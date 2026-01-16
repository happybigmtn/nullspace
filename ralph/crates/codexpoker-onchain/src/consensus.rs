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
#[derive(Debug, Clone, Default)]
pub struct ChainState {
    /// Current chain tip digest (header hash of latest finalized block).
    /// `Digest::ZERO` if no blocks finalized yet.
    tip: Digest,

    /// Current block height (0 for genesis, increments with each block).
    height: u64,

    /// Current state root (application state commitment).
    state_root: [u8; 32],

    /// Whether genesis has been finalized.
    has_genesis: bool,
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
}
