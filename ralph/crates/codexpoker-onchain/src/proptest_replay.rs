//! Property tests for replay determinism and commitment binding.
//!
//! These tests verify the critical invariants of the consensus system:
//!
//! 1. **Replay Determinism**: Given the same ordered block/payload sequence,
//!    all validators produce identical state roots, receipts roots, and digests.
//!
//! 2. **Commitment Binding**: All game actions must reference the deal commitment
//!    hash from the hand's initial `DealCommitment`. Actions with wrong or missing
//!    commitment bindings are rejected.
//!
//! # Property Test Strategy
//!
//! Property tests generate random inputs (block sequences, actions, commitment
//! parameters) and verify that invariants hold across all generated cases.
//! This complements unit tests by exploring edge cases that manual tests miss.

#[cfg(test)]
mod tests {
    use crate::block::{compute_receipts_root, Block, BlockBody, BlockHeader, Receipt};
    use crate::consensus::{
        Automaton, Digest, Finalization, Marshal, SimplexAutomaton, SimplexConfig,
    };
    use crate::messages::{ActionLogValidator, ConsensusPayload, GameActionMessage, PayloadError};
    use protocol_messages::{
        DealCommitment, DealCommitmentAck, ProtocolVersion, ScopeBinding, CURRENT_PROTOCOL_VERSION,
    };
    use proptest::prelude::*;

    // ─────────────────────────────────────────────────────────────────────────────
    // Generators
    // ─────────────────────────────────────────────────────────────────────────────

    /// Generate a random 32-byte array.
    fn arb_bytes32() -> impl Strategy<Value = [u8; 32]> {
        prop::array::uniform32(any::<u8>())
    }

    /// Generate a random seat order (1-9 players, indices 0-8).
    fn arb_seat_order() -> impl Strategy<Value = Vec<u8>> {
        prop::collection::vec(0u8..9, 1..=9).prop_map(|mut seats| {
            // Deduplicate and ensure valid seat indices
            seats.sort_unstable();
            seats.dedup();
            if seats.is_empty() {
                vec![0]
            } else {
                seats
            }
        })
    }

    /// Generate a valid scope binding.
    fn arb_scope_binding() -> impl Strategy<Value = ScopeBinding> {
        (arb_bytes32(), any::<u64>(), arb_seat_order(), 36u8..=52)
            .prop_map(|(table_id, hand_id, seat_order, deck_length)| {
                ScopeBinding::new(table_id, hand_id, seat_order, deck_length)
            })
    }

    /// Generate a valid deal commitment.
    fn arb_deal_commitment() -> impl Strategy<Value = DealCommitment> {
        (
            arb_scope_binding(),
            arb_bytes32(),
            prop::collection::vec(arb_bytes32(), 0..4),
            any::<u64>(),
        )
            .prop_map(|(scope, shuffle_commitment, artifact_hashes, timestamp_ms)| {
                DealCommitment {
                    version: ProtocolVersion::current(),
                    scope,
                    shuffle_commitment,
                    artifact_hashes,
                    timestamp_ms,
                    dealer_signature: vec![0xDE, 0xAD],
                }
            })
    }

    /// Generate a block header with controlled parameters.
    fn arb_block_header(height: u64, parent_hash: [u8; 32]) -> impl Strategy<Value = BlockHeader> {
        (arb_bytes32(), arb_bytes32(), any::<u64>(), arb_bytes32()).prop_map(
            move |(receipts_root, state_root, timestamp_ms, proposer)| {
                BlockHeader::new(
                    ProtocolVersion::current(),
                    height,
                    parent_hash,
                    receipts_root,
                    state_root,
                    timestamp_ms,
                    proposer,
                )
            },
        )
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Property: Replay Determinism
    // ─────────────────────────────────────────────────────────────────────────────
    //
    // R2 from chain_history_commonware.md:
    // "Given the same block sequence, all validators compute identical state roots"

    proptest! {
        /// Property: Block header hash is deterministic.
        ///
        /// The same header must always produce the same hash.
        #[test]
        fn prop_block_header_hash_deterministic(
            height in 0u64..1000,
            parent_hash in arb_bytes32(),
        ) {
            let header_strat = arb_block_header(height, parent_hash);
            proptest!(|(header in header_strat)| {
                // Hash is stable
                let hash1 = header.block_hash();
                let hash2 = header.block_hash();
                prop_assert_eq!(hash1, hash2, "header hash must be deterministic");

                // Hash is also stable when computed via Digest
                let digest1 = Digest::from_header(&header);
                let digest2 = Digest::from_header(&header);
                prop_assert_eq!(digest1, digest2, "digest must be deterministic");
            });
        }

        /// Property: Receipt hash is deterministic.
        ///
        /// The same receipt must always produce the same hash.
        #[test]
        fn prop_receipt_hash_deterministic(
            payload_hash in arb_bytes32(),
            success in any::<bool>(),
            post_state_root in arb_bytes32(),
        ) {
            let receipt = if success {
                Receipt::success(payload_hash, post_state_root)
            } else {
                Receipt::failure(payload_hash, post_state_root, "test error")
            };

            let hash1 = receipt.receipt_hash();
            let hash2 = receipt.receipt_hash();
            prop_assert_eq!(hash1, hash2, "receipt hash must be deterministic");
        }

        /// Property: Receipts root is deterministic for same receipt sequence.
        ///
        /// Given the same receipts in the same order, the root must be identical.
        #[test]
        fn prop_receipts_root_deterministic(
            hashes in prop::collection::vec(arb_bytes32(), 0..10),
        ) {
            let receipts: Vec<Receipt> = hashes
                .iter()
                .map(|h| Receipt::success(*h, [0u8; 32]))
                .collect();

            let root1 = compute_receipts_root(&receipts);
            let root2 = compute_receipts_root(&receipts);
            prop_assert_eq!(root1, root2, "receipts root must be deterministic");
        }

        /// Property: Receipts root is order-sensitive.
        ///
        /// Changing the order of receipts must change the root (unless trivial).
        #[test]
        fn prop_receipts_root_order_sensitive(
            h1 in arb_bytes32(),
            h2 in arb_bytes32(),
        ) {
            prop_assume!(h1 != h2);

            let r1 = Receipt::success(h1, [1u8; 32]);
            let r2 = Receipt::success(h2, [2u8; 32]);

            let root_a = compute_receipts_root(&[r1.clone(), r2.clone()]);
            let root_b = compute_receipts_root(&[r2, r1]);

            prop_assert_ne!(root_a, root_b,
                "different receipt orderings must produce different roots");
        }

        /// Property: Simplex automaton produces deterministic state for same inputs.
        ///
        /// Two automatons with identical config, starting from the same initial state,
        /// processing the same blocks, must end up with identical state roots.
        #[test]
        fn prop_automaton_replay_deterministic(
            proposer_id in arb_bytes32(),
            num_blocks in 1usize..5,
        ) {
            let config = SimplexConfig {
                version: ProtocolVersion::new(CURRENT_PROTOCOL_VERSION),
                proposer_id,
                validator_count: 1,
            };

            let mut auto1 = SimplexAutomaton::new(config.clone());
            let mut auto2 = SimplexAutomaton::new(config);

            // Both start at same state
            prop_assert_eq!(auto1.state_root(), auto2.state_root());
            prop_assert_eq!(auto1.tip(), auto2.tip());

            // Build and finalize blocks on auto1
            let mut blocks = Vec::new();
            let mut parent = Digest::ZERO;

            for i in 0..num_blocks {
                let body = BlockBody::empty();
                let block = auto1.propose(i as u64, parent, &body).unwrap();
                let digest = Digest::from_header(&block.header);

                let mut fin = Finalization::new(
                    ProtocolVersion::new(CURRENT_PROTOCOL_VERSION),
                    digest,
                    i as u64,
                    i as u64,
                );
                fin.add_signature([1u8; 32], vec![]);
                auto1.finalize(block.clone(), fin.clone()).unwrap();

                blocks.push((block, fin));
                parent = digest;
            }

            // Replay same blocks on auto2
            for (block, fin) in blocks {
                auto2.finalize(block, fin).unwrap();
            }

            // Both must end at identical state
            prop_assert_eq!(auto1.state_root(), auto2.state_root(),
                "replayed automatons must have identical state roots");
            prop_assert_eq!(auto1.tip(), auto2.tip(),
                "replayed automatons must have identical tips");
            prop_assert_eq!(auto1.height(), auto2.height(),
                "replayed automatons must have identical heights");
        }

        /// Property: Block encoding is deterministic and reversible.
        ///
        /// Encoding a block and decoding it must produce an identical block.
        #[test]
        fn prop_block_marshal_roundtrip(
            height in 0u64..1000,
            parent_hash in arb_bytes32(),
            receipts_root in arb_bytes32(),
            state_root in arb_bytes32(),
            timestamp_ms in any::<u64>(),
            proposer in arb_bytes32(),
        ) {
            let header = BlockHeader::new(
                ProtocolVersion::current(),
                height,
                parent_hash,
                receipts_root,
                state_root,
                timestamp_ms,
                proposer,
            );
            let body = BlockBody::empty();
            let block = Block::new(header, body);
            let original_hash = block.block_hash();

            let encoded = Marshal::encode_block(&block).unwrap();
            let decoded = Marshal::decode_block(&encoded).unwrap();
            let decoded_hash = decoded.block_hash();

            // Compare hashes first (they're Copy)
            prop_assert_eq!(original_hash, decoded_hash,
                "block hash must be preserved through marshal");

            // Compare blocks by their headers (the key data)
            prop_assert_eq!(block.header.height, decoded.header.height,
                "block height must be preserved");
            prop_assert_eq!(block.header.parent_hash, decoded.header.parent_hash,
                "block parent hash must be preserved");
            prop_assert_eq!(block.header.state_root, decoded.header.state_root,
                "block state root must be preserved");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Property: Commitment Binding
    // ─────────────────────────────────────────────────────────────────────────────
    //
    // From messages.rs: "All subsequent payloads must reference the commitment hash"

    proptest! {
        /// Property: Deal commitment hash is deterministic.
        ///
        /// The same commitment must always produce the same hash.
        #[test]
        fn prop_deal_commitment_hash_deterministic(commitment in arb_deal_commitment()) {
            let hash1 = commitment.commitment_hash();
            let hash2 = commitment.commitment_hash();
            prop_assert_eq!(hash1, hash2, "commitment hash must be deterministic");
        }

        /// Property: Different commitments produce different hashes.
        ///
        /// Changing any field in the commitment must change the hash (with high probability).
        #[test]
        fn prop_different_commitments_different_hashes(
            c1 in arb_deal_commitment(),
            c2 in arb_deal_commitment(),
        ) {
            // Only assert difference if commitments are actually different
            if c1.scope.table_id != c2.scope.table_id
                || c1.scope.hand_id != c2.scope.hand_id
                || c1.shuffle_commitment != c2.shuffle_commitment
            {
                prop_assert_ne!(
                    c1.commitment_hash(),
                    c2.commitment_hash(),
                    "different commitments should produce different hashes"
                );
            }
        }

        /// Property: Actions with correct commitment hash are accepted.
        ///
        /// A valid action log (commitment → acks → action) must pass validation.
        #[test]
        fn prop_valid_action_log_accepted(commitment in arb_deal_commitment()) {
            let commitment_hash = commitment.commitment_hash();
            let seats = commitment.scope.seat_order.clone();

            let mut validator = ActionLogValidator::new();

            // First payload: DealCommitment
            let result = validator.validate(&ConsensusPayload::DealCommitment(commitment.clone()));
            prop_assert!(result.is_ok(), "valid commitment should be accepted");

            // All seats ack
            for &seat in &seats {
                let ack = DealCommitmentAck {
                    version: ProtocolVersion::current(),
                    commitment_hash,
                    seat_index: seat,
                    player_signature: vec![],
                };
                let result = validator.validate(&ConsensusPayload::DealCommitmentAck(ack));
                prop_assert!(result.is_ok(), "valid ack should be accepted");
            }

            // Now actions should be allowed
            prop_assert!(validator.all_acks_received(), "all acks should be received");

            // A valid action (bound to correct commitment)
            if !seats.is_empty() {
                let action = GameActionMessage {
                    version: ProtocolVersion::current(),
                    deal_commitment_hash: commitment_hash,
                    seat_index: seats[0],
                    action_type: 1, // Check
                    amount: 0,
                    sequence: 0,
                    signature: vec![],
                };
                let result = validator.validate(&ConsensusPayload::GameAction(action));
                prop_assert!(result.is_ok(), "valid action with correct commitment should be accepted");
            }
        }

        /// Property: Actions with wrong commitment hash are rejected.
        ///
        /// An action referencing a different commitment hash must be rejected.
        #[test]
        fn prop_wrong_commitment_hash_rejected(
            commitment in arb_deal_commitment(),
            wrong_hash in arb_bytes32(),
        ) {
            let commitment_hash = commitment.commitment_hash();
            let seats = commitment.scope.seat_order.clone();

            // Skip if by chance wrong_hash equals the real hash
            prop_assume!(wrong_hash != commitment_hash);

            let mut validator = ActionLogValidator::new();

            // Setup: commitment + all acks
            validator.validate(&ConsensusPayload::DealCommitment(commitment.clone())).unwrap();
            for &seat in &seats {
                let ack = DealCommitmentAck {
                    version: ProtocolVersion::current(),
                    commitment_hash,
                    seat_index: seat,
                    player_signature: vec![],
                };
                validator.validate(&ConsensusPayload::DealCommitmentAck(ack)).unwrap();
            }

            // Action with WRONG commitment hash
            if !seats.is_empty() {
                let bad_action = GameActionMessage {
                    version: ProtocolVersion::current(),
                    deal_commitment_hash: wrong_hash, // Wrong!
                    seat_index: seats[0],
                    action_type: 1,
                    amount: 0,
                    sequence: 0,
                    signature: vec![],
                };
                let result = validator.validate(&ConsensusPayload::GameAction(bad_action));
                prop_assert!(
                    matches!(result, Err(PayloadError::CommitmentHashMismatch { .. })),
                    "action with wrong commitment hash should be rejected"
                );
            }
        }

        /// Property: Actions before commitment are rejected.
        ///
        /// Sending an action before any commitment exists must fail.
        #[test]
        fn prop_action_before_commitment_rejected(
            commitment_hash in arb_bytes32(),
            seat in 0u8..9,
        ) {
            let mut validator = ActionLogValidator::new();

            let action = GameActionMessage {
                version: ProtocolVersion::current(),
                deal_commitment_hash: commitment_hash,
                seat_index: seat,
                action_type: 1,
                amount: 0,
                sequence: 0,
                signature: vec![],
            };

            let result = validator.validate(&ConsensusPayload::GameAction(action));
            prop_assert!(
                matches!(result, Err(PayloadError::MissingInitialCommitment { .. })),
                "action before commitment should be rejected"
            );
        }

        /// Property: Actions before all acks are rejected.
        ///
        /// Sending an action before all players have acked the commitment must fail.
        #[test]
        fn prop_action_before_all_acks_rejected(commitment in arb_deal_commitment()) {
            let commitment_hash = commitment.commitment_hash();
            let seats = commitment.scope.seat_order.clone();

            // Skip if only one seat (no partial ack scenario)
            prop_assume!(seats.len() >= 2);

            let mut validator = ActionLogValidator::new();

            // Commitment
            validator.validate(&ConsensusPayload::DealCommitment(commitment.clone())).unwrap();

            // Only one ack (not all)
            let ack = DealCommitmentAck {
                version: ProtocolVersion::current(),
                commitment_hash,
                seat_index: seats[0],
                player_signature: vec![],
            };
            validator.validate(&ConsensusPayload::DealCommitmentAck(ack)).unwrap();

            prop_assert!(!validator.all_acks_received(), "not all acks received yet");

            // Action before all acks
            let action = GameActionMessage {
                version: ProtocolVersion::current(),
                deal_commitment_hash: commitment_hash,
                seat_index: seats[0],
                action_type: 1,
                amount: 0,
                sequence: 0,
                signature: vec![],
            };
            let result = validator.validate(&ConsensusPayload::GameAction(action));
            prop_assert!(
                matches!(result, Err(PayloadError::ActionBeforeAllAcks { .. })),
                "action before all acks should be rejected"
            );
        }

        /// Property: Duplicate DealCommitment is rejected.
        ///
        /// Only one DealCommitment per hand is allowed.
        #[test]
        fn prop_duplicate_commitment_rejected(
            c1 in arb_deal_commitment(),
            c2 in arb_deal_commitment(),
        ) {
            let mut validator = ActionLogValidator::new();

            // First commitment accepted
            let result = validator.validate(&ConsensusPayload::DealCommitment(c1));
            prop_assert!(result.is_ok());

            // Second commitment rejected
            let result = validator.validate(&ConsensusPayload::DealCommitment(c2));
            prop_assert!(
                matches!(result, Err(PayloadError::DuplicateCommitment)),
                "duplicate commitment should be rejected"
            );
        }

        /// Property: GameActionMessage hash includes commitment hash.
        ///
        /// The action hash must change when commitment hash changes.
        #[test]
        fn prop_action_hash_includes_commitment(
            hash1 in arb_bytes32(),
            hash2 in arb_bytes32(),
            seat in 0u8..9,
            action_type in 0u8..6,
            amount in any::<u64>(),
            sequence in any::<u32>(),
        ) {
            prop_assume!(hash1 != hash2);

            let action1 = GameActionMessage {
                version: ProtocolVersion::current(),
                deal_commitment_hash: hash1,
                seat_index: seat,
                action_type,
                amount,
                sequence,
                signature: vec![],
            };

            let action2 = GameActionMessage {
                version: ProtocolVersion::current(),
                deal_commitment_hash: hash2,
                seat_index: seat,
                action_type,
                amount,
                sequence,
                signature: vec![],
            };

            prop_assert_ne!(
                action1.action_hash(),
                action2.action_hash(),
                "different commitment hashes must produce different action hashes"
            );
        }

        /// Property: Action preimage is deterministic.
        ///
        /// The same action must always produce the same preimage.
        #[test]
        fn prop_action_preimage_deterministic(
            commitment_hash in arb_bytes32(),
            seat in 0u8..9,
            action_type in 0u8..6,
            amount in any::<u64>(),
            sequence in any::<u32>(),
        ) {
            let action = GameActionMessage {
                version: ProtocolVersion::current(),
                deal_commitment_hash: commitment_hash,
                seat_index: seat,
                action_type,
                amount,
                sequence,
                signature: vec![],
            };

            let preimage1 = action.preimage();
            let preimage2 = action.preimage();
            prop_assert_eq!(preimage1, preimage2, "action preimage must be deterministic");

            // Hash is also deterministic
            let hash1 = action.action_hash();
            let hash2 = action.action_hash();
            prop_assert_eq!(hash1, hash2, "action hash must be deterministic");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Non-proptest regression tests
    // ─────────────────────────────────────────────────────────────────────────────

    /// Regression: Verify that replaying a specific sequence yields identical results.
    #[test]
    fn test_replay_determinism_specific_sequence() {
        let config = SimplexConfig {
            version: ProtocolVersion::new(CURRENT_PROTOCOL_VERSION),
            proposer_id: [0xAA; 32],
            validator_count: 1,
        };

        // Create first automaton and build a chain
        let mut auto1 = SimplexAutomaton::new(config.clone());
        let mut auto2 = SimplexAutomaton::new(config);

        // Build 3 blocks on auto1
        let mut blocks = Vec::new();
        let mut parent = Digest::ZERO;

        for i in 0..3 {
            let body = BlockBody::empty();
            let block = auto1.propose(i, parent, &body).unwrap();
            let digest = Digest::from_header(&block.header);

            let mut fin =
                Finalization::new(ProtocolVersion::new(CURRENT_PROTOCOL_VERSION), digest, i, i);
            fin.add_signature([1u8; 32], vec![]);

            auto1.finalize(block.clone(), fin.clone()).unwrap();
            blocks.push((block, fin));
            parent = digest;
        }

        // Record auto1's final state
        let final_tip_1 = auto1.tip();
        let final_height_1 = auto1.height();
        let final_state_root_1 = auto1.state_root();

        // Replay on auto2
        for (block, fin) in blocks {
            auto2.finalize(block, fin).unwrap();
        }

        // Verify identical state
        assert_eq!(auto2.tip(), final_tip_1, "tip must match after replay");
        assert_eq!(
            auto2.height(),
            final_height_1,
            "height must match after replay"
        );
        assert_eq!(
            auto2.state_root(),
            final_state_root_1,
            "state root must match after replay"
        );
    }

    /// Regression: Verify commitment binding prevents cross-hand replay.
    #[test]
    fn test_commitment_binding_prevents_cross_hand_replay() {
        // Create two different commitments for different hands
        let scope1 = ScopeBinding::new([1u8; 32], 1, vec![0, 1], 52);
        let scope2 = ScopeBinding::new([1u8; 32], 2, vec![0, 1], 52); // Different hand_id

        let commitment1 = DealCommitment {
            version: ProtocolVersion::current(),
            scope: scope1,
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![],
        };

        let commitment2 = DealCommitment {
            version: ProtocolVersion::current(),
            scope: scope2,
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![],
        };

        // Hashes must differ
        assert_ne!(
            commitment1.commitment_hash(),
            commitment2.commitment_hash(),
            "different hands must have different commitment hashes"
        );

        // An action bound to commitment1...
        let action_for_hand1 = GameActionMessage {
            version: ProtocolVersion::current(),
            deal_commitment_hash: commitment1.commitment_hash(),
            seat_index: 0,
            action_type: 1,
            amount: 0,
            sequence: 0,
            signature: vec![],
        };

        // ...should be rejected in a validator set up for commitment2
        let mut validator = ActionLogValidator::new();
        validator
            .validate(&ConsensusPayload::DealCommitment(commitment2.clone()))
            .unwrap();
        for seat in [0, 1] {
            let ack = DealCommitmentAck {
                version: ProtocolVersion::current(),
                commitment_hash: commitment2.commitment_hash(),
                seat_index: seat,
                player_signature: vec![],
            };
            validator
                .validate(&ConsensusPayload::DealCommitmentAck(ack))
                .unwrap();
        }

        let result = validator.validate(&ConsensusPayload::GameAction(action_for_hand1));
        assert!(
            matches!(result, Err(PayloadError::CommitmentHashMismatch { .. })),
            "action from hand 1 must be rejected in hand 2's validator"
        );
    }
}
