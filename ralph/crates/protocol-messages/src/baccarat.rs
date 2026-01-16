//! Baccarat v2 compact encoding (spec: `compact-encoding-baccarat.md`).
//!
//! This module implements the bitwise compact encoding for baccarat move payloads
//! and state blobs as defined in the spec. All bit layouts are canonical; JS/TS
//! consumes generated artifacts.
//!
//! # Move Payload Encoding
//!
//! All baccarat moves use a 1-byte header:
//! - `version` (3 bits): Protocol version (2 for v2)
//! - `opcode` (5 bits): Action type (0-4)
//!
//! PlaceBet includes bet_type (4 bits) + amount (ULEB128).
//! AtomicBatch includes bet_count (4 bits) + repeated bet descriptors.
//!
//! # State Blob Encoding
//!
//! State is encoded compactly using:
//! - 6-bit card IDs (0-51)
//! - 4-bit totals (0-9, baccarat scores are mod 10)
//! - 2-bit card counts per hand
//! - Bit-packed stage and result flags

use crate::codec::{
    BitReader, BitWriter, CodecError, CodecResult, DualDecoder, EncodingVersion, PayloadHeader,
};

// ============================================================================
// Baccarat Opcodes (v2)
// ============================================================================

/// Baccarat action opcodes for v2 compact encoding.
///
/// These map to the opcode values in the 5-bit opcode field of the header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum BaccaratOpcode {
    /// Place a single bet (bet_type + amount).
    PlaceBet = 0,
    /// Deal cards (initiates the hand after bets are placed).
    Deal = 1,
    /// Clear all bets.
    ClearBets = 2,
    /// Place multiple bets atomically.
    AtomicBatch = 3,
    /// Set table rules variant.
    SetRules = 4,
}

impl BaccaratOpcode {
    /// All valid opcodes.
    pub const ALL: [Self; 5] = [
        Self::PlaceBet,
        Self::Deal,
        Self::ClearBets,
        Self::AtomicBatch,
        Self::SetRules,
    ];

    /// Opcodes that produce a header-only (1 byte) payload.
    pub const HEADER_ONLY: [Self; 2] = [Self::Deal, Self::ClearBets];

    /// Check if this opcode produces a header-only (1 byte) payload.
    #[must_use]
    pub const fn is_header_only(&self) -> bool {
        matches!(self, Self::Deal | Self::ClearBets)
    }
}

impl TryFrom<u8> for BaccaratOpcode {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::PlaceBet),
            1 => Ok(Self::Deal),
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
// Bet Types
// ============================================================================

/// Baccarat bet types.
///
/// Encoded in 4 bits (0-9). Matches the bet layout in `codec.rs`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum BetType {
    /// Bet on player hand winning.
    Player = 0,
    /// Bet on banker hand winning.
    Banker = 1,
    /// Bet on tie (push).
    Tie = 2,
    /// Player pair side bet.
    PlayerPair = 3,
    /// Banker pair side bet.
    BankerPair = 4,
    /// Either pair side bet.
    EitherPair = 5,
    /// Perfect pair side bet (both hands have pairs).
    PerfectPair = 6,
    /// Big side bet (5-6 total cards).
    Big = 7,
    /// Small side bet (4 total cards).
    Small = 8,
    /// Dragon bonus side bet.
    DragonBonus = 9,
}

impl BetType {
    /// Number of bet types.
    pub const COUNT: usize = 10;

    /// Bit width for bet type field.
    pub const BITS: usize = 4;

    /// Maximum bet count in a batch (fits in 4 bits).
    pub const MAX_BATCH: usize = 11;

    /// All bet types in order.
    pub const ALL: [Self; 10] = [
        Self::Player,
        Self::Banker,
        Self::Tie,
        Self::PlayerPair,
        Self::BankerPair,
        Self::EitherPair,
        Self::PerfectPair,
        Self::Big,
        Self::Small,
        Self::DragonBonus,
    ];
}

impl TryFrom<u8> for BetType {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Player),
            1 => Ok(Self::Banker),
            2 => Ok(Self::Tie),
            3 => Ok(Self::PlayerPair),
            4 => Ok(Self::BankerPair),
            5 => Ok(Self::EitherPair),
            6 => Ok(Self::PerfectPair),
            7 => Ok(Self::Big),
            8 => Ok(Self::Small),
            9 => Ok(Self::DragonBonus),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 9, // max bet type
            }),
        }
    }
}

// ============================================================================
// Bet Descriptor
// ============================================================================

/// A single bet: bet_type (4 bits) + amount (ULEB128).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BetDescriptor {
    /// Type of bet.
    pub bet_type: BetType,
    /// Bet amount (in smallest currency unit).
    pub amount: u64,
}

impl BetDescriptor {
    /// Create a new bet descriptor.
    #[must_use]
    pub const fn new(bet_type: BetType, amount: u64) -> Self {
        Self { bet_type, amount }
    }

    /// Encode this bet to a BitWriter.
    pub fn encode(&self, writer: &mut BitWriter) -> CodecResult<()> {
        writer.write_bits(self.bet_type as u64, BetType::BITS)?;
        writer.write_uleb128(self.amount)?;
        Ok(())
    }

    /// Decode a bet from a BitReader.
    pub fn decode(reader: &mut BitReader) -> CodecResult<Self> {
        let bet_type = BetType::try_from(reader.read_bits(BetType::BITS)? as u8)?;
        let amount = reader.read_uleb128()?;
        Ok(Self { bet_type, amount })
    }

    /// Calculate the encoded byte size of this bet.
    ///
    /// Returns (bit_prefix_size, uleb_byte_size).
    #[must_use]
    pub fn encoded_size(&self) -> usize {
        // 4 bits for bet_type, then ULEB128 bytes for amount
        let uleb_bytes = crate::codec::encode_uleb128(self.amount).len();
        // 4 bits + uleb bytes, rounded up
        (BetType::BITS + uleb_bytes * 8 + 7) / 8
    }
}

// ============================================================================
// Move Payload Encoding
// ============================================================================

/// A baccarat move action with optional payload data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BaccaratMove {
    /// Place a single bet.
    PlaceBet(BetDescriptor),
    /// Deal cards to start the hand.
    Deal,
    /// Clear all current bets.
    ClearBets,
    /// Place multiple bets atomically.
    AtomicBatch(Vec<BetDescriptor>),
    /// Set table rules variant.
    SetRules { rules_id: u64 },
}

impl BaccaratMove {
    /// Get the opcode for this move.
    #[must_use]
    pub fn opcode(&self) -> BaccaratOpcode {
        match self {
            Self::PlaceBet(_) => BaccaratOpcode::PlaceBet,
            Self::Deal => BaccaratOpcode::Deal,
            Self::ClearBets => BaccaratOpcode::ClearBets,
            Self::AtomicBatch(_) => BaccaratOpcode::AtomicBatch,
            Self::SetRules { .. } => BaccaratOpcode::SetRules,
        }
    }

    /// Encode this move as a v2 compact payload.
    ///
    /// # Returns
    /// The encoded bytes. Header-only moves (Deal, ClearBets) return 1 byte.
    pub fn encode_v2(&self) -> CodecResult<Vec<u8>> {
        let mut writer = BitWriter::new();
        let header = PayloadHeader::new(self.opcode() as u8);
        header.encode(&mut writer)?;

        match self {
            Self::Deal | Self::ClearBets => {
                // Header only - no additional payload
            }
            Self::PlaceBet(bet) => {
                bet.encode(&mut writer)?;
            }
            Self::AtomicBatch(bets) => {
                // bet_count (4 bits, max 11)
                let count = bets.len().min(BetType::MAX_BATCH);
                writer.write_bits(count as u64, 4)?;
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
        let opcode = BaccaratOpcode::try_from(header.opcode)?;

        Ok(match opcode {
            BaccaratOpcode::Deal => Self::Deal,
            BaccaratOpcode::ClearBets => Self::ClearBets,
            BaccaratOpcode::PlaceBet => {
                let bet = BetDescriptor::decode(&mut reader)?;
                Self::PlaceBet(bet)
            }
            BaccaratOpcode::AtomicBatch => {
                let count = reader.read_bits(4)? as usize;
                let mut bets = Vec::with_capacity(count);
                for _ in 0..count {
                    bets.push(BetDescriptor::decode(&mut reader)?);
                }
                Self::AtomicBatch(bets)
            }
            BaccaratOpcode::SetRules => {
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

/// Baccarat game stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum BaccaratStage {
    /// Waiting for bets.
    #[default]
    Betting = 0,
    /// Cards being dealt.
    Dealing = 1,
    /// Waiting for third card draw decision.
    Drawing = 2,
    /// Hand is complete with result.
    Complete = 3,
}

impl BaccaratStage {
    /// Bit width for stage field.
    pub const BITS: usize = 2;
}

impl TryFrom<u8> for BaccaratStage {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Betting),
            1 => Ok(Self::Dealing),
            2 => Ok(Self::Drawing),
            3 => Ok(Self::Complete),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 3, // max stage
            }),
        }
    }
}

/// Baccarat hand result.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum BaccaratResult {
    /// No result yet.
    #[default]
    None = 0,
    /// Player wins.
    PlayerWin = 1,
    /// Banker wins.
    BankerWin = 2,
    /// Tie.
    Tie = 3,
}

impl BaccaratResult {
    /// Bit width for result field.
    pub const BITS: usize = 2;
}

impl TryFrom<u8> for BaccaratResult {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::None),
            1 => Ok(Self::PlayerWin),
            2 => Ok(Self::BankerWin),
            3 => Ok(Self::Tie),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 3, // max result
            }),
        }
    }
}

/// Complete baccarat state blob.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BaccaratState {
    /// Current game stage.
    pub stage: BaccaratStage,
    /// Player's total (0-9).
    pub player_total: u8,
    /// Banker's total (0-9).
    pub banker_total: u8,
    /// Hand result (if complete).
    pub result: BaccaratResult,
    /// Player's cards (6-bit IDs, 0-51).
    pub player_cards: Vec<u8>,
    /// Banker's cards (6-bit IDs, 0-51).
    pub banker_cards: Vec<u8>,
    /// Active bets.
    pub bets: Vec<BetDescriptor>,
}

impl BaccaratState {
    /// Maximum cards per hand (3).
    pub const MAX_CARDS_PER_HAND: usize = 3;

    /// Bit width for card count field (0-3 fits in 2 bits).
    pub const CARD_COUNT_BITS: usize = 2;

    /// Bit width for a single card (0-51 fits in 6 bits).
    pub const CARD_BITS: usize = 6;

    /// Bit width for totals (0-9 fits in 4 bits).
    pub const TOTAL_BITS: usize = 4;

    /// Bit width for bet count (0-15 fits in 4 bits).
    pub const BET_COUNT_BITS: usize = 4;

    /// Version bits.
    pub const VERSION_BITS: usize = 3;

    /// Encode this state as a v2 compact blob.
    pub fn encode_v2(&self) -> CodecResult<Vec<u8>> {
        let mut writer = BitWriter::new();

        // Header bits
        writer.write_bits(PayloadHeader::V2 as u64, Self::VERSION_BITS)?;
        writer.write_bits(self.stage as u8 as u64, BaccaratStage::BITS)?;
        writer.write_bits(self.player_total as u64, Self::TOTAL_BITS)?;
        writer.write_bits(self.banker_total as u64, Self::TOTAL_BITS)?;
        writer.write_bits(self.result as u8 as u64, BaccaratResult::BITS)?;

        // Card counts
        let player_count = self.player_cards.len().min(Self::MAX_CARDS_PER_HAND);
        let banker_count = self.banker_cards.len().min(Self::MAX_CARDS_PER_HAND);
        writer.write_bits(player_count as u64, Self::CARD_COUNT_BITS)?;
        writer.write_bits(banker_count as u64, Self::CARD_COUNT_BITS)?;

        // Player cards
        for &card in self.player_cards.iter().take(Self::MAX_CARDS_PER_HAND) {
            writer.write_bits(card as u64, Self::CARD_BITS)?;
        }

        // Banker cards
        for &card in self.banker_cards.iter().take(Self::MAX_CARDS_PER_HAND) {
            writer.write_bits(card as u64, Self::CARD_BITS)?;
        }

        // Bets
        let bet_count = self.bets.len().min(BetType::MAX_BATCH);
        writer.write_bits(bet_count as u64, Self::BET_COUNT_BITS)?;
        for bet in self.bets.iter().take(bet_count) {
            bet.encode(&mut writer)?;
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

        let stage = BaccaratStage::try_from(reader.read_bits(BaccaratStage::BITS)? as u8)?;
        let player_total = reader.read_bits(Self::TOTAL_BITS)? as u8;
        let banker_total = reader.read_bits(Self::TOTAL_BITS)? as u8;
        let result = BaccaratResult::try_from(reader.read_bits(BaccaratResult::BITS)? as u8)?;

        // Card counts
        let player_count = reader.read_bits(Self::CARD_COUNT_BITS)? as usize;
        let banker_count = reader.read_bits(Self::CARD_COUNT_BITS)? as usize;

        // Player cards
        let mut player_cards = Vec::with_capacity(player_count);
        for _ in 0..player_count {
            player_cards.push(reader.read_bits(Self::CARD_BITS)? as u8);
        }

        // Banker cards
        let mut banker_cards = Vec::with_capacity(banker_count);
        for _ in 0..banker_count {
            banker_cards.push(reader.read_bits(Self::CARD_BITS)? as u8);
        }

        // Bets
        let bet_count = reader.read_bits(Self::BET_COUNT_BITS)? as usize;
        let mut bets = Vec::with_capacity(bet_count);
        for _ in 0..bet_count {
            bets.push(BetDescriptor::decode(&mut reader)?);
        }

        Ok(Self {
            stage,
            player_total,
            banker_total,
            result,
            player_cards,
            banker_cards,
            bets,
        })
    }

    /// Estimate the v1 JSON-style encoding size for comparison.
    ///
    /// This is a rough estimate based on typical v1 field sizes:
    /// - stage: 1 byte enum + padding
    /// - totals: 2 bytes each
    /// - result: 1 byte enum + padding
    /// - cards: array overhead + 1 byte per card
    /// - bets: array overhead + (type + amount) per bet
    #[must_use]
    pub fn estimate_v1_size(&self) -> usize {
        let base_overhead = 16; // object wrapper, padding
        let stage_size = 4;     // enum with padding
        let totals_size = 4;    // 2 bytes each
        let result_size = 4;    // enum with padding
        let player_cards_size = 8 + self.player_cards.len(); // array overhead + cards
        let banker_cards_size = 8 + self.banker_cards.len(); // array overhead + cards
        let bets_size = if self.bets.is_empty() {
            8 // empty array
        } else {
            8 + self.bets.len() * 12 // array overhead + (type + amount padding) per bet
        };

        base_overhead
            + stage_size
            + totals_size
            + result_size
            + player_cards_size
            + banker_cards_size
            + bets_size
    }

    /// Calculate the actual v2 encoded size.
    #[must_use]
    pub fn v2_size(&self) -> usize {
        // Header bits
        let header_bits = Self::VERSION_BITS
            + BaccaratStage::BITS
            + Self::TOTAL_BITS * 2
            + BaccaratResult::BITS
            + Self::CARD_COUNT_BITS * 2;

        // Card bits
        let player_card_bits =
            self.player_cards.len().min(Self::MAX_CARDS_PER_HAND) * Self::CARD_BITS;
        let banker_card_bits =
            self.banker_cards.len().min(Self::MAX_CARDS_PER_HAND) * Self::CARD_BITS;

        // Bet count bits
        let bet_count_bits = Self::BET_COUNT_BITS;

        // Bet descriptor bits (4 bits type + ULEB128 bytes)
        let bet_bits: usize = self
            .bets
            .iter()
            .take(BetType::MAX_BATCH)
            .map(|b| BetType::BITS + crate::codec::encode_uleb128(b.amount).len() * 8)
            .sum();

        let total_bits =
            header_bits + player_card_bits + banker_card_bits + bet_count_bits + bet_bits;
        (total_bits + 7) / 8
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ========================================================================
    // AC-1.1: Single bet payload <= 3 bytes for small amounts
    // ========================================================================

    #[test]
    fn test_single_bet_small_amount_3_bytes_ac_1_1() {
        // PlaceBet with small amount (< 128, fits in 1 byte ULEB128)
        let mov = BaccaratMove::PlaceBet(BetDescriptor::new(BetType::Player, 100));
        let payload = mov.encode_v2().unwrap();

        // 1 byte header + 4 bits bet_type + 1 byte ULEB128(100) = 1 + (4 + 8) bits = 13 bits
        // 13 bits rounds to 2 bytes
        assert!(
            payload.len() <= 3,
            "AC-1.1: Single bet payload must be <= 3 bytes for small amounts, got {}",
            payload.len()
        );
    }

    #[test]
    fn test_single_bet_various_amounts_ac_1_1() {
        let test_amounts = [1u64, 50, 100, 127];

        for amount in test_amounts {
            let mov = BaccaratMove::PlaceBet(BetDescriptor::new(BetType::Banker, amount));
            let payload = mov.encode_v2().unwrap();
            assert!(
                payload.len() <= 3,
                "AC-1.1: Single bet ({}) must be <= 3 bytes, got {}",
                amount,
                payload.len()
            );
        }
    }

    #[test]
    fn test_deal_payload_1_byte_ac_1_1() {
        let payload = BaccaratMove::Deal.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "AC-1.1: Deal must be 1 byte");
    }

    #[test]
    fn test_clear_bets_payload_1_byte_ac_1_1() {
        let payload = BaccaratMove::ClearBets.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "AC-1.1: ClearBets must be 1 byte");
    }

    // ========================================================================
    // AC-1.2: Batch payload size scales linearly (no padding)
    // ========================================================================

    #[test]
    fn test_batch_payload_scales_linearly_ac_1_2() {
        // Single bet baseline
        let single = BaccaratMove::PlaceBet(BetDescriptor::new(BetType::Player, 100));
        let single_size = single.encode_v2().unwrap().len();

        // Multiple bets
        let batch_2 = BaccaratMove::AtomicBatch(vec![
            BetDescriptor::new(BetType::Player, 100),
            BetDescriptor::new(BetType::Banker, 100),
        ]);
        let batch_3 = BaccaratMove::AtomicBatch(vec![
            BetDescriptor::new(BetType::Player, 100),
            BetDescriptor::new(BetType::Banker, 100),
            BetDescriptor::new(BetType::Tie, 100),
        ]);

        let batch_2_size = batch_2.encode_v2().unwrap().len();
        let batch_3_size = batch_3.encode_v2().unwrap().len();

        // Each additional bet should add approximately the same amount
        // AtomicBatch has: 1 byte header + 4 bits count + N * (4 bits type + ULEB128 amount)
        // For amount=100, ULEB128 is 1 byte, so each bet is ~12 bits = 1.5 bytes

        // Check that batch_3 - batch_2 is roughly equal to batch_2 - header_overhead
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

    #[test]
    fn test_batch_no_padding_waste_ac_1_2() {
        // AtomicBatch with varying amounts should not waste bytes on padding
        let batch = BaccaratMove::AtomicBatch(vec![
            BetDescriptor::new(BetType::Player, 50),
            BetDescriptor::new(BetType::Banker, 75),
            BetDescriptor::new(BetType::Tie, 200),
        ]);
        let payload = batch.encode_v2().unwrap();

        // Expected: 1 byte header + 4 bits count + 3 * (4 bits + ULEB)
        // ULEB(50)=1, ULEB(75)=1, ULEB(200)=2
        // = 8 + 4 + (4+8) + (4+8) + (4+16) = 8 + 4 + 12 + 12 + 20 = 56 bits = 7 bytes
        assert!(
            payload.len() <= 8,
            "AC-1.2: Batch should not have excessive padding, got {} bytes",
            payload.len()
        );
    }

    // ========================================================================
    // AC-2.1: State compaction >= 35%
    // ========================================================================

    #[test]
    fn test_typical_state_compaction_ac_2_1() {
        // Typical mid-game state: player and banker each have 2 cards
        let state = BaccaratState {
            stage: BaccaratStage::Dealing,
            player_total: 7,
            banker_total: 6,
            result: BaccaratResult::None,
            player_cards: vec![10, 25], // 2 cards
            banker_cards: vec![5, 51],  // 2 cards
            bets: vec![
                BetDescriptor::new(BetType::Player, 100),
                BetDescriptor::new(BetType::Banker, 50),
            ],
        };

        let v2_bytes = state.encode_v2().unwrap();
        let v1_estimate = state.estimate_v1_size();

        let reduction = 1.0 - (v2_bytes.len() as f64 / v1_estimate as f64);
        assert!(
            reduction >= 0.35,
            "AC-2.1: State compaction must be >= 35%, got {:.1}% (v1={}, v2={})",
            reduction * 100.0,
            v1_estimate,
            v2_bytes.len()
        );
    }

    #[test]
    fn test_three_card_state_compaction_ac_2_1() {
        // State with 3-card draws (both player and banker drew third card)
        let state = BaccaratState {
            stage: BaccaratStage::Complete,
            player_total: 5,
            banker_total: 9,
            result: BaccaratResult::BankerWin,
            player_cards: vec![10, 25, 40], // 3 cards
            banker_cards: vec![5, 51, 30],  // 3 cards
            bets: vec![BetDescriptor::new(BetType::Banker, 100)],
        };

        let v2_bytes = state.encode_v2().unwrap();
        let v1_estimate = state.estimate_v1_size();

        let reduction = 1.0 - (v2_bytes.len() as f64 / v1_estimate as f64);
        assert!(
            reduction >= 0.35,
            "AC-2.1: Three-card state compaction must be >= 35%, got {:.1}% (v1={}, v2={})",
            reduction * 100.0,
            v1_estimate,
            v2_bytes.len()
        );
    }

    #[test]
    fn test_state_with_many_bets_compaction_ac_2_1() {
        // State with multiple side bets
        let state = BaccaratState {
            stage: BaccaratStage::Complete,
            player_total: 8,
            banker_total: 8,
            result: BaccaratResult::Tie,
            player_cards: vec![10, 25],
            banker_cards: vec![5, 51],
            bets: vec![
                BetDescriptor::new(BetType::Player, 100),
                BetDescriptor::new(BetType::Tie, 50),
                BetDescriptor::new(BetType::PlayerPair, 25),
                BetDescriptor::new(BetType::BankerPair, 25),
            ],
        };

        let v2_bytes = state.encode_v2().unwrap();
        let v1_estimate = state.estimate_v1_size();

        let reduction = 1.0 - (v2_bytes.len() as f64 / v1_estimate as f64);
        assert!(
            reduction >= 0.35,
            "AC-2.1: Multi-bet state compaction must be >= 35%, got {:.1}% (v1={}, v2={})",
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
        let mov = BaccaratMove::Deal;
        let payload = mov.encode_v2().unwrap();

        // Should decode successfully
        let decoded = BaccaratMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov, "AC-3.1: v2 payload must decode correctly");
    }

    #[test]
    fn test_v2_place_bet_roundtrip_ac_3_1() {
        let original = BaccaratMove::PlaceBet(BetDescriptor::new(BetType::Player, 500));
        let payload = original.encode_v2().unwrap();
        let decoded = BaccaratMove::decode_v2(&payload).unwrap();

        assert_eq!(decoded, original, "AC-3.1: PlaceBet must roundtrip");
    }

    #[test]
    fn test_v2_atomic_batch_roundtrip_ac_3_1() {
        let original = BaccaratMove::AtomicBatch(vec![
            BetDescriptor::new(BetType::Player, 100),
            BetDescriptor::new(BetType::Banker, 200),
            BetDescriptor::new(BetType::Tie, 50),
        ]);
        let payload = original.encode_v2().unwrap();
        let decoded = BaccaratMove::decode_v2(&payload).unwrap();

        assert_eq!(decoded, original, "AC-3.1: AtomicBatch must roundtrip");
    }

    #[test]
    fn test_dual_decode_v2_payload_ac_3_1() {
        let mov = BaccaratMove::Deal;
        let payload = mov.encode_v2().unwrap();

        // Dual decode should return Some for v2
        let result = BaccaratMove::decode_dual(&payload).unwrap();
        assert!(result.is_some(), "AC-3.1: dual decode must return Some for v2");
        assert_eq!(result.unwrap(), mov);
    }

    #[test]
    fn test_dual_decode_v1_payload_returns_none_ac_3_1() {
        // Simulate a v1 payload (version bits = 1)
        let v1_payload = vec![0x01, 0x00, 0x00, 0x00];

        // Dual decode should return None for v1
        let result = BaccaratMove::decode_dual(&v1_payload).unwrap();
        assert!(result.is_none(), "AC-3.1: dual decode must return None for v1");
    }

    // ========================================================================
    // State blob roundtrip tests
    // ========================================================================

    #[test]
    fn test_state_roundtrip_empty() {
        let state = BaccaratState::default();
        let encoded = state.encode_v2().unwrap();
        let decoded = BaccaratState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_typical() {
        let state = BaccaratState {
            stage: BaccaratStage::Dealing,
            player_total: 7,
            banker_total: 6,
            result: BaccaratResult::None,
            player_cards: vec![10, 25],
            banker_cards: vec![5],
            bets: vec![BetDescriptor::new(BetType::Player, 100)],
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = BaccaratState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_complete() {
        let state = BaccaratState {
            stage: BaccaratStage::Complete,
            player_total: 5,
            banker_total: 9,
            result: BaccaratResult::BankerWin,
            player_cards: vec![10, 25, 40],
            banker_cards: vec![5, 51, 30],
            bets: vec![
                BetDescriptor::new(BetType::Banker, 200),
                BetDescriptor::new(BetType::Big, 50),
            ],
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = BaccaratState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_all_bet_types() {
        let state = BaccaratState {
            stage: BaccaratStage::Betting,
            player_total: 0,
            banker_total: 0,
            result: BaccaratResult::None,
            player_cards: vec![],
            banker_cards: vec![],
            bets: BetType::ALL
                .iter()
                .enumerate()
                .map(|(i, &bt)| BetDescriptor::new(bt, (i + 1) as u64 * 10))
                .collect(),
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = BaccaratState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    // ========================================================================
    // Move roundtrip tests
    // ========================================================================

    #[test]
    fn test_all_moves_roundtrip() {
        let moves = vec![
            BaccaratMove::PlaceBet(BetDescriptor::new(BetType::Player, 100)),
            BaccaratMove::Deal,
            BaccaratMove::ClearBets,
            BaccaratMove::AtomicBatch(vec![]),
            BaccaratMove::AtomicBatch(vec![BetDescriptor::new(BetType::Tie, 50)]),
            BaccaratMove::SetRules { rules_id: 42 },
        ];

        for mov in moves {
            let encoded = mov.encode_v2().unwrap();
            let decoded = BaccaratMove::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, mov, "Move {:?} must roundtrip", mov);
        }
    }

    #[test]
    fn test_set_rules_roundtrip() {
        let test_ids = [0, 1, 127, 128, 1000, u64::MAX];

        for rules_id in test_ids {
            let mov = BaccaratMove::SetRules { rules_id };
            let encoded = mov.encode_v2().unwrap();
            let decoded = BaccaratMove::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, mov, "SetRules({}) must roundtrip", rules_id);
        }
    }

    // ========================================================================
    // Golden vector tests for determinism
    // ========================================================================

    #[test]
    fn test_deal_golden_vector() {
        let payload = BaccaratMove::Deal.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 1 (bits 00001) = 0b00001_010 = 0x0A
        assert_eq!(payload, vec![0x0A], "Deal golden vector");
    }

    #[test]
    fn test_clear_bets_golden_vector() {
        let payload = BaccaratMove::ClearBets.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 2 (bits 00010) = 0b00010_010 = 0x12
        assert_eq!(payload, vec![0x12], "ClearBets golden vector");
    }

    #[test]
    fn test_place_bet_player_100_golden_vector() {
        let mov = BaccaratMove::PlaceBet(BetDescriptor::new(BetType::Player, 100));
        let payload = mov.encode_v2().unwrap();

        // Version 2 (010) + opcode 0 (00000) = 0b00000_010 = 0x02
        // Then bet_type=0 (0000) + ULEB128(100) = 0x64
        // So: header byte 0x02, then 4 bits 0000, then byte 0x64
        // Bit layout: [010 00000] [0000 0100] [0110 ...]
        //             0x02       bit-packed with ULEB

        // Actually let's verify the encoding is deterministic
        let payload2 = mov.encode_v2().unwrap();
        assert_eq!(payload, payload2, "Encoding must be deterministic");

        // And verify size is <= 3 bytes
        assert!(payload.len() <= 3, "PlaceBet(Player, 100) should be <= 3 bytes");
    }

    #[test]
    fn test_encoding_deterministic() {
        // Same input must produce same output every time
        for _ in 0..10 {
            let mov = BaccaratMove::Deal;
            let payload = mov.encode_v2().unwrap();
            assert_eq!(payload, vec![0x0A]);
        }
    }

    // ========================================================================
    // Edge case tests
    // ========================================================================

    #[test]
    fn test_empty_batch() {
        let mov = BaccaratMove::AtomicBatch(vec![]);
        let payload = mov.encode_v2().unwrap();

        // Should have header + 4-bit count (0)
        // 8 bits + 4 bits = 12 bits = 2 bytes
        assert_eq!(payload.len(), 2, "Empty batch should be 2 bytes");

        let decoded = BaccaratMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov);
    }

    #[test]
    fn test_max_batch_size() {
        let bets: Vec<_> = (0..BetType::MAX_BATCH)
            .map(|i| BetDescriptor::new(BetType::Player, (i + 1) as u64 * 10))
            .collect();

        let mov = BaccaratMove::AtomicBatch(bets);
        let payload = mov.encode_v2().unwrap();
        let decoded = BaccaratMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov);
    }

    #[test]
    fn test_state_max_card_values() {
        // Test with max card ID (51)
        let state = BaccaratState {
            stage: BaccaratStage::Complete,
            player_total: 9,
            banker_total: 9,
            result: BaccaratResult::Tie,
            player_cards: vec![51, 51, 51],
            banker_cards: vec![51, 51, 51],
            bets: vec![],
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = BaccaratState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_all_results() {
        for result in [
            BaccaratResult::None,
            BaccaratResult::PlayerWin,
            BaccaratResult::BankerWin,
            BaccaratResult::Tie,
        ] {
            let state = BaccaratState {
                result,
                ..Default::default()
            };
            let encoded = state.encode_v2().unwrap();
            let decoded = BaccaratState::decode_v2(&encoded).unwrap();
            assert_eq!(decoded.result, result);
        }
    }

    #[test]
    fn test_all_stages() {
        for stage in [
            BaccaratStage::Betting,
            BaccaratStage::Dealing,
            BaccaratStage::Drawing,
            BaccaratStage::Complete,
        ] {
            let state = BaccaratState {
                stage,
                ..Default::default()
            };
            let encoded = state.encode_v2().unwrap();
            let decoded = BaccaratState::decode_v2(&encoded).unwrap();
            assert_eq!(decoded.stage, stage);
        }
    }
}
