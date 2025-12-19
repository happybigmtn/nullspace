//! Blackjack game implementation.
//!
//! This implementation supports:
//! - Standard blackjack main wager (`session.bet`, deducted by `CasinoStartGame`)
//! - Splits (up to 4 hands) + doubles (deducted via `ContinueWithUpdate`)
//! - 21+3 side bet (optional, placed before deal)
//!
//! House rules (executor):
//! - 8-deck shoe, dealer hits soft 17 (H17)
//! - No surrender, no on-chain insurance
//! - No dealer peek (dealer hole card is drawn at `Reveal` for hidden-info safety)
//!
//! State blob format (v2):
//! [version:u8=2]
//! [stage:u8]
//! [sideBet21Plus3Amount:u64 BE]
//! [initialPlayerCard1:u8] [initialPlayerCard2:u8]   (0xFF if not dealt yet)
//! [active_hand_idx:u8]
//! [hand_count:u8]
//! ... per hand:
//!   [bet_mult:u8] (1=base, 2=doubled)
//!   [status:u8] (0=playing, 1=stand, 2=bust, 3=blackjack)
//!   [was_split:u8] (0/1; split hands cannot be a natural blackjack)
//!   [card_count:u8]
//!   [cards...]
//! [dealer_count:u8] [dealer_cards...]
//!
//! Stages:
//! 0 = Betting (optional 21+3, then Deal)
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

use super::super_mode::apply_super_multiplier_cards;
use super::{cards, CasinoGame, GameError, GameResult, GameRng};
use nullspace_types::casino::GameSession;

/// Maximum cards in a blackjack hand.
const MAX_HAND_SIZE: usize = 11;
/// Maximum number of hands allowed (splits).
const MAX_HANDS: usize = 4;
const STATE_VERSION: u8 = 2;
const CARD_UNKNOWN: u8 = 0xFF;
/// WoO notes blackjack is commonly dealt from multi-deck shoes; we use 8 decks.
const BLACKJACK_DECKS: u8 = 8;

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
}

impl TryFrom<u8> for HandStatus {
    type Error = GameError;
    fn try_from(v: u8) -> Result<Self, Self::Error> {
        match v {
            0 => Ok(HandStatus::Playing),
            1 => Ok(HandStatus::Standing),
            2 => Ok(HandStatus::Busted),
            3 => Ok(HandStatus::Blackjack),
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
    pub initial_player_cards: [u8; 2],
    pub active_hand_idx: usize,
    pub hands: Vec<HandState>,
    pub dealer_cards: Vec<u8>,
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
    // WoO 21+3 "Version 4" / "Xtreme" pay table: 30-20-10-5 (to-1).
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

    match (is_straight, is_flush, is_trips) {
        (_, _, true) => 20,
        (true, true, false) => 30,
        (true, false, false) => 10,
        (false, true, false) => 5,
        _ => 0,
    }
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

fn apply_21plus3_update(state: &mut BlackjackState, new_bet: u64) -> Result<i64, GameError> {
    let old = state.side_bet_21plus3 as i128;
    let new = new_bet as i128;
    let delta = new.saturating_sub(old);
    if delta > i64::MAX as i128 || delta < i64::MIN as i128 {
        return Err(GameError::InvalidMove);
    }
    state.side_bet_21plus3 = new_bet;
    Ok(-(delta as i64))
}

/// Serialize state to blob.
fn serialize_state(state: &BlackjackState) -> Vec<u8> {
    let mut blob = Vec::new();
    blob.push(STATE_VERSION);
    blob.push(state.stage as u8);
    blob.extend_from_slice(&state.side_bet_21plus3.to_be_bytes());
    blob.push(state.initial_player_cards[0]);
    blob.push(state.initial_player_cards[1]);
    blob.push(state.active_hand_idx as u8);
    blob.push(state.hands.len() as u8);

    for hand in &state.hands {
        blob.push(hand.bet_mult);
        blob.push(hand.status as u8);
        blob.push(hand.was_split as u8);
        blob.push(hand.cards.len() as u8);
        blob.extend_from_slice(&hand.cards);
    }

    blob.push(state.dealer_cards.len() as u8);
    blob.extend_from_slice(&state.dealer_cards);
    blob
}

/// Parse state from blob.
fn parse_state(blob: &[u8]) -> Option<BlackjackState> {
    if blob.len() < 14 {
        return None;
    }

    if blob[0] != STATE_VERSION {
        return None;
    }

    let stage = Stage::try_from(blob[1]).ok()?;
    let mut idx = 2;
    let side_bet_21plus3 = u64::from_be_bytes(blob[idx..idx + 8].try_into().ok()?);
    idx += 8;

    let initial_player_cards = [blob[idx], blob[idx + 1]];
    idx += 2;

    let active_hand_idx = blob[idx] as usize;
    idx += 1;

    let hand_count = blob[idx] as usize;
    idx += 1;
    if hand_count > MAX_HANDS {
        return None;
    }

    let mut hands = Vec::with_capacity(hand_count);
    for _ in 0..hand_count {
        if idx + 4 > blob.len() {
            return None;
        }
        let bet_mult = blob[idx];
        let status = HandStatus::try_from(blob[idx + 1]).ok()?;
        let was_split = blob[idx + 2] != 0;
        let c_len = blob[idx + 3] as usize;
        idx += 4;

        if c_len > MAX_HAND_SIZE || idx + c_len > blob.len() {
            return None;
        }
        let cards = blob[idx..idx + c_len].to_vec();
        idx += c_len;

        hands.push(HandState {
            cards,
            bet_mult,
            status,
            was_split,
        });
    }

    if idx >= blob.len() {
        return None;
    }
    let d_len = blob[idx] as usize;
    idx += 1;

    if d_len > MAX_HAND_SIZE || idx + d_len > blob.len() {
        return None;
    }
    let dealer_cards = blob[idx..idx + d_len].to_vec();
    idx += d_len;

    if idx != blob.len() {
        return None;
    }

    Some(BlackjackState {
        stage,
        side_bet_21plus3,
        initial_player_cards,
        active_hand_idx,
        hands,
        dealer_cards,
    })
}

pub struct Blackjack;

impl CasinoGame for Blackjack {
    fn init(session: &mut GameSession, _rng: &mut GameRng) -> GameResult {
        // Start in a betting stage so side bets can be placed before any cards are dealt.
        let state = BlackjackState {
            stage: Stage::Betting,
            side_bet_21plus3: 0,
            initial_player_cards: [CARD_UNKNOWN; 2],
            active_hand_idx: 0,
            hands: Vec::new(),
            dealer_cards: Vec::new(),
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

        let mv = Move::try_from(payload[0])?;
        let mut state = parse_state(&session.state_blob).ok_or(GameError::InvalidPayload)?;

        if state.stage == Stage::Complete {
            return Err(GameError::GameAlreadyComplete);
        }

        match state.stage {
            Stage::Betting => match mv {
                Move::Set21Plus3 => {
                    let new_bet = super::payload::parse_u64_be(payload, 1)?;
                    let payout = apply_21plus3_update(&mut state, new_bet)?;
                    session.state_blob = serialize_state(&state);
                    Ok(if payout == 0 {
                        GameResult::Continue(vec![])
                    } else {
                        GameResult::ContinueWithUpdate { payout, logs: vec![] }
                    })
                }
                Move::Deal => {
                    if payload.len() != 1 {
                        return Err(GameError::InvalidPayload);
                    }
                    if !state.hands.is_empty() || !state.dealer_cards.is_empty() {
                        return Err(GameError::InvalidMove);
                    }

                    let mut deck = rng.create_shoe(BLACKJACK_DECKS);
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
                    // [7, sidebet_21plus3: u64 BE]
                    if payload[0] == 7 {
                        if payload.len() != 9 {
                            return Err(GameError::InvalidPayload);
                        }
                        if !state.hands.is_empty() || !state.dealer_cards.is_empty() {
                            return Err(GameError::InvalidMove);
                        }

                        // Parse and apply 21+3 side bet
                        let side_bet = super::payload::parse_u64_be(payload, 1)?;
                        let payout_update = apply_21plus3_update(&mut state, side_bet)?;

                        // Deal cards
                        let mut deck = rng.create_shoe(BLACKJACK_DECKS);
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
                let mut all_cards = Vec::new();
                for h in &state.hands {
                    all_cards.extend_from_slice(&h.cards);
                }
                all_cards.extend_from_slice(&state.dealer_cards);
                let mut deck = rng.create_shoe_excluding(&all_cards, BLACKJACK_DECKS);

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
                                    let total_return = resolve_21plus3_return(&state);

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
                                let total_return = resolve_21plus3_return(&state);

                                state.stage = Stage::Complete;
                                session.is_complete = true;
                                session.state_blob = serialize_state(&state);

                                return Ok(finalize_game_result(session, &state, total_return));
                            }

                            state.stage = Stage::AwaitingReveal;
                        }

                        session.state_blob = serialize_state(&state);
                        Ok(GameResult::ContinueWithUpdate {
                            payout: -(extra_bet as i64), logs: vec![],
                        })
                    }
                    Move::Split => {
                        if state.active_hand_idx >= state.hands.len() {
                            return Err(GameError::InvalidState);
                        }
                        if state.hands.len() >= MAX_HANDS {
                            return Err(GameError::InvalidMove);
                        }

                        let current_hand = &mut state.hands[state.active_hand_idx];
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

                        let split_bet = session.bet;

                        // Perform split
                        let split_card = current_hand.cards.pop().ok_or(GameError::InvalidState)?;
                        current_hand.was_split = true;

                        // Deal a card to each split hand
                        let c1 = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                        current_hand.cards.push(c1);

                        let c2 = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                        let new_hand = HandState {
                            cards: vec![split_card, c2],
                            bet_mult: 1,
                            status: HandStatus::Playing,
                            was_split: true,
                        };

                        state.hands.insert(state.active_hand_idx + 1, new_hand);

                        session.move_count = session.move_count.saturating_add(1);
                        session.state_blob = serialize_state(&state);
                        Ok(GameResult::ContinueWithUpdate {
                            payout: -(split_bet as i64), logs: vec![],
                        })
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
                    let mut all_cards = Vec::new();
                    for h in &state.hands {
                        all_cards.extend_from_slice(&h.cards);
                    }
                    all_cards.extend_from_slice(&state.dealer_cards);
                    let mut deck = rng.create_shoe_excluding(&all_cards, BLACKJACK_DECKS);

                    // Reveal dealer hole card.
                    let hole = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                    state.dealer_cards.push(hole);

                    let any_live = state.hands.iter().any(|h| h.status != HandStatus::Busted);
                    if any_live {
                        loop {
                            let (val, is_soft) = hand_value(&state.dealer_cards);
                            if val > 17 || (val == 17 && !is_soft) {
                                break;
                            }
                            let c = rng.draw_card(&mut deck).ok_or(GameError::DeckExhausted)?;
                            state.dealer_cards.push(c);
                        }
                    }

                    let mut total_return = resolve_main_return(session, &state);
                    total_return = total_return.saturating_add(resolve_21plus3_return(&state));

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
) -> u64 {
    if hand.status == HandStatus::Busted {
        return 0;
    }

    let (player_value, _) = hand_value(&hand.cards);
    let player_blackjack = is_natural_blackjack(hand);

    if player_blackjack && dealer_blackjack {
        return bet;
    }
    if player_blackjack {
        return bet.saturating_mul(5) / 2;
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
        ))
    })
}

fn total_wagered(session: &GameSession, state: &BlackjackState) -> u64 {
    let main_wagered: u64 = state
        .hands
        .iter()
        .map(|h| session.bet.saturating_mul(h.bet_mult as u64))
        .sum();
    main_wagered.saturating_add(state.side_bet_21plus3)
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

/// Generate JSON logs for blackjack game completion
fn generate_blackjack_logs(session: &GameSession, state: &BlackjackState, total_return: u64) -> Vec<String> {
    let (dealer_value, _) = hand_value(&state.dealer_cards);
    let dealer_blackjack = is_blackjack(&state.dealer_cards);

    // Build hands info as JSON array
    let hands_json: Vec<String> = state
        .hands
        .iter()
        .map(|h| {
            let (value, is_soft) = hand_value(&h.cards);
            let cards_str = h
                .cards
                .iter()
                .map(|c| c.to_string())
                .collect::<Vec<_>>()
                .join(",");
            let bet = session.bet.saturating_mul(h.bet_mult as u64);
            let hand_return = resolve_hand_return(bet, h, dealer_value, dealer_blackjack);
            let status_str = match h.status {
                HandStatus::Playing => "PLAYING",
                HandStatus::Standing => "STANDING",
                HandStatus::Busted => "BUSTED",
                HandStatus::Blackjack => "BLACKJACK",
            };
            format!(
                r#"{{"cards":[{}],"value":{},"soft":{},"status":"{}","bet":{},"return":{}}}"#,
                cards_str, value, is_soft, status_str, bet, hand_return
            )
        })
        .collect();

    let dealer_cards_str = state
        .dealer_cards
        .iter()
        .map(|c| c.to_string())
        .collect::<Vec<_>>()
        .join(",");

    let side_bet_return = resolve_21plus3_return(state);

    vec![format!(
        r#"{{"hands":[{}],"dealer":{{"cards":[{}],"value":{},"blackjack":{}}},"sideBet21Plus3":{},"sideBetReturn":{},"totalReturn":{}}}"#,
        hands_json.join(","),
        dealer_cards_str,
        dealer_value,
        dealer_blackjack,
        state.side_bet_21plus3,
        side_bet_return,
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
mod tests {
    use super::*;
    use nullspace_types::casino::GameType;
    use nullspace_types::casino::SuperModeState;
    use rand::{rngs::StdRng, Rng as _, SeedableRng as _};

    #[test]
    fn test_21plus3_multiplier_table() {
        // Straight flush (2-3-4 suited)
        assert_eq!(eval_21plus3_multiplier([1, 2, 3]), 30);

        // Trips (three 7s)
        assert_eq!(eval_21plus3_multiplier([6, 19, 32]), 20);

        // Straight (10-J-Q unsuited)
        assert_eq!(eval_21plus3_multiplier([9, 23, 37]), 10);

        // Flush (A-5-9 suited, not straight)
        assert_eq!(eval_21plus3_multiplier([0, 4, 8]), 5);

        // Nothing
        assert_eq!(eval_21plus3_multiplier([0, 10, 25]), 0);
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
    fn test_hit_all_busted_returns_loss_prededucted() {
        let (network_secret, _) = crate::mocks::create_network_keypair();
        let seed = crate::mocks::create_seed(&network_secret, 1);
        let (_, public) = crate::mocks::create_account_keypair(1);

        let state = BlackjackState {
            stage: Stage::PlayerTurn,
            side_bet_21plus3: 0,
            initial_player_cards: [9, 12],
            active_hand_idx: 0,
            hands: vec![HandState {
                cards: vec![9, 12], // 10 + K = 20
                bet_mult: 1,
                status: HandStatus::Playing,
                was_split: false,
            }],
            dealer_cards: vec![0],
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
            match Blackjack::process_move(&mut session, &[Move::Hit as u8], &mut rng).unwrap() {
                GameResult::LossPreDeducted(total_wagered, _) => {
                    found = Some(total_wagered);
                    break;
                }
                _ => continue,
            }
        }

        assert_eq!(found, Some(100));
    }

    #[test]
    fn test_hit_all_busted_side_bet_win_returns_win() {
        let (network_secret, _) = crate::mocks::create_network_keypair();
        let seed = crate::mocks::create_seed(&network_secret, 1);
        let (_, public) = crate::mocks::create_account_keypair(1);

        let state = BlackjackState {
            stage: Stage::PlayerTurn,
            side_bet_21plus3: 10,
            initial_player_cards: [1, 2],
            active_hand_idx: 0,
            hands: vec![HandState {
                cards: vec![1, 2, 9, 4], // 2 + 3 + 10 + 5 = 20
                bet_mult: 1,
                status: HandStatus::Playing,
                was_split: false,
            }],
            dealer_cards: vec![3],
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
            match Blackjack::process_move(&mut session, &[Move::Hit as u8], &mut rng).unwrap() {
                GameResult::Win(total_return, _) => {
                    found = Some(total_return);
                    break;
                }
                _ => continue,
            }
        }

        assert_eq!(found, Some(310));
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
}
