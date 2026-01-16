//! Artifact registry for deal artifacts.
//!
//! This module provides the [`ArtifactRegistry`] for storing and retrieving
//! deal artifacts (encryption keys, proofs, encrypted shares, etc.) by their
//! content hash.
//!
//! # Content-Addressed Storage
//!
//! Artifacts are stored and retrieved by their blake3 hash. This provides:
//!
//! 1. **Deduplication**: Identical artifacts are stored only once.
//! 2. **Integrity verification**: On retrieval, the hash is verified.
//! 3. **Tamper evidence**: Any modification invalidates the hash.
//!
//! # Metadata
//!
//! Each artifact has associated [`ArtifactMetadata`] that tracks:
//! - Creation timestamp
//! - Creator identity (seat or "dealer")
//! - Artifact type classification
//! - Size in bytes
//!
//! # Usage
//!
//! ```
//! use codexpoker_onchain::artifact_registry::{ArtifactRegistry, ArtifactType, InMemoryArtifactRegistry};
//!
//! let mut registry = InMemoryArtifactRegistry::new();
//!
//! // Store an artifact
//! let data = b"encryption key material";
//! let hash = registry.store(data, ArtifactType::EncryptionKey, "dealer", 1700000000000)
//!     .expect("store should succeed");
//!
//! // Retrieve by hash
//! let (retrieved_data, metadata) = registry.get(&hash).expect("should exist");
//! assert_eq!(retrieved_data, data);
//! ```
//!
//! # Size Bounds
//!
//! The registry enforces configurable size bounds to prevent DoS attacks:
//! - Maximum individual artifact size (default: 1 MiB)
//! - Maximum total storage (default: 256 MiB)
//!
//! These bounds can be adjusted via [`RegistryConfig`].
//!
//! # Backfill
//!
//! When a validator restarts or is missing artifacts, it can request them
//! from peers using the backfill API:
//!
//! 1. **Identify missing artifacts**: Use [`ArtifactRegistry::find_missing`] to
//!    determine which hashes are not in the local registry.
//! 2. **Create request**: Build an [`ArtifactRequest`] with the missing hashes.
//! 3. **Receive response**: Process the [`ArtifactResponse`] using
//!    [`ArtifactRegistry::process_backfill_response`].
//! 4. **Handle response**: Use [`ArtifactRegistry::handle_artifact_request`] to
//!    serve requests from peers.
//!
//! The backfill process is designed to be idempotent and corruption-resistant:
//! - Duplicate stores are no-ops
//! - Hash verification on store prevents corrupted data
//! - Missing artifacts don't corrupt existing state

use protocol_messages::{ArtifactRequest, ArtifactResponse};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

/// Maximum artifact size in bytes (default: 1 MiB).
///
/// This prevents a single malicious artifact from consuming excessive memory.
/// Typical deal artifacts (keys, proofs) are well under this limit.
pub const DEFAULT_MAX_ARTIFACT_SIZE: usize = 1024 * 1024;

/// Maximum total registry size in bytes (default: 256 MiB).
///
/// This bounds the total memory/storage used by the registry. When the limit
/// is reached, old artifacts may need to be evicted or new stores rejected.
pub const DEFAULT_MAX_TOTAL_SIZE: usize = 256 * 1024 * 1024;

/// Classification of artifact types.
///
/// This helps with auditing, retention policies, and understanding what
/// data the registry contains.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[non_exhaustive]
pub enum ArtifactType {
    /// Encryption key material for card encryption.
    EncryptionKey,
    /// Zero-knowledge proof or verification data.
    ZkProof,
    /// Encrypted card share data.
    EncryptedShare,
    /// Shuffle proof demonstrating correct permutation.
    ShuffleProof,
    /// Timelock puzzle or decryption material.
    TimelockMaterial,
    /// Other/unclassified artifact type.
    Other,
}

impl ArtifactType {
    /// Human-readable name for this artifact type.
    pub fn as_str(&self) -> &'static str {
        match self {
            ArtifactType::EncryptionKey => "encryption_key",
            ArtifactType::ZkProof => "zk_proof",
            ArtifactType::EncryptedShare => "encrypted_share",
            ArtifactType::ShuffleProof => "shuffle_proof",
            ArtifactType::TimelockMaterial => "timelock_material",
            ArtifactType::Other => "other",
        }
    }
}

/// Metadata associated with a stored artifact.
///
/// This metadata is stored alongside the artifact data and is useful for:
/// - Auditing who created which artifacts
/// - Lifecycle management (retention, eviction)
/// - Debugging and operational visibility
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactMetadata {
    /// Unix timestamp (milliseconds) when the artifact was stored.
    pub created_at_ms: u64,
    /// Identifier of the creator (e.g., "dealer", "seat_0", "seat_1").
    pub creator: String,
    /// Classification of the artifact type.
    pub artifact_type: ArtifactType,
    /// Size of the artifact data in bytes.
    pub size_bytes: usize,
    /// Optional: hash of the deal commitment this artifact belongs to.
    ///
    /// This enables efficient lookup of all artifacts for a given commitment.
    pub commitment_hash: Option<[u8; 32]>,
}

/// Errors that can occur when interacting with the artifact registry.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ArtifactRegistryError {
    /// Artifact not found for the given hash.
    #[error("artifact not found: {hash:?}")]
    NotFound { hash: [u8; 32] },

    /// Artifact exceeds maximum allowed size.
    #[error("artifact size {size} exceeds maximum {max}")]
    ArtifactTooLarge { size: usize, max: usize },

    /// Registry storage limit exceeded.
    #[error("registry full: total size {current} + {new} would exceed {max}")]
    RegistryFull {
        current: usize,
        new: usize,
        max: usize,
    },

    /// Hash verification failed on retrieval.
    ///
    /// This indicates data corruption or tampering.
    #[error("hash mismatch: expected {expected:?}, computed {computed:?}")]
    HashMismatch {
        expected: [u8; 32],
        computed: [u8; 32],
    },

    /// Duplicate artifact (same hash already exists).
    ///
    /// This is usually not an error - the existing artifact can be returned.
    #[error("artifact already exists: {hash:?}")]
    AlreadyExists { hash: [u8; 32] },
}

/// Configuration for the artifact registry.
#[derive(Debug, Clone)]
pub struct RegistryConfig {
    /// Maximum size of a single artifact in bytes.
    pub max_artifact_size: usize,
    /// Maximum total storage in bytes.
    pub max_total_size: usize,
    /// Whether to allow overwriting existing artifacts.
    ///
    /// If false (default), storing an artifact with an existing hash returns
    /// the existing hash without modification.
    pub allow_overwrite: bool,
}

impl Default for RegistryConfig {
    fn default() -> Self {
        Self {
            max_artifact_size: DEFAULT_MAX_ARTIFACT_SIZE,
            max_total_size: DEFAULT_MAX_TOTAL_SIZE,
            allow_overwrite: false,
        }
    }
}

/// Result of processing a backfill response.
///
/// This struct summarizes what happened when processing artifacts received
/// from a peer. It allows the caller to understand:
/// - Which artifacts were successfully stored
/// - Which artifacts failed validation (hash mismatch)
/// - Which artifacts couldn't be stored (size limits, etc.)
#[derive(Debug, Clone, Default)]
pub struct BackfillResult {
    /// Hashes of artifacts successfully stored.
    pub stored: Vec<[u8; 32]>,
    /// Hashes of artifacts that already existed (no-op).
    pub already_present: Vec<[u8; 32]>,
    /// Hashes where the received data didn't match the claimed hash.
    pub hash_mismatch: Vec<[u8; 32]>,
    /// Hashes that couldn't be stored due to size limits or other errors.
    /// Each entry is (hash, error_description).
    pub storage_failed: Vec<([u8; 32], String)>,
}

impl BackfillResult {
    /// Total number of artifacts processed (all categories).
    pub fn total_processed(&self) -> usize {
        self.stored.len()
            + self.already_present.len()
            + self.hash_mismatch.len()
            + self.storage_failed.len()
    }

    /// Whether the backfill was fully successful (no failures).
    pub fn is_complete(&self) -> bool {
        self.hash_mismatch.is_empty() && self.storage_failed.is_empty()
    }

    /// Number of artifacts that were newly stored.
    pub fn newly_stored(&self) -> usize {
        self.stored.len()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit Logging
// ─────────────────────────────────────────────────────────────────────────────

/// Classification of audit events for artifact operations.
///
/// These events provide operational visibility into registry operations,
/// enabling debugging, security monitoring, and forensic analysis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum AuditEventType {
    /// Artifact successfully stored.
    Store,
    /// Artifact store was a no-op (duplicate).
    StoreDuplicate,
    /// Artifact store failed (size limit, registry full).
    StoreFailed,
    /// Artifact successfully fetched.
    Fetch,
    /// Artifact fetch failed (not found).
    FetchNotFound,
    /// Artifact fetch failed (hash mismatch / corruption).
    FetchCorrupted,
    /// Artifact removed from registry.
    Remove,
    /// Backfill request received from peer.
    BackfillRequestReceived,
    /// Backfill response processed.
    BackfillResponseProcessed,
    /// Backfill artifact rejected (hash mismatch).
    BackfillHashMismatch,
}

impl AuditEventType {
    /// Human-readable name for this event type.
    pub fn as_str(&self) -> &'static str {
        match self {
            AuditEventType::Store => "store",
            AuditEventType::StoreDuplicate => "store_duplicate",
            AuditEventType::StoreFailed => "store_failed",
            AuditEventType::Fetch => "fetch",
            AuditEventType::FetchNotFound => "fetch_not_found",
            AuditEventType::FetchCorrupted => "fetch_corrupted",
            AuditEventType::Remove => "remove",
            AuditEventType::BackfillRequestReceived => "backfill_request_received",
            AuditEventType::BackfillResponseProcessed => "backfill_response_processed",
            AuditEventType::BackfillHashMismatch => "backfill_hash_mismatch",
        }
    }
}

/// A structured audit log entry for artifact operations.
///
/// Each entry captures:
/// - What happened (event type)
/// - When it happened (timestamp)
/// - Which artifact (hash)
/// - Additional context (artifact type, size, creator, error details)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditEntry {
    /// Unix timestamp (milliseconds) when the event occurred.
    pub timestamp_ms: u64,
    /// Classification of the event.
    pub event_type: AuditEventType,
    /// Hash of the artifact involved (if applicable).
    pub artifact_hash: Option<[u8; 32]>,
    /// Type of the artifact (if known).
    pub artifact_type: Option<ArtifactType>,
    /// Size of the artifact in bytes (if known).
    pub size_bytes: Option<usize>,
    /// Creator of the artifact (if known).
    pub creator: Option<String>,
    /// Commitment hash the artifact is associated with (if any).
    pub commitment_hash: Option<[u8; 32]>,
    /// Error message or additional details (if any).
    pub details: Option<String>,
    /// Number of artifacts involved (for batch operations).
    pub count: Option<usize>,
}

impl AuditEntry {
    /// Create a new audit entry with minimal fields.
    pub fn new(timestamp_ms: u64, event_type: AuditEventType) -> Self {
        Self {
            timestamp_ms,
            event_type,
            artifact_hash: None,
            artifact_type: None,
            size_bytes: None,
            creator: None,
            commitment_hash: None,
            details: None,
            count: None,
        }
    }

    /// Set the artifact hash.
    pub fn with_hash(mut self, hash: [u8; 32]) -> Self {
        self.artifact_hash = Some(hash);
        self
    }

    /// Set the artifact type.
    pub fn with_artifact_type(mut self, artifact_type: ArtifactType) -> Self {
        self.artifact_type = Some(artifact_type);
        self
    }

    /// Set the artifact size.
    pub fn with_size(mut self, size: usize) -> Self {
        self.size_bytes = Some(size);
        self
    }

    /// Set the creator.
    pub fn with_creator(mut self, creator: &str) -> Self {
        self.creator = Some(creator.to_string());
        self
    }

    /// Set the commitment hash.
    pub fn with_commitment(mut self, commitment_hash: [u8; 32]) -> Self {
        self.commitment_hash = Some(commitment_hash);
        self
    }

    /// Set additional details.
    pub fn with_details(mut self, details: &str) -> Self {
        self.details = Some(details.to_string());
        self
    }

    /// Set the count for batch operations.
    pub fn with_count(mut self, count: usize) -> Self {
        self.count = Some(count);
        self
    }
}

/// Trait for audit log storage.
///
/// Implementations may store logs in memory, write to disk, send to a
/// logging service, etc.
pub trait AuditLog: Send + Sync {
    /// Record an audit entry.
    fn record(&mut self, entry: AuditEntry);

    /// Get the number of recorded entries.
    fn len(&self) -> usize;

    /// Check if the log is empty.
    fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Get all entries (for testing/inspection).
    fn entries(&self) -> &[AuditEntry];

    /// Get entries filtered by event type.
    fn entries_by_type(&self, event_type: AuditEventType) -> Vec<&AuditEntry>;

    /// Get entries for a specific artifact hash.
    fn entries_for_artifact(&self, hash: &[u8; 32]) -> Vec<&AuditEntry>;

    /// Clear all entries (primarily for testing).
    fn clear(&mut self);
}

/// In-memory audit log implementation.
///
/// Stores audit entries in a vector, suitable for testing and short-lived
/// processes. For production, consider a persistent or streaming implementation.
#[derive(Debug, Default)]
pub struct InMemoryAuditLog {
    entries: Vec<AuditEntry>,
    /// Maximum entries to retain (0 = unlimited).
    max_entries: usize,
}

impl InMemoryAuditLog {
    /// Create a new in-memory audit log with no entry limit.
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            max_entries: 0,
        }
    }

    /// Create a new in-memory audit log with a maximum entry limit.
    ///
    /// When the limit is reached, oldest entries are evicted (FIFO).
    pub fn with_max_entries(max_entries: usize) -> Self {
        Self {
            entries: Vec::new(),
            max_entries,
        }
    }
}

impl AuditLog for InMemoryAuditLog {
    fn record(&mut self, entry: AuditEntry) {
        if self.max_entries > 0 && self.entries.len() >= self.max_entries {
            self.entries.remove(0);
        }
        self.entries.push(entry);
    }

    fn len(&self) -> usize {
        self.entries.len()
    }

    fn entries(&self) -> &[AuditEntry] {
        &self.entries
    }

    fn entries_by_type(&self, event_type: AuditEventType) -> Vec<&AuditEntry> {
        self.entries
            .iter()
            .filter(|e| e.event_type == event_type)
            .collect()
    }

    fn entries_for_artifact(&self, hash: &[u8; 32]) -> Vec<&AuditEntry> {
        self.entries
            .iter()
            .filter(|e| e.artifact_hash.as_ref() == Some(hash))
            .collect()
    }

    fn clear(&mut self) {
        self.entries.clear();
    }
}

/// An artifact registry wrapper that adds audit logging to all operations.
///
/// This wrapper delegates all storage operations to an inner registry while
/// recording audit entries for:
/// - Store operations (success, duplicate, failure)
/// - Fetch operations (success, not found, corruption)
/// - Remove operations
/// - Backfill operations (requests, responses, hash mismatches)
///
/// # Usage
///
/// ```
/// use codexpoker_onchain::artifact_registry::{
///     AuditedArtifactRegistry, ArtifactRegistry, ArtifactType, AuditLog,
///     InMemoryArtifactRegistry, InMemoryAuditLog,
/// };
///
/// let registry = InMemoryArtifactRegistry::new();
/// let audit_log = InMemoryAuditLog::new();
/// let mut audited = AuditedArtifactRegistry::new(registry, audit_log);
///
/// // Store an artifact
/// let hash = audited.store(b"data", ArtifactType::EncryptionKey, "dealer", 1000)
///     .expect("store should succeed");
///
/// // Audit log now contains a Store entry
/// assert_eq!(audited.audit_log().len(), 1);
/// ```
#[derive(Debug)]
pub struct AuditedArtifactRegistry<R: ArtifactRegistry, L: AuditLog> {
    inner: R,
    audit_log: L,
}

impl<R: ArtifactRegistry, L: AuditLog> AuditedArtifactRegistry<R, L> {
    /// Create a new audited registry wrapping the given inner registry.
    pub fn new(inner: R, audit_log: L) -> Self {
        Self { inner, audit_log }
    }

    /// Get a reference to the inner registry.
    pub fn inner(&self) -> &R {
        &self.inner
    }

    /// Get a mutable reference to the inner registry.
    pub fn inner_mut(&mut self) -> &mut R {
        &mut self.inner
    }

    /// Get a reference to the audit log.
    pub fn audit_log(&self) -> &L {
        &self.audit_log
    }

    /// Get a mutable reference to the audit log.
    pub fn audit_log_mut(&mut self) -> &mut L {
        &mut self.audit_log
    }

    /// Decompose into inner registry and audit log.
    pub fn into_parts(self) -> (R, L) {
        (self.inner, self.audit_log)
    }
}

impl<R: ArtifactRegistry, L: AuditLog> ArtifactRegistry for AuditedArtifactRegistry<R, L> {
    fn store(
        &mut self,
        data: &[u8],
        artifact_type: ArtifactType,
        creator: &str,
        timestamp_ms: u64,
    ) -> Result<[u8; 32], ArtifactRegistryError> {
        let pre_count = self.inner.count();
        let result = self.inner.store(data, artifact_type, creator, timestamp_ms);

        match &result {
            Ok(hash) => {
                let post_count = self.inner.count();
                let event_type = if post_count > pre_count {
                    AuditEventType::Store
                } else {
                    AuditEventType::StoreDuplicate
                };

                self.audit_log.record(
                    AuditEntry::new(timestamp_ms, event_type)
                        .with_hash(*hash)
                        .with_artifact_type(artifact_type)
                        .with_size(data.len())
                        .with_creator(creator),
                );
            }
            Err(e) => {
                let hash: [u8; 32] = blake3::hash(data).into();
                self.audit_log.record(
                    AuditEntry::new(timestamp_ms, AuditEventType::StoreFailed)
                        .with_hash(hash)
                        .with_artifact_type(artifact_type)
                        .with_size(data.len())
                        .with_creator(creator)
                        .with_details(&e.to_string()),
                );
            }
        }

        result
    }

    fn store_for_commitment(
        &mut self,
        data: &[u8],
        artifact_type: ArtifactType,
        creator: &str,
        timestamp_ms: u64,
        commitment_hash: [u8; 32],
    ) -> Result<[u8; 32], ArtifactRegistryError> {
        let pre_count = self.inner.count();
        let result = self
            .inner
            .store_for_commitment(data, artifact_type, creator, timestamp_ms, commitment_hash);

        match &result {
            Ok(hash) => {
                let post_count = self.inner.count();
                let event_type = if post_count > pre_count {
                    AuditEventType::Store
                } else {
                    AuditEventType::StoreDuplicate
                };

                self.audit_log.record(
                    AuditEntry::new(timestamp_ms, event_type)
                        .with_hash(*hash)
                        .with_artifact_type(artifact_type)
                        .with_size(data.len())
                        .with_creator(creator)
                        .with_commitment(commitment_hash),
                );
            }
            Err(e) => {
                let hash: [u8; 32] = blake3::hash(data).into();
                self.audit_log.record(
                    AuditEntry::new(timestamp_ms, AuditEventType::StoreFailed)
                        .with_hash(hash)
                        .with_artifact_type(artifact_type)
                        .with_size(data.len())
                        .with_creator(creator)
                        .with_commitment(commitment_hash)
                        .with_details(&e.to_string()),
                );
            }
        }

        result
    }

    fn get(&self, hash: &[u8; 32]) -> Result<(Vec<u8>, ArtifactMetadata), ArtifactRegistryError> {
        // Note: We can't record audit entries here because &self is immutable.
        // For full audit coverage of reads, use get_with_audit() instead.
        self.inner.get(hash)
    }

    fn contains(&self, hash: &[u8; 32]) -> bool {
        self.inner.contains(hash)
    }

    fn get_metadata(&self, hash: &[u8; 32]) -> Result<ArtifactMetadata, ArtifactRegistryError> {
        self.inner.get_metadata(hash)
    }

    fn remove(
        &mut self,
        hash: &[u8; 32],
    ) -> Result<(Vec<u8>, ArtifactMetadata), ArtifactRegistryError> {
        let result = self.inner.remove(hash);

        // Use current time placeholder; caller should provide timestamp if needed
        let timestamp_ms = 0;

        match &result {
            Ok((data, metadata)) => {
                self.audit_log.record(
                    AuditEntry::new(timestamp_ms, AuditEventType::Remove)
                        .with_hash(*hash)
                        .with_artifact_type(metadata.artifact_type)
                        .with_size(data.len())
                        .with_creator(&metadata.creator),
                );
            }
            Err(_) => {
                self.audit_log.record(
                    AuditEntry::new(timestamp_ms, AuditEventType::FetchNotFound).with_hash(*hash),
                );
            }
        }

        result
    }

    fn get_by_commitment(&self, commitment_hash: &[u8; 32]) -> Vec<[u8; 32]> {
        self.inner.get_by_commitment(commitment_hash)
    }

    fn total_size(&self) -> usize {
        self.inner.total_size()
    }

    fn count(&self) -> usize {
        self.inner.count()
    }

    fn find_missing(&self, hashes: &[[u8; 32]]) -> Vec<[u8; 32]> {
        self.inner.find_missing(hashes)
    }

    fn handle_artifact_request(&self, request: &ArtifactRequest) -> ArtifactResponse {
        // Note: immutable method, can't log here. Use handle_artifact_request_with_audit().
        self.inner.handle_artifact_request(request)
    }

    fn process_backfill_response(
        &mut self,
        response: &ArtifactResponse,
        timestamp_ms: u64,
    ) -> BackfillResult {
        let result = self
            .inner
            .process_backfill_response(response, timestamp_ms);

        // Log the overall backfill result
        self.audit_log.record(
            AuditEntry::new(timestamp_ms, AuditEventType::BackfillResponseProcessed)
                .with_count(result.total_processed())
                .with_details(&format!(
                    "stored={}, duplicates={}, hash_mismatch={}, failed={}",
                    result.stored.len(),
                    result.already_present.len(),
                    result.hash_mismatch.len(),
                    result.storage_failed.len()
                )),
        );

        // Log individual hash mismatches (security events)
        for hash in &result.hash_mismatch {
            self.audit_log.record(
                AuditEntry::new(timestamp_ms, AuditEventType::BackfillHashMismatch).with_hash(*hash),
            );
        }

        result
    }
}

impl<R: ArtifactRegistry, L: AuditLog> AuditedArtifactRegistry<R, L> {
    /// Get an artifact with full audit logging.
    ///
    /// Unlike the trait method `get()`, this method takes `&mut self` to
    /// allow recording audit entries for both successful and failed fetches.
    pub fn get_with_audit(
        &mut self,
        hash: &[u8; 32],
        timestamp_ms: u64,
    ) -> Result<(Vec<u8>, ArtifactMetadata), ArtifactRegistryError> {
        let result = self.inner.get(hash);

        match &result {
            Ok((data, metadata)) => {
                self.audit_log.record(
                    AuditEntry::new(timestamp_ms, AuditEventType::Fetch)
                        .with_hash(*hash)
                        .with_artifact_type(metadata.artifact_type)
                        .with_size(data.len()),
                );
            }
            Err(ArtifactRegistryError::NotFound { .. }) => {
                self.audit_log.record(
                    AuditEntry::new(timestamp_ms, AuditEventType::FetchNotFound).with_hash(*hash),
                );
            }
            Err(ArtifactRegistryError::HashMismatch { .. }) => {
                self.audit_log.record(
                    AuditEntry::new(timestamp_ms, AuditEventType::FetchCorrupted).with_hash(*hash),
                );
            }
            Err(_) => {
                // Other errors (shouldn't happen for get)
            }
        }

        result
    }

    /// Handle an artifact request with full audit logging.
    ///
    /// Unlike the trait method, this records the request in the audit log.
    pub fn handle_artifact_request_with_audit(
        &mut self,
        request: &ArtifactRequest,
        timestamp_ms: u64,
    ) -> ArtifactResponse {
        let response = self.inner.handle_artifact_request(request);

        self.audit_log.record(
            AuditEntry::new(timestamp_ms, AuditEventType::BackfillRequestReceived)
                .with_count(request.artifact_hashes.len())
                .with_details(&format!(
                    "requested={}, found={}, missing={}",
                    request.artifact_hashes.len(),
                    response.artifacts.len(),
                    response.missing.len()
                )),
        );

        // Log each miss
        for hash in &response.missing {
            self.audit_log.record(
                AuditEntry::new(timestamp_ms, AuditEventType::FetchNotFound).with_hash(*hash),
            );
        }

        response
    }
}

/// Trait for artifact storage backends.
///
/// This trait allows different storage implementations:
/// - [`InMemoryArtifactRegistry`]: Fast, volatile storage for testing/dev
/// - Future: persistent storage, distributed storage, etc.
///
/// # Thread Safety
///
/// Implementations must be safe for concurrent access from multiple threads.
/// The consensus path may validate artifacts concurrently.
pub trait ArtifactRegistry: Send + Sync {
    /// Store an artifact and return its hash.
    ///
    /// The hash is computed as `blake3(data)`. If an artifact with the same
    /// hash already exists and `allow_overwrite` is false, the existing hash
    /// is returned without modification.
    ///
    /// # Arguments
    ///
    /// * `data` - The artifact bytes to store
    /// * `artifact_type` - Classification of the artifact
    /// * `creator` - Identifier of who created this artifact
    /// * `timestamp_ms` - Unix timestamp when the artifact was created
    ///
    /// # Errors
    ///
    /// - [`ArtifactRegistryError::ArtifactTooLarge`] if data exceeds size limit
    /// - [`ArtifactRegistryError::RegistryFull`] if storage limit exceeded
    fn store(
        &mut self,
        data: &[u8],
        artifact_type: ArtifactType,
        creator: &str,
        timestamp_ms: u64,
    ) -> Result<[u8; 32], ArtifactRegistryError>;

    /// Store an artifact with an associated commitment hash.
    ///
    /// This is the preferred method when the artifact is part of a deal,
    /// as it enables efficient lookup by commitment.
    fn store_for_commitment(
        &mut self,
        data: &[u8],
        artifact_type: ArtifactType,
        creator: &str,
        timestamp_ms: u64,
        commitment_hash: [u8; 32],
    ) -> Result<[u8; 32], ArtifactRegistryError>;

    /// Retrieve an artifact by its hash.
    ///
    /// Returns the artifact data and its metadata. The implementation should
    /// verify the hash matches on retrieval to detect corruption.
    ///
    /// # Errors
    ///
    /// - [`ArtifactRegistryError::NotFound`] if no artifact exists for this hash
    /// - [`ArtifactRegistryError::HashMismatch`] if stored data is corrupted
    fn get(&self, hash: &[u8; 32]) -> Result<(Vec<u8>, ArtifactMetadata), ArtifactRegistryError>;

    /// Check if an artifact exists without retrieving it.
    fn contains(&self, hash: &[u8; 32]) -> bool;

    /// Get metadata for an artifact without retrieving the data.
    fn get_metadata(&self, hash: &[u8; 32]) -> Result<ArtifactMetadata, ArtifactRegistryError>;

    /// Remove an artifact from the registry.
    ///
    /// Returns the removed data and metadata, or an error if not found.
    fn remove(&mut self, hash: &[u8; 32])
        -> Result<(Vec<u8>, ArtifactMetadata), ArtifactRegistryError>;

    /// Get all artifact hashes for a given commitment.
    ///
    /// Returns an empty vec if no artifacts are associated with this commitment.
    fn get_by_commitment(&self, commitment_hash: &[u8; 32]) -> Vec<[u8; 32]>;

    /// Get the current total size of stored artifacts in bytes.
    fn total_size(&self) -> usize;

    /// Get the number of stored artifacts.
    fn count(&self) -> usize;

    // ─────────────────────────────────────────────────────────────────────────
    // Backfill API
    // ─────────────────────────────────────────────────────────────────────────

    /// Find which hashes from the given list are missing from the registry.
    ///
    /// Use this to determine which artifacts need to be requested from peers.
    ///
    /// # Arguments
    ///
    /// * `hashes` - List of artifact hashes to check
    ///
    /// # Returns
    ///
    /// Vector of hashes that are NOT present in the registry.
    fn find_missing(&self, hashes: &[[u8; 32]]) -> Vec<[u8; 32]>;

    /// Handle an artifact request from a peer.
    ///
    /// Builds an `ArtifactResponse` containing the requested artifacts that
    /// are present in the registry. Artifacts not found are listed in the
    /// `missing` field of the response.
    ///
    /// # Arguments
    ///
    /// * `request` - The artifact request from a peer
    ///
    /// # Returns
    ///
    /// An `ArtifactResponse` with found artifacts and missing hashes.
    fn handle_artifact_request(&self, request: &ArtifactRequest) -> ArtifactResponse;

    /// Process a backfill response and store received artifacts.
    ///
    /// This method validates each received artifact's hash before storing.
    /// Invalid artifacts (hash mismatch) are skipped but do not fail the
    /// entire operation.
    ///
    /// # Arguments
    ///
    /// * `response` - The artifact response from a peer
    /// * `timestamp_ms` - Timestamp to use for stored artifacts
    ///
    /// # Returns
    ///
    /// A `BackfillResult` summarizing what was stored and what failed.
    fn process_backfill_response(
        &mut self,
        response: &ArtifactResponse,
        timestamp_ms: u64,
    ) -> BackfillResult;
}

/// In-memory artifact registry implementation.
///
/// This is a fast, volatile storage suitable for testing and development.
/// Artifacts are lost when the process exits.
///
/// # Thread Safety
///
/// This implementation uses internal mutability patterns. For concurrent
/// access, wrap in an `Arc<Mutex<_>>` or use a concurrent HashMap.
#[derive(Debug)]
pub struct InMemoryArtifactRegistry {
    /// Configuration for size bounds.
    config: RegistryConfig,
    /// Stored artifacts: hash -> (data, metadata).
    artifacts: HashMap<[u8; 32], (Vec<u8>, ArtifactMetadata)>,
    /// Index: commitment_hash -> [artifact_hashes].
    commitment_index: HashMap<[u8; 32], Vec<[u8; 32]>>,
    /// Current total size of stored artifacts.
    current_size: usize,
}

impl InMemoryArtifactRegistry {
    /// Create a new in-memory registry with default configuration.
    pub fn new() -> Self {
        Self::with_config(RegistryConfig::default())
    }

    /// Create a new in-memory registry with custom configuration.
    pub fn with_config(config: RegistryConfig) -> Self {
        Self {
            config,
            artifacts: HashMap::new(),
            commitment_index: HashMap::new(),
            current_size: 0,
        }
    }

    /// Compute the blake3 hash of data.
    fn compute_hash(data: &[u8]) -> [u8; 32] {
        blake3::hash(data).into()
    }
}

impl Default for InMemoryArtifactRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ArtifactRegistry for InMemoryArtifactRegistry {
    fn store(
        &mut self,
        data: &[u8],
        artifact_type: ArtifactType,
        creator: &str,
        timestamp_ms: u64,
    ) -> Result<[u8; 32], ArtifactRegistryError> {
        // Check size bounds
        if data.len() > self.config.max_artifact_size {
            return Err(ArtifactRegistryError::ArtifactTooLarge {
                size: data.len(),
                max: self.config.max_artifact_size,
            });
        }

        // Compute hash
        let hash = Self::compute_hash(data);

        // Check for duplicate
        if self.artifacts.contains_key(&hash) {
            if !self.config.allow_overwrite {
                // Return existing hash (idempotent)
                return Ok(hash);
            }
            // Remove existing to update size tracking
            if let Some((old_data, _)) = self.artifacts.remove(&hash) {
                self.current_size -= old_data.len();
            }
        }

        // Check total size limit
        if self.current_size + data.len() > self.config.max_total_size {
            return Err(ArtifactRegistryError::RegistryFull {
                current: self.current_size,
                new: data.len(),
                max: self.config.max_total_size,
            });
        }

        // Create metadata
        let metadata = ArtifactMetadata {
            created_at_ms: timestamp_ms,
            creator: creator.to_string(),
            artifact_type,
            size_bytes: data.len(),
            commitment_hash: None,
        };

        // Store
        self.artifacts.insert(hash, (data.to_vec(), metadata));
        self.current_size += data.len();

        Ok(hash)
    }

    fn store_for_commitment(
        &mut self,
        data: &[u8],
        artifact_type: ArtifactType,
        creator: &str,
        timestamp_ms: u64,
        commitment_hash: [u8; 32],
    ) -> Result<[u8; 32], ArtifactRegistryError> {
        // Check size bounds
        if data.len() > self.config.max_artifact_size {
            return Err(ArtifactRegistryError::ArtifactTooLarge {
                size: data.len(),
                max: self.config.max_artifact_size,
            });
        }

        // Compute hash
        let hash = Self::compute_hash(data);

        // Check for duplicate
        if self.artifacts.contains_key(&hash) {
            if !self.config.allow_overwrite {
                // Ensure it's indexed for this commitment
                self.commitment_index
                    .entry(commitment_hash)
                    .or_default()
                    .push(hash);
                return Ok(hash);
            }
            // Remove existing to update size tracking
            if let Some((old_data, _)) = self.artifacts.remove(&hash) {
                self.current_size -= old_data.len();
            }
        }

        // Check total size limit
        if self.current_size + data.len() > self.config.max_total_size {
            return Err(ArtifactRegistryError::RegistryFull {
                current: self.current_size,
                new: data.len(),
                max: self.config.max_total_size,
            });
        }

        // Create metadata
        let metadata = ArtifactMetadata {
            created_at_ms: timestamp_ms,
            creator: creator.to_string(),
            artifact_type,
            size_bytes: data.len(),
            commitment_hash: Some(commitment_hash),
        };

        // Store
        self.artifacts.insert(hash, (data.to_vec(), metadata));
        self.current_size += data.len();

        // Index by commitment
        self.commitment_index
            .entry(commitment_hash)
            .or_default()
            .push(hash);

        Ok(hash)
    }

    fn get(&self, hash: &[u8; 32]) -> Result<(Vec<u8>, ArtifactMetadata), ArtifactRegistryError> {
        let (data, metadata) = self
            .artifacts
            .get(hash)
            .ok_or(ArtifactRegistryError::NotFound { hash: *hash })?;

        // Verify hash integrity
        let computed = Self::compute_hash(data);
        if computed != *hash {
            return Err(ArtifactRegistryError::HashMismatch {
                expected: *hash,
                computed,
            });
        }

        Ok((data.clone(), metadata.clone()))
    }

    fn contains(&self, hash: &[u8; 32]) -> bool {
        self.artifacts.contains_key(hash)
    }

    fn get_metadata(&self, hash: &[u8; 32]) -> Result<ArtifactMetadata, ArtifactRegistryError> {
        self.artifacts
            .get(hash)
            .map(|(_, metadata)| metadata.clone())
            .ok_or(ArtifactRegistryError::NotFound { hash: *hash })
    }

    fn remove(
        &mut self,
        hash: &[u8; 32],
    ) -> Result<(Vec<u8>, ArtifactMetadata), ArtifactRegistryError> {
        let (data, metadata) = self
            .artifacts
            .remove(hash)
            .ok_or(ArtifactRegistryError::NotFound { hash: *hash })?;

        self.current_size -= data.len();

        // Remove from commitment index if present
        if let Some(commitment_hash) = &metadata.commitment_hash {
            if let Some(hashes) = self.commitment_index.get_mut(commitment_hash) {
                hashes.retain(|h| h != hash);
                if hashes.is_empty() {
                    self.commitment_index.remove(commitment_hash);
                }
            }
        }

        Ok((data, metadata))
    }

    fn get_by_commitment(&self, commitment_hash: &[u8; 32]) -> Vec<[u8; 32]> {
        self.commitment_index
            .get(commitment_hash)
            .cloned()
            .unwrap_or_default()
    }

    fn total_size(&self) -> usize {
        self.current_size
    }

    fn count(&self) -> usize {
        self.artifacts.len()
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Backfill Implementation
    // ─────────────────────────────────────────────────────────────────────────

    fn find_missing(&self, hashes: &[[u8; 32]]) -> Vec<[u8; 32]> {
        hashes
            .iter()
            .filter(|h| !self.artifacts.contains_key(*h))
            .copied()
            .collect()
    }

    fn handle_artifact_request(&self, request: &ArtifactRequest) -> ArtifactResponse {
        let mut artifacts = Vec::new();
        let mut missing = Vec::new();

        for hash in &request.artifact_hashes {
            match self.artifacts.get(hash) {
                Some((data, _metadata)) => {
                    // Include the artifact data in the response
                    artifacts.push((*hash, data.clone()));
                }
                None => {
                    // Track as missing
                    missing.push(*hash);
                }
            }
        }

        ArtifactResponse {
            version: request.version,
            artifacts,
            missing,
        }
    }

    fn process_backfill_response(
        &mut self,
        response: &ArtifactResponse,
        timestamp_ms: u64,
    ) -> BackfillResult {
        let mut result = BackfillResult::default();

        for (claimed_hash, data) in &response.artifacts {
            // Verify the hash matches the data
            let computed_hash = Self::compute_hash(data);
            if computed_hash != *claimed_hash {
                result.hash_mismatch.push(*claimed_hash);
                continue;
            }

            // Check if already present
            if self.artifacts.contains_key(claimed_hash) {
                result.already_present.push(*claimed_hash);
                continue;
            }

            // Try to store
            match self.store(data, ArtifactType::Other, "backfill", timestamp_ms) {
                Ok(_hash) => {
                    result.stored.push(*claimed_hash);
                }
                Err(e) => {
                    result.storage_failed.push((*claimed_hash, e.to_string()));
                }
            }
        }

        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_store_and_retrieve() {
        let mut registry = InMemoryArtifactRegistry::new();

        let data = b"test artifact data";
        let hash = registry
            .store(data, ArtifactType::EncryptionKey, "dealer", 1700000000000)
            .expect("store should succeed");

        // Hash should be blake3 of data
        let expected_hash: [u8; 32] = blake3::hash(data).into();
        assert_eq!(hash, expected_hash);

        // Retrieve should return same data
        let (retrieved, metadata) = registry.get(&hash).expect("get should succeed");
        assert_eq!(retrieved, data);
        assert_eq!(metadata.creator, "dealer");
        assert_eq!(metadata.artifact_type, ArtifactType::EncryptionKey);
        assert_eq!(metadata.size_bytes, data.len());
    }

    #[test]
    fn test_duplicate_store_is_idempotent() {
        let mut registry = InMemoryArtifactRegistry::new();

        let data = b"same data twice";
        let hash1 = registry
            .store(data, ArtifactType::ZkProof, "dealer", 1)
            .unwrap();
        let hash2 = registry
            .store(data, ArtifactType::ZkProof, "dealer", 2)
            .unwrap();

        // Same hash returned
        assert_eq!(hash1, hash2);
        // Only stored once
        assert_eq!(registry.count(), 1);
    }

    #[test]
    fn test_not_found_error() {
        let registry = InMemoryArtifactRegistry::new();
        let fake_hash = [0u8; 32];

        let result = registry.get(&fake_hash);
        assert!(matches!(
            result,
            Err(ArtifactRegistryError::NotFound { .. })
        ));
    }

    #[test]
    fn test_size_limit_per_artifact() {
        let config = RegistryConfig {
            max_artifact_size: 100,
            max_total_size: 1000,
            allow_overwrite: false,
        };
        let mut registry = InMemoryArtifactRegistry::with_config(config);

        let large_data = vec![0u8; 200];
        let result = registry.store(&large_data, ArtifactType::Other, "test", 0);

        assert!(matches!(
            result,
            Err(ArtifactRegistryError::ArtifactTooLarge { size: 200, max: 100 })
        ));
    }

    #[test]
    fn test_total_size_limit() {
        let config = RegistryConfig {
            max_artifact_size: 100,
            max_total_size: 150,
            allow_overwrite: false,
        };
        let mut registry = InMemoryArtifactRegistry::with_config(config);

        // Store first artifact (100 bytes)
        let data1 = vec![1u8; 100];
        registry
            .store(&data1, ArtifactType::Other, "test", 0)
            .expect("first store should succeed");

        // Try to store second artifact (60 bytes) - would exceed 150 total
        let data2 = vec![2u8; 60];
        let result = registry.store(&data2, ArtifactType::Other, "test", 0);

        assert!(matches!(
            result,
            Err(ArtifactRegistryError::RegistryFull { .. })
        ));
    }

    #[test]
    fn test_store_for_commitment_and_index() {
        let mut registry = InMemoryArtifactRegistry::new();
        let commitment_hash = [42u8; 32];

        let data1 = b"artifact 1";
        let data2 = b"artifact 2";

        let hash1 = registry
            .store_for_commitment(
                data1,
                ArtifactType::EncryptionKey,
                "dealer",
                1,
                commitment_hash,
            )
            .unwrap();

        let hash2 = registry
            .store_for_commitment(
                data2,
                ArtifactType::ShuffleProof,
                "dealer",
                2,
                commitment_hash,
            )
            .unwrap();

        // Both artifacts should be indexed under the commitment
        let indexed = registry.get_by_commitment(&commitment_hash);
        assert_eq!(indexed.len(), 2);
        assert!(indexed.contains(&hash1));
        assert!(indexed.contains(&hash2));
    }

    #[test]
    fn test_remove_updates_index() {
        let mut registry = InMemoryArtifactRegistry::new();
        let commitment_hash = [42u8; 32];

        let data = b"artifact to remove";
        let hash = registry
            .store_for_commitment(
                data,
                ArtifactType::EncryptedShare,
                "seat_0",
                1,
                commitment_hash,
            )
            .unwrap();

        // Verify it's indexed
        assert_eq!(registry.get_by_commitment(&commitment_hash).len(), 1);

        // Remove it
        let (removed_data, metadata) = registry.remove(&hash).unwrap();
        assert_eq!(removed_data, data);
        assert_eq!(metadata.commitment_hash, Some(commitment_hash));

        // Index should be empty now
        assert!(registry.get_by_commitment(&commitment_hash).is_empty());

        // Should no longer be retrievable
        assert!(!registry.contains(&hash));
    }

    #[test]
    fn test_contains() {
        let mut registry = InMemoryArtifactRegistry::new();

        let data = b"check existence";
        let hash = registry
            .store(data, ArtifactType::Other, "test", 0)
            .unwrap();

        assert!(registry.contains(&hash));
        assert!(!registry.contains(&[0u8; 32]));
    }

    #[test]
    fn test_get_metadata_without_data() {
        let mut registry = InMemoryArtifactRegistry::new();

        let data = b"metadata test";
        let hash = registry
            .store(data, ArtifactType::TimelockMaterial, "seat_1", 999)
            .unwrap();

        let metadata = registry.get_metadata(&hash).unwrap();
        assert_eq!(metadata.creator, "seat_1");
        assert_eq!(metadata.artifact_type, ArtifactType::TimelockMaterial);
        assert_eq!(metadata.created_at_ms, 999);
    }

    #[test]
    fn test_total_size_tracking() {
        let mut registry = InMemoryArtifactRegistry::new();

        let data1 = vec![1u8; 100];
        let data2 = vec![2u8; 200];

        registry
            .store(&data1, ArtifactType::Other, "test", 0)
            .unwrap();
        assert_eq!(registry.total_size(), 100);

        registry
            .store(&data2, ArtifactType::Other, "test", 0)
            .unwrap();
        assert_eq!(registry.total_size(), 300);

        // Storing duplicate doesn't increase size
        registry
            .store(&data1, ArtifactType::Other, "test", 0)
            .unwrap();
        assert_eq!(registry.total_size(), 300);
    }

    #[test]
    fn test_artifact_type_as_str() {
        assert_eq!(ArtifactType::EncryptionKey.as_str(), "encryption_key");
        assert_eq!(ArtifactType::ZkProof.as_str(), "zk_proof");
        assert_eq!(ArtifactType::EncryptedShare.as_str(), "encrypted_share");
        assert_eq!(ArtifactType::ShuffleProof.as_str(), "shuffle_proof");
        assert_eq!(ArtifactType::TimelockMaterial.as_str(), "timelock_material");
        assert_eq!(ArtifactType::Other.as_str(), "other");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Backfill Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_find_missing_returns_missing_hashes() {
        let mut registry = InMemoryArtifactRegistry::new();

        let data1 = b"artifact 1";
        let hash1 = registry
            .store(data1, ArtifactType::Other, "test", 0)
            .unwrap();

        let fake_hash1 = [1u8; 32];
        let fake_hash2 = [2u8; 32];

        // Check which are missing
        let missing = registry.find_missing(&[hash1, fake_hash1, fake_hash2]);

        // hash1 exists, the other two don't
        assert_eq!(missing.len(), 2);
        assert!(missing.contains(&fake_hash1));
        assert!(missing.contains(&fake_hash2));
        assert!(!missing.contains(&hash1));
    }

    #[test]
    fn test_find_missing_empty_when_all_present() {
        let mut registry = InMemoryArtifactRegistry::new();

        let data1 = b"artifact 1";
        let data2 = b"artifact 2";
        let hash1 = registry
            .store(data1, ArtifactType::Other, "test", 0)
            .unwrap();
        let hash2 = registry
            .store(data2, ArtifactType::Other, "test", 0)
            .unwrap();

        let missing = registry.find_missing(&[hash1, hash2]);
        assert!(missing.is_empty());
    }

    #[test]
    fn test_handle_artifact_request_returns_present_artifacts() {
        use protocol_messages::ProtocolVersion;

        let mut registry = InMemoryArtifactRegistry::new();

        let data1 = b"artifact 1";
        let data2 = b"artifact 2";
        let hash1 = registry
            .store(data1, ArtifactType::EncryptionKey, "dealer", 1)
            .unwrap();
        let hash2 = registry
            .store(data2, ArtifactType::ShuffleProof, "dealer", 2)
            .unwrap();
        let missing_hash = [99u8; 32];

        let request = ArtifactRequest {
            version: ProtocolVersion::current(),
            artifact_hashes: vec![hash1, missing_hash, hash2],
            commitment_hash: None,
        };

        let response = registry.handle_artifact_request(&request);

        // Should have 2 artifacts
        assert_eq!(response.artifacts.len(), 2);
        assert!(response.artifacts.iter().any(|(h, d)| *h == hash1 && d == data1));
        assert!(response.artifacts.iter().any(|(h, d)| *h == hash2 && d == data2));

        // Should have 1 missing
        assert_eq!(response.missing.len(), 1);
        assert_eq!(response.missing[0], missing_hash);
    }

    #[test]
    fn test_process_backfill_response_stores_valid_artifacts() {
        use protocol_messages::ProtocolVersion;

        let mut registry = InMemoryArtifactRegistry::new();

        let data1 = b"new artifact 1";
        let data2 = b"new artifact 2";
        let hash1: [u8; 32] = blake3::hash(data1).into();
        let hash2: [u8; 32] = blake3::hash(data2).into();

        let response = ArtifactResponse {
            version: ProtocolVersion::current(),
            artifacts: vec![(hash1, data1.to_vec()), (hash2, data2.to_vec())],
            missing: vec![],
        };

        let result = registry.process_backfill_response(&response, 1000);

        // Both should be stored
        assert_eq!(result.stored.len(), 2);
        assert!(result.stored.contains(&hash1));
        assert!(result.stored.contains(&hash2));
        assert!(result.is_complete());

        // Verify they're actually in the registry
        assert!(registry.contains(&hash1));
        assert!(registry.contains(&hash2));
        let (retrieved, _) = registry.get(&hash1).unwrap();
        assert_eq!(retrieved, data1);
    }

    #[test]
    fn test_process_backfill_response_rejects_hash_mismatch() {
        use protocol_messages::ProtocolVersion;

        let mut registry = InMemoryArtifactRegistry::new();

        let data = b"actual data";
        let claimed_hash = [42u8; 32]; // Wrong hash

        let response = ArtifactResponse {
            version: ProtocolVersion::current(),
            artifacts: vec![(claimed_hash, data.to_vec())],
            missing: vec![],
        };

        let result = registry.process_backfill_response(&response, 1000);

        // Should be rejected
        assert_eq!(result.hash_mismatch.len(), 1);
        assert_eq!(result.hash_mismatch[0], claimed_hash);
        assert!(result.stored.is_empty());
        assert!(!result.is_complete());

        // Should NOT be in registry
        assert!(!registry.contains(&claimed_hash));
    }

    #[test]
    fn test_process_backfill_response_handles_already_present() {
        use protocol_messages::ProtocolVersion;

        let mut registry = InMemoryArtifactRegistry::new();

        // Pre-populate
        let data = b"already here";
        let hash = registry
            .store(data, ArtifactType::Other, "original", 1)
            .unwrap();

        // Try to backfill same artifact
        let response = ArtifactResponse {
            version: ProtocolVersion::current(),
            artifacts: vec![(hash, data.to_vec())],
            missing: vec![],
        };

        let result = registry.process_backfill_response(&response, 2000);

        // Should be marked as already present
        assert_eq!(result.already_present.len(), 1);
        assert!(result.stored.is_empty());
        assert!(result.is_complete()); // Not a failure

        // Original metadata should be preserved
        let metadata = registry.get_metadata(&hash).unwrap();
        assert_eq!(metadata.creator, "original");
        assert_eq!(metadata.created_at_ms, 1);
    }

    #[test]
    fn test_process_backfill_response_handles_size_limit() {
        use protocol_messages::ProtocolVersion;

        let config = RegistryConfig {
            max_artifact_size: 100,
            max_total_size: 150,
            allow_overwrite: false,
        };
        let mut registry = InMemoryArtifactRegistry::with_config(config);

        // Fill up registry
        let filler = vec![1u8; 100];
        registry
            .store(&filler, ArtifactType::Other, "filler", 0)
            .unwrap();

        // Try to backfill something that won't fit
        let big_data = vec![2u8; 60];
        let big_hash: [u8; 32] = blake3::hash(&big_data).into();

        let response = ArtifactResponse {
            version: ProtocolVersion::current(),
            artifacts: vec![(big_hash, big_data)],
            missing: vec![],
        };

        let result = registry.process_backfill_response(&response, 1000);

        // Should fail to store
        assert_eq!(result.storage_failed.len(), 1);
        assert_eq!(result.storage_failed[0].0, big_hash);
        assert!(result.storage_failed[0].1.contains("registry full"));
        assert!(!result.is_complete());
    }

    #[test]
    fn test_backfill_result_helpers() {
        let mut result = BackfillResult::default();

        assert_eq!(result.total_processed(), 0);
        assert!(result.is_complete());
        assert_eq!(result.newly_stored(), 0);

        result.stored.push([1u8; 32]);
        result.already_present.push([2u8; 32]);

        assert_eq!(result.total_processed(), 2);
        assert!(result.is_complete());
        assert_eq!(result.newly_stored(), 1);

        result.hash_mismatch.push([3u8; 32]);

        assert_eq!(result.total_processed(), 3);
        assert!(!result.is_complete());
    }

    #[test]
    fn test_full_backfill_round_trip() {
        use protocol_messages::ProtocolVersion;

        // Set up source registry with some artifacts
        let mut source = InMemoryArtifactRegistry::new();
        let data1 = b"encryption key material";
        let data2 = b"shuffle proof data";
        let hash1 = source
            .store(data1, ArtifactType::EncryptionKey, "dealer", 1)
            .unwrap();
        let hash2 = source
            .store(data2, ArtifactType::ShuffleProof, "dealer", 2)
            .unwrap();

        // Set up destination registry (empty)
        let mut dest = InMemoryArtifactRegistry::new();

        // Find what's missing in dest
        let missing = dest.find_missing(&[hash1, hash2]);
        assert_eq!(missing.len(), 2);

        // Create request
        let request = ArtifactRequest {
            version: ProtocolVersion::current(),
            artifact_hashes: missing,
            commitment_hash: None,
        };

        // Source handles request
        let response = source.handle_artifact_request(&request);
        assert_eq!(response.artifacts.len(), 2);
        assert!(response.missing.is_empty());

        // Dest processes response
        let result = dest.process_backfill_response(&response, 3000);
        assert_eq!(result.stored.len(), 2);
        assert!(result.is_complete());

        // Verify dest now has the artifacts
        assert!(dest.contains(&hash1));
        assert!(dest.contains(&hash2));

        let (retrieved1, _) = dest.get(&hash1).unwrap();
        let (retrieved2, _) = dest.get(&hash2).unwrap();
        assert_eq!(retrieved1, data1);
        assert_eq!(retrieved2, data2);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Audit Logging Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_audit_event_type_as_str() {
        assert_eq!(AuditEventType::Store.as_str(), "store");
        assert_eq!(AuditEventType::StoreDuplicate.as_str(), "store_duplicate");
        assert_eq!(AuditEventType::StoreFailed.as_str(), "store_failed");
        assert_eq!(AuditEventType::Fetch.as_str(), "fetch");
        assert_eq!(AuditEventType::FetchNotFound.as_str(), "fetch_not_found");
        assert_eq!(AuditEventType::FetchCorrupted.as_str(), "fetch_corrupted");
        assert_eq!(AuditEventType::Remove.as_str(), "remove");
        assert_eq!(
            AuditEventType::BackfillRequestReceived.as_str(),
            "backfill_request_received"
        );
        assert_eq!(
            AuditEventType::BackfillResponseProcessed.as_str(),
            "backfill_response_processed"
        );
        assert_eq!(
            AuditEventType::BackfillHashMismatch.as_str(),
            "backfill_hash_mismatch"
        );
    }

    #[test]
    fn test_audit_entry_builder() {
        let entry = AuditEntry::new(1000, AuditEventType::Store)
            .with_hash([1u8; 32])
            .with_artifact_type(ArtifactType::EncryptionKey)
            .with_size(256)
            .with_creator("dealer")
            .with_commitment([2u8; 32])
            .with_details("test details")
            .with_count(5);

        assert_eq!(entry.timestamp_ms, 1000);
        assert_eq!(entry.event_type, AuditEventType::Store);
        assert_eq!(entry.artifact_hash, Some([1u8; 32]));
        assert_eq!(entry.artifact_type, Some(ArtifactType::EncryptionKey));
        assert_eq!(entry.size_bytes, Some(256));
        assert_eq!(entry.creator, Some("dealer".to_string()));
        assert_eq!(entry.commitment_hash, Some([2u8; 32]));
        assert_eq!(entry.details, Some("test details".to_string()));
        assert_eq!(entry.count, Some(5));
    }

    #[test]
    fn test_in_memory_audit_log_record_and_retrieve() {
        let mut log = InMemoryAuditLog::new();

        assert!(log.is_empty());
        assert_eq!(log.len(), 0);

        log.record(AuditEntry::new(1, AuditEventType::Store).with_hash([1u8; 32]));
        log.record(AuditEntry::new(2, AuditEventType::Fetch).with_hash([2u8; 32]));

        assert!(!log.is_empty());
        assert_eq!(log.len(), 2);
        assert_eq!(log.entries().len(), 2);
    }

    #[test]
    fn test_in_memory_audit_log_filter_by_type() {
        let mut log = InMemoryAuditLog::new();

        log.record(AuditEntry::new(1, AuditEventType::Store).with_hash([1u8; 32]));
        log.record(AuditEntry::new(2, AuditEventType::Store).with_hash([2u8; 32]));
        log.record(AuditEntry::new(3, AuditEventType::Fetch).with_hash([3u8; 32]));
        log.record(AuditEntry::new(4, AuditEventType::FetchNotFound).with_hash([4u8; 32]));

        let stores = log.entries_by_type(AuditEventType::Store);
        assert_eq!(stores.len(), 2);

        let fetches = log.entries_by_type(AuditEventType::Fetch);
        assert_eq!(fetches.len(), 1);

        let not_found = log.entries_by_type(AuditEventType::FetchNotFound);
        assert_eq!(not_found.len(), 1);
    }

    #[test]
    fn test_in_memory_audit_log_filter_by_artifact() {
        let mut log = InMemoryAuditLog::new();
        let hash = [42u8; 32];

        log.record(AuditEntry::new(1, AuditEventType::Store).with_hash(hash));
        log.record(AuditEntry::new(2, AuditEventType::Fetch).with_hash(hash));
        log.record(AuditEntry::new(3, AuditEventType::Store).with_hash([99u8; 32]));

        let artifact_entries = log.entries_for_artifact(&hash);
        assert_eq!(artifact_entries.len(), 2);
        assert!(artifact_entries.iter().all(|e| e.artifact_hash == Some(hash)));
    }

    #[test]
    fn test_in_memory_audit_log_max_entries() {
        let mut log = InMemoryAuditLog::with_max_entries(3);

        log.record(AuditEntry::new(1, AuditEventType::Store));
        log.record(AuditEntry::new(2, AuditEventType::Store));
        log.record(AuditEntry::new(3, AuditEventType::Store));

        assert_eq!(log.len(), 3);
        assert_eq!(log.entries()[0].timestamp_ms, 1);

        // Adding 4th should evict the oldest
        log.record(AuditEntry::new(4, AuditEventType::Store));
        assert_eq!(log.len(), 3);
        assert_eq!(log.entries()[0].timestamp_ms, 2); // First entry evicted
        assert_eq!(log.entries()[2].timestamp_ms, 4); // New entry added
    }

    #[test]
    fn test_in_memory_audit_log_clear() {
        let mut log = InMemoryAuditLog::new();

        log.record(AuditEntry::new(1, AuditEventType::Store));
        log.record(AuditEntry::new(2, AuditEventType::Fetch));

        assert_eq!(log.len(), 2);

        log.clear();

        assert!(log.is_empty());
        assert_eq!(log.len(), 0);
    }

    #[test]
    fn test_audited_registry_logs_store() {
        let registry = InMemoryArtifactRegistry::new();
        let audit_log = InMemoryAuditLog::new();
        let mut audited = AuditedArtifactRegistry::new(registry, audit_log);

        let data = b"test data";
        let hash = audited
            .store(data, ArtifactType::EncryptionKey, "dealer", 1000)
            .unwrap();

        assert_eq!(audited.audit_log().len(), 1);
        let entry = &audited.audit_log().entries()[0];
        assert_eq!(entry.event_type, AuditEventType::Store);
        assert_eq!(entry.artifact_hash, Some(hash));
        assert_eq!(entry.artifact_type, Some(ArtifactType::EncryptionKey));
        assert_eq!(entry.size_bytes, Some(data.len()));
        assert_eq!(entry.creator, Some("dealer".to_string()));
        assert_eq!(entry.timestamp_ms, 1000);
    }

    #[test]
    fn test_audited_registry_logs_duplicate_store() {
        let registry = InMemoryArtifactRegistry::new();
        let audit_log = InMemoryAuditLog::new();
        let mut audited = AuditedArtifactRegistry::new(registry, audit_log);

        let data = b"duplicate data";

        // First store
        audited
            .store(data, ArtifactType::ZkProof, "dealer", 1)
            .unwrap();
        assert_eq!(audited.audit_log().entries()[0].event_type, AuditEventType::Store);

        // Second store (duplicate)
        audited
            .store(data, ArtifactType::ZkProof, "dealer", 2)
            .unwrap();
        assert_eq!(audited.audit_log().entries()[1].event_type, AuditEventType::StoreDuplicate);
    }

    #[test]
    fn test_audited_registry_logs_store_failure() {
        let config = RegistryConfig {
            max_artifact_size: 10,
            max_total_size: 1000,
            allow_overwrite: false,
        };
        let registry = InMemoryArtifactRegistry::with_config(config);
        let audit_log = InMemoryAuditLog::new();
        let mut audited = AuditedArtifactRegistry::new(registry, audit_log);

        let large_data = vec![0u8; 50]; // Too large
        let result = audited.store(&large_data, ArtifactType::Other, "test", 1000);

        assert!(result.is_err());
        assert_eq!(audited.audit_log().len(), 1);
        let entry = &audited.audit_log().entries()[0];
        assert_eq!(entry.event_type, AuditEventType::StoreFailed);
        assert!(entry.details.is_some());
        assert!(entry.details.as_ref().unwrap().contains("exceeds maximum"));
    }

    #[test]
    fn test_audited_registry_get_with_audit() {
        let registry = InMemoryArtifactRegistry::new();
        let audit_log = InMemoryAuditLog::new();
        let mut audited = AuditedArtifactRegistry::new(registry, audit_log);

        let data = b"fetch test";
        let hash = audited
            .store(data, ArtifactType::ShuffleProof, "dealer", 1)
            .unwrap();

        audited.audit_log_mut().clear();

        // Successful fetch
        let (retrieved, _) = audited.get_with_audit(&hash, 2000).unwrap();
        assert_eq!(retrieved, data);
        assert_eq!(audited.audit_log().len(), 1);
        assert_eq!(audited.audit_log().entries()[0].event_type, AuditEventType::Fetch);

        // Failed fetch (not found)
        let missing_hash = [99u8; 32];
        let result = audited.get_with_audit(&missing_hash, 3000);
        assert!(result.is_err());
        assert_eq!(audited.audit_log().len(), 2);
        assert_eq!(
            audited.audit_log().entries()[1].event_type,
            AuditEventType::FetchNotFound
        );
    }

    #[test]
    fn test_audited_registry_logs_remove() {
        let registry = InMemoryArtifactRegistry::new();
        let audit_log = InMemoryAuditLog::new();
        let mut audited = AuditedArtifactRegistry::new(registry, audit_log);

        let data = b"remove test";
        let hash = audited
            .store(data, ArtifactType::EncryptedShare, "seat_0", 1)
            .unwrap();

        audited.audit_log_mut().clear();

        // Remove
        audited.remove(&hash).unwrap();
        assert_eq!(audited.audit_log().len(), 1);
        assert_eq!(audited.audit_log().entries()[0].event_type, AuditEventType::Remove);

        // Try to remove again (not found)
        let result = audited.remove(&hash);
        assert!(result.is_err());
        assert_eq!(audited.audit_log().len(), 2);
        assert_eq!(
            audited.audit_log().entries()[1].event_type,
            AuditEventType::FetchNotFound
        );
    }

    #[test]
    fn test_audited_registry_logs_backfill_response() {
        use protocol_messages::ProtocolVersion;

        let registry = InMemoryArtifactRegistry::new();
        let audit_log = InMemoryAuditLog::new();
        let mut audited = AuditedArtifactRegistry::new(registry, audit_log);

        let data1 = b"backfill artifact 1";
        let hash1: [u8; 32] = blake3::hash(data1).into();

        let response = ArtifactResponse {
            version: ProtocolVersion::current(),
            artifacts: vec![(hash1, data1.to_vec())],
            missing: vec![],
        };

        let result = audited.process_backfill_response(&response, 5000);
        assert_eq!(result.stored.len(), 1);

        // Should log the backfill response processed event
        let log = audited.audit_log();
        assert!(log.entries_by_type(AuditEventType::BackfillResponseProcessed).len() >= 1);
    }

    #[test]
    fn test_audited_registry_logs_backfill_hash_mismatch() {
        use protocol_messages::ProtocolVersion;

        let registry = InMemoryArtifactRegistry::new();
        let audit_log = InMemoryAuditLog::new();
        let mut audited = AuditedArtifactRegistry::new(registry, audit_log);

        let data = b"actual data";
        let claimed_hash = [42u8; 32]; // Wrong hash

        let response = ArtifactResponse {
            version: ProtocolVersion::current(),
            artifacts: vec![(claimed_hash, data.to_vec())],
            missing: vec![],
        };

        let result = audited.process_backfill_response(&response, 5000);
        assert_eq!(result.hash_mismatch.len(), 1);

        // Should log the hash mismatch
        let mismatches = audited
            .audit_log()
            .entries_by_type(AuditEventType::BackfillHashMismatch);
        assert_eq!(mismatches.len(), 1);
        assert_eq!(mismatches[0].artifact_hash, Some(claimed_hash));
    }

    #[test]
    fn test_audited_registry_handle_request_with_audit() {
        use protocol_messages::ProtocolVersion;

        let registry = InMemoryArtifactRegistry::new();
        let audit_log = InMemoryAuditLog::new();
        let mut audited = AuditedArtifactRegistry::new(registry, audit_log);

        // Store some artifacts
        let data = b"available artifact";
        let hash = audited
            .store(data, ArtifactType::ZkProof, "dealer", 1)
            .unwrap();

        audited.audit_log_mut().clear();

        let missing_hash = [99u8; 32];
        let request = ArtifactRequest {
            version: ProtocolVersion::current(),
            artifact_hashes: vec![hash, missing_hash],
            commitment_hash: None,
        };

        let response = audited.handle_artifact_request_with_audit(&request, 2000);
        assert_eq!(response.artifacts.len(), 1);
        assert_eq!(response.missing.len(), 1);

        // Should log request received and the miss
        let log = audited.audit_log();
        assert_eq!(
            log.entries_by_type(AuditEventType::BackfillRequestReceived)
                .len(),
            1
        );
        assert_eq!(log.entries_by_type(AuditEventType::FetchNotFound).len(), 1);
    }

    #[test]
    fn test_audited_registry_store_for_commitment() {
        let registry = InMemoryArtifactRegistry::new();
        let audit_log = InMemoryAuditLog::new();
        let mut audited = AuditedArtifactRegistry::new(registry, audit_log);

        let data = b"commitment artifact";
        let commitment_hash = [42u8; 32];

        let hash = audited
            .store_for_commitment(data, ArtifactType::ShuffleProof, "dealer", 1000, commitment_hash)
            .unwrap();

        let entry = &audited.audit_log().entries()[0];
        assert_eq!(entry.event_type, AuditEventType::Store);
        assert_eq!(entry.artifact_hash, Some(hash));
        assert_eq!(entry.commitment_hash, Some(commitment_hash));
    }

    #[test]
    fn test_audited_registry_into_parts() {
        let registry = InMemoryArtifactRegistry::new();
        let audit_log = InMemoryAuditLog::new();
        let mut audited = AuditedArtifactRegistry::new(registry, audit_log);

        audited
            .store(b"test", ArtifactType::Other, "test", 0)
            .unwrap();

        let (inner, log) = audited.into_parts();
        assert_eq!(inner.count(), 1);
        assert_eq!(log.len(), 1);
    }
}
