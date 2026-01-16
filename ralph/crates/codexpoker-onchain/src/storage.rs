//! Block storage for persisting chain history.
//!
//! This module provides the [`BlockStorage`] trait and implementations for
//! persisting blocks, finalization certificates, and receipts to disk.
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────────────────┐
//! │                          BlockStorage                                        │
//! │  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────────┐ │
//! │  │   InMemoryStorage  │  │   FileBlockStorage │  │  (future: distributed) │ │
//! │  │   (testing)        │  │   (production)     │  │                        │ │
//! │  └────────────────────┘  └────────────────────┘  └────────────────────────┘ │
//! │                                    │                                         │
//! │                                    ▼                                         │
//! │  ┌─────────────────────────────────────────────────────────────────────────┐ │
//! │  │                     Directory Layout                                     │ │
//! │  │  data/                                                                   │ │
//! │  │  ├── blocks/                                                             │ │
//! │  │  │   ├── 0000000000000000.block                                          │ │
//! │  │  │   ├── 0000000000000001.block                                          │ │
//! │  │  │   └── ...                                                             │ │
//! │  │  ├── finalizations/                                                      │ │
//! │  │  │   ├── 0000000000000000.fin                                            │ │
//! │  │  │   └── ...                                                             │ │
//! │  │  ├── receipts/                                                           │ │
//! │  │  │   ├── 0000000000000000.receipts                                       │ │
//! │  │  │   └── ...                                                             │ │
//! │  │  └── chain_state.json                                                    │ │
//! │  └─────────────────────────────────────────────────────────────────────────┘ │
//! └─────────────────────────────────────────────────────────────────────────────┘
//! ```
//!
//! # Durability
//!
//! File-based storage uses a write-rename pattern for atomic updates:
//! 1. Write data to a temporary file
//! 2. Sync the file to disk (`fsync`)
//! 3. Rename to the final path (atomic on POSIX)
//!
//! This ensures that a crash during write leaves no partial data.
//!
//! # Recovery
//!
//! On startup, [`FileBlockStorage::recover`] scans the storage directory and
//! rebuilds the chain state from persisted blocks and finalizations.

use crate::block::{Block, Receipt};
use crate::consensus::{ChainState, Digest, Finalization, Marshal};
use std::collections::HashMap;
use std::io::{Read as IoRead, Write as IoWrite};
use std::path::{Path, PathBuf};
use thiserror::Error;

// ─────────────────────────────────────────────────────────────────────────────
// Storage Errors
// ─────────────────────────────────────────────────────────────────────────────

/// Errors that can occur during block storage operations.
#[derive(Debug, Error)]
pub enum StorageError {
    /// I/O error during file operations.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// Serialization/deserialization error.
    #[error("serialization error: {0}")]
    Serialization(String),

    /// Block not found at the given height.
    #[error("block not found at height {height}")]
    BlockNotFound { height: u64 },

    /// Finalization not found at the given height.
    #[error("finalization not found at height {height}")]
    FinalizationNotFound { height: u64 },

    /// Receipts not found at the given height.
    #[error("receipts not found at height {height}")]
    ReceiptsNotFound { height: u64 },

    /// Chain state corrupted or inconsistent.
    #[error("chain state corrupted: {0}")]
    CorruptedState(String),

    /// Storage directory does not exist or is not accessible.
    #[error("storage directory error: {0}")]
    DirectoryError(String),
}

// ─────────────────────────────────────────────────────────────────────────────
// BlockStorage Trait
// ─────────────────────────────────────────────────────────────────────────────

/// Trait for block storage backends.
///
/// Implementations provide persistent storage for blocks, finalization
/// certificates, and receipts. The storage is keyed by block height.
///
/// # Thread Safety
///
/// Implementations should be safe for use from a single thread. For concurrent
/// access, wrap in appropriate synchronization primitives.
pub trait BlockStorage: Send {
    /// Persist a block at the given height.
    ///
    /// If a block already exists at this height, it is overwritten.
    fn put_block(&mut self, height: u64, block: &Block) -> Result<(), StorageError>;

    /// Retrieve a block by height.
    fn get_block(&self, height: u64) -> Result<Block, StorageError>;

    /// Check if a block exists at the given height.
    fn has_block(&self, height: u64) -> bool;

    /// Persist a finalization certificate at the given height.
    fn put_finalization(&mut self, height: u64, finalization: &Finalization)
        -> Result<(), StorageError>;

    /// Retrieve a finalization certificate by height.
    fn get_finalization(&self, height: u64) -> Result<Finalization, StorageError>;

    /// Check if a finalization exists at the given height.
    fn has_finalization(&self, height: u64) -> bool;

    /// Persist receipts for a block at the given height.
    fn put_receipts(&mut self, height: u64, receipts: &[Receipt]) -> Result<(), StorageError>;

    /// Retrieve receipts by block height.
    fn get_receipts(&self, height: u64) -> Result<Vec<Receipt>, StorageError>;

    /// Check if receipts exist at the given height.
    fn has_receipts(&self, height: u64) -> bool;

    /// Persist the current chain state.
    ///
    /// This includes the tip digest, height, and state root. Used for fast
    /// restart without re-scanning all blocks.
    fn put_chain_state(&mut self, state: &ChainState) -> Result<(), StorageError>;

    /// Retrieve the persisted chain state.
    ///
    /// Returns `None` if no state has been persisted yet (fresh start).
    fn get_chain_state(&self) -> Result<Option<ChainState>, StorageError>;

    /// Get the highest block height in storage.
    ///
    /// Returns `None` if no blocks have been stored.
    fn max_height(&self) -> Option<u64>;

    /// Persist a block, its finalization, and receipts atomically.
    ///
    /// This is the primary method used by consensus after finalization.
    /// Default implementation calls individual put methods; implementations
    /// may override for true atomicity.
    fn persist_finalized(
        &mut self,
        block: &Block,
        finalization: &Finalization,
        receipts: &[Receipt],
        chain_state: &ChainState,
    ) -> Result<(), StorageError> {
        let height = block.header.height;
        self.put_block(height, block)?;
        self.put_finalization(height, finalization)?;
        self.put_receipts(height, receipts)?;
        self.put_chain_state(chain_state)?;
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Storage (for testing)
// ─────────────────────────────────────────────────────────────────────────────

/// In-memory block storage for testing.
///
/// This implementation stores everything in memory and is lost when the
/// process exits. Useful for unit tests and development.
#[derive(Debug, Default)]
pub struct InMemoryBlockStorage {
    blocks: HashMap<u64, Vec<u8>>,
    finalizations: HashMap<u64, Vec<u8>>,
    receipts: HashMap<u64, Vec<u8>>,
    chain_state: Option<ChainState>,
}

impl InMemoryBlockStorage {
    /// Create a new empty in-memory storage.
    pub fn new() -> Self {
        Self::default()
    }
}

impl BlockStorage for InMemoryBlockStorage {
    fn put_block(&mut self, height: u64, block: &Block) -> Result<(), StorageError> {
        let encoded = Marshal::encode_block(block)
            .map_err(|e| StorageError::Serialization(e.to_string()))?;
        self.blocks.insert(height, encoded);
        Ok(())
    }

    fn get_block(&self, height: u64) -> Result<Block, StorageError> {
        let data = self
            .blocks
            .get(&height)
            .ok_or(StorageError::BlockNotFound { height })?;
        Marshal::decode_block(data).map_err(|e| StorageError::Serialization(e.to_string()))
    }

    fn has_block(&self, height: u64) -> bool {
        self.blocks.contains_key(&height)
    }

    fn put_finalization(
        &mut self,
        height: u64,
        finalization: &Finalization,
    ) -> Result<(), StorageError> {
        let encoded = Marshal::encode_finalization(finalization)
            .map_err(|e| StorageError::Serialization(e.to_string()))?;
        self.finalizations.insert(height, encoded);
        Ok(())
    }

    fn get_finalization(&self, height: u64) -> Result<Finalization, StorageError> {
        let data = self
            .finalizations
            .get(&height)
            .ok_or(StorageError::FinalizationNotFound { height })?;
        Marshal::decode_finalization(data).map_err(|e| StorageError::Serialization(e.to_string()))
    }

    fn has_finalization(&self, height: u64) -> bool {
        self.finalizations.contains_key(&height)
    }

    fn put_receipts(&mut self, height: u64, receipts: &[Receipt]) -> Result<(), StorageError> {
        let encoded = serde_json::to_vec(receipts)
            .map_err(|e| StorageError::Serialization(e.to_string()))?;
        self.receipts.insert(height, encoded);
        Ok(())
    }

    fn get_receipts(&self, height: u64) -> Result<Vec<Receipt>, StorageError> {
        let data = self
            .receipts
            .get(&height)
            .ok_or(StorageError::ReceiptsNotFound { height })?;
        serde_json::from_slice(data).map_err(|e| StorageError::Serialization(e.to_string()))
    }

    fn has_receipts(&self, height: u64) -> bool {
        self.receipts.contains_key(&height)
    }

    fn put_chain_state(&mut self, state: &ChainState) -> Result<(), StorageError> {
        self.chain_state = Some(state.clone());
        Ok(())
    }

    fn get_chain_state(&self) -> Result<Option<ChainState>, StorageError> {
        Ok(self.chain_state.clone())
    }

    fn max_height(&self) -> Option<u64> {
        self.blocks.keys().max().copied()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// File-Based Storage (for production)
// ─────────────────────────────────────────────────────────────────────────────

/// File-based block storage for production use.
///
/// Stores blocks, finalizations, and receipts as files in a directory tree.
/// Uses atomic write-rename operations to ensure durability.
///
/// # Directory Structure
///
/// ```text
/// {base_path}/
/// ├── blocks/
/// │   ├── 0000000000000000.block
/// │   ├── 0000000000000001.block
/// │   └── ...
/// ├── finalizations/
/// │   ├── 0000000000000000.fin
/// │   └── ...
/// ├── receipts/
/// │   ├── 0000000000000000.receipts
/// │   └── ...
/// └── chain_state.json
/// ```
pub struct FileBlockStorage {
    base_path: PathBuf,
    blocks_dir: PathBuf,
    finalizations_dir: PathBuf,
    receipts_dir: PathBuf,
}

impl FileBlockStorage {
    /// Create or open file-based storage at the given path.
    ///
    /// Creates the directory structure if it doesn't exist.
    pub fn open(base_path: impl AsRef<Path>) -> Result<Self, StorageError> {
        let base = base_path.as_ref().to_path_buf();
        let blocks_dir = base.join("blocks");
        let finalizations_dir = base.join("finalizations");
        let receipts_dir = base.join("receipts");

        // Create directories
        std::fs::create_dir_all(&blocks_dir)?;
        std::fs::create_dir_all(&finalizations_dir)?;
        std::fs::create_dir_all(&receipts_dir)?;

        Ok(Self {
            base_path: base,
            blocks_dir,
            finalizations_dir,
            receipts_dir,
        })
    }

    /// Recover chain state from persisted data.
    ///
    /// Scans the storage and returns the `ChainState` reflecting the
    /// highest finalized block. If a `chain_state.json` exists and matches
    /// the stored data, it is returned directly.
    ///
    /// # Recovery Process
    ///
    /// 1. Try to load `chain_state.json`
    /// 2. Verify it matches the highest stored block
    /// 3. If mismatch or missing, rebuild from blocks
    pub fn recover(&self) -> Result<Option<ChainState>, StorageError> {
        // First try to load persisted chain state
        if let Some(state) = self.get_chain_state()? {
            // Verify the state matches storage
            if self.has_block(state.height) && self.has_finalization(state.height) {
                let block = self.get_block(state.height)?;
                let digest = Digest::from_header(&block.header);
                if digest == state.tip && block.header.state_root == state.state_root {
                    return Ok(Some(state));
                }
            }
        }

        // Rebuild from storage
        let max_height = match self.max_height() {
            Some(h) => h,
            None => return Ok(None), // Empty storage
        };

        // Load the highest block
        let block = self.get_block(max_height)?;
        let state = ChainState::at(
            Digest::from_header(&block.header),
            max_height,
            block.header.state_root,
        );

        Ok(Some(state))
    }

    /// Format a height as a zero-padded 16-digit hex string.
    fn height_to_filename(height: u64) -> String {
        format!("{:016x}", height)
    }

    /// Parse a height from a filename.
    fn filename_to_height(filename: &str) -> Option<u64> {
        // Strip extension and parse
        let stem = filename.split('.').next()?;
        u64::from_str_radix(stem, 16).ok()
    }

    /// Path to the block file for a given height.
    fn block_path(&self, height: u64) -> PathBuf {
        self.blocks_dir
            .join(format!("{}.block", Self::height_to_filename(height)))
    }

    /// Path to the finalization file for a given height.
    fn finalization_path(&self, height: u64) -> PathBuf {
        self.finalizations_dir
            .join(format!("{}.fin", Self::height_to_filename(height)))
    }

    /// Path to the receipts file for a given height.
    fn receipts_path(&self, height: u64) -> PathBuf {
        self.receipts_dir
            .join(format!("{}.receipts", Self::height_to_filename(height)))
    }

    /// Path to the chain state file.
    fn chain_state_path(&self) -> PathBuf {
        self.base_path.join("chain_state.json")
    }

    /// Atomically write data to a file using write-rename pattern.
    fn atomic_write(&self, path: &Path, data: &[u8]) -> Result<(), StorageError> {
        let temp_path = path.with_extension("tmp");

        // Write to temp file
        {
            let mut file = std::fs::File::create(&temp_path)?;
            file.write_all(data)?;
            file.sync_all()?; // Ensure data is on disk
        }

        // Atomic rename
        std::fs::rename(&temp_path, path)?;

        Ok(())
    }

    /// Read entire file contents.
    fn read_file(&self, path: &Path) -> Result<Vec<u8>, std::io::Error> {
        let mut file = std::fs::File::open(path)?;
        let mut data = Vec::new();
        file.read_to_end(&mut data)?;
        Ok(data)
    }
}

impl BlockStorage for FileBlockStorage {
    fn put_block(&mut self, height: u64, block: &Block) -> Result<(), StorageError> {
        let encoded = Marshal::encode_block(block)
            .map_err(|e| StorageError::Serialization(e.to_string()))?;
        self.atomic_write(&self.block_path(height), &encoded)
    }

    fn get_block(&self, height: u64) -> Result<Block, StorageError> {
        let path = self.block_path(height);
        let data = self
            .read_file(&path)
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::NotFound => StorageError::BlockNotFound { height },
                _ => StorageError::Io(e),
            })?;
        Marshal::decode_block(&data).map_err(|e| StorageError::Serialization(e.to_string()))
    }

    fn has_block(&self, height: u64) -> bool {
        self.block_path(height).exists()
    }

    fn put_finalization(
        &mut self,
        height: u64,
        finalization: &Finalization,
    ) -> Result<(), StorageError> {
        let encoded = Marshal::encode_finalization(finalization)
            .map_err(|e| StorageError::Serialization(e.to_string()))?;
        self.atomic_write(&self.finalization_path(height), &encoded)
    }

    fn get_finalization(&self, height: u64) -> Result<Finalization, StorageError> {
        let path = self.finalization_path(height);
        let data = self.read_file(&path).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => StorageError::FinalizationNotFound { height },
            _ => StorageError::Io(e),
        })?;
        Marshal::decode_finalization(&data).map_err(|e| StorageError::Serialization(e.to_string()))
    }

    fn has_finalization(&self, height: u64) -> bool {
        self.finalization_path(height).exists()
    }

    fn put_receipts(&mut self, height: u64, receipts: &[Receipt]) -> Result<(), StorageError> {
        let encoded =
            serde_json::to_vec(receipts).map_err(|e| StorageError::Serialization(e.to_string()))?;
        self.atomic_write(&self.receipts_path(height), &encoded)
    }

    fn get_receipts(&self, height: u64) -> Result<Vec<Receipt>, StorageError> {
        let path = self.receipts_path(height);
        let data = self.read_file(&path).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => StorageError::ReceiptsNotFound { height },
            _ => StorageError::Io(e),
        })?;
        serde_json::from_slice(&data).map_err(|e| StorageError::Serialization(e.to_string()))
    }

    fn has_receipts(&self, height: u64) -> bool {
        self.receipts_path(height).exists()
    }

    fn put_chain_state(&mut self, state: &ChainState) -> Result<(), StorageError> {
        let encoded =
            serde_json::to_vec(state).map_err(|e| StorageError::Serialization(e.to_string()))?;
        self.atomic_write(&self.chain_state_path(), &encoded)
    }

    fn get_chain_state(&self) -> Result<Option<ChainState>, StorageError> {
        let path = self.chain_state_path();
        if !path.exists() {
            return Ok(None);
        }
        let data = self.read_file(&path)?;
        let state =
            serde_json::from_slice(&data).map_err(|e| StorageError::Serialization(e.to_string()))?;
        Ok(Some(state))
    }

    fn max_height(&self) -> Option<u64> {
        let entries = std::fs::read_dir(&self.blocks_dir).ok()?;
        entries
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                Self::filename_to_height(&name)
            })
            .max()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::block::{BlockBody, BlockHeader};
    use protocol_messages::ProtocolVersion;

    fn test_version() -> ProtocolVersion {
        ProtocolVersion::current()
    }

    fn make_test_block(height: u64) -> Block {
        let header = if height == 0 {
            BlockHeader::genesis(
                test_version(),
                [1u8; 32],
                [2u8; 32],
                1700000000000,
                [3u8; 32],
            )
        } else {
            BlockHeader::new(
                test_version(),
                height,
                [(height - 1) as u8; 32],
                [1u8; 32],
                [2u8; 32],
                1700000000000 + height,
                [3u8; 32],
            )
        };
        Block::new(header, BlockBody::empty())
    }

    fn make_test_finalization(height: u64, block: &Block) -> Finalization {
        let mut fin = Finalization::new(
            test_version(),
            Digest::from_header(&block.header),
            height,
            height,
        );
        fin.add_signature([1u8; 32], vec![0xAA; 64]);
        fin
    }

    fn make_test_receipts() -> Vec<Receipt> {
        vec![
            Receipt::success([1u8; 32], [2u8; 32]),
            Receipt::success([3u8; 32], [4u8; 32]),
        ]
    }

    // ─────────────────────────────────────────────────────────────────────────
    // InMemoryBlockStorage Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_in_memory_block_roundtrip() {
        let mut storage = InMemoryBlockStorage::new();
        let block = make_test_block(0);

        storage.put_block(0, &block).unwrap();
        assert!(storage.has_block(0));
        assert!(!storage.has_block(1));

        let retrieved = storage.get_block(0).unwrap();
        assert_eq!(retrieved.header.height, 0);
        assert_eq!(retrieved.block_hash(), block.block_hash());
    }

    #[test]
    fn test_in_memory_finalization_roundtrip() {
        let mut storage = InMemoryBlockStorage::new();
        let block = make_test_block(0);
        let fin = make_test_finalization(0, &block);

        storage.put_finalization(0, &fin).unwrap();
        assert!(storage.has_finalization(0));

        let retrieved = storage.get_finalization(0).unwrap();
        assert_eq!(retrieved.height, 0);
        assert_eq!(retrieved.digest, fin.digest);
    }

    #[test]
    fn test_in_memory_receipts_roundtrip() {
        let mut storage = InMemoryBlockStorage::new();
        let receipts = make_test_receipts();

        storage.put_receipts(0, &receipts).unwrap();
        assert!(storage.has_receipts(0));

        let retrieved = storage.get_receipts(0).unwrap();
        assert_eq!(retrieved.len(), 2);
        assert_eq!(retrieved[0].payload_hash, [1u8; 32]);
    }

    #[test]
    fn test_in_memory_chain_state_roundtrip() {
        let mut storage = InMemoryBlockStorage::new();
        let state = ChainState::at(Digest::new([1u8; 32]), 5, [2u8; 32]);

        assert!(storage.get_chain_state().unwrap().is_none());

        storage.put_chain_state(&state).unwrap();
        let retrieved = storage.get_chain_state().unwrap().unwrap();

        assert_eq!(retrieved.tip, state.tip);
        assert_eq!(retrieved.height, state.height);
        assert_eq!(retrieved.state_root, state.state_root);
    }

    #[test]
    fn test_in_memory_max_height() {
        let mut storage = InMemoryBlockStorage::new();
        assert!(storage.max_height().is_none());

        storage.put_block(5, &make_test_block(5)).unwrap();
        assert_eq!(storage.max_height(), Some(5));

        storage.put_block(10, &make_test_block(10)).unwrap();
        assert_eq!(storage.max_height(), Some(10));

        storage.put_block(3, &make_test_block(3)).unwrap();
        assert_eq!(storage.max_height(), Some(10));
    }

    #[test]
    fn test_in_memory_persist_finalized() {
        let mut storage = InMemoryBlockStorage::new();
        let block = make_test_block(0);
        let fin = make_test_finalization(0, &block);
        let receipts = make_test_receipts();
        let state = ChainState::at(
            Digest::from_header(&block.header),
            0,
            block.header.state_root,
        );

        storage
            .persist_finalized(&block, &fin, &receipts, &state)
            .unwrap();

        assert!(storage.has_block(0));
        assert!(storage.has_finalization(0));
        assert!(storage.has_receipts(0));
        assert!(storage.get_chain_state().unwrap().is_some());
    }

    #[test]
    fn test_in_memory_not_found_errors() {
        let storage = InMemoryBlockStorage::new();

        assert!(matches!(
            storage.get_block(99),
            Err(StorageError::BlockNotFound { height: 99 })
        ));

        assert!(matches!(
            storage.get_finalization(99),
            Err(StorageError::FinalizationNotFound { height: 99 })
        ));

        assert!(matches!(
            storage.get_receipts(99),
            Err(StorageError::ReceiptsNotFound { height: 99 })
        ));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FileBlockStorage Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_file_storage_creates_directories() {
        let temp_dir = tempfile::tempdir().unwrap();
        let storage = FileBlockStorage::open(temp_dir.path()).unwrap();

        assert!(storage.blocks_dir.exists());
        assert!(storage.finalizations_dir.exists());
        assert!(storage.receipts_dir.exists());
    }

    #[test]
    fn test_file_storage_block_roundtrip() {
        let temp_dir = tempfile::tempdir().unwrap();
        let mut storage = FileBlockStorage::open(temp_dir.path()).unwrap();
        let block = make_test_block(0);

        storage.put_block(0, &block).unwrap();
        assert!(storage.has_block(0));
        assert!(!storage.has_block(1));

        let retrieved = storage.get_block(0).unwrap();
        assert_eq!(retrieved.header.height, 0);
        assert_eq!(retrieved.block_hash(), block.block_hash());
    }

    #[test]
    fn test_file_storage_finalization_roundtrip() {
        let temp_dir = tempfile::tempdir().unwrap();
        let mut storage = FileBlockStorage::open(temp_dir.path()).unwrap();
        let block = make_test_block(0);
        let fin = make_test_finalization(0, &block);

        storage.put_finalization(0, &fin).unwrap();
        assert!(storage.has_finalization(0));

        let retrieved = storage.get_finalization(0).unwrap();
        assert_eq!(retrieved.height, 0);
        assert_eq!(retrieved.digest, fin.digest);
    }

    #[test]
    fn test_file_storage_receipts_roundtrip() {
        let temp_dir = tempfile::tempdir().unwrap();
        let mut storage = FileBlockStorage::open(temp_dir.path()).unwrap();
        let receipts = make_test_receipts();

        storage.put_receipts(0, &receipts).unwrap();
        assert!(storage.has_receipts(0));

        let retrieved = storage.get_receipts(0).unwrap();
        assert_eq!(retrieved.len(), 2);
    }

    #[test]
    fn test_file_storage_chain_state_roundtrip() {
        let temp_dir = tempfile::tempdir().unwrap();
        let mut storage = FileBlockStorage::open(temp_dir.path()).unwrap();
        let state = ChainState::at(Digest::new([1u8; 32]), 5, [2u8; 32]);

        assert!(storage.get_chain_state().unwrap().is_none());

        storage.put_chain_state(&state).unwrap();
        let retrieved = storage.get_chain_state().unwrap().unwrap();

        assert_eq!(retrieved.tip, state.tip);
        assert_eq!(retrieved.height, state.height);
    }

    #[test]
    fn test_file_storage_max_height() {
        let temp_dir = tempfile::tempdir().unwrap();
        let mut storage = FileBlockStorage::open(temp_dir.path()).unwrap();

        assert!(storage.max_height().is_none());

        storage.put_block(5, &make_test_block(5)).unwrap();
        assert_eq!(storage.max_height(), Some(5));

        storage.put_block(10, &make_test_block(10)).unwrap();
        assert_eq!(storage.max_height(), Some(10));
    }

    #[test]
    fn test_file_storage_persist_finalized() {
        let temp_dir = tempfile::tempdir().unwrap();
        let mut storage = FileBlockStorage::open(temp_dir.path()).unwrap();
        let block = make_test_block(0);
        let fin = make_test_finalization(0, &block);
        let receipts = make_test_receipts();
        let state = ChainState::at(
            Digest::from_header(&block.header),
            0,
            block.header.state_root,
        );

        storage
            .persist_finalized(&block, &fin, &receipts, &state)
            .unwrap();

        assert!(storage.has_block(0));
        assert!(storage.has_finalization(0));
        assert!(storage.has_receipts(0));
        assert!(storage.get_chain_state().unwrap().is_some());
    }

    #[test]
    fn test_file_storage_recovery() {
        let temp_dir = tempfile::tempdir().unwrap();

        // First session: create and persist some blocks
        {
            let mut storage = FileBlockStorage::open(temp_dir.path()).unwrap();
            for height in 0..5 {
                let block = make_test_block(height);
                let fin = make_test_finalization(height, &block);
                let receipts = make_test_receipts();
                let state = ChainState::at(
                    Digest::from_header(&block.header),
                    height,
                    block.header.state_root,
                );
                storage
                    .persist_finalized(&block, &fin, &receipts, &state)
                    .unwrap();
            }
        }

        // Second session: recover state
        {
            let storage = FileBlockStorage::open(temp_dir.path()).unwrap();
            let state = storage.recover().unwrap().unwrap();

            assert_eq!(state.height, 4);
            assert!(state.has_genesis);

            // Verify blocks are still there
            for height in 0..5 {
                assert!(storage.has_block(height));
                assert!(storage.has_finalization(height));
                assert!(storage.has_receipts(height));
            }
        }
    }

    #[test]
    fn test_file_storage_recovery_rebuilds_state() {
        let temp_dir = tempfile::tempdir().unwrap();

        // Create blocks but with invalid chain_state.json
        let mut storage = FileBlockStorage::open(temp_dir.path()).unwrap();
        let block = make_test_block(0);
        let fin = make_test_finalization(0, &block);
        let receipts = make_test_receipts();

        storage.put_block(0, &block).unwrap();
        storage.put_finalization(0, &fin).unwrap();
        storage.put_receipts(0, &receipts).unwrap();

        // Write invalid chain state
        let invalid_state = ChainState::at(Digest::new([99u8; 32]), 99, [88u8; 32]);
        storage.put_chain_state(&invalid_state).unwrap();

        // Recovery should rebuild from blocks
        let recovered = storage.recover().unwrap().unwrap();
        assert_eq!(recovered.height, 0);
        assert_eq!(recovered.tip, Digest::from_header(&block.header));
    }

    #[test]
    fn test_file_storage_height_filename_encoding() {
        assert_eq!(FileBlockStorage::height_to_filename(0), "0000000000000000");
        assert_eq!(FileBlockStorage::height_to_filename(255), "00000000000000ff");
        assert_eq!(
            FileBlockStorage::height_to_filename(u64::MAX),
            "ffffffffffffffff"
        );

        assert_eq!(
            FileBlockStorage::filename_to_height("0000000000000000.block"),
            Some(0)
        );
        assert_eq!(
            FileBlockStorage::filename_to_height("00000000000000ff.block"),
            Some(255)
        );
        assert_eq!(
            FileBlockStorage::filename_to_height("ffffffffffffffff.block"),
            Some(u64::MAX)
        );
    }
}
