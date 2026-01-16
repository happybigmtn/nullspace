//! Adversarial tests for protocol hardening.
//!
//! These tests verify the protocol correctly handles adversarial conditions:
//!
//! 1. **Missing reveal → timelock fallback**: When a player fails to reveal
//!    within `REVEAL_TTL`, the timelock fallback becomes available.
//!
//! 2. **Invalid proofs → rejection**: Malformed or invalid timelock proofs
//!    are rejected by the proof verifier.
//!
//! 3. **Altered commitment → detection**: Any modification to a deal commitment
//!    produces a different hash and fails verification.

#[cfg(test)]
mod tests {
    use crate::messages::{
        ActionLogValidator, ConsensusPayload, GameActionMessage, PayloadError,
        TimelockProofVerifier, TimelockVerificationInput, REVEAL_TTL,
    };
    use protocol_messages::{
        DealCommitment, DealCommitmentAck, ProtocolVersion, RevealPhase, RevealShare,
        ScopeBinding, ShuffleContext, TimelockReveal,
    };
    use std::sync::Arc;

    // ─────────────────────────────────────────────────────────────────────────────
    // Test Helpers
    // ─────────────────────────────────────────────────────────────────────────────

    fn test_scope() -> ScopeBinding {
        ScopeBinding::new([1u8; 32], 42, vec![0, 1, 2, 3], 52)
    }

    fn test_deal_commitment() -> DealCommitment {
        DealCommitment {
            version: ProtocolVersion::current(),
            scope: test_scope(),
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![[3u8; 32]],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![0xDE, 0xAD],
        }
    }

    /// Create a validator with commitment and all acks received.
    fn setup_validator_with_acks() -> (ActionLogValidator, [u8; 32]) {
        let dc = test_deal_commitment();
        let commitment_hash = dc.commitment_hash();
        let seats = dc.scope.seat_order.clone();

        let mut validator = ActionLogValidator::new();
        validator
            .validate(&ConsensusPayload::DealCommitment(dc))
            .unwrap();

        for seat in seats {
            let ack = DealCommitmentAck {
                version: ProtocolVersion::current(),
                commitment_hash,
                seat_index: seat,
                player_signature: vec![],
            };
            validator
                .validate(&ConsensusPayload::DealCommitmentAck(ack))
                .unwrap();
        }

        assert!(validator.all_acks_received());
        (validator, commitment_hash)
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. Missing Reveal → Timelock Fallback Tests
    // ─────────────────────────────────────────────────────────────────────────────

    /// Test: Timelock reveal is rejected before the timeout expires.
    #[test]
    fn test_timelock_rejected_before_timeout() {
        let (mut validator, commitment_hash) = setup_validator_with_acks();

        // Enter reveal-only phase for Preflop with timeout tracking
        let phase_start = 1700000000000u64;
        validator
            .enter_reveal_only_phase_with_timeout(RevealPhase::Preflop, phase_start, 0)
            .unwrap();

        // Create a valid timelock reveal
        let timelock = TimelockReveal {
            version: ProtocolVersion::current(),
            commitment_hash,
            phase: RevealPhase::Preflop,
            card_indices: vec![0, 1],
            timelock_proof: vec![0xAB, 0xCD], // Dummy proof
            revealed_values: vec![vec![0x01], vec![0x02]],
            timeout_seat: 0,
        };

        // Try to validate at various times before timeout
        for offset_ms in [0, 1000, 10_000, 29_000, REVEAL_TTL - 1] {
            let current_time = phase_start + offset_ms;
            let result = validator.validate_at_time(
                &ConsensusPayload::TimelockReveal(timelock.clone()),
                current_time,
            );

            assert!(
                matches!(result, Err(PayloadError::TimelockRevealBeforeTimeout { .. })),
                "timelock should be rejected at offset {}ms, got {:?}",
                offset_ms,
                result
            );
        }
    }

    /// Test: Timelock reveal is accepted exactly at timeout boundary.
    #[test]
    fn test_timelock_accepted_at_timeout_boundary() {
        let (mut validator, commitment_hash) = setup_validator_with_acks();

        // Enter reveal-only phase for Preflop with timeout tracking
        let phase_start = 1700000000000u64;
        validator
            .enter_reveal_only_phase_with_timeout(RevealPhase::Preflop, phase_start, 0)
            .unwrap();

        let timelock = TimelockReveal {
            version: ProtocolVersion::current(),
            commitment_hash,
            phase: RevealPhase::Preflop,
            card_indices: vec![0, 1],
            timelock_proof: vec![0xAB, 0xCD],
            revealed_values: vec![vec![0x01], vec![0x02]],
            timeout_seat: 0,
        };

        // At exactly TTL+1ms, timelock should be accepted
        let current_time = phase_start + REVEAL_TTL + 1;
        let result = validator.validate_at_time(
            &ConsensusPayload::TimelockReveal(timelock),
            current_time,
        );

        assert!(result.is_ok(), "timelock should be accepted after timeout: {:?}", result);
    }

    /// Test: Normal reveal share is still accepted after timeout (player was slow but not malicious).
    #[test]
    fn test_normal_reveal_still_accepted_after_timeout() {
        let (mut validator, commitment_hash) = setup_validator_with_acks();

        // Enter reveal-only phase with timeout tracking
        let phase_start = 1700000000000u64;
        validator
            .enter_reveal_only_phase_with_timeout(RevealPhase::Preflop, phase_start, 0)
            .unwrap();

        // Create a normal reveal share
        let reveal = RevealShare {
            version: ProtocolVersion::current(),
            commitment_hash,
            phase: RevealPhase::Preflop,
            card_indices: vec![0, 1],
            reveal_data: vec![vec![0x01], vec![0x02]],
            from_seat: 0,
            signature: vec![],
        };

        // Even after timeout, normal reveal should still work
        let current_time = phase_start + REVEAL_TTL + 5000;
        let result = validator.validate_at_time(
            &ConsensusPayload::RevealShare(reveal),
            current_time,
        );

        assert!(result.is_ok(), "normal reveal should still be accepted after timeout: {:?}", result);
    }

    /// Test: check_reveal_timeout correctly detects timeout condition.
    #[test]
    fn test_check_reveal_timeout_detection() {
        let (mut validator, commitment_hash) = setup_validator_with_acks();

        // First complete Preflop (required before entering Flop phase)
        let preflop_reveal = RevealShare {
            version: ProtocolVersion::current(),
            commitment_hash,
            phase: RevealPhase::Preflop,
            card_indices: vec![0, 1],
            reveal_data: vec![vec![0x01], vec![0x02]],
            from_seat: 0,
            signature: vec![],
        };
        validator
            .validate(&ConsensusPayload::RevealShare(preflop_reveal))
            .unwrap();

        let phase_start = 1700000000000u64;
        let expected_seat = 2u8;

        validator
            .enter_reveal_only_phase_with_timeout(RevealPhase::Flop, phase_start, expected_seat)
            .unwrap();

        // Before timeout: returns None
        let current_time = phase_start + REVEAL_TTL - 1000;
        assert!(validator.check_reveal_timeout(current_time).is_none());

        // After timeout: returns Some with elapsed time and timeout seat
        let current_time = phase_start + REVEAL_TTL + 5000;
        let result = validator.check_reveal_timeout(current_time);
        assert!(result.is_some());

        let (elapsed, seat) = result.unwrap();
        assert!(elapsed > REVEAL_TTL, "elapsed should be > REVEAL_TTL");
        assert_eq!(seat, expected_seat, "should return the expected timeout seat");
    }

    /// Test: Game actions are blocked during reveal-only phase.
    #[test]
    fn test_actions_blocked_during_reveal_phase() {
        let (mut validator, commitment_hash) = setup_validator_with_acks();

        // First complete Preflop (required before entering Flop phase)
        let preflop_reveal = RevealShare {
            version: ProtocolVersion::current(),
            commitment_hash,
            phase: RevealPhase::Preflop,
            card_indices: vec![0, 1],
            reveal_data: vec![vec![0x01], vec![0x02]],
            from_seat: 0,
            signature: vec![],
        };
        validator
            .validate(&ConsensusPayload::RevealShare(preflop_reveal))
            .unwrap();

        // Enter reveal-only phase for Flop
        validator
            .enter_reveal_only_phase(RevealPhase::Flop)
            .unwrap();

        // Try to submit a game action
        let action = GameActionMessage {
            version: ProtocolVersion::current(),
            deal_commitment_hash: commitment_hash,
            seat_index: 0,
            action_type: 1, // Check
            amount: 0,
            sequence: 0,
            signature: vec![],
        };

        let result = validator.validate(&ConsensusPayload::GameAction(action));
        assert!(
            matches!(result, Err(PayloadError::ActionDuringRevealOnlyPhase { expected_phase: RevealPhase::Flop })),
            "action should be blocked during reveal phase: {:?}",
            result
        );
    }

    /// Test: Timelock reveal without timeout tracking (backward compat).
    #[test]
    fn test_timelock_without_timeout_tracking_is_accepted() {
        let (mut validator, commitment_hash) = setup_validator_with_acks();

        // Enter reveal-only phase WITHOUT timeout tracking
        validator
            .enter_reveal_only_phase(RevealPhase::Preflop)
            .unwrap();

        let timelock = TimelockReveal {
            version: ProtocolVersion::current(),
            commitment_hash,
            phase: RevealPhase::Preflop,
            card_indices: vec![0, 1],
            timelock_proof: vec![0xAB],
            revealed_values: vec![vec![0x01], vec![0x02]],
            timeout_seat: 0,
        };

        // Without timeout tracking, timelock should be accepted immediately
        let result = validator.validate(&ConsensusPayload::TimelockReveal(timelock));
        assert!(result.is_ok(), "timelock should be accepted without timeout tracking: {:?}", result);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. Invalid Proofs → Rejection Tests
    // ─────────────────────────────────────────────────────────────────────────────

    /// A timelock verifier that rejects all proofs with a specific error message.
    #[derive(Debug)]
    struct RejectingTimelockVerifier {
        reason: String,
    }

    impl RejectingTimelockVerifier {
        fn new(reason: &str) -> Self {
            Self {
                reason: reason.to_string(),
            }
        }
    }

    impl TimelockProofVerifier for RejectingTimelockVerifier {
        fn verify_timelock_proof(
            &self,
            _input: &TimelockVerificationInput<'_>,
        ) -> Result<(), String> {
            Err(self.reason.clone())
        }
    }

    /// A timelock verifier that only accepts proofs with a specific magic prefix.
    #[derive(Debug)]
    struct MagicPrefixVerifier {
        magic: Vec<u8>,
    }

    impl MagicPrefixVerifier {
        fn new(magic: &[u8]) -> Self {
            Self {
                magic: magic.to_vec(),
            }
        }
    }

    impl TimelockProofVerifier for MagicPrefixVerifier {
        fn verify_timelock_proof(
            &self,
            input: &TimelockVerificationInput<'_>,
        ) -> Result<(), String> {
            if input.timelock_proof.starts_with(&self.magic) {
                Ok(())
            } else {
                Err(format!(
                    "proof must start with {:?}, got {:?}",
                    self.magic,
                    input.timelock_proof.get(0..self.magic.len())
                ))
            }
        }
    }

    /// Test: Rejecting verifier causes validation failure.
    #[test]
    fn test_invalid_proof_rejected_by_verifier() {
        let dc = test_deal_commitment();
        let commitment_hash = dc.commitment_hash();
        let seats = dc.scope.seat_order.clone();

        // Create validator with a rejecting verifier
        let verifier = Arc::new(RejectingTimelockVerifier::new("cryptographic verification failed"));
        let mut validator = ActionLogValidator::with_proof_verifier(verifier);

        validator
            .validate(&ConsensusPayload::DealCommitment(dc))
            .unwrap();

        for seat in seats {
            let ack = DealCommitmentAck {
                version: ProtocolVersion::current(),
                commitment_hash,
                seat_index: seat,
                player_signature: vec![],
            };
            validator
                .validate(&ConsensusPayload::DealCommitmentAck(ack))
                .unwrap();
        }

        let timelock = TimelockReveal {
            version: ProtocolVersion::current(),
            commitment_hash,
            phase: RevealPhase::Preflop,
            card_indices: vec![0, 1],
            timelock_proof: vec![0xDE, 0xAD, 0xBE, 0xEF],
            revealed_values: vec![vec![0x01], vec![0x02]],
            timeout_seat: 0,
        };

        let result = validator.validate(&ConsensusPayload::TimelockReveal(timelock));
        assert!(
            matches!(result, Err(PayloadError::TimelockProofInvalid { ref reason }) if reason == "cryptographic verification failed"),
            "invalid proof should be rejected: {:?}",
            result
        );
    }

    /// Test: Valid proof passes when verifier accepts it.
    #[test]
    fn test_valid_proof_accepted_by_verifier() {
        let dc = test_deal_commitment();
        let commitment_hash = dc.commitment_hash();
        let seats = dc.scope.seat_order.clone();

        // Create validator with a magic prefix verifier
        let magic = vec![0xCA, 0xFE, 0xBA, 0xBE];
        let verifier = Arc::new(MagicPrefixVerifier::new(&magic));
        let mut validator = ActionLogValidator::with_proof_verifier(verifier);

        validator
            .validate(&ConsensusPayload::DealCommitment(dc))
            .unwrap();

        for seat in seats {
            let ack = DealCommitmentAck {
                version: ProtocolVersion::current(),
                commitment_hash,
                seat_index: seat,
                player_signature: vec![],
            };
            validator
                .validate(&ConsensusPayload::DealCommitmentAck(ack))
                .unwrap();
        }

        // Timelock with correct magic prefix
        let timelock = TimelockReveal {
            version: ProtocolVersion::current(),
            commitment_hash,
            phase: RevealPhase::Preflop,
            card_indices: vec![0, 1],
            timelock_proof: vec![0xCA, 0xFE, 0xBA, 0xBE, 0x00, 0x01], // Correct magic
            revealed_values: vec![vec![0x01], vec![0x02]],
            timeout_seat: 0,
        };

        let result = validator.validate(&ConsensusPayload::TimelockReveal(timelock));
        assert!(result.is_ok(), "valid proof should be accepted: {:?}", result);
    }

    /// Test: Wrong magic prefix is rejected.
    #[test]
    fn test_wrong_magic_prefix_rejected() {
        let dc = test_deal_commitment();
        let commitment_hash = dc.commitment_hash();
        let seats = dc.scope.seat_order.clone();

        let magic = vec![0xCA, 0xFE, 0xBA, 0xBE];
        let verifier = Arc::new(MagicPrefixVerifier::new(&magic));
        let mut validator = ActionLogValidator::with_proof_verifier(verifier);

        validator
            .validate(&ConsensusPayload::DealCommitment(dc))
            .unwrap();

        for seat in seats {
            let ack = DealCommitmentAck {
                version: ProtocolVersion::current(),
                commitment_hash,
                seat_index: seat,
                player_signature: vec![],
            };
            validator
                .validate(&ConsensusPayload::DealCommitmentAck(ack))
                .unwrap();
        }

        // Timelock with WRONG magic prefix
        let timelock = TimelockReveal {
            version: ProtocolVersion::current(),
            commitment_hash,
            phase: RevealPhase::Preflop,
            card_indices: vec![0, 1],
            timelock_proof: vec![0xDE, 0xAD, 0xBE, 0xEF], // Wrong magic
            revealed_values: vec![vec![0x01], vec![0x02]],
            timeout_seat: 0,
        };

        let result = validator.validate(&ConsensusPayload::TimelockReveal(timelock));
        assert!(
            matches!(result, Err(PayloadError::TimelockProofInvalid { .. })),
            "wrong magic prefix should be rejected: {:?}",
            result
        );
    }

    /// Test: Timelock with mismatched card indices and revealed values is rejected.
    #[test]
    fn test_timelock_card_value_mismatch_rejected() {
        let (mut validator, commitment_hash) = setup_validator_with_acks();

        // Timelock with 3 card indices but only 2 revealed values
        let timelock = TimelockReveal {
            version: ProtocolVersion::current(),
            commitment_hash,
            phase: RevealPhase::Preflop,
            card_indices: vec![0, 1, 2],        // 3 indices
            timelock_proof: vec![0xAB],
            revealed_values: vec![vec![0x01], vec![0x02]], // Only 2 values
            timeout_seat: 0,
        };

        let result = validator.validate(&ConsensusPayload::TimelockReveal(timelock));
        assert!(
            matches!(result, Err(PayloadError::TimelockCardValueMismatch { indices_count: 3, values_count: 2 })),
            "mismatched counts should be rejected: {:?}",
            result
        );
    }

    /// Test: Timelock with card index out of bounds is rejected.
    #[test]
    fn test_timelock_card_index_out_of_bounds_rejected() {
        let (mut validator, commitment_hash) = setup_validator_with_acks();

        // Deck length is 52, so index 55 is out of bounds
        let timelock = TimelockReveal {
            version: ProtocolVersion::current(),
            commitment_hash,
            phase: RevealPhase::Preflop,
            card_indices: vec![0, 55], // 55 > 52
            timelock_proof: vec![0xAB],
            revealed_values: vec![vec![0x01], vec![0x02]],
            timeout_seat: 0,
        };

        let result = validator.validate(&ConsensusPayload::TimelockReveal(timelock));
        assert!(
            matches!(result, Err(PayloadError::TimelockCardIndexOutOfBounds { index: 55, deck_length: 52 })),
            "out of bounds index should be rejected: {:?}",
            result
        );
    }

    /// Test: Timelock with revealed values but missing proof is rejected.
    #[test]
    fn test_timelock_missing_proof_rejected() {
        let (mut validator, commitment_hash) = setup_validator_with_acks();

        // Timelock with revealed values but empty proof
        let timelock = TimelockReveal {
            version: ProtocolVersion::current(),
            commitment_hash,
            phase: RevealPhase::Preflop,
            card_indices: vec![0, 1],
            timelock_proof: vec![], // Empty proof
            revealed_values: vec![vec![0x01], vec![0x02]], // Has values
            timeout_seat: 0,
        };

        let result = validator.validate(&ConsensusPayload::TimelockReveal(timelock));
        assert!(
            matches!(result, Err(PayloadError::TimelockMissingProof { values_count: 2 })),
            "missing proof should be rejected: {:?}",
            result
        );
    }

    /// Test: Timelock with invalid timeout seat is rejected.
    #[test]
    fn test_timelock_invalid_timeout_seat_rejected() {
        let (mut validator, commitment_hash) = setup_validator_with_acks();

        // Seat 99 is not in the seat_order [0, 1, 2, 3]
        let timelock = TimelockReveal {
            version: ProtocolVersion::current(),
            commitment_hash,
            phase: RevealPhase::Preflop,
            card_indices: vec![0, 1],
            timelock_proof: vec![0xAB],
            revealed_values: vec![vec![0x01], vec![0x02]],
            timeout_seat: 99, // Invalid seat
        };

        let result = validator.validate(&ConsensusPayload::TimelockReveal(timelock));
        assert!(
            matches!(result, Err(PayloadError::InvalidTimelockTimeoutSeat { seat: 99, .. })),
            "invalid timeout seat should be rejected: {:?}",
            result
        );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. Altered Commitment → Detection Tests
    // ─────────────────────────────────────────────────────────────────────────────

    /// Test: Changing any field in commitment changes the hash.
    #[test]
    fn test_altered_commitment_produces_different_hash() {
        let original = test_deal_commitment();
        let original_hash = original.commitment_hash();

        // Test 1: Alter shuffle_commitment
        {
            let mut altered = original.clone();
            altered.shuffle_commitment = [99u8; 32];
            assert_ne!(
                altered.commitment_hash(),
                original_hash,
                "changing shuffle_commitment must change hash"
            );
        }

        // Test 2: Alter table_id in scope
        {
            let mut altered = original.clone();
            altered.scope.table_id = [99u8; 32];
            assert_ne!(
                altered.commitment_hash(),
                original_hash,
                "changing table_id must change hash"
            );
        }

        // Test 3: Alter hand_id in scope
        {
            let mut altered = original.clone();
            altered.scope.hand_id = 9999;
            assert_ne!(
                altered.commitment_hash(),
                original_hash,
                "changing hand_id must change hash"
            );
        }

        // Test 4: Alter seat_order in scope
        {
            let mut altered = original.clone();
            altered.scope.seat_order = vec![0, 1]; // Remove seats 2 and 3
            assert_ne!(
                altered.commitment_hash(),
                original_hash,
                "changing seat_order must change hash"
            );
        }

        // Test 5: Alter deck_length in scope
        {
            let mut altered = original.clone();
            altered.scope.deck_length = 36; // Short deck
            assert_ne!(
                altered.commitment_hash(),
                original_hash,
                "changing deck_length must change hash"
            );
        }

        // Test 6: Alter artifact_hashes
        {
            let mut altered = original.clone();
            altered.artifact_hashes = vec![[99u8; 32], [88u8; 32]];
            assert_ne!(
                altered.commitment_hash(),
                original_hash,
                "changing artifact_hashes must change hash"
            );
        }

        // Test 7: Alter timestamp_ms
        {
            let mut altered = original.clone();
            altered.timestamp_ms = 9999999999999;
            assert_ne!(
                altered.commitment_hash(),
                original_hash,
                "changing timestamp_ms must change hash"
            );
        }

        // Test 8: Alter protocol version
        {
            let mut altered = original.clone();
            altered.version = ProtocolVersion::new(99);
            assert_ne!(
                altered.commitment_hash(),
                original_hash,
                "changing version must change hash"
            );
        }
    }

    /// Test: Action with altered commitment hash is rejected.
    #[test]
    fn test_action_with_altered_commitment_rejected() {
        let (mut validator, original_hash) = setup_validator_with_acks();

        // Create action with a DIFFERENT commitment hash (as if attacker altered it)
        let mut altered_hash = original_hash;
        altered_hash[0] ^= 0xFF; // Flip bits in first byte

        let action = GameActionMessage {
            version: ProtocolVersion::current(),
            deal_commitment_hash: altered_hash, // Altered!
            seat_index: 0,
            action_type: 1,
            amount: 0,
            sequence: 0,
            signature: vec![],
        };

        let result = validator.validate(&ConsensusPayload::GameAction(action));
        assert!(
            matches!(result, Err(PayloadError::CommitmentHashMismatch { expected, got }) if expected == original_hash && got == altered_hash),
            "action with altered commitment should be rejected: {:?}",
            result
        );
    }

    /// Test: Reveal with altered commitment hash is rejected.
    #[test]
    fn test_reveal_with_altered_commitment_rejected() {
        let (mut validator, original_hash) = setup_validator_with_acks();

        // Enter reveal phase
        validator
            .enter_reveal_only_phase(RevealPhase::Preflop)
            .unwrap();

        // Create reveal with altered commitment hash
        let mut altered_hash = original_hash;
        altered_hash[31] ^= 0xFF;

        let reveal = RevealShare {
            version: ProtocolVersion::current(),
            commitment_hash: altered_hash, // Altered!
            phase: RevealPhase::Preflop,
            card_indices: vec![0, 1],
            reveal_data: vec![vec![0x01], vec![0x02]],
            from_seat: 0,
            signature: vec![],
        };

        let result = validator.validate(&ConsensusPayload::RevealShare(reveal));
        assert!(
            matches!(result, Err(PayloadError::CommitmentHashMismatch { .. })),
            "reveal with altered commitment should be rejected: {:?}",
            result
        );
    }

    /// Test: Ack with altered commitment hash is rejected.
    #[test]
    fn test_ack_with_altered_commitment_rejected() {
        let dc = test_deal_commitment();
        let original_hash = dc.commitment_hash();
        let mut altered_hash = original_hash;
        altered_hash[15] ^= 0xFF;

        let mut validator = ActionLogValidator::new();
        validator
            .validate(&ConsensusPayload::DealCommitment(dc))
            .unwrap();

        // First ack is valid
        let valid_ack = DealCommitmentAck {
            version: ProtocolVersion::current(),
            commitment_hash: original_hash,
            seat_index: 0,
            player_signature: vec![],
        };
        validator
            .validate(&ConsensusPayload::DealCommitmentAck(valid_ack))
            .unwrap();

        // Second ack has altered commitment hash
        let invalid_ack = DealCommitmentAck {
            version: ProtocolVersion::current(),
            commitment_hash: altered_hash,
            seat_index: 1,
            player_signature: vec![],
        };

        let result = validator.validate(&ConsensusPayload::DealCommitmentAck(invalid_ack));
        assert!(
            matches!(result, Err(PayloadError::CommitmentHashMismatch { .. })),
            "ack with altered commitment should be rejected: {:?}",
            result
        );
    }

    /// Test: Commitment with mismatched shuffle context is rejected.
    #[test]
    fn test_commitment_with_wrong_context_rejected() {
        // Expected context
        let expected = ShuffleContext::new(
            ProtocolVersion::current(),
            [1u8; 32],
            42,
            vec![0, 1, 2, 3],
            52,
        );

        // Commitment with WRONG hand_id
        let wrong_scope = ScopeBinding::new([1u8; 32], 999, vec![0, 1, 2, 3], 52);
        let wrong_commitment = DealCommitment {
            version: ProtocolVersion::current(),
            scope: wrong_scope,
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![],
        };

        let mut validator = ActionLogValidator::with_expected_context(expected);
        let result = validator.validate(&ConsensusPayload::DealCommitment(wrong_commitment));

        assert!(
            matches!(result, Err(PayloadError::ShuffleContextMismatch(_))),
            "commitment with wrong context should be rejected: {:?}",
            result
        );
    }

    /// Test: Commitment with mismatched seat order is rejected.
    #[test]
    fn test_commitment_with_wrong_seat_order_rejected() {
        let expected = ShuffleContext::new(
            ProtocolVersion::current(),
            [1u8; 32],
            42,
            vec![0, 1, 2, 3], // Expected seats
            52,
        );

        // Commitment with different seat order (missing seat 3)
        let wrong_scope = ScopeBinding::new([1u8; 32], 42, vec![0, 1, 2], 52);
        let wrong_commitment = DealCommitment {
            version: ProtocolVersion::current(),
            scope: wrong_scope,
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![],
        };

        let mut validator = ActionLogValidator::with_expected_context(expected);
        let result = validator.validate(&ConsensusPayload::DealCommitment(wrong_commitment));

        assert!(
            matches!(result, Err(PayloadError::ShuffleContextMismatch(_))),
            "commitment with wrong seat order should be rejected: {:?}",
            result
        );
    }

    /// Test: Cross-hand replay attack is prevented.
    #[test]
    fn test_cross_hand_replay_prevented() {
        // Commitment from hand 1
        let scope_hand1 = ScopeBinding::new([1u8; 32], 1, vec![0, 1], 52);
        let commitment_hand1 = DealCommitment {
            version: ProtocolVersion::current(),
            scope: scope_hand1,
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![],
        };
        let hash_hand1 = commitment_hand1.commitment_hash();

        // Setup validator for hand 2 with different hand_id
        let expected_hand2 = ShuffleContext::new(
            ProtocolVersion::current(),
            [1u8; 32],
            2, // Different hand
            vec![0, 1],
            52,
        );

        let mut validator = ActionLogValidator::with_expected_context(expected_hand2);

        // Try to replay hand 1's commitment on hand 2
        let result = validator.validate(&ConsensusPayload::DealCommitment(commitment_hand1));
        assert!(
            matches!(result, Err(PayloadError::ShuffleContextMismatch(_))),
            "cross-hand replay should be prevented: {:?}",
            result
        );

        // Action signed for hand 1 should also fail (if we had a validator for hand 2)
        // This is implicitly tested because the commitment would have different hash
        let scope_hand2 = ScopeBinding::new([1u8; 32], 2, vec![0, 1], 52);
        let commitment_hand2 = DealCommitment {
            version: ProtocolVersion::current(),
            scope: scope_hand2,
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![],
        };
        let hash_hand2 = commitment_hand2.commitment_hash();

        // Even with same shuffle_commitment, the hashes differ due to hand_id
        assert_ne!(
            hash_hand1, hash_hand2,
            "different hands must produce different commitment hashes"
        );
    }

    /// Test: Cross-table replay attack is prevented.
    #[test]
    fn test_cross_table_replay_prevented() {
        // Commitment from table A
        let scope_table_a = ScopeBinding::new([0xAA; 32], 1, vec![0, 1], 52);
        let commitment_table_a = DealCommitment {
            version: ProtocolVersion::current(),
            scope: scope_table_a,
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![],
        };

        // Setup validator expecting table B
        let expected_table_b = ShuffleContext::new(
            ProtocolVersion::current(),
            [0xBB; 32], // Different table
            1,
            vec![0, 1],
            52,
        );

        let mut validator = ActionLogValidator::with_expected_context(expected_table_b);

        // Try to replay table A's commitment on table B
        let result = validator.validate(&ConsensusPayload::DealCommitment(commitment_table_a));
        assert!(
            matches!(result, Err(PayloadError::ShuffleContextMismatch(_))),
            "cross-table replay should be prevented: {:?}",
            result
        );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Additional Edge Cases
    // ─────────────────────────────────────────────────────────────────────────────

    /// Test: Duplicate commitment is rejected.
    #[test]
    fn test_duplicate_commitment_rejected() {
        let dc1 = test_deal_commitment();
        let dc2 = test_deal_commitment();

        let mut validator = ActionLogValidator::new();
        validator
            .validate(&ConsensusPayload::DealCommitment(dc1))
            .unwrap();

        let result = validator.validate(&ConsensusPayload::DealCommitment(dc2));
        assert!(
            matches!(result, Err(PayloadError::DuplicateCommitment)),
            "duplicate commitment should be rejected: {:?}",
            result
        );
    }

    /// Test: Reveal phase ordering is enforced.
    #[test]
    fn test_reveal_phase_order_enforced() {
        let (mut validator, commitment_hash) = setup_validator_with_acks();

        // Must reveal Preflop first
        validator
            .enter_reveal_only_phase(RevealPhase::Preflop)
            .unwrap();

        // Trying to reveal Flop before Preflop should fail
        let flop_reveal = RevealShare {
            version: ProtocolVersion::current(),
            commitment_hash,
            phase: RevealPhase::Flop, // Wrong phase
            card_indices: vec![4, 5, 6],
            reveal_data: vec![vec![0x01], vec![0x02], vec![0x03]],
            from_seat: 0xFF,
            signature: vec![],
        };

        let result = validator.validate(&ConsensusPayload::RevealShare(flop_reveal));
        assert!(
            matches!(result, Err(PayloadError::RevealPhaseTooEarly { .. })),
            "out-of-order reveal should be rejected: {:?}",
            result
        );
    }

    /// Test: Duplicate reveal for same phase is rejected.
    #[test]
    fn test_duplicate_reveal_phase_rejected() {
        let (mut validator, commitment_hash) = setup_validator_with_acks();

        // First Preflop reveal succeeds
        let preflop1 = RevealShare {
            version: ProtocolVersion::current(),
            commitment_hash,
            phase: RevealPhase::Preflop,
            card_indices: vec![0, 1],
            reveal_data: vec![vec![0x01], vec![0x02]],
            from_seat: 0,
            signature: vec![],
        };
        validator
            .validate(&ConsensusPayload::RevealShare(preflop1))
            .unwrap();

        // Second Preflop reveal should fail
        let preflop2 = RevealShare {
            version: ProtocolVersion::current(),
            commitment_hash,
            phase: RevealPhase::Preflop,
            card_indices: vec![2, 3],
            reveal_data: vec![vec![0x03], vec![0x04]],
            from_seat: 1,
            signature: vec![],
        };

        let result = validator.validate(&ConsensusPayload::RevealShare(preflop2));
        assert!(
            matches!(result, Err(PayloadError::RevealPhaseAlreadyCompleted { phase: RevealPhase::Preflop })),
            "duplicate phase reveal should be rejected: {:?}",
            result
        );
    }
}
