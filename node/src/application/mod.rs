use std::{num::NonZero, time::Duration};

use crate::indexer::Indexer;
use commonware_cryptography::{
    bls12381::primitives::{group, sharing::Sharing, variant::MinSig},
    ed25519::PublicKey,
};

mod actor;
pub use actor::Actor;
mod ingress;
use commonware_runtime::buffer::PoolRef;
pub use ingress::Mailbox;
mod mempool;

/// Configuration for the application.
pub struct Config<I: Indexer> {
    /// Participants active in consensus.
    pub participants: Vec<PublicKey>,

    /// The public sharing associated with the current dealing.
    pub sharing: Sharing<MinSig>,

    /// The share of the secret.
    pub share: group::Share,

    /// Number of messages from consensus to hold in our backlog
    /// before blocking.
    pub mailbox_size: usize,

    /// The prefix for the partition.
    pub partition_prefix: String,

    /// The number of items per blob for the MMR.
    pub mmr_items_per_blob: NonZero<u64>,

    /// The number of items per write for the MMR.
    pub mmr_write_buffer: NonZero<usize>,

    /// The number of items per section for the log.
    pub log_items_per_section: NonZero<u64>,

    /// The number of items per write for the log.
    pub log_write_buffer: NonZero<usize>,

    /// The number of items per blob for the locations.
    pub locations_items_per_blob: NonZero<u64>,

    /// The buffer pool to use.
    pub buffer_pool: PoolRef,

    /// The indexer to upload to.
    pub indexer: I,

    /// The number of threads to use for execution.
    pub execution_concurrency: usize,

    /// The maximum number of transactions a single account can have in the mempool.
    pub mempool_max_backlog: usize,

    /// The maximum number of transactions in the mempool.
    pub mempool_max_transactions: usize,

    /// Buffer size for the mempool stream channel.
    pub mempool_stream_buffer_size: usize,

    /// Maximum number of entries to retain in the nonce cache.
    pub nonce_cache_capacity: usize,

    /// Maximum age for nonce cache entries.
    pub nonce_cache_ttl: Duration,

    /// Attempt to prune the state every N blocks (randomly).
    pub prune_interval: u64,

    /// Upper bound on cached ancestry results.
    pub ancestry_cache_entries: usize,

    /// Buffer size for proof job queue.
    pub proof_queue_size: usize,
}
