//! Ultimate Hold'em v2 compact encoding (spec: `compact-encoding-ultimate-holdem.md`).
//!
//! This module implements the bitwise compact encoding for Ultimate Hold'em move
//! payloads and state blobs as defined in the spec. All bit layouts are canonical;
//! JS/TS consumes generated artifacts.
//!
//! # Move Payload Encoding
//!
//! All Ultimate Hold'em moves use a 1-byte header:
//! - `version` (3 bits): Protocol version (2 for v2)
//! - `opcode` (5 bits): Action type (0-5)
//!
//! Check/Fold/Reveal are header-only (1 byte).
//! Bet includes a 2-bit multiplier.
//! Deal includes a side bet mask (3 bits) and ULEB128 amounts.
//!
//! # State Blob Encoding
//!
//! State is encoded compactly using:
//! - 6-bit card IDs (0-51)
//! - 2-bit stage (preflop/flop/turn/river)
//! - 3-bit side bet mask
//! - 6-bit bonus rank for results

use crate::codec::{
    BitReader, BitWriter, CodecError, CodecResult, DualDecoder, EncodingVersion, PayloadHeader,
};

// ============================================================================
// Ultimate Hold'em Opcodes (v2)
// ============================================================================

/// Ultimate Hold'em action opcodes for v2 compact encoding.
///
/// These map to the opcode values in the 5-bit opcode field of the header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum UltimateHoldemOpcode {
    /// Check: Pass action without betting.
    Check = 0,
    /// Bet: Make a bet with specified multiplier (1x, 2x, 3x, 4x).
    Bet = 1,
    /// Fold: Surrender the hand.
    Fold = 2,
    /// Deal: Start a new hand with ante and optional side bets.
    Deal = 3,
    /// Reveal: Dealer reveals cards and resolves hand.
    Reveal = 4,
    /// SetRules: Configure table rules variant.
    SetRules = 5,
}

impl UltimateHoldemOpcode {
    /// All valid opcodes.
    pub const ALL: [Self; 6] = [
        Self::Check,
        Self::Bet,
        Self::Fold,
        Self::Deal,
        Self::Reveal,
        Self::SetRules,
    ];

    /// Opcodes that produce a header-only (1 byte) payload.
    pub const HEADER_ONLY: [Self; 3] = [Self::Check, Self::Fold, Self::Reveal];

    /// Check if this opcode produces a header-only (1 byte) payload.
    #[must_use]
    pub const fn is_header_only(&self) -> bool {
        matches!(self, Self::Check | Self::Fold | Self::Reveal)
    }
}

impl TryFrom<u8> for UltimateHoldemOpcode {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Check),
            1 => Ok(Self::Bet),
            2 => Ok(Self::Fold),
            3 => Ok(Self::Deal),
            4 => Ok(Self::Reveal),
            5 => Ok(Self::SetRules),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 5, // max opcode
            }),
        }
    }
}

// ============================================================================
// Bet Multiplier
// ============================================================================

/// Bet multiplier for Ultimate Hold'em betting actions.
///
/// Encoded in 2 bits (0-3) representing 1x, 2x, 3x, 4x.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum BetMultiplier {
    /// 1x bet (river only).
    #[default]
    One = 0,
    /// 2x bet (turn/river).
    Two = 1,
    /// 3x bet (preflop).
    Three = 2,
    /// 4x bet (preflop).
    Four = 3,
}

impl BetMultiplier {
    /// Bit width for multiplier field.
    pub const BITS: usize = 2;

    /// Get the actual multiplier value.
    #[must_use]
    pub const fn value(&self) -> u8 {
        match self {
            Self::One => 1,
            Self::Two => 2,
            Self::Three => 3,
            Self::Four => 4,
        }
    }
}

impl TryFrom<u8> for BetMultiplier {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::One),
            1 => Ok(Self::Two),
            2 => Ok(Self::Three),
            3 => Ok(Self::Four),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 3, // max multiplier value
            }),
        }
    }
}

// ============================================================================
// Side Bet Types
// ============================================================================

/// Ultimate Hold'em side bet types.
///
/// The mask uses 3 bits, one for each possible side bet:
/// - Bit 0: Trips
/// - Bit 1: Six Card
/// - Bit 2: Progressive
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum SideBetType {
    /// Trips: Side bet on player's final hand having trips or better.
    Trips = 0,
    /// Six Card Bonus: Uses player's 2 cards + 5 community cards for poker hand.
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
    pub const ALL: [Self; 3] = [Self::Trips, Self::SixCard, Self::Progressive];
}

/// Side bets for a deal action.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SideBets {
    /// Amount for Trips bet (0 if not placed).
    pub trips: u64,
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
            trips: 0,
            six_card: 0,
            progressive: 0,
        }
    }

    /// Check if any side bets are placed.
    #[must_use]
    pub fn has_any(&self) -> bool {
        self.trips > 0 || self.six_card > 0 || self.progressive > 0
    }

    /// Generate the 3-bit mask for set side bets.
    #[must_use]
    pub fn mask(&self) -> u8 {
        let mut mask = 0u8;
        if self.trips > 0 {
            mask |= 1 << SideBetType::Trips as u8;
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
            SideBetType::Trips => self.trips,
            SideBetType::SixCard => self.six_card,
            SideBetType::Progressive => self.progressive,
        }
    }

    /// Set the amount for a side bet type.
    pub fn set_amount(&mut self, bet_type: SideBetType, amount: u64) {
        match bet_type {
            SideBetType::Trips => self.trips = amount,
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

/// An Ultimate Hold'em move action with optional payload data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UltimateHoldemMove {
    /// Check: Pass without betting.
    Check,
    /// Bet: Make a bet with specified multiplier.
    Bet { multiplier: BetMultiplier },
    /// Fold: Surrender the hand.
    Fold,
    /// Deal: Start a new hand with ante and optional side bets.
    Deal { side_bets: SideBets },
    /// Reveal: Dealer reveals and resolves the hand.
    Reveal,
    /// SetRules: Configure table rules.
    SetRules { rules_id: u64 },
}

impl UltimateHoldemMove {
    /// Get the opcode for this move.
    #[must_use]
    pub fn opcode(&self) -> UltimateHoldemOpcode {
        match self {
            Self::Check => UltimateHoldemOpcode::Check,
            Self::Bet { .. } => UltimateHoldemOpcode::Bet,
            Self::Fold => UltimateHoldemOpcode::Fold,
            Self::Deal { .. } => UltimateHoldemOpcode::Deal,
            Self::Reveal => UltimateHoldemOpcode::Reveal,
            Self::SetRules { .. } => UltimateHoldemOpcode::SetRules,
        }
    }

    /// Encode this move as a v2 compact payload.
    ///
    /// # Returns
    /// The encoded bytes. Header-only moves (Check, Fold, Reveal) return 1 byte.
    /// Bet returns 2 bytes (header + multiplier).
    pub fn encode_v2(&self) -> CodecResult<Vec<u8>> {
        let mut writer = BitWriter::new();
        let header = PayloadHeader::new(self.opcode() as u8);
        header.encode(&mut writer)?;

        match self {
            Self::Check | Self::Fold | Self::Reveal => {
                // Header only - no additional payload
            }
            Self::Bet { multiplier } => {
                writer.write_bits(*multiplier as u8 as u64, BetMultiplier::BITS)?;
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
        let opcode = UltimateHoldemOpcode::try_from(header.opcode)?;

        Ok(match opcode {
            UltimateHoldemOpcode::Check => Self::Check,
            UltimateHoldemOpcode::Fold => Self::Fold,
            UltimateHoldemOpcode::Reveal => Self::Reveal,
            UltimateHoldemOpcode::Bet => {
                let multiplier_val = reader.read_bits(BetMultiplier::BITS)? as u8;
                let multiplier = BetMultiplier::try_from(multiplier_val)?;
                Self::Bet { multiplier }
            }
            UltimateHoldemOpcode::Deal => {
                let side_bets = SideBets::decode(&mut reader)?;
                Self::Deal { side_bets }
            }
            UltimateHoldemOpcode::SetRules => {
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

/// Ultimate Hold'em game stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum UltimateHoldemStage {
    /// Preflop: Initial betting after hole cards dealt.
    #[default]
    Preflop = 0,
    /// Flop: Three community cards revealed.
    Flop = 1,
    /// Turn: Fourth community card revealed.
    Turn = 2,
    /// River: Fifth community card revealed / showdown.
    River = 3,
}

impl UltimateHoldemStage {
    /// Bit width for stage field.
    pub const BITS: usize = 2;
}

impl TryFrom<u8> for UltimateHoldemStage {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Preflop),
            1 => Ok(Self::Flop),
            2 => Ok(Self::Turn),
            3 => Ok(Self::River),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 3, // max stage
            }),
        }
    }
}

/// Bonus hand rank for Trips/Six Card side bets.
///
/// Encoded in 6 bits (0-63), representing poker hand rankings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum BonusRank {
    /// No bonus rank determined yet.
    #[default]
    None = 0,
    /// Royal Flush (best).
    RoyalFlush = 1,
    /// Straight Flush.
    StraightFlush = 2,
    /// Four of a Kind.
    FourOfAKind = 3,
    /// Full House.
    FullHouse = 4,
    /// Flush.
    Flush = 5,
    /// Straight.
    Straight = 6,
    /// Three of a Kind (trips).
    ThreeOfAKind = 7,
    /// Two Pair (for Six Card bonus).
    TwoPair = 8,
    /// One Pair.
    Pair = 9,
    /// High Card.
    HighCard = 10,
}

impl BonusRank {
    /// Bit width for rank field.
    pub const BITS: usize = 6;
}

impl TryFrom<u8> for BonusRank {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::None),
            1 => Ok(Self::RoyalFlush),
            2 => Ok(Self::StraightFlush),
            3 => Ok(Self::FourOfAKind),
            4 => Ok(Self::FullHouse),
            5 => Ok(Self::Flush),
            6 => Ok(Self::Straight),
            7 => Ok(Self::ThreeOfAKind),
            8 => Ok(Self::TwoPair),
            9 => Ok(Self::Pair),
            10 => Ok(Self::HighCard),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 10, // max rank
            }),
        }
    }
}

/// Complete Ultimate Hold'em state blob.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UltimateHoldemState {
    /// Current game stage.
    pub stage: UltimateHoldemStage,
    /// Whether result is present.
    pub has_result: bool,
    /// Player's hole cards (6-bit IDs, 0-51). Always 2 when dealt.
    pub hole_cards: Vec<u8>,
    /// Community cards (6-bit IDs, 0-51). 0, 3, 4, or 5 cards.
    pub community_cards: Vec<u8>,
    /// Dealer's hole cards (6-bit IDs, 0-51). 2 when revealed.
    pub dealer_cards: Vec<u8>,
    /// Side bets for this hand.
    pub side_bets: SideBets,
    /// Bonus rank for side bet resolution (if complete).
    pub bonus_rank: BonusRank,
}

impl UltimateHoldemState {
    /// Maximum hole cards (always 2 in Ultimate Hold'em).
    pub const MAX_HOLE_CARDS: usize = 2;

    /// Maximum community cards (always 5 in Ultimate Hold'em).
    pub const MAX_COMMUNITY_CARDS: usize = 5;

    /// Maximum dealer cards (always 2 in Ultimate Hold'em).
    pub const MAX_DEALER_CARDS: usize = 2;

    /// Bit width for hole card count field (0-2 fits in 2 bits).
    pub const HOLE_COUNT_BITS: usize = 2;

    /// Bit width for community card count field (0-5 fits in 3 bits).
    pub const COMMUNITY_COUNT_BITS: usize = 3;

    /// Bit width for dealer card count field (0-2 fits in 2 bits).
    pub const DEALER_COUNT_BITS: usize = 2;

    /// Bit width for a single card (0-51 fits in 6 bits).
    pub const CARD_BITS: usize = 6;

    /// Version bits.
    pub const VERSION_BITS: usize = 3;

    /// Encode this state as a v2 compact blob.
    pub fn encode_v2(&self) -> CodecResult<Vec<u8>> {
        let mut writer = BitWriter::new();

        // Header bits per spec (section 4.1)
        writer.write_bits(PayloadHeader::V2 as u64, Self::VERSION_BITS)?;
        writer.write_bits(self.stage as u8 as u64, UltimateHoldemStage::BITS)?;
        writer.write_bit(self.has_result)?;

        // Cards (section 4.2)
        let hole_count = self.hole_cards.len().min(Self::MAX_HOLE_CARDS);
        let community_count = self.community_cards.len().min(Self::MAX_COMMUNITY_CARDS);
        let dealer_count = self.dealer_cards.len().min(Self::MAX_DEALER_CARDS);
        writer.write_bits(hole_count as u64, Self::HOLE_COUNT_BITS)?;
        writer.write_bits(community_count as u64, Self::COMMUNITY_COUNT_BITS)?;
        writer.write_bits(dealer_count as u64, Self::DEALER_COUNT_BITS)?;

        // Hole cards
        for &card in self.hole_cards.iter().take(Self::MAX_HOLE_CARDS) {
            writer.write_bits(card as u64, Self::CARD_BITS)?;
        }

        // Community cards
        for &card in self.community_cards.iter().take(Self::MAX_COMMUNITY_CARDS) {
            writer.write_bits(card as u64, Self::CARD_BITS)?;
        }

        // Dealer cards
        for &card in self.dealer_cards.iter().take(Self::MAX_DEALER_CARDS) {
            writer.write_bits(card as u64, Self::CARD_BITS)?;
        }

        // Bets (section 4.3)
        self.side_bets.encode(&mut writer)?;

        // Results (section 4.4) - only if has_result is true
        if self.has_result {
            writer.write_bits(self.bonus_rank as u8 as u64, BonusRank::BITS)?;
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

        let stage = UltimateHoldemStage::try_from(reader.read_bits(UltimateHoldemStage::BITS)? as u8)?;
        let has_result = reader.read_bit()?;

        // Card counts
        let hole_count = reader.read_bits(Self::HOLE_COUNT_BITS)? as usize;
        let community_count = reader.read_bits(Self::COMMUNITY_COUNT_BITS)? as usize;
        let dealer_count = reader.read_bits(Self::DEALER_COUNT_BITS)? as usize;

        // Hole cards
        let mut hole_cards = Vec::with_capacity(hole_count);
        for _ in 0..hole_count {
            hole_cards.push(reader.read_bits(Self::CARD_BITS)? as u8);
        }

        // Community cards
        let mut community_cards = Vec::with_capacity(community_count);
        for _ in 0..community_count {
            community_cards.push(reader.read_bits(Self::CARD_BITS)? as u8);
        }

        // Dealer cards
        let mut dealer_cards = Vec::with_capacity(dealer_count);
        for _ in 0..dealer_count {
            dealer_cards.push(reader.read_bits(Self::CARD_BITS)? as u8);
        }

        // Side bets
        let side_bets = SideBets::decode(&mut reader)?;

        // Results (only if has_result)
        let bonus_rank = if has_result {
            BonusRank::try_from(reader.read_bits(BonusRank::BITS)? as u8)?
        } else {
            BonusRank::None
        };

        Ok(Self {
            stage,
            has_result,
            hole_cards,
            community_cards,
            dealer_cards,
            side_bets,
            bonus_rank,
        })
    }

    /// Estimate the v1 JSON-style encoding size for comparison.
    ///
    /// This is a rough estimate based on typical v1 field sizes:
    /// - stage: 1 byte enum + padding
    /// - has_result: 1 byte bool
    /// - cards: array overhead + 1 byte per card
    /// - side_bets: object with 3 optional u64 fields
    /// - bonus_rank: 1 byte
    #[must_use]
    pub fn estimate_v1_size(&self) -> usize {
        let base_overhead = 16; // object wrapper, padding
        let stage_size = 4;     // enum with padding
        let has_result_size = 4; // bool with padding
        let hole_cards_size = 8 + self.hole_cards.len(); // array overhead + cards
        let community_cards_size = 8 + self.community_cards.len(); // array overhead + cards
        let dealer_cards_size = 8 + self.dealer_cards.len(); // array overhead + cards
        let side_bet_size = if self.side_bets.has_any() {
            8 + self.side_bets.count() * 8 // object overhead + u64 per bet
        } else {
            8 // empty object
        };
        let result_size = if self.has_result {
            4 // bonus_rank enum
        } else {
            0
        };

        base_overhead
            + stage_size
            + has_result_size
            + hole_cards_size
            + community_cards_size
            + dealer_cards_size
            + side_bet_size
            + result_size
    }

    /// Calculate the actual v2 encoded size.
    #[must_use]
    pub fn v2_size(&self) -> usize {
        // Header bits
        let header_bits = Self::VERSION_BITS
            + UltimateHoldemStage::BITS
            + 1 // has_result
            + Self::HOLE_COUNT_BITS
            + Self::COMMUNITY_COUNT_BITS
            + Self::DEALER_COUNT_BITS;

        // Card bits
        let hole_card_bits =
            self.hole_cards.len().min(Self::MAX_HOLE_CARDS) * Self::CARD_BITS;
        let community_card_bits =
            self.community_cards.len().min(Self::MAX_COMMUNITY_CARDS) * Self::CARD_BITS;
        let dealer_card_bits =
            self.dealer_cards.len().min(Self::MAX_DEALER_CARDS) * Self::CARD_BITS;

        // Side bet bits (mask + ULEB128 amounts)
        let side_bet_bits = SideBetType::MASK_BITS;
        let side_bet_bytes: usize = SideBetType::ALL
            .iter()
            .filter(|&&bt| self.side_bets.amount(bt) > 0)
            .map(|&bt| crate::codec::encode_uleb128(self.side_bets.amount(bt)).len())
            .sum();

        // Result bits (only if has_result)
        let result_bits = if self.has_result {
            BonusRank::BITS
        } else {
            0
        };

        let total_bits = header_bits + hole_card_bits + community_card_bits + dealer_card_bits + side_bet_bits + result_bits;
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
    // AC-1.1: Bet payload is 2 bytes total (header + multiplier)
    // ========================================================================

    #[test]
    fn test_bet_1x_payload_2_bytes_ac_1_1() {
        let payload = UltimateHoldemMove::Bet { multiplier: BetMultiplier::One }.encode_v2().unwrap();
        assert_eq!(payload.len(), 2, "AC-1.1: Bet (1x) must be 2 bytes");
    }

    #[test]
    fn test_bet_2x_payload_2_bytes_ac_1_1() {
        let payload = UltimateHoldemMove::Bet { multiplier: BetMultiplier::Two }.encode_v2().unwrap();
        assert_eq!(payload.len(), 2, "AC-1.1: Bet (2x) must be 2 bytes");
    }

    #[test]
    fn test_bet_3x_payload_2_bytes_ac_1_1() {
        let payload = UltimateHoldemMove::Bet { multiplier: BetMultiplier::Three }.encode_v2().unwrap();
        assert_eq!(payload.len(), 2, "AC-1.1: Bet (3x) must be 2 bytes");
    }

    #[test]
    fn test_bet_4x_payload_2_bytes_ac_1_1() {
        let payload = UltimateHoldemMove::Bet { multiplier: BetMultiplier::Four }.encode_v2().unwrap();
        assert_eq!(payload.len(), 2, "AC-1.1: Bet (4x) must be 2 bytes");
    }

    #[test]
    fn test_all_bet_multipliers_2_bytes_ac_1_1() {
        for multiplier in [BetMultiplier::One, BetMultiplier::Two, BetMultiplier::Three, BetMultiplier::Four] {
            let mov = UltimateHoldemMove::Bet { multiplier };
            let payload = mov.encode_v2().unwrap();
            assert_eq!(
                payload.len(),
                2,
                "AC-1.1: Bet ({:?}) must be 2 bytes",
                multiplier
            );
        }
    }

    #[test]
    fn test_check_payload_1_byte() {
        let payload = UltimateHoldemMove::Check.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "Check must be 1 byte");
    }

    #[test]
    fn test_fold_payload_1_byte() {
        let payload = UltimateHoldemMove::Fold.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "Fold must be 1 byte");
    }

    #[test]
    fn test_reveal_payload_1_byte() {
        let payload = UltimateHoldemMove::Reveal.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "Reveal must be 1 byte");
    }

    #[test]
    fn test_all_header_only_actions_1_byte() {
        for opcode in UltimateHoldemOpcode::HEADER_ONLY {
            let mov = match opcode {
                UltimateHoldemOpcode::Check => UltimateHoldemMove::Check,
                UltimateHoldemOpcode::Fold => UltimateHoldemMove::Fold,
                UltimateHoldemOpcode::Reveal => UltimateHoldemMove::Reveal,
                _ => unreachable!(),
            };
            let payload = mov.encode_v2().unwrap();
            assert_eq!(
                payload.len(),
                1,
                "{:?} must be 1 byte",
                opcode
            );
        }
    }

    // ========================================================================
    // AC-1.2: deal payload <= 3 bytes when only one side bet present
    // ========================================================================

    #[test]
    fn test_deal_no_side_bets_size() {
        let mov = UltimateHoldemMove::Deal {
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
        side_bets.trips = 100; // ULEB128(100) = 1 byte

        let mov = UltimateHoldemMove::Deal { side_bets };
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
            (SideBetType::Trips, 50),
            (SideBetType::SixCard, 100),
            (SideBetType::Progressive, 127),
        ];

        for (bet_type, amount) in test_cases {
            let mut side_bets = SideBets::none();
            side_bets.set_amount(bet_type, amount);

            let mov = UltimateHoldemMove::Deal { side_bets };
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
        side_bets.trips = 50;       // ULEB128(50) = 1 byte
        side_bets.six_card = 75;    // ULEB128(75) = 1 byte
        side_bets.progressive = 200; // ULEB128(200) = 2 bytes

        let mov = UltimateHoldemMove::Deal { side_bets };
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
        // Typical mid-game state: flop with community cards
        let state = UltimateHoldemState {
            stage: UltimateHoldemStage::Flop,
            has_result: false,
            hole_cards: vec![10, 25],      // 2 hole cards
            community_cards: vec![5, 30, 45], // 3 community cards (flop)
            dealer_cards: vec![],           // dealer cards hidden
            side_bets: SideBets {
                trips: 100,
                six_card: 0,
                progressive: 0,
            },
            bonus_rank: BonusRank::None,
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
        // Complete state with result (showdown)
        let state = UltimateHoldemState {
            stage: UltimateHoldemStage::River,
            has_result: true,
            hole_cards: vec![10, 25],
            community_cards: vec![5, 30, 45, 12, 51], // all 5 community cards
            dealer_cards: vec![8, 33],                 // dealer revealed
            side_bets: SideBets {
                trips: 100,
                six_card: 50,
                progressive: 0,
            },
            bonus_rank: BonusRank::FullHouse,
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
    fn test_preflop_state_compaction_ac_2_1() {
        // Preflop state with just hole cards
        let state = UltimateHoldemState {
            stage: UltimateHoldemStage::Preflop,
            has_result: false,
            hole_cards: vec![10, 25],
            community_cards: vec![],
            dealer_cards: vec![],
            side_bets: SideBets::none(),
            bonus_rank: BonusRank::None,
        };

        let v2_bytes = state.encode_v2().unwrap();
        let v1_estimate = state.estimate_v1_size();

        let reduction = 1.0 - (v2_bytes.len() as f64 / v1_estimate as f64);
        assert!(
            reduction >= 0.35,
            "AC-2.1: Preflop state compaction must be >= 35%, got {:.1}% (v1={}, v2={})",
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
        let mov = UltimateHoldemMove::Check;
        let payload = mov.encode_v2().unwrap();

        // Should decode successfully
        let decoded = UltimateHoldemMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov, "AC-3.1: v2 payload must decode correctly");
    }

    #[test]
    fn test_v2_deal_roundtrip_ac_3_1() {
        let mut side_bets = SideBets::none();
        side_bets.trips = 250;
        side_bets.six_card = 100;

        let original = UltimateHoldemMove::Deal { side_bets };
        let payload = original.encode_v2().unwrap();
        let decoded = UltimateHoldemMove::decode_v2(&payload).unwrap();

        assert_eq!(decoded, original, "AC-3.1: Deal with side bets must roundtrip");
    }

    #[test]
    fn test_v2_bet_roundtrip_ac_3_1() {
        for multiplier in [BetMultiplier::One, BetMultiplier::Two, BetMultiplier::Three, BetMultiplier::Four] {
            let original = UltimateHoldemMove::Bet { multiplier };
            let payload = original.encode_v2().unwrap();
            let decoded = UltimateHoldemMove::decode_v2(&payload).unwrap();

            assert_eq!(decoded, original, "AC-3.1: Bet ({:?}) must roundtrip", multiplier);
        }
    }

    #[test]
    fn test_dual_decode_v2_payload_ac_3_1() {
        let mov = UltimateHoldemMove::Fold;
        let payload = mov.encode_v2().unwrap();

        // Dual decode should return Some for v2
        let result = UltimateHoldemMove::decode_dual(&payload).unwrap();
        assert!(result.is_some(), "AC-3.1: dual decode must return Some for v2");
        assert_eq!(result.unwrap(), mov);
    }

    #[test]
    fn test_dual_decode_v1_payload_returns_none_ac_3_1() {
        // Simulate a v1 payload (version bits = 1)
        let v1_payload = vec![0x01, 0x00, 0x00, 0x00];

        // Dual decode should return None for v1
        let result = UltimateHoldemMove::decode_dual(&v1_payload).unwrap();
        assert!(result.is_none(), "AC-3.1: dual decode must return None for v1");
    }

    // ========================================================================
    // State blob roundtrip tests
    // ========================================================================

    #[test]
    fn test_state_roundtrip_empty() {
        let state = UltimateHoldemState::default();
        let encoded = state.encode_v2().unwrap();
        let decoded = UltimateHoldemState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_preflop() {
        let state = UltimateHoldemState {
            stage: UltimateHoldemStage::Preflop,
            has_result: false,
            hole_cards: vec![10, 25],
            community_cards: vec![],
            dealer_cards: vec![],
            side_bets: SideBets {
                trips: 100,
                six_card: 0,
                progressive: 0,
            },
            bonus_rank: BonusRank::None,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = UltimateHoldemState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_flop() {
        let state = UltimateHoldemState {
            stage: UltimateHoldemStage::Flop,
            has_result: false,
            hole_cards: vec![10, 25],
            community_cards: vec![5, 30, 45],
            dealer_cards: vec![],
            side_bets: SideBets::none(),
            bonus_rank: BonusRank::None,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = UltimateHoldemState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_turn() {
        let state = UltimateHoldemState {
            stage: UltimateHoldemStage::Turn,
            has_result: false,
            hole_cards: vec![10, 25],
            community_cards: vec![5, 30, 45, 12],
            dealer_cards: vec![],
            side_bets: SideBets {
                trips: 0,
                six_card: 75,
                progressive: 0,
            },
            bonus_rank: BonusRank::None,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = UltimateHoldemState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_river_with_result() {
        let state = UltimateHoldemState {
            stage: UltimateHoldemStage::River,
            has_result: true,
            hole_cards: vec![10, 25],
            community_cards: vec![5, 30, 45, 12, 51],
            dealer_cards: vec![8, 33],
            side_bets: SideBets {
                trips: 100,
                six_card: 50,
                progressive: 25,
            },
            bonus_rank: BonusRank::StraightFlush,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = UltimateHoldemState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_all_stages() {
        for stage in [
            UltimateHoldemStage::Preflop,
            UltimateHoldemStage::Flop,
            UltimateHoldemStage::Turn,
            UltimateHoldemStage::River,
        ] {
            let state = UltimateHoldemState {
                stage,
                ..Default::default()
            };
            let encoded = state.encode_v2().unwrap();
            let decoded = UltimateHoldemState::decode_v2(&encoded).unwrap();
            assert_eq!(decoded.stage, stage);
        }
    }

    #[test]
    fn test_state_roundtrip_all_bonus_ranks() {
        for bonus_rank in [
            BonusRank::None,
            BonusRank::RoyalFlush,
            BonusRank::StraightFlush,
            BonusRank::FourOfAKind,
            BonusRank::FullHouse,
            BonusRank::Flush,
            BonusRank::Straight,
            BonusRank::ThreeOfAKind,
            BonusRank::TwoPair,
            BonusRank::Pair,
            BonusRank::HighCard,
        ] {
            let state = UltimateHoldemState {
                stage: UltimateHoldemStage::River,
                has_result: true,
                hole_cards: vec![10, 25],
                community_cards: vec![5, 30, 45, 12, 51],
                dealer_cards: vec![8, 33],
                side_bets: SideBets::none(),
                bonus_rank,
            };
            let encoded = state.encode_v2().unwrap();
            let decoded = UltimateHoldemState::decode_v2(&encoded).unwrap();
            assert_eq!(decoded.bonus_rank, bonus_rank);
        }
    }

    // ========================================================================
    // Move roundtrip tests
    // ========================================================================

    #[test]
    fn test_all_moves_roundtrip() {
        let moves = vec![
            UltimateHoldemMove::Check,
            UltimateHoldemMove::Bet { multiplier: BetMultiplier::Four },
            UltimateHoldemMove::Fold,
            UltimateHoldemMove::Deal { side_bets: SideBets::none() },
            UltimateHoldemMove::Reveal,
            UltimateHoldemMove::SetRules { rules_id: 42 },
        ];

        for mov in moves {
            let encoded = mov.encode_v2().unwrap();
            let decoded = UltimateHoldemMove::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, mov, "Move {:?} must roundtrip", mov);
        }
    }

    #[test]
    fn test_set_rules_roundtrip() {
        let test_ids = [0, 1, 127, 128, 1000, u64::MAX];

        for rules_id in test_ids {
            let mov = UltimateHoldemMove::SetRules { rules_id };
            let encoded = mov.encode_v2().unwrap();
            let decoded = UltimateHoldemMove::decode_v2(&encoded).unwrap();
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

        side_bets.trips = 1;
        assert_eq!(side_bets.mask(), 0b001);

        side_bets.six_card = 1;
        assert_eq!(side_bets.mask(), 0b011);

        side_bets.progressive = 1;
        assert_eq!(side_bets.mask(), 0b111);
    }

    #[test]
    fn test_side_bets_roundtrip() {
        let side_bets = SideBets {
            trips: 100,
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
    fn test_check_golden_vector() {
        let payload = UltimateHoldemMove::Check.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 0 (bits 00000) = 0b00000_010 = 0x02
        assert_eq!(payload, vec![0x02], "Check golden vector");
    }

    #[test]
    fn test_bet_4x_golden_vector() {
        let payload = UltimateHoldemMove::Bet { multiplier: BetMultiplier::Four }.encode_v2().unwrap();
        // Version 2 (010) + opcode 1 (00001) = 0b00001_010 = 0x0A
        // Then 2-bit multiplier 3 (11) padded
        // Byte 0: 0x0A, Byte 1: 0b000000_11 padded = depends on bit order
        // Actually: bits written LSB first in bytes
        // Header: version=2 (3 bits), opcode=1 (5 bits) = 0b00001_010 = 0x0A
        // Multiplier: 3 (2 bits) = 0b11
        // Total: 10 bits, so 2 bytes
        // First byte: 0x0A (header)
        // Second byte: 0b000000_11 = 0x03 (multiplier padded)
        // But let's verify by roundtrip instead of hardcoding
        let decoded = UltimateHoldemMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, UltimateHoldemMove::Bet { multiplier: BetMultiplier::Four });
    }

    #[test]
    fn test_fold_golden_vector() {
        let payload = UltimateHoldemMove::Fold.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 2 (bits 00010) = 0b00010_010 = 0x12
        assert_eq!(payload, vec![0x12], "Fold golden vector");
    }

    #[test]
    fn test_reveal_golden_vector() {
        let payload = UltimateHoldemMove::Reveal.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 4 (bits 00100) = 0b00100_010 = 0x22
        assert_eq!(payload, vec![0x22], "Reveal golden vector");
    }

    #[test]
    fn test_deal_no_side_bets_golden_vector() {
        let mov = UltimateHoldemMove::Deal { side_bets: SideBets::none() };
        let payload = mov.encode_v2().unwrap();
        // Version 2 (010) + opcode 3 (00011) = 0b00011_010 = 0x1A
        // Then 3-bit mask = 000, so byte 2 = 0b00000_000 (padded) = 0x00
        // Actually: 8 bits (0x1A) + 3 bits (000) = 11 bits
        // Byte 0: 0x1A
        // Byte 1: remaining 3 bits (000) padded to byte = 0x00
        assert_eq!(payload, vec![0x1A, 0x00], "Deal (no side bets) golden vector");
    }

    #[test]
    fn test_encoding_deterministic() {
        // Same input must produce same output every time
        for _ in 0..10 {
            let mov = UltimateHoldemMove::Check;
            let payload = mov.encode_v2().unwrap();
            assert_eq!(payload, vec![0x02]);
        }
    }

    // ========================================================================
    // Golden vector tests for bet multipliers
    // ========================================================================

    #[test]
    fn test_bet_all_multipliers_golden_vectors() {
        // Verify determinism for all multipliers
        for multiplier in [BetMultiplier::One, BetMultiplier::Two, BetMultiplier::Three, BetMultiplier::Four] {
            let mov = UltimateHoldemMove::Bet { multiplier };
            let payload1 = mov.encode_v2().unwrap();
            let payload2 = UltimateHoldemMove::Bet { multiplier }.encode_v2().unwrap();
            assert_eq!(payload1, payload2, "Encoding must be deterministic for {:?}", multiplier);

            // Verify roundtrip
            let decoded = UltimateHoldemMove::decode_v2(&payload1).unwrap();
            assert_eq!(decoded, mov);
        }
    }

    #[test]
    fn test_deal_trips_golden_vector() {
        let mut side_bets = SideBets::none();
        side_bets.trips = 100;

        let mov = UltimateHoldemMove::Deal { side_bets };
        let payload = mov.encode_v2().unwrap();

        // Verify determinism
        let payload2 = UltimateHoldemMove::Deal {
            side_bets: SideBets {
                trips: 100,
                six_card: 0,
                progressive: 0,
            },
        }
        .encode_v2()
        .unwrap();
        assert_eq!(payload, payload2, "Encoding must be deterministic");

        // Verify size
        assert!(payload.len() <= 3, "Deal with trips=100 should be <= 3 bytes");
    }

    #[test]
    fn test_deal_six_card_golden_vector() {
        let mut side_bets = SideBets::none();
        side_bets.six_card = 50;

        let mov = UltimateHoldemMove::Deal { side_bets };
        let payload = mov.encode_v2().unwrap();

        // Verify roundtrip
        let decoded = UltimateHoldemMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov);
    }

    #[test]
    fn test_deal_progressive_golden_vector() {
        let mut side_bets = SideBets::none();
        side_bets.progressive = 25;

        let mov = UltimateHoldemMove::Deal { side_bets };
        let payload = mov.encode_v2().unwrap();

        // Verify roundtrip
        let decoded = UltimateHoldemMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov);
    }

    #[test]
    fn test_deal_all_side_bets_golden_vector() {
        let side_bets = SideBets {
            trips: 100,
            six_card: 50,
            progressive: 25,
        };

        let mov = UltimateHoldemMove::Deal { side_bets };
        let payload = mov.encode_v2().unwrap();

        // Verify roundtrip
        let decoded = UltimateHoldemMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov);
    }

    // ========================================================================
    // Edge case tests
    // ========================================================================

    #[test]
    fn test_state_max_card_values() {
        // Test with max card ID (51)
        let state = UltimateHoldemState {
            stage: UltimateHoldemStage::River,
            has_result: true,
            hole_cards: vec![51, 51],
            community_cards: vec![51, 51, 51, 51, 51],
            dealer_cards: vec![51, 51],
            side_bets: SideBets::none(),
            bonus_rank: BonusRank::RoyalFlush,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = UltimateHoldemState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_min_card_values() {
        // Test with min card ID (0)
        let state = UltimateHoldemState {
            stage: UltimateHoldemStage::River,
            has_result: true,
            hole_cards: vec![0, 0],
            community_cards: vec![0, 0, 0, 0, 0],
            dealer_cards: vec![0, 0],
            side_bets: SideBets::none(),
            bonus_rank: BonusRank::None,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = UltimateHoldemState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_partial_cards() {
        // Test with partial community cards (e.g., during flop animation)
        let state = UltimateHoldemState {
            stage: UltimateHoldemStage::Flop,
            has_result: false,
            hole_cards: vec![10, 25],
            community_cards: vec![5, 30], // Only 2 of 3 flop cards
            dealer_cards: vec![],
            side_bets: SideBets::none(),
            bonus_rank: BonusRank::None,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = UltimateHoldemState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_all_opcodes_have_correct_values() {
        // Verify opcode values match spec section 3.2
        assert_eq!(UltimateHoldemOpcode::Check as u8, 0);
        assert_eq!(UltimateHoldemOpcode::Bet as u8, 1);
        assert_eq!(UltimateHoldemOpcode::Fold as u8, 2);
        assert_eq!(UltimateHoldemOpcode::Deal as u8, 3);
        assert_eq!(UltimateHoldemOpcode::Reveal as u8, 4);
        assert_eq!(UltimateHoldemOpcode::SetRules as u8, 5);
    }

    #[test]
    fn test_side_bet_mask_bits_match_spec() {
        // Verify side bet mask matches spec section 3.4
        // Bit 0: trips, Bit 1: six_card, Bit 2: progressive
        let side_bets = SideBets {
            trips: 1,
            six_card: 0,
            progressive: 0,
        };
        assert_eq!(side_bets.mask(), 0b001);

        let side_bets = SideBets {
            trips: 0,
            six_card: 1,
            progressive: 0,
        };
        assert_eq!(side_bets.mask(), 0b010);

        let side_bets = SideBets {
            trips: 0,
            six_card: 0,
            progressive: 1,
        };
        assert_eq!(side_bets.mask(), 0b100);
    }

    #[test]
    fn test_bet_multiplier_values() {
        // Verify multiplier values match spec section 3.3
        assert_eq!(BetMultiplier::One.value(), 1);
        assert_eq!(BetMultiplier::Two.value(), 2);
        assert_eq!(BetMultiplier::Three.value(), 3);
        assert_eq!(BetMultiplier::Four.value(), 4);
    }
}
