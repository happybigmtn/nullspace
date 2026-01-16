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
}
