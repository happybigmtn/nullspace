//! HiLo game implementation.
//!
//! State blob format:
//! [currentCard:u8] [accumulator:i64 BE]
//!
//! The accumulator stores the current pot multiplier in basis points (1/10000).
//! For example, 15000 = 1.5x multiplier.
//!
//! Payload format:
//! [0] = Higher - guess next card is higher
//! [1] = Lower - guess next card is lower
//! [2] = Cashout - take current pot

use super::{CasinoGame, GameError, GameResult, GameRng};
use battleware_types::casino::GameSession;

/// Base multiplier in basis points (1.0 = 10000)
const BASE_MULTIPLIER: i64 = 10_000;

/// HiLo move types
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Move {
    Higher = 0,
    Lower = 1,
    Cashout = 2,
}

impl TryFrom<u8> for Move {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Move::Higher),
            1 => Ok(Move::Lower),
            2 => Ok(Move::Cashout),
            _ => Err(GameError::InvalidPayload),
        }
    }
}

/// Get the rank of a card for HiLo comparison (1-13).
/// Ace = 1, 2 = 2, ..., K = 13
pub fn card_rank(card: u8) -> u8 {
    (card % 13) + 1
}

/// Calculate the multiplier for a correct guess based on probability.
/// Returns multiplier in basis points.
fn calculate_multiplier(current_rank: u8, guess_higher: bool) -> i64 {
    // Cards left that would be wins
    let wins = if guess_higher {
        // Higher: cards with rank > current
        13 - current_rank as i64
    } else {
        // Lower: cards with rank < current
        current_rank as i64 - 1
    };

    if wins <= 0 {
        // No possible wins (e.g., guessing higher than King)
        return 0;
    }

    // Multiplier = 13 / wins (approximate fair odds)
    // Stored in basis points for precision
    (13 * BASE_MULTIPLIER) / wins
}

/// Parse state blob into current card and accumulator.
fn parse_state(state: &[u8]) -> Option<(u8, i64)> {
    if state.len() < 9 {
        return None;
    }

    let current_card = state[0];
    let accumulator = i64::from_be_bytes([
        state[1], state[2], state[3], state[4], state[5], state[6], state[7], state[8],
    ]);

    Some((current_card, accumulator))
}

/// Serialize state to blob.
fn serialize_state(current_card: u8, accumulator: i64) -> Vec<u8> {
    let mut state = Vec::with_capacity(9);
    state.push(current_card);
    state.extend_from_slice(&accumulator.to_be_bytes());
    state
}

pub struct HiLo;

impl CasinoGame for HiLo {
    fn init(session: &mut GameSession, rng: &mut GameRng) {
        // Deal one card to start
        let mut deck = rng.create_deck();
        let card = rng.draw_card(&mut deck).unwrap();

        // Initial accumulator = bet amount in basis points (1x)
        let accumulator = BASE_MULTIPLIER;

        session.state_blob = serialize_state(card, accumulator);
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

        let mv = Move::try_from(payload[0])?;
        let (current_card, accumulator) =
            parse_state(&session.state_blob).ok_or(GameError::InvalidPayload)?;

        match mv {
            Move::Cashout => {
                // Cash out with current accumulated amount
                session.is_complete = true;

                // Calculate actual payout from accumulator with overflow protection
                // accumulator is in basis points, so divide by BASE_MULTIPLIER
                let payout = (session.bet as i64)
                    .checked_mul(accumulator)
                    .and_then(|v| v.checked_div(BASE_MULTIPLIER))
                    .unwrap_or(i64::MAX);

                // Return profit (payout - original bet)
                let profit = payout.saturating_sub(session.bet as i64);
                if profit > 0 {
                    Ok(GameResult::Win(profit as u64))
                } else if profit < 0 {
                    Ok(GameResult::Loss)
                } else {
                    Ok(GameResult::Push)
                }
            }
            Move::Higher | Move::Lower => {
                let guess_higher = mv == Move::Higher;
                let current_rank = card_rank(current_card);

                // Check for impossible guesses
                if (guess_higher && current_rank == 13) || (!guess_higher && current_rank == 1) {
                    return Err(GameError::InvalidMove);
                }

                // Draw new card (recreate deck without current card)
                let mut deck = rng.create_deck_excluding(&[current_card]);
                let new_card = rng.draw_card(&mut deck).ok_or(GameError::InvalidMove)?;
                let new_rank = card_rank(new_card);

                session.move_count += 1;

                // Check if guess was correct
                let correct = if guess_higher {
                    new_rank > current_rank
                } else {
                    new_rank < current_rank
                };

                if correct {
                    // Calculate new accumulator with overflow protection
                    let multiplier = calculate_multiplier(current_rank, guess_higher);
                    let new_accumulator = accumulator
                        .checked_mul(multiplier)
                        .and_then(|v| v.checked_div(BASE_MULTIPLIER))
                        .unwrap_or(i64::MAX); // Cap at maximum on overflow

                    session.state_blob = serialize_state(new_card, new_accumulator);
                    Ok(GameResult::Continue)
                } else {
                    // Wrong guess - lose everything
                    session.state_blob = serialize_state(new_card, 0);
                    session.is_complete = true;
                    Ok(GameResult::Loss)
                }
            }
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
            game_type: GameType::HiLo,
            bet,
            state_blob: vec![],
            move_count: 0,
            created_at: 0,
            is_complete: false,
            super_mode: battleware_types::casino::SuperModeState::default(),
        }
    }

    #[test]
    fn test_card_rank() {
        // Ace = 1
        assert_eq!(card_rank(0), 1);
        assert_eq!(card_rank(13), 1);
        assert_eq!(card_rank(26), 1);

        // 2 = 2
        assert_eq!(card_rank(1), 2);

        // King = 13
        assert_eq!(card_rank(12), 13);
        assert_eq!(card_rank(25), 13);
    }

    #[test]
    fn test_calculate_multiplier() {
        // From Ace (rank 1), guessing higher: 12 wins possible
        let mult = calculate_multiplier(1, true);
        assert_eq!(mult, 13 * BASE_MULTIPLIER / 12); // ~1.08x

        // From King (rank 13), guessing lower: 12 wins possible
        let mult = calculate_multiplier(13, false);
        assert_eq!(mult, 13 * BASE_MULTIPLIER / 12); // ~1.08x

        // From 7 (middle), guessing higher: 6 wins possible
        let mult = calculate_multiplier(7, true);
        assert_eq!(mult, 13 * BASE_MULTIPLIER / 6); // ~2.16x

        // From 2, guessing lower: only 1 win possible (Ace)
        let mult = calculate_multiplier(2, false);
        assert_eq!(mult, 13 * BASE_MULTIPLIER / 1); // 13x
    }

    #[test]
    fn test_impossible_guess() {
        // Cannot guess higher than King
        assert_eq!(calculate_multiplier(13, true), 0);

        // Cannot guess lower than Ace
        assert_eq!(calculate_multiplier(1, false), 0);
    }

    #[test]
    fn test_parse_serialize_roundtrip() {
        let card = 25; // Queen of diamonds
        let accumulator = 15_000; // 1.5x

        let state = serialize_state(card, accumulator);
        let (c, a) = parse_state(&state).unwrap();

        assert_eq!(c, card);
        assert_eq!(a, accumulator);
    }

    #[test]
    fn test_init_deals_card() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        HiLo::init(&mut session, &mut rng);

        let (card, accumulator) = parse_state(&session.state_blob).unwrap();

        assert!(card < 52);
        assert_eq!(accumulator, BASE_MULTIPLIER);
        assert!(!session.is_complete);
    }

    #[test]
    fn test_cashout_immediately() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        HiLo::init(&mut session, &mut rng);

        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = HiLo::process_move(&mut session, &[2], &mut rng); // Cashout

        assert!(result.is_ok());
        assert!(session.is_complete);

        // Immediate cashout at 1x should be a push
        match result.unwrap() {
            GameResult::Push => {}
            _ => panic!("Expected push on immediate cashout"),
        }
    }

    #[test]
    fn test_cannot_guess_higher_than_king() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);

        // Force a King in state
        session.state_blob = serialize_state(12, BASE_MULTIPLIER); // King

        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = HiLo::process_move(&mut session, &[0], &mut rng); // Higher

        assert!(matches!(result, Err(GameError::InvalidMove)));
    }

    #[test]
    fn test_cannot_guess_lower_than_ace() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);

        // Force an Ace in state
        session.state_blob = serialize_state(0, BASE_MULTIPLIER); // Ace

        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = HiLo::process_move(&mut session, &[1], &mut rng); // Lower

        assert!(matches!(result, Err(GameError::InvalidMove)));
    }

    #[test]
    fn test_winning_streak() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);

        // Start with a 2 (lots of room to go higher)
        session.state_blob = serialize_state(1, BASE_MULTIPLIER); // 2 of spades

        let mut move_num = 1;
        let mut streak = 0;

        // Keep guessing higher until we lose or win 5 times
        while streak < 5 && !session.is_complete {
            let mut rng = GameRng::new(&seed, session.id, move_num);
            let result = HiLo::process_move(&mut session, &[0], &mut rng); // Higher

            match result {
                Ok(GameResult::Continue) => {
                    streak += 1;
                    let (_, acc) = parse_state(&session.state_blob).unwrap();
                    // Accumulator should be growing
                    assert!(acc > BASE_MULTIPLIER);
                }
                Ok(GameResult::Loss) => {
                    break;
                }
                _ => {}
            }
            move_num += 1;
        }
    }
}
