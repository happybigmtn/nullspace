//! Casino War game implementation.
//!
//! State blob format:
//! [version:u8=1] [stage:u8] [playerCard:u8] [dealerCard:u8] [tie_bet:u64 BE] [rules:u8]
//!
//! Stage: 0 = Betting (pre-deal), 1 = War (after tie), 2 = Complete
//!
//! Payload format:
//! [0] = Play (in Betting: deal + compare)
//! [1] = War (after tie, go to war)
//! [2] = Surrender (after tie, forfeit half bet)
//! [3, tie_bet:u64 BE] = Set tie bet (Betting stage only)
//! [5, rules:u8] = Set rules (Betting stage only)

use super::logging::{clamp_i64, push_resolved_entry};
use super::serialization::{StateReader, StateWriter};
use super::super_mode::apply_super_multiplier_cards;
use super::{cards, CasinoGame, GameError, GameResult, GameRng};
use nullspace_types::casino::GameSession;

const STATE_VERSION: u8 = 1;
const HIDDEN_CARD: u8 = 0xFF;
const STATE_LEN_BASE: usize = 12;
const STATE_LEN_WITH_RULES: usize = 13;
/// WoO: Casino War is played with six decks.
const CASINO_WAR_DECKS: u8 = 6;
/// Max base bet amount to keep i64-safe deductions.
const MAX_BASE_BET_AMOUNT: u64 = i64::MAX as u64;
/// Max tie bet amount to keep i64-safe return amounts (11:1 payout => 12x return).
const MAX_TIE_BET_AMOUNT: u64 = (i64::MAX as u64) / 12;

fn clamp_base_bet(session: &mut GameSession) {
    if session.bet > MAX_BASE_BET_AMOUNT {
        session.bet = MAX_BASE_BET_AMOUNT;
    }
}

fn clamp_tie_bet_amount(amount: u64) -> u64 {
    super::payload::clamp_bet_amount(amount, MAX_TIE_BET_AMOUNT)
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

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum TieBetPayout {
    #[default]
    TenToOne = 0,
    ElevenToOne = 1,
}

impl TryFrom<u8> for TieBetPayout {
    type Error = ();

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(TieBetPayout::TenToOne),
            1 => Ok(TieBetPayout::ElevenToOne),
            _ => Err(()),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CasinoWarRules {
    tie_bet_payout: TieBetPayout,
    tie_after_tie_bonus: bool,
}

impl Default for CasinoWarRules {
    fn default() -> Self {
        Self {
            tie_bet_payout: TieBetPayout::default(),
            tie_after_tie_bonus: true,
        }
    }
}

impl CasinoWarRules {
    fn from_byte(value: u8) -> Option<Self> {
        Some(Self {
            tie_bet_payout: TieBetPayout::try_from(value & 0x01).ok()?,
            tie_after_tie_bonus: value & 0x02 != 0,
        })
    }

    fn to_byte(self) -> u8 {
        (self.tie_bet_payout as u8) | if self.tie_after_tie_bonus { 0x02 } else { 0x00 }
    }

    fn tie_bet_multiplier(self) -> u64 {
        match self.tie_bet_payout {
            TieBetPayout::TenToOne => 10,
            TieBetPayout::ElevenToOne => 11,
        }
    }
}

/// Casino War stages.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Stage {
    Betting = 0,
    War = 1,
    Complete = 2,
}

impl TryFrom<u8> for Stage {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Stage::Betting),
            1 => Ok(Stage::War),
            2 => Ok(Stage::Complete),
            _ => Err(GameError::InvalidPayload),
        }
    }
}

/// Player moves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Move {
    Play = 0,      // Initial play or continue
    War = 1,       // Go to war (on tie)
    Surrender = 2, // Surrender on tie
    SetTieBet = 3, // Set optional tie bet (betting stage only)
    SetRules = 5,  // Set rules (betting stage only)
}

impl TryFrom<u8> for Move {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Move::Play),
            1 => Ok(Move::War),
            2 => Ok(Move::Surrender),
            3 => Ok(Move::SetTieBet),
            5 => Ok(Move::SetRules),
            _ => Err(GameError::InvalidPayload),
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct CasinoWarState {
    player_card: u8,
    dealer_card: u8,
    stage: Stage,
    tie_bet: u64,
    rules: CasinoWarRules,
}

fn parse_state(state: &[u8]) -> Option<CasinoWarState> {
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
    let player_card = reader.read_u8()?;
    let dealer_card = reader.read_u8()?;
    if !matches!(player_card, HIDDEN_CARD) && player_card >= 52 {
        return None;
    }
    if !matches!(dealer_card, HIDDEN_CARD) && dealer_card >= 52 {
        return None;
    }
    let tie_bet = clamp_tie_bet_amount(reader.read_u64_be()?);
    let rules = if reader.remaining() > 0 {
        CasinoWarRules::from_byte(reader.read_u8()?)?
    } else {
        CasinoWarRules::default()
    };
    Some(CasinoWarState {
        player_card,
        dealer_card,
        stage,
        tie_bet,
        rules,
    })
}

fn serialize_state(state: &CasinoWarState) -> Vec<u8> {
    let mut out = StateWriter::with_capacity(13);
    out.push_u8(STATE_VERSION);
    out.push_u8(state.stage as u8);
    out.push_u8(state.player_card);
    out.push_u8(state.dealer_card);
    out.push_u64_be(state.tie_bet);
    out.push_u8(state.rules.to_byte());
    out.into_inner()
}

pub struct CasinoWar;

impl CasinoGame for CasinoWar {
    fn init(session: &mut GameSession, _rng: &mut GameRng) -> GameResult {
        // Start in a betting stage so optional side bets can be placed before the deal.
        let state = CasinoWarState {
            player_card: HIDDEN_CARD,
            dealer_card: HIDDEN_CARD,
            stage: Stage::Betting,
            tie_bet: 0,
            rules: CasinoWarRules::default(),
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

        session.move_count += 1;

        match state.stage {
            Stage::Betting => match mv {
                Move::SetRules => {
                    if payload.len() != 2 {
                        return Err(GameError::InvalidPayload);
                    }
                    let rules = CasinoWarRules::from_byte(payload[1])
                        .ok_or(GameError::InvalidPayload)?;
                    state.rules = rules;
                    session.state_blob = serialize_state(&state);
                    Ok(GameResult::Continue(vec![]))
                }
                Move::SetTieBet => {
                    if payload.len() != 9 {
                        return Err(GameError::InvalidPayload);
                    }
                    let next_amount = u64::from_be_bytes(
                        payload[1..9]
                            .try_into()
                            .map_err(|_| GameError::InvalidPayload)?,
                    );
                    let next_amount = clamp_tie_bet_amount(next_amount);

                    let prev_amount = state.tie_bet;

                    // We only support i64 deltas in ContinueWithUpdate.
                    let (payout, new_tie_bet) = if next_amount >= prev_amount {
                        let delta = next_amount - prev_amount;
                        let delta_i64 =
                            i64::try_from(delta).map_err(|_| GameError::InvalidPayload)?;
                        (-(delta_i64), next_amount)
                    } else {
                        let delta = prev_amount - next_amount;
                        let delta_i64 =
                            i64::try_from(delta).map_err(|_| GameError::InvalidPayload)?;
                        (delta_i64, next_amount)
                    };

                    state.tie_bet = new_tie_bet;
                    session.state_blob = serialize_state(&state);
                    Ok(GameResult::ContinueWithUpdate {
                        payout,
                        logs: vec![],
                    })
                }
                Move::Play => {
                    if payload.len() != 1 {
                        return Err(GameError::InvalidPayload);
                    }

                    // Deal one card each.
                    let mut deck = rng.create_shoe(CASINO_WAR_DECKS);
                    let player_card = rng.draw_card(&mut deck).unwrap_or(0);
                    let dealer_card = rng.draw_card(&mut deck).unwrap_or(1);

                    let player_rank = cards::card_rank_ace_high(player_card);
                    let dealer_rank = cards::card_rank_ace_high(dealer_card);

                    // Tie bet pays on initial tie only.
                    let tie_bet_return: i64 = if state.tie_bet > 0 && player_rank == dealer_rank {
                        let credited = state
                            .tie_bet
                            .saturating_mul(state.rules.tie_bet_multiplier().saturating_add(1));
                        i64::try_from(credited).map_err(|_| GameError::InvalidPayload)?
                    } else {
                        0
                    };

                    if player_rank > dealer_rank {
                        // Player wins 1:1.
                        state.stage = Stage::Complete;
                        state.player_card = player_card;
                        state.dealer_card = dealer_card;
                        session.state_blob = serialize_state(&state);
                        session.is_complete = true;

                        let base_winnings = session.bet.saturating_mul(2);
                        let final_winnings = if session.super_mode.is_active {
                            apply_super_multiplier_cards(
                                &[player_card],
                                &session.super_mode.multipliers,
                                base_winnings,
                            )
                        } else {
                            base_winnings
                        };
                        let summary = format!(
                            "Deal: P {} D {}",
                            format_card_label(player_card),
                            format_card_label(dealer_card)
                        );
                        let mut resolved_entries = String::with_capacity(256);
                        let mut resolved_sum: i128 = 0;
                        let main_pnl =
                            clamp_i64(i128::from(base_winnings) - i128::from(session.bet));
                        push_resolved_entry(&mut resolved_entries, "MAIN", main_pnl);
                        resolved_sum = resolved_sum.saturating_add(i128::from(main_pnl));
                        if state.tie_bet > 0 {
                            let tie_pnl = -(state.tie_bet as i64);
                            push_resolved_entry(&mut resolved_entries, "TIE", tie_pnl);
                            resolved_sum = resolved_sum.saturating_add(i128::from(tie_pnl));
                        }
                        let net_pnl = clamp_i64(
                            i128::from(final_winnings)
                                .saturating_sub(i128::from(session.bet))
                                .saturating_sub(i128::from(state.tie_bet)),
                        );
                        let diff = i128::from(net_pnl).saturating_sub(resolved_sum);
                        if diff != 0 {
                            push_resolved_entry(&mut resolved_entries, "ADJUSTMENT", clamp_i64(diff));
                        }
                        let logs = vec![format!(
                            r#"{{"summary":"{}","netPnl":{},"resolvedBets":[{}],"stage":"DEAL","playerCard":{},"dealerCard":{},"outcome":"PLAYER_WIN","tieBet":{},"payout":{}}}"#,
                            summary,
                            net_pnl,
                            resolved_entries,
                            player_card,
                            dealer_card,
                            state.tie_bet,
                            final_winnings
                        )];
                        Ok(GameResult::Win(final_winnings, logs))
                    } else if player_rank < dealer_rank {
                        // Dealer wins.
                        state.stage = Stage::Complete;
                        state.player_card = player_card;
                        state.dealer_card = dealer_card;
                        session.state_blob = serialize_state(&state);
                        session.is_complete = true;
                        let summary = format!(
                            "Deal: P {} D {}",
                            format_card_label(player_card),
                            format_card_label(dealer_card)
                        );
                        let mut resolved_entries = String::with_capacity(256);
                        let mut resolved_sum: i128 = 0;
                        let main_pnl = -(session.bet as i64);
                        push_resolved_entry(&mut resolved_entries, "MAIN", main_pnl);
                        resolved_sum = resolved_sum.saturating_add(i128::from(main_pnl));
                        if state.tie_bet > 0 {
                            let tie_pnl = -(state.tie_bet as i64);
                            push_resolved_entry(&mut resolved_entries, "TIE", tie_pnl);
                            resolved_sum = resolved_sum.saturating_add(i128::from(tie_pnl));
                        }
                        let net_pnl = clamp_i64(
                            -(i128::from(session.bet) + i128::from(state.tie_bet)),
                        );
                        let diff = i128::from(net_pnl).saturating_sub(resolved_sum);
                        if diff != 0 {
                            push_resolved_entry(&mut resolved_entries, "ADJUSTMENT", clamp_i64(diff));
                        }
                        let logs = vec![format!(
                            r#"{{"summary":"{}","netPnl":{},"resolvedBets":[{}],"stage":"DEAL","playerCard":{},"dealerCard":{},"outcome":"DEALER_WIN","tieBet":{},"payout":0}}"#,
                            summary,
                            net_pnl,
                            resolved_entries,
                            player_card,
                            dealer_card,
                            state.tie_bet
                        )];
                        Ok(GameResult::Loss(logs))
                    } else {
                        // Tie: offer war or surrender, and pay tie bet (if any) immediately.
                        state.stage = Stage::War;
                        state.player_card = player_card;
                        state.dealer_card = dealer_card;
                        session.state_blob = serialize_state(&state);

                        let summary = format!(
                            "Deal: P {} D {} (TIE)",
                            format_card_label(player_card),
                            format_card_label(dealer_card)
                        );
                        let mut resolved_entries = String::with_capacity(256);
                        let mut resolved_sum: i128 = 0;
                        if state.tie_bet > 0 {
                            let tie_pnl = clamp_i64(
                                i128::from(tie_bet_return) - i128::from(state.tie_bet),
                            );
                            push_resolved_entry(&mut resolved_entries, "TIE", tie_pnl);
                            resolved_sum = resolved_sum.saturating_add(i128::from(tie_pnl));
                        }
                        let net_pnl = clamp_i64(
                            i128::from(tie_bet_return) - i128::from(state.tie_bet),
                        );
                        let diff = i128::from(net_pnl).saturating_sub(resolved_sum);
                        if diff != 0 {
                            push_resolved_entry(&mut resolved_entries, "ADJUSTMENT", clamp_i64(diff));
                        }
                        let logs = vec![format!(
                            r#"{{"summary":"{}","netPnl":{},"resolvedBets":[{}],"stage":"DEAL","playerCard":{},"dealerCard":{},"outcome":"TIE","tieBet":{},"tieBetPayout":{}}}"#,
                            summary,
                            net_pnl,
                            resolved_entries,
                            player_card,
                            dealer_card,
                            state.tie_bet,
                            tie_bet_return
                        )];
                        if tie_bet_return != 0 {
                            Ok(GameResult::ContinueWithUpdate {
                                payout: tie_bet_return as i64,
                                logs,
                            })
                        } else {
                            Ok(GameResult::Continue(logs))
                        }
                    }
                }
                _ => {
                    // Check for atomic batch action (payload[0] == 4)
                    // [4, tie_bet: u64 BE]
                    if payload[0] == 4 {
                        if payload.len() != 9 {
                            return Err(GameError::InvalidPayload);
                        }

                        // Parse tie bet
                        let next_amount = u64::from_be_bytes(
                            payload[1..9]
                                .try_into()
                                .map_err(|_| GameError::InvalidPayload)?,
                        );
                        let next_amount = clamp_tie_bet_amount(next_amount);

                        // Apply tie bet
                        let prev_amount = state.tie_bet;
                        let tie_bet_payout = if next_amount >= prev_amount {
                            let delta = next_amount - prev_amount;
                            let delta_i64 =
                                i64::try_from(delta).map_err(|_| GameError::InvalidPayload)?;
                            -(delta_i64)
                        } else {
                            let delta = prev_amount - next_amount;
                            i64::try_from(delta).map_err(|_| GameError::InvalidPayload)?
                        };
                        state.tie_bet = next_amount;

                        // Deal one card each
                        let mut deck = rng.create_shoe(CASINO_WAR_DECKS);
                        let player_card = rng.draw_card(&mut deck).unwrap_or(0);
                        let dealer_card = rng.draw_card(&mut deck).unwrap_or(1);

                        let player_rank = cards::card_rank_ace_high(player_card);
                        let dealer_rank = cards::card_rank_ace_high(dealer_card);

                        // Tie bet pays on initial tie only
                        let tie_bet_return: i64 = if state.tie_bet > 0 && player_rank == dealer_rank {
                            let credited = state
                                .tie_bet
                                .saturating_mul(state.rules.tie_bet_multiplier().saturating_add(1));
                            i64::try_from(credited).map_err(|_| GameError::InvalidPayload)?
                        } else {
                            0
                        };

                        state.player_card = player_card;
                        state.dealer_card = dealer_card;

                        // Total payout is tie bet placement delta + tie bet winnings
                        let total_payout = tie_bet_payout.saturating_add(tie_bet_return);

                        match player_rank.cmp(&dealer_rank) {
                            std::cmp::Ordering::Greater => {
                                // Player wins
                                let final_winnings = session.bet.saturating_mul(2);
                                state.stage = Stage::Complete;
                                session.state_blob = serialize_state(&state);
                                session.is_complete = true;
                                session.move_count += 1;

                                let base_payout = final_winnings;
                                let final_payout = if session.super_mode.is_active {
                                    apply_super_multiplier_cards(
                                        &[player_card, dealer_card],
                                        &session.super_mode.multipliers,
                                        base_payout,
                                    )
                                } else {
                                    base_payout
                                };

                                let summary = format!(
                                    "Deal: P {} D {}",
                                    format_card_label(player_card),
                                    format_card_label(dealer_card)
                                );
                                let mut resolved_entries = String::with_capacity(256);
                                let mut resolved_sum: i128 = 0;
                                let main_pnl =
                                    clamp_i64(i128::from(base_payout) - i128::from(session.bet));
                                push_resolved_entry(&mut resolved_entries, "MAIN", main_pnl);
                                resolved_sum = resolved_sum.saturating_add(i128::from(main_pnl));
                                if state.tie_bet > 0 {
                                    let tie_pnl = -(state.tie_bet as i64);
                                    push_resolved_entry(&mut resolved_entries, "TIE", tie_pnl);
                                    resolved_sum = resolved_sum.saturating_add(i128::from(tie_pnl));
                                }
                                let net_pnl = clamp_i64(
                                    i128::from(final_payout)
                                        .saturating_sub(i128::from(session.bet))
                                        .saturating_sub(i128::from(state.tie_bet)),
                                );
                                let diff = i128::from(net_pnl).saturating_sub(resolved_sum);
                                if diff != 0 {
                                    push_resolved_entry(
                                        &mut resolved_entries,
                                        "ADJUSTMENT",
                                        clamp_i64(diff),
                                    );
                                }
                                let logs = vec![format!(
                                    r#"{{"summary":"{}","netPnl":{},"resolvedBets":[{}],"stage":"DEAL","playerCard":{},"dealerCard":{},"outcome":"PLAYER_WIN","tieBet":{},"payout":{}}}"#,
                                    summary,
                                    net_pnl,
                                    resolved_entries,
                                    player_card,
                                    dealer_card,
                                    state.tie_bet,
                                    final_payout
                                )];
                                if total_payout != 0 {
                                    Ok(GameResult::ContinueWithUpdate {
                                        payout: total_payout + final_payout as i64,
                                        logs,
                                    })
                                } else {
                                    Ok(GameResult::Win(final_payout, logs))
                                }
                            }
                            std::cmp::Ordering::Less => {
                                // Dealer wins - player loses ante (already deducted)
                                state.stage = Stage::Complete;
                                session.state_blob = serialize_state(&state);
                                session.is_complete = true;
                                session.move_count += 1;

                                let summary = format!(
                                    "Deal: P {} D {}",
                                    format_card_label(player_card),
                                    format_card_label(dealer_card)
                                );
                                let mut resolved_entries = String::with_capacity(256);
                                let mut resolved_sum: i128 = 0;
                                let main_pnl = -(session.bet as i64);
                                push_resolved_entry(&mut resolved_entries, "MAIN", main_pnl);
                                resolved_sum = resolved_sum.saturating_add(i128::from(main_pnl));
                                if state.tie_bet > 0 {
                                    let tie_pnl = -(state.tie_bet as i64);
                                    push_resolved_entry(&mut resolved_entries, "TIE", tie_pnl);
                                    resolved_sum = resolved_sum.saturating_add(i128::from(tie_pnl));
                                }
                                let net_pnl = clamp_i64(
                                    -(i128::from(session.bet) + i128::from(state.tie_bet)),
                                );
                                let diff = i128::from(net_pnl).saturating_sub(resolved_sum);
                                if diff != 0 {
                                    push_resolved_entry(&mut resolved_entries, "ADJUSTMENT", clamp_i64(diff));
                                }
                                let logs = vec![format!(
                                    r#"{{"summary":"{}","netPnl":{},"resolvedBets":[{}],"stage":"DEAL","playerCard":{},"dealerCard":{},"outcome":"DEALER_WIN","tieBet":{},"payout":0}}"#,
                                    summary,
                                    net_pnl,
                                    resolved_entries,
                                    player_card,
                                    dealer_card,
                                    state.tie_bet
                                )];
                                if total_payout != 0 {
                                    Ok(GameResult::ContinueWithUpdate {
                                        payout: total_payout,
                                        logs,
                                    })
                                } else {
                                    Ok(GameResult::Loss(logs))
                                }
                            }
                            std::cmp::Ordering::Equal => {
                                // Tie - player must go to war or surrender
                                state.stage = Stage::War;
                                session.state_blob = serialize_state(&state);
                                session.move_count += 1;

                                let summary = format!(
                                    "Deal: P {} D {} (TIE)",
                                    format_card_label(player_card),
                                    format_card_label(dealer_card)
                                );
                                let mut resolved_entries = String::with_capacity(256);
                                let mut resolved_sum: i128 = 0;
                                if state.tie_bet > 0 {
                                    let tie_pnl = clamp_i64(
                                        i128::from(tie_bet_return) - i128::from(state.tie_bet),
                                    );
                                    push_resolved_entry(&mut resolved_entries, "TIE", tie_pnl);
                                    resolved_sum = resolved_sum.saturating_add(i128::from(tie_pnl));
                                }
                                let net_pnl = clamp_i64(
                                    i128::from(tie_bet_return) - i128::from(state.tie_bet),
                                );
                                let diff = i128::from(net_pnl).saturating_sub(resolved_sum);
                                if diff != 0 {
                                    push_resolved_entry(&mut resolved_entries, "ADJUSTMENT", clamp_i64(diff));
                                }
                                let logs = vec![format!(
                                    r#"{{"summary":"{}","netPnl":{},"resolvedBets":[{}],"stage":"DEAL","playerCard":{},"dealerCard":{},"outcome":"TIE","tieBet":{},"tieBetPayout":{}}}"#,
                                    summary,
                                    net_pnl,
                                    resolved_entries,
                                    player_card,
                                    dealer_card,
                                    state.tie_bet,
                                    tie_bet_return
                                )];
                                if total_payout != 0 {
                                    Ok(GameResult::ContinueWithUpdate {
                                        payout: total_payout,
                                        logs,
                                    })
                                } else {
                                    Ok(GameResult::Continue(logs))
                                }
                            }
                        }
                    } else {
                        Err(GameError::InvalidMove)
                    }
                }
            },
            Stage::War => match mv {
                Move::Surrender => {
                    state.stage = Stage::Complete;
                    session.state_blob = serialize_state(&state);
                    session.is_complete = true;
                    // CasinoStartGame already deducted the ante, so refund half to realize a
                    // half-loss outcome.
                    let refund = session.bet / 2;
                    let summary = format!(
                        "Surrender: P {} D {}",
                        format_card_label(state.player_card),
                        format_card_label(state.dealer_card)
                    );
                    let tie_bet_return = if state.tie_bet > 0 {
                        let credited = state
                            .tie_bet
                            .saturating_mul(state.rules.tie_bet_multiplier().saturating_add(1));
                        i64::try_from(credited).unwrap_or(0)
                    } else {
                        0
                    };
                    let mut resolved_entries = String::with_capacity(256);
                    let mut resolved_sum: i128 = 0;
                    let main_pnl = clamp_i64(i128::from(refund) - i128::from(session.bet));
                    push_resolved_entry(&mut resolved_entries, "MAIN", main_pnl);
                    resolved_sum = resolved_sum.saturating_add(i128::from(main_pnl));
                    if state.tie_bet > 0 {
                        let tie_pnl = clamp_i64(
                            i128::from(tie_bet_return) - i128::from(state.tie_bet),
                        );
                        push_resolved_entry(&mut resolved_entries, "TIE", tie_pnl);
                        resolved_sum = resolved_sum.saturating_add(i128::from(tie_pnl));
                    }
                    let net_pnl = clamp_i64(
                        i128::from(refund)
                            .saturating_sub(i128::from(session.bet))
                            .saturating_sub(i128::from(state.tie_bet))
                            .saturating_add(i128::from(tie_bet_return)),
                    );
                    let diff = i128::from(net_pnl).saturating_sub(resolved_sum);
                    if diff != 0 {
                        push_resolved_entry(&mut resolved_entries, "ADJUSTMENT", clamp_i64(diff));
                    }
                    let logs = vec![format!(
                        r#"{{"summary":"{}","netPnl":{},"resolvedBets":[{}],"stage":"SURRENDER","playerCard":{},"dealerCard":{},"outcome":"SURRENDER","payout":{}}}"#,
                        summary,
                        net_pnl,
                        resolved_entries,
                        state.player_card,
                        state.dealer_card,
                        refund
                    )];
                    Ok(GameResult::Win(refund, logs))
                }
                Move::War => {
                    let war_bet = session.bet;
                    let original_player_card = state.player_card;
                    let original_dealer_card = state.dealer_card;

                    // Burn 3 cards, then deal new cards.
                    let mut deck = rng.create_shoe_excluding(
                        &[state.player_card, state.dealer_card],
                        CASINO_WAR_DECKS,
                    );
                    for _ in 0..3 {
                        rng.draw_card(&mut deck);
                    }

                    let new_player_card =
                        rng.draw_card(&mut deck).ok_or(GameError::InvalidMove)?;
                    let new_dealer_card =
                        rng.draw_card(&mut deck).ok_or(GameError::InvalidMove)?;

                    let new_player_rank = cards::card_rank_ace_high(new_player_card);
                    let new_dealer_rank = cards::card_rank_ace_high(new_dealer_card);

                    state.stage = Stage::Complete;
                    state.player_card = new_player_card;
                    state.dealer_card = new_dealer_card;
                    session.state_blob = serialize_state(&state);
                    session.is_complete = true;

                    let tie_bet_return = if state.tie_bet > 0 {
                        let credited = state
                            .tie_bet
                            .saturating_mul(state.rules.tie_bet_multiplier().saturating_add(1));
                        i64::try_from(credited).unwrap_or(0)
                    } else {
                        0
                    };

                    if new_player_rank >= new_dealer_rank {
                        // WoO "bonus" variant: tie-after-tie awards a bonus equal to the ante.
                        // https://wizardofodds.com/games/casino-war/
                        //
                        // Note: We model the raise as a contingent loss (`LossWithExtraDeduction`)
                        // instead of a pre-deducted bet, so we express the bonus via the credited return.
                        let is_tie_after_tie = new_player_rank == new_dealer_rank;
                        let bonus = if is_tie_after_tie && state.rules.tie_after_tie_bonus {
                            session.bet
                        } else {
                            0
                        };
                        let base_winnings = session.bet.saturating_mul(2).saturating_add(bonus);
                        let final_winnings = if session.super_mode.is_active {
                            apply_super_multiplier_cards(
                                &[new_player_card],
                                &session.super_mode.multipliers,
                                base_winnings,
                            )
                        } else {
                            base_winnings
                        };
                        let outcome = if is_tie_after_tie { "TIE_AFTER_TIE" } else { "PLAYER_WIN" };
                        let summary = format!(
                            "War: P {} D {}",
                            format_card_label(new_player_card),
                            format_card_label(new_dealer_card)
                        );
                        let mut resolved_entries = String::with_capacity(256);
                        let mut resolved_sum: i128 = 0;
                        let main_pnl =
                            clamp_i64(i128::from(base_winnings) - i128::from(session.bet));
                        push_resolved_entry(&mut resolved_entries, "MAIN", main_pnl);
                        resolved_sum = resolved_sum.saturating_add(i128::from(main_pnl));
                        if state.tie_bet > 0 {
                            let tie_pnl = clamp_i64(
                                i128::from(tie_bet_return) - i128::from(state.tie_bet),
                            );
                            push_resolved_entry(&mut resolved_entries, "TIE", tie_pnl);
                            resolved_sum = resolved_sum.saturating_add(i128::from(tie_pnl));
                        }
                        let net_pnl = clamp_i64(
                            i128::from(final_winnings)
                                .saturating_sub(i128::from(session.bet))
                                .saturating_sub(i128::from(state.tie_bet))
                                .saturating_add(i128::from(tie_bet_return)),
                        );
                        let diff = i128::from(net_pnl).saturating_sub(resolved_sum);
                        if diff != 0 {
                            push_resolved_entry(&mut resolved_entries, "ADJUSTMENT", clamp_i64(diff));
                        }
                        let logs = vec![format!(
                            r#"{{"summary":"{}","netPnl":{},"resolvedBets":[{}],"stage":"WAR","originalPlayerCard":{},"originalDealerCard":{},"warPlayerCard":{},"warDealerCard":{},"outcome":"{}","payout":{}}}"#,
                            summary,
                            net_pnl,
                            resolved_entries,
                            original_player_card,
                            original_dealer_card,
                            new_player_card,
                            new_dealer_card,
                            outcome,
                            final_winnings
                        )];
                        Ok(GameResult::Win(final_winnings, logs))
                    } else {
                        // Lose both bets (ante + war bet).
                        let summary = format!(
                            "War: P {} D {}",
                            format_card_label(new_player_card),
                            format_card_label(new_dealer_card)
                        );
                        let mut resolved_entries = String::with_capacity(256);
                        let mut resolved_sum: i128 = 0;
                        let main_pnl = -(session.bet as i64);
                        let war_pnl = -(war_bet as i64);
                        push_resolved_entry(&mut resolved_entries, "MAIN", main_pnl);
                        push_resolved_entry(&mut resolved_entries, "WAR", war_pnl);
                        resolved_sum = resolved_sum
                            .saturating_add(i128::from(main_pnl))
                            .saturating_add(i128::from(war_pnl));
                        if state.tie_bet > 0 {
                            let tie_pnl = clamp_i64(
                                i128::from(tie_bet_return) - i128::from(state.tie_bet),
                            );
                            push_resolved_entry(&mut resolved_entries, "TIE", tie_pnl);
                            resolved_sum = resolved_sum.saturating_add(i128::from(tie_pnl));
                        }
                        let net_pnl = clamp_i64(
                            -(i128::from(session.bet)
                                + i128::from(war_bet)
                                + i128::from(state.tie_bet))
                                .saturating_add(i128::from(tie_bet_return)),
                        );
                        let diff = i128::from(net_pnl).saturating_sub(resolved_sum);
                        if diff != 0 {
                            push_resolved_entry(&mut resolved_entries, "ADJUSTMENT", clamp_i64(diff));
                        }
                        let logs = vec![format!(
                            r#"{{"summary":"{}","netPnl":{},"resolvedBets":[{}],"stage":"WAR","originalPlayerCard":{},"originalDealerCard":{},"warPlayerCard":{},"warDealerCard":{},"outcome":"DEALER_WIN","payout":0}}"#,
                            summary,
                            net_pnl,
                            resolved_entries,
                            original_player_card,
                            original_dealer_card,
                            new_player_card,
                            new_dealer_card
                        )];
                        Ok(GameResult::LossWithExtraDeduction(war_bet, logs))
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
            game_type: GameType::CasinoWar,
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
    fn test_init_starts_in_betting_stage() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        CasinoWar::init(&mut session, &mut rng);

        let state = parse_state(&session.state_blob).expect("Failed to parse state");
        assert_eq!(state.stage, Stage::Betting);
        assert_eq!(state.player_card, HIDDEN_CARD);
        assert_eq!(state.dealer_card, HIDDEN_CARD);
        assert_eq!(state.tie_bet, 0);
    }

    #[test]
    fn test_set_tie_bet_updates_state() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        CasinoWar::init(&mut session, &mut rng);

        let mut payload = vec![3];
        payload.extend_from_slice(&10u64.to_be_bytes());
        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = CasinoWar::process_move(&mut session, &payload, &mut rng);
        assert!(matches!(
            result,
            Ok(GameResult::ContinueWithUpdate { payout: -10, .. })
        ));

        let state = parse_state(&session.state_blob).expect("Failed to parse state");
        assert_eq!(state.tie_bet, 10);
        assert_eq!(state.stage, Stage::Betting);
    }

    #[test]
    fn test_tie_bet_pays_on_tie() {
        let seed = create_test_seed();

        // Find a session that produces an initial tie.
        for session_id in 1..300 {
            let mut session = create_test_session(100);
            session.id = session_id;
            let mut rng = GameRng::new(&seed, session.id, 0);
            CasinoWar::init(&mut session, &mut rng);

            // Set tie bet to 10.
            let mut payload = vec![3];
            payload.extend_from_slice(&10u64.to_be_bytes());
            let mut rng = GameRng::new(&seed, session.id, 1);
            CasinoWar::process_move(&mut session, &payload, &mut rng).expect("set tie bet");

            // Deal + compare.
            let mut rng = GameRng::new(&seed, session.id, 2);
            let result = CasinoWar::process_move(&mut session, &[0], &mut rng);

            if matches!(result, Ok(GameResult::ContinueWithUpdate { payout: 110, .. })) {
                let state = parse_state(&session.state_blob).expect("Failed to parse state");
                assert_eq!(state.stage, Stage::War);
                assert!(state.player_card < 52);
                assert!(state.dealer_card < 52);
                assert_eq!(
                    cards::card_rank_ace_high(state.player_card),
                    cards::card_rank_ace_high(state.dealer_card)
                );
                return;
            }
        }

        panic!("failed to find a tie in 300 trials");
    }

    #[test]
    fn test_surrender_refunds_half_bet() -> Result<(), GameError> {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let state = CasinoWarState {
            player_card: 12,
            dealer_card: 25,
            stage: Stage::War,
            tie_bet: 0,
            rules: CasinoWarRules::default(),
        };
        session.state_blob = serialize_state(&state);

        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = CasinoWar::process_move(&mut session, &[Move::Surrender as u8], &mut rng)?;

        assert!(matches!(result, GameResult::Win(50, _)));
        assert!(session.is_complete);
        let parsed = parse_state(&session.state_blob).expect("parse state");
        assert_eq!(parsed.stage, Stage::Complete);
        Ok(())
    }

    #[test]
    fn test_tie_after_tie_awards_bonus() {
        let seed = create_test_seed();

        // Find a session that produces a tie and then a tie-after-tie.
        for session_id in 1..10_000 {
            let mut session = create_test_session(100);
            session.id = session_id;
            let mut rng = GameRng::new(&seed, session.id, 0);
            CasinoWar::init(&mut session, &mut rng);

            // Deal + compare.
            let mut rng = GameRng::new(&seed, session.id, 1);
            let _ = CasinoWar::process_move(&mut session, &[0], &mut rng).expect("deal");

            let state = parse_state(&session.state_blob).expect("parse state");
            if state.stage != Stage::War {
                continue;
            }

            // Go to war.
            let mut rng = GameRng::new(&seed, session.id, 2);
            let result = CasinoWar::process_move(&mut session, &[1], &mut rng).expect("war");

            let final_state = parse_state(&session.state_blob).expect("parse final state");
            assert_eq!(final_state.stage, Stage::Complete);

            if cards::card_rank_ace_high(final_state.player_card)
                == cards::card_rank_ace_high(final_state.dealer_card)
            {
                // Bonus is equal to the ante, so the win credits 3x the ante in our model.
        assert!(matches!(result, GameResult::Win(300, _)));
                return;
            }
        }

        panic!("failed to find a tie-after-tie in 10,000 trials");
    }

    #[test]
    fn test_state_blob_fuzz_does_not_panic() {
        let mut rng = StdRng::seed_from_u64(0x5eed_cafe);
        for _ in 0..1_000 {
            let len = rng.gen_range(0..=128);
            let mut blob = vec![0u8; len];
            rng.fill(&mut blob[..]);
            let _ = parse_state(&blob);
        }
    }
}
