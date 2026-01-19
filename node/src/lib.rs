use commonware_codec::{Decode, DecodeExt};
use commonware_cryptography::{
    bls12381::primitives::{group, sharing::Sharing, variant::MinSig},
    ed25519::{PrivateKey, PublicKey},
    Signer,
};
use commonware_utils::{from_hex_formatted, hex};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fmt,
    net::SocketAddr,
    num::{NonZeroU32, NonZeroU64, NonZeroUsize},
    path::PathBuf,
    str::FromStr,
    time::Duration,
};
use thiserror::Error;
use tracing::Level;
use url::Url;

use nullspace_types::Identity;

pub mod aggregator;
pub mod application;
mod backoff;
pub mod defaults;
pub mod engine;
pub mod indexer;
pub mod seeder;
pub mod supervisor;
mod system_metrics;

#[derive(Clone, PartialEq, Eq)]
pub struct HexBytes(Vec<u8>);

impl HexBytes {
    pub fn from_hex_formatted(value: &str) -> Option<Self> {
        from_hex_formatted(value).map(Self)
    }
}

impl AsRef<[u8]> for HexBytes {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

impl Serialize for HexBytes {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&hex(self.as_ref()))
    }
}

impl<'de> Deserialize<'de> for HexBytes {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        let bytes = from_hex_formatted(&value)
            .ok_or_else(|| serde::de::Error::custom("expected a hex string"))?;
        Ok(Self(bytes))
    }
}

/// Configuration for the [engine::Engine].
#[derive(Deserialize, Serialize)]
pub struct Config {
    pub private_key: HexBytes,
    pub share: HexBytes,
    pub polynomial: HexBytes,

    pub port: u16,
    pub metrics_port: u16,
    pub directory: String,
    pub worker_threads: usize,
    pub log_level: String,
    #[serde(default)]
    pub deterministic_seed: Option<u64>,
    #[serde(default)]
    pub deterministic_time_scale_ms: Option<u64>,

    pub allowed_peers: Vec<String>,
    pub bootstrappers: Vec<String>,

    pub message_backlog: usize,
    pub mailbox_size: usize,
    pub deque_size: usize,
    #[serde(default = "default_mempool_max_backlog")]
    pub mempool_max_backlog: usize,
    #[serde(default = "default_mempool_max_transactions")]
    pub mempool_max_transactions: usize,
    #[serde(default = "default_mempool_stream_buffer_size")]
    pub mempool_stream_buffer_size: usize,
    #[serde(default = "default_nonce_cache_capacity")]
    pub nonce_cache_capacity: usize,
    #[serde(default = "default_nonce_cache_ttl_seconds")]
    pub nonce_cache_ttl_seconds: u64,
    #[serde(default = "default_max_pending_seed_listeners")]
    pub max_pending_seed_listeners: usize,

    pub indexer: String,
    pub execution_concurrency: usize,

    // Tunables (defaults preserve current constants in `node/src/main.rs`).
    #[serde(default = "default_max_uploads_outstanding")]
    pub max_uploads_outstanding: usize,
    #[serde(default = "default_allow_unsigned_summaries")]
    pub allow_unsigned_summaries: bool,
    #[serde(default = "default_max_message_size")]
    pub max_message_size: usize,
    #[serde(default = "default_leader_timeout_ms")]
    pub leader_timeout_ms: u64,
    #[serde(default = "default_notarization_timeout_ms")]
    pub notarization_timeout_ms: u64,
    #[serde(default = "default_nullify_retry_ms")]
    pub nullify_retry_ms: u64,
    #[serde(default = "default_fetch_timeout_ms")]
    pub fetch_timeout_ms: u64,
    #[serde(default = "default_activity_timeout")]
    pub activity_timeout: u64,
    #[serde(default = "default_skip_timeout")]
    pub skip_timeout: u64,
    #[serde(default = "default_fetch_concurrent")]
    pub fetch_concurrent: usize,
    #[serde(default = "default_max_fetch_count")]
    pub max_fetch_count: usize,
    #[serde(default = "default_max_fetch_size")]
    pub max_fetch_size: usize,
    #[serde(default = "default_blocks_freezer_table_initial_size")]
    pub blocks_freezer_table_initial_size: u32,
    #[serde(default = "default_finalized_freezer_table_initial_size")]
    pub finalized_freezer_table_initial_size: u32,
    #[serde(default = "default_buffer_pool_page_size")]
    pub buffer_pool_page_size: usize,
    #[serde(default = "default_buffer_pool_capacity")]
    pub buffer_pool_capacity: usize,
    #[serde(default = "default_prunable_items_per_section")]
    pub prunable_items_per_section: u64,
    #[serde(default = "default_immutable_items_per_section")]
    pub immutable_items_per_section: u64,
    #[serde(default = "default_freezer_table_resize_frequency")]
    pub freezer_table_resize_frequency: u8,
    #[serde(default = "default_freezer_table_resize_chunk_size")]
    pub freezer_table_resize_chunk_size: u32,
    #[serde(default = "default_freezer_journal_target_size")]
    pub freezer_journal_target_size: u64,
    #[serde(default = "default_freezer_journal_compression")]
    pub freezer_journal_compression: Option<u8>,
    #[serde(default = "default_mmr_items_per_blob")]
    pub mmr_items_per_blob: u64,
    #[serde(default = "default_log_items_per_section")]
    pub log_items_per_section: u64,
    #[serde(default = "default_locations_items_per_blob")]
    pub locations_items_per_blob: u64,
    #[serde(default = "default_certificates_items_per_blob")]
    pub certificates_items_per_blob: u64,
    #[serde(default = "default_cache_items_per_blob")]
    pub cache_items_per_blob: u64,
    #[serde(default = "default_replay_buffer_bytes")]
    pub replay_buffer_bytes: usize,
    #[serde(default = "default_write_buffer_bytes")]
    pub write_buffer_bytes: usize,
    #[serde(default = "default_max_repair")]
    pub max_repair: u64,
    #[serde(default = "default_prune_interval")]
    pub prune_interval: u64,
    #[serde(default = "default_ancestry_cache_entries")]
    pub ancestry_cache_entries: usize,
    #[serde(default = "default_proof_queue_size")]
    pub proof_queue_size: usize,
    #[serde(default = "default_pending_rate_per_second")]
    pub pending_rate_per_second: u32,
    #[serde(default = "default_recovered_rate_per_second")]
    pub recovered_rate_per_second: u32,
    #[serde(default = "default_resolver_rate_per_second")]
    pub resolver_rate_per_second: u32,
    #[serde(default = "default_broadcaster_rate_per_second")]
    pub broadcaster_rate_per_second: u32,
    #[serde(default = "default_backfill_rate_per_second")]
    pub backfill_rate_per_second: u32,
    #[serde(default = "default_aggregation_rate_per_second")]
    pub aggregation_rate_per_second: u32,
    #[serde(default = "default_fetch_rate_per_peer_per_second")]
    pub fetch_rate_per_peer_per_second: u32,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("{field} must be hex: {value}")]
    InvalidHex { field: &'static str, value: String },
    #[error("{field} is invalid: {value}")]
    InvalidDecode {
        field: &'static str,
        value: String,
        #[source]
        source: commonware_codec::Error,
    },
    #[error("invalid log level: {value}")]
    InvalidLogLevel { value: String },
    #[error("{field} must be > 0 (got {value})")]
    InvalidNonZero { field: &'static str, value: usize },
    #[error("{field} must be a valid URL: {value}")]
    InvalidUrl { field: &'static str, value: String },
    #[error("{field} URL scheme must be http or https: {value}")]
    InvalidUrlScheme { field: &'static str, value: String },
    #[error("port and metrics_port must be different (port={port}, metrics_port={metrics_port})")]
    PortConflict { port: u16, metrics_port: u16 },
}

pub struct ValidatedConfig {
    pub signer: PrivateKey,
    pub public_key: PublicKey,
    pub share: group::Share,
    pub sharing: Sharing<MinSig>,
    pub identity: Identity,

    pub port: u16,
    pub metrics_port: u16,
    pub directory: PathBuf,
    pub worker_threads: usize,
    pub log_level: Level,
    pub deterministic_seed: Option<u64>,
    pub deterministic_time_scale: Option<Duration>,

    pub allowed_peers: Vec<String>,
    pub bootstrappers: Vec<String>,

    pub message_backlog: usize,
    pub mailbox_size: usize,
    pub deque_size: usize,
    pub mempool_max_backlog: usize,
    pub mempool_max_transactions: usize,
    pub mempool_stream_buffer_size: usize,
    pub nonce_cache_capacity: usize,
    pub nonce_cache_ttl: Duration,
    pub max_pending_seed_listeners: usize,

    pub indexer: String,
    pub execution_concurrency: usize,

    pub max_uploads_outstanding: usize,
    pub allow_unsigned_summaries: bool,
    pub max_message_size: usize,
    pub leader_timeout: Duration,
    pub notarization_timeout: Duration,
    pub nullify_retry: Duration,
    pub fetch_timeout: Duration,
    pub activity_timeout: u64,
    pub skip_timeout: u64,
    pub fetch_concurrent: usize,
    pub max_fetch_count: usize,
    pub max_fetch_size: usize,
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
    pub replay_buffer_bytes: NonZeroUsize,
    pub write_buffer_bytes: NonZeroUsize,
    pub max_repair: NonZeroUsize,
    pub prune_interval: u64,
    pub ancestry_cache_entries: usize,
    pub proof_queue_size: usize,
    pub pending_rate_per_second: NonZeroU32,
    pub recovered_rate_per_second: NonZeroU32,
    pub resolver_rate_per_second: NonZeroU32,
    pub broadcaster_rate_per_second: NonZeroU32,
    pub backfill_rate_per_second: NonZeroU32,
    pub aggregation_rate_per_second: NonZeroU32,
    pub fetch_rate_per_peer_per_second: NonZeroU32,
}

struct RedactedConfig<'a>(&'a Config);

impl fmt::Debug for RedactedConfig<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let cfg = self.0;
        f.debug_struct("Config")
            .field("private_key", &"<redacted>")
            .field("share", &"<redacted>")
            .field("polynomial", &"<redacted>")
            .field("port", &cfg.port)
            .field("metrics_port", &cfg.metrics_port)
            .field("directory", &cfg.directory)
            .field("worker_threads", &cfg.worker_threads)
            .field("log_level", &cfg.log_level)
            .field("allowed_peers", &cfg.allowed_peers)
            .field("bootstrappers", &cfg.bootstrappers)
            .field("message_backlog", &cfg.message_backlog)
            .field("mailbox_size", &cfg.mailbox_size)
            .field("deque_size", &cfg.deque_size)
            .field("mempool_max_backlog", &cfg.mempool_max_backlog)
            .field("mempool_max_transactions", &cfg.mempool_max_transactions)
            .field(
                "mempool_stream_buffer_size",
                &cfg.mempool_stream_buffer_size,
            )
            .field("nonce_cache_capacity", &cfg.nonce_cache_capacity)
            .field("nonce_cache_ttl_seconds", &cfg.nonce_cache_ttl_seconds)
            .field(
                "max_pending_seed_listeners",
                &cfg.max_pending_seed_listeners,
            )
            .field("indexer", &cfg.indexer)
            .field("execution_concurrency", &cfg.execution_concurrency)
            .field("max_uploads_outstanding", &cfg.max_uploads_outstanding)
            .field("allow_unsigned_summaries", &cfg.allow_unsigned_summaries)
            .field("max_message_size", &cfg.max_message_size)
            .field("leader_timeout_ms", &cfg.leader_timeout_ms)
            .field("notarization_timeout_ms", &cfg.notarization_timeout_ms)
            .field("nullify_retry_ms", &cfg.nullify_retry_ms)
            .field("fetch_timeout_ms", &cfg.fetch_timeout_ms)
            .field("activity_timeout", &cfg.activity_timeout)
            .field("skip_timeout", &cfg.skip_timeout)
            .field("fetch_concurrent", &cfg.fetch_concurrent)
            .field("max_fetch_count", &cfg.max_fetch_count)
            .field("max_fetch_size", &cfg.max_fetch_size)
            .field(
                "blocks_freezer_table_initial_size",
                &cfg.blocks_freezer_table_initial_size,
            )
            .field(
                "finalized_freezer_table_initial_size",
                &cfg.finalized_freezer_table_initial_size,
            )
            .field("buffer_pool_page_size", &cfg.buffer_pool_page_size)
            .field("buffer_pool_capacity", &cfg.buffer_pool_capacity)
            .field("prunable_items_per_section", &cfg.prunable_items_per_section)
            .field("immutable_items_per_section", &cfg.immutable_items_per_section)
            .field(
                "freezer_table_resize_frequency",
                &cfg.freezer_table_resize_frequency,
            )
            .field(
                "freezer_table_resize_chunk_size",
                &cfg.freezer_table_resize_chunk_size,
            )
            .field(
                "freezer_journal_target_size",
                &cfg.freezer_journal_target_size,
            )
            .field(
                "freezer_journal_compression",
                &cfg.freezer_journal_compression,
            )
            .field("mmr_items_per_blob", &cfg.mmr_items_per_blob)
            .field("log_items_per_section", &cfg.log_items_per_section)
            .field("locations_items_per_blob", &cfg.locations_items_per_blob)
            .field(
                "certificates_items_per_blob",
                &cfg.certificates_items_per_blob,
            )
            .field("cache_items_per_blob", &cfg.cache_items_per_blob)
            .field("replay_buffer_bytes", &cfg.replay_buffer_bytes)
            .field("write_buffer_bytes", &cfg.write_buffer_bytes)
            .field("max_repair", &cfg.max_repair)
            .field("prune_interval", &cfg.prune_interval)
            .field("ancestry_cache_entries", &cfg.ancestry_cache_entries)
            .field("proof_queue_size", &cfg.proof_queue_size)
            .field("pending_rate_per_second", &cfg.pending_rate_per_second)
            .field("recovered_rate_per_second", &cfg.recovered_rate_per_second)
            .field("resolver_rate_per_second", &cfg.resolver_rate_per_second)
            .field(
                "broadcaster_rate_per_second",
                &cfg.broadcaster_rate_per_second,
            )
            .field("backfill_rate_per_second", &cfg.backfill_rate_per_second)
            .field(
                "aggregation_rate_per_second",
                &cfg.aggregation_rate_per_second,
            )
            .field(
                "fetch_rate_per_peer_per_second",
                &cfg.fetch_rate_per_peer_per_second,
            )
            .finish()
    }
}

fn default_mempool_max_backlog() -> usize {
    defaults::DEFAULT_MEMPOOL_MAX_BACKLOG
}

fn default_mempool_max_transactions() -> usize {
    defaults::DEFAULT_MEMPOOL_MAX_TRANSACTIONS
}

fn default_mempool_stream_buffer_size() -> usize {
    defaults::DEFAULT_MEMPOOL_STREAM_BUFFER_SIZE
}

fn default_nonce_cache_capacity() -> usize {
    defaults::DEFAULT_NONCE_CACHE_CAPACITY
}

fn default_nonce_cache_ttl_seconds() -> u64 {
    defaults::DEFAULT_NONCE_CACHE_TTL_SECONDS
}

fn default_max_pending_seed_listeners() -> usize {
    defaults::DEFAULT_MAX_PENDING_SEED_LISTENERS
}

fn default_max_uploads_outstanding() -> usize {
    defaults::DEFAULT_MAX_UPLOADS_OUTSTANDING
}

fn default_allow_unsigned_summaries() -> bool {
    defaults::DEFAULT_ALLOW_UNSIGNED_SUMMARIES
}

fn default_max_message_size() -> usize {
    defaults::DEFAULT_MAX_MESSAGE_SIZE
}

fn default_leader_timeout_ms() -> u64 {
    defaults::DEFAULT_LEADER_TIMEOUT_MS
}

fn default_notarization_timeout_ms() -> u64 {
    defaults::DEFAULT_NOTARIZATION_TIMEOUT_MS
}

fn default_nullify_retry_ms() -> u64 {
    defaults::DEFAULT_NULLIFY_RETRY_MS
}

fn default_fetch_timeout_ms() -> u64 {
    defaults::DEFAULT_FETCH_TIMEOUT_MS
}

fn default_activity_timeout() -> u64 {
    defaults::DEFAULT_ACTIVITY_TIMEOUT
}

fn default_skip_timeout() -> u64 {
    defaults::DEFAULT_SKIP_TIMEOUT
}

fn default_fetch_concurrent() -> usize {
    defaults::DEFAULT_FETCH_CONCURRENT
}

fn default_max_fetch_count() -> usize {
    defaults::DEFAULT_MAX_FETCH_COUNT
}

fn default_max_fetch_size() -> usize {
    defaults::DEFAULT_MAX_FETCH_SIZE
}

fn default_blocks_freezer_table_initial_size() -> u32 {
    defaults::DEFAULT_BLOCKS_FREEZER_TABLE_INITIAL_SIZE
}

fn default_finalized_freezer_table_initial_size() -> u32 {
    defaults::DEFAULT_FINALIZED_FREEZER_TABLE_INITIAL_SIZE
}

fn default_buffer_pool_page_size() -> usize {
    defaults::DEFAULT_BUFFER_POOL_PAGE_SIZE
}

fn default_buffer_pool_capacity() -> usize {
    defaults::DEFAULT_BUFFER_POOL_CAPACITY
}

fn default_prunable_items_per_section() -> u64 {
    defaults::DEFAULT_PRUNABLE_ITEMS_PER_SECTION
}

fn default_immutable_items_per_section() -> u64 {
    defaults::DEFAULT_IMMUTABLE_ITEMS_PER_SECTION
}

fn default_freezer_table_resize_frequency() -> u8 {
    defaults::DEFAULT_FREEZER_TABLE_RESIZE_FREQUENCY
}

fn default_freezer_table_resize_chunk_size() -> u32 {
    defaults::DEFAULT_FREEZER_TABLE_RESIZE_CHUNK_SIZE
}

fn default_freezer_journal_target_size() -> u64 {
    defaults::DEFAULT_FREEZER_JOURNAL_TARGET_SIZE
}

fn default_freezer_journal_compression() -> Option<u8> {
    defaults::DEFAULT_FREEZER_JOURNAL_COMPRESSION
}

fn default_mmr_items_per_blob() -> u64 {
    defaults::DEFAULT_MMR_ITEMS_PER_BLOB
}

fn default_log_items_per_section() -> u64 {
    defaults::DEFAULT_LOG_ITEMS_PER_SECTION
}

fn default_locations_items_per_blob() -> u64 {
    defaults::DEFAULT_LOCATIONS_ITEMS_PER_BLOB
}

fn default_certificates_items_per_blob() -> u64 {
    defaults::DEFAULT_CERTIFICATES_ITEMS_PER_BLOB
}

fn default_cache_items_per_blob() -> u64 {
    defaults::DEFAULT_CACHE_ITEMS_PER_BLOB
}

fn default_replay_buffer_bytes() -> usize {
    defaults::DEFAULT_REPLAY_BUFFER_BYTES
}

fn default_write_buffer_bytes() -> usize {
    defaults::DEFAULT_WRITE_BUFFER_BYTES
}

fn default_max_repair() -> u64 {
    defaults::DEFAULT_MAX_REPAIR
}

fn default_prune_interval() -> u64 {
    defaults::DEFAULT_PRUNE_INTERVAL
}

fn default_ancestry_cache_entries() -> usize {
    defaults::DEFAULT_ANCESTRY_CACHE_ENTRIES
}

fn default_proof_queue_size() -> usize {
    defaults::DEFAULT_PROOF_QUEUE_SIZE
}

fn default_pending_rate_per_second() -> u32 {
    defaults::DEFAULT_PENDING_RATE_PER_SECOND
}

fn default_recovered_rate_per_second() -> u32 {
    defaults::DEFAULT_RECOVERED_RATE_PER_SECOND
}

fn default_resolver_rate_per_second() -> u32 {
    defaults::DEFAULT_RESOLVER_RATE_PER_SECOND
}

fn default_broadcaster_rate_per_second() -> u32 {
    defaults::DEFAULT_BROADCASTER_RATE_PER_SECOND
}

fn default_backfill_rate_per_second() -> u32 {
    defaults::DEFAULT_BACKFILL_RATE_PER_SECOND
}

fn default_aggregation_rate_per_second() -> u32 {
    defaults::DEFAULT_AGGREGATION_RATE_PER_SECOND
}

fn default_fetch_rate_per_peer_per_second() -> u32 {
    defaults::DEFAULT_FETCH_RATE_PER_PEER_PER_SECOND
}

fn redact_value(field: &'static str, value: String) -> String {
    match field {
        "private_key" | "share" => "<redacted>".to_string(),
        _ => value,
    }
}

fn decode_bytes<T: DecodeExt<()>>(field: &'static str, value: &HexBytes) -> Result<T, ConfigError> {
    T::decode(value.as_ref()).map_err(|source| ConfigError::InvalidDecode {
        field,
        value: redact_value(field, hex(value.as_ref())),
        source,
    })
}

fn ensure_nonzero(field: &'static str, value: usize) -> Result<(), ConfigError> {
    if value == 0 {
        return Err(ConfigError::InvalidNonZero { field, value });
    }
    Ok(())
}

fn ensure_nonzero_u64(field: &'static str, value: u64) -> Result<(), ConfigError> {
    if value == 0 {
        return Err(ConfigError::InvalidNonZero { field, value: 0 });
    }
    Ok(())
}

fn nonzero_usize(field: &'static str, value: usize) -> Result<NonZeroUsize, ConfigError> {
    NonZeroUsize::new(value).ok_or(ConfigError::InvalidNonZero { field, value })
}

fn nonzero_u32(field: &'static str, value: u32) -> Result<NonZeroU32, ConfigError> {
    NonZeroU32::new(value).ok_or(ConfigError::InvalidNonZero {
        field,
        value: value as usize,
    })
}

fn nonzero_u64(field: &'static str, value: u64) -> Result<NonZeroU64, ConfigError> {
    NonZeroU64::new(value).ok_or(ConfigError::InvalidNonZero { field, value: 0 })
}

fn validate_http_url(field: &'static str, value: &str) -> Result<(), ConfigError> {
    let url = Url::parse(value).map_err(|_| ConfigError::InvalidUrl {
        field,
        value: value.to_string(),
    })?;
    match url.scheme() {
        "http" | "https" => {}
        _ => {
            return Err(ConfigError::InvalidUrlScheme {
                field,
                value: value.to_string(),
            })
        }
    }
    if url.host_str().is_none() {
        return Err(ConfigError::InvalidUrl {
            field,
            value: value.to_string(),
        });
    }
    Ok(())
}

pub fn parse_peer_public_key(name: &str) -> Option<PublicKey> {
    from_hex_formatted(name).and_then(|key| PublicKey::decode(key.as_ref()).ok())
}

impl Config {
    pub fn redacted_debug(&self) -> impl fmt::Debug + '_ {
        RedactedConfig(self)
    }

    pub fn parse_signer(&self) -> Result<PrivateKey, ConfigError> {
        decode_bytes("private_key", &self.private_key)
    }

    pub fn validate(self, peer_count: u32) -> Result<ValidatedConfig, ConfigError> {
        let signer = self.parse_signer()?;
        self.validate_with_signer(signer, peer_count)
    }

    pub fn validate_with_signer(
        self,
        signer: PrivateKey,
        peer_count: u32,
    ) -> Result<ValidatedConfig, ConfigError> {
        ensure_nonzero("worker_threads", self.worker_threads)?;
        ensure_nonzero("message_backlog", self.message_backlog)?;
        ensure_nonzero("mailbox_size", self.mailbox_size)?;
        ensure_nonzero("deque_size", self.deque_size)?;
        ensure_nonzero("mempool_max_backlog", self.mempool_max_backlog)?;
        ensure_nonzero("mempool_max_transactions", self.mempool_max_transactions)?;
        ensure_nonzero("mempool_stream_buffer_size", self.mempool_stream_buffer_size)?;
        ensure_nonzero("nonce_cache_capacity", self.nonce_cache_capacity)?;
        ensure_nonzero_u64("nonce_cache_ttl_seconds", self.nonce_cache_ttl_seconds)?;
        ensure_nonzero(
            "max_pending_seed_listeners",
            self.max_pending_seed_listeners,
        )?;
        ensure_nonzero("execution_concurrency", self.execution_concurrency)?;
        ensure_nonzero("max_uploads_outstanding", self.max_uploads_outstanding)?;
        ensure_nonzero("max_message_size", self.max_message_size)?;
        ensure_nonzero_u64("leader_timeout_ms", self.leader_timeout_ms)?;
        ensure_nonzero_u64("notarization_timeout_ms", self.notarization_timeout_ms)?;
        ensure_nonzero_u64("nullify_retry_ms", self.nullify_retry_ms)?;
        ensure_nonzero_u64("fetch_timeout_ms", self.fetch_timeout_ms)?;
        ensure_nonzero_u64("activity_timeout", self.activity_timeout)?;
        ensure_nonzero_u64("skip_timeout", self.skip_timeout)?;
        ensure_nonzero("fetch_concurrent", self.fetch_concurrent)?;
        ensure_nonzero("max_fetch_count", self.max_fetch_count)?;
        ensure_nonzero("max_fetch_size", self.max_fetch_size)?;
        if self.blocks_freezer_table_initial_size == 0 {
            return Err(ConfigError::InvalidNonZero {
                field: "blocks_freezer_table_initial_size",
                value: 0,
            });
        }
        if self.finalized_freezer_table_initial_size == 0 {
            return Err(ConfigError::InvalidNonZero {
                field: "finalized_freezer_table_initial_size",
                value: 0,
            });
        }
        let buffer_pool_page_size =
            nonzero_usize("buffer_pool_page_size", self.buffer_pool_page_size)?;
        let buffer_pool_capacity =
            nonzero_usize("buffer_pool_capacity", self.buffer_pool_capacity)?;
        let prunable_items_per_section =
            nonzero_u64("prunable_items_per_section", self.prunable_items_per_section)?;
        let immutable_items_per_section =
            nonzero_u64("immutable_items_per_section", self.immutable_items_per_section)?;
        if self.freezer_table_resize_frequency == 0 {
            return Err(ConfigError::InvalidNonZero {
                field: "freezer_table_resize_frequency",
                value: 0,
            });
        }
        if self.freezer_table_resize_chunk_size == 0 {
            return Err(ConfigError::InvalidNonZero {
                field: "freezer_table_resize_chunk_size",
                value: 0,
            });
        }
        ensure_nonzero_u64(
            "freezer_journal_target_size",
            self.freezer_journal_target_size,
        )?;
        let mmr_items_per_blob =
            nonzero_u64("mmr_items_per_blob", self.mmr_items_per_blob)?;
        let log_items_per_section =
            nonzero_u64("log_items_per_section", self.log_items_per_section)?;
        let locations_items_per_blob =
            nonzero_u64("locations_items_per_blob", self.locations_items_per_blob)?;
        let certificates_items_per_blob =
            nonzero_u64("certificates_items_per_blob", self.certificates_items_per_blob)?;
        let cache_items_per_blob =
            nonzero_u64("cache_items_per_blob", self.cache_items_per_blob)?;
        let replay_buffer_bytes =
            nonzero_usize("replay_buffer_bytes", self.replay_buffer_bytes)?;
        let write_buffer_bytes =
            nonzero_usize("write_buffer_bytes", self.write_buffer_bytes)?;
        let max_repair = nonzero_usize("max_repair", self.max_repair as usize)?;
        ensure_nonzero_u64("prune_interval", self.prune_interval)?;
        ensure_nonzero("ancestry_cache_entries", self.ancestry_cache_entries)?;
        ensure_nonzero("proof_queue_size", self.proof_queue_size)?;
        let pending_rate_per_second =
            nonzero_u32("pending_rate_per_second", self.pending_rate_per_second)?;
        let recovered_rate_per_second =
            nonzero_u32("recovered_rate_per_second", self.recovered_rate_per_second)?;
        let resolver_rate_per_second =
            nonzero_u32("resolver_rate_per_second", self.resolver_rate_per_second)?;
        let broadcaster_rate_per_second = nonzero_u32(
            "broadcaster_rate_per_second",
            self.broadcaster_rate_per_second,
        )?;
        let backfill_rate_per_second =
            nonzero_u32("backfill_rate_per_second", self.backfill_rate_per_second)?;
        let aggregation_rate_per_second = nonzero_u32(
            "aggregation_rate_per_second",
            self.aggregation_rate_per_second,
        )?;
        let fetch_rate_per_peer_per_second = nonzero_u32(
            "fetch_rate_per_peer_per_second",
            self.fetch_rate_per_peer_per_second,
        )?;

        if self.port == self.metrics_port {
            return Err(ConfigError::PortConflict {
                port: self.port,
                metrics_port: self.metrics_port,
            });
        }

        validate_http_url("indexer", &self.indexer)?;

        let public_key = signer.public_key();

        let share = decode_bytes("share", &self.share)?;

        let max_participants = nonzero_u32("peer_count", peer_count)?;
        let sharing = Sharing::<MinSig>::decode_cfg(self.polynomial.as_ref(), &max_participants)
            .map_err(|source| ConfigError::InvalidDecode {
                field: "polynomial",
                value: hex(self.polynomial.as_ref()),
                source,
            })?;
        let identity = *sharing.public();

        let log_level =
            Level::from_str(&self.log_level).map_err(|_| ConfigError::InvalidLogLevel {
                value: self.log_level.clone(),
            })?;

        Ok(ValidatedConfig {
            signer,
            public_key,
            share,
            sharing,
            identity,
            port: self.port,
            metrics_port: self.metrics_port,
            directory: PathBuf::from(self.directory),
            worker_threads: self.worker_threads,
            log_level,
            deterministic_seed: self.deterministic_seed,
            deterministic_time_scale: self
                .deterministic_time_scale_ms
                .map(Duration::from_millis),
            allowed_peers: self.allowed_peers,
            bootstrappers: self.bootstrappers,
            message_backlog: self.message_backlog,
            mailbox_size: self.mailbox_size,
            deque_size: self.deque_size,
            mempool_max_backlog: self.mempool_max_backlog,
            mempool_max_transactions: self.mempool_max_transactions,
            mempool_stream_buffer_size: self.mempool_stream_buffer_size,
            nonce_cache_capacity: self.nonce_cache_capacity,
            nonce_cache_ttl: Duration::from_secs(self.nonce_cache_ttl_seconds),
            max_pending_seed_listeners: self.max_pending_seed_listeners,
            indexer: self.indexer,
            execution_concurrency: self.execution_concurrency,
            max_uploads_outstanding: self.max_uploads_outstanding,
            allow_unsigned_summaries: self.allow_unsigned_summaries,
            max_message_size: self.max_message_size,
            leader_timeout: Duration::from_millis(self.leader_timeout_ms),
            notarization_timeout: Duration::from_millis(self.notarization_timeout_ms),
            nullify_retry: Duration::from_millis(self.nullify_retry_ms),
            fetch_timeout: Duration::from_millis(self.fetch_timeout_ms),
            activity_timeout: self.activity_timeout,
            skip_timeout: self.skip_timeout,
            fetch_concurrent: self.fetch_concurrent,
            max_fetch_count: self.max_fetch_count,
            max_fetch_size: self.max_fetch_size,
            blocks_freezer_table_initial_size: self.blocks_freezer_table_initial_size,
            finalized_freezer_table_initial_size: self.finalized_freezer_table_initial_size,
            buffer_pool_page_size,
            buffer_pool_capacity,
            prunable_items_per_section,
            immutable_items_per_section,
            freezer_table_resize_frequency: self.freezer_table_resize_frequency,
            freezer_table_resize_chunk_size: self.freezer_table_resize_chunk_size,
            freezer_journal_target_size: self.freezer_journal_target_size,
            freezer_journal_compression: self.freezer_journal_compression,
            mmr_items_per_blob,
            log_items_per_section,
            locations_items_per_blob,
            certificates_items_per_blob,
            cache_items_per_blob,
            replay_buffer_bytes,
            write_buffer_bytes,
            max_repair,
            prune_interval: self.prune_interval,
            ancestry_cache_entries: self.ancestry_cache_entries,
            proof_queue_size: self.proof_queue_size,
            pending_rate_per_second,
            recovered_rate_per_second,
            resolver_rate_per_second,
            broadcaster_rate_per_second,
            backfill_rate_per_second,
            aggregation_rate_per_second,
            fetch_rate_per_peer_per_second,
        })
    }
}

/// A list of peers provided when a validator is run locally.
///
/// When run remotely, [commonware_deployer::ec2::Hosts] is used instead.
#[derive(Deserialize, Serialize)]
pub struct Peers {
    pub addresses: HashMap<String, SocketAddr>,
}

#[cfg(test)]
mod tests;
