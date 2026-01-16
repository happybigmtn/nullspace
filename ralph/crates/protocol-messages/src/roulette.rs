//! Roulette v2 compact encoding (spec: `compact-encoding-roulette.md`).
//!
//! This module implements the bitwise compact encoding for roulette move payloads
//! and state blobs as defined in the spec. All bit layouts are canonical; JS/TS
//! consumes generated artifacts.
//!
//! # Move Payload Encoding
//!
//! All roulette moves use a 1-byte header:
//! - `version` (3 bits): Protocol version (2 for v2)
//! - `opcode` (5 bits): Action type (0-4)
//!
//! PlaceBet includes bet_type (4 bits) + value (6 bits) + amount (ULEB128).
//! AtomicBatch includes bet_count (5 bits) + repeated bet descriptors.
//!
//! # State Blob Encoding
//!
//! State is encoded compactly using:
//! - 2-bit phase
//! - 3-bit zero_rule
//! - Optional 6-bit result
//! - Bit-packed bets and history
//! - ULEB128 for totals

use crate::codec::{
    BitReader, BitWriter, CodecError, CodecResult, DualDecoder, EncodingVersion,
    PayloadHeader, RouletteBetType,
};

// ============================================================================
// Roulette Opcodes (v2)
// ============================================================================

/// Roulette action opcodes for v2 compact encoding.
///
/// These map to the opcode values in the 5-bit opcode field of the header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum RouletteOpcode {
    /// Place a single bet (bet_type + value + amount).
    PlaceBet = 0,
    /// Spin the wheel (initiates the spin after bets are placed).
    Spin = 1,
    /// Clear all bets.
    ClearBets = 2,
    /// Set table rules variant (zero rule).
    SetRules = 3,
    /// Place multiple bets atomically.
    AtomicBatch = 4,
}

impl RouletteOpcode {
    /// All valid opcodes.
    pub const ALL: [Self; 5] = [
        Self::PlaceBet,
        Self::Spin,
        Self::ClearBets,
        Self::AtomicBatch,
        Self::SetRules,
    ];

    /// Opcodes that produce a header-only (1 byte) payload.
    pub const HEADER_ONLY: [Self; 2] = [Self::Spin, Self::ClearBets];

    /// Check if this opcode produces a header-only (1 byte) payload.
    #[must_use]
    pub const fn is_header_only(&self) -> bool {
        matches!(self, Self::Spin | Self::ClearBets)
    }
}

impl TryFrom<u8> for RouletteOpcode {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::PlaceBet),
            1 => Ok(Self::Spin),
            2 => Ok(Self::ClearBets),
            3 => Ok(Self::SetRules),
            4 => Ok(Self::AtomicBatch),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 4, // max opcode
            }),
        }
    }
}

// ============================================================================
// Bet Descriptor (roulette-specific wrapper)
// ============================================================================

/// A single roulette bet: bet_type (4 bits) + value (6 bits) + amount (ULEB128).
///
/// The `value` field encodes different things based on bet type:
/// - Straight: number 0-36, or 37 for 00
/// - Split/Street/Corner/SixLine: index (0-based) of the combination
/// - Dozen/Column: index 0-2
/// - Red/Black/Even/Odd/Low/High/Basket: unused (always 0)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RouletteBet {
    /// Type of bet (0-13, see `RouletteBetType`).
    pub bet_type: RouletteBetType,
    /// Position/index value (0-63, interpretation depends on bet_type).
    pub value: u8,
    /// Bet amount (in smallest currency unit).
    pub amount: u64,
}

impl RouletteBet {
    /// Bit width for bet type field.
    pub const BET_TYPE_BITS: usize = 4;

    /// Bit width for value field.
    pub const VALUE_BITS: usize = 6;

    /// Maximum bet count in a batch (fits in 5 bits).
    pub const MAX_BATCH: usize = 20;

    /// Create a new roulette bet.
    #[must_use]
    pub const fn new(bet_type: RouletteBetType, value: u8, amount: u64) -> Self {
        Self {
            bet_type,
            value,
            amount,
        }
    }

    /// Create a bet that doesn't require a value (e.g., Red, Black, Even, Odd).
    #[must_use]
    pub const fn simple(bet_type: RouletteBetType, amount: u64) -> Self {
        Self {
            bet_type,
            value: 0,
            amount,
        }
    }

    /// Encode this bet to a BitWriter.
    pub fn encode(&self, writer: &mut BitWriter) -> CodecResult<()> {
        writer.write_bits(self.bet_type as u64, Self::BET_TYPE_BITS)?;
        writer.write_bits(self.value as u64, Self::VALUE_BITS)?;
        writer.write_uleb128(self.amount)?;
        Ok(())
    }

    /// Decode a bet from a BitReader.
    pub fn decode(reader: &mut BitReader) -> CodecResult<Self> {
        let bet_type_raw = reader.read_bits(Self::BET_TYPE_BITS)? as u8;
        let bet_type = RouletteBetType::try_from(bet_type_raw).map_err(|_| {
            CodecError::InvalidVersion {
                version: bet_type_raw,
                expected: 13, // max bet type
            }
        })?;
        let value = reader.read_bits(Self::VALUE_BITS)? as u8;
        let amount = reader.read_uleb128()?;
        Ok(Self {
            bet_type,
            value,
            amount,
        })
    }

    /// Validate the bet against roulette rules.
    #[must_use]
    pub fn is_valid(&self) -> bool {
        // Check value is within expected range for bet type
        let max_value = match self.bet_type {
            RouletteBetType::Straight => 37, // 0-36 plus 00 (37)
            RouletteBetType::Split => 56,    // Number of valid split positions
            RouletteBetType::Street => 11,   // 12 streets (0-11)
            RouletteBetType::Corner => 21,   // Number of valid corner positions
            RouletteBetType::SixLine => 10,  // 11 six-line positions (0-10)
            RouletteBetType::Column => 2,    // 3 columns (0-2)
            RouletteBetType::Dozen => 2,     // 3 dozens (0-2)
            // These bets don't use value
            RouletteBetType::Red
            | RouletteBetType::Black
            | RouletteBetType::Even
            | RouletteBetType::Odd
            | RouletteBetType::Low
            | RouletteBetType::High
            | RouletteBetType::Basket => 0,
        };
        self.value <= max_value
    }
}

// ============================================================================
// Move Payload Encoding
// ============================================================================

/// A roulette move action with optional payload data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RouletteMove {
    /// Place a single bet.
    PlaceBet(RouletteBet),
    /// Spin the wheel to determine result.
    Spin,
    /// Clear all current bets.
    ClearBets,
    /// Place multiple bets atomically.
    AtomicBatch(Vec<RouletteBet>),
    /// Set table rules variant (zero rule).
    SetRules { rules_id: u64 },
}

impl RouletteMove {
    /// Get the opcode for this move.
    #[must_use]
    pub fn opcode(&self) -> RouletteOpcode {
        match self {
            Self::PlaceBet(_) => RouletteOpcode::PlaceBet,
            Self::Spin => RouletteOpcode::Spin,
            Self::ClearBets => RouletteOpcode::ClearBets,
            Self::AtomicBatch(_) => RouletteOpcode::AtomicBatch,
            Self::SetRules { .. } => RouletteOpcode::SetRules,
        }
    }

    /// Encode this move as a v2 compact payload.
    ///
    /// # Returns
    /// The encoded bytes. Header-only moves (Spin, ClearBets) return 1 byte.
    pub fn encode_v2(&self) -> CodecResult<Vec<u8>> {
        let mut writer = BitWriter::new();
        let header = PayloadHeader::new(self.opcode() as u8);
        header.encode(&mut writer)?;

        match self {
            Self::Spin | Self::ClearBets => {
                // Header only - no additional payload
            }
            Self::PlaceBet(bet) => {
                bet.encode(&mut writer)?;
            }
            Self::AtomicBatch(bets) => {
                // bet_count (5 bits, max 20)
                let count = bets.len().min(RouletteBet::MAX_BATCH);
                writer.write_bits(count as u64, 5)?;
                for bet in bets.iter().take(count) {
                    bet.encode(&mut writer)?;
                }
            }
            Self::SetRules { rules_id } => {
                writer.write_uleb128(*rules_id)?;
            }
        }

        Ok(writer.finish())
    }

    /// Decode a move from a v2 compact payload.
    ///
    /// # Errors
    /// Returns an error if the payload is invalid or has an unrecognized opcode.
    pub fn decode_v2(data: &[u8]) -> CodecResult<Self> {
        let mut reader = BitReader::new(data);
        let header = PayloadHeader::decode_validated(&mut reader, PayloadHeader::V2)?;
        let opcode = RouletteOpcode::try_from(header.opcode)?;

        Ok(match opcode {
            RouletteOpcode::Spin => Self::Spin,
            RouletteOpcode::ClearBets => Self::ClearBets,
            RouletteOpcode::PlaceBet => {
                let bet = RouletteBet::decode(&mut reader)?;
                Self::PlaceBet(bet)
            }
            RouletteOpcode::AtomicBatch => {
                let count = reader.read_bits(5)? as usize;
                let mut bets = Vec::with_capacity(count);
                for _ in 0..count {
                    bets.push(RouletteBet::decode(&mut reader)?);
                }
                Self::AtomicBatch(bets)
            }
            RouletteOpcode::SetRules => {
                let rules_id = reader.read_uleb128()?;
                Self::SetRules { rules_id }
            }
        })
    }

    /// Detect version and decode (dual-decode for v1/v2 migration).
    ///
    /// V2 payloads are decoded directly. V1 payloads return `Ok(None)` to
    /// signal that legacy decoding is needed.
    pub fn decode_dual(data: &[u8]) -> Result<Option<Self>, CodecError> {
        let info = DualDecoder::detect_version(data).map_err(|_e| CodecError::InvalidVersion {
            version: 0,
            expected: PayloadHeader::V2,
        })?;

        match info.version {
            EncodingVersion::V2 => Self::decode_v2(data).map(Some),
            EncodingVersion::V1 => Ok(None), // Caller should use legacy decoder
        }
    }
}

// ============================================================================
// State Blob Encoding
// ============================================================================

/// Roulette game phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum RoulettePhase {
    /// Waiting for bets.
    #[default]
    Betting = 0,
    /// Wheel is spinning.
    Spinning = 1,
    /// Spin complete, result available.
    Complete = 2,
}

impl RoulettePhase {
    /// Bit width for phase field.
    pub const BITS: usize = 2;
}

impl TryFrom<u8> for RoulettePhase {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Betting),
            1 => Ok(Self::Spinning),
            2 => Ok(Self::Complete),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 2, // max phase
            }),
        }
    }
}

/// Zero rule variant (La Partage, En Prison, etc.).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum ZeroRule {
    /// Standard (lose all on zero).
    #[default]
    Standard = 0,
    /// La Partage (return half on zero for even-money bets).
    LaPartage = 1,
    /// En Prison (imprison bet on zero for even-money bets).
    EnPrison = 2,
    /// American (double zero, no special rules).
    American = 3,
    /// Triple zero (some American tables).
    TripleZero = 4,
}

impl ZeroRule {
    /// Bit width for zero_rule field.
    pub const BITS: usize = 3;
}

impl TryFrom<u8> for ZeroRule {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Standard),
            1 => Ok(Self::LaPartage),
            2 => Ok(Self::EnPrison),
            3 => Ok(Self::American),
            4 => Ok(Self::TripleZero),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 4, // max zero_rule
            }),
        }
    }
}

/// Complete roulette state blob.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RouletteState {
    /// Current game phase.
    pub phase: RoulettePhase,
    /// Zero rule variant.
    pub zero_rule: ZeroRule,
    /// Result of spin (0-36, 37=00), if complete.
    pub result: Option<u8>,
    /// Active bets.
    pub bets: Vec<RouletteBet>,
    /// Total wagered on current spin.
    pub total_wagered: u64,
    /// Pending return (winnings).
    pub pending_return: u64,
    /// Recent results history.
    pub history: Vec<u8>,
}

impl RouletteState {
    /// Bit width for version field.
    pub const VERSION_BITS: usize = 3;

    /// Bit width for result field (0-37 fits in 6 bits).
    pub const RESULT_BITS: usize = 6;

    /// Bit width for bet count (0-20 fits in 5 bits).
    pub const BET_COUNT_BITS: usize = 5;

    /// Bit width for history count (0-31 fits in 5 bits).
    pub const HISTORY_COUNT_BITS: usize = 5;

    /// Maximum history entries.
    pub const MAX_HISTORY: usize = 31;

    /// Encode this state as a v2 compact blob.
    pub fn encode_v2(&self) -> CodecResult<Vec<u8>> {
        let mut writer = BitWriter::new();

        // Header bits
        writer.write_bits(PayloadHeader::V2 as u64, Self::VERSION_BITS)?;
        writer.write_bits(self.phase as u8 as u64, RoulettePhase::BITS)?;
        writer.write_bits(self.zero_rule as u8 as u64, ZeroRule::BITS)?;

        // has_result flag and optional result
        let has_result = self.result.is_some();
        writer.write_bit(has_result)?;
        if let Some(result) = self.result {
            writer.write_bits(result as u64, Self::RESULT_BITS)?;
        }

        // Bets
        let bet_count = self.bets.len().min(RouletteBet::MAX_BATCH);
        writer.write_bits(bet_count as u64, Self::BET_COUNT_BITS)?;
        for bet in self.bets.iter().take(bet_count) {
            bet.encode(&mut writer)?;
        }

        // Totals
        writer.write_uleb128(self.total_wagered)?;
        writer.write_uleb128(self.pending_return)?;

        // History
        let history_count = self.history.len().min(Self::MAX_HISTORY);
        writer.write_bits(history_count as u64, Self::HISTORY_COUNT_BITS)?;
        for &result in self.history.iter().take(history_count) {
            writer.write_bits(result as u64, Self::RESULT_BITS)?;
        }

        Ok(writer.finish())
    }

    /// Decode a state from a v2 compact blob.
    pub fn decode_v2(data: &[u8]) -> CodecResult<Self> {
        let mut reader = BitReader::new(data);

        // Header
        let version = reader.read_bits(Self::VERSION_BITS)? as u8;
        if version != PayloadHeader::V2 {
            return Err(CodecError::InvalidVersion {
                version,
                expected: PayloadHeader::V2,
            });
        }

        let phase = RoulettePhase::try_from(reader.read_bits(RoulettePhase::BITS)? as u8)?;
        let zero_rule = ZeroRule::try_from(reader.read_bits(ZeroRule::BITS)? as u8)?;

        // Optional result
        let has_result = reader.read_bit()?;
        let result = if has_result {
            Some(reader.read_bits(Self::RESULT_BITS)? as u8)
        } else {
            None
        };

        // Bets
        let bet_count = reader.read_bits(Self::BET_COUNT_BITS)? as usize;
        let mut bets = Vec::with_capacity(bet_count);
        for _ in 0..bet_count {
            bets.push(RouletteBet::decode(&mut reader)?);
        }

        // Totals
        let total_wagered = reader.read_uleb128()?;
        let pending_return = reader.read_uleb128()?;

        // History
        let history_count = reader.read_bits(Self::HISTORY_COUNT_BITS)? as usize;
        let mut history = Vec::with_capacity(history_count);
        for _ in 0..history_count {
            history.push(reader.read_bits(Self::RESULT_BITS)? as u8);
        }

        Ok(Self {
            phase,
            zero_rule,
            result,
            bets,
            total_wagered,
            pending_return,
            history,
        })
    }

    /// Estimate the v1 JSON-style encoding size for comparison.
    ///
    /// This is a rough estimate based on typical v1 field sizes:
    /// - phase: 1 byte enum + padding
    /// - zero_rule: 1 byte enum + padding
    /// - result: Option wrapper + u8
    /// - bets: array overhead + (type + value + amount) per bet
    /// - totals: 8 bytes each (u64)
    /// - history: array overhead + 1 byte per result
    #[must_use]
    pub fn estimate_v1_size(&self) -> usize {
        let base_overhead = 16; // object wrapper, padding
        let phase_size = 4;     // enum with padding
        let zero_rule_size = 4; // enum with padding
        let result_size = 4;    // Option + u8 with padding
        let bets_size = if self.bets.is_empty() {
            8 // empty array
        } else {
            8 + self.bets.len() * 16 // array overhead + (type + value + amount padding) per bet
        };
        let totals_size = 16; // two u64s
        let history_size = if self.history.is_empty() {
            8 // empty array
        } else {
            8 + self.history.len() // array overhead + 1 byte per result
        };

        base_overhead + phase_size + zero_rule_size + result_size + bets_size + totals_size + history_size
    }

    /// Calculate the actual v2 encoded size.
    #[must_use]
    pub fn v2_size(&self) -> usize {
        // Header bits
        let header_bits = Self::VERSION_BITS + RoulettePhase::BITS + ZeroRule::BITS + 1; // +1 for has_result flag
        let result_bits = if self.result.is_some() {
            Self::RESULT_BITS
        } else {
            0
        };

        // Bet bits
        let bet_count_bits = Self::BET_COUNT_BITS;
        let bet_bits: usize = self
            .bets
            .iter()
            .take(RouletteBet::MAX_BATCH)
            .map(|b| {
                RouletteBet::BET_TYPE_BITS
                    + RouletteBet::VALUE_BITS
                    + crate::codec::encode_uleb128(b.amount).len() * 8
            })
            .sum();

        // ULEB128 totals
        let total_wagered_bytes = crate::codec::encode_uleb128(self.total_wagered).len();
        let pending_return_bytes = crate::codec::encode_uleb128(self.pending_return).len();

        // History bits
        let history_count_bits = Self::HISTORY_COUNT_BITS;
        let history_bits = self.history.len().min(Self::MAX_HISTORY) * Self::RESULT_BITS;

        let total_bits = header_bits + result_bits + bet_count_bits + bet_bits + history_count_bits + history_bits;
        (total_bits + 7) / 8 + total_wagered_bytes + pending_return_bytes
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::bet_layouts;

    // ========================================================================
    // AC-1.1: Single bet payload <= 4 bytes for small amounts
    // ========================================================================

    #[test]
    fn test_single_bet_small_amount_4_bytes_ac_1_1() {
        // PlaceBet with small amount (< 128, fits in 1 byte ULEB128)
        let mov = RouletteMove::PlaceBet(RouletteBet::new(RouletteBetType::Straight, 17, 100));
        let payload = mov.encode_v2().unwrap();

        // 1 byte header + 4 bits bet_type + 6 bits value + 1 byte ULEB128(100)
        // = 8 + 10 + 8 = 26 bits = 4 bytes (with padding)
        assert!(
            payload.len() <= 4,
            "AC-1.1: Single bet payload must be <= 4 bytes for small amounts, got {}",
            payload.len()
        );
    }

    #[test]
    fn test_single_bet_various_types_ac_1_1() {
        let test_bets = [
            RouletteBet::new(RouletteBetType::Straight, 0, 100),
            RouletteBet::new(RouletteBetType::Split, 5, 50),
            RouletteBet::simple(RouletteBetType::Red, 100),
            RouletteBet::simple(RouletteBetType::Black, 127),
            RouletteBet::new(RouletteBetType::Dozen, 1, 100),
            RouletteBet::new(RouletteBetType::Column, 2, 50),
        ];

        for bet in test_bets {
            let mov = RouletteMove::PlaceBet(bet);
            let payload = mov.encode_v2().unwrap();
            assert!(
                payload.len() <= 4,
                "AC-1.1: Single bet ({:?}, {}, {}) must be <= 4 bytes, got {}",
                bet.bet_type,
                bet.value,
                bet.amount,
                payload.len()
            );
        }
    }

    #[test]
    fn test_spin_payload_1_byte_ac_1_1() {
        let payload = RouletteMove::Spin.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "AC-1.1: Spin must be 1 byte");
    }

    #[test]
    fn test_clear_bets_payload_1_byte_ac_1_1() {
        let payload = RouletteMove::ClearBets.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "AC-1.1: ClearBets must be 1 byte");
    }

    // ========================================================================
    // AC-1.2: Batch payload size reduction >= 40%
    // ========================================================================

    #[test]
    fn test_batch_payload_reduction_ac_1_2() {
        // Create a typical batch of 5 bets
        let bets = vec![
            RouletteBet::new(RouletteBetType::Straight, 17, 100),
            RouletteBet::new(RouletteBetType::Straight, 20, 100),
            RouletteBet::simple(RouletteBetType::Red, 200),
            RouletteBet::new(RouletteBetType::Column, 1, 150),
            RouletteBet::new(RouletteBetType::Dozen, 0, 100),
        ];

        let batch = RouletteMove::AtomicBatch(bets.clone());
        let v2_bytes = batch.encode_v2().unwrap();

        // Estimate v1 size: each bet would be ~16 bytes (type + value + amount with padding)
        // Plus array overhead
        let v1_estimate = 8 + bets.len() * 16; // ~88 bytes

        let reduction = 1.0 - (v2_bytes.len() as f64 / v1_estimate as f64);
        assert!(
            reduction >= 0.40,
            "AC-1.2: Batch payload reduction must be >= 40%, got {:.1}% (v1={}, v2={})",
            reduction * 100.0,
            v1_estimate,
            v2_bytes.len()
        );
    }

    #[test]
    fn test_batch_scales_linearly_ac_1_2() {
        // Single bet baseline
        let single = RouletteMove::PlaceBet(RouletteBet::new(RouletteBetType::Straight, 17, 100));
        let single_size = single.encode_v2().unwrap().len();

        // Multiple bets
        let batch_2 = RouletteMove::AtomicBatch(vec![
            RouletteBet::new(RouletteBetType::Straight, 17, 100),
            RouletteBet::new(RouletteBetType::Straight, 20, 100),
        ]);
        let batch_3 = RouletteMove::AtomicBatch(vec![
            RouletteBet::new(RouletteBetType::Straight, 17, 100),
            RouletteBet::new(RouletteBetType::Straight, 20, 100),
            RouletteBet::new(RouletteBetType::Straight, 23, 100),
        ]);

        let batch_2_size = batch_2.encode_v2().unwrap().len();
        let batch_3_size = batch_3.encode_v2().unwrap().len();

        // Each additional bet should add approximately the same amount
        let delta_2_3 = batch_3_size as i32 - batch_2_size as i32;
        let delta_1_2 = batch_2_size as i32 - single_size as i32;

        // They should be within 2 bytes of each other (accounting for rounding)
        assert!(
            (delta_2_3 - delta_1_2).abs() <= 2,
            "AC-1.2: Batch size should scale linearly. delta(2->3)={}, delta(1->2)={}",
            delta_2_3,
            delta_1_2
        );
    }

    // ========================================================================
    // AC-2.1: State compaction >= 30%
    // ========================================================================

    #[test]
    fn test_typical_state_compaction_ac_2_1() {
        // Typical state: a few bets, result available
        let state = RouletteState {
            phase: RoulettePhase::Complete,
            zero_rule: ZeroRule::Standard,
            result: Some(17),
            bets: vec![
                RouletteBet::new(RouletteBetType::Straight, 17, 100),
                RouletteBet::simple(RouletteBetType::Red, 200),
            ],
            total_wagered: 300,
            pending_return: 3600, // 35:1 on straight + loss on red
            history: vec![17, 0, 32, 15, 3],
        };

        let v2_bytes = state.encode_v2().unwrap();
        let v1_estimate = state.estimate_v1_size();

        let reduction = 1.0 - (v2_bytes.len() as f64 / v1_estimate as f64);
        assert!(
            reduction >= 0.30,
            "AC-2.1: State compaction must be >= 30%, got {:.1}% (v1={}, v2={})",
            reduction * 100.0,
            v1_estimate,
            v2_bytes.len()
        );
    }

    #[test]
    fn test_state_with_many_bets_compaction_ac_2_1() {
        // State with multiple bets
        let state = RouletteState {
            phase: RoulettePhase::Betting,
            zero_rule: ZeroRule::LaPartage,
            result: None,
            bets: vec![
                RouletteBet::new(RouletteBetType::Straight, 17, 100),
                RouletteBet::new(RouletteBetType::Straight, 20, 100),
                RouletteBet::new(RouletteBetType::Split, 5, 200),
                RouletteBet::simple(RouletteBetType::Red, 500),
                RouletteBet::new(RouletteBetType::Column, 1, 300),
            ],
            total_wagered: 1200,
            pending_return: 0,
            history: vec![],
        };

        let v2_bytes = state.encode_v2().unwrap();
        let v1_estimate = state.estimate_v1_size();

        let reduction = 1.0 - (v2_bytes.len() as f64 / v1_estimate as f64);
        assert!(
            reduction >= 0.30,
            "AC-2.1: Multi-bet state compaction must be >= 30%, got {:.1}% (v1={}, v2={})",
            reduction * 100.0,
            v1_estimate,
            v2_bytes.len()
        );
    }

    #[test]
    fn test_state_with_long_history_compaction_ac_2_1() {
        // State with long history
        let state = RouletteState {
            phase: RoulettePhase::Complete,
            zero_rule: ZeroRule::Standard,
            result: Some(7),
            bets: vec![RouletteBet::simple(RouletteBetType::Black, 100)],
            total_wagered: 100,
            pending_return: 0,
            history: vec![7, 14, 21, 28, 35, 0, 2, 4, 6, 8, 10, 12, 32, 34, 36],
        };

        let v2_bytes = state.encode_v2().unwrap();
        let v1_estimate = state.estimate_v1_size();

        let reduction = 1.0 - (v2_bytes.len() as f64 / v1_estimate as f64);
        assert!(
            reduction >= 0.30,
            "AC-2.1: History-heavy state compaction must be >= 30%, got {:.1}% (v1={}, v2={})",
            reduction * 100.0,
            v1_estimate,
            v2_bytes.len()
        );
    }

    // ========================================================================
    // AC-3.1: v1 and v2 both supported during migration
    // ========================================================================

    #[test]
    fn test_v2_payload_accepted_ac_3_1() {
        let mov = RouletteMove::Spin;
        let payload = mov.encode_v2().unwrap();

        // Should decode successfully
        let decoded = RouletteMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov, "AC-3.1: v2 payload must decode correctly");
    }

    #[test]
    fn test_v2_place_bet_roundtrip_ac_3_1() {
        let original = RouletteMove::PlaceBet(RouletteBet::new(RouletteBetType::Straight, 17, 500));
        let payload = original.encode_v2().unwrap();
        let decoded = RouletteMove::decode_v2(&payload).unwrap();

        assert_eq!(decoded, original, "AC-3.1: PlaceBet must roundtrip");
    }

    #[test]
    fn test_v2_atomic_batch_roundtrip_ac_3_1() {
        let original = RouletteMove::AtomicBatch(vec![
            RouletteBet::new(RouletteBetType::Straight, 17, 100),
            RouletteBet::simple(RouletteBetType::Red, 200),
            RouletteBet::new(RouletteBetType::Dozen, 1, 50),
        ]);
        let payload = original.encode_v2().unwrap();
        let decoded = RouletteMove::decode_v2(&payload).unwrap();

        assert_eq!(decoded, original, "AC-3.1: AtomicBatch must roundtrip");
    }

    #[test]
    fn test_dual_decode_v2_payload_ac_3_1() {
        let mov = RouletteMove::Spin;
        let payload = mov.encode_v2().unwrap();

        // Dual decode should return Some for v2
        let result = RouletteMove::decode_dual(&payload).unwrap();
        assert!(result.is_some(), "AC-3.1: dual decode must return Some for v2");
        assert_eq!(result.unwrap(), mov);
    }

    #[test]
    fn test_dual_decode_v1_payload_returns_none_ac_3_1() {
        // Simulate a v1 payload (version bits = 1)
        let v1_payload = vec![0x01, 0x00, 0x00, 0x00];

        // Dual decode should return None for v1
        let result = RouletteMove::decode_dual(&v1_payload).unwrap();
        assert!(result.is_none(), "AC-3.1: dual decode must return None for v1");
    }

    // ========================================================================
    // State blob roundtrip tests
    // ========================================================================

    #[test]
    fn test_state_roundtrip_empty() {
        let state = RouletteState::default();
        let encoded = state.encode_v2().unwrap();
        let decoded = RouletteState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_typical() {
        let state = RouletteState {
            phase: RoulettePhase::Complete,
            zero_rule: ZeroRule::Standard,
            result: Some(17),
            bets: vec![RouletteBet::new(RouletteBetType::Straight, 17, 100)],
            total_wagered: 100,
            pending_return: 3600,
            history: vec![17],
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = RouletteState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_all_phases() {
        for phase in [
            RoulettePhase::Betting,
            RoulettePhase::Spinning,
            RoulettePhase::Complete,
        ] {
            let state = RouletteState {
                phase,
                ..Default::default()
            };
            let encoded = state.encode_v2().unwrap();
            let decoded = RouletteState::decode_v2(&encoded).unwrap();
            assert_eq!(decoded.phase, phase);
        }
    }

    #[test]
    fn test_state_roundtrip_all_zero_rules() {
        for zero_rule in [
            ZeroRule::Standard,
            ZeroRule::LaPartage,
            ZeroRule::EnPrison,
            ZeroRule::American,
            ZeroRule::TripleZero,
        ] {
            let state = RouletteState {
                zero_rule,
                ..Default::default()
            };
            let encoded = state.encode_v2().unwrap();
            let decoded = RouletteState::decode_v2(&encoded).unwrap();
            assert_eq!(decoded.zero_rule, zero_rule);
        }
    }

    #[test]
    fn test_state_roundtrip_with_double_zero() {
        // Test encoding of 00 (value 37)
        let state = RouletteState {
            phase: RoulettePhase::Complete,
            zero_rule: ZeroRule::American,
            result: Some(37), // 00
            bets: vec![],
            total_wagered: 0,
            pending_return: 0,
            history: vec![0, 37, 17], // 0, 00, 17
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = RouletteState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
        assert_eq!(decoded.result, Some(37));
        assert_eq!(decoded.history, vec![0, 37, 17]);
    }

    // ========================================================================
    // Move roundtrip tests
    // ========================================================================

    #[test]
    fn test_all_moves_roundtrip() {
        let moves = vec![
            RouletteMove::PlaceBet(RouletteBet::new(RouletteBetType::Straight, 17, 100)),
            RouletteMove::Spin,
            RouletteMove::ClearBets,
            RouletteMove::AtomicBatch(vec![]),
            RouletteMove::AtomicBatch(vec![RouletteBet::simple(RouletteBetType::Red, 50)]),
            RouletteMove::SetRules { rules_id: 42 },
        ];

        for mov in moves {
            let encoded = mov.encode_v2().unwrap();
            let decoded = RouletteMove::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, mov, "Move {:?} must roundtrip", mov);
        }
    }

    #[test]
    fn test_set_rules_roundtrip() {
        let test_ids = [0, 1, 127, 128, 1000, u64::MAX];

        for rules_id in test_ids {
            let mov = RouletteMove::SetRules { rules_id };
            let encoded = mov.encode_v2().unwrap();
            let decoded = RouletteMove::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, mov, "SetRules({}) must roundtrip", rules_id);
        }
    }

    // ========================================================================
    // Golden vector tests for determinism
    // ========================================================================

    #[test]
    fn test_spin_golden_vector() {
        let payload = RouletteMove::Spin.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 1 (bits 00001) = 0b00001_010 = 0x0A
        assert_eq!(payload, vec![0x0A], "Spin golden vector");
    }

    #[test]
    fn test_clear_bets_golden_vector() {
        let payload = RouletteMove::ClearBets.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 2 (bits 00010) = 0b00010_010 = 0x12
        assert_eq!(payload, vec![0x12], "ClearBets golden vector");
    }

    #[test]
    fn test_encoding_deterministic() {
        // Same input must produce same output every time
        for _ in 0..10 {
            let mov = RouletteMove::Spin;
            let payload = mov.encode_v2().unwrap();
            assert_eq!(payload, vec![0x0A]);
        }
    }

    #[test]
    fn test_place_bet_deterministic() {
        let bet = RouletteBet::new(RouletteBetType::Straight, 17, 100);
        let mov = RouletteMove::PlaceBet(bet);

        let payload1 = mov.encode_v2().unwrap();
        let payload2 = mov.encode_v2().unwrap();

        assert_eq!(payload1, payload2, "Encoding must be deterministic");
    }

    // ========================================================================
    // Edge case tests
    // ========================================================================

    #[test]
    fn test_empty_batch() {
        let mov = RouletteMove::AtomicBatch(vec![]);
        let payload = mov.encode_v2().unwrap();

        // Should have header + 5-bit count (0)
        // 8 bits + 5 bits = 13 bits = 2 bytes
        assert_eq!(payload.len(), 2, "Empty batch should be 2 bytes");

        let decoded = RouletteMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov);
    }

    #[test]
    fn test_max_batch_size() {
        let bets: Vec<_> = (0..RouletteBet::MAX_BATCH)
            .map(|i| RouletteBet::new(RouletteBetType::Straight, (i % 38) as u8, (i + 1) as u64 * 10))
            .collect();

        let mov = RouletteMove::AtomicBatch(bets);
        let payload = mov.encode_v2().unwrap();
        let decoded = RouletteMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov);
    }

    #[test]
    fn test_all_bet_types_roundtrip() {
        let bet_types = [
            (RouletteBetType::Straight, 17),
            (RouletteBetType::Split, 5),
            (RouletteBetType::Street, 3),
            (RouletteBetType::Corner, 10),
            (RouletteBetType::SixLine, 5),
            (RouletteBetType::Column, 1),
            (RouletteBetType::Dozen, 2),
            (RouletteBetType::Red, 0),
            (RouletteBetType::Black, 0),
            (RouletteBetType::Even, 0),
            (RouletteBetType::Odd, 0),
            (RouletteBetType::Low, 0),
            (RouletteBetType::High, 0),
            (RouletteBetType::Basket, 0),
        ];

        for (bet_type, value) in bet_types {
            let bet = RouletteBet::new(bet_type, value, 100);
            let mov = RouletteMove::PlaceBet(bet);
            let encoded = mov.encode_v2().unwrap();
            let decoded = RouletteMove::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, mov, "{:?} bet must roundtrip", bet_type);
        }
    }

    #[test]
    fn test_state_max_result_value() {
        // Test with max result (37 = 00 on American wheel)
        let state = RouletteState {
            phase: RoulettePhase::Complete,
            zero_rule: ZeroRule::American,
            result: Some(37),
            bets: vec![],
            total_wagered: 0,
            pending_return: 0,
            history: vec![37],
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = RouletteState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_bet_validation() {
        // Valid bets
        assert!(RouletteBet::new(RouletteBetType::Straight, 36, 100).is_valid());
        assert!(RouletteBet::new(RouletteBetType::Straight, 37, 100).is_valid()); // 00
        assert!(RouletteBet::new(RouletteBetType::Dozen, 2, 100).is_valid());
        assert!(RouletteBet::simple(RouletteBetType::Red, 100).is_valid());

        // Invalid bets
        assert!(!RouletteBet::new(RouletteBetType::Straight, 38, 100).is_valid());
        assert!(!RouletteBet::new(RouletteBetType::Dozen, 3, 100).is_valid());
        assert!(!RouletteBet::new(RouletteBetType::Column, 5, 100).is_valid());
    }

    // ========================================================================
    // Bet descriptor integration test
    // ========================================================================

    #[test]
    fn test_roulette_bet_uses_correct_layout() {
        // Verify that our RouletteBet encoding is compatible with the unified BetDescriptor
        let layout = bet_layouts::ROULETTE;

        // Check that our bit widths match the layout
        assert_eq!(RouletteBet::BET_TYPE_BITS, layout.bet_type_bits as usize);
        assert_eq!(RouletteBet::VALUE_BITS, layout.target_bits as usize);
    }
}
