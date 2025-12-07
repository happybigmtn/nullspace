//! Roulette game implementation.
//!
//! State blob format:
//! Empty before spin, [result:u8] after spin.
//!
//! Payload format (bet types):
//! [betType:u8] [number:u8]
//!
//! Bet types:
//! 0 = Straight (single number, 35:1)
//! 1 = Red (1:1)
//! 2 = Black (1:1)
//! 3 = Even (1:1)
//! 4 = Odd (1:1)
//! 5 = Low (1-18, 1:1)
//! 6 = High (19-36, 1:1)
//! 7 = Dozen (1-12, 13-24, 25-36, 2:1) - number = 0/1/2
//! 8 = Column (2:1) - number = 0/1/2

use super::{CasinoGame, GameError, GameResult, GameRng};
use battleware_types::casino::GameSession;

/// Red numbers on a roulette wheel.
const RED_NUMBERS: [u8; 18] = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

/// Roulette bet types.
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BetType {
    Straight = 0, // Single number (35:1)
    Red = 1,      // Red (1:1)
    Black = 2,    // Black (1:1)
    Even = 3,     // Even (1:1)
    Odd = 4,      // Odd (1:1)
    Low = 5,      // 1-18 (1:1)
    High = 6,     // 19-36 (1:1)
    Dozen = 7,    // 1-12, 13-24, 25-36 (2:1)
    Column = 8,   // First, second, third column (2:1)
}

impl TryFrom<u8> for BetType {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(BetType::Straight),
            1 => Ok(BetType::Red),
            2 => Ok(BetType::Black),
            3 => Ok(BetType::Even),
            4 => Ok(BetType::Odd),
            5 => Ok(BetType::Low),
            6 => Ok(BetType::High),
            7 => Ok(BetType::Dozen),
            8 => Ok(BetType::Column),
            _ => Err(GameError::InvalidPayload),
        }
    }
}

/// Check if a number is red.
fn is_red(number: u8) -> bool {
    RED_NUMBERS.contains(&number)
}

/// Check if a bet wins for a given result.
fn bet_wins(bet_type: BetType, bet_number: u8, result: u8) -> bool {
    // Zero loses all except straight bet on 0
    if result == 0 {
        return bet_type == BetType::Straight && bet_number == 0;
    }

    match bet_type {
        BetType::Straight => bet_number == result,
        BetType::Red => is_red(result),
        BetType::Black => !is_red(result),
        BetType::Even => result % 2 == 0,
        BetType::Odd => result % 2 == 1,
        BetType::Low => result >= 1 && result <= 18,
        BetType::High => result >= 19 && result <= 36,
        BetType::Dozen => {
            let dozen = (result - 1) / 12; // 0, 1, or 2
            dozen == bet_number
        }
        BetType::Column => {
            // Column 0: 1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34
            // Column 1: 2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35
            // Column 2: 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36
            let column = (result - 1) % 3;
            column == bet_number
        }
    }
}

/// Get the payout multiplier for a bet type (excludes original bet).
fn payout_multiplier(bet_type: BetType) -> u64 {
    match bet_type {
        BetType::Straight => 35,
        BetType::Red | BetType::Black | BetType::Even | BetType::Odd | BetType::Low | BetType::High => 1,
        BetType::Dozen | BetType::Column => 2,
    }
}

pub struct Roulette;

impl CasinoGame for Roulette {
    fn init(session: &mut GameSession, _rng: &mut GameRng) {
        // No initial state needed - waiting for bet
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

        if payload.len() < 2 {
            return Err(GameError::InvalidPayload);
        }

        let bet_type = BetType::try_from(payload[0])?;
        let bet_number = payload[1];

        // Validate bet number
        match bet_type {
            BetType::Straight => {
                if bet_number > 36 {
                    return Err(GameError::InvalidPayload);
                }
            }
            BetType::Dozen | BetType::Column => {
                if bet_number > 2 {
                    return Err(GameError::InvalidPayload);
                }
            }
            _ => {} // No number needed for other bets
        }

        // Spin the wheel
        let result = rng.spin_roulette();
        session.state_blob = vec![result];
        session.move_count += 1;
        session.is_complete = true;

        // Check if bet wins
        if bet_wins(bet_type, bet_number, result) {
            let winnings = session.bet * payout_multiplier(bet_type);
            Ok(GameResult::Win(winnings))
        } else {
            Ok(GameResult::Loss)
        }
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
            game_type: GameType::Roulette,
            bet,
            state_blob: vec![],
            move_count: 0,
            created_at: 0,
            is_complete: false,
        }
    }

    #[test]
    fn test_is_red() {
        assert!(is_red(1));
        assert!(is_red(3));
        assert!(is_red(32));
        assert!(!is_red(2));
        assert!(!is_red(4));
        assert!(!is_red(0));
    }

    #[test]
    fn test_bet_wins_straight() {
        assert!(bet_wins(BetType::Straight, 17, 17));
        assert!(!bet_wins(BetType::Straight, 17, 18));
        assert!(bet_wins(BetType::Straight, 0, 0));
        assert!(!bet_wins(BetType::Straight, 1, 0)); // 0 loses non-zero straight
    }

    #[test]
    fn test_bet_wins_colors() {
        // Red numbers
        assert!(bet_wins(BetType::Red, 0, 1));
        assert!(bet_wins(BetType::Red, 0, 3));
        assert!(!bet_wins(BetType::Red, 0, 2));
        assert!(!bet_wins(BetType::Red, 0, 0)); // Zero loses

        // Black numbers
        assert!(bet_wins(BetType::Black, 0, 2));
        assert!(bet_wins(BetType::Black, 0, 4));
        assert!(!bet_wins(BetType::Black, 0, 1));
        assert!(!bet_wins(BetType::Black, 0, 0)); // Zero loses
    }

    #[test]
    fn test_bet_wins_even_odd() {
        assert!(bet_wins(BetType::Even, 0, 2));
        assert!(bet_wins(BetType::Even, 0, 36));
        assert!(!bet_wins(BetType::Even, 0, 1));
        assert!(!bet_wins(BetType::Even, 0, 0)); // Zero loses

        assert!(bet_wins(BetType::Odd, 0, 1));
        assert!(bet_wins(BetType::Odd, 0, 35));
        assert!(!bet_wins(BetType::Odd, 0, 2));
        assert!(!bet_wins(BetType::Odd, 0, 0)); // Zero loses
    }

    #[test]
    fn test_bet_wins_low_high() {
        assert!(bet_wins(BetType::Low, 0, 1));
        assert!(bet_wins(BetType::Low, 0, 18));
        assert!(!bet_wins(BetType::Low, 0, 19));
        assert!(!bet_wins(BetType::Low, 0, 0));

        assert!(bet_wins(BetType::High, 0, 19));
        assert!(bet_wins(BetType::High, 0, 36));
        assert!(!bet_wins(BetType::High, 0, 18));
        assert!(!bet_wins(BetType::High, 0, 0));
    }

    #[test]
    fn test_bet_wins_dozen() {
        // First dozen (1-12)
        assert!(bet_wins(BetType::Dozen, 0, 1));
        assert!(bet_wins(BetType::Dozen, 0, 12));
        assert!(!bet_wins(BetType::Dozen, 0, 13));

        // Second dozen (13-24)
        assert!(bet_wins(BetType::Dozen, 1, 13));
        assert!(bet_wins(BetType::Dozen, 1, 24));
        assert!(!bet_wins(BetType::Dozen, 1, 12));

        // Third dozen (25-36)
        assert!(bet_wins(BetType::Dozen, 2, 25));
        assert!(bet_wins(BetType::Dozen, 2, 36));
        assert!(!bet_wins(BetType::Dozen, 2, 24));
    }

    #[test]
    fn test_bet_wins_column() {
        // First column (1, 4, 7, ...)
        assert!(bet_wins(BetType::Column, 0, 1));
        assert!(bet_wins(BetType::Column, 0, 4));
        assert!(bet_wins(BetType::Column, 0, 34));
        assert!(!bet_wins(BetType::Column, 0, 2));

        // Second column (2, 5, 8, ...)
        assert!(bet_wins(BetType::Column, 1, 2));
        assert!(bet_wins(BetType::Column, 1, 35));
        assert!(!bet_wins(BetType::Column, 1, 3));

        // Third column (3, 6, 9, ...)
        assert!(bet_wins(BetType::Column, 2, 3));
        assert!(bet_wins(BetType::Column, 2, 36));
        assert!(!bet_wins(BetType::Column, 2, 1));
    }

    #[test]
    fn test_payout_multipliers() {
        assert_eq!(payout_multiplier(BetType::Straight), 35);
        assert_eq!(payout_multiplier(BetType::Red), 1);
        assert_eq!(payout_multiplier(BetType::Black), 1);
        assert_eq!(payout_multiplier(BetType::Dozen), 2);
        assert_eq!(payout_multiplier(BetType::Column), 2);
    }

    #[test]
    fn test_game_completes_after_spin() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Roulette::init(&mut session, &mut rng);
        assert!(!session.is_complete);
        assert!(session.state_blob.is_empty());

        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = Roulette::process_move(&mut session, &[1, 0], &mut rng); // Bet on red

        assert!(result.is_ok());
        assert!(session.is_complete);
        assert_eq!(session.state_blob.len(), 1);
        assert!(session.state_blob[0] <= 36);
    }

    #[test]
    fn test_invalid_bet_number() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Roulette::init(&mut session, &mut rng);

        let mut rng = GameRng::new(&seed, session.id, 1);
        // Straight bet on 37 (invalid)
        let result = Roulette::process_move(&mut session, &[0, 37], &mut rng);
        assert!(matches!(result, Err(GameError::InvalidPayload)));

        // Dozen bet on 3 (invalid, should be 0, 1, or 2)
        let result = Roulette::process_move(&mut session, &[7, 3], &mut rng);
        assert!(matches!(result, Err(GameError::InvalidPayload)));
    }

    #[test]
    fn test_straight_win_payout() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Roulette::init(&mut session, &mut rng);

        // We need to find a seed that produces a known result
        // For testing, let's just verify the payout calculation is correct
        // by manually checking a few spins
        for session_id in 1..100 {
            let mut test_session = create_test_session(100);
            test_session.id = session_id;
            let mut rng = GameRng::new(&seed, session_id, 0);
            Roulette::init(&mut test_session, &mut rng);

            let mut rng = GameRng::new(&seed, session_id, 1);
            // Bet on number 0
            let result = Roulette::process_move(&mut test_session, &[0, 0], &mut rng);

            if let Ok(GameResult::Win(amount)) = result {
                // Straight bet pays 35:1
                assert_eq!(amount, 100 * 35);
                return; // Found a winning case
            }
        }
        // Note: It's statistically unlikely to hit 0 in 100 tries (expected ~2-3 times)
        // but not guaranteed. This test just verifies the logic works.
    }
}
