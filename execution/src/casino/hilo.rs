//! HiLo game implementation.
//!
//! State blob format:
//! [currentCard:u8] [accumulator:i64 BE] [rules:u8]
//! [higherMultiplier:u32 BE] [lowerMultiplier:u32 BE] [sameMultiplier:u32 BE]
//!
//! The accumulator stores the current pot multiplier in basis points (1/10000).
//! For example, 15000 = 1.5x multiplier.
//!
//! Payload format:
//! [0] = Higher - guess next card is higher
//! [1] = Lower - guess next card is lower
//! [2] = Cashout - take current pot
//! [3] = Same - guess next card is same rank (only valid at Ace or King)
//!
//! Win conditions:
//! - Normal cards (2-Q): Higher wins on >, Lower wins on <, Same rank = PUSH (continue, no multiplier change)
//! - Ace (rank 1): Only Higher (>) and Same (=) are valid options
//! - King (rank 13): Only Lower (<) and Same (=) are valid options
//!
//! Draws WITH replacement (always 52 cards in deck).

use super::logging::clamp_i64;
use super::serialization::{StateReader, StateWriter};
use super::super_mode::apply_hilo_streak_multiplier;
use super::{cards, CasinoGame, GameError, GameResult, GameRng};
use nullspace_types::casino::GameSession;

/// Base multiplier in basis points (1.0 = 10000)
const BASE_MULTIPLIER: i64 = 10_000;
/// Max base bet amount to keep i64-safe deductions.
const MAX_BASE_BET_AMOUNT: u64 = i64::MAX as u64;
const STATE_LEN_BASE: usize = 9;
const STATE_LEN_WITH_RULES: usize = 10;
const STATE_LEN_WITH_MULTIPLIERS: usize = 22;

fn clamp_base_bet(session: &mut GameSession) {
    if session.bet > MAX_BASE_BET_AMOUNT {
        session.bet = MAX_BASE_BET_AMOUNT;
    }
}

fn format_card_label(card: u8) -> String {
    if !cards::is_valid_card(card) {
        return "?".to_string();
    }
    let rank = cards::card_rank_one_based(card);
    let rank_label = match rank {
        1 => "A".to_string(),
        11 => "J".to_string(),
        12 => "Q".to_string(),
        13 => "K".to_string(),
        10 => "10".to_string(),
        _ => rank.to_string(),
    };
    let suit = match cards::card_suit(card) {
        0 => "S",
        1 => "H",
        2 => "D",
        3 => "C",
        _ => "?",
    };
    format!("{}{}", rank_label, suit)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct HiLoRules {
    allow_same_any: bool,
    tie_push: bool,
}

impl Default for HiLoRules {
    fn default() -> Self {
        Self {
            allow_same_any: false,
            tie_push: true,
        }
    }
}

impl HiLoRules {
    fn from_byte(value: u8) -> Self {
        Self {
            allow_same_any: value & 0x01 != 0,
            tie_push: value & 0x02 != 0,
        }
    }

    fn to_byte(self) -> u8 {
        (if self.allow_same_any { 0x01 } else { 0x00 })
            | if self.tie_push { 0x02 } else { 0x00 }
    }
}

struct HiLoState {
    current_card: u8,
    accumulator: i64,
    rules: HiLoRules,
}

/// HiLo move types
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Move {
    Higher = 0,
    Lower = 1,
    Cashout = 2,
    Same = 3,
}

impl TryFrom<u8> for Move {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Move::Higher),
            1 => Ok(Move::Lower),
            2 => Ok(Move::Cashout),
            3 => Ok(Move::Same),
            _ => Err(GameError::InvalidPayload),
        }
    }
}

/// Get the rank of a card for HiLo comparison (1-13).
/// Ace = 1, 2 = 2, ..., K = 13
pub fn card_rank(card: u8) -> u8 {
    cards::card_rank_one_based(card)
}

/// Calculate the multiplier for a correct guess based on probability.
/// Returns multiplier in basis points.
///
/// With 52 cards (draw with replacement):
/// - Same (at Ace/King only): 1 rank wins → 12x multiplier
/// - Higher/Lower: strictly higher/lower wins, same = push (no multiplier change)
fn calculate_multiplier(current_rank: u8, mv: Move) -> i64 {
    let winning_ranks = match mv {
        Move::Same => {
            // Same: only 1 rank wins (4 cards out of 52) = 12x
            1
        }
        Move::Higher => {
            if current_rank == 13 {
                // At King: Higher is invalid (should use Same)
                return 0;
            }
            // Strictly higher: ranks above current
            13 - current_rank as i64
        }
        Move::Lower => {
            if current_rank == 1 {
                // At Ace: Lower is invalid (should use Same)
                return 0;
            }
            // Strictly lower: ranks below current
            current_rank as i64 - 1
        }
        Move::Cashout => return 0,
    };

    if winning_ranks <= 0 {
        return 0;
    }

    // Multiplier = 13 / winning_ranks (fair odds based on rank distribution)
    (12 * BASE_MULTIPLIER) / winning_ranks
}

fn next_guess_multipliers(current_card: u8, rules: HiLoRules) -> (u32, u32, u32) {
    let current_rank = card_rank(current_card);
    let higher = calculate_multiplier(current_rank, Move::Higher);
    let lower = calculate_multiplier(current_rank, Move::Lower);
    let same = if rules.allow_same_any || current_rank == 1 || current_rank == 13 {
        calculate_multiplier(current_rank, Move::Same)
    } else {
        0
    };

    let clamp = |value: i64| -> u32 {
        if value <= 0 {
            0
        } else if value > u32::MAX as i64 {
            u32::MAX
        } else {
            value as u32
        }
    };

    (clamp(higher), clamp(lower), clamp(same))
}

/// Parse state blob into current card, accumulator, and rules.
fn parse_state(state: &[u8]) -> Option<HiLoState> {
    if state.len() < STATE_LEN_BASE {
        return None;
    }
    if state.len() != STATE_LEN_BASE
        && state.len() != STATE_LEN_WITH_RULES
        && state.len() != STATE_LEN_WITH_MULTIPLIERS
    {
        return None;
    }

    let mut reader = StateReader::new(state);
    let current_card = reader.read_u8()?;
    if current_card >= 52 {
        return None;
    }
    let accumulator = reader.read_i64_be()?;
    let rules = if reader.remaining() > 0 {
        HiLoRules::from_byte(reader.read_u8()?)
    } else {
        HiLoRules::default()
    };

    Some(HiLoState {
        current_card,
        accumulator,
        rules,
    })
}

/// Serialize state to blob.
fn serialize_state(current_card: u8, accumulator: i64, rules: HiLoRules) -> Vec<u8> {
    let mut state = StateWriter::with_capacity(22);
    state.push_u8(current_card);
    state.push_i64_be(accumulator);
    state.push_u8(rules.to_byte());
    let (higher, lower, same) = next_guess_multipliers(current_card, rules);
    state.push_u32_be(higher);
    state.push_u32_be(lower);
    state.push_u32_be(same);
    state.into_inner()
}

pub struct HiLo;

impl CasinoGame for HiLo {
    fn init(session: &mut GameSession, rng: &mut GameRng) -> GameResult {
        // Deal one card to start
        let mut deck = rng.create_deck();
        // This should never fail with a fresh deck, but we use a default card (Ace of Spades) as fallback
        let card = rng.draw_card(&mut deck).unwrap_or(0);

        // Initial accumulator = bet amount in basis points (1x)
        let accumulator = BASE_MULTIPLIER;

        session.state_blob = serialize_state(card, accumulator, HiLoRules::default());
        GameResult::Continue(vec![])
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

        clamp_base_bet(session);

        let mv = Move::try_from(payload[0])?;
        let state = parse_state(&session.state_blob).ok_or(GameError::InvalidPayload)?;
        let current_card = state.current_card;
        let accumulator = state.accumulator;
        let rules = state.rules;

        match mv {
            Move::Cashout => {
                // Cash out with current accumulated amount
                session.is_complete = true;

                // Calculate actual payout from accumulator with overflow protection
                // accumulator is in basis points, so divide by BASE_MULTIPLIER
                let base_payout = (session.bet as i64)
                    .checked_mul(accumulator)
                    .and_then(|v| v.checked_div(BASE_MULTIPLIER))
                    .ok_or(GameError::InvalidState)?;

                // Return total payout (stake + winnings), consistent with other games
                // Win(amount) means "add this to player chips" and the original bet
                // was already deducted at StartGame
                if base_payout > 0 {
                    // Safe cast: positive i64 fits in u64
                    let payout_u64 = u64::try_from(base_payout).unwrap_or(0);
                    // Apply super mode streak multiplier if active
                    // move_count represents the streak (number of correct guesses)
                    let final_payout = if session.super_mode.is_active && session.move_count > 0 {
                        // Check if current card is an Ace for bonus
                        let is_ace = card_rank(current_card) == 1;
                        // Cap streak at u8::MAX for the multiplier function
                        let streak = session.move_count.min(u8::MAX as u32) as u8;
                        apply_hilo_streak_multiplier(payout_u64, streak, is_ace)
                    } else {
                        payout_u64
                    };
                    let summary = format!("Cashout: {}", format_card_label(current_card));
                    let net_pnl =
                        clamp_i64(i128::from(final_payout) - i128::from(session.bet));
                    let resolved_bets = format!(
                        r#"{{"label":"CASHOUT","pnl":{}}}"#,
                        net_pnl
                    );
                    // Generate completion logs for frontend display
                    let logs = vec![format!(
                        r#"{{"summary":"{}","netPnl":{},"resolvedBets":[{}],"card":{},"guess":"CASHOUT","multiplier":{},"streak":{},"payout":{}}}"#,
                        summary,
                        net_pnl,
                        resolved_bets,
                        current_card,
                        accumulator,
                        session.move_count,
                        final_payout
                    )];
                    Ok(GameResult::Win(final_payout, logs))
                } else {
                    // Accumulator is 0 or negative (shouldn't happen in normal play)
                    let summary = format!("Cashout: {}", format_card_label(current_card));
                    let net_pnl = -(session.bet as i64);
                    let resolved_bets = format!(
                        r#"{{"label":"CASHOUT","pnl":{}}}"#,
                        net_pnl
                    );
                    let logs = vec![format!(
                        r#"{{"summary":"{}","netPnl":{},"resolvedBets":[{}],"card":{},"guess":"CASHOUT","multiplier":0,"streak":{},"payout":0}}"#,
                        summary,
                        net_pnl,
                        resolved_bets,
                        current_card,
                        session.move_count
                    )];
                    Ok(GameResult::Loss(logs))
                }
            }
            Move::Higher | Move::Lower | Move::Same => {
                let current_rank = card_rank(current_card);

                // Validate move based on current card position
                match mv {
                    Move::Same => {
                        // Same is only valid at Ace or King unless rules allow any rank.
                        if !rules.allow_same_any && current_rank != 1 && current_rank != 13 {
                            return Err(GameError::InvalidMove);
                        }
                    }
                    Move::Higher => {
                        // Higher is invalid at King (use Same instead)
                        if current_rank == 13 {
                            return Err(GameError::InvalidMove);
                        }
                    }
                    Move::Lower => {
                        // Lower is invalid at Ace (use Same instead)
                        if current_rank == 1 {
                            return Err(GameError::InvalidMove);
                        }
                    }
                    _ => {}
                }

                // Draw new card WITH REPLACEMENT (full 52-card deck)
                let mut deck = rng.create_deck();
                let new_card = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                let new_rank = card_rank(new_card);

                session.move_count += 1;

                // Check for push: same rank on Higher/Lower (not Same move)
                let is_push = rules.tie_push
                    && (mv == Move::Higher || mv == Move::Lower)
                    && new_rank == current_rank;

                // Determine if guess was correct
                let correct = match mv {
                    Move::Same => new_rank == current_rank,
                    Move::Higher => new_rank > current_rank, // Strictly higher
                    Move::Lower => new_rank < current_rank,  // Strictly lower
                    _ => false,
                };

                let guess_str = match mv {
                    Move::Higher => "HIGHER",
                    Move::Lower => "LOWER",
                    Move::Same => "SAME",
                    _ => "UNKNOWN",
                };

                if is_push {
                    // Push: same rank drawn, game continues with no multiplier change
                    session.state_blob = serialize_state(new_card, accumulator, rules);
                    let summary = format!(
                        "{} -> {}",
                        format_card_label(current_card),
                        format_card_label(new_card)
                    );
                    let logs = vec![format!(
                        r#"{{"summary":"{}","netPnl":0,"resolvedBets":[],"previousCard":{},"newCard":{},"guess":"{}","push":true,"multiplier":{},"streak":{}}}"#,
                        summary,
                        current_card,
                        new_card,
                        guess_str,
                        accumulator,
                        session.move_count
                    )];
                    return Ok(GameResult::Continue(logs));
                }

                if correct {
                    // Calculate new accumulator with overflow protection
                    let multiplier = calculate_multiplier(current_rank, mv);
                    let new_accumulator = accumulator
                        .checked_mul(multiplier)
                        .and_then(|v| v.checked_div(BASE_MULTIPLIER))
                        .ok_or(GameError::InvalidState)?;

                    session.state_blob = serialize_state(new_card, new_accumulator, rules);
                    // Generate move logs for frontend display
                    let summary = format!(
                        "{} -> {}",
                        format_card_label(current_card),
                        format_card_label(new_card)
                    );
                    let logs = vec![format!(
                        r#"{{"summary":"{}","netPnl":0,"resolvedBets":[],"previousCard":{},"newCard":{},"guess":"{}","correct":true,"multiplier":{},"streak":{}}}"#,
                        summary,
                        current_card,
                        new_card,
                        guess_str,
                        new_accumulator,
                        session.move_count
                    )];
                    Ok(GameResult::Continue(logs))
                } else {
                    // Wrong guess - lose everything
                    session.state_blob = serialize_state(new_card, 0, rules);
                    session.is_complete = true;
                    // Generate completion logs for frontend display
                    let summary = format!(
                        "{} -> {}",
                        format_card_label(current_card),
                        format_card_label(new_card)
                    );
                    let net_pnl = -(session.bet as i64);
                    let resolved_bets = format!(
                        r#"{{"label":"{}","pnl":{}}}"#,
                        guess_str, net_pnl
                    );
                    let logs = vec![format!(
                        r#"{{"summary":"{}","netPnl":{},"resolvedBets":[{}],"previousCard":{},"newCard":{},"guess":"{}","correct":false,"multiplier":0,"streak":{},"payout":0}}"#,
                        summary,
                        net_pnl,
                        resolved_bets,
                        current_card,
                        new_card,
                        guess_str,
                        session.move_count
                    )];
                    Ok(GameResult::Loss(logs))
                }
            }
        }
    }
}

#[cfg(test)]
#[allow(unused_must_use)]
mod tests {
    use super::*;
    use crate::mocks::{create_account_keypair, create_network_keypair, create_seed};
    use nullspace_types::casino::GameType;
    use rand::{rngs::StdRng, Rng, SeedableRng};

    fn create_test_seed() -> nullspace_types::Seed {
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
            super_mode: nullspace_types::casino::SuperModeState::default(),
            is_tournament: false,
            tournament_id: None,
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
        // From Ace (rank 1), guessing Higher (strictly): 12 ranks win (2-K)
        let mult = calculate_multiplier(1, Move::Higher);
        assert_eq!(mult, 12 * BASE_MULTIPLIER / 12); // 1.0x

        // From King (rank 13), guessing Lower (strictly): 12 ranks win (A-Q)
        let mult = calculate_multiplier(13, Move::Lower);
        assert_eq!(mult, 12 * BASE_MULTIPLIER / 12); // 1.0x

        // From 7 (middle), guessing Higher (strictly): 6 ranks win (8-K)
        let mult = calculate_multiplier(7, Move::Higher);
        assert_eq!(mult, 12 * BASE_MULTIPLIER / 6); // 2.0x

        // From 7 (middle), guessing Lower (strictly): 6 ranks win (A-6)
        let mult = calculate_multiplier(7, Move::Lower);
        assert_eq!(mult, 12 * BASE_MULTIPLIER / 6); // 2.0x

        // From 2, guessing Lower (strictly): 1 rank wins (A)
        let mult = calculate_multiplier(2, Move::Lower);
        assert_eq!(mult, 12 * BASE_MULTIPLIER); // 12x

        // Same: always 1 rank wins (4 cards out of 52) = 12x
        let mult = calculate_multiplier(7, Move::Same);
        assert_eq!(mult, 12 * BASE_MULTIPLIER); // 12x

        let mult = calculate_multiplier(1, Move::Same);
        assert_eq!(mult, 12 * BASE_MULTIPLIER); // 12x at Ace

        let mult = calculate_multiplier(13, Move::Same);
        assert_eq!(mult, 12 * BASE_MULTIPLIER); // 12x at King
    }

    #[test]
    fn test_impossible_guess() {
        // Cannot guess higher than King (should use Same)
        assert_eq!(calculate_multiplier(13, Move::Higher), 0);

        // Cannot guess lower than Ace (should use Same)
        assert_eq!(calculate_multiplier(1, Move::Lower), 0);
    }

    #[test]
    fn test_state_blob_fuzz_does_not_panic() {
        let mut rng = StdRng::seed_from_u64(0x5eed_4110);
        for _ in 0..1_000 {
            let len = rng.gen_range(0..=64);
            let mut blob = vec![0u8; len];
            rng.fill(&mut blob[..]);
            let _ = parse_state(&blob);
        }
    }

    #[test]
    fn test_parse_serialize_roundtrip() {
        let card = 25; // Queen of diamonds
        let accumulator = 15_000; // 1.5x

        let state = serialize_state(card, accumulator, HiLoRules::default());
        let parsed = parse_state(&state).expect("Failed to parse state");

        assert_eq!(parsed.current_card, card);
        assert_eq!(parsed.accumulator, accumulator);
    }

    #[test]
    fn test_init_deals_card() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        HiLo::init(&mut session, &mut rng);

        let parsed = parse_state(&session.state_blob).expect("Failed to parse state");

        assert!(parsed.current_card < 52);
        assert_eq!(parsed.accumulator, BASE_MULTIPLIER);
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

        // Immediate cashout at 1x returns the bet (stake returned = Win(100))
        match result.expect("Failed to process cashout") {
            GameResult::Win(amount, _) => assert_eq!(amount, 100), // Returns the original bet
            _ => panic!("Expected Win on immediate cashout"),
        }
    }

    #[test]
    fn test_cannot_guess_higher_than_king() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);

        // Force a King in state
        session.state_blob = serialize_state(12, BASE_MULTIPLIER, HiLoRules::default()); // King

        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = HiLo::process_move(&mut session, &[0], &mut rng); // Higher

        assert!(matches!(result, Err(GameError::InvalidMove)));
    }

    #[test]
    fn test_cannot_guess_lower_than_ace() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);

        // Force an Ace in state
        session.state_blob = serialize_state(0, BASE_MULTIPLIER, HiLoRules::default()); // Ace

        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = HiLo::process_move(&mut session, &[1], &mut rng); // Lower

        assert!(matches!(result, Err(GameError::InvalidMove)));
    }

    #[test]
    fn test_winning_streak() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);

        // Start with a 2 (lots of room to go higher)
        session.state_blob = serialize_state(1, BASE_MULTIPLIER, HiLoRules::default()); // 2 of spades

        let mut move_num = 1;
        let mut streak = 0;

        // Keep guessing higher until we lose or win 5 times
        while streak < 5 && !session.is_complete {
            let mut rng = GameRng::new(&seed, session.id, move_num);
            let result = HiLo::process_move(&mut session, &[0], &mut rng); // Higher

            match result {
                Ok(GameResult::Continue(_)) => {
                    streak += 1;
                    let parsed = parse_state(&session.state_blob).expect("Failed to parse state");
                    // Accumulator should be growing
                    assert!(parsed.accumulator > BASE_MULTIPLIER);
                }
                Ok(GameResult::Loss(_)) => {
                    break;
                }
                Err(_) => {
                    // Error (e.g., trying to guess higher than King) - break to avoid infinite loop
                    break;
                }
                _ => {}
            }
            move_num += 1;
        }
    }

    #[test]
    fn test_same_only_valid_at_edges() {
        let seed = create_test_seed();

        // Same should be INVALID at middle card (rank 7)
        let mut session = create_test_session(100);
        session.state_blob = serialize_state(6, BASE_MULTIPLIER, HiLoRules::default()); // 7 of spades (rank 7)
        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = HiLo::process_move(&mut session, &[3], &mut rng); // Same
        assert!(matches!(result, Err(GameError::InvalidMove)));

        // Same should be VALID at Ace
        let mut session = create_test_session(100);
        session.state_blob = serialize_state(0, BASE_MULTIPLIER, HiLoRules::default()); // Ace of spades
        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = HiLo::process_move(&mut session, &[3], &mut rng); // Same
        // Either Continue (if drew Ace) or Loss (if drew non-Ace), but not InvalidMove
        assert!(!matches!(result, Err(GameError::InvalidMove)));

        // Same should be VALID at King
        let mut session = create_test_session(100);
        session.state_blob = serialize_state(12, BASE_MULTIPLIER, HiLoRules::default()); // King of spades
        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = HiLo::process_move(&mut session, &[3], &mut rng); // Same
        assert!(!matches!(result, Err(GameError::InvalidMove)));
    }

    #[test]
    fn test_same_allowed_any_rank_variant() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let rules = HiLoRules {
            allow_same_any: true,
            tie_push: true,
        };

        // Middle card should allow SAME when variant is enabled.
        session.state_blob = serialize_state(6, BASE_MULTIPLIER, rules); // 7 of spades (rank 7)
        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = HiLo::process_move(&mut session, &[3], &mut rng); // Same
        assert!(!matches!(result, Err(GameError::InvalidMove)));
    }

    #[test]
    fn test_tie_push_on_equal_rank() {
        let seed = create_test_seed();
        let rules = HiLoRules {
            allow_same_any: false,
            tie_push: true,
        };

        let mut base_session = create_test_session(100);
        base_session.state_blob = serialize_state(6, BASE_MULTIPLIER, rules); // 7 of spades

        let mut found = false;
        for move_num in 1..=2000 {
            let mut session = base_session.clone();
            let mut rng = GameRng::new(&seed, session.id, move_num);
            let result = HiLo::process_move(&mut session, &[Move::Higher as u8], &mut rng);
            if let Ok(GameResult::Continue(_)) = result {
                let parsed = parse_state(&session.state_blob).expect("parse state");
                if parsed.accumulator == BASE_MULTIPLIER
                    && card_rank(parsed.current_card) == card_rank(6)
                {
                    found = true;
                    break;
                }
            }
        }

        assert!(found, "expected to find a tie push within search range");
    }

    #[test]
    fn test_same_rank_is_push_for_middle_cards() {
        // At rank 7, if same rank is drawn, it should be a push (continue with no multiplier change)
        // Higher wins strictly on 8-K (6 ranks), pushes on 7, loses on A-6
        let mult = calculate_multiplier(7, Move::Higher);
        assert_eq!(mult, 12 * BASE_MULTIPLIER / 6); // 2.0x for strictly higher

        // Lower wins strictly on A-6 (6 ranks), pushes on 7, loses on 8-K
        let mult = calculate_multiplier(7, Move::Lower);
        assert_eq!(mult, 12 * BASE_MULTIPLIER / 6); // 2.0x for strictly lower
    }

    #[test]
    fn test_draw_with_replacement() {
        // Verify that drawing with replacement means we can get the exact same card
        // (This is probabilistic, but the implementation should allow it)
        let seed = create_test_seed();
        let mut session = create_test_session(100);

        // Force specific card in state
        session.state_blob = serialize_state(0, BASE_MULTIPLIER, HiLoRules::default()); // Ace of spades

        // Try Higher move multiple times with different RNG states
        // With replacement, probability of getting any specific card is 1/52
        // We can't deterministically test this, but we verify no exclusion error
        for move_num in 1..10 {
            let mut test_session = session.clone();
            let mut rng = GameRng::new(&seed, test_session.id, move_num);
            let result = HiLo::process_move(&mut test_session, &[0], &mut rng); // Higher

            // Should succeed (either Continue or Loss)
            assert!(result.is_ok());
        }
    }
}
