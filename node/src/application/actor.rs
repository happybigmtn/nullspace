use super::{
    ingress::{Mailbox, Message},
    Config,
};
use crate::{
    aggregator,
    application::mempool::Mempool,
    backoff::jittered_backoff,
    indexer::Indexer,
    seeder,
    supervisor::{EpochSupervisor, Supervisor, ViewSupervisor},
};
use commonware_consensus::{marshal, threshold_simplex::types::View};
use commonware_cryptography::{
    bls12381::primitives::{poly::public, variant::MinSig},
    ed25519::Batch,
    sha256::Digest,
    BatchVerifier, Committable, Digestible, Sha256,
};
use commonware_macros::select;
use commonware_runtime::{
    buffer::PoolRef, telemetry::metrics::histogram, Clock, Handle, Metrics, Spawner, Storage,
    ThreadPool,
};
use commonware_storage::{
    adb::{self, keyless},
    translator::EightCap,
};
use commonware_utils::{futures::ClosedExt, NZU64};
use futures::StreamExt;
use futures::{channel::mpsc, future::try_join};
use futures::{future, future::Either};
use nullspace_execution::{nonce, state_transition, Adb, Noncer};
use nullspace_types::{
    execution::{Output, Value, MAX_BLOCK_TRANSACTIONS},
    genesis_block, genesis_digest, Block, Identity,
};
use prometheus_client::metrics::{counter::Counter, histogram::Histogram};
use rand::{CryptoRng, Rng};
use std::{
    collections::{HashMap, VecDeque},
    num::NonZero,
    sync::{atomic::AtomicU64, Arc, Mutex},
    time::Duration,
};
use tracing::{debug, error, info, warn};

/// Histogram buckets for application latency.
const LATENCY: [f64; 20] = [
    0.001, 0.002, 0.003, 0.004, 0.005, 0.0075, 0.010, 0.015, 0.020, 0.025, 0.030, 0.050, 0.075,
    0.100, 0.200, 0.500, 1.0, 2.0, 5.0, 10.0,
];

/// Attempt to prune the state every 10000 blocks (randomly).
const PRUNE_INTERVAL: u64 = 10_000;

/// Upper bound on cached ancestry results.
const ANCESTRY_CACHE_ENTRIES: usize = 64;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct AncestryCacheKey {
    start: Digest,
    end: u64,
}

struct AncestryCache {
    capacity: usize,
    entries: HashMap<AncestryCacheKey, Arc<[Block]>>,
    lru: VecDeque<AncestryCacheKey>,
}

impl AncestryCache {
    fn new(capacity: usize) -> Self {
        Self {
            capacity,
            entries: HashMap::new(),
            lru: VecDeque::new(),
        }
    }

    fn get(&mut self, key: &AncestryCacheKey) -> Option<Arc<[Block]>> {
        let blocks = self.entries.get(key)?.clone();
        self.lru.retain(|k| k != key);
        self.lru.push_back(key.clone());
        Some(blocks)
    }

    fn insert(&mut self, key: AncestryCacheKey, blocks: Arc<[Block]>) {
        if self.entries.contains_key(&key) {
            self.entries.insert(key.clone(), blocks);
            self.lru.retain(|k| k != &key);
            self.lru.push_back(key);
            return;
        }

        if self.entries.len() >= self.capacity {
            if let Some(oldest) = self.lru.pop_front() {
                self.entries.remove(&oldest);
            }
        }

        self.lru.push_back(key.clone());
        self.entries.insert(key, blocks);
    }
}

async fn ancestry(
    mut marshal: marshal::Mailbox<MinSig, Block>,
    start: (Option<View>, Digest),
    end: u64,
) -> Option<Arc<[Block]>> {
    let mut ancestry = Vec::new();

    // Get the start block
    let Ok(block) = marshal.subscribe(start.0, start.1).await.await else {
        return None;
    };
    let mut next = (block.height.saturating_sub(1), block.parent);
    ancestry.push(block);

    // Recurse until reaching the end height
    while next.0 > end {
        let request = marshal.subscribe(None, next.1).await;
        let Ok(block) = request.await else {
            return None;
        };
        next = (block.height.saturating_sub(1), block.parent);
        ancestry.push(block);
    }

    // Reverse the ancestry
    let blocks: Vec<Block> = ancestry.into_iter().rev().collect();
    Some(Arc::from(blocks))
}

async fn ancestry_cached(
    marshal: marshal::Mailbox<MinSig, Block>,
    start: (Option<View>, Digest),
    end: u64,
    cache: Arc<Mutex<AncestryCache>>,
) -> Option<Arc<[Block]>> {
    let key = AncestryCacheKey {
        start: start.1,
        end,
    };
    {
        let mut cache = cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(blocks) = cache.get(&key) {
            return Some(blocks);
        }
    }

    let blocks = ancestry(marshal, start, end).await?;

    let mut cache = cache
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    cache.insert(key, blocks.clone());
    Some(blocks)
}

/// Application actor.
pub struct Actor<R: Rng + CryptoRng + Spawner + Metrics + Clock + Storage, I: Indexer> {
    context: R,
    inbound: Mailbox<R>,
    mailbox: mpsc::Receiver<Message<R>>,
    identity: Identity,
    partition_prefix: String,
    mmr_items_per_blob: NonZero<u64>,
    mmr_write_buffer: NonZero<usize>,
    log_items_per_section: NonZero<u64>,
    log_write_buffer: NonZero<usize>,
    locations_items_per_blob: NonZero<u64>,
    buffer_pool: PoolRef,
    indexer: I,
    execution_concurrency: usize,
    mempool_max_backlog: usize,
    mempool_max_transactions: usize,
}

impl<R: Rng + CryptoRng + Spawner + Metrics + Clock + Storage, I: Indexer> Actor<R, I> {
    /// Create a new application actor.
    pub fn new(
        context: R,
        config: Config<I>,
    ) -> (Self, ViewSupervisor, EpochSupervisor, Mailbox<R>) {
        // Create actor
        let (sender, mailbox) = mpsc::channel(config.mailbox_size);
        let inbound = Mailbox::new(sender, context.stopped());

        // Create supervisors
        let identity = *public::<MinSig>(&config.polynomial);
        let supervisor = Supervisor::new(config.polynomial, config.participants, config.share);
        let view_supervisor = ViewSupervisor::new(supervisor.clone());
        let epoch_supervisor = EpochSupervisor::new(supervisor);

        (
            Self {
                context,
                mailbox,
                inbound: inbound.clone(),
                identity,
                partition_prefix: config.partition_prefix,
                mmr_items_per_blob: config.mmr_items_per_blob,
                mmr_write_buffer: config.mmr_write_buffer,
                log_items_per_section: config.log_items_per_section,
                log_write_buffer: config.log_write_buffer,
                locations_items_per_blob: config.locations_items_per_blob,
                buffer_pool: config.buffer_pool,
                indexer: config.indexer,
                execution_concurrency: config.execution_concurrency,
                mempool_max_backlog: config.mempool_max_backlog,
                mempool_max_transactions: config.mempool_max_transactions,
            },
            view_supervisor,
            epoch_supervisor,
            inbound,
        )
    }

    pub fn start(
        mut self,
        marshal: marshal::Mailbox<MinSig, Block>,
        seeder: seeder::Mailbox,
        aggregator: aggregator::Mailbox,
    ) -> Handle<()> {
        self.context.spawn_ref()(self.run(marshal, seeder, aggregator))
    }

    /// Run the application actor.
    async fn run(
        mut self,
        mut marshal: marshal::Mailbox<MinSig, Block>,
        seeder: seeder::Mailbox,
        mut aggregator: aggregator::Mailbox,
    ) {
        // Initialize metrics
        let txs_considered: Counter<u64, AtomicU64> = Counter::default();
        let txs_executed: Counter<u64, AtomicU64> = Counter::default();
        let state_metadata_read_errors: Counter<u64, AtomicU64> = Counter::default();
        let nonce_read_errors: Counter<u64, AtomicU64> = Counter::default();
        let state_transition_errors: Counter<u64, AtomicU64> = Counter::default();
        let storage_prune_errors: Counter<u64, AtomicU64> = Counter::default();
        let ancestry_latency = Histogram::new(LATENCY.into_iter());
        let propose_latency = Histogram::new(LATENCY.into_iter());
        let verify_latency = Histogram::new(LATENCY.into_iter());
        let seeded_latency = Histogram::new(LATENCY.into_iter());
        let execute_latency = Histogram::new(LATENCY.into_iter());
        let finalize_latency = Histogram::new(LATENCY.into_iter());
        let prune_latency = Histogram::new(LATENCY.into_iter());
        self.context.register(
            "txs_considered",
            "Number of transactions considered during propose",
            txs_considered.clone(),
        );
        self.context.register(
            "txs_executed",
            "Number of transactions executed after finalization",
            txs_executed.clone(),
        );
        self.context.register(
            "state_metadata_read_errors",
            "Number of state metadata read errors in application actor",
            state_metadata_read_errors.clone(),
        );
        self.context.register(
            "nonce_read_errors",
            "Number of account nonce read errors in application actor",
            nonce_read_errors.clone(),
        );
        self.context.register(
            "state_transition_errors",
            "Number of state transition execution errors in application actor",
            state_transition_errors.clone(),
        );
        self.context.register(
            "storage_prune_errors",
            "Number of storage prune errors in application actor",
            storage_prune_errors.clone(),
        );
        self.context.register(
            "ancestry_latency",
            "Latency of ancestry requests",
            ancestry_latency.clone(),
        );
        self.context.register(
            "propose_latency",
            "Latency of propose requests",
            propose_latency.clone(),
        );
        self.context.register(
            "verify_latency",
            "Latency of verify requests",
            verify_latency.clone(),
        );
        self.context.register(
            "seeded_latency",
            "Latency of seeded requests",
            seeded_latency.clone(),
        );
        self.context.register(
            "execute_latency",
            "Latency of execute requests",
            execute_latency.clone(),
        );
        self.context.register(
            "finalize_latency",
            "Latency of finalize requests",
            finalize_latency.clone(),
        );
        self.context.register(
            "prune_latency",
            "Latency of prune requests",
            prune_latency.clone(),
        );
        let ancestry_latency = histogram::Timed::new(
            ancestry_latency,
            Arc::new(self.context.with_label("ancestry_latency")),
        );
        let propose_latency = histogram::Timed::new(
            propose_latency,
            Arc::new(self.context.with_label("propose_latency")),
        );
        let verify_latency = histogram::Timed::new(
            verify_latency,
            Arc::new(self.context.with_label("verify_latency")),
        );
        let seeded_latency = histogram::Timed::new(
            seeded_latency,
            Arc::new(self.context.with_label("seeded_latency")),
        );
        let execute_latency = histogram::Timed::new(
            execute_latency,
            Arc::new(self.context.with_label("execute_latency")),
        );
        let finalize_latency = histogram::Timed::new(
            finalize_latency,
            Arc::new(self.context.with_label("finalize_latency")),
        );
        let prune_latency = histogram::Timed::new(
            prune_latency,
            Arc::new(self.context.with_label("prune_latency")),
        );

        // Initialize the state
        let mut state = match Adb::init(
            self.context.with_label("state"),
            adb::any::variable::Config {
                mmr_journal_partition: format!("{}-state-mmr-journal", self.partition_prefix),
                mmr_metadata_partition: format!("{}-state-mmr-metadata", self.partition_prefix),
                mmr_items_per_blob: self.mmr_items_per_blob,
                mmr_write_buffer: self.mmr_write_buffer,
                log_journal_partition: format!("{}-state-log-journal", self.partition_prefix),
                log_items_per_section: self.log_items_per_section,
                log_write_buffer: self.log_write_buffer,
                log_compression: None,
                log_codec_config: (),
                locations_journal_partition: format!(
                    "{}-state-locations-journal",
                    self.partition_prefix
                ),
                locations_items_per_blob: self.locations_items_per_blob,
                translator: EightCap,
                thread_pool: None,
                buffer_pool: self.buffer_pool.clone(),
            },
        )
        .await
        {
            Ok(state) => state,
            Err(err) => {
                error!(?err, "failed to initialize state adb");
                return;
            }
        };
        let mut events = match keyless::Keyless::<_, Output, Sha256>::init(
            self.context.with_label("events"),
            keyless::Config {
                mmr_journal_partition: format!("{}-events-mmr-journal", self.partition_prefix),
                mmr_metadata_partition: format!("{}-events-mmr-metadata", self.partition_prefix),
                mmr_items_per_blob: self.mmr_items_per_blob,
                mmr_write_buffer: self.mmr_write_buffer,
                log_journal_partition: format!("{}-events-log-journal", self.partition_prefix),
                log_items_per_section: self.log_items_per_section,
                log_write_buffer: self.log_write_buffer,
                log_compression: None,
                log_codec_config: (),
                locations_journal_partition: format!(
                    "{}-events-locations-journal",
                    self.partition_prefix
                ),
                locations_items_per_blob: self.locations_items_per_blob,
                locations_write_buffer: self.log_write_buffer,
                thread_pool: None,
                buffer_pool: self.buffer_pool.clone(),
            },
        )
        .await
        {
            Ok(events) => events,
            Err(err) => {
                error!(?err, "failed to initialize events log");
                return;
            }
        };

        // Create the execution pool
        //
        // Note: Using rayon ThreadPool directly. When commonware-runtime::create_pool
        // becomes available (see https://github.com/commonwarexyz/monorepo/issues/1540),
        // consider migrating to it for consistency with the runtime.
        let execution_pool = match rayon::ThreadPoolBuilder::new()
            .num_threads(self.execution_concurrency)
            .build()
        {
            Ok(execution_pool) => execution_pool,
            Err(err) => {
                error!(?err, "failed to create execution pool");
                return;
            }
        };
        let execution_pool = ThreadPool::new(execution_pool);

        // Compute genesis digest
        let genesis_digest = genesis_digest();

        let mut committed_height = match state.get_metadata().await {
            Ok(meta) => meta
                .and_then(|(_, v)| match v {
                    Some(Value::Commit { height, start: _ }) => Some(height),
                    _ => None,
                })
                .unwrap_or(0),
            Err(err) => {
                state_metadata_read_errors.inc();
                warn!(
                    ?err,
                    "failed to read state metadata during init; using height=0"
                );
                0
            }
        };

        // Track built blocks
        let built: Option<(View, Block)> = None;
        let built = Arc::new(Mutex::new(built));

        let ancestry_cache = Arc::new(Mutex::new(AncestryCache::new(ANCESTRY_CACHE_ENTRIES)));

        // Initialize mempool
        let mut mempool = Mempool::new_with_limits(
            self.context.with_label("mempool"),
            self.mempool_max_backlog,
            self.mempool_max_transactions,
        );
        let mut next_nonce_cache = HashMap::new();

        // Use reconnecting indexer wrapper
        let reconnecting_indexer = crate::indexer::ReconnectingIndexer::new(
            self.context.with_label("indexer"),
            self.indexer,
        );

        // This will never fail and handles reconnection internally
        let mut next_prune = self.context.gen_range(1..=PRUNE_INTERVAL);
        let tx_stream = match reconnecting_indexer.listen_mempool().await {
            Ok(tx_stream) => tx_stream,
            Err(err) => {
                error!(?err, "failed to start indexer mempool stream");
                return;
            }
        };
        let mut tx_stream = Box::pin(tx_stream);
        loop {
            select! {
                    message =  self.mailbox.next() => {
                        let Some(message) = message else {
                            return;
                        };
                        match message {
                            Message::Genesis { response } => {
                                // Use the digest of the genesis message as the initial
                                // payload.
                                let _ = response.send(genesis_digest);
                            }
                            Message::Propose {
                                view,
                                parent,
                                mut response,
                            } => {
                                // Start the timer
                                let ancestry_timer = ancestry_latency.timer();
                                let propose_timer = propose_latency.timer();

                                // Immediately send a response for genesis block
                                if parent.1 == genesis_digest {
                                    drop(ancestry_timer);
                                    if let Err(err) = self
                                        .inbound
                                        .ancestry(view, Arc::from(vec![genesis_block()]), propose_timer, response)
                                        .await
                                    {
                                        warn!(view, ?err, "failed to send ancestry response");
                                    }
                                    continue;
                                }

                                // Get the ancestry
                                let committed_height_snapshot = committed_height;
                                let ancestry = ancestry_cached(
                                    marshal.clone(),
                                    (Some(parent.0), parent.1),
                                    committed_height_snapshot,
                                    ancestry_cache.clone(),
                                );

                                // Wait for the parent block to be available or the request to be cancelled in a separate task (to
                                // continue processing other messages)
                                self.context.with_label("ancestry").spawn({
                                    let mut inbound = self.inbound.clone();
                                    move |_| async move {
                                        select! {
                                            ancestry = ancestry => {
                                                // Get the ancestry
                                                let Some(ancestry) = ancestry else {
                                                    ancestry_timer.cancel();
                                                    warn!(view, "missing parent ancestry");
                                                    return;
                                                };
                                                drop(ancestry_timer);

                                                // Pass back to mailbox
                                                if let Err(err) = inbound
                                                    .ancestry(view, ancestry, propose_timer, response)
                                                    .await
                                                {
                                                    warn!(view, ?err, "failed to send ancestry response");
                                                }
                                            },
                                            _ = response.closed() => {
                                                // The response was cancelled
                                                ancestry_timer.cancel();
                                                warn!(view, "propose aborted");
                                            }
                                        }
                                    }
                                });
                            }
                            Message::Ancestry {
                                view,
                                blocks,
                                timer,
                                response,
                            } => {
                                // Get parent block
                                let Some(parent) = blocks.last() else {
                                    warn!(view, "missing parent block for propose");
                                    drop(timer);
                                    continue;
                                };

                                // Find first block on top of finalized state (may have increased since we started)
                                let height = committed_height;
                                let mut noncer = Noncer::new(&state);
                                for block in blocks.iter() {
                                    // Skip blocks below our height
                                    if block.height <= height {
                                        debug!(block = block.height, processed = height, "skipping block during propose");
                                        continue;
                                    }

                                    // Apply transaction nonces to state
                                    for tx in &block.transactions {
                                        // We don't care if the nonces are valid or not, we just need to ensure we'll process tip the same way as state will be processed during finalization
                                        let _ = noncer.prepare(tx).await;
                                    }
                                }

                                // Select up to max transactions using non-destructive peek.
                                // Transactions remain in mempool until finalized (via retain).
                                // Peek more than needed to account for nonce validation rejections.
                                let candidates = mempool.peek_batch(MAX_BLOCK_TRANSACTIONS * 2);
                                let considered = candidates.len();
                                let mut transactions = Vec::new();
                                for tx in candidates {
                                    if transactions.len() >= MAX_BLOCK_TRANSACTIONS {
                                        break;
                                    }

                                    // Attempt to apply
                                    if noncer.prepare(&tx).await.is_err() {
                                        continue;
                                    }

                                    // Add to transactions
                                    transactions.push(tx);
                                }
                                let txs = transactions.len();

                                // Update metrics
                                txs_considered.inc_by(considered as u64);

                                // When ancestry for propose is provided, we can attempt to pack a block.
                                //
                                // This should be infallible because we explicitly bound `transactions` to
                                // `MAX_BLOCK_TRANSACTIONS`, but use `try_new` to avoid a panic if future
                                // code changes violate the invariant.
                                let block = match Block::try_new(
                                    parent.digest(),
                                    view,
                                    parent.height + 1,
                                    transactions,
                                ) {
                                    Ok(block) => block,
                                    Err(err) => {
                                        warn!(
                                            view,
                                            parent_height = parent.height,
                                            ?err,
                                            "failed to build proposed block; proposing parent digest"
                                        );
                                        let _ = response.send(parent.digest());
                                        drop(timer);
                                        continue;
                                    }
                                };
                                let digest = block.digest();
                                {
                                    // We may drop the transactions from a block that was never broadcast...users
                                    // can rebroadcast.
                                    let mut built = built.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                                    *built = Some((view, block));
                                }

                                // Send the digest to the consensus
                                let result = response.send(digest);
                                info!(view, ?digest, txs, success=result.is_ok(), "proposed block");
                                drop(timer);
                            }
                            Message::Broadcast { payload } => {
                                // Check if the last built is equal
                                let Some(built) = built.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take() else {
                                    warn!(?payload, "missing block to broadcast");
                                    continue;
                                };

                                // Check if the block is equal
                                if built.1.commitment() != payload {
                                    warn!(?payload, "outdated broadcast");
                                    continue;
                                }

                                // Send the block to the syncer
                                debug!(
                                    ?payload,
                                    view = built.0,
                                    height = built.1.height,
                                    "broadcast requested"
                                );
                                marshal.broadcast(built.1).await;
                            }
                            Message::Verify {
                                view,
                                parent,
                                payload,
                                mut response,
                            } => {
                                // Start the timer
                                let timer = verify_latency.timer();

                                // Get the parent and current block
                                let parent_request = if parent.1 == genesis_digest {
                                    Either::Left(future::ready(Ok(genesis_block())))
                                } else {
                                    Either::Right(marshal.subscribe(Some(parent.0), parent.1).await)
                                };

                                // Wait for the blocks to be available or the request to be cancelled in a separate task (to
                                // continue processing other messages)
                                self.context.with_label("verify").spawn({
                                    let mut marshal = marshal.clone();
                                    move |mut context| async move {
                                        let requester =
                                            try_join(parent_request, marshal.subscribe(None, payload).await);
                                        select! {
                                            result = requester => {
                                                let Ok((parent, block)) = result else {
                                                    warn!(view, ?payload, "verify aborted: missing blocks");
                                                    let _ = response.send(false);
                                                    return;
                                                };

                                                // Verify the block
                                                if block.view != view {
                                                    let _ = response.send(false);
                                                    return;
                                                }
                                                if block.height != parent.height + 1 {
                                                    let _ = response.send(false);
                                                    return;
                                                }
                                                if block.parent != parent.digest() {
                                                    let _ = response.send(false);
                                                    return;
                                                }

                                                // Batch verify transaction signatures (we don't care if the nonces are valid or not, we'll just skip the ones that are invalid)
                                                let mut batcher = Batch::new();
                                                let mut payload_scratch = Vec::new();
                                                for tx in &block.transactions {
                                                    tx.verify_batch_with_scratch(
                                                        &mut batcher,
                                                        &mut payload_scratch,
                                                    );
                                                }
                                                if !batcher.verify(&mut context) {
                                                    let _ = response.send(false);
                                                    return;
                                                }

                                                // Persist the verified block (transactions may be invalid)
                                                marshal.verified(view, block).await;

                                                // Send the verification result to the consensus
                                                let _ = response.send(true);

                                                // Stop the timer
                                                drop(timer);
                                            },
                                            _ = response.closed() => {
                                                // The response was cancelled
                                                warn!(view, "verify aborted");
                                            }
                                        }
                                    }
                                });
                            }
                            Message::Finalized { block, response } => {
                                // Start the timer
                                let seeded_timer = seeded_latency.timer();
                                let finalize_timer = finalize_latency.timer();

                                // While waiting for the seed required for processing, we should spawn a task
                                // to handle resolution to avoid blocking the application.
                                self.context.with_label("seeded").spawn({
                                    let mut inbound = self.inbound.clone();
                                    let mut seeder = seeder.clone();
                                    move |_| async move {
                                        let seed = match seeder.get(block.view).await {
                                            Ok(seed) => seed,
                                            Err(err) => {
                                                warn!(?err, view = block.view, "failed to fetch seed");
                                                return;
                                            }
                                        };
                                        drop(seeded_timer);
                                        if let Err(err) = inbound
                                            .seeded(block, seed, finalize_timer, response)
                                            .await
                                        {
                                            warn!(?err, "failed to send seeded response");
                                        }
                                    }
                                });

                            }
                            Message::Seeded { block, seed, timer, response } => {
                                // Execute state transition (will only apply if next block)
                                let height = block.height;
                                let commitment = block.commitment();

                                // Apply the block to our state
                                //
                                // We must wait for the seed to be available before processing the block,
                                // otherwise we will not be able to match players or compute attack strength.
                                let execute_timer = execute_latency.timer();
                                let tx_count = block.transactions.len();
                                let result = state_transition::execute_state_transition(
                                    &mut state,
                                    &mut events,
                                    self.identity,
                                    height,
                                    seed,
                                    block.transactions,
                                    execution_pool.clone(),
                                )
                                .await;
                                let result = match result {
                                    Ok(result) => result,
                                    Err(err) => {
                                        state_transition_errors.inc();
                                        error!(?err, height, "state transition failed");
                                        return;
                                    }
                                };
                                drop(execute_timer);

                                // Update metrics
                                txs_executed.inc_by(tx_count as u64);

                                // Update mempool based on processed transactions
                                for (public, next_nonce) in &result.processed_nonces {
                                    mempool.retain(public, *next_nonce);
                                    next_nonce_cache.insert(public.clone(), *next_nonce);
                                }

                                // Generate range proof for changes
                                let state_proof_ops = result.state_end_op - result.state_start_op;
                                let events_start_op = result.events_start_op;
                                let events_proof_ops = result.events_end_op - events_start_op;
                                if state_proof_ops == 0 && events_proof_ops == 0 {
                                    // No-op execution (already processed or out-of-order); skip proof generation.
                                    let _ = response.send(());
                                    drop(timer);
                                    continue;
                                }
                                committed_height = committed_height.max(height);
                                let mut attempt = 0usize;
                                let mut backoff = Duration::from_millis(50);
                                let ((state_proof, state_proof_ops), (events_proof, events_proof_ops)) = loop {
                                    attempt += 1;
                                    match try_join(
                                        state.historical_proof(
                                            result.state_end_op,
                                            result.state_start_op,
                                            state_proof_ops,
                                        ),
                                        events.historical_proof(
                                            result.events_end_op,
                                            events_start_op,
                                            NZU64!(events_proof_ops),
                                        ),
                                    )
                                    .await
                                    {
                                        Ok(proofs) => break proofs,
                                        Err(err) if attempt < 5 => {
                                            warn!(
                                                ?err,
                                                height,
                                                attempt,
                                                "failed to generate proofs; retrying"
                                            );
                                            let delay =
                                                jittered_backoff(&mut self.context, backoff);
                                            self.context.sleep(delay).await;
                                            backoff = (backoff.saturating_mul(2))
                                                .min(Duration::from_secs(2));
                                        }
                                        Err(err) => {
                                            error!(
                                                ?err,
                                                height,
                                                attempt,
                                                "failed to generate proofs; aborting engine"
                                            );
                                            return;
                                        }
                                    }
                                };

                                // Send to aggregator
                                aggregator.executed(block.view, block.height, commitment, result, state_proof, state_proof_ops, events_proof, events_proof_ops, response).await;

                                // Stop the timer
                                drop(timer);

                                // Attempt to prune (this syncs data prior to prune, so we don't need to call separately)
                                next_prune -= 1;
                                if next_prune == 0 {
                                    // Prune storage
                                    let timer = prune_latency.timer();
                                    if let Err(err) = try_join(
                                        state.prune(state.inactivity_floor_loc()),
                                        events.prune(events_start_op),
                                    )
                                    .await
                                    {
                                        storage_prune_errors.inc();
                                        warn!(?err, height, "failed to prune storage");
                                    }
                                    drop(timer);

                                    // Reset next prune
                                    next_prune = self.context.gen_range(1..=PRUNE_INTERVAL);
                                }
                            },
                        }
                },
                pending = tx_stream.next() => {
                    // The reconnecting wrapper handles all connection issues internally
                    // We only get Some(Ok(tx)) for valid transactions
                    let Some(Ok(pending)) = pending else {
                        // This should only happen if there's a transaction-level error
                        // The stream itself won't end due to the reconnecting wrapper
                        continue;
                    };

                    // Process transactions (already verified in indexer client)
                    for tx in pending.transactions {
                        // Check if below next
                        let next = match next_nonce_cache.get(&tx.public) {
                            Some(next) => *next,
                            None => match nonce(&state, &tx.public).await {
                                Ok(next) => {
                                    next_nonce_cache.insert(tx.public.clone(), next);
                                    next
                                }
                                Err(err) => {
                                    nonce_read_errors.inc();
                                    warn!(
                                        ?err,
                                        public = ?tx.public,
                                        "failed to read account nonce; dropping transaction"
                                    );
                                    continue;
                                }
                            },
                        };
                        if tx.nonce < next {
                            // If below next, we drop the incoming transaction
                            debug!(tx = tx.nonce, state = next, "dropping incoming transaction");
                            continue;
                        }

                        // Add to mempool
                        mempool.add(tx);
                    }
                }
            }
        }
    }
}
