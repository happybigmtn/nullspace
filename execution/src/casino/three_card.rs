//! Three Card Poker implementation.
//!
//! This implementation supports:
//! - Ante (`session.bet`, deducted by CasinoStartGame)
//! - Optional Pairplus side bet (placed before deal)
//! - Optional 6-card bonus side bet (placed before deal)
//! - Optional Progressive side bet (placed before deal; WoO Progressive v2A, for-one)
//! - Play/Fold decision (Play bet equals Ante; charged before reveal)
//! - Dealer qualification: Q-high or better (WoO), with optional Q-6-4 variant
//! - Ante bonus (pay table #1: SF 5, Trips 4, Straight 1), paid when player plays
//!
//! State blob format (32 bytes + optional rules byte):
//! [version:u8=3]
//! [stage:u8]
//! [playerCard1:u8] [playerCard2:u8] [playerCard3:u8]   (0xFF if not dealt yet)
//! [dealerCard1:u8] [dealerCard2:u8] [dealerCard3:u8]   (0xFF if unrevealed)
//! [pairplusBetAmount:u64 BE]
//! [sixCardBonusBetAmount:u64 BE]
//! [progressiveBetAmount:u64 BE]
//! [rules:u8] (optional; dealer qualifier)
//!
//! Stages:
//! 0 = Betting (optional Pairplus, then Deal)
//! 1 = Decision (player cards dealt; Play/Fold)
//! 2 = AwaitingReveal (Play bet deducted; Reveal resolves)
//! 3 = Complete
//!
//! Payload format:
//! [move:u8] [optional amount:u64 BE]
//! 0 = Play
//! 1 = Fold
//! 2 = Deal (optional u64 = Pairplus bet)
//! 3 = Set Pairplus bet (u64)
//! 4 = Reveal
//! 5 = Set 6-Card Bonus bet (u64)
//! 6 = Set Progressive bet (u64)
//! 8 = Set rules (u8)

use super::logging::{clamp_i64, format_card_list, push_resolved_entry};
use super::serialization::{StateReader, StateWriter};
use super::super_mode::apply_super_multiplier_cards;
use super::{cards, CasinoGame, GameError, GameResult, GameRng};
use nullspace_types::casino::{GameSession, THREE_CARD_PROGRESSIVE_BASE_JACKPOT};

/// Payout multipliers for Three Card Poker.
/// Most values are expressed as "to 1" winnings; Progressive is "for-one" (total return).
mod payouts {
    // Ante Bonus (pay table #1)
    pub const ANTE_STRAIGHT_FLUSH: u64 = 5;
    pub const ANTE_THREE_OF_A_KIND: u64 = 4;
    pub const ANTE_STRAIGHT: u64 = 1;

    // Pairplus
    pub const PAIRPLUS_STRAIGHT_FLUSH: u64 = 40;
    pub const PAIRPLUS_THREE_OF_A_KIND: u64 = 30;
    pub const PAIRPLUS_STRAIGHT: u64 = 6;
    pub const PAIRPLUS_FLUSH: u64 = 3;
    pub const PAIRPLUS_PAIR: u64 = 1;

    // 6-Card Bonus (Version 1-A)
    pub const SIX_CARD_ROYAL_FLUSH: u64 = 1000;
    pub const SIX_CARD_STRAIGHT_FLUSH: u64 = 200;
    pub const SIX_CARD_FOUR_OF_A_KIND: u64 = 100;
    pub const SIX_CARD_FULL_HOUSE: u64 = 20;
    pub const SIX_CARD_FLUSH: u64 = 15;
    pub const SIX_CARD_STRAIGHT: u64 = 10;
    pub const SIX_CARD_THREE_OF_A_KIND: u64 = 7;

    // Progressive (WoO v2A, for-one)
    pub const PROGRESSIVE_MINI_ROYAL_OTHER: u64 = 500;
    pub const PROGRESSIVE_STRAIGHT_FLUSH: u64 = 70;
    pub const PROGRESSIVE_THREE_OF_A_KIND: u64 = 60;
    pub const PROGRESSIVE_STRAIGHT: u64 = 6;
}

const STATE_VERSION: u8 = 3;
const CARD_UNKNOWN: u8 = 0xFF;
const STATE_LEN_BASE: usize = 32;
const STATE_LEN_WITH_RULES: usize = 33;

const PROGRESSIVE_BET_UNIT: u64 = 1;
/// Max base bet amount to keep i64-safe deductions.
const MAX_BASE_BET_AMOUNT: u64 = i64::MAX as u64;
/// Max side bet amount to keep i64-safe return amounts (6-card bonus pays 1000:1 => 1001x return).
const MAX_SIDE_BET_AMOUNT: u64 = (i64::MAX as u64) / (payouts::SIX_CARD_ROYAL_FLUSH + 1);

fn clamp_base_bet(session: &mut GameSession) {
    if session.bet > MAX_BASE_BET_AMOUNT {
        session.bet = MAX_BASE_BET_AMOUNT;
    }
}

fn clamp_side_bet_amount(amount: u64) -> u64 {
    super::payload::clamp_bet_amount(amount, MAX_SIDE_BET_AMOUNT)
}

fn clamp_progressive_bet(amount: u64) -> u64 {
    super::payload::clamp_bet_amount(amount, PROGRESSIVE_BET_UNIT)
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum DealerQualifier {
    #[default]
    QHigh = 0,
    Q64 = 1,
}

impl TryFrom<u8> for DealerQualifier {
    type Error = ();

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(DealerQualifier::QHigh),
            1 => Ok(DealerQualifier::Q64),
            _ => Err(()),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct ThreeCardRules {
    dealer_qualifier: DealerQualifier,
}

impl ThreeCardRules {
    fn from_byte(value: u8) -> Option<Self> {
        Some(Self {
            dealer_qualifier: DealerQualifier::try_from(value & 0x01).ok()?,
        })
    }

    fn to_byte(self) -> u8 {
        self.dealer_qualifier as u8
    }
}

/// Three Card Poker stages.
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    Betting = 0,
    Decision = 1,
    AwaitingReveal = 2,
    Complete = 3,
}

impl TryFrom<u8> for Stage {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Stage::Betting),
            1 => Ok(Stage::Decision),
            2 => Ok(Stage::AwaitingReveal),
            3 => Ok(Stage::Complete),
            _ => Err(GameError::InvalidPayload),
        }
    }
}

/// Player moves.
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Move {
    Play = 0,
    Fold = 1,
    Deal = 2,
    SetPairPlus = 3,
    Reveal = 4,
    SetSixCardBonus = 5,
    SetProgressive = 6,
    AtomicDeal = 7,
    SetRules = 8,
}

impl TryFrom<u8> for Move {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Move::Play),
            1 => Ok(Move::Fold),
            2 => Ok(Move::Deal),
            3 => Ok(Move::SetPairPlus),
            4 => Ok(Move::Reveal),
            5 => Ok(Move::SetSixCardBonus),
            6 => Ok(Move::SetProgressive),
            7 => Ok(Move::AtomicDeal),
            8 => Ok(Move::SetRules),
            _ => Err(GameError::InvalidPayload),
        }
    }
}

/// Three card hand rankings (higher is better).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum HandRank {
    HighCard = 0,
    Pair = 1,
    Flush = 2,
    Straight = 3,
    ThreeOfAKind = 4,
    StraightFlush = 5,
}

/// Evaluate a 3-card hand, returns (HandRank, tiebreak kickers).
pub fn evaluate_hand(cards: &[u8; 3]) -> (HandRank, [u8; 3]) {
    let mut ranks = [0u8; 3];
    let mut suits = [0u8; 3];
    for i in 0..3 {
        ranks[i] = cards::card_rank_ace_high(cards[i]);
        suits[i] = cards::card_suit(cards[i]);
    }

    let is_flush = suits[0] == suits[1] && suits[1] == suits[2];

    let mut sorted = ranks;
    sorted.sort_unstable();
    let is_wheel = sorted == [2, 3, 14];
    let is_straight = is_wheel || (sorted[2] - sorted[0] == 2 && sorted[1] - sorted[0] == 1);
    let straight_high = if is_wheel { 3 } else { sorted[2] };

    let mut counts = [0u8; 15];
    for &r in &ranks {
        counts[r as usize] += 1;
    }

    let mut trip_rank = 0u8;
    let mut pair_rank = 0u8;
    let mut kicker_rank = 0u8;
    for r in (2..=14).rev() {
        match counts[r as usize] {
            3 => trip_rank = r as u8,
            2 => pair_rank = r as u8,
            1 => {
                if kicker_rank == 0 {
                    kicker_rank = r as u8;
                }
            }
            _ => {}
        }
    }

    let mut desc = ranks;
    desc.sort_unstable_by(|a, b| b.cmp(a));

    let hand_rank = if is_straight && is_flush {
        HandRank::StraightFlush
    } else if trip_rank > 0 {
        HandRank::ThreeOfAKind
    } else if is_straight {
        HandRank::Straight
    } else if is_flush {
        HandRank::Flush
    } else if pair_rank > 0 {
        HandRank::Pair
    } else {
        HandRank::HighCard
    };

    let kickers = match hand_rank {
        HandRank::StraightFlush | HandRank::Straight => [straight_high, 0, 0],
        HandRank::ThreeOfAKind => [trip_rank, 0, 0],
        HandRank::Pair => [pair_rank, kicker_rank, 0],
        HandRank::Flush | HandRank::HighCard => desc,
    };

    (hand_rank, kickers)
}

fn compare_hands(h1: &(HandRank, [u8; 3]), h2: &(HandRank, [u8; 3])) -> std::cmp::Ordering {
    match h1.0.cmp(&h2.0) {
        std::cmp::Ordering::Equal => h1.1.cmp(&h2.1),
        other => other,
    }
}

fn ante_bonus_multiplier(hand_rank: HandRank) -> u64 {
    match hand_rank {
        HandRank::StraightFlush => payouts::ANTE_STRAIGHT_FLUSH,
        HandRank::ThreeOfAKind => payouts::ANTE_THREE_OF_A_KIND,
        HandRank::Straight => payouts::ANTE_STRAIGHT,
        _ => 0,
    }
}

fn pairplus_multiplier(hand_rank: HandRank) -> u64 {
    match hand_rank {
        HandRank::StraightFlush => payouts::PAIRPLUS_STRAIGHT_FLUSH,
        HandRank::ThreeOfAKind => payouts::PAIRPLUS_THREE_OF_A_KIND,
        HandRank::Straight => payouts::PAIRPLUS_STRAIGHT,
        HandRank::Flush => payouts::PAIRPLUS_FLUSH,
        HandRank::Pair => payouts::PAIRPLUS_PAIR,
        _ => 0,
    }
}

fn dealer_qualifies(dealer_hand: &(HandRank, [u8; 3]), rules: ThreeCardRules) -> bool {
    if dealer_hand.0 >= HandRank::Pair {
        return true;
    }
    match rules.dealer_qualifier {
        DealerQualifier::QHigh => dealer_hand.1[0] >= 12,
        DealerQualifier::Q64 => dealer_hand.1 >= [12, 6, 4],
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TcState {
    stage: Stage,
    player: [u8; 3],
    dealer: [u8; 3],
    pairplus_bet: u64,
    six_card_bonus_bet: u64,
    progressive_bet: u64,
    rules: ThreeCardRules,
}

fn parse_state(state: &[u8]) -> Option<TcState> {
    if state.len() < STATE_LEN_BASE {
        return None;
    }
    if state.len() != STATE_LEN_BASE && state.len() != STATE_LEN_WITH_RULES {
        return None;
    }

    let mut reader = StateReader::new(state);
    let version = reader.read_u8()?;
    if version != STATE_VERSION {
        return None;
    }
    let stage = Stage::try_from(reader.read_u8()?).ok()?;
    let player: [u8; 3] = reader.read_bytes(3)?.try_into().ok()?;
    let dealer: [u8; 3] = reader.read_bytes(3)?.try_into().ok()?;
    if player
        .iter()
        .chain(dealer.iter())
        .any(|&card| card >= 52 && card != CARD_UNKNOWN)
    {
        return None;
    }
    let pairplus_bet = clamp_side_bet_amount(reader.read_u64_be()?);
    let six_card_bonus_bet = clamp_side_bet_amount(reader.read_u64_be()?);
    let progressive_bet = clamp_progressive_bet(reader.read_u64_be()?);
    let rules = if reader.remaining() > 0 {
        ThreeCardRules::from_byte(reader.read_u8()?)?
    } else {
        ThreeCardRules::default()
    };

    Some(TcState {
        stage,
        player,
        dealer,
        pairplus_bet,
        six_card_bonus_bet,
        progressive_bet,
        rules,
    })
}

fn serialize_state(state: &TcState) -> Vec<u8> {
    let mut out = StateWriter::with_capacity(STATE_LEN_WITH_RULES);
    out.push_u8(STATE_VERSION);
    out.push_u8(state.stage as u8);
    out.push_bytes(&state.player);
    out.push_bytes(&state.dealer);
    out.push_u64_be(state.pairplus_bet);
    out.push_u64_be(state.six_card_bonus_bet);
    out.push_u64_be(state.progressive_bet);
    out.push_u8(state.rules.to_byte());
    out.into_inner()
}

fn apply_pairplus_update(state: &mut TcState, new_bet: u64) -> Result<i64, GameError> {
    let old = state.pairplus_bet as i128;
    let new = new_bet as i128;
    let delta = new - old;
    if delta > i64::MAX as i128 || delta < i64::MIN as i128 {
        return Err(GameError::InvalidMove);
    }
    state.pairplus_bet = new_bet;
    Ok(-(delta as i64))
}

fn apply_six_card_bonus_update(state: &mut TcState, new_bet: u64) -> Result<i64, GameError> {
    let old = state.six_card_bonus_bet as i128;
    let new = new_bet as i128;
    let delta = new - old;
    if delta > i64::MAX as i128 || delta < i64::MIN as i128 {
        return Err(GameError::InvalidMove);
    }
    state.six_card_bonus_bet = new_bet;
    Ok(-(delta as i64))
}

fn apply_progressive_update(state: &mut TcState, new_bet: u64) -> Result<i64, GameError> {
    let old = state.progressive_bet as i128;
    let new = new_bet as i128;
    let delta = new - old;
    if delta > i64::MAX as i128 || delta < i64::MIN as i128 {
        return Err(GameError::InvalidMove);
    }
    state.progressive_bet = new_bet;
    Ok(-(delta as i64))
}

fn is_known_card(card: u8) -> bool {
    cards::is_valid_card(card)
}

fn resolve_pairplus_return(player_cards: &[u8; 3], pairplus_bet: u64) -> u64 {
    if pairplus_bet == 0 {
        return 0;
    }
    let player_hand = evaluate_hand(player_cards);
    let mult = pairplus_multiplier(player_hand.0);
    if mult == 0 {
        0
    } else {
        pairplus_bet.saturating_mul(mult.saturating_add(1))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum SixCardBonusRank {
    None = 0,
    ThreeOfAKind = 1,
    Straight = 2,
    Flush = 3,
    FullHouse = 4,
    FourOfAKind = 5,
    StraightFlush = 6,
    RoyalFlush = 7,
}

fn evaluate_5_card_bonus_rank(cards: &[u8; 5]) -> SixCardBonusRank {
    let mut ranks = [0u8; 5];
    let mut suits = [0u8; 5];
    for i in 0..5 {
        ranks[i] = cards::card_rank_ace_high(cards[i]);
        suits[i] = cards::card_suit(cards[i]);
    }

    ranks.sort_unstable_by(|a, b| b.cmp(a));

    let is_flush = suits[0] == suits[1]
        && suits[1] == suits[2]
        && suits[2] == suits[3]
        && suits[3] == suits[4];

    let mut sorted = ranks;
    sorted.sort_unstable();
    let has_duplicates = sorted[0] == sorted[1]
        || sorted[1] == sorted[2]
        || sorted[2] == sorted[3]
        || sorted[3] == sorted[4];
    let is_straight = if has_duplicates {
        false
    } else if sorted[4] - sorted[0] == 4 {
        true
    } else {
        // Wheel A-2-3-4-5
        sorted == [2, 3, 4, 5, 14]
    };

    let is_royal = sorted == [10, 11, 12, 13, 14];

    let mut counts = [0u8; 15];
    for &r in &ranks {
        counts[r as usize] += 1;
    }

    let mut pair_count = 0u8;
    let mut has_trips = false;
    let mut has_quads = false;
    for &count in &counts {
        match count {
            2 => pair_count += 1,
            3 => has_trips = true,
            4 => has_quads = true,
            _ => {}
        }
    }

    if is_royal && is_flush {
        SixCardBonusRank::RoyalFlush
    } else if is_straight && is_flush {
        SixCardBonusRank::StraightFlush
    } else if has_quads {
        SixCardBonusRank::FourOfAKind
    } else if has_trips && pair_count >= 1 {
        SixCardBonusRank::FullHouse
    } else if is_flush {
        SixCardBonusRank::Flush
    } else if is_straight {
        SixCardBonusRank::Straight
    } else if has_trips {
        SixCardBonusRank::ThreeOfAKind
    } else {
        SixCardBonusRank::None
    }
}

fn evaluate_best_5_of_6_bonus_rank(cards: &[u8; 6]) -> SixCardBonusRank {
    let mut best = SixCardBonusRank::None;
    for skip in 0..6 {
        let mut hand = [0u8; 5];
        let mut idx = 0;
        for (i, &c) in cards.iter().enumerate() {
            if i == skip {
                continue;
            }
            hand[idx] = c;
            idx += 1;
        }
        let rank = evaluate_5_card_bonus_rank(&hand);
        if rank > best {
            best = rank;
        }
    }
    best
}

fn six_card_bonus_multiplier(rank: SixCardBonusRank) -> u64 {
    // WoO 6-Card Bonus, Version 1-A.
    match rank {
        SixCardBonusRank::RoyalFlush => payouts::SIX_CARD_ROYAL_FLUSH,
        SixCardBonusRank::StraightFlush => payouts::SIX_CARD_STRAIGHT_FLUSH,
        SixCardBonusRank::FourOfAKind => payouts::SIX_CARD_FOUR_OF_A_KIND,
        SixCardBonusRank::FullHouse => payouts::SIX_CARD_FULL_HOUSE,
        SixCardBonusRank::Flush => payouts::SIX_CARD_FLUSH,
        SixCardBonusRank::Straight => payouts::SIX_CARD_STRAIGHT,
        SixCardBonusRank::ThreeOfAKind => payouts::SIX_CARD_THREE_OF_A_KIND,
        SixCardBonusRank::None => 0,
    }
}

fn resolve_six_card_bonus_return(player_cards: &[u8; 3], dealer_cards: &[u8; 3], bet: u64) -> u64 {
    if bet == 0 {
        return 0;
    }
    let cards = [
        player_cards[0],
        player_cards[1],
        player_cards[2],
        dealer_cards[0],
        dealer_cards[1],
        dealer_cards[2],
    ];
    let rank = evaluate_best_5_of_6_bonus_rank(&cards);
    let mult = six_card_bonus_multiplier(rank);
    if mult == 0 {
        0
    } else {
        bet.saturating_mul(mult.saturating_add(1))
    }
}

fn resolve_progressive_return(player_cards: &[u8; 3], progressive_bet: u64) -> u64 {
    if progressive_bet == 0 {
        return 0;
    }
    let player_hand = evaluate_hand(player_cards);
    match player_hand.0 {
        HandRank::StraightFlush => {
            // Mini-royal is A-K-Q suited.
            if is_mini_royal(player_cards) {
                let is_spades = player_cards.iter().all(|&c| cards::card_suit(c) == 0);
                if is_spades {
                    progressive_bet.saturating_mul(THREE_CARD_PROGRESSIVE_BASE_JACKPOT)
                } else {
                    progressive_bet.saturating_mul(payouts::PROGRESSIVE_MINI_ROYAL_OTHER)
                }
            } else {
                progressive_bet.saturating_mul(payouts::PROGRESSIVE_STRAIGHT_FLUSH)
            }
        }
        HandRank::ThreeOfAKind => {
            progressive_bet.saturating_mul(payouts::PROGRESSIVE_THREE_OF_A_KIND)
        }
        HandRank::Straight => progressive_bet.saturating_mul(payouts::PROGRESSIVE_STRAIGHT),
        _ => 0,
    }
}

fn is_mini_royal(cards: &[u8; 3]) -> bool {
    let mut ranks = [0u8; 3];
    for (i, &card) in cards.iter().enumerate() {
        ranks[i] = cards::card_rank_ace_high(card);
    }
    ranks.sort_unstable();
    if ranks != [12, 13, 14] {
        return false;
    }
    let suit = cards::card_suit(cards[0]);
    cards.iter().all(|&card| cards::card_suit(card) == suit)
}

/// Generate JSON logs for Three Card Poker game completion
#[allow(clippy::too_many_arguments)]
fn generate_three_card_logs(
    state: &TcState,
    session: &GameSession,
    is_fold: bool,
    dealer_qualifies: bool,
    outcome: &str,
    ante_return: u64,
    play_return: u64,
    pairplus_return: u64,
    six_card_return: u64,
    progressive_return: u64,
    ante_bonus: u64,
    total_return: u64,
) -> Vec<String> {
    let player_hand = evaluate_hand(&state.player);
    let dealer_hand = evaluate_hand(&state.dealer);

    let hand_rank_str = |rank: HandRank| -> &'static str {
        match rank {
            HandRank::HighCard => "HIGH_CARD",
            HandRank::Pair => "PAIR",
            HandRank::Flush => "FLUSH",
            HandRank::Straight => "STRAIGHT",
            HandRank::ThreeOfAKind => "THREE_OF_A_KIND",
            HandRank::StraightFlush => "STRAIGHT_FLUSH",
        }
    };
    let format_rank = |rank: HandRank| -> String {
        hand_rank_str(rank).replace('_', " ")
    };

    let player_cards_str = format_card_list(&state.player);
    let dealer_cards_str = format_card_list(&state.dealer);

    let play_bet = if is_fold { 0 } else { session.bet };
    let total_wagered = session
        .bet
        .saturating_add(play_bet)
        .saturating_add(state.pairplus_bet)
        .saturating_add(state.six_card_bonus_bet)
        .saturating_add(state.progressive_bet);
    let mut resolved_entries = String::with_capacity(384);
    let mut resolved_sum: i128 = 0;
    let ante_pnl = clamp_i64(i128::from(ante_return) - i128::from(session.bet));
    push_resolved_entry(&mut resolved_entries, "ANTE", ante_pnl);
    resolved_sum = resolved_sum.saturating_add(i128::from(ante_pnl));
    if play_bet > 0 || is_fold {
        let play_pnl = clamp_i64(i128::from(play_return) - i128::from(play_bet));
        push_resolved_entry(&mut resolved_entries, "PLAY", play_pnl);
        resolved_sum = resolved_sum.saturating_add(i128::from(play_pnl));
    }
    if state.pairplus_bet > 0 {
        let pnl = clamp_i64(i128::from(pairplus_return) - i128::from(state.pairplus_bet));
        push_resolved_entry(&mut resolved_entries, "PAIR PLUS", pnl);
        resolved_sum = resolved_sum.saturating_add(i128::from(pnl));
    }
    if state.six_card_bonus_bet > 0 {
        let pnl =
            clamp_i64(i128::from(six_card_return) - i128::from(state.six_card_bonus_bet));
        push_resolved_entry(&mut resolved_entries, "SIX CARD", pnl);
        resolved_sum = resolved_sum.saturating_add(i128::from(pnl));
    }
    if state.progressive_bet > 0 {
        let pnl = clamp_i64(i128::from(progressive_return) - i128::from(state.progressive_bet));
        push_resolved_entry(&mut resolved_entries, "PROGRESSIVE", pnl);
        resolved_sum = resolved_sum.saturating_add(i128::from(pnl));
    }
    let net_pnl = clamp_i64(i128::from(total_return) - i128::from(total_wagered));
    let diff = i128::from(net_pnl).saturating_sub(resolved_sum);
    if diff != 0 {
        push_resolved_entry(&mut resolved_entries, "ADJUSTMENT", clamp_i64(diff));
    }
    let mut summary = format!(
        "P: {}, D: {}",
        format_rank(player_hand.0),
        format_rank(dealer_hand.0)
    );
    if !dealer_qualifies {
        summary.push_str(" (NO QUALIFY)");
    }
    if is_fold {
        summary.push_str(" (FOLD)");
    }

    vec![format!(
        r#"{{"summary":"{}","netPnl":{},"resolvedBets":[{}],"player":{{"cards":[{}],"rank":"{}"}},"dealer":{{"cards":[{}],"rank":"{}","qualifies":{}}},"folded":{},"outcome":"{}","anteBet":{},"playBet":{},"pairplusBet":{},"sixCardBet":{},"progressiveBet":{},"anteReturn":{},"playReturn":{},"pairplusReturn":{},"sixCardReturn":{},"progressiveReturn":{},"anteBonus":{},"totalWagered":{},"totalReturn":{}}}"#,
        summary,
        net_pnl,
        resolved_entries,
        player_cards_str,
        hand_rank_str(player_hand.0),
        dealer_cards_str,
        hand_rank_str(dealer_hand.0),
        dealer_qualifies,
        is_fold,
        outcome,
        session.bet,
        play_bet,
        state.pairplus_bet,
        state.six_card_bonus_bet,
        state.progressive_bet,
        ante_return,
        play_return,
        pairplus_return,
        six_card_return,
        progressive_return,
        ante_bonus,
        total_wagered,
        total_return
    )]
}

pub struct ThreeCardPoker;

impl CasinoGame for ThreeCardPoker {
    fn init(session: &mut GameSession, _rng: &mut GameRng) -> GameResult {
        // Start in a betting stage so Pairplus can be placed before any cards are dealt.
        let state = TcState {
            stage: Stage::Betting,
            player: [CARD_UNKNOWN; 3],
            dealer: [CARD_UNKNOWN; 3],
            pairplus_bet: 0,
            six_card_bonus_bet: 0,
            progressive_bet: 0,
            rules: ThreeCardRules::default(),
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

        match state.stage {
            Stage::Betting => match mv {
                Move::SetRules => {
                    if payload.len() != 2 {
                        return Err(GameError::InvalidPayload);
                    }
                    let rules =
                        ThreeCardRules::from_byte(payload[1]).ok_or(GameError::InvalidPayload)?;
                    state.rules = rules;
                    session.state_blob = serialize_state(&state);
                    Ok(GameResult::Continue(vec![]))
                }
                Move::SetPairPlus => {
                    let new_bet =
                        clamp_side_bet_amount(super::payload::parse_u64_be(payload, 1)?);
                    let payout = apply_pairplus_update(&mut state, new_bet)?;
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
                Move::Deal => {
                    if is_known_card(state.player[0]) {
                        return Err(GameError::InvalidMove);
                    }

                    let mut payout_update: i64 = 0;
                    if payload.len() == 9 {
                        let new_bet =
                            clamp_side_bet_amount(super::payload::parse_u64_be(payload, 1)?);
                        payout_update = apply_pairplus_update(&mut state, new_bet)?;
                    } else if payload.len() != 1 {
                        return Err(GameError::InvalidPayload);
                    }

                    let mut deck = rng.create_deck();
                    state.player[0] = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                    state.player[1] = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                    state.player[2] = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                    state.stage = Stage::Decision;

                    session.state_blob = serialize_state(&state);
                    Ok(if payout_update == 0 {
                        GameResult::Continue(vec![])
                    } else {
                        GameResult::ContinueWithUpdate {
                            payout: payout_update,
                            logs: vec![],
                        }
                    })
                }
                Move::SetSixCardBonus => {
                    let new_bet =
                        clamp_side_bet_amount(super::payload::parse_u64_be(payload, 1)?);
                    let payout = apply_six_card_bonus_update(&mut state, new_bet)?;
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
                Move::SetProgressive => {
                    let new_bet =
                        clamp_progressive_bet(super::payload::parse_u64_be(payload, 1)?);
                    let payout = apply_progressive_update(&mut state, new_bet)?;
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
                _ => {
                    // Check for atomic batch action (payload[0] == 7)
                    // [7, pair_plus: u64 BE, six_card: u64 BE, progressive: u64 BE]
                    if payload[0] == 7 {
                        if payload.len() != 25 {
                            return Err(GameError::InvalidPayload);
                        }
                        if is_known_card(state.player[0]) {
                            return Err(GameError::InvalidMove);
                        }

                        // Parse side bet amounts
                        let pair_plus =
                            clamp_side_bet_amount(super::payload::parse_u64_be(payload, 1)?);
                        let six_card =
                            clamp_side_bet_amount(super::payload::parse_u64_be(payload, 9)?);
                        let progressive =
                            clamp_progressive_bet(super::payload::parse_u64_be(payload, 17)?);

                        // Apply all side bets atomically
                        let mut total_deduction: i64 = 0;
                        total_deduction = total_deduction
                            .saturating_add(apply_pairplus_update(&mut state, pair_plus)?);
                        total_deduction = total_deduction
                            .saturating_add(apply_six_card_bonus_update(&mut state, six_card)?);
                        total_deduction = total_deduction
                            .saturating_add(apply_progressive_update(&mut state, progressive)?);

                        // Deal player cards
                        let mut deck = rng.create_deck();
                        state.player[0] = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                        state.player[1] = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                        state.player[2] = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                        state.stage = Stage::Decision;

                        session.state_blob = serialize_state(&state);
                        Ok(if total_deduction == 0 {
                            GameResult::Continue(vec![])
                        } else {
                            GameResult::ContinueWithUpdate {
                                payout: total_deduction,
                                logs: vec![],
                            }
                        })
                    } else {
                        Err(GameError::InvalidMove)
                    }
                }
            },
            Stage::Decision => match mv {
                Move::Fold => {
                    // Fold: lose ante, Pairplus still resolves.
                    // Reveal dealer cards for display.
                    let mut deck = rng.create_deck_excluding(&state.player);
                    state.dealer[0] = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                    state.dealer[1] = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                    state.dealer[2] = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                    state.stage = Stage::Complete;
                    session.is_complete = true;

                    let mut pairplus_return =
                        resolve_pairplus_return(&state.player, state.pairplus_bet);
                    let mut six_card_return = resolve_six_card_bonus_return(
                        &state.player,
                        &state.dealer,
                        state.six_card_bonus_bet,
                    );
                    let mut progressive_return =
                        resolve_progressive_return(&state.player, state.progressive_bet);
                    let ante_return = 0;
                    let play_return = 0;
                    let ante_bonus = 0;

                    if session.super_mode.is_active {
                        let apply_super = |amount: u64| {
                            if amount > 0 {
                                apply_super_multiplier_cards(
                                    &state.player,
                                    &session.super_mode.multipliers,
                                    amount,
                                )
                            } else {
                                0
                            }
                        };
                        pairplus_return = apply_super(pairplus_return);
                        six_card_return = apply_super(six_card_return);
                        progressive_return = apply_super(progressive_return);
                    }

                    let total_return = pairplus_return
                        .saturating_add(six_card_return)
                        .saturating_add(progressive_return)
                        .saturating_add(ante_return)
                        .saturating_add(play_return);

                    let total_wagered = session
                        .bet
                        .saturating_add(state.pairplus_bet)
                        .saturating_add(state.six_card_bonus_bet)
                        .saturating_add(state.progressive_bet);

                    session.state_blob = serialize_state(&state);

                    let logs = generate_three_card_logs(
                        &state,
                        session,
                        true,
                        false,
                        "FOLD",
                        ante_return,
                        play_return,
                        pairplus_return,
                        six_card_return,
                        progressive_return,
                        ante_bonus,
                        total_return,
                    );
                    if total_return == 0 {
                        Ok(GameResult::LossPreDeducted(total_wagered, logs))
                    } else {
                        Ok(GameResult::Win(total_return, logs))
                    }
                }
                Move::Play => {
                    // Charge Play bet (equal to ante) now; resolve on Reveal.
                    state.stage = Stage::AwaitingReveal;
                    session.state_blob = serialize_state(&state);
                    Ok(GameResult::ContinueWithUpdate {
                        payout: -(session.bet as i64),
                        logs: vec![],
                    })
                }
                _ => Err(GameError::InvalidMove),
            },
            Stage::AwaitingReveal => match mv {
                Move::Reveal => {
                    // Reveal dealer cards and resolve all bets.
                    let mut deck = rng.create_deck_excluding(&state.player);
                    state.dealer[0] = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                    state.dealer[1] = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                    state.dealer[2] = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                    state.stage = Stage::Complete;
                    session.is_complete = true;

                    let player_hand = evaluate_hand(&state.player);
                    let dealer_hand = evaluate_hand(&state.dealer);
                    let dealer_ok = dealer_qualifies(&dealer_hand, state.rules);

                    let mut pairplus_return =
                        resolve_pairplus_return(&state.player, state.pairplus_bet);
                    let mut six_card_return = resolve_six_card_bonus_return(
                        &state.player,
                        &state.dealer,
                        state.six_card_bonus_bet,
                    );
                    let mut progressive_return =
                        resolve_progressive_return(&state.player, state.progressive_bet);

                    // Ante bonus is paid when the player plays, regardless of dealer qualification/outcome.
                    let ante_bonus = session
                        .bet
                        .saturating_mul(ante_bonus_multiplier(player_hand.0));

                    let (mut ante_return, mut play_return) = if !dealer_ok {
                        // Dealer doesn't qualify: Ante wins 1:1, Play pushes.
                        (
                            session.bet.saturating_mul(2).saturating_add(ante_bonus),
                            session.bet,
                        )
                    } else {
                        match compare_hands(&player_hand, &dealer_hand) {
                            std::cmp::Ordering::Greater => (
                                session.bet.saturating_mul(2).saturating_add(ante_bonus),
                                session.bet.saturating_mul(2),
                            ),
                            std::cmp::Ordering::Equal => (
                                session.bet.saturating_add(ante_bonus),
                                session.bet,
                            ),
                            std::cmp::Ordering::Less => {
                                // Lose both; ante bonus can still apply.
                                (ante_bonus, 0)
                            }
                        }
                    };

                    if session.super_mode.is_active {
                        let apply_super = |amount: u64| {
                            if amount > 0 {
                                apply_super_multiplier_cards(
                                    &state.player,
                                    &session.super_mode.multipliers,
                                    amount,
                                )
                            } else {
                                0
                            }
                        };
                        ante_return = apply_super(ante_return);
                        play_return = apply_super(play_return);
                        pairplus_return = apply_super(pairplus_return);
                        six_card_return = apply_super(six_card_return);
                        progressive_return = apply_super(progressive_return);
                    }

                    let total_return = ante_return
                        .saturating_add(play_return)
                        .saturating_add(pairplus_return)
                        .saturating_add(six_card_return)
                        .saturating_add(progressive_return);

                    let total_wagered = session
                        .bet
                        .saturating_mul(2)
                        .saturating_add(state.pairplus_bet)
                        .saturating_add(state.six_card_bonus_bet)
                        .saturating_add(state.progressive_bet);

                    session.state_blob = serialize_state(&state);

                    // Determine outcome string for logs
                    let outcome = if !dealer_ok {
                        "DEALER_NO_QUALIFY"
                    } else {
                        match compare_hands(&player_hand, &dealer_hand) {
                            std::cmp::Ordering::Greater => "WIN",
                            std::cmp::Ordering::Equal => "PUSH",
                            std::cmp::Ordering::Less => "LOSS",
                        }
                    };

                    let logs = generate_three_card_logs(
                        &state,
                        session,
                        false,
                        dealer_ok,
                        outcome,
                        ante_return,
                        play_return,
                        pairplus_return,
                        six_card_return,
                        progressive_return,
                        ante_bonus,
                        total_return,
                    );
                    if total_return == 0 {
                        Ok(GameResult::LossPreDeducted(total_wagered, logs))
                    } else {
                        Ok(GameResult::Win(total_return, logs))
                    }
                }
                _ => Err(GameError::InvalidMove),
            },
            Stage::Complete => Err(GameError::GameAlreadyComplete),
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
            game_type: GameType::ThreeCard,
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
    fn test_dealer_qualification_threshold() {
        // Q-high qualifies; J-high does not.
        let rules = ThreeCardRules::default();
        let qualifies = dealer_qualifies(&(HandRank::HighCard, [12, 5, 4]), rules);
        assert!(qualifies);
        let qualifies = dealer_qualifies(&(HandRank::HighCard, [11, 9, 8]), rules);
        assert!(!qualifies);

        // Q-6-4 qualifier variant.
        let rules = ThreeCardRules {
            dealer_qualifier: DealerQualifier::Q64,
        };
        let qualifies = dealer_qualifies(&(HandRank::HighCard, [12, 6, 4]), rules);
        assert!(qualifies);
        let qualifies = dealer_qualifies(&(HandRank::HighCard, [12, 6, 3]), rules);
        assert!(!qualifies);
    }

    #[test]
    fn test_pairplus_multiplier_table() {
        assert_eq!(pairplus_multiplier(HandRank::StraightFlush), 40);
        assert_eq!(pairplus_multiplier(HandRank::ThreeOfAKind), 30);
        assert_eq!(pairplus_multiplier(HandRank::Straight), 6);
        assert_eq!(pairplus_multiplier(HandRank::Flush), 3);
        assert_eq!(pairplus_multiplier(HandRank::Pair), 1);
        assert_eq!(pairplus_multiplier(HandRank::HighCard), 0);
    }

    #[test]
    fn test_ante_bonus_multiplier_table() {
        assert_eq!(
            ante_bonus_multiplier(HandRank::StraightFlush),
            payouts::ANTE_STRAIGHT_FLUSH
        );
        assert_eq!(
            ante_bonus_multiplier(HandRank::ThreeOfAKind),
            payouts::ANTE_THREE_OF_A_KIND
        );
        assert_eq!(
            ante_bonus_multiplier(HandRank::Straight),
            payouts::ANTE_STRAIGHT
        );
        assert_eq!(ante_bonus_multiplier(HandRank::Flush), 0);
    }

    #[test]
    fn test_state_blob_fuzz_does_not_panic() {
        let mut rng = StdRng::seed_from_u64(0x5eed_7c3d);
        for _ in 0..1_000 {
            let len = rng.gen_range(0..=128);
            let mut blob = vec![0u8; len];
            rng.fill(&mut blob[..]);
            let _ = parse_state(&blob);
        }
    }

    #[test]
    fn test_three_card_tiebreakers() {
        // Pair kicker comparison.
        let pair_ace = evaluate_hand(&[4u8, 17u8, 26u8]); // 5♠ 5♥ A♦
        let pair_king = evaluate_hand(&[4u8, 30u8, 51u8]); // 5♠ 5♦ K♣
        assert!(compare_hands(&pair_ace, &pair_king).is_gt());

        // Wheel straight should be lowest straight.
        let wheel = evaluate_hand(&[0u8, 14u8, 28u8]); // A♠ 2♥ 3♦
        let higher = evaluate_hand(&[1u8, 15u8, 29u8]); // 2♠ 3♥ 4♦
        assert!(compare_hands(&higher, &wheel).is_gt());
    }

    #[test]
    fn test_basic_flow_deal_play_reveal() -> Result<(), GameError> {
        let seed = create_test_seed();
        let mut session = create_test_session(100);

        // Init
        let mut rng = GameRng::new(&seed, session.id, 0);
        ThreeCardPoker::init(&mut session, &mut rng);

        // Deal (no pairplus)
        let mut rng = GameRng::new(&seed, session.id, 1);
        ThreeCardPoker::process_move(&mut session, &[Move::Deal as u8], &mut rng)?;

        // Play (deduct play bet)
        let mut rng = GameRng::new(&seed, session.id, 2);
        let res = ThreeCardPoker::process_move(&mut session, &[Move::Play as u8], &mut rng)?;
        assert!(matches!(
            res,
            GameResult::ContinueWithUpdate { payout: -100, .. }
        ));

        // Reveal resolves
        let mut rng = GameRng::new(&seed, session.id, 3);
        let res = ThreeCardPoker::process_move(&mut session, &[Move::Reveal as u8], &mut rng)?;
        assert!(matches!(
            res,
            GameResult::Win(_, _) | GameResult::LossPreDeducted(_, _)
        ));
        assert!(session.is_complete);
        Ok(())
    }

    #[test]
    fn test_six_card_bonus_multiplier_examples() {
        // Royal flush in diamonds + junk.
        let cards = [26u8, 35u8, 36u8, 37u8, 38u8, 0u8];
        assert_eq!(
            evaluate_best_5_of_6_bonus_rank(&cards),
            SixCardBonusRank::RoyalFlush
        );
        assert_eq!(
            six_card_bonus_multiplier(SixCardBonusRank::RoyalFlush),
            1000
        );

        // Quads (four aces) + junk.
        let cards = [0u8, 13u8, 26u8, 39u8, 1u8, 2u8]; // A♠ A♥ A♦ A♣ 2♠ 3♠
        assert_eq!(
            evaluate_best_5_of_6_bonus_rank(&cards),
            SixCardBonusRank::FourOfAKind
        );
        assert_eq!(
            six_card_bonus_multiplier(SixCardBonusRank::FourOfAKind),
            100
        );
    }

    #[test]
    fn test_progressive_paytable_examples() {
        // Mini-royal in spades: A♠ K♠ Q♠.
        let player = [0u8, 12u8, 11u8];
        assert_eq!(
            resolve_progressive_return(&player, PROGRESSIVE_BET_UNIT),
            THREE_CARD_PROGRESSIVE_BASE_JACKPOT
        );

        // Mini-royal in hearts: A♥ K♥ Q♥.
        let player = [13u8, 25u8, 24u8];
        assert_eq!(
            resolve_progressive_return(&player, PROGRESSIVE_BET_UNIT),
            500
        );

        // Straight flush: 2♠ 3♠ 4♠.
        let player = [1u8, 2u8, 3u8];
        assert_eq!(
            resolve_progressive_return(&player, PROGRESSIVE_BET_UNIT),
            70
        );

        // Trips: 5♠ 5♥ 5♦.
        let player = [4u8, 17u8, 30u8];
        assert_eq!(
            resolve_progressive_return(&player, PROGRESSIVE_BET_UNIT),
            60
        );

        // Straight: 2♠ 3♥ 4♦.
        let player = [1u8, 15u8, 29u8];
        assert_eq!(resolve_progressive_return(&player, PROGRESSIVE_BET_UNIT), 6);
    }
}
