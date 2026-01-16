//! Canonical message formats for protocol hardening.
//!
//! This crate defines the core message types for:
//! - Deal commitments and acknowledgments
//! - Selective card reveals
//! - Timelock fallback reveals
//! - Artifact requests
//!
//! All messages use deterministic encoding with domain separation
//! and are hashed using `blake3(encode(x))`.

mod payload;

pub use payload::{
    ArtifactRequest, ArtifactResponse, DealCommitment, DealCommitmentAck, ProtocolVersion,
    RevealPhase, RevealShare, ScopeBinding, TimelockReveal, CURRENT_PROTOCOL_VERSION,
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
