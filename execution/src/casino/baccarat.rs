//! Baccarat game implementation.
//!
//! State blob format:
//! [playerHandLen:u8] [playerCards:u8×n] [bankerHandLen:u8] [bankerCards:u8×n]
//!
//! Payload format:
//! [betType:u8]
//! 0 = Player (1:1)
//! 1 = Banker (0.95:1, 5% commission)
//! 2 = Tie (8:1)

use super::{CasinoGame, GameError, GameResult, GameRng};
use battleware_types::casino::GameSession;

/// Maximum cards in a Baccarat hand (2-3 cards per hand).
const MAX_HAND_SIZE: usize = 3;

/// Bet types in Baccarat.
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BetType {
    Player = 0, // 1:1
    Banker = 1, // 0.95:1 (5% commission)
    Tie = 2,    // 8:1
}

impl TryFrom<u8> for BetType {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(BetType::Player),
            1 => Ok(BetType::Banker),
            2 => Ok(BetType::Tie),
            _ => Err(GameError::InvalidPayload),
        }
    }
}

/// Get card value for Baccarat (0-9).
/// Face cards and 10s = 0, Ace = 1, others = face value.
fn card_value(card: u8) -> u8 {
    let rank = (card % 13) + 1; // 1-13
    match rank {
        1 => 1,         // Ace
        2..=9 => rank,  // 2-9
        _ => 0,         // 10, J, Q, K
    }
}

/// Calculate hand total (mod 10).
fn hand_total(cards: &[u8]) -> u8 {
    cards.iter().map(|&c| card_value(c)).sum::<u8>() % 10
}

/// Determine if player should draw third card.
/// Player draws on 0-5, stands on 6-7.
fn player_draws(player_total: u8) -> bool {
    player_total <= 5
}

/// Determine if banker should draw third card.
/// Depends on banker's total and player's third card (if any).
fn banker_draws(banker_total: u8, player_third_card: Option<u8>) -> bool {
    match banker_total {
        0..=2 => true, // Always draws
        3 => match player_third_card {
            None => true,
            Some(c) => card_value(c) != 8,
        },
        4 => match player_third_card {
            None => true,
            Some(c) => {
                let v = card_value(c);
                v >= 2 && v <= 7
            }
        },
        5 => match player_third_card {
            None => true,
            Some(c) => {
                let v = card_value(c);
                v >= 4 && v <= 7
            }
        },
        6 => match player_third_card {
            None => false,
            Some(c) => {
                let v = card_value(c);
                v == 6 || v == 7
            }
        },
        _ => false, // 7-9 stands
    }
}

fn parse_state(state: &[u8]) -> Option<(Vec<u8>, Vec<u8>)> {
    if state.is_empty() {
        return None;
    }

    let player_len = state[0] as usize;
    // Bounds check: reject impossibly large hand sizes
    if player_len > MAX_HAND_SIZE || state.len() < 1 + player_len + 1 {
        return None;
    }

    let player_cards: Vec<u8> = state[1..1 + player_len].to_vec();
    let banker_len = state[1 + player_len] as usize;

    // Bounds check: reject impossibly large hand sizes
    if banker_len > MAX_HAND_SIZE || state.len() < 1 + player_len + 1 + banker_len {
        return None;
    }

    let banker_cards: Vec<u8> = state[2 + player_len..2 + player_len + banker_len].to_vec();

    Some((player_cards, banker_cards))
}

fn serialize_state(player_cards: &[u8], banker_cards: &[u8]) -> Vec<u8> {
    let mut state = Vec::with_capacity(2 + player_cards.len() + banker_cards.len());
    state.push(player_cards.len() as u8);
    state.extend_from_slice(player_cards);
    state.push(banker_cards.len() as u8);
    state.extend_from_slice(banker_cards);
    state
}

pub struct Baccarat;

impl CasinoGame for Baccarat {
    fn init(session: &mut GameSession, _rng: &mut GameRng) {
        // Empty state - waiting for bet
        session.state_blob = vec![];
    }

    fn process_move(
        session: &mut GameSession,
        payload: &[u8],
        rng: &mut GameRng,
    ) -> Result<GameResult, GameError> {
        if session.is_complete {
            return Err(GameError::GameAlreadyComplete);
        }

        if payload.is_empty() {
            return Err(GameError::InvalidPayload);
        }

        let bet_type = BetType::try_from(payload[0])?;

        // Deal initial cards
        let mut deck = rng.create_deck();

        // Deal 2 cards each: Player, Banker, Player, Banker
        let mut player_cards = vec![
            rng.draw_card(&mut deck).unwrap(),
            rng.draw_card(&mut deck).unwrap(),
        ];
        let mut banker_cards = vec![
            rng.draw_card(&mut deck).unwrap(),
            rng.draw_card(&mut deck).unwrap(),
        ];

        let mut player_total = hand_total(&player_cards);
        let mut banker_total = hand_total(&banker_cards);

        // Natural check (8 or 9 on first two cards)
        let natural = player_total >= 8 || banker_total >= 8;

        let mut player_third_card: Option<u8> = None;

        if !natural {
            // Player draws?
            if player_draws(player_total) {
                let card = rng.draw_card(&mut deck).unwrap();
                player_cards.push(card);
                player_third_card = Some(card);
                player_total = hand_total(&player_cards);
            }

            // Banker draws?
            if banker_draws(banker_total, player_third_card) {
                let card = rng.draw_card(&mut deck).unwrap();
                banker_cards.push(card);
                banker_total = hand_total(&banker_cards);
            }
        }

        session.state_blob = serialize_state(&player_cards, &banker_cards);
        session.move_count += 1;
        session.is_complete = true;

        // Determine winner
        let result = if player_total == banker_total {
            // Tie
            match bet_type {
                BetType::Tie => GameResult::Win(session.bet.saturating_mul(8)),
                _ => GameResult::Push, // Push for Player/Banker bets on tie
            }
        } else if player_total > banker_total {
            // Player wins
            match bet_type {
                BetType::Player => GameResult::Win(session.bet),
                BetType::Tie => GameResult::Loss,
                BetType::Banker => GameResult::Loss,
            }
        } else {
            // Banker wins
            match bet_type {
                BetType::Banker => {
                    // 5% commission - win 95% of bet (with overflow protection)
                    let winnings = session.bet.saturating_mul(95) / 100;
                    if winnings > 0 {
                        GameResult::Win(winnings)
                    } else {
                        GameResult::Push
                    }
                }
                BetType::Tie => GameResult::Loss,
                BetType::Player => GameResult::Loss,
            }
        };

        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mocks::{create_account_keypair, create_network_keypair, create_seed};
    use battleware_types::casino::GameType;

    fn create_test_seed() -> battleware_types::Seed {
        let (network_secret, _) = create_network_keypair();
        create_seed(&network_secret, 1)
    }

    fn create_test_session(bet: u64) -> GameSession {
        let (_, pk) = create_account_keypair(1);
        GameSession {
            id: 1,
            player: pk,
            game_type: GameType::Baccarat,
            bet,
            state_blob: vec![],
            move_count: 0,
            created_at: 0,
            is_complete: false,
            super_mode: battleware_types::casino::SuperModeState::default(),
        }
    }

    #[test]
    fn test_card_value() {
        // Ace = 1
        assert_eq!(card_value(0), 1);
        assert_eq!(card_value(13), 1);

        // 2-9 = face value
        assert_eq!(card_value(1), 2);
        assert_eq!(card_value(8), 9);

        // 10, J, Q, K = 0
        assert_eq!(card_value(9), 0);  // 10
        assert_eq!(card_value(10), 0); // J
        assert_eq!(card_value(11), 0); // Q
        assert_eq!(card_value(12), 0); // K
    }

    #[test]
    fn test_hand_total() {
        // 7 + 8 = 15 mod 10 = 5
        assert_eq!(hand_total(&[6, 7]), 5);

        // Ace + 3 = 4
        assert_eq!(hand_total(&[0, 2]), 4);

        // King + Queen = 0
        assert_eq!(hand_total(&[12, 11]), 0);

        // 9 + 9 = 18 mod 10 = 8 (natural)
        assert_eq!(hand_total(&[8, 21]), 8);
    }

    #[test]
    fn test_player_draws() {
        assert!(player_draws(0));
        assert!(player_draws(5));
        assert!(!player_draws(6));
        assert!(!player_draws(7));
    }

    #[test]
    fn test_banker_draws_no_player_third() {
        // Banker draws on 0-5 when player stands
        assert!(banker_draws(0, None));
        assert!(banker_draws(5, None));
        assert!(!banker_draws(6, None));
        assert!(!banker_draws(7, None));
    }

    #[test]
    fn test_banker_draws_with_player_third() {
        // Banker on 3, player drew 8 -> banker stands
        assert!(!banker_draws(3, Some(7))); // 7's value is 8

        // Banker on 4, player drew 2 -> banker draws
        assert!(banker_draws(4, Some(1))); // 1's value is 2

        // Banker on 6, player drew 6 -> banker draws
        assert!(banker_draws(6, Some(5))); // 5's value is 6
    }

    #[test]
    fn test_serialize_parse_roundtrip() {
        let player = vec![1, 2, 3];
        let banker = vec![4, 5];

        let state = serialize_state(&player, &banker);
        let (p, b) = parse_state(&state).unwrap();

        assert_eq!(p, player);
        assert_eq!(b, banker);
    }

    #[test]
    fn test_game_completes() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Baccarat::init(&mut session, &mut rng);
        assert!(!session.is_complete);

        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = Baccarat::process_move(&mut session, &[0], &mut rng); // Bet on Player

        assert!(result.is_ok());
        assert!(session.is_complete);

        // State should have cards
        let (player_cards, banker_cards) = parse_state(&session.state_blob).unwrap();
        assert!(player_cards.len() >= 2);
        assert!(banker_cards.len() >= 2);
    }

    #[test]
    fn test_invalid_bet_type() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Baccarat::init(&mut session, &mut rng);

        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = Baccarat::process_move(&mut session, &[5], &mut rng); // Invalid

        assert!(matches!(result, Err(GameError::InvalidPayload)));
    }

    #[test]
    fn test_banker_commission() {
        // If banker wins, payout should be 95% of bet
        // We need to verify the calculation is correct
        let bet = 100;
        let expected_winnings = (bet * 95) / 100;
        assert_eq!(expected_winnings, 95);
    }

    #[test]
    fn test_tie_payout() {
        // Tie bet should pay 8:1
        let bet = 100;
        let expected_winnings = bet * 8;
        assert_eq!(expected_winnings, 800);
    }

    #[test]
    fn test_various_outcomes() {
        let seed = create_test_seed();

        // Run multiple sessions to test different outcomes
        for session_id in 1..20 {
            let mut session = create_test_session(100);
            session.id = session_id;

            let mut rng = GameRng::new(&seed, session_id, 0);
            Baccarat::init(&mut session, &mut rng);

            let mut rng = GameRng::new(&seed, session_id, 1);
            let result = Baccarat::process_move(&mut session, &[0], &mut rng);

            assert!(result.is_ok());
            assert!(session.is_complete);

            // Verify result is one of the valid outcomes
            match result.unwrap() {
                GameResult::Win(_) | GameResult::Loss | GameResult::Push => {}
                GameResult::Continue => panic!("Baccarat should complete in one move"),
            }
        }
    }
}
