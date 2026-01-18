//! Blackjack game implementation.
//!
//! This implementation supports:
//! - Standard blackjack main wager (`session.bet`, deducted by `CasinoStartGame`)
//! - Splits (up to 4 hands) + doubles (deducted via `ContinueWithUpdate`)
//! - 21+3 side bet (optional, placed before deal)
//!
//! House rules (executor defaults):
//! - 8-deck shoe, dealer hits soft 17 (H17)
//! - No surrender, no on-chain insurance
//! - No dealer peek (dealer hole card is drawn at `Reveal` for hidden-info safety)
//!
//! State blob format (v4; v2/v3 still accepted):
//! [version:u8=4]
//! [stage:u8]
//! [sideBet21Plus3Amount:u64 BE]
//! [sideBetLuckyLadiesAmount:u64 BE]
//! [sideBetPerfectPairsAmount:u64 BE]
//! [sideBetBustItAmount:u64 BE]
//! [sideBetRoyalMatchAmount:u64 BE]
//! [initialPlayerCard1:u8] [initialPlayerCard2:u8]   (0xFF if not dealt yet)
//! [active_hand_idx:u8]
//! [hand_count:u8]
//! ... per hand:
//!   [bet_mult:u8] (1=base, 2=doubled)
//!   [status:u8] (0=playing, 1=stand, 2=bust, 3=blackjack, 4=surrendered)
//!   [was_split:u8] (0/1; split hands cannot be a natural blackjack)
//!   [card_count:u8]
//!   [cards...]
//! [dealer_count:u8] [dealer_cards...]
//! [rules_flags:u8] [rules_decks:u8] (optional)
//!
//! Stages:
//! 0 = Betting (optional side bets, then Deal)
//! 1 = PlayerTurn
//! 2 = AwaitingReveal (player done; Reveal resolves)
//! 3 = Complete
//!
//! Payload format:
//! [move:u8] [optional amount:u64 BE]
//! 0 = Hit
//! 1 = Stand
//! 2 = Double Down
//! 3 = Split
//! 4 = Deal
//! 5 = Set 21+3 side bet (u64)
//! 6 = Reveal
//! 7 = Surrender
//! 8 = Set rules (flags:u8, decks:u8)

use super::logging::{clamp_i64, push_resolved_entry};
use super::serialization::{StateReader, StateWriter};
use super::super_mode::apply_super_multiplier_cards;
use super::{cards, CasinoGame, GameError, GameResult, GameRng};
use nullspace_types::casino::GameSession;
use std::fmt::Write;

/// Maximum cards in a blackjack hand.
const MAX_HAND_SIZE: usize = 11;
/// Maximum number of hands allowed (splits).
const MAX_HANDS: usize = 4;
/// Max base bet amount to keep i64-safe deductions.
const MAX_BASE_BET_AMOUNT: u64 = i64::MAX as u64;
/// Max side bet amount to keep i64-safe return amounts (Lucky Ladies pays 200:1 => 201x return).
const MAX_SIDE_BET_AMOUNT: u64 = (i64::MAX as u64) / 201;
const STATE_VERSION: u8 = 4;
const CARD_UNKNOWN: u8 = 0xFF;
const STATE_HEADER_V2_LEN: usize = 14;
const STATE_HEADER_V3_LEN: usize = 38;
const STATE_HEADER_V4_LEN: usize = 46;
const RULES_LEN: usize = 2;
const UI_EXTRA_LEN: usize = 3;
const ROYAL_MATCH_KQ_MULTIPLIER: u64 = 25;

fn clamp_base_bet(session: &mut GameSession) {
    if session.bet > MAX_BASE_BET_AMOUNT {
        session.bet = MAX_BASE_BET_AMOUNT;
    }
}

fn clamp_side_bet_amount(amount: u64) -> u64 {
    super::payload::clamp_bet_amount(amount, MAX_SIDE_BET_AMOUNT)
}
#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum BlackjackDecks {
    One = 0,
    Two = 1,
    Four = 2,
    Six = 3,
    #[default]
    Eight = 4,
}

impl BlackjackDecks {
    fn count(self) -> u8 {
        match self {
            BlackjackDecks::One => 1,
            BlackjackDecks::Two => 2,
            BlackjackDecks::Four => 4,
            BlackjackDecks::Six => 6,
            BlackjackDecks::Eight => 8,
        }
    }
}

impl TryFrom<u8> for BlackjackDecks {
    type Error = ();

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(BlackjackDecks::One),
            1 => Ok(BlackjackDecks::Two),
            2 => Ok(BlackjackDecks::Four),
            3 => Ok(BlackjackDecks::Six),
            4 => Ok(BlackjackDecks::Eight),
            _ => Err(()),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct BlackjackRules {
    dealer_hits_soft_17: bool,
    blackjack_pays_six_five: bool,
    late_surrender: bool,
    double_after_split: bool,
    resplit_aces: bool,
    hit_split_aces: bool,
    decks: BlackjackDecks,
}

impl Default for BlackjackRules {
    fn default() -> Self {
        Self {
            dealer_hits_soft_17: true,
            blackjack_pays_six_five: false,
            late_surrender: false,
            double_after_split: true,
            resplit_aces: true,
            hit_split_aces: true,
            decks: BlackjackDecks::default(),
        }
    }
}

impl BlackjackRules {
    fn from_bytes(flags: u8, decks: u8) -> Option<Self> {
        Some(Self {
            dealer_hits_soft_17: flags & 0x01 != 0,
            blackjack_pays_six_five: flags & 0x02 != 0,
            late_surrender: flags & 0x04 != 0,
            double_after_split: flags & 0x08 != 0,
            resplit_aces: flags & 0x10 != 0,
            hit_split_aces: flags & 0x20 != 0,
            decks: BlackjackDecks::try_from(decks).ok()?,
        })
    }

    fn to_bytes(self) -> [u8; 2] {
        let mut flags = 0u8;
        if self.dealer_hits_soft_17 {
            flags |= 0x01;
        }
        if self.blackjack_pays_six_five {
            flags |= 0x02;
        }
        if self.late_surrender {
            flags |= 0x04;
        }
        if self.double_after_split {
            flags |= 0x08;
        }
        if self.resplit_aces {
            flags |= 0x10;
        }
        if self.hit_split_aces {
            flags |= 0x20;
        }
        [flags, self.decks as u8]
    }
}

/// Blackjack game stages
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    Betting = 0,
    PlayerTurn = 1,
    AwaitingReveal = 2,
    Complete = 3,
}

impl TryFrom<u8> for Stage {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Stage::Betting),
            1 => Ok(Stage::PlayerTurn),
            2 => Ok(Stage::AwaitingReveal),
            3 => Ok(Stage::Complete),
            _ => Err(GameError::InvalidPayload),
        }
    }
}

/// Blackjack move types
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Move {
    Hit = 0,
    Stand = 1,
    Double = 2,
    Split = 3,
    Deal = 4,
    Set21Plus3 = 5,
    Reveal = 6,
    Surrender = 7,
    SetRules = 8,
}

impl TryFrom<u8> for Move {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Move::Hit),
            1 => Ok(Move::Stand),
            2 => Ok(Move::Double),
            3 => Ok(Move::Split),
            4 => Ok(Move::Deal),
            5 => Ok(Move::Set21Plus3),
            6 => Ok(Move::Reveal),
            7 => Ok(Move::Surrender),
            8 => Ok(Move::SetRules),
            _ => Err(GameError::InvalidPayload),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HandStatus {
    Playing = 0,
    Standing = 1,
    Busted = 2,
    Blackjack = 3,
    Surrendered = 4,
}

impl TryFrom<u8> for HandStatus {
    type Error = GameError;
    fn try_from(v: u8) -> Result<Self, Self::Error> {
        match v {
            0 => Ok(HandStatus::Playing),
            1 => Ok(HandStatus::Standing),
            2 => Ok(HandStatus::Busted),
            3 => Ok(HandStatus::Blackjack),
            4 => Ok(HandStatus::Surrendered),
            _ => Err(GameError::InvalidPayload),
        }
    }
}

#[derive(Clone, Debug)]
pub struct HandState {
    pub cards: Vec<u8>,
    pub bet_mult: u8,
    pub status: HandStatus,
    pub was_split: bool,
}

/// Game state structure
pub struct BlackjackState {
    pub stage: Stage,
    pub side_bet_21plus3: u64,
    pub side_bet_lucky_ladies: u64,
    pub side_bet_perfect_pairs: u64,
    pub side_bet_bust_it: u64,
    pub side_bet_royal_match: u64,
    pub initial_player_cards: [u8; 2],
    pub active_hand_idx: usize,
    pub hands: Vec<HandState>,
    pub dealer_cards: Vec<u8>,
    rules: BlackjackRules,
}

/// Calculate the value of a blackjack hand.
pub fn hand_value(cards: &[u8]) -> (u8, bool) {
    let mut value: u16 = 0;
    let mut aces: u8 = 0;

    for &card in cards {
        let rank = (card % 13) + 1; // 1=Ace, 2-10, 11=J, 12=Q, 13=K
        if rank == 1 {
            aces += 1;
            value += 11;
        } else if rank >= 10 {
            value += 10;
        } else {
            value += rank as u16;
        }
    }

    while value > 21 && aces > 0 {
        value -= 10;
        aces -= 1;
    }

    let is_soft = aces > 0 && value <= 21;
    (value.min(255) as u8, is_soft)
}

/// Check if hand is a blackjack (21 with 2 cards).
pub fn is_blackjack(cards: &[u8]) -> bool {
    cards.len() == 2 && hand_value(cards).0 == 21
}

fn is_natural_blackjack(hand: &HandState) -> bool {
    !hand.was_split && is_blackjack(&hand.cards)
}

fn is_21plus3_straight(ranks: &mut [u8; 3]) -> bool {
    ranks.sort_unstable();
    let is_wheel = *ranks == [2, 3, 14];
    let is_run = ranks[1] == ranks[0].saturating_add(1) && ranks[2] == ranks[1].saturating_add(1);
    is_wheel || is_run
}

fn eval_21plus3_multiplier(cards: [u8; 3]) -> u64 {
    // WoO 21+3 "Version 7" pay table (8 decks): 100-40-30-10-5 (to-1).
    // https://wizardofodds.com/games/blackjack/side-bets/21plus3/
    let suits = [
        cards::card_suit(cards[0]),
        cards::card_suit(cards[1]),
        cards::card_suit(cards[2]),
    ];
    let is_flush = suits[0] == suits[1] && suits[1] == suits[2];

    let r1 = cards::card_rank(cards[0]);
    let r2 = cards::card_rank(cards[1]);
    let r3 = cards::card_rank(cards[2]);
    let is_trips = r1 == r2 && r2 == r3;

    let mut ranks = [
        cards::card_rank_ace_high(cards[0]),
        cards::card_rank_ace_high(cards[1]),
        cards::card_rank_ace_high(cards[2]),
    ];
    let is_straight = is_21plus3_straight(&mut ranks);

    if is_trips && is_flush {
        return 100;
    }
    if is_straight && is_flush {
        return 40;
    }
    if is_trips {
        return 30;
    }
    if is_straight {
        return 10;
    }
    if is_flush {
        return 5;
    }
    0
}

fn resolve_21plus3_return(state: &BlackjackState) -> u64 {
    let bet = state.side_bet_21plus3;
    if bet == 0 {
        return 0;
    }
    if !state.initial_player_cards.iter().all(|&c| c < 52) {
        return 0;
    }
    let dealer_up = match state.dealer_cards.first().copied() {
        Some(c) if c < 52 => c,
        _ => return 0,
    };
    let cards = [
        state.initial_player_cards[0],
        state.initial_player_cards[1],
        dealer_up,
    ];
    let mult = eval_21plus3_multiplier(cards);
    if mult == 0 {
        0
    } else {
        bet.saturating_mul(mult.saturating_add(1))
    }
}

fn is_red_suit(suit: u8) -> bool {
    suit == 1 || suit == 2
}

fn eval_lucky_ladies_multiplier(cards: [u8; 2], dealer_blackjack: bool) -> u64 {
    let (total, _) = hand_value(&cards);
    if total != 20 {
        return 0;
    }

    let rank_one = cards::card_rank_one_based(cards[0]);
    let rank_two = cards::card_rank_one_based(cards[1]);
    let is_queens = rank_one == 12 && rank_two == 12;
    if !is_queens {
        return 4;
    }

    let suits = [cards::card_suit(cards[0]), cards::card_suit(cards[1])];
    let both_hearts = suits[0] == 1 && suits[1] == 1;
    if both_hearts && dealer_blackjack {
        // Casino-dependent (100-200:1). Default to the top-end.
        return 200;
    }
    if both_hearts {
        return 25;
    }
    10
}

fn eval_perfect_pairs_multiplier(cards: [u8; 2]) -> u64 {
    let rank_one = cards::card_rank(cards[0]);
    let rank_two = cards::card_rank(cards[1]);
    if rank_one != rank_two {
        return 0;
    }

    let suit_one = cards::card_suit(cards[0]);
    let suit_two = cards::card_suit(cards[1]);
    if suit_one == suit_two {
        return 25;
    }
    let same_color = is_red_suit(suit_one) == is_red_suit(suit_two);
    if same_color {
        return 10;
    }
    5
}

fn eval_royal_match_multiplier(cards: [u8; 2]) -> u64 {
    let suit_one = cards::card_suit(cards[0]);
    let suit_two = cards::card_suit(cards[1]);
    if suit_one != suit_two {
        return 0;
    }

    let rank_one = cards::card_rank_one_based(cards[0]);
    let rank_two = cards::card_rank_one_based(cards[1]);
    let is_king_queen = (rank_one == 13 && rank_two == 12) || (rank_one == 12 && rank_two == 13);
    if is_king_queen {
        return ROYAL_MATCH_KQ_MULTIPLIER;
    }
    5
}

fn resolve_lucky_ladies_return(state: &BlackjackState, dealer_blackjack: bool) -> u64 {
    let bet = state.side_bet_lucky_ladies;
    if bet == 0 {
        return 0;
    }
    if !state.initial_player_cards.iter().all(|&c| c < 52) {
        return 0;
    }
    let cards = [state.initial_player_cards[0], state.initial_player_cards[1]];
    let mult = eval_lucky_ladies_multiplier(cards, dealer_blackjack);
    if mult == 0 {
        0
    } else {
        bet.saturating_mul(mult.saturating_add(1))
    }
}

fn resolve_perfect_pairs_return(state: &BlackjackState) -> u64 {
    let bet = state.side_bet_perfect_pairs;
    if bet == 0 {
        return 0;
    }
    if !state.initial_player_cards.iter().all(|&c| c < 52) {
        return 0;
    }
    let cards = [state.initial_player_cards[0], state.initial_player_cards[1]];
    let mult = eval_perfect_pairs_multiplier(cards);
    if mult == 0 {
        0
    } else {
        bet.saturating_mul(mult.saturating_add(1))
    }
}

fn resolve_royal_match_return(state: &BlackjackState) -> u64 {
    let bet = state.side_bet_royal_match;
    if bet == 0 {
        return 0;
    }
    if !state.initial_player_cards.iter().all(|&c| c < 52) {
        return 0;
    }
    let cards = [state.initial_player_cards[0], state.initial_player_cards[1]];
    let mult = eval_royal_match_multiplier(cards);
    if mult == 0 {
        0
    } else {
        bet.saturating_mul(mult.saturating_add(1))
    }
}

fn resolve_bust_it_return(state: &BlackjackState) -> u64 {
    let bet = state.side_bet_bust_it;
    if bet == 0 {
        return 0;
    }
    let (dealer_value, _) = hand_value(&state.dealer_cards);
    if dealer_value <= 21 {
        return 0;
    }
    let multiplier: u64 = match state.dealer_cards.len() {
        3 => 1,
        4 => 2,
        5 => 9,
        6.. => 50,
        _ => 0,
    };
    if multiplier == 0 {
        return 0;
    }
    bet.saturating_mul(multiplier.saturating_add(1))
}

fn resolve_side_bets_return(state: &BlackjackState) -> u64 {
    let dealer_blackjack = is_blackjack(&state.dealer_cards);
    resolve_21plus3_return(state)
        .saturating_add(resolve_lucky_ladies_return(state, dealer_blackjack))
        .saturating_add(resolve_perfect_pairs_return(state))
        .saturating_add(resolve_royal_match_return(state))
        .saturating_add(resolve_bust_it_return(state))
}

fn apply_side_bet_update(current: &mut u64, new_bet: u64) -> Result<i64, GameError> {
    let old = *current as i128;
    let new = new_bet as i128;
    let delta = new.saturating_sub(old);
    if delta > i64::MAX as i128 || delta < i64::MIN as i128 {
        return Err(GameError::InvalidMove);
    }
    *current = new_bet;
    Ok(-(delta as i64))
}

fn active_hand_value(state: &BlackjackState) -> u8 {
    let hand = match state.hands.get(state.active_hand_idx) {
        Some(hand) => hand,
        None => return 0,
    };
    let (value, _) = hand_value(&hand.cards);
    value
}

fn dealer_visible_value(state: &BlackjackState) -> u8 {
    if state.dealer_cards.is_empty() {
        return 0;
    }
    if state.stage == Stage::Complete {
        let (value, _) = hand_value(&state.dealer_cards);
        return value;
    }
    let (value, _) = hand_value(&state.dealer_cards[0..1]);
    value
}

fn action_mask(state: &BlackjackState) -> u8 {
    if state.stage != Stage::PlayerTurn {
        return 0;
    }
    let hand = match state.hands.get(state.active_hand_idx) {
        Some(hand) => hand,
        None => return 0,
    };
    if hand.status != HandStatus::Playing {
        return 0;
    }

    let mut mask = 0u8;
    mask |= 1 << 0; // hit
    mask |= 1 << 1; // stand

    if hand.cards.len() == 2
        && hand.bet_mult == 1
        && (!hand.was_split || state.rules.double_after_split)
    {
        mask |= 1 << 2; // double
    }

    if state.hands.len() < MAX_HANDS && hand.cards.len() == 2 {
        let r1 = cards::card_rank(hand.cards[0]);
        let r2 = cards::card_rank(hand.cards[1]);
        if r1 == r2 {
            let is_aces = r1 == 0;
            if !(is_aces && hand.was_split && !state.rules.resplit_aces) {
                mask |= 1 << 3; // split
            }
        }
    }

    mask
}

fn reveal_dealer_hand(
    state: &mut BlackjackState,
    rng: &mut GameRng,
    deck: &mut Vec<u8>,
    play_out: bool,
) -> Result<(), GameError> {
    if state.dealer_cards.len() < 2 {
        let hole = rng.draw_card(deck).ok_or(GameError::DeckExhausted)?;
        state.dealer_cards.push(hole);
    }
    if !play_out {
        return Ok(());
    }

    let hits_soft_17 = state.rules.dealer_hits_soft_17;
    loop {
        let (val, is_soft) = hand_value(&state.dealer_cards);
        if val > 17 || (val == 17 && (!is_soft || !hits_soft_17)) {
            break;
        }
        let c = rng.draw_card(deck).ok_or(GameError::DeckExhausted)?;
        state.dealer_cards.push(c);
    }
    Ok(())
}

/// Serialize state to blob.
fn serialize_state(state: &BlackjackState) -> Vec<u8> {
    let mut capacity = STATE_HEADER_V4_LEN + RULES_LEN + UI_EXTRA_LEN;
    for hand in &state.hands {
        capacity = capacity.saturating_add(4 + hand.cards.len());
    }
    capacity = capacity.saturating_add(1 + state.dealer_cards.len());
    let mut blob = StateWriter::with_capacity(capacity);
    blob.push_u8(STATE_VERSION);
    blob.push_u8(state.stage as u8);
    blob.push_u64_be(state.side_bet_21plus3);
    blob.push_u64_be(state.side_bet_lucky_ladies);
    blob.push_u64_be(state.side_bet_perfect_pairs);
    blob.push_u64_be(state.side_bet_bust_it);
    blob.push_u64_be(state.side_bet_royal_match);
    blob.push_bytes(&state.initial_player_cards);
    blob.push_u8(state.active_hand_idx as u8);
    blob.push_u8(state.hands.len() as u8);

    for hand in &state.hands {
        blob.push_u8(hand.bet_mult);
        blob.push_u8(hand.status as u8);
        blob.push_u8(hand.was_split as u8);
        blob.push_u8(hand.cards.len() as u8);
        blob.push_bytes(&hand.cards);
    }

    blob.push_u8(state.dealer_cards.len() as u8);
    blob.push_bytes(&state.dealer_cards);
    let rules_bytes = state.rules.to_bytes();
    blob.push_bytes(&rules_bytes);
    blob.push_u8(active_hand_value(state));
    blob.push_u8(dealer_visible_value(state));
    blob.push_u8(action_mask(state));
    blob.into_inner()
}

/// Parse state from blob.
fn parse_state(blob: &[u8]) -> Option<BlackjackState> {
    if blob.len() < 2 {
        return None;
    }

    let mut reader = StateReader::new(blob);
    let version = reader.read_u8()?;
    if (version == 2 && blob.len() < STATE_HEADER_V2_LEN)
        || (version == 3 && blob.len() < STATE_HEADER_V3_LEN)
        || (version == STATE_VERSION && blob.len() < STATE_HEADER_V4_LEN)
    {
        return None;
    }
    let stage = Stage::try_from(reader.read_u8()?).ok()?;
    let (
        side_bet_21plus3,
        side_bet_lucky_ladies,
        side_bet_perfect_pairs,
        side_bet_bust_it,
        side_bet_royal_match,
    ) = if version == 2 {
        (reader.read_u64_be()?, 0, 0, 0, 0)
    } else if version == 3 {
        (
            reader.read_u64_be()?,
            reader.read_u64_be()?,
            reader.read_u64_be()?,
            reader.read_u64_be()?,
            0,
        )
    } else if version == STATE_VERSION {
        (
            reader.read_u64_be()?,
            reader.read_u64_be()?,
            reader.read_u64_be()?,
            reader.read_u64_be()?,
            reader.read_u64_be()?,
        )
    } else {
        return None;
    };
    let side_bet_21plus3 = clamp_side_bet_amount(side_bet_21plus3);
    let side_bet_lucky_ladies = clamp_side_bet_amount(side_bet_lucky_ladies);
    let side_bet_perfect_pairs = clamp_side_bet_amount(side_bet_perfect_pairs);
    let side_bet_bust_it = clamp_side_bet_amount(side_bet_bust_it);
    let side_bet_royal_match = clamp_side_bet_amount(side_bet_royal_match);
    let initial_player_cards: [u8; 2] = reader.read_bytes(2)?.try_into().ok()?;
    if !initial_player_cards
        .iter()
        .all(|&card| card < 52 || card == CARD_UNKNOWN)
    {
        return None;
    }

    let active_hand_idx = reader.read_u8()? as usize;
    let hand_count = reader.read_u8()? as usize;
    if hand_count > MAX_HANDS {
        return None;
    }
    if hand_count == 0 {
        if active_hand_idx != 0 {
            return None;
        }
    } else {
        match stage {
            Stage::PlayerTurn => {
                if active_hand_idx >= hand_count {
                    return None;
                }
            }
            _ => {
                if active_hand_idx > hand_count {
                    return None;
                }
            }
        }
    }

    let mut hands = Vec::with_capacity(hand_count);
    for _ in 0..hand_count {
        let bet_mult = reader.read_u8()?;
        let status = HandStatus::try_from(reader.read_u8()?).ok()?;
        let was_split = reader.read_u8()? != 0;
        let c_len = reader.read_u8()? as usize;

        if c_len > MAX_HAND_SIZE {
            return None;
        }
        let cards = reader.read_vec(c_len)?;
        if cards.iter().any(|&card| card >= 52) {
            return None;
        }

        hands.push(HandState {
            cards,
            bet_mult,
            status,
            was_split,
        });
    }

    let d_len = reader.read_u8()? as usize;
    if d_len > MAX_HAND_SIZE {
        return None;
    }
    let dealer_cards = reader.read_vec(d_len)?;
    if dealer_cards.iter().any(|&card| card >= 52) {
        return None;
    }

    let mut rules = BlackjackRules::default();
    if reader.remaining() >= RULES_LEN {
        rules = BlackjackRules::from_bytes(reader.read_u8()?, reader.read_u8()?)?;
    }

    let remaining = reader.remaining();
    if remaining == UI_EXTRA_LEN {
        let _ = reader.read_bytes(UI_EXTRA_LEN)?;
    }
    if reader.remaining() != 0 {
        return None;
    }

    Some(BlackjackState {
        stage,
        side_bet_21plus3,
        side_bet_lucky_ladies,
        side_bet_perfect_pairs,
        side_bet_bust_it,
        side_bet_royal_match,
        initial_player_cards,
        active_hand_idx,
        hands,
        dealer_cards,
        rules,
    })
}

pub struct Blackjack;

impl CasinoGame for Blackjack {
    fn init(session: &mut GameSession, _rng: &mut GameRng) -> GameResult {
        // Start in a betting stage so side bets can be placed before any cards are dealt.
        let state = BlackjackState {
            stage: Stage::Betting,
            side_bet_21plus3: 0,
            side_bet_lucky_ladies: 0,
            side_bet_perfect_pairs: 0,
            side_bet_bust_it: 0,
            side_bet_royal_match: 0,
            initial_player_cards: [CARD_UNKNOWN; 2],
            active_hand_idx: 0,
            hands: Vec::new(),
            dealer_cards: Vec::new(),
            rules: BlackjackRules::default(),
        };
        session.state_blob = serialize_state(&state);
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
        let mut state = parse_state(&session.state_blob).ok_or(GameError::InvalidPayload)?;

        if state.stage == Stage::Complete {
            return Err(GameError::GameAlreadyComplete);
        }

        match state.stage {
            Stage::Betting => match mv {
                Move::Set21Plus3 => {
                    let new_bet =
                        clamp_side_bet_amount(super::payload::parse_u64_be(payload, 1)?);
                    let payout = apply_side_bet_update(&mut state.side_bet_21plus3, new_bet)?;
                    session.state_blob = serialize_state(&state);
                    Ok(if payout == 0 {
                        GameResult::Continue(vec![])
                    } else {
                        GameResult::ContinueWithUpdate {
                            payout,
                            logs: vec![],
                        }
                    })
                }
                Move::SetRules => {
                    if payload.len() != 3 {
                        return Err(GameError::InvalidPayload);
                    }
                    let rules = BlackjackRules::from_bytes(payload[1], payload[2])
                        .ok_or(GameError::InvalidPayload)?;
                    state.rules = rules;
                    session.state_blob = serialize_state(&state);
                    Ok(GameResult::Continue(vec![]))
                }
                Move::Deal => {
                    if payload.len() != 1 {
                        return Err(GameError::InvalidPayload);
                    }
                    if !state.hands.is_empty() || !state.dealer_cards.is_empty() {
                        return Err(GameError::InvalidMove);
                    }

                    let mut deck = rng.create_shoe(state.rules.decks.count());
                    let p1 = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                    let p2 = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                    let dealer_up = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;

                    state.initial_player_cards = [p1, p2];
                    let player_cards = vec![p1, p2];
                    let player_bj = is_blackjack(&player_cards);

                    state.hands = vec![HandState {
                        cards: player_cards,
                        bet_mult: 1,
                        status: if player_bj {
                            HandStatus::Blackjack
                        } else {
                            HandStatus::Playing
                        },
                        was_split: false,
                    }];
                    state.dealer_cards = vec![dealer_up];
                    state.active_hand_idx = 0;
                    state.stage = if player_bj {
                        Stage::AwaitingReveal
                    } else {
                        Stage::PlayerTurn
                    };

                    // If the only hand is already non-playing (natural BJ), we can skip directly to
                    // reveal stage.
                    if state.stage == Stage::PlayerTurn && !advance_turn(&mut state) {
                        state.stage = Stage::AwaitingReveal;
                    }

                    session.state_blob = serialize_state(&state);
                    Ok(GameResult::Continue(vec![]))
                }
                _ => {
                    // Check for atomic batch action (payload[0] == 7)
                    // [7, sidebet_21plus3: u64 BE, lucky_ladies: u64 BE, perfect_pairs: u64 BE, bust_it: u64 BE, royal_match: u64 BE]
                    if payload[0] == 7 {
                        if payload.len() != 9 && payload.len() != 33 && payload.len() != 41 {
                            return Err(GameError::InvalidPayload);
                        }
                        if !state.hands.is_empty() || !state.dealer_cards.is_empty() {
                            return Err(GameError::InvalidMove);
                        }

                        // Parse and apply 21+3 side bet
                        let side_bet_21plus3 =
                            clamp_side_bet_amount(super::payload::parse_u64_be(payload, 1)?);
                        let mut payout_update =
                            apply_side_bet_update(&mut state.side_bet_21plus3, side_bet_21plus3)?;

                        if payload.len() >= 33 {
                            let side_bet_lucky_ladies =
                                clamp_side_bet_amount(super::payload::parse_u64_be(payload, 9)?);
                            let side_bet_perfect_pairs =
                                clamp_side_bet_amount(super::payload::parse_u64_be(payload, 17)?);
                            let side_bet_bust_it =
                                clamp_side_bet_amount(super::payload::parse_u64_be(payload, 25)?);

                            payout_update = payout_update
                                .saturating_add(apply_side_bet_update(
                                    &mut state.side_bet_lucky_ladies,
                                    side_bet_lucky_ladies,
                                )?)
                                .saturating_add(apply_side_bet_update(
                                    &mut state.side_bet_perfect_pairs,
                                    side_bet_perfect_pairs,
                                )?)
                                .saturating_add(apply_side_bet_update(
                                    &mut state.side_bet_bust_it,
                                    side_bet_bust_it,
                                )?);
                        }
                        if payload.len() == 41 {
                            let side_bet_royal_match =
                                clamp_side_bet_amount(super::payload::parse_u64_be(payload, 33)?);
                            payout_update = payout_update.saturating_add(apply_side_bet_update(
                                &mut state.side_bet_royal_match,
                                side_bet_royal_match,
                            )?);
                        }

                        // Deal cards
                        let mut deck = rng.create_shoe(state.rules.decks.count());
                        let p1 = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                        let p2 = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                        let dealer_up = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;

                        state.initial_player_cards = [p1, p2];
                        let player_cards = vec![p1, p2];
                        let player_bj = is_blackjack(&player_cards);

                        state.hands = vec![HandState {
                            cards: player_cards,
                            bet_mult: 1,
                            status: if player_bj {
                                HandStatus::Blackjack
                            } else {
                                HandStatus::Playing
                            },
                            was_split: false,
                        }];
                        state.dealer_cards = vec![dealer_up];
                        state.active_hand_idx = 0;
                        state.stage = if player_bj {
                            Stage::AwaitingReveal
                        } else {
                            Stage::PlayerTurn
                        };

                        if state.stage == Stage::PlayerTurn && !advance_turn(&mut state) {
                            state.stage = Stage::AwaitingReveal;
                        }

                        session.state_blob = serialize_state(&state);
                        Ok(if payout_update == 0 {
                            GameResult::Continue(vec![])
                        } else {
                            GameResult::ContinueWithUpdate {
                                payout: payout_update,
                                logs: vec![],
                            }
                        })
                    } else {
                        Err(GameError::InvalidMove)
                    }
                }
            },
            Stage::PlayerTurn => {
                // Reconstruct deck (excludes only visible/known cards).
                let mut used_counts = [0u8; 52];
                for hand in &state.hands {
                    for &card in &hand.cards {
                        if card < 52 {
                            used_counts[card as usize] =
                                used_counts[card as usize].saturating_add(1);
                        }
                    }
                }
                for &card in &state.dealer_cards {
                    if card < 52 {
                        used_counts[card as usize] = used_counts[card as usize].saturating_add(1);
                    }
                }
                let mut deck =
                    rng.create_shoe_excluding_counts(&used_counts, state.rules.decks.count());

                match mv {
                    Move::Hit => {
                        if state.active_hand_idx >= state.hands.len() {
                            return Err(GameError::InvalidState);
                        }
                        let hand = &mut state.hands[state.active_hand_idx];
                        if hand.status != HandStatus::Playing {
                            return Err(GameError::InvalidMove);
                        }

                        let card = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                        hand.cards.push(card);
                        session.move_count = session.move_count.saturating_add(1);

                        let (val, _) = hand_value(&hand.cards);
                        if val > 21 {
                            hand.status = HandStatus::Busted;
                            if !advance_turn(&mut state) {
                                // If all hands are busted, dealer play/reveal is irrelevant.
                                let all_busted =
                                    state.hands.iter().all(|h| h.status == HandStatus::Busted);
                                if all_busted {
                                    if state.side_bet_lucky_ladies > 0 || state.side_bet_bust_it > 0
                                    {
                                        let play_out = state.side_bet_bust_it > 0;
                                        reveal_dealer_hand(&mut state, rng, &mut deck, play_out)?;
                                    }
                                    let total_return = resolve_side_bets_return(&state);

                                    state.stage = Stage::Complete;
                                    session.is_complete = true;
                                    session.state_blob = serialize_state(&state);

                                    return Ok(finalize_game_result(session, &state, total_return));
                                }

                                state.stage = Stage::AwaitingReveal;
                            }
                        } else if val == 21 {
                            hand.status = HandStatus::Standing;
                            if !advance_turn(&mut state) {
                                state.stage = Stage::AwaitingReveal;
                            }
                        }

                        session.state_blob = serialize_state(&state);
                        Ok(GameResult::Continue(vec![]))
                    }
                    Move::Stand => {
                        if state.active_hand_idx >= state.hands.len() {
                            return Err(GameError::InvalidState);
                        }
                        let hand = &mut state.hands[state.active_hand_idx];
                        if hand.status != HandStatus::Playing {
                            return Err(GameError::InvalidMove);
                        }
                        hand.status = HandStatus::Standing;
                        session.move_count = session.move_count.saturating_add(1);

                        if !advance_turn(&mut state) {
                            state.stage = Stage::AwaitingReveal;
                        }

                        session.state_blob = serialize_state(&state);
                        Ok(GameResult::Continue(vec![]))
                    }
                    Move::Double => {
                        if state.active_hand_idx >= state.hands.len() {
                            return Err(GameError::InvalidState);
                        }
                        let hand = &mut state.hands[state.active_hand_idx];
                        if hand.status != HandStatus::Playing
                            || hand.cards.len() != 2
                            || hand.bet_mult != 1
                        {
                            return Err(GameError::InvalidMove);
                        }
                        if hand.was_split && !state.rules.double_after_split {
                            return Err(GameError::InvalidMove);
                        }

                        let extra_bet = session.bet;
                        hand.bet_mult = 2;

                        let card = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                        hand.cards.push(card);
                        session.move_count = session.move_count.saturating_add(1);

                        let (val, _) = hand_value(&hand.cards);
                        hand.status = if val > 21 {
                            HandStatus::Busted
                        } else {
                            HandStatus::Standing
                        };

                        if !advance_turn(&mut state) {
                            // If all hands are busted, dealer play/reveal is irrelevant.
                            let all_busted =
                                state.hands.iter().all(|h| h.status == HandStatus::Busted);
                            if all_busted {
                                if state.side_bet_lucky_ladies > 0 || state.side_bet_bust_it > 0 {
                                    let play_out = state.side_bet_bust_it > 0;
                                    reveal_dealer_hand(&mut state, rng, &mut deck, play_out)?;
                                }
                                let total_return = resolve_side_bets_return(&state);

                                state.stage = Stage::Complete;
                                session.is_complete = true;
                                session.state_blob = serialize_state(&state);

                                return Ok(finalize_game_result(session, &state, total_return));
                            }

                            state.stage = Stage::AwaitingReveal;
                        }

                        session.state_blob = serialize_state(&state);
                        Ok(GameResult::ContinueWithUpdate {
                            payout: -(extra_bet as i64),
                            logs: vec![],
                        })
                    }
                    Move::Split => {
                        if state.active_hand_idx >= state.hands.len() {
                            return Err(GameError::InvalidState);
                        }
                        if state.hands.len() >= MAX_HANDS {
                            return Err(GameError::InvalidMove);
                        }

                        let current_idx = state.active_hand_idx;
                        let split_bet = session.bet;
                        let (is_aces, split_card, c2) = {
                            let current_hand = &mut state.hands[current_idx];
                            if current_hand.status != HandStatus::Playing
                                || current_hand.cards.len() != 2
                            {
                                return Err(GameError::InvalidMove);
                            }

                            let r1 = cards::card_rank(current_hand.cards[0]);
                            let r2 = cards::card_rank(current_hand.cards[1]);
                            if r1 != r2 {
                                return Err(GameError::InvalidMove);
                            }
                            let is_aces = r1 == 0;
                            if is_aces && current_hand.was_split && !state.rules.resplit_aces {
                                return Err(GameError::InvalidMove);
                            }

                            // Perform split
                            let split_card =
                                current_hand.cards.pop().ok_or(GameError::InvalidState)?;
                            current_hand.was_split = true;

                            // Deal a card to each split hand
                            let c1 = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                            current_hand.cards.push(c1);

                            let c2 = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                            if is_aces && !state.rules.hit_split_aces {
                                current_hand.status = HandStatus::Standing;
                            }
                            (is_aces, split_card, c2)
                        };

                        let mut new_hand = HandState {
                            cards: vec![split_card, c2],
                            bet_mult: 1,
                            status: HandStatus::Playing,
                            was_split: true,
                        };

                        if is_aces && !state.rules.hit_split_aces {
                            new_hand.status = HandStatus::Standing;
                        }

                        state.hands.insert(current_idx + 1, new_hand);

                        session.move_count = session.move_count.saturating_add(1);
                        if state.hands[current_idx].status != HandStatus::Playing
                            && !advance_turn(&mut state)
                        {
                            state.stage = Stage::AwaitingReveal;
                        }
                        session.state_blob = serialize_state(&state);
                        Ok(GameResult::ContinueWithUpdate {
                            payout: -(split_bet as i64),
                            logs: vec![],
                        })
                    }
                    Move::Surrender => {
                        if !state.rules.late_surrender {
                            return Err(GameError::InvalidMove);
                        }
                        if state.active_hand_idx >= state.hands.len() {
                            return Err(GameError::InvalidState);
                        }
                        let hand = &mut state.hands[state.active_hand_idx];
                        if hand.status != HandStatus::Playing
                            || hand.cards.len() != 2
                            || hand.bet_mult != 1
                            || hand.was_split
                        {
                            return Err(GameError::InvalidMove);
                        }
                        hand.status = HandStatus::Surrendered;
                        session.move_count = session.move_count.saturating_add(1);

                        if !advance_turn(&mut state) {
                            state.stage = Stage::AwaitingReveal;
                        }

                        session.state_blob = serialize_state(&state);
                        Ok(GameResult::Continue(vec![]))
                    }
                    _ => Err(GameError::InvalidMove),
                }
            }
            Stage::AwaitingReveal => match mv {
                Move::Reveal => {
                    if payload.len() != 1 {
                        return Err(GameError::InvalidPayload);
                    }

                    // Reconstruct deck excluding all known cards (player hands + dealer up).
                    let mut used_counts = [0u8; 52];
                    for hand in &state.hands {
                        for &card in &hand.cards {
                            if card < 52 {
                                used_counts[card as usize] =
                                    used_counts[card as usize].saturating_add(1);
                            }
                        }
                    }
                    for &card in &state.dealer_cards {
                        if card < 52 {
                            used_counts[card as usize] =
                                used_counts[card as usize].saturating_add(1);
                        }
                    }
                    let mut deck =
                        rng.create_shoe_excluding_counts(&used_counts, state.rules.decks.count());

                    let any_live = state.hands.iter().any(|h| h.status != HandStatus::Busted);
                    reveal_dealer_hand(&mut state, rng, &mut deck, any_live)?;

                    let mut total_return = resolve_main_return(session, &state);
                    total_return = total_return.saturating_add(resolve_side_bets_return(&state));

                    state.stage = Stage::Complete;
                    session.is_complete = true;
                    session.state_blob = serialize_state(&state);

                    Ok(finalize_game_result(session, &state, total_return))
                }
                _ => Err(GameError::InvalidMove),
            },
            Stage::Complete => Err(GameError::GameAlreadyComplete),
        }
    }
}

/// Advance active turn to next playing hand. Returns true if there is a hand to play.
fn advance_turn(state: &mut BlackjackState) -> bool {
    while state.active_hand_idx < state.hands.len() {
        if state.hands[state.active_hand_idx].status == HandStatus::Playing {
            return true;
        }
        state.active_hand_idx += 1;
    }
    false
}

fn resolve_hand_return(
    bet: u64,
    hand: &HandState,
    dealer_value: u8,
    dealer_blackjack: bool,
    rules: BlackjackRules,
) -> u64 {
    if hand.status == HandStatus::Busted {
        return 0;
    }
    if hand.status == HandStatus::Surrendered {
        return if dealer_blackjack { 0 } else { bet / 2 };
    }

    let (player_value, _) = hand_value(&hand.cards);
    let player_blackjack = is_natural_blackjack(hand);

    if player_blackjack && dealer_blackjack {
        return bet;
    }
    if player_blackjack {
        return if rules.blackjack_pays_six_five {
            bet.saturating_mul(11) / 5
        } else {
            bet.saturating_mul(5) / 2
        };
    }
    if dealer_blackjack {
        return 0;
    }
    if dealer_value > 21 || player_value > dealer_value {
        return bet.saturating_mul(2);
    }
    if player_value == dealer_value {
        return bet;
    }
    0
}

fn resolve_main_return(session: &GameSession, state: &BlackjackState) -> u64 {
    let (dealer_value, _) = hand_value(&state.dealer_cards);
    let dealer_blackjack = is_blackjack(&state.dealer_cards);

    state.hands.iter().fold(0u64, |acc, hand| {
        let bet = session.bet.saturating_mul(hand.bet_mult as u64);
        acc.saturating_add(resolve_hand_return(
            bet,
            hand,
            dealer_value,
            dealer_blackjack,
            state.rules,
        ))
    })
}

fn total_wagered(session: &GameSession, state: &BlackjackState) -> u64 {
    let main_wagered: u64 = state
        .hands
        .iter()
        .map(|h| session.bet.saturating_mul(h.bet_mult as u64))
        .sum();
    main_wagered
        .saturating_add(state.side_bet_21plus3)
        .saturating_add(state.side_bet_lucky_ladies)
        .saturating_add(state.side_bet_perfect_pairs)
        .saturating_add(state.side_bet_bust_it)
        .saturating_add(state.side_bet_royal_match)
}

fn apply_super_multiplier(session: &GameSession, state: &BlackjackState, total_return: u64) -> u64 {
    if !session.super_mode.is_active || total_return == 0 {
        return total_return;
    }
    let Some(hand) = state.hands.first() else {
        return total_return;
    };
    apply_super_multiplier_cards(&hand.cards, &session.super_mode.multipliers, total_return)
}

fn append_card_list(out: &mut String, cards: &[u8]) {
    for (idx, card) in cards.iter().enumerate() {
        if idx > 0 {
            out.push(',');
        }
        let _ = write!(out, "{}", card);
    }
}

/// Generate JSON logs for blackjack game completion
fn generate_blackjack_logs(session: &GameSession, state: &BlackjackState, total_return: u64) -> Vec<String> {
    let (dealer_value, _) = hand_value(&state.dealer_cards);
    let dealer_blackjack = is_blackjack(&state.dealer_cards);

    // Build hands info as JSON array
    let hands_capacity = state.hands.len().saturating_mul(128);
    let resolved_capacity = state.hands.len().saturating_mul(64).saturating_add(64);
    let mut hands_json = String::with_capacity(hands_capacity);
    let mut resolved_entries = String::with_capacity(resolved_capacity);
    let mut resolved_sum: i128 = 0;
    let mut player_label = String::with_capacity(state.hands.len().saturating_mul(4));
    for (idx, h) in state.hands.iter().enumerate() {
        let (value, is_soft) = hand_value(&h.cards);
        if !player_label.is_empty() {
            player_label.push('/');
        }
        let _ = write!(player_label, "{}", value);
        let bet = session.bet.saturating_mul(h.bet_mult as u64);
        let hand_return = resolve_hand_return(bet, h, dealer_value, dealer_blackjack, state.rules);
        let status_str = match h.status {
            HandStatus::Playing => "PLAYING",
            HandStatus::Standing => "STANDING",
            HandStatus::Busted => "BUSTED",
            HandStatus::Blackjack => "BLACKJACK",
            HandStatus::Surrendered => "SURRENDERED",
        };
        let pnl = clamp_i64(i128::from(hand_return) - i128::from(bet));
        if state.hands.len() > 1 {
            if !resolved_entries.is_empty() {
                resolved_entries.push(',');
            }
            let _ = write!(
                resolved_entries,
                r#"{{"label":"HAND {}","pnl":{}}}"#,
                idx + 1,
                pnl
            );
        } else {
            push_resolved_entry(&mut resolved_entries, "HAND", pnl);
        }
        resolved_sum = resolved_sum.saturating_add(i128::from(pnl));
        if !hands_json.is_empty() {
            hands_json.push(',');
        }
        let _ = write!(hands_json, r#"{{"cards":["#);
        append_card_list(&mut hands_json, &h.cards);
        let _ = write!(
            hands_json,
            r#"],"value":{},"soft":{},"status":"{}","bet":{},"return":{}}}"#,
            value,
            is_soft,
            status_str,
            bet,
            hand_return
        );
    }

    let mut dealer_cards_str = String::with_capacity(state.dealer_cards.len().saturating_mul(4));
    append_card_list(&mut dealer_cards_str, &state.dealer_cards);

    let side_bet_21p3_return = resolve_21plus3_return(state);
    if state.side_bet_21plus3 > 0 {
        let side_pnl =
            clamp_i64(i128::from(side_bet_21p3_return) - i128::from(state.side_bet_21plus3));
        push_resolved_entry(&mut resolved_entries, "21+3", side_pnl);
        resolved_sum = resolved_sum.saturating_add(i128::from(side_pnl));
    }
    let lucky_ladies_return = resolve_lucky_ladies_return(state, dealer_blackjack);
    if state.side_bet_lucky_ladies > 0 {
        let side_pnl = clamp_i64(
            i128::from(lucky_ladies_return) - i128::from(state.side_bet_lucky_ladies),
        );
        push_resolved_entry(&mut resolved_entries, "LUCKY LADIES", side_pnl);
        resolved_sum = resolved_sum.saturating_add(i128::from(side_pnl));
    }
    let perfect_pairs_return = resolve_perfect_pairs_return(state);
    if state.side_bet_perfect_pairs > 0 {
        let side_pnl = clamp_i64(
            i128::from(perfect_pairs_return) - i128::from(state.side_bet_perfect_pairs),
        );
        push_resolved_entry(&mut resolved_entries, "PERFECT PAIRS", side_pnl);
        resolved_sum = resolved_sum.saturating_add(i128::from(side_pnl));
    }
    let royal_match_return = resolve_royal_match_return(state);
    if state.side_bet_royal_match > 0 {
        let side_pnl = clamp_i64(
            i128::from(royal_match_return) - i128::from(state.side_bet_royal_match),
        );
        push_resolved_entry(&mut resolved_entries, "ROYAL MATCH", side_pnl);
        resolved_sum = resolved_sum.saturating_add(i128::from(side_pnl));
    }
    let bust_it_return = resolve_bust_it_return(state);
    if state.side_bet_bust_it > 0 {
        let side_pnl =
            clamp_i64(i128::from(bust_it_return) - i128::from(state.side_bet_bust_it));
        push_resolved_entry(&mut resolved_entries, "BUST IT", side_pnl);
        resolved_sum = resolved_sum.saturating_add(i128::from(side_pnl));
    }
    let total_wagered = total_wagered(session, state);
    let net_pnl = clamp_i64(i128::from(total_return) - i128::from(total_wagered));
    let diff = i128::from(net_pnl).saturating_sub(resolved_sum);
    if diff != 0 {
        push_resolved_entry(&mut resolved_entries, "ADJUSTMENT", clamp_i64(diff));
    }
    let player_label = if player_label.is_empty() {
        "?".to_string()
    } else {
        player_label
    };
    let summary = format!("P: {}, D: {}", player_label, dealer_value);

    vec![format!(
        r#"{{"summary":"{}","netPnl":{},"resolvedBets":[{}],"hands":[{}],"dealer":{{"cards":[{}],"value":{},"blackjack":{}}},"sideBet21Plus3":{},"sideBet21Plus3Return":{},"sideBetReturn":{},"sideBetLuckyLadies":{},"sideBetLuckyLadiesReturn":{},"sideBetPerfectPairs":{},"sideBetPerfectPairsReturn":{},"sideBetRoyalMatch":{},"sideBetRoyalMatchReturn":{},"sideBetBustIt":{},"sideBetBustItReturn":{},"totalReturn":{}}}"#,
        summary,
        net_pnl,
        resolved_entries,
        hands_json,
        dealer_cards_str,
        dealer_value,
        dealer_blackjack,
        state.side_bet_21plus3,
        side_bet_21p3_return,
        side_bet_21p3_return,
        state.side_bet_lucky_ladies,
        lucky_ladies_return,
        state.side_bet_perfect_pairs,
        perfect_pairs_return,
        state.side_bet_royal_match,
        royal_match_return,
        state.side_bet_bust_it,
        bust_it_return,
        total_return
    )]
}

fn finalize_game_result(
    session: &GameSession,
    state: &BlackjackState,
    total_return: u64,
) -> GameResult {
    let total_wagered = total_wagered(session, state);
    let total_return = apply_super_multiplier(session, state, total_return);
    let logs = generate_blackjack_logs(session, state, total_return);
    if total_return == 0 {
        GameResult::LossPreDeducted(total_wagered, logs)
    } else {
        GameResult::Win(total_return, logs)
    }
}

#[cfg(test)]
#[allow(unused_must_use)]
mod tests {
    use super::*;
    use nullspace_types::casino::GameType;
    use nullspace_types::casino::SuperModeState;
    use rand::{rngs::StdRng, Rng as _, SeedableRng as _};

    fn base_side_bet_state() -> BlackjackState {
        BlackjackState {
            stage: Stage::PlayerTurn,
            side_bet_21plus3: 0,
            side_bet_lucky_ladies: 0,
            side_bet_perfect_pairs: 0,
            side_bet_bust_it: 0,
            side_bet_royal_match: 0,
            initial_player_cards: [CARD_UNKNOWN, CARD_UNKNOWN],
            active_hand_idx: 0,
            hands: Vec::new(),
            dealer_cards: Vec::new(),
            rules: BlackjackRules::default(),
        }
    }

    #[test]
    fn test_21plus3_multiplier_table() {
        // Suited trips (three identical cards)
        assert_eq!(eval_21plus3_multiplier([0, 0, 0]), 100);

        // Straight flush (2-3-4 suited)
        assert_eq!(eval_21plus3_multiplier([1, 2, 3]), 40);

        // Trips (three 7s)
        assert_eq!(eval_21plus3_multiplier([6, 19, 32]), 30);

        // Straight (10-J-Q unsuited)
        assert_eq!(eval_21plus3_multiplier([9, 23, 37]), 10);

        // Flush (A-5-9 suited, not straight)
        assert_eq!(eval_21plus3_multiplier([0, 4, 8]), 5);

        // Nothing
        assert_eq!(eval_21plus3_multiplier([0, 10, 25]), 0);
    }

    #[test]
    fn test_royal_match_multiplier() {
        // Any suited cards
        assert_eq!(eval_royal_match_multiplier([0, 1]), 5);

        // King-Queen suited (spades)
        assert_eq!(eval_royal_match_multiplier([11, 12]), ROYAL_MATCH_KQ_MULTIPLIER);

        // Off-suit should not pay
        assert_eq!(eval_royal_match_multiplier([11, 25]), 0);
    }

    #[test]
    fn test_21plus3_returns() {
        let mut state = base_side_bet_state();
        state.side_bet_21plus3 = 10;

        // Straight flush A-2-3 spades.
        state.initial_player_cards = [0, 1];
        state.dealer_cards = vec![2];
        assert_eq!(resolve_21plus3_return(&state), 410);

        // Non-qualifying hand returns 0.
        state.initial_player_cards = [0, 13]; // A♠ A♥
        state.dealer_cards = vec![5]; // 6♠
        assert_eq!(resolve_21plus3_return(&state), 0);
    }

    #[test]
    fn test_royal_match_returns() {
        let mut state = base_side_bet_state();
        state.side_bet_royal_match = 10;

        // Suited KQ pays 25:1.
        state.initial_player_cards = [12, 11]; // K♠ Q♠
        assert_eq!(resolve_royal_match_return(&state), 260);

        // Suited non-KQ pays 5:1.
        state.initial_player_cards = [0, 1]; // A♠ 2♠
        assert_eq!(resolve_royal_match_return(&state), 60);

        // Off-suit pays 0.
        state.initial_player_cards = [12, 25]; // K♠ Q♥
        assert_eq!(resolve_royal_match_return(&state), 0);
    }

    #[test]
    fn test_lucky_ladies_returns() {
        let mut state = base_side_bet_state();
        state.side_bet_lucky_ladies = 10;

        // Total 20 with non-queens pays 4:1.
        state.initial_player_cards = [9, 22]; // 10 + 10
        assert_eq!(resolve_lucky_ladies_return(&state, false), 50);

        // Queen pair (non-hearts) pays 10:1.
        state.initial_player_cards = [11, 50]; // Q spades + Q clubs
        assert_eq!(resolve_lucky_ladies_return(&state, false), 110);

        // Queen hearts with dealer blackjack pays 200:1.
        state.initial_player_cards = [24, 24]; // Q hearts
        assert_eq!(resolve_lucky_ladies_return(&state, true), 2010);
    }

    // ========================
    // Lucky Ladies Dealer Blackjack Tests (US-051)
    // ========================

    #[test]
    fn test_lucky_ladies_queen_hearts_dealer_blackjack_200_to_1() {
        // This is the highest payout in Lucky Ladies: 200:1
        // Requires: player has Queen of Hearts pair AND dealer has blackjack
        let mut state = base_side_bet_state();
        state.side_bet_lucky_ladies = 100;
        state.initial_player_cards = [24, 24]; // Q♥ + Q♥

        // With dealer blackjack: 200:1 payout = 100 * 201 = 20100
        assert_eq!(
            resolve_lucky_ladies_return(&state, true),
            20100,
            "Queen of Hearts pair with dealer blackjack should pay 200:1"
        );

        // Without dealer blackjack: 25:1 payout = 100 * 26 = 2600
        assert_eq!(
            resolve_lucky_ladies_return(&state, false),
            2600,
            "Queen of Hearts pair without dealer blackjack should pay 25:1"
        );
    }

    #[test]
    fn test_lucky_ladies_dealer_blackjack_parameter_passed() {
        // Verify dealer_blackjack is correctly determined from dealer cards
        let mut state = base_side_bet_state();
        state.side_bet_lucky_ladies = 10;
        state.initial_player_cards = [24, 24]; // Q♥ + Q♥

        // Dealer blackjack: A♠ + 10♠ = 21 with 2 cards
        state.dealer_cards = vec![0, 9]; // A♠ + 10♠
        assert!(is_blackjack(&state.dealer_cards));

        // Dealer 20: K♠ + 10♠ (not blackjack)
        state.dealer_cards = vec![12, 9]; // K♠ + 10♠
        assert!(!is_blackjack(&state.dealer_cards));

        // Dealer 21 with 3 cards (not blackjack)
        state.dealer_cards = vec![6, 7, 6]; // 7 + 8 + 6 = 21
        assert!(!is_blackjack(&state.dealer_cards));
    }

    #[test]
    fn test_lucky_ladies_all_payout_tiers() {
        let mut state = base_side_bet_state();
        state.side_bet_lucky_ladies = 10;

        // Tier 1: Non-20 total = 0 (loss)
        state.initial_player_cards = [0, 1]; // A + 2 = 13 (soft) or 3
        assert_eq!(
            resolve_lucky_ladies_return(&state, false),
            0,
            "Non-20 total should lose"
        );

        // Tier 2: 20 with non-queens = 4:1
        state.initial_player_cards = [9, 22]; // 10♠ + 10♥ = 20
        assert_eq!(
            resolve_lucky_ladies_return(&state, false),
            50,
            "20 with non-queens should pay 4:1"
        );

        // Also test 20 with K+K
        state.initial_player_cards = [12, 25]; // K♠ + K♥ = 20
        assert_eq!(
            resolve_lucky_ladies_return(&state, false),
            50,
            "K+K (20) should pay 4:1"
        );

        // Tier 3: Queen pair (non-hearts) = 10:1
        state.initial_player_cards = [11, 50]; // Q♠ + Q♣ = 20
        assert_eq!(
            resolve_lucky_ladies_return(&state, false),
            110,
            "Queen pair (non-hearts) should pay 10:1"
        );

        // Test Q♦ + Q♦
        state.initial_player_cards = [37, 37]; // Q♦ + Q♦
        assert_eq!(
            resolve_lucky_ladies_return(&state, false),
            110,
            "Q♦ pair should pay 10:1"
        );

        // Tier 4: Queen of Hearts pair (no dealer BJ) = 25:1
        state.initial_player_cards = [24, 24]; // Q♥ + Q♥
        assert_eq!(
            resolve_lucky_ladies_return(&state, false),
            260,
            "Q♥ pair without dealer BJ should pay 25:1"
        );

        // Tier 5: Queen of Hearts pair + dealer blackjack = 200:1
        assert_eq!(
            resolve_lucky_ladies_return(&state, true),
            2010,
            "Q♥ pair with dealer BJ should pay 200:1"
        );
    }

    #[test]
    fn test_lucky_ladies_200_to_1_triggers_correctly() {
        // The 200:1 payout requires BOTH conditions:
        // 1. Player has Queen of Hearts pair (both cards are Q♥)
        // 2. Dealer has blackjack (21 with exactly 2 cards)

        let mut state = base_side_bet_state();
        state.side_bet_lucky_ladies = 1; // Minimum bet to verify multiplier math

        // Case 1: Q♥ + Q♥ with dealer blackjack = 200:1 (201 return on 1 bet)
        state.initial_player_cards = [24, 24];
        assert_eq!(
            resolve_lucky_ladies_return(&state, true),
            201,
            "1 unit bet should return 201 (200:1 payout + stake)"
        );

        // Case 2: Q♥ + Q♠ with dealer blackjack = 10:1 (not both hearts)
        state.initial_player_cards = [24, 11]; // Q♥ + Q♠
        assert_eq!(
            resolve_lucky_ladies_return(&state, true),
            11,
            "Mixed queen pair should pay 10:1 even with dealer BJ"
        );

        // Case 3: Q♥ + Q♥ without dealer blackjack = 25:1
        state.initial_player_cards = [24, 24];
        assert_eq!(
            resolve_lucky_ladies_return(&state, false),
            26,
            "Q♥ pair without dealer BJ should pay 25:1"
        );

        // Case 4: Q♥ + Q♦ with dealer blackjack = 10:1 (not both hearts)
        state.initial_player_cards = [24, 37]; // Q♥ + Q♦
        assert_eq!(
            resolve_lucky_ladies_return(&state, true),
            11,
            "Q♥ + Q♦ should pay 10:1 even with dealer BJ"
        );
    }

    #[test]
    fn test_lucky_ladies_edge_cases() {
        let mut state = base_side_bet_state();
        state.side_bet_lucky_ladies = 10;

        // Edge: Zero bet returns zero regardless of hand
        state.side_bet_lucky_ladies = 0;
        state.initial_player_cards = [24, 24]; // Best possible hand
        assert_eq!(
            resolve_lucky_ladies_return(&state, true),
            0,
            "Zero bet should return zero"
        );

        // Edge: Invalid card (>= 52) returns zero
        state.side_bet_lucky_ladies = 10;
        state.initial_player_cards = [255, 24]; // Invalid + Q♥
        assert_eq!(
            resolve_lucky_ladies_return(&state, true),
            0,
            "Invalid card should return zero"
        );

        // Edge: Large bet amounts work correctly
        state.side_bet_lucky_ladies = 1_000_000;
        state.initial_player_cards = [24, 24]; // Q♥ + Q♥
        // 200:1 = 1_000_000 * 201 = 201_000_000
        assert_eq!(
            resolve_lucky_ladies_return(&state, true),
            201_000_000,
            "Large bet should calculate correctly"
        );
    }

    #[test]
    fn test_lucky_ladies_integration_with_is_blackjack() {
        // Test that the is_blackjack function correctly identifies dealer blackjacks
        // This ensures dealer_blackjack parameter is computed correctly in practice

        // Dealer blackjack scenarios (A + 10-value)
        assert!(is_blackjack(&[0, 9]), "A♠ + 10♠ should be blackjack");
        assert!(is_blackjack(&[0, 10]), "A♠ + J♠ should be blackjack");
        assert!(is_blackjack(&[0, 11]), "A♠ + Q♠ should be blackjack");
        assert!(is_blackjack(&[0, 12]), "A♠ + K♠ should be blackjack");
        assert!(is_blackjack(&[13, 22]), "A♥ + 10♥ should be blackjack");
        assert!(is_blackjack(&[9, 0]), "10♠ + A♠ should be blackjack (reversed)");

        // Not blackjack scenarios
        assert!(!is_blackjack(&[9, 10]), "10 + J = 20, not blackjack");
        assert!(!is_blackjack(&[0, 1, 8]), "A + 2 + 9 = 21 with 3 cards, not blackjack");
        assert!(!is_blackjack(&[0, 0]), "A + A = 12, not blackjack");
        assert!(!is_blackjack(&[0]), "Single ace, not blackjack");
        assert!(!is_blackjack(&[]), "Empty hand, not blackjack");
    }

    #[test]
    fn test_perfect_pairs_returns() {
        let mut state = base_side_bet_state();
        state.side_bet_perfect_pairs = 10;

        // Perfect pair (same suit) pays 25:1.
        state.initial_player_cards = [0, 0]; // A spades twice
        assert_eq!(resolve_perfect_pairs_return(&state), 260);

        // Colored pair (same color) pays 10:1.
        state.initial_player_cards = [0, 39]; // A spades + A clubs
        assert_eq!(resolve_perfect_pairs_return(&state), 110);

        // Mixed pair pays 5:1.
        state.initial_player_cards = [0, 13]; // A spades + A hearts
        assert_eq!(resolve_perfect_pairs_return(&state), 60);
    }

    #[test]
    fn test_bust_it_returns_by_bust_size() {
        let mut state = base_side_bet_state();
        state.side_bet_bust_it = 10;

        // Dealer busts with 3 cards pays 1:1.
        state.dealer_cards = vec![9, 22, 35]; // 10 + 10 + 10
        assert_eq!(resolve_bust_it_return(&state), 20);

        // Dealer busts with 6 cards pays 50:1.
        state.dealer_cards = vec![9, 22, 35, 48, 10, 23];
        assert_eq!(resolve_bust_it_return(&state), 510);
    }

    #[test]
    fn test_split_hand_is_not_natural_blackjack() {
        let hand = HandState {
            cards: vec![0, 9], // A + 10
            bet_mult: 1,
            status: HandStatus::Standing,
            was_split: true,
        };
        assert!(!is_natural_blackjack(&hand));
    }

    #[test]
    fn test_blackjack_payout_rules() {
        let bet = 100u64;
        let hand = HandState {
            cards: vec![0, 9], // A + 10
            bet_mult: 1,
            status: HandStatus::Blackjack,
            was_split: false,
        };

        let rules = BlackjackRules {
            blackjack_pays_six_five: true,
            ..Default::default()
        };
        assert_eq!(resolve_hand_return(bet, &hand, 20, false, rules), 220);

        let rules = BlackjackRules {
            blackjack_pays_six_five: false,
            ..Default::default()
        };
        assert_eq!(resolve_hand_return(bet, &hand, 20, false, rules), 250);
    }

    #[test]
    fn test_surrender_requires_late_surrender_rule() {
        let (network_secret, _) = crate::mocks::create_network_keypair();
        let seed = crate::mocks::create_seed(&network_secret, 1);
        let (_, public) = crate::mocks::create_account_keypair(1);

        let mut state = BlackjackState {
            stage: Stage::PlayerTurn,
            side_bet_21plus3: 0,
            side_bet_lucky_ladies: 0,
            side_bet_perfect_pairs: 0,
            side_bet_bust_it: 0,
            side_bet_royal_match: 0,
            initial_player_cards: [0, 9],
            active_hand_idx: 0,
            hands: vec![HandState {
                cards: vec![0, 9],
                bet_mult: 1,
                status: HandStatus::Playing,
                was_split: false,
            }],
            dealer_cards: vec![5],
            rules: BlackjackRules::default(),
        };

        let mut session = GameSession {
            id: 7,
            player: public.clone(),
            game_type: GameType::Blackjack,
            bet: 100,
            state_blob: serialize_state(&state),
            move_count: 0,
            created_at: 0,
            is_complete: false,
            super_mode: SuperModeState::default(),
            is_tournament: false,
            tournament_id: None,
        };
        let mut rng = GameRng::new(&seed, session.id, 1);
        assert!(matches!(
            Blackjack::process_move(&mut session, &[Move::Surrender as u8], &mut rng),
            Err(GameError::InvalidMove)
        ));

        state.rules.late_surrender = true;
        let mut session = GameSession {
            id: 8,
            player: public,
            game_type: GameType::Blackjack,
            bet: 100,
            state_blob: serialize_state(&state),
            move_count: 0,
            created_at: 0,
            is_complete: false,
            super_mode: SuperModeState::default(),
            is_tournament: false,
            tournament_id: None,
        };
        let mut rng = GameRng::new(&seed, session.id, 1);
        Blackjack::process_move(&mut session, &[Move::Surrender as u8], &mut rng)
            .expect("surrender should be allowed");
        let updated = parse_state(&session.state_blob).expect("valid blackjack state");
        assert_eq!(updated.hands[0].status, HandStatus::Surrendered);
        assert_eq!(updated.stage, Stage::AwaitingReveal);
    }

    #[test]
    fn test_resplit_aces_requires_rule() {
        let (network_secret, _) = crate::mocks::create_network_keypair();
        let seed = crate::mocks::create_seed(&network_secret, 2);
        let (_, public) = crate::mocks::create_account_keypair(2);

        let rules = BlackjackRules {
            resplit_aces: false,
            ..Default::default()
        };
        let state = BlackjackState {
            stage: Stage::PlayerTurn,
            side_bet_21plus3: 0,
            side_bet_lucky_ladies: 0,
            side_bet_perfect_pairs: 0,
            side_bet_bust_it: 0,
            side_bet_royal_match: 0,
            initial_player_cards: [0, 13],
            active_hand_idx: 0,
            hands: vec![HandState {
                cards: vec![0, 13],
                bet_mult: 1,
                status: HandStatus::Playing,
                was_split: true,
            }],
            dealer_cards: vec![9],
            rules,
        };

        let mut session = GameSession {
            id: 9,
            player: public,
            game_type: GameType::Blackjack,
            bet: 100,
            state_blob: serialize_state(&state),
            move_count: 0,
            created_at: 0,
            is_complete: false,
            super_mode: SuperModeState::default(),
            is_tournament: false,
            tournament_id: None,
        };
        let mut rng = GameRng::new(&seed, session.id, 1);
        assert!(matches!(
            Blackjack::process_move(&mut session, &[Move::Split as u8], &mut rng),
            Err(GameError::InvalidMove)
        ));
    }

    #[test]
    fn test_split_aces_no_hit_sets_standing() {
        let (network_secret, _) = crate::mocks::create_network_keypair();
        let seed = crate::mocks::create_seed(&network_secret, 3);
        let (_, public) = crate::mocks::create_account_keypair(3);

        let rules = BlackjackRules {
            hit_split_aces: false,
            ..Default::default()
        };
        let state = BlackjackState {
            stage: Stage::PlayerTurn,
            side_bet_21plus3: 0,
            side_bet_lucky_ladies: 0,
            side_bet_perfect_pairs: 0,
            side_bet_bust_it: 0,
            side_bet_royal_match: 0,
            initial_player_cards: [0, 13],
            active_hand_idx: 0,
            hands: vec![HandState {
                cards: vec![0, 13],
                bet_mult: 1,
                status: HandStatus::Playing,
                was_split: false,
            }],
            dealer_cards: vec![9],
            rules,
        };

        let mut session = GameSession {
            id: 10,
            player: public,
            game_type: GameType::Blackjack,
            bet: 100,
            state_blob: serialize_state(&state),
            move_count: 0,
            created_at: 0,
            is_complete: false,
            super_mode: SuperModeState::default(),
            is_tournament: false,
            tournament_id: None,
        };
        let mut rng = GameRng::new(&seed, session.id, 1);
        Blackjack::process_move(&mut session, &[Move::Split as u8], &mut rng)
            .expect("split should be allowed");

        let updated = parse_state(&session.state_blob).expect("valid blackjack state");
        assert_eq!(updated.hands.len(), 2);
        assert!(updated
            .hands
            .iter()
            .all(|hand| hand.status == HandStatus::Standing));
        assert_eq!(updated.stage, Stage::AwaitingReveal);
    }

    #[test]
    fn test_hit_all_busted_returns_loss_prededucted() -> Result<(), GameError> {
        let (network_secret, _) = crate::mocks::create_network_keypair();
        let seed = crate::mocks::create_seed(&network_secret, 1);
        let (_, public) = crate::mocks::create_account_keypair(1);

        let state = BlackjackState {
            stage: Stage::PlayerTurn,
            side_bet_21plus3: 0,
            side_bet_lucky_ladies: 0,
            side_bet_perfect_pairs: 0,
            side_bet_bust_it: 0,
            side_bet_royal_match: 0,
            initial_player_cards: [9, 12],
            active_hand_idx: 0,
            hands: vec![HandState {
                cards: vec![9, 12], // 10 + K = 20
                bet_mult: 1,
                status: HandStatus::Playing,
                was_split: false,
            }],
            dealer_cards: vec![0],
            rules: BlackjackRules::default(),
        };

        let base_session = GameSession {
            id: 0,
            player: public,
            game_type: GameType::Blackjack,
            bet: 100,
            state_blob: serialize_state(&state),
            move_count: 1,
            created_at: 0,
            is_complete: false,
            super_mode: SuperModeState::default(),
            is_tournament: false,
            tournament_id: None,
        };

        let mut found = None;
        for session_id in 0u64..64 {
            let mut session = base_session.clone();
            session.id = session_id;
            let mut rng = GameRng::new(&seed, session_id, 1);
            match Blackjack::process_move(&mut session, &[Move::Hit as u8], &mut rng)? {
                GameResult::LossPreDeducted(total_wagered, _) => {
                    found = Some(total_wagered);
                    break;
                }
                _ => continue,
            }
        }

        assert_eq!(found, Some(100));
        Ok(())
    }

    #[test]
    fn test_hit_all_busted_side_bet_win_returns_win() -> Result<(), GameError> {
        let (network_secret, _) = crate::mocks::create_network_keypair();
        let seed = crate::mocks::create_seed(&network_secret, 1);
        let (_, public) = crate::mocks::create_account_keypair(1);

        let state = BlackjackState {
            stage: Stage::PlayerTurn,
            side_bet_21plus3: 10,
            side_bet_lucky_ladies: 0,
            side_bet_perfect_pairs: 0,
            side_bet_bust_it: 0,
            side_bet_royal_match: 0,
            initial_player_cards: [1, 2],
            active_hand_idx: 0,
            hands: vec![HandState {
                cards: vec![1, 2, 9, 4], // 2 + 3 + 10 + 5 = 20
                bet_mult: 1,
                status: HandStatus::Playing,
                was_split: false,
            }],
            dealer_cards: vec![3],
            rules: BlackjackRules::default(),
        };

        let base_session = GameSession {
            id: 0,
            player: public,
            game_type: GameType::Blackjack,
            bet: 100,
            state_blob: serialize_state(&state),
            move_count: 1,
            created_at: 0,
            is_complete: false,
            super_mode: SuperModeState::default(),
            is_tournament: false,
            tournament_id: None,
        };

        let mut found = None;
        for session_id in 0u64..64 {
            let mut session = base_session.clone();
            session.id = session_id;
            let mut rng = GameRng::new(&seed, session_id, 1);
            match Blackjack::process_move(&mut session, &[Move::Hit as u8], &mut rng)? {
                GameResult::Win(total_return, _) => {
                    found = Some(total_return);
                    break;
                }
                _ => continue,
            }
        }

        assert_eq!(found, Some(410));
        Ok(())
    }

    #[test]
    fn test_blackjack_wager_and_payout_bounds_no_super_no_side_bet() {
        let (network_secret, _) = crate::mocks::create_network_keypair();
        let seed = crate::mocks::create_seed(&network_secret, 1);
        let (_, public) = crate::mocks::create_account_keypair(1);

        let bet = 100u64;
        let mut chooser = StdRng::seed_from_u64(0);

        for session_id in 0u64..200 {
            let mut session = GameSession {
                id: session_id,
                player: public.clone(),
                game_type: GameType::Blackjack,
                bet,
                state_blob: vec![],
                move_count: 0,
                created_at: 0,
                is_complete: false,
                super_mode: SuperModeState::default(),
                is_tournament: false,
                tournament_id: None,
            };

            let mut init_rng = GameRng::new(&seed, session_id, 0);
            assert!(matches!(
                Blackjack::init(&mut session, &mut init_rng),
                GameResult::Continue(_)
            ));

            let mut total_extra_deductions: i64 = 0;

            for _ in 0..64 {
                if session.is_complete {
                    break;
                }

                let state = parse_state(&session.state_blob).expect("valid blackjack state");
                let payload = match state.stage {
                    Stage::Betting => vec![Move::Deal as u8],
                    Stage::AwaitingReveal => vec![Move::Reveal as u8],
                    Stage::PlayerTurn => {
                        let Some(hand) = state.hands.get(state.active_hand_idx) else {
                            panic!("active_hand_idx out of bounds");
                        };
                        if hand.status != HandStatus::Playing {
                            vec![Move::Stand as u8]
                        } else {
                            let can_split = state.hands.len() < MAX_HANDS
                                && hand.cards.len() == 2
                                && cards::card_rank(hand.cards[0])
                                    == cards::card_rank(hand.cards[1]);
                            let can_double = hand.cards.len() == 2 && hand.bet_mult == 1;
                            let (val, _) = hand_value(&hand.cards);

                            if can_split && chooser.gen_bool(0.35) {
                                vec![Move::Split as u8]
                            } else if can_double && chooser.gen_bool(0.35) && val <= 11 {
                                vec![Move::Double as u8]
                            } else if val >= 19 || hand.cards.len() >= MAX_HAND_SIZE {
                                vec![Move::Stand as u8]
                            } else if chooser.gen_bool(0.60) {
                                vec![Move::Hit as u8]
                            } else {
                                vec![Move::Stand as u8]
                            }
                        }
                    }
                    Stage::Complete => break,
                };

                // Mirror the executor behavior: increment move_count before seeding the RNG.
                session.move_count = session.move_count.saturating_add(1);
                let mut rng = GameRng::new(&seed, session_id, session.move_count);

                match Blackjack::process_move(&mut session, &payload, &mut rng)
                    .expect("blackjack move should not error for valid payload")
                {
                    GameResult::Continue(_) => {}
                    GameResult::ContinueWithUpdate { payout, .. } => {
                        if payout < 0 {
                            total_extra_deductions = total_extra_deductions.saturating_add(payout);
                        }
                    }
                    GameResult::Win(total_return, _) => {
                        let end_state =
                            parse_state(&session.state_blob).expect("valid final blackjack state");
                        assert_eq!(end_state.side_bet_21plus3, 0);
                        assert!(!session.super_mode.is_active);

                        let wagered = total_wagered(&session, &end_state);
                        assert!(wagered <= bet.saturating_mul(8));
                        assert!(total_return <= bet.saturating_mul(16));
                    }
                    GameResult::LossPreDeducted(total_loss, _) => {
                        let end_state =
                            parse_state(&session.state_blob).expect("valid final blackjack state");
                        let wagered = total_wagered(&session, &end_state);
                        assert_eq!(total_loss, wagered);
                        assert!(wagered <= bet.saturating_mul(8));
                    }
                    _ => panic!("unexpected blackjack result variant"),
                }
            }

            assert!(session.is_complete, "blackjack fuzz run did not complete");
            assert!(total_extra_deductions <= 0);
            assert!(total_extra_deductions >= -(bet as i64).saturating_mul(7));
        }
    }

    #[test]
    fn test_state_blob_fuzz_does_not_panic() {
        let mut rng = StdRng::seed_from_u64(0x5eed_b1ac);
        for _ in 0..1_000 {
            let len = rng.gen_range(0..=256);
            let mut blob = vec![0u8; len];
            rng.fill(&mut blob[..]);
            let _ = parse_state(&blob);
        }
    }
}
