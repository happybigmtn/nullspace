//! Sic Bo game implementation.
//!
//! State blob format:
//! [die1:u8] [die2:u8] [die3:u8]
//!
//! Payload format:
//! [betType:u8] [number:u8]
//!
//! Bet types:
//! 0 = Small (4-10, 1:1) - loses on triple
//! 1 = Big (11-17, 1:1) - loses on triple
//! 2 = Odd total (1:1)
//! 3 = Even total (1:1)
//! 4 = Specific triple (150:1) - number = 1-6
//! 5 = Any triple (24:1)
//! 6 = Specific double (8:1) - number = 1-6
//! 7 = Total of N (various payouts) - number = 4-17
//! 8 = Single number appears (1:1 to 3:1) - number = 1-6

use super::{CasinoGame, GameError, GameResult, GameRng};
use nullspace_types::casino::GameSession;

/// Sic Bo bet types.
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BetType {
    Small = 0,          // 4-10, loses on triple (1:1)
    Big = 1,            // 11-17, loses on triple (1:1)
    Odd = 2,            // Odd total (1:1)
    Even = 3,           // Even total (1:1)
    SpecificTriple = 4, // All three same specific (150:1)
    AnyTriple = 5,      // Any triple (24:1)
    SpecificDouble = 6, // At least two of specific (8:1)
    Total = 7,          // Specific total (various)
    Single = 8,         // Single number appears 1-3 times (1:1 to 3:1)
}

impl TryFrom<u8> for BetType {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(BetType::Small),
            1 => Ok(BetType::Big),
            2 => Ok(BetType::Odd),
            3 => Ok(BetType::Even),
            4 => Ok(BetType::SpecificTriple),
            5 => Ok(BetType::AnyTriple),
            6 => Ok(BetType::SpecificDouble),
            7 => Ok(BetType::Total),
            8 => Ok(BetType::Single),
            _ => Err(GameError::InvalidPayload),
        }
    }
}

/// Payout table for total bets.
fn total_payout(total: u8) -> u64 {
    match total {
        4 | 17 => 50,
        5 | 16 => 18,
        6 | 15 => 14,
        7 | 14 => 12,
        8 | 13 => 8,
        9 | 12 => 6,
        10 | 11 => 6,
        _ => 0,
    }
}

/// Check if dice form a triple (all same).
fn is_triple(dice: &[u8; 3]) -> bool {
    dice[0] == dice[1] && dice[1] == dice[2]
}

/// Count occurrences of a specific number.
fn count_number(dice: &[u8; 3], number: u8) -> u8 {
    dice.iter().filter(|&&d| d == number).count() as u8
}

fn parse_state(state: &[u8]) -> Option<[u8; 3]> {
    if state.len() < 3 {
        return None;
    }
    Some([state[0], state[1], state[2]])
}

fn serialize_state(dice: [u8; 3]) -> Vec<u8> {
    vec![dice[0], dice[1], dice[2]]
}

pub struct SicBo;

impl CasinoGame for SicBo {
    fn init(session: &mut GameSession, _rng: &mut GameRng) -> GameResult {
        session.state_blob = vec![];
        GameResult::Continue
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
        let number = payload[1];

        // Validate number for bet types that need it
        match bet_type {
            BetType::SpecificTriple | BetType::SpecificDouble | BetType::Single => {
                if number < 1 || number > 6 {
                    return Err(GameError::InvalidPayload);
                }
            }
            BetType::Total => {
                if number < 4 || number > 17 {
                    return Err(GameError::InvalidPayload);
                }
            }
            _ => {}
        }

        // Roll three dice
        let dice: [u8; 3] = [rng.roll_die(), rng.roll_die(), rng.roll_die()];
        let total: u8 = dice.iter().sum();

        session.state_blob = serialize_state(dice);
        session.move_count += 1;
        session.is_complete = true;

        let triple = is_triple(&dice);

        // Evaluate bet
        let winnings = match bet_type {
            BetType::Small => {
                if !triple && total >= 4 && total <= 10 {
                    session.bet.saturating_mul(2) // 1:1 -> 2x
                } else {
                    0
                }
            }
            BetType::Big => {
                if !triple && total >= 11 && total <= 17 {
                    session.bet.saturating_mul(2)
                } else {
                    0
                }
            }
            BetType::Odd => {
                if total % 2 == 1 && !triple {
                    session.bet.saturating_mul(2)
                } else {
                    0
                }
            }
            BetType::Even => {
                if total % 2 == 0 && !triple {
                    session.bet.saturating_mul(2)
                } else {
                    0
                }
            }
            BetType::SpecificTriple => {
                if triple && dice[0] == number {
                    session.bet.saturating_mul(151) // 150:1 -> 151x
                } else {
                    0
                }
            }
            BetType::AnyTriple => {
                if triple {
                    session.bet.saturating_mul(25) // 24:1 -> 25x
                } else {
                    0
                }
            }
            BetType::SpecificDouble => {
                if count_number(&dice, number) >= 2 {
                    session.bet.saturating_mul(9) // 8:1 -> 9x
                } else {
                    0
                }
            }
            BetType::Total => {
                if total == number {
                    session.bet.saturating_mul(total_payout(number) + 1)
                } else {
                    0
                }
            }
            BetType::Single => {
                let count = count_number(&dice, number);
                match count {
                    1 => session.bet.saturating_mul(2),  // 1:1 -> 2x
                    2 => session.bet.saturating_mul(3),  // 2:1 -> 3x
                    3 => session.bet.saturating_mul(4),  // 3:1 -> 4x
                    _ => 0,
                }
            }
        };

        if winnings > 0 {
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
    use nullspace_types::casino::GameType;

    fn create_test_seed() -> nullspace_types::Seed {
        let (network_secret, _) = create_network_keypair();
        create_seed(&network_secret, 1)
    }

    fn create_test_session(bet: u64) -> GameSession {
        let (_, pk) = create_account_keypair(1);
        GameSession {
            id: 1,
            player: pk,
            game_type: GameType::SicBo,
            bet,
            state_blob: vec![],
            move_count: 0,
            created_at: 0,
            is_complete: false,
            super_mode: nullspace_types::casino::SuperModeState::default(),
        }
    }

    #[test]
    fn test_is_triple() {
        assert!(is_triple(&[1, 1, 1]));
        assert!(is_triple(&[6, 6, 6]));
        assert!(!is_triple(&[1, 1, 2]));
        assert!(!is_triple(&[1, 2, 3]));
    }

    #[test]
    fn test_count_number() {
        assert_eq!(count_number(&[1, 1, 1], 1), 3);
        assert_eq!(count_number(&[1, 1, 2], 1), 2);
        assert_eq!(count_number(&[1, 2, 3], 1), 1);
        assert_eq!(count_number(&[2, 2, 3], 1), 0);
    }

    #[test]
    fn test_total_payout() {
        assert_eq!(total_payout(4), 50);
        assert_eq!(total_payout(17), 50);
        assert_eq!(total_payout(5), 18);
        assert_eq!(total_payout(10), 6);
        assert_eq!(total_payout(11), 6);
    }

    #[test]
    fn test_small_bet() {
        // Small: total 4-10, loses on triple
        // Total 6 (non-triple) = win
        let dice = [1, 2, 3]; // total 6
        let total: u8 = dice.iter().sum();
        let triple = is_triple(&dice);

        assert!(!triple && total >= 4 && total <= 10);
    }

    #[test]
    fn test_big_bet() {
        // Big: total 11-17, loses on triple
        let dice = [4, 5, 6]; // total 15
        let total: u8 = dice.iter().sum();
        let triple = is_triple(&dice);

        assert!(!triple && total >= 11 && total <= 17);
    }

    #[test]
    fn test_game_completes() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        SicBo::init(&mut session, &mut rng);
        assert!(!session.is_complete);

        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = SicBo::process_move(&mut session, &[0, 0], &mut rng); // Small bet

        assert!(result.is_ok());
        assert!(session.is_complete);
        assert_eq!(session.state_blob.len(), 3);

        let dice = parse_state(&session.state_blob).unwrap();
        for die in dice.iter() {
            assert!(*die >= 1 && *die <= 6);
        }
    }

    #[test]
    fn test_invalid_number() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        SicBo::init(&mut session, &mut rng);

        let mut rng = GameRng::new(&seed, session.id, 1);

        // Single bet with invalid number (0)
        let result = SicBo::process_move(&mut session, &[8, 0], &mut rng);
        assert!(matches!(result, Err(GameError::InvalidPayload)));

        // Single bet with invalid number (7)
        let result = SicBo::process_move(&mut session, &[8, 7], &mut rng);
        assert!(matches!(result, Err(GameError::InvalidPayload)));

        // Total bet with invalid number (3)
        let result = SicBo::process_move(&mut session, &[7, 3], &mut rng);
        assert!(matches!(result, Err(GameError::InvalidPayload)));
    }

    #[test]
    fn test_various_outcomes() {
        let seed = create_test_seed();

        for session_id in 1..30 {
            let mut session = create_test_session(100);
            session.id = session_id;

            let mut rng = GameRng::new(&seed, session_id, 0);
            SicBo::init(&mut session, &mut rng);

            let mut rng = GameRng::new(&seed, session_id, 1);
            let result = SicBo::process_move(&mut session, &[0, 0], &mut rng);

            assert!(result.is_ok());
            assert!(session.is_complete);

            match result.unwrap() {
                GameResult::Win(_) | GameResult::Loss => {}
                _ => panic!("SicBo should complete with Win or Loss"),
            }
        }
    }
}
