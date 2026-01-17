//! Casino War v2 compact encoding (spec: `compact-encoding-casino-war.md`).
//!
//! This module implements the bitwise compact encoding for casino war move
//! payloads and state blobs as defined in the spec. All bit layouts are canonical;
//! JS/TS consumes generated artifacts.
//!
//! # Move Payload Encoding
//!
//! All casino war moves use a 1-byte header:
//! - `version` (3 bits): Protocol version (2 for v2)
//! - `opcode` (5 bits): Action type (0-4)
//!
//! Play/War/Surrender are header-only (1 byte).
//! SetTieBet includes a ULEB128 amount.
//!
//! # State Blob Encoding
//!
//! State is encoded compactly using:
//! - 6-bit card IDs (0-51)
//! - 2-bit stage
//! - ULEB128 tie bet amount

use crate::codec::{
    BitReader, BitWriter, CodecError, CodecResult, DualDecoder, EncodingVersion, PayloadHeader,
};

// ============================================================================
// Casino War Opcodes (v2)
// ============================================================================

/// Casino War action opcodes for v2 compact encoding.
///
/// These map to the opcode values in the 5-bit opcode field of the header.
/// Per spec section 3.2.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum CasinoWarOpcode {
    /// Initial play action (start the hand).
    Play = 0,
    /// Go to war after a tie.
    War = 1,
    /// Surrender after a tie (forfeit half the bet).
    Surrender = 2,
    /// Set the tie bet amount.
    SetTieBet = 3,
    /// Set table rules variant.
    SetRules = 4,
}

impl CasinoWarOpcode {
    /// All valid opcodes.
    pub const ALL: [Self; 5] = [
        Self::Play,
        Self::War,
        Self::Surrender,
        Self::SetTieBet,
        Self::SetRules,
    ];

    /// Opcodes that produce a header-only (1 byte) payload.
    pub const HEADER_ONLY: [Self; 3] = [Self::Play, Self::War, Self::Surrender];

    /// Check if this opcode produces a header-only (1 byte) payload.
    #[must_use]
    pub const fn is_header_only(&self) -> bool {
        matches!(self, Self::Play | Self::War | Self::Surrender)
    }
}

impl TryFrom<u8> for CasinoWarOpcode {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Play),
            1 => Ok(Self::War),
            2 => Ok(Self::Surrender),
            3 => Ok(Self::SetTieBet),
            4 => Ok(Self::SetRules),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 4, // max opcode
            }),
        }
    }
}

// ============================================================================
// Move Payload Encoding
// ============================================================================

/// A casino war move action with optional payload data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CasinoWarMove {
    /// Play: Start a new hand.
    Play,
    /// War: Go to war after a tie.
    War,
    /// Surrender: Forfeit half the bet after a tie.
    Surrender,
    /// SetTieBet: Set the tie bet amount.
    SetTieBet { amount: u64 },
    /// SetRules: Configure table rules.
    SetRules { rules_id: u64 },
}

impl CasinoWarMove {
    /// Get the opcode for this move.
    #[must_use]
    pub fn opcode(&self) -> CasinoWarOpcode {
        match self {
            Self::Play => CasinoWarOpcode::Play,
            Self::War => CasinoWarOpcode::War,
            Self::Surrender => CasinoWarOpcode::Surrender,
            Self::SetTieBet { .. } => CasinoWarOpcode::SetTieBet,
            Self::SetRules { .. } => CasinoWarOpcode::SetRules,
        }
    }

    /// Encode this move as a v2 compact payload.
    ///
    /// # Returns
    /// The encoded bytes. Header-only moves (Play, War, Surrender) return 1 byte.
    pub fn encode_v2(&self) -> CodecResult<Vec<u8>> {
        let mut writer = BitWriter::new();
        let header = PayloadHeader::new(self.opcode() as u8);
        header.encode(&mut writer)?;

        match self {
            Self::Play | Self::War | Self::Surrender => {
                // Header only - no additional payload
            }
            Self::SetTieBet { amount } => {
                writer.write_uleb128(*amount)?;
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
        let opcode = CasinoWarOpcode::try_from(header.opcode)?;

        Ok(match opcode {
            CasinoWarOpcode::Play => Self::Play,
            CasinoWarOpcode::War => Self::War,
            CasinoWarOpcode::Surrender => Self::Surrender,
            CasinoWarOpcode::SetTieBet => {
                let amount = reader.read_uleb128()?;
                Self::SetTieBet { amount }
            }
            CasinoWarOpcode::SetRules => {
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

/// Casino War game stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum CasinoWarStage {
    /// Waiting for initial bet/play.
    #[default]
    Betting = 0,
    /// Initial cards dealt, comparing ranks.
    Comparing = 1,
    /// Tie occurred, waiting for war/surrender decision.
    TieDecision = 2,
    /// Hand is complete with result.
    Complete = 3,
}

impl CasinoWarStage {
    /// Bit width for stage field.
    pub const BITS: usize = 2;
}

impl TryFrom<u8> for CasinoWarStage {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Betting),
            1 => Ok(Self::Comparing),
            2 => Ok(Self::TieDecision),
            3 => Ok(Self::Complete),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 3, // max stage
            }),
        }
    }
}

/// Complete casino war state blob.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CasinoWarState {
    /// Current game stage.
    pub stage: CasinoWarStage,
    /// Player's card (6-bit ID, 0-51). 63 = no card dealt yet.
    pub player_card: u8,
    /// Dealer's card (6-bit ID, 0-51). 63 = no card dealt yet.
    pub dealer_card: u8,
    /// Tie bet amount (0 if none).
    pub tie_bet: u64,
    /// War cards dealt (during war phase).
    pub war_player_card: Option<u8>,
    pub war_dealer_card: Option<u8>,
}

impl CasinoWarState {
    /// Sentinel value for "no card dealt yet".
    pub const NO_CARD: u8 = 63;

    /// Bit width for a single card (0-63 fits in 6 bits).
    pub const CARD_BITS: usize = 6;

    /// Version bits.
    pub const VERSION_BITS: usize = 3;

    /// Encode this state as a v2 compact blob.
    pub fn encode_v2(&self) -> CodecResult<Vec<u8>> {
        let mut writer = BitWriter::new();

        // Header bits per spec (section 4.1)
        writer.write_bits(PayloadHeader::V2 as u64, Self::VERSION_BITS)?;
        writer.write_bits(self.stage as u8 as u64, CasinoWarStage::BITS)?;

        // Cards per spec (section 4.1)
        writer.write_bits(self.player_card as u64, Self::CARD_BITS)?;
        writer.write_bits(self.dealer_card as u64, Self::CARD_BITS)?;

        // Tie bet per spec (section 4.1)
        writer.write_uleb128(self.tie_bet)?;

        // War cards (optional - use 1 bit flag + 6 bits if present)
        let has_war_cards = self.war_player_card.is_some() || self.war_dealer_card.is_some();
        writer.write_bit(has_war_cards)?;
        if has_war_cards {
            writer.write_bits(
                self.war_player_card.unwrap_or(Self::NO_CARD) as u64,
                Self::CARD_BITS,
            )?;
            writer.write_bits(
                self.war_dealer_card.unwrap_or(Self::NO_CARD) as u64,
                Self::CARD_BITS,
            )?;
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

        let stage = CasinoWarStage::try_from(reader.read_bits(CasinoWarStage::BITS)? as u8)?;

        // Cards
        let player_card = reader.read_bits(Self::CARD_BITS)? as u8;
        let dealer_card = reader.read_bits(Self::CARD_BITS)? as u8;

        // Tie bet
        let tie_bet = reader.read_uleb128()?;

        // War cards
        let has_war_cards = reader.read_bit()?;
        let (war_player_card, war_dealer_card) = if has_war_cards {
            let wpc = reader.read_bits(Self::CARD_BITS)? as u8;
            let wdc = reader.read_bits(Self::CARD_BITS)? as u8;
            (
                if wpc == Self::NO_CARD { None } else { Some(wpc) },
                if wdc == Self::NO_CARD { None } else { Some(wdc) },
            )
        } else {
            (None, None)
        };

        Ok(Self {
            stage,
            player_card,
            dealer_card,
            tie_bet,
            war_player_card,
            war_dealer_card,
        })
    }

    /// Estimate the v1 JSON-style encoding size for comparison.
    ///
    /// This is a rough estimate based on typical v1 field sizes:
    /// - stage: 1 byte enum + padding
    /// - cards: 1 byte each
    /// - tie_bet: 8 bytes (u64)
    /// - war cards: optional u8s
    #[must_use]
    pub fn estimate_v1_size(&self) -> usize {
        let base_overhead = 16; // object wrapper, padding
        let stage_size = 4;     // enum with padding
        let cards_size = 4 + 4; // player_card + dealer_card with padding
        let tie_bet_size = 8;   // u64
        let war_cards_size = if self.war_player_card.is_some() || self.war_dealer_card.is_some() {
            8 + 4 + 4 // Option overhead + 2 optional u8s with padding
        } else {
            8 // Two None options
        };

        base_overhead + stage_size + cards_size + tie_bet_size + war_cards_size
    }

    /// Calculate the actual v2 encoded size.
    #[must_use]
    pub fn v2_size(&self) -> usize {
        // Header bits
        let header_bits = Self::VERSION_BITS + CasinoWarStage::BITS + Self::CARD_BITS * 2;

        // Tie bet bytes (ULEB128)
        let tie_bet_bytes = crate::codec::encode_uleb128(self.tie_bet).len();

        // War cards (1 flag bit + optional 12 bits)
        let war_bits = 1
            + if self.war_player_card.is_some() || self.war_dealer_card.is_some() {
                Self::CARD_BITS * 2
            } else {
                0
            };

        let total_bits = header_bits + war_bits;
        total_bits.div_ceil(8) + tie_bet_bytes
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ========================================================================
    // AC-1.1: play/war/surrender payloads are 1 byte total
    // ========================================================================

    #[test]
    fn test_play_payload_1_byte_ac_1_1() {
        let payload = CasinoWarMove::Play.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "AC-1.1: Play must be 1 byte");
    }

    #[test]
    fn test_war_payload_1_byte_ac_1_1() {
        let payload = CasinoWarMove::War.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "AC-1.1: War must be 1 byte");
    }

    #[test]
    fn test_surrender_payload_1_byte_ac_1_1() {
        let payload = CasinoWarMove::Surrender.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "AC-1.1: Surrender must be 1 byte");
    }

    #[test]
    fn test_all_header_only_actions_1_byte_ac_1_1() {
        for opcode in CasinoWarOpcode::HEADER_ONLY {
            let mov = match opcode {
                CasinoWarOpcode::Play => CasinoWarMove::Play,
                CasinoWarOpcode::War => CasinoWarMove::War,
                CasinoWarOpcode::Surrender => CasinoWarMove::Surrender,
                _ => unreachable!(),
            };
            let payload = mov.encode_v2().unwrap();
            assert_eq!(
                payload.len(),
                1,
                "AC-1.1: {:?} must be 1 byte",
                opcode
            );
        }
    }

    // ========================================================================
    // AC-1.2: tie bet payload <= 3 bytes for small amounts
    // ========================================================================

    #[test]
    fn test_tie_bet_small_amount_3_bytes_ac_1_2() {
        let mov = CasinoWarMove::SetTieBet { amount: 100 };
        let payload = mov.encode_v2().unwrap();

        // 1 byte header + ULEB128(100) = 1 byte
        assert!(
            payload.len() <= 3,
            "AC-1.2: SetTieBet(100) must be <= 3 bytes, got {}",
            payload.len()
        );
    }

    #[test]
    fn test_tie_bet_various_small_amounts_ac_1_2() {
        // Test with different small amounts (< 128)
        let test_amounts = [1, 25, 50, 100, 127];

        for amount in test_amounts {
            let mov = CasinoWarMove::SetTieBet { amount };
            let payload = mov.encode_v2().unwrap();

            assert!(
                payload.len() <= 3,
                "AC-1.2: SetTieBet({}) must be <= 3 bytes, got {}",
                amount,
                payload.len()
            );
        }
    }

    #[test]
    fn test_tie_bet_medium_amount_size() {
        // 128-16383 should still be small (2 ULEB128 bytes)
        let mov = CasinoWarMove::SetTieBet { amount: 1000 };
        let payload = mov.encode_v2().unwrap();

        // 1 byte header + ULEB128(1000) = 2 bytes = 3 bytes total
        assert!(payload.len() <= 3, "SetTieBet(1000) should be <= 3 bytes");
    }

    #[test]
    fn test_tie_bet_large_amount_size() {
        // Large amounts need more bytes
        let mov = CasinoWarMove::SetTieBet { amount: 100000 };
        let payload = mov.encode_v2().unwrap();

        // 1 byte header + ULEB128(100000) = 3 bytes = 4 bytes total
        // This exceeds the <= 3 byte target, but that's expected for large amounts
        assert!(payload.len() >= 4, "SetTieBet(100000) should be >= 4 bytes");
    }

    // ========================================================================
    // AC-2.1: Typical state blob shrinks by >= 30%
    // ========================================================================

    #[test]
    fn test_typical_state_compaction_ac_2_1() {
        // Typical mid-game state: comparing phase with cards dealt
        let state = CasinoWarState {
            stage: CasinoWarStage::Comparing,
            player_card: 10, // Jack of clubs (example)
            dealer_card: 25, // King of hearts (example)
            tie_bet: 100,
            war_player_card: None,
            war_dealer_card: None,
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
    fn test_complete_state_with_war_compaction_ac_2_1() {
        // Complete state with war cards dealt
        let state = CasinoWarState {
            stage: CasinoWarStage::Complete,
            player_card: 10,
            dealer_card: 10, // Tied initially
            tie_bet: 50,
            war_player_card: Some(30),
            war_dealer_card: Some(15),
        };

        let v2_bytes = state.encode_v2().unwrap();
        let v1_estimate = state.estimate_v1_size();

        let reduction = 1.0 - (v2_bytes.len() as f64 / v1_estimate as f64);
        assert!(
            reduction >= 0.30,
            "AC-2.1: State with war cards compaction must be >= 30%, got {:.1}% (v1={}, v2={})",
            reduction * 100.0,
            v1_estimate,
            v2_bytes.len()
        );
    }

    #[test]
    fn test_minimal_state_compaction_ac_2_1() {
        // Minimal state (betting phase, no cards)
        let state = CasinoWarState {
            stage: CasinoWarStage::Betting,
            player_card: CasinoWarState::NO_CARD,
            dealer_card: CasinoWarState::NO_CARD,
            tie_bet: 0,
            war_player_card: None,
            war_dealer_card: None,
        };

        let v2_bytes = state.encode_v2().unwrap();
        let v1_estimate = state.estimate_v1_size();

        let reduction = 1.0 - (v2_bytes.len() as f64 / v1_estimate as f64);
        assert!(
            reduction >= 0.30,
            "AC-2.1: Minimal state compaction must be >= 30%, got {:.1}% (v1={}, v2={})",
            reduction * 100.0,
            v1_estimate,
            v2_bytes.len()
        );
    }

    // ========================================================================
    // AC-3.1: v1 and v2 supported during migration
    // ========================================================================

    #[test]
    fn test_v2_payload_accepted_ac_3_1() {
        let mov = CasinoWarMove::Play;
        let payload = mov.encode_v2().unwrap();

        // Should decode successfully
        let decoded = CasinoWarMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov, "AC-3.1: v2 payload must decode correctly");
    }

    #[test]
    fn test_v2_tie_bet_roundtrip_ac_3_1() {
        let original = CasinoWarMove::SetTieBet { amount: 250 };
        let payload = original.encode_v2().unwrap();
        let decoded = CasinoWarMove::decode_v2(&payload).unwrap();

        assert_eq!(decoded, original, "AC-3.1: SetTieBet must roundtrip");
    }

    #[test]
    fn test_dual_decode_v2_payload_ac_3_1() {
        let mov = CasinoWarMove::War;
        let payload = mov.encode_v2().unwrap();

        // Dual decode should return Some for v2
        let result = CasinoWarMove::decode_dual(&payload).unwrap();
        assert!(result.is_some(), "AC-3.1: dual decode must return Some for v2");
        assert_eq!(result.unwrap(), mov);
    }

    #[test]
    fn test_dual_decode_v1_payload_returns_none_ac_3_1() {
        // Simulate a v1 payload (version bits = 1)
        let v1_payload = vec![0x01, 0x00, 0x00, 0x00];

        // Dual decode should return None for v1
        let result = CasinoWarMove::decode_dual(&v1_payload).unwrap();
        assert!(result.is_none(), "AC-3.1: dual decode must return None for v1");
    }

    // ========================================================================
    // State blob roundtrip tests
    // ========================================================================

    #[test]
    fn test_state_roundtrip_empty() {
        let state = CasinoWarState::default();
        let encoded = state.encode_v2().unwrap();
        let decoded = CasinoWarState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_comparing_phase() {
        let state = CasinoWarState {
            stage: CasinoWarStage::Comparing,
            player_card: 10,
            dealer_card: 25,
            tie_bet: 100,
            war_player_card: None,
            war_dealer_card: None,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = CasinoWarState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_tie_decision() {
        let state = CasinoWarState {
            stage: CasinoWarStage::TieDecision,
            player_card: 10,
            dealer_card: 10, // Same rank = tie
            tie_bet: 50,
            war_player_card: None,
            war_dealer_card: None,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = CasinoWarState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_complete_with_war() {
        let state = CasinoWarState {
            stage: CasinoWarStage::Complete,
            player_card: 10,
            dealer_card: 10,
            tie_bet: 100,
            war_player_card: Some(30),
            war_dealer_card: Some(15),
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = CasinoWarState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_all_stages() {
        for stage in [
            CasinoWarStage::Betting,
            CasinoWarStage::Comparing,
            CasinoWarStage::TieDecision,
            CasinoWarStage::Complete,
        ] {
            let state = CasinoWarState {
                stage,
                ..Default::default()
            };
            let encoded = state.encode_v2().unwrap();
            let decoded = CasinoWarState::decode_v2(&encoded).unwrap();
            assert_eq!(decoded.stage, stage);
        }
    }

    // ========================================================================
    // Move roundtrip tests
    // ========================================================================

    #[test]
    fn test_all_moves_roundtrip() {
        let moves = vec![
            CasinoWarMove::Play,
            CasinoWarMove::War,
            CasinoWarMove::Surrender,
            CasinoWarMove::SetTieBet { amount: 0 },
            CasinoWarMove::SetTieBet { amount: 100 },
            CasinoWarMove::SetRules { rules_id: 42 },
        ];

        for mov in moves {
            let encoded = mov.encode_v2().unwrap();
            let decoded = CasinoWarMove::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, mov, "Move {:?} must roundtrip", mov);
        }
    }

    #[test]
    fn test_set_rules_roundtrip() {
        let test_ids = [0, 1, 127, 128, 1000, u64::MAX];

        for rules_id in test_ids {
            let mov = CasinoWarMove::SetRules { rules_id };
            let encoded = mov.encode_v2().unwrap();
            let decoded = CasinoWarMove::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, mov, "SetRules({}) must roundtrip", rules_id);
        }
    }

    #[test]
    fn test_tie_bet_amounts_roundtrip() {
        let test_amounts = [0, 1, 127, 128, 1000, 10000, 100000, u64::MAX];

        for amount in test_amounts {
            let mov = CasinoWarMove::SetTieBet { amount };
            let encoded = mov.encode_v2().unwrap();
            let decoded = CasinoWarMove::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, mov, "SetTieBet({}) must roundtrip", amount);
        }
    }

    // ========================================================================
    // Golden vector tests for determinism
    // ========================================================================

    #[test]
    fn test_play_golden_vector() {
        let payload = CasinoWarMove::Play.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 0 (bits 00000) = 0b00000_010 = 0x02
        assert_eq!(payload, vec![0x02], "Play golden vector");
    }

    #[test]
    fn test_war_golden_vector() {
        let payload = CasinoWarMove::War.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 1 (bits 00001) = 0b00001_010 = 0x0A
        assert_eq!(payload, vec![0x0A], "War golden vector");
    }

    #[test]
    fn test_surrender_golden_vector() {
        let payload = CasinoWarMove::Surrender.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 2 (bits 00010) = 0b00010_010 = 0x12
        assert_eq!(payload, vec![0x12], "Surrender golden vector");
    }

    #[test]
    fn test_set_tie_bet_golden_vector() {
        let payload = CasinoWarMove::SetTieBet { amount: 100 }.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 3 (bits 00011) = 0b00011_010 = 0x1A
        // Then ULEB128(100) = 0x64
        assert_eq!(payload, vec![0x1A, 0x64], "SetTieBet(100) golden vector");
    }

    #[test]
    fn test_encoding_deterministic() {
        // Same input must produce same output every time
        for _ in 0..10 {
            let mov = CasinoWarMove::Play;
            let payload = mov.encode_v2().unwrap();
            assert_eq!(payload, vec![0x02]);
        }
    }

    // ========================================================================
    // Edge case tests
    // ========================================================================

    #[test]
    fn test_state_max_card_values() {
        // Test with max valid card ID (51)
        let state = CasinoWarState {
            stage: CasinoWarStage::Complete,
            player_card: 51,
            dealer_card: 51,
            tie_bet: 0,
            war_player_card: Some(51),
            war_dealer_card: Some(51),
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = CasinoWarState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_min_card_values() {
        // Test with min card ID (0)
        let state = CasinoWarState {
            stage: CasinoWarStage::Comparing,
            player_card: 0,
            dealer_card: 0,
            tie_bet: 0,
            war_player_card: None,
            war_dealer_card: None,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = CasinoWarState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_no_card_sentinel() {
        // Test with NO_CARD sentinel (63)
        let state = CasinoWarState {
            stage: CasinoWarStage::Betting,
            player_card: CasinoWarState::NO_CARD,
            dealer_card: CasinoWarState::NO_CARD,
            tie_bet: 0,
            war_player_card: None,
            war_dealer_card: None,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = CasinoWarState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded.player_card, CasinoWarState::NO_CARD);
        assert_eq!(decoded.dealer_card, CasinoWarState::NO_CARD);
    }

    #[test]
    fn test_all_opcodes_have_correct_values() {
        // Verify opcode values match spec section 3.2
        assert_eq!(CasinoWarOpcode::Play as u8, 0);
        assert_eq!(CasinoWarOpcode::War as u8, 1);
        assert_eq!(CasinoWarOpcode::Surrender as u8, 2);
        assert_eq!(CasinoWarOpcode::SetTieBet as u8, 3);
        assert_eq!(CasinoWarOpcode::SetRules as u8, 4);
    }

    #[test]
    fn test_large_tie_bet_roundtrip() {
        // Test with max u64 value
        let state = CasinoWarState {
            stage: CasinoWarStage::Comparing,
            player_card: 10,
            dealer_card: 25,
            tie_bet: u64::MAX,
            war_player_card: None,
            war_dealer_card: None,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = CasinoWarState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded.tie_bet, u64::MAX);
    }

    #[test]
    fn test_war_cards_partial_presence() {
        // Test with only war player card (unusual but should work)
        let state = CasinoWarState {
            stage: CasinoWarStage::Complete,
            player_card: 10,
            dealer_card: 10,
            tie_bet: 50,
            war_player_card: Some(30),
            war_dealer_card: None,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = CasinoWarState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded.war_player_card, Some(30));
        assert_eq!(decoded.war_dealer_card, None);
    }
}
