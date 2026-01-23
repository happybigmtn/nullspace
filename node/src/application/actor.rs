use super::{
    ingress::{Mailbox, Message},
    Config,
};
use crate::{
    aggregator,
    application::mempool::{AddRejectReason, AddResult, Mempool},
    backoff::jittered_backoff,
    indexer::Indexer,
    seeder,
    supervisor::{AggregationSupervisor, EpochSupervisor, Supervisor, ViewSupervisor},
};
use commonware_consensus::{marshal, types::{Round, View}};
use commonware_cryptography::{
    bls12381::primitives::variant::MinSig,
    ed25519::{Batch, PublicKey},
    sha256::Digest,
    BatchVerifier, Committable, Digestible, Sha256,
};
use commonware_macros::select;
use commonware_runtime::{
    buffer::PoolRef, telemetry::metrics::histogram, Clock, Handle, Metrics, Spawner, Storage,
    ThreadPool,
};
use commonware_storage::mmr::{mem::Clean, Location};
use commonware_storage::qmdb::{any::VariableConfig, keyless};
use commonware_storage::qmdb::store::CleanStore as _;
use commonware_storage::translator::EightCap;
use commonware_utils::futures::ClosedExt;
use futures::executor::block_on;
use futures::{SinkExt, StreamExt};
use futures::{
    channel::{mpsc, oneshot},
    future::try_join,
};
use futures::{future, future::Either};
use nullspace_execution::{state_transition, Adb, PrepareError, State};
use nullspace_types::{
    execution::{Key, Output, Value, MAX_BLOCK_TRANSACTIONS},
    genesis_block, genesis_digest, Block, Identity,
};
use prometheus_client::metrics::{counter::Counter, gauge::Gauge, histogram::Histogram};
use rand::{CryptoRng, Rng};
use std::{
    collections::{HashMap, VecDeque},
    num::NonZero,
    sync::{atomic::AtomicU64, Arc, Mutex},
    time::{Duration, SystemTime},
};
use tokio::sync::Mutex as AsyncMutex;
use tracing::{debug, error, info, warn};

type ThresholdScheme =
    commonware_consensus::simplex::scheme::bls12381_threshold::Scheme<PublicKey, MinSig>;

/// Histogram buckets for application latency.
const LATENCY: [f64; 20] = [
    0.001, 0.002, 0.003, 0.004, 0.005, 0.0075, 0.010, 0.015, 0.020, 0.025, 0.030, 0.050, 0.075,
    0.100, 0.200, 0.500, 1.0, 2.0, 5.0, 10.0,
];

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

struct NonceCacheEntry {
    next_nonce: u64,
    last_seen: SystemTime,
}

struct NonceCache {
    entries: HashMap<PublicKey, NonceCacheEntry>,
    lru: VecDeque<PublicKey>,
    capacity: usize,
    ttl: Duration,
}

impl NonceCache {
    fn new(capacity: usize, ttl: Duration) -> Self {
        Self {
            entries: HashMap::new(),
            lru: VecDeque::new(),
            capacity,
            ttl,
        }
    }

    fn get(&mut self, now: SystemTime, public: &PublicKey) -> Option<u64> {
        self.evict_expired(now);
        // Check if entry exists and if it's expired (without holding mutable borrow)
        let (is_expired, next_nonce) = {
            let entry = self.entries.get(public)?;
            let expired = match now.duration_since(entry.last_seen) {
                Ok(elapsed) => elapsed > self.ttl,
                Err(_) => false,
            };
            (expired, entry.next_nonce)
        };
        if is_expired {
            self.remove(public);
            return None;
        }
        // Update last_seen and touch LRU
        if let Some(entry) = self.entries.get_mut(public) {
            entry.last_seen = now;
        }
        self.touch(public);
        Some(next_nonce)
    }

    fn insert(&mut self, now: SystemTime, public: PublicKey, next_nonce: u64) {
        self.evict_expired(now);
        self.entries.insert(
            public.clone(),
            NonceCacheEntry {
                next_nonce,
                last_seen: now,
            },
        );
        self.touch(&public);
        self.evict_capacity();
    }

    fn touch(&mut self, public: &PublicKey) {
        self.lru.retain(|key| key != public);
        self.lru.push_back(public.clone());
    }

    fn remove(&mut self, public: &PublicKey) {
        self.entries.remove(public);
        self.lru.retain(|key| key != public);
    }

    fn evict_expired(&mut self, now: SystemTime) {
        loop {
            let Some(oldest) = self.lru.front().cloned() else {
                break;
            };
            let expired = match self.entries.get(&oldest) {
                Some(entry) => {
                    // Inline expiry check to avoid borrow issues
                    match now.duration_since(entry.last_seen) {
                        Ok(elapsed) => elapsed > self.ttl,
                        Err(_) => false,
                    }
                }
                None => true,
            };
            if !expired {
                break;
            }
            self.lru.pop_front();
            self.entries.remove(&oldest);
        }
    }

    fn evict_capacity(&mut self) {
        while self.entries.len() > self.capacity {
            let Some(oldest) = self.lru.pop_front() else {
                break;
            };
            self.entries.remove(&oldest);
        }
    }

}

async fn fetch_account_nonce<R>(
    state: Arc<AsyncMutex<Adb<R, EightCap>>>,
    public: PublicKey,
) -> Result<u64, PrepareError>
where
    R: Rng + CryptoRng + Spawner + Metrics + Clock + Storage + Clone + Send + Sync + 'static,
{
    let state_guard = state.lock().await;
    match block_on(State::get(&*state_guard, Key::Account(public)))
        .map_err(PrepareError::State)?
    {
        Some(Value::Account(account)) => Ok(account.nonce),
        _ => Ok(0),
    }
}

fn system_time_ms(now: SystemTime) -> i64 {
    match now.duration_since(SystemTime::UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as i64,
        Err(_) => 0,
    }
}

async fn apply_transaction_nonce<R>(
    state: Arc<AsyncMutex<Adb<R, EightCap>>>,
    pending: &mut HashMap<PublicKey, u64>,
    public: PublicKey,
    nonce: u64,
) -> Result<(), PrepareError>
where
    R: Rng + CryptoRng + Spawner + Metrics + Clock + Storage + Clone + Send + Sync + 'static,
{
    let cached_nonce = pending.get(&public).copied();
    let expected = match cached_nonce {
        Some(nonce) => nonce,
        None => fetch_account_nonce(state, public.clone()).await?,
    };

    if expected != nonce {
        return Err(PrepareError::NonceMismatch {
            expected,
            got: nonce,
        });
    }

    pending.insert(public, expected.saturating_add(1));
    Ok(())
}

struct ProofJob<R: Clock> {
    view: View,
    height: u64,
    commitment: Digest,
    result: state_transition::StateTransitionResult,
    finalize_timer: histogram::Timer<R>,
    response: oneshot::Sender<()>,
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
    mut marshal: marshal::Mailbox<ThresholdScheme, Block>,
    start: (Option<Round>, Digest),
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
    marshal: marshal::Mailbox<ThresholdScheme, Block>,
    start: (Option<Round>, Digest),
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
pub struct Actor<
    R: Rng + CryptoRng + Spawner + Metrics + Clock + Storage + Clone + Send + Sync,
    I: Indexer,
> {
    context: R,
    inbound: Mailbox<R>,
    mailbox: mpsc::Receiver<Message<R>>,
    identity: Identity,
    partition_prefix: String,
    mmr_items_per_blob: NonZero<u64>,
    mmr_write_buffer: NonZero<usize>,
    log_items_per_section: NonZero<u64>,
    log_write_buffer: NonZero<usize>,
    _locations_items_per_blob: NonZero<u64>,
    buffer_pool: PoolRef,
    indexer: I,
    execution_concurrency: usize,
    mempool_max_backlog: usize,
    mempool_max_transactions: usize,
    mempool_stream_buffer_size: usize,
    mempool_inclusion_sla_ms: u64,
    nonce_cache_capacity: usize,
    nonce_cache_ttl: Duration,
    prune_interval: u64,
    ancestry_cache_entries: usize,
    proof_queue_size: usize,
}

impl<
        R: Rng + CryptoRng + Spawner + Metrics + Clock + Storage + Clone + Send + Sync,
        I: Indexer,
    > Actor<R, I>
{
    /// Create a new application actor.
    pub fn new(
        context: R,
        config: Config<I>,
    ) -> (Self, ViewSupervisor, EpochSupervisor, AggregationSupervisor, Mailbox<R>) {
        // Create actor
        let (sender, mailbox) = mpsc::channel(config.mailbox_size);
        let inbound = Mailbox::new(sender, context.stopped());

        // Create supervisors
        let identity = *config.sharing.public();
        let supervisor = Supervisor::new(config.sharing, config.participants, config.share);
        let view_supervisor = ViewSupervisor::new(supervisor.clone());
        let epoch_supervisor = EpochSupervisor::new(supervisor.clone());
        let aggregation_supervisor = AggregationSupervisor::new(supervisor);

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
            _locations_items_per_blob: config.locations_items_per_blob,
                buffer_pool: config.buffer_pool,
                indexer: config.indexer,
                execution_concurrency: config.execution_concurrency,
                mempool_max_backlog: config.mempool_max_backlog,
                mempool_max_transactions: config.mempool_max_transactions,
                mempool_stream_buffer_size: config.mempool_stream_buffer_size,
                mempool_inclusion_sla_ms: config.mempool_inclusion_sla_ms,
                nonce_cache_capacity: config.nonce_cache_capacity,
                nonce_cache_ttl: config.nonce_cache_ttl,
                prune_interval: config.prune_interval,
                ancestry_cache_entries: config.ancestry_cache_entries,
                proof_queue_size: config.proof_queue_size,
            },
            view_supervisor,
            epoch_supervisor,
            aggregation_supervisor,
            inbound,
        )
    }

    pub fn start(
        self,
        marshal: marshal::Mailbox<ThresholdScheme, Block>,
        seeder: seeder::Mailbox,
        aggregator: aggregator::Mailbox,
    ) -> Handle<()> {
        let context = self.context.clone();
        context.spawn(move |context| async move {
            let mut actor = self;
            actor.context = context;
            actor.run(marshal, seeder, aggregator).await;
        })
    }

    /// Run the application actor.
    async fn run(
        mut self,
        mut marshal: marshal::Mailbox<ThresholdScheme, Block>,
        seeder: seeder::Mailbox,
        aggregator: aggregator::Mailbox,
    ) {
        // Initialize metrics
        let txs_considered: Counter<u64, AtomicU64> = Counter::default();
        let txs_executed: Counter<u64, AtomicU64> = Counter::default();
        let state_metadata_read_errors: Counter<u64, AtomicU64> = Counter::default();
        let nonce_read_errors: Counter<u64, AtomicU64> = Counter::default();
        let pending_batches: Counter<u64, AtomicU64> = Counter::default();
        let pending_transactions: Counter<u64, AtomicU64> = Counter::default();
        let pending_transactions_added: Counter<u64, AtomicU64> = Counter::default();
        let pending_transactions_trimmed: Counter<u64, AtomicU64> = Counter::default();
        let pending_transactions_rejected_capacity: Counter<u64, AtomicU64> = Counter::default();
        let pending_transactions_rejected_backlog: Counter<u64, AtomicU64> = Counter::default();
        let pending_transactions_duplicate: Counter<u64, AtomicU64> = Counter::default();
        let pending_transactions_dropped_nonce: Counter<u64, AtomicU64> = Counter::default();
        let pending_transactions_future_nonce: Counter<u64, AtomicU64> = Counter::default();
        let pending_transactions_cache_hits: Counter<u64, AtomicU64> = Counter::default();
        let pending_transactions_cache_misses: Counter<u64, AtomicU64> = Counter::default();
        let candidate_nonce_mismatches: Counter<u64, AtomicU64> = Counter::default();
        let candidate_prepare_errors: Counter<u64, AtomicU64> = Counter::default();
        let state_transition_errors: Counter<u64, AtomicU64> = Counter::default();
        let storage_prune_errors: Counter<u64, AtomicU64> = Counter::default();
        let proposed_blocks: Counter<u64, AtomicU64> = Counter::default();
        let proposed_empty_blocks: Counter<u64, AtomicU64> = Counter::default();
        let proposed_empty_blocks_with_candidates: Counter<u64, AtomicU64> = Counter::default();
        let mempool_oldest_age_ms: Gauge = Gauge::default();
        let mempool_oldest_age_updated_ms: Gauge = Gauge::default();
        let finalized_height: Gauge = Gauge::default();
        let finalized_height_updated_ms: Gauge = Gauge::default();
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
            "pending_batches",
            "Number of mempool batches received from the indexer",
            pending_batches.clone(),
        );
        self.context.register(
            "pending_transactions",
            "Number of mempool transactions received from the indexer",
            pending_transactions.clone(),
        );
        self.context.register(
            "pending_transactions_added",
            "Number of mempool transactions added after nonce checks",
            pending_transactions_added.clone(),
        );
        self.context.register(
            "pending_transactions_trimmed",
            "Number of mempool transactions trimmed due to per-account backlog limits",
            pending_transactions_trimmed.clone(),
        );
        self.context.register(
            "pending_transactions_rejected_capacity",
            "Number of mempool transactions rejected due to global capacity limits",
            pending_transactions_rejected_capacity.clone(),
        );
        self.context.register(
            "pending_transactions_rejected_backlog",
            "Number of mempool transactions rejected due to per-account backlog limits",
            pending_transactions_rejected_backlog.clone(),
        );
        self.context.register(
            "pending_transactions_duplicate",
            "Number of mempool transactions rejected due to duplicate nonces",
            pending_transactions_duplicate.clone(),
        );
        self.context.register(
            "pending_transactions_dropped_nonce",
            "Number of mempool transactions dropped due to nonce below next",
            pending_transactions_dropped_nonce.clone(),
        );
        self.context.register(
            "pending_transactions_future_nonce",
            "Number of mempool transactions with nonce above next (queued for future)",
            pending_transactions_future_nonce.clone(),
        );
        self.context.register(
            "pending_transactions_cache_hits",
            "Number of nonce cache hits while processing mempool transactions",
            pending_transactions_cache_hits.clone(),
        );
        self.context.register(
            "pending_transactions_cache_misses",
            "Number of nonce cache misses while processing mempool transactions",
            pending_transactions_cache_misses.clone(),
        );
        self.context.register(
            "candidate_nonce_mismatches",
            "Number of candidate transactions rejected due to nonce mismatch during propose",
            candidate_nonce_mismatches.clone(),
        );
        self.context.register(
            "candidate_prepare_errors",
            "Number of candidate transactions rejected due to prepare errors during propose",
            candidate_prepare_errors.clone(),
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
            "proposed_blocks_total",
            "Number of blocks proposed by the application actor",
            proposed_blocks.clone(),
        );
        self.context.register(
            "proposed_empty_blocks_total",
            "Number of proposed blocks with zero transactions",
            proposed_empty_blocks.clone(),
        );
        self.context.register(
            "proposed_empty_blocks_with_candidates_total",
            "Number of proposed empty blocks when mempool candidates existed",
            proposed_empty_blocks_with_candidates.clone(),
        );
        self.context.register(
            "mempool_oldest_age_ms",
            "Age in milliseconds of the oldest pending transaction in the mempool",
            mempool_oldest_age_ms.clone(),
        );
        self.context.register(
            "mempool_oldest_age_updated_ms",
            "Unix timestamp (ms) when mempool_oldest_age_ms was last updated",
            mempool_oldest_age_updated_ms.clone(),
        );
        self.context.register(
            "finalized_height",
            "Latest finalized block height applied by the application actor",
            finalized_height.clone(),
        );
        self.context.register(
            "finalized_height_updated_ms",
            "Unix timestamp (ms) when finalized_height was last updated",
            finalized_height_updated_ms.clone(),
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
        let state = match Adb::init(
            self.context.with_label("state"),
            VariableConfig {
                mmr_journal_partition: format!("{}-state-mmr-journal", self.partition_prefix),
                mmr_metadata_partition: format!("{}-state-mmr-metadata", self.partition_prefix),
                mmr_items_per_blob: self.mmr_items_per_blob,
                mmr_write_buffer: self.mmr_write_buffer,
                log_partition: format!("{}-state-log-journal", self.partition_prefix),
                log_items_per_blob: self.log_items_per_section,
                log_write_buffer: self.log_write_buffer,
                log_compression: None,
                log_codec_config: (),
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
        let events = match keyless::Keyless::<_, Output, Sha256, Clean<Digest>>::init(
            self.context.with_label("events"),
            keyless::Config {
                mmr_journal_partition: format!("{}-events-mmr-journal", self.partition_prefix),
                mmr_metadata_partition: format!("{}-events-mmr-metadata", self.partition_prefix),
                mmr_items_per_blob: self.mmr_items_per_blob,
                mmr_write_buffer: self.mmr_write_buffer,
                log_partition: format!("{}-events-log-journal", self.partition_prefix),
                log_items_per_section: self.log_items_per_section,
                log_write_buffer: self.log_write_buffer,
                log_compression: None,
                log_codec_config: (),
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
        let state = Arc::new(AsyncMutex::new(state));
        let events = Arc::new(AsyncMutex::new(events));

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

        let mut committed_height = {
            let state_guard = state.lock().await;
            match block_on(state_guard.get_metadata()) {
                Ok(meta) => meta
                    .and_then(|v| match v {
                        Value::Commit { height, start: _ } => Some(height),
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
            }
        };

        // Track built blocks
        let built: Option<(Round, Block)> = None;
        let built = Arc::new(Mutex::new(built));

        let ancestry_cache = Arc::new(Mutex::new(AncestryCache::new(
            self.ancestry_cache_entries,
        )));

        // Initialize mempool
        let mut mempool = Mempool::new_with_limits(
            self.context.with_label("mempool"),
            self.mempool_max_backlog,
            self.mempool_max_transactions,
        );
        let mut last_mempool_sla_warning_ms: Option<i64> = None;
        let mut next_nonce_cache =
            NonceCache::new(self.nonce_cache_capacity, self.nonce_cache_ttl);

        let (mut proof_tx, mut proof_rx) = mpsc::channel(self.proof_queue_size);
        let (proof_err_tx, mut proof_err_rx) = oneshot::channel::<()>();
        let proof_state = state.clone();
        let proof_events = events.clone();
        let mut proof_aggregator = aggregator.clone();
        let proof_prune_latency = prune_latency.clone();
        let proof_storage_prune_errors = storage_prune_errors.clone();
        let prune_interval = self.prune_interval;
        let _proof_handle = self.context.with_label("proofs").spawn({
            move |mut context| async move {
                let mut next_prune = context.gen_range(1..=prune_interval);
                while let Some(job) = proof_rx.next().await {
                    let ProofJob {
                        view,
                        height,
                        commitment,
                        result,
                        finalize_timer,
                        response,
                    } = job;
                    let state_op_count = result.state_end_op - result.state_start_op;
                    let events_start_op = result.events_start_op;
                    let events_op_count = result.events_end_op - events_start_op;
                    if state_op_count == 0 && events_op_count == 0 {
                        let _ = response.send(());
                        drop(finalize_timer);
                        continue;
                    }

                    let state_op_count = std::num::NonZeroU64::new(state_op_count)
                        .expect("state op count should be non-zero");
                    let events_op_count = std::num::NonZeroU64::new(events_op_count)
                        .expect("events op count should be non-zero");

                    let mut attempt = 0usize;
                    let mut backoff = Duration::from_millis(50);
                    let ((state_proof, state_proof_ops), (events_proof, events_proof_ops)) = loop {
                        attempt += 1;
                        let proofs = {
                            let state_guard = proof_state.lock().await;
                            let events_guard = proof_events.lock().await;
                            let state_proofs = block_on(state_guard.historical_proof(
                                Location::from(result.state_end_op),
                                Location::from(result.state_start_op),
                                state_op_count,
                            ));
                            let events_proofs = block_on(events_guard.historical_proof(
                                Location::from(result.events_end_op),
                                Location::from(events_start_op),
                                events_op_count,
                            ));
                            match (state_proofs, events_proofs) {
                                (Ok(state), Ok(events)) => Ok((state, events)),
                                (Err(err), _) | (_, Err(err)) => Err(err),
                            }
                        };
                        match proofs {
                            Ok(proofs) => break proofs,
                            Err(err) if attempt < 5 => {
                                warn!(
                                    ?err,
                                    height,
                                    attempt,
                                    "failed to generate proofs; retrying"
                                );
                                let delay = jittered_backoff(&mut context, backoff);
                                context.sleep(delay).await;
                                backoff = (backoff.saturating_mul(2)).min(Duration::from_secs(2));
                            }
                            Err(err) => {
                                error!(
                                    ?err,
                                    height,
                                    attempt,
                                    "failed to generate proofs; aborting engine"
                                );
                                let _ = proof_err_tx.send(());
                                let _ = response.send(());
                                drop(finalize_timer);
                                return;
                            }
                        }
                    };

                    proof_aggregator
                        .executed(
                            view,
                            height,
                            commitment,
                            result,
                            state_proof,
                            state_proof_ops,
                            events_proof,
                            events_proof_ops,
                            response,
                        )
                        .await;
                    drop(finalize_timer);

                    next_prune = next_prune.saturating_sub(1);
                    if next_prune == 0 {
                        let timer = proof_prune_latency.timer();
                        let mut state_guard = proof_state.lock().await;
                        let mut events_guard = proof_events.lock().await;
                        let inactivity_floor = state_guard.inactivity_floor_loc();
                        let prune_state = block_on(state_guard.prune(inactivity_floor));
                        let prune_events =
                            block_on(events_guard.prune(Location::from(events_start_op)));
                        if let Err(err) = prune_state.and(prune_events) {
                            proof_storage_prune_errors.inc();
                            warn!(?err, height, "failed to prune storage");
                        }
                        drop(timer);
                        next_prune = context.gen_range(1..=prune_interval);
                    }
                }
            }
        });

        // Use reconnecting indexer wrapper
        let reconnecting_indexer = crate::indexer::ReconnectingIndexer::new(
            self.context.with_label("indexer"),
            self.indexer,
            self.mempool_stream_buffer_size,
        );

        // This will never fail and handles reconnection internally
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
                                round,
                                parent,
                                mut response,
                            } => {
                                let view = round.view();
                                // Start the timer
                                let ancestry_timer = ancestry_latency.timer();
                                let propose_timer = propose_latency.timer();

                                // Immediately send a response for genesis block
                                if parent.1 == genesis_digest {
                                    drop(ancestry_timer);
                                    if let Err(err) = self
                                        .inbound
                                        .ancestry(round, Arc::from(vec![genesis_block()]), propose_timer, response)
                                        .await
                                    {
                                        warn!(view = view.get(), ?err, "failed to send ancestry response");
                                    }
                                    continue;
                                }

                                // Get the ancestry
                                let committed_height_snapshot = committed_height;
                                let parent_round = Round::new(round.epoch(), parent.0);
                                let ancestry = ancestry_cached(
                                    marshal.clone(),
                                    (Some(parent_round), parent.1),
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
                                                    warn!(view = view.get(), "missing parent ancestry");
                                                    return;
                                                };
                                                drop(ancestry_timer);

                                                // Pass back to mailbox
                                                if let Err(err) = inbound
                                                    .ancestry(round, ancestry, propose_timer, response)
                                                    .await
                                                {
                                                    warn!(view = view.get(), ?err, "failed to send ancestry response");
                                                }
                                            },
                                            _ = response.closed() => {
                                                // The response was cancelled
                                                ancestry_timer.cancel();
                                                warn!(view = view.get(), "propose aborted");
                                            }
                                        }
                                    }
                                });
                            }
                            Message::Ancestry {
                                round,
                                blocks,
                                timer,
                                response,
                            } => {
                                let view = round.view();
                                // Get parent block
                                let Some(parent) = blocks.last() else {
                                    warn!(view = view.get(), "missing parent block for propose");
                                    drop(timer);
                                    continue;
                                };

                                // Find first block on top of finalized state (may have increased since we started)
                                let height = committed_height;
                                let state_for_nonce = state.clone();
                                let mut pending_nonces: HashMap<PublicKey, u64> = HashMap::new();
                                for block in blocks.iter() {
                                    // Skip blocks below our height
                                    if block.height <= height {
                                        debug!(block = block.height, processed = height, "skipping block during propose");
                                        continue;
                                    }

                                    // Apply transaction nonces to state
                                    for tx in &block.transactions {
                                        // We don't care if the nonces are valid or not, we just need to ensure we'll process tip the same way as state will be processed during finalization
                                        let _ = apply_transaction_nonce(
                                            state_for_nonce.clone(),
                                            &mut pending_nonces,
                                            tx.public.clone(),
                                            tx.nonce,
                                        )
                                        .await;
                                    }
                                }

                                // Select up to max transactions using non-destructive peek.
                                // Transactions remain in mempool until finalized (via retain).
                                // Peek more than needed to account for nonce validation rejections.
                                let candidates = mempool.peek_batch(MAX_BLOCK_TRANSACTIONS * 2);
                                let now_ms = system_time_ms(self.context.current());
                                let oldest_age_ms = mempool.oldest_age_ms(now_ms);
                                mempool_oldest_age_ms
                                    .set(oldest_age_ms.map(|age| age as i64).unwrap_or(0));
                                mempool_oldest_age_updated_ms.set(now_ms);
                                let considered = candidates.len();
                                let mut transactions = Vec::new();
                                let mut rejected_nonce = 0u64;
                                let mut rejected_other = 0u64;
                                for tx in candidates {
                                    if transactions.len() >= MAX_BLOCK_TRANSACTIONS {
                                        break;
                                    }

                                    // Attempt to apply
                                    if let Err(err) = apply_transaction_nonce(
                                        state_for_nonce.clone(),
                                        &mut pending_nonces,
                                        tx.public.clone(),
                                        tx.nonce,
                                    )
                                    .await
                                    {
                                        match err {
                                            PrepareError::NonceMismatch { expected, got } => {
                                                candidate_nonce_mismatches.inc();
                                                if rejected_nonce < 3 {
                                                    debug!(
                                                        public = ?tx.public,
                                                        expected,
                                                        got,
                                                        "candidate transaction rejected (nonce mismatch)"
                                                    );
                                                }
                                                rejected_nonce = rejected_nonce.saturating_add(1);
                                            }
                                            PrepareError::State(err) => {
                                                candidate_prepare_errors.inc();
                                                if rejected_other < 3 {
                                                    warn!(
                                                        public = ?tx.public,
                                                        ?err,
                                                        "candidate transaction rejected (prepare error)"
                                                    );
                                                }
                                                rejected_other = rejected_other.saturating_add(1);
                                            }
                                        }
                                        continue;
                                    }

                                    // Add to transactions
                                    transactions.push(tx);
                                }
                                let txs = transactions.len();

                                // Update metrics
                                txs_considered.inc_by(considered as u64);
                                proposed_blocks.inc();
                                if txs == 0 {
                                    proposed_empty_blocks.inc();
                                    if considered > 0 {
                                        proposed_empty_blocks_with_candidates.inc();
                                        warn!(
                                            view = view.get(),
                                            considered,
                                            rejected_nonce,
                                            rejected_other,
                                            "proposed empty block with pending candidates"
                                        );
                                    }
                                }
                                if rejected_nonce > 0 || rejected_other > 0 {
                                    debug!(
                                        considered,
                                        rejected_nonce,
                                        rejected_other,
                                        "candidate transactions rejected during propose"
                                    );
                                }

                                if let Some(age_ms) = oldest_age_ms {
                                    if self.mempool_inclusion_sla_ms > 0
                                        && age_ms > self.mempool_inclusion_sla_ms
                                    {
                                        let should_warn = match last_mempool_sla_warning_ms {
                                            Some(prev) => {
                                                now_ms.saturating_sub(prev)
                                                    >= self.mempool_inclusion_sla_ms as i64
                                            }
                                            None => true,
                                        };
                                        if should_warn {
                                            let (pending_total, pending_accounts) = mempool.stats();
                                            warn!(
                                                view = view.get(),
                                                age_ms,
                                                sla_ms = self.mempool_inclusion_sla_ms,
                                                pending_total,
                                                pending_accounts,
                                                considered,
                                                rejected_nonce,
                                                rejected_other,
                                                "mempool inclusion SLA exceeded"
                                            );
                                            last_mempool_sla_warning_ms = Some(now_ms);
                                        }
                                    }
                                }

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
                                            view = view.get(),
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
                                    *built = Some((round, block));
                                }

                                // Send the digest to the consensus
                                let result = response.send(digest);
                                info!(
                                    view = view.get(),
                                    ?digest,
                                    txs,
                                    success = result.is_ok(),
                                    "proposed block"
                                );
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
                                    view = built.0.view().get(),
                                    height = built.1.height,
                                    "broadcast requested"
                                );
                                marshal.proposed(built.0, built.1).await;
                            }
                            Message::Verify {
                                round,
                                parent,
                                payload,
                                mut response,
                            } => {
                                let view = round.view();
                                // Start the timer
                                let timer = verify_latency.timer();

                                // Get the parent and current block
                                let parent_request = if parent.1 == genesis_digest {
                                    Either::Left(future::ready(Ok(genesis_block())))
                                } else {
                                    let parent_round = Round::new(round.epoch(), parent.0);
                                    Either::Right(marshal.subscribe(Some(parent_round), parent.1).await)
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
                                                    warn!(
                                                        view = view.get(),
                                                        ?payload,
                                                        "verify aborted: missing blocks"
                                                    );
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
                                                marshal.verified(round, block).await;

                                                // Send the verification result to the consensus
                                                let _ = response.send(true);

                                                // Stop the timer
                                                drop(timer);
                                            },
                                            _ = response.closed() => {
                                                // The response was cancelled
                                                warn!(view = view.get(), "verify aborted");
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
                                                warn!(
                                                    ?err,
                                                    view = block.view.get(),
                                                    "failed to fetch seed"
                                                );
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
                                let (result, sync_result) = {
                                    let mut state_guard = state.lock().await;
                                    let mut events_guard = events.lock().await;
                                    let result = state_transition::execute_state_transition(
                                        &mut *state_guard,
                                        &mut *events_guard,
                                        self.identity,
                                        height,
                                        seed,
                                        block.transactions,
                                        execution_pool.clone(),
                                    )
                                    .await;
                                    let sync_result = if result.is_ok() {
                                        match state_guard.sync().await {
                                            Ok(()) => events_guard.sync().await,
                                            Err(err) => Err(err),
                                        }
                                    } else {
                                        Ok(())
                                    };
                                    (result, sync_result)
                                };
                                let result = match result {
                                    Ok(result) => result,
                                    Err(err) => {
                                        state_transition_errors.inc();
                                        error!(?err, height, "state transition failed");
                                        return;
                                    }
                                };
                                drop(execute_timer);
                                if let Err(err) = sync_result {
                                    error!(?err, height, "failed to sync execution storage");
                                    return;
                                }

                                // Update metrics
                                txs_executed.inc_by(result.executed_transactions);
                                finalized_height.set(height as i64);
                                finalized_height_updated_ms
                                    .set(system_time_ms(self.context.current()));

                                // Update mempool based on processed transactions
                                let now = self.context.current();
                                for (public, next_nonce) in &result.processed_nonces {
                                    mempool.retain(public, *next_nonce);
                                    next_nonce_cache.insert(now, public.clone(), *next_nonce);
                                }

                                // Queue proof generation for changes
                                let state_op_count = result.state_end_op - result.state_start_op;
                                let events_op_count = result.events_end_op - result.events_start_op;
                                if state_op_count == 0 && events_op_count == 0 {
                                    // No-op execution (already processed or out-of-order); skip proof generation.
                                    let _ = response.send(());
                                    drop(timer);
                                    continue;
                                }
                                committed_height = committed_height.max(height);
                                let job = ProofJob {
                                    view: block.view,
                                    height: block.height,
                                    commitment,
                                    result,
                                    finalize_timer: timer,
                                    response,
                                };
                                match proof_tx.try_send(job) {
                                    Ok(()) => {}
                                    Err(err) if err.is_full() => {
                                        let job = err.into_inner();
                                        if proof_tx.send(job).await.is_err() {
                                            warn!(height, "proof queue closed; stopping application");
                                            return;
                                        }
                                    }
                                    Err(err) => {
                                        let job = err.into_inner();
                                        warn!(height, "proof queue closed; stopping application");
                                        let _ = job.response.send(());
                                        drop(job.finalize_timer);
                                        return;
                                    }
                                }
                            },
                        }
                },
                fatal = &mut proof_err_rx => {
                    warn!(?fatal, "proof worker stopped; stopping application");
                    return;
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
                    pending_batches.inc();
                    let batch_size = pending.transactions.len();
                    pending_transactions.inc_by(batch_size as u64);

                    // AC-2.2: Log transaction arrival at validator
                    info!(
                        batch_size,
                        "validator received transaction batch from mempool stream"
                    );

                    let mut dropped_nonce = 0u64;
                    let mut future_nonce = 0u64;
                    let mut added = 0u64;
                    let mut rejected_capacity = 0u64;
                    let mut rejected_backlog = 0u64;
                    let mut rejected_duplicate = 0u64;
                    let mut sample_dropped = 0u64;
                    let mut sample_rejected = 0u64;
                    let now_ms = system_time_ms(self.context.current());
                    for tx in pending.transactions {
                        // Check if below next
                        let now = self.context.current();
                        let cached_next = next_nonce_cache.get(now, &tx.public);
                        let (next, cache_hit) = match cached_next {
                            Some(next) => (next, true),
                            None => match fetch_account_nonce(state.clone(), tx.public.clone()).await {
                                Ok(next) => {
                                    next_nonce_cache.insert(now, tx.public.clone(), next);
                                    (next, false)
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
                        if cache_hit {
                            pending_transactions_cache_hits.inc();
                        } else {
                            pending_transactions_cache_misses.inc();
                        }
                        if tx.nonce < next {
                            // If below next, we drop the incoming transaction
                            pending_transactions_dropped_nonce.inc();
                            dropped_nonce = dropped_nonce.saturating_add(1);
                            if sample_dropped < 3 {
                                info!(
                                    public = ?tx.public,
                                    tx_nonce = tx.nonce,
                                    next_nonce = next,
                                    cache_hit,
                                    "dropping incoming transaction (nonce below next)"
                                );
                                sample_dropped = sample_dropped.saturating_add(1);
                            }
                            continue;
                        }
                        if tx.nonce > next {
                            pending_transactions_future_nonce.inc();
                            future_nonce = future_nonce.saturating_add(1);
                        }

                        // Add to mempool
                        let public = tx.public.clone();
                        let tx_nonce = tx.nonce;
                        match mempool.add(tx, now_ms) {
                            AddResult::Added { trimmed } => {
                                pending_transactions_added.inc();
                                added = added.saturating_add(1);
                                if trimmed {
                                    pending_transactions_trimmed.inc();
                                }
                            }
                            AddResult::Rejected(reason) => {
                                match reason {
                                    AddRejectReason::GlobalCapacity => {
                                        pending_transactions_rejected_capacity.inc();
                                        rejected_capacity = rejected_capacity.saturating_add(1);
                                    }
                                    AddRejectReason::BacklogLimit => {
                                        pending_transactions_rejected_backlog.inc();
                                        rejected_backlog = rejected_backlog.saturating_add(1);
                                    }
                                    AddRejectReason::DuplicateNonce => {
                                        pending_transactions_duplicate.inc();
                                        rejected_duplicate = rejected_duplicate.saturating_add(1);
                                    }
                                }
                                if sample_rejected < 3 {
                                    info!(
                                        public = ?public,
                                        tx_nonce,
                                        ?reason,
                                        "mempool rejected transaction"
                                    );
                                    sample_rejected = sample_rejected.saturating_add(1);
                                }
                            }
                        }
                    }
                    // AC-2.2: Log nonce validation results and inclusion/rejection summary
                    {
                        let (mempool_total, mempool_accounts) = mempool.stats();
                        let rejected_total = rejected_capacity + rejected_backlog + rejected_duplicate;
                        info!(
                            batch_size,
                            added,
                            dropped_nonce,
                            future_nonce,
                            rejected_total,
                            rejected_capacity,
                            rejected_backlog,
                            rejected_duplicate,
                            mempool_total,
                            mempool_accounts,
                            "processed mempool batch: nonce validation complete"
                        );
                    }
                }
            }
        }
    }
}
