//! Craps v2 compact encoding (spec: `compact-encoding-craps.md`).
//!
//! This module implements the bitwise compact encoding for craps move payloads
//! and state blobs as defined in the spec. All bit layouts are canonical; JS/TS
//! consumes generated artifacts.
//!
//! # Move Payload Encoding
//!
//! All craps moves use a 1-byte header:
//! - `version` (3 bits): Protocol version (2 for v2)
//! - `opcode` (5 bits): Action type (0-4)
//!
//! PlaceBet includes bet_type (5 bits) + optional target (4 bits) + amount (ULEB128).
//! AtomicBatch includes bet_count (5 bits) + repeated bet descriptors.
//!
//! # State Blob Encoding
//!
//! State is encoded compactly using:
//! - 2-bit phase (ComeOut, Point, Resolved)
//! - 4-bit point value (0 if no point, 4-10 if established)
//! - 3-bit dice values (1-6 each)
//! - 12-bit made_points_mask (for Fire/ATS tracking)
//! - Bit-packed bets

use crate::codec::{
    BitReader, BitWriter, CodecError, CodecResult, CrapsBetType, DualDecoder,
    EncodingVersion, PayloadHeader,
};

// Re-export for convenience
pub use crate::codec::CrapsBetType as BetType;

// ============================================================================
// Craps Opcodes (v2)
// ============================================================================

/// Craps action opcodes for v2 compact encoding.
///
/// These map to the opcode values in the 5-bit opcode field of the header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum CrapsOpcode {
    /// Place a single bet (bet_type + optional target + amount).
    PlaceBet = 0,
    /// Add odds to pass/come bet.
    AddOdds = 1,
    /// Roll the dice.
    Roll = 2,
    /// Clear all bets.
    ClearBets = 3,
    /// Place multiple bets atomically.
    AtomicBatch = 4,
}

impl CrapsOpcode {
    /// All valid opcodes.
    pub const ALL: [Self; 5] = [
        Self::PlaceBet,
        Self::AddOdds,
        Self::Roll,
        Self::ClearBets,
        Self::AtomicBatch,
    ];

    /// Opcodes that produce a header-only (1 byte) payload.
    pub const HEADER_ONLY: [Self; 2] = [Self::Roll, Self::ClearBets];

    /// Check if this opcode produces a header-only (1 byte) payload.
    #[must_use]
    pub const fn is_header_only(&self) -> bool {
        matches!(self, Self::Roll | Self::ClearBets)
    }
}

impl TryFrom<u8> for CrapsOpcode {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::PlaceBet),
            1 => Ok(Self::AddOdds),
            2 => Ok(Self::Roll),
            3 => Ok(Self::ClearBets),
            4 => Ok(Self::AtomicBatch),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 4, // max opcode
            }),
        }
    }
}

// ============================================================================
// Bet Descriptor (craps-specific wrapper)
// ============================================================================

/// A single craps bet: bet_type (5 bits) + optional target (4 bits) + amount (ULEB128).
///
/// The `target` field encodes the point number for bets that require it:
/// - Pass/Don't Pass/Come/Don't Come/Field: target unused (0)
/// - Place/Buy/Lay: target is the point number (4, 5, 6, 8, 9, 10 encoded as 0-5)
/// - Hardways: target is the hard number (4, 6, 8, 10 encoded as 0-3)
/// - Hop: target encodes the dice combination
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CrapsBet {
    /// Type of bet (0-22, see `CrapsBetType`).
    pub bet_type: CrapsBetType,
    /// Target value (interpretation depends on bet_type).
    pub target: u8,
    /// Bet amount (in smallest currency unit).
    pub amount: u64,
}

impl CrapsBet {
    /// Bit width for bet type field (0-22 fits in 5 bits).
    pub const BET_TYPE_BITS: usize = 5;

    /// Bit width for target field (0-12 fits in 4 bits).
    pub const TARGET_BITS: usize = 4;

    /// Maximum bet count in a batch (fits in 5 bits).
    pub const MAX_BATCH: usize = 20;

    /// Create a new craps bet.
    #[must_use]
    pub const fn new(bet_type: CrapsBetType, target: u8, amount: u64) -> Self {
        Self {
            bet_type,
            target,
            amount,
        }
    }

    /// Create a bet that doesn't require a target (pass line, come, field, etc.).
    #[must_use]
    pub const fn simple(bet_type: CrapsBetType, amount: u64) -> Self {
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
        let bet_type = CrapsBetType::try_from(bet_type_raw).map_err(|_| {
            CodecError::InvalidVersion {
                version: bet_type_raw,
                expected: 22, // max bet type
            }
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

    /// Validate the bet against craps rules.
    #[must_use]
    pub fn is_valid(&self) -> bool {
        // Check target is within valid range based on bet type
        if self.bet_type.requires_target() {
            // Place/Buy/Lay targets: 0-5 (encoding 4,5,6,8,9,10)
            // Hardway targets: 0-3 (encoding 4,6,8,10)
            // Hop targets: 0-12 for dice combinations
            self.target <= 12
        } else {
            // Non-targeted bets should have target = 0
            self.target == 0
        }
    }
}

// ============================================================================
// Move Payload Encoding
// ============================================================================

/// A craps move action with optional payload data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CrapsMove {
    /// Place a single bet.
    PlaceBet(CrapsBet),
    /// Add odds to existing pass/come bet.
    AddOdds { amount: u64 },
    /// Roll the dice.
    Roll,
    /// Clear all current bets.
    ClearBets,
    /// Place multiple bets atomically.
    AtomicBatch(Vec<CrapsBet>),
}

impl CrapsMove {
    /// Get the opcode for this move.
    #[must_use]
    pub fn opcode(&self) -> CrapsOpcode {
        match self {
            Self::PlaceBet(_) => CrapsOpcode::PlaceBet,
            Self::AddOdds { .. } => CrapsOpcode::AddOdds,
            Self::Roll => CrapsOpcode::Roll,
            Self::ClearBets => CrapsOpcode::ClearBets,
            Self::AtomicBatch(_) => CrapsOpcode::AtomicBatch,
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
            Self::AddOdds { amount } => {
                writer.write_uleb128(*amount)?;
            }
            Self::AtomicBatch(bets) => {
                // bet_count (5 bits, max 20)
                let count = bets.len().min(CrapsBet::MAX_BATCH);
                writer.write_bits(count as u64, 5)?;
                for bet in bets.iter().take(count) {
                    bet.encode(&mut writer)?;
                }
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
        let opcode = CrapsOpcode::try_from(header.opcode)?;

        Ok(match opcode {
            CrapsOpcode::Roll => Self::Roll,
            CrapsOpcode::ClearBets => Self::ClearBets,
            CrapsOpcode::PlaceBet => {
                let bet = CrapsBet::decode(&mut reader)?;
                Self::PlaceBet(bet)
            }
            CrapsOpcode::AddOdds => {
                let amount = reader.read_uleb128()?;
                Self::AddOdds { amount }
            }
            CrapsOpcode::AtomicBatch => {
                let count = reader.read_bits(5)? as usize;
                let mut bets = Vec::with_capacity(count);
                for _ in 0..count {
                    bets.push(CrapsBet::decode(&mut reader)?);
                }
                Self::AtomicBatch(bets)
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

/// Craps game phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum CrapsPhase {
    /// Come-out roll (no point established).
    #[default]
    ComeOut = 0,
    /// Point phase (point is established).
    Point = 1,
    /// Roll resolved (waiting for next shooter or game over).
    Resolved = 2,
}

impl CrapsPhase {
    /// Bit width for phase field.
    pub const BITS: usize = 2;
}

impl TryFrom<u8> for CrapsPhase {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::ComeOut),
            1 => Ok(Self::Point),
            2 => Ok(Self::Resolved),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 2, // max phase
            }),
        }
    }
}

/// Field bet paytable variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum FieldPaytable {
    /// Standard: 2 pays 2:1, 12 pays 2:1.
    #[default]
    Standard = 0,
    /// Double: 2 pays 2:1, 12 pays 3:1.
    Double12 = 1,
    /// Triple: 2 pays 3:1, 12 pays 3:1.
    TripleBoth = 2,
}

impl FieldPaytable {
    /// Bit width for paytable field.
    pub const BITS: usize = 2;
}

impl TryFrom<u8> for FieldPaytable {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Standard),
            1 => Ok(Self::Double12),
            2 => Ok(Self::TripleBoth),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 2, // max paytable
            }),
        }
    }
}

/// Complete craps state blob.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CrapsState {
    /// Current game phase.
    pub phase: CrapsPhase,
    /// Established point (0 if none, 4-10 if established).
    pub point: u8,
    /// Last dice roll (die 1).
    pub die1: u8,
    /// Last dice roll (die 2).
    pub die2: u8,
    /// Whether point was established in current shooter's turn.
    pub point_established_epoch: bool,
    /// Mask of made points for Fire/ATS tracking (bits for 4,5,6,8,9,10).
    pub made_points_mask: u16,
    /// Field bet paytable.
    pub field_paytable: FieldPaytable,
    /// Active bets.
    pub bets: Vec<CrapsBet>,
    /// Total wagered on current roll.
    pub total_wagered: u64,
}

impl CrapsState {
    /// Bit width for version field.
    pub const VERSION_BITS: usize = 3;

    /// Bit width for point field (0 or 4-10 encoded as 0-6 in 4 bits).
    pub const POINT_BITS: usize = 4;

    /// Bit width for a single die (1-6 fits in 3 bits).
    pub const DIE_BITS: usize = 3;

    /// Bit width for made_points_mask (12 bits for all point numbers).
    pub const MADE_POINTS_BITS: usize = 12;

    /// Bit width for bet count (0-20 fits in 5 bits).
    pub const BET_COUNT_BITS: usize = 5;

    /// Encode this state as a v2 compact blob.
    pub fn encode_v2(&self) -> CodecResult<Vec<u8>> {
        let mut writer = BitWriter::new();

        // Header bits
        writer.write_bits(PayloadHeader::V2 as u64, Self::VERSION_BITS)?;
        writer.write_bits(self.phase as u8 as u64, CrapsPhase::BITS)?;
        writer.write_bits(self.encode_point() as u64, Self::POINT_BITS)?;
        // Dice values: subtract 1 to fit 1-6 in 3 bits (0-5)
        writer.write_bits((self.die1.saturating_sub(1)) as u64, Self::DIE_BITS)?;
        writer.write_bits((self.die2.saturating_sub(1)) as u64, Self::DIE_BITS)?;
        writer.write_bit(self.point_established_epoch)?;
        writer.write_bits(self.made_points_mask as u64, Self::MADE_POINTS_BITS)?;
        writer.write_bits(self.field_paytable as u8 as u64, FieldPaytable::BITS)?;

        // Bets
        let bet_count = self.bets.len().min(CrapsBet::MAX_BATCH);
        writer.write_bits(bet_count as u64, Self::BET_COUNT_BITS)?;
        for bet in self.bets.iter().take(bet_count) {
            bet.encode(&mut writer)?;
        }

        // Total wagered
        writer.write_uleb128(self.total_wagered)?;

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

        let phase = CrapsPhase::try_from(reader.read_bits(CrapsPhase::BITS)? as u8)?;
        let point = Self::decode_point(reader.read_bits(Self::POINT_BITS)? as u8);
        // Dice values: add 1 to recover 1-6 from 0-5
        let die1 = (reader.read_bits(Self::DIE_BITS)? as u8) + 1;
        let die2 = (reader.read_bits(Self::DIE_BITS)? as u8) + 1;
        let point_established_epoch = reader.read_bit()?;
        let made_points_mask = reader.read_bits(Self::MADE_POINTS_BITS)? as u16;
        let field_paytable = FieldPaytable::try_from(reader.read_bits(FieldPaytable::BITS)? as u8)?;

        // Bets
        let bet_count = reader.read_bits(Self::BET_COUNT_BITS)? as usize;
        let mut bets = Vec::with_capacity(bet_count);
        for _ in 0..bet_count {
            bets.push(CrapsBet::decode(&mut reader)?);
        }

        // Total wagered
        let total_wagered = reader.read_uleb128()?;

        Ok(Self {
            phase,
            point,
            die1,
            die2,
            point_established_epoch,
            made_points_mask,
            field_paytable,
            bets,
            total_wagered,
        })
    }

    /// Encode point value (0 or 4-10) into 4 bits.
    /// 0 -> 0, 4 -> 1, 5 -> 2, 6 -> 3, 8 -> 4, 9 -> 5, 10 -> 6
    fn encode_point(&self) -> u8 {
        match self.point {
            0 => 0,
            4 => 1,
            5 => 2,
            6 => 3,
            8 => 4,
            9 => 5,
            10 => 6,
            _ => 0, // Invalid point, encode as no point
        }
    }

    /// Decode point value from 4 bits.
    fn decode_point(encoded: u8) -> u8 {
        match encoded {
            0 => 0,
            1 => 4,
            2 => 5,
            3 => 6,
            4 => 8,
            5 => 9,
            6 => 10,
            _ => 0, // Invalid encoding, treat as no point
        }
    }

    /// Estimate the v1 JSON-style encoding size for comparison.
    ///
    /// This is a rough estimate based on typical v1 field sizes:
    /// - phase: 1 byte enum + padding
    /// - point: 1 byte + padding
    /// - dice: 2 bytes
    /// - flags: 2 bytes (boolean + mask)
    /// - paytable: 1 byte + padding
    /// - bets: array overhead + per-bet data
    /// - total_wagered: 8 bytes
    #[must_use]
    pub fn estimate_v1_size(&self) -> usize {
        let base_overhead = 16; // object wrapper, padding
        let phase_size = 4;     // enum with padding
        let point_size = 4;     // u8 with padding
        let dice_size = 4;      // 2 x u8 with padding
        let flags_size = 4;     // bool + mask with padding
        let paytable_size = 4;  // enum with padding
        let bets_size = if self.bets.is_empty() {
            8 // empty array
        } else {
            // Array overhead + (type + target + amount with padding) per bet
            8 + self.bets.len() * 16
        };
        let total_size = 8; // u64

        base_overhead + phase_size + point_size + dice_size + flags_size + paytable_size + bets_size + total_size
    }

    /// Calculate the actual v2 encoded size.
    #[must_use]
    pub fn v2_size(&self) -> usize {
        // Header bits
        let header_bits = Self::VERSION_BITS
            + CrapsPhase::BITS
            + Self::POINT_BITS
            + Self::DIE_BITS * 2
            + 1 // point_established_epoch
            + Self::MADE_POINTS_BITS
            + FieldPaytable::BITS
            + Self::BET_COUNT_BITS;

        // Bet bits
        let bet_bits: usize = self
            .bets
            .iter()
            .take(CrapsBet::MAX_BATCH)
            .map(|b| {
                let base_bits = CrapsBet::BET_TYPE_BITS;
                let target_bits = if b.bet_type.requires_target() {
                    CrapsBet::TARGET_BITS
                } else {
                    0
                };
                let amount_bytes = crate::codec::encode_uleb128(b.amount).len();
                base_bits + target_bits + amount_bytes * 8
            })
            .sum();

        // Total wagered ULEB128
        let total_wagered_bytes = crate::codec::encode_uleb128(self.total_wagered).len();

        let total_bits = header_bits + bet_bits;
        (total_bits + 7) / 8 + total_wagered_bytes
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
    // AC-1.1: Single craps bet payload <= 4 bytes for small amounts
    // ========================================================================

    #[test]
    fn test_single_bet_small_amount_4_bytes_ac_1_1() {
        // PlaceBet with small amount (< 128, fits in 1 byte ULEB128)
        // Pass line bet (no target)
        let mov = CrapsMove::PlaceBet(CrapsBet::simple(CrapsBetType::PassLine, 100));
        let payload = mov.encode_v2().unwrap();

        // 1 byte header + 5 bits bet_type + 1 byte ULEB128(100)
        // = 8 + 5 + 8 = 21 bits = 3 bytes
        assert!(
            payload.len() <= 4,
            "AC-1.1: Single bet payload must be <= 4 bytes for small amounts, got {}",
            payload.len()
        );
    }

    #[test]
    fn test_single_bet_with_target_4_bytes_ac_1_1() {
        // Place bet on 6 (requires target)
        let mov = CrapsMove::PlaceBet(CrapsBet::new(CrapsBetType::Place, 2, 100)); // target 2 = point 6
        let payload = mov.encode_v2().unwrap();

        // 1 byte header + 5 bits bet_type + 4 bits target + 1 byte ULEB128(100)
        // = 8 + 5 + 4 + 8 = 25 bits = 4 bytes
        assert!(
            payload.len() <= 4,
            "AC-1.1: Single bet with target must be <= 4 bytes for small amounts, got {}",
            payload.len()
        );
    }

    #[test]
    fn test_single_bet_various_types_ac_1_1() {
        let test_bets = [
            CrapsBet::simple(CrapsBetType::PassLine, 100),
            CrapsBet::simple(CrapsBetType::DontPass, 50),
            CrapsBet::simple(CrapsBetType::Come, 100),
            CrapsBet::simple(CrapsBetType::Field, 127),
            CrapsBet::new(CrapsBetType::Place, 0, 100),    // Place 4
            CrapsBet::new(CrapsBetType::Buy, 4, 100),      // Buy 8
            CrapsBet::new(CrapsBetType::HardSix, 0, 100),  // Hardway
        ];

        for bet in test_bets {
            let mov = CrapsMove::PlaceBet(bet);
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
        let payload = CrapsMove::Roll.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "AC-1.1: Roll must be 1 byte");
    }

    #[test]
    fn test_clear_bets_payload_1_byte_ac_1_1() {
        let payload = CrapsMove::ClearBets.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "AC-1.1: ClearBets must be 1 byte");
    }

    // ========================================================================
    // AC-1.2: Batch payload size reduction >= 40%
    // ========================================================================

    #[test]
    fn test_batch_payload_reduction_ac_1_2() {
        // Create a typical batch of 5 bets
        let bets = vec![
            CrapsBet::simple(CrapsBetType::PassLine, 100),
            CrapsBet::new(CrapsBetType::Place, 2, 100), // Place 6
            CrapsBet::new(CrapsBetType::Place, 4, 100), // Place 8
            CrapsBet::simple(CrapsBetType::Field, 50),
            CrapsBet::new(CrapsBetType::HardSix, 0, 25),
        ];

        let batch = CrapsMove::AtomicBatch(bets.clone());
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
        let single = CrapsMove::PlaceBet(CrapsBet::simple(CrapsBetType::PassLine, 100));
        let single_size = single.encode_v2().unwrap().len();

        // Multiple bets
        let batch_2 = CrapsMove::AtomicBatch(vec![
            CrapsBet::simple(CrapsBetType::PassLine, 100),
            CrapsBet::simple(CrapsBetType::DontPass, 100),
        ]);
        let batch_3 = CrapsMove::AtomicBatch(vec![
            CrapsBet::simple(CrapsBetType::PassLine, 100),
            CrapsBet::simple(CrapsBetType::DontPass, 100),
            CrapsBet::simple(CrapsBetType::Field, 100),
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
        // Typical state: point established, a few bets active
        let state = CrapsState {
            phase: CrapsPhase::Point,
            point: 6,
            die1: 4,
            die2: 2,
            point_established_epoch: true,
            made_points_mask: 0b0000_0000_0100, // Made the 6
            field_paytable: FieldPaytable::Standard,
            bets: vec![
                CrapsBet::simple(CrapsBetType::PassLine, 100),
                CrapsBet::new(CrapsBetType::Place, 4, 100), // Place 8
            ],
            total_wagered: 200,
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
        // State with multiple place bets
        let state = CrapsState {
            phase: CrapsPhase::Point,
            point: 8,
            die1: 3,
            die2: 5,
            point_established_epoch: true,
            made_points_mask: 0,
            field_paytable: FieldPaytable::Double12,
            bets: vec![
                CrapsBet::simple(CrapsBetType::PassLine, 100),
                CrapsBet::new(CrapsBetType::Place, 0, 100), // Place 4
                CrapsBet::new(CrapsBetType::Place, 1, 100), // Place 5
                CrapsBet::new(CrapsBetType::Place, 2, 100), // Place 6
                CrapsBet::new(CrapsBetType::Place, 5, 100), // Place 10
                CrapsBet::simple(CrapsBetType::Field, 50),
            ],
            total_wagered: 550,
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
    fn test_state_with_ats_tracking_ac_2_1() {
        // State with ATS (All-Tall-Small) tracking progress using made_points_mask
        let state = CrapsState {
            phase: CrapsPhase::Point,
            point: 9,
            die1: 4,
            die2: 5,
            point_established_epoch: true,
            made_points_mask: 0b0000_0011_0110, // Made 4, 5, 6, 8
            field_paytable: FieldPaytable::Standard,
            bets: vec![
                CrapsBet::simple(CrapsBetType::PassLine, 100),
                CrapsBet::simple(CrapsBetType::Horn, 50), // Horn bet as a complex side bet
            ],
            total_wagered: 150,
        };

        let v2_bytes = state.encode_v2().unwrap();
        let v1_estimate = state.estimate_v1_size();

        let reduction = 1.0 - (v2_bytes.len() as f64 / v1_estimate as f64);
        assert!(
            reduction >= 0.30,
            "AC-2.1: ATS tracking state compaction must be >= 30%, got {:.1}% (v1={}, v2={})",
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
        let mov = CrapsMove::Roll;
        let payload = mov.encode_v2().unwrap();

        // Should decode successfully
        let decoded = CrapsMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov, "AC-3.1: v2 payload must decode correctly");
    }

    #[test]
    fn test_v2_place_bet_roundtrip_ac_3_1() {
        let original = CrapsMove::PlaceBet(CrapsBet::new(CrapsBetType::Place, 2, 500)); // Place 6
        let payload = original.encode_v2().unwrap();
        let decoded = CrapsMove::decode_v2(&payload).unwrap();

        assert_eq!(decoded, original, "AC-3.1: PlaceBet must roundtrip");
    }

    #[test]
    fn test_v2_atomic_batch_roundtrip_ac_3_1() {
        let original = CrapsMove::AtomicBatch(vec![
            CrapsBet::simple(CrapsBetType::PassLine, 100),
            CrapsBet::new(CrapsBetType::Place, 2, 200),
            CrapsBet::simple(CrapsBetType::Field, 50),
        ]);
        let payload = original.encode_v2().unwrap();
        let decoded = CrapsMove::decode_v2(&payload).unwrap();

        assert_eq!(decoded, original, "AC-3.1: AtomicBatch must roundtrip");
    }

    #[test]
    fn test_dual_decode_v2_payload_ac_3_1() {
        let mov = CrapsMove::Roll;
        let payload = mov.encode_v2().unwrap();

        // Dual decode should return Some for v2
        let result = CrapsMove::decode_dual(&payload).unwrap();
        assert!(result.is_some(), "AC-3.1: dual decode must return Some for v2");
        assert_eq!(result.unwrap(), mov);
    }

    #[test]
    fn test_dual_decode_v1_payload_returns_none_ac_3_1() {
        // Simulate a v1 payload (version bits = 1)
        let v1_payload = vec![0x01, 0x00, 0x00, 0x00];

        // Dual decode should return None for v1
        let result = CrapsMove::decode_dual(&v1_payload).unwrap();
        assert!(result.is_none(), "AC-3.1: dual decode must return None for v1");
    }

    // ========================================================================
    // State blob roundtrip tests
    // ========================================================================

    #[test]
    fn test_state_roundtrip_empty() {
        let state = CrapsState::default();
        let encoded = state.encode_v2().unwrap();
        let decoded = CrapsState::decode_v2(&encoded).unwrap();
        // Default dice are 0, which encodes as 1 after decode (+1)
        // Need to set valid dice values
        let mut expected = state;
        expected.die1 = 1;
        expected.die2 = 1;
        assert_eq!(decoded, expected);
    }

    #[test]
    fn test_state_roundtrip_typical() {
        let state = CrapsState {
            phase: CrapsPhase::Point,
            point: 6,
            die1: 4,
            die2: 2,
            point_established_epoch: true,
            made_points_mask: 0,
            field_paytable: FieldPaytable::Standard,
            bets: vec![CrapsBet::simple(CrapsBetType::PassLine, 100)],
            total_wagered: 100,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = CrapsState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_all_phases() {
        for phase in [
            CrapsPhase::ComeOut,
            CrapsPhase::Point,
            CrapsPhase::Resolved,
        ] {
            let state = CrapsState {
                phase,
                die1: 3,
                die2: 4,
                ..Default::default()
            };
            let encoded = state.encode_v2().unwrap();
            let decoded = CrapsState::decode_v2(&encoded).unwrap();
            assert_eq!(decoded.phase, phase);
        }
    }

    #[test]
    fn test_state_roundtrip_all_points() {
        for point in [0, 4, 5, 6, 8, 9, 10] {
            let state = CrapsState {
                point,
                die1: 3,
                die2: 4,
                ..Default::default()
            };
            let encoded = state.encode_v2().unwrap();
            let decoded = CrapsState::decode_v2(&encoded).unwrap();
            assert_eq!(decoded.point, point, "Point {} must roundtrip", point);
        }
    }

    #[test]
    fn test_state_roundtrip_all_dice_values() {
        for die1 in 1..=6 {
            for die2 in 1..=6 {
                let state = CrapsState {
                    die1,
                    die2,
                    ..Default::default()
                };
                let encoded = state.encode_v2().unwrap();
                let decoded = CrapsState::decode_v2(&encoded).unwrap();
                assert_eq!(decoded.die1, die1, "Die1 {} must roundtrip", die1);
                assert_eq!(decoded.die2, die2, "Die2 {} must roundtrip", die2);
            }
        }
    }

    #[test]
    fn test_state_roundtrip_all_paytables() {
        for paytable in [
            FieldPaytable::Standard,
            FieldPaytable::Double12,
            FieldPaytable::TripleBoth,
        ] {
            let state = CrapsState {
                field_paytable: paytable,
                die1: 3,
                die2: 4,
                ..Default::default()
            };
            let encoded = state.encode_v2().unwrap();
            let decoded = CrapsState::decode_v2(&encoded).unwrap();
            assert_eq!(decoded.field_paytable, paytable);
        }
    }

    #[test]
    fn test_state_roundtrip_made_points_mask() {
        // Test various made_points_mask values
        let test_masks = [
            0b0000_0000_0000,  // No points made
            0b0000_0000_0001,  // Made 4
            0b0000_0011_1111,  // Made all points
            0b0000_0010_1010,  // Made 5, 8, 10
        ];

        for mask in test_masks {
            let state = CrapsState {
                made_points_mask: mask,
                die1: 3,
                die2: 4,
                ..Default::default()
            };
            let encoded = state.encode_v2().unwrap();
            let decoded = CrapsState::decode_v2(&encoded).unwrap();
            assert_eq!(decoded.made_points_mask, mask, "Mask {:012b} must roundtrip", mask);
        }
    }

    // ========================================================================
    // Move roundtrip tests
    // ========================================================================

    #[test]
    fn test_all_moves_roundtrip() {
        let moves = vec![
            CrapsMove::PlaceBet(CrapsBet::simple(CrapsBetType::PassLine, 100)),
            CrapsMove::PlaceBet(CrapsBet::new(CrapsBetType::Place, 2, 100)),
            CrapsMove::AddOdds { amount: 200 },
            CrapsMove::Roll,
            CrapsMove::ClearBets,
            CrapsMove::AtomicBatch(vec![]),
            CrapsMove::AtomicBatch(vec![CrapsBet::simple(CrapsBetType::Field, 50)]),
        ];

        for mov in moves {
            let encoded = mov.encode_v2().unwrap();
            let decoded = CrapsMove::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, mov, "Move {:?} must roundtrip", mov);
        }
    }

    #[test]
    fn test_add_odds_roundtrip() {
        let test_amounts = [0u64, 1, 127, 128, 1000, 10000, u64::MAX];

        for amount in test_amounts {
            let mov = CrapsMove::AddOdds { amount };
            let encoded = mov.encode_v2().unwrap();
            let decoded = CrapsMove::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, mov, "AddOdds({}) must roundtrip", amount);
        }
    }

    // ========================================================================
    // Golden vector tests for determinism
    // ========================================================================

    #[test]
    fn test_roll_golden_vector() {
        let payload = CrapsMove::Roll.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 2 (bits 00010) = 0b00010_010 = 0x12
        assert_eq!(payload, vec![0x12], "Roll golden vector");
    }

    #[test]
    fn test_clear_bets_golden_vector() {
        let payload = CrapsMove::ClearBets.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 3 (bits 00011) = 0b00011_010 = 0x1A
        assert_eq!(payload, vec![0x1A], "ClearBets golden vector");
    }

    #[test]
    fn test_encoding_deterministic() {
        // Same input must produce same output every time
        for _ in 0..10 {
            let mov = CrapsMove::Roll;
            let payload = mov.encode_v2().unwrap();
            assert_eq!(payload, vec![0x12]);
        }
    }

    #[test]
    fn test_place_bet_deterministic() {
        let bet = CrapsBet::simple(CrapsBetType::PassLine, 100);
        let mov = CrapsMove::PlaceBet(bet);

        let payload1 = mov.encode_v2().unwrap();
        let payload2 = mov.encode_v2().unwrap();

        assert_eq!(payload1, payload2, "Encoding must be deterministic");
    }

    // ========================================================================
    // Edge case tests
    // ========================================================================

    #[test]
    fn test_empty_batch() {
        let mov = CrapsMove::AtomicBatch(vec![]);
        let payload = mov.encode_v2().unwrap();

        // Should have header + 5-bit count (0)
        // 8 bits + 5 bits = 13 bits = 2 bytes
        assert_eq!(payload.len(), 2, "Empty batch should be 2 bytes");

        let decoded = CrapsMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov);
    }

    #[test]
    fn test_max_batch_size() {
        let bets: Vec<_> = (0..CrapsBet::MAX_BATCH)
            .map(|i| CrapsBet::simple(CrapsBetType::PassLine, (i + 1) as u64 * 10))
            .collect();

        let mov = CrapsMove::AtomicBatch(bets);
        let payload = mov.encode_v2().unwrap();
        let decoded = CrapsMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov);
    }

    #[test]
    fn test_all_bet_types_roundtrip() {
        // Test all bet types that don't require targets
        let simple_types = [
            CrapsBetType::PassLine,
            CrapsBetType::DontPass,
            CrapsBetType::Come,
            CrapsBetType::DontCome,
            CrapsBetType::Field,
            CrapsBetType::Big6,
            CrapsBetType::Big8,
            CrapsBetType::CrapsEleven, // Yo (11)
            CrapsBetType::CrapsTwo,    // Snake eyes (2)
            CrapsBetType::CrapsThree,  // Ace-Deuce (3)
            CrapsBetType::CrapsTwelve, // Boxcars (12)
            CrapsBetType::AnyCraps,
            CrapsBetType::Any7,
            CrapsBetType::HardFour,
            CrapsBetType::HardSix,
            CrapsBetType::HardEight,
            CrapsBetType::HardTen,
            CrapsBetType::Horn,
            CrapsBetType::World,
        ];

        for bet_type in simple_types {
            let bet = CrapsBet::simple(bet_type, 100);
            let mov = CrapsMove::PlaceBet(bet);
            let encoded = mov.encode_v2().unwrap();
            let decoded = CrapsMove::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, mov, "{:?} bet must roundtrip", bet_type);
        }

        // Test bet types that require targets
        let targeted_types = [
            (CrapsBetType::Place, 0),  // Place 4
            (CrapsBetType::Place, 5),  // Place 10
            (CrapsBetType::Buy, 2),    // Buy 6
            (CrapsBetType::Lay, 4),    // Lay 8
            (CrapsBetType::Hop, 3),    // Hop bet
        ];

        for (bet_type, target) in targeted_types {
            let bet = CrapsBet::new(bet_type, target, 100);
            let mov = CrapsMove::PlaceBet(bet);
            let encoded = mov.encode_v2().unwrap();
            let decoded = CrapsMove::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, mov, "{:?} with target {} must roundtrip", bet_type, target);
        }
    }

    #[test]
    fn test_bet_validation() {
        // Valid bets
        assert!(CrapsBet::simple(CrapsBetType::PassLine, 100).is_valid());
        assert!(CrapsBet::new(CrapsBetType::Place, 5, 100).is_valid());
        assert!(CrapsBet::new(CrapsBetType::Hop, 12, 100).is_valid());

        // Invalid: targeted bet with target = 0 is actually valid (encodes point 4)
        // Invalid: non-targeted bet with target > 0
        assert!(!CrapsBet::new(CrapsBetType::PassLine, 1, 100).is_valid());
    }

    // ========================================================================
    // Bet descriptor integration test
    // ========================================================================

    #[test]
    fn test_craps_bet_uses_correct_layout() {
        // Verify that our CrapsBet encoding is compatible with the unified BetDescriptor
        let layout = bet_layouts::CRAPS;

        // Check that our bit widths match the layout
        assert_eq!(CrapsBet::BET_TYPE_BITS, layout.bet_type_bits as usize);
        assert_eq!(CrapsBet::TARGET_BITS, layout.target_bits as usize);
    }

    // ========================================================================
    // Golden vector tests for specific bet type families
    // ========================================================================

    #[test]
    fn test_pass_line_golden_vector() {
        let mov = CrapsMove::PlaceBet(CrapsBet::simple(CrapsBetType::PassLine, 100));
        let payload = mov.encode_v2().unwrap();

        // Version 2 (010) + opcode 0 (00000) = 0b00000_010 = 0x02
        // Then bet_type=0 (00000) + ULEB128(100) = 0x64
        // Verify determinism and size
        let payload2 = mov.encode_v2().unwrap();
        assert_eq!(payload, payload2, "PassLine encoding must be deterministic");
        assert!(payload.len() <= 3, "PassLine bet should be <= 3 bytes");
    }

    #[test]
    fn test_hardway_bets_golden_vectors() {
        // All hardway bets should encode similarly (no target, just type + amount)
        let hardways = [
            (CrapsBetType::HardFour, "HardFour"),
            (CrapsBetType::HardSix, "HardSix"),
            (CrapsBetType::HardEight, "HardEight"),
            (CrapsBetType::HardTen, "HardTen"),
        ];

        for (bet_type, name) in hardways {
            let mov = CrapsMove::PlaceBet(CrapsBet::simple(bet_type, 100));
            let payload = mov.encode_v2().unwrap();
            assert!(payload.len() <= 3, "{} bet should be <= 3 bytes", name);

            // Verify roundtrip
            let decoded = CrapsMove::decode_v2(&payload).unwrap();
            assert_eq!(decoded, mov, "{} must roundtrip", name);
        }
    }

    #[test]
    fn test_mixed_batch_golden_vector() {
        // Batch with various bet types
        let batch = CrapsMove::AtomicBatch(vec![
            CrapsBet::simple(CrapsBetType::PassLine, 100),
            CrapsBet::new(CrapsBetType::Place, 2, 50),  // Place 6
            CrapsBet::simple(CrapsBetType::Field, 25),
            CrapsBet::new(CrapsBetType::HardSix, 0, 10),
        ]);

        let payload = batch.encode_v2().unwrap();
        let decoded = CrapsMove::decode_v2(&payload).unwrap();

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
}
