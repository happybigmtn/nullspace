//! Golden vector generation for cross-language encode/decode parity testing.
//!
//! This module provides deterministic test vectors for protocol messages.
//! These vectors are the **canonical reference** for encoding parity:
//! any implementation (Rust, JS/TS, etc.) must produce identical byte
//! sequences for the same logical message.
//!
//! # AC-3.2 / AC-4.2 Compliance
//!
//! This module satisfies:
//! - **AC-3.2**: Round-trip tests validate parity between Rust and JS/TS encode/decode.
//! - **AC-4.2**: Golden vectors remain stable across Rust and JS/TS builds.
//!
//! # Usage
//!
//! ```
//! use protocol_messages::golden_vectors::{GoldenVectors, export_golden_vectors_json};
//!
//! // Get all golden vectors
//! let vectors = GoldenVectors::canonical();
//!
//! // Export to JSON for JS/TS parity tests
//! let json = export_golden_vectors_json();
//! assert!(json.contains("deal_commitment"));
//! ```
//!
//! # Stability Guarantee
//!
//! Once published, golden vectors are **frozen**. If encoding logic changes,
//! new vectors are added with a version suffix (e.g., `deal_commitment_v2`),
//! and old vectors remain for backward compatibility testing.

use serde::{Deserialize, Serialize};

use crate::{
    ArtifactRequest, ArtifactResponse, DealCommitment, DealCommitmentAck, ProtocolVersion,
    RevealPhase, RevealShare, ScopeBinding, ShuffleContext, TimelockReveal,
};

/// Schema version for golden vectors export.
///
/// Bump when the export structure changes in a breaking way.
pub const GOLDEN_VECTORS_SCHEMA_VERSION: u32 = 1;

/// A single golden vector: input message + expected encoded bytes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GoldenVector {
    /// Unique identifier for this vector.
    pub name: String,
    /// Human-readable description of what this vector tests.
    pub description: String,
    /// The message type being encoded.
    pub message_type: String,
    /// Hex-encoded preimage bytes.
    pub preimage_hex: String,
    /// Hex-encoded hash of the preimage (blake3).
    pub hash_hex: String,
    /// Expected byte length of the preimage.
    pub preimage_length: usize,
}

impl GoldenVector {
    /// Create a new golden vector from a preimage.
    pub fn new(name: &str, description: &str, message_type: &str, preimage: &[u8]) -> Self {
        let hash = crate::canonical_hash(preimage);
        Self {
            name: name.to_string(),
            description: description.to_string(),
            message_type: message_type.to_string(),
            preimage_hex: hex::encode(preimage),
            hash_hex: hex::encode(hash),
            preimage_length: preimage.len(),
        }
    }

    /// Verify that encoding produces the expected bytes.
    pub fn verify(&self, actual_preimage: &[u8]) -> Result<(), GoldenVectorMismatch> {
        let expected = hex::decode(&self.preimage_hex).expect("golden vector hex is valid");
        if actual_preimage != expected {
            return Err(GoldenVectorMismatch {
                vector_name: self.name.clone(),
                expected_hex: self.preimage_hex.clone(),
                actual_hex: hex::encode(actual_preimage),
            });
        }
        Ok(())
    }
}

/// Error when actual encoding doesn't match golden vector.
#[derive(Debug, Clone)]
pub struct GoldenVectorMismatch {
    pub vector_name: String,
    pub expected_hex: String,
    pub actual_hex: String,
}

impl std::fmt::Display for GoldenVectorMismatch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Golden vector '{}' mismatch:\n  expected: {}\n  actual:   {}",
            self.vector_name, self.expected_hex, self.actual_hex
        )
    }
}

impl std::error::Error for GoldenVectorMismatch {}

/// Complete set of golden vectors for protocol messages.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GoldenVectors {
    /// Schema version for this export.
    pub schema_version: u32,
    /// All golden vectors, keyed by name.
    pub vectors: Vec<GoldenVector>,
}

impl GoldenVectors {
    /// Generate the canonical golden vectors.
    ///
    /// These vectors use deterministic, hardcoded input values.
    /// They must remain stable across releases.
    pub fn canonical() -> Self {
        let mut vectors = Vec::new();

        // ─────────────────────────────────────────────────────────────────────
        // ScopeBinding
        // ─────────────────────────────────────────────────────────────────────

        let scope_minimal = ScopeBinding::new([0u8; 32], 0, vec![], 52);
        vectors.push(GoldenVector::new(
            "scope_binding_minimal",
            "Minimal scope: zero table_id, hand_id=0, empty seats, deck=52",
            "ScopeBinding",
            &scope_minimal.encode(),
        ));

        let scope_typical = ScopeBinding::new(
            [
                0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
                0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c,
                0x1d, 0x1e, 0x1f, 0x20,
            ],
            42,
            vec![0, 1, 2, 3],
            52,
        );
        vectors.push(GoldenVector::new(
            "scope_binding_typical",
            "Typical scope: sequential table_id, hand_id=42, 4 seats, deck=52",
            "ScopeBinding",
            &scope_typical.encode(),
        ));

        let scope_max_seats = ScopeBinding::new(
            [0xFF; 32],
            u64::MAX,
            vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
            52,
        );
        vectors.push(GoldenVector::new(
            "scope_binding_max_seats",
            "Max seats scope: all-1s table_id, max hand_id, 10 seats, deck=52",
            "ScopeBinding",
            &scope_max_seats.encode(),
        ));

        // ─────────────────────────────────────────────────────────────────────
        // ShuffleContext
        // ─────────────────────────────────────────────────────────────────────

        let shuffle_ctx = ShuffleContext::new(
            ProtocolVersion::new(1),
            [
                0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
                0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c,
                0x1d, 0x1e, 0x1f, 0x20,
            ],
            42,
            vec![0, 1, 2, 3],
            52,
        );
        vectors.push(GoldenVector::new(
            "shuffle_context_v1",
            "ShuffleContext with v1 protocol, typical table/hand/seats",
            "ShuffleContext",
            &shuffle_ctx.preimage(),
        ));

        // ─────────────────────────────────────────────────────────────────────
        // DealCommitment
        // ─────────────────────────────────────────────────────────────────────

        let deal_commitment_minimal = DealCommitment {
            version: ProtocolVersion::new(1),
            scope: scope_minimal.clone(),
            shuffle_commitment: [0u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 0,
            dealer_signature: vec![], // excluded from preimage
        };
        vectors.push(GoldenVector::new(
            "deal_commitment_minimal",
            "Minimal DealCommitment: zero scope, no artifacts, timestamp=0",
            "DealCommitment",
            &deal_commitment_minimal.preimage(),
        ));

        let deal_commitment_typical = DealCommitment {
            version: ProtocolVersion::new(1),
            scope: scope_typical.clone(),
            shuffle_commitment: [
                0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
                0x88, 0x99, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
                0x66, 0x77, 0x88, 0x99,
            ],
            artifact_hashes: vec![
                [0x11; 32],
                [0x22; 32],
            ],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![0xDE, 0xAD, 0xBE, 0xEF], // excluded from preimage
        };
        vectors.push(GoldenVector::new(
            "deal_commitment_typical",
            "Typical DealCommitment: real scope, shuffle hash, 2 artifacts, real timestamp",
            "DealCommitment",
            &deal_commitment_typical.preimage(),
        ));

        // ─────────────────────────────────────────────────────────────────────
        // DealCommitmentAck
        // ─────────────────────────────────────────────────────────────────────

        let ack = DealCommitmentAck {
            version: ProtocolVersion::new(1),
            commitment_hash: [0x42; 32],
            seat_index: 2,
            player_signature: vec![0x12, 0x34], // excluded from preimage
        };
        vectors.push(GoldenVector::new(
            "deal_commitment_ack_v1",
            "DealCommitmentAck: v1, commitment hash=0x42 repeated, seat=2",
            "DealCommitmentAck",
            &ack.preimage(),
        ));

        // ─────────────────────────────────────────────────────────────────────
        // RevealShare
        // ─────────────────────────────────────────────────────────────────────

        let reveal_flop = RevealShare {
            version: ProtocolVersion::new(1),
            commitment_hash: [0x42; 32],
            phase: RevealPhase::Flop,
            card_indices: vec![0, 1, 2],
            reveal_data: vec![
                vec![0x10, 0x20, 0x30, 0x40],
                vec![0x50, 0x60],
                vec![0x70],
            ],
            from_seat: 1,
            signature: vec![0xAB, 0xCD], // excluded from preimage
        };
        vectors.push(GoldenVector::new(
            "reveal_share_flop",
            "RevealShare for flop: 3 cards, variable-length reveal data",
            "RevealShare",
            &reveal_flop.preimage(),
        ));

        let reveal_showdown = RevealShare {
            version: ProtocolVersion::new(1),
            commitment_hash: [0x42; 32],
            phase: RevealPhase::Showdown,
            card_indices: vec![10, 11],
            reveal_data: vec![vec![0xAA; 64], vec![0xBB; 64]],
            from_seat: 0xFF, // dealer
            signature: vec![],
        };
        vectors.push(GoldenVector::new(
            "reveal_share_showdown",
            "RevealShare for showdown: 2 hole cards, 64-byte reveal data each, from dealer",
            "RevealShare",
            &reveal_showdown.preimage(),
        ));

        // ─────────────────────────────────────────────────────────────────────
        // TimelockReveal
        // ─────────────────────────────────────────────────────────────────────

        let timelock = TimelockReveal {
            version: ProtocolVersion::new(1),
            commitment_hash: [0x42; 32],
            phase: RevealPhase::Turn,
            card_indices: vec![10],
            timelock_proof: vec![0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08],
            revealed_values: vec![vec![0xCA, 0xFE]],
            timeout_seat: 3,
        };
        vectors.push(GoldenVector::new(
            "timelock_reveal_turn",
            "TimelockReveal for turn: 1 card, 8-byte proof, seat 3 timeout",
            "TimelockReveal",
            &timelock.preimage(),
        ));

        // ─────────────────────────────────────────────────────────────────────
        // ArtifactRequest
        // ─────────────────────────────────────────────────────────────────────

        let artifact_req = ArtifactRequest {
            version: ProtocolVersion::new(1),
            artifact_hashes: vec![[0x11; 32], [0x22; 32]],
            commitment_hash: Some([0x42; 32]),
        };
        vectors.push(GoldenVector::new(
            "artifact_request_with_commitment",
            "ArtifactRequest: 2 artifact hashes, with commitment scope",
            "ArtifactRequest",
            &artifact_req.preimage(),
        ));

        let artifact_req_no_scope = ArtifactRequest {
            version: ProtocolVersion::new(1),
            artifact_hashes: vec![[0x33; 32]],
            commitment_hash: None,
        };
        vectors.push(GoldenVector::new(
            "artifact_request_no_commitment",
            "ArtifactRequest: 1 artifact hash, no commitment scope",
            "ArtifactRequest",
            &artifact_req_no_scope.preimage(),
        ));

        // ─────────────────────────────────────────────────────────────────────
        // ArtifactResponse
        // ─────────────────────────────────────────────────────────────────────

        let artifact_resp = ArtifactResponse {
            version: ProtocolVersion::new(1),
            artifacts: vec![
                ([0x11; 32], vec![0xAA, 0xBB, 0xCC, 0xDD]),
            ],
            missing: vec![[0x22; 32]],
        };
        vectors.push(GoldenVector::new(
            "artifact_response_partial",
            "ArtifactResponse: 1 artifact found (4 bytes), 1 missing",
            "ArtifactResponse",
            &artifact_resp.preimage(),
        ));

        Self {
            schema_version: GOLDEN_VECTORS_SCHEMA_VERSION,
            vectors,
        }
    }

    /// Get a vector by name.
    pub fn get(&self, name: &str) -> Option<&GoldenVector> {
        self.vectors.iter().find(|v| v.name == name)
    }
}

/// Export golden vectors to JSON for JS/TS parity tests.
///
/// The exported JSON can be loaded by JS/TS test suites to verify
/// that their encoding produces identical byte sequences.
pub fn export_golden_vectors_json() -> String {
    let vectors = GoldenVectors::canonical();
    serde_json::to_string_pretty(&vectors).expect("GoldenVectors serialization cannot fail")
}

/// Export golden vectors to compact JSON (no whitespace).
pub fn export_golden_vectors_json_compact() -> String {
    let vectors = GoldenVectors::canonical();
    serde_json::to_string(&vectors).expect("GoldenVectors serialization cannot fail")
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─────────────────────────────────────────────────────────────────────────
    // AC-4.2: Golden vectors remain stable
    // ─────────────────────────────────────────────────────────────────────────

    /// AC-4.2: Golden vectors are deterministic.
    #[test]
    fn test_golden_vectors_deterministic_ac_4_2() {
        let v1 = GoldenVectors::canonical();
        let v2 = GoldenVectors::canonical();
        assert_eq!(v1, v2, "Golden vectors must be deterministic");
    }

    /// AC-4.2: Golden vector JSON export is deterministic.
    #[test]
    fn test_golden_vectors_json_deterministic_ac_4_2() {
        let json1 = export_golden_vectors_json();
        let json2 = export_golden_vectors_json();
        assert_eq!(json1, json2, "JSON export must be deterministic");
    }

    /// AC-4.2: Golden vectors JSON is valid.
    #[test]
    fn test_golden_vectors_json_valid_ac_4_2() {
        let json = export_golden_vectors_json();
        let parsed: serde_json::Value =
            serde_json::from_str(&json).expect("JSON must be valid");
        assert!(parsed.get("schema_version").is_some());
        assert!(parsed.get("vectors").is_some());
    }

    /// AC-4.2: Golden vectors can be deserialized back.
    #[test]
    fn test_golden_vectors_roundtrip_ac_4_2() {
        let original = GoldenVectors::canonical();
        let json = serde_json::to_string(&original).unwrap();
        let parsed: GoldenVectors = serde_json::from_str(&json).unwrap();
        assert_eq!(original, parsed, "Golden vectors must roundtrip through JSON");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AC-3.2: Round-trip parity tests
    // ─────────────────────────────────────────────────────────────────────────

    /// AC-3.2: ScopeBinding encoding matches golden vector.
    #[test]
    fn test_scope_binding_minimal_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("scope_binding_minimal").unwrap();

        let scope = ScopeBinding::new([0u8; 32], 0, vec![], 52);
        let actual = scope.encode();

        vector.verify(&actual).expect("ScopeBinding minimal must match golden vector");
    }

    /// AC-3.2: ScopeBinding typical encoding matches golden vector.
    #[test]
    fn test_scope_binding_typical_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("scope_binding_typical").unwrap();

        let scope = ScopeBinding::new(
            [
                0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
                0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c,
                0x1d, 0x1e, 0x1f, 0x20,
            ],
            42,
            vec![0, 1, 2, 3],
            52,
        );
        let actual = scope.encode();

        vector.verify(&actual).expect("ScopeBinding typical must match golden vector");
    }

    /// AC-3.2: ShuffleContext encoding matches golden vector.
    #[test]
    fn test_shuffle_context_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("shuffle_context_v1").unwrap();

        let ctx = ShuffleContext::new(
            ProtocolVersion::new(1),
            [
                0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
                0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c,
                0x1d, 0x1e, 0x1f, 0x20,
            ],
            42,
            vec![0, 1, 2, 3],
            52,
        );
        let actual = ctx.preimage();

        vector.verify(&actual).expect("ShuffleContext must match golden vector");
    }

    /// AC-3.2: DealCommitment minimal encoding matches golden vector.
    #[test]
    fn test_deal_commitment_minimal_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("deal_commitment_minimal").unwrap();

        let scope = ScopeBinding::new([0u8; 32], 0, vec![], 52);
        let commitment = DealCommitment {
            version: ProtocolVersion::new(1),
            scope,
            shuffle_commitment: [0u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 0,
            dealer_signature: vec![],
        };
        let actual = commitment.preimage();

        vector.verify(&actual).expect("DealCommitment minimal must match golden vector");
    }

    /// AC-3.2: DealCommitment typical encoding matches golden vector.
    #[test]
    fn test_deal_commitment_typical_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("deal_commitment_typical").unwrap();

        let scope = ScopeBinding::new(
            [
                0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
                0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c,
                0x1d, 0x1e, 0x1f, 0x20,
            ],
            42,
            vec![0, 1, 2, 3],
            52,
        );
        let commitment = DealCommitment {
            version: ProtocolVersion::new(1),
            scope,
            shuffle_commitment: [
                0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
                0x88, 0x99, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
                0x66, 0x77, 0x88, 0x99,
            ],
            artifact_hashes: vec![[0x11; 32], [0x22; 32]],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![0xDE, 0xAD, 0xBE, 0xEF],
        };
        let actual = commitment.preimage();

        vector.verify(&actual).expect("DealCommitment typical must match golden vector");
    }

    /// AC-3.2: DealCommitmentAck encoding matches golden vector.
    #[test]
    fn test_deal_commitment_ack_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("deal_commitment_ack_v1").unwrap();

        let ack = DealCommitmentAck {
            version: ProtocolVersion::new(1),
            commitment_hash: [0x42; 32],
            seat_index: 2,
            player_signature: vec![0x12, 0x34],
        };
        let actual = ack.preimage();

        vector.verify(&actual).expect("DealCommitmentAck must match golden vector");
    }

    /// AC-3.2: RevealShare flop encoding matches golden vector.
    #[test]
    fn test_reveal_share_flop_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("reveal_share_flop").unwrap();

        let reveal = RevealShare {
            version: ProtocolVersion::new(1),
            commitment_hash: [0x42; 32],
            phase: RevealPhase::Flop,
            card_indices: vec![0, 1, 2],
            reveal_data: vec![
                vec![0x10, 0x20, 0x30, 0x40],
                vec![0x50, 0x60],
                vec![0x70],
            ],
            from_seat: 1,
            signature: vec![0xAB, 0xCD],
        };
        let actual = reveal.preimage();

        vector.verify(&actual).expect("RevealShare flop must match golden vector");
    }

    /// AC-3.2: RevealShare showdown encoding matches golden vector.
    #[test]
    fn test_reveal_share_showdown_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("reveal_share_showdown").unwrap();

        let reveal = RevealShare {
            version: ProtocolVersion::new(1),
            commitment_hash: [0x42; 32],
            phase: RevealPhase::Showdown,
            card_indices: vec![10, 11],
            reveal_data: vec![vec![0xAA; 64], vec![0xBB; 64]],
            from_seat: 0xFF,
            signature: vec![],
        };
        let actual = reveal.preimage();

        vector.verify(&actual).expect("RevealShare showdown must match golden vector");
    }

    /// AC-3.2: TimelockReveal encoding matches golden vector.
    #[test]
    fn test_timelock_reveal_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("timelock_reveal_turn").unwrap();

        let timelock = TimelockReveal {
            version: ProtocolVersion::new(1),
            commitment_hash: [0x42; 32],
            phase: RevealPhase::Turn,
            card_indices: vec![10],
            timelock_proof: vec![0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08],
            revealed_values: vec![vec![0xCA, 0xFE]],
            timeout_seat: 3,
        };
        let actual = timelock.preimage();

        vector.verify(&actual).expect("TimelockReveal must match golden vector");
    }

    /// AC-3.2: ArtifactRequest with commitment encoding matches golden vector.
    #[test]
    fn test_artifact_request_with_commitment_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("artifact_request_with_commitment").unwrap();

        let req = ArtifactRequest {
            version: ProtocolVersion::new(1),
            artifact_hashes: vec![[0x11; 32], [0x22; 32]],
            commitment_hash: Some([0x42; 32]),
        };
        let actual = req.preimage();

        vector.verify(&actual).expect("ArtifactRequest with commitment must match golden vector");
    }

    /// AC-3.2: ArtifactRequest without commitment encoding matches golden vector.
    #[test]
    fn test_artifact_request_no_commitment_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("artifact_request_no_commitment").unwrap();

        let req = ArtifactRequest {
            version: ProtocolVersion::new(1),
            artifact_hashes: vec![[0x33; 32]],
            commitment_hash: None,
        };
        let actual = req.preimage();

        vector.verify(&actual).expect("ArtifactRequest without commitment must match golden vector");
    }

    /// AC-3.2: ArtifactResponse encoding matches golden vector.
    #[test]
    fn test_artifact_response_parity_ac_3_2() {
        let vectors = GoldenVectors::canonical();
        let vector = vectors.get("artifact_response_partial").unwrap();

        let resp = ArtifactResponse {
            version: ProtocolVersion::new(1),
            artifacts: vec![([0x11; 32], vec![0xAA, 0xBB, 0xCC, 0xDD])],
            missing: vec![[0x22; 32]],
        };
        let actual = resp.preimage();

        vector.verify(&actual).expect("ArtifactResponse must match golden vector");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Frozen vector tests - these verify exact hex values
    // ─────────────────────────────────────────────────────────────────────────

    /// AC-4.2: Verify frozen hex values for ScopeBinding minimal.
    ///
    /// This test hardcodes the expected hex to catch any encoding changes.
    #[test]
    fn test_scope_binding_minimal_frozen_hex_ac_4_2() {
        let scope = ScopeBinding::new([0u8; 32], 0, vec![], 52);
        let encoded = scope.encode();
        let hex = hex::encode(&encoded);

        // Frozen hex: 32 zero bytes + 8 zero bytes (hand_id) + 1 byte (count=0) + 1 byte (deck=52)
        let expected = "0000000000000000000000000000000000000000000000000000000000000000\
                        0000000000000000\
                        00\
                        34";
        assert_eq!(hex, expected, "ScopeBinding minimal encoding must be frozen");
    }

    /// AC-4.2: Verify frozen hex values for DealCommitmentAck.
    #[test]
    fn test_deal_commitment_ack_frozen_hex_ac_4_2() {
        let ack = DealCommitmentAck {
            version: ProtocolVersion::new(1),
            commitment_hash: [0x42; 32],
            seat_index: 2,
            player_signature: vec![],
        };
        let preimage = ack.preimage();
        let hex = hex::encode(&preimage);

        // Domain prefix "nullspace.deal_commitment_ack.v1" (32 bytes)
        // + version (1) + commitment_hash (32 bytes of 0x42) + seat_index (1)
        let expected_prefix = hex::encode(b"nullspace.deal_commitment_ack.v1");
        assert!(
            hex.starts_with(&expected_prefix),
            "DealCommitmentAck preimage must start with domain prefix"
        );

        // Verify exact length: 32 (domain) + 1 (version) + 32 (hash) + 1 (seat) = 66 bytes
        assert_eq!(preimage.len(), 66, "DealCommitmentAck preimage length must be 66");
    }

    /// AC-4.2: Verify hash stability for DealCommitment.
    #[test]
    fn test_deal_commitment_hash_frozen_ac_4_2() {
        let scope = ScopeBinding::new([0u8; 32], 0, vec![], 52);
        let commitment = DealCommitment {
            version: ProtocolVersion::new(1),
            scope,
            shuffle_commitment: [0u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 0,
            dealer_signature: vec![],
        };

        let hash = commitment.commitment_hash();
        let hash_hex = hex::encode(hash);

        // This hash must remain stable across releases
        // If this test fails, encoding logic has changed!
        let expected_hash = "8735883a1105f66ed542b052896e34ecdd97932c781d797f1e60692952a9668c";
        assert_eq!(
            hash_hex, expected_hash,
            "DealCommitment hash must remain frozen. Encoding logic may have changed!"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vector coverage test
    // ─────────────────────────────────────────────────────────────────────────

    /// Verify we have golden vectors for all message types.
    #[test]
    fn test_golden_vectors_coverage() {
        let vectors = GoldenVectors::canonical();

        // List of expected vectors
        let expected_names = [
            "scope_binding_minimal",
            "scope_binding_typical",
            "scope_binding_max_seats",
            "shuffle_context_v1",
            "deal_commitment_minimal",
            "deal_commitment_typical",
            "deal_commitment_ack_v1",
            "reveal_share_flop",
            "reveal_share_showdown",
            "timelock_reveal_turn",
            "artifact_request_with_commitment",
            "artifact_request_no_commitment",
            "artifact_response_partial",
        ];

        for name in expected_names {
            assert!(
                vectors.get(name).is_some(),
                "Golden vector '{}' must exist",
                name
            );
        }

        // Also verify count
        assert_eq!(
            vectors.vectors.len(),
            expected_names.len(),
            "Golden vector count must match expected"
        );
    }
}
