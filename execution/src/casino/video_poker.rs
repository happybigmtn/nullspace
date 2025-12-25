//! Video Poker (Jacks or Better) implementation.
//!
//! State blob format:
//! [stage:u8] [card1:u8] [card2:u8] [card3:u8] [card4:u8] [card5:u8] [rules:u8]
//!
//! Stage: 0 = Deal (initial), 1 = Draw (after hold selection)
//!
//! Payload format:
//! [holdMask:u8] - bits indicate which cards to hold
//! bit 0 = hold card 1, bit 1 = hold card 2, etc.
//! [0xFF, rules:u8] - set paytable rules (Deal stage only)

use super::super_mode::apply_super_multiplier_cards;
use super::{cards, CasinoGame, GameError, GameResult, GameRng};
use nullspace_types::casino::GameSession;

/// Jacks or Better paytable multipliers (expressed as "to 1" winnings).
mod payouts {
    pub const HIGH_CARD: u64 = 0;
    pub const JACKS_OR_BETTER: u64 = 1;
    pub const TWO_PAIR: u64 = 2;
    pub const THREE_OF_A_KIND: u64 = 3;
    pub const STRAIGHT: u64 = 4;
    pub const FLUSH: u64 = 6;
    pub const FULL_HOUSE: u64 = 9;
    pub const FOUR_OF_A_KIND: u64 = 25;
    pub const STRAIGHT_FLUSH: u64 = 50;
    pub const ROYAL_FLUSH: u64 = 800;
}

/// Video Poker stages.
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    Deal = 0,
    Draw = 1,
}

impl TryFrom<u8> for Stage {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Stage::Deal),
            1 => Ok(Stage::Draw),
            _ => Err(GameError::InvalidPayload),
        }
    }
}

/// Poker hand rankings.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Hand {
    HighCard = 0,
    JacksOrBetter = 1,
    TwoPair = 2,
    ThreeOfAKind = 3,
    Straight = 4,
    Flush = 5,
    FullHouse = 6,
    FourOfAKind = 7,
    StraightFlush = 8,
    RoyalFlush = 9,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum VideoPokerPaytable {
    NineSix = 0,
    EightFive = 1,
}

impl Default for VideoPokerPaytable {
    fn default() -> Self {
        VideoPokerPaytable::NineSix
    }
}

impl TryFrom<u8> for VideoPokerPaytable {
    type Error = ();

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(VideoPokerPaytable::NineSix),
            1 => Ok(VideoPokerPaytable::EightFive),
            _ => Err(()),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct VideoPokerRules {
    paytable: VideoPokerPaytable,
}

impl Default for VideoPokerRules {
    fn default() -> Self {
        Self {
            paytable: VideoPokerPaytable::default(),
        }
    }
}

impl VideoPokerRules {
    fn from_byte(value: u8) -> Option<Self> {
        Some(Self {
            paytable: VideoPokerPaytable::try_from(value & 0x01).ok()?,
        })
    }

    fn to_byte(self) -> u8 {
        self.paytable as u8
    }
}

struct VideoPokerState {
    stage: Stage,
    cards: [u8; 5],
    rules: VideoPokerRules,
}

/// Evaluate a 5-card poker hand.
/// Optimized to avoid heap allocations.
pub fn evaluate_hand(cards: &[u8; 5]) -> Hand {
    // Extract ranks and suits into fixed arrays
    let mut ranks = [0u8; 5];
    let mut suits = [0u8; 5];
    for (i, &card) in cards.iter().enumerate() {
        ranks[i] = cards::card_rank_one_based(card);
        suits[i] = cards::card_suit(card);
    }
    ranks.sort_unstable();

    // Check flush
    let is_flush = suits[0] == suits[1]
        && suits[1] == suits[2]
        && suits[2] == suits[3]
        && suits[3] == suits[4];

    // Check for duplicates (to determine if straight is possible)
    let has_duplicates = ranks[0] == ranks[1]
        || ranks[1] == ranks[2]
        || ranks[2] == ranks[3]
        || ranks[3] == ranks[4];

    // Check for straight (including A-2-3-4-5 and 10-J-Q-K-A)
    let is_straight = if has_duplicates {
        false
    } else if ranks == [1, 10, 11, 12, 13] {
        // A-10-J-Q-K (ace high straight / royal)
        true
    } else if ranks == [1, 2, 3, 4, 5] {
        // A-2-3-4-5 (ace low straight)
        true
    } else {
        ranks[4] - ranks[0] == 4
    };

    let is_royal = ranks == [1, 10, 11, 12, 13];

    // Count rank occurrences
    let mut counts = [0u8; 14];
    for &r in &ranks {
        counts[r as usize] += 1;
    }

    let mut pairs = 0u8;
    let mut three_kind = false;
    let mut four_kind = false;
    let mut high_pair = false; // Jacks or better

    for (rank, &count) in counts.iter().enumerate() {
        match count {
            2 => {
                pairs += 1;
                if rank >= 11 || rank == 1 {
                    // J, Q, K, A
                    high_pair = true;
                }
            }
            3 => three_kind = true,
            4 => four_kind = true,
            _ => {}
        }
    }

    // Determine hand
    if is_royal && is_flush {
        Hand::RoyalFlush
    } else if is_straight && is_flush {
        Hand::StraightFlush
    } else if four_kind {
        Hand::FourOfAKind
    } else if three_kind && pairs == 1 {
        Hand::FullHouse
    } else if is_flush {
        Hand::Flush
    } else if is_straight {
        Hand::Straight
    } else if three_kind {
        Hand::ThreeOfAKind
    } else if pairs == 2 {
        Hand::TwoPair
    } else if pairs == 1 && high_pair {
        Hand::JacksOrBetter
    } else {
        Hand::HighCard
    }
}

/// Payout multiplier for each hand (Jacks or Better paytable).
fn payout_multiplier(hand: Hand, paytable: VideoPokerPaytable) -> u64 {
    match paytable {
        VideoPokerPaytable::NineSix => match hand {
            Hand::HighCard => 0,
            Hand::JacksOrBetter => 1,
            Hand::TwoPair => 2,
            Hand::ThreeOfAKind => 3,
            Hand::Straight => 4,
            Hand::Flush => 6,
            Hand::FullHouse => 9,
            Hand::FourOfAKind => 25,
            Hand::StraightFlush => 50,
            Hand::RoyalFlush => 800,
        },
        VideoPokerPaytable::EightFive => match hand {
            Hand::HighCard => 0,
            Hand::JacksOrBetter => 1,
            Hand::TwoPair => 2,
            Hand::ThreeOfAKind => 3,
            Hand::Straight => 4,
            Hand::Flush => 5,
            Hand::FullHouse => 8,
            Hand::FourOfAKind => 25,
            Hand::StraightFlush => 50,
            Hand::RoyalFlush => 800,
        },
    }
}

fn parse_state(state: &[u8]) -> Option<VideoPokerState> {
    if state.len() < 6 {
        return None;
    }
    let stage = Stage::try_from(state[0]).ok()?;
    let cards = [state[1], state[2], state[3], state[4], state[5]];
    let rules = if state.len() >= 7 {
        VideoPokerRules::from_byte(state[6])?
    } else {
        VideoPokerRules::default()
    };
    Some(VideoPokerState { stage, cards, rules })
}

fn serialize_state(stage: Stage, cards: &[u8; 5], rules: VideoPokerRules) -> Vec<u8> {
    vec![
        stage as u8,
        cards[0],
        cards[1],
        cards[2],
        cards[3],
        cards[4],
        rules.to_byte(),
    ]
}

pub struct VideoPoker;

impl CasinoGame for VideoPoker {
    fn init(session: &mut GameSession, rng: &mut GameRng) -> GameResult {
        // Deal 5 cards
        let mut deck = rng.create_deck();
        let cards: [u8; 5] = [
            rng.draw_card(&mut deck).unwrap_or(0),
            rng.draw_card(&mut deck).unwrap_or(1),
            rng.draw_card(&mut deck).unwrap_or(2),
            rng.draw_card(&mut deck).unwrap_or(3),
            rng.draw_card(&mut deck).unwrap_or(4),
        ];

        session.state_blob = serialize_state(Stage::Deal, &cards, VideoPokerRules::default());
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

        let mut state = parse_state(&session.state_blob).ok_or(GameError::InvalidPayload)?;

        if state.stage != Stage::Deal {
            return Err(GameError::GameAlreadyComplete);
        }

        if payload.len() == 2 && payload[0] == 0xFF {
            let rules = VideoPokerRules::from_byte(payload[1]).ok_or(GameError::InvalidPayload)?;
            state.rules = rules;
            session.state_blob = serialize_state(state.stage, &state.cards, state.rules);
            return Ok(GameResult::Continue(vec![]));
        }

        if payload.len() != 1 {
            return Err(GameError::InvalidPayload);
        }

        let hold_mask = payload[0];
        session.move_count += 1;

        // Build the draw deck from the remaining cards in the pack.
        // All 5 originally-dealt cards are removed from the deck (even discards cannot be re-drawn).
        let original_cards = state.cards;
        let mut deck = rng.create_deck_excluding(&original_cards);

        // Replace non-held cards
        for (i, card) in state.cards.iter_mut().enumerate() {
            if hold_mask & (1 << i) == 0 {
                *card = rng.draw_card(&mut deck).ok_or(GameError::InvalidMove)?;
            }
        }

        session.state_blob = serialize_state(Stage::Draw, &state.cards, state.rules);
        session.is_complete = true;

        // Evaluate final hand
        let hand = evaluate_hand(&state.cards);
        let multiplier = payout_multiplier(hand, state.rules.paytable);

        // Generate completion logs for frontend display
        let logs = vec![format!("RESULT:{}:{}", hand as u8, multiplier)];

        if multiplier > 0 {
            // Pay tables are expressed "to 1" (winnings). Our executor expects TOTAL RETURN.
            let base_winnings = session.bet.saturating_mul(multiplier.saturating_add(1));
            // Apply super mode multipliers if active
            let final_winnings = if session.super_mode.is_active {
                apply_super_multiplier_cards(
                    &state.cards,
                    &session.super_mode.multipliers,
                    base_winnings,
                )
            } else {
                base_winnings
            };
            Ok(GameResult::Win(final_winnings, logs))
        } else {
            Ok(GameResult::Loss(logs))
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
            game_type: GameType::VideoPoker,
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
        assert_eq!(cards::card_rank_one_based(0), 1); // Ace
        assert_eq!(cards::card_rank_one_based(1), 2); // 2
        assert_eq!(cards::card_rank_one_based(12), 13); // King
    }

    #[test]
    fn test_card_suit() {
        assert_eq!(cards::card_suit(0), 0); // Spades
        assert_eq!(cards::card_suit(13), 1); // Hearts
        assert_eq!(cards::card_suit(26), 2); // Diamonds
        assert_eq!(cards::card_suit(39), 3); // Clubs
    }

    #[test]
    fn test_evaluate_royal_flush() {
        // 10, J, Q, K, A of same suit
        let cards = [9, 10, 11, 12, 0]; // 10-J-Q-K-A of spades
        assert_eq!(evaluate_hand(&cards), Hand::RoyalFlush);
    }

    #[test]
    fn test_evaluate_straight_flush() {
        // 5, 6, 7, 8, 9 of same suit
        let cards = [4, 5, 6, 7, 8]; // 5-6-7-8-9 of spades
        assert_eq!(evaluate_hand(&cards), Hand::StraightFlush);
    }

    #[test]
    fn test_evaluate_four_of_a_kind() {
        // Four Aces
        let cards = [0, 13, 26, 39, 1]; // A-A-A-A-2
        assert_eq!(evaluate_hand(&cards), Hand::FourOfAKind);
    }

    #[test]
    fn test_evaluate_full_house() {
        // Three Kings and two Queens
        let cards = [12, 25, 38, 11, 24]; // K-K-K-Q-Q
        assert_eq!(evaluate_hand(&cards), Hand::FullHouse);
    }

    #[test]
    fn test_evaluate_flush() {
        // All same suit, non-sequential
        let cards = [0, 2, 4, 6, 8]; // A-3-5-7-9 of spades
        assert_eq!(evaluate_hand(&cards), Hand::Flush);
    }

    #[test]
    fn test_evaluate_straight() {
        // Sequential, different suits
        let cards = [4, 18, 32, 7, 21]; // 5-6-7-8-9 mixed suits
        assert_eq!(evaluate_hand(&cards), Hand::Straight);
    }

    #[test]
    fn test_evaluate_three_of_a_kind() {
        let cards = [0, 13, 26, 1, 2]; // A-A-A-2-3
        assert_eq!(evaluate_hand(&cards), Hand::ThreeOfAKind);
    }

    #[test]
    fn test_evaluate_two_pair() {
        let cards = [0, 13, 1, 14, 2]; // A-A-2-2-3
        assert_eq!(evaluate_hand(&cards), Hand::TwoPair);
    }

    #[test]
    fn test_evaluate_jacks_or_better() {
        let cards = [10, 23, 1, 2, 3]; // J-J-2-3-4
        assert_eq!(evaluate_hand(&cards), Hand::JacksOrBetter);
    }

    #[test]
    fn test_evaluate_low_pair() {
        // Pair of 2s - not jacks or better
        let cards = [1, 14, 3, 4, 5]; // 2-2-4-5-6
        assert_eq!(evaluate_hand(&cards), Hand::HighCard);
    }

    #[test]
    fn test_payout_multipliers() {
        assert_eq!(
            payout_multiplier(Hand::HighCard, VideoPokerPaytable::NineSix),
            0
        );
        assert_eq!(
            payout_multiplier(Hand::JacksOrBetter, VideoPokerPaytable::NineSix),
            1
        );
        assert_eq!(
            payout_multiplier(Hand::TwoPair, VideoPokerPaytable::NineSix),
            2
        );
        assert_eq!(
            payout_multiplier(Hand::RoyalFlush, VideoPokerPaytable::NineSix),
            800
        );
        assert_eq!(
            payout_multiplier(Hand::Flush, VideoPokerPaytable::EightFive),
            5
        );
    }

    #[test]
    fn test_game_flow() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        VideoPoker::init(&mut session, &mut rng);
        assert!(!session.is_complete);

        let parsed = parse_state(&session.state_blob).expect("Failed to parse state");
        assert_eq!(parsed.stage, Stage::Deal);
        for card in parsed.cards {
            assert!(card < 52);
        }

        // Hold all cards
        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = VideoPoker::process_move(&mut session, &[0b11111], &mut rng);

        assert!(result.is_ok());
        assert!(session.is_complete);
    }

    #[test]
    fn test_discard_all() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        VideoPoker::init(&mut session, &mut rng);
        let original_cards = parse_state(&session.state_blob)
            .expect("Failed to parse state")
            .cards;

        // Discard all cards (hold none)
        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = VideoPoker::process_move(&mut session, &[0], &mut rng);

        assert!(result.is_ok());
        let new_cards = parse_state(&session.state_blob)
            .expect("Failed to parse state")
            .cards;

        // None of the original 5 cards may be re-drawn in the same hand.
        let same_count = original_cards
            .iter()
            .filter(|c| new_cards.contains(c))
            .count();
        assert_eq!(same_count, 0);
    }

    #[test]
    fn test_payout_includes_stake() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        // Force a known Jacks-or-Better hand and hold all cards so no draw occurs.
        let cards = [10, 23, 1, 2, 3]; // J-J-2-3-4
        session.state_blob = serialize_state(Stage::Deal, &cards, VideoPokerRules::default());

        let result = VideoPoker::process_move(&mut session, &[0b11111], &mut rng)
            .expect("Failed to process move");

        // Jacks-or-Better pays 1:1 -> total return 2x bet
        assert!(matches!(result, GameResult::Win(200, _)));
    }

    #[test]
    fn test_ace_low_straight() {
        // A-2-3-4-5 (wheel)
        let cards = [0, 1, 2, 3, 4]; // A-2-3-4-5 of spades
        assert_eq!(evaluate_hand(&cards), Hand::StraightFlush); // All same suit
    }
}
