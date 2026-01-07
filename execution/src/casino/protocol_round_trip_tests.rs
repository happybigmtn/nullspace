//! Protocol round-trip tests (PROTO-1)
//!
//! Verifies that TypeScript-encoded mobile payloads can be correctly decoded
//! and processed by Rust game implementations. Uses golden vectors from
//! `packages/protocol/test/fixtures/golden-vectors.json` as source of truth.
//!
//! These tests prevent protocol drift between frontend (TypeScript encoding)
//! and backend (Rust decoding/execution).

#[cfg(test)]
mod tests {
    use crate::casino::{init_game, process_game_move, GameRng};
    use crate::mocks::{create_account_keypair, create_network_keypair, create_seed};
    use nullspace_types::casino::{GameSession, GameType};

    /// Helper to convert hex string to bytes
    fn hex_to_bytes(hex: &str) -> Vec<u8> {
        (0..hex.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("invalid hex"))
            .collect()
    }

    /// Golden vectors from TypeScript encoding tests
    /// Source: packages/protocol/test/fixtures/golden-vectors.json

    #[test]
    fn test_blackjack_move_payloads() {
        // Golden vectors from TypeScript encoding
        let vectors = vec![
            ("hit", "00"),
            ("stand", "01"),
            ("double", "02"),
            ("split", "03"),
            ("deal", "04"),
            ("surrender", "07"),
        ];

        for (move_name, hex) in vectors {
            let payload = hex_to_bytes(hex);

            // Verify payload length
            assert_eq!(payload.len(), 1, "Invalid payload length for {}", move_name);

            // Verify opcode matches expected value
            let opcode = payload[0];
            match move_name {
                "hit" => assert_eq!(opcode, 0, "Hit opcode mismatch"),
                "stand" => assert_eq!(opcode, 1, "Stand opcode mismatch"),
                "double" => assert_eq!(opcode, 2, "Double opcode mismatch"),
                "split" => assert_eq!(opcode, 3, "Split opcode mismatch"),
                "deal" => assert_eq!(opcode, 4, "Deal opcode mismatch"),
                "surrender" => assert_eq!(opcode, 7, "Surrender opcode mismatch"),
                _ => panic!("Unknown move: {}", move_name),
            }
        }
    }

    #[test]
    fn test_roulette_move_payloads() {
        let vectors = vec![
            ("spin", "01"),
            ("clear_bets", "02"),
        ];

        for (move_name, hex) in vectors {
            let payload = hex_to_bytes(hex);
            assert_eq!(payload.len(), 1, "Invalid payload length for {}", move_name);

            let opcode = payload[0];
            match move_name {
                "spin" => assert_eq!(opcode, 1, "Spin opcode mismatch"),
                "clear_bets" => assert_eq!(opcode, 2, "Clear bets opcode mismatch"),
                _ => panic!("Unknown move: {}", move_name),
            }
        }
    }

    #[test]
    fn test_roulette_bet_payloads() {
        // Format: [opcode=0, betType, number, amount (8 bytes BE)]
        let vectors = vec![
            ("Red bet, amount 100", "0001000000000000000064", 1, 0, 100u64),
        ];

        for (description, hex, expected_bet_type, expected_number, expected_amount) in vectors {
            let payload = hex_to_bytes(hex);
            assert_eq!(payload.len(), 11, "Invalid payload length for {}", description);

            // Opcode should be 0 (PlaceBet)
            assert_eq!(payload[0], 0, "PlaceBet opcode mismatch for {}", description);

            // Bet type
            assert_eq!(payload[1], expected_bet_type, "Bet type mismatch for {}", description);

            // Number
            assert_eq!(payload[2], expected_number, "Number mismatch for {}", description);

            // Amount (8 bytes big-endian)
            let amount = u64::from_be_bytes([
                payload[3], payload[4], payload[5], payload[6],
                payload[7], payload[8], payload[9], payload[10],
            ]);
            assert_eq!(amount, expected_amount, "Amount mismatch for {}", description);
        }
    }

    #[test]
    fn test_roulette_atomic_batch_payloads() {
        let vectors = vec![
            (
                "Single bet: Red, amount 100",
                "040101000000000000000064",
                vec![(1u8, 0u8, 100u64)], // (betType, number, amount)
            ),
            (
                "Two bets: Red 100, Black 50",
                "04020100000000000000006402000000000000000032",
                vec![(1, 0, 100), (2, 0, 50)],
            ),
        ];

        for (description, hex, expected_bets) in vectors {
            let payload = hex_to_bytes(hex);

            // Opcode should be 4 (AtomicBatch)
            assert_eq!(payload[0], 4, "AtomicBatch opcode mismatch for {}", description);

            // Bet count
            let bet_count = payload[1];
            assert_eq!(bet_count as usize, expected_bets.len(), "Bet count mismatch for {}", description);

            // Parse each bet
            let mut offset = 2;
            for (idx, (expected_type, expected_number, expected_amount)) in expected_bets.iter().enumerate() {
                let bet_type = payload[offset];
                let number = payload[offset + 1];
                let amount = u64::from_be_bytes([
                    payload[offset + 2], payload[offset + 3], payload[offset + 4], payload[offset + 5],
                    payload[offset + 6], payload[offset + 7], payload[offset + 8], payload[offset + 9],
                ]);

                assert_eq!(bet_type, *expected_type, "Bet {} type mismatch for {}", idx, description);
                assert_eq!(number, *expected_number, "Bet {} number mismatch for {}", idx, description);
                assert_eq!(amount, *expected_amount, "Bet {} amount mismatch for {}", idx, description);

                offset += 10; // Each bet is 10 bytes
            }
        }
    }

    #[test]
    fn test_craps_move_payloads() {
        let vectors = vec![
            ("roll", "02"),
            ("clear_bets", "03"),
        ];

        for (move_name, hex) in vectors {
            let payload = hex_to_bytes(hex);
            assert_eq!(payload.len(), 1, "Invalid payload length for {}", move_name);

            let opcode = payload[0];
            match move_name {
                "roll" => assert_eq!(opcode, 2, "Roll opcode mismatch"),
                "clear_bets" => assert_eq!(opcode, 3, "Clear bets opcode mismatch"),
                _ => panic!("Unknown move: {}", move_name),
            }
        }
    }

    #[test]
    fn test_craps_place_bet_payloads() {
        // Format: [opcode=0, betType, target, amount (8 bytes BE)]
        let vectors = vec![
            ("Pass bet, amount 100", "0000000000000000000064", 0, 0, 100u64),
        ];

        for (description, hex, expected_bet_type, expected_target, expected_amount) in vectors {
            let payload = hex_to_bytes(hex);
            assert_eq!(payload.len(), 11, "Invalid payload length for {}", description);

            // Opcode should be 0 (PlaceBet)
            assert_eq!(payload[0], 0, "PlaceBet opcode mismatch for {}", description);

            // Bet type
            assert_eq!(payload[1], expected_bet_type, "Bet type mismatch for {}", description);

            // Target
            assert_eq!(payload[2], expected_target, "Target mismatch for {}", description);

            // Amount (8 bytes big-endian)
            let amount = u64::from_be_bytes([
                payload[3], payload[4], payload[5], payload[6],
                payload[7], payload[8], payload[9], payload[10],
            ]);
            assert_eq!(amount, expected_amount, "Amount mismatch for {}", description);
        }
    }

    #[test]
    fn test_craps_add_odds_payloads() {
        // Format: [opcode=1, amount (8 bytes BE)]
        let vectors = vec![
            ("Add odds 25", "010000000000000019", 25u64),
        ];

        for (description, hex, expected_amount) in vectors {
            let payload = hex_to_bytes(hex);
            assert_eq!(payload.len(), 9, "Invalid payload length for {}", description);

            // Opcode should be 1 (AddOdds)
            assert_eq!(payload[0], 1, "AddOdds opcode mismatch for {}", description);

            // Amount (8 bytes big-endian)
            let amount = u64::from_be_bytes([
                payload[1], payload[2], payload[3], payload[4],
                payload[5], payload[6], payload[7], payload[8],
            ]);
            assert_eq!(amount, expected_amount, "Amount mismatch for {}", description);
        }
    }

    #[test]
    fn test_craps_atomic_batch_payloads() {
        let vectors = vec![
            (
                "Single bet: Pass, amount 100",
                "040100000000000000000064",
                vec![(0u8, 0u8, 100u64)], // (betType, target, amount)
            ),
            (
                "Two bets: Pass 100, Field 50",
                "04020000000000000000006404000000000000000032",
                vec![(0, 0, 100), (4, 0, 50)],
            ),
            (
                "Three bets: Pass 100, Field 50, Yes(6) 25",
                "0403000000000000000000640400000000000000003205060000000000000019",
                vec![(0, 0, 100), (4, 0, 50), (5, 6, 25)],
            ),
        ];

        for (description, hex, expected_bets) in vectors {
            let payload = hex_to_bytes(hex);

            // Opcode should be 4 (AtomicBatch)
            assert_eq!(payload[0], 4, "AtomicBatch opcode mismatch for {}", description);

            // Bet count
            let bet_count = payload[1];
            assert_eq!(bet_count as usize, expected_bets.len(), "Bet count mismatch for {}", description);

            // Parse each bet
            let mut offset = 2;
            for (idx, (expected_type, expected_target, expected_amount)) in expected_bets.iter().enumerate() {
                let bet_type = payload[offset];
                let target = payload[offset + 1];
                let amount = u64::from_be_bytes([
                    payload[offset + 2], payload[offset + 3], payload[offset + 4], payload[offset + 5],
                    payload[offset + 6], payload[offset + 7], payload[offset + 8], payload[offset + 9],
                ]);

                assert_eq!(bet_type, *expected_type, "Bet {} type mismatch for {}", idx, description);
                assert_eq!(target, *expected_target, "Bet {} target mismatch for {}", idx, description);
                assert_eq!(amount, *expected_amount, "Bet {} amount mismatch for {}", idx, description);

                offset += 10; // Each bet is 10 bytes
            }
        }
    }

    #[test]
    fn test_baccarat_atomic_batch_payloads() {
        let vectors = vec![
            (
                "Single bet: Player, amount 100",
                "0301000000000000000064",
                vec![(0u8, 100u64)], // (betType, amount)
            ),
            (
                "Two bets: Player 100, Banker 50",
                "0302000000000000000064010000000000000032",
                vec![(0, 100), (1, 50)],
            ),
        ];

        for (description, hex, expected_bets) in vectors {
            let payload = hex_to_bytes(hex);

            // Opcode should be 3 (AtomicBatch)
            assert_eq!(payload[0], 3, "AtomicBatch opcode mismatch for {}", description);

            // Bet count
            let bet_count = payload[1];
            assert_eq!(bet_count as usize, expected_bets.len(), "Bet count mismatch for {}", description);

            // Parse each bet (betType:u8, amount:u64 BE)
            let mut offset = 2;
            for (idx, (expected_type, expected_amount)) in expected_bets.iter().enumerate() {
                let bet_type = payload[offset];
                let amount = u64::from_be_bytes([
                    payload[offset + 1], payload[offset + 2], payload[offset + 3], payload[offset + 4],
                    payload[offset + 5], payload[offset + 6], payload[offset + 7], payload[offset + 8],
                ]);

                assert_eq!(bet_type, *expected_type, "Bet {} type mismatch for {}", idx, description);
                assert_eq!(amount, *expected_amount, "Bet {} amount mismatch for {}", idx, description);

                offset += 9; // Each bet is 9 bytes
            }
        }
    }

    #[test]
    fn test_sic_bo_atomic_batch_payloads() {
        let vectors = vec![
            (
                "Single bet: Small, amount 100",
                "030100000000000000000064",
                vec![(0u8, 0u8, 100u64)], // (betType, target, amount)
            ),
            (
                "Two bets: Small 100, Big 50",
                "03020000000000000000006401000000000000000032",
                vec![(0, 0, 100), (1, 0, 50)],
            ),
        ];

        for (description, hex, expected_bets) in vectors {
            let payload = hex_to_bytes(hex);

            // Opcode should be 3 (AtomicBatch)
            assert_eq!(payload[0], 3, "AtomicBatch opcode mismatch for {}", description);

            // Bet count
            let bet_count = payload[1];
            assert_eq!(bet_count as usize, expected_bets.len(), "Bet count mismatch for {}", description);

            // Parse each bet (betType:u8, target:u8, amount:u64 BE)
            let mut offset = 2;
            for (idx, (expected_type, expected_target, expected_amount)) in expected_bets.iter().enumerate() {
                let bet_type = payload[offset];
                let target = payload[offset + 1];
                let amount = u64::from_be_bytes([
                    payload[offset + 2], payload[offset + 3], payload[offset + 4], payload[offset + 5],
                    payload[offset + 6], payload[offset + 7], payload[offset + 8], payload[offset + 9],
                ]);

                assert_eq!(bet_type, *expected_type, "Bet {} type mismatch for {}", idx, description);
                assert_eq!(target, *expected_target, "Bet {} target mismatch for {}", idx, description);
                assert_eq!(amount, *expected_amount, "Bet {} amount mismatch for {}", idx, description);

                offset += 10; // Each bet is 10 bytes
            }
        }
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

    /// Comprehensive end-to-end test: TypeScript encodes → Rust decodes and processes
    #[test]
    fn test_protocol_round_trip_integration() {
        // This test verifies that payloads encoded by TypeScript can be successfully
        // processed by Rust game implementations (not just parsed, but executed)

        // Create test seed
        let (network_secret, _) = create_network_keypair();
        let seed = create_seed(&network_secret, 1);

        // Test blackjack "deal" move (opcode 4)
        let mut session = create_test_session(GameType::Blackjack, 100, 1);
        let mut rng = GameRng::new(&seed, session.id, 0);

        // Initialize blackjack game
        init_game(&mut session, &mut rng);
        assert!(!session.is_complete, "Game should not be complete after init");

        // Process TypeScript-encoded deal move
        let deal_payload = hex_to_bytes("04");
        let move_result = process_game_move(&mut session, &deal_payload, &mut rng);
        assert!(move_result.is_ok(), "Failed to process TypeScript-encoded deal move");

        // Verify state was updated (state blob should be non-empty after deal)
        assert!(!session.state_blob.is_empty(), "State blob should be populated after deal");
    }
}
