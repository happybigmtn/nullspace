//! Consensus integration for simplex and ordered finalization.
//!
//! This module provides the integration layer between CodexPoker's block structures
//! and Commonware's simplex consensus protocol. It defines:
//!
//! - [`Automaton`]: The core consensus state machine interface
//! - [`Digest`]: A compact commitment to block content (header hash)
//! - [`Marshal`]: Serialization for consensus messages
//! - [`Finalization`]: Finalization certificate with signatures
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────────────────┐
//! │                        Consensus Integration                                 │
//! │                                                                              │
//! │  ┌────────────────────┐     ┌────────────────────┐     ┌─────────────────┐ │
//! │  │     Automaton      │     │      Marshal       │     │  Finalization   │ │
//! │  │  propose()         │     │  encode_block()    │     │  certificate    │ │
//! │  │  verify()          │────▶│  decode_block()    │────▶│  persist()      │ │
//! │  │  finalize()        │     │  encode_digest()   │     │                 │ │
//! │  └────────────────────┘     └────────────────────┘     └─────────────────┘ │
//! │           │                                                    │            │
//! │           ▼                                                    ▼            │
//! │  ┌────────────────────────────────────────────────────────────────────────┐ │
//! │  │                          Block / BlockHeader                            │ │
//! │  │                          (from block.rs)                                │ │
//! │  └────────────────────────────────────────────────────────────────────────┘ │
//! └─────────────────────────────────────────────────────────────────────────────┘
//! ```
//!
//! # Simplex Integration
//!
//! The simplex protocol operates in rounds where:
//! 1. A leader proposes a block (via `Automaton::propose()`)
//! 2. Validators verify the proposal (via `Automaton::verify()`)
//! 3. Validators vote; on quorum, the block is finalized
//! 4. Finalized blocks are persisted (via `Automaton::finalize()`)
//!
//! Our implementation maps:
//! - Simplex "digest" → `BlockHeader` hash (32 bytes)
//! - Simplex "payload" → `BlockBody` (serialized payloads)
//! - Finalization includes the block hash and validator signatures

use crate::block::{compute_receipts_root, Block, BlockBody, BlockHeader, Receipt};
use protocol_messages::ProtocolVersion;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

// ─────────────────────────────────────────────────────────────────────────────
// Domain Separation
// ─────────────────────────────────────────────────────────────────────────────

/// Domain separation prefixes for consensus-related hashing.
pub mod domain {
    /// Domain prefix for [`super::Finalization`] hashing.
    pub const FINALIZATION: &[u8] = b"nullspace.finalization.v1";
    /// Domain prefix for finalization vote preimage.
    pub const FINALIZATION_VOTE: &[u8] = b"nullspace.finalization_vote.v1";
}

// ─────────────────────────────────────────────────────────────────────────────
// Digest
// ─────────────────────────────────────────────────────────────────────────────

/// A compact commitment to a block, used as the consensus "digest".
///
/// In simplex consensus, the digest is what validators vote on. It must uniquely
/// identify the block content without including the full payload. Our digest is
/// simply the block header hash (32 bytes).
///
/// # Properties
///
/// - **Binding**: The digest commits to all header fields including receipts_root
/// - **Unique**: Different blocks produce different digests (collision-resistant)
/// - **Compact**: Fixed 32-byte size regardless of block content
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
pub struct Digest(pub [u8; 32]);

impl Digest {
    /// Create a digest from raw bytes.
    pub fn new(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    /// Create a digest from a block header.
    pub fn from_header(header: &BlockHeader) -> Self {
        Self(header.block_hash())
    }

    /// Zero digest (used for genesis parent).
    pub const ZERO: Self = Self([0; 32]);

    /// Convert to raw bytes.
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl AsRef<[u8]> for Digest {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

impl From<[u8; 32]> for Digest {
    fn from(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
}

impl From<Digest> for [u8; 32] {
    fn from(digest: Digest) -> Self {
        digest.0
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Finalization
// ─────────────────────────────────────────────────────────────────────────────

/// A finalization certificate proving a block was accepted by consensus.
///
/// When a quorum of validators agrees on a block, their signatures form a
/// finalization certificate. This certificate proves:
///
/// 1. The block was proposed in a valid consensus round
/// 2. Enough validators verified and voted for it
/// 3. The block can be safely persisted and executed
///
/// # Security
///
/// - Certificates are tied to a specific block digest (header hash)
/// - Each validator signature covers the same digest + round number
/// - A quorum threshold must be met for the certificate to be valid
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Finalization {
    /// Protocol version for this finalization format.
    pub version: ProtocolVersion,

    /// The finalized block's digest (header hash).
    pub digest: Digest,

    /// Consensus round in which this block was finalized.
    pub round: u64,

    /// Block height (should match the block header's height).
    pub height: u64,

    /// Validator signatures attesting to finalization.
    ///
    /// Each entry is (validator_public_key, signature).
    /// Using a Vec instead of HashMap for JSON serialization compatibility.
    pub signatures: Vec<([u8; 32], Vec<u8>)>,
}

impl Finalization {
    /// Create a new finalization certificate.
    pub fn new(
        version: ProtocolVersion,
        digest: Digest,
        round: u64,
        height: u64,
    ) -> Self {
        Self {
            version,
            digest,
            round,
            height,
            signatures: Vec::new(),
        }
    }

    /// Add a validator signature to the certificate.
    ///
    /// If the validator already has a signature, this replaces it.
    pub fn add_signature(&mut self, validator: [u8; 32], signature: Vec<u8>) {
        // Check if validator already exists and replace
        if let Some(pos) = self.signatures.iter().position(|(v, _)| *v == validator) {
            self.signatures[pos] = (validator, signature);
        } else {
            self.signatures.push((validator, signature));
        }
    }

    /// Number of signatures in this certificate.
    pub fn signature_count(&self) -> usize {
        self.signatures.len()
    }

    /// Check if the certificate has reached a quorum.
    ///
    /// Requires strictly more than 2/3 of validators.
    pub fn has_quorum(&self, total_validators: usize) -> bool {
        if total_validators == 0 {
            return false;
        }
        // Quorum: more than 2/3, i.e., > 2n/3, which means >= floor(2n/3) + 1
        let quorum_threshold = (2 * total_validators / 3) + 1;
        self.signatures.len() >= quorum_threshold
    }

    /// Domain-separated preimage for hashing the finalization certificate.
    pub fn preimage(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(domain::FINALIZATION.len() + 1 + 32 + 8 + 8);
        buf.extend_from_slice(domain::FINALIZATION);
        buf.push(self.version.0);
        buf.extend_from_slice(self.digest.as_bytes());
        buf.extend_from_slice(&self.round.to_le_bytes());
        buf.extend_from_slice(&self.height.to_le_bytes());
        // Note: signatures are not included in the preimage (they sign this preimage)
        buf
    }

    /// Canonical hash of this finalization certificate (without signatures).
    pub fn finalization_hash(&self) -> [u8; 32] {
        protocol_messages::canonical_hash(&self.preimage())
    }

    /// Preimage that validators sign when voting for finalization.
    ///
    /// This is what each validator's signature should cover.
    pub fn vote_preimage(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(domain::FINALIZATION_VOTE.len() + 32 + 8);
        buf.extend_from_slice(domain::FINALIZATION_VOTE);
        buf.extend_from_slice(self.digest.as_bytes());
        buf.extend_from_slice(&self.round.to_le_bytes());
        buf
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Automaton Error
// ─────────────────────────────────────────────────────────────────────────────

/// Errors that can occur during consensus operations.
#[derive(Debug, Clone, Error, PartialEq, Eq)]
pub enum AutomatonError {
    /// Block height does not match expected height.
    #[error("height mismatch: expected {expected}, got {actual}")]
    HeightMismatch { expected: u64, actual: u64 },

    /// Block's parent hash does not match the previous block.
    #[error("parent hash mismatch")]
    ParentHashMismatch,

    /// Block's receipts root does not match computed receipts.
    #[error("receipts root mismatch")]
    ReceiptsRootMismatch,

    /// Block's state root does not match expected state.
    #[error("state root mismatch")]
    StateRootMismatch,

    /// Block body is invalid or contains invalid payloads.
    #[error("invalid block body: {0}")]
    InvalidBlockBody(String),

    /// Proposer is not authorized for this round.
    #[error("unauthorized proposer")]
    UnauthorizedProposer,

    /// Block timestamp is invalid (too old or too far in future).
    #[error("invalid timestamp: {0}")]
    InvalidTimestamp(String),

    /// Finalization certificate is invalid.
    #[error("invalid finalization: {0}")]
    InvalidFinalization(String),

    /// State execution failed.
    #[error("execution error: {0}")]
    ExecutionError(String),

    /// Serialization/deserialization error.
    #[error("marshal error: {0}")]
    MarshalError(String),
}

// ─────────────────────────────────────────────────────────────────────────────
// Automaton Trait
// ─────────────────────────────────────────────────────────────────────────────

/// The consensus state machine interface.
///
/// This trait defines the core operations needed by simplex consensus:
///
/// - **`propose`**: Leader creates a new block for the current round
/// - **`verify`**: Validators check that a proposed block is valid
/// - **`finalize`**: Commit a finalized block and update state
///
/// # Implementation Notes
///
/// Implementations must ensure:
///
/// 1. **Determinism**: Given the same inputs, all operations produce identical
///    outputs across all validators.
///
/// 2. **Atomicity**: `finalize` either fully succeeds or fully fails; no
///    partial state updates.
///
/// 3. **Consistency**: `verify(propose(...))` should always succeed (a leader
///    should only propose valid blocks).
///
/// # Type Parameters
///
/// The trait uses associated types to allow flexibility in state representation:
/// - `State`: The application state being managed
/// - `Payload`: Additional proposal context from consensus layer
pub trait Automaton {
    /// Application state type.
    type State;

    /// Additional proposal context from consensus.
    type Payload;

    /// Propose a new block for the given round.
    ///
    /// Called when this node is the leader for the round. Should:
    /// 1. Collect pending payloads from the mempool
    /// 2. Execute them against current state to get receipts
    /// 3. Compute receipts root and state root
    /// 4. Build and return the complete block
    ///
    /// # Arguments
    ///
    /// - `round`: The consensus round number
    /// - `parent`: Digest of the parent block (or `Digest::ZERO` for genesis)
    /// - `payload`: Additional context from the consensus layer
    ///
    /// # Returns
    ///
    /// The proposed block, or an error if proposal fails.
    fn propose(
        &mut self,
        round: u64,
        parent: Digest,
        payload: &Self::Payload,
    ) -> Result<Block, AutomatonError>;

    /// Verify a proposed block is valid.
    ///
    /// Called by validators when they receive a proposal. Should check:
    /// 1. Block height and parent hash are correct
    /// 2. Proposer is authorized for this round
    /// 3. All payloads in the body are valid
    /// 4. Receipts root matches re-execution of payloads
    /// 5. State root matches the expected post-execution state
    ///
    /// # Arguments
    ///
    /// - `round`: The consensus round number
    /// - `block`: The proposed block to verify
    ///
    /// # Returns
    ///
    /// `Ok(receipts)` if valid, containing the receipts from re-execution.
    /// `Err(...)` if any validation check fails.
    fn verify(
        &self,
        round: u64,
        block: &Block,
    ) -> Result<Vec<Receipt>, AutomatonError>;

    /// Finalize a block after consensus agreement.
    ///
    /// Called when a block has received a quorum of votes. Should:
    /// 1. Persist the block and finalization certificate
    /// 2. Update the canonical chain tip
    /// 3. Apply state changes atomically
    ///
    /// # Arguments
    ///
    /// - `block`: The finalized block
    /// - `finalization`: The finalization certificate with signatures
    ///
    /// # Returns
    ///
    /// `Ok(())` on success, `Err(...)` if finalization fails.
    fn finalize(
        &mut self,
        block: Block,
        finalization: Finalization,
    ) -> Result<(), AutomatonError>;

    /// Get the current chain tip digest.
    ///
    /// Returns `Digest::ZERO` if no blocks have been finalized yet.
    fn tip(&self) -> Digest;

    /// Get the current block height.
    ///
    /// Returns 0 if no blocks have been finalized (next block will be height 0).
    fn height(&self) -> u64;

    /// Get the current state root.
    fn state_root(&self) -> [u8; 32];
}

// ─────────────────────────────────────────────────────────────────────────────
// Marshal
// ─────────────────────────────────────────────────────────────────────────────

/// Serialization utilities for consensus messages.
///
/// Marshal provides encode/decode functions for blocks, digests, and
/// finalization certificates. All encoding is deterministic and includes
/// version information for forward compatibility.
pub struct Marshal;

impl Marshal {
    /// Encode a block for network transmission.
    ///
    /// The encoding uses bincode with little-endian byte order for
    /// cross-platform determinism.
    pub fn encode_block(block: &Block) -> Result<Vec<u8>, AutomatonError> {
        // Use a simple length-prefixed format:
        // [header_len: u32][header_bytes][body_len: u32][body_bytes]
        let header_bytes = Self::encode_block_header(&block.header)?;
        let body_bytes = Self::encode_block_body(&block.body)?;

        let mut buf = Vec::with_capacity(8 + header_bytes.len() + body_bytes.len());
        buf.extend_from_slice(&(header_bytes.len() as u32).to_le_bytes());
        buf.extend_from_slice(&header_bytes);
        buf.extend_from_slice(&(body_bytes.len() as u32).to_le_bytes());
        buf.extend_from_slice(&body_bytes);

        Ok(buf)
    }

    /// Decode a block from network bytes.
    pub fn decode_block(data: &[u8]) -> Result<Block, AutomatonError> {
        if data.len() < 8 {
            return Err(AutomatonError::MarshalError("block data too short".into()));
        }

        let header_len = u32::from_le_bytes(
            data[0..4].try_into().map_err(|_| AutomatonError::MarshalError("invalid header length".into()))?
        ) as usize;

        if data.len() < 4 + header_len + 4 {
            return Err(AutomatonError::MarshalError("block data truncated".into()));
        }

        let header = Self::decode_block_header(&data[4..4 + header_len])?;

        let body_offset = 4 + header_len;
        let body_len = u32::from_le_bytes(
            data[body_offset..body_offset + 4].try_into()
                .map_err(|_| AutomatonError::MarshalError("invalid body length".into()))?
        ) as usize;

        if data.len() < body_offset + 4 + body_len {
            return Err(AutomatonError::MarshalError("body data truncated".into()));
        }

        let body = Self::decode_block_body(&data[body_offset + 4..body_offset + 4 + body_len])?;

        Ok(Block::new(header, body))
    }

    /// Encode a block header.
    fn encode_block_header(header: &BlockHeader) -> Result<Vec<u8>, AutomatonError> {
        // Fixed-size encoding: version(1) + height(8) + parent(32) + receipts(32) + state(32) + ts(8) + proposer(32) = 145 bytes
        let mut buf = Vec::with_capacity(145);
        buf.push(header.version.0);
        buf.extend_from_slice(&header.height.to_le_bytes());
        buf.extend_from_slice(&header.parent_hash);
        buf.extend_from_slice(&header.receipts_root);
        buf.extend_from_slice(&header.state_root);
        buf.extend_from_slice(&header.timestamp_ms.to_le_bytes());
        buf.extend_from_slice(&header.proposer);
        Ok(buf)
    }

    /// Decode a block header.
    fn decode_block_header(data: &[u8]) -> Result<BlockHeader, AutomatonError> {
        if data.len() != 145 {
            return Err(AutomatonError::MarshalError(
                format!("invalid header size: expected 145, got {}", data.len())
            ));
        }

        let version = ProtocolVersion::new(data[0]);
        let height = u64::from_le_bytes(data[1..9].try_into().unwrap());
        let parent_hash: [u8; 32] = data[9..41].try_into().unwrap();
        let receipts_root: [u8; 32] = data[41..73].try_into().unwrap();
        let state_root: [u8; 32] = data[73..105].try_into().unwrap();
        let timestamp_ms = u64::from_le_bytes(data[105..113].try_into().unwrap());
        let proposer: [u8; 32] = data[113..145].try_into().unwrap();

        Ok(BlockHeader::new(
            version,
            height,
            parent_hash,
            receipts_root,
            state_root,
            timestamp_ms,
            proposer,
        ))
    }

    /// Encode a block body.
    ///
    /// Uses serde for payload serialization with length prefixing.
    fn encode_block_body(body: &BlockBody) -> Result<Vec<u8>, AutomatonError> {
        // For now, use JSON for simplicity. In production, use a binary format.
        serde_json::to_vec(body)
            .map_err(|e| AutomatonError::MarshalError(format!("body encode error: {}", e)))
    }

    /// Decode a block body.
    fn decode_block_body(data: &[u8]) -> Result<BlockBody, AutomatonError> {
        serde_json::from_slice(data)
            .map_err(|e| AutomatonError::MarshalError(format!("body decode error: {}", e)))
    }

    /// Encode a digest for network transmission.
    pub fn encode_digest(digest: &Digest) -> [u8; 32] {
        digest.0
    }

    /// Decode a digest from network bytes.
    pub fn decode_digest(data: &[u8]) -> Result<Digest, AutomatonError> {
        if data.len() != 32 {
            return Err(AutomatonError::MarshalError(
                format!("invalid digest size: expected 32, got {}", data.len())
            ));
        }
        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(data);
        Ok(Digest(bytes))
    }

    /// Encode a finalization certificate.
    pub fn encode_finalization(fin: &Finalization) -> Result<Vec<u8>, AutomatonError> {
        serde_json::to_vec(fin)
            .map_err(|e| AutomatonError::MarshalError(format!("finalization encode error: {}", e)))
    }

    /// Decode a finalization certificate.
    pub fn decode_finalization(data: &[u8]) -> Result<Finalization, AutomatonError> {
        serde_json::from_slice(data)
            .map_err(|e| AutomatonError::MarshalError(format!("finalization decode error: {}", e)))
    }

    /// Encode a receipt for storage or transmission.
    pub fn encode_receipt(receipt: &Receipt) -> Result<Vec<u8>, AutomatonError> {
        serde_json::to_vec(receipt)
            .map_err(|e| AutomatonError::MarshalError(format!("receipt encode error: {}", e)))
    }

    /// Decode a receipt from bytes.
    pub fn decode_receipt(data: &[u8]) -> Result<Receipt, AutomatonError> {
        serde_json::from_slice(data)
            .map_err(|e| AutomatonError::MarshalError(format!("receipt decode error: {}", e)))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SimplexAutomaton - Concrete Implementation
// ─────────────────────────────────────────────────────────────────────────────

/// Configuration for the simplex automaton.
#[derive(Debug, Clone)]
pub struct SimplexConfig {
    /// Protocol version to use for new blocks.
    pub version: ProtocolVersion,

    /// This node's proposer identity (public key).
    pub proposer_id: [u8; 32],

    /// Total number of validators for quorum calculation.
    pub validator_count: usize,
}

impl Default for SimplexConfig {
    fn default() -> Self {
        Self {
            version: ProtocolVersion::current(),
            proposer_id: [0; 32],
            validator_count: 1,
        }
    }
}

/// In-memory chain state for the simplex automaton.
///
/// This tracks:
/// - The canonical chain tip (latest finalized block digest)
/// - Block height
/// - State root (application state commitment)
/// - Finalized blocks and their receipts
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChainState {
    /// Current chain tip digest (header hash of latest finalized block).
    /// `Digest::ZERO` if no blocks finalized yet.
    pub tip: Digest,

    /// Current block height (0 for genesis, increments with each block).
    pub height: u64,

    /// Current state root (application state commitment).
    pub state_root: [u8; 32],

    /// Whether genesis has been finalized.
    pub has_genesis: bool,
}

impl ChainState {
    /// Create a new chain state starting from genesis.
    pub fn new() -> Self {
        Self::default()
    }

    /// Create chain state at a specific point (for restart recovery).
    pub fn at(tip: Digest, height: u64, state_root: [u8; 32]) -> Self {
        Self {
            tip,
            height,
            state_root,
            has_genesis: height > 0 || tip != Digest::ZERO,
        }
    }

    /// Expected height for the next block.
    pub fn next_height(&self) -> u64 {
        if self.has_genesis {
            self.height + 1
        } else {
            0
        }
    }
}

/// A concrete implementation of the [`Automaton`] trait for simplex consensus.
///
/// `SimplexAutomaton` maintains in-memory chain state and provides the
/// propose/verify/finalize operations needed by the consensus layer.
///
/// # State Management
///
/// The automaton uses a simple state model:
/// - State root is updated after each finalized block
/// - Blocks and finalizations are stored in-memory (for persistence, see M5.3)
///
/// # Payload Execution
///
/// Currently, payload execution is a no-op (state root is computed from
/// block content hash). In a full implementation, this would execute
/// game actions and update poker table state.
///
/// # Example
///
/// ```
/// use codexpoker_onchain::consensus::{SimplexAutomaton, SimplexConfig, Digest};
/// use codexpoker_onchain::consensus::Automaton;
///
/// let config = SimplexConfig::default();
/// let mut automaton = SimplexAutomaton::new(config);
///
/// // Check initial state
/// assert_eq!(automaton.tip(), Digest::ZERO);
/// assert_eq!(automaton.height(), 0);
/// ```
pub struct SimplexAutomaton<E: PayloadExecutor = NoOpExecutor> {
    /// Configuration.
    config: SimplexConfig,

    /// Current chain state.
    state: ChainState,

    /// Finalized blocks by height.
    blocks: HashMap<u64, Block>,

    /// Finalization certificates by height.
    finalizations: HashMap<u64, Finalization>,

    /// Receipts by block height.
    receipts: HashMap<u64, Vec<Receipt>>,

    /// Payload executor for state transitions.
    executor: E,
}

/// Trait for executing payloads and computing state transitions.
///
/// This allows different execution backends (no-op for testing, real
/// game logic for production).
pub trait PayloadExecutor {
    /// Execute a block body and return receipts.
    ///
    /// The executor receives the current state root and the payloads,
    /// and returns:
    /// - The receipts for each payload
    /// - The new state root after execution
    fn execute(
        &mut self,
        current_state_root: [u8; 32],
        body: &BlockBody,
    ) -> Result<(Vec<Receipt>, [u8; 32]), AutomatonError>;

    /// Verify execution of a block body.
    ///
    /// This re-executes the payloads and checks that:
    /// - Receipts match the expected receipts root
    /// - Final state root matches the expected state root
    fn verify(
        &self,
        current_state_root: [u8; 32],
        body: &BlockBody,
        expected_receipts_root: [u8; 32],
        expected_state_root: [u8; 32],
    ) -> Result<Vec<Receipt>, AutomatonError>;
}

/// No-op executor for testing.
///
/// This executor:
/// - Produces success receipts for all payloads
/// - Computes state root as hash of (current_root || block_body_hash)
#[derive(Debug, Clone, Default)]
pub struct NoOpExecutor;

impl PayloadExecutor for NoOpExecutor {
    fn execute(
        &mut self,
        current_state_root: [u8; 32],
        body: &BlockBody,
    ) -> Result<(Vec<Receipt>, [u8; 32]), AutomatonError> {
        // Generate success receipts for each payload
        let mut receipts = Vec::with_capacity(body.payloads.len());

        // Compute new state root incrementally
        let mut state_root = current_state_root;

        for payload in &body.payloads {
            // Compute payload hash
            let payload_hash = if let Some(hash) = payload.referenced_commitment_hash() {
                hash
            } else {
                [0; 32]
            };

            // Update state root: hash(current || payload_hash)
            let mut preimage = Vec::with_capacity(64);
            preimage.extend_from_slice(&state_root);
            preimage.extend_from_slice(&payload_hash);
            state_root = protocol_messages::canonical_hash(&preimage);

            receipts.push(Receipt::success(payload_hash, state_root));
        }

        // For empty blocks, just hash the current state with a marker
        if body.payloads.is_empty() {
            let mut preimage = Vec::with_capacity(33);
            preimage.extend_from_slice(&state_root);
            preimage.push(0xFF); // Empty block marker
            state_root = protocol_messages::canonical_hash(&preimage);
        }

        Ok((receipts, state_root))
    }

    fn verify(
        &self,
        current_state_root: [u8; 32],
        body: &BlockBody,
        expected_receipts_root: [u8; 32],
        expected_state_root: [u8; 32],
    ) -> Result<Vec<Receipt>, AutomatonError> {
        // Re-execute using same logic
        let mut executor = NoOpExecutor;
        let (receipts, state_root) = executor.execute(current_state_root, body)?;

        // Verify receipts root
        let receipts_root = compute_receipts_root(&receipts);
        if receipts_root != expected_receipts_root {
            return Err(AutomatonError::ReceiptsRootMismatch);
        }

        // Verify state root
        if state_root != expected_state_root {
            return Err(AutomatonError::StateRootMismatch);
        }

        Ok(receipts)
    }
}

impl SimplexAutomaton<NoOpExecutor> {
    /// Create a new automaton with no-op executor.
    pub fn new(config: SimplexConfig) -> Self {
        Self::with_executor(config, NoOpExecutor)
    }
}

impl<E: PayloadExecutor> SimplexAutomaton<E> {
    /// Create a new automaton with a custom executor.
    pub fn with_executor(config: SimplexConfig, executor: E) -> Self {
        Self {
            config,
            state: ChainState::new(),
            blocks: HashMap::new(),
            finalizations: HashMap::new(),
            receipts: HashMap::new(),
            executor,
        }
    }

    /// Restore automaton from persisted state.
    ///
    /// Used for restart recovery when chain state is loaded from disk.
    pub fn restore(
        config: SimplexConfig,
        executor: E,
        state: ChainState,
        blocks: HashMap<u64, Block>,
        finalizations: HashMap<u64, Finalization>,
        receipts: HashMap<u64, Vec<Receipt>>,
    ) -> Self {
        Self {
            config,
            state,
            blocks,
            finalizations,
            receipts,
            executor,
        }
    }

    /// Get a finalized block by height.
    pub fn get_block(&self, height: u64) -> Option<&Block> {
        self.blocks.get(&height)
    }

    /// Get a finalization certificate by height.
    pub fn get_finalization(&self, height: u64) -> Option<&Finalization> {
        self.finalizations.get(&height)
    }

    /// Get receipts for a block by height.
    pub fn get_receipts(&self, height: u64) -> Option<&[Receipt]> {
        self.receipts.get(&height).map(|v| v.as_slice())
    }

    /// Get current timestamp in milliseconds.
    fn now_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }
}

impl<E: PayloadExecutor> Automaton for SimplexAutomaton<E> {
    type State = ChainState;
    type Payload = BlockBody;

    fn propose(
        &mut self,
        round: u64,
        parent: Digest,
        payload: &Self::Payload,
    ) -> Result<Block, AutomatonError> {
        // Verify parent matches our tip
        if parent != self.state.tip {
            return Err(AutomatonError::ParentHashMismatch);
        }

        let height = self.state.next_height();

        // Execute payloads to get receipts and state root
        let (receipts, state_root) = self.executor.execute(self.state.state_root, payload)?;
        let receipts_root = compute_receipts_root(&receipts);

        // Build header
        let header = if height == 0 {
            BlockHeader::genesis(
                self.config.version,
                receipts_root,
                state_root,
                Self::now_ms(),
                self.config.proposer_id,
            )
        } else {
            BlockHeader::new(
                self.config.version,
                height,
                parent.0,
                receipts_root,
                state_root,
                Self::now_ms(),
                self.config.proposer_id,
            )
        };

        // Store receipts temporarily (will be committed on finalize)
        // Using round as temp key since block isn't finalized yet
        self.receipts.insert(round, receipts);

        Ok(Block::new(header, payload.clone()))
    }

    fn verify(
        &self,
        _round: u64,
        block: &Block,
    ) -> Result<Vec<Receipt>, AutomatonError> {
        let header = &block.header;

        // Check height
        let expected_height = self.state.next_height();
        if header.height != expected_height {
            return Err(AutomatonError::HeightMismatch {
                expected: expected_height,
                actual: header.height,
            });
        }

        // Check parent hash
        if header.is_genesis() {
            if self.state.has_genesis {
                return Err(AutomatonError::HeightMismatch {
                    expected: expected_height,
                    actual: 0,
                });
            }
        } else {
            if header.parent_hash != self.state.tip.0 {
                return Err(AutomatonError::ParentHashMismatch);
            }
        }

        // Verify execution
        self.executor.verify(
            self.state.state_root,
            &block.body,
            header.receipts_root,
            header.state_root,
        )
    }

    fn finalize(
        &mut self,
        block: Block,
        finalization: Finalization,
    ) -> Result<(), AutomatonError> {
        // Verify finalization matches block
        let block_digest = Digest::from_header(&block.header);
        if finalization.digest != block_digest {
            return Err(AutomatonError::InvalidFinalization(
                "digest mismatch".into()
            ));
        }

        // Verify height matches
        if finalization.height != block.header.height {
            return Err(AutomatonError::InvalidFinalization(
                "height mismatch".into()
            ));
        }

        // Verify quorum
        if !finalization.has_quorum(self.config.validator_count) {
            return Err(AutomatonError::InvalidFinalization(
                format!(
                    "insufficient signatures: {} of {} required",
                    finalization.signature_count(),
                    (2 * self.config.validator_count / 3) + 1
                )
            ));
        }

        // Re-verify block if we haven't already
        let receipts = self.verify(finalization.round, &block)?;

        // Update chain state
        let height = block.header.height;
        self.state.tip = block_digest;
        self.state.height = height;
        self.state.state_root = block.header.state_root;
        self.state.has_genesis = true;

        // Store block, finalization, and receipts
        self.blocks.insert(height, block);
        self.finalizations.insert(height, finalization);
        self.receipts.insert(height, receipts);

        Ok(())
    }

    fn tip(&self) -> Digest {
        self.state.tip
    }

    fn height(&self) -> u64 {
        self.state.height
    }

    fn state_root(&self) -> [u8; 32] {
        self.state.state_root
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistent Automaton
// ─────────────────────────────────────────────────────────────────────────────

use crate::storage::{BlockStorage, StorageError};

/// A wrapper around [`SimplexAutomaton`] that persists finalized data.
///
/// `PersistentAutomaton` intercepts `finalize()` calls to persist blocks,
/// finalization certificates, and receipts to the configured storage backend.
/// On startup, use [`PersistentAutomaton::restore`] to recover from storage.
///
/// # Usage
///
/// ```ignore
/// use codexpoker_onchain::consensus::{PersistentAutomaton, SimplexConfig};
/// use codexpoker_onchain::storage::FileBlockStorage;
///
/// // Create storage backend
/// let storage = FileBlockStorage::open("./data").unwrap();
///
/// // Create or restore automaton
/// let mut automaton = PersistentAutomaton::restore_or_new(
///     SimplexConfig::default(),
///     storage,
/// ).unwrap();
///
/// // Finalize will automatically persist
/// automaton.finalize(block, finalization).unwrap();
/// ```
pub struct PersistentAutomaton<S: BlockStorage, E: PayloadExecutor = NoOpExecutor> {
    /// The inner automaton.
    inner: SimplexAutomaton<E>,
    /// Storage backend for persistence.
    storage: S,
}

impl<S: BlockStorage> PersistentAutomaton<S, NoOpExecutor> {
    /// Create a new persistent automaton with no-op executor.
    pub fn new(config: SimplexConfig, storage: S) -> Self {
        Self {
            inner: SimplexAutomaton::new(config),
            storage,
        }
    }

    /// Restore from storage or create a fresh automaton if storage is empty.
    ///
    /// This is the primary entry point for production use. It:
    /// 1. Checks if the storage has existing data
    /// 2. If yes, recovers chain state and creates the automaton
    /// 3. If no, creates a fresh automaton
    pub fn restore_or_new(config: SimplexConfig, storage: S) -> Result<Self, StorageError> {
        Self::restore_or_new_with_executor(config, NoOpExecutor, storage)
    }
}

impl<S: BlockStorage, E: PayloadExecutor> PersistentAutomaton<S, E> {
    /// Create a new persistent automaton with a custom executor.
    pub fn with_executor(config: SimplexConfig, executor: E, storage: S) -> Self {
        Self {
            inner: SimplexAutomaton::with_executor(config, executor),
            storage,
        }
    }

    /// Restore from storage or create fresh with a custom executor.
    pub fn restore_or_new_with_executor(
        config: SimplexConfig,
        executor: E,
        storage: S,
    ) -> Result<Self, StorageError> {
        // Check for existing chain state
        if let Some(state) = storage.get_chain_state()? {
            // Load blocks into memory cache
            let mut blocks = HashMap::new();
            let mut finalizations = HashMap::new();
            let mut receipts = HashMap::new();

            // Load recent blocks (could be optimized to load on-demand)
            let max_height = state.height;
            // Load the last N blocks into memory for quick access
            let cache_depth = std::cmp::min(max_height + 1, 100);
            let start_height = max_height.saturating_sub(cache_depth - 1);

            for height in start_height..=max_height {
                if storage.has_block(height) {
                    blocks.insert(height, storage.get_block(height)?);
                }
                if storage.has_finalization(height) {
                    finalizations.insert(height, storage.get_finalization(height)?);
                }
                if storage.has_receipts(height) {
                    receipts.insert(height, storage.get_receipts(height)?);
                }
            }

            let inner = SimplexAutomaton::restore(config, executor, state, blocks, finalizations, receipts);
            Ok(Self { inner, storage })
        } else {
            // Fresh start
            Ok(Self {
                inner: SimplexAutomaton::with_executor(config, executor),
                storage,
            })
        }
    }

    /// Get a reference to the inner automaton.
    pub fn inner(&self) -> &SimplexAutomaton<E> {
        &self.inner
    }

    /// Get a mutable reference to the inner automaton.
    pub fn inner_mut(&mut self) -> &mut SimplexAutomaton<E> {
        &mut self.inner
    }

    /// Get a reference to the storage backend.
    pub fn storage(&self) -> &S {
        &self.storage
    }

    /// Get a mutable reference to the storage backend.
    pub fn storage_mut(&mut self) -> &mut S {
        &mut self.storage
    }

    /// Decompose into inner automaton and storage.
    pub fn into_parts(self) -> (SimplexAutomaton<E>, S) {
        (self.inner, self.storage)
    }

    /// Verify state root consistency by recomputing from stored blocks.
    ///
    /// This method validates that the current state root matches what would
    /// be computed by replaying all blocks from genesis. Use this on restart
    /// to ensure state integrity.
    ///
    /// # Returns
    ///
    /// `Ok(true)` if verification passes (or no blocks exist).
    /// `Ok(false)` if state roots don't match (indicates corruption).
    /// `Err(_)` if storage access fails.
    ///
    /// # Performance
    ///
    /// This method replays all blocks from genesis, so it may be slow for
    /// long chains. Consider using sampling or checkpoints for large chains.
    pub fn verify_state_root(&self) -> Result<bool, StorageError> {
        let state = match self.storage.get_chain_state()? {
            Some(s) => s,
            None => return Ok(true), // No state to verify
        };

        if !state.has_genesis {
            return Ok(true); // Fresh chain, nothing to verify
        }

        // Recompute state root by replaying all blocks
        let mut computed_root = [0u8; 32];

        for height in 0..=state.height {
            if !self.storage.has_block(height) {
                // Missing block is a storage error, not a state mismatch
                return Err(StorageError::BlockNotFound { height });
            }

            let block = self.storage.get_block(height)?;

            // Recompute state root using same logic as NoOpExecutor
            for payload in &block.body.payloads {
                let payload_hash = payload.referenced_commitment_hash().unwrap_or([0; 32]);
                let mut preimage = Vec::with_capacity(64);
                preimage.extend_from_slice(&computed_root);
                preimage.extend_from_slice(&payload_hash);
                computed_root = protocol_messages::canonical_hash(&preimage);
            }

            // Handle empty blocks
            if block.body.payloads.is_empty() {
                let mut preimage = Vec::with_capacity(33);
                preimage.extend_from_slice(&computed_root);
                preimage.push(0xFF);
                computed_root = protocol_messages::canonical_hash(&preimage);
            }

            // Verify intermediate state root matches block header
            if computed_root != block.header.state_root {
                return Ok(false);
            }
        }

        // Final verification against chain state
        Ok(computed_root == state.state_root)
    }

    /// Restore from storage with state root verification.
    ///
    /// This is like `restore_or_new` but also verifies state root consistency
    /// after restoration. Use this when state integrity is critical.
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - Storage access fails
    /// - State root verification fails (indicates data corruption)
    pub fn restore_with_verification(
        config: SimplexConfig,
        executor: E,
        storage: S,
    ) -> Result<Self, StorageError> {
        let automaton = Self::restore_or_new_with_executor(config, executor, storage)?;

        // Verify state root consistency
        if !automaton.verify_state_root()? {
            return Err(StorageError::CorruptedState(
                "state root verification failed: computed root does not match stored root".into(),
            ));
        }

        Ok(automaton)
    }
}

impl<S: BlockStorage, E: PayloadExecutor> Automaton for PersistentAutomaton<S, E> {
    type State = ChainState;
    type Payload = BlockBody;

    fn propose(
        &mut self,
        round: u64,
        parent: Digest,
        payload: &Self::Payload,
    ) -> Result<Block, AutomatonError> {
        self.inner.propose(round, parent, payload)
    }

    fn verify(
        &self,
        round: u64,
        block: &Block,
    ) -> Result<Vec<Receipt>, AutomatonError> {
        self.inner.verify(round, block)
    }

    fn finalize(
        &mut self,
        block: Block,
        finalization: Finalization,
    ) -> Result<(), AutomatonError> {
        // First, let the inner automaton validate and finalize
        self.inner.finalize(block.clone(), finalization.clone())?;

        // Now persist to storage
        let height = block.header.height;
        let state = ChainState::at(
            Digest::from_header(&block.header),
            height,
            block.header.state_root,
        );

        // Get receipts from inner automaton
        let receipts = self.inner.get_receipts(height).unwrap_or(&[]).to_vec();

        // Persist atomically
        self.storage
            .persist_finalized(&block, &finalization, &receipts, &state)
            .map_err(|e| AutomatonError::ExecutionError(format!("storage error: {}", e)))?;

        Ok(())
    }

    fn tip(&self) -> Digest {
        self.inner.tip()
    }

    fn height(&self) -> u64 {
        self.inner.height()
    }

    fn state_root(&self) -> [u8; 32] {
        self.inner.state_root()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use protocol_messages::CURRENT_PROTOCOL_VERSION;

    fn test_version() -> ProtocolVersion {
        ProtocolVersion::new(CURRENT_PROTOCOL_VERSION)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Digest Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_digest_from_header() {
        let header = BlockHeader::genesis(
            test_version(),
            [1u8; 32],
            [2u8; 32],
            1700000000000,
            [3u8; 32],
        );

        let digest = Digest::from_header(&header);
        assert_eq!(digest.0, header.block_hash());
    }

    #[test]
    fn test_digest_zero() {
        assert_eq!(Digest::ZERO.0, [0u8; 32]);
    }

    #[test]
    fn test_digest_conversions() {
        let bytes = [42u8; 32];
        let digest: Digest = bytes.into();
        let back: [u8; 32] = digest.into();
        assert_eq!(bytes, back);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Finalization Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_finalization_new() {
        let fin = Finalization::new(
            test_version(),
            Digest::new([1u8; 32]),
            10,
            5,
        );

        assert_eq!(fin.round, 10);
        assert_eq!(fin.height, 5);
        assert_eq!(fin.signature_count(), 0);
    }

    #[test]
    fn test_finalization_add_signature() {
        let mut fin = Finalization::new(
            test_version(),
            Digest::new([1u8; 32]),
            10,
            5,
        );

        fin.add_signature([1u8; 32], vec![0xAA; 64]);
        fin.add_signature([2u8; 32], vec![0xBB; 64]);

        assert_eq!(fin.signature_count(), 2);
    }

    #[test]
    fn test_finalization_quorum() {
        let mut fin = Finalization::new(
            test_version(),
            Digest::new([1u8; 32]),
            10,
            5,
        );

        // With 4 validators, need > 2/3, so need 3 signatures
        assert!(!fin.has_quorum(4));

        fin.add_signature([1u8; 32], vec![0xAA; 64]);
        assert!(!fin.has_quorum(4));

        fin.add_signature([2u8; 32], vec![0xBB; 64]);
        assert!(!fin.has_quorum(4));

        fin.add_signature([3u8; 32], vec![0xCC; 64]);
        assert!(fin.has_quorum(4)); // 3 out of 4 = 75% > 66.7%
    }

    #[test]
    fn test_finalization_quorum_edge_cases() {
        let mut fin = Finalization::new(
            test_version(),
            Digest::new([1u8; 32]),
            10,
            5,
        );

        // Zero validators: no quorum possible
        assert!(!fin.has_quorum(0));

        // 1 validator: need 1 signature (100% > 66.7%)
        fin.add_signature([1u8; 32], vec![0xAA; 64]);
        assert!(fin.has_quorum(1));

        // 3 validators: need 3 signatures (quorum is floor(2*3/3)+1 = 3)
        assert!(!fin.has_quorum(3));
        fin.add_signature([2u8; 32], vec![0xBB; 64]);
        assert!(!fin.has_quorum(3));
        fin.add_signature([3u8; 32], vec![0xCC; 64]);
        assert!(fin.has_quorum(3));
    }

    #[test]
    fn test_finalization_preimage_includes_domain() {
        let fin = Finalization::new(
            test_version(),
            Digest::new([1u8; 32]),
            10,
            5,
        );

        let preimage = fin.preimage();
        assert!(
            preimage.starts_with(domain::FINALIZATION),
            "finalization preimage must start with domain prefix"
        );
    }

    #[test]
    fn test_finalization_vote_preimage_includes_domain() {
        let fin = Finalization::new(
            test_version(),
            Digest::new([1u8; 32]),
            10,
            5,
        );

        let vote_preimage = fin.vote_preimage();
        assert!(
            vote_preimage.starts_with(domain::FINALIZATION_VOTE),
            "vote preimage must start with domain prefix"
        );
    }

    #[test]
    fn test_finalization_hash_deterministic() {
        let fin = Finalization::new(
            test_version(),
            Digest::new([1u8; 32]),
            10,
            5,
        );

        let hash1 = fin.finalization_hash();
        let hash2 = fin.finalization_hash();
        assert_eq!(hash1, hash2, "finalization hash must be deterministic");
    }

    #[test]
    fn test_finalization_hash_changes_with_digest() {
        let fin1 = Finalization::new(
            test_version(),
            Digest::new([1u8; 32]),
            10,
            5,
        );
        let fin2 = Finalization::new(
            test_version(),
            Digest::new([2u8; 32]),
            10,
            5,
        );

        assert_ne!(
            fin1.finalization_hash(),
            fin2.finalization_hash(),
            "different digests must produce different hashes"
        );
    }

    #[test]
    fn test_finalization_hash_changes_with_round() {
        let fin1 = Finalization::new(
            test_version(),
            Digest::new([1u8; 32]),
            10,
            5,
        );
        let fin2 = Finalization::new(
            test_version(),
            Digest::new([1u8; 32]),
            11,
            5,
        );

        assert_ne!(
            fin1.finalization_hash(),
            fin2.finalization_hash(),
            "different rounds must produce different hashes"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Marshal Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_marshal_block_header_roundtrip() {
        let header = BlockHeader::new(
            test_version(),
            42,
            [0xAA; 32],
            [0xBB; 32],
            [0xCC; 32],
            1700000000000,
            [0xDD; 32],
        );

        let encoded = Marshal::encode_block_header(&header).unwrap();
        let decoded = Marshal::decode_block_header(&encoded).unwrap();

        assert_eq!(header, decoded);
    }

    #[test]
    fn test_marshal_block_body_roundtrip() {
        let body = BlockBody::empty();

        let encoded = Marshal::encode_block_body(&body).unwrap();
        let decoded = Marshal::decode_block_body(&encoded).unwrap();

        assert_eq!(body, decoded);
    }

    #[test]
    fn test_marshal_block_roundtrip() {
        let header = BlockHeader::genesis(
            test_version(),
            [1u8; 32],
            [2u8; 32],
            1700000000000,
            [3u8; 32],
        );
        let body = BlockBody::empty();
        let block = Block::new(header, body);

        let encoded = Marshal::encode_block(&block).unwrap();
        let decoded = Marshal::decode_block(&encoded).unwrap();

        assert_eq!(block, decoded);
    }

    #[test]
    fn test_marshal_digest_roundtrip() {
        let digest = Digest::new([0x42; 32]);

        let encoded = Marshal::encode_digest(&digest);
        let decoded = Marshal::decode_digest(&encoded).unwrap();

        assert_eq!(digest, decoded);
    }

    #[test]
    fn test_marshal_finalization_roundtrip() {
        let mut fin = Finalization::new(
            test_version(),
            Digest::new([1u8; 32]),
            10,
            5,
        );
        fin.add_signature([0xAA; 32], vec![0xBB; 64]);
        fin.add_signature([0xCC; 32], vec![0xDD; 64]);

        let encoded = Marshal::encode_finalization(&fin).unwrap();
        let decoded = Marshal::decode_finalization(&encoded).unwrap();

        assert_eq!(fin, decoded);
    }

    #[test]
    fn test_marshal_block_header_hash_stable_across_roundtrip() {
        let header = BlockHeader::new(
            test_version(),
            42,
            [0xAA; 32],
            [0xBB; 32],
            [0xCC; 32],
            1700000000000,
            [0xDD; 32],
        );

        let hash_before = header.block_hash();

        let encoded = Marshal::encode_block_header(&header).unwrap();
        let decoded = Marshal::decode_block_header(&encoded).unwrap();

        let hash_after = decoded.block_hash();

        assert_eq!(hash_before, hash_after, "hash must be stable across encode/decode");
    }

    #[test]
    fn test_marshal_decode_invalid_header_size() {
        let short_data = vec![0u8; 100]; // Less than 145 bytes
        let result = Marshal::decode_block_header(&short_data);
        assert!(result.is_err());
    }

    #[test]
    fn test_marshal_decode_invalid_digest_size() {
        let short_data = vec![0u8; 16]; // Less than 32 bytes
        let result = Marshal::decode_digest(&short_data);
        assert!(result.is_err());
    }

    #[test]
    fn test_marshal_decode_truncated_block() {
        let short_data = vec![0u8; 4]; // Just length prefix, no content
        let result = Marshal::decode_block(&short_data);
        assert!(result.is_err());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Domain Separation Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_domains_are_unique() {
        assert_ne!(domain::FINALIZATION, domain::FINALIZATION_VOTE);
    }

    #[test]
    fn test_domains_differ_from_block_domains() {
        use crate::block::domain as block_domain;

        assert_ne!(domain::FINALIZATION, block_domain::BLOCK_HEADER);
        assert_ne!(domain::FINALIZATION, block_domain::BLOCK_BODY);
        assert_ne!(domain::FINALIZATION, block_domain::RECEIPT);
        assert_ne!(domain::FINALIZATION_VOTE, block_domain::BLOCK_HEADER);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SimplexAutomaton Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_simplex_automaton_initial_state() {
        let config = SimplexConfig::default();
        let automaton = SimplexAutomaton::new(config);

        assert_eq!(automaton.tip(), Digest::ZERO);
        assert_eq!(automaton.height(), 0);
        assert_eq!(automaton.state_root(), [0; 32]);
    }

    #[test]
    fn test_simplex_automaton_propose_genesis() {
        let config = SimplexConfig {
            version: test_version(),
            proposer_id: [0xAA; 32],
            validator_count: 1,
        };
        let mut automaton = SimplexAutomaton::new(config);

        let body = BlockBody::empty();
        let block = automaton.propose(0, Digest::ZERO, &body).unwrap();

        assert_eq!(block.height(), 0);
        assert!(block.header.is_genesis());
        assert_eq!(block.header.proposer, [0xAA; 32]);
    }

    #[test]
    fn test_simplex_automaton_verify_genesis() {
        let config = SimplexConfig {
            version: test_version(),
            proposer_id: [0xAA; 32],
            validator_count: 1,
        };
        let mut automaton = SimplexAutomaton::new(config);

        let body = BlockBody::empty();
        let block = automaton.propose(0, Digest::ZERO, &body).unwrap();

        // Verify should succeed
        let receipts = automaton.verify(0, &block).unwrap();
        assert!(receipts.is_empty()); // Empty block has no receipts
    }

    #[test]
    fn test_simplex_automaton_finalize_genesis() {
        let config = SimplexConfig {
            version: test_version(),
            proposer_id: [0xAA; 32],
            validator_count: 1,
        };
        let mut automaton = SimplexAutomaton::new(config);

        // Propose genesis
        let body = BlockBody::empty();
        let block = automaton.propose(0, Digest::ZERO, &body).unwrap();
        let block_digest = Digest::from_header(&block.header);

        // Create finalization with quorum
        let mut fin = Finalization::new(test_version(), block_digest, 0, 0);
        fin.add_signature([1u8; 32], vec![0xBB; 64]);

        // Finalize
        automaton.finalize(block.clone(), fin).unwrap();

        // Check state updated
        assert_eq!(automaton.tip(), block_digest);
        assert_eq!(automaton.height(), 0);
        assert_eq!(automaton.state_root(), block.header.state_root);
    }

    #[test]
    fn test_simplex_automaton_propose_chain() {
        let config = SimplexConfig {
            version: test_version(),
            proposer_id: [0xAA; 32],
            validator_count: 1,
        };
        let mut automaton = SimplexAutomaton::new(config);

        // Propose and finalize genesis
        let body0 = BlockBody::empty();
        let block0 = automaton.propose(0, Digest::ZERO, &body0).unwrap();
        let digest0 = Digest::from_header(&block0.header);

        let mut fin0 = Finalization::new(test_version(), digest0, 0, 0);
        fin0.add_signature([1u8; 32], vec![]);
        automaton.finalize(block0.clone(), fin0).unwrap();

        // Propose block 1
        let body1 = BlockBody::empty();
        let block1 = automaton.propose(1, digest0, &body1).unwrap();

        assert_eq!(block1.height(), 1);
        assert_eq!(block1.header.parent_hash, digest0.0);

        // Finalize block 1
        let digest1 = Digest::from_header(&block1.header);
        let mut fin1 = Finalization::new(test_version(), digest1, 1, 1);
        fin1.add_signature([1u8; 32], vec![]);
        automaton.finalize(block1.clone(), fin1).unwrap();

        assert_eq!(automaton.height(), 1);
        assert_eq!(automaton.tip(), digest1);
    }

    #[test]
    fn test_simplex_automaton_rejects_wrong_parent() {
        let config = SimplexConfig::default();
        let mut automaton = SimplexAutomaton::new(config);

        // Try to propose with non-zero parent (should fail, we have no genesis)
        let body = BlockBody::empty();
        let result = automaton.propose(0, Digest::new([1u8; 32]), &body);

        assert!(matches!(result, Err(AutomatonError::ParentHashMismatch)));
    }

    #[test]
    fn test_simplex_automaton_rejects_insufficient_quorum() {
        let config = SimplexConfig {
            version: test_version(),
            proposer_id: [0xAA; 32],
            validator_count: 4, // Requires 3 signatures for quorum
        };
        let mut automaton = SimplexAutomaton::new(config);

        // Propose genesis
        let body = BlockBody::empty();
        let block = automaton.propose(0, Digest::ZERO, &body).unwrap();
        let block_digest = Digest::from_header(&block.header);

        // Create finalization with only 2 signatures (need 3)
        let mut fin = Finalization::new(test_version(), block_digest, 0, 0);
        fin.add_signature([1u8; 32], vec![]);
        fin.add_signature([2u8; 32], vec![]);

        // Finalize should fail
        let result = automaton.finalize(block, fin);
        assert!(matches!(result, Err(AutomatonError::InvalidFinalization(_))));
    }

    #[test]
    fn test_simplex_automaton_get_finalized_data() {
        let config = SimplexConfig {
            version: test_version(),
            proposer_id: [0xAA; 32],
            validator_count: 1,
        };
        let mut automaton = SimplexAutomaton::new(config);

        // Propose and finalize genesis
        let body = BlockBody::empty();
        let block = automaton.propose(0, Digest::ZERO, &body).unwrap();
        let digest = Digest::from_header(&block.header);

        let mut fin = Finalization::new(test_version(), digest, 0, 0);
        fin.add_signature([1u8; 32], vec![]);
        automaton.finalize(block.clone(), fin.clone()).unwrap();

        // Should be able to retrieve finalized data
        assert_eq!(automaton.get_block(0), Some(&block));
        assert_eq!(automaton.get_finalization(0), Some(&fin));
        assert!(automaton.get_receipts(0).is_some());
    }

    #[test]
    fn test_simplex_automaton_state_root_changes() {
        let config = SimplexConfig {
            version: test_version(),
            proposer_id: [0xAA; 32],
            validator_count: 1,
        };
        let mut automaton = SimplexAutomaton::new(config);

        let initial_state_root = automaton.state_root();

        // Propose and finalize genesis
        let body = BlockBody::empty();
        let block = automaton.propose(0, Digest::ZERO, &body).unwrap();
        let digest = Digest::from_header(&block.header);

        let mut fin = Finalization::new(test_version(), digest, 0, 0);
        fin.add_signature([1u8; 32], vec![]);
        automaton.finalize(block.clone(), fin).unwrap();

        // State root should have changed
        assert_ne!(automaton.state_root(), initial_state_root);
        assert_eq!(automaton.state_root(), block.header.state_root);
    }

    #[test]
    fn test_chain_state_at() {
        let state = ChainState::at(
            Digest::new([1u8; 32]),
            5,
            [2u8; 32],
        );

        assert_eq!(state.tip, Digest::new([1u8; 32]));
        assert_eq!(state.height, 5);
        assert_eq!(state.state_root, [2u8; 32]);
        assert!(state.has_genesis);
        assert_eq!(state.next_height(), 6);
    }

    #[test]
    fn test_chain_state_new() {
        let state = ChainState::new();

        assert_eq!(state.tip, Digest::ZERO);
        assert_eq!(state.height, 0);
        assert!(!state.has_genesis);
        assert_eq!(state.next_height(), 0);
    }

    #[test]
    fn test_marshal_receipt_roundtrip() {
        let receipt = Receipt::success([1u8; 32], [2u8; 32]);

        let encoded = Marshal::encode_receipt(&receipt).unwrap();
        let decoded = Marshal::decode_receipt(&encoded).unwrap();

        assert_eq!(receipt, decoded);
    }

    #[test]
    fn test_marshal_receipt_failure_roundtrip() {
        let receipt = Receipt::failure([1u8; 32], [2u8; 32], "test error");

        let encoded = Marshal::encode_receipt(&receipt).unwrap();
        let decoded = Marshal::decode_receipt(&encoded).unwrap();

        assert_eq!(receipt, decoded);
        assert_eq!(decoded.error, Some("test error".to_string()));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PersistentAutomaton Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_persistent_automaton_persists_finalized_blocks() {
        use crate::storage::InMemoryBlockStorage;

        let config = SimplexConfig {
            version: test_version(),
            proposer_id: [0xAA; 32],
            validator_count: 1,
        };
        let storage = InMemoryBlockStorage::new();
        let mut automaton = PersistentAutomaton::new(config, storage);

        // Propose and finalize genesis
        let body = BlockBody::empty();
        let block = automaton.propose(0, Digest::ZERO, &body).unwrap();
        let digest = Digest::from_header(&block.header);

        let mut fin = Finalization::new(test_version(), digest, 0, 0);
        fin.add_signature([1u8; 32], vec![0xBB; 64]);

        automaton.finalize(block.clone(), fin.clone()).unwrap();

        // Verify storage has the data
        assert!(automaton.storage().has_block(0));
        assert!(automaton.storage().has_finalization(0));
        assert!(automaton.storage().has_receipts(0));

        let chain_state = automaton.storage().get_chain_state().unwrap().unwrap();
        assert_eq!(chain_state.tip, digest);
        assert_eq!(chain_state.height, 0);
    }

    #[test]
    fn test_persistent_automaton_restore_from_storage() {
        use crate::storage::InMemoryBlockStorage;

        let config = SimplexConfig {
            version: test_version(),
            proposer_id: [0xAA; 32],
            validator_count: 1,
        };

        // First session: create and finalize blocks
        let storage = InMemoryBlockStorage::new();
        let mut automaton = PersistentAutomaton::new(config.clone(), storage);

        // Finalize genesis
        let body0 = BlockBody::empty();
        let block0 = automaton.propose(0, Digest::ZERO, &body0).unwrap();
        let digest0 = Digest::from_header(&block0.header);

        let mut fin0 = Finalization::new(test_version(), digest0, 0, 0);
        fin0.add_signature([1u8; 32], vec![]);
        automaton.finalize(block0.clone(), fin0).unwrap();

        // Finalize block 1
        let body1 = BlockBody::empty();
        let block1 = automaton.propose(1, digest0, &body1).unwrap();
        let digest1 = Digest::from_header(&block1.header);

        let mut fin1 = Finalization::new(test_version(), digest1, 1, 1);
        fin1.add_signature([1u8; 32], vec![]);
        automaton.finalize(block1.clone(), fin1).unwrap();

        // Extract storage for "restart"
        let (_inner, storage) = automaton.into_parts();

        // "Restart": restore from storage
        let restored = PersistentAutomaton::restore_or_new(config, storage).unwrap();

        // Verify state was recovered
        assert_eq!(restored.tip(), digest1);
        assert_eq!(restored.height(), 1);
        assert_eq!(restored.state_root(), block1.header.state_root);

        // Can access blocks from restored automaton
        assert!(restored.inner().get_block(0).is_some());
        assert!(restored.inner().get_block(1).is_some());
    }

    #[test]
    fn test_persistent_automaton_restore_empty_storage() {
        use crate::storage::InMemoryBlockStorage;

        let config = SimplexConfig {
            version: test_version(),
            proposer_id: [0xAA; 32],
            validator_count: 1,
        };
        let storage = InMemoryBlockStorage::new();

        // Restore from empty storage should create fresh automaton
        let automaton = PersistentAutomaton::restore_or_new(config, storage).unwrap();

        assert_eq!(automaton.tip(), Digest::ZERO);
        assert_eq!(automaton.height(), 0);
    }

    #[test]
    fn test_persistent_automaton_chain_continuation() {
        use crate::storage::InMemoryBlockStorage;

        let config = SimplexConfig {
            version: test_version(),
            proposer_id: [0xAA; 32],
            validator_count: 1,
        };

        // First session
        let storage = InMemoryBlockStorage::new();
        let mut automaton = PersistentAutomaton::new(config.clone(), storage);

        // Finalize genesis
        let body = BlockBody::empty();
        let block0 = automaton.propose(0, Digest::ZERO, &body).unwrap();
        let digest0 = Digest::from_header(&block0.header);

        let mut fin = Finalization::new(test_version(), digest0, 0, 0);
        fin.add_signature([1u8; 32], vec![]);
        automaton.finalize(block0.clone(), fin).unwrap();

        let (_, storage) = automaton.into_parts();

        // "Restart" and continue chain
        let mut restored = PersistentAutomaton::restore_or_new(config, storage).unwrap();

        // Should be able to propose and finalize block 1
        let body1 = BlockBody::empty();
        let block1 = restored.propose(1, digest0, &body1).unwrap();
        let digest1 = Digest::from_header(&block1.header);

        let mut fin1 = Finalization::new(test_version(), digest1, 1, 1);
        fin1.add_signature([1u8; 32], vec![]);
        restored.finalize(block1.clone(), fin1).unwrap();

        assert_eq!(restored.height(), 1);
        assert_eq!(restored.tip(), digest1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State Root Verification Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_verify_state_root_empty_storage() {
        use crate::storage::InMemoryBlockStorage;

        let config = SimplexConfig::default();
        let storage = InMemoryBlockStorage::new();
        let automaton = PersistentAutomaton::new(config, storage);

        // Empty storage should verify as Ok(true)
        assert!(automaton.verify_state_root().unwrap());
    }

    #[test]
    fn test_verify_state_root_after_finalization() {
        use crate::storage::InMemoryBlockStorage;

        let config = SimplexConfig {
            version: test_version(),
            proposer_id: [0xAA; 32],
            validator_count: 1,
        };
        let storage = InMemoryBlockStorage::new();
        let mut automaton = PersistentAutomaton::new(config, storage);

        // Finalize some blocks
        let body = BlockBody::empty();
        let block0 = automaton.propose(0, Digest::ZERO, &body).unwrap();
        let digest0 = Digest::from_header(&block0.header);

        let mut fin = Finalization::new(test_version(), digest0, 0, 0);
        fin.add_signature([1u8; 32], vec![]);
        automaton.finalize(block0, fin).unwrap();

        // State root should verify
        assert!(automaton.verify_state_root().unwrap());
    }

    #[test]
    fn test_verify_state_root_multi_block() {
        use crate::storage::InMemoryBlockStorage;

        let config = SimplexConfig {
            version: test_version(),
            proposer_id: [0xAA; 32],
            validator_count: 1,
        };
        let storage = InMemoryBlockStorage::new();
        let mut automaton = PersistentAutomaton::new(config, storage);

        // Finalize genesis
        let body0 = BlockBody::empty();
        let block0 = automaton.propose(0, Digest::ZERO, &body0).unwrap();
        let digest0 = Digest::from_header(&block0.header);

        let mut fin0 = Finalization::new(test_version(), digest0, 0, 0);
        fin0.add_signature([1u8; 32], vec![]);
        automaton.finalize(block0, fin0).unwrap();

        // Finalize block 1
        let body1 = BlockBody::empty();
        let block1 = automaton.propose(1, digest0, &body1).unwrap();
        let digest1 = Digest::from_header(&block1.header);

        let mut fin1 = Finalization::new(test_version(), digest1, 1, 1);
        fin1.add_signature([1u8; 32], vec![]);
        automaton.finalize(block1, fin1).unwrap();

        // Finalize block 2
        let body2 = BlockBody::empty();
        let block2 = automaton.propose(2, digest1, &body2).unwrap();
        let digest2 = Digest::from_header(&block2.header);

        let mut fin2 = Finalization::new(test_version(), digest2, 2, 2);
        fin2.add_signature([1u8; 32], vec![]);
        automaton.finalize(block2, fin2).unwrap();

        // State root should verify across all blocks
        assert!(automaton.verify_state_root().unwrap());
    }

    #[test]
    fn test_verify_state_root_after_restart() {
        use crate::storage::InMemoryBlockStorage;

        let config = SimplexConfig {
            version: test_version(),
            proposer_id: [0xAA; 32],
            validator_count: 1,
        };

        // First session: create blocks
        let storage = InMemoryBlockStorage::new();
        let mut automaton = PersistentAutomaton::new(config.clone(), storage);

        // Finalize some blocks
        let body0 = BlockBody::empty();
        let block0 = automaton.propose(0, Digest::ZERO, &body0).unwrap();
        let digest0 = Digest::from_header(&block0.header);

        let mut fin0 = Finalization::new(test_version(), digest0, 0, 0);
        fin0.add_signature([1u8; 32], vec![]);
        automaton.finalize(block0, fin0).unwrap();

        let body1 = BlockBody::empty();
        let block1 = automaton.propose(1, digest0, &body1).unwrap();
        let digest1 = Digest::from_header(&block1.header);

        let mut fin1 = Finalization::new(test_version(), digest1, 1, 1);
        fin1.add_signature([1u8; 32], vec![]);
        automaton.finalize(block1, fin1).unwrap();

        // Extract storage
        let (_, storage) = automaton.into_parts();

        // "Restart": restore and verify
        let restored = PersistentAutomaton::restore_or_new(config, storage).unwrap();

        // State root should still verify after restart
        assert!(restored.verify_state_root().unwrap());
    }

    #[test]
    fn test_restore_with_verification_success() {
        use crate::storage::InMemoryBlockStorage;

        let config = SimplexConfig {
            version: test_version(),
            proposer_id: [0xAA; 32],
            validator_count: 1,
        };

        // First session
        let storage = InMemoryBlockStorage::new();
        let mut automaton = PersistentAutomaton::new(config.clone(), storage);

        // Finalize genesis
        let body = BlockBody::empty();
        let block = automaton.propose(0, Digest::ZERO, &body).unwrap();
        let digest = Digest::from_header(&block.header);

        let mut fin = Finalization::new(test_version(), digest, 0, 0);
        fin.add_signature([1u8; 32], vec![]);
        automaton.finalize(block, fin).unwrap();

        let (_, storage) = automaton.into_parts();

        // Restore with verification should succeed
        let restored = PersistentAutomaton::restore_with_verification(
            config,
            NoOpExecutor,
            storage,
        ).unwrap();

        assert_eq!(restored.height(), 0);
    }

    #[test]
    fn test_restore_with_verification_empty_storage() {
        use crate::storage::InMemoryBlockStorage;

        let config = SimplexConfig::default();
        let storage = InMemoryBlockStorage::new();

        // Restore with verification on empty storage should succeed
        let automaton = PersistentAutomaton::restore_with_verification(
            config,
            NoOpExecutor,
            storage,
        ).unwrap();

        assert_eq!(automaton.tip(), Digest::ZERO);
    }
}
