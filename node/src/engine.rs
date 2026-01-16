use crate::{
    aggregator, application,
    indexer::Indexer,
    seeder,
    supervisor::{AggregationSupervisor, EpochSupervisor, ViewSupervisor},
    system_metrics,
};
use commonware_broadcast::buffered;
use commonware_consensus::{
    aggregation, marshal, simplex,
    types::{Epoch, EpochDelta, FixedEpocher, ViewDelta},
    Reporters,
};
use commonware_cryptography::{
    bls12381::primitives::{
        group,
        sharing::Sharing,
        variant::MinSig,
    },
    ed25519::{PrivateKey, PublicKey},
    sha256::Digest,
    Signer,
};
use commonware_p2p::{Blocker, Receiver, Sender};
use commonware_runtime::{
    buffer::PoolRef, signal::Signal, Clock, Handle, Metrics, Quota, Spawner, Storage,
};
use commonware_storage::archive::{immutable, prunable};
use commonware_storage::translator::Translator;
use commonware_utils::{NZDuration, NZU64};
use nullspace_types::{Activity, Block, Finalization, NAMESPACE};
use rand::{CryptoRng, Rng};
use std::{
    collections::hash_map::RandomState,
    future::Future,
    hash::BuildHasher,
    num::{NonZeroU64, NonZeroUsize},
    pin::Pin,
    task::{Context, Poll},
    time::Duration,
};
use tracing::{error, warn};

type ThresholdScheme = simplex::scheme::bls12381_threshold::Scheme<PublicKey, MinSig>;
type FinalizationStore<E> = immutable::Archive<E, Digest, Finalization>;
type BlockStore<E> = prunable::Archive<DigestTranslator, E, Digest, Block>;

#[derive(Clone, Default)]
struct DigestTranslator(RandomState);

impl BuildHasher for DigestTranslator {
    type Hasher = <RandomState as BuildHasher>::Hasher;

    fn build_hasher(&self) -> Self::Hasher {
        self.0.build_hasher()
    }
}

impl Translator for DigestTranslator {
    type Key = Digest;

    fn transform(&self, key: &[u8]) -> Self::Key {
        let bytes: [u8; 32] = key
            .try_into()
            .expect("digest keys should be 32 bytes");
        Digest::from(bytes)
    }
}

/// Reporter type for [simplex::Engine].
type Reporter = Reporters<Activity, marshal::Mailbox<ThresholdScheme, Block>, seeder::Mailbox>;

/// To better support peers near tip during network instability, we multiply
/// the consensus activity timeout by this factor.
const SYNCER_ACTIVITY_TIMEOUT_MULTIPLIER: u64 = 10;

enum TaskCompletion<T>
where
    T: Send + 'static,
{
    Actor {
        name: &'static str,
        result: Result<T, commonware_runtime::Error>,
    },
    Stop {
        value: i32,
    },
}

enum NamedTaskInner<T>
where
    T: Send + 'static,
{
    Actor(Handle<T>),
    Stop(Signal),
}

struct NamedTask<T>
where
    T: Send + 'static,
{
    name: &'static str,
    inner: NamedTaskInner<T>,
}

impl<T> NamedTask<T>
where
    T: Send + 'static,
{
    fn actor(name: &'static str, handle: Handle<T>) -> Self {
        Self {
            name,
            inner: NamedTaskInner::Actor(handle),
        }
    }

    fn stop(name: &'static str, signal: Signal) -> Self {
        Self {
            name,
            inner: NamedTaskInner::Stop(signal),
        }
    }

    fn abort(&self) {
        if let NamedTaskInner::Actor(handle) = &self.inner {
            handle.abort();
        }
    }
}

impl<T> Future for NamedTask<T>
where
    T: Send + 'static,
{
    type Output = TaskCompletion<T>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let name = self.name;
        match &mut self.inner {
            NamedTaskInner::Actor(handle) => match Pin::new(handle).poll(cx) {
                Poll::Ready(result) => Poll::Ready(TaskCompletion::Actor { name, result }),
                Poll::Pending => Poll::Pending,
            },
            NamedTaskInner::Stop(signal) => match Pin::new(signal).poll(cx) {
                Poll::Ready(Ok(value)) => Poll::Ready(TaskCompletion::Stop { value }),
                Poll::Ready(Err(_)) => Poll::Ready(TaskCompletion::Stop { value: 0 }),
                Poll::Pending => Poll::Pending,
            },
        }
    }
}

/// Configuration for the [Engine].
pub struct IdentityConfig {
    pub signer: PrivateKey,
    pub sharing: Sharing<MinSig>,
    pub share: group::Share,
    pub participants: Vec<PublicKey>,
}

pub struct StorageConfig {
    pub partition_prefix: String,
    pub blocks_freezer_table_initial_size: u32,
    pub finalized_freezer_table_initial_size: u32,
    pub buffer_pool_page_size: NonZeroUsize,
    pub buffer_pool_capacity: NonZeroUsize,
    pub prunable_items_per_section: NonZeroU64,
    pub immutable_items_per_section: NonZeroU64,
    pub freezer_table_resize_frequency: u8,
    pub freezer_table_resize_chunk_size: u32,
    pub freezer_journal_target_size: u64,
    pub freezer_journal_compression: Option<u8>,
    pub mmr_items_per_blob: NonZeroU64,
    pub log_items_per_section: NonZeroU64,
    pub locations_items_per_blob: NonZeroU64,
    pub certificates_items_per_blob: NonZeroU64,
    pub cache_items_per_blob: NonZeroU64,
    pub replay_buffer: NonZeroUsize,
    pub write_buffer: NonZeroUsize,
    pub max_repair: NonZeroUsize,
}

pub struct ConsensusConfig {
    pub mailbox_size: usize,
    pub backfill_quota: Quota,
    pub deque_size: usize,

    pub leader_timeout: Duration,
    pub notarization_timeout: Duration,
    pub nullify_retry: Duration,
    pub fetch_timeout: Duration,
    pub activity_timeout: u64,
    pub skip_timeout: u64,
    pub max_fetch_count: usize,
    pub max_fetch_size: usize,
    pub fetch_concurrent: usize,
    pub fetch_rate_per_peer: Quota,
}

pub struct ApplicationConfig<I: Indexer> {
    pub indexer: I,
    pub execution_concurrency: usize,
    pub max_uploads_outstanding: usize,
    pub mempool_max_backlog: usize,
    pub mempool_max_transactions: usize,
    pub max_pending_seed_listeners: usize,
    pub mempool_stream_buffer_size: usize,
    pub mempool_inclusion_sla_ms: u64,
    pub nonce_cache_capacity: usize,
    pub nonce_cache_ttl: Duration,
    pub prune_interval: u64,
    pub ancestry_cache_entries: usize,
    pub proof_queue_size: usize,
}

pub struct Config<B: Blocker<PublicKey = PublicKey>, I: Indexer> {
    pub blocker: B,
    pub identity: IdentityConfig,
    pub storage: StorageConfig,
    pub consensus: ConsensusConfig,
    pub application: ApplicationConfig<I>,
}

/// The engine that drives the [application].
pub struct Engine<
    E: Clock + Rng + CryptoRng + Spawner + Storage + Metrics + Clone + Send + Sync,
    B: Blocker<PublicKey = PublicKey>,
    I: Indexer,
> {
    context: E,
    view_supervisor: ViewSupervisor,
    public_key: PublicKey,
    mailbox_size: usize,

    application: application::Actor<E, I>,
    application_mailbox: application::Mailbox<E>,
    seeder: seeder::Actor<E, I>,
    seeder_mailbox: seeder::Mailbox,
    aggregator: aggregator::Actor<E, I>,
    aggregator_mailbox: aggregator::Mailbox,
    buffer: buffered::Engine<E, PublicKey, Block>,
    buffer_mailbox: buffered::Mailbox<PublicKey, Block>,
    marshal: marshal::Actor<E, Block, EpochSupervisor, FinalizationStore<E>, BlockStore<E>, FixedEpocher>,
    marshal_mailbox: marshal::Mailbox<ThresholdScheme, Block>,

    #[allow(clippy::type_complexity)]
    consensus: simplex::Engine<
        E,
        ThresholdScheme,
        simplex::elector::Random,
        B,
        Digest,
        application::Mailbox<E>,
        application::Mailbox<E>,
        Reporter,
    >,
    aggregation: aggregation::Engine<
        E,
        AggregationSupervisor,
        Digest,
        aggregator::Mailbox,
        aggregator::Mailbox,
        EpochSupervisor,
        B,
    >,
}

impl<
        E: Clock + Rng + CryptoRng + Spawner + Storage + Metrics + Clone + Send + Sync,
        B: Blocker<PublicKey = PublicKey>,
        I: Indexer,
    > Engine<E, B, I>
{
    /// Create a new [Engine].
    pub async fn new(context: E, cfg: Config<B, I>) -> Self {
        // Create the buffer pool
        let buffer_pool = PoolRef::new(
            cfg.storage.buffer_pool_page_size,
            cfg.storage.buffer_pool_capacity,
        );

        // Create the application
        let identity = *cfg.identity.sharing.public();
        let public_key = cfg.identity.signer.public_key();
        let (
            application,
            view_supervisor,
            epoch_supervisor,
            aggregation_supervisor,
            application_mailbox,
        ) = application::Actor::new(
                context.with_label("application"),
                application::Config {
                    participants: cfg.identity.participants.clone(),
                    sharing: cfg.identity.sharing.clone(),
                    share: cfg.identity.share.clone(),
                    mailbox_size: cfg.consensus.mailbox_size,
                    partition_prefix: format!("{}-application", cfg.storage.partition_prefix),
                    mmr_items_per_blob: cfg.storage.mmr_items_per_blob,
                    mmr_write_buffer: cfg.storage.write_buffer,
                    log_items_per_section: cfg.storage.log_items_per_section,
                    log_write_buffer: cfg.storage.write_buffer,
                    locations_items_per_blob: cfg.storage.locations_items_per_blob,
                    buffer_pool: buffer_pool.clone(),
                    indexer: cfg.application.indexer.clone(),
                    execution_concurrency: cfg.application.execution_concurrency,
                    mempool_max_backlog: cfg.application.mempool_max_backlog,
                    mempool_max_transactions: cfg.application.mempool_max_transactions,
                    mempool_stream_buffer_size: cfg.application.mempool_stream_buffer_size,
                    mempool_inclusion_sla_ms: cfg.application.mempool_inclusion_sla_ms,
                    nonce_cache_capacity: cfg.application.nonce_cache_capacity,
                    nonce_cache_ttl: cfg.application.nonce_cache_ttl,
                    prune_interval: cfg.application.prune_interval,
                    ancestry_cache_entries: cfg.application.ancestry_cache_entries,
                    proof_queue_size: cfg.application.proof_queue_size,
                },
            );

        // Create the seeder
        let (seeder, seeder_mailbox) = seeder::Actor::new(
            context.with_label("seeder"),
            seeder::Config {
                indexer: cfg.application.indexer.clone(),
                identity,
                supervisor: view_supervisor.clone(),
                namespace: NAMESPACE.to_vec(),
                public_key: public_key.clone(),
                backfill_quota: cfg.consensus.backfill_quota,
                mailbox_size: cfg.consensus.mailbox_size,
                partition_prefix: format!("{}-seeder", cfg.storage.partition_prefix),
                items_per_blob: cfg.storage.mmr_items_per_blob,
                write_buffer: cfg.storage.write_buffer,
                replay_buffer: cfg.storage.replay_buffer,
                max_uploads_outstanding: cfg.application.max_uploads_outstanding,
                max_pending_seed_listeners: cfg.application.max_pending_seed_listeners,
            },
        );

        // Create the aggregator
        let (aggregator, aggregator_mailbox) = aggregator::Actor::new(
            context.with_label("aggregator"),
            aggregator::Config {
                identity,
                supervisor: view_supervisor.clone(),
                namespace: NAMESPACE.to_vec(),
                public_key: public_key.clone(),
                backfill_quota: cfg.consensus.backfill_quota,
                mailbox_size: cfg.consensus.mailbox_size,
                partition: format!("{}-aggregator", cfg.storage.partition_prefix),
                buffer_pool: buffer_pool.clone(),
                prunable_items_per_blob: cfg.storage.cache_items_per_blob,
                persistent_items_per_blob: cfg.storage.certificates_items_per_blob,
                write_buffer: cfg.storage.write_buffer,
                replay_buffer: cfg.storage.replay_buffer,
                indexer: cfg.application.indexer.clone(),
                max_uploads_outstanding: cfg.application.max_uploads_outstanding,
            },
        );

        // Create the buffer
        let (buffer, buffer_mailbox) = buffered::Engine::new(
            context.with_label("buffer"),
            buffered::Config {
                public_key: public_key.clone(),
                mailbox_size: cfg.consensus.mailbox_size,
                deque_size: cfg.consensus.deque_size,
                priority: true,
                codec_config: (),
            },
        );

        // Create marshal stores
        let marshal_partition = format!("{}-marshal", cfg.storage.partition_prefix);
        let finalizations_by_height = immutable::Archive::init(
            context.with_label("finalizations"),
            immutable::Config {
                metadata_partition: format!("{}-finalizations-metadata", &marshal_partition),
                freezer_table_partition: format!("{}-finalizations-table", &marshal_partition),
                freezer_table_initial_size: cfg.storage.finalized_freezer_table_initial_size,
                freezer_table_resize_frequency: cfg.storage.freezer_table_resize_frequency,
                freezer_table_resize_chunk_size: cfg.storage.freezer_table_resize_chunk_size,
                freezer_journal_partition: format!("{}-finalizations-journal", &marshal_partition),
                freezer_journal_target_size: cfg.storage.freezer_journal_target_size,
                freezer_journal_compression: cfg.storage.freezer_journal_compression,
                freezer_journal_buffer_pool: buffer_pool.clone(),
                ordinal_partition: format!("{}-finalizations-ordinal", &marshal_partition),
                items_per_section: cfg.storage.immutable_items_per_section,
                write_buffer: cfg.storage.write_buffer,
                replay_buffer: cfg.storage.replay_buffer,
                codec_config: (),
            },
        )
        .await
        .expect("failed to initialize finalizations archive");

        let finalized_blocks = prunable::Archive::init(
            context.with_label("finalized_blocks"),
            prunable::Config {
                translator: DigestTranslator::default(),
                partition: format!("{}-finalized-blocks", &marshal_partition),
                compression: None,
                codec_config: (),
                items_per_section: cfg.storage.prunable_items_per_section,
                write_buffer: cfg.storage.write_buffer,
                replay_buffer: cfg.storage.replay_buffer,
                buffer_pool: buffer_pool.clone(),
            },
        )
        .await
        .expect("failed to initialize finalized blocks archive");

        // Create marshal
        let (marshal, marshal_mailbox, _last_processed_height): (_, _, u64) =
            marshal::Actor::init(
                context.with_label("marshal"),
                finalizations_by_height,
                finalized_blocks,
                marshal::Config {
                    provider: epoch_supervisor.clone(),
                    epocher: FixedEpocher::new(NZU64!(u64::MAX)),
                    partition_prefix: marshal_partition,
                    mailbox_size: cfg.consensus.mailbox_size,
                    view_retention_timeout: ViewDelta::new(
                        cfg.consensus
                            .activity_timeout
                            .saturating_mul(SYNCER_ACTIVITY_TIMEOUT_MULTIPLIER),
                    ),
                    namespace: NAMESPACE.to_vec(),
                    prunable_items_per_section: cfg.storage.prunable_items_per_section,
                    buffer_pool: buffer_pool.clone(),
                    replay_buffer: cfg.storage.replay_buffer,
                    write_buffer: cfg.storage.write_buffer,
                    block_codec_config: (),
                    max_repair: cfg.storage.max_repair,
                },
            )
            .await;

        // Create the reporter
        let reporter = (marshal_mailbox.clone(), seeder_mailbox.clone()).into();

        // Create the consensus engine
        let consensus = simplex::Engine::new(
            context.with_label("consensus"),
            simplex::Config {
                scheme: epoch_supervisor.scheme(),
                elector: simplex::elector::Random,
                blocker: cfg.blocker.clone(),
                automaton: application_mailbox.clone(),
                relay: application_mailbox.clone(),
                reporter,
                partition: format!("{}-consensus", cfg.storage.partition_prefix),
                mailbox_size: cfg.consensus.mailbox_size,
                epoch: Epoch::zero(),
                namespace: NAMESPACE.to_vec(),
                replay_buffer: cfg.storage.replay_buffer,
                write_buffer: cfg.storage.write_buffer,
                buffer_pool: buffer_pool.clone(),
                leader_timeout: cfg.consensus.leader_timeout,
                notarization_timeout: cfg.consensus.notarization_timeout,
                nullify_retry: cfg.consensus.nullify_retry,
                activity_timeout: ViewDelta::new(cfg.consensus.activity_timeout),
                skip_timeout: ViewDelta::new(cfg.consensus.skip_timeout),
                fetch_timeout: cfg.consensus.fetch_timeout,
                fetch_concurrent: cfg.consensus.fetch_concurrent,
            },
        );

        // Create the aggregator
        let aggregation = aggregation::Engine::new(
            context.with_label("aggregation"),
            aggregation::Config {
                monitor: epoch_supervisor.clone(),
                provider: aggregation_supervisor.clone(),
                automaton: aggregator_mailbox.clone(),
                reporter: aggregator_mailbox.clone(),
                blocker: cfg.blocker,
                namespace: NAMESPACE.to_vec(),
                priority_acks: false,
                rebroadcast_timeout: NZDuration!(Duration::from_secs(10)),
                epoch_bounds: (EpochDelta::zero(), EpochDelta::zero()),
                window: NZU64!(16),
                activity_timeout: cfg.consensus.activity_timeout,
                journal_partition: format!("{}-aggregation", cfg.storage.partition_prefix),
                journal_write_buffer: cfg.storage.write_buffer,
                journal_replay_buffer: cfg.storage.replay_buffer,
                journal_heights_per_section: NZU64!(16_384),
                journal_compression: None,
                journal_buffer_pool: buffer_pool,
            },
        );

        // Return the engine
        Self {
            context,
            view_supervisor,
            public_key,
            mailbox_size: cfg.consensus.mailbox_size,
            application,
            application_mailbox,
            seeder,
            seeder_mailbox,
            buffer,
            buffer_mailbox,
            marshal,
            marshal_mailbox,
            consensus,
            aggregator,
            aggregator_mailbox,
            aggregation,
        }
    }

    /// Start the [simplex::Engine].
    #[allow(clippy::too_many_arguments)]
    pub fn start(
        self,
        pending_network: (
            impl Sender<PublicKey = PublicKey>,
            impl Receiver<PublicKey = PublicKey>,
        ),
        recovered_network: (
            impl Sender<PublicKey = PublicKey>,
            impl Receiver<PublicKey = PublicKey>,
        ),
        resolver_network: (
            impl Sender<PublicKey = PublicKey>,
            impl Receiver<PublicKey = PublicKey>,
        ),
        broadcast_network: (
            impl Sender<PublicKey = PublicKey>,
            impl Receiver<PublicKey = PublicKey>,
        ),
        backfill_network: (
            impl Sender<PublicKey = PublicKey>,
            impl Receiver<PublicKey = PublicKey>,
        ),
        seeder_network: (
            impl Sender<PublicKey = PublicKey>,
            impl Receiver<PublicKey = PublicKey>,
        ),
        aggregator_network: (
            impl Sender<PublicKey = PublicKey>,
            impl Receiver<PublicKey = PublicKey>,
        ),
        aggregation_network: (
            impl Sender<PublicKey = PublicKey>,
            impl Receiver<PublicKey = PublicKey>,
        ),
    ) -> Handle<()> {
        self.context.clone().spawn(|_| {
            self.run(
                pending_network,
                recovered_network,
                resolver_network,
                broadcast_network,
                backfill_network,
                seeder_network,
                aggregator_network,
                aggregation_network,
            )
        })
    }

    #[allow(clippy::too_many_arguments)]
    async fn run(
        self,
        pending_network: (
            impl Sender<PublicKey = PublicKey>,
            impl Receiver<PublicKey = PublicKey>,
        ),
        recovered_network: (
            impl Sender<PublicKey = PublicKey>,
            impl Receiver<PublicKey = PublicKey>,
        ),
        resolver_network: (
            impl Sender<PublicKey = PublicKey>,
            impl Receiver<PublicKey = PublicKey>,
        ),
        broadcast_network: (
            impl Sender<PublicKey = PublicKey>,
            impl Receiver<PublicKey = PublicKey>,
        ),
        backfill_network: (
            impl Sender<PublicKey = PublicKey>,
            impl Receiver<PublicKey = PublicKey>,
        ),
        seeder_network: (
            impl Sender<PublicKey = PublicKey>,
            impl Receiver<PublicKey = PublicKey>,
        ),
        aggregator_network: (
            impl Sender<PublicKey = PublicKey>,
            impl Receiver<PublicKey = PublicKey>,
        ),
        aggregation_network: (
            impl Sender<PublicKey = PublicKey>,
            impl Receiver<PublicKey = PublicKey>,
        ),
    ) {
        // If a downstream actor is started after an upstream actor (i.e. application after consensus), it is possible
        // that restart could block (as the upstream actor may fill the downstream actor's mailbox with items during initialization,
        // potentially blocking if not read).

        let system_metrics_handle = system_metrics::spawn_process_metrics(self.context.clone());

        // Start the seeder
        let seeder_handle = self.seeder.start(seeder_network);

        // Start aggregation
        let aggregation_handle = self.aggregation.start(aggregation_network);

        // Start the aggregator
        let aggregator_handle = self.aggregator.start(aggregator_network);

        // Start the buffer
        let buffer_handle = self.buffer.start(broadcast_network);

        // Start the application
        let application_handle = self.application.start(
            self.marshal_mailbox,
            self.seeder_mailbox,
            self.aggregator_mailbox,
        );

        // Create marshal resolver
        let marshal_resolver = marshal::resolver::p2p::init(
            &self.context,
            marshal::resolver::p2p::Config {
                public_key: self.public_key.clone(),
                manager: self.view_supervisor.clone(),
                blocker: self.view_supervisor.clone(),
                mailbox_size: self.mailbox_size,
                initial: Duration::from_secs(1),
                timeout: Duration::from_secs(2),
                fetch_retry_timeout: Duration::from_secs(10),
                priority_requests: false,
                priority_responses: false,
            },
            backfill_network,
        );

        // Start marshal
        let marshal_handle = self.marshal.start(
            self.application_mailbox,
            self.buffer_mailbox,
            marshal_resolver,
        );

        // Start consensus
        let consensus_handle =
            self.consensus
                .start(pending_network, recovered_network, resolver_network);

        // Stop the node when any actor terminates. If we allowed the engine task to
        // continue, we'd leave the system in a partially alive state.
        let tasks = vec![
            NamedTask::actor("system_metrics", system_metrics_handle),
            NamedTask::actor("seeder", seeder_handle),
            NamedTask::actor("aggregation", aggregation_handle),
            NamedTask::actor("aggregator", aggregator_handle),
            NamedTask::actor("buffer", buffer_handle),
            NamedTask::actor("application", application_handle),
            NamedTask::actor("marshal", marshal_handle),
            NamedTask::actor("consensus", consensus_handle),
            NamedTask::stop("engine", self.context.stopped()),
        ];

        let (completed, _index, remaining) = futures::future::select_all(tasks).await;
        for task in &remaining {
            task.abort();
        }

        match completed {
            TaskCompletion::Stop { value } => {
                warn!(value, "engine stop signal received");
            }
            TaskCompletion::Actor { name, result } => match result {
                Ok(()) => {
                    warn!(actor = name, "engine actor exited");
                }
                Err(err) => {
                    error!(?err, actor = name, "engine actor failed");
                }
            },
        }
    }
}
