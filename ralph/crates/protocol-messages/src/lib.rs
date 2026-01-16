//! Canonical message formats for protocol hardening.
//!
//! This crate defines the core message types for:
//! - Deal commitments and acknowledgments
//! - Selective card reveals
//! - Timelock fallback reveals
//! - Artifact requests
//!
//! # Canonical Hashing: `blake3(encode(x))`
//!
//! All messages use deterministic encoding and are hashed using the pattern
//! `blake3(encode(x))`. This approach ensures:
//!
//! 1. **Determinism**: The same logical message always produces the same hash,
//!    regardless of when or where it is computed.
//!
//! 2. **Domain separation**: Each message type has a unique domain prefix
//!    (e.g., `b"nullspace.deal_commitment.v1"`) prepended to its preimage.
//!    This prevents cross-protocol attacks where a valid message of type A
//!    could be misinterpreted as type B.
//!
//! 3. **Version binding**: The protocol version is explicitly included in
//!    the preimage, ensuring messages from different protocol versions
//!    cannot collide.
//!
//! ## Encoding Rules
//!
//! - **Fixed-size fields**: Encoded as raw bytes (e.g., `[u8; 32]` for hashes).
//! - **Integers**: Encoded as little-endian bytes.
//! - **Variable-length fields**: Prefixed with a length byte or u16/u32 as
//!   appropriate for the expected size range.
//! - **Signatures**: Excluded from preimages (signatures sign the preimage,
//!   not themselves).
//!
//! ## Example
//!
//! ```
//! use protocol_messages::{DealCommitment, ProtocolVersion, ScopeBinding};
//!
//! let scope = ScopeBinding::new([1u8; 32], 42, vec![0, 1, 2, 3], 52);
//! let commitment = DealCommitment {
//!     version: ProtocolVersion::current(),
//!     scope,
//!     shuffle_commitment: [2u8; 32],
//!     artifact_hashes: vec![[3u8; 32]],
//!     timestamp_ms: 1700000000000,
//!     dealer_signature: vec![],
//! };
//!
//! // Preimage is deterministic and domain-separated
//! let preimage = commitment.preimage();
//! assert!(preimage.starts_with(b"nullspace.deal_commitment.v1"));
//!
//! // Hash is computed as blake3(preimage)
//! let hash = commitment.commitment_hash();
//! assert_eq!(hash, protocol_messages::canonical_hash(&preimage));
//! ```
//!
//! # Scope Binding
//!
//! [`ScopeBinding`] prevents replay attacks by binding messages to a specific
//! context. A scope includes:
//!
//! - **`table_id`**: Unique identifier for the game table/room.
//! - **`hand_id`**: Sequential hand number within the table session.
//! - **`seat_order`**: Ordered list of player seats participating in the hand.
//! - **`deck_length`**: Number of cards in the deck (typically 52).
//!
//! This binding ensures that:
//! - A commitment from table A cannot be replayed on table B.
//! - A commitment from hand 1 cannot be replayed on hand 2.
//! - A commitment with players [A, B, C] cannot be used for players [A, D].
//!
//! ## Verification
//!
//! When verifying a message, the verifier must:
//! 1. Reconstruct the expected scope from the current game state.
//! 2. Compare it against the scope embedded in the message.
//! 3. Reject if they don't match exactly (byte-for-byte).
//!
//! This is critical for deterministic replay: given the same ordered log,
//! verification must succeed or fail identically across all validators.

mod payload;
pub mod exports;

pub use payload::{
    ArtifactRequest, ArtifactResponse, DealCommitment, DealCommitmentAck, ProtocolVersion,
    ProtocolVersionError, RevealPhase, RevealShare, ScopeBinding, ShuffleContext,
    ShuffleContextMismatch, TimelockReveal,
    // Version constants for protocol compatibility
    CURRENT_PROTOCOL_VERSION, MIN_SUPPORTED_PROTOCOL_VERSION, MAX_SUPPORTED_PROTOCOL_VERSION,
    // Size bounds for DoS protection
    MAX_SEATS, MAX_ARTIFACT_HASHES, MAX_REVEAL_CARDS, MAX_REVEAL_DATA_SIZE,
    MAX_TIMELOCK_PROOF_SIZE, MAX_SIGNATURE_SIZE, MAX_ARTIFACT_SIZE,
    // Domain prefixes for message hashing
    domain,
};

/// Re-export blake3 for consumers who need consistent hashing.
pub use blake3;

/// Canonical hash of an encodable message.
///
/// Uses `blake3(encode(x))` as specified in the protocol hardening spec.
pub fn canonical_hash(data: &[u8]) -> [u8; 32] {
    blake3::hash(data).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_canonical_hash_deterministic() {
        let data = b"test payload";
        let hash1 = canonical_hash(data);
        let hash2 = canonical_hash(data);
        assert_eq!(hash1, hash2, "canonical hash must be deterministic");
    }

    #[test]
    fn test_canonical_hash_different_inputs() {
        let hash1 = canonical_hash(b"input A");
        let hash2 = canonical_hash(b"input B");
        assert_ne!(hash1, hash2, "different inputs must produce different hashes");
    }
}
