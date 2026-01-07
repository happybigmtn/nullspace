//! Integration tests for casino game execution.
//!
//! These tests verify the full flow from game initialization
//! through multiple moves to game completion.

#[cfg(test)]
#[allow(unused_must_use)]
mod tests {
    use crate::casino::{init_game, process_game_move, GameResult, GameRng};
    use crate::mocks::{create_account_keypair, create_network_keypair, create_seed};
    use nullspace_types::casino::{GameSession, GameType};
    use rand::{rngs::StdRng, Rng, SeedableRng};

    fn create_test_seed() -> nullspace_types::Seed {
        let (network_secret, _) = create_network_keypair();
        create_seed(&network_secret, 1)
    }

    fn create_session(game_type: GameType, bet: u64, session_id: u64) -> GameSession {
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

    /// Test that all games can be initialized.
    #[test]
    fn test_all_games_initialize() {
        let seed = create_test_seed();

        for (i, game_type) in [
            GameType::Baccarat,
            GameType::Blackjack,
            GameType::CasinoWar,
            GameType::Craps,
            GameType::HiLo,
            GameType::Roulette,
            GameType::SicBo,
            GameType::ThreeCard,
            GameType::UltimateHoldem,
            GameType::VideoPoker,
        ]
        .iter()
        .enumerate()
        {
            let mut session = create_session(*game_type, 100, i as u64 + 1);
            let mut rng = GameRng::new(&seed, session.id, 0);

            init_game(&mut session, &mut rng);

            // Verify state was set
            assert!(
                !session.is_complete,
                "Game {:?} should not be complete after init",
                game_type
            );
        }
    }

    #[test]
    fn test_all_games_payload_fuzz_does_not_panic() {
        let seed = create_test_seed();
        let mut payload_rng = StdRng::seed_from_u64(0x5eed_f00d);

        let games = [
            GameType::Baccarat,
            GameType::Blackjack,
            GameType::CasinoWar,
            GameType::Craps,
            GameType::HiLo,
            GameType::Roulette,
            GameType::SicBo,
            GameType::ThreeCard,
            GameType::UltimateHoldem,
            GameType::VideoPoker,
        ];

        for (idx, game_type) in games.iter().enumerate() {
            let mut session = create_session(*game_type, 100, idx as u64 + 1);
            let mut rng = GameRng::new(&seed, session.id, 0);
            init_game(&mut session, &mut rng);

            for step in 0..200u32 {
                if session.is_complete {
                    break;
                }
                let len = payload_rng.gen_range(0..=32);
                let mut payload = vec![0u8; len];
                payload_rng.fill(&mut payload[..]);

                let mut move_rng = GameRng::new(&seed, session.id, step.saturating_add(1));
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let _ = process_game_move(&mut session, &payload, &mut move_rng);
                }));
                assert!(
                    result.is_ok(),
                    "payload fuzz panicked for {:?} (len {})",
                    game_type,
                    len
                );
            }
        }
    }

    /// Test Blackjack full game flow.
    #[test]
    fn test_blackjack_full_flow() {
        let seed = create_test_seed();
        let mut session = create_session(GameType::Blackjack, 100, 1);

        let mut rng = GameRng::new(&seed, session.id, 0);
        init_game(&mut session, &mut rng);

        // Deal
        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = process_game_move(&mut session, &[4], &mut rng);
        assert!(matches!(result, Ok(GameResult::Continue(_))));

        // If we're still in player turn, stand to end decisions.
        if session.state_blob.get(1).copied() == Some(1) {
            let mut rng = GameRng::new(&seed, session.id, 2);
            let result = process_game_move(&mut session, &[1], &mut rng);
            assert!(matches!(result, Ok(GameResult::Continue(_))));
        }

        // Reveal settles.
        let mut rng = GameRng::new(&seed, session.id, 3);
        let result = process_game_move(&mut session, &[6], &mut rng);
        assert!(result.is_ok());

        assert!(session.is_complete);
    }

    /// Test HiLo cashout flow.
    #[test]
    fn test_hilo_cashout_flow() {
        let seed = create_test_seed();
        let mut session = create_session(GameType::HiLo, 100, 1);

        let mut rng = GameRng::new(&seed, session.id, 0);
        init_game(&mut session, &mut rng);

        // Make a few guesses then cashout
        let mut move_num = 1;
        for _ in 0..3 {
            if session.is_complete {
                break;
            }

            let mut rng = GameRng::new(&seed, session.id, move_num);
            // Guess higher (0)
            let result = process_game_move(&mut session, &[0], &mut rng);
            match result {
                Ok(GameResult::Continue(_)) => {}
                Ok(GameResult::Loss(_)) => break,
                _ => {}
            }
            move_num += 1;
        }

        // Cashout if not already complete
        if !session.is_complete {
            let mut rng = GameRng::new(&seed, session.id, move_num);
            let result = process_game_move(&mut session, &[2], &mut rng); // Cashout
            assert!(result.is_ok());
        }

        assert!(session.is_complete);
    }

    /// Test Roulette single spin flow.
    #[test]
    fn test_roulette_single_spin() {
        let seed = create_test_seed();
        let mut session = create_session(GameType::Roulette, 100, 1);

        let mut rng = GameRng::new(&seed, session.id, 0);
        init_game(&mut session, &mut rng);

        // Place bet: [0, bet_type, number, amount_bytes...]
        let mut place_bet_payload = vec![0, 1, 0]; // Action 0, RED bet (type 1), number 0
        place_bet_payload.extend_from_slice(&100u64.to_be_bytes());

        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = process_game_move(&mut session, &place_bet_payload, &mut rng);
        assert!(result.is_ok());
        assert!(!session.is_complete); // Game continues - need to spin

        // Spin wheel: [1]
        let mut rng = GameRng::new(&seed, session.id, 2);
        let result = process_game_move(&mut session, &[1], &mut rng);

        assert!(result.is_ok());
        assert!(session.is_complete);

        // State should contain bet + result (11 bytes: bet_count + 10-byte bet + result)
        assert!(session.state_blob.len() >= 2);
    }

    /// Test Craps point phase flow.
    #[test]
    fn test_craps_point_flow() {
        let seed = create_test_seed();

        // Try multiple sessions to find one that establishes a point
        for session_id in 1..100 {
            let mut session = create_session(GameType::Craps, 100, session_id);

            let mut rng = GameRng::new(&seed, session_id, 0);
            init_game(&mut session, &mut rng);

            let mut rng = GameRng::new(&seed, session_id, 1);
            let result = process_game_move(&mut session, &[0], &mut rng); // Pass line

            if matches!(result, Ok(GameResult::Continue(_))) {
                // Point established, keep rolling
                let mut move_num = 2;
                while !session.is_complete && move_num < 50 {
                    let mut rng = GameRng::new(&seed, session_id, move_num);
                    let result = process_game_move(&mut session, &[], &mut rng);
                    assert!(result.is_ok());
                    move_num += 1;
                }
                assert!(session.is_complete);
                return; // Found and tested a point game
            }
        }
    }

    /// Test Video Poker hold all flow.
    #[test]
    fn test_video_poker_hold_all() {
        let seed = create_test_seed();
        let mut session = create_session(GameType::VideoPoker, 100, 1);

        let mut rng = GameRng::new(&seed, session.id, 0);
        init_game(&mut session, &mut rng);

        // Verify 5 cards dealt
        assert_eq!(session.state_blob.len(), 7); // stage + 5 cards + rules

        let mut rng = GameRng::new(&seed, session.id, 1);
        // Hold all cards (0b11111)
        let result = process_game_move(&mut session, &[0b11111], &mut rng);

        assert!(result.is_ok());
        assert!(session.is_complete);
    }

    /// Test Ultimate Holdem check to river flow.
    #[test]
    fn test_ultimate_holdem_check_to_river() {
        let seed = create_test_seed();
        let mut session = create_session(GameType::UltimateHoldem, 100, 1);

        let mut rng = GameRng::new(&seed, session.id, 0);
        init_game(&mut session, &mut rng);

        // Deal
        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = process_game_move(&mut session, &[5], &mut rng);
        assert!(matches!(result, Ok(GameResult::Continue(_))));

        // Check preflop (reveals flop)
        let mut rng = GameRng::new(&seed, session.id, 2);
        let result = process_game_move(&mut session, &[0], &mut rng);
        assert!(matches!(result, Ok(GameResult::Continue(_))));

        // Check flop (reveals turn+river)
        let mut rng = GameRng::new(&seed, session.id, 3);
        let result = process_game_move(&mut session, &[0], &mut rng);
        assert!(matches!(result, Ok(GameResult::Continue(_))));

        // Bet 1x at river (deduct play bet)
        let mut rng = GameRng::new(&seed, session.id, 4);
        let result = process_game_move(&mut session, &[3], &mut rng);
        assert!(matches!(
            result,
            Ok(GameResult::ContinueWithUpdate { payout: -100, .. })
        ));

        // Reveal to resolve
        let mut rng = GameRng::new(&seed, session.id, 5);
        let result = process_game_move(&mut session, &[7], &mut rng);
        assert!(result.is_ok());
        assert!(session.is_complete);
    }

    /// Test Three Card Poker play decision.
    #[test]
    fn test_three_card_poker_play() {
        let seed = create_test_seed();
        let mut session = create_session(GameType::ThreeCard, 100, 1);

        let mut rng = GameRng::new(&seed, session.id, 0);
        init_game(&mut session, &mut rng);

        // Verify fixed-size versioned state
        assert_eq!(session.state_blob.len(), 33);

        // Deal player cards
        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = process_game_move(&mut session, &[2], &mut rng);
        assert!(matches!(result, Ok(GameResult::Continue(_))));

        // Play (deduct play bet)
        let mut rng = GameRng::new(&seed, session.id, 2);
        let result = process_game_move(&mut session, &[0], &mut rng);
        assert!(matches!(
            result,
            Ok(GameResult::ContinueWithUpdate { payout: -100, .. })
        ));

        // Reveal to resolve
        let mut rng = GameRng::new(&seed, session.id, 3);
        let result = process_game_move(&mut session, &[4], &mut rng);
        assert!(result.is_ok());
        assert!(session.is_complete);
    }

    /// Test Baccarat complete flow.
    #[test]
    fn test_baccarat_complete() {
        let seed = create_test_seed();
        let mut session = create_session(GameType::Baccarat, 100, 1);

        let mut rng = GameRng::new(&seed, session.id, 0);
        init_game(&mut session, &mut rng);

        // Place bet: [0, bet_type, amount_bytes...]
        let mut place_bet_payload = vec![0, 1]; // Action 0, Banker bet (type 1)
        place_bet_payload.extend_from_slice(&100u64.to_be_bytes());

        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = process_game_move(&mut session, &place_bet_payload, &mut rng);
        assert!(result.is_ok());
        assert!(!session.is_complete); // Game continues - need to deal

        // Deal cards: [1]
        let mut rng = GameRng::new(&seed, session.id, 2);
        let result = process_game_move(&mut session, &[1], &mut rng);

        assert!(result.is_ok());
        assert!(session.is_complete);

        // State should have bets and cards
        assert!(session.state_blob.len() >= 10);
    }

    /// Test Casino War tie handling.
    #[test]
    fn test_casino_war_tie() {
        let seed = create_test_seed();

        // Find a session that results in a tie
        for session_id in 1..200 {
            let mut session = create_session(GameType::CasinoWar, 100, session_id);

            let mut rng = GameRng::new(&seed, session_id, 0);
            init_game(&mut session, &mut rng);

            let mut rng = GameRng::new(&seed, session_id, 1);
            let result = process_game_move(&mut session, &[0], &mut rng); // Play

            if matches!(result, Ok(GameResult::Continue(_))) {
                // Tie! Go to war
                let mut rng = GameRng::new(&seed, session_id, 2);
                let result = process_game_move(&mut session, &[1], &mut rng); // War

                assert!(result.is_ok());
                assert!(session.is_complete);
                return;
            }
        }
    }

    /// Test Sic Bo various bets.
    #[test]
    fn test_sic_bo_various_bets() {
        let seed = create_test_seed();

        // Test different bet types
        let bet_types = [
            (0, 0, "Small"),
            (1, 0, "Big"),
            (2, 0, "Odd"),
            (3, 0, "Even"),
            (8, 1, "Single 1"),
        ];

        for (session_id, (bet_type, bet_num, name)) in bet_types.iter().enumerate() {
            let mut session = create_session(GameType::SicBo, 100, session_id as u64 + 1);

            let mut rng = GameRng::new(&seed, session.id, 0);
            init_game(&mut session, &mut rng);

            // Place bet: [0, bet_type, number, amount_bytes...]
            let mut place_bet_payload = vec![0, *bet_type, *bet_num];
            place_bet_payload.extend_from_slice(&100u64.to_be_bytes());

            let mut rng = GameRng::new(&seed, session.id, 1);
            let result = process_game_move(&mut session, &place_bet_payload, &mut rng);
            assert!(result.is_ok(), "Place bet failed for {}", name);
            assert!(
                !session.is_complete,
                "Game should not complete after placing bet for {}",
                name
            );

            // Roll dice: [1]
            let mut rng = GameRng::new(&seed, session.id, 2);
            let result = process_game_move(&mut session, &[1], &mut rng);

            assert!(result.is_ok(), "Roll dice failed for {}", name);
            assert!(session.is_complete, "Game should complete for {}", name);
        }
    }

    /// Test deterministic outcomes across identical sessions.
    #[test]
    fn test_deterministic_outcomes() {
        let seed = create_test_seed();

        // Run two identical sessions
        for _ in 0..2 {
            let mut session1 = create_session(GameType::Blackjack, 100, 42);
            let mut session2 = create_session(GameType::Blackjack, 100, 42);

            let mut rng1 = GameRng::new(&seed, 42, 0);
            let mut rng2 = GameRng::new(&seed, 42, 0);

            init_game(&mut session1, &mut rng1);
            init_game(&mut session2, &mut rng2);

            // States should be identical
            assert_eq!(session1.state_blob, session2.state_blob);

            // Process same move
            let mut rng1 = GameRng::new(&seed, 42, 1);
            let mut rng2 = GameRng::new(&seed, 42, 1);

            let _result1 = process_game_move(&mut session1, &[1], &mut rng1);
            let _result2 = process_game_move(&mut session2, &[1], &mut rng2);

            // Results and states should match
            assert_eq!(session1.state_blob, session2.state_blob);
            assert_eq!(session1.is_complete, session2.is_complete);
        }
    }

    /// Test different sessions produce different outcomes.
    #[test]
    fn test_different_sessions_different_outcomes() {
        let seed = create_test_seed();

        let mut session1 = create_session(GameType::Roulette, 100, 1);
        let mut session2 = create_session(GameType::Roulette, 100, 2);

        let mut rng1 = GameRng::new(&seed, 1, 0);
        let mut rng2 = GameRng::new(&seed, 2, 0);

        init_game(&mut session1, &mut rng1);
        init_game(&mut session2, &mut rng2);

        // Place straight bet on 17: [0, bet_type=0 (Straight), number=17, amount]
        let mut bet_payload = vec![0, 0, 17];
        bet_payload.extend_from_slice(&100u64.to_be_bytes());

        let mut rng1 = GameRng::new(&seed, 1, 1);
        let mut rng2 = GameRng::new(&seed, 2, 1);

        process_game_move(&mut session1, &bet_payload, &mut rng1).expect("Failed to process move");
        process_game_move(&mut session2, &bet_payload, &mut rng2).expect("Failed to process move");

        // Now spin both wheels
        let mut rng1 = GameRng::new(&seed, 1, 2);
        let mut rng2 = GameRng::new(&seed, 2, 2);

        process_game_move(&mut session1, &[1], &mut rng1).expect("Failed to process move");
        process_game_move(&mut session2, &[1], &mut rng2).expect("Failed to process move");

        // Results should be different (with very high probability)
        assert_ne!(session1.state_blob, session2.state_blob);
    }

    /// Test that completed games reject moves.
    #[test]
    fn test_completed_games_reject_moves() {
        let seed = create_test_seed();
        let mut session = create_session(GameType::Roulette, 100, 1);

        let mut rng = GameRng::new(&seed, session.id, 0);
        init_game(&mut session, &mut rng);

        // Place a bet: [0, bet_type=1 (RED), number=0, amount]
        let mut bet_payload = vec![0, 1, 0];
        bet_payload.extend_from_slice(&100u64.to_be_bytes());
        let mut rng = GameRng::new(&seed, session.id, 1);
        process_game_move(&mut session, &bet_payload, &mut rng).expect("Failed to process move");

        // Complete the game by spinning
        let mut rng = GameRng::new(&seed, session.id, 2);
        process_game_move(&mut session, &[1], &mut rng).expect("Failed to process move");

        assert!(session.is_complete);

        // Try another move
        let mut rng = GameRng::new(&seed, session.id, 3);
        let result = process_game_move(&mut session, &[1], &mut rng);

        assert!(result.is_err());
    }

    // =========================================================================
    // US-087: Error code distinction tests (Rust → Gateway)
    // =========================================================================

    use crate::casino::GameError;

    /// Test InvalidPayload error is returned for truncated/malformed payloads.
    /// This maps to ERROR_INVALID_PAYLOAD (code 16).
    #[test]
    fn test_error_invalid_payload_blackjack_truncated() {
        let seed = create_test_seed();
        let mut session = create_session(GameType::Blackjack, 100, 1);

        let mut rng = GameRng::new(&seed, session.id, 0);
        init_game(&mut session, &mut rng);

        // Deal first to get into player turn
        let mut rng = GameRng::new(&seed, session.id, 1);
        let _ = process_game_move(&mut session, &[4], &mut rng);

        // Empty payload should be InvalidPayload
        let mut rng = GameRng::new(&seed, session.id, 2);
        let result = process_game_move(&mut session, &[], &mut rng);
        assert!(matches!(result, Err(GameError::InvalidPayload)));
    }

    /// Test InvalidMove error is returned for wrong action in current state.
    /// This maps to ERROR_INVALID_MOVE (code 9).
    #[test]
    fn test_error_invalid_move_blackjack_hit_before_deal() {
        let seed = create_test_seed();
        let mut session = create_session(GameType::Blackjack, 100, 1);

        let mut rng = GameRng::new(&seed, session.id, 0);
        init_game(&mut session, &mut rng);

        // Try to hit (action 0) before dealing - should be InvalidMove
        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = process_game_move(&mut session, &[0], &mut rng);
        assert!(matches!(result, Err(GameError::InvalidMove)));
    }

    /// Test GameAlreadyComplete error is returned when game is over.
    /// This maps to ERROR_SESSION_COMPLETE (code 8).
    #[test]
    fn test_error_game_already_complete_roulette() {
        let seed = create_test_seed();
        let mut session = create_session(GameType::Roulette, 100, 1);

        let mut rng = GameRng::new(&seed, session.id, 0);
        init_game(&mut session, &mut rng);

        // Place bet and spin to complete
        let mut bet_payload = vec![0, 1, 0];
        bet_payload.extend_from_slice(&100u64.to_be_bytes());
        let mut rng = GameRng::new(&seed, session.id, 1);
        process_game_move(&mut session, &bet_payload, &mut rng).unwrap();

        let mut rng = GameRng::new(&seed, session.id, 2);
        process_game_move(&mut session, &[1], &mut rng).unwrap();

        assert!(session.is_complete);

        // Any action on completed game should be GameAlreadyComplete
        let mut rng = GameRng::new(&seed, session.id, 3);
        let result = process_game_move(&mut session, &[0, 1, 0, 0, 0, 0, 0, 0, 0, 100], &mut rng);
        assert!(matches!(result, Err(GameError::GameAlreadyComplete)));
    }

    /// Test InvalidPayload vs InvalidMove distinction for Craps.
    #[test]
    fn test_error_distinction_craps() {
        let seed = create_test_seed();

        // Test InvalidPayload: truncated bet array
        {
            let mut session = create_session(GameType::Craps, 100, 1);
            let mut rng = GameRng::new(&seed, session.id, 0);
            init_game(&mut session, &mut rng);

            // Truncated payload (bet array incomplete)
            let mut rng = GameRng::new(&seed, session.id, 1);
            let result = process_game_move(&mut session, &[0, 1], &mut rng);
            assert!(
                matches!(result, Err(GameError::InvalidPayload)),
                "Truncated Craps bet should return InvalidPayload"
            );
        }

        // Test InvalidMove: roll without placing bets
        {
            let mut session = create_session(GameType::Craps, 100, 2);
            let mut rng = GameRng::new(&seed, session.id, 0);
            init_game(&mut session, &mut rng);

            // Try to roll (action 2 in Craps) without placing any bets
            let mut rng = GameRng::new(&seed, session.id, 1);
            let result = process_game_move(&mut session, &[2], &mut rng);
            assert!(
                matches!(result, Err(GameError::InvalidMove)),
                "Rolling without bets should return InvalidMove"
            );
        }
    }

    /// Test InvalidPayload vs InvalidMove distinction for Baccarat.
    #[test]
    fn test_error_distinction_baccarat() {
        let seed = create_test_seed();

        // Test InvalidPayload: truncated bet
        {
            let mut session = create_session(GameType::Baccarat, 100, 1);
            let mut rng = GameRng::new(&seed, session.id, 0);
            init_game(&mut session, &mut rng);

            // Truncated payload
            let mut rng = GameRng::new(&seed, session.id, 1);
            let result = process_game_move(&mut session, &[0, 1], &mut rng);
            assert!(
                matches!(result, Err(GameError::InvalidPayload)),
                "Truncated Baccarat bet should return InvalidPayload"
            );
        }

        // Test InvalidMove: deal without placing bets
        {
            let mut session = create_session(GameType::Baccarat, 100, 2);
            let mut rng = GameRng::new(&seed, session.id, 0);
            init_game(&mut session, &mut rng);

            // Try to deal (action 1) without placing any bets
            let mut rng = GameRng::new(&seed, session.id, 1);
            let result = process_game_move(&mut session, &[1], &mut rng);
            assert!(
                matches!(result, Err(GameError::InvalidMove)),
                "Dealing without bets should return InvalidMove"
            );
        }
    }

    /// Test InvalidPayload vs InvalidMove distinction for SicBo.
    #[test]
    fn test_error_distinction_sic_bo() {
        let seed = create_test_seed();

        // Test InvalidPayload: truncated bet
        {
            let mut session = create_session(GameType::SicBo, 100, 1);
            let mut rng = GameRng::new(&seed, session.id, 0);
            init_game(&mut session, &mut rng);

            // Truncated payload
            let mut rng = GameRng::new(&seed, session.id, 1);
            let result = process_game_move(&mut session, &[0, 1], &mut rng);
            assert!(
                matches!(result, Err(GameError::InvalidPayload)),
                "Truncated SicBo bet should return InvalidPayload"
            );
        }

        // Test InvalidPayload: roll without placing bets
        // Note: SicBo considers "no bets" as InvalidPayload, not InvalidMove
        {
            let mut session = create_session(GameType::SicBo, 100, 2);
            let mut rng = GameRng::new(&seed, session.id, 0);
            init_game(&mut session, &mut rng);

            // Try to roll (action 1) without placing any bets
            let mut rng = GameRng::new(&seed, session.id, 1);
            let result = process_game_move(&mut session, &[1], &mut rng);
            assert!(
                matches!(result, Err(GameError::InvalidPayload)),
                "Rolling without bets in SicBo returns InvalidPayload"
            );
        }
    }

    /// Test all error variants have distinct codes.
    /// Documents the error code mapping table.
    #[test]
    fn test_error_code_mapping_table() {
        // This test documents the authoritative error code mapping.
        // ERROR_INVALID_PAYLOAD (16) ← GameError::InvalidPayload
        // ERROR_INVALID_MOVE (9)     ← GameError::InvalidMove
        // ERROR_SESSION_COMPLETE (8) ← GameError::GameAlreadyComplete
        // ERROR_INVALID_STATE (17)   ← GameError::InvalidState
        // ERROR_DECK_EXHAUSTED (18)  ← GameError::DeckExhausted

        use nullspace_types::casino::{
            ERROR_DECK_EXHAUSTED, ERROR_INVALID_MOVE, ERROR_INVALID_PAYLOAD, ERROR_INVALID_STATE,
            ERROR_SESSION_COMPLETE,
        };

        // Verify codes are distinct
        let codes = [
            ERROR_INVALID_PAYLOAD,
            ERROR_INVALID_MOVE,
            ERROR_SESSION_COMPLETE,
            ERROR_INVALID_STATE,
            ERROR_DECK_EXHAUSTED,
        ];
        let unique: std::collections::HashSet<_> = codes.iter().collect();
        assert_eq!(
            unique.len(),
            codes.len(),
            "All error codes must be distinct"
        );

        // Verify expected values
        assert_eq!(ERROR_INVALID_PAYLOAD, 16);
        assert_eq!(ERROR_INVALID_MOVE, 9);
        assert_eq!(ERROR_SESSION_COMPLETE, 8);
        assert_eq!(ERROR_INVALID_STATE, 17);
        assert_eq!(ERROR_DECK_EXHAUSTED, 18);
    }

    /// Test InvalidPayload with out-of-range action byte.
    #[test]
    fn test_error_invalid_payload_unknown_action() {
        let seed = create_test_seed();
        let mut session = create_session(GameType::Blackjack, 100, 1);

        let mut rng = GameRng::new(&seed, session.id, 0);
        init_game(&mut session, &mut rng);

        // Action 255 is not valid for any game
        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = process_game_move(&mut session, &[255], &mut rng);

        // Should be InvalidPayload or InvalidMove depending on game implementation
        assert!(
            matches!(result, Err(GameError::InvalidPayload) | Err(GameError::InvalidMove)),
            "Unknown action should return InvalidPayload or InvalidMove"
        );
    }

    /// Test DeckExhausted can occur in theory.
    /// Note: In practice, games are designed to prevent this, but we document the code.
    #[test]
    fn test_deck_exhausted_code_exists() {
        use nullspace_types::casino::ERROR_DECK_EXHAUSTED;
        assert_eq!(
            ERROR_DECK_EXHAUSTED, 18,
            "ERROR_DECK_EXHAUSTED should be code 18"
        );

        // GameError::DeckExhausted exists in the enum
        let _: GameError = GameError::DeckExhausted;
    }

    /// Test InvalidState code exists for corrupted state handling.
    #[test]
    fn test_invalid_state_code_exists() {
        use nullspace_types::casino::ERROR_INVALID_STATE;
        assert_eq!(
            ERROR_INVALID_STATE, 17,
            "ERROR_INVALID_STATE should be code 17"
        );

        // GameError::InvalidState exists in the enum
        let _: GameError = GameError::InvalidState;
    }
}
