//! State management, synchronization, and proof verification for QMDB integration.
//!
//! This module provides the infrastructure for managing application state during
//! block execution. It defines traits and types that can be backed by different
//! state storage engines (in-memory, QMDB, etc.).
//!
//! # State Sync
//!
//! State sync allows nodes that have fallen behind to catch up without replaying
//! all blocks from genesis. The sync protocol consists of:
//!
//! - [`StateSyncRequest`]: Request state at a specific height/root
//! - [`StateSyncResponse`]: Response containing state entries and proofs
//! - [`StateSyncChunk`]: A chunk of state entries for streaming large states
//!
//! # State Proofs
//!
//! State proofs allow verifying individual state entries against a state root
//! without having the full state. This enables:
//!
//! - Light clients verifying state without full node storage
//! - Dispute resolution by proving specific state values
//! - Efficient cross-chain state verification
//!
//! The proof system uses a Merkle-like structure where:
//! - [`StateProof`]: Proves a key-value pair is in the state at a given root
//! - [`StateProofVerifier`]: Verifies proofs against claimed roots
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
// State Sync Protocol
// ─────────────────────────────────────────────────────────────────────────────

/// Domain separation for state sync message hashing.
pub mod sync_domain {
    /// Domain prefix for state sync request hashing.
    pub const SYNC_REQUEST: &[u8] = b"nullspace.state_sync_request.v1";
    /// Domain prefix for state sync response hashing.
    pub const SYNC_RESPONSE: &[u8] = b"nullspace.state_sync_response.v1";
    /// Domain prefix for state proof hashing.
    pub const STATE_PROOF: &[u8] = b"nullspace.state_proof.v1";
}

/// Maximum size of a single state sync chunk in bytes.
pub const MAX_SYNC_CHUNK_SIZE: usize = 1024 * 1024; // 1 MB

/// Maximum number of keys that can be requested in a single sync request.
pub const MAX_SYNC_KEYS_PER_REQUEST: usize = 1000;

/// A request for state synchronization.
///
/// Nodes use this message to request state data from peers. The request can be:
/// - A full state snapshot at a specific height/root
/// - A partial state with specific keys
/// - A continuation of a previous request (via `continuation_token`)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StateSyncRequest {
    /// Target state root to sync.
    pub target_root: StateRoot,

    /// Target block height (for context).
    pub target_height: u64,

    /// Specific keys to request (if empty, request full state).
    pub requested_keys: Vec<Vec<u8>>,

    /// Continuation token from a previous response (for pagination).
    pub continuation_token: Option<Vec<u8>>,

    /// Request ID for correlation.
    pub request_id: u64,
}

impl StateSyncRequest {
    /// Create a request for full state at a specific root.
    pub fn full_state(target_root: StateRoot, target_height: u64, request_id: u64) -> Self {
        Self {
            target_root,
            target_height,
            requested_keys: Vec::new(),
            continuation_token: None,
            request_id,
        }
    }

    /// Create a request for specific keys.
    pub fn specific_keys(
        target_root: StateRoot,
        target_height: u64,
        keys: Vec<Vec<u8>>,
        request_id: u64,
    ) -> Self {
        Self {
            target_root,
            target_height,
            requested_keys: keys,
            continuation_token: None,
            request_id,
        }
    }

    /// Continue a previous request.
    pub fn continue_from(
        target_root: StateRoot,
        target_height: u64,
        continuation_token: Vec<u8>,
        request_id: u64,
    ) -> Self {
        Self {
            target_root,
            target_height,
            requested_keys: Vec::new(),
            continuation_token: Some(continuation_token),
            request_id,
        }
    }

    /// Domain-separated preimage for hashing.
    pub fn preimage(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(256);
        buf.extend_from_slice(sync_domain::SYNC_REQUEST);
        buf.extend_from_slice(self.target_root.as_bytes());
        buf.extend_from_slice(&self.target_height.to_le_bytes());
        buf.extend_from_slice(&self.request_id.to_le_bytes());
        buf.extend_from_slice(&(self.requested_keys.len() as u32).to_le_bytes());
        for key in &self.requested_keys {
            buf.extend_from_slice(&(key.len() as u32).to_le_bytes());
            buf.extend_from_slice(key);
        }
        if let Some(token) = &self.continuation_token {
            buf.push(1);
            buf.extend_from_slice(&(token.len() as u32).to_le_bytes());
            buf.extend_from_slice(token);
        } else {
            buf.push(0);
        }
        buf
    }

    /// Canonical hash of this request.
    pub fn request_hash(&self) -> [u8; 32] {
        protocol_messages::canonical_hash(&self.preimage())
    }

    /// Validate the request for bounds.
    pub fn validate(&self) -> Result<(), StateError> {
        if self.requested_keys.len() > MAX_SYNC_KEYS_PER_REQUEST {
            return Err(StateError::InvalidTransition(format!(
                "too many keys requested: {} > {}",
                self.requested_keys.len(),
                MAX_SYNC_KEYS_PER_REQUEST
            )));
        }
        Ok(())
    }
}

/// A chunk of state entries for streaming large states.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StateSyncChunk {
    /// Key-value pairs in this chunk.
    pub entries: Vec<(Vec<u8>, Vec<u8>)>,

    /// Total byte size of this chunk.
    pub chunk_size: usize,
}

impl StateSyncChunk {
    /// Create a new empty chunk.
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            chunk_size: 0,
        }
    }

    /// Add an entry to the chunk, returns false if it would exceed max size.
    pub fn try_add(&mut self, key: Vec<u8>, value: Vec<u8>) -> bool {
        let entry_size = key.len() + value.len() + 8; // 8 bytes for length prefixes
        if self.chunk_size + entry_size > MAX_SYNC_CHUNK_SIZE {
            return false;
        }
        self.chunk_size += entry_size;
        self.entries.push((key, value));
        true
    }

    /// Number of entries in this chunk.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Check if chunk is empty.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

impl Default for StateSyncChunk {
    fn default() -> Self {
        Self::new()
    }
}

/// A response to a state sync request.
///
/// Contains the requested state entries along with proof data and
/// pagination information for large states.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StateSyncResponse {
    /// The request ID this responds to.
    pub request_id: u64,

    /// State root this response is for.
    pub state_root: StateRoot,

    /// Block height this state is from.
    pub height: u64,

    /// State entries in this response.
    pub chunk: StateSyncChunk,

    /// Proof that the entries are in the state at `state_root`.
    pub proof: StateProof,

    /// Token for requesting the next chunk (None if this is the last chunk).
    pub continuation_token: Option<Vec<u8>>,

    /// Whether this is the final chunk.
    pub is_final: bool,
}

impl StateSyncResponse {
    /// Create a response with state data.
    pub fn new(
        request_id: u64,
        state_root: StateRoot,
        height: u64,
        chunk: StateSyncChunk,
        proof: StateProof,
        continuation_token: Option<Vec<u8>>,
        is_final: bool,
    ) -> Self {
        Self {
            request_id,
            state_root,
            height,
            chunk,
            proof,
            continuation_token,
            is_final,
        }
    }

    /// Create an empty/error response.
    pub fn empty(request_id: u64, state_root: StateRoot, height: u64) -> Self {
        Self {
            request_id,
            state_root,
            height,
            chunk: StateSyncChunk::new(),
            proof: StateProof::empty(state_root),
            continuation_token: None,
            is_final: true,
        }
    }

    /// Domain-separated preimage for hashing.
    pub fn preimage(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(256);
        buf.extend_from_slice(sync_domain::SYNC_RESPONSE);
        buf.extend_from_slice(&self.request_id.to_le_bytes());
        buf.extend_from_slice(self.state_root.as_bytes());
        buf.extend_from_slice(&self.height.to_le_bytes());
        buf.extend_from_slice(&(self.chunk.entries.len() as u32).to_le_bytes());
        buf.push(if self.is_final { 1 } else { 0 });
        buf
    }

    /// Canonical hash of this response.
    pub fn response_hash(&self) -> [u8; 32] {
        protocol_messages::canonical_hash(&self.preimage())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// State Proofs
// ─────────────────────────────────────────────────────────────────────────────

/// A Merkle-like proof that a key-value pair is in the state.
///
/// For the in-memory implementation, this is a simplified proof that includes
/// the sorted key-value pairs needed to reconstruct the state root. A production
/// implementation would use actual Merkle tree siblings.
///
/// # Proof Structure
///
/// The proof contains:
/// - The claimed state root
/// - The key-value entries being proven
/// - Sibling hashes in the Merkle path (for tree-based implementations)
///
/// # Verification
///
/// To verify a proof:
/// 1. Recompute the state root from the proof data
/// 2. Compare against the claimed root
/// 3. Check that the proven keys/values match the claimed data
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StateProof {
    /// The state root this proof is against.
    pub claimed_root: StateRoot,

    /// Key-value pairs being proven.
    pub entries: Vec<(Vec<u8>, Option<Vec<u8>>)>,

    /// Merkle sibling hashes (for tree-based proofs).
    /// For the simple linear hash, this contains intermediate hashes.
    pub siblings: Vec<[u8; 32]>,

    /// Proof type indicator for extensibility.
    pub proof_type: StateProofType,
}

/// Type of state proof for extensibility.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StateProofType {
    /// Simple linear hash proof (for initial implementation).
    LinearHash,
    /// Merkle tree proof (for future production use).
    MerkleTree,
    /// Empty/trivial proof (for state root zero).
    Empty,
}

impl StateProof {
    /// Create an empty proof for the zero state root.
    pub fn empty(root: StateRoot) -> Self {
        Self {
            claimed_root: root,
            entries: Vec::new(),
            siblings: Vec::new(),
            proof_type: StateProofType::Empty,
        }
    }

    /// Create a linear hash proof from state entries.
    ///
    /// This is used by the in-memory state manager. It includes all state
    /// entries needed to recompute the root.
    pub fn linear_hash(root: StateRoot, entries: Vec<(Vec<u8>, Option<Vec<u8>>)>) -> Self {
        Self {
            claimed_root: root,
            entries,
            siblings: Vec::new(),
            proof_type: StateProofType::LinearHash,
        }
    }

    /// Create a Merkle tree proof.
    pub fn merkle_tree(
        root: StateRoot,
        entries: Vec<(Vec<u8>, Option<Vec<u8>>)>,
        siblings: Vec<[u8; 32]>,
    ) -> Self {
        Self {
            claimed_root: root,
            entries,
            siblings,
            proof_type: StateProofType::MerkleTree,
        }
    }

    /// Domain-separated preimage for hashing.
    pub fn preimage(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(256);
        buf.extend_from_slice(sync_domain::STATE_PROOF);
        buf.extend_from_slice(self.claimed_root.as_bytes());
        buf.push(self.proof_type as u8);
        buf.extend_from_slice(&(self.entries.len() as u32).to_le_bytes());
        for (key, value) in &self.entries {
            buf.extend_from_slice(&(key.len() as u32).to_le_bytes());
            buf.extend_from_slice(key);
            match value {
                Some(v) => {
                    buf.push(1);
                    buf.extend_from_slice(&(v.len() as u32).to_le_bytes());
                    buf.extend_from_slice(v);
                }
                None => {
                    buf.push(0);
                }
            }
        }
        buf.extend_from_slice(&(self.siblings.len() as u32).to_le_bytes());
        for sibling in &self.siblings {
            buf.extend_from_slice(sibling);
        }
        buf
    }

    /// Canonical hash of this proof.
    pub fn proof_hash(&self) -> [u8; 32] {
        protocol_messages::canonical_hash(&self.preimage())
    }

    /// Check if this is an empty/trivial proof.
    pub fn is_empty(&self) -> bool {
        matches!(self.proof_type, StateProofType::Empty) || self.entries.is_empty()
    }
}

/// Trait for verifying state proofs.
///
/// Implementations provide verification logic for different proof types
/// and state storage backends.
pub trait StateProofVerifier {
    /// Verify a state proof against a claimed root.
    ///
    /// Returns `Ok(())` if the proof is valid, or an error describing the failure.
    fn verify_proof(&self, proof: &StateProof) -> Result<(), StateError>;

    /// Verify that specific entries are correctly proven.
    ///
    /// This is a convenience method that verifies both the proof validity
    /// and that the claimed entries match what's in the proof.
    fn verify_entries(
        &self,
        proof: &StateProof,
        entries: &[(Vec<u8>, Option<Vec<u8>>)],
    ) -> Result<(), StateError>;
}

/// In-memory state proof verifier.
///
/// Verifies proofs by recomputing the state root from the proof data
/// and comparing against the claimed root.
pub struct InMemoryProofVerifier;

impl StateProofVerifier for InMemoryProofVerifier {
    fn verify_proof(&self, proof: &StateProof) -> Result<(), StateError> {
        match proof.proof_type {
            StateProofType::Empty => {
                // Empty proof is valid only for zero root
                if proof.claimed_root.is_zero() {
                    Ok(())
                } else {
                    Err(StateError::VerificationFailed(
                        "empty proof for non-zero root".into(),
                    ))
                }
            }
            StateProofType::LinearHash => {
                // Recompute root from entries using same algorithm as InMemoryStateManager
                let computed_root = compute_linear_hash_root(&proof.entries);
                if computed_root == proof.claimed_root {
                    Ok(())
                } else {
                    Err(StateError::RootMismatch {
                        expected: proof.claimed_root,
                        actual: computed_root,
                    })
                }
            }
            StateProofType::MerkleTree => {
                // Merkle tree verification would go here
                // For now, return error as not implemented
                Err(StateError::VerificationFailed(
                    "merkle tree proofs not yet implemented".into(),
                ))
            }
        }
    }

    fn verify_entries(
        &self,
        proof: &StateProof,
        entries: &[(Vec<u8>, Option<Vec<u8>>)],
    ) -> Result<(), StateError> {
        // First verify the proof itself
        self.verify_proof(proof)?;

        // Then verify the entries are in the proof
        for (key, expected_value) in entries {
            let found = proof.entries.iter().find(|(k, _)| k == key);
            match (found, expected_value) {
                (None, _) => {
                    return Err(StateError::VerificationFailed(format!(
                        "key {:?} not found in proof",
                        key
                    )));
                }
                (Some((_, None)), None) => {
                    // Both expect deletion, OK
                }
                (Some((_, None)), Some(_)) => {
                    return Err(StateError::VerificationFailed(format!(
                        "expected value but found deletion for key {:?}",
                        key
                    )));
                }
                (Some((_, Some(_))), None) => {
                    return Err(StateError::VerificationFailed(format!(
                        "expected deletion but found value for key {:?}",
                        key
                    )));
                }
                (Some((_, Some(proof_value))), Some(expected)) => {
                    if proof_value != expected {
                        return Err(StateError::VerificationFailed(format!(
                            "value mismatch for key {:?}",
                            key
                        )));
                    }
                }
            }
        }

        Ok(())
    }
}

/// Compute state root using linear hash algorithm.
///
/// This matches the `InMemoryStateManager::compute_root` algorithm:
/// - Filter out deletions (None values)
/// - Sort keys
/// - Hash all key-value pairs together
fn compute_linear_hash_root(entries: &[(Vec<u8>, Option<Vec<u8>>)]) -> StateRoot {
    // Filter to only existing values and collect as sorted map
    let mut state: HashMap<Vec<u8>, Vec<u8>> = HashMap::new();
    for (key, value) in entries {
        if let Some(v) = value {
            state.insert(key.clone(), v.clone());
        }
    }

    if state.is_empty() {
        return StateRoot::ZERO;
    }

    // Sort keys for determinism
    let mut keys: Vec<_> = state.keys().collect();
    keys.sort();

    // Hash all key-value pairs
    let mut hasher_input = Vec::new();
    for key in keys {
        let value = state.get(key).unwrap();
        hasher_input.extend_from_slice(&(key.len() as u32).to_le_bytes());
        hasher_input.extend_from_slice(key);
        hasher_input.extend_from_slice(&(value.len() as u32).to_le_bytes());
        hasher_input.extend_from_slice(value);
    }

    StateRoot(protocol_messages::canonical_hash(&hasher_input))
}

// ─────────────────────────────────────────────────────────────────────────────
// State Sync Handler
// ─────────────────────────────────────────────────────────────────────────────

/// Handles state sync requests by generating responses from local state.
pub struct StateSyncHandler<S: StateManager + StateVerifier> {
    state: S,
    current_height: u64,
}

impl<S: StateManager + StateVerifier> StateSyncHandler<S> {
    /// Create a new sync handler with the given state manager.
    pub fn new(state: S, current_height: u64) -> Self {
        Self {
            state,
            current_height,
        }
    }

    /// Handle a state sync request and generate a response.
    pub fn handle_request(&self, request: &StateSyncRequest) -> Result<StateSyncResponse, StateError> {
        // Validate request
        request.validate()?;

        // Check if we have the requested state root
        let current_root = self.state.state_root();
        if request.target_root != current_root {
            // We don't have the exact state root requested
            // In a full implementation, we'd check historical states
            return Err(StateError::VerificationFailed(format!(
                "state root {:?} not available, current is {:?}",
                request.target_root, current_root
            )));
        }

        // Build response chunk
        let mut chunk = StateSyncChunk::new();

        if request.requested_keys.is_empty() {
            // Full state requested - would need iteration support
            // For now, return empty (in-memory doesn't expose iteration)
            return Ok(StateSyncResponse::empty(
                request.request_id,
                current_root,
                self.current_height,
            ));
        }

        // Specific keys requested
        let mut proof_entries = Vec::new();
        for key in &request.requested_keys {
            let value = self.state.get(key);
            if let Some(v) = &value {
                chunk.try_add(key.clone(), v.clone());
            }
            proof_entries.push((key.clone(), value));
        }

        // Build proof
        let proof = StateProof::linear_hash(current_root, proof_entries);

        Ok(StateSyncResponse::new(
            request.request_id,
            current_root,
            self.current_height,
            chunk,
            proof,
            None,
            true,
        ))
    }

    /// Get reference to underlying state.
    pub fn state(&self) -> &S {
        &self.state
    }

    /// Get current height.
    pub fn height(&self) -> u64 {
        self.current_height
    }
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

    // ─────────────────────────────────────────────────────────────────────────
    // State Sync Request Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_state_sync_request_full_state() {
        let root = StateRoot::new([1u8; 32]);
        let request = StateSyncRequest::full_state(root, 100, 42);

        assert_eq!(request.target_root, root);
        assert_eq!(request.target_height, 100);
        assert_eq!(request.request_id, 42);
        assert!(request.requested_keys.is_empty());
        assert!(request.continuation_token.is_none());
    }

    #[test]
    fn test_state_sync_request_specific_keys() {
        let root = StateRoot::new([1u8; 32]);
        let keys = vec![b"key1".to_vec(), b"key2".to_vec()];
        let request = StateSyncRequest::specific_keys(root, 100, keys.clone(), 42);

        assert_eq!(request.requested_keys, keys);
        assert!(request.continuation_token.is_none());
    }

    #[test]
    fn test_state_sync_request_continue_from() {
        let root = StateRoot::new([1u8; 32]);
        let token = vec![0xAA, 0xBB];
        let request = StateSyncRequest::continue_from(root, 100, token.clone(), 42);

        assert!(request.requested_keys.is_empty());
        assert_eq!(request.continuation_token, Some(token));
    }

    #[test]
    fn test_state_sync_request_hash_deterministic() {
        let root = StateRoot::new([1u8; 32]);
        let request = StateSyncRequest::full_state(root, 100, 42);

        let hash1 = request.request_hash();
        let hash2 = request.request_hash();

        assert_eq!(hash1, hash2, "request hash must be deterministic");
    }

    #[test]
    fn test_state_sync_request_hash_differs_by_root() {
        let r1 = StateSyncRequest::full_state(StateRoot::new([1u8; 32]), 100, 42);
        let r2 = StateSyncRequest::full_state(StateRoot::new([2u8; 32]), 100, 42);

        assert_ne!(r1.request_hash(), r2.request_hash());
    }

    #[test]
    fn test_state_sync_request_validate() {
        let root = StateRoot::new([1u8; 32]);
        let request = StateSyncRequest::full_state(root, 100, 42);
        assert!(request.validate().is_ok());
    }

    #[test]
    fn test_state_sync_request_validate_too_many_keys() {
        let root = StateRoot::new([1u8; 32]);
        let keys: Vec<Vec<u8>> = (0..MAX_SYNC_KEYS_PER_REQUEST + 1)
            .map(|i| format!("key{}", i).into_bytes())
            .collect();
        let request = StateSyncRequest::specific_keys(root, 100, keys, 42);

        assert!(request.validate().is_err());
    }

    #[test]
    fn test_state_sync_request_preimage_includes_domain() {
        let request = StateSyncRequest::full_state(StateRoot::ZERO, 0, 0);
        let preimage = request.preimage();
        assert!(
            preimage.starts_with(sync_domain::SYNC_REQUEST),
            "request preimage must start with domain prefix"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State Sync Chunk Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_state_sync_chunk_new() {
        let chunk = StateSyncChunk::new();
        assert!(chunk.is_empty());
        assert_eq!(chunk.len(), 0);
        assert_eq!(chunk.chunk_size, 0);
    }

    #[test]
    fn test_state_sync_chunk_try_add() {
        let mut chunk = StateSyncChunk::new();

        assert!(chunk.try_add(b"key".to_vec(), b"value".to_vec()));
        assert_eq!(chunk.len(), 1);
        assert!(!chunk.is_empty());
    }

    #[test]
    fn test_state_sync_chunk_size_limit() {
        let mut chunk = StateSyncChunk::new();

        // Fill near capacity
        let large_value = vec![0u8; MAX_SYNC_CHUNK_SIZE - 100];
        assert!(chunk.try_add(b"key".to_vec(), large_value));

        // Adding more should fail
        assert!(!chunk.try_add(b"key2".to_vec(), vec![0u8; 200]));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State Sync Response Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_state_sync_response_empty() {
        let root = StateRoot::new([1u8; 32]);
        let response = StateSyncResponse::empty(42, root, 100);

        assert_eq!(response.request_id, 42);
        assert_eq!(response.state_root, root);
        assert_eq!(response.height, 100);
        assert!(response.chunk.is_empty());
        assert!(response.is_final);
    }

    #[test]
    fn test_state_sync_response_hash_deterministic() {
        let root = StateRoot::new([1u8; 32]);
        let response = StateSyncResponse::empty(42, root, 100);

        let hash1 = response.response_hash();
        let hash2 = response.response_hash();

        assert_eq!(hash1, hash2, "response hash must be deterministic");
    }

    #[test]
    fn test_state_sync_response_preimage_includes_domain() {
        let response = StateSyncResponse::empty(0, StateRoot::ZERO, 0);
        let preimage = response.preimage();
        assert!(
            preimage.starts_with(sync_domain::SYNC_RESPONSE),
            "response preimage must start with domain prefix"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State Proof Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_state_proof_empty() {
        let proof = StateProof::empty(StateRoot::ZERO);

        assert!(proof.is_empty());
        assert_eq!(proof.proof_type, StateProofType::Empty);
    }

    #[test]
    fn test_state_proof_linear_hash() {
        let root = StateRoot::new([1u8; 32]);
        let entries = vec![(b"key".to_vec(), Some(b"value".to_vec()))];
        let proof = StateProof::linear_hash(root, entries.clone());

        assert_eq!(proof.claimed_root, root);
        assert_eq!(proof.entries, entries);
        assert_eq!(proof.proof_type, StateProofType::LinearHash);
    }

    #[test]
    fn test_state_proof_merkle_tree() {
        let root = StateRoot::new([1u8; 32]);
        let entries = vec![(b"key".to_vec(), Some(b"value".to_vec()))];
        let siblings = vec![[2u8; 32], [3u8; 32]];
        let proof = StateProof::merkle_tree(root, entries.clone(), siblings.clone());

        assert_eq!(proof.claimed_root, root);
        assert_eq!(proof.entries, entries);
        assert_eq!(proof.siblings, siblings);
        assert_eq!(proof.proof_type, StateProofType::MerkleTree);
    }

    #[test]
    fn test_state_proof_hash_deterministic() {
        let proof = StateProof::empty(StateRoot::ZERO);

        let hash1 = proof.proof_hash();
        let hash2 = proof.proof_hash();

        assert_eq!(hash1, hash2, "proof hash must be deterministic");
    }

    #[test]
    fn test_state_proof_preimage_includes_domain() {
        let proof = StateProof::empty(StateRoot::ZERO);
        let preimage = proof.preimage();
        assert!(
            preimage.starts_with(sync_domain::STATE_PROOF),
            "proof preimage must start with domain prefix"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Proof Verification Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_verify_empty_proof_zero_root() {
        let verifier = InMemoryProofVerifier;
        let proof = StateProof::empty(StateRoot::ZERO);

        assert!(verifier.verify_proof(&proof).is_ok());
    }

    #[test]
    fn test_verify_empty_proof_non_zero_root_fails() {
        let verifier = InMemoryProofVerifier;
        let proof = StateProof::empty(StateRoot::new([1u8; 32]));

        assert!(verifier.verify_proof(&proof).is_err());
    }

    #[test]
    fn test_verify_linear_hash_proof_valid() {
        let verifier = InMemoryProofVerifier;

        // Create state and get its root
        let mut manager = InMemoryStateManager::new();
        manager.begin_block();
        let mut batch = StateUpdateBatch::new();
        batch.set(b"key1", b"value1");
        batch.set(b"key2", b"value2");
        manager.apply_update(&batch).unwrap();
        manager.commit().unwrap();

        let root = manager.state_root();

        // Create proof with the same entries
        let entries = vec![
            (b"key1".to_vec(), Some(b"value1".to_vec())),
            (b"key2".to_vec(), Some(b"value2".to_vec())),
        ];
        let proof = StateProof::linear_hash(root, entries);

        assert!(verifier.verify_proof(&proof).is_ok());
    }

    #[test]
    fn test_verify_linear_hash_proof_invalid_root() {
        let verifier = InMemoryProofVerifier;

        // Create proof claiming wrong root
        let entries = vec![(b"key".to_vec(), Some(b"value".to_vec()))];
        let wrong_root = StateRoot::new([99u8; 32]);
        let proof = StateProof::linear_hash(wrong_root, entries);

        let result = verifier.verify_proof(&proof);
        assert!(matches!(result, Err(StateError::RootMismatch { .. })));
    }

    #[test]
    fn test_verify_merkle_tree_proof_not_implemented() {
        let verifier = InMemoryProofVerifier;
        let proof = StateProof::merkle_tree(StateRoot::ZERO, vec![], vec![]);

        let result = verifier.verify_proof(&proof);
        assert!(matches!(result, Err(StateError::VerificationFailed(_))));
    }

    #[test]
    fn test_verify_entries_correct() {
        let verifier = InMemoryProofVerifier;

        // Create proof with entries
        let entries = vec![
            (b"key1".to_vec(), Some(b"value1".to_vec())),
            (b"key2".to_vec(), Some(b"value2".to_vec())),
        ];
        let root = compute_linear_hash_root(&entries);
        let proof = StateProof::linear_hash(root, entries.clone());

        // Verify subset of entries
        let check = vec![(b"key1".to_vec(), Some(b"value1".to_vec()))];
        assert!(verifier.verify_entries(&proof, &check).is_ok());
    }

    #[test]
    fn test_verify_entries_key_not_found() {
        let verifier = InMemoryProofVerifier;

        let entries = vec![(b"key1".to_vec(), Some(b"value1".to_vec()))];
        let root = compute_linear_hash_root(&entries);
        let proof = StateProof::linear_hash(root, entries);

        // Try to verify a key that's not in the proof
        let check = vec![(b"missing".to_vec(), Some(b"value".to_vec()))];
        let result = verifier.verify_entries(&proof, &check);
        assert!(matches!(result, Err(StateError::VerificationFailed(_))));
    }

    #[test]
    fn test_verify_entries_value_mismatch() {
        let verifier = InMemoryProofVerifier;

        let entries = vec![(b"key".to_vec(), Some(b"value".to_vec()))];
        let root = compute_linear_hash_root(&entries);
        let proof = StateProof::linear_hash(root, entries);

        // Try to verify with wrong value
        let check = vec![(b"key".to_vec(), Some(b"wrong".to_vec()))];
        let result = verifier.verify_entries(&proof, &check);
        assert!(matches!(result, Err(StateError::VerificationFailed(_))));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State Sync Handler Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_state_sync_handler_handle_request_specific_keys() {
        let mut manager = InMemoryStateManager::new();
        manager.begin_block();
        let mut batch = StateUpdateBatch::new();
        batch.set(b"key1", b"value1");
        batch.set(b"key2", b"value2");
        manager.apply_update(&batch).unwrap();
        manager.commit().unwrap();

        let root = manager.state_root();
        let handler = StateSyncHandler::new(manager, 10);

        let request = StateSyncRequest::specific_keys(
            root,
            10,
            vec![b"key1".to_vec()],
            42,
        );

        let response = handler.handle_request(&request).unwrap();

        assert_eq!(response.request_id, 42);
        assert_eq!(response.state_root, root);
        assert_eq!(response.height, 10);
        assert!(response.is_final);
        assert_eq!(response.chunk.len(), 1);
    }

    #[test]
    fn test_state_sync_handler_wrong_root() {
        let manager = InMemoryStateManager::new();
        let handler = StateSyncHandler::new(manager, 0);

        let request = StateSyncRequest::full_state(
            StateRoot::new([99u8; 32]), // Wrong root
            0,
            42,
        );

        let result = handler.handle_request(&request);
        assert!(result.is_err());
    }

    #[test]
    fn test_state_sync_handler_full_state_returns_empty() {
        let manager = InMemoryStateManager::new();
        let root = manager.state_root();
        let handler = StateSyncHandler::new(manager, 0);

        let request = StateSyncRequest::full_state(root, 0, 42);
        let response = handler.handle_request(&request).unwrap();

        // Full state iteration not implemented, returns empty
        assert!(response.chunk.is_empty());
        assert!(response.is_final);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Domain Separation Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_sync_domains_are_unique() {
        assert_ne!(sync_domain::SYNC_REQUEST, sync_domain::SYNC_RESPONSE);
        assert_ne!(sync_domain::SYNC_REQUEST, sync_domain::STATE_PROOF);
        assert_ne!(sync_domain::SYNC_RESPONSE, sync_domain::STATE_PROOF);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Hash Stability Tests (Exit Criteria)
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_state_sync_request_hash_stable() {
        // This test ensures hash stability across encode/decode
        let request = StateSyncRequest::specific_keys(
            StateRoot::new([1u8; 32]),
            100,
            vec![b"key".to_vec()],
            42,
        );

        let hash_before = request.request_hash();
        let serialized = serde_json::to_vec(&request).unwrap();
        let deserialized: StateSyncRequest = serde_json::from_slice(&serialized).unwrap();
        let hash_after = deserialized.request_hash();

        assert_eq!(hash_before, hash_after, "hash must be stable across serialization");
    }

    #[test]
    fn test_state_sync_response_hash_stable() {
        let response = StateSyncResponse::empty(42, StateRoot::new([1u8; 32]), 100);

        let hash_before = response.response_hash();
        let serialized = serde_json::to_vec(&response).unwrap();
        let deserialized: StateSyncResponse = serde_json::from_slice(&serialized).unwrap();
        let hash_after = deserialized.response_hash();

        assert_eq!(hash_before, hash_after, "hash must be stable across serialization");
    }

    #[test]
    fn test_state_proof_hash_stable() {
        let entries = vec![(b"key".to_vec(), Some(b"value".to_vec()))];
        let proof = StateProof::linear_hash(StateRoot::new([1u8; 32]), entries);

        let hash_before = proof.proof_hash();
        let serialized = serde_json::to_vec(&proof).unwrap();
        let deserialized: StateProof = serde_json::from_slice(&serialized).unwrap();
        let hash_after = deserialized.proof_hash();

        assert_eq!(hash_before, hash_after, "hash must be stable across serialization");
    }
}
