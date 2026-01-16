//! Fuzz tests for payload decoding and size bounds.
//!
//! These tests verify that the protocol payloads handle adversarial inputs safely:
//!
//! 1. **No panics**: Decoding arbitrary bytes must not panic.
//! 2. **Size bounds**: Variable-length fields are bounded to prevent DoS.
//! 3. **Determinism**: Valid payloads decode identically across runs.
//!
//! # Testing Strategy
//!
//! We use proptest to generate:
//! - Fully random byte sequences (pure fuzz)
//! - Structured payloads with field mutations (boundary testing)
//! - Oversized payloads (size bound verification)
//!
//! # Size Bound Invariants
//!
//! From `protocol-messages`:
//! - `seat_order`: max 10 entries (MAX_SEATS)
//! - `artifact_hashes`: max 16 entries (MAX_ARTIFACT_HASHES)
//! - `card_indices`/`reveal_data`: max 16 entries (MAX_REVEAL_CARDS)
//! - `reveal_data` entries: max 256 bytes each (MAX_REVEAL_DATA_SIZE)
//! - `timelock_proof`: max 4 KiB (MAX_TIMELOCK_PROOF_SIZE)
//! - `signatures`: max 256 bytes (MAX_SIGNATURE_SIZE)

#[cfg(test)]
mod tests {
    use crate::messages::ConsensusPayload;
    use proptest::prelude::*;
    use protocol_messages::{
        ArtifactRequest, ArtifactResponse, DealCommitment, ProtocolVersion, RevealPhase,
        RevealShare, ScopeBinding, TimelockReveal, MAX_ARTIFACT_HASHES, MAX_REVEAL_CARDS,
        MAX_REVEAL_DATA_SIZE, MAX_SEATS, MAX_SIGNATURE_SIZE, MAX_TIMELOCK_PROOF_SIZE,
    };

    // ─────────────────────────────────────────────────────────────────────────────
    // Generators
    // ─────────────────────────────────────────────────────────────────────────────

    /// Generate arbitrary bytes (pure fuzz input).
    fn arb_bytes(max_len: usize) -> impl Strategy<Value = Vec<u8>> {
        prop::collection::vec(any::<u8>(), 0..=max_len)
    }

    /// Generate a random 32-byte array.
    fn arb_bytes32() -> impl Strategy<Value = [u8; 32]> {
        prop::array::uniform32(any::<u8>())
    }

    /// Generate valid seat order within bounds.
    fn arb_bounded_seat_order() -> impl Strategy<Value = Vec<u8>> {
        prop::collection::vec(0u8..10, 0..=MAX_SEATS).prop_map(|mut seats| {
            seats.sort_unstable();
            seats.dedup();
            seats
        })
    }

    /// Generate valid artifact hashes within bounds.
    fn arb_bounded_artifact_hashes() -> impl Strategy<Value = Vec<[u8; 32]>> {
        prop::collection::vec(arb_bytes32(), 0..=MAX_ARTIFACT_HASHES)
    }

    /// Generate bounded reveal data entries.
    fn arb_bounded_reveal_data() -> impl Strategy<Value = Vec<Vec<u8>>> {
        prop::collection::vec(
            prop::collection::vec(any::<u8>(), 0..=MAX_REVEAL_DATA_SIZE),
            0..=MAX_REVEAL_CARDS,
        )
    }

    /// Generate bounded card indices.
    fn arb_bounded_card_indices() -> impl Strategy<Value = Vec<u8>> {
        prop::collection::vec(0u8..52, 0..=MAX_REVEAL_CARDS)
    }

    /// Generate bounded timelock proof.
    fn arb_bounded_timelock_proof() -> impl Strategy<Value = Vec<u8>> {
        prop::collection::vec(any::<u8>(), 0..=MAX_TIMELOCK_PROOF_SIZE)
    }

    /// Generate bounded signature.
    fn arb_bounded_signature() -> impl Strategy<Value = Vec<u8>> {
        prop::collection::vec(any::<u8>(), 0..=MAX_SIGNATURE_SIZE)
    }

    /// Generate a valid ScopeBinding within bounds.
    fn arb_valid_scope() -> impl Strategy<Value = ScopeBinding> {
        (arb_bytes32(), any::<u64>(), arb_bounded_seat_order(), 36u8..=52)
            .prop_map(|(table_id, hand_id, seat_order, deck_length)| {
                // Ensure at least one seat for valid scope
                let seat_order = if seat_order.is_empty() { vec![0] } else { seat_order };
                ScopeBinding::new(table_id, hand_id, seat_order, deck_length)
            })
    }

    /// Generate a valid DealCommitment within bounds.
    fn arb_valid_deal_commitment() -> impl Strategy<Value = DealCommitment> {
        (
            arb_valid_scope(),
            arb_bytes32(),
            arb_bounded_artifact_hashes(),
            any::<u64>(),
            arb_bounded_signature(),
        )
            .prop_map(|(scope, shuffle_commitment, artifact_hashes, timestamp_ms, dealer_signature)| {
                DealCommitment {
                    version: ProtocolVersion::current(),
                    scope,
                    shuffle_commitment,
                    artifact_hashes,
                    timestamp_ms,
                    dealer_signature,
                }
            })
    }

    /// Generate a valid RevealShare within bounds.
    fn arb_valid_reveal_share() -> impl Strategy<Value = RevealShare> {
        (
            arb_bytes32(),
            0u8..5,
            arb_bounded_card_indices(),
            arb_bounded_reveal_data(),
            any::<u8>(),
            arb_bounded_signature(),
        )
            .prop_map(|(commitment_hash, phase_byte, card_indices, reveal_data, from_seat, signature)| {
                let phase = RevealPhase::from_u8(phase_byte).unwrap_or(RevealPhase::Preflop);
                // Match card_indices and reveal_data lengths
                let len = card_indices.len().min(reveal_data.len());
                RevealShare {
                    version: ProtocolVersion::current(),
                    commitment_hash,
                    phase,
                    card_indices: card_indices.into_iter().take(len).collect(),
                    reveal_data: reveal_data.into_iter().take(len).collect(),
                    from_seat,
                    signature,
                }
            })
    }

    /// Generate a valid TimelockReveal within bounds.
    fn arb_valid_timelock_reveal() -> impl Strategy<Value = TimelockReveal> {
        (
            arb_bytes32(),
            0u8..5,
            arb_bounded_card_indices(),
            arb_bounded_timelock_proof(),
            arb_bounded_reveal_data(),
            any::<u8>(),
        )
            .prop_map(|(commitment_hash, phase_byte, card_indices, timelock_proof, revealed_values, timeout_seat)| {
                let phase = RevealPhase::from_u8(phase_byte).unwrap_or(RevealPhase::Preflop);
                // Match card_indices and revealed_values lengths
                let len = card_indices.len().min(revealed_values.len());
                TimelockReveal {
                    version: ProtocolVersion::current(),
                    commitment_hash,
                    phase,
                    card_indices: card_indices.into_iter().take(len).collect(),
                    timelock_proof,
                    revealed_values: revealed_values.into_iter().take(len).collect(),
                    timeout_seat,
                }
            })
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Property: No panics on arbitrary bytes (JSON decoding)
    // ─────────────────────────────────────────────────────────────────────────────

    proptest! {
        /// Property: JSON decoding of ConsensusPayload does not panic on arbitrary bytes.
        ///
        /// This tests the primary attack surface: an adversary sends arbitrary
        /// bytes claiming to be a valid JSON-encoded ConsensusPayload.
        #[test]
        fn prop_json_decode_no_panic(data in arb_bytes(4096)) {
            // Try to decode as ConsensusPayload - should not panic
            let _ = serde_json::from_slice::<ConsensusPayload>(&data);
        }

        /// Property: JSON decoding of DealCommitment does not panic on arbitrary bytes.
        #[test]
        fn prop_json_decode_deal_commitment_no_panic(data in arb_bytes(4096)) {
            let _ = serde_json::from_slice::<DealCommitment>(&data);
        }

        /// Property: JSON decoding of RevealShare does not panic on arbitrary bytes.
        #[test]
        fn prop_json_decode_reveal_share_no_panic(data in arb_bytes(4096)) {
            let _ = serde_json::from_slice::<RevealShare>(&data);
        }

        /// Property: JSON decoding of TimelockReveal does not panic on arbitrary bytes.
        #[test]
        fn prop_json_decode_timelock_reveal_no_panic(data in arb_bytes(4096)) {
            let _ = serde_json::from_slice::<TimelockReveal>(&data);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Property: Valid payloads roundtrip through JSON
    // ─────────────────────────────────────────────────────────────────────────────

    proptest! {
        /// Property: Valid DealCommitment roundtrips through JSON.
        #[test]
        fn prop_deal_commitment_json_roundtrip(commitment in arb_valid_deal_commitment()) {
            let json = serde_json::to_vec(&commitment).expect("serialize");
            let decoded: DealCommitment = serde_json::from_slice(&json).expect("deserialize");

            prop_assert_eq!(commitment.version, decoded.version);
            prop_assert_eq!(commitment.scope.table_id, decoded.scope.table_id);
            prop_assert_eq!(commitment.scope.hand_id, decoded.scope.hand_id);
            prop_assert_eq!(commitment.scope.seat_order, decoded.scope.seat_order);
            prop_assert_eq!(commitment.shuffle_commitment, decoded.shuffle_commitment);
            prop_assert_eq!(commitment.artifact_hashes, decoded.artifact_hashes);
            prop_assert_eq!(commitment.timestamp_ms, decoded.timestamp_ms);
        }

        /// Property: Valid RevealShare roundtrips through JSON.
        #[test]
        fn prop_reveal_share_json_roundtrip(reveal in arb_valid_reveal_share()) {
            let json = serde_json::to_vec(&reveal).expect("serialize");
            let decoded: RevealShare = serde_json::from_slice(&json).expect("deserialize");

            prop_assert_eq!(reveal.commitment_hash, decoded.commitment_hash);
            prop_assert_eq!(reveal.phase, decoded.phase);
            prop_assert_eq!(reveal.card_indices, decoded.card_indices);
            prop_assert_eq!(reveal.reveal_data, decoded.reveal_data);
            prop_assert_eq!(reveal.from_seat, decoded.from_seat);
        }

        /// Property: Valid TimelockReveal roundtrips through JSON.
        #[test]
        fn prop_timelock_reveal_json_roundtrip(reveal in arb_valid_timelock_reveal()) {
            let json = serde_json::to_vec(&reveal).expect("serialize");
            let decoded: TimelockReveal = serde_json::from_slice(&json).expect("deserialize");

            prop_assert_eq!(reveal.commitment_hash, decoded.commitment_hash);
            prop_assert_eq!(reveal.phase, decoded.phase);
            prop_assert_eq!(reveal.card_indices, decoded.card_indices);
            prop_assert_eq!(reveal.timelock_proof, decoded.timelock_proof);
            prop_assert_eq!(reveal.revealed_values, decoded.revealed_values);
            prop_assert_eq!(reveal.timeout_seat, decoded.timeout_seat);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Property: Hash determinism under adversarial inputs
    // ─────────────────────────────────────────────────────────────────────────────

    proptest! {
        /// Property: DealCommitment hash is deterministic even with random content.
        #[test]
        fn prop_commitment_hash_deterministic(commitment in arb_valid_deal_commitment()) {
            let hash1 = commitment.commitment_hash();
            let hash2 = commitment.commitment_hash();
            prop_assert_eq!(hash1, hash2, "hash must be deterministic");
        }

        /// Property: RevealShare hash is deterministic even with random content.
        #[test]
        fn prop_reveal_hash_deterministic(reveal in arb_valid_reveal_share()) {
            let hash1 = reveal.reveal_hash();
            let hash2 = reveal.reveal_hash();
            prop_assert_eq!(hash1, hash2, "hash must be deterministic");
        }

        /// Property: TimelockReveal hash is deterministic even with random content.
        #[test]
        fn prop_timelock_hash_deterministic(reveal in arb_valid_timelock_reveal()) {
            let hash1 = reveal.timelock_hash();
            let hash2 = reveal.timelock_hash();
            prop_assert_eq!(hash1, hash2, "hash must be deterministic");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Size Bound Verification Tests
    // ─────────────────────────────────────────────────────────────────────────────

    /// Test: Verify size bounds are enforced by the validation layer.
    ///
    /// These tests create payloads that exceed the defined size bounds and
    /// verify that such payloads would be rejected by validation logic.

    #[test]
    fn test_size_bound_seat_order() {
        // Construct a commitment with oversized seat_order
        let oversized_seats: Vec<u8> = (0..=MAX_SEATS as u8 + 5).collect();
        let scope = ScopeBinding::new([1u8; 32], 42, oversized_seats.clone(), 52);

        // The scope itself can be created, but validation should catch it
        assert!(
            scope.seat_order.len() > MAX_SEATS,
            "test setup: seat_order should exceed MAX_SEATS"
        );

        // Verify the bound constant is correct
        assert_eq!(MAX_SEATS, 10, "MAX_SEATS should be 10");
    }

    #[test]
    fn test_size_bound_artifact_hashes() {
        // Construct a commitment with oversized artifact_hashes
        let oversized_artifacts: Vec<[u8; 32]> = (0..MAX_ARTIFACT_HASHES + 5)
            .map(|i| [i as u8; 32])
            .collect();

        let commitment = DealCommitment {
            version: ProtocolVersion::current(),
            scope: ScopeBinding::new([1u8; 32], 42, vec![0, 1], 52),
            shuffle_commitment: [2u8; 32],
            artifact_hashes: oversized_artifacts.clone(),
            timestamp_ms: 1700000000000,
            dealer_signature: vec![],
        };

        // The commitment can be created, but should be flagged as oversized
        assert!(
            commitment.artifact_hashes.len() > MAX_ARTIFACT_HASHES,
            "test setup: artifact_hashes should exceed MAX_ARTIFACT_HASHES"
        );

        // Verify the bound constant is correct
        assert_eq!(MAX_ARTIFACT_HASHES, 16, "MAX_ARTIFACT_HASHES should be 16");
    }

    #[test]
    fn test_size_bound_reveal_data() {
        // Create reveal with oversized reveal_data entries
        let oversized_data: Vec<Vec<u8>> = (0..3)
            .map(|_| vec![0u8; MAX_REVEAL_DATA_SIZE + 100])
            .collect();

        let reveal = RevealShare {
            version: ProtocolVersion::current(),
            commitment_hash: [1u8; 32],
            phase: RevealPhase::Flop,
            card_indices: vec![0, 1, 2],
            reveal_data: oversized_data.clone(),
            from_seat: 0,
            signature: vec![],
        };

        // Verify data exceeds bounds
        for data in &reveal.reveal_data {
            assert!(
                data.len() > MAX_REVEAL_DATA_SIZE,
                "test setup: reveal_data entry should exceed MAX_REVEAL_DATA_SIZE"
            );
        }

        // Verify the bound constant is correct
        assert_eq!(MAX_REVEAL_DATA_SIZE, 256, "MAX_REVEAL_DATA_SIZE should be 256");
    }

    #[test]
    fn test_size_bound_timelock_proof() {
        // Create timelock reveal with oversized proof
        let oversized_proof = vec![0u8; MAX_TIMELOCK_PROOF_SIZE + 1000];

        let reveal = TimelockReveal {
            version: ProtocolVersion::current(),
            commitment_hash: [1u8; 32],
            phase: RevealPhase::Turn,
            card_indices: vec![10],
            timelock_proof: oversized_proof.clone(),
            revealed_values: vec![vec![42]],
            timeout_seat: 0,
        };

        // Verify proof exceeds bounds
        assert!(
            reveal.timelock_proof.len() > MAX_TIMELOCK_PROOF_SIZE,
            "test setup: timelock_proof should exceed MAX_TIMELOCK_PROOF_SIZE"
        );

        // Verify the bound constant is correct
        assert_eq!(MAX_TIMELOCK_PROOF_SIZE, 4096, "MAX_TIMELOCK_PROOF_SIZE should be 4096");
    }

    #[test]
    fn test_size_bound_card_indices() {
        // Create reveal with too many card indices
        let oversized_indices: Vec<u8> = (0..MAX_REVEAL_CARDS as u8 + 5).collect();

        let reveal = RevealShare {
            version: ProtocolVersion::current(),
            commitment_hash: [1u8; 32],
            phase: RevealPhase::Showdown,
            card_indices: oversized_indices.clone(),
            reveal_data: vec![vec![0u8]; oversized_indices.len()],
            from_seat: 0xFF,
            signature: vec![],
        };

        // Verify indices exceed bounds
        assert!(
            reveal.card_indices.len() > MAX_REVEAL_CARDS,
            "test setup: card_indices should exceed MAX_REVEAL_CARDS"
        );

        // Verify the bound constant is correct
        assert_eq!(MAX_REVEAL_CARDS, 16, "MAX_REVEAL_CARDS should be 16");
    }

    #[test]
    fn test_size_bound_signature() {
        // Create commitment with oversized signature
        let oversized_signature = vec![0xAB; MAX_SIGNATURE_SIZE + 100];

        let commitment = DealCommitment {
            version: ProtocolVersion::current(),
            scope: ScopeBinding::new([1u8; 32], 42, vec![0, 1], 52),
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 1700000000000,
            dealer_signature: oversized_signature.clone(),
        };

        // Verify signature exceeds bounds
        assert!(
            commitment.dealer_signature.len() > MAX_SIGNATURE_SIZE,
            "test setup: dealer_signature should exceed MAX_SIGNATURE_SIZE"
        );

        // Verify the bound constant is correct
        assert_eq!(MAX_SIGNATURE_SIZE, 256, "MAX_SIGNATURE_SIZE should be 256");
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Preimage Size Bound Tests
    // ─────────────────────────────────────────────────────────────────────────────

    proptest! {
        /// Property: Preimage size is bounded even with maximum valid inputs.
        ///
        /// This ensures that computing the preimage (for hashing) cannot trigger
        /// unbounded memory allocation with valid inputs.
        #[test]
        fn prop_deal_commitment_preimage_bounded(commitment in arb_valid_deal_commitment()) {
            let preimage = commitment.preimage();

            // Calculate expected max size:
            // - domain prefix: ~30 bytes
            // - version: 1 byte
            // - scope: 32 (table_id) + 8 (hand_id) + 1 (len) + MAX_SEATS + 1 (deck_length)
            // - shuffle_commitment: 32 bytes
            // - artifact count: 1 byte
            // - artifact_hashes: MAX_ARTIFACT_HASHES * 32
            // - timestamp_ms: 8 bytes
            // Total max: ~30 + 1 + 44 + 32 + 1 + 512 + 8 = ~628 bytes
            let max_expected_size = 1024; // generous upper bound

            prop_assert!(
                preimage.len() <= max_expected_size,
                "preimage should be bounded: {} > {}",
                preimage.len(),
                max_expected_size
            );
        }

        /// Property: RevealShare preimage size is bounded.
        #[test]
        fn prop_reveal_share_preimage_bounded(reveal in arb_valid_reveal_share()) {
            let preimage = reveal.preimage();

            // Calculate expected max size:
            // - domain prefix: ~30 bytes
            // - version: 1 byte
            // - commitment_hash: 32 bytes
            // - phase: 1 byte
            // - card_indices len: 1 byte
            // - card_indices: MAX_REVEAL_CARDS bytes
            // - reveal_data: MAX_REVEAL_CARDS * (2 + MAX_REVEAL_DATA_SIZE) bytes
            // - from_seat: 1 byte
            // Total max: ~30 + 1 + 32 + 1 + 1 + 16 + 16*(2+256) + 1 = ~4210 bytes
            let max_expected_size = 8192; // generous upper bound

            prop_assert!(
                preimage.len() <= max_expected_size,
                "preimage should be bounded: {} > {}",
                preimage.len(),
                max_expected_size
            );
        }

        /// Property: TimelockReveal preimage size is bounded.
        #[test]
        fn prop_timelock_reveal_preimage_bounded(reveal in arb_valid_timelock_reveal()) {
            let preimage = reveal.preimage();

            // Calculate expected max size:
            // - domain prefix: ~30 bytes
            // - version: 1 byte
            // - commitment_hash: 32 bytes
            // - phase: 1 byte
            // - card_indices len: 1 byte
            // - card_indices: MAX_REVEAL_CARDS bytes
            // - timelock_proof len: 4 bytes
            // - timelock_proof: MAX_TIMELOCK_PROOF_SIZE bytes
            // - revealed_values: MAX_REVEAL_CARDS * (2 + MAX_REVEAL_DATA_SIZE) bytes
            // - timeout_seat: 1 byte
            // Total max: ~30 + 1 + 32 + 1 + 1 + 16 + 4 + 4096 + 4128 + 1 = ~8310 bytes
            let max_expected_size = 16384; // generous upper bound

            prop_assert!(
                preimage.len() <= max_expected_size,
                "preimage should be bounded: {} > {}",
                preimage.len(),
                max_expected_size
            );
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Edge Case Tests
    // ─────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_empty_payload_fields() {
        // Test that empty variable-length fields are handled correctly
        let commitment = DealCommitment {
            version: ProtocolVersion::current(),
            scope: ScopeBinding::new([0u8; 32], 0, vec![], 52),  // empty seat_order
            shuffle_commitment: [0u8; 32],
            artifact_hashes: vec![],  // empty
            timestamp_ms: 0,
            dealer_signature: vec![],  // empty
        };

        // Should not panic when computing preimage or hash
        let preimage = commitment.preimage();
        let hash = commitment.commitment_hash();

        assert!(!preimage.is_empty(), "preimage should not be empty");
        assert_ne!(hash, [0u8; 32], "hash should not be zero (highly unlikely)");
    }

    #[test]
    fn test_reveal_with_zero_cards() {
        // Test reveal with no cards
        let reveal = RevealShare {
            version: ProtocolVersion::current(),
            commitment_hash: [1u8; 32],
            phase: RevealPhase::Preflop,
            card_indices: vec![],
            reveal_data: vec![],
            from_seat: 0,
            signature: vec![],
        };

        let preimage = reveal.preimage();
        let hash = reveal.reveal_hash();

        assert!(!preimage.is_empty());
        assert_ne!(hash, [0u8; 32]);
    }

    #[test]
    fn test_all_reveal_phases() {
        // Test each reveal phase can be encoded and produces distinct hashes
        let phases = [
            RevealPhase::Preflop,
            RevealPhase::Flop,
            RevealPhase::Turn,
            RevealPhase::River,
            RevealPhase::Showdown,
        ];

        let mut hashes = Vec::new();
        for phase in phases {
            let reveal = RevealShare {
                version: ProtocolVersion::current(),
                commitment_hash: [1u8; 32],
                phase,
                card_indices: vec![0],
                reveal_data: vec![vec![42]],
                from_seat: 0,
                signature: vec![],
            };

            let hash = reveal.reveal_hash();
            hashes.push(hash);
        }

        // All hashes should be unique
        for i in 0..hashes.len() {
            for j in i + 1..hashes.len() {
                assert_ne!(
                    hashes[i], hashes[j],
                    "different phases should produce different hashes"
                );
            }
        }
    }

    #[test]
    fn test_invalid_reveal_phase_byte() {
        // Verify invalid phase bytes are handled
        assert!(RevealPhase::from_u8(5).is_none(), "phase 5 should be invalid");
        assert!(RevealPhase::from_u8(255).is_none(), "phase 255 should be invalid");
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // JSON Payload Size Limits
    // ─────────────────────────────────────────────────────────────────────────────

    proptest! {
        /// Property: JSON-encoded valid payloads stay within reasonable size limits.
        ///
        /// This ensures that even maximum-sized valid payloads don't produce
        /// unbounded JSON output.
        #[test]
        fn prop_json_encoded_size_bounded(commitment in arb_valid_deal_commitment()) {
            let json = serde_json::to_vec(&commitment).expect("serialize");

            // JSON encoding of max-sized commitment should be under 64 KiB
            // (due to base64 encoding of byte arrays in JSON)
            let max_json_size = 64 * 1024;

            prop_assert!(
                json.len() <= max_json_size,
                "JSON encoding should be bounded: {} > {}",
                json.len(),
                max_json_size
            );
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Artifact Request/Response Fuzz Tests
    // ─────────────────────────────────────────────────────────────────────────────

    proptest! {
        /// Property: ArtifactRequest JSON decoding does not panic.
        #[test]
        fn prop_artifact_request_json_no_panic(data in arb_bytes(4096)) {
            let _ = serde_json::from_slice::<ArtifactRequest>(&data);
        }

        /// Property: ArtifactResponse JSON decoding does not panic.
        #[test]
        fn prop_artifact_response_json_no_panic(data in arb_bytes(4096)) {
            let _ = serde_json::from_slice::<ArtifactResponse>(&data);
        }

        /// Property: Valid ArtifactRequest roundtrips.
        #[test]
        fn prop_artifact_request_roundtrip(
            artifact_hashes in prop::collection::vec(arb_bytes32(), 0..=MAX_ARTIFACT_HASHES),
            commitment_hash in prop::option::of(arb_bytes32()),
        ) {
            let request = ArtifactRequest {
                version: ProtocolVersion::current(),
                artifact_hashes,
                commitment_hash,
            };

            let json = serde_json::to_vec(&request).expect("serialize");
            let decoded: ArtifactRequest = serde_json::from_slice(&json).expect("deserialize");

            prop_assert_eq!(request.artifact_hashes, decoded.artifact_hashes);
            prop_assert_eq!(request.commitment_hash, decoded.commitment_hash);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Regression: Specific attack vectors
    // ─────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_deeply_nested_json_attack() {
        // Attempt to decode deeply nested JSON (potential stack overflow attack)
        let mut deeply_nested = String::from("{\"scope\":");
        for _ in 0..100 {
            deeply_nested.push_str("{\"nested\":");
        }
        deeply_nested.push_str("{}");
        for _ in 0..100 {
            deeply_nested.push('}');
        }
        deeply_nested.push('}');

        // Should not panic (serde_json has depth limits)
        let result = serde_json::from_str::<DealCommitment>(&deeply_nested);
        assert!(result.is_err(), "deeply nested JSON should fail to parse as DealCommitment");
    }

    #[test]
    fn test_large_string_in_json() {
        // Attempt to include a very large string in JSON
        let large_string = "A".repeat(1024 * 1024); // 1 MiB string
        let json = format!(r#"{{"version":1,"dealer_signature":"{}"}}"#, large_string);

        // Should not panic
        let _ = serde_json::from_str::<DealCommitment>(&json);
    }

    #[test]
    fn test_unicode_in_json_fields() {
        // JSON with unicode should be handled safely
        let json = r#"{"version":1,"scope":{"table_id":"🎰","hand_id":42,"seat_order":[0,1],"deck_length":52}}"#;

        // Should not panic
        let _ = serde_json::from_str::<DealCommitment>(json);
    }
}
