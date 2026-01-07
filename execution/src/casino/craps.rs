//! Enhanced Craps game implementation with a multi-bet menu.
//!
//! State blob format:
//! [version:u8=2]
//! [phase:u8]
//! [main_point:u8]
//! [d1:u8] [d2:u8]
//! [made_points_mask:u8] (Fire Bet: bits for 4/5/6/8/9/10 made)
//! [epoch_point_established:u8] (0/1, becomes 1 after the first point is established in an epoch)
//! [bet_count:u8]
//! [bets:CrapsBetEntry×count]
//! [field_paytable:u8]? (optional, post-bets rules bytes)
//!
//! Each CrapsBetEntry (19 bytes):
//! [bet_type:u8] [target:u8] [status:u8] [amount:u64 BE] [odds_amount:u64 BE]
//!
//! Phases:
//! 0 = Come out (initial roll)
//! 1 = Point phase (rolling for point)
//!
//! Payload format:
//! [0, bet_type, target, amount_bytes...] - Place bet
//! [1, amount_bytes...] - Add odds to last contract bet
//! [2] - Roll dice
//! [3] - Clear all bets (only before first roll, with refund)
//! [4, bet_count, bets...] - Atomic batch: place all bets + roll in one transaction
//!                          Each bet is 10 bytes: [bet_type:u8, target:u8, amount:u64 BE]
//!                          Ensures all-or-nothing semantics (only before first roll)
//!                          Note: Odds cannot be added in atomic batch

use super::logging::{clamp_i64, push_resolved_entry};
use super::serialization::{StateReader, StateWriter};
use super::super_mode::apply_super_multiplier_total;
use super::{limits, CasinoGame, GameError, GameResult, GameRng};
use nullspace_types::casino::GameSession;
use std::fmt::Write;

/// Payout multipliers for Craps (expressed as "to 1" winnings unless noted).
mod payouts {
    // Field bet multipliers (total return multiples, not "to 1")
    pub const FIELD_2_OR_12_DOUBLE: u64 = 3;  // 2:1 -> 3x total
    pub const FIELD_12_TRIPLE: u64 = 4;       // 3:1 -> 4x total
    pub const FIELD_STANDARD: u64 = 2;        // 1:1 -> 2x total

    // Next (Hop) bet multipliers ("to 1" winnings)
    pub const NEXT_1_WAY: u64 = 35;   // 2 or 12
    pub const NEXT_2_WAYS: u64 = 17;  // 3 or 11
    pub const NEXT_3_WAYS: u64 = 11;  // 4 or 10
    pub const NEXT_4_WAYS: u64 = 8;   // 5 or 9
    pub const NEXT_5_WAYS: u64 = 6;   // 6 or 8
    pub const NEXT_6_WAYS: u64 = 5;   // 7

    // Hardway bet multipliers ("to 1" winnings)
    pub const HARDWAY_4_OR_10: u64 = 7;
    pub const HARDWAY_6_OR_8: u64 = 9;

    // Fire bet multipliers ("to 1" winnings)
    pub const FIRE_4_POINTS: u64 = 24;
    pub const FIRE_5_POINTS: u64 = 249;
    pub const FIRE_6_POINTS: u64 = 999;

    // All Tall Small (ATS) multipliers ("to 1" winnings).
    // WoO Bonus Craps lists the common paytable as 30/30/150.
    pub const ATS_SMALL: u64 = 30;
    pub const ATS_TALL: u64 = 30;
    pub const ATS_ALL: u64 = 150;

    // Commission rates
    pub const YES_NO_COMMISSION_DIVISOR: u64 = 100;  // 1% commission
    pub const NEXT_COMMISSION_DIVISOR: u64 = 100;    // 1% commission
}

const STATE_VERSION: u8 = 2;
const STATE_HEADER_LEN: usize = 8;
const BET_BYTES: usize = 19;

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FieldPaytable {
    /// 2 pays double (2:1) and 12 pays triple (3:1).
    Double2Triple12 = 0,
}

impl Default for FieldPaytable {
    fn default() -> Self {
        Self::Double2Triple12
    }
}

impl TryFrom<u8> for FieldPaytable {
    type Error = ();

    fn try_from(v: u8) -> Result<Self, ()> {
        match v {
            0 | 1 => Ok(FieldPaytable::Double2Triple12),
            _ => Err(()),
        }
    }
}

const MUGGSY_COME_OUT_PAYOUT_TO_1: u64 = 2;
const MUGGSY_POINT_SEVEN_PAYOUT_TO_1: u64 = 3;
const DIFF_DOUBLES_PAYOUTS_TO_1: [u64; 7] = [0, 0, 0, 4, 8, 15, 100];
const HOT_ROLLER_PAYOUTS_TO_1: [u64; 7] = [0, 0, 5, 10, 20, 50, 200];

// ATS progress bitmask (stored in `odds_amount` for ATS bet entries).
// Bits: 2..6 => 0..4, 8..12 => 5..9.
const ATS_SMALL_MASK: u64 = (1u64 << 0) | (1u64 << 1) | (1u64 << 2) | (1u64 << 3) | (1u64 << 4);
const ATS_TALL_MASK: u64 = (1u64 << 5) | (1u64 << 6) | (1u64 << 7) | (1u64 << 8) | (1u64 << 9);
const ATS_ALL_MASK: u64 = ATS_SMALL_MASK | ATS_TALL_MASK;

/// Number of ways to roll each total with 2d6
const WAYS: [u8; 13] = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];
//                      0  1  2  3  4  5  6  7  8  9 10 11 12

/// Craps phases.
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    ComeOut = 0,
    Point = 1,
}

impl TryFrom<u8> for Phase {
    type Error = ();

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Phase::ComeOut),
            1 => Ok(Phase::Point),
            _ => Err(()),
        }
    }
}

/// Supported bet types in craps.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum BetType {
    Pass = 0,       // Come-out: 7/11 win, 2/3/12 lose, else point
    DontPass = 1,   // Come-out: 2/3 win, 7/11 lose, 12 push
    Come = 2,       // Like PASS but during point phase
    DontCome = 3,   // Like DONT_PASS but during point phase
    Field = 4,      // Single roll: 2=2x, 12=3x, 3,4,9,10,11=1x
    Yes = 5,        // Place bet: target (2-12 except 7) hits before 7
    No = 6,         // Lay bet: 7 hits before target (2-12 except 7)
    Next = 7,       // Hop bet: exact total (2-12) on next roll
    Hardway4 = 8,   // 2+2 before 7 or easy 4
    Hardway6 = 9,   // 3+3 before 7 or easy 6
    Hardway8 = 10,  // 4+4 before 7 or easy 8
    Hardway10 = 11, // 5+5 before 7 or easy 10
    Fire = 12,      // Fire Bet side bet (Pay Table A)
    AtsSmall = 15,  // All Tall Small: Small (2-6) before a 7
    AtsTall = 16,   // All Tall Small: Tall (8-12) before a 7
    AtsAll = 17,    // All Tall Small: All (Small + Tall) before a 7
    Muggsy = 18,    // Muggsy's Corner
    DiffDoubles = 19, // Different Doubles
    RideLine = 20,  // Ride the Line
    Replay = 21,    // Replay
    HotRoller = 22, // Hot Roller
}

impl TryFrom<u8> for BetType {
    type Error = ();

    fn try_from(v: u8) -> Result<Self, ()> {
        match v {
            0 => Ok(BetType::Pass),
            1 => Ok(BetType::DontPass),
            2 => Ok(BetType::Come),
            3 => Ok(BetType::DontCome),
            4 => Ok(BetType::Field),
            5 => Ok(BetType::Yes),
            6 => Ok(BetType::No),
            7 => Ok(BetType::Next),
            8 => Ok(BetType::Hardway4),
            9 => Ok(BetType::Hardway6),
            10 => Ok(BetType::Hardway8),
            11 => Ok(BetType::Hardway10),
            12 => Ok(BetType::Fire),
            // 13 (Buy) removed
            15 => Ok(BetType::AtsSmall),
            16 => Ok(BetType::AtsTall),
            17 => Ok(BetType::AtsAll),
            18 => Ok(BetType::Muggsy),
            19 => Ok(BetType::DiffDoubles),
            20 => Ok(BetType::RideLine),
            21 => Ok(BetType::Replay),
            22 => Ok(BetType::HotRoller),
            _ => Err(()),
        }
    }
}

/// Bet status for contract bets.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum BetStatus {
    On = 0,      // Bet is working
    Pending = 1, // Come/Don't Come waiting to travel
}

impl TryFrom<u8> for BetStatus {
    type Error = ();

    fn try_from(v: u8) -> Result<Self, ()> {
        match v {
            0 => Ok(BetStatus::On),
            1 => Ok(BetStatus::Pending),
            _ => Err(()),
        }
    }
}

/// Individual bet in craps.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CrapsBet {
    pub bet_type: BetType,
    pub target: u8,        // Point for COME/YES/NO, number for NEXT/HARDWAY
    pub status: BetStatus, // ON or PENDING
    pub amount: u64,
    pub odds_amount: u64, // Free odds behind contract bets
}

impl CrapsBet {
    /// Serialize to 19 bytes
    fn to_bytes(&self) -> [u8; 19] {
        let mut bytes = [0u8; 19];
        bytes[0] = self.bet_type as u8;
        bytes[1] = self.target;
        bytes[2] = self.status as u8;
        bytes[3..11].copy_from_slice(&self.amount.to_be_bytes());
        bytes[11..19].copy_from_slice(&self.odds_amount.to_be_bytes());
        bytes
    }

    /// Deserialize from 19 bytes
    fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < 19 {
            return None;
        }
        let bet_type = BetType::try_from(bytes[0]).ok()?;
        let target = bytes[1];
        let status = BetStatus::try_from(bytes[2]).ok()?;
        let amount = u64::from_be_bytes(bytes[3..11].try_into().ok()?);
        let odds_amount = u64::from_be_bytes(bytes[11..19].try_into().ok()?);
        if amount == 0 {
            return None;
        }
        Some(CrapsBet {
            bet_type,
            target,
            status,
            amount,
            odds_amount,
        })
    }
}

fn is_valid_bet_state(bet: &CrapsBet) -> bool {
    match bet.bet_type {
        BetType::Pass | BetType::DontPass => {
            bet.status == BetStatus::On && (bet.target == 0 || is_point_total(bet.target))
        }
        BetType::Come | BetType::DontCome => match bet.status {
            BetStatus::Pending => bet.target == 0,
            BetStatus::On => is_point_total(bet.target),
        },
        BetType::Field => bet.status == BetStatus::On && bet.target == 0,
        BetType::Yes | BetType::No => {
            bet.status == BetStatus::On && (2..=12).contains(&bet.target) && bet.target != 7
        }
        BetType::Next => bet.status == BetStatus::On && (2..=12).contains(&bet.target),
        BetType::Hardway4 => bet.status == BetStatus::On && (bet.target == 0 || bet.target == 4),
        BetType::Hardway6 => bet.status == BetStatus::On && (bet.target == 0 || bet.target == 6),
        BetType::Hardway8 => bet.status == BetStatus::On && (bet.target == 0 || bet.target == 8),
        BetType::Hardway10 => bet.status == BetStatus::On && (bet.target == 0 || bet.target == 10),
        BetType::Fire
        | BetType::AtsSmall
        | BetType::AtsTall
        | BetType::AtsAll
        | BetType::Muggsy
        | BetType::DiffDoubles
        | BetType::RideLine
        | BetType::Replay
        | BetType::HotRoller => bet.status == BetStatus::On && bet.target == 0,
    }
}

/// Result of processing a bet after a roll.
#[derive(Debug)]
struct BetResult {
    bet_idx: usize,
    /// Amount to credit to player balance (stake already deducted at bet placement).
    return_amount: u64,
    /// Total amount wagered on this bet (used to report losses when completing).
    wagered: u64,
    resolved: bool,
}

fn bet_type_str(bet_type: BetType) -> &'static str {
    match bet_type {
        BetType::Pass => "PASS",
        BetType::DontPass => "DONT_PASS",
        BetType::Come => "COME",
        BetType::DontCome => "DONT_COME",
        BetType::Field => "FIELD",
        BetType::Yes => "YES",
        BetType::No => "NO",
        BetType::Next => "NEXT",
        BetType::Hardway4 => "HARDWAY_4",
        BetType::Hardway6 => "HARDWAY_6",
        BetType::Hardway8 => "HARDWAY_8",
        BetType::Hardway10 => "HARDWAY_10",
        BetType::Fire => "FIRE",
        BetType::AtsSmall => "ATS_SMALL",
        BetType::AtsTall => "ATS_TALL",
        BetType::AtsAll => "ATS_ALL",
        BetType::Muggsy => "MUGGSY",
        BetType::DiffDoubles => "DIFF_DOUBLES",
        BetType::RideLine => "RIDE_LINE",
        BetType::Replay => "REPLAY",
        BetType::HotRoller => "HOT_ROLLER",
    }
}

fn phase_str(phase: Phase) -> &'static str {
    match phase {
        Phase::ComeOut => "COME_OUT",
        Phase::Point => "POINT",
    }
}

/// Generate JSON logs for craps game completion
fn generate_craps_logs(
    state: &CrapsState,
    resolved_bets: &[(BetType, u8, u64, u64, u64)], // (bet_type, target, wagered, return_amount, odds_amount)
    total_wagered: u64,
    total_return: u64,
) -> Vec<String> {
    let d1 = state.d1;
    let d2 = state.d2;
    let total = d1.saturating_add(d2);

    // Build bet results array
    let bet_capacity = resolved_bets.len().saturating_mul(96);
    let resolved_capacity = resolved_bets.len().saturating_mul(48).saturating_add(32);
    let mut bet_results = String::with_capacity(bet_capacity);
    let mut resolved_entries = String::with_capacity(resolved_capacity);
    let mut resolved_sum: i128 = 0;
    let mut total_odds: u64 = 0;
    for (idx, (bet_type, target, wagered, return_amount, odds)) in
        resolved_bets.iter().enumerate()
    {
        if idx > 0 {
            bet_results.push(',');
        }
        let outcome = if *return_amount > *wagered {
            "WIN"
        } else if *return_amount == *wagered {
            "PUSH"
        } else {
            "LOSS"
        };
        let type_label = bet_type_str(*bet_type);
        let label = if let Some(stripped) = type_label.strip_prefix("HARDWAY_") {
            format!("HARDWAY {}", stripped)
        } else if *target > 0 {
            format!("{} {}", type_label, target)
        } else {
            type_label.to_string()
        };
        let pnl = clamp_i64(
            i128::from(*return_amount)
                .saturating_sub(i128::from(*wagered))
                .saturating_sub(i128::from(*odds)),
        );
        resolved_sum = resolved_sum.saturating_add(i128::from(pnl));
        total_odds = total_odds.saturating_add(*odds);
        push_resolved_entry(&mut resolved_entries, &label, pnl);
        if *target > 0 {
            let _ = write!(
                bet_results,
                r#"{{"type":"{}","target":{},"wagered":{},"odds":{},"return":{},"outcome":"{}"}}"#,
                type_label,
                target,
                wagered,
                odds,
                return_amount,
                outcome
            );
        } else {
            let _ = write!(
                bet_results,
                r#"{{"type":"{}","wagered":{},"odds":{},"return":{},"outcome":"{}"}}"#,
                type_label,
                wagered,
                odds,
                return_amount,
                outcome
            );
        }
    }
    let summary = format!("Roll: {} ({}-{})", total, d1, d2);
    let net_from_totals =
        i128::from(total_return).saturating_sub(i128::from(total_wagered)).saturating_sub(
            i128::from(total_odds),
        );
    let net_pnl = clamp_i64(net_from_totals);
    let diff = i128::from(net_pnl).saturating_sub(resolved_sum);
    if diff != 0 {
        push_resolved_entry(&mut resolved_entries, "ADJUSTMENT", clamp_i64(diff));
    }

    vec![format!(
        r#"{{"summary":"{}","netPnl":{},"resolvedBets":[{}],"dice":[{},{}],"total":{},"phase":"{}","point":{},"bets":[{}],"totalWagered":{},"totalReturn":{}}}"#,
        summary,
        net_pnl,
        resolved_entries,
        d1,
        d2,
        total,
        phase_str(state.phase),
        state.main_point,
        bet_results,
        total_wagered,
        total_return
    )]
}

/// Game state.
struct CrapsState {
    phase: Phase,
    main_point: u8,
    d1: u8,
    d2: u8,
    made_points_mask: u8,
    epoch_point_established: bool,
    field_paytable: FieldPaytable,
    bets: Vec<CrapsBet>,
}

impl CrapsState {
    /// Serialize state to blob
    fn to_blob(&self) -> Vec<u8> {
        // Capacity: 8 (header) + bets (19 bytes each) + 1 (optional rules bytes)
        let capacity = STATE_HEADER_LEN + (self.bets.len() * BET_BYTES) + 1;
        let mut blob = StateWriter::with_capacity(capacity);
        blob.push_u8(STATE_VERSION);
        blob.push_u8(self.phase as u8);
        blob.push_u8(self.main_point);
        blob.push_u8(self.d1);
        blob.push_u8(self.d2);
        blob.push_u8(self.made_points_mask);
        blob.push_u8(self.epoch_point_established as u8);
        blob.push_u8(self.bets.len() as u8);

        for bet in &self.bets {
            blob.push_bytes(&bet.to_bytes());
        }

        // Post-bets optional rules bytes (kept at the end so legacy parsers remain compatible).
        blob.push_u8(self.field_paytable as u8);

        blob.into_inner()
    }

    /// Deserialize state from blob
    fn from_blob(blob: &[u8]) -> Option<Self> {
        if blob.len() < 8 {
            return None;
        }

        let mut reader = StateReader::new(blob);
        let version = reader.read_u8()?;
        if version != STATE_VERSION {
            return None;
        }

        let phase = Phase::try_from(reader.read_u8()?).ok()?;
        let main_point = reader.read_u8()?;
        let d1 = reader.read_u8()?;
        let d2 = reader.read_u8()?;
        let made_points_mask = reader.read_u8()?;
        let epoch_point_established = reader.read_u8()? != 0;
        let bet_count = reader.read_u8()? as usize;

        if (d1 > 6 || d2 > 6) || (d1 == 0 && d2 != 0) || (d1 != 0 && d2 == 0) {
            return None;
        }

        if main_point != 0 && !matches!(main_point, 4 | 5 | 6 | 8 | 9 | 10) {
            return None;
        }

        // US-147: Validate Fire Bet made_points_mask only has valid point bits (0-5).
        // Bits 6-7 don't correspond to valid points and could allow corrupted payouts.
        // Valid masks: 0x00-0x3F (points 4=bit0, 5=bit1, 6=bit2, 8=bit3, 9=bit4, 10=bit5)
        if made_points_mask > 0b0011_1111 {
            return None;
        }

        // Validate bet count against maximum to prevent DoS via large allocations
        if bet_count > limits::CRAPS_MAX_BETS {
            return None;
        }

        let mut bets = Vec::with_capacity(bet_count);

        for _ in 0..bet_count {
            let bet = CrapsBet::from_bytes(reader.read_bytes(BET_BYTES)?)?;
            if !is_valid_bet_state(&bet) {
                return None;
            }
            bets.push(bet);
        }

        let remaining = reader.remaining();
        let field_paytable = match remaining {
            0 => FieldPaytable::default(),
            1 => FieldPaytable::try_from(reader.read_u8()?).ok()?,
            2 => {
                let field_paytable = FieldPaytable::try_from(reader.read_u8()?).ok()?;
                let _legacy_rules_byte = reader.read_u8()?;
                field_paytable
            }
            _ => return None,
        };

        Some(CrapsState {
            phase,
            main_point,
            d1,
            d2,
            made_points_mask,
            epoch_point_established,
            field_paytable,
            bets,
        })
    }
}

fn serialize_state(state: &CrapsState) -> Vec<u8> {
    state.to_blob()
}

fn parse_state(blob: &[u8]) -> Option<CrapsState> {
    CrapsState::from_blob(blob)
}

// ============================================================================
// Payout Calculations
// ============================================================================

/// Calculate pass/don't pass return (TOTAL RETURN: stake + winnings).
/// Stake is assumed already deducted at bet placement.
fn calculate_pass_return(bet: &CrapsBet, won: bool, is_pass: bool) -> u64 {
    if !won {
        return 0;
    }

    let flat_return = bet.amount.saturating_mul(2);
    let odds_return = if bet.odds_amount > 0 && bet.target > 0 {
        let winnings = calculate_odds_payout(bet.target, bet.odds_amount, is_pass);
        bet.odds_amount.saturating_add(winnings)
    } else {
        0
    };

    flat_return.saturating_add(odds_return)
}

/// Calculate true odds payout (WINNINGS ONLY)
fn calculate_odds_payout(point: u8, odds_amount: u64, is_pass: bool) -> u64 {
    match point {
        4 | 10 => {
            if is_pass {
                odds_amount.saturating_mul(2) // 2:1
            } else {
                odds_amount.saturating_div(2) // 1:2
            }
        }
        5 | 9 => {
            if is_pass {
                odds_amount.saturating_mul(3).saturating_div(2) // 3:2
            } else {
                odds_amount.saturating_mul(2).saturating_div(3) // 2:3
            }
        }
        6 | 8 => {
            if is_pass {
                odds_amount.saturating_mul(6).saturating_div(5) // 6:5
            } else {
                odds_amount.saturating_mul(5).saturating_div(6) // 5:6
            }
        }
        _ => 0,
    }
}

/// Calculate field bet return (TOTAL RETURN: stake + winnings).
fn calculate_field_payout(total: u8, amount: u64, paytable: FieldPaytable) -> u64 {
    match paytable {
        FieldPaytable::Double2Triple12 => match total {
            2 => amount.saturating_mul(payouts::FIELD_2_OR_12_DOUBLE),
            12 => amount.saturating_mul(payouts::FIELD_12_TRIPLE),
            3 | 4 | 9 | 10 | 11 => amount.saturating_mul(payouts::FIELD_STANDARD),
            _ => 0,
        },
    }
}

/// Calculate YES (place) bet return with a 1% commission on winnings.
/// True odds are based on ways to roll 7 (6) vs ways to roll target.
fn calculate_yes_payout(target: u8, amount: u64, hit: bool) -> u64 {
    if !hit {
        return 0;
    }

    // True odds: 6 / ways_to_roll_target
    let true_odds = match target {
        2 | 12 => amount.saturating_mul(6),                  // 6:1 (1 way to roll)
        3 | 11 => amount.saturating_mul(3),                  // 3:1 (2 ways to roll)
        4 | 10 => amount.saturating_mul(2),                  // 2:1 (3 ways to roll)
        5 | 9 => amount.saturating_mul(3).saturating_div(2), // 3:2 (4 ways to roll)
        6 | 8 => amount.saturating_mul(6).saturating_div(5), // 6:5 (5 ways to roll)
        _ => amount,
    };

    let commission = true_odds.saturating_div(payouts::YES_NO_COMMISSION_DIVISOR);
    let winnings = true_odds.saturating_sub(commission);
    amount.saturating_add(winnings)
}

/// Calculate NO (lay) bet return with a 1% commission on winnings.
/// True odds are based on ways to roll target vs ways to roll 7 (6).
fn calculate_no_payout(target: u8, amount: u64, seven_hit: bool) -> u64 {
    if !seven_hit {
        return 0;
    }

    // True odds: ways_to_roll_target / 6
    let true_odds = match target {
        2 | 12 => amount.saturating_div(6),                  // 1:6 (1 way to roll target)
        3 | 11 => amount.saturating_div(3),                  // 1:3 (2 ways to roll target)
        4 | 10 => amount.saturating_div(2),                  // 1:2 (3 ways to roll target)
        5 | 9 => amount.saturating_mul(2).saturating_div(3), // 2:3 (4 ways to roll target)
        6 | 8 => amount.saturating_mul(5).saturating_div(6), // 5:6 (5 ways to roll target)
        _ => amount,
    };

    let commission = true_odds.saturating_div(payouts::YES_NO_COMMISSION_DIVISOR);
    let winnings = true_odds.saturating_sub(commission);
    amount.saturating_add(winnings)
}


/// Calculate NEXT bet return (TOTAL RETURN: stake + winnings) with a 1% commission on winnings.
fn calculate_next_payout(target: u8, total: u8, amount: u64) -> u64 {
    if total != target {
        return 0;
    }

    // Payout based on probability
    let ways = WAYS.get(target as usize).copied().unwrap_or(0);
    if ways == 0 {
        return 0;
    }
    let multiplier: u64 = match ways {
        1 => payouts::NEXT_1_WAY,   // 2 or 12
        2 => payouts::NEXT_2_WAYS,  // 3 or 11
        3 => payouts::NEXT_3_WAYS,  // 4 or 10
        4 => payouts::NEXT_4_WAYS,  // 5 or 9
        5 => payouts::NEXT_5_WAYS,  // 6 or 8
        6 => payouts::NEXT_6_WAYS,  // 7
        _ => 1,
    };

    let winnings = amount.saturating_mul(multiplier);
    let commission = winnings.saturating_div(payouts::NEXT_COMMISSION_DIVISOR);
    let winnings = winnings.saturating_sub(commission);
    amount.saturating_add(winnings)
}

fn ats_bit_for_total(total: u8) -> u64 {
    match total {
        2 => 1u64 << 0,
        3 => 1u64 << 1,
        4 => 1u64 << 2,
        5 => 1u64 << 3,
        6 => 1u64 << 4,
        8 => 1u64 << 5,
        9 => 1u64 << 6,
        10 => 1u64 << 7,
        11 => 1u64 << 8,
        12 => 1u64 << 9,
        _ => 0,
    }
}

fn ats_required_mask(bet_type: BetType) -> u64 {
    match bet_type {
        BetType::AtsSmall => ATS_SMALL_MASK,
        BetType::AtsTall => ATS_TALL_MASK,
        BetType::AtsAll => ATS_ALL_MASK,
        _ => 0,
    }
}

fn ats_payout_to_1(bet_type: BetType) -> u64 {
    match bet_type {
        BetType::AtsSmall => payouts::ATS_SMALL,
        BetType::AtsTall => payouts::ATS_TALL,
        BetType::AtsAll => payouts::ATS_ALL,
        _ => 0,
    }
}

fn is_point_total(total: u8) -> bool {
    matches!(total, 4 | 5 | 6 | 8 | 9 | 10)
}

fn diff_doubles_payout_to_1(count: u32) -> u64 {
    DIFF_DOUBLES_PAYOUTS_TO_1
        .get(count as usize)
        .copied()
        .unwrap_or(0)
}

fn ride_line_payout_to_1(wins: u64) -> u64 {
    // WoO Ride the Line Pay Table 3 (pays "to 1").
    match wins {
        3 => 1,
        4 => 2,
        5 => 3,
        6 => 6,
        7 => 10,
        8 => 20,
        9 => 30,
        10 => 40,
        w if w >= 11 => 100,
        _ => 0,
    }
}

fn replay_shift_for_point(point: u8) -> Option<u32> {
    match point {
        4 => Some(0),
        5 => Some(4),
        6 => Some(8),
        8 => Some(12),
        9 => Some(16),
        10 => Some(20),
        _ => None,
    }
}

fn replay_payout_to_1(mask: u64) -> u64 {
    let mut payout = 0u64;
    for (point, shift) in [(4, 0u32), (5, 4), (6, 8), (8, 12), (9, 16), (10, 20)] {
        let count = ((mask >> shift) & 0xF) as u8;
        let point_payout = match point {
            4 | 10 => {
                if count >= 4 {
                    1000
                } else if count >= 3 {
                    120
                } else {
                    0
                }
            }
            5 | 9 => {
                if count >= 4 {
                    500
                } else if count >= 3 {
                    95
                } else {
                    0
                }
            }
            6 | 8 => {
                if count >= 4 {
                    100
                } else if count >= 3 {
                    70
                } else {
                    0
                }
            }
            _ => 0,
        };
        payout = payout.max(point_payout);
    }
    payout
}

fn hot_roller_bit_for_roll(d1: u8, d2: u8) -> u64 {
    let (a, b) = if d1 <= d2 { (d1, d2) } else { (d2, d1) };
    match (a, b) {
        (1, 3) => 1u64 << 0,
        (2, 2) => 1u64 << 1,
        (1, 4) => 1u64 << 2,
        (2, 3) => 1u64 << 3,
        (1, 5) => 1u64 << 4,
        (2, 4) => 1u64 << 5,
        (3, 3) => 1u64 << 6,
        (2, 6) => 1u64 << 7,
        (3, 5) => 1u64 << 8,
        (4, 4) => 1u64 << 9,
        (3, 6) => 1u64 << 10,
        (4, 5) => 1u64 << 11,
        (4, 6) => 1u64 << 12,
        (5, 5) => 1u64 << 13,
        _ => 0,
    }
}

fn hot_roller_completed_points(mask: u64) -> u8 {
    let point_masks = [
        (1u64 << 0) | (1u64 << 1),
        (1u64 << 2) | (1u64 << 3),
        (1u64 << 4) | (1u64 << 5) | (1u64 << 6),
        (1u64 << 7) | (1u64 << 8) | (1u64 << 9),
        (1u64 << 10) | (1u64 << 11),
        (1u64 << 12) | (1u64 << 13),
    ];
    point_masks
        .iter()
        .filter(|&&mask_req| (mask & mask_req) == mask_req)
        .count() as u8
}

fn hot_roller_payout_to_1(completed_points: u8) -> u64 {
    HOT_ROLLER_PAYOUTS_TO_1
        .get(completed_points as usize)
        .copied()
        .unwrap_or(0)
}

/// Calculate hardway bet payout
/// Returns Some(payout) if resolved, None if still working
fn calculate_hardway_payout(target: u8, d1: u8, d2: u8, total: u8, amount: u64) -> Option<u64> {
    let is_hard = d1 == d2 && d1.saturating_mul(2) == target;
    let is_easy = !is_hard && total == target;
    let is_seven = total == 7;

    if is_hard {
        // Win!
        let winnings = match target {
            4 | 10 => amount.saturating_mul(payouts::HARDWAY_4_OR_10),
            6 | 8 => amount.saturating_mul(payouts::HARDWAY_6_OR_8),
            _ => amount,
        };
        Some(amount.saturating_add(winnings))
    } else if is_easy || is_seven {
        // Lose
        Some(0)
    } else {
        // Still working
        None
    }
}

// ============================================================================
// Roll Processing
// ============================================================================

/// Process a roll and return bet results
fn process_roll(state: &mut CrapsState, d1: u8, d2: u8) -> Vec<BetResult> {
    let total = d1.saturating_add(d2);
    let phase_before = state.phase;
    let is_seven = total == 7;
    let is_double = d1 == d2;
    let mut results = Vec::with_capacity(state.bets.len());

    // 1. Single-roll bets (FIELD, NEXT) - always resolve
    for (idx, bet) in state.bets.iter().enumerate() {
        if bet.bet_type == BetType::Field {
            results.push(BetResult {
                bet_idx: idx,
                return_amount: calculate_field_payout(total, bet.amount, state.field_paytable),
                wagered: bet.amount,
                resolved: true,
            });
        }
        if bet.bet_type == BetType::Next {
            results.push(BetResult {
                bet_idx: idx,
                return_amount: calculate_next_payout(bet.target, total, bet.amount),
                wagered: bet.amount,
                resolved: true,
            });
        }
    }

    // 2. HARDWAY bets (check for 7 or easy way)
    for (idx, bet) in state.bets.iter().enumerate() {
        if matches!(
            bet.bet_type,
            BetType::Hardway4 | BetType::Hardway6 | BetType::Hardway8 | BetType::Hardway10
        ) {
            let target = match bet.bet_type {
                BetType::Hardway4 => 4,
                BetType::Hardway6 => 6,
                BetType::Hardway8 => 8,
                BetType::Hardway10 => 10,
                _ => continue,
            };
            if let Some(payout) = calculate_hardway_payout(target, d1, d2, total, bet.amount) {
                results.push(BetResult {
                    bet_idx: idx,
                    return_amount: payout,
                    wagered: bet.amount,
                    resolved: true,
                });
            }
        }
    }

    // 3. YES/NO/BUY bets (working bets only)
    for (idx, bet) in state.bets.iter().enumerate() {
        if bet.status != BetStatus::On {
            continue;
        }

        match bet.bet_type {
            BetType::Yes => {
                if total == bet.target {
                    results.push(BetResult {
                        bet_idx: idx,
                        return_amount: calculate_yes_payout(bet.target, bet.amount, true),
                        wagered: bet.amount,
                        resolved: true,
                    });
                } else if total == 7 {
                    results.push(BetResult {
                        bet_idx: idx,
                        return_amount: calculate_yes_payout(bet.target, bet.amount, false),
                        wagered: bet.amount,
                        resolved: true,
                    });
                }
            }
            BetType::No => {
                if total == 7 {
                    results.push(BetResult {
                        bet_idx: idx,
                        return_amount: calculate_no_payout(bet.target, bet.amount, true),
                        wagered: bet.amount,
                        resolved: true,
                    });
                } else if total == bet.target {
                    results.push(BetResult {
                        bet_idx: idx,
                        return_amount: calculate_no_payout(bet.target, bet.amount, false),
                        wagered: bet.amount,
                        resolved: true,
                    });
                }
            }
            _ => {}
        }
    }

    // 4. ATS progress + early wins (resolves immediately when completed).
    let ats_bit = ats_bit_for_total(total);
    if ats_bit != 0 {
        for (idx, bet) in state.bets.iter_mut().enumerate() {
            if !matches!(
                bet.bet_type,
                BetType::AtsSmall | BetType::AtsTall | BetType::AtsAll
            ) {
                continue;
            }
            bet.odds_amount |= ats_bit;
            let required = ats_required_mask(bet.bet_type);
            if required != 0 && (bet.odds_amount & required) == required {
                let mult = ats_payout_to_1(bet.bet_type);
                let return_amount = bet.amount.saturating_mul(mult.saturating_add(1));
                results.push(BetResult {
                    bet_idx: idx,
                    return_amount,
                    wagered: bet.amount,
                    resolved: true,
                });
            }
        }
    }

    // 5. COME/DONT_COME bets
    for (idx, bet) in state.bets.iter_mut().enumerate() {
        match (bet.bet_type, bet.status) {
            (BetType::Come, BetStatus::Pending) => {
                // Act like come-out roll
                match total {
                    7 | 11 => {
                        results.push(BetResult {
                            bet_idx: idx,
                            return_amount: bet.amount.saturating_mul(2),
                            wagered: bet.amount,
                            resolved: true,
                        });
                    }
                    2 | 3 | 12 => {
                        results.push(BetResult {
                            bet_idx: idx,
                            return_amount: 0,
                            wagered: bet.amount,
                            resolved: true,
                        });
                    }
                    _ => {
                        // Travel to point
                        bet.target = total;
                        bet.status = BetStatus::On;
                    }
                }
            }
            (BetType::Come, BetStatus::On) => {
                if total == bet.target {
                    // Win!
                    let odds_payout = calculate_odds_payout(bet.target, bet.odds_amount, true);
                    let total_payout = bet
                        .amount
                        .saturating_mul(2)
                        .saturating_add(bet.odds_amount)
                        .saturating_add(odds_payout);
                    results.push(BetResult {
                        bet_idx: idx,
                        return_amount: total_payout,
                        wagered: bet.amount.saturating_add(bet.odds_amount),
                        resolved: true,
                    });
                } else if total == 7 {
                    // Lose
                    results.push(BetResult {
                        bet_idx: idx,
                        return_amount: 0,
                        wagered: bet.amount.saturating_add(bet.odds_amount),
                        resolved: true,
                    });
                }
            }
            (BetType::DontCome, BetStatus::Pending) => {
                match total {
                    2 | 3 => {
                        results.push(BetResult {
                            bet_idx: idx,
                            return_amount: bet.amount.saturating_mul(2),
                            wagered: bet.amount,
                            resolved: true,
                        });
                    }
                    12 => {
                        // Push
                        results.push(BetResult {
                            bet_idx: idx,
                            return_amount: bet.amount,
                            wagered: bet.amount,
                            resolved: true,
                        });
                    }
                    7 | 11 => {
                        results.push(BetResult {
                            bet_idx: idx,
                            return_amount: 0,
                            wagered: bet.amount,
                            resolved: true,
                        });
                    }
                    _ => {
                        bet.target = total;
                        bet.status = BetStatus::On;
                    }
                }
            }
            (BetType::DontCome, BetStatus::On) => {
                if total == 7 {
                    // Win!
                    let odds_payout = calculate_odds_payout(bet.target, bet.odds_amount, false);
                    let total_payout = bet
                        .amount
                        .saturating_mul(2)
                        .saturating_add(bet.odds_amount)
                        .saturating_add(odds_payout);
                    results.push(BetResult {
                        bet_idx: idx,
                        return_amount: total_payout,
                        wagered: bet.amount.saturating_add(bet.odds_amount),
                        resolved: true,
                    });
                } else if total == bet.target {
                    results.push(BetResult {
                        bet_idx: idx,
                        return_amount: 0,
                        wagered: bet.amount.saturating_add(bet.odds_amount),
                        resolved: true,
                    });
                }
            }
            _ => {}
        }
    }

    // 6. PASS/DONT_PASS
    process_pass_bets(state, total, &mut results);

    // 7. Update phase and main point
    let phase_event = update_phase(state, total);
    let point_established = if let PhaseEvent::PointEstablished(point) = phase_event {
        Some(point)
    } else {
        None
    };
    let point_made = if let PhaseEvent::PointMade(point) = phase_event {
        Some(point)
    } else {
        None
    };
    let seven_out = matches!(phase_event, PhaseEvent::SevenOut);

    if let Some(point) = point_established {
        // Fix pass/don't pass odds tracking: set bet.target to the main point.
        for bet in state.bets.iter_mut() {
            if matches!(bet.bet_type, BetType::Pass | BetType::DontPass)
                && bet.status == BetStatus::On
            {
                bet.target = point;
            }
        }
    }

    if let Some(point) = point_made {
        if let Some(bit) = point_to_fire_bit(point) {
            state.made_points_mask |= 1u8 << bit;
        }
    }

    // Bonus bet progress and resolution.
    for (idx, bet) in state.bets.iter_mut().enumerate() {
        match bet.bet_type {
            BetType::Muggsy => {
                let stage = bet.odds_amount;
                if stage == 0 {
                    if phase_before != Phase::ComeOut {
                        results.push(BetResult {
                            bet_idx: idx,
                            return_amount: 0,
                            wagered: bet.amount,
                            resolved: true,
                        });
                    } else if total == 7 {
                        let return_amount =
                            bet.amount.saturating_mul(MUGGSY_COME_OUT_PAYOUT_TO_1.saturating_add(1));
                        results.push(BetResult {
                            bet_idx: idx,
                            return_amount,
                            wagered: bet.amount,
                            resolved: true,
                        });
                    } else if point_established.is_some() && is_point_total(total) {
                        bet.odds_amount = 1;
                    } else {
                        results.push(BetResult {
                            bet_idx: idx,
                            return_amount: 0,
                            wagered: bet.amount,
                            resolved: true,
                        });
                    }
                } else {
                    let return_amount = if total == 7 {
                        bet.amount
                            .saturating_mul(MUGGSY_POINT_SEVEN_PAYOUT_TO_1.saturating_add(1))
                    } else {
                        0
                    };
                    results.push(BetResult {
                        bet_idx: idx,
                        return_amount,
                        wagered: bet.amount,
                        resolved: true,
                    });
                }
            }
            BetType::DiffDoubles => {
                if is_double {
                    let bit = 1u64 << u32::from(d1.saturating_sub(1));
                    bet.odds_amount |= bit;
                }
                if is_seven {
                    let count = bet.odds_amount.count_ones();
                    let mult = diff_doubles_payout_to_1(count);
                    let return_amount = if mult == 0 {
                        0
                    } else {
                        bet.amount.saturating_mul(mult.saturating_add(1))
                    };
                    results.push(BetResult {
                        bet_idx: idx,
                        return_amount,
                        wagered: bet.amount,
                        resolved: true,
                    });
                }
            }
            BetType::RideLine => {
                if phase_before == Phase::ComeOut && matches!(total, 7 | 11) {
                    bet.odds_amount = bet.odds_amount.saturating_add(1);
                }
                if point_made.is_some() {
                    bet.odds_amount = bet.odds_amount.saturating_add(1);
                }
                if seven_out {
                    let mult = ride_line_payout_to_1(bet.odds_amount);
                    let return_amount = if mult == 0 {
                        0
                    } else {
                        bet.amount.saturating_mul(mult.saturating_add(1))
                    };
                    results.push(BetResult {
                        bet_idx: idx,
                        return_amount,
                        wagered: bet.amount,
                        resolved: true,
                    });
                }
            }
            BetType::Replay => {
                if let Some(point) = point_made {
                    if let Some(shift) = replay_shift_for_point(point) {
                        let mask = 0xF_u64 << shift;
                        let current = (bet.odds_amount & mask) >> shift;
                        let next = (current.saturating_add(1)).min(0xF);
                        bet.odds_amount = (bet.odds_amount & !mask) | (next << shift);
                    }
                }
                if seven_out {
                    let mult = replay_payout_to_1(bet.odds_amount);
                    let return_amount = if mult == 0 {
                        0
                    } else {
                        bet.amount.saturating_mul(mult.saturating_add(1))
                    };
                    results.push(BetResult {
                        bet_idx: idx,
                        return_amount,
                        wagered: bet.amount,
                        resolved: true,
                    });
                }
            }
            BetType::HotRoller => {
                let bit = hot_roller_bit_for_roll(d1, d2);
                if bit != 0 {
                    bet.odds_amount |= bit;
                }
                if is_seven {
                    // Hot Roller resolves on any 7 (WoO rules).
                    let completed = hot_roller_completed_points(bet.odds_amount);
                    let mult = hot_roller_payout_to_1(completed);
                    let return_amount = if mult == 0 {
                        0
                    } else {
                        bet.amount.saturating_mul(mult.saturating_add(1))
                    };
                    results.push(BetResult {
                        bet_idx: idx,
                        return_amount,
                        wagered: bet.amount,
                        resolved: true,
                    });
                }
            }
            _ => {}
        }
    }

    // Fire bet resolves on seven-out.
    if seven_out {
        let points_made = state.made_points_mask.count_ones() as u8;
        let mult = fire_bet_multiplier(points_made);
        for (idx, bet) in state.bets.iter().enumerate() {
            if bet.bet_type != BetType::Fire {
                continue;
            }
            let return_amount = if mult == 0 {
                0
            } else {
                bet.amount.saturating_mul(mult.saturating_add(1))
            };
            results.push(BetResult {
                bet_idx: idx,
                return_amount,
                wagered: bet.amount,
                resolved: true,
            });
        }
    }

    // ATS bets lose on any 7 if not already completed.
    if is_seven {
        for (idx, bet) in state.bets.iter().enumerate() {
            if !matches!(
                bet.bet_type,
                BetType::AtsSmall | BetType::AtsTall | BetType::AtsAll
            ) {
                continue;
            }
            results.push(BetResult {
                bet_idx: idx,
                return_amount: 0,
                wagered: bet.amount,
                resolved: true,
            });
        }
    }

    if seven_out {
        state.made_points_mask = 0;
    }

    results
}

/// Process PASS/DONT_PASS bets based on phase
fn process_pass_bets(state: &CrapsState, total: u8, results: &mut Vec<BetResult>) {
    for (idx, bet) in state.bets.iter().enumerate() {
        match (bet.bet_type, state.phase) {
            (BetType::Pass, Phase::ComeOut) => {
                match total {
                    7 | 11 => {
                        // Win on come out
                        results.push(BetResult {
                            bet_idx: idx,
                            return_amount: bet.amount.saturating_mul(2),
                            wagered: bet.amount,
                            resolved: true,
                        });
                    }
                    2 | 3 | 12 => {
                        // Lose on come out (craps)
                        results.push(BetResult {
                            bet_idx: idx,
                            return_amount: 0,
                            wagered: bet.amount,
                            resolved: true,
                        });
                    }
                    _ => {
                        // Point established - bet stays
                    }
                }
            }
            (BetType::Pass, Phase::Point) => {
                if total == state.main_point {
                    // Hit the point - win
                    let return_amount = calculate_pass_return(bet, true, true);
                    results.push(BetResult {
                        bet_idx: idx,
                        return_amount,
                        wagered: bet.amount.saturating_add(bet.odds_amount),
                        resolved: true,
                    });
                } else if total == 7 {
                    // Seven out - lose
                    results.push(BetResult {
                        bet_idx: idx,
                        return_amount: 0,
                        wagered: bet.amount.saturating_add(bet.odds_amount),
                        resolved: true,
                    });
                }
            }
            (BetType::DontPass, Phase::ComeOut) => {
                match total {
                    7 | 11 => {
                        // Lose on come out
                        results.push(BetResult {
                            bet_idx: idx,
                            return_amount: 0,
                            wagered: bet.amount,
                            resolved: true,
                        });
                    }
                    2 | 3 => {
                        // Win on come out (craps)
                        results.push(BetResult {
                            bet_idx: idx,
                            return_amount: bet.amount.saturating_mul(2),
                            wagered: bet.amount,
                            resolved: true,
                        });
                    }
                    12 => {
                        // Push on 12 (bar)
                        results.push(BetResult {
                            bet_idx: idx,
                            return_amount: bet.amount,
                            wagered: bet.amount,
                            resolved: true,
                        });
                    }
                    _ => {
                        // Point established - bet stays
                    }
                }
            }
            (BetType::DontPass, Phase::Point) => {
                if total == 7 {
                    // Seven out - win for don't pass
                    let return_amount = calculate_pass_return(bet, true, false);
                    results.push(BetResult {
                        bet_idx: idx,
                        return_amount,
                        wagered: bet.amount.saturating_add(bet.odds_amount),
                        resolved: true,
                    });
                } else if total == state.main_point {
                    // Hit the point - lose for don't pass
                    results.push(BetResult {
                        bet_idx: idx,
                        return_amount: 0,
                        wagered: bet.amount.saturating_add(bet.odds_amount),
                        resolved: true,
                    });
                }
            }
            _ => {}
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PhaseEvent {
    None,
    PointEstablished(u8),
    PointMade(u8),
    SevenOut,
}

fn point_to_fire_bit(point: u8) -> Option<u8> {
    match point {
        4 => Some(0),
        5 => Some(1),
        6 => Some(2),
        8 => Some(3),
        9 => Some(4),
        10 => Some(5),
        _ => None,
    }
}

fn fire_bet_multiplier(points_made: u8) -> u64 {
    // WoO Fire Bet Pay Table A (pays "to 1"): 4->24, 5->249, 6->999.
    // https://wizardofodds.com/games/craps/side-bets/fire-bet/
    match points_made {
        4 => payouts::FIRE_4_POINTS,
        5 => payouts::FIRE_5_POINTS,
        6 => payouts::FIRE_6_POINTS,
        _ => 0,
    }
}

/// Update phase and main point after a roll.
fn update_phase(state: &mut CrapsState, total: u8) -> PhaseEvent {
    match state.phase {
        Phase::ComeOut => {
            if ![2, 3, 7, 11, 12].contains(&total) {
                state.phase = Phase::Point;
                state.main_point = total;
                state.epoch_point_established = true;
                PhaseEvent::PointEstablished(total)
            } else {
                PhaseEvent::None
            }
        }
        Phase::Point => {
            if total == state.main_point {
                let point = state.main_point;
                state.phase = Phase::ComeOut;
                state.main_point = 0;
                PhaseEvent::PointMade(point)
            } else if total == 7 {
                state.phase = Phase::ComeOut;
                state.main_point = 0;
                state.epoch_point_established = false;
                PhaseEvent::SevenOut
            } else {
                PhaseEvent::None
            }
        }
    }
}

// ============================================================================
// CasinoGame Implementation
// ============================================================================

pub struct Craps;

impl CasinoGame for Craps {
    fn init(session: &mut GameSession, _rng: &mut GameRng) -> GameResult {
        let state = CrapsState {
            phase: Phase::ComeOut,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: FieldPaytable::default(),
            bets: Vec::new(),
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

        // Parse state (or initialize if legacy-empty).
        let mut state = if session.state_blob.is_empty() {
            CrapsState {
                phase: Phase::ComeOut,
                main_point: 0,
                d1: 0,
                d2: 0,
                made_points_mask: 0,
                epoch_point_established: false,
                field_paytable: FieldPaytable::default(),
                bets: Vec::new(),
            }
        } else {
            parse_state(&session.state_blob).ok_or(GameError::InvalidPayload)?
        };

        if payload.is_empty() {
            return Err(GameError::InvalidPayload);
        }

        match payload[0] {
            // [0, bet_type, target, amount_bytes...] - Place bet
            0 => {
                let (bet_type, target, amount) = super::payload::parse_place_bet_payload(payload)?;
                let bet_type =
                    BetType::try_from(bet_type).map_err(|_| GameError::InvalidPayload)?;

                // Validate bet
                super::payload::ensure_nonzero_amount(amount)?;
                if state.bets.len() >= limits::CRAPS_MAX_BETS {
                    return Err(GameError::InvalidMove);
                }

                // Validate target + timing rules.
                match bet_type {
                    BetType::Pass
                    | BetType::DontPass
                    | BetType::Field
                    | BetType::Fire
                    | BetType::AtsSmall
                    | BetType::AtsTall
                    | BetType::AtsAll
                    | BetType::Muggsy
                    | BetType::DiffDoubles
                    | BetType::RideLine
                    | BetType::Replay
                    | BetType::HotRoller => {
                        if target != 0 {
                            return Err(GameError::InvalidPayload);
                        }
                    }
                    BetType::Come | BetType::DontCome => {
                        if target != 0 {
                            return Err(GameError::InvalidPayload);
                        }
                        // Come/DontCome are only allowed once a point is established.
                        if state.phase != Phase::Point {
                            return Err(GameError::InvalidMove);
                        }
                    }
                    BetType::Yes | BetType::No => {
                        // Accept all totals 2-12 except 7
                        if !(2..=12).contains(&target) || target == 7 {
                            return Err(GameError::InvalidPayload);
                        }
                    }
                    BetType::Next => {
                        if !(2..=12).contains(&target) {
                            return Err(GameError::InvalidPayload);
                        }
                    }
                    BetType::Hardway4
                    | BetType::Hardway6
                    | BetType::Hardway8
                    | BetType::Hardway10 => {
                        if target != 0 {
                            return Err(GameError::InvalidPayload);
                        }
                    }
                }

                let has_rolled = state.d1 != 0 || state.d2 != 0;
                let last_total = state.d1.saturating_add(state.d2);
                let can_place_bonus = !state.epoch_point_established
                    && (!has_rolled || (state.phase == Phase::ComeOut && last_total == 7));
                if matches!(
                    bet_type,
                    BetType::Fire
                        | BetType::AtsSmall
                        | BetType::AtsTall
                        | BetType::AtsAll
                        | BetType::Muggsy
                        | BetType::DiffDoubles
                        | BetType::RideLine
                        | BetType::Replay
                        | BetType::HotRoller
                ) {
                    // Bonus bets are tracked for the entire shooter epoch.
                    // Allow placement before any roll, and also after a 7 (no-point roll)
                    // so long as a point has not yet been established in the current epoch.
                    if !can_place_bonus {
                        return Err(GameError::InvalidMove);
                    }
                }

                if bet_type == BetType::Fire
                    && state.bets.iter().any(|b| b.bet_type == BetType::Fire)
                {
                    return Err(GameError::InvalidMove);
                }

                // Determine initial status
                let status = match bet_type {
                    BetType::Come | BetType::DontCome => BetStatus::Pending,
                    _ => BetStatus::On,
                };

                state.bets.push(CrapsBet {
                    bet_type,
                    target,
                    status,
                    amount,
                    odds_amount: 0,
                });

                session.state_blob = serialize_state(&state);

                let deduction_i64 =
                    i64::try_from(amount).map_err(|_| GameError::InvalidPayload)?;
                Ok(GameResult::ContinueWithUpdate {
                    payout: -deduction_i64,
                    logs: vec![],
                })
            }

            // [1, amount_bytes...] - Add odds to last contract bet
            1 => {
                if payload.len() < 9 {
                    return Err(GameError::InvalidPayload);
                }
                let odds_amount = u64::from_be_bytes(
                    payload[1..9]
                        .try_into()
                        .map_err(|_| GameError::InvalidPayload)?,
                );
                if odds_amount == 0 {
                    return Err(GameError::InvalidPayload);
                }

                // Find last contract bet (PASS, DONT_PASS, COME, DONT_COME with status ON)
                let mut found = false;
                for bet in state.bets.iter_mut().rev() {
                    if matches!(
                        bet.bet_type,
                        BetType::Pass | BetType::DontPass | BetType::Come | BetType::DontCome
                    ) && bet.status == BetStatus::On
                    {
                        if ![4u8, 5, 6, 8, 9, 10].contains(&bet.target) {
                            return Err(GameError::InvalidMove);
                        }
                        // Use checked_add to prevent overflow - reject if it would overflow
                        // (otherwise player gets charged but odds amount doesn't increase)
                        bet.odds_amount = bet
                            .odds_amount
                            .checked_add(odds_amount)
                            .ok_or(GameError::InvalidPayload)?;
                        found = true;
                        break;
                    }
                }

                if !found {
                    return Err(GameError::InvalidMove);
                }

                session.state_blob = serialize_state(&state);
                Ok(GameResult::ContinueWithUpdate {
                    payout: -(odds_amount as i64),
                    logs: vec![],
                })
            }

            // [2] - Roll dice
            2 => {
                if state.bets.is_empty() {
                    return Err(GameError::InvalidMove);
                }
                let d1 = rng.roll_die();
                let d2 = rng.roll_die();
                state.d1 = d1;
                state.d2 = d2;

                // Capture bet info before processing (for logs)
                let mut bets_snapshot = Vec::with_capacity(state.bets.len());
                for bet in &state.bets {
                    bets_snapshot.push((bet.bet_type, bet.target, bet.amount, bet.odds_amount));
                }

                // Process roll
                let results = process_roll(&mut state, d1, d2);

                // Calculate credited return, total wagered, and (for completion reporting) loss amount.
                let mut total_return: u64 = 0;
                let mut total_wagered: u64 = 0;
                let mut total_loss: u64 = 0;
                let mut resolved_indices = Vec::with_capacity(state.bets.len());
                let mut resolved_bets: Vec<(BetType, u8, u64, u64, u64)> =
                    Vec::with_capacity(results.len());

                for result in results {
                    if result.resolved {
                        total_return = total_return.saturating_add(result.return_amount);
                        total_wagered = total_wagered.saturating_add(result.wagered);
                        if result.return_amount == 0 {
                            total_loss = total_loss.saturating_add(result.wagered);
                        }
                        // Capture resolved bet info for logs
                        let (bet_type, target, _, odds) = bets_snapshot[result.bet_idx];
                        resolved_bets.push((bet_type, target, result.wagered, result.return_amount, odds));
                        resolved_indices.push(result.bet_idx);
                    }
                }

                // Remove resolved bets (in reverse order to maintain indices)
                resolved_indices.sort_unstable();
                for idx in resolved_indices.iter().rev() {
                    state.bets.remove(*idx);
                }

                // Update state
                session.state_blob = serialize_state(&state);

                // Check if game is complete (no bets left)
                if state.bets.is_empty() {
                    session.is_complete = true;
                    // Determine if this is a pure push (all bets returned stake, no wins/losses)
                    let is_pure_push = total_return == total_wagered && total_loss == 0 && total_wagered > 0;
                    let final_return = if !is_pure_push && total_return > 0 && session.super_mode.is_active {
                        let dice_total = d1.saturating_add(d2);
                        apply_super_multiplier_total(
                            dice_total,
                            &session.super_mode.multipliers,
                            total_return,
                        )
                    } else {
                        total_return
                    };

                    // Generate logs for completed game
                    let logs = generate_craps_logs(&state, &resolved_bets, total_wagered, final_return);

                    if is_pure_push {
                        // All bets pushed - return stake without double modifier
                        Ok(GameResult::Push(total_wagered, logs))
                    } else if total_return > 0 {
                        Ok(GameResult::Win(final_return, logs))
                    } else {
                        Ok(GameResult::LossPreDeducted(total_loss, logs))
                    }
                } else {
                    // Game continues with active bets
                    // Credit any wins/pushes this roll; losses were already deducted at placement.
                    // Generate logs showing this roll's results
                    let logs = generate_craps_logs(&state, &resolved_bets, total_wagered, total_return);
                    if total_return > 0 {
                        let payout =
                            i64::try_from(total_return).map_err(|_| GameError::InvalidMove)?;
                        Ok(GameResult::ContinueWithUpdate { payout, logs })
                    } else {
                        Ok(GameResult::Continue(logs))
                    }
                }
            }

            // [3] - Clear all bets (only before first roll, with refund)
            3 => {
                if state.d1 != 0 || state.d2 != 0 {
                    return Err(GameError::InvalidMove);
                }

                // Calculate total to refund (bets were deducted via ContinueWithUpdate)
                // Craps bets have both base amount and odds amount
                let refund: u64 = state
                    .bets
                    .iter()
                    .map(|b| b.amount.saturating_add(b.odds_amount))
                    .sum();
                state.bets.clear();
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

            // [4, bet_count, bets...] - Atomic batch: place all bets + roll in one transaction
            // Each bet is 10 bytes: [bet_type:u8, target:u8, amount:u64 BE]
            // This ensures all-or-nothing semantics - no partial bet states
            // Note: Odds cannot be added in atomic batch - use action 1 after if needed
            4 => {
                // Only works before first roll
                if state.d1 != 0 || state.d2 != 0 {
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
                if bet_count == 0 || bet_count > limits::CRAPS_MAX_BETS {
                    return Err(GameError::InvalidPayload);
                }

                // Expected payload size: 2 (action + count) + bet_count * 10 (type + target + amount)
                let expected_len = 2 + bet_count * 10;
                if payload.len() < expected_len {
                    return Err(GameError::InvalidPayload);
                }

                // Parse and validate all bets first (before any state changes)
                let mut bets_to_place: Vec<CrapsBet> = Vec::with_capacity(bet_count);
                let mut total_wager: u64 = 0;
                let mut offset = 2;

                for _ in 0..bet_count {
                    let bet_type = BetType::try_from(payload[offset])
                        .map_err(|_| GameError::InvalidPayload)?;
                    let target = payload[offset + 1];
                    let amount = u64::from_be_bytes(
                        payload[offset + 2..offset + 10]
                            .try_into()
                            .map_err(|_| GameError::InvalidPayload)?,
                    );

                    if amount == 0 {
                        return Err(GameError::InvalidPayload);
                    }

                    // Validate bet type/target combinations (simplified - full validation in action 0)
                    // Yes (Place), No (Lay) need targets 2-12 excluding 7
                    if matches!(bet_type, BetType::Yes | BetType::No)
                        && (!(2..=12).contains(&target) || target == 7)
                    {
                        return Err(GameError::InvalidPayload);
                    }

                    // Check for overflow in total wager
                    let bet_cost = amount;

                    total_wager = total_wager
                        .checked_add(bet_cost)
                        .ok_or(GameError::InvalidPayload)?;

                    // Determine initial status
                    let status = match bet_type {
                        BetType::Come | BetType::DontCome => BetStatus::Pending,
                        _ => BetStatus::On,
                    };

                    bets_to_place.push(CrapsBet {
                        bet_type,
                        target,
                        status,
                        amount,
                        odds_amount: 0,
                    });

                    offset += 10;
                }

                session.bet = total_wager;

                // All validation passed - now execute atomically
                state.bets = bets_to_place;

                // Roll the dice
                let d1 = rng.roll_die();
                let d2 = rng.roll_die();
                state.d1 = d1;
                state.d2 = d2;

                // Capture bet info before processing (for logs)
                let mut bets_snapshot = Vec::with_capacity(state.bets.len());
                for bet in &state.bets {
                    bets_snapshot.push((bet.bet_type, bet.target, bet.amount, bet.odds_amount));
                }

                // Process the roll
                let results = process_roll(&mut state, d1, d2);

                // Calculate results
                let mut total_return: u64 = 0;
                let mut total_resolved_wagered: u64 = 0;
                let mut total_loss: u64 = 0;
                let mut resolved_indices = Vec::with_capacity(state.bets.len());
                let mut resolved_bets: Vec<(BetType, u8, u64, u64, u64)> =
                    Vec::with_capacity(results.len());

                for result in results {
                    if result.resolved {
                        total_return = total_return.saturating_add(result.return_amount);
                        total_resolved_wagered = total_resolved_wagered.saturating_add(result.wagered);
                        if result.return_amount == 0 {
                            total_loss = total_loss.saturating_add(result.wagered);
                        }
                        // Capture resolved bet info for logs
                        let (bet_type, target, _, odds) = bets_snapshot[result.bet_idx];
                        resolved_bets.push((bet_type, target, result.wagered, result.return_amount, odds));
                        resolved_indices.push(result.bet_idx);
                    }
                }

                // Remove resolved bets
                resolved_indices.sort_unstable();
                for idx in resolved_indices.iter().rev() {
                    state.bets.remove(*idx);
                }

                session.state_blob = serialize_state(&state);

                // Check if game is complete
                if state.bets.is_empty() {
                    session.is_complete = true;
                    // Determine if this is a pure push (all bets returned stake, no wins/losses)
                    let is_pure_push = total_return == total_resolved_wagered && total_loss == 0 && total_resolved_wagered > 0;
                    let final_return = if !is_pure_push && total_return > 0 && session.super_mode.is_active {
                        let dice_total = d1.saturating_add(d2);
                        apply_super_multiplier_total(
                            dice_total,
                            &session.super_mode.multipliers,
                            total_return,
                        )
                    } else {
                        total_return
                    };

                    // Generate logs for completed game
                    let logs = generate_craps_logs(&state, &resolved_bets, total_resolved_wagered, final_return);

                    if is_pure_push {
                        // All bets pushed - return stake without double modifier
                        Ok(GameResult::Push(total_wager, logs))
                    } else if total_return > 0 {
                        Ok(GameResult::Win(final_return, logs))
                    } else {
                        // Total loss - wager is deducted on completion for atomic batch
                        Ok(GameResult::Loss(logs))
                    }
                } else {
                    // Game continues - return net result
                    // For atomic batch: player paid total_wager (+ super fee), received total_return
                    // Net = total_return - total_cost (can be negative)
                    // Generate logs showing this roll's results
                    let logs = generate_craps_logs(&state, &resolved_bets, total_resolved_wagered, total_return);
                    let super_fee = if session.super_mode.is_active {
                        crate::casino::get_super_mode_fee(total_wager)
                    } else {
                        0
                    };
                    let total_cost = total_wager.saturating_add(super_fee);
                    if total_return > total_cost {
                        // Net win on first roll (after fee)
                        let net_win = total_return.saturating_sub(total_cost);
                        Ok(GameResult::ContinueWithUpdate {
                            payout: net_win as i64,
                            logs,
                        })
                    } else if total_return < total_cost {
                        // Net loss on first roll, but game continues
                        // Player paid total_wager + fee, got back total_return
                        // Report via ContinueWithUpdate with negative delta
                        let net_loss = total_cost.saturating_sub(total_return);
                        Ok(GameResult::ContinueWithUpdate {
                            payout: -(net_loss as i64),
                            logs,
                        })
                    } else {
                        // Break-even
                        Ok(GameResult::Continue(logs))
                    }
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
            game_type: GameType::Craps,
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

    fn state_with_bets(
        phase: Phase,
        main_point: u8,
        bets: Vec<CrapsBet>,
    ) -> CrapsState {
        CrapsState {
            phase,
            main_point,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: phase == Phase::Point,
            field_paytable: FieldPaytable::default(),
            bets,
        }
    }

    fn assert_single_result(
        results: Vec<BetResult>,
        expected_return: u64,
        expected_wagered: u64,
    ) {
        assert_eq!(results.len(), 1);
        let result = results.into_iter().next().unwrap();
        assert!(result.resolved);
        assert_eq!(result.return_amount, expected_return);
        assert_eq!(result.wagered, expected_wagered);
    }

    fn atomic_payload(bets: &[(BetType, u8, u64)]) -> Vec<u8> {
        let mut payload = Vec::with_capacity(2 + bets.len() * 10);
        payload.push(4);
        payload.push(bets.len() as u8);
        for (bet_type, target, amount) in bets {
            payload.push(*bet_type as u8);
            payload.push(*target);
            payload.extend_from_slice(&amount.to_be_bytes());
        }
        payload
    }

    #[test]
    fn test_bet_serialization() {
        let bet = CrapsBet {
            bet_type: BetType::Pass,
            target: 6,
            status: BetStatus::On,
            amount: 100,
            odds_amount: 50,
        };

        let bytes = bet.to_bytes();
        assert_eq!(bytes.len(), 19);

        let deserialized = CrapsBet::from_bytes(&bytes).expect("Failed to parse bet");
        assert_eq!(deserialized, bet);
    }

    #[test]
    fn test_state_serialization() {
        let state = CrapsState {
            phase: Phase::Point,
            main_point: 6,
            d1: 3,
            d2: 3,
            made_points_mask: 0b001011, // arbitrary
            epoch_point_established: true,
            field_paytable: FieldPaytable::default(),
            bets: vec![
                CrapsBet {
                    bet_type: BetType::Pass,
                    target: 0,
                    status: BetStatus::On,
                    amount: 100,
                    odds_amount: 50,
                },
                CrapsBet {
                    bet_type: BetType::Field,
                    target: 0,
                    status: BetStatus::On,
                    amount: 25,
                    odds_amount: 0,
                },
            ],
        };

        let blob = serialize_state(&state);
        assert_eq!(blob[0], STATE_VERSION);
        assert_eq!(blob[1], Phase::Point as u8);
        assert_eq!(blob[2], 6);
        assert_eq!(blob[5], state.made_points_mask);
        assert_eq!(blob[6], 1); // epoch_point_established
        assert_eq!(blob[7], 2); // bet count

        let deserialized = parse_state(&blob).expect("Failed to parse state");
        assert_eq!(deserialized.phase, state.phase);
        assert_eq!(deserialized.main_point, state.main_point);
        assert_eq!(deserialized.made_points_mask, state.made_points_mask);
        assert_eq!(
            deserialized.epoch_point_established,
            state.epoch_point_established
        );
        assert_eq!(deserialized.bets.len(), 2);
    }

    #[test]
    fn test_state_blob_fuzz_does_not_panic() {
        let mut rng = StdRng::seed_from_u64(0x5eed_5eed);
        for _ in 0..1_000 {
            let len = rng.gen_range(0..=256);
            let mut blob = vec![0u8; len];
            rng.fill(&mut blob[..]);
            let _ = parse_state(&blob);
        }
    }

    /// US-147: Validate that corrupted made_points_mask values are rejected.
    /// Fire Bet has 999:1 payout for 6 points. Invalid masks could drain bankroll.
    #[test]
    fn test_invalid_made_points_mask_rejected() {
        // Build a valid state blob, then corrupt the made_points_mask byte
        let valid_state = CrapsState {
            phase: Phase::ComeOut,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0b0011_1111, // All 6 valid points made
            epoch_point_established: false,
            field_paytable: FieldPaytable::default(),
            bets: Vec::new(),
        };

        let mut blob = serialize_state(&valid_state);
        assert!(parse_state(&blob).is_some(), "Valid state should parse");

        // Byte 5 is made_points_mask. Valid values are 0x00-0x3F (bits 0-5).
        // Test that any value with bits 6 or 7 set is rejected.

        // Test bit 6 set (0x40)
        blob[5] = 0b0100_0000;
        assert!(
            parse_state(&blob).is_none(),
            "Mask 0x40 (bit 6) should be rejected"
        );

        // Test bit 7 set (0x80)
        blob[5] = 0b1000_0000;
        assert!(
            parse_state(&blob).is_none(),
            "Mask 0x80 (bit 7) should be rejected"
        );

        // Test both bits 6 and 7 set (0xC0)
        blob[5] = 0b1100_0000;
        assert!(
            parse_state(&blob).is_none(),
            "Mask 0xC0 (bits 6-7) should be rejected"
        );

        // Test maximum invalid value (0xFF - all bits set)
        blob[5] = 0xFF;
        assert!(
            parse_state(&blob).is_none(),
            "Mask 0xFF should be rejected"
        );

        // Test boundary: 0x3F should be valid (max valid value)
        blob[5] = 0b0011_1111;
        assert!(
            parse_state(&blob).is_some(),
            "Mask 0x3F (all 6 points) should be valid"
        );

        // Test boundary: 0x40 should be invalid (min invalid value)
        blob[5] = 0b0100_0000;
        assert!(
            parse_state(&blob).is_none(),
            "Mask 0x40 should be rejected"
        );
    }

    #[test]
    fn test_field_payout() {
        // Payouts are TOTAL RETURN (stake + winnings)
        assert_eq!(
            calculate_field_payout(2, 100, FieldPaytable::Double2Triple12),
            300
        ); // 2:1 -> 3x total
        assert_eq!(
            calculate_field_payout(12, 100, FieldPaytable::Double2Triple12),
            400
        ); // 3:1 -> 4x total
        assert_eq!(
            calculate_field_payout(3, 100, FieldPaytable::Double2Triple12),
            200
        ); // 1:1 -> 2x total
        assert_eq!(
            calculate_field_payout(11, 100, FieldPaytable::Double2Triple12),
            200
        ); // 1:1 -> 2x total
        assert_eq!(
            calculate_field_payout(7, 100, FieldPaytable::Double2Triple12),
            0
        ); // lose
    }

    #[test]
    fn test_field_payout_triple_twelve() {
        assert_eq!(
            calculate_field_payout(2, 100, FieldPaytable::Double2Triple12),
            300
        ); // 2:1 -> 3x total
        assert_eq!(
            calculate_field_payout(12, 100, FieldPaytable::Double2Triple12),
            400
        ); // 3:1 -> 4x total
    }

    #[test]
    fn test_odds_payouts() {
        // Pass odds: 4 pays 2:1
        assert_eq!(calculate_odds_payout(4, 100, true), 200);
        // Don't pass odds: 4 pays 1:2
        assert_eq!(calculate_odds_payout(4, 100, false), 50);
        // Pass odds: 6 pays 6:5
        assert_eq!(calculate_odds_payout(6, 120, true), 144);
        // Don't pass odds: 6 pays 5:6
        assert_eq!(calculate_odds_payout(6, 120, false), 100);
    }

    #[test]
    fn test_yes_payout() {
        // YES pays true odds with a 1% commission on winnings.
        // 6:5 on a 60 bet -> 72 winnings + 60 stake = 132 total.
        assert_eq!(calculate_yes_payout(6, 60, true), 132);
        // Miss
        assert_eq!(calculate_yes_payout(6, 60, false), 0);
    }

    #[test]
    fn test_no_payout() {
        // NO pays true odds with a 1% commission on winnings.
        // Target 4: 1:2 on 500 -> 250 winnings - 2 commission = 248; total return 748.
        assert_eq!(calculate_no_payout(4, 500, true), 748);
        // Target 6: 5:6 on 120 -> 100 winnings - 1 commission = 99; total return 219.
        assert_eq!(calculate_no_payout(6, 120, true), 219);
        // Miss
        assert_eq!(calculate_no_payout(6, 120, false), 0);
    }

    #[test]
    fn test_next_payout() {
        // NEXT pays with a 1% commission on winnings.
        assert_eq!(calculate_next_payout(7, 7, 100), 595); // winnings 500 -> -5 commission
        assert_eq!(calculate_next_payout(2, 2, 100), 3565); // winnings 3500 -> -35 commission
                                                            // Miss
        assert_eq!(calculate_next_payout(7, 6, 100), 0);
    }

    #[test]
    fn test_next_bet_resolves_on_hit_and_miss() {
        let amount = 25;
        let bet = CrapsBet {
            bet_type: BetType::Next,
            target: 9,
            status: BetStatus::On,
            amount,
            odds_amount: 0,
        };

        let mut state = state_with_bets(Phase::ComeOut, 0, vec![bet.clone()]);
        let results = process_roll(&mut state, 4, 5); // 9 hits
        let expected = calculate_next_payout(9, 9, amount);
        assert_single_result(results, expected, amount);

        let mut state = state_with_bets(Phase::ComeOut, 0, vec![bet]);
        let results = process_roll(&mut state, 3, 4); // 7 misses
        assert_single_result(results, 0, amount);
    }

    #[test]
    fn test_ats_small_completes_and_pays() {
        let mut state = CrapsState {
            phase: Phase::ComeOut,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: FieldPaytable::default(),
            bets: vec![CrapsBet {
                bet_type: BetType::AtsSmall,
                target: 0,
                status: BetStatus::On,
                amount: 10,
                odds_amount: 0,
            }],
        };

        for (d1, d2) in [(1, 1), (1, 2), (2, 2), (2, 3), (3, 3)] {
            let results = process_roll(&mut state, d1, d2);
            let resolved: Vec<_> = results.into_iter().filter(|r| r.resolved).collect();
            if d1 + d2 == 6 {
                assert_eq!(resolved.len(), 1);
                assert_eq!(resolved[0].return_amount, 310); // 30:1 -> 31x total
                assert_eq!(resolved[0].bet_idx, 0);
                state.bets.clear();
            } else {
                assert!(resolved.is_empty());
            }
        }
    }

    #[test]
    fn test_ats_tall_completes_and_pays() {
        let amount = 10;
        let mut state = CrapsState {
            phase: Phase::ComeOut,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: FieldPaytable::default(),
            bets: vec![CrapsBet {
                bet_type: BetType::AtsTall,
                target: 0,
                status: BetStatus::On,
                amount,
                odds_amount: 0,
            }],
        };

        let rolls = [(4, 4, 8), (4, 5, 9), (5, 5, 10), (5, 6, 11), (6, 6, 12)];
        for (d1, d2, total) in rolls {
            let results = process_roll(&mut state, d1, d2);
            let resolved: Vec<_> = results.into_iter().filter(|r| r.resolved).collect();
            if total == 12 {
                assert_eq!(resolved.len(), 1);
                assert_eq!(
                    resolved[0].return_amount,
                    amount.saturating_mul(payouts::ATS_TALL.saturating_add(1))
                );
                assert_eq!(resolved[0].bet_idx, 0);
            } else {
                assert!(resolved.is_empty());
            }
        }
    }

    #[test]
    fn test_ats_all_completes_and_pays() {
        let amount = 10;
        let mut state = CrapsState {
            phase: Phase::ComeOut,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: FieldPaytable::default(),
            bets: vec![CrapsBet {
                bet_type: BetType::AtsAll,
                target: 0,
                status: BetStatus::On,
                amount,
                odds_amount: 0,
            }],
        };

        let rolls = [
            (1, 1, 2),
            (1, 2, 3),
            (2, 2, 4),
            (2, 3, 5),
            (3, 3, 6),
            (4, 4, 8),
            (4, 5, 9),
            (5, 5, 10),
            (5, 6, 11),
            (6, 6, 12),
        ];
        for (d1, d2, total) in rolls {
            let results = process_roll(&mut state, d1, d2);
            let resolved: Vec<_> = results.into_iter().filter(|r| r.resolved).collect();
            if total == 12 {
                assert_eq!(resolved.len(), 1);
                assert_eq!(
                    resolved[0].return_amount,
                    amount.saturating_mul(payouts::ATS_ALL.saturating_add(1))
                );
                assert_eq!(resolved[0].bet_idx, 0);
            } else {
                assert!(resolved.is_empty());
            }
        }
    }

    #[test]
    fn test_ats_loses_on_any_seven() {
        let mut state = CrapsState {
            phase: Phase::ComeOut,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: FieldPaytable::default(),
            bets: vec![CrapsBet {
                bet_type: BetType::AtsTall,
                target: 0,
                status: BetStatus::On,
                amount: 10,
                odds_amount: 0,
            }],
        };

        let results = process_roll(&mut state, 3, 4);
        let ats = results
            .into_iter()
            .find(|r| r.resolved && r.bet_idx == 0)
            .expect("expected ATS bet to resolve on any 7");
        assert_eq!(ats.return_amount, 0);
        assert_eq!(ats.wagered, 10);
    }

    #[test]
    fn test_hardway_payout() {
        // Hard 6 (3,3) wins - 9:1 = 900 + 100 stake = 1000 total
        assert_eq!(calculate_hardway_payout(6, 3, 3, 6, 100), Some(1000));
        // Easy 6 (2,4) loses
        assert_eq!(calculate_hardway_payout(6, 2, 4, 6, 100), Some(0));
        // Seven out loses
        assert_eq!(calculate_hardway_payout(6, 4, 3, 7, 100), Some(0));
        // Still working
        assert_eq!(calculate_hardway_payout(6, 2, 3, 5, 100), None);
    }

    #[test]
    fn test_place_bet() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Craps::init(&mut session, &mut rng);

        // Place a field bet
        let mut payload = vec![0, BetType::Field as u8, 0];
        payload.extend_from_slice(&100u64.to_be_bytes());

        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = Craps::process_move(&mut session, &payload, &mut rng);
        assert!(result.is_ok());
        assert!(!session.is_complete);

        // Verify state
        let state = parse_state(&session.state_blob).expect("Failed to parse state");
        assert_eq!(state.bets.len(), 1);
        assert_eq!(state.bets[0].bet_type, BetType::Field);
    }

    #[test]
    fn test_roll_resolves_field_bet() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Craps::init(&mut session, &mut rng);

        // Place a field bet
        let mut payload = vec![0, BetType::Field as u8, 0];
        payload.extend_from_slice(&100u64.to_be_bytes());

        let mut rng = GameRng::new(&seed, session.id, 1);
        Craps::process_move(&mut session, &payload, &mut rng).expect("Failed to process move");

        // Roll dice
        let mut rng = GameRng::new(&seed, session.id, 2);
        let result = Craps::process_move(&mut session, &[2], &mut rng);
        assert!(result.is_ok());

        // Field bet should be resolved, game complete
        assert!(session.is_complete);
    }

    #[test]
    fn test_roll_without_bets_rejected() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Craps::init(&mut session, &mut rng);

        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = Craps::process_move(&mut session, &[2], &mut rng);
        assert!(matches!(result, Err(GameError::InvalidMove)));
    }

    #[test]
    fn test_atomic_batch_win_resolves_all() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Craps::init(&mut session, &mut rng);

        let payload = atomic_payload(&[(BetType::Pass, 0, 10), (BetType::Field, 0, 5)]);
        let mut rng = GameRng::from_state([
            2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0,
        ]);
        let result = Craps::process_move(&mut session, &payload, &mut rng).expect("atomic batch");

        match result {
            GameResult::Win(payout, _) => assert_eq!(payout, 20),
            _ => panic!("expected win from atomic batch"),
        }

        let state = parse_state(&session.state_blob).expect("Failed to parse state");
        assert!(state.bets.is_empty());
        assert!(session.is_complete);
    }

    #[test]
    fn test_atomic_batch_loss_returns_loss() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Craps::init(&mut session, &mut rng);

        let payload = atomic_payload(&[(BetType::Pass, 0, 10)]);
        let mut rng = GameRng::from_state([
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0,
        ]);
        let result = Craps::process_move(&mut session, &payload, &mut rng).expect("atomic batch");

        assert!(matches!(result, GameResult::Loss(_)));
        assert!(session.is_complete);
    }

    #[test]
    fn test_atomic_batch_sets_point_and_charges_wager() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Craps::init(&mut session, &mut rng);

        let payload = atomic_payload(&[(BetType::Pass, 0, 10)]);
        let mut rng = GameRng::from_state([
            0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0,
        ]);
        let result = Craps::process_move(&mut session, &payload, &mut rng).expect("atomic batch");

        match result {
            GameResult::ContinueWithUpdate { payout, .. } => assert_eq!(payout, -10),
            _ => panic!("expected ContinueWithUpdate with wager deduction"),
        }

        let state = parse_state(&session.state_blob).expect("Failed to parse state");
        assert_eq!(state.phase, Phase::Point);
        assert_eq!(state.main_point, 4);
        assert_eq!(state.bets.len(), 1);
        assert_eq!(state.bets[0].bet_type, BetType::Pass);
        assert_eq!(state.bets[0].target, 4);
    }

    #[test]
    fn test_atomic_batch_rejects_when_bets_exist() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Craps::init(&mut session, &mut rng);

        let mut payload = vec![0, BetType::Field as u8, 0];
        payload.extend_from_slice(&10u64.to_be_bytes());
        let mut rng = GameRng::new(&seed, session.id, 1);
        Craps::process_move(&mut session, &payload, &mut rng).expect("place bet");

        let atomic = atomic_payload(&[(BetType::Pass, 0, 10)]);
        let mut rng = GameRng::new(&seed, session.id, 2);
        let result = Craps::process_move(&mut session, &atomic, &mut rng);
        assert!(matches!(result, Err(GameError::InvalidMove)));
    }

    #[test]
    fn test_atomic_batch_rejects_after_roll() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Craps::init(&mut session, &mut rng);

        let mut payload = vec![0, BetType::Field as u8, 0];
        payload.extend_from_slice(&10u64.to_be_bytes());
        let mut rng = GameRng::new(&seed, session.id, 1);
        Craps::process_move(&mut session, &payload, &mut rng).expect("place bet");

        let mut rng = GameRng::new(&seed, session.id, 2);
        Craps::process_move(&mut session, &[2], &mut rng).expect("roll");

        let atomic = atomic_payload(&[(BetType::Pass, 0, 10)]);
        let mut rng = GameRng::new(&seed, session.id, 3);
        let result = Craps::process_move(&mut session, &atomic, &mut rng);
        // After a roll that ends the game, atomic batch is rejected because game is complete
        assert!(matches!(result, Err(GameError::GameAlreadyComplete)));
    }

    #[test]
    fn test_atomic_batch_invalid_yes_target_rejected() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Craps::init(&mut session, &mut rng);
        let before = session.state_blob.clone();

        let atomic = atomic_payload(&[(BetType::Yes, 7, 10)]);
        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = Craps::process_move(&mut session, &atomic, &mut rng);
        assert!(matches!(result, Err(GameError::InvalidPayload)));
        assert_eq!(session.state_blob, before);
    }

    #[test]
    fn test_atomic_batch_over_max_bets_rejected() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Craps::init(&mut session, &mut rng);

        let mut payload = Vec::with_capacity(2 + (limits::CRAPS_MAX_BETS + 1) * 10);
        payload.push(4);
        payload.push((limits::CRAPS_MAX_BETS + 1) as u8);
        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = Craps::process_move(&mut session, &payload, &mut rng);
        assert!(matches!(result, Err(GameError::InvalidPayload)));
    }

    #[test]
    fn test_pass_line_come_out_resolution_matrix() {
        let amount = 10;
        let bets = vec![CrapsBet {
            bet_type: BetType::Pass,
            target: 0,
            status: BetStatus::On,
            amount,
            odds_amount: 0,
        }];

        let cases = [
            (3, 4, amount.saturating_mul(2)), // 7 wins
            (5, 6, amount.saturating_mul(2)), // 11 wins
            (1, 1, 0),                        // 2 loses
            (1, 2, 0),                        // 3 loses
            (6, 6, 0),                        // 12 loses
        ];

        for (d1, d2, expected) in cases {
            let mut state = state_with_bets(Phase::ComeOut, 0, bets.clone());
            let results = process_roll(&mut state, d1, d2);
            assert_single_result(results, expected, amount);
            assert_eq!(state.phase, Phase::ComeOut);
            assert_eq!(state.main_point, 0);
        }
    }

    #[test]
    fn test_dont_pass_come_out_resolution_matrix() {
        let amount = 10;
        let bets = vec![CrapsBet {
            bet_type: BetType::DontPass,
            target: 0,
            status: BetStatus::On,
            amount,
            odds_amount: 0,
        }];

        let cases = [
            (1, 1, amount.saturating_mul(2)), // 2 wins
            (1, 2, amount.saturating_mul(2)), // 3 wins
            (6, 6, amount),                   // 12 pushes
            (3, 4, 0),                         // 7 loses
            (5, 6, 0),                         // 11 loses
        ];

        for (d1, d2, expected) in cases {
            let mut state = state_with_bets(Phase::ComeOut, 0, bets.clone());
            let results = process_roll(&mut state, d1, d2);
            assert_single_result(results, expected, amount);
            assert_eq!(state.phase, Phase::ComeOut);
            assert_eq!(state.main_point, 0);
        }
    }

    #[test]
    fn test_dont_pass_bar_12_returns_push_result() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Craps::init(&mut session, &mut rng);

        let mut payload = vec![0, BetType::DontPass as u8, 0];
        payload.extend_from_slice(&10u64.to_be_bytes());
        let mut rng = GameRng::new(&seed, session.id, 1);
        Craps::process_move(&mut session, &payload, &mut rng).expect("place bet");

        let mut rng_state = [0u8; 32];
        rng_state[0] = 5;
        rng_state[1] = 5;
        let mut rng = GameRng::from_state(rng_state);
        let result = Craps::process_move(&mut session, &[2], &mut rng).expect("roll");

        match result {
            GameResult::Push(amount, _) => assert_eq!(amount, 10),
            _ => panic!("expected push result for bar 12"),
        }
        assert!(session.is_complete);
    }

    #[test]
    fn test_come_bet_pending_immediate_resolution() {
        let amount = 25;
        let base_bet = CrapsBet {
            bet_type: BetType::Come,
            target: 0,
            status: BetStatus::Pending,
            amount,
            odds_amount: 0,
        };

        let mut state = state_with_bets(Phase::Point, 6, vec![base_bet.clone()]);
        let results = process_roll(&mut state, 3, 4); // 7
        assert_single_result(results, amount.saturating_mul(2), amount);

        let mut state = state_with_bets(Phase::Point, 6, vec![base_bet]);
        let results = process_roll(&mut state, 6, 6); // 12
        assert_single_result(results, 0, amount);
    }

    #[test]
    fn test_dont_come_bet_pending_resolution() {
        let amount = 25;
        let base_bet = CrapsBet {
            bet_type: BetType::DontCome,
            target: 0,
            status: BetStatus::Pending,
            amount,
            odds_amount: 0,
        };

        let mut state = state_with_bets(Phase::Point, 5, vec![base_bet.clone()]);
        let results = process_roll(&mut state, 6, 6); // 12 pushes
        assert_single_result(results, amount, amount);

        let mut state = state_with_bets(Phase::Point, 5, vec![base_bet]);
        let results = process_roll(&mut state, 3, 4); // 7 loses
        assert_single_result(results, 0, amount);
    }

    #[test]
    fn test_come_bet_on_resolves_on_target_and_seven() {
        let amount = 10;
        let odds = 20;
        let bet = CrapsBet {
            bet_type: BetType::Come,
            target: 4,
            status: BetStatus::On,
            amount,
            odds_amount: odds,
        };

        let mut state = state_with_bets(Phase::Point, 5, vec![bet.clone()]);
        let results = process_roll(&mut state, 2, 2); // 4 hits
        let expected = amount
            .saturating_mul(2)
            .saturating_add(odds)
            .saturating_add(calculate_odds_payout(4, odds, true));
        assert_single_result(
            results,
            expected,
            amount.saturating_add(odds),
        );

        let mut state = state_with_bets(Phase::Point, 5, vec![bet]);
        let results = process_roll(&mut state, 3, 4); // 7 out
        assert_single_result(results, 0, amount.saturating_add(odds));
    }

    #[test]
    fn test_dont_come_bet_on_resolves_on_seven_and_target() {
        let amount = 10;
        let odds = 20;
        let bet = CrapsBet {
            bet_type: BetType::DontCome,
            target: 4,
            status: BetStatus::On,
            amount,
            odds_amount: odds,
        };

        let mut state = state_with_bets(Phase::Point, 5, vec![bet.clone()]);
        let results = process_roll(&mut state, 3, 4); // 7 wins
        let expected = amount
            .saturating_mul(2)
            .saturating_add(odds)
            .saturating_add(calculate_odds_payout(4, odds, false));
        assert_single_result(
            results,
            expected,
            amount.saturating_add(odds),
        );

        let mut state = state_with_bets(Phase::Point, 5, vec![bet]);
        let results = process_roll(&mut state, 2, 2); // 4 loses
        assert_single_result(results, 0, amount.saturating_add(odds));
    }

    #[test]
    fn test_hardway_bet_resolves_on_hard_and_easy() {
        let amount = 10;
        let bet = CrapsBet {
            bet_type: BetType::Hardway6,
            target: 0,
            status: BetStatus::On,
            amount,
            odds_amount: 0,
        };

        let mut state = state_with_bets(Phase::ComeOut, 0, vec![bet.clone()]);
        let results = process_roll(&mut state, 3, 3); // hard 6
        let expected = amount.saturating_add(amount.saturating_mul(payouts::HARDWAY_6_OR_8));
        assert_single_result(results, expected, amount);

        let mut state = state_with_bets(Phase::ComeOut, 0, vec![bet]);
        let results = process_roll(&mut state, 4, 2); // easy 6
        assert_single_result(results, 0, amount);
    }

    #[test]
    fn test_yes_no_bets_resolve_on_target_and_seven() {
        let amount = 40;
        let yes_bet = CrapsBet {
            bet_type: BetType::Yes,
            target: 6,
            status: BetStatus::On,
            amount,
            odds_amount: 0,
        };
        let mut state = state_with_bets(Phase::Point, 6, vec![yes_bet.clone()]);
        let results = process_roll(&mut state, 3, 3);
        assert_single_result(results, calculate_yes_payout(6, amount, true), amount);

        let mut state = state_with_bets(Phase::Point, 6, vec![yes_bet]);
        let results = process_roll(&mut state, 3, 4);
        assert_single_result(results, 0, amount);

        let no_bet = CrapsBet {
            bet_type: BetType::No,
            target: 4,
            status: BetStatus::On,
            amount,
            odds_amount: 0,
        };
        let mut state = state_with_bets(Phase::Point, 4, vec![no_bet.clone()]);
        let results = process_roll(&mut state, 3, 4);
        assert_single_result(results, calculate_no_payout(4, amount, true), amount);

        let mut state = state_with_bets(Phase::Point, 4, vec![no_bet]);
        let results = process_roll(&mut state, 2, 2);
        assert_single_result(results, 0, amount);
    }

    #[test]
    fn test_pass_line_odds_payout_on_point_hit() {
        let bet = CrapsBet {
            bet_type: BetType::Pass,
            target: 6,
            status: BetStatus::On,
            amount: 10,
            odds_amount: 20,
        };
        let mut state = state_with_bets(Phase::Point, 6, vec![bet.clone()]);
        let results = process_roll(&mut state, 3, 3);
        let expected = calculate_pass_return(&bet, true, true);
        assert_single_result(results, expected, bet.amount.saturating_add(bet.odds_amount));
    }

    #[test]
    fn test_dont_pass_odds_payout_on_seven_out() {
        let bet = CrapsBet {
            bet_type: BetType::DontPass,
            target: 6,
            status: BetStatus::On,
            amount: 10,
            odds_amount: 20,
        };
        let mut state = state_with_bets(Phase::Point, 6, vec![bet.clone()]);
        let results = process_roll(&mut state, 3, 4);
        let expected = calculate_pass_return(&bet, true, false);
        assert_single_result(results, expected, bet.amount.saturating_add(bet.odds_amount));
    }

    #[test]
    fn test_max_bets_enforced() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Craps::init(&mut session, &mut rng);

        for idx in 0..limits::CRAPS_MAX_BETS {
            let mut payload = vec![0, BetType::Field as u8, 0];
            payload.extend_from_slice(&1u64.to_be_bytes());
            let mut rng = GameRng::new(&seed, session.id, (idx + 1) as u32);
            let result = Craps::process_move(&mut session, &payload, &mut rng);
            assert!(result.is_ok(), "bet {idx} should succeed");
        }

        let mut payload = vec![0, BetType::Field as u8, 0];
        payload.extend_from_slice(&1u64.to_be_bytes());
        let mut rng = GameRng::new(&seed, session.id, (limits::CRAPS_MAX_BETS + 1) as u32);
        let result = Craps::process_move(&mut session, &payload, &mut rng);
        assert!(matches!(result, Err(GameError::InvalidMove)));
    }

    #[test]
    fn test_pass_line_flow() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Craps::init(&mut session, &mut rng);

        // Place pass line bet
        let mut payload = vec![0, BetType::Pass as u8, 0];
        payload.extend_from_slice(&100u64.to_be_bytes());

        let mut rng = GameRng::new(&seed, session.id, 1);
        Craps::process_move(&mut session, &payload, &mut rng).expect("Failed to process move");

        // Roll until game completes
        let mut move_num = 2;
        while !session.is_complete && move_num < 100 {
            let mut rng = GameRng::new(&seed, session.id, move_num);
            let result = Craps::process_move(&mut session, &[2], &mut rng);
            assert!(result.is_ok());
            move_num += 1;
        }

        assert!(session.is_complete);
    }

    #[test]
    fn test_add_odds() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Craps::init(&mut session, &mut rng);

        // Place pass line bet
        let mut payload = vec![0, BetType::Pass as u8, 0];
        payload.extend_from_slice(&100u64.to_be_bytes());

        let mut rng = GameRng::new(&seed, session.id, 1);
        Craps::process_move(&mut session, &payload, &mut rng).expect("Failed to process move");

        // Roll to establish point
        let mut rng = GameRng::new(&seed, session.id, 2);
        Craps::process_move(&mut session, &[2], &mut rng).expect("Failed to process move");

        let state = parse_state(&session.state_blob).expect("Failed to parse state");
        if state.phase == Phase::Point {
            // Add odds
            let mut odds_payload = vec![1];
            odds_payload.extend_from_slice(&200u64.to_be_bytes());

            let mut rng = GameRng::new(&seed, session.id, 3);
            let result = Craps::process_move(&mut session, &odds_payload, &mut rng);
            assert!(result.is_ok());

            // Verify odds added
            let state = parse_state(&session.state_blob).expect("Failed to parse state");
            assert_eq!(state.bets[0].odds_amount, 200);
        }
    }

    #[test]
    fn test_add_odds_without_contract_bet_fails() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Craps::init(&mut session, &mut rng);

        let mut payload = vec![0, BetType::Field as u8, 0];
        payload.extend_from_slice(&10u64.to_be_bytes());
        let mut rng = GameRng::new(&seed, session.id, 1);
        Craps::process_move(&mut session, &payload, &mut rng).expect("place bet");

        let mut odds_payload = vec![1];
        odds_payload.extend_from_slice(&50u64.to_be_bytes());
        let mut rng = GameRng::new(&seed, session.id, 2);
        let result = Craps::process_move(&mut session, &odds_payload, &mut rng);
        assert!(matches!(result, Err(GameError::InvalidMove)));
    }

    #[test]
    fn test_come_bet_pending_to_on() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Craps::init(&mut session, &mut rng);

        // Force point phase (come bets are only allowed after a point is established).
        let mut state = parse_state(&session.state_blob).expect("Failed to parse state");
        state.phase = Phase::Point;
        state.main_point = 4;
        session.state_blob = serialize_state(&state);

        // Place come bet
        let mut payload = vec![0, BetType::Come as u8, 0];
        payload.extend_from_slice(&100u64.to_be_bytes());

        let mut rng = GameRng::new(&seed, session.id, 1);
        Craps::process_move(&mut session, &payload, &mut rng).expect("Failed to process move");

        let state = parse_state(&session.state_blob).expect("Failed to parse state");
        assert_eq!(state.bets[0].status, BetStatus::Pending);

        // Roll a point number (6) to travel the come bet.
        let mut state = parse_state(&session.state_blob).expect("Failed to parse state");
        process_roll(&mut state, 3, 3);
        assert_eq!(state.bets[0].status, BetStatus::On);
        assert_eq!(state.bets[0].target, 6);
    }

    #[test]
    fn test_clear_bets_refunds_total() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Craps::init(&mut session, &mut rng);

        let mut payload = vec![0, BetType::Field as u8, 0];
        payload.extend_from_slice(&10u64.to_be_bytes());
        let mut rng = GameRng::new(&seed, session.id, 1);
        Craps::process_move(&mut session, &payload, &mut rng).expect("place bet");

        let mut payload = vec![0, BetType::Pass as u8, 0];
        payload.extend_from_slice(&20u64.to_be_bytes());
        let mut rng = GameRng::new(&seed, session.id, 2);
        Craps::process_move(&mut session, &payload, &mut rng).expect("place bet");

        let mut rng = GameRng::new(&seed, session.id, 3);
        let result = Craps::process_move(&mut session, &[3], &mut rng).expect("clear bets");

        match result {
            GameResult::ContinueWithUpdate { payout, .. } => assert_eq!(payout, 30),
            _ => panic!("expected refund payout"),
        }

        let state = parse_state(&session.state_blob).expect("Failed to parse state");
        assert!(state.bets.is_empty());
    }

    #[test]
    fn test_clear_bets() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Craps::init(&mut session, &mut rng);

        // Place a bet
        let mut payload = vec![0, BetType::Field as u8, 0];
        payload.extend_from_slice(&100u64.to_be_bytes());

        let mut rng = GameRng::new(&seed, session.id, 1);
        Craps::process_move(&mut session, &payload, &mut rng).expect("Failed to process move");

        // Clear bets before rolling should succeed
        let mut rng = GameRng::new(&seed, session.id, 2);
        let result = Craps::process_move(&mut session, &[3], &mut rng);
        assert!(result.is_ok());

        // Verify bets are cleared
        let state = parse_state(&session.state_blob).expect("Failed to parse state");
        assert!(state.bets.is_empty());

        // Place another bet and roll
        let mut payload = vec![0, BetType::Field as u8, 0];
        payload.extend_from_slice(&100u64.to_be_bytes());
        let mut rng = GameRng::new(&seed, session.id, 3);
        Craps::process_move(&mut session, &payload, &mut rng).expect("Failed to process move");

        // Roll dice (this increments move_count)
        let mut rng = GameRng::new(&seed, session.id, 4);
        Craps::process_move(&mut session, &[2], &mut rng).expect("Failed to process move");

        // Clear bets after rolling should fail
        let mut rng = GameRng::new(&seed, session.id, 5);
        let result = Craps::process_move(&mut session, &[3], &mut rng);
        assert!(result.is_err());
    }

    #[test]
    fn test_multiple_bets() {
        let seed = create_test_seed();
        let mut session = create_test_session(500);
        let mut rng = GameRng::new(&seed, session.id, 0);

        Craps::init(&mut session, &mut rng);

        // Place multiple bets
        let bets = [(BetType::Pass, 0, 100u64), (BetType::Field, 0, 50u64)];

        for (idx, (bet_type, target, amount)) in bets.iter().enumerate() {
            let mut payload = vec![0, *bet_type as u8, *target];
            payload.extend_from_slice(&amount.to_be_bytes());

            let mut rng = GameRng::new(&seed, session.id, (idx + 1) as u32);
            let result = Craps::process_move(&mut session, &payload, &mut rng);
            assert!(result.is_ok());
        }

        let state = parse_state(&session.state_blob).expect("Failed to parse state");
        assert_eq!(state.bets.len(), 2);

        // Verify we have Pass and Field bets
        assert!(state.bets.iter().any(|b| b.bet_type == BetType::Pass));
        assert!(state.bets.iter().any(|b| b.bet_type == BetType::Field));

        // Roll dice - field bet should always resolve (single-roll)
        // Other bets may or may not resolve depending on dice
        let initial_bet_count = state.bets.len();
        let mut rng = GameRng::new(&seed, session.id, 3);
        Craps::process_move(&mut session, &[2], &mut rng).expect("Failed to process move");

        let state = parse_state(&session.state_blob).expect("Failed to parse state");
        // Field bet always resolves on first roll, so at least that bet is gone
        // Remaining bets depend on actual dice roll (Pass may resolve on 7/11/2/3/12)
        assert!(
            state.bets.len() < initial_bet_count,
            "At least field bet should resolve"
        );
        // No field bet should remain (it's always a single-roll bet)
        assert!(!state.bets.iter().any(|b| b.bet_type == BetType::Field));
    }

    #[test]
    fn test_ways_constant() {
        assert_eq!(WAYS[2], 1); // One way to roll 2 (1,1)
        assert_eq!(WAYS[7], 6); // Six ways to roll 7
        assert_eq!(WAYS[12], 1); // One way to roll 12 (6,6)
    }

    #[test]
    fn test_fire_bet_pays_on_seven_out() {
        let mut state = CrapsState {
            phase: Phase::ComeOut,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: FieldPaytable::default(),
            bets: vec![CrapsBet {
                bet_type: BetType::Fire,
                target: 0,
                status: BetStatus::On,
                amount: 10,
                odds_amount: 0,
            }],
        };

        // Make 4, 5, 6, 8.
        for (d1, d2) in [
            (2, 2),
            (2, 2),
            (2, 3),
            (2, 3),
            (3, 3),
            (3, 3),
            (4, 4),
            (4, 4),
        ] {
            process_roll(&mut state, d1, d2);
        }
        assert_eq!(state.made_points_mask.count_ones(), 4);

        // Establish a point, then seven-out to resolve Fire bet.
        process_roll(&mut state, 4, 5); // 9 establishes a point
        let results = process_roll(&mut state, 3, 4); // 7
        assert_eq!(results.len(), 1);
        assert!(results[0].resolved);
        assert_eq!(results[0].return_amount, 250); // 10 * (24 + 1)
    }

    #[test]
    fn test_fire_bet_loses_under_four_points() {
        let mut state = CrapsState {
            phase: Phase::ComeOut,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: FieldPaytable::default(),
            bets: vec![CrapsBet {
                bet_type: BetType::Fire,
                target: 0,
                status: BetStatus::On,
                amount: 10,
                odds_amount: 0,
            }],
        };

        // Make 4, 5, 6 (only 3 points).
        for (d1, d2) in [(2, 2), (2, 2), (2, 3), (2, 3), (3, 3), (3, 3)] {
            process_roll(&mut state, d1, d2);
        }
        assert_eq!(state.made_points_mask.count_ones(), 3);

        process_roll(&mut state, 4, 5); // 9 establishes a point
        let results = process_roll(&mut state, 3, 4); // 7 out
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].return_amount, 0);
    }

    #[test]
    fn test_made_points_mask_resets_on_seven_out() {
        let mut state = CrapsState {
            phase: Phase::Point,
            main_point: 6,
            d1: 3,
            d2: 3,
            made_points_mask: 0b001011,
            epoch_point_established: true,
            field_paytable: FieldPaytable::default(),
            bets: Vec::new(),
        };

        process_roll(&mut state, 3, 4); // 7 out
        assert_eq!(state.made_points_mask, 0);
        assert_eq!(state.phase, Phase::ComeOut);
        assert_eq!(state.main_point, 0);
        assert!(!state.epoch_point_established);
    }

    #[test]
    fn test_yes_bet_target_2_can_be_placed() -> Result<(), GameError> {
        // Verify YES bet with target 2 can be placed
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = crate::casino::GameRng::new(&seed, session.id, 1);

        // Payload: [0, bet_type=5 (Yes), target=2, amount=100u64 BE]
        let mut payload = vec![0u8, 5, 2]; // command=0, bet_type=Yes(5), target=2
        payload.extend_from_slice(&100u64.to_be_bytes()); // amount=100

        let result = Craps::process_move(&mut session, &payload, &mut rng);
        assert!(result.is_ok(), "YES bet with target 2 should be accepted");

        // Verify bet was placed
        let state = parse_state(&session.state_blob).ok_or(GameError::InvalidPayload)?;
        assert_eq!(state.bets.len(), 1);
        assert_eq!(state.bets[0].bet_type, BetType::Yes);
        assert_eq!(state.bets[0].target, 2);
        assert_eq!(state.bets[0].amount, 100);
        Ok(())
    }

    #[test]
    fn test_no_bet_target_2_can_be_placed() -> Result<(), GameError> {
        // Verify NO bet with target 2 can be placed
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = crate::casino::GameRng::new(&seed, session.id, 1);

        // Payload: [0, bet_type=6 (No), target=2, amount=100u64 BE]
        let mut payload = vec![0u8, 6, 2]; // command=0, bet_type=No(6), target=2
        payload.extend_from_slice(&100u64.to_be_bytes()); // amount=100

        let result = Craps::process_move(&mut session, &payload, &mut rng);
        assert!(result.is_ok(), "NO bet with target 2 should be accepted");

        // Verify bet was placed
        let state = parse_state(&session.state_blob).ok_or(GameError::InvalidPayload)?;
        assert_eq!(state.bets.len(), 1);
        assert_eq!(state.bets[0].bet_type, BetType::No);
        assert_eq!(state.bets[0].target, 2);
        Ok(())
    }

    #[test]
    fn test_yes_bet_target_7_rejected() {
        // Verify YES bet with target 7 is rejected
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = crate::casino::GameRng::new(&seed, session.id, 1);

        // Payload: [0, bet_type=5 (Yes), target=7, amount=100u64 BE]
        let mut payload = vec![0u8, 5, 7]; // command=0, bet_type=Yes(5), target=7
        payload.extend_from_slice(&100u64.to_be_bytes()); // amount=100

        let result = Craps::process_move(&mut session, &payload, &mut rng);
        assert!(result.is_err(), "YES bet with target 7 should be rejected");
    }

    #[test]
    fn test_muggsy_come_out_seven_pays() {
        let mut state = CrapsState {
            phase: Phase::ComeOut,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: FieldPaytable::default(),
            bets: vec![CrapsBet {
                bet_type: BetType::Muggsy,
                target: 0,
                status: BetStatus::On,
                amount: 10,
                odds_amount: 0,
            }],
        };

        let results = process_roll(&mut state, 3, 4);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].return_amount, 30);
    }

    #[test]
    fn test_muggsy_point_seven_pays() {
        let mut state = CrapsState {
            phase: Phase::ComeOut,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: FieldPaytable::default(),
            bets: vec![CrapsBet {
                bet_type: BetType::Muggsy,
                target: 0,
                status: BetStatus::On,
                amount: 10,
                odds_amount: 0,
            }],
        };

        let results = process_roll(&mut state, 2, 2);
        assert!(results.is_empty());
        assert_eq!(state.bets[0].odds_amount, 1);

        let results = process_roll(&mut state, 3, 4);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].return_amount, 40);
    }

    #[test]
    fn test_diff_doubles_pays_on_seven() {
        let mut state = CrapsState {
            phase: Phase::ComeOut,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: FieldPaytable::default(),
            bets: vec![CrapsBet {
                bet_type: BetType::DiffDoubles,
                target: 0,
                status: BetStatus::On,
                amount: 10,
                odds_amount: 0,
            }],
        };

        process_roll(&mut state, 1, 1);
        process_roll(&mut state, 2, 2);
        let results = process_roll(&mut state, 3, 3);
        assert!(results.is_empty());

        let results = process_roll(&mut state, 3, 4);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].return_amount, 50);
    }

    #[test]
    fn test_ride_line_pays_on_seven_out() {
        let mut state = CrapsState {
            phase: Phase::ComeOut,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: FieldPaytable::default(),
            bets: vec![CrapsBet {
                bet_type: BetType::RideLine,
                target: 0,
                status: BetStatus::On,
                amount: 10,
                odds_amount: 0,
            }],
        };

        process_roll(&mut state, 5, 6); // come-out 11
        process_roll(&mut state, 2, 2); // point 4 established
        process_roll(&mut state, 2, 2); // point 4 made
        process_roll(&mut state, 2, 3); // point 5 established
        process_roll(&mut state, 2, 3); // point 5 made
        process_roll(&mut state, 3, 3); // point 6 established
        let results = process_roll(&mut state, 3, 4); // seven-out
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].return_amount, 20);
    }

    #[test]
    fn test_replay_pays_on_three_points() {
        let mut state = CrapsState {
            phase: Phase::ComeOut,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: FieldPaytable::default(),
            bets: vec![CrapsBet {
                bet_type: BetType::Replay,
                target: 0,
                status: BetStatus::On,
                amount: 1,
                odds_amount: 0,
            }],
        };

        for _ in 0..3 {
            process_roll(&mut state, 2, 2); // point 4 established
            process_roll(&mut state, 2, 2); // point 4 made
        }
        process_roll(&mut state, 2, 3); // point 5 established
        let results = process_roll(&mut state, 3, 4); // seven-out
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].return_amount, 121);
    }

    #[test]
    fn test_hot_roller_pays_on_two_points() {
        let mut state = CrapsState {
            phase: Phase::ComeOut,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: FieldPaytable::default(),
            bets: vec![CrapsBet {
                bet_type: BetType::HotRoller,
                target: 0,
                status: BetStatus::On,
                amount: 10,
                odds_amount: 0,
            }],
        };

        process_roll(&mut state, 1, 3);
        process_roll(&mut state, 2, 2);
        process_roll(&mut state, 1, 4);
        process_roll(&mut state, 2, 3);
        let results = process_roll(&mut state, 3, 4); // seven resolves hot roller
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].return_amount, 60);
    }

    // ========================================================================
    // Fire Bet Six Points Tests (US-052)
    // ========================================================================

    #[test]
    fn test_fire_bet_six_points_999_to_1() {
        // Test making all 6 unique points (4, 5, 6, 8, 9, 10) before sevening out
        // should pay 999:1 (the highest Fire Bet payout).
        let mut state = CrapsState {
            phase: Phase::ComeOut,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: FieldPaytable::default(),
            bets: vec![CrapsBet {
                bet_type: BetType::Fire,
                target: 0,
                status: BetStatus::On,
                amount: 10,
                odds_amount: 0,
            }],
        };

        // Make all 6 points in sequence:
        // Point 4: (2,2)=4 establishes, (2,2)=4 makes it
        process_roll(&mut state, 2, 2); // Establish 4
        process_roll(&mut state, 2, 2); // Make 4 (bit 0)
        assert_eq!(state.made_points_mask, 0b000001, "After making 4");

        // Point 5: (2,3)=5 establishes, (2,3)=5 makes it
        process_roll(&mut state, 2, 3); // Establish 5
        process_roll(&mut state, 2, 3); // Make 5 (bit 1)
        assert_eq!(state.made_points_mask, 0b000011, "After making 4 and 5");

        // Point 6: (3,3)=6 establishes, (3,3)=6 makes it
        process_roll(&mut state, 3, 3); // Establish 6
        process_roll(&mut state, 3, 3); // Make 6 (bit 2)
        assert_eq!(state.made_points_mask, 0b000111, "After making 4, 5, and 6");

        // Point 8: (4,4)=8 establishes, (4,4)=8 makes it
        process_roll(&mut state, 4, 4); // Establish 8
        process_roll(&mut state, 4, 4); // Make 8 (bit 3)
        assert_eq!(state.made_points_mask, 0b001111, "After making 4, 5, 6, and 8");

        // Point 9: (4,5)=9 establishes, (4,5)=9 makes it
        process_roll(&mut state, 4, 5); // Establish 9
        process_roll(&mut state, 4, 5); // Make 9 (bit 4)
        assert_eq!(state.made_points_mask, 0b011111, "After making 4, 5, 6, 8, and 9");

        // Point 10: (5,5)=10 establishes, (5,5)=10 makes it
        process_roll(&mut state, 5, 5); // Establish 10
        process_roll(&mut state, 5, 5); // Make 10 (bit 5)
        assert_eq!(state.made_points_mask, 0b111111, "All 6 points made");

        // Verify count
        assert_eq!(state.made_points_mask.count_ones(), 6);

        // Establish a new point and seven-out to resolve Fire bet
        process_roll(&mut state, 2, 2); // Establish 4 again
        let results = process_roll(&mut state, 3, 4); // 7 out

        // Verify 999:1 payout: 10 * (999 + 1) = 10000
        assert_eq!(results.len(), 1);
        assert!(results[0].resolved);
        assert_eq!(results[0].return_amount, 10_000, "6 points should pay 999:1");
    }

    #[test]
    fn test_fire_bet_made_points_mask_bit_flags() {
        // Verify each bit in made_points_mask corresponds to the correct point number.
        // Bit 0 = 4, Bit 1 = 5, Bit 2 = 6, Bit 3 = 8, Bit 4 = 9, Bit 5 = 10
        let mut state = CrapsState {
            phase: Phase::ComeOut,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: FieldPaytable::default(),
            bets: Vec::new(),
        };

        // Make point 4 (bit 0)
        process_roll(&mut state, 2, 2); // Establish 4
        process_roll(&mut state, 2, 2); // Make 4
        assert_eq!(state.made_points_mask & (1 << 0), 1 << 0, "Bit 0 should be set for point 4");

        // Make point 10 (bit 5) - skip to verify bits are independent
        process_roll(&mut state, 5, 5); // Establish 10
        process_roll(&mut state, 5, 5); // Make 10
        assert_eq!(state.made_points_mask & (1 << 5), 1 << 5, "Bit 5 should be set for point 10");

        // Make point 6 (bit 2)
        process_roll(&mut state, 3, 3); // Establish 6
        process_roll(&mut state, 3, 3); // Make 6
        assert_eq!(state.made_points_mask & (1 << 2), 1 << 2, "Bit 2 should be set for point 6");

        // Verify full mask: bits 0, 2, 5 should be set = 0b100101 = 37
        assert_eq!(state.made_points_mask, 0b100101, "Bits 0, 2, 5 set for points 4, 6, 10");
        assert_eq!(state.made_points_mask.count_ones(), 3);
    }

    #[test]
    fn test_fire_bet_five_points_249_to_1() {
        // Test making 5 unique points should pay 249:1.
        let mut state = CrapsState {
            phase: Phase::ComeOut,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: FieldPaytable::default(),
            bets: vec![CrapsBet {
                bet_type: BetType::Fire,
                target: 0,
                status: BetStatus::On,
                amount: 100,
                odds_amount: 0,
            }],
        };

        // Make 5 points: 4, 5, 6, 8, 9 (skip 10)
        for (d1, d2) in [
            (2, 2), (2, 2), // Establish and make 4
            (2, 3), (2, 3), // Establish and make 5
            (3, 3), (3, 3), // Establish and make 6
            (4, 4), (4, 4), // Establish and make 8
            (4, 5), (4, 5), // Establish and make 9
        ] {
            process_roll(&mut state, d1, d2);
        }
        assert_eq!(state.made_points_mask.count_ones(), 5);
        assert_eq!(state.made_points_mask, 0b011111, "Points 4, 5, 6, 8, 9 made");

        // Establish a point and seven-out
        process_roll(&mut state, 5, 5); // Establish 10
        let results = process_roll(&mut state, 3, 4); // 7 out

        // Verify 249:1 payout: 100 * (249 + 1) = 25000
        assert_eq!(results.len(), 1);
        assert!(results[0].resolved);
        assert_eq!(results[0].return_amount, 25_000, "5 points should pay 249:1");
    }

    #[test]
    fn test_fire_bet_duplicate_points_count_once() {
        // Test that making the same point multiple times only counts once.
        let mut state = CrapsState {
            phase: Phase::ComeOut,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: FieldPaytable::default(),
            bets: vec![CrapsBet {
                bet_type: BetType::Fire,
                target: 0,
                status: BetStatus::On,
                amount: 10,
                odds_amount: 0,
            }],
        };

        // Make point 4 three times
        for _ in 0..3 {
            process_roll(&mut state, 2, 2); // Establish 4
            process_roll(&mut state, 2, 2); // Make 4
        }

        // Only 1 unique point made
        assert_eq!(state.made_points_mask.count_ones(), 1);
        assert_eq!(state.made_points_mask, 0b000001);

        // Seven-out should lose Fire bet (need 4+ unique points)
        process_roll(&mut state, 2, 2); // Establish 4
        let results = process_roll(&mut state, 3, 4); // 7 out
        assert_eq!(results[0].return_amount, 0, "Repeated single point should lose");
    }

    #[test]
    fn test_fire_bet_reverse_order_points() {
        // Test making points in reverse order (10, 9, 8, 6, 5, 4) still works.
        let mut state = CrapsState {
            phase: Phase::ComeOut,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: FieldPaytable::default(),
            bets: vec![CrapsBet {
                bet_type: BetType::Fire,
                target: 0,
                status: BetStatus::On,
                amount: 1,
                odds_amount: 0,
            }],
        };

        // Make all 6 points in reverse order
        for (d1, d2) in [
            (5, 5), (5, 5), // 10
            (4, 5), (4, 5), // 9
            (4, 4), (4, 4), // 8
            (3, 3), (3, 3), // 6
            (2, 3), (2, 3), // 5
            (2, 2), (2, 2), // 4
        ] {
            process_roll(&mut state, d1, d2);
        }

        assert_eq!(state.made_points_mask, 0b111111, "All 6 points made in reverse order");

        // Establish and seven-out
        process_roll(&mut state, 4, 5); // Establish 9
        let results = process_roll(&mut state, 3, 4); // 7 out

        // 1 * (999 + 1) = 1000
        assert_eq!(results[0].return_amount, 1_000, "Reverse order should still pay 999:1");
    }

    #[test]
    fn test_fire_bet_partial_payouts_all_tiers() {
        // Test payout amounts for each tier: 4 points (24:1), 5 points (249:1), 6 points (999:1).
        // Also verify 0-3 points pay nothing.

        // Helper function to run Fire bet scenario
        fn run_fire_bet_with_points(points_to_make: &[(u8, u8)], bet_amount: u64) -> u64 {
            let mut state = CrapsState {
                phase: Phase::ComeOut,
                main_point: 0,
                d1: 0,
                d2: 0,
                made_points_mask: 0,
                epoch_point_established: false,
                field_paytable: FieldPaytable::default(),
                bets: vec![CrapsBet {
                    bet_type: BetType::Fire,
                    target: 0,
                    status: BetStatus::On,
                    amount: bet_amount,
                    odds_amount: 0,
                }],
            };

            // Establish and make each point
            for &(d1, d2) in points_to_make {
                process_roll(&mut state, d1, d2);
                process_roll(&mut state, d1, d2);
            }

            // Establish a point and seven-out
            process_roll(&mut state, 4, 5); // Establish 9
            let results = process_roll(&mut state, 3, 4); // 7 out
            results[0].return_amount
        }

        // 0 points (lose)
        let result = run_fire_bet_with_points(&[], 10);
        assert_eq!(result, 0, "0 points should lose");

        // 1 point (lose)
        let result = run_fire_bet_with_points(&[(2, 2)], 10); // Point 4 only
        assert_eq!(result, 0, "1 point should lose");

        // 2 points (lose)
        let result = run_fire_bet_with_points(&[(2, 2), (2, 3)], 10); // Points 4, 5
        assert_eq!(result, 0, "2 points should lose");

        // 3 points (lose)
        let result = run_fire_bet_with_points(&[(2, 2), (2, 3), (3, 3)], 10); // Points 4, 5, 6
        assert_eq!(result, 0, "3 points should lose");

        // 4 points (24:1)
        let result = run_fire_bet_with_points(&[(2, 2), (2, 3), (3, 3), (4, 4)], 10);
        assert_eq!(result, 250, "4 points should pay 24:1 (10 * 25)");

        // 5 points (249:1)
        let result = run_fire_bet_with_points(&[(2, 2), (2, 3), (3, 3), (4, 4), (5, 5)], 10);
        assert_eq!(result, 2500, "5 points should pay 249:1 (10 * 250)");

        // 6 points (999:1)
        let result = run_fire_bet_with_points(&[(2, 2), (2, 3), (3, 3), (4, 4), (4, 5), (5, 5)], 10);
        assert_eq!(result, 10_000, "6 points should pay 999:1 (10 * 1000)");
    }

    #[test]
    fn test_fire_bet_large_amounts() {
        // Test Fire bet with large bet amounts to verify no overflow issues.
        let mut state = CrapsState {
            phase: Phase::ComeOut,
            main_point: 0,
            d1: 0,
            d2: 0,
            made_points_mask: 0,
            epoch_point_established: false,
            field_paytable: FieldPaytable::default(),
            bets: vec![CrapsBet {
                bet_type: BetType::Fire,
                target: 0,
                status: BetStatus::On,
                amount: 1_000_000, // 1 million
                odds_amount: 0,
            }],
        };

        // Make all 6 points
        for (d1, d2) in [
            (2, 2), (2, 2), // 4
            (2, 3), (2, 3), // 5
            (3, 3), (3, 3), // 6
            (4, 4), (4, 4), // 8
            (4, 5), (4, 5), // 9
            (5, 5), (5, 5), // 10
        ] {
            process_roll(&mut state, d1, d2);
        }

        // Establish and seven-out
        process_roll(&mut state, 4, 5); // Establish 9
        let results = process_roll(&mut state, 3, 4); // 7 out

        // 1,000,000 * 1000 = 1,000,000,000 (1 billion) - within u64 range
        assert_eq!(results[0].return_amount, 1_000_000_000, "Large bet with 6 points");
    }

    #[test]
    fn test_point_to_fire_bit_mapping() {
        // Directly test the point_to_fire_bit function to ensure correct bit mapping.
        assert_eq!(point_to_fire_bit(4), Some(0), "Point 4 -> bit 0");
        assert_eq!(point_to_fire_bit(5), Some(1), "Point 5 -> bit 1");
        assert_eq!(point_to_fire_bit(6), Some(2), "Point 6 -> bit 2");
        assert_eq!(point_to_fire_bit(8), Some(3), "Point 8 -> bit 3");
        assert_eq!(point_to_fire_bit(9), Some(4), "Point 9 -> bit 4");
        assert_eq!(point_to_fire_bit(10), Some(5), "Point 10 -> bit 5");

        // Non-point numbers return None
        assert_eq!(point_to_fire_bit(2), None, "2 is not a point");
        assert_eq!(point_to_fire_bit(3), None, "3 is not a point");
        assert_eq!(point_to_fire_bit(7), None, "7 is not a point");
        assert_eq!(point_to_fire_bit(11), None, "11 is not a point");
        assert_eq!(point_to_fire_bit(12), None, "12 is not a point");
    }
}
