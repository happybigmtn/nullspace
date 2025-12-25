//! Sic Bo game implementation with multi-bet support.
//!
//! State blob format:
//! [bet_count:u8] [bets:SicBoBet×count] [die1:u8]? [die2:u8]? [die3:u8]? [rules:u8]
//!
//! Each SicBoBet (10 bytes):
//! [bet_type:u8] [number:u8] [amount:u64 BE]
//!
//! Payload format:
//! Action 0: Place bet - [0, bet_type, number, amount_bytes...]
//! Action 1: Roll dice and resolve - [1]
//! Action 2: Clear bets (with refund) - [2]
//! Action 3: Atomic batch - [3, bet_count, bets...]
//!           Each bet is 10 bytes: [bet_type:u8, number:u8, amount:u64 BE]
//!           Ensures all-or-nothing semantics - no partial bet states
//! Action 4: Set rules - [4, rules:u8]
//!
//! Bet types:
//! 0 = Small (4-10, 1:1) - loses on triple
//! 1 = Big (11-17, 1:1) - loses on triple
//! 2 = Odd total (1:1)
//! 3 = Even total (1:1)
//! 4 = Specific triple (150:1) - number = 1-6
//! 5 = Any triple (24:1)
//! 6 = Specific double (8:1) - number = 1-6
//! 7 = Total of N (various payouts) - number = 3-18
//! 8 = Single number appears (1:1 to 3:1) - number = 1-6
//! 9 = Domino (two faces) (5:1) - number = (min<<4)|max, min/max in 1-6 and min<max
//! 10 = Three-Number Easy Hop (30:1) - number = 6-bit mask of chosen numbers (exactly 3 bits set)
//! 11 = Three-Number Hard Hop (50:1) - number = (double<<4)|single, both 1-6 and distinct
//! 12 = Four-Number Easy Hop (7:1) - number = 6-bit mask of chosen numbers (exactly 4 bits set)

use super::super_mode::apply_super_multiplier_total;
use super::{CasinoGame, GameError, GameResult, GameRng};
use nullspace_types::casino::GameSession;

/// Maximum number of bets per session.
const MAX_BETS: usize = 20;

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SicBoPaytable {
    Macau = 0,
    AtlanticCity = 1,
}

impl Default for SicBoPaytable {
    fn default() -> Self {
        SicBoPaytable::Macau
    }
}

impl TryFrom<u8> for SicBoPaytable {
    type Error = ();

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(SicBoPaytable::Macau),
            1 => Ok(SicBoPaytable::AtlanticCity),
            _ => Err(()),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SicBoRules {
    paytable: SicBoPaytable,
}

impl Default for SicBoRules {
    fn default() -> Self {
        Self {
            paytable: SicBoPaytable::default(),
        }
    }
}

impl SicBoRules {
    fn from_byte(value: u8) -> Option<Self> {
        Some(Self {
            paytable: SicBoPaytable::try_from(value & 0x01).ok()?,
        })
    }

    fn to_byte(self) -> u8 {
        self.paytable as u8
    }
}

/// Sic Bo bet types.
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BetType {
    Small = 0,               // 4-10, loses on triple (1:1)
    Big = 1,                 // 11-17, loses on triple (1:1)
    Odd = 2,                 // Odd total (1:1)
    Even = 3,                // Even total (1:1)
    SpecificTriple = 4,      // All three same specific (150:1)
    AnyTriple = 5,           // Any triple (24:1)
    SpecificDouble = 6,      // At least two of specific (8:1)
    Total = 7,               // Specific total (various)
    Single = 8,              // Single number appears 1-3 times (1:1 to 3:1)
    Domino = 9,              // Two-number combination (5:1)
    ThreeNumberEasyHop = 10, // Three unique numbers (30:1)
    ThreeNumberHardHop = 11, // Two of one number + one of another (50:1)
    FourNumberEasyHop = 12,  // Three-of-four numbers (7:1)
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
            9 => Ok(BetType::Domino),
            10 => Ok(BetType::ThreeNumberEasyHop),
            11 => Ok(BetType::ThreeNumberHardHop),
            12 => Ok(BetType::FourNumberEasyHop),
            _ => Err(GameError::InvalidPayload),
        }
    }
}

/// A single bet in Sic Bo (10 bytes).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SicBoBet {
    pub bet_type: BetType,
    pub number: u8,
    pub amount: u64,
}

impl SicBoBet {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(10);
        bytes.push(self.bet_type as u8);
        bytes.push(self.number);
        bytes.extend_from_slice(&self.amount.to_be_bytes());
        bytes
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < 10 {
            return None;
        }
        let bet_type = BetType::try_from(bytes[0]).ok()?;
        let number = bytes[1];
        let amount = u64::from_be_bytes(bytes[2..10].try_into().ok()?);
        Some(Self {
            bet_type,
            number,
            amount,
        })
    }
}

/// Sic Bo game state.
struct SicBoState {
    bets: Vec<SicBoBet>,
    dice: Option<[u8; 3]>,
    rules: SicBoRules,
}

impl SicBoState {
    fn new() -> Self {
        Self {
            bets: Vec::new(),
            dice: None,
            rules: SicBoRules::default(),
        }
    }

    fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.is_empty() {
            return Some(Self::new());
        }

        let bet_count = bytes[0] as usize;

        // Validate bet count against maximum to prevent DoS via large allocations
        const MAX_BETS: usize = 20;
        if bet_count > MAX_BETS {
            return None;
        }

        let expected_bet_bytes = bet_count * 10;

        if bytes.len() < 1 + expected_bet_bytes {
            return None;
        }

        let mut bets = Vec::with_capacity(bet_count);
        let mut offset = 1;
        for _ in 0..bet_count {
            let bet = SicBoBet::from_bytes(&bytes[offset..])?;
            bets.push(bet);
            offset += 10;
        }

        // Optional dice result (3 bytes)
        let dice = if bytes.len() >= offset + 3 {
            Some([bytes[offset], bytes[offset + 1], bytes[offset + 2]])
        } else {
            None
        };

        let rules_offset = offset + if dice.is_some() { 3 } else { 0 };
        let rules = if bytes.len() > rules_offset {
            SicBoRules::from_byte(bytes[rules_offset])?
        } else {
            SicBoRules::default()
        };

        Some(Self { bets, dice, rules })
    }

    fn to_bytes(&self) -> Vec<u8> {
        // Capacity: 1 (bet count) + bets (10 bytes each) + 3 (optional dice) + 1 (rules)
        let capacity =
            1 + (self.bets.len() * 10) + if self.dice.is_some() { 3 } else { 0 } + 1;
        let mut bytes = Vec::with_capacity(capacity);
        bytes.push(self.bets.len() as u8);
        for bet in &self.bets {
            bytes.extend(bet.to_bytes());
        }
        if let Some(dice) = self.dice {
            bytes.extend_from_slice(&dice);
        }
        bytes.push(self.rules.to_byte());
        bytes
    }
}

/// Payout table for total bets.
fn total_payout(total: u8, paytable: SicBoPaytable) -> u64 {
    match paytable {
        SicBoPaytable::Macau => match total {
            3 | 18 => 180,
            4 | 17 => 50,
            5 | 16 => 18,
            6 | 15 => 14,
            7 | 14 => 12,
            8 | 13 => 8,
            9 | 12 => 6,
            10 | 11 => 6,
            _ => 0,
        },
        SicBoPaytable::AtlanticCity => match total {
            3 | 18 => 180,
            4 | 17 => 60,
            5 | 16 => 30,
            6 | 15 => 17,
            7 | 14 => 12,
            8 | 13 => 8,
            9 | 12 => 6,
            10 | 11 => 6,
            _ => 0,
        },
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

fn dice_all_distinct(dice: &[u8; 3]) -> bool {
    dice[0] != dice[1] && dice[0] != dice[2] && dice[1] != dice[2]
}

fn dice_mask(dice: &[u8; 3]) -> u8 {
    let mut mask: u8 = 0;
    for &d in dice {
        if (1..=6).contains(&d) {
            mask |= 1u8 << (d - 1);
        }
    }
    mask
}

/// Calculate payout for a single bet given the dice result.
fn calculate_bet_payout(bet: &SicBoBet, dice: &[u8; 3], rules: SicBoRules) -> u64 {
    let total: u8 = dice.iter().sum();
    let triple = is_triple(dice);

    match bet.bet_type {
        BetType::Small => {
            if !triple && (4..=10).contains(&total) {
                bet.amount.saturating_mul(2) // 1:1 -> 2x
            } else {
                0
            }
        }
        BetType::Big => {
            if !triple && (11..=17).contains(&total) {
                bet.amount.saturating_mul(2)
            } else {
                0
            }
        }
        BetType::Odd => {
            if total % 2 == 1 && !triple {
                bet.amount.saturating_mul(2)
            } else {
                0
            }
        }
        BetType::Even => {
            if total % 2 == 0 && !triple {
                bet.amount.saturating_mul(2)
            } else {
                0
            }
        }
        BetType::SpecificTriple => {
            if triple && dice[0] == bet.number {
                let payout: u64 = match rules.paytable {
                    SicBoPaytable::Macau => 150,
                    SicBoPaytable::AtlanticCity => 180,
                };
                bet.amount.saturating_mul(payout.saturating_add(1))
            } else {
                0
            }
        }
        BetType::AnyTriple => {
            if triple {
                let payout: u64 = match rules.paytable {
                    SicBoPaytable::Macau => 24,
                    SicBoPaytable::AtlanticCity => 30,
                };
                bet.amount.saturating_mul(payout.saturating_add(1))
            } else {
                0
            }
        }
        BetType::SpecificDouble => {
            if count_number(dice, bet.number) >= 2 {
                let payout: u64 = match rules.paytable {
                    SicBoPaytable::Macau => 8,
                    SicBoPaytable::AtlanticCity => 10,
                };
                bet.amount.saturating_mul(payout.saturating_add(1))
            } else {
                0
            }
        }
        BetType::Total => {
            if total == bet.number {
                bet.amount.saturating_mul(total_payout(bet.number, rules.paytable) + 1)
            } else {
                0
            }
        }
        BetType::Single => {
            let count = count_number(dice, bet.number);
            match count {
                1 => bet.amount.saturating_mul(2), // 1:1 -> 2x
                2 => bet.amount.saturating_mul(3), // 2:1 -> 3x
                3 => bet.amount.saturating_mul(4), // 3:1 -> 4x
                _ => 0,
            }
        }
        BetType::Domino => {
            let min = (bet.number >> 4) & 0x0f;
            let max = bet.number & 0x0f;
            if !(1..=6).contains(&min) || !(1..=6).contains(&max) || min >= max {
                return 0;
            }
            if count_number(dice, min) >= 1 && count_number(dice, max) >= 1 {
                // 5:1 -> return 6x (stake + winnings)
                bet.amount.saturating_mul(6)
            } else {
                0
            }
        }
        BetType::ThreeNumberEasyHop => {
            // number encodes a 6-bit mask of the chosen numbers (1..6), with exactly 3 bits set.
            let mask = bet.number;
            if mask & !0x3F != 0 || mask.count_ones() != 3 {
                return 0;
            }
            if dice_all_distinct(dice) && (dice_mask(dice) & mask) == dice_mask(dice) {
                // 30:1 -> return 31x
                bet.amount.saturating_mul(31)
            } else {
                0
            }
        }
        BetType::ThreeNumberHardHop => {
            // number encodes (double<<4)|single.
            let double = (bet.number >> 4) & 0x0F;
            let single = bet.number & 0x0F;
            if !(1..=6).contains(&double) || !(1..=6).contains(&single) || double == single {
                return 0;
            }
            if count_number(dice, double) == 2 && count_number(dice, single) == 1 {
                // 50:1 -> return 51x
                bet.amount.saturating_mul(51)
            } else {
                0
            }
        }
        BetType::FourNumberEasyHop => {
            // number encodes a 6-bit mask of the chosen numbers (1..6), with exactly 4 bits set.
            let mask = bet.number;
            if mask & !0x3F != 0 || mask.count_ones() != 4 {
                return 0;
            }
            if dice_all_distinct(dice) && (dice_mask(dice) & mask) == dice_mask(dice) {
                // 7:1 -> return 8x
                bet.amount.saturating_mul(8)
            } else {
                0
            }
        }
    }
}

/// Generate JSON logs for Sic Bo game completion
fn generate_sicbo_logs(
    state: &SicBoState,
    dice: &[u8; 3],
    total_wagered: u64,
    total_return: u64,
) -> Vec<String> {
    let total: u8 = dice.iter().sum();
    let is_triple = is_triple(dice);

    // Build bet results array
    let bet_results: Vec<String> = state
        .bets
        .iter()
        .map(|bet| {
            let payout = calculate_bet_payout(bet, dice, state.rules);
            let won = payout > 0;
            let bet_type_str = match bet.bet_type {
                BetType::Small => "SMALL",
                BetType::Big => "BIG",
                BetType::Odd => "ODD",
                BetType::Even => "EVEN",
                BetType::SpecificTriple => "SPECIFIC_TRIPLE",
                BetType::AnyTriple => "ANY_TRIPLE",
                BetType::SpecificDouble => "SPECIFIC_DOUBLE",
                BetType::Total => "TOTAL",
                BetType::Single => "SINGLE",
                BetType::Domino => "DOMINO",
                BetType::ThreeNumberEasyHop => "THREE_NUMBER_EASY_HOP",
                BetType::ThreeNumberHardHop => "THREE_NUMBER_HARD_HOP",
                BetType::FourNumberEasyHop => "FOUR_NUMBER_EASY_HOP",
            };
            format!(
                r#"{{"type":"{}","number":{},"amount":{},"won":{},"payout":{}}}"#,
                bet_type_str, bet.number, bet.amount, won, payout
            )
        })
        .collect();

    vec![format!(
        r#"{{"dice":[{},{},{}],"total":{},"isTriple":{},"bets":[{}],"totalWagered":{},"totalReturn":{}}}"#,
        dice[0], dice[1], dice[2],
        total,
        is_triple,
        bet_results.join(","),
        total_wagered,
        total_return
    )]
}

pub struct SicBo;

impl CasinoGame for SicBo {
    fn init(session: &mut GameSession, _rng: &mut GameRng) -> GameResult {
        let state = SicBoState::new();
        session.state_blob = state.to_bytes();
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

        let action = payload[0];
        let mut state =
            SicBoState::from_bytes(&session.state_blob).ok_or(GameError::InvalidMove)?;

        match action {
            // Action 0: Place bet
            0 => {
                let (bet_type, number, amount) = super::payload::parse_place_bet_payload(payload)?;
                let bet_type = BetType::try_from(bet_type)?;

                // Validate number for bet types that need it
                match bet_type {
                    BetType::SpecificTriple | BetType::SpecificDouble | BetType::Single => {
                        if !(1..=6).contains(&number) {
                            return Err(GameError::InvalidPayload);
                        }
                    }
                    BetType::Total => {
                        if !(3..=18).contains(&number) {
                            return Err(GameError::InvalidPayload);
                        }
                    }
                    BetType::Domino => {
                        let min = (number >> 4) & 0x0f;
                        let max = number & 0x0f;
                        if !(1..=6).contains(&min) || !(1..=6).contains(&max) || min >= max {
                            return Err(GameError::InvalidPayload);
                        }
                    }
                    BetType::ThreeNumberEasyHop => {
                        if number & !0x3F != 0 || number.count_ones() != 3 {
                            return Err(GameError::InvalidPayload);
                        }
                    }
                    BetType::ThreeNumberHardHop => {
                        let double = (number >> 4) & 0x0f;
                        let single = number & 0x0f;
                        if !(1..=6).contains(&double)
                            || !(1..=6).contains(&single)
                            || double == single
                        {
                            return Err(GameError::InvalidPayload);
                        }
                    }
                    BetType::FourNumberEasyHop => {
                        if number & !0x3F != 0 || number.count_ones() != 4 {
                            return Err(GameError::InvalidPayload);
                        }
                    }
                    _ => {}
                }

                super::payload::ensure_nonzero_amount(amount)?;

                state.bets.push(SicBoBet {
                    bet_type,
                    number,
                    amount,
                });
                session.state_blob = state.to_bytes();
                session.move_count += 1;
                Ok(GameResult::ContinueWithUpdate {
                    payout: -(amount as i64), logs: vec![],
                })
            }

            // Action 4: Set rules
            4 => {
                if payload.len() != 2 {
                    return Err(GameError::InvalidPayload);
                }
                if state.dice.is_some() {
                    return Err(GameError::InvalidMove);
                }
                let rules = SicBoRules::from_byte(payload[1]).ok_or(GameError::InvalidPayload)?;
                state.rules = rules;
                session.state_blob = state.to_bytes();
                Ok(GameResult::Continue(vec![]))
            }

            // Action 1: Roll dice and resolve all bets
            1 => {
                if state.bets.is_empty() {
                    return Err(GameError::InvalidPayload); // Must have at least one bet
                }

                // Roll three dice
                let dice: [u8; 3] = [rng.roll_die(), rng.roll_die(), rng.roll_die()];
                state.dice = Some(dice);

                // Calculate total winnings and losses
                let total_bet: u64 = state.bets.iter().map(|b| b.amount).sum();
                let total_winnings: u64 = state
                    .bets
                    .iter()
                    .map(|bet| calculate_bet_payout(bet, &dice, state.rules))
                    .sum();

                session.state_blob = state.to_bytes();
                session.move_count += 1;
                session.is_complete = true;

                // Determine overall result.
                // All wagers were deducted via ContinueWithUpdate at bet time, so the completion
                // result should return the total amount to credit back (if any).
                if total_winnings > 0 {
                    let final_winnings = if session.super_mode.is_active {
                        let dice_total = dice.iter().sum::<u8>();
                        apply_super_multiplier_total(
                            dice_total,
                            &session.super_mode.multipliers,
                            total_winnings,
                        )
                    } else {
                        total_winnings
                    };
                    let logs = generate_sicbo_logs(&state, &dice, total_bet, final_winnings);
                    Ok(GameResult::Win(final_winnings, logs))
                } else {
                    let logs = generate_sicbo_logs(&state, &dice, total_bet, 0);
                    Ok(GameResult::LossPreDeducted(total_bet, logs))
                }
            }

            // Action 2: Clear all bets (with refund)
            2 => {
                // Calculate total to refund (bets were deducted via ContinueWithUpdate)
                let refund: u64 = state.bets.iter().map(|b| b.amount).sum();
                state.bets.clear();
                session.state_blob = state.to_bytes();

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

            // Action 3: Atomic batch - place all bets + roll in one transaction
            // Each bet is 10 bytes: [bet_type:u8, number:u8, amount:u64 BE]
            // This ensures all-or-nothing semantics - no partial bet states
            3 => {
                // Must have existing bets cleared first (fresh round)
                if !state.bets.is_empty() || state.dice.is_some() {
                    return Err(GameError::InvalidMove);
                }

                if payload.len() < 2 {
                    return Err(GameError::InvalidPayload);
                }

                let bet_count = payload[1] as usize;
                if bet_count == 0 || bet_count > MAX_BETS {
                    return Err(GameError::InvalidPayload);
                }

                // Expected payload size: 2 (action + count) + bet_count * 10 (type + number + amount)
                let expected_len = 2 + bet_count * 10;
                if payload.len() < expected_len {
                    return Err(GameError::InvalidPayload);
                }

                // Parse and validate all bets first (before any state changes)
                let mut bets_to_place: Vec<SicBoBet> = Vec::with_capacity(bet_count);
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

                    bets_to_place.push(SicBoBet {
                        bet_type,
                        number,
                        amount,
                    });

                    offset += 10;
                }

                session.bet = total_wager;

                // All validation passed - now execute atomically
                state.bets = bets_to_place;

                // Roll the dice
                let dice: [u8; 3] = [rng.roll_die(), rng.roll_die(), rng.roll_die()];
                state.dice = Some(dice);

                // Calculate total winnings
                let total_winnings: u64 = state
                    .bets
                    .iter()
                    .map(|bet| calculate_bet_payout(bet, &dice, state.rules))
                    .sum();

                session.state_blob = state.to_bytes();
                session.move_count += 1;
                session.is_complete = true;

                // Determine result
                if total_winnings > 0 {
                    let final_winnings = if session.super_mode.is_active {
                        let dice_total = dice.iter().sum::<u8>();
                        apply_super_multiplier_total(
                            dice_total,
                            &session.super_mode.multipliers,
                            total_winnings,
                        )
                    } else {
                        total_winnings
                    };
                    let logs = generate_sicbo_logs(&state, &dice, total_wager, final_winnings);
                    Ok(GameResult::Win(final_winnings, logs))
                } else {
                    // Total loss - wager is deducted on completion for atomic batch
                    let logs = generate_sicbo_logs(&state, &dice, total_wager, 0);
                    Ok(GameResult::Loss(logs))
                }
            }

            _ => Err(GameError::InvalidPayload),
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
            is_tournament: false,
            tournament_id: None,
        }
    }

    /// Helper to create a place bet payload.
    fn place_bet_payload(bet_type: u8, number: u8, amount: u64) -> Vec<u8> {
        let mut payload = vec![0, bet_type, number];
        payload.extend_from_slice(&amount.to_be_bytes());
        payload
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
        assert_eq!(total_payout(3, SicBoPaytable::Macau), 180);
        assert_eq!(total_payout(4, SicBoPaytable::Macau), 50);
        assert_eq!(total_payout(17, SicBoPaytable::Macau), 50);
        assert_eq!(total_payout(18, SicBoPaytable::Macau), 180);
        assert_eq!(total_payout(5, SicBoPaytable::Macau), 18);
        assert_eq!(total_payout(10, SicBoPaytable::Macau), 6);
        assert_eq!(total_payout(11, SicBoPaytable::Macau), 6);
        assert_eq!(total_payout(4, SicBoPaytable::AtlanticCity), 60);
        assert_eq!(total_payout(6, SicBoPaytable::AtlanticCity), 17);
    }

    #[test]
    fn test_atlantic_city_triple_payouts() {
        let rules = SicBoRules {
            paytable: SicBoPaytable::AtlanticCity,
        };
        let bet = SicBoBet {
            bet_type: BetType::AnyTriple,
            number: 0,
            amount: 10,
        };
        assert_eq!(
            calculate_bet_payout(&bet, &[3, 3, 3], rules),
            10 * 31
        );
    }

    #[test]
    fn test_domino_two_faces_payout() {
        // Domino (two faces): pays 5:1 if the roll contains both numbers.
        // Encoding is (min<<4)|max.
        let bet = SicBoBet {
            bet_type: BetType::Domino,
            number: (2 << 4) | 5,
            amount: 10,
        };

        assert_eq!(
            calculate_bet_payout(&bet, &[1, 2, 5], SicBoRules::default()),
            10 * 6
        );
        assert_eq!(
            calculate_bet_payout(&bet, &[2, 2, 5], SicBoRules::default()),
            10 * 6
        );
        assert_eq!(
            calculate_bet_payout(&bet, &[2, 5, 5], SicBoRules::default()),
            10 * 6
        );

        // Missing one of the faces loses.
        assert_eq!(
            calculate_bet_payout(&bet, &[2, 2, 2], SicBoRules::default()),
            0
        );
        assert_eq!(
            calculate_bet_payout(&bet, &[5, 5, 5], SicBoRules::default()),
            0
        );
        assert_eq!(
            calculate_bet_payout(&bet, &[1, 3, 4], SicBoRules::default()),
            0
        );
    }

    #[test]
    fn test_three_number_easy_hop_payout() {
        let bet = SicBoBet {
            bet_type: BetType::ThreeNumberEasyHop,
            number: (1u8 << 0) | (1u8 << 2) | (1u8 << 4), // {1,3,5}
            amount: 10,
        };

        assert_eq!(
            calculate_bet_payout(&bet, &[1, 3, 5], SicBoRules::default()),
            10 * 31
        );
        assert_eq!(
            calculate_bet_payout(&bet, &[5, 1, 3], SicBoRules::default()),
            10 * 31
        );
        assert_eq!(
            calculate_bet_payout(&bet, &[1, 1, 5], SicBoRules::default()),
            0
        );
        assert_eq!(
            calculate_bet_payout(&bet, &[1, 3, 6], SicBoRules::default()),
            0
        );
    }

    #[test]
    fn test_three_number_hard_hop_payout() {
        let bet = SicBoBet {
            bet_type: BetType::ThreeNumberHardHop,
            number: (2u8 << 4) | 4u8, // 2-2-4
            amount: 10,
        };

        assert_eq!(
            calculate_bet_payout(&bet, &[2, 2, 4], SicBoRules::default()),
            10 * 51
        );
        assert_eq!(
            calculate_bet_payout(&bet, &[2, 4, 2], SicBoRules::default()),
            10 * 51
        );
        assert_eq!(
            calculate_bet_payout(&bet, &[2, 4, 4], SicBoRules::default()),
            0
        );
        assert_eq!(
            calculate_bet_payout(&bet, &[2, 2, 2], SicBoRules::default()),
            0
        );
    }

    #[test]
    fn test_four_number_easy_hop_payout() {
        let bet = SicBoBet {
            bet_type: BetType::FourNumberEasyHop,
            number: (1u8 << 0) | (1u8 << 2) | (1u8 << 3) | (1u8 << 5), // {1,3,4,6}
            amount: 10,
        };

        assert_eq!(
            calculate_bet_payout(&bet, &[1, 3, 4], SicBoRules::default()),
            10 * 8
        );
        assert_eq!(
            calculate_bet_payout(&bet, &[6, 4, 3], SicBoRules::default()),
            10 * 8
        );
        assert_eq!(
            calculate_bet_payout(&bet, &[1, 3, 5], SicBoRules::default()),
            0
        );
        assert_eq!(
            calculate_bet_payout(&bet, &[1, 1, 4], SicBoRules::default()),
            0
        );
    }

    #[test]
    fn test_small_bet() {
        // Small: total 4-10, loses on triple
        // Total 6 (non-triple) = win
        let dice = [1, 2, 3]; // total 6
        let total: u8 = dice.iter().sum();
        let triple = is_triple(&dice);

        assert!(!triple && (4..=10).contains(&total));
    }

    #[test]
    fn test_big_bet() {
        // Big: total 11-17, loses on triple
        let dice = [4, 5, 6]; // total 15
        let total: u8 = dice.iter().sum();
        let triple = is_triple(&dice);

        assert!(!triple && (11..=17).contains(&total));
    }

    #[test]
    fn test_place_bet() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        SicBo::init(&mut session, &mut rng);
        assert!(!session.is_complete);

        // Place a Small bet
        let payload = place_bet_payload(0, 0, 100); // Small bet, number doesn't matter, 100 amount
        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = SicBo::process_move(&mut session, &payload, &mut rng);

        assert!(result.is_ok());
        assert!(!session.is_complete); // Not complete until dice rolled
        assert!(matches!(
            result.expect("Failed to process move"),
            GameResult::Continue(_) | GameResult::ContinueWithUpdate { .. }
        ));

        // Verify bet was stored
        let state = SicBoState::from_bytes(&session.state_blob).expect("Failed to parse state");
        assert_eq!(state.bets.len(), 1);
        assert_eq!(state.bets[0].bet_type, BetType::Small);
        assert_eq!(state.bets[0].amount, 100);
    }

    #[test]
    fn test_game_completes() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        SicBo::init(&mut session, &mut rng);
        assert!(!session.is_complete);

        // Place a Small bet
        let payload = place_bet_payload(0, 0, 100);
        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = SicBo::process_move(&mut session, &payload, &mut rng);
        assert!(result.is_ok());
        assert!(!session.is_complete);

        // Roll dice
        let mut rng = GameRng::new(&seed, session.id, 2);
        let result = SicBo::process_move(&mut session, &[1], &mut rng);

        assert!(result.is_ok());
        assert!(session.is_complete);

        // Verify dice were rolled and stored
        let state = SicBoState::from_bytes(&session.state_blob).expect("Failed to parse state");
        assert!(state.dice.is_some());
        let dice = state.dice.expect("Dice should be rolled");
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
        let payload = place_bet_payload(8, 0, 100);
        let result = SicBo::process_move(&mut session, &payload, &mut rng);
        assert!(matches!(result, Err(GameError::InvalidPayload)));

        // Single bet with invalid number (7)
        let payload = place_bet_payload(8, 7, 100);
        let result = SicBo::process_move(&mut session, &payload, &mut rng);
        assert!(matches!(result, Err(GameError::InvalidPayload)));

        // Total bet with invalid number (2)
        let payload = place_bet_payload(7, 2, 100);
        let result = SicBo::process_move(&mut session, &payload, &mut rng);
        assert!(matches!(result, Err(GameError::InvalidPayload)));

        // Total bet with invalid number (19)
        let payload = place_bet_payload(7, 19, 100);
        let result = SicBo::process_move(&mut session, &payload, &mut rng);
        assert!(matches!(result, Err(GameError::InvalidPayload)));

        // Domino bet with invalid encoding (min == max)
        let payload = place_bet_payload(9, (3 << 4) | 3, 100);
        let result = SicBo::process_move(&mut session, &payload, &mut rng);
        assert!(matches!(result, Err(GameError::InvalidPayload)));
    }

    #[test]
    fn test_roll_without_bets() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        SicBo::init(&mut session, &mut rng);

        // Try to roll without placing any bets
        let mut rng = GameRng::new(&seed, session.id, 1);
        let result = SicBo::process_move(&mut session, &[1], &mut rng);

        assert!(matches!(result, Err(GameError::InvalidPayload)));
    }

    #[test]
    fn test_clear_bets() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        SicBo::init(&mut session, &mut rng);

        // Place a bet
        let payload = place_bet_payload(0, 0, 100);
        let mut rng = GameRng::new(&seed, session.id, 1);
        SicBo::process_move(&mut session, &payload, &mut rng).expect("Failed to process move");

        // Verify bet was placed
        let state = SicBoState::from_bytes(&session.state_blob).expect("Failed to parse state");
        assert_eq!(state.bets.len(), 1);

        // Clear bets
        let mut rng = GameRng::new(&seed, session.id, 2);
        let result = SicBo::process_move(&mut session, &[2], &mut rng);
        assert!(result.is_ok());

        // Verify bets were cleared
        let state = SicBoState::from_bytes(&session.state_blob).expect("Failed to parse state");
        assert_eq!(state.bets.len(), 0);
    }

    #[test]
    fn test_multi_bet() {
        let seed = create_test_seed();
        let mut session = create_test_session(100);
        let mut rng = GameRng::new(&seed, session.id, 0);

        SicBo::init(&mut session, &mut rng);

        // Place Small bet
        let payload = place_bet_payload(0, 0, 50);
        let mut rng = GameRng::new(&seed, session.id, 1);
        SicBo::process_move(&mut session, &payload, &mut rng).expect("Failed to process move");

        // Place Big bet
        let payload = place_bet_payload(1, 0, 50);
        let mut rng = GameRng::new(&seed, session.id, 2);
        SicBo::process_move(&mut session, &payload, &mut rng).expect("Failed to process move");

        // Verify both bets were placed
        let state = SicBoState::from_bytes(&session.state_blob).expect("Failed to parse state");
        assert_eq!(state.bets.len(), 2);
        assert_eq!(state.bets[0].bet_type, BetType::Small);
        assert_eq!(state.bets[1].bet_type, BetType::Big);

        // Roll dice
        let mut rng = GameRng::new(&seed, session.id, 3);
        let result = SicBo::process_move(&mut session, &[1], &mut rng);

        assert!(result.is_ok());
        assert!(session.is_complete);
    }

    #[test]
    fn test_various_outcomes() {
        let seed = create_test_seed();

        for session_id in 1..30 {
            let mut session = create_test_session(100);
            session.id = session_id;

            let mut rng = GameRng::new(&seed, session_id, 0);
            SicBo::init(&mut session, &mut rng);

            // Place Small bet
            let payload = place_bet_payload(0, 0, 100);
            let mut rng = GameRng::new(&seed, session_id, 1);
            SicBo::process_move(&mut session, &payload, &mut rng).expect("Failed to process move");

            // Roll dice
            let mut rng = GameRng::new(&seed, session_id, 2);
            let result = SicBo::process_move(&mut session, &[1], &mut rng);

            assert!(result.is_ok());
            assert!(session.is_complete);

            match result.expect("Failed to process move") {
                GameResult::Win(_, _) | GameResult::LossPreDeducted(_, _) => {}
                _ => panic!("SicBo should complete with Win or LossPreDeducted"),
            }
        }
    }
}
