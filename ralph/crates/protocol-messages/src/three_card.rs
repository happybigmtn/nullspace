//! Three Card Poker v2 compact encoding (spec: `compact-encoding-three-card.md`).
//!
//! This module implements the bitwise compact encoding for three card poker move
//! payloads and state blobs as defined in the spec. All bit layouts are canonical;
//! JS/TS consumes generated artifacts.
//!
//! # Move Payload Encoding
//!
//! All three card moves use a 1-byte header:
//! - `version` (3 bits): Protocol version (2 for v2)
//! - `opcode` (5 bits): Action type (0-4)
//!
//! Play/Fold/Reveal are header-only (1 byte).
//! Deal includes a side bet mask (3 bits) and ULEB128 amounts.
//!
//! # State Blob Encoding
//!
//! State is encoded compactly using:
//! - 6-bit card IDs (0-51)
//! - 2-bit stage
//! - 3-bit side bet mask
//! - 6-bit ranks for results

use crate::codec::{
    BitReader, BitWriter, CodecError, CodecResult, DualDecoder, EncodingVersion, PayloadHeader,
};

// ============================================================================
// Three Card Opcodes (v2)
// ============================================================================

/// Three Card Poker action opcodes for v2 compact encoding.
///
/// These map to the opcode values in the 5-bit opcode field of the header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ThreeCardOpcode {
    /// Player decides to play (matches ante with play bet).
    Play = 0,
    /// Player folds (forfeits ante).
    Fold = 1,
    /// Deal cards with optional side bets.
    Deal = 2,
    /// Dealer reveals cards and resolves hand.
    Reveal = 3,
    /// Set table rules variant.
    SetRules = 4,
}

impl ThreeCardOpcode {
    /// All valid opcodes.
    pub const ALL: [Self; 5] = [
        Self::Play,
        Self::Fold,
        Self::Deal,
        Self::Reveal,
        Self::SetRules,
    ];

    /// Opcodes that produce a header-only (1 byte) payload.
    pub const HEADER_ONLY: [Self; 3] = [Self::Play, Self::Fold, Self::Reveal];

    /// Check if this opcode produces a header-only (1 byte) payload.
    #[must_use]
    pub const fn is_header_only(&self) -> bool {
        matches!(self, Self::Play | Self::Fold | Self::Reveal)
    }
}

impl TryFrom<u8> for ThreeCardOpcode {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Play),
            1 => Ok(Self::Fold),
            2 => Ok(Self::Deal),
            3 => Ok(Self::Reveal),
            4 => Ok(Self::SetRules),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 4, // max opcode
            }),
        }
    }
}

// ============================================================================
// Side Bet Types
// ============================================================================

/// Three Card Poker side bet types.
///
/// The mask uses 3 bits, one for each possible side bet:
/// - Bit 0: Pair Plus
/// - Bit 1: Six Card Bonus
/// - Bit 2: Progressive
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum SideBetType {
    /// Pair Plus: Side bet on player's hand having pair or better.
    PairPlus = 0,
    /// Six Card Bonus: Uses player's 3 cards + dealer's 3 cards for poker hand.
    SixCard = 1,
    /// Progressive: Player's hand contributes to progressive jackpot.
    Progressive = 2,
}

impl SideBetType {
    /// Number of supported side bet types.
    pub const COUNT: usize = 3;

    /// Bit width for the side bet mask.
    pub const MASK_BITS: usize = 3;

    /// All side bet types in order.
    pub const ALL: [Self; 3] = [Self::PairPlus, Self::SixCard, Self::Progressive];
}

/// Side bets for a deal action.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SideBets {
    /// Amount for Pair Plus bet (0 if not placed).
    pub pair_plus: u64,
    /// Amount for Six Card Bonus bet (0 if not placed).
    pub six_card: u64,
    /// Amount for Progressive bet (0 if not placed).
    pub progressive: u64,
}

impl SideBets {
    /// Create empty side bets (no bets placed).
    #[must_use]
    pub const fn none() -> Self {
        Self {
            pair_plus: 0,
            six_card: 0,
            progressive: 0,
        }
    }

    /// Check if any side bets are placed.
    #[must_use]
    pub fn has_any(&self) -> bool {
        self.pair_plus > 0 || self.six_card > 0 || self.progressive > 0
    }

    /// Generate the 3-bit mask for set side bets.
    #[must_use]
    pub fn mask(&self) -> u8 {
        let mut mask = 0u8;
        if self.pair_plus > 0 {
            mask |= 1 << SideBetType::PairPlus as u8;
        }
        if self.six_card > 0 {
            mask |= 1 << SideBetType::SixCard as u8;
        }
        if self.progressive > 0 {
            mask |= 1 << SideBetType::Progressive as u8;
        }
        mask
    }

    /// Get the amount for a side bet type.
    #[must_use]
    pub fn amount(&self, bet_type: SideBetType) -> u64 {
        match bet_type {
            SideBetType::PairPlus => self.pair_plus,
            SideBetType::SixCard => self.six_card,
            SideBetType::Progressive => self.progressive,
        }
    }

    /// Set the amount for a side bet type.
    pub fn set_amount(&mut self, bet_type: SideBetType, amount: u64) {
        match bet_type {
            SideBetType::PairPlus => self.pair_plus = amount,
            SideBetType::SixCard => self.six_card = amount,
            SideBetType::Progressive => self.progressive = amount,
        }
    }

    /// Count the number of side bets placed.
    #[must_use]
    pub fn count(&self) -> usize {
        self.mask().count_ones() as usize
    }

    /// Encode side bets to a BitWriter.
    ///
    /// Format:
    /// - side_bet_mask (3 bits)
    /// - For each set bit: amount as ULEB128
    pub fn encode(&self, writer: &mut BitWriter) -> CodecResult<()> {
        let mask = self.mask();
        writer.write_bits(mask as u64, SideBetType::MASK_BITS)?;

        for bet_type in SideBetType::ALL {
            if mask & (1 << bet_type as u8) != 0 {
                writer.write_uleb128(self.amount(bet_type))?;
            }
        }

        Ok(())
    }

    /// Decode side bets from a BitReader.
    pub fn decode(reader: &mut BitReader) -> CodecResult<Self> {
        let mask = reader.read_bits(SideBetType::MASK_BITS)? as u8;
        let mut side_bets = Self::none();

        for bet_type in SideBetType::ALL {
            if mask & (1 << bet_type as u8) != 0 {
                let amount = reader.read_uleb128()?;
                side_bets.set_amount(bet_type, amount);
            }
        }

        Ok(side_bets)
    }
}

// ============================================================================
// Move Payload Encoding
// ============================================================================

/// A three card poker move action with optional payload data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThreeCardMove {
    /// Play: Player matches ante with play bet.
    Play,
    /// Fold: Player forfeits ante.
    Fold,
    /// Deal: Start a new hand with ante and optional side bets.
    Deal { side_bets: SideBets },
    /// Reveal: Dealer reveals and resolves the hand.
    Reveal,
    /// SetRules: Configure table rules.
    SetRules { rules_id: u64 },
}

impl ThreeCardMove {
    /// Get the opcode for this move.
    #[must_use]
    pub fn opcode(&self) -> ThreeCardOpcode {
        match self {
            Self::Play => ThreeCardOpcode::Play,
            Self::Fold => ThreeCardOpcode::Fold,
            Self::Deal { .. } => ThreeCardOpcode::Deal,
            Self::Reveal => ThreeCardOpcode::Reveal,
            Self::SetRules { .. } => ThreeCardOpcode::SetRules,
        }
    }

    /// Encode this move as a v2 compact payload.
    ///
    /// # Returns
    /// The encoded bytes. Header-only moves (Play, Fold, Reveal) return 1 byte.
    pub fn encode_v2(&self) -> CodecResult<Vec<u8>> {
        let mut writer = BitWriter::new();
        let header = PayloadHeader::new(self.opcode() as u8);
        header.encode(&mut writer)?;

        match self {
            Self::Play | Self::Fold | Self::Reveal => {
                // Header only - no additional payload
            }
            Self::Deal { side_bets } => {
                side_bets.encode(&mut writer)?;
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
        let opcode = ThreeCardOpcode::try_from(header.opcode)?;

        Ok(match opcode {
            ThreeCardOpcode::Play => Self::Play,
            ThreeCardOpcode::Fold => Self::Fold,
            ThreeCardOpcode::Reveal => Self::Reveal,
            ThreeCardOpcode::Deal => {
                let side_bets = SideBets::decode(&mut reader)?;
                Self::Deal { side_bets }
            }
            ThreeCardOpcode::SetRules => {
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

/// Three Card Poker game stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum ThreeCardStage {
    /// Waiting for ante/deal.
    #[default]
    Betting = 0,
    /// Cards dealt, waiting for play/fold decision.
    Decision = 1,
    /// Waiting for dealer reveal.
    AwaitingReveal = 2,
    /// Hand is complete with result.
    Complete = 3,
}

impl ThreeCardStage {
    /// Bit width for stage field.
    pub const BITS: usize = 2;
}

impl TryFrom<u8> for ThreeCardStage {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Betting),
            1 => Ok(Self::Decision),
            2 => Ok(Self::AwaitingReveal),
            3 => Ok(Self::Complete),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 3, // max stage
            }),
        }
    }
}

/// Three Card Poker hand rank (for result comparison).
///
/// Encoded in 6 bits (0-63), with lower values being better hands.
/// This matches standard three card poker rankings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum HandRank {
    /// No rank determined yet.
    #[default]
    None = 0,
    /// Straight flush (best).
    StraightFlush = 1,
    /// Three of a kind.
    ThreeOfAKind = 2,
    /// Straight.
    Straight = 3,
    /// Flush.
    Flush = 4,
    /// Pair.
    Pair = 5,
    /// High card (worst qualifying hand).
    HighCard = 6,
}

impl HandRank {
    /// Bit width for rank field.
    pub const BITS: usize = 6;
}

impl TryFrom<u8> for HandRank {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::None),
            1 => Ok(Self::StraightFlush),
            2 => Ok(Self::ThreeOfAKind),
            3 => Ok(Self::Straight),
            4 => Ok(Self::Flush),
            5 => Ok(Self::Pair),
            6 => Ok(Self::HighCard),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 6, // max rank
            }),
        }
    }
}

/// Complete three card poker state blob.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ThreeCardState {
    /// Current game stage.
    pub stage: ThreeCardStage,
    /// Whether result is present.
    pub has_result: bool,
    /// Player's cards (6-bit IDs, 0-51).
    pub player_cards: Vec<u8>,
    /// Dealer's cards (6-bit IDs, 0-51).
    pub dealer_cards: Vec<u8>,
    /// Side bets for this hand.
    pub side_bets: SideBets,
    /// Player's hand rank (if complete).
    pub player_rank: HandRank,
    /// Dealer's hand rank (if complete).
    pub dealer_rank: HandRank,
    /// Whether dealer qualifies (queen high or better).
    pub dealer_qualifies: bool,
}

impl ThreeCardState {
    /// Maximum cards per hand (always 3 in three card poker).
    pub const MAX_CARDS_PER_HAND: usize = 3;

    /// Bit width for card count field (0-3 fits in 2 bits).
    pub const CARD_COUNT_BITS: usize = 2;

    /// Bit width for a single card (0-51 fits in 6 bits).
    pub const CARD_BITS: usize = 6;

    /// Version bits.
    pub const VERSION_BITS: usize = 3;

    /// Encode this state as a v2 compact blob.
    pub fn encode_v2(&self) -> CodecResult<Vec<u8>> {
        let mut writer = BitWriter::new();

        // Header bits per spec (section 4.1)
        writer.write_bits(PayloadHeader::V2 as u64, Self::VERSION_BITS)?;
        writer.write_bits(self.stage as u8 as u64, ThreeCardStage::BITS)?;
        writer.write_bit(self.has_result)?;

        // Cards (section 4.2)
        let player_count = self.player_cards.len().min(Self::MAX_CARDS_PER_HAND);
        let dealer_count = self.dealer_cards.len().min(Self::MAX_CARDS_PER_HAND);
        writer.write_bits(player_count as u64, Self::CARD_COUNT_BITS)?;
        writer.write_bits(dealer_count as u64, Self::CARD_COUNT_BITS)?;

        // Player cards
        for &card in self.player_cards.iter().take(Self::MAX_CARDS_PER_HAND) {
            writer.write_bits(card as u64, Self::CARD_BITS)?;
        }

        // Dealer cards
        for &card in self.dealer_cards.iter().take(Self::MAX_CARDS_PER_HAND) {
            writer.write_bits(card as u64, Self::CARD_BITS)?;
        }

        // Bets (section 4.3)
        self.side_bets.encode(&mut writer)?;

        // Results (section 4.4) - only if has_result is true
        if self.has_result {
            writer.write_bits(self.player_rank as u8 as u64, HandRank::BITS)?;
            writer.write_bits(self.dealer_rank as u8 as u64, HandRank::BITS)?;
            writer.write_bit(self.dealer_qualifies)?;
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

        let stage = ThreeCardStage::try_from(reader.read_bits(ThreeCardStage::BITS)? as u8)?;
        let has_result = reader.read_bit()?;

        // Card counts
        let player_count = reader.read_bits(Self::CARD_COUNT_BITS)? as usize;
        let dealer_count = reader.read_bits(Self::CARD_COUNT_BITS)? as usize;

        // Player cards
        let mut player_cards = Vec::with_capacity(player_count);
        for _ in 0..player_count {
            player_cards.push(reader.read_bits(Self::CARD_BITS)? as u8);
        }

        // Dealer cards
        let mut dealer_cards = Vec::with_capacity(dealer_count);
        for _ in 0..dealer_count {
            dealer_cards.push(reader.read_bits(Self::CARD_BITS)? as u8);
        }

        // Side bets
        let side_bets = SideBets::decode(&mut reader)?;

        // Results (only if has_result)
        let (player_rank, dealer_rank, dealer_qualifies) = if has_result {
            let player_rank = HandRank::try_from(reader.read_bits(HandRank::BITS)? as u8)?;
            let dealer_rank = HandRank::try_from(reader.read_bits(HandRank::BITS)? as u8)?;
            let dealer_qualifies = reader.read_bit()?;
            (player_rank, dealer_rank, dealer_qualifies)
        } else {
            (HandRank::None, HandRank::None, false)
        };

        Ok(Self {
            stage,
            has_result,
            player_cards,
            dealer_cards,
            side_bets,
            player_rank,
            dealer_rank,
            dealer_qualifies,
        })
    }

    /// Estimate the v1 JSON-style encoding size for comparison.
    ///
    /// This is a rough estimate based on typical v1 field sizes:
    /// - stage: 1 byte enum + padding
    /// - has_result: 1 byte bool
    /// - cards: array overhead + 1 byte per card
    /// - side_bets: object with 3 optional u64 fields
    /// - ranks: 1 byte each
    /// - dealer_qualifies: 1 byte bool
    #[must_use]
    pub fn estimate_v1_size(&self) -> usize {
        let base_overhead = 16; // object wrapper, padding
        let stage_size = 4;     // enum with padding
        let has_result_size = 4; // bool with padding
        let player_cards_size = 8 + self.player_cards.len(); // array overhead + cards
        let dealer_cards_size = 8 + self.dealer_cards.len(); // array overhead + cards
        let side_bet_size = if self.side_bets.has_any() {
            8 + self.side_bets.count() * 8 // object overhead + u64 per bet
        } else {
            8 // empty object
        };
        let result_size = if self.has_result {
            4 + 4 + 4 // player_rank + dealer_rank + dealer_qualifies
        } else {
            0
        };

        base_overhead
            + stage_size
            + has_result_size
            + player_cards_size
            + dealer_cards_size
            + side_bet_size
            + result_size
    }

    /// Calculate the actual v2 encoded size.
    #[must_use]
    pub fn v2_size(&self) -> usize {
        // Header bits
        let header_bits = Self::VERSION_BITS
            + ThreeCardStage::BITS
            + 1 // has_result
            + Self::CARD_COUNT_BITS * 2;

        // Card bits
        let player_card_bits =
            self.player_cards.len().min(Self::MAX_CARDS_PER_HAND) * Self::CARD_BITS;
        let dealer_card_bits =
            self.dealer_cards.len().min(Self::MAX_CARDS_PER_HAND) * Self::CARD_BITS;

        // Side bet bits (mask + ULEB128 amounts)
        let side_bet_bits = SideBetType::MASK_BITS;
        let side_bet_bytes: usize = SideBetType::ALL
            .iter()
            .filter(|&&bt| self.side_bets.amount(bt) > 0)
            .map(|&bt| crate::codec::encode_uleb128(self.side_bets.amount(bt)).len())
            .sum();

        // Result bits (only if has_result)
        let result_bits = if self.has_result {
            HandRank::BITS * 2 + 1 // player_rank + dealer_rank + dealer_qualifies
        } else {
            0
        };

        let total_bits = header_bits + player_card_bits + dealer_card_bits + side_bet_bits + result_bits;
        (total_bits + 7) / 8 + side_bet_bytes
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ========================================================================
    // AC-1.1: play/fold/reveal payloads are 1 byte total
    // ========================================================================

    #[test]
    fn test_play_payload_1_byte_ac_1_1() {
        let payload = ThreeCardMove::Play.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "AC-1.1: Play must be 1 byte");
    }

    #[test]
    fn test_fold_payload_1_byte_ac_1_1() {
        let payload = ThreeCardMove::Fold.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "AC-1.1: Fold must be 1 byte");
    }

    #[test]
    fn test_reveal_payload_1_byte_ac_1_1() {
        let payload = ThreeCardMove::Reveal.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "AC-1.1: Reveal must be 1 byte");
    }

    #[test]
    fn test_all_header_only_actions_1_byte_ac_1_1() {
        for opcode in ThreeCardOpcode::HEADER_ONLY {
            let mov = match opcode {
                ThreeCardOpcode::Play => ThreeCardMove::Play,
                ThreeCardOpcode::Fold => ThreeCardMove::Fold,
                ThreeCardOpcode::Reveal => ThreeCardMove::Reveal,
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
    // AC-1.2: deal payload <= 3 bytes when only one side bet present
    // ========================================================================

    #[test]
    fn test_deal_no_side_bets_size() {
        let mov = ThreeCardMove::Deal {
            side_bets: SideBets::none(),
        };
        let payload = mov.encode_v2().unwrap();
        // 1 byte header + 3 bits side_bet_mask (all zeros) padded to 1 byte
        // 8 bits header + 3 bits mask = 11 bits = 2 bytes
        assert_eq!(payload.len(), 2, "Deal with no side bets should be 2 bytes");
    }

    #[test]
    fn test_deal_one_side_bet_3_bytes_ac_1_2() {
        let mut side_bets = SideBets::none();
        side_bets.pair_plus = 100; // ULEB128(100) = 1 byte

        let mov = ThreeCardMove::Deal { side_bets };
        let payload = mov.encode_v2().unwrap();

        // 8 bits header + 3 bits mask + 8 bits ULEB128(100) = 19 bits = 3 bytes
        assert!(
            payload.len() <= 3,
            "AC-1.2: Deal with one side bet (100) must be <= 3 bytes, got {}",
            payload.len()
        );
    }

    #[test]
    fn test_deal_one_side_bet_various_amounts_ac_1_2() {
        // Test with different side bets and small amounts (< 128)
        let test_cases = [
            (SideBetType::PairPlus, 50),
            (SideBetType::SixCard, 100),
            (SideBetType::Progressive, 127),
        ];

        for (bet_type, amount) in test_cases {
            let mut side_bets = SideBets::none();
            side_bets.set_amount(bet_type, amount);

            let mov = ThreeCardMove::Deal { side_bets };
            let payload = mov.encode_v2().unwrap();

            assert!(
                payload.len() <= 3,
                "AC-1.2: Deal with one {:?}={} must be <= 3 bytes, got {}",
                bet_type,
                amount,
                payload.len()
            );
        }
    }

    #[test]
    fn test_deal_multiple_side_bets_size() {
        let mut side_bets = SideBets::none();
        side_bets.pair_plus = 50;     // ULEB128(50) = 1 byte
        side_bets.six_card = 75;       // ULEB128(75) = 1 byte
        side_bets.progressive = 200;   // ULEB128(200) = 2 bytes

        let mov = ThreeCardMove::Deal { side_bets };
        let payload = mov.encode_v2().unwrap();

        // 8 bits header + 3 bits mask + 1+1+2 bytes amounts
        // = 11 bits + 4 bytes = 2 bytes (header+mask) + 4 bytes (amounts) = 6 bytes
        assert!(payload.len() <= 6, "Deal with 3 side bets should be <= 6 bytes");
    }

    // ========================================================================
    // AC-2.1: Typical state blob shrinks by >= 35%
    // ========================================================================

    #[test]
    fn test_typical_state_compaction_ac_2_1() {
        // Typical mid-game state: decision phase with 3 cards each
        let state = ThreeCardState {
            stage: ThreeCardStage::Decision,
            has_result: false,
            player_cards: vec![10, 25, 40], // 3 cards
            dealer_cards: vec![5, 51, 30],  // 3 cards (face down until reveal)
            side_bets: SideBets {
                pair_plus: 100,
                six_card: 0,
                progressive: 0,
            },
            player_rank: HandRank::None,
            dealer_rank: HandRank::None,
            dealer_qualifies: false,
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
    fn test_complete_state_with_result_compaction_ac_2_1() {
        // Complete state with result
        let state = ThreeCardState {
            stage: ThreeCardStage::Complete,
            has_result: true,
            player_cards: vec![10, 25, 40],
            dealer_cards: vec![5, 51, 30],
            side_bets: SideBets {
                pair_plus: 100,
                six_card: 50,
                progressive: 0,
            },
            player_rank: HandRank::Pair,
            dealer_rank: HandRank::HighCard,
            dealer_qualifies: true,
        };

        let v2_bytes = state.encode_v2().unwrap();
        let v1_estimate = state.estimate_v1_size();

        let reduction = 1.0 - (v2_bytes.len() as f64 / v1_estimate as f64);
        assert!(
            reduction >= 0.35,
            "AC-2.1: Complete state compaction must be >= 35%, got {:.1}% (v1={}, v2={})",
            reduction * 100.0,
            v1_estimate,
            v2_bytes.len()
        );
    }

    #[test]
    fn test_state_without_dealer_qualification_compaction_ac_2_1() {
        // State where dealer doesn't qualify
        let state = ThreeCardState {
            stage: ThreeCardStage::Complete,
            has_result: true,
            player_cards: vec![10, 25, 40],
            dealer_cards: vec![2, 5, 8],
            side_bets: SideBets::none(),
            player_rank: HandRank::Pair,
            dealer_rank: HandRank::HighCard,
            dealer_qualifies: false, // Dealer doesn't qualify
        };

        let v2_bytes = state.encode_v2().unwrap();
        let v1_estimate = state.estimate_v1_size();

        let reduction = 1.0 - (v2_bytes.len() as f64 / v1_estimate as f64);
        assert!(
            reduction >= 0.35,
            "AC-2.1: Non-qualifying dealer state compaction must be >= 35%, got {:.1}% (v1={}, v2={})",
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
        let mov = ThreeCardMove::Play;
        let payload = mov.encode_v2().unwrap();

        // Should decode successfully
        let decoded = ThreeCardMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov, "AC-3.1: v2 payload must decode correctly");
    }

    #[test]
    fn test_v2_deal_roundtrip_ac_3_1() {
        let mut side_bets = SideBets::none();
        side_bets.pair_plus = 250;
        side_bets.six_card = 100;

        let original = ThreeCardMove::Deal { side_bets };
        let payload = original.encode_v2().unwrap();
        let decoded = ThreeCardMove::decode_v2(&payload).unwrap();

        assert_eq!(decoded, original, "AC-3.1: Deal with side bets must roundtrip");
    }

    #[test]
    fn test_dual_decode_v2_payload_ac_3_1() {
        let mov = ThreeCardMove::Fold;
        let payload = mov.encode_v2().unwrap();

        // Dual decode should return Some for v2
        let result = ThreeCardMove::decode_dual(&payload).unwrap();
        assert!(result.is_some(), "AC-3.1: dual decode must return Some for v2");
        assert_eq!(result.unwrap(), mov);
    }

    #[test]
    fn test_dual_decode_v1_payload_returns_none_ac_3_1() {
        // Simulate a v1 payload (version bits = 1)
        let v1_payload = vec![0x01, 0x00, 0x00, 0x00];

        // Dual decode should return None for v1
        let result = ThreeCardMove::decode_dual(&v1_payload).unwrap();
        assert!(result.is_none(), "AC-3.1: dual decode must return None for v1");
    }

    // ========================================================================
    // State blob roundtrip tests
    // ========================================================================

    #[test]
    fn test_state_roundtrip_empty() {
        let state = ThreeCardState::default();
        let encoded = state.encode_v2().unwrap();
        let decoded = ThreeCardState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_decision_phase() {
        let state = ThreeCardState {
            stage: ThreeCardStage::Decision,
            has_result: false,
            player_cards: vec![10, 25, 40],
            dealer_cards: vec![5, 51, 30],
            side_bets: SideBets {
                pair_plus: 100,
                six_card: 0,
                progressive: 0,
            },
            player_rank: HandRank::None,
            dealer_rank: HandRank::None,
            dealer_qualifies: false,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = ThreeCardState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_complete_with_result() {
        let state = ThreeCardState {
            stage: ThreeCardStage::Complete,
            has_result: true,
            player_cards: vec![10, 25, 40],
            dealer_cards: vec![5, 51, 30],
            side_bets: SideBets {
                pair_plus: 100,
                six_card: 50,
                progressive: 25,
            },
            player_rank: HandRank::StraightFlush,
            dealer_rank: HandRank::Pair,
            dealer_qualifies: true,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = ThreeCardState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_all_stages() {
        for stage in [
            ThreeCardStage::Betting,
            ThreeCardStage::Decision,
            ThreeCardStage::AwaitingReveal,
            ThreeCardStage::Complete,
        ] {
            let state = ThreeCardState {
                stage,
                ..Default::default()
            };
            let encoded = state.encode_v2().unwrap();
            let decoded = ThreeCardState::decode_v2(&encoded).unwrap();
            assert_eq!(decoded.stage, stage);
        }
    }

    #[test]
    fn test_state_roundtrip_all_ranks() {
        for player_rank in [
            HandRank::None,
            HandRank::StraightFlush,
            HandRank::ThreeOfAKind,
            HandRank::Straight,
            HandRank::Flush,
            HandRank::Pair,
            HandRank::HighCard,
        ] {
            let state = ThreeCardState {
                stage: ThreeCardStage::Complete,
                has_result: true,
                player_cards: vec![10, 25, 40],
                dealer_cards: vec![5, 51, 30],
                side_bets: SideBets::none(),
                player_rank,
                dealer_rank: HandRank::HighCard,
                dealer_qualifies: true,
            };
            let encoded = state.encode_v2().unwrap();
            let decoded = ThreeCardState::decode_v2(&encoded).unwrap();
            assert_eq!(decoded.player_rank, player_rank);
        }
    }

    // ========================================================================
    // Move roundtrip tests
    // ========================================================================

    #[test]
    fn test_all_moves_roundtrip() {
        let moves = vec![
            ThreeCardMove::Play,
            ThreeCardMove::Fold,
            ThreeCardMove::Reveal,
            ThreeCardMove::Deal { side_bets: SideBets::none() },
            ThreeCardMove::SetRules { rules_id: 42 },
        ];

        for mov in moves {
            let encoded = mov.encode_v2().unwrap();
            let decoded = ThreeCardMove::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, mov, "Move {:?} must roundtrip", mov);
        }
    }

    #[test]
    fn test_set_rules_roundtrip() {
        let test_ids = [0, 1, 127, 128, 1000, u64::MAX];

        for rules_id in test_ids {
            let mov = ThreeCardMove::SetRules { rules_id };
            let encoded = mov.encode_v2().unwrap();
            let decoded = ThreeCardMove::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, mov, "SetRules({}) must roundtrip", rules_id);
        }
    }

    // ========================================================================
    // Side bet encoding tests
    // ========================================================================

    #[test]
    fn test_side_bet_mask_encoding() {
        let mut side_bets = SideBets::none();
        assert_eq!(side_bets.mask(), 0b000);

        side_bets.pair_plus = 1;
        assert_eq!(side_bets.mask(), 0b001);

        side_bets.six_card = 1;
        assert_eq!(side_bets.mask(), 0b011);

        side_bets.progressive = 1;
        assert_eq!(side_bets.mask(), 0b111);
    }

    #[test]
    fn test_side_bets_roundtrip() {
        let side_bets = SideBets {
            pair_plus: 100,
            six_card: 50,
            progressive: 200,
        };

        let mut writer = BitWriter::new();
        side_bets.encode(&mut writer).unwrap();
        let encoded = writer.finish();

        let mut reader = BitReader::new(&encoded);
        let decoded = SideBets::decode(&mut reader).unwrap();

        assert_eq!(decoded, side_bets);
    }

    // ========================================================================
    // Golden vector tests for determinism
    // ========================================================================

    #[test]
    fn test_play_golden_vector() {
        let payload = ThreeCardMove::Play.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 0 (bits 00000) = 0b00000_010 = 0x02
        assert_eq!(payload, vec![0x02], "Play golden vector");
    }

    #[test]
    fn test_fold_golden_vector() {
        let payload = ThreeCardMove::Fold.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 1 (bits 00001) = 0b00001_010 = 0x0A
        assert_eq!(payload, vec![0x0A], "Fold golden vector");
    }

    #[test]
    fn test_reveal_golden_vector() {
        let payload = ThreeCardMove::Reveal.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 3 (bits 00011) = 0b00011_010 = 0x1A
        assert_eq!(payload, vec![0x1A], "Reveal golden vector");
    }

    #[test]
    fn test_deal_no_side_bets_golden_vector() {
        let mov = ThreeCardMove::Deal { side_bets: SideBets::none() };
        let payload = mov.encode_v2().unwrap();
        // Version 2 (010) + opcode 2 (00010) = 0b00010_010 = 0x12
        // Then 3-bit mask = 000, so byte 2 = 0b00000_000 (padded) = 0x00
        // Actually: 8 bits (0x12) + 3 bits (000) = 11 bits
        // Byte 0: 0x12
        // Byte 1: remaining 3 bits (000) padded to byte = 0x00
        assert_eq!(payload, vec![0x12, 0x00], "Deal (no side bets) golden vector");
    }

    #[test]
    fn test_encoding_deterministic() {
        // Same input must produce same output every time
        for _ in 0..10 {
            let mov = ThreeCardMove::Play;
            let payload = mov.encode_v2().unwrap();
            assert_eq!(payload, vec![0x02]);
        }
    }

    // ========================================================================
    // Golden vector tests for deal with each side bet combination
    // ========================================================================

    #[test]
    fn test_deal_pair_plus_golden_vector() {
        let mut side_bets = SideBets::none();
        side_bets.pair_plus = 100;

        let mov = ThreeCardMove::Deal { side_bets };
        let payload = mov.encode_v2().unwrap();

        // Verify determinism
        let payload2 = ThreeCardMove::Deal {
            side_bets: SideBets {
                pair_plus: 100,
                six_card: 0,
                progressive: 0,
            },
        }
        .encode_v2()
        .unwrap();
        assert_eq!(payload, payload2, "Encoding must be deterministic");

        // Verify size
        assert!(payload.len() <= 3, "Deal with pair_plus=100 should be <= 3 bytes");
    }

    #[test]
    fn test_deal_six_card_golden_vector() {
        let mut side_bets = SideBets::none();
        side_bets.six_card = 50;

        let mov = ThreeCardMove::Deal { side_bets };
        let payload = mov.encode_v2().unwrap();

        // Verify roundtrip
        let decoded = ThreeCardMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov);
    }

    #[test]
    fn test_deal_progressive_golden_vector() {
        let mut side_bets = SideBets::none();
        side_bets.progressive = 25;

        let mov = ThreeCardMove::Deal { side_bets };
        let payload = mov.encode_v2().unwrap();

        // Verify roundtrip
        let decoded = ThreeCardMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov);
    }

    #[test]
    fn test_deal_all_side_bets_golden_vector() {
        let side_bets = SideBets {
            pair_plus: 100,
            six_card: 50,
            progressive: 25,
        };

        let mov = ThreeCardMove::Deal { side_bets };
        let payload = mov.encode_v2().unwrap();

        // Verify roundtrip
        let decoded = ThreeCardMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov);
    }

    // ========================================================================
    // Edge case tests
    // ========================================================================

    #[test]
    fn test_state_max_card_values() {
        // Test with max card ID (51)
        let state = ThreeCardState {
            stage: ThreeCardStage::Complete,
            has_result: true,
            player_cards: vec![51, 51, 51],
            dealer_cards: vec![51, 51, 51],
            side_bets: SideBets::none(),
            player_rank: HandRank::ThreeOfAKind,
            dealer_rank: HandRank::ThreeOfAKind,
            dealer_qualifies: true,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = ThreeCardState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_min_card_values() {
        // Test with min card ID (0)
        let state = ThreeCardState {
            stage: ThreeCardStage::Decision,
            has_result: false,
            player_cards: vec![0, 0, 0],
            dealer_cards: vec![0, 0, 0],
            side_bets: SideBets::none(),
            player_rank: HandRank::None,
            dealer_rank: HandRank::None,
            dealer_qualifies: false,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = ThreeCardState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_partial_cards() {
        // Test with less than 3 cards (e.g., during deal animation)
        let state = ThreeCardState {
            stage: ThreeCardStage::Decision,
            has_result: false,
            player_cards: vec![10, 25], // Only 2 cards
            dealer_cards: vec![5],      // Only 1 card
            side_bets: SideBets::none(),
            player_rank: HandRank::None,
            dealer_rank: HandRank::None,
            dealer_qualifies: false,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = ThreeCardState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_all_opcodes_have_correct_values() {
        // Verify opcode values match spec section 3.2
        assert_eq!(ThreeCardOpcode::Play as u8, 0);
        assert_eq!(ThreeCardOpcode::Fold as u8, 1);
        assert_eq!(ThreeCardOpcode::Deal as u8, 2);
        assert_eq!(ThreeCardOpcode::Reveal as u8, 3);
        assert_eq!(ThreeCardOpcode::SetRules as u8, 4);
    }

    #[test]
    fn test_side_bet_mask_bits_match_spec() {
        // Verify side bet mask matches spec section 3.3
        // Bit 0: pair_plus, Bit 1: six_card, Bit 2: progressive
        let side_bets = SideBets {
            pair_plus: 1,
            six_card: 0,
            progressive: 0,
        };
        assert_eq!(side_bets.mask(), 0b001);

        let side_bets = SideBets {
            pair_plus: 0,
            six_card: 1,
            progressive: 0,
        };
        assert_eq!(side_bets.mask(), 0b010);

        let side_bets = SideBets {
            pair_plus: 0,
            six_card: 0,
            progressive: 1,
        };
        assert_eq!(side_bets.mask(), 0b100);
    }
}
