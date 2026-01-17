//! HiLo v2 compact encoding (spec: `compact-encoding-hilo.md`).
//!
//! This module implements the bitwise compact encoding for HiLo move payloads
//! and state blobs as defined in the spec. All bit layouts are canonical; JS/TS
//! consumes generated artifacts.
//!
//! # Move Payload Encoding
//!
//! All HiLo moves use a 1-byte header only:
//! - `version` (3 bits): Protocol version (2 for v2)
//! - `opcode` (5 bits): Action type (0-3)
//!
//! No additional payload data is needed since all actions are simple choices.
//!
//! # State Blob Encoding
//!
//! State is encoded compactly using:
//! - 3-bit version
//! - 2-bit stage
//! - ULEB128 accumulator (winnings)
//! - 6-bit last card (0-51)
//! - ULEB128 rules_id

use crate::codec::{
    BitReader, BitWriter, CodecError, CodecResult, DualDecoder, EncodingVersion, PayloadHeader,
};

// ============================================================================
// HiLo Opcodes (v2)
// ============================================================================

/// HiLo action opcodes for v2 compact encoding.
///
/// These map to the opcode values in the 5-bit opcode field of the header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum HiLoOpcode {
    /// Player guesses next card will be higher.
    Higher = 0,
    /// Player guesses next card will be lower.
    Lower = 1,
    /// Player guesses next card will be the same rank.
    Same = 2,
    /// Player cashes out current winnings.
    Cashout = 3,
}

impl TryFrom<u8> for HiLoOpcode {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Higher),
            1 => Ok(Self::Lower),
            2 => Ok(Self::Same),
            3 => Ok(Self::Cashout),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 3, // max opcode
            }),
        }
    }
}

// ============================================================================
// Move Payload Encoding
// ============================================================================

/// A HiLo move action.
///
/// All HiLo moves are header-only (1 byte) since they represent simple choices
/// with no additional parameters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HiLoMove {
    /// Guess the next card will be higher than the current card.
    Higher,
    /// Guess the next card will be lower than the current card.
    Lower,
    /// Guess the next card will be the same rank as the current card.
    Same,
    /// Cash out current winnings and end the round.
    Cashout,
}

impl HiLoMove {
    /// Get the opcode for this move.
    #[must_use]
    pub fn opcode(&self) -> HiLoOpcode {
        match self {
            Self::Higher => HiLoOpcode::Higher,
            Self::Lower => HiLoOpcode::Lower,
            Self::Same => HiLoOpcode::Same,
            Self::Cashout => HiLoOpcode::Cashout,
        }
    }

    /// Encode this move as a v2 compact payload.
    ///
    /// # Returns
    /// The encoded bytes. All HiLo moves are exactly 1 byte (header only).
    /// This satisfies AC-1.1: each action payload is 1 byte total.
    pub fn encode_v2(&self) -> CodecResult<Vec<u8>> {
        let mut writer = BitWriter::new();
        let header = PayloadHeader::new(self.opcode() as u8);
        header.encode(&mut writer)?;
        Ok(writer.finish())
    }

    /// Decode a move from a v2 compact payload.
    ///
    /// # Errors
    /// Returns an error if the payload is invalid or has an unrecognized opcode.
    pub fn decode_v2(data: &[u8]) -> CodecResult<Self> {
        let mut reader = BitReader::new(data);
        let header = PayloadHeader::decode_validated(&mut reader, PayloadHeader::V2)?;
        let opcode = HiLoOpcode::try_from(header.opcode)?;

        Ok(match opcode {
            HiLoOpcode::Higher => Self::Higher,
            HiLoOpcode::Lower => Self::Lower,
            HiLoOpcode::Same => Self::Same,
            HiLoOpcode::Cashout => Self::Cashout,
        })
    }

    /// Detect version and decode (dual-decode for v1/v2 migration).
    ///
    /// V2 payloads are decoded directly. V1 payloads return `Ok(None)` to
    /// signal that legacy decoding is needed.
    ///
    /// This satisfies AC-3.1: v1 and v2 supported during migration.
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

/// HiLo game stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum HiLoStage {
    /// Waiting for initial bet.
    #[default]
    Betting = 0,
    /// Card revealed, awaiting guess.
    AwaitingGuess = 1,
    /// Round complete (win or loss).
    Complete = 2,
    /// Reserved for future use.
    Reserved = 3,
}

impl TryFrom<u8> for HiLoStage {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Betting),
            1 => Ok(Self::AwaitingGuess),
            2 => Ok(Self::Complete),
            3 => Ok(Self::Reserved),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 3, // max stage
            }),
        }
    }
}

/// Complete HiLo state blob.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HiLoState {
    /// Current game stage.
    pub stage: HiLoStage,
    /// Accumulated winnings (multiplied bet amount).
    pub accumulator: u64,
    /// Last revealed card (0-51, or 63 for none).
    pub last_card: u8,
    /// Rules variant ID.
    pub rules_id: u64,
}

impl HiLoState {
    /// Maximum card ID in a standard deck.
    pub const MAX_CARD_ID: u8 = 51;

    /// Sentinel value for "no card" (fits in 6 bits).
    pub const NO_CARD: u8 = 63;

    /// Bit width for a single card (0-51 + sentinel fits in 6 bits).
    pub const CARD_BITS: usize = 6;

    /// Bit widths for header fields.
    pub const VERSION_BITS: usize = 3;
    pub const STAGE_BITS: usize = 2;

    /// Create a new state with the given card.
    #[must_use]
    pub fn with_card(card: u8) -> Self {
        Self {
            stage: HiLoStage::AwaitingGuess,
            accumulator: 0,
            last_card: card.min(Self::MAX_CARD_ID),
            rules_id: 0,
        }
    }

    /// Create a state with no card shown.
    #[must_use]
    pub fn betting() -> Self {
        Self {
            stage: HiLoStage::Betting,
            accumulator: 0,
            last_card: Self::NO_CARD,
            rules_id: 0,
        }
    }

    /// Check if a card is currently shown.
    #[must_use]
    pub fn has_card(&self) -> bool {
        self.last_card <= Self::MAX_CARD_ID
    }

    /// Get the card rank (0-12 for A-K) if a card is shown.
    #[must_use]
    pub fn card_rank(&self) -> Option<u8> {
        if self.has_card() {
            Some(self.last_card % 13)
        } else {
            None
        }
    }

    /// Encode this state as a v2 compact blob.
    pub fn encode_v2(&self) -> CodecResult<Vec<u8>> {
        let mut writer = BitWriter::new();

        // Header
        writer.write_bits(PayloadHeader::V2 as u64, Self::VERSION_BITS)?;
        writer.write_bits(self.stage as u8 as u64, Self::STAGE_BITS)?;

        // Accumulator (ULEB128)
        writer.write_uleb128(self.accumulator)?;

        // Last card (6 bits)
        let card = if self.last_card > Self::MAX_CARD_ID {
            Self::NO_CARD
        } else {
            self.last_card
        };
        writer.write_bits(card as u64, Self::CARD_BITS)?;

        // Rules ID (ULEB128)
        writer.write_uleb128(self.rules_id)?;

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

        let stage = HiLoStage::try_from(reader.read_bits(Self::STAGE_BITS)? as u8)?;

        // Accumulator (ULEB128)
        let accumulator = reader.read_uleb128()?;

        // Last card (6 bits)
        let last_card = reader.read_bits(Self::CARD_BITS)? as u8;

        // Rules ID (ULEB128)
        let rules_id = reader.read_uleb128()?;

        Ok(Self {
            stage,
            accumulator,
            last_card,
            rules_id,
        })
    }

    /// Estimate the v1 JSON-style encoding size for comparison.
    ///
    /// This is a rough estimate based on typical v1 field sizes:
    /// - stage: 4 bytes (enum with padding)
    /// - accumulator: 8 bytes (u64)
    /// - last_card: 4 bytes (u8 with padding)
    /// - rules_id: 8 bytes (u64)
    /// - object overhead: ~16 bytes
    #[must_use]
    pub fn estimate_v1_size(&self) -> usize {
        let base_overhead = 16; // object wrapper, padding
        let stage_size = 4; // enum with padding
        let accumulator_size = 8; // u64
        let last_card_size = 4; // u8 with padding
        let rules_id_size = 8; // u64

        base_overhead + stage_size + accumulator_size + last_card_size + rules_id_size
    }

    /// Calculate the actual v2 encoded size.
    #[must_use]
    pub fn v2_size(&self) -> usize {
        // This calculates the exact size without encoding
        let header_bits = Self::VERSION_BITS + Self::STAGE_BITS;
        let accumulator_bytes = uleb128_size(self.accumulator);
        let card_bits = Self::CARD_BITS;
        let rules_bytes = uleb128_size(self.rules_id);

        // Header + accumulator + card + rules
        // Header and card are bit-packed, accumulator and rules are byte-aligned after flush
        // Actually, ULEB128 writes full bytes to the bit stream, so:
        // (header_bits) + (accumulator_bytes * 8) + (card_bits) + (rules_bytes * 8)
        let total_bits = header_bits + (accumulator_bytes * 8) + card_bits + (rules_bytes * 8);
        (total_bits + 7) / 8
    }
}

/// Calculate the number of bytes needed to encode a value as ULEB128.
fn uleb128_size(value: u64) -> usize {
    if value == 0 {
        return 1;
    }
    let bits_needed = 64 - value.leading_zeros() as usize;
    (bits_needed + 6) / 7 // ceil(bits_needed / 7)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ========================================================================
    // AC-1.1: Each action payload is 1 byte total
    // ========================================================================

    #[test]
    fn test_higher_payload_1_byte_ac_1_1() {
        let mov = HiLoMove::Higher;
        let payload = mov.encode_v2().unwrap();
        assert_eq!(
            payload.len(),
            1,
            "AC-1.1: Higher payload must be 1 byte, got {}",
            payload.len()
        );
    }

    #[test]
    fn test_lower_payload_1_byte_ac_1_1() {
        let mov = HiLoMove::Lower;
        let payload = mov.encode_v2().unwrap();
        assert_eq!(
            payload.len(),
            1,
            "AC-1.1: Lower payload must be 1 byte, got {}",
            payload.len()
        );
    }

    #[test]
    fn test_same_payload_1_byte_ac_1_1() {
        let mov = HiLoMove::Same;
        let payload = mov.encode_v2().unwrap();
        assert_eq!(
            payload.len(),
            1,
            "AC-1.1: Same payload must be 1 byte, got {}",
            payload.len()
        );
    }

    #[test]
    fn test_cashout_payload_1_byte_ac_1_1() {
        let mov = HiLoMove::Cashout;
        let payload = mov.encode_v2().unwrap();
        assert_eq!(
            payload.len(),
            1,
            "AC-1.1: Cashout payload must be 1 byte, got {}",
            payload.len()
        );
    }

    #[test]
    fn test_all_moves_exactly_1_byte_ac_1_1() {
        let moves = [
            HiLoMove::Higher,
            HiLoMove::Lower,
            HiLoMove::Same,
            HiLoMove::Cashout,
        ];
        for mov in moves {
            let payload = mov.encode_v2().unwrap();
            assert_eq!(
                payload.len(),
                1,
                "AC-1.1: {:?} must encode to 1 byte",
                mov
            );
        }
    }

    // ========================================================================
    // AC-2.1: State blob shrinks by >= 30%
    // ========================================================================

    #[test]
    fn test_typical_state_compaction_ac_2_1() {
        // Typical state: awaiting guess with small accumulator
        let state = HiLoState {
            stage: HiLoStage::AwaitingGuess,
            accumulator: 100,
            last_card: 25, // 3 of diamonds (example)
            rules_id: 0,
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
    fn test_betting_state_compaction_ac_2_1() {
        let state = HiLoState::betting();

        let v2_bytes = state.encode_v2().unwrap();
        let v1_estimate = state.estimate_v1_size();

        let reduction = 1.0 - (v2_bytes.len() as f64 / v1_estimate as f64);
        assert!(
            reduction >= 0.30,
            "AC-2.1: Betting state compaction must be >= 30%, got {:.1}% (v1={}, v2={})",
            reduction * 100.0,
            v1_estimate,
            v2_bytes.len()
        );
    }

    #[test]
    fn test_large_accumulator_compaction_ac_2_1() {
        // State with large accumulator (big win streak)
        let state = HiLoState {
            stage: HiLoStage::AwaitingGuess,
            accumulator: 10000,
            last_card: 0, // Ace of spades
            rules_id: 1,
        };

        let v2_bytes = state.encode_v2().unwrap();
        let v1_estimate = state.estimate_v1_size();

        let reduction = 1.0 - (v2_bytes.len() as f64 / v1_estimate as f64);
        assert!(
            reduction >= 0.30,
            "AC-2.1: Large accumulator state compaction must be >= 30%, got {:.1}% (v1={}, v2={})",
            reduction * 100.0,
            v1_estimate,
            v2_bytes.len()
        );
    }

    #[test]
    fn test_complete_state_compaction_ac_2_1() {
        // Complete state (round over)
        let state = HiLoState {
            stage: HiLoStage::Complete,
            accumulator: 500,
            last_card: 51, // King of clubs
            rules_id: 2,
        };

        let v2_bytes = state.encode_v2().unwrap();
        let v1_estimate = state.estimate_v1_size();

        let reduction = 1.0 - (v2_bytes.len() as f64 / v1_estimate as f64);
        assert!(
            reduction >= 0.30,
            "AC-2.1: Complete state compaction must be >= 30%, got {:.1}% (v1={}, v2={})",
            reduction * 100.0,
            v1_estimate,
            v2_bytes.len()
        );
    }

    // ========================================================================
    // AC-3.1: v1 and v2 both accepted during migration
    // ========================================================================

    #[test]
    fn test_v2_payload_accepted_ac_3_1() {
        let mov = HiLoMove::Higher;
        let payload = mov.encode_v2().unwrap();

        // Should decode successfully
        let decoded = HiLoMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov, "AC-3.1: v2 payload must decode correctly");
    }

    #[test]
    fn test_all_moves_roundtrip_ac_3_1() {
        let moves = [
            HiLoMove::Higher,
            HiLoMove::Lower,
            HiLoMove::Same,
            HiLoMove::Cashout,
        ];
        for original in moves {
            let payload = original.encode_v2().unwrap();
            let decoded = HiLoMove::decode_v2(&payload).unwrap();
            assert_eq!(decoded, original, "AC-3.1: {:?} must roundtrip", original);
        }
    }

    #[test]
    fn test_dual_decode_v2_payload_ac_3_1() {
        let mov = HiLoMove::Lower;
        let payload = mov.encode_v2().unwrap();

        // Dual decode should return Some for v2
        let result = HiLoMove::decode_dual(&payload).unwrap();
        assert!(result.is_some(), "AC-3.1: dual decode must return Some for v2");
        assert_eq!(result.unwrap(), mov);
    }

    #[test]
    fn test_dual_decode_v1_payload_returns_none_ac_3_1() {
        // Simulate a v1 payload (version bits = 1)
        let v1_payload = vec![0x01, 0x00, 0x00, 0x00];

        // Dual decode should return None for v1
        let result = HiLoMove::decode_dual(&v1_payload).unwrap();
        assert!(
            result.is_none(),
            "AC-3.1: dual decode must return None for v1"
        );
    }

    // ========================================================================
    // Golden vector tests (determinism)
    // ========================================================================

    #[test]
    fn test_higher_golden_vector() {
        let mov = HiLoMove::Higher;
        let payload = mov.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 0 (bits 00000) = 0b00000_010 = 0x02
        assert_eq!(payload, vec![0x02], "Higher golden vector");
    }

    #[test]
    fn test_lower_golden_vector() {
        let mov = HiLoMove::Lower;
        let payload = mov.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 1 (bits 00001) = 0b00001_010 = 0x0A
        assert_eq!(payload, vec![0x0A], "Lower golden vector");
    }

    #[test]
    fn test_same_golden_vector() {
        let mov = HiLoMove::Same;
        let payload = mov.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 2 (bits 00010) = 0b00010_010 = 0x12
        assert_eq!(payload, vec![0x12], "Same golden vector");
    }

    #[test]
    fn test_cashout_golden_vector() {
        let mov = HiLoMove::Cashout;
        let payload = mov.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 3 (bits 00011) = 0b00011_010 = 0x1A
        assert_eq!(payload, vec![0x1A], "Cashout golden vector");
    }

    #[test]
    fn test_encoding_deterministic() {
        // Same input must produce same output every time
        for _ in 0..10 {
            let mov = HiLoMove::Higher;
            let payload = mov.encode_v2().unwrap();
            assert_eq!(payload, vec![0x02]);
        }
    }

    // ========================================================================
    // State blob roundtrip tests
    // ========================================================================

    #[test]
    fn test_state_roundtrip_betting() {
        let state = HiLoState::betting();
        let encoded = state.encode_v2().unwrap();
        let decoded = HiLoState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_awaiting_guess() {
        let state = HiLoState::with_card(25);
        let encoded = state.encode_v2().unwrap();
        let decoded = HiLoState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_with_accumulator() {
        let state = HiLoState {
            stage: HiLoStage::AwaitingGuess,
            accumulator: 1000,
            last_card: 10,
            rules_id: 5,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = HiLoState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_complete() {
        let state = HiLoState {
            stage: HiLoStage::Complete,
            accumulator: 500,
            last_card: 51,
            rules_id: 0,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = HiLoState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_all_stages() {
        for stage_val in 0..=3 {
            let stage = HiLoStage::try_from(stage_val).unwrap();
            let state = HiLoState {
                stage,
                accumulator: 100,
                last_card: 0,
                rules_id: 1,
            };

            let encoded = state.encode_v2().unwrap();
            let decoded = HiLoState::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, state, "Stage {:?} must roundtrip", stage);
        }
    }

    #[test]
    fn test_state_roundtrip_all_cards() {
        // Test all 52 cards
        for card in 0..=51 {
            let state = HiLoState::with_card(card);
            let encoded = state.encode_v2().unwrap();
            let decoded = HiLoState::decode_v2(&encoded).unwrap();
            assert_eq!(decoded.last_card, card, "Card {} must roundtrip", card);
        }
    }

    #[test]
    fn test_state_roundtrip_no_card() {
        let state = HiLoState {
            stage: HiLoStage::Betting,
            accumulator: 0,
            last_card: HiLoState::NO_CARD,
            rules_id: 0,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = HiLoState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded.last_card, HiLoState::NO_CARD);
        assert!(!decoded.has_card());
    }

    #[test]
    fn test_state_roundtrip_various_accumulators() {
        let accumulators = [0u64, 1, 127, 128, 1000, 16383, 100000, u64::MAX / 2];

        for acc in accumulators {
            let state = HiLoState {
                stage: HiLoStage::AwaitingGuess,
                accumulator: acc,
                last_card: 25,
                rules_id: 0,
            };

            let encoded = state.encode_v2().unwrap();
            let decoded = HiLoState::decode_v2(&encoded).unwrap();
            assert_eq!(
                decoded.accumulator, acc,
                "Accumulator {} must roundtrip",
                acc
            );
        }
    }

    #[test]
    fn test_state_roundtrip_various_rules_ids() {
        let rules_ids = [0u64, 1, 127, 128, 1000, 16383];

        for rules_id in rules_ids {
            let state = HiLoState {
                stage: HiLoStage::AwaitingGuess,
                accumulator: 100,
                last_card: 10,
                rules_id,
            };

            let encoded = state.encode_v2().unwrap();
            let decoded = HiLoState::decode_v2(&encoded).unwrap();
            assert_eq!(
                decoded.rules_id, rules_id,
                "Rules ID {} must roundtrip",
                rules_id
            );
        }
    }

    // ========================================================================
    // Helper method tests
    // ========================================================================

    #[test]
    fn test_has_card() {
        assert!(HiLoState::with_card(0).has_card());
        assert!(HiLoState::with_card(51).has_card());
        assert!(!HiLoState::betting().has_card());
    }

    #[test]
    fn test_card_rank() {
        // Aces (rank 0) are at positions 0, 13, 26, 39
        assert_eq!(HiLoState::with_card(0).card_rank(), Some(0)); // Ace of spades
        assert_eq!(HiLoState::with_card(13).card_rank(), Some(0)); // Ace of hearts

        // Kings (rank 12) are at positions 12, 25, 38, 51
        assert_eq!(HiLoState::with_card(12).card_rank(), Some(12)); // King of spades
        assert_eq!(HiLoState::with_card(51).card_rank(), Some(12)); // King of clubs

        // No card
        assert_eq!(HiLoState::betting().card_rank(), None);
    }

    #[test]
    fn test_opcode_mapping() {
        assert_eq!(HiLoMove::Higher.opcode() as u8, 0);
        assert_eq!(HiLoMove::Lower.opcode() as u8, 1);
        assert_eq!(HiLoMove::Same.opcode() as u8, 2);
        assert_eq!(HiLoMove::Cashout.opcode() as u8, 3);
    }

    // ========================================================================
    // Size calculation tests
    // ========================================================================

    #[test]
    fn test_v2_size_calculation_betting() {
        let state = HiLoState::betting();
        let encoded = state.encode_v2().unwrap();
        assert_eq!(encoded.len(), state.v2_size());
    }

    #[test]
    fn test_v2_size_calculation_with_accumulator() {
        let state = HiLoState {
            stage: HiLoStage::AwaitingGuess,
            accumulator: 1000,
            last_card: 25,
            rules_id: 10,
        };
        let encoded = state.encode_v2().unwrap();
        assert_eq!(encoded.len(), state.v2_size());
    }

    // ========================================================================
    // Error handling tests
    // ========================================================================

    #[test]
    fn test_invalid_opcode_error() {
        // Construct a payload with invalid opcode (31)
        let mut writer = BitWriter::new();
        writer.write_bits(2, 3).unwrap(); // version 2
        writer.write_bits(31, 5).unwrap(); // opcode 31 (invalid)
        let payload = writer.finish();

        let result = HiLoMove::decode_v2(&payload);
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_version_error() {
        // Construct a payload with version 0
        let mut writer = BitWriter::new();
        writer.write_bits(0, 3).unwrap(); // version 0
        writer.write_bits(0, 5).unwrap(); // opcode 0
        let payload = writer.finish();

        let result = HiLoMove::decode_v2(&payload);
        assert!(result.is_err());
    }

    #[test]
    fn test_empty_payload_error() {
        let result = HiLoMove::decode_v2(&[]);
        assert!(result.is_err());
    }

    #[test]
    fn test_state_invalid_version_error() {
        // Construct state with version 0
        let mut writer = BitWriter::new();
        writer.write_bits(0, 3).unwrap(); // version 0
        writer.write_bits(0, 2).unwrap(); // stage 0
        writer.write_uleb128(0).unwrap(); // accumulator
        writer.write_bits(0, 6).unwrap(); // card
        writer.write_uleb128(0).unwrap(); // rules_id
        let data = writer.finish();

        let result = HiLoState::decode_v2(&data);
        assert!(result.is_err());
    }
}
