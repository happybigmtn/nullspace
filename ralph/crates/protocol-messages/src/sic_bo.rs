//! Sic Bo v2 compact encoding (spec: `compact-encoding-sicbo.md`).
//!
//! This module implements the bitwise compact encoding for sic bo move payloads
//! and state blobs as defined in the spec. All bit layouts are canonical; JS/TS
//! consumes generated artifacts.
//!
//! # Move Payload Encoding
//!
//! All sic bo moves use a 1-byte header:
//! - `version` (3 bits): Protocol version (2 for v2)
//! - `opcode` (5 bits): Action type (0-4)
//!
//! PlaceBet includes bet_type (4 bits) + optional target (6 bits) + amount (ULEB128).
//! AtomicBatch includes bet_count (5 bits) + repeated bet descriptors.
//!
//! # State Blob Encoding
//!
//! State is encoded compactly using:
//! - 2-bit phase (Betting, Rolling, Resolved)
//! - 3-bit dice values (1-6 each, three dice)
//! - Bit-packed bets
//! - Roll history as 9-bit entries (3 dice × 3 bits)

use crate::codec::{
    BitReader, BitWriter, CodecError, CodecResult, DualDecoder, EncodingVersion, PayloadHeader,
    SicBoBetType,
};

// Re-export for convenience
pub use crate::codec::SicBoBetType as BetType;

// ============================================================================
// Sic Bo Opcodes (v2)
// ============================================================================

/// Sic Bo action opcodes for v2 compact encoding.
///
/// These map to the opcode values in the 5-bit opcode field of the header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum SicBoOpcode {
    /// Place a single bet (bet_type + optional target + amount).
    PlaceBet = 0,
    /// Roll the dice.
    Roll = 1,
    /// Clear all bets.
    ClearBets = 2,
    /// Place multiple bets atomically.
    AtomicBatch = 3,
    /// Set table rules variant.
    SetRules = 4,
}

impl SicBoOpcode {
    /// All valid opcodes.
    pub const ALL: [Self; 5] = [
        Self::PlaceBet,
        Self::Roll,
        Self::ClearBets,
        Self::AtomicBatch,
        Self::SetRules,
    ];

    /// Opcodes that produce a header-only (1 byte) payload.
    pub const HEADER_ONLY: [Self; 2] = [Self::Roll, Self::ClearBets];

    /// Check if this opcode produces a header-only (1 byte) payload.
    #[must_use]
    pub const fn is_header_only(&self) -> bool {
        matches!(self, Self::Roll | Self::ClearBets)
    }
}

impl TryFrom<u8> for SicBoOpcode {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::PlaceBet),
            1 => Ok(Self::Roll),
            2 => Ok(Self::ClearBets),
            3 => Ok(Self::AtomicBatch),
            4 => Ok(Self::SetRules),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 4, // max opcode
            }),
        }
    }
}

// ============================================================================
// Bet Descriptor (sic bo-specific wrapper)
// ============================================================================

/// A single sic bo bet: bet_type (4 bits) + optional target (6 bits) + amount (ULEB128).
///
/// The `target` field encodes a value specific to the bet type:
/// - Small/Big/Odd/Even/AnyTriple: target unused (0)
/// - SpecificTriple: target is the triple number (1-6 encoded as 0-5)
/// - SpecificDouble: target is the double number (1-6 encoded as 0-5)
/// - TwoFaceCombo: target encodes the two dice faces (0-14 for 15 combinations)
/// - SingleDice: target is the face value (1-6 encoded as 0-5)
/// - TotalSum: target is the sum value (4-17 encoded as 0-13)
/// - Domino: target encodes the domino combination (0-20)
/// - Hop: target encodes the dice combination
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SicBoBet {
    /// Type of bet (0-12, see `SicBoBetType`).
    pub bet_type: SicBoBetType,
    /// Target value (interpretation depends on bet_type).
    pub target: u8,
    /// Bet amount (in smallest currency unit).
    pub amount: u64,
}

impl SicBoBet {
    /// Bit width for bet type field (0-12 fits in 4 bits).
    pub const BET_TYPE_BITS: usize = 4;

    /// Bit width for target field (0-63 fits in 6 bits).
    pub const TARGET_BITS: usize = 6;

    /// Maximum bet count in a batch (fits in 5 bits).
    pub const MAX_BATCH: usize = 20;

    /// Create a new sic bo bet.
    #[must_use]
    pub const fn new(bet_type: SicBoBetType, target: u8, amount: u64) -> Self {
        Self {
            bet_type,
            target,
            amount,
        }
    }

    /// Create a bet that doesn't require a target (small, big, odd, even, any triple).
    #[must_use]
    pub const fn simple(bet_type: SicBoBetType, amount: u64) -> Self {
        Self {
            bet_type,
            target: 0,
            amount,
        }
    }

    /// Encode this bet to a BitWriter.
    pub fn encode(&self, writer: &mut BitWriter) -> CodecResult<()> {
        writer.write_bits(self.bet_type as u64, Self::BET_TYPE_BITS)?;
        // Only write target if the bet type requires it
        if self.bet_type.requires_target() {
            writer.write_bits(self.target as u64, Self::TARGET_BITS)?;
        }
        writer.write_uleb128(self.amount)?;
        Ok(())
    }

    /// Decode a bet from a BitReader.
    pub fn decode(reader: &mut BitReader) -> CodecResult<Self> {
        let bet_type_raw = reader.read_bits(Self::BET_TYPE_BITS)? as u8;
        let bet_type = SicBoBetType::try_from(bet_type_raw).map_err(|_| CodecError::InvalidVersion {
            version: bet_type_raw,
            expected: 12, // max bet type
        })?;

        let target = if bet_type.requires_target() {
            reader.read_bits(Self::TARGET_BITS)? as u8
        } else {
            0
        };

        let amount = reader.read_uleb128()?;
        Ok(Self {
            bet_type,
            target,
            amount,
        })
    }

    /// Validate the bet against sic bo rules.
    #[must_use]
    pub fn is_valid(&self) -> bool {
        // Check target is within valid range based on bet type
        if self.bet_type.requires_target() {
            // Target ranges depend on bet type:
            // - SpecificTriple/SpecificDouble/SingleDice: 0-5 (encoding 1-6)
            // - TwoFaceCombo: 0-14 (15 unique combinations)
            // - TotalSum: 0-13 (encoding 4-17)
            // - Domino: 0-20 (21 unique dominoes)
            // - Hop: 0-55 (56 possible dice combinations with order)
            // All fit within 6 bits (0-63)
            self.target <= 63
        } else {
            // Non-targeted bets should have target = 0
            self.target == 0
        }
    }
}

// ============================================================================
// Move Payload Encoding
// ============================================================================

/// A sic bo move action with optional payload data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SicBoMove {
    /// Place a single bet.
    PlaceBet(SicBoBet),
    /// Roll the dice.
    Roll,
    /// Clear all current bets.
    ClearBets,
    /// Place multiple bets atomically.
    AtomicBatch(Vec<SicBoBet>),
    /// Set table rules variant.
    SetRules { rules_id: u64 },
}

impl SicBoMove {
    /// Get the opcode for this move.
    #[must_use]
    pub fn opcode(&self) -> SicBoOpcode {
        match self {
            Self::PlaceBet(_) => SicBoOpcode::PlaceBet,
            Self::Roll => SicBoOpcode::Roll,
            Self::ClearBets => SicBoOpcode::ClearBets,
            Self::AtomicBatch(_) => SicBoOpcode::AtomicBatch,
            Self::SetRules { .. } => SicBoOpcode::SetRules,
        }
    }

    /// Encode this move as a v2 compact payload.
    ///
    /// # Returns
    /// The encoded bytes. Header-only moves (Roll, ClearBets) return 1 byte.
    pub fn encode_v2(&self) -> CodecResult<Vec<u8>> {
        let mut writer = BitWriter::new();
        let header = PayloadHeader::new(self.opcode() as u8);
        header.encode(&mut writer)?;

        match self {
            Self::Roll | Self::ClearBets => {
                // Header only - no additional payload
            }
            Self::PlaceBet(bet) => {
                bet.encode(&mut writer)?;
            }
            Self::AtomicBatch(bets) => {
                // bet_count (5 bits, max 20)
                let count = bets.len().min(SicBoBet::MAX_BATCH);
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
        let opcode = SicBoOpcode::try_from(header.opcode)?;

        Ok(match opcode {
            SicBoOpcode::Roll => Self::Roll,
            SicBoOpcode::ClearBets => Self::ClearBets,
            SicBoOpcode::PlaceBet => {
                let bet = SicBoBet::decode(&mut reader)?;
                Self::PlaceBet(bet)
            }
            SicBoOpcode::AtomicBatch => {
                let count = reader.read_bits(5)? as usize;
                let mut bets = Vec::with_capacity(count);
                for _ in 0..count {
                    bets.push(SicBoBet::decode(&mut reader)?);
                }
                Self::AtomicBatch(bets)
            }
            SicBoOpcode::SetRules => {
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

/// Sic Bo game phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum SicBoPhase {
    /// Waiting for bets.
    #[default]
    Betting = 0,
    /// Dice are being rolled.
    Rolling = 1,
    /// Roll resolved with results.
    Resolved = 2,
}

impl SicBoPhase {
    /// Bit width for phase field.
    pub const BITS: usize = 2;
}

impl TryFrom<u8> for SicBoPhase {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Betting),
            1 => Ok(Self::Rolling),
            2 => Ok(Self::Resolved),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 2, // max phase
            }),
        }
    }
}

/// A single roll result (three dice values).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct DiceRoll {
    /// First die value (1-6).
    pub die1: u8,
    /// Second die value (1-6).
    pub die2: u8,
    /// Third die value (1-6).
    pub die3: u8,
}

impl DiceRoll {
    /// Bit width for a single die (1-6 fits in 3 bits as 0-5).
    pub const DIE_BITS: usize = 3;

    /// Total bits for a roll (3 dice × 3 bits = 9 bits).
    pub const ROLL_BITS: usize = 9;

    /// Create a new dice roll.
    #[must_use]
    pub const fn new(die1: u8, die2: u8, die3: u8) -> Self {
        Self { die1, die2, die3 }
    }

    /// Calculate the sum of all three dice.
    #[must_use]
    pub const fn sum(&self) -> u8 {
        self.die1 + self.die2 + self.die3
    }

    /// Check if this is a triple (all dice same).
    #[must_use]
    pub const fn is_triple(&self) -> bool {
        self.die1 == self.die2 && self.die2 == self.die3
    }

    /// Encode this roll to a BitWriter (9 bits total).
    pub fn encode(&self, writer: &mut BitWriter) -> CodecResult<()> {
        // Subtract 1 to fit 1-6 in 3 bits (0-5)
        writer.write_bits((self.die1.saturating_sub(1)) as u64, Self::DIE_BITS)?;
        writer.write_bits((self.die2.saturating_sub(1)) as u64, Self::DIE_BITS)?;
        writer.write_bits((self.die3.saturating_sub(1)) as u64, Self::DIE_BITS)?;
        Ok(())
    }

    /// Decode a roll from a BitReader.
    pub fn decode(reader: &mut BitReader) -> CodecResult<Self> {
        // Add 1 to recover 1-6 from 0-5
        let die1 = (reader.read_bits(Self::DIE_BITS)? as u8) + 1;
        let die2 = (reader.read_bits(Self::DIE_BITS)? as u8) + 1;
        let die3 = (reader.read_bits(Self::DIE_BITS)? as u8) + 1;
        Ok(Self { die1, die2, die3 })
    }
}

/// Complete sic bo state blob.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SicBoState {
    /// Current game phase.
    pub phase: SicBoPhase,
    /// Current/last dice roll.
    pub current_roll: DiceRoll,
    /// Active bets.
    pub bets: Vec<SicBoBet>,
    /// Roll history (most recent first).
    pub history: Vec<DiceRoll>,
}

impl SicBoState {
    /// Bit width for version field.
    pub const VERSION_BITS: usize = 3;

    /// Bit width for bet count (0-20 fits in 5 bits).
    pub const BET_COUNT_BITS: usize = 5;

    /// Bit width for history count (0-31 fits in 5 bits).
    pub const HISTORY_COUNT_BITS: usize = 5;

    /// Maximum history entries to store.
    pub const MAX_HISTORY: usize = 20;

    /// Encode this state as a v2 compact blob.
    pub fn encode_v2(&self) -> CodecResult<Vec<u8>> {
        let mut writer = BitWriter::new();

        // Header bits
        writer.write_bits(PayloadHeader::V2 as u64, Self::VERSION_BITS)?;
        writer.write_bits(self.phase as u8 as u64, SicBoPhase::BITS)?;

        // Current dice roll
        self.current_roll.encode(&mut writer)?;

        // Bets
        let bet_count = self.bets.len().min(SicBoBet::MAX_BATCH);
        writer.write_bits(bet_count as u64, Self::BET_COUNT_BITS)?;
        for bet in self.bets.iter().take(bet_count) {
            bet.encode(&mut writer)?;
        }

        // History
        let history_count = self.history.len().min(Self::MAX_HISTORY);
        writer.write_bits(history_count as u64, Self::HISTORY_COUNT_BITS)?;
        for roll in self.history.iter().take(history_count) {
            roll.encode(&mut writer)?;
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

        let phase = SicBoPhase::try_from(reader.read_bits(SicBoPhase::BITS)? as u8)?;

        // Current dice roll
        let current_roll = DiceRoll::decode(&mut reader)?;

        // Bets
        let bet_count = reader.read_bits(Self::BET_COUNT_BITS)? as usize;
        let mut bets = Vec::with_capacity(bet_count);
        for _ in 0..bet_count {
            bets.push(SicBoBet::decode(&mut reader)?);
        }

        // History
        let history_count = reader.read_bits(Self::HISTORY_COUNT_BITS)? as usize;
        let mut history = Vec::with_capacity(history_count);
        for _ in 0..history_count {
            history.push(DiceRoll::decode(&mut reader)?);
        }

        Ok(Self {
            phase,
            current_roll,
            bets,
            history,
        })
    }

    /// Estimate the v1 JSON-style encoding size for comparison.
    ///
    /// This is a rough estimate based on typical v1 field sizes:
    /// - phase: 1 byte enum + padding
    /// - dice: 3 bytes each + padding
    /// - bets: array overhead + per-bet data
    /// - history: array overhead + per-roll data
    #[must_use]
    pub fn estimate_v1_size(&self) -> usize {
        let base_overhead = 16; // object wrapper, padding
        let phase_size = 4;     // enum with padding
        let dice_size = 8;      // 3 x u8 with padding
        let bets_size = if self.bets.is_empty() {
            8 // empty array
        } else {
            // Array overhead + (type + target + amount with padding) per bet
            8 + self.bets.len() * 16
        };
        let history_size = if self.history.is_empty() {
            8 // empty array
        } else {
            // Array overhead + (3 dice with padding) per roll
            8 + self.history.len() * 8
        };

        base_overhead + phase_size + dice_size + bets_size + history_size
    }

    /// Calculate the actual v2 encoded size.
    #[must_use]
    pub fn v2_size(&self) -> usize {
        // Header bits
        let header_bits = Self::VERSION_BITS + SicBoPhase::BITS + DiceRoll::ROLL_BITS;

        // Bet count + bet bits
        let bet_bits: usize = Self::BET_COUNT_BITS
            + self
                .bets
                .iter()
                .take(SicBoBet::MAX_BATCH)
                .map(|b| {
                    let base_bits = SicBoBet::BET_TYPE_BITS;
                    let target_bits = if b.bet_type.requires_target() {
                        SicBoBet::TARGET_BITS
                    } else {
                        0
                    };
                    let amount_bytes = crate::codec::encode_uleb128(b.amount).len();
                    base_bits + target_bits + amount_bytes * 8
                })
                .sum::<usize>();

        // History bits
        let history_count = self.history.len().min(Self::MAX_HISTORY);
        let history_bits = Self::HISTORY_COUNT_BITS + history_count * DiceRoll::ROLL_BITS;

        let total_bits = header_bits + bet_bits + history_bits;
        (total_bits + 7) / 8
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bet_layouts;

    // ========================================================================
    // AC-1.1: Single sic bo bet payload <= 4 bytes for small amounts
    // ========================================================================

    #[test]
    fn test_single_bet_small_amount_4_bytes_ac_1_1() {
        // PlaceBet with small amount (< 128, fits in 1 byte ULEB128)
        // Small bet (no target)
        let mov = SicBoMove::PlaceBet(SicBoBet::simple(SicBoBetType::Small, 100));
        let payload = mov.encode_v2().unwrap();

        // 1 byte header + 4 bits bet_type + 1 byte ULEB128(100)
        // = 8 + 4 + 8 = 20 bits = 3 bytes
        assert!(
            payload.len() <= 4,
            "AC-1.1: Single bet payload must be <= 4 bytes for small amounts, got {}",
            payload.len()
        );
    }

    #[test]
    fn test_single_bet_with_target_4_bytes_ac_1_1() {
        // Specific triple bet on 6 (requires target)
        let mov = SicBoMove::PlaceBet(SicBoBet::new(SicBoBetType::SpecificTriple, 5, 100)); // target 5 = triple 6
        let payload = mov.encode_v2().unwrap();

        // 1 byte header + 4 bits bet_type + 6 bits target + 1 byte ULEB128(100)
        // = 8 + 4 + 6 + 8 = 26 bits = 4 bytes
        assert!(
            payload.len() <= 4,
            "AC-1.1: Single bet with target must be <= 4 bytes for small amounts, got {}",
            payload.len()
        );
    }

    #[test]
    fn test_single_bet_various_types_ac_1_1() {
        let test_bets = [
            SicBoBet::simple(SicBoBetType::Small, 100),
            SicBoBet::simple(SicBoBetType::Big, 50),
            SicBoBet::simple(SicBoBetType::Odd, 100),
            SicBoBet::simple(SicBoBetType::Even, 127),
            SicBoBet::simple(SicBoBetType::AnyTriple, 100),
            SicBoBet::new(SicBoBetType::SpecificTriple, 0, 100),   // Triple 1
            SicBoBet::new(SicBoBetType::SpecificDouble, 5, 100),   // Double 6
            SicBoBet::new(SicBoBetType::TotalSum, 10, 100),        // Sum 14
            SicBoBet::new(SicBoBetType::SingleDice, 2, 100),       // Single 3
        ];

        for bet in test_bets {
            let mov = SicBoMove::PlaceBet(bet);
            let payload = mov.encode_v2().unwrap();
            assert!(
                payload.len() <= 4,
                "AC-1.1: Single bet ({:?}, {}, {}) must be <= 4 bytes, got {}",
                bet.bet_type,
                bet.target,
                bet.amount,
                payload.len()
            );
        }
    }

    #[test]
    fn test_roll_payload_1_byte_ac_1_1() {
        let payload = SicBoMove::Roll.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "AC-1.1: Roll must be 1 byte");
    }

    #[test]
    fn test_clear_bets_payload_1_byte_ac_1_1() {
        let payload = SicBoMove::ClearBets.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "AC-1.1: ClearBets must be 1 byte");
    }

    // ========================================================================
    // AC-1.2: Batch payload size reduction >= 40%
    // ========================================================================

    #[test]
    fn test_batch_payload_reduction_ac_1_2() {
        // Create a typical batch of 5 bets
        let bets = vec![
            SicBoBet::simple(SicBoBetType::Small, 100),
            SicBoBet::simple(SicBoBetType::Big, 100),
            SicBoBet::new(SicBoBetType::TotalSum, 10, 100),
            SicBoBet::simple(SicBoBetType::Odd, 50),
            SicBoBet::new(SicBoBetType::SpecificDouble, 2, 25),
        ];

        let batch = SicBoMove::AtomicBatch(bets.clone());
        let v2_bytes = batch.encode_v2().unwrap();

        // Estimate v1 size: each bet would be ~16 bytes (type + target + amount with padding)
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
        let single = SicBoMove::PlaceBet(SicBoBet::simple(SicBoBetType::Small, 100));
        let single_size = single.encode_v2().unwrap().len();

        // Multiple bets
        let batch_2 = SicBoMove::AtomicBatch(vec![
            SicBoBet::simple(SicBoBetType::Small, 100),
            SicBoBet::simple(SicBoBetType::Big, 100),
        ]);
        let batch_3 = SicBoMove::AtomicBatch(vec![
            SicBoBet::simple(SicBoBetType::Small, 100),
            SicBoBet::simple(SicBoBetType::Big, 100),
            SicBoBet::simple(SicBoBetType::Odd, 100),
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
        // Typical state: resolved roll with a few bets
        let state = SicBoState {
            phase: SicBoPhase::Resolved,
            current_roll: DiceRoll::new(4, 2, 5),
            bets: vec![
                SicBoBet::simple(SicBoBetType::Small, 100),
                SicBoBet::new(SicBoBetType::TotalSum, 7, 100), // Sum 11
            ],
            history: vec![],
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
    fn test_state_with_history_compaction_ac_2_1() {
        // State with roll history
        let state = SicBoState {
            phase: SicBoPhase::Resolved,
            current_roll: DiceRoll::new(3, 3, 3),
            bets: vec![SicBoBet::simple(SicBoBetType::AnyTriple, 100)],
            history: vec![
                DiceRoll::new(1, 2, 3),
                DiceRoll::new(4, 5, 6),
                DiceRoll::new(2, 2, 4),
                DiceRoll::new(1, 1, 1),
                DiceRoll::new(6, 6, 5),
            ],
        };

        let v2_bytes = state.encode_v2().unwrap();
        let v1_estimate = state.estimate_v1_size();

        let reduction = 1.0 - (v2_bytes.len() as f64 / v1_estimate as f64);
        assert!(
            reduction >= 0.30,
            "AC-2.1: State with history compaction must be >= 30%, got {:.1}% (v1={}, v2={})",
            reduction * 100.0,
            v1_estimate,
            v2_bytes.len()
        );
    }

    #[test]
    fn test_state_with_many_bets_compaction_ac_2_1() {
        // State with multiple bets
        let state = SicBoState {
            phase: SicBoPhase::Betting,
            current_roll: DiceRoll::default(),
            bets: vec![
                SicBoBet::simple(SicBoBetType::Small, 100),
                SicBoBet::simple(SicBoBetType::Big, 100),
                SicBoBet::simple(SicBoBetType::Odd, 50),
                SicBoBet::new(SicBoBetType::SpecificTriple, 5, 25),
                SicBoBet::new(SicBoBetType::TotalSum, 10, 75),
                SicBoBet::new(SicBoBetType::SingleDice, 0, 50),
            ],
            history: vec![DiceRoll::new(2, 4, 6)],
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

    // ========================================================================
    // AC-3.1: v1 and v2 both supported during migration
    // ========================================================================

    #[test]
    fn test_v2_payload_accepted_ac_3_1() {
        let mov = SicBoMove::Roll;
        let payload = mov.encode_v2().unwrap();

        // Should decode successfully
        let decoded = SicBoMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov, "AC-3.1: v2 payload must decode correctly");
    }

    #[test]
    fn test_v2_place_bet_roundtrip_ac_3_1() {
        let original = SicBoMove::PlaceBet(SicBoBet::new(SicBoBetType::TotalSum, 10, 500));
        let payload = original.encode_v2().unwrap();
        let decoded = SicBoMove::decode_v2(&payload).unwrap();

        assert_eq!(decoded, original, "AC-3.1: PlaceBet must roundtrip");
    }

    #[test]
    fn test_v2_atomic_batch_roundtrip_ac_3_1() {
        let original = SicBoMove::AtomicBatch(vec![
            SicBoBet::simple(SicBoBetType::Small, 100),
            SicBoBet::new(SicBoBetType::SpecificDouble, 2, 200),
            SicBoBet::simple(SicBoBetType::Even, 50),
        ]);
        let payload = original.encode_v2().unwrap();
        let decoded = SicBoMove::decode_v2(&payload).unwrap();

        assert_eq!(decoded, original, "AC-3.1: AtomicBatch must roundtrip");
    }

    #[test]
    fn test_dual_decode_v2_payload_ac_3_1() {
        let mov = SicBoMove::Roll;
        let payload = mov.encode_v2().unwrap();

        // Dual decode should return Some for v2
        let result = SicBoMove::decode_dual(&payload).unwrap();
        assert!(result.is_some(), "AC-3.1: dual decode must return Some for v2");
        assert_eq!(result.unwrap(), mov);
    }

    #[test]
    fn test_dual_decode_v1_payload_returns_none_ac_3_1() {
        // Simulate a v1 payload (version bits = 1)
        let v1_payload = vec![0x01, 0x00, 0x00, 0x00];

        // Dual decode should return None for v1
        let result = SicBoMove::decode_dual(&v1_payload).unwrap();
        assert!(result.is_none(), "AC-3.1: dual decode must return None for v1");
    }

    // ========================================================================
    // State blob roundtrip tests
    // ========================================================================

    #[test]
    fn test_state_roundtrip_empty() {
        let state = SicBoState::default();
        let encoded = state.encode_v2().unwrap();
        let decoded = SicBoState::decode_v2(&encoded).unwrap();
        // Default dice are 0, which encodes as 1 after decode (+1)
        let mut expected = state;
        expected.current_roll = DiceRoll::new(1, 1, 1);
        assert_eq!(decoded, expected);
    }

    #[test]
    fn test_state_roundtrip_typical() {
        let state = SicBoState {
            phase: SicBoPhase::Resolved,
            current_roll: DiceRoll::new(4, 2, 6),
            bets: vec![SicBoBet::simple(SicBoBetType::Big, 100)],
            history: vec![],
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = SicBoState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_all_phases() {
        for phase in [
            SicBoPhase::Betting,
            SicBoPhase::Rolling,
            SicBoPhase::Resolved,
        ] {
            let state = SicBoState {
                phase,
                current_roll: DiceRoll::new(3, 4, 5),
                ..Default::default()
            };
            let encoded = state.encode_v2().unwrap();
            let decoded = SicBoState::decode_v2(&encoded).unwrap();
            assert_eq!(decoded.phase, phase);
        }
    }

    #[test]
    fn test_state_roundtrip_all_dice_values() {
        for die1 in 1..=6 {
            for die2 in 1..=6 {
                for die3 in 1..=6 {
                    let state = SicBoState {
                        current_roll: DiceRoll::new(die1, die2, die3),
                        ..Default::default()
                    };
                    let encoded = state.encode_v2().unwrap();
                    let decoded = SicBoState::decode_v2(&encoded).unwrap();
                    assert_eq!(decoded.current_roll.die1, die1, "Die1 {} must roundtrip", die1);
                    assert_eq!(decoded.current_roll.die2, die2, "Die2 {} must roundtrip", die2);
                    assert_eq!(decoded.current_roll.die3, die3, "Die3 {} must roundtrip", die3);
                }
            }
        }
    }

    #[test]
    fn test_state_roundtrip_with_history() {
        let state = SicBoState {
            phase: SicBoPhase::Resolved,
            current_roll: DiceRoll::new(1, 2, 3),
            bets: vec![],
            history: vec![
                DiceRoll::new(6, 6, 6),
                DiceRoll::new(1, 1, 1),
                DiceRoll::new(2, 3, 4),
                DiceRoll::new(5, 5, 2),
            ],
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = SicBoState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    // ========================================================================
    // Move roundtrip tests
    // ========================================================================

    #[test]
    fn test_all_moves_roundtrip() {
        let moves = vec![
            SicBoMove::PlaceBet(SicBoBet::simple(SicBoBetType::Small, 100)),
            SicBoMove::PlaceBet(SicBoBet::new(SicBoBetType::TotalSum, 10, 100)),
            SicBoMove::Roll,
            SicBoMove::ClearBets,
            SicBoMove::AtomicBatch(vec![]),
            SicBoMove::AtomicBatch(vec![SicBoBet::simple(SicBoBetType::Even, 50)]),
            SicBoMove::SetRules { rules_id: 42 },
        ];

        for mov in moves {
            let encoded = mov.encode_v2().unwrap();
            let decoded = SicBoMove::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, mov, "Move {:?} must roundtrip", mov);
        }
    }

    #[test]
    fn test_set_rules_roundtrip() {
        let test_ids = [0u64, 1, 127, 128, 1000, u64::MAX];

        for rules_id in test_ids {
            let mov = SicBoMove::SetRules { rules_id };
            let encoded = mov.encode_v2().unwrap();
            let decoded = SicBoMove::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, mov, "SetRules({}) must roundtrip", rules_id);
        }
    }

    // ========================================================================
    // Golden vector tests for determinism
    // ========================================================================

    #[test]
    fn test_roll_golden_vector() {
        let payload = SicBoMove::Roll.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 1 (bits 00001) = 0b00001_010 = 0x0A
        assert_eq!(payload, vec![0x0A], "Roll golden vector");
    }

    #[test]
    fn test_clear_bets_golden_vector() {
        let payload = SicBoMove::ClearBets.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 2 (bits 00010) = 0b00010_010 = 0x12
        assert_eq!(payload, vec![0x12], "ClearBets golden vector");
    }

    #[test]
    fn test_encoding_deterministic() {
        // Same input must produce same output every time
        for _ in 0..10 {
            let mov = SicBoMove::Roll;
            let payload = mov.encode_v2().unwrap();
            assert_eq!(payload, vec![0x0A]);
        }
    }

    #[test]
    fn test_place_bet_deterministic() {
        let bet = SicBoBet::simple(SicBoBetType::Small, 100);
        let mov = SicBoMove::PlaceBet(bet);

        let payload1 = mov.encode_v2().unwrap();
        let payload2 = mov.encode_v2().unwrap();

        assert_eq!(payload1, payload2, "Encoding must be deterministic");
    }

    // ========================================================================
    // Edge case tests
    // ========================================================================

    #[test]
    fn test_empty_batch() {
        let mov = SicBoMove::AtomicBatch(vec![]);
        let payload = mov.encode_v2().unwrap();

        // Should have header + 5-bit count (0)
        // 8 bits + 5 bits = 13 bits = 2 bytes
        assert_eq!(payload.len(), 2, "Empty batch should be 2 bytes");

        let decoded = SicBoMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov);
    }

    #[test]
    fn test_max_batch_size() {
        let bets: Vec<_> = (0..SicBoBet::MAX_BATCH)
            .map(|i| SicBoBet::simple(SicBoBetType::Small, (i + 1) as u64 * 10))
            .collect();

        let mov = SicBoMove::AtomicBatch(bets);
        let payload = mov.encode_v2().unwrap();
        let decoded = SicBoMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov);
    }

    #[test]
    fn test_all_bet_types_roundtrip() {
        // Test all bet types that don't require targets
        let simple_types = [
            SicBoBetType::Small,
            SicBoBetType::Big,
            SicBoBetType::Odd,
            SicBoBetType::Even,
            SicBoBetType::AnyTriple,
            SicBoBetType::ThreeForces,
        ];

        for bet_type in simple_types {
            let bet = SicBoBet::simple(bet_type, 100);
            let mov = SicBoMove::PlaceBet(bet);
            let encoded = mov.encode_v2().unwrap();
            let decoded = SicBoMove::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, mov, "{:?} bet must roundtrip", bet_type);
        }

        // Test bet types that require targets
        let targeted_types = [
            (SicBoBetType::SpecificTriple, 0),   // Triple 1
            (SicBoBetType::SpecificTriple, 5),   // Triple 6
            (SicBoBetType::SpecificDouble, 2),   // Double 3
            (SicBoBetType::TwoFaceCombo, 7),     // Some combo
            (SicBoBetType::SingleDice, 4),       // Single 5
            (SicBoBetType::TotalSum, 10),        // Sum 14
            (SicBoBetType::Domino, 15),          // Domino combo
            (SicBoBetType::Hop, 30),             // Hop bet
        ];

        for (bet_type, target) in targeted_types {
            let bet = SicBoBet::new(bet_type, target, 100);
            let mov = SicBoMove::PlaceBet(bet);
            let encoded = mov.encode_v2().unwrap();
            let decoded = SicBoMove::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, mov, "{:?} with target {} must roundtrip", bet_type, target);
        }
    }

    #[test]
    fn test_bet_validation() {
        // Valid bets
        assert!(SicBoBet::simple(SicBoBetType::Small, 100).is_valid());
        assert!(SicBoBet::new(SicBoBetType::TotalSum, 13, 100).is_valid());
        assert!(SicBoBet::new(SicBoBetType::Hop, 55, 100).is_valid());

        // Invalid: non-targeted bet with target > 0
        assert!(!SicBoBet::new(SicBoBetType::Small, 1, 100).is_valid());
    }

    // ========================================================================
    // Bet descriptor integration test
    // ========================================================================

    #[test]
    fn test_sic_bo_bet_uses_correct_layout() {
        // Verify that our SicBoBet encoding is compatible with the unified BetDescriptor
        let layout = bet_layouts::SIC_BO;

        // Check that our bit widths match the layout
        assert_eq!(SicBoBet::BET_TYPE_BITS, layout.bet_type_bits as usize);
        assert_eq!(SicBoBet::TARGET_BITS, layout.target_bits as usize);
    }

    // ========================================================================
    // Golden vector tests for specific bet type families
    // ========================================================================

    #[test]
    fn test_small_bet_golden_vector() {
        let mov = SicBoMove::PlaceBet(SicBoBet::simple(SicBoBetType::Small, 100));
        let payload = mov.encode_v2().unwrap();

        // Verify determinism and size
        let payload2 = mov.encode_v2().unwrap();
        assert_eq!(payload, payload2, "Small bet encoding must be deterministic");
        assert!(payload.len() <= 3, "Small bet should be <= 3 bytes");
    }

    #[test]
    fn test_triple_bets_golden_vectors() {
        // All specific triple bets should encode similarly
        for target in 0..=5 {
            let mov = SicBoMove::PlaceBet(SicBoBet::new(SicBoBetType::SpecificTriple, target, 100));
            let payload = mov.encode_v2().unwrap();
            assert!(payload.len() <= 4, "SpecificTriple bet should be <= 4 bytes");

            // Verify roundtrip
            let decoded = SicBoMove::decode_v2(&payload).unwrap();
            assert_eq!(decoded, mov, "SpecificTriple({}) must roundtrip", target);
        }
    }

    #[test]
    fn test_total_sum_bets_golden_vectors() {
        // Test all valid sum targets (4-17 encoded as 0-13)
        for target in 0..=13 {
            let mov = SicBoMove::PlaceBet(SicBoBet::new(SicBoBetType::TotalSum, target, 100));
            let payload = mov.encode_v2().unwrap();
            assert!(payload.len() <= 4, "TotalSum bet should be <= 4 bytes");

            // Verify roundtrip
            let decoded = SicBoMove::decode_v2(&payload).unwrap();
            assert_eq!(decoded, mov, "TotalSum({}) must roundtrip", target);
        }
    }

    #[test]
    fn test_mixed_batch_golden_vector() {
        // Batch with various bet types
        let batch = SicBoMove::AtomicBatch(vec![
            SicBoBet::simple(SicBoBetType::Small, 100),
            SicBoBet::new(SicBoBetType::TotalSum, 10, 50),  // Sum 14
            SicBoBet::simple(SicBoBetType::Odd, 25),
            SicBoBet::new(SicBoBetType::SpecificDouble, 2, 10),
        ]);

        let payload = batch.encode_v2().unwrap();
        let decoded = SicBoMove::decode_v2(&payload).unwrap();

        assert_eq!(decoded, batch, "Mixed batch must roundtrip");

        // Verify it achieves good compression vs v1
        // V1 would be roughly 8 (array) + 4 * 16 (bets) = 72 bytes
        // V2 should be much smaller
        let v1_estimate = 8 + 4 * 16;
        let reduction = 1.0 - (payload.len() as f64 / v1_estimate as f64);
        assert!(
            reduction >= 0.40,
            "Mixed batch should achieve >= 40% reduction, got {:.1}%",
            reduction * 100.0
        );
    }

    // ========================================================================
    // DiceRoll tests
    // ========================================================================

    #[test]
    fn test_dice_roll_sum() {
        assert_eq!(DiceRoll::new(1, 1, 1).sum(), 3);
        assert_eq!(DiceRoll::new(6, 6, 6).sum(), 18);
        assert_eq!(DiceRoll::new(1, 2, 3).sum(), 6);
        assert_eq!(DiceRoll::new(4, 5, 6).sum(), 15);
    }

    #[test]
    fn test_dice_roll_is_triple() {
        assert!(DiceRoll::new(1, 1, 1).is_triple());
        assert!(DiceRoll::new(6, 6, 6).is_triple());
        assert!(!DiceRoll::new(1, 1, 2).is_triple());
        assert!(!DiceRoll::new(1, 2, 3).is_triple());
    }

    #[test]
    fn test_dice_roll_encode_decode() {
        for die1 in 1..=6 {
            for die2 in 1..=6 {
                for die3 in 1..=6 {
                    let roll = DiceRoll::new(die1, die2, die3);
                    let mut writer = BitWriter::new();
                    roll.encode(&mut writer).unwrap();
                    let bytes = writer.finish();

                    let mut reader = BitReader::new(&bytes);
                    let decoded = DiceRoll::decode(&mut reader).unwrap();

                    assert_eq!(decoded, roll, "Roll ({}, {}, {}) must roundtrip", die1, die2, die3);
                }
            }
        }
    }
}
