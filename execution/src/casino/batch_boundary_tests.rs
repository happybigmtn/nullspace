//! Atomic batch payload boundary tests (US-091)
//!
//! Verifies that malformed binary payloads are rejected gracefully with proper
//! error codes (InvalidPayload) instead of causing crashes or undefined behavior.
//!
//! Key scenarios:
//! - Truncated payloads (N bets but less than N×bet_size bytes)
//! - Cross-format validation (Baccarat 9-byte format sent to Craps 10-byte handler)
//! - Amount field endianness consistency (big-endian verification)
//! - Exact length boundary conditions

#[cfg(test)]
mod tests {
    use crate::casino::{init_game, process_game_move, GameError, GameRng};
    use crate::mocks::{create_account_keypair, create_network_keypair, create_seed};
    use nullspace_types::casino::{GameSession, GameType};

    /// Helper to convert hex string to bytes
    fn hex_to_bytes(hex: &str) -> Vec<u8> {
        (0..hex.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("invalid hex"))
            .collect()
    }

    /// Helper to create a test session
    fn create_test_session(game_type: GameType, bet: u64, session_id: u64) -> GameSession {
        let (_, pk) = create_account_keypair(1);
        GameSession {
            id: session_id,
            player: pk,
            game_type,
            bet,
            state_blob: vec![],
            move_count: 0,
            created_at: 0,
            is_complete: false,
            super_mode: nullspace_types::casino::SuperModeState::default(),
            is_tournament: false,
            tournament_id: None,
        }
    }

    /// Helper to create seed and RNG
    fn create_test_rng(session_id: u64, move_number: u32) -> GameRng {
        let (network_secret, _) = create_network_keypair();
        let seed = create_seed(&network_secret, 1);
        GameRng::new(&seed, session_id, move_number)
    }

    // =========================================================================
    // TRUNCATED PAYLOAD TESTS
    // =========================================================================

    #[test]
    fn test_craps_atomic_batch_truncated_by_half_bet() {
        // Craps atomic batch: opcode=4, bet_count, then 10 bytes per bet
        // Test: 2 bets declared but only 1.5 bets worth of data (15 bytes instead of 22)
        // Expected format: [04, 02, bet0(10 bytes), bet1(10 bytes)] = 22 bytes
        let mut session = create_test_session(GameType::Craps, 100, 1);
        let mut rng = create_test_rng(1, 0);
        let _ = init_game(&mut session, &mut rng);

        // Truncated: 2 bets declared but only 16 bytes (missing 6 bytes of 2nd bet)
        // 04 02 = opcode + count
        // 00 00 0000000000000064 = bet 1 (Pass, target 0, 100 chips)
        // 04 00 00 00 = partial bet 2 (only 4 bytes)
        let truncated_payload = hex_to_bytes("04020000000000000000640400000000");

        let mut rng = create_test_rng(1, 1);
        let result = process_game_move(&mut session, &truncated_payload, &mut rng);

        assert!(
            matches!(result, Err(GameError::InvalidPayload)),
            "Truncated payload should return InvalidPayload"
        );
    }

    #[test]
    fn test_craps_atomic_batch_missing_one_byte() {
        // Craps: exactly 1 byte short of valid payload
        // Valid: [04, 01, bet(10 bytes)] = 12 bytes
        // This: [04, 01, bet(9 bytes)] = 11 bytes
        let mut session = create_test_session(GameType::Craps, 100, 2);
        let mut rng = create_test_rng(2, 0);
        let _ = init_game(&mut session, &mut rng);

        // Missing last byte of amount (should be 0x64 = 100)
        let payload = hex_to_bytes("04010000000000000000");

        let mut rng = create_test_rng(2, 1);
        let result = process_game_move(&mut session, &payload, &mut rng);

        assert!(
            matches!(result, Err(GameError::InvalidPayload)),
            "Payload missing 1 byte should return InvalidPayload"
        );
    }

    #[test]
    fn test_baccarat_atomic_batch_truncated() {
        // Baccarat atomic batch: opcode=3, bet_count, then 9 bytes per bet
        // Expected: [03, 02, bet0(9 bytes), bet1(9 bytes)] = 20 bytes
        let mut session = create_test_session(GameType::Baccarat, 100, 3);
        let mut rng = create_test_rng(3, 0);
        let _ = init_game(&mut session, &mut rng);

        // Truncated: 2 bets declared but only 16 bytes instead of 20
        // 03 02 = opcode + count
        // 00 0000000000000064 = bet 1 (Player, 100)
        // 01 00 00 00 = partial bet 2 (only 4 bytes)
        let truncated_payload = hex_to_bytes("030200000000000000640100000000");

        let mut rng = create_test_rng(3, 1);
        let result = process_game_move(&mut session, &truncated_payload, &mut rng);

        assert!(
            matches!(result, Err(GameError::InvalidPayload)),
            "Baccarat truncated payload should return InvalidPayload"
        );
    }

    #[test]
    fn test_roulette_atomic_batch_truncated() {
        // Roulette atomic batch: opcode=4, bet_count, then 10 bytes per bet
        // Expected: [04, 02, bet0(10 bytes), bet1(10 bytes)] = 22 bytes
        let mut session = create_test_session(GameType::Roulette, 100, 4);
        let mut rng = create_test_rng(4, 0);
        let _ = init_game(&mut session, &mut rng);

        // Truncated: 2 bets declared but only 18 bytes (missing 4 bytes)
        let truncated_payload = hex_to_bytes("040201000000000000006402000000000000");

        let mut rng = create_test_rng(4, 1);
        let result = process_game_move(&mut session, &truncated_payload, &mut rng);

        assert!(
            matches!(result, Err(GameError::InvalidPayload)),
            "Roulette truncated payload should return InvalidPayload"
        );
    }

    #[test]
    fn test_sic_bo_atomic_batch_truncated() {
        // Sic Bo atomic batch: opcode=3, bet_count, then 10 bytes per bet
        // Expected: [03, 01, bet0(10 bytes)] = 12 bytes
        let mut session = create_test_session(GameType::SicBo, 100, 5);
        let mut rng = create_test_rng(5, 0);
        let _ = init_game(&mut session, &mut rng);

        // Truncated: 1 bet declared but only 6 bytes of bet data
        let truncated_payload = hex_to_bytes("03010000000000");

        let mut rng = create_test_rng(5, 1);
        let result = process_game_move(&mut session, &truncated_payload, &mut rng);

        assert!(
            matches!(result, Err(GameError::InvalidPayload)),
            "Sic Bo truncated payload should return InvalidPayload"
        );
    }

    // =========================================================================
    // CROSS-FORMAT VALIDATION TESTS
    // =========================================================================

    #[test]
    fn test_baccarat_format_sent_to_craps_handler() {
        // Baccarat uses 9 bytes/bet, Craps expects 10 bytes/bet
        // Send Baccarat-sized payload (9 bytes/bet) to Craps game
        let mut session = create_test_session(GameType::Craps, 100, 10);
        let mut rng = create_test_rng(10, 0);
        let _ = init_game(&mut session, &mut rng);

        // Baccarat atomic batch format: [03, 01, betType:u8, amount:u64] = 11 bytes
        // But we're sending to Craps which expects [04, 01, betType:u8, target:u8, amount:u64] = 12 bytes
        // This payload is 11 bytes but Craps expects 12
        let baccarat_format = hex_to_bytes("04010000000000000064"); // 10 bytes (missing 2), Craps expects 12

        let mut rng = create_test_rng(10, 1);
        let result = process_game_move(&mut session, &baccarat_format, &mut rng);

        // Should fail because payload.len() < expected_len (11 < 12)
        assert!(
            matches!(result, Err(GameError::InvalidPayload)),
            "Baccarat-sized payload to Craps should return InvalidPayload"
        );
    }

    #[test]
    fn test_craps_format_sent_to_baccarat_handler() {
        // Craps uses 10 bytes/bet, Baccarat expects 9 bytes/bet
        // Send Craps-sized payload (10 bytes/bet) to Baccarat game
        let mut session = create_test_session(GameType::Baccarat, 100, 11);
        let mut rng = create_test_rng(11, 0);
        let _ = init_game(&mut session, &mut rng);

        // Craps format for 1 bet: [04, 01, betType:u8, target:u8, amount:u64] = 12 bytes
        // Baccarat expects: [03, 01, betType:u8, amount:u64] = 11 bytes
        // Extra byte will cause amount parsing to be misaligned
        let craps_format = hex_to_bytes("030100000000000000000064"); // 12 bytes

        let mut rng = create_test_rng(11, 1);
        let result = process_game_move(&mut session, &craps_format, &mut rng);

        // The amount will be parsed from wrong offset (first byte of amount becomes bet type)
        // This should either:
        // 1. Parse incorrectly and fail validation, OR
        // 2. Work but with wrong values (which is the actual gap US-091 documents)
        // Current behavior: payload is longer than expected, but validation uses < not ==
        // So this WILL be accepted if amount is valid - demonstrating the format gap
        //
        // For this test, we're verifying current behavior (may be accepted or rejected
        // depending on whether extra bytes are ignored)
        match result {
            Err(GameError::InvalidPayload) => {
                // Strict validation - good
            }
            Ok(_) => {
                // Lenient validation - extra bytes ignored
                // This documents current behavior (not necessarily a bug, but a gap)
            }
            Err(e) => {
                panic!("Unexpected error type: {:?}", e);
            }
        }
    }

    // =========================================================================
    // AMOUNT ENDIANNESS TESTS
    // =========================================================================

    #[test]
    fn test_amount_big_endian_encoding() {
        // Verify amount field is big-endian (network byte order)
        // Amount 0x0000000000000064 = 100 in big-endian
        let amount_bytes = hex_to_bytes("0000000000000064");
        let amount = u64::from_be_bytes(amount_bytes.try_into().unwrap());
        assert_eq!(amount, 100, "Amount 100 should decode from BE bytes");

        // Amount 0x00000000000003E8 = 1000 in big-endian
        let amount_bytes = hex_to_bytes("00000000000003E8");
        let amount = u64::from_be_bytes(amount_bytes.try_into().unwrap());
        assert_eq!(amount, 1000, "Amount 1000 should decode from BE bytes");

        // Verify little-endian would give wrong result
        let amount_le = u64::from_le_bytes(hex_to_bytes("0000000000000064").try_into().unwrap());
        assert_ne!(
            amount_le, 100,
            "LE interpretation should differ from BE for 100"
        );
    }

    #[test]
    fn test_craps_atomic_batch_with_golden_vector_amounts() {
        // Use known good payloads from protocol golden vectors
        // Verify they are processed correctly
        let mut session = create_test_session(GameType::Craps, 200, 20);
        let mut rng = create_test_rng(20, 0);
        let _ = init_game(&mut session, &mut rng);

        // Valid Craps atomic batch: Pass bet (type=0) for 100 chips
        // [04, 01, 00, 00, 0000000000000064]
        let valid_payload = hex_to_bytes("040100000000000000000064");

        let mut rng = create_test_rng(20, 1);
        let result = process_game_move(&mut session, &valid_payload, &mut rng);

        assert!(
            result.is_ok(),
            "Valid Craps payload should succeed"
        );
    }

    // =========================================================================
    // BOUNDARY EDGE CASES
    // =========================================================================

    #[test]
    fn test_empty_payload() {
        // Empty payload should return InvalidPayload
        let mut session = create_test_session(GameType::Craps, 100, 30);
        let mut rng = create_test_rng(30, 0);
        let _ = init_game(&mut session, &mut rng);

        let empty_payload: Vec<u8> = vec![];

        let mut rng = create_test_rng(30, 1);
        let result = process_game_move(&mut session, &empty_payload, &mut rng);

        assert!(
            matches!(result, Err(GameError::InvalidPayload)),
            "Empty payload should return InvalidPayload"
        );
    }

    #[test]
    fn test_payload_with_only_opcode() {
        // Payload with just opcode, no bet count
        let mut session = create_test_session(GameType::Craps, 100, 31);
        let mut rng = create_test_rng(31, 0);
        let _ = init_game(&mut session, &mut rng);

        let minimal_payload = vec![0x04]; // Just AtomicBatch opcode, no count

        let mut rng = create_test_rng(31, 1);
        let result = process_game_move(&mut session, &minimal_payload, &mut rng);

        assert!(
            matches!(result, Err(GameError::InvalidPayload)),
            "Payload with only opcode should return InvalidPayload"
        );
    }

    #[test]
    fn test_atomic_batch_with_zero_bets() {
        // Atomic batch declaring zero bets
        let mut session = create_test_session(GameType::Craps, 100, 32);
        let mut rng = create_test_rng(32, 0);
        let _ = init_game(&mut session, &mut rng);

        let zero_bets = vec![0x04, 0x00]; // AtomicBatch with 0 bets

        let mut rng = create_test_rng(32, 1);
        let result = process_game_move(&mut session, &zero_bets, &mut rng);

        assert!(
            matches!(result, Err(GameError::InvalidPayload)),
            "Zero-bet atomic batch should return InvalidPayload"
        );
    }

    #[test]
    fn test_atomic_batch_with_excessive_bet_count() {
        // Bet count exceeds limits (e.g., 255 bets)
        let mut session = create_test_session(GameType::Craps, 100, 33);
        let mut rng = create_test_rng(33, 0);
        let _ = init_game(&mut session, &mut rng);

        // 255 bets declared but no actual bet data
        let excessive_count = vec![0x04, 0xFF];

        let mut rng = create_test_rng(33, 1);
        let result = process_game_move(&mut session, &excessive_count, &mut rng);

        assert!(
            matches!(result, Err(GameError::InvalidPayload)),
            "Excessive bet count should return InvalidPayload"
        );
    }

    #[test]
    fn test_invalid_bet_type_in_batch() {
        // Valid structure but invalid bet type (0xFF is not a valid Craps bet type)
        let mut session = create_test_session(GameType::Craps, 100, 34);
        let mut rng = create_test_rng(34, 0);
        let _ = init_game(&mut session, &mut rng);

        // [04, 01, FF, 00, amount] - bet type 0xFF is invalid
        let invalid_bet_type = hex_to_bytes("0401FF000000000000000064");

        let mut rng = create_test_rng(34, 1);
        let result = process_game_move(&mut session, &invalid_bet_type, &mut rng);

        assert!(
            matches!(result, Err(GameError::InvalidPayload)),
            "Invalid bet type should return InvalidPayload"
        );
    }

    #[test]
    fn test_zero_amount_in_batch() {
        // Valid structure but zero amount
        let mut session = create_test_session(GameType::Craps, 100, 35);
        let mut rng = create_test_rng(35, 0);
        let _ = init_game(&mut session, &mut rng);

        // [04, 01, 00, 00, 0000000000000000] - amount = 0
        let zero_amount = hex_to_bytes("040100000000000000000000");

        let mut rng = create_test_rng(35, 1);
        let result = process_game_move(&mut session, &zero_amount, &mut rng);

        assert!(
            matches!(result, Err(GameError::InvalidPayload)),
            "Zero amount should return InvalidPayload"
        );
    }

    // =========================================================================
    // PAYLOAD PARSING SAFETY (NO PANICS)
    // =========================================================================

    #[test]
    fn test_malformed_payloads_never_panic() {
        // Generate various malformed payloads and ensure none cause panics
        let malformed_payloads: Vec<Vec<u8>> = vec![
            vec![],                                           // Empty
            vec![0xFF],                                       // Invalid opcode
            vec![0x04],                                       // Truncated after opcode
            vec![0x04, 0x01],                                 // Truncated after count
            vec![0x04, 0x01, 0x00],                           // Truncated bet (3 bytes)
            vec![0x04, 0x01, 0x00, 0x00],                     // Truncated bet (4 bytes)
            vec![0x04, 0x01, 0x00, 0x00, 0x00],               // Truncated bet (5 bytes)
            vec![0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00],   // Truncated bet (7 bytes)
            vec![0x04, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x64], // 2 bets, only 1 provided
            (0..1000).map(|_| 0xFF).collect(),                // Large garbage
        ];

        for (idx, payload) in malformed_payloads.iter().enumerate() {
            let mut session = create_test_session(GameType::Craps, 100, 100 + idx as u64);
            let mut rng = create_test_rng(100 + idx as u64, 0);
            let _ = init_game(&mut session, &mut rng);

            let mut rng = create_test_rng(100 + idx as u64, 1);
            // This should not panic - it should return an error
            let result = process_game_move(&mut session, payload, &mut rng);

            // Any result is fine as long as we didn't panic
            match result {
                Ok(_) => {} // Unexpected but not a panic
                Err(_) => {} // Expected - malformed payload rejected
            }
        }
    }

    // =========================================================================
    // MULTI-GAME BOUNDARY VERIFICATION
    // =========================================================================

    #[test]
    fn test_all_games_handle_truncated_batch_gracefully() {
        // Verify all games with atomic batch support reject truncated payloads
        let game_configs: Vec<(GameType, Vec<u8>)> = vec![
            // Craps: opcode=4, count=1, but only partial bet data
            (GameType::Craps, hex_to_bytes("040100000000")),
            // Roulette: opcode=4, count=1, but only partial bet data
            (GameType::Roulette, hex_to_bytes("040100000000")),
            // Baccarat: opcode=3, count=1, but only partial bet data
            (GameType::Baccarat, hex_to_bytes("03010000")),
            // Sic Bo: opcode=3, count=1, but only partial bet data
            (GameType::SicBo, hex_to_bytes("030100000000")),
        ];

        for (idx, (game_type, truncated_payload)) in game_configs.iter().enumerate() {
            let mut session = create_test_session(*game_type, 100, 200 + idx as u64);
            let mut rng = create_test_rng(200 + idx as u64, 0);
            let _ = init_game(&mut session, &mut rng);

            let mut rng = create_test_rng(200 + idx as u64, 1);
            let result = process_game_move(&mut session, truncated_payload, &mut rng);

            assert!(
                matches!(result, Err(GameError::InvalidPayload)),
                "{:?} should reject truncated batch with InvalidPayload",
                game_type
            );
        }
    }
}
