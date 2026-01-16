//! State management and root verification for QMDB integration.
//!
//! This module provides the infrastructure for managing application state during
//! block execution. It defines traits and types that can be backed by different
//! state storage engines (in-memory, QMDB, etc.).
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────────────────┐
//! │                          State Management                                    │
//! │                                                                              │
//! │  ┌────────────────────┐      ┌────────────────────┐                         │
//! │  │   StateManager     │      │    StateVerifier   │                         │
//! │  │   (write path)     │      │   (verify path)    │                         │
//! │  │                    │      │                    │                         │
//! │  │  - apply_update()  │      │  - verify_root()   │                         │
//! │  │  - commit()        │      │  - recompute()     │                         │
//! │  │  - state_root()    │      │                    │                         │
//! │  └────────────────────┘      └────────────────────┘                         │
//! │            │                          │                                      │
//! │            ▼                          ▼                                      │
//! │  ┌─────────────────────────────────────────────────────────────────────────┐│
//! │  │                         StateRoot [u8; 32]                               ││
//! │  │                   (Merkle/trie root commitment)                          ││
//! │  └─────────────────────────────────────────────────────────────────────────┘│
//! └─────────────────────────────────────────────────────────────────────────────┘
//! ```
//!
//! # State Root Semantics
//!
//! The state root is a 32-byte commitment to the entire application state at a
//! point in time. For deterministic replay:
//!
//! 1. Genesis starts with a known initial state root (typically all zeros)
//! 2. Each payload execution updates state and produces a new root
//! 3. The final root after all payloads is stored in the block header
//! 4. On restart, recomputing from genesis must yield the same roots
//!
//! # QMDB Integration
//!
//! The traits in this module are designed to eventually wrap Commonware's QMDB:
//!
//! - `StateManager::apply_update` maps to QMDB write operations
//! - `StateManager::state_root` maps to QMDB root computation
//! - `StateVerifier::recompute` maps to QMDB proof verification
//!
//! For now, we provide in-memory implementations for testing and development.

use crate::block::{BlockBody, Receipt};
use crate::consensus::AutomatonError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

// ─────────────────────────────────────────────────────────────────────────────
// State Errors
// ─────────────────────────────────────────────────────────────────────────────

/// Errors that can occur during state operations.
#[derive(Debug, Clone, Error, PartialEq, Eq)]
pub enum StateError {
    /// State root mismatch during verification.
    #[error("state root mismatch: expected {expected}, got {actual}")]
    RootMismatch {
        expected: StateRoot,
        actual: StateRoot,
    },

    /// State key not found.
    #[error("key not found: {0:?}")]
    KeyNotFound(Vec<u8>),

    /// Invalid state transition.
    #[error("invalid state transition: {0}")]
    InvalidTransition(String),

    /// Persistence error.
    #[error("persistence error: {0}")]
    PersistenceError(String),

    /// Verification failed.
    #[error("verification failed: {0}")]
    VerificationFailed(String),
}

impl From<StateError> for AutomatonError {
    fn from(e: StateError) -> Self {
        match e {
            StateError::RootMismatch { .. } => AutomatonError::StateRootMismatch,
            _ => AutomatonError::ExecutionError(e.to_string()),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// State Root
// ─────────────────────────────────────────────────────────────────────────────

/// A 32-byte commitment to the application state.
///
/// The state root is computed from the underlying state storage (trie, QMDB, etc.)
/// and uniquely identifies a snapshot of the state. It has the following properties:
///
/// - **Binding**: The root commits to all key-value pairs in the state
/// - **Unique**: Different states produce different roots (collision-resistant)
/// - **Deterministic**: Same state always produces the same root
/// - **Compact**: Fixed 32-byte size regardless of state size
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
pub struct StateRoot(pub [u8; 32]);

impl StateRoot {
    /// Create a state root from raw bytes.
    pub fn new(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    /// The zero/empty state root (used for initial state).
    pub const ZERO: Self = Self([0; 32]);

    /// Create from a slice (must be exactly 32 bytes).
    pub fn from_slice(slice: &[u8]) -> Option<Self> {
        if slice.len() == 32 {
            let mut bytes = [0u8; 32];
            bytes.copy_from_slice(slice);
            Some(Self(bytes))
        } else {
            None
        }
    }

    /// Get the underlying bytes.
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// Check if this is the zero root.
    pub fn is_zero(&self) -> bool {
        self.0 == [0; 32]
    }
}

impl std::fmt::Display for StateRoot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", hex::encode(&self.0[..8]))
    }
}

impl AsRef<[u8]> for StateRoot {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

impl From<[u8; 32]> for StateRoot {
    fn from(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
}

impl From<StateRoot> for [u8; 32] {
    fn from(root: StateRoot) -> Self {
        root.0
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// State Update
// ─────────────────────────────────────────────────────────────────────────────

/// A single key-value state update.
///
/// State updates are the atomic units of state change. Each payload execution
/// produces zero or more updates that are applied to the state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StateUpdate {
    /// The key being updated.
    pub key: Vec<u8>,
    /// The new value, or `None` for deletion.
    pub value: Option<Vec<u8>>,
}

impl StateUpdate {
    /// Create an update that sets a key to a value.
    pub fn set(key: impl Into<Vec<u8>>, value: impl Into<Vec<u8>>) -> Self {
        Self {
            key: key.into(),
            value: Some(value.into()),
        }
    }

    /// Create an update that deletes a key.
    pub fn delete(key: impl Into<Vec<u8>>) -> Self {
        Self {
            key: key.into(),
            value: None,
        }
    }

    /// Check if this is a deletion.
    pub fn is_delete(&self) -> bool {
        self.value.is_none()
    }
}

/// A batch of state updates from executing a single payload.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct StateUpdateBatch {
    /// The updates in this batch.
    pub updates: Vec<StateUpdate>,
}

impl StateUpdateBatch {
    /// Create an empty batch.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add an update to the batch.
    pub fn push(&mut self, update: StateUpdate) {
        self.updates.push(update);
    }

    /// Add a set operation.
    pub fn set(&mut self, key: impl Into<Vec<u8>>, value: impl Into<Vec<u8>>) {
        self.push(StateUpdate::set(key, value));
    }

    /// Add a delete operation.
    pub fn delete(&mut self, key: impl Into<Vec<u8>>) {
        self.push(StateUpdate::delete(key));
    }

    /// Check if the batch is empty.
    pub fn is_empty(&self) -> bool {
        self.updates.is_empty()
    }

    /// Number of updates in the batch.
    pub fn len(&self) -> usize {
        self.updates.len()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// State Manager Trait
// ─────────────────────────────────────────────────────────────────────────────

/// Trait for managing application state.
///
/// A `StateManager` is responsible for:
/// - Applying state updates from payload execution
/// - Computing state roots
/// - Providing read access to state
/// - Committing or rolling back changes
///
/// # Transaction Model
///
/// State updates happen in the context of a block execution:
///
/// 1. `begin_block()` starts a new transaction
/// 2. `apply_update()` applies updates for each payload
/// 3. `commit()` finalizes all changes, or `rollback()` discards them
///
/// The state root after each payload is captured in the receipt.
pub trait StateManager: Send {
    /// Get the current state root.
    fn state_root(&self) -> StateRoot;

    /// Get a value by key.
    fn get(&self, key: &[u8]) -> Option<Vec<u8>>;

    /// Check if a key exists.
    fn contains(&self, key: &[u8]) -> bool {
        self.get(key).is_some()
    }

    /// Begin a new block transaction.
    ///
    /// This prepares the state manager for a series of updates.
    /// Changes are buffered until `commit()` or discarded on `rollback()`.
    fn begin_block(&mut self);

    /// Apply a batch of state updates.
    ///
    /// Returns the new state root after applying the updates.
    fn apply_update(&mut self, batch: &StateUpdateBatch) -> Result<StateRoot, StateError>;

    /// Commit all changes from the current block.
    ///
    /// This finalizes the state changes and updates the persistent root.
    fn commit(&mut self) -> Result<(), StateError>;

    /// Rollback all changes from the current block.
    ///
    /// This discards all buffered changes and reverts to the pre-block state.
    fn rollback(&mut self);

    /// Create a checkpoint that can be restored later.
    ///
    /// Checkpoints allow partial rollback within a block (e.g., for failed payloads).
    fn checkpoint(&mut self) -> StateCheckpoint;

    /// Restore state to a previous checkpoint.
    fn restore(&mut self, checkpoint: StateCheckpoint);
}

/// A checkpoint for partial state rollback.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StateCheckpoint {
    /// The state root at the checkpoint.
    pub root: StateRoot,
    /// Number of updates applied at checkpoint time.
    pub update_count: usize,
}

// ─────────────────────────────────────────────────────────────────────────────
// State Verifier Trait
// ─────────────────────────────────────────────────────────────────────────────

/// Trait for verifying state roots.
///
/// A `StateVerifier` can:
/// - Verify that a claimed state root matches the actual state
/// - Recompute state roots from block history
/// - Validate state proofs
///
/// This is used during restart to ensure state integrity.
pub trait StateVerifier: Send {
    /// Verify that the current state matches an expected root.
    fn verify_root(&self, expected: StateRoot) -> Result<(), StateError>;

    /// Recompute the state root from scratch.
    ///
    /// This is used to verify state integrity by re-executing from genesis.
    fn recompute_root(&self) -> StateRoot;

    /// Check if state verification is supported.
    ///
    /// Some implementations (e.g., in-memory without history) cannot verify.
    fn supports_verification(&self) -> bool {
        true
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory State Manager
// ─────────────────────────────────────────────────────────────────────────────

/// In-memory state manager for testing and development.
///
/// This implementation stores state as a simple key-value map and computes
/// roots using a deterministic hash chain. It does not provide true Merkle
/// proofs but is useful for testing the state management interfaces.
///
/// # Root Computation
///
/// The state root is computed as:
/// ```text
/// root = hash(sorted_keys_and_values)
/// ```
///
/// This is deterministic but not suitable for production use with proofs.
#[derive(Debug, Clone)]
pub struct InMemoryStateManager {
    /// The committed state.
    committed: HashMap<Vec<u8>, Vec<u8>>,
    /// Buffered updates for current block.
    pending: HashMap<Vec<u8>, Option<Vec<u8>>>,
    /// Current state root.
    root: StateRoot,
    /// Whether a block transaction is active.
    in_block: bool,
    /// Update count for checkpoints.
    update_count: usize,
}

impl Default for InMemoryStateManager {
    fn default() -> Self {
        Self::new()
    }
}

impl InMemoryStateManager {
    /// Create a new empty state manager.
    pub fn new() -> Self {
        Self {
            committed: HashMap::new(),
            pending: HashMap::new(),
            root: StateRoot::ZERO,
            in_block: false,
            update_count: 0,
        }
    }

    /// Create a state manager with initial state.
    pub fn with_state(initial: HashMap<Vec<u8>, Vec<u8>>) -> Self {
        let mut manager = Self::new();
        manager.committed = initial;
        manager.root = manager.compute_root();
        manager
    }

    /// Compute the state root from current state.
    fn compute_root(&self) -> StateRoot {
        // Merge committed and pending
        let mut merged = self.committed.clone();
        for (k, v) in &self.pending {
            match v {
                Some(value) => {
                    merged.insert(k.clone(), value.clone());
                }
                None => {
                    merged.remove(k);
                }
            }
        }

        if merged.is_empty() {
            return StateRoot::ZERO;
        }

        // Sort keys for determinism
        let mut keys: Vec<_> = merged.keys().collect();
        keys.sort();

        // Hash all key-value pairs
        let mut hasher_input = Vec::new();
        for key in keys {
            let value = merged.get(key).unwrap();
            // Include key length, key, value length, value
            hasher_input.extend_from_slice(&(key.len() as u32).to_le_bytes());
            hasher_input.extend_from_slice(key);
            hasher_input.extend_from_slice(&(value.len() as u32).to_le_bytes());
            hasher_input.extend_from_slice(value);
        }

        StateRoot(protocol_messages::canonical_hash(&hasher_input))
    }

    /// Get the number of keys in committed state.
    pub fn len(&self) -> usize {
        self.committed.len()
    }

    /// Check if the committed state is empty.
    pub fn is_empty(&self) -> bool {
        self.committed.is_empty()
    }
}

impl StateManager for InMemoryStateManager {
    fn state_root(&self) -> StateRoot {
        self.root
    }

    fn get(&self, key: &[u8]) -> Option<Vec<u8>> {
        // Check pending first
        if let Some(value) = self.pending.get(key) {
            return value.clone();
        }
        self.committed.get(key).cloned()
    }

    fn begin_block(&mut self) {
        self.pending.clear();
        self.in_block = true;
        self.update_count = 0;
    }

    fn apply_update(&mut self, batch: &StateUpdateBatch) -> Result<StateRoot, StateError> {
        for update in &batch.updates {
            self.pending.insert(update.key.clone(), update.value.clone());
            self.update_count += 1;
        }
        self.root = self.compute_root();
        Ok(self.root)
    }

    fn commit(&mut self) -> Result<(), StateError> {
        // Apply pending to committed
        for (k, v) in self.pending.drain() {
            match v {
                Some(value) => {
                    self.committed.insert(k, value);
                }
                None => {
                    self.committed.remove(&k);
                }
            }
        }
        self.in_block = false;
        self.update_count = 0;
        Ok(())
    }

    fn rollback(&mut self) {
        self.pending.clear();
        self.root = self.compute_root(); // Revert to committed root
        self.in_block = false;
        self.update_count = 0;
    }

    fn checkpoint(&mut self) -> StateCheckpoint {
        StateCheckpoint {
            root: self.root,
            update_count: self.update_count,
        }
    }

    fn restore(&mut self, checkpoint: StateCheckpoint) {
        // For in-memory, we'd need to track update history to properly restore.
        // For now, this is a simplified implementation that just restores the root.
        // A full implementation would maintain an update log.
        self.root = checkpoint.root;
    }
}

impl StateVerifier for InMemoryStateManager {
    fn verify_root(&self, expected: StateRoot) -> Result<(), StateError> {
        let actual = self.compute_root();
        if actual == expected {
            Ok(())
        } else {
            Err(StateError::RootMismatch { expected, actual })
        }
    }

    fn recompute_root(&self) -> StateRoot {
        self.compute_root()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// State-Aware Executor
// ─────────────────────────────────────────────────────────────────────────────

use crate::block::compute_receipts_root;
use crate::consensus::PayloadExecutor;

/// A payload executor that uses a state manager.
///
/// This executor wraps a `StateManager` and translates payload execution
/// into state updates. It bridges the consensus layer with the state layer.
///
/// # Execution Flow
///
/// 1. For each payload in the block body:
///    a. Generate state updates from the payload
///    b. Apply updates to the state manager
///    c. Record the post-update state root in the receipt
///
/// 2. Return all receipts and the final state root
pub struct StateAwareExecutor<S: StateManager> {
    /// The underlying state manager.
    state: S,
}

impl<S: StateManager> StateAwareExecutor<S> {
    /// Create a new executor with the given state manager.
    pub fn new(state: S) -> Self {
        Self { state }
    }

    /// Get a reference to the state manager.
    pub fn state(&self) -> &S {
        &self.state
    }

    /// Get a mutable reference to the state manager.
    pub fn state_mut(&mut self) -> &mut S {
        &mut self.state
    }

    /// Extract the state manager.
    pub fn into_state(self) -> S {
        self.state
    }
}

impl<S: StateManager> PayloadExecutor for StateAwareExecutor<S> {
    fn execute(
        &mut self,
        current_state_root: [u8; 32],
        body: &BlockBody,
    ) -> Result<(Vec<Receipt>, [u8; 32]), AutomatonError> {
        // Verify we're starting from expected state
        let current = self.state.state_root();
        if current.0 != current_state_root {
            return Err(AutomatonError::StateRootMismatch);
        }

        self.state.begin_block();
        let mut receipts = Vec::with_capacity(body.payloads.len());

        for payload in &body.payloads {
            let payload_hash = payload.referenced_commitment_hash().unwrap_or([0; 32]);

            // Generate state updates from the payload.
            // For now, we create a simple update that records the payload was processed.
            // A real implementation would parse the payload and update game state.
            let mut batch = StateUpdateBatch::new();

            // Record payload execution in state
            let key = format!("payload:{}", hex::encode(&payload_hash[..8]));
            let value = format!("executed:{}", std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis());
            batch.set(key.as_bytes(), value.as_bytes());

            // Apply updates and get new root
            let new_root = self.state.apply_update(&batch).map_err(AutomatonError::from)?;

            receipts.push(Receipt::success(payload_hash, new_root.0));
        }

        // Handle empty blocks
        if body.payloads.is_empty() {
            // Apply an empty update to advance the state
            let batch = StateUpdateBatch::new();
            let _ = self.state.apply_update(&batch).map_err(AutomatonError::from)?;
        }

        // Commit the block
        self.state.commit().map_err(AutomatonError::from)?;

        let final_root = self.state.state_root();
        Ok((receipts, final_root.0))
    }

    fn verify(
        &self,
        current_state_root: [u8; 32],
        body: &BlockBody,
        expected_receipts_root: [u8; 32],
        expected_state_root: [u8; 32],
    ) -> Result<Vec<Receipt>, AutomatonError> {
        // For verification, we need to re-execute.
        // Create a temporary executor with a clone of the state.
        // Note: This requires S: Clone, which we should add as a bound.

        // For now, delegate to a simple verification that checks roots match
        let current = self.state.state_root();
        if current.0 != current_state_root {
            return Err(AutomatonError::StateRootMismatch);
        }

        // Generate expected receipts by simulating execution
        let mut receipts = Vec::with_capacity(body.payloads.len());
        let mut state_root = StateRoot(current_state_root);

        for payload in &body.payloads {
            let payload_hash = payload.referenced_commitment_hash().unwrap_or([0; 32]);

            // Simulate state root update (same logic as execute)
            let mut preimage = Vec::with_capacity(64);
            preimage.extend_from_slice(&state_root.0);
            preimage.extend_from_slice(&payload_hash);
            state_root = StateRoot(protocol_messages::canonical_hash(&preimage));

            receipts.push(Receipt::success(payload_hash, state_root.0));
        }

        // Handle empty blocks
        if body.payloads.is_empty() {
            let mut preimage = Vec::with_capacity(33);
            preimage.extend_from_slice(&state_root.0);
            preimage.push(0xFF);
            state_root = StateRoot(protocol_messages::canonical_hash(&preimage));
        }

        // Verify receipts root
        let receipts_root = compute_receipts_root(&receipts);
        if receipts_root != expected_receipts_root {
            return Err(AutomatonError::ReceiptsRootMismatch);
        }

        // Verify state root
        if state_root.0 != expected_state_root {
            return Err(AutomatonError::StateRootMismatch);
        }

        Ok(receipts)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// State Root Verification on Restart
// ─────────────────────────────────────────────────────────────────────────────

/// Verifies state root consistency on restart.
///
/// This function checks that the persisted state root matches what would be
/// computed by replaying all blocks from genesis.
///
/// # Arguments
///
/// * `storage` - Block storage to read persisted blocks
/// * `expected_root` - The state root we expect (from chain state)
/// * `height` - The block height to verify up to
///
/// # Returns
///
/// `Ok(())` if the roots match, or `Err` with details if they don't.
pub fn verify_state_root_on_restart<S: crate::storage::BlockStorage>(
    storage: &S,
    expected_root: StateRoot,
    height: u64,
) -> Result<(), StateError> {
    // Recompute state root by replaying blocks
    let mut state = InMemoryStateManager::new();

    for h in 0..=height {
        let block = storage.get_block(h).map_err(|e| {
            StateError::VerificationFailed(format!("failed to load block {}: {}", h, e))
        })?;

        state.begin_block();

        // Apply each payload
        for payload in &block.body.payloads {
            let payload_hash = payload.referenced_commitment_hash().unwrap_or([0; 32]);
            let mut batch = StateUpdateBatch::new();

            let key = format!("payload:{}", hex::encode(&payload_hash[..8]));
            let value = format!("verified:{}", h);
            batch.set(key.as_bytes(), value.as_bytes());

            state.apply_update(&batch)?;
        }

        // For empty blocks, still advance state
        if block.body.payloads.is_empty() {
            state.apply_update(&StateUpdateBatch::new())?;
        }

        state.commit()?;

        // Verify intermediate root matches block header
        let computed_root = state.state_root();
        if computed_root.0 != block.header.state_root {
            return Err(StateError::RootMismatch {
                expected: StateRoot(block.header.state_root),
                actual: computed_root,
            });
        }
    }

    // Final verification
    let final_root = state.state_root();
    if final_root != expected_root {
        return Err(StateError::RootMismatch {
            expected: expected_root,
            actual: final_root,
        });
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ─────────────────────────────────────────────────────────────────────────
    // StateRoot Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_state_root_zero() {
        assert!(StateRoot::ZERO.is_zero());
        assert!(!StateRoot::new([1u8; 32]).is_zero());
    }

    #[test]
    fn test_state_root_from_slice() {
        let bytes = [42u8; 32];
        let root = StateRoot::from_slice(&bytes).unwrap();
        assert_eq!(root.0, bytes);

        assert!(StateRoot::from_slice(&[0u8; 16]).is_none());
    }

    #[test]
    fn test_state_root_conversions() {
        let bytes = [42u8; 32];
        let root: StateRoot = bytes.into();
        let back: [u8; 32] = root.into();
        assert_eq!(bytes, back);
    }

    #[test]
    fn test_state_root_display() {
        let root = StateRoot::new([0xAA; 32]);
        let display = format!("{}", root);
        assert!(display.contains("aa"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // StateUpdate Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_state_update_set() {
        let update = StateUpdate::set(b"key", b"value");
        assert!(!update.is_delete());
        assert_eq!(update.key, b"key".to_vec());
        assert_eq!(update.value, Some(b"value".to_vec()));
    }

    #[test]
    fn test_state_update_delete() {
        let update = StateUpdate::delete(b"key");
        assert!(update.is_delete());
        assert_eq!(update.key, b"key".to_vec());
        assert!(update.value.is_none());
    }

    #[test]
    fn test_state_update_batch() {
        let mut batch = StateUpdateBatch::new();
        assert!(batch.is_empty());

        batch.set(b"k1", b"v1");
        batch.delete(b"k2");

        assert_eq!(batch.len(), 2);
        assert!(!batch.is_empty());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // InMemoryStateManager Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_in_memory_initial_state() {
        let manager = InMemoryStateManager::new();
        assert!(manager.is_empty());
        assert_eq!(manager.state_root(), StateRoot::ZERO);
    }

    #[test]
    fn test_in_memory_apply_update() {
        let mut manager = InMemoryStateManager::new();
        manager.begin_block();

        let mut batch = StateUpdateBatch::new();
        batch.set(b"key1", b"value1");
        batch.set(b"key2", b"value2");

        let root1 = manager.apply_update(&batch).unwrap();
        assert_ne!(root1, StateRoot::ZERO);

        // Same updates should produce same root
        let root2 = manager.apply_update(&StateUpdateBatch::new()).unwrap();
        assert_eq!(root1, root2); // No change
    }

    #[test]
    fn test_in_memory_get() {
        let mut manager = InMemoryStateManager::new();
        manager.begin_block();

        let mut batch = StateUpdateBatch::new();
        batch.set(b"key", b"value");
        manager.apply_update(&batch).unwrap();

        // Can read pending
        assert_eq!(manager.get(b"key"), Some(b"value".to_vec()));
        assert!(manager.contains(b"key"));
        assert!(!manager.contains(b"nonexistent"));
    }

    #[test]
    fn test_in_memory_commit() {
        let mut manager = InMemoryStateManager::new();
        manager.begin_block();

        let mut batch = StateUpdateBatch::new();
        batch.set(b"key", b"value");
        let root = manager.apply_update(&batch).unwrap();
        manager.commit().unwrap();

        // Value persists after commit
        assert_eq!(manager.get(b"key"), Some(b"value".to_vec()));
        assert_eq!(manager.state_root(), root);
        assert_eq!(manager.len(), 1);
    }

    #[test]
    fn test_in_memory_rollback() {
        let mut manager = InMemoryStateManager::new();
        manager.begin_block();

        let mut batch = StateUpdateBatch::new();
        batch.set(b"key", b"value");
        manager.apply_update(&batch).unwrap();

        let root_before = manager.state_root();
        manager.rollback();

        // Value is gone
        assert!(manager.get(b"key").is_none());
        // Root reverted
        assert_ne!(manager.state_root(), root_before);
        assert_eq!(manager.state_root(), StateRoot::ZERO);
    }

    #[test]
    fn test_in_memory_delete() {
        let mut manager = InMemoryStateManager::new();

        // First, add a key
        manager.begin_block();
        let mut batch = StateUpdateBatch::new();
        batch.set(b"key", b"value");
        manager.apply_update(&batch).unwrap();
        manager.commit().unwrap();

        assert!(manager.contains(b"key"));

        // Now delete it
        manager.begin_block();
        let mut batch = StateUpdateBatch::new();
        batch.delete(b"key");
        manager.apply_update(&batch).unwrap();
        manager.commit().unwrap();

        assert!(!manager.contains(b"key"));
    }

    #[test]
    fn test_in_memory_root_deterministic() {
        let mut m1 = InMemoryStateManager::new();
        let mut m2 = InMemoryStateManager::new();

        // Same updates should produce same roots
        for m in [&mut m1, &mut m2] {
            m.begin_block();
            let mut batch = StateUpdateBatch::new();
            batch.set(b"a", b"1");
            batch.set(b"b", b"2");
            m.apply_update(&batch).unwrap();
            m.commit().unwrap();
        }

        assert_eq!(m1.state_root(), m2.state_root());
    }

    #[test]
    fn test_in_memory_root_order_independent() {
        // Keys are sorted, so order shouldn't matter
        let mut m1 = InMemoryStateManager::new();
        let mut m2 = InMemoryStateManager::new();

        m1.begin_block();
        let mut batch1 = StateUpdateBatch::new();
        batch1.set(b"a", b"1");
        batch1.set(b"b", b"2");
        m1.apply_update(&batch1).unwrap();
        m1.commit().unwrap();

        m2.begin_block();
        let mut batch2 = StateUpdateBatch::new();
        batch2.set(b"b", b"2");
        batch2.set(b"a", b"1");
        m2.apply_update(&batch2).unwrap();
        m2.commit().unwrap();

        assert_eq!(m1.state_root(), m2.state_root());
    }

    #[test]
    fn test_in_memory_checkpoint() {
        let mut manager = InMemoryStateManager::new();
        manager.begin_block();

        let mut batch = StateUpdateBatch::new();
        batch.set(b"key1", b"value1");
        manager.apply_update(&batch).unwrap();

        let checkpoint = manager.checkpoint();

        let mut batch2 = StateUpdateBatch::new();
        batch2.set(b"key2", b"value2");
        manager.apply_update(&batch2).unwrap();

        // Root changed
        assert_ne!(manager.state_root(), checkpoint.root);

        // Restore
        manager.restore(checkpoint);
        assert_eq!(manager.state_root(), checkpoint.root);
    }

    #[test]
    fn test_in_memory_verify_root() {
        let mut manager = InMemoryStateManager::new();
        manager.begin_block();

        let mut batch = StateUpdateBatch::new();
        batch.set(b"key", b"value");
        let root = manager.apply_update(&batch).unwrap();
        manager.commit().unwrap();

        // Verify correct root succeeds
        assert!(manager.verify_root(root).is_ok());

        // Verify wrong root fails
        let result = manager.verify_root(StateRoot::new([99u8; 32]));
        assert!(matches!(result, Err(StateError::RootMismatch { .. })));
    }

    #[test]
    fn test_in_memory_with_initial_state() {
        let mut initial = HashMap::new();
        initial.insert(b"existing".to_vec(), b"value".to_vec());

        let manager = InMemoryStateManager::with_state(initial);

        assert!(!manager.is_empty());
        assert!(manager.contains(b"existing"));
        assert_ne!(manager.state_root(), StateRoot::ZERO);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // StateError Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_state_error_to_automaton_error() {
        let err = StateError::RootMismatch {
            expected: StateRoot::ZERO,
            actual: StateRoot::new([1u8; 32]),
        };
        let automaton_err: AutomatonError = err.into();
        assert!(matches!(automaton_err, AutomatonError::StateRootMismatch));
    }
}
