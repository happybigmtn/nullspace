//! Block structures for chain history and state persistence.
//!
//! This module defines the block header, body, and receipt types used for
//! persisting chain history. These structures are designed to integrate with
//! Commonware's simplex consensus while maintaining deterministic replay.
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────────────┐
//! │                              Block                                       │
//! │  ┌───────────────────────────────────┐  ┌────────────────────────────┐  │
//! │  │           BlockHeader             │  │        BlockBody           │  │
//! │  │  ┌─────────────────────────────┐  │  │  ┌──────────────────────┐  │  │
//! │  │  │ height, parent_hash         │  │  │  │  ConsensusPayload[]  │  │  │
//! │  │  │ receipts_root, state_root   │  │  │  └──────────────────────┘  │  │
//! │  │  │ timestamp_ms, proposer      │  │  └────────────────────────────┘  │
//! │  │  └─────────────────────────────┘  │                                   │
//! │  └───────────────────────────────────┘                                   │
//! └─────────────────────────────────────────────────────────────────────────┘
//!                                    │
//!                                    ▼
//! ┌─────────────────────────────────────────────────────────────────────────┐
//! │                          Receipt[]                                       │
//! │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │
//! │  │ payload_hash    │  │ payload_hash    │  │ payload_hash    │  ...     │
//! │  │ success         │  │ success         │  │ success         │          │
//! │  │ post_state_root │  │ post_state_root │  │ post_state_root │          │
//! │  └─────────────────┘  └─────────────────┘  └─────────────────┘          │
//! └─────────────────────────────────────────────────────────────────────────┘
//! ```
//!
//! # Deterministic Replay
//!
//! Given the same ordered block sequence, all validators compute identical:
//! - Block hashes (from header preimages)
//! - Receipts roots (from receipt hashes)
//! - State roots (from payload execution)
//!
//! # Receipts Root
//!
//! The receipts root commits to all payload outcomes in a block. This enables:
//! - Light client verification without replaying all payloads
//! - Dispute resolution by proving a specific receipt
//! - Efficient state sync by comparing roots
//!
//! ## Computation
//!
//! For the initial implementation, receipts are chained linearly:
//! ```text
//! receipts_root = hash(r0 || hash(r1 || hash(r2 || ... || hash(rn || [0; 32]))))
//! ```
//!
//! This can be upgraded to a Merkle tree for O(log n) inclusion proofs.

use crate::ConsensusPayload;
use protocol_messages::ProtocolVersion;
use serde::{Deserialize, Serialize};

// ─────────────────────────────────────────────────────────────────────────────
// Domain Separation
// ─────────────────────────────────────────────────────────────────────────────

/// Domain separation prefixes for block-related hashing.
pub mod domain {
    /// Domain prefix for [`super::BlockHeader`] hashing.
    pub const BLOCK_HEADER: &[u8] = b"nullspace.block_header.v1";
    /// Domain prefix for [`super::BlockBody`] hashing.
    pub const BLOCK_BODY: &[u8] = b"nullspace.block_body.v1";
    /// Domain prefix for [`super::Receipt`] hashing.
    pub const RECEIPT: &[u8] = b"nullspace.receipt.v1";
}

// ─────────────────────────────────────────────────────────────────────────────
// BlockHeader
// ─────────────────────────────────────────────────────────────────────────────

/// A block header containing commitments to block contents and state.
///
/// The header is the minimal data structure needed to verify block validity
/// without processing all payloads. It contains:
///
/// - **Chain linking**: `parent_hash` creates an immutable chain
/// - **Content commitment**: `receipts_root` commits to all payload outcomes
/// - **State commitment**: `state_root` commits to the post-block state
///
/// # Genesis Block
///
/// The genesis block (height 0) has:
/// - `parent_hash = [0; 32]` (zero hash)
/// - `receipts_root` computed from any genesis payloads
/// - `state_root` from the initial state
///
/// # Deterministic Hashing
///
/// The header hash is computed as `blake3(preimage())` where the preimage
/// includes all fields except any external signatures. This ensures all
/// validators compute identical hashes for identical headers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockHeader {
    /// Protocol version for this block format.
    pub version: ProtocolVersion,

    /// Block height (0-indexed, genesis is height 0).
    pub height: u64,

    /// Hash of the parent block header.
    ///
    /// For the genesis block, this is `[0; 32]`.
    /// For all other blocks, this must equal the parent's `block_hash()`.
    pub parent_hash: [u8; 32],

    /// Merkle root of the receipts in this block.
    ///
    /// Commits to all payload execution outcomes. Computed from the receipts
    /// generated during block execution.
    pub receipts_root: [u8; 32],

    /// State root after applying all payloads in this block.
    ///
    /// This is the root of the state trie (or QMDB root) after executing
    /// all payloads in the block body.
    pub state_root: [u8; 32],

    /// Unix timestamp (milliseconds) when block was proposed.
    pub timestamp_ms: u64,

    /// Proposer identifier.
    ///
    /// Typically the proposer's public key or a derived identifier.
    /// Used for leader election verification in consensus.
    pub proposer: [u8; 32],
}

impl BlockHeader {
    /// Create a genesis block header.
    ///
    /// Genesis has height 0, zero parent hash, and uses provided roots.
    pub fn genesis(
        version: ProtocolVersion,
        receipts_root: [u8; 32],
        state_root: [u8; 32],
        timestamp_ms: u64,
        proposer: [u8; 32],
    ) -> Self {
        Self {
            version,
            height: 0,
            parent_hash: [0; 32],
            receipts_root,
            state_root,
            timestamp_ms,
            proposer,
        }
    }

    /// Create a new block header extending a parent.
    pub fn new(
        version: ProtocolVersion,
        height: u64,
        parent_hash: [u8; 32],
        receipts_root: [u8; 32],
        state_root: [u8; 32],
        timestamp_ms: u64,
        proposer: [u8; 32],
    ) -> Self {
        Self {
            version,
            height,
            parent_hash,
            receipts_root,
            state_root,
            timestamp_ms,
            proposer,
        }
    }

    /// Domain-separated preimage for hashing.
    ///
    /// The preimage encodes all header fields deterministically:
    /// ```text
    /// [domain][version][height][parent_hash][receipts_root][state_root][timestamp_ms][proposer]
    /// ```
    pub fn preimage(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(domain::BLOCK_HEADER.len() + 1 + 8 + 32 + 32 + 32 + 8 + 32);
        buf.extend_from_slice(domain::BLOCK_HEADER);
        buf.push(self.version.0);
        buf.extend_from_slice(&self.height.to_le_bytes());
        buf.extend_from_slice(&self.parent_hash);
        buf.extend_from_slice(&self.receipts_root);
        buf.extend_from_slice(&self.state_root);
        buf.extend_from_slice(&self.timestamp_ms.to_le_bytes());
        buf.extend_from_slice(&self.proposer);
        buf
    }

    /// Canonical hash of this block header.
    ///
    /// This is the block's unique identifier used in:
    /// - Child blocks' `parent_hash`
    /// - Block storage keys
    /// - Finalization certificates
    pub fn block_hash(&self) -> [u8; 32] {
        protocol_messages::canonical_hash(&self.preimage())
    }

    /// Check if this is a genesis block.
    pub fn is_genesis(&self) -> bool {
        self.height == 0 && self.parent_hash == [0; 32]
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// BlockBody
// ─────────────────────────────────────────────────────────────────────────────

/// The body of a block containing ordered consensus payloads.
///
/// A block body is the executable content of a block. When applied to the
/// state, each payload produces a receipt capturing its outcome.
///
/// # Ordering
///
/// Payloads are stored in execution order. The consensus layer determines
/// this order (typically proposer-determined within consensus rules).
///
/// # Empty Blocks
///
/// Empty blocks (with no payloads) are valid. They advance the chain and
/// can be used for heartbeats or epoch transitions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct BlockBody {
    /// Ordered list of consensus payloads in this block.
    pub payloads: Vec<ConsensusPayload>,
}

impl BlockBody {
    /// Create a new block body with the given payloads.
    pub fn new(payloads: Vec<ConsensusPayload>) -> Self {
        Self { payloads }
    }

    /// Create an empty block body.
    pub fn empty() -> Self {
        Self {
            payloads: Vec::new(),
        }
    }

    /// Domain-separated preimage for hashing.
    ///
    /// The preimage includes a count followed by each payload's referenced
    /// commitment hash (or a placeholder for DealCommitments).
    pub fn preimage(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(domain::BLOCK_BODY);
        // Encode payload count as u32
        buf.extend_from_slice(&(self.payloads.len() as u32).to_le_bytes());
        // For each payload, include its commitment hash reference
        for payload in &self.payloads {
            if let Some(hash) = payload.referenced_commitment_hash() {
                buf.extend_from_slice(&hash);
            } else {
                // Should not happen as all payload types have a commitment hash
                buf.extend_from_slice(&[0; 32]);
            }
        }
        buf
    }

    /// Canonical hash of this block body.
    pub fn body_hash(&self) -> [u8; 32] {
        protocol_messages::canonical_hash(&self.preimage())
    }

    /// Returns true if this body has no payloads.
    pub fn is_empty(&self) -> bool {
        self.payloads.is_empty()
    }

    /// Number of payloads in this body.
    pub fn len(&self) -> usize {
        self.payloads.len()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Block
// ─────────────────────────────────────────────────────────────────────────────

/// A complete block with header and body.
///
/// A block combines the header (commitments) with the body (content).
/// This is the unit of storage and transmission in the chain.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Block {
    /// The block header with commitments.
    pub header: BlockHeader,
    /// The block body with payloads.
    pub body: BlockBody,
}

impl Block {
    /// Create a new block from header and body.
    pub fn new(header: BlockHeader, body: BlockBody) -> Self {
        Self { header, body }
    }

    /// The block's canonical hash (from the header).
    pub fn block_hash(&self) -> [u8; 32] {
        self.header.block_hash()
    }

    /// Block height.
    pub fn height(&self) -> u64 {
        self.header.height
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Receipt
// ─────────────────────────────────────────────────────────────────────────────

/// Maximum length for receipt error messages.
///
/// Prevents unbounded allocations from malformed receipts.
pub const MAX_RECEIPT_ERROR_LEN: usize = 256;

/// A receipt capturing the outcome of executing a consensus payload.
///
/// Receipts are produced when payloads are applied to the state. They capture:
/// - Whether the payload succeeded or failed
/// - The state root after application (regardless of success/failure)
/// - An optional error message for failures
///
/// # State Root Semantics
///
/// The `post_state_root` always reflects the state AFTER attempting to apply
/// the payload:
/// - On success: state includes the payload's effects
/// - On failure: state is unchanged (transaction rolled back)
///
/// This allows verification that state transitions are deterministic even
/// when payloads fail validation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Receipt {
    /// Hash of the payload this receipt is for.
    ///
    /// Links the receipt to a specific payload in the block body.
    pub payload_hash: [u8; 32],

    /// Whether the payload was successfully applied.
    pub success: bool,

    /// State root after applying (or attempting to apply) this payload.
    pub post_state_root: [u8; 32],

    /// Optional error message if `success` is false.
    ///
    /// Truncated to [`MAX_RECEIPT_ERROR_LEN`] bytes if longer.
    pub error: Option<String>,
}

impl Receipt {
    /// Create a success receipt.
    pub fn success(payload_hash: [u8; 32], post_state_root: [u8; 32]) -> Self {
        Self {
            payload_hash,
            success: true,
            post_state_root,
            error: None,
        }
    }

    /// Create a failure receipt.
    ///
    /// The error message is truncated to [`MAX_RECEIPT_ERROR_LEN`] if needed.
    pub fn failure(payload_hash: [u8; 32], post_state_root: [u8; 32], error: impl Into<String>) -> Self {
        let mut error_str = error.into();
        if error_str.len() > MAX_RECEIPT_ERROR_LEN {
            error_str.truncate(MAX_RECEIPT_ERROR_LEN);
        }
        Self {
            payload_hash,
            success: false,
            post_state_root,
            error: Some(error_str),
        }
    }

    /// Domain-separated preimage for hashing.
    ///
    /// The preimage encodes:
    /// ```text
    /// [domain][payload_hash][success: 1 byte][post_state_root][error_len: 2 bytes][error]
    /// ```
    pub fn preimage(&self) -> Vec<u8> {
        let error_bytes = self.error.as_deref().unwrap_or("").as_bytes();
        let mut buf = Vec::with_capacity(domain::RECEIPT.len() + 32 + 1 + 32 + 2 + error_bytes.len());
        buf.extend_from_slice(domain::RECEIPT);
        buf.extend_from_slice(&self.payload_hash);
        buf.push(if self.success { 1 } else { 0 });
        buf.extend_from_slice(&self.post_state_root);
        buf.extend_from_slice(&(error_bytes.len() as u16).to_le_bytes());
        buf.extend_from_slice(error_bytes);
        buf
    }

    /// Canonical hash of this receipt.
    pub fn receipt_hash(&self) -> [u8; 32] {
        protocol_messages::canonical_hash(&self.preimage())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Receipts Root Computation
// ─────────────────────────────────────────────────────────────────────────────

/// Compute the receipts root from a list of receipts.
///
/// Uses a simple linear hash chain for the initial implementation:
/// ```text
/// root = hash(r0 || hash(r1 || hash(r2 || ... || hash(rn || [0; 32]))))
/// ```
///
/// For an empty receipt list, returns `[0; 32]`.
///
/// # Determinism
///
/// The receipts must be provided in execution order. Given the same receipts
/// in the same order, this function always produces the same root.
///
/// # Future Improvements
///
/// This can be upgraded to a Merkle tree for O(log n) inclusion proofs
/// without breaking existing block validation (new blocks would use the
/// new scheme, old blocks remain valid).
pub fn compute_receipts_root(receipts: &[Receipt]) -> [u8; 32] {
    if receipts.is_empty() {
        return [0; 32];
    }

    // Start from the end with a zero accumulator
    let mut acc = [0u8; 32];

    // Chain from right to left: hash(r_i || acc)
    for receipt in receipts.iter().rev() {
        let receipt_hash = receipt.receipt_hash();
        let mut combined = Vec::with_capacity(64);
        combined.extend_from_slice(&receipt_hash);
        combined.extend_from_slice(&acc);
        acc = protocol_messages::canonical_hash(&combined);
    }

    acc
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
    // BlockHeader Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_block_header_genesis() {
        let header = BlockHeader::genesis(
            test_version(),
            [1u8; 32],
            [2u8; 32],
            1700000000000,
            [3u8; 32],
        );

        assert!(header.is_genesis());
        assert_eq!(header.height, 0);
        assert_eq!(header.parent_hash, [0; 32]);
    }

    #[test]
    fn test_block_header_non_genesis() {
        let header = BlockHeader::new(
            test_version(),
            1,
            [0xAA; 32],
            [1u8; 32],
            [2u8; 32],
            1700000000000,
            [3u8; 32],
        );

        assert!(!header.is_genesis());
        assert_eq!(header.height, 1);
        assert_eq!(header.parent_hash, [0xAA; 32]);
    }

    #[test]
    fn test_block_header_hash_deterministic() {
        let header = BlockHeader::genesis(
            test_version(),
            [1u8; 32],
            [2u8; 32],
            1700000000000,
            [3u8; 32],
        );

        let hash1 = header.block_hash();
        let hash2 = header.block_hash();
        assert_eq!(hash1, hash2, "block hash must be deterministic");
    }

    #[test]
    fn test_block_header_preimage_includes_domain() {
        let header = BlockHeader::genesis(
            test_version(),
            [1u8; 32],
            [2u8; 32],
            1700000000000,
            [3u8; 32],
        );

        let preimage = header.preimage();
        assert!(
            preimage.starts_with(domain::BLOCK_HEADER),
            "header preimage must start with domain prefix"
        );
    }

    #[test]
    fn test_block_header_hash_changes_with_height() {
        let h1 = BlockHeader::new(
            test_version(),
            1,
            [0; 32],
            [1u8; 32],
            [2u8; 32],
            1700000000000,
            [3u8; 32],
        );
        let h2 = BlockHeader::new(
            test_version(),
            2,
            [0; 32],
            [1u8; 32],
            [2u8; 32],
            1700000000000,
            [3u8; 32],
        );

        assert_ne!(h1.block_hash(), h2.block_hash(), "different heights must produce different hashes");
    }

    #[test]
    fn test_block_header_hash_changes_with_receipts_root() {
        let h1 = BlockHeader::genesis(test_version(), [1u8; 32], [2u8; 32], 1700000000000, [3u8; 32]);
        let h2 = BlockHeader::genesis(test_version(), [9u8; 32], [2u8; 32], 1700000000000, [3u8; 32]);

        assert_ne!(h1.block_hash(), h2.block_hash(), "different receipts roots must produce different hashes");
    }

    #[test]
    fn test_block_header_hash_changes_with_state_root() {
        let h1 = BlockHeader::genesis(test_version(), [1u8; 32], [2u8; 32], 1700000000000, [3u8; 32]);
        let h2 = BlockHeader::genesis(test_version(), [1u8; 32], [9u8; 32], 1700000000000, [3u8; 32]);

        assert_ne!(h1.block_hash(), h2.block_hash(), "different state roots must produce different hashes");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BlockBody Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_block_body_empty() {
        let body = BlockBody::empty();
        assert!(body.is_empty());
        assert_eq!(body.len(), 0);
    }

    #[test]
    fn test_block_body_hash_deterministic() {
        let body = BlockBody::empty();
        let hash1 = body.body_hash();
        let hash2 = body.body_hash();
        assert_eq!(hash1, hash2, "body hash must be deterministic");
    }

    #[test]
    fn test_block_body_preimage_includes_domain() {
        let body = BlockBody::empty();
        let preimage = body.preimage();
        assert!(
            preimage.starts_with(domain::BLOCK_BODY),
            "body preimage must start with domain prefix"
        );
    }

    #[test]
    fn test_block_body_default_is_empty() {
        let body: BlockBody = Default::default();
        assert!(body.is_empty());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Receipt Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_receipt_success() {
        let receipt = Receipt::success([1u8; 32], [2u8; 32]);
        assert!(receipt.success);
        assert!(receipt.error.is_none());
    }

    #[test]
    fn test_receipt_failure() {
        let receipt = Receipt::failure([1u8; 32], [2u8; 32], "test error");
        assert!(!receipt.success);
        assert_eq!(receipt.error, Some("test error".to_string()));
    }

    #[test]
    fn test_receipt_failure_truncates_long_error() {
        let long_error = "x".repeat(MAX_RECEIPT_ERROR_LEN + 100);
        let receipt = Receipt::failure([1u8; 32], [2u8; 32], long_error);

        assert_eq!(
            receipt.error.as_ref().map(|e| e.len()),
            Some(MAX_RECEIPT_ERROR_LEN),
            "error must be truncated"
        );
    }

    #[test]
    fn test_receipt_hash_deterministic() {
        let receipt = Receipt::success([1u8; 32], [2u8; 32]);
        let hash1 = receipt.receipt_hash();
        let hash2 = receipt.receipt_hash();
        assert_eq!(hash1, hash2, "receipt hash must be deterministic");
    }

    #[test]
    fn test_receipt_preimage_includes_domain() {
        let receipt = Receipt::success([1u8; 32], [2u8; 32]);
        let preimage = receipt.preimage();
        assert!(
            preimage.starts_with(domain::RECEIPT),
            "receipt preimage must start with domain prefix"
        );
    }

    #[test]
    fn test_receipt_hash_differs_by_success() {
        let r1 = Receipt::success([1u8; 32], [2u8; 32]);
        let r2 = Receipt::failure([1u8; 32], [2u8; 32], "error");

        assert_ne!(r1.receipt_hash(), r2.receipt_hash(), "success/failure must produce different hashes");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Receipts Root Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_receipts_root_empty() {
        let root = compute_receipts_root(&[]);
        assert_eq!(root, [0; 32], "empty receipts must produce zero root");
    }

    #[test]
    fn test_receipts_root_deterministic() {
        let receipts = vec![
            Receipt::success([1u8; 32], [2u8; 32]),
            Receipt::success([3u8; 32], [4u8; 32]),
        ];

        let root1 = compute_receipts_root(&receipts);
        let root2 = compute_receipts_root(&receipts);
        assert_eq!(root1, root2, "receipts root must be deterministic");
    }

    #[test]
    fn test_receipts_root_order_matters() {
        let r1 = Receipt::success([1u8; 32], [2u8; 32]);
        let r2 = Receipt::success([3u8; 32], [4u8; 32]);

        let root_a = compute_receipts_root(&[r1.clone(), r2.clone()]);
        let root_b = compute_receipts_root(&[r2, r1]);

        assert_ne!(root_a, root_b, "receipt order must affect root");
    }

    #[test]
    fn test_receipts_root_single_receipt() {
        let receipt = Receipt::success([1u8; 32], [2u8; 32]);
        let root = compute_receipts_root(&[receipt.clone()]);

        // For a single receipt: hash(receipt_hash || [0; 32])
        let mut expected_input = Vec::new();
        expected_input.extend_from_slice(&receipt.receipt_hash());
        expected_input.extend_from_slice(&[0; 32]);
        let expected_root = protocol_messages::canonical_hash(&expected_input);

        assert_eq!(root, expected_root);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Block Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_block_creation() {
        let header = BlockHeader::genesis(
            test_version(),
            [1u8; 32],
            [2u8; 32],
            1700000000000,
            [3u8; 32],
        );
        let body = BlockBody::empty();
        let block = Block::new(header.clone(), body);

        assert_eq!(block.height(), 0);
        assert_eq!(block.block_hash(), header.block_hash());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Domain Separation Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_domains_are_unique() {
        assert_ne!(domain::BLOCK_HEADER, domain::BLOCK_BODY);
        assert_ne!(domain::BLOCK_HEADER, domain::RECEIPT);
        assert_ne!(domain::BLOCK_BODY, domain::RECEIPT);
    }
}
