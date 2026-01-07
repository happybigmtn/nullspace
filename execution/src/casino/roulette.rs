//! Roulette game implementation with multi-bet support.
//!
//! State blob format:
//! [bet_count:u8]
//! [zero_rule:u8]                 (0=Standard, 1=La Partage, 2=En Prison, 3=En Prison (Double), 4=American)
//! [phase:u8]                     (0=Betting, 1=Prison)
//! [totalWagered:u64 BE]          (sum of all placed bet amounts)
//! [pendingReturn:u64 BE]         (credited return accumulated before completion; used by En Prison)
//! [bets:RouletteBet×count]
//! [result:u8]?                   (last spin result, if any)
//!
//! Each RouletteBet (10 bytes):
//! [bet_type:u8] [number:u8] [amount:u64 BE]
//!
//! Payload format:
//! [0, bet_type, number, amount_bytes...] - Place bet (adds to pending bets)
//! [1] - Spin wheel and resolve all bets
//! [2] - Clear all pending bets (with refund)
//! [3, zero_rule] - Set zero rule / wheel (0-3 European, 4 American)
//! [4, bet_count, bets...] - Atomic batch: place all bets + spin in one transaction
//!                          Each bet is 10 bytes: [bet_type:u8, number:u8, amount:u64 BE]
//!                          Uses standard zero rule (no En Prison in atomic batch)
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
//! 9 = SplitH (2 numbers in same row, 17:1) - number = left number (1-35, not multiple of 3)
//! 10 = SplitV (2 numbers in same column, 17:1) - number = top number (1-33)
//! 11 = Street (3 numbers in a row, 11:1) - number = row start (1,4,...,34)
//! 12 = Corner (4-number corner, 8:1) - number = top-left (1-32, not multiple of 3)
//! 13 = SixLine (6 numbers, 5:1) - number = row start (1,4,...,31)

use super::logging::{clamp_i64, push_resolved_entry};
use super::serialization::{StateReader, StateWriter};
use super::super_mode::apply_super_multiplier_number;
use super::{limits, CasinoGame, GameError, GameResult, GameRng};
use nullspace_types::casino::GameSession;
use std::fmt::Write;

/// Payout multipliers for Roulette (expressed as "to 1" winnings).
mod payouts {
    pub const STRAIGHT: u64 = 35;
    pub const EVEN_MONEY: u64 = 1; // Red, Black, Even, Odd, Low, High
    pub const DOZEN: u64 = 2;
    pub const COLUMN: u64 = 2;
    pub const SPLIT: u64 = 17;
    pub const STREET: u64 = 11;
    pub const CORNER: u64 = 8;
    pub const SIX_LINE: u64 = 5;
}

/// State header length: bet_count(1) + zero_rule(1) + phase(1) + totalWagered(8) + pendingReturn(8).
const STATE_HEADER_V2_LEN: usize = 19;
const BET_BYTES: usize = 10;

/// Red numbers on a roulette wheel.
const RED_NUMBERS: [u8; 18] = [
    1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
];
const DOUBLE_ZERO: u8 = 37;

fn is_zero_result(zero_rule: ZeroRule, result: u8) -> bool {
    match zero_rule {
        ZeroRule::American => result == 0 || result == DOUBLE_ZERO,
        _ => result == 0,
    }
}

fn spin_result(rng: &mut GameRng, zero_rule: ZeroRule) -> u8 {
    if matches!(zero_rule, ZeroRule::American) {
        rng.next_bounded(38)
    } else {
        rng.spin_roulette()
    }
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ZeroRule {
    Standard = 0,
    LaPartage = 1,
    EnPrison = 2,
    EnPrisonDouble = 3,
    American = 4,
}

impl TryFrom<u8> for ZeroRule {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(ZeroRule::Standard),
            1 => Ok(ZeroRule::LaPartage),
            2 => Ok(ZeroRule::EnPrison),
            3 => Ok(ZeroRule::EnPrisonDouble),
            4 => Ok(ZeroRule::American),
            _ => Err(GameError::InvalidPayload),
        }
    }
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Betting = 0,
    Prison = 1,
}

impl TryFrom<u8> for Phase {
    type Error = GameError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Phase::Betting),
            1 => Ok(Phase::Prison),
            _ => Err(GameError::InvalidPayload),
        }
    }
}

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
    SplitH = 9,   // Horizontal split (17:1) - number is left cell in row
    SplitV = 10,  // Vertical split (17:1) - number is top cell in column
    Street = 11,  // 3-number row (11:1) - number is row start
    Corner = 12,  // 4-number corner (8:1) - number is top-left cell
    SixLine = 13, // 6-number (5:1) - number is row start of top row
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
            9 => Ok(BetType::SplitH),
            10 => Ok(BetType::SplitV),
            11 => Ok(BetType::Street),
            12 => Ok(BetType::Corner),
            13 => Ok(BetType::SixLine),
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
    // Zero loses all except straight bet on the matching zero (0 or 00).
    if result == 0 || result == DOUBLE_ZERO {
        return bet_type == BetType::Straight && bet_number == result;
    }

    match bet_type {
        BetType::Straight => bet_number == result,
        BetType::Red => is_red(result),
        BetType::Black => !is_red(result),
        BetType::Even => result % 2 == 0,
        BetType::Odd => result % 2 == 1,
        BetType::Low => (1..=18).contains(&result),
        BetType::High => (19..=36).contains(&result),
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
        BetType::SplitH => result == bet_number || result == bet_number.saturating_add(1),
        BetType::SplitV => result == bet_number || result == bet_number.saturating_add(3),
        BetType::Street => {
            result == bet_number
                || result == bet_number.saturating_add(1)
                || result == bet_number.saturating_add(2)
        }
        BetType::Corner => {
            result == bet_number
                || result == bet_number.saturating_add(1)
                || result == bet_number.saturating_add(3)
                || result == bet_number.saturating_add(4)
        }
        BetType::SixLine => result >= bet_number && result <= bet_number.saturating_add(5),
    }
}

/// Get the payout multiplier for a bet type (excludes original bet).
fn payout_multiplier(bet_type: BetType) -> u64 {
    match bet_type {
        BetType::Straight => payouts::STRAIGHT,
        BetType::Red
        | BetType::Black
        | BetType::Even
        | BetType::Odd
        | BetType::Low
        | BetType::High => payouts::EVEN_MONEY,
        BetType::Dozen => payouts::DOZEN,
        BetType::Column => payouts::COLUMN,
        BetType::SplitH | BetType::SplitV => payouts::SPLIT,
        BetType::Street => payouts::STREET,
        BetType::Corner => payouts::CORNER,
        BetType::SixLine => payouts::SIX_LINE,
    }
}

fn is_even_money_bet(bet_type: BetType) -> bool {
    matches!(
        bet_type,
        BetType::Red | BetType::Black | BetType::Even | BetType::Odd | BetType::Low | BetType::High
    )
}

fn is_valid_bet_number(bet_type: BetType, number: u8, zero_rule: ZeroRule) -> bool {
    match bet_type {
        BetType::Straight => {
            let max_straight = if matches!(zero_rule, ZeroRule::American) {
                DOUBLE_ZERO
            } else {
                36
            };
            number <= max_straight
        }
        BetType::Dozen | BetType::Column => number <= 2,
        BetType::SplitH => (1..=35).contains(&number) && number % 3 != 0,
        BetType::SplitV => (1..=33).contains(&number),
        BetType::Street => {
            (1..=34).contains(&number) && (number - 1) % 3 == 0
        }
        BetType::Corner => (1..=32).contains(&number) && number % 3 != 0,
        BetType::SixLine => {
            (1..=31).contains(&number) && (number - 1) % 3 == 0
        }
        _ => true,
    }
}

/// Individual bet in roulette.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RouletteBet {
    pub bet_type: BetType,
    pub number: u8,
    pub amount: u64,
}

impl RouletteBet {
    /// Serialize to 10 bytes: [bet_type:u8] [number:u8] [amount:u64 BE]
    fn to_bytes(&self) -> [u8; 10] {
        let mut bytes = [0u8; 10];
        bytes[0] = self.bet_type as u8;
        bytes[1] = self.number;
        bytes[2..10].copy_from_slice(&self.amount.to_be_bytes());
        bytes
    }

    /// Deserialize from 10 bytes
    fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < 10 {
            return None;
        }
        let bet_type = BetType::try_from(bytes[0]).ok()?;
        let number = bytes[1];
        let amount = u64::from_be_bytes(bytes[2..10].try_into().ok()?);
        if amount == 0 {
            return None;
        }
        Some(RouletteBet {
            bet_type,
            number,
            amount,
        })
    }
}

/// Game state for multi-bet roulette.
struct RouletteState {
    zero_rule: ZeroRule,
    phase: Phase,
    total_wagered: u64,
    pending_return: u64,
    bets: Vec<RouletteBet>,
    result: Option<u8>,
}

impl RouletteState {
    fn new() -> Self {
        RouletteState {
            zero_rule: ZeroRule::Standard,
            phase: Phase::Betting,
            total_wagered: 0,
            pending_return: 0,
            bets: Vec::new(),
            result: None,
        }
    }

    /// Serialize state to blob
    fn to_blob(&self) -> Vec<u8> {
        // Capacity: header + bets (10 bytes each) + 1 (optional result)
        let capacity = STATE_HEADER_V2_LEN
            + (self.bets.len() * BET_BYTES)
            + if self.result.is_some() { 1 } else { 0 };
        let mut blob = StateWriter::with_capacity(capacity);
        blob.push_u8(self.bets.len() as u8);
        blob.push_u8(self.zero_rule as u8);
        blob.push_u8(self.phase as u8);
        blob.push_u64_be(self.total_wagered);
        blob.push_u64_be(self.pending_return);
        for bet in &self.bets {
            blob.push_bytes(&bet.to_bytes());
        }
        if let Some(result) = self.result {
            blob.push_u8(result);
        }
        blob.into_inner()
    }

    /// Deserialize state from blob.
    ///
    /// Format: STATE_HEADER_V2_LEN(19) bytes header + bets + optional result.
    /// Header: [bet_count:u8][zero_rule:u8][phase:u8][totalWagered:u64 BE][pendingReturn:u64 BE]
    fn from_blob(blob: &[u8]) -> Option<Self> {
        if blob.is_empty() {
            return Some(RouletteState::new());
        }

        // Validate minimum header length
        if blob.len() < STATE_HEADER_V2_LEN {
            return None;
        }

        let mut reader = StateReader::new(blob);
        let bet_count = reader.read_u8()? as usize;
        if bet_count > limits::ROULETTE_MAX_BETS {
            return None;
        }

        // Parse header
        let zero_rule = ZeroRule::try_from(reader.read_u8()?).ok()?;
        let phase = Phase::try_from(reader.read_u8()?).ok()?;
        let total_wagered = reader.read_u64_be()?;
        let pending_return = reader.read_u64_be()?;

        // Parse bets
        let mut bets = Vec::with_capacity(bet_count);
        for _ in 0..bet_count {
            let bet = RouletteBet::from_bytes(reader.read_bytes(BET_BYTES)?)?;
            if !is_valid_bet_number(bet.bet_type, bet.number, zero_rule) {
                return None;
            }
            bets.push(bet);
        }

        // Parse optional result
        let result = if reader.remaining() > 0 {
            if reader.remaining() != 1 {
                return None;
            }
            let result = reader.read_u8()?;
            let max_result = if matches!(zero_rule, ZeroRule::American) {
                DOUBLE_ZERO
            } else {
                36
            };
            if result > max_result {
                return None;
            }
            Some(result)
        } else {
            None
        };

        Some(RouletteState {
            zero_rule,
            phase,
            total_wagered,
            pending_return,
            bets,
            result,
        })
    }
}

fn serialize_state(state: &RouletteState) -> Vec<u8> {
    state.to_blob()
}

fn parse_state(blob: &[u8]) -> Option<RouletteState> {
    RouletteState::from_blob(blob)
}

/// Generate JSON logs for roulette game completion
fn generate_roulette_logs(
    state: &RouletteState,
    result: u8,
    total_return: u64,
) -> Vec<String> {
    let display_number = if result == DOUBLE_ZERO {
        "00".to_string()
    } else {
        result.to_string()
    };

    // Build bet results array
    let bet_capacity = state.bets.len().saturating_mul(96);
    let resolved_capacity = state.bets.len().saturating_mul(48).saturating_add(32);
    let mut bet_results = String::with_capacity(bet_capacity);
    let mut resolved_bets = String::with_capacity(resolved_capacity);
    let mut resolved_sum: i128 = 0;
    for (idx, bet) in state.bets.iter().enumerate() {
        if idx > 0 {
            bet_results.push(',');
        }
        let wins = bet_wins(bet.bet_type, bet.number, result);
        let bet_type_str = match bet.bet_type {
            BetType::Straight => "STRAIGHT",
            BetType::Red => "RED",
            BetType::Black => "BLACK",
            BetType::Even => "EVEN",
            BetType::Odd => "ODD",
            BetType::Low => "LOW",
            BetType::High => "HIGH",
            BetType::Dozen => "DOZEN",
            BetType::Column => "COLUMN",
            BetType::SplitH => "SPLIT_H",
            BetType::SplitV => "SPLIT_V",
            BetType::Street => "STREET",
            BetType::Corner => "CORNER",
            BetType::SixLine => "SIX_LINE",
        };
        let label = match bet.bet_type {
            BetType::Dozen => format!("DOZEN_{}", bet.number.saturating_add(1)),
            BetType::Column => format!("COL_{}", bet.number.saturating_add(1)),
            BetType::Straight
            | BetType::SplitH
            | BetType::SplitV
            | BetType::Street
            | BetType::Corner
            | BetType::SixLine => format!("{} {}", bet_type_str, bet.number),
            _ => bet_type_str.to_string(),
        };
        let bet_return = match state.phase {
            Phase::Prison => {
                if is_zero_result(state.zero_rule, result) {
                    0
                } else if wins {
                    bet.amount
                } else {
                    0
                }
            }
            Phase::Betting => {
                if wins {
                    let multiplier = payout_multiplier(bet.bet_type).saturating_add(1);
                    bet.amount.saturating_mul(multiplier)
                } else if is_zero_result(state.zero_rule, result)
                    && state.zero_rule == ZeroRule::LaPartage
                    && is_even_money_bet(bet.bet_type)
                {
                    bet.amount / 2
                } else {
                    0
                }
            }
        };
        let pnl = clamp_i64(i128::from(bet_return) - i128::from(bet.amount));
        resolved_sum = resolved_sum.saturating_add(i128::from(pnl));
        push_resolved_entry(&mut resolved_bets, &label, pnl);
        let _ = write!(
            bet_results,
            r#"{{"type":"{}","number":{},"amount":{},"won":{}}}"#,
            bet_type_str, bet.number, bet.amount, wins
        );
    }

    let color = if is_zero_result(state.zero_rule, result) {
        "GREEN"
    } else if is_red(result) {
        "RED"
    } else {
        "BLACK"
    };

    let summary = format!("Roll: {} {}", display_number, color);
    let net_pnl = clamp_i64(i128::from(total_return) - i128::from(state.total_wagered));
    let diff = i128::from(net_pnl).saturating_sub(resolved_sum);
    if diff != 0 {
        push_resolved_entry(&mut resolved_bets, "ADJUSTMENT", clamp_i64(diff));
    }

    vec![format!(
        r#"{{"summary":"{}","netPnl":{},"resolvedBets":[{}],"result":{},"color":"{}","bets":[{}],"totalWagered":{},"totalReturn":{}}}"#,
        summary,
        net_pnl,
        resolved_bets,
        result,
        color,
        bet_results,
        state.total_wagered,
        total_return
    )]
}

pub struct Roulette;

impl CasinoGame for Roulette {
    fn init(session: &mut GameSession, _rng: &mut GameRng) -> GameResult {
        // Initialize with empty state
        let state = RouletteState::new();
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

        // Parse current state
        let mut state =
            parse_state(&session.state_blob).ok_or(GameError::InvalidPayload)?;

        match payload[0] {
            // [0, bet_type, number, amount_bytes...] - Place bet
            0 => {
                let (bet_type, number, amount) = super::payload::parse_place_bet_payload(payload)?;

                // Bets can only be placed before the first spin.
                if state.phase != Phase::Betting || state.result.is_some() {
                    return Err(GameError::InvalidMove);
                }

                let bet_type = BetType::try_from(bet_type)?;
                super::payload::ensure_nonzero_amount(amount)?;

                if !is_valid_bet_number(bet_type, number, state.zero_rule) {
                    return Err(GameError::InvalidPayload);
                }

                // Check max bets limit
                if state.bets.len() >= limits::ROULETTE_MAX_BETS {
                    return Err(GameError::InvalidMove);
                }

                // Add bet (allow duplicates for roulette - bet on same spot multiple times)
                state.bets.push(RouletteBet {
                    bet_type,
                    number,
                    amount,
                });
                // Use checked_add to prevent overflow - reject bet if it would overflow
                // (otherwise player gets charged but wager total doesn't increase)
                state.total_wagered = state
                    .total_wagered
                    .checked_add(amount)
                    .ok_or(GameError::InvalidPayload)?;

                session.state_blob = serialize_state(&state);
                Ok(GameResult::ContinueWithUpdate {
                    payout: -(amount as i64),
                    logs: vec![],
                })
            }

            // [1] - Spin wheel and resolve all bets
            1 => {
                match state.phase {
                    Phase::Betting => {
                        // Must have at least one bet
                        if state.bets.is_empty() {
                            return Err(GameError::InvalidMove);
                        }

                        // Wheel already spun
                        if state.result.is_some() {
                            return Err(GameError::InvalidMove);
                        }

                        let result = spin_result(rng, state.zero_rule);
                        state.result = Some(result);

                        // Standard single-spin settlement unless En Prison triggers.
                        let mut total_return: u64 = 0;

                        if is_zero_result(state.zero_rule, result) {
                            match state.zero_rule {
                                ZeroRule::Standard | ZeroRule::American => {
                                    for bet in &state.bets {
                                        if bet_wins(bet.bet_type, bet.number, result) {
                                            let multiplier =
                                                payout_multiplier(bet.bet_type).saturating_add(1);
                                            total_return = total_return.saturating_add(
                                                bet.amount.saturating_mul(multiplier),
                                            );
                                        }
                                    }
                                }
                                ZeroRule::LaPartage => {
                                    for bet in &state.bets {
                                        if bet_wins(bet.bet_type, bet.number, result) {
                                            let multiplier =
                                                payout_multiplier(bet.bet_type).saturating_add(1);
                                            total_return = total_return.saturating_add(
                                                bet.amount.saturating_mul(multiplier),
                                            );
                                        } else if is_even_money_bet(bet.bet_type) {
                                            // Half-back on even-money bets.
                                            total_return =
                                                total_return.saturating_add(bet.amount / 2);
                                        }
                                    }
                                }
                                ZeroRule::EnPrison | ZeroRule::EnPrisonDouble => {
                                    let mut imprisoned =
                                        Vec::with_capacity(state.bets.len());
                                    let mut retained = Vec::with_capacity(state.bets.len());

                                    for bet in state.bets.drain(..) {
                                        let wins = bet_wins(bet.bet_type, bet.number, result);
                                        if wins {
                                            let multiplier =
                                                payout_multiplier(bet.bet_type).saturating_add(1);
                                            let mut ret = bet.amount.saturating_mul(multiplier);
                                            if session.super_mode.is_active && ret > 0 {
                                                ret = apply_super_multiplier_number(
                                                    result,
                                                    &session.super_mode.multipliers,
                                                    ret,
                                                );
                                            }
                                            state.pending_return =
                                                state.pending_return.saturating_add(ret);
                                        }

                                        if !wins && is_even_money_bet(bet.bet_type) {
                                            imprisoned.push(bet);
                                        } else {
                                            retained.push(bet);
                                        }
                                    }

                                    if imprisoned.is_empty() {
                                        state.bets = retained;
                                        total_return = state.pending_return;
                                    } else {
                                        state.bets = imprisoned;
                                        state.phase = Phase::Prison;

                                        session.state_blob = serialize_state(&state);
                                        session.move_count += 1;
                                        return Ok(GameResult::Continue(vec![]));
                                    }
                                }
                            }
                        } else {
                            for bet in &state.bets {
                                if bet_wins(bet.bet_type, bet.number, result) {
                                    let multiplier =
                                        payout_multiplier(bet.bet_type).saturating_add(1);
                                    total_return = total_return
                                        .saturating_add(bet.amount.saturating_mul(multiplier));
                                }
                            }
                        }

                        if session.super_mode.is_active && total_return > 0 {
                            // In En Prison on a zero result, pending_return already includes the super multiplier (if any).
                            if !(matches!(
                                state.zero_rule,
                                ZeroRule::EnPrison | ZeroRule::EnPrisonDouble
                            ) && is_zero_result(state.zero_rule, result))
                            {
                                total_return = apply_super_multiplier_number(
                                    result,
                                    &session.super_mode.multipliers,
                                    total_return,
                                );
                            }
                        }

                        session.state_blob = serialize_state(&state);
                        session.move_count += 1;
                        session.is_complete = true;

                        let logs = generate_roulette_logs(&state, result, total_return);
                        if total_return > 0 {
                            Ok(GameResult::Win(total_return, logs))
                        } else {
                            Ok(GameResult::LossPreDeducted(state.total_wagered, logs))
                        }
                    }
                    Phase::Prison => {
                        // Second spin to resolve imprisoned even-money bets.
                        if state.bets.is_empty() {
                            return Err(GameError::InvalidMove);
                        }

                        let result = spin_result(rng, state.zero_rule);
                        state.result = Some(result);

                        if is_zero_result(state.zero_rule, result)
                            && state.zero_rule == ZeroRule::EnPrisonDouble
                        {
                            // Double-imprisonment variant: a second 0 re-imprisons the bets.
                            session.state_blob = serialize_state(&state);
                            session.move_count += 1;
                            return Ok(GameResult::Continue(vec![]));
                        }

                        let mut push_return: u64 = 0;
                        if !is_zero_result(state.zero_rule, result) {
                            for bet in &state.bets {
                                if bet_wins(bet.bet_type, bet.number, result) {
                                    // Winning imprisoned bets push (stake returned, no winnings).
                                    push_return = push_return.saturating_add(bet.amount);
                                }
                            }
                        }

                        if session.super_mode.is_active && push_return > 0 {
                            push_return = apply_super_multiplier_number(
                                result,
                                &session.super_mode.multipliers,
                                push_return,
                            );
                        }

                        let total_return = state.pending_return.saturating_add(push_return);

                        session.state_blob = serialize_state(&state);
                        session.move_count += 1;
                        session.is_complete = true;

                        let logs = generate_roulette_logs(&state, result, total_return);
                        if total_return > 0 {
                            Ok(GameResult::Win(total_return, logs))
                        } else {
                            Ok(GameResult::LossPreDeducted(state.total_wagered, logs))
                        }
                    }
                }
            }

            // [2] - Clear all pending bets (with refund)
            2 => {
                // Can't clear after wheel spun or during En Prison.
                if state.phase != Phase::Betting || state.result.is_some() {
                    return Err(GameError::InvalidMove);
                }

                // Calculate total to refund (bets were deducted via ContinueWithUpdate)
                let refund = state.total_wagered;
                state.bets.clear();
                state.total_wagered = 0;
                session.state_blob = serialize_state(&state);

                if refund > 0 {
                    // Positive payout = credit chips back to player
                    Ok(GameResult::ContinueWithUpdate {
                        payout: refund as i64,
                        logs: vec![],
                    })
                } else {
                    Ok(GameResult::Continue(vec![]))
                }
            }

            // [3, zero_rule] - Set even-money-on-zero rule.
            3 => {
                if payload.len() != 2 {
                    return Err(GameError::InvalidPayload);
                }
                if state.phase != Phase::Betting || state.result.is_some() {
                    return Err(GameError::InvalidMove);
                }
                state.zero_rule = ZeroRule::try_from(payload[1])?;
                session.state_blob = serialize_state(&state);
                Ok(GameResult::Continue(vec![]))
            }

            // [4, bet_count, bets...] - Atomic batch: place all bets + spin in one transaction
            // Each bet is 10 bytes: [bet_type:u8, number:u8, amount:u64 BE]
            // This ensures all-or-nothing semantics - no partial bet states
            // Uses standard zero rule (no En Prison in atomic batch)
            4 => {
                // Can't batch if wheel already spun or in prison
                if state.phase != Phase::Betting || state.result.is_some() {
                    return Err(GameError::InvalidMove);
                }

                // Must have existing bets cleared first (fresh round)
                if !state.bets.is_empty() {
                    return Err(GameError::InvalidMove);
                }

                if payload.len() < 2 {
                    return Err(GameError::InvalidPayload);
                }

                let bet_count = payload[1] as usize;
                if bet_count == 0 || bet_count > limits::ROULETTE_MAX_BETS {
                    return Err(GameError::InvalidPayload);
                }

                // Expected payload size: 2 (action + count) + bet_count * 10 (type + number + amount)
                let expected_len = 2 + bet_count * 10;
                if payload.len() < expected_len {
                    return Err(GameError::InvalidPayload);
                }

                // Parse and validate all bets first (before any state changes)
                let mut bets_to_place: Vec<RouletteBet> = Vec::with_capacity(bet_count);
                let mut total_wager: u64 = 0;
                let mut offset = 2;

                for _ in 0..bet_count {
                    let bet_type = BetType::try_from(payload[offset])?;
                    let number = payload[offset + 1];
                    let amount = u64::from_be_bytes(
                        payload[offset + 2..offset + 10]
                            .try_into()
                            .map_err(|_| GameError::InvalidPayload)?,
                    );

                    if amount == 0 {
                        return Err(GameError::InvalidPayload);
                    }

                    // Check for overflow in total wager
                    total_wager = total_wager
                        .checked_add(amount)
                        .ok_or(GameError::InvalidPayload)?;

                    bets_to_place.push(RouletteBet {
                        bet_type,
                        number,
                        amount,
                    });

                    offset += 10;
                }

                session.bet = total_wager;

                // All validation passed - now execute atomically
                state.bets = bets_to_place;
                state.total_wagered = total_wager;

                // Spin the wheel
                let result = spin_result(rng, state.zero_rule);
                state.result = Some(result);

                // Calculate total return (standard rules - no En Prison for atomic batch)
                let mut total_return: u64 = 0;
                for bet in &state.bets {
                    if bet_wins(bet.bet_type, bet.number, result) {
                        let multiplier = payout_multiplier(bet.bet_type).saturating_add(1);
                        total_return =
                            total_return.saturating_add(bet.amount.saturating_mul(multiplier));
                    }
                }

                // Apply super mode multipliers
                if session.super_mode.is_active && total_return > 0 {
                    total_return = apply_super_multiplier_number(
                        result,
                        &session.super_mode.multipliers,
                        total_return,
                    );
                }

                session.state_blob = serialize_state(&state);
                session.move_count += 1;
                session.is_complete = true;

                let logs = generate_roulette_logs(&state, result, total_return);
                if total_return > 0 {
                    Ok(GameResult::Win(total_return, logs))
                } else {
                    // Total loss - wager is deducted on completion for atomic batch
                    Ok(GameResult::Loss(logs))
                }
            }

            _ => Err(GameError::InvalidPayload),
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
            game_type: GameType::Roulette,
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
    fn test_roulette_bet_bytes_roundtrip() {
        let bet = RouletteBet {
            bet_type: BetType::Straight,
            number: 17,
            amount: 123_456,
        };

        let bytes = bet.to_bytes();
        assert_eq!(bytes.len(), 10);

        let decoded = RouletteBet::from_bytes(&bytes).expect("decode bet");
        assert_eq!(decoded, bet);
    }

    #[test]
    fn test_roulette_bet_from_bytes_rejects_invalid_inputs() {
        assert!(RouletteBet::from_bytes(&[0u8; 9]).is_none());

        let mut bytes = vec![0u8; 10];
        bytes[0] = 255; // invalid bet type
        assert!(RouletteBet::from_bytes(&bytes).is_none());
    }

    #[test]
    fn test_state_blob_fuzz_does_not_panic() {
        let mut rng = StdRng::seed_from_u64(0x5eed_1e77);
        for _ in 0..1_000 {
            let len = rng.gen_range(0..=256);
            let mut blob = vec![0u8; len];
            rng.fill(&mut blob[..]);
            let _ = parse_state(&blob);
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
        assert!(bet_wins(BetType::Straight, DOUBLE_ZERO, DOUBLE_ZERO));
        assert!(!bet_wins(BetType::Straight, 0, DOUBLE_ZERO));
    }

    #[test]
    fn test_bet_wins_colors() {
        // Red numbers
        assert!(bet_wins(BetType::Red, 0, 1));
        assert!(bet_wins(BetType::Red, 0, 3));
        assert!(!bet_wins(BetType::Red, 0, 2));
        assert!(!bet_wins(BetType::Red, 0, 0)); // Zero loses
        assert!(!bet_wins(BetType::Red, 0, DOUBLE_ZERO));

        // Black numbers
        assert!(bet_wins(BetType::Black, 0, 2));
        assert!(bet_wins(BetType::Black, 0, 4));
        assert!(!bet_wins(BetType::Black, 0, 1));
        assert!(!bet_wins(BetType::Black, 0, 0)); // Zero loses
        assert!(!bet_wins(BetType::Black, 0, DOUBLE_ZERO));
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
        assert_eq!(payout_multiplier(BetType::SplitH), 17);
        assert_eq!(payout_multiplier(BetType::SplitV), 17);
        assert_eq!(payout_multiplier(BetType::Street), 11);
        assert_eq!(payout_multiplier(BetType::Corner), 8);
        assert_eq!(payout_multiplier(BetType::SixLine), 5);
    }

    #[test]
    fn test_bet_wins_inside_bets() {
        // SplitH: 1-2
        assert!(bet_wins(BetType::SplitH, 1, 1));
        assert!(bet_wins(BetType::SplitH, 1, 2));
        assert!(!bet_wins(BetType::SplitH, 1, 3));

        // SplitV: 1-4
        assert!(bet_wins(BetType::SplitV, 1, 1));
        assert!(bet_wins(BetType::SplitV, 1, 4));
        assert!(!bet_wins(BetType::SplitV, 1, 7));

        // Street: 4-5-6
        assert!(bet_wins(BetType::Street, 4, 4));
        assert!(bet_wins(BetType::Street, 4, 5));
        assert!(bet_wins(BetType::Street, 4, 6));
        assert!(!bet_wins(BetType::Street, 4, 7));

        // Corner: 1-2-4-5
        assert!(bet_wins(BetType::Corner, 1, 1));
        assert!(bet_wins(BetType::Corner, 1, 2));
        assert!(bet_wins(BetType::Corner, 1, 4));
        assert!(bet_wins(BetType::Corner, 1, 5));
        assert!(!bet_wins(BetType::Corner, 1, 3));

        // SixLine: 1-2-3-4-5-6
        for r in 1..=6 {
            assert!(bet_wins(BetType::SixLine, 1, r));
        }
        assert!(!bet_wins(BetType::SixLine, 1, 7));

        // Zero should lose all inside bets.
        assert!(!bet_wins(BetType::SplitH, 1, 0));
        assert!(!bet_wins(BetType::SplitV, 1, 0));
        assert!(!bet_wins(BetType::Street, 1, 0));
        assert!(!bet_wins(BetType::Corner, 1, 0));
        assert!(!bet_wins(BetType::SixLine, 1, 0));
    }

    #[test]
    fn test_is_zero_result_american() {
        assert!(is_zero_result(ZeroRule::Standard, 0));
        assert!(!is_zero_result(ZeroRule::Standard, DOUBLE_ZERO));
        assert!(is_zero_result(ZeroRule::American, 0));
        assert!(is_zero_result(ZeroRule::American, DOUBLE_ZERO));
    }

    /// Helper to create place bet payload
    fn place_bet_payload(bet_type: BetType, number: u8, amount: u64) -> Vec<u8> {
        let mut payload = vec![0, bet_type as u8, number];
        payload.extend_from_slice(&amount.to_be_bytes());
        payload
    }

    #[test]
    fn test_place_bet() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Roulette::init(&mut session, &mut rng);
        assert!(!session.is_complete);

        // Place a red bet
        let mut rng = GameRng::new(&seed, session.id, 1);
        let payload = place_bet_payload(BetType::Red, 0, 100);
        let result = Roulette::process_move(&mut session, &payload, &mut rng);

        assert!(result.is_ok());
        assert!(!session.is_complete); // Game continues - need to spin

        // Verify bet was stored
        let state = parse_state(&session.state_blob).expect("Failed to parse state");
        assert_eq!(state.bets.len(), 1);
        assert_eq!(state.bets[0].bet_type, BetType::Red);
        assert_eq!(state.bets[0].amount, 100);
    }

    #[test]
    fn test_game_completes_after_spin() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Roulette::init(&mut session, &mut rng);
        assert!(!session.is_complete);

        // Place a red bet
        let mut rng = GameRng::new(&seed, session.id, 1);
        let payload = place_bet_payload(BetType::Red, 0, 100);
        Roulette::process_move(&mut session, &payload, &mut rng).expect("Failed to process move");

        // Spin the wheel
        let mut rng = GameRng::new(&seed, session.id, 2);
        let result = Roulette::process_move(&mut session, &[1], &mut rng);

        assert!(result.is_ok());
        assert!(session.is_complete);

        // State should have bet and result
        let state = parse_state(&session.state_blob).expect("Failed to parse state");
        assert!(state.result.is_some());
        assert!(state.result.expect("Result should be set") <= 36);
    }

    #[test]
    fn test_multi_bet() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Roulette::init(&mut session, &mut rng);

        // Place multiple bets
        let mut rng = GameRng::new(&seed, session.id, 1);
        let payload = place_bet_payload(BetType::Red, 0, 50);
        Roulette::process_move(&mut session, &payload, &mut rng).expect("Failed to process move");

        let mut rng = GameRng::new(&seed, session.id, 2);
        let payload = place_bet_payload(BetType::Straight, 17, 25);
        Roulette::process_move(&mut session, &payload, &mut rng).expect("Failed to process move");

        let mut rng = GameRng::new(&seed, session.id, 3);
        let payload = place_bet_payload(BetType::Odd, 0, 25);
        Roulette::process_move(&mut session, &payload, &mut rng).expect("Failed to process move");

        // Verify all bets stored
        let state = parse_state(&session.state_blob).expect("Failed to parse state");
        assert_eq!(state.bets.len(), 3);

        // Spin
        let mut rng = GameRng::new(&seed, session.id, 4);
        let result = Roulette::process_move(&mut session, &[1], &mut rng);

        assert!(result.is_ok());
        assert!(session.is_complete);
    }

    #[test]
    fn test_invalid_bet_number() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Roulette::init(&mut session, &mut rng);

        let mut rng = GameRng::new(&seed, session.id, 1);
        // Straight bet on 37 (invalid)
        let payload = place_bet_payload(BetType::Straight, 37, 100);
        let result = Roulette::process_move(&mut session, &payload, &mut rng);
        assert!(matches!(result, Err(GameError::InvalidPayload)));

        // Dozen bet on 3 (invalid, should be 0, 1, or 2)
        let payload = place_bet_payload(BetType::Dozen, 3, 100);
        let result = Roulette::process_move(&mut session, &payload, &mut rng);
        assert!(matches!(result, Err(GameError::InvalidPayload)));

        // SplitH on rightmost number in a row (3-4 would be invalid as a horizontal split)
        let payload = place_bet_payload(BetType::SplitH, 3, 100);
        let result = Roulette::process_move(&mut session, &payload, &mut rng);
        assert!(matches!(result, Err(GameError::InvalidPayload)));

        // SplitV starting too low/high
        let payload = place_bet_payload(BetType::SplitV, 34, 100);
        let result = Roulette::process_move(&mut session, &payload, &mut rng);
        assert!(matches!(result, Err(GameError::InvalidPayload)));

        // Street must start on 1,4,...,34
        let payload = place_bet_payload(BetType::Street, 2, 100);
        let result = Roulette::process_move(&mut session, &payload, &mut rng);
        assert!(matches!(result, Err(GameError::InvalidPayload)));

        // Corner can't start on rightmost column
        let payload = place_bet_payload(BetType::Corner, 3, 100);
        let result = Roulette::process_move(&mut session, &payload, &mut rng);
        assert!(matches!(result, Err(GameError::InvalidPayload)));

        // SixLine must start on 1,4,...,31
        let payload = place_bet_payload(BetType::SixLine, 34, 100);
        let result = Roulette::process_move(&mut session, &payload, &mut rng);
        assert!(matches!(result, Err(GameError::InvalidPayload)));
    }

    /// US-148: Comprehensive edge boundary tests for all split/corner/line bet types.
    /// Verifies that boundary values are correctly accepted or rejected.
    #[test]
    fn test_edge_bet_boundary_validation() {
        // SplitH: Valid numbers are 1-35, excluding multiples of 3 (right-edge).
        // Left column (1,4,7,...,34): valid
        // Middle column (2,5,8,...,35): valid
        // Right column (3,6,9,...,36): INVALID

        // Valid SplitH boundary cases
        assert!(is_valid_bet_number(BetType::SplitH, 1, ZeroRule::Standard)); // First valid
        assert!(is_valid_bet_number(BetType::SplitH, 2, ZeroRule::Standard)); // Middle column
        assert!(is_valid_bet_number(BetType::SplitH, 34, ZeroRule::Standard)); // Last row, col 1
        assert!(is_valid_bet_number(BetType::SplitH, 35, ZeroRule::Standard)); // Last row, col 2

        // Invalid SplitH: right-edge numbers (column 3)
        assert!(!is_valid_bet_number(BetType::SplitH, 3, ZeroRule::Standard));
        assert!(!is_valid_bet_number(BetType::SplitH, 6, ZeroRule::Standard));
        assert!(!is_valid_bet_number(BetType::SplitH, 33, ZeroRule::Standard));
        assert!(!is_valid_bet_number(BetType::SplitH, 36, ZeroRule::Standard));

        // Invalid SplitH: out of range
        assert!(!is_valid_bet_number(BetType::SplitH, 0, ZeroRule::Standard));
        assert!(!is_valid_bet_number(BetType::SplitH, 37, ZeroRule::Standard));

        // SplitV: Valid numbers are 1-33 (vertical split needs row below)
        assert!(is_valid_bet_number(BetType::SplitV, 1, ZeroRule::Standard));
        assert!(is_valid_bet_number(BetType::SplitV, 33, ZeroRule::Standard)); // Last valid
        assert!(!is_valid_bet_number(BetType::SplitV, 34, ZeroRule::Standard)); // No row below
        assert!(!is_valid_bet_number(BetType::SplitV, 35, ZeroRule::Standard));
        assert!(!is_valid_bet_number(BetType::SplitV, 36, ZeroRule::Standard));
        assert!(!is_valid_bet_number(BetType::SplitV, 0, ZeroRule::Standard));

        // Street: Must start on 1, 4, 7, ..., 34 (row starts)
        assert!(is_valid_bet_number(BetType::Street, 1, ZeroRule::Standard));
        assert!(is_valid_bet_number(BetType::Street, 4, ZeroRule::Standard));
        assert!(is_valid_bet_number(BetType::Street, 34, ZeroRule::Standard)); // Last row
        assert!(!is_valid_bet_number(BetType::Street, 2, ZeroRule::Standard)); // Not row start
        assert!(!is_valid_bet_number(BetType::Street, 3, ZeroRule::Standard));
        assert!(!is_valid_bet_number(BetType::Street, 35, ZeroRule::Standard)); // Out of range
        assert!(!is_valid_bet_number(BetType::Street, 0, ZeroRule::Standard));

        // Corner: Must be 1-32, excluding right-edge (multiples of 3)
        assert!(is_valid_bet_number(BetType::Corner, 1, ZeroRule::Standard)); // Top-left
        assert!(is_valid_bet_number(BetType::Corner, 2, ZeroRule::Standard)); // Top-middle
        assert!(is_valid_bet_number(BetType::Corner, 31, ZeroRule::Standard)); // Bottom-left
        assert!(is_valid_bet_number(BetType::Corner, 32, ZeroRule::Standard)); // Bottom-middle
        assert!(!is_valid_bet_number(BetType::Corner, 3, ZeroRule::Standard)); // Right edge
        assert!(!is_valid_bet_number(BetType::Corner, 33, ZeroRule::Standard)); // Right edge
        assert!(!is_valid_bet_number(BetType::Corner, 34, ZeroRule::Standard)); // No row below
        assert!(!is_valid_bet_number(BetType::Corner, 0, ZeroRule::Standard));

        // SixLine: Must start on 1, 4, 7, ..., 31 (two consecutive rows)
        assert!(is_valid_bet_number(BetType::SixLine, 1, ZeroRule::Standard));
        assert!(is_valid_bet_number(BetType::SixLine, 4, ZeroRule::Standard));
        assert!(is_valid_bet_number(BetType::SixLine, 31, ZeroRule::Standard)); // Last valid
        assert!(!is_valid_bet_number(BetType::SixLine, 34, ZeroRule::Standard)); // No second row
        assert!(!is_valid_bet_number(BetType::SixLine, 2, ZeroRule::Standard)); // Not row start
        assert!(!is_valid_bet_number(BetType::SixLine, 0, ZeroRule::Standard));

        // Dozen: Valid numbers are 0, 1, 2
        assert!(is_valid_bet_number(BetType::Dozen, 0, ZeroRule::Standard));
        assert!(is_valid_bet_number(BetType::Dozen, 1, ZeroRule::Standard));
        assert!(is_valid_bet_number(BetType::Dozen, 2, ZeroRule::Standard));
        assert!(!is_valid_bet_number(BetType::Dozen, 3, ZeroRule::Standard));
        assert!(!is_valid_bet_number(BetType::Dozen, 255, ZeroRule::Standard));

        // Column: Valid numbers are 0, 1, 2
        assert!(is_valid_bet_number(BetType::Column, 0, ZeroRule::Standard));
        assert!(is_valid_bet_number(BetType::Column, 1, ZeroRule::Standard));
        assert!(is_valid_bet_number(BetType::Column, 2, ZeroRule::Standard));
        assert!(!is_valid_bet_number(BetType::Column, 3, ZeroRule::Standard));
    }

    /// US-148: Verify SplitH edge case - 35-36 is a valid horizontal split.
    /// Number 35 is in column 2 (35 % 3 = 2), 36 is in column 3 (36 % 3 = 0).
    /// They are adjacent in row 12, so this is a valid split bet.
    #[test]
    fn test_splith_35_36_is_valid() {
        // 35 passes validation (35 % 3 = 2, not 0)
        assert!(is_valid_bet_number(BetType::SplitH, 35, ZeroRule::Standard));

        // The bet correctly wins on both 35 and 36
        assert!(bet_wins(BetType::SplitH, 35, 35));
        assert!(bet_wins(BetType::SplitH, 35, 36));
        assert!(!bet_wins(BetType::SplitH, 35, 34)); // Not adjacent
        assert!(!bet_wins(BetType::SplitH, 35, 0)); // Zero loses
    }

    #[test]
    fn test_spin_without_bets() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Roulette::init(&mut session, &mut rng);

        // Try to spin without placing bets
        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = Roulette::process_move(&mut session, &[1], &mut rng);

        assert!(matches!(result, Err(GameError::InvalidMove)));
    }

    #[test]
    fn test_clear_bets() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Roulette::init(&mut session, &mut rng);

        // Place a bet
        let mut rng = GameRng::new(&seed, session.id, 1);
        let payload = place_bet_payload(BetType::Red, 0, 100);
        Roulette::process_move(&mut session, &payload, &mut rng).expect("Failed to process move");

        // Clear bets
        let mut rng = GameRng::new(&seed, session.id, 2);
        let result = Roulette::process_move(&mut session, &[2], &mut rng);
        assert!(result.is_ok());

        // Verify bets cleared
        let state = parse_state(&session.state_blob).expect("Failed to parse state");
        assert!(state.bets.is_empty());
    }

    #[test]
    fn test_la_partage_half_back_on_zero_even_money() {
        let seed = create_test_seed();

        for session_id in 1..10_000 {
            let mut test_session = create_test_session(100);
            test_session.id = session_id;
            let mut rng = GameRng::new(&seed, session_id, 0);
            Roulette::init(&mut test_session, &mut rng);

            // Set La Partage (1)
            let mut rng = GameRng::new(&seed, session_id, 1);
            Roulette::process_move(&mut test_session, &[3, 1], &mut rng)
                .expect("Failed to set rule");

            // Place a red bet
            let mut rng = GameRng::new(&seed, session_id, 2);
            let payload = place_bet_payload(BetType::Red, 0, 100);
            Roulette::process_move(&mut test_session, &payload, &mut rng)
                .expect("Failed to place bet");

            // Spin
            let mut rng = GameRng::new(&seed, session_id, 3);
            let res =
                Roulette::process_move(&mut test_session, &[1], &mut rng).expect("Spin failed");
            let state =
                parse_state(&test_session.state_blob).expect("Failed to parse state");

            if state.result == Some(0) {
                assert!(matches!(res, GameResult::Win(50, _)));
                return;
            }
        }

        panic!("did not find a session that landed on 0");
    }

    #[test]
    fn test_en_prison_continues_on_zero_then_resolves() {
        let seed = create_test_seed();

        for session_id in 1..10_000 {
            let mut test_session = create_test_session(100);
            test_session.id = session_id;
            let mut rng = GameRng::new(&seed, session_id, 0);
            Roulette::init(&mut test_session, &mut rng);

            // Set En Prison (2)
            let mut rng = GameRng::new(&seed, session_id, 1);
            Roulette::process_move(&mut test_session, &[3, 2], &mut rng)
                .expect("Failed to set rule");

            // Place a red bet
            let mut rng = GameRng::new(&seed, session_id, 2);
            let payload = place_bet_payload(BetType::Red, 0, 100);
            Roulette::process_move(&mut test_session, &payload, &mut rng)
                .expect("Failed to place bet");

            // First spin
            let mut rng = GameRng::new(&seed, session_id, 3);
            let res1 =
                Roulette::process_move(&mut test_session, &[1], &mut rng).expect("Spin failed");
            let state1 =
                parse_state(&test_session.state_blob).expect("Failed to parse state");

            if state1.result != Some(0) {
                continue;
            }

            assert!(matches!(res1, GameResult::Continue(_)));
            assert!(!test_session.is_complete);
            assert_eq!(state1.phase, Phase::Prison);

            // Second spin
            let mut rng = GameRng::new(&seed, session_id, 4);
            let res2 =
                Roulette::process_move(&mut test_session, &[1], &mut rng).expect("Spin failed");
            let state2 =
                parse_state(&test_session.state_blob).expect("Failed to parse state");
            let result2 = state2.result.expect("Second result should be set");

            assert!(test_session.is_complete);

            if result2 != 0 && is_red(result2) {
                assert!(matches!(res2, GameResult::Win(100, _)));
            } else {
                assert!(matches!(res2, GameResult::LossPreDeducted(100, _)));
            }
            return;
        }

        panic!("did not find a session that landed on 0 with En Prison");
    }

    #[test]
    fn test_en_prison_double_continues_on_second_zero() {
        let seed = create_test_seed();

        for session_id in 1..100_000 {
            let mut test_session = create_test_session(100);
            test_session.id = session_id;
            let mut rng = GameRng::new(&seed, session_id, 0);
            Roulette::init(&mut test_session, &mut rng);

            // Set En Prison (Double) (3)
            let mut rng = GameRng::new(&seed, session_id, 1);
            Roulette::process_move(&mut test_session, &[3, 3], &mut rng)
                .expect("Failed to set rule");

            // Place a red bet
            let mut rng = GameRng::new(&seed, session_id, 2);
            let payload = place_bet_payload(BetType::Red, 0, 100);
            Roulette::process_move(&mut test_session, &payload, &mut rng)
                .expect("Failed to place bet");

            // First spin
            let mut rng = GameRng::new(&seed, session_id, 3);
            let res1 =
                Roulette::process_move(&mut test_session, &[1], &mut rng).expect("Spin failed");
            let state1 =
                parse_state(&test_session.state_blob).expect("Failed to parse state");

            if state1.result != Some(0) {
                continue;
            }

            assert!(matches!(res1, GameResult::Continue(_)));
            assert!(!test_session.is_complete);
            assert_eq!(state1.phase, Phase::Prison);

            // Second spin (look for 0 again)
            let mut rng = GameRng::new(&seed, session_id, 4);
            let res2 =
                Roulette::process_move(&mut test_session, &[1], &mut rng).expect("Spin failed");
            let state2 =
                parse_state(&test_session.state_blob).expect("Failed to parse state");

            if state2.result != Some(0) {
                continue;
            }

            assert!(matches!(res2, GameResult::Continue(_)));
            assert!(!test_session.is_complete);
            assert_eq!(state2.phase, Phase::Prison);
            return;
        }

        panic!("did not find a session that landed on 0 twice with En Prison Double");
    }

    #[test]
    fn test_american_double_zero_straight_win() {
        let seed = create_test_seed();

        for session_id in 1..100_000 {
            let mut test_session = create_test_session(100);
            test_session.id = session_id;
            let mut rng = GameRng::new(&seed, session_id, 0);
            Roulette::init(&mut test_session, &mut rng);

            // Set American wheel (4)
            let mut rng = GameRng::new(&seed, session_id, 1);
            Roulette::process_move(&mut test_session, &[3, 4], &mut rng)
                .expect("Failed to set rule");

            // Place a straight bet on 00 (37) and a red bet.
            let mut rng = GameRng::new(&seed, session_id, 2);
            let payload = place_bet_payload(BetType::Straight, DOUBLE_ZERO, 100);
            Roulette::process_move(&mut test_session, &payload, &mut rng)
                .expect("Failed to place bet");

            let mut rng = GameRng::new(&seed, session_id, 3);
            let payload = place_bet_payload(BetType::Red, 0, 100);
            Roulette::process_move(&mut test_session, &payload, &mut rng)
                .expect("Failed to place bet");

            // Spin
            let mut rng = GameRng::new(&seed, session_id, 4);
            let res =
                Roulette::process_move(&mut test_session, &[1], &mut rng).expect("Spin failed");
            let state =
                parse_state(&test_session.state_blob).expect("Failed to parse state");

            if state.result == Some(DOUBLE_ZERO) {
                assert!(matches!(res, GameResult::Win(3600, _)));
                return;
            }
        }

        panic!("did not find a session that landed on 00");
    }

    #[test]
    fn test_straight_win_payout() {
        let seed = create_test_seed();

        // Find a session that produces a known result
        for session_id in 1..100 {
            let mut test_session = create_test_session(100);
            test_session.id = session_id;
            let mut rng = GameRng::new(&seed, session_id, 0);
            Roulette::init(&mut test_session, &mut rng);

            // Place bet on number 0
            let mut rng = GameRng::new(&seed, session_id, 1);
            let payload = place_bet_payload(BetType::Straight, 0, 100);
            Roulette::process_move(&mut test_session, &payload, &mut rng)
                .expect("Failed to process move");

            // Spin
            let mut rng = GameRng::new(&seed, session_id, 2);
            let result = Roulette::process_move(&mut test_session, &[1], &mut rng);

            if let Ok(GameResult::Win(amount, _)) = result {
                // Straight bet pays 35:1 plus stake returned = 36x total
                assert_eq!(amount, 100 * 36);
                return; // Found a winning case
            }
        }
        // Note: It's statistically unlikely to hit 0 in 100 tries (expected ~2-3 times)
        // but not guaranteed. This test just verifies the logic works.
    }
}
