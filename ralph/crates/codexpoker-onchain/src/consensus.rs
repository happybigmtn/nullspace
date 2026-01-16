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

use crate::block::{Block, BlockBody, BlockHeader, Receipt};
use protocol_messages::ProtocolVersion;
use serde::{Deserialize, Serialize};
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
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
}
