//! Blackjack v2 compact encoding (spec: `compact-encoding-blackjack.md`).
//!
//! This module implements the bitwise compact encoding for blackjack move payloads
//! and state blobs as defined in the spec. All bit layouts are canonical; JS/TS
//! consumes generated artifacts.
//!
//! # Move Payload Encoding
//!
//! All blackjack moves use a 1-byte header:
//! - `version` (3 bits): Protocol version (2 for v2)
//! - `opcode` (5 bits): Action type (0-7)
//!
//! Most actions (Hit, Stand, Double, Split, Surrender, Reveal) are header-only (1 byte).
//! Deal includes an optional side bet mask and amounts.
//!
//! # State Blob Encoding
//!
//! State is encoded compactly using:
//! - 6-bit card IDs (0-51)
//! - 2-bit bet multipliers
//! - 3-bit hand status
//! - ULEB128 for variable amounts

use crate::codec::{BitReader, BitWriter, CodecError, CodecResult, DualDecoder, EncodingVersion, PayloadHeader};

// ============================================================================
// Blackjack Opcodes (v2)
// ============================================================================

/// Blackjack action opcodes for v2 compact encoding.
///
/// These map to the opcode values in the 5-bit opcode field of the header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum BlackjackOpcode {
    /// Player requests another card.
    Hit = 0,
    /// Player stands with current hand.
    Stand = 1,
    /// Player doubles down (doubles bet, takes one card, then stands).
    Double = 2,
    /// Player splits a pair into two hands.
    Split = 3,
    /// Start a new hand with optional side bets.
    Deal = 4,
    /// Player surrenders (forfeits half the bet).
    Surrender = 5,
    /// Dealer reveals hole card.
    Reveal = 6,
    /// Set table rules variant.
    SetRules = 7,
}

impl BlackjackOpcode {
    /// All opcodes that produce a 1-byte payload (header only).
    pub const HEADER_ONLY: [Self; 6] = [
        Self::Hit,
        Self::Stand,
        Self::Double,
        Self::Split,
        Self::Surrender,
        Self::Reveal,
    ];

    /// Check if this opcode produces a header-only (1 byte) payload.
    #[must_use]
    pub const fn is_header_only(&self) -> bool {
        matches!(
            self,
            Self::Hit | Self::Stand | Self::Double | Self::Split | Self::Surrender | Self::Reveal
        )
    }
}

impl TryFrom<u8> for BlackjackOpcode {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Hit),
            1 => Ok(Self::Stand),
            2 => Ok(Self::Double),
            3 => Ok(Self::Split),
            4 => Ok(Self::Deal),
            5 => Ok(Self::Surrender),
            6 => Ok(Self::Reveal),
            7 => Ok(Self::SetRules),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 7, // max opcode
            }),
        }
    }
}

// ============================================================================
// Side Bet Types
// ============================================================================

/// Side bet types in fixed order for the side_bet_mask.
///
/// The mask uses 5 bits, one for each possible side bet:
/// - Bit 0: 21+3
/// - Bit 1: Lucky Ladies
/// - Bit 2: Perfect Pairs
/// - Bit 3: Bust It
/// - Bit 4: Royal Match
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum SideBetType {
    /// 21+3: Player's two cards + dealer upcard form poker hand.
    TwentyOnePlus3 = 0,
    /// Lucky Ladies: Player's first two cards total 20.
    LuckyLadies = 1,
    /// Perfect Pairs: Player's first two cards are a pair.
    PerfectPairs = 2,
    /// Bust It: Dealer busts with specific card count.
    BustIt = 3,
    /// Royal Match: Player's first two cards are suited.
    RoyalMatch = 4,
}

impl SideBetType {
    /// Number of supported side bet types.
    pub const COUNT: usize = 5;

    /// Bit width for the side bet mask.
    pub const MASK_BITS: usize = 5;

    /// All side bet types in order.
    pub const ALL: [Self; 5] = [
        Self::TwentyOnePlus3,
        Self::LuckyLadies,
        Self::PerfectPairs,
        Self::BustIt,
        Self::RoyalMatch,
    ];
}

/// Side bets for a deal action.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SideBets {
    /// Amount for 21+3 bet (0 if not placed).
    pub twenty_one_plus_3: u64,
    /// Amount for Lucky Ladies bet (0 if not placed).
    pub lucky_ladies: u64,
    /// Amount for Perfect Pairs bet (0 if not placed).
    pub perfect_pairs: u64,
    /// Amount for Bust It bet (0 if not placed).
    pub bust_it: u64,
    /// Amount for Royal Match bet (0 if not placed).
    pub royal_match: u64,
}

impl SideBets {
    /// Create empty side bets (no bets placed).
    #[must_use]
    pub const fn none() -> Self {
        Self {
            twenty_one_plus_3: 0,
            lucky_ladies: 0,
            perfect_pairs: 0,
            bust_it: 0,
            royal_match: 0,
        }
    }

    /// Check if any side bets are placed.
    #[must_use]
    pub fn has_any(&self) -> bool {
        self.twenty_one_plus_3 > 0
            || self.lucky_ladies > 0
            || self.perfect_pairs > 0
            || self.bust_it > 0
            || self.royal_match > 0
    }

    /// Generate the 5-bit mask for set side bets.
    #[must_use]
    pub fn mask(&self) -> u8 {
        let mut mask = 0u8;
        if self.twenty_one_plus_3 > 0 {
            mask |= 1 << SideBetType::TwentyOnePlus3 as u8;
        }
        if self.lucky_ladies > 0 {
            mask |= 1 << SideBetType::LuckyLadies as u8;
        }
        if self.perfect_pairs > 0 {
            mask |= 1 << SideBetType::PerfectPairs as u8;
        }
        if self.bust_it > 0 {
            mask |= 1 << SideBetType::BustIt as u8;
        }
        if self.royal_match > 0 {
            mask |= 1 << SideBetType::RoyalMatch as u8;
        }
        mask
    }

    /// Get the amount for a side bet type.
    #[must_use]
    pub fn amount(&self, bet_type: SideBetType) -> u64 {
        match bet_type {
            SideBetType::TwentyOnePlus3 => self.twenty_one_plus_3,
            SideBetType::LuckyLadies => self.lucky_ladies,
            SideBetType::PerfectPairs => self.perfect_pairs,
            SideBetType::BustIt => self.bust_it,
            SideBetType::RoyalMatch => self.royal_match,
        }
    }

    /// Set the amount for a side bet type.
    pub fn set_amount(&mut self, bet_type: SideBetType, amount: u64) {
        match bet_type {
            SideBetType::TwentyOnePlus3 => self.twenty_one_plus_3 = amount,
            SideBetType::LuckyLadies => self.lucky_ladies = amount,
            SideBetType::PerfectPairs => self.perfect_pairs = amount,
            SideBetType::BustIt => self.bust_it = amount,
            SideBetType::RoyalMatch => self.royal_match = amount,
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
    /// - side_bet_mask (5 bits)
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

/// A blackjack move action with optional payload data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlackjackMove {
    /// Hit: request another card.
    Hit,
    /// Stand: keep current hand.
    Stand,
    /// Double: double bet and take one card.
    Double,
    /// Split: split a pair into two hands.
    Split,
    /// Deal: start a new hand with optional side bets.
    Deal { side_bets: SideBets },
    /// Surrender: forfeit half the bet.
    Surrender,
    /// Reveal: dealer reveals hole card.
    Reveal,
    /// SetRules: configure table rules.
    SetRules { rules_id: u64 },
}

impl BlackjackMove {
    /// Get the opcode for this move.
    #[must_use]
    pub fn opcode(&self) -> BlackjackOpcode {
        match self {
            Self::Hit => BlackjackOpcode::Hit,
            Self::Stand => BlackjackOpcode::Stand,
            Self::Double => BlackjackOpcode::Double,
            Self::Split => BlackjackOpcode::Split,
            Self::Deal { .. } => BlackjackOpcode::Deal,
            Self::Surrender => BlackjackOpcode::Surrender,
            Self::Reveal => BlackjackOpcode::Reveal,
            Self::SetRules { .. } => BlackjackOpcode::SetRules,
        }
    }

    /// Encode this move as a v2 compact payload.
    ///
    /// # Returns
    /// The encoded bytes. Header-only moves (Hit, Stand, etc.) return 1 byte.
    pub fn encode_v2(&self) -> CodecResult<Vec<u8>> {
        let mut writer = BitWriter::new();
        let header = PayloadHeader::new(self.opcode() as u8);
        header.encode(&mut writer)?;

        match self {
            Self::Hit | Self::Stand | Self::Double | Self::Split | Self::Surrender | Self::Reveal => {
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
        let opcode = BlackjackOpcode::try_from(header.opcode)?;

        Ok(match opcode {
            BlackjackOpcode::Hit => Self::Hit,
            BlackjackOpcode::Stand => Self::Stand,
            BlackjackOpcode::Double => Self::Double,
            BlackjackOpcode::Split => Self::Split,
            BlackjackOpcode::Surrender => Self::Surrender,
            BlackjackOpcode::Reveal => Self::Reveal,
            BlackjackOpcode::Deal => {
                let side_bets = SideBets::decode(&mut reader)?;
                Self::Deal { side_bets }
            }
            BlackjackOpcode::SetRules => {
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

/// Blackjack game stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum BlackjackStage {
    /// Waiting for bets.
    #[default]
    Betting = 0,
    /// Player's turn to act.
    PlayerTurn = 1,
    /// Waiting for dealer reveal.
    AwaitingReveal = 2,
    /// Hand is complete.
    Complete = 3,
}

impl TryFrom<u8> for BlackjackStage {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Betting),
            1 => Ok(Self::PlayerTurn),
            2 => Ok(Self::AwaitingReveal),
            3 => Ok(Self::Complete),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 3, // max stage
            }),
        }
    }
}

/// Hand status after resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum HandStatus {
    /// Hand is active (not yet resolved).
    #[default]
    Active = 0,
    /// Player stands.
    Stand = 1,
    /// Player busted.
    Bust = 2,
    /// Player has blackjack.
    Blackjack = 3,
    /// Player surrendered.
    Surrendered = 4,
    /// Player won.
    Won = 5,
    /// Player lost.
    Lost = 6,
    /// Push (tie).
    Push = 7,
}

impl TryFrom<u8> for HandStatus {
    type Error = CodecError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Active),
            1 => Ok(Self::Stand),
            2 => Ok(Self::Bust),
            3 => Ok(Self::Blackjack),
            4 => Ok(Self::Surrendered),
            5 => Ok(Self::Won),
            6 => Ok(Self::Lost),
            7 => Ok(Self::Push),
            _ => Err(CodecError::InvalidVersion {
                version: value,
                expected: 7, // max status
            }),
        }
    }
}

/// A single player hand.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BlackjackHand {
    /// Cards in the hand (6-bit IDs, 0-51).
    pub cards: Vec<u8>,
    /// Bet multiplier (1x, 2x for double, etc.). Encoded in 2 bits (0-3).
    pub bet_mult: u8,
    /// Current status.
    pub status: HandStatus,
    /// Whether this hand resulted from a split.
    pub was_split: bool,
}

impl BlackjackHand {
    /// Maximum cards per hand (8, encoded in 3 bits).
    pub const MAX_CARDS: usize = 8;

    /// Bit width for card count field.
    pub const CARD_COUNT_BITS: usize = 3;

    /// Bit width for bet multiplier field.
    pub const BET_MULT_BITS: usize = 2;

    /// Bit width for status field.
    pub const STATUS_BITS: usize = 3;

    /// Bit width for a single card (0-51 fits in 6 bits).
    pub const CARD_BITS: usize = 6;

    /// Encode this hand to a BitWriter.
    pub fn encode(&self, writer: &mut BitWriter) -> CodecResult<()> {
        let card_count = self.cards.len().min(Self::MAX_CARDS);
        writer.write_bits(card_count as u64, Self::CARD_COUNT_BITS)?;
        writer.write_bits(self.bet_mult as u64, Self::BET_MULT_BITS)?;
        writer.write_bits(self.status as u8 as u64, Self::STATUS_BITS)?;
        writer.write_bit(self.was_split)?;

        for &card in self.cards.iter().take(Self::MAX_CARDS) {
            writer.write_bits(card as u64, Self::CARD_BITS)?;
        }

        Ok(())
    }

    /// Decode a hand from a BitReader.
    pub fn decode(reader: &mut BitReader) -> CodecResult<Self> {
        let card_count = reader.read_bits(Self::CARD_COUNT_BITS)? as usize;
        let bet_mult = reader.read_bits(Self::BET_MULT_BITS)? as u8;
        let status = HandStatus::try_from(reader.read_bits(Self::STATUS_BITS)? as u8)?;
        let was_split = reader.read_bit()?;

        let mut cards = Vec::with_capacity(card_count);
        for _ in 0..card_count {
            cards.push(reader.read_bits(Self::CARD_BITS)? as u8);
        }

        Ok(Self {
            cards,
            bet_mult,
            status,
            was_split,
        })
    }

    /// Calculate the encoded bit size of this hand.
    #[must_use]
    pub fn bit_size(&self) -> usize {
        Self::CARD_COUNT_BITS
            + Self::BET_MULT_BITS
            + Self::STATUS_BITS
            + 1 // was_split
            + self.cards.len().min(Self::MAX_CARDS) * Self::CARD_BITS
    }
}

/// Complete blackjack state blob.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BlackjackState {
    /// Current game stage.
    pub stage: BlackjackStage,
    /// Player hands (up to 4 due to splits).
    pub hands: Vec<BlackjackHand>,
    /// Index of the active hand (during player turn).
    pub active_hand_index: u8,
    /// Dealer's cards.
    pub dealer_cards: Vec<u8>,
    /// Side bets for this hand.
    pub side_bets: SideBets,
}

impl BlackjackState {
    /// Maximum number of hands (4, encoded in 3 bits to handle 0-4 range).
    pub const MAX_HANDS: usize = 4;

    /// Maximum dealer cards (8, encoded in 3 bits).
    pub const MAX_DEALER_CARDS: usize = 8;

    /// Bit widths for header fields.
    pub const VERSION_BITS: usize = 3;
    pub const STAGE_BITS: usize = 2;
    /// 3 bits to store 0-4 hand count (0-7 range, but capped at 4).
    pub const HAND_COUNT_BITS: usize = 3;
    pub const ACTIVE_HAND_BITS: usize = 2;
    pub const DEALER_COUNT_BITS: usize = 3;

    /// Encode this state as a v2 compact blob.
    pub fn encode_v2(&self) -> CodecResult<Vec<u8>> {
        let mut writer = BitWriter::new();

        // Header
        writer.write_bits(PayloadHeader::V2 as u64, Self::VERSION_BITS)?;
        writer.write_bits(self.stage as u8 as u64, Self::STAGE_BITS)?;

        let hand_count = self.hands.len().min(Self::MAX_HANDS);
        writer.write_bits(hand_count as u64, Self::HAND_COUNT_BITS)?;
        writer.write_bits(self.active_hand_index as u64, Self::ACTIVE_HAND_BITS)?;

        let dealer_count = self.dealer_cards.len().min(Self::MAX_DEALER_CARDS);
        writer.write_bits(dealer_count as u64, Self::DEALER_COUNT_BITS)?;

        // Hands
        for hand in self.hands.iter().take(Self::MAX_HANDS) {
            hand.encode(&mut writer)?;
        }

        // Dealer cards
        for &card in self.dealer_cards.iter().take(Self::MAX_DEALER_CARDS) {
            writer.write_bits(card as u64, BlackjackHand::CARD_BITS)?;
        }

        // Side bets
        self.side_bets.encode(&mut writer)?;

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

        let stage = BlackjackStage::try_from(reader.read_bits(Self::STAGE_BITS)? as u8)?;
        let hand_count = reader.read_bits(Self::HAND_COUNT_BITS)? as usize;
        let active_hand_index = reader.read_bits(Self::ACTIVE_HAND_BITS)? as u8;
        let dealer_count = reader.read_bits(Self::DEALER_COUNT_BITS)? as usize;

        // Hands
        let mut hands = Vec::with_capacity(hand_count);
        for _ in 0..hand_count {
            hands.push(BlackjackHand::decode(&mut reader)?);
        }

        // Dealer cards
        let mut dealer_cards = Vec::with_capacity(dealer_count);
        for _ in 0..dealer_count {
            dealer_cards.push(reader.read_bits(BlackjackHand::CARD_BITS)? as u8);
        }

        // Side bets
        let side_bets = SideBets::decode(&mut reader)?;

        Ok(Self {
            stage,
            hands,
            active_hand_index,
            dealer_cards,
            side_bets,
        })
    }

    /// Estimate the v1 JSON-style encoding size for comparison.
    ///
    /// This is a rough estimate based on typical v1 field sizes:
    /// - stage: 1 byte enum + padding
    /// - hands: array overhead + per-hand (cards array + status + bet_mult + flags)
    /// - dealer_cards: array overhead + cards
    /// - side_bets: object with 5 optional u64 fields
    #[must_use]
    pub fn estimate_v1_size(&self) -> usize {
        let base_overhead = 16; // object wrapper, padding
        let stage_size = 4; // enum with padding
        let hand_array_overhead = 8;
        let hand_size = |h: &BlackjackHand| {
            8 // array overhead for cards
            + h.cards.len() * 1 // 1 byte per card
            + 4 // bet_mult
            + 4 // status
            + 1 // was_split
            + 7 // padding
        };
        let dealer_size = 8 + self.dealer_cards.len();
        let side_bet_size = if self.side_bets.has_any() {
            8 + self.side_bets.count() * 8 // object overhead + u64 per bet
        } else {
            8 // empty object
        };

        base_overhead
            + stage_size
            + hand_array_overhead
            + self.hands.iter().map(hand_size).sum::<usize>()
            + dealer_size
            + side_bet_size
    }

    /// Calculate the actual v2 encoded size.
    #[must_use]
    pub fn v2_size(&self) -> usize {
        // Header bits
        let header_bits = Self::VERSION_BITS
            + Self::STAGE_BITS
            + Self::HAND_COUNT_BITS
            + Self::ACTIVE_HAND_BITS
            + Self::DEALER_COUNT_BITS;

        // Hand bits
        let hand_bits: usize = self.hands.iter().map(|h| h.bit_size()).sum();

        // Dealer card bits
        let dealer_bits = self.dealer_cards.len().min(Self::MAX_DEALER_CARDS) * BlackjackHand::CARD_BITS;

        // Side bet bits (mask + ULEB128 amounts)
        let side_bet_bits = SideBetType::MASK_BITS;
        let side_bet_bytes: usize = SideBetType::ALL
            .iter()
            .filter(|&&bt| self.side_bets.amount(bt) > 0)
            .map(|&bt| crate::codec::encode_uleb128(self.side_bets.amount(bt)).len())
            .sum();

        let total_bits = header_bits + hand_bits + dealer_bits + side_bet_bits;
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
    // AC-1.1: Header-only actions are 1 byte
    // ========================================================================

    #[test]
    fn test_hit_payload_1_byte_ac_1_1() {
        let payload = BlackjackMove::Hit.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "AC-1.1: Hit must be 1 byte");
    }

    #[test]
    fn test_stand_payload_1_byte_ac_1_1() {
        let payload = BlackjackMove::Stand.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "AC-1.1: Stand must be 1 byte");
    }

    #[test]
    fn test_double_payload_1_byte_ac_1_1() {
        let payload = BlackjackMove::Double.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "AC-1.1: Double must be 1 byte");
    }

    #[test]
    fn test_split_payload_1_byte_ac_1_1() {
        let payload = BlackjackMove::Split.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "AC-1.1: Split must be 1 byte");
    }

    #[test]
    fn test_surrender_payload_1_byte_ac_1_1() {
        let payload = BlackjackMove::Surrender.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "AC-1.1: Surrender must be 1 byte");
    }

    #[test]
    fn test_reveal_payload_1_byte_ac_1_1() {
        let payload = BlackjackMove::Reveal.encode_v2().unwrap();
        assert_eq!(payload.len(), 1, "AC-1.1: Reveal must be 1 byte");
    }

    #[test]
    fn test_all_header_only_actions_1_byte_ac_1_1() {
        for opcode in BlackjackOpcode::HEADER_ONLY {
            let mov = match opcode {
                BlackjackOpcode::Hit => BlackjackMove::Hit,
                BlackjackOpcode::Stand => BlackjackMove::Stand,
                BlackjackOpcode::Double => BlackjackMove::Double,
                BlackjackOpcode::Split => BlackjackMove::Split,
                BlackjackOpcode::Surrender => BlackjackMove::Surrender,
                BlackjackOpcode::Reveal => BlackjackMove::Reveal,
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
    // AC-1.2: Deal with no side bets is 2 bytes
    // ========================================================================

    #[test]
    fn test_deal_no_side_bets_2_bytes_ac_1_2() {
        let mov = BlackjackMove::Deal {
            side_bets: SideBets::none(),
        };
        let payload = mov.encode_v2().unwrap();
        // 1 byte header + 5 bits side_bet_mask (all zeros) padded to 1 byte
        // Actually: 8 bits header + 5 bits mask = 13 bits = 2 bytes
        assert_eq!(payload.len(), 2, "AC-1.2: Deal with no side bets must be 2 bytes");
    }

    #[test]
    fn test_deal_with_one_side_bet_size() {
        let mut side_bets = SideBets::none();
        side_bets.twenty_one_plus_3 = 100; // ULEB128(100) = 1 byte

        let mov = BlackjackMove::Deal { side_bets };
        let payload = mov.encode_v2().unwrap();

        // 8 bits header + 5 bits mask + 8 bits ULEB128(100) = 21 bits = 3 bytes
        assert_eq!(payload.len(), 3, "Deal with one side bet (100) should be 3 bytes");
    }

    #[test]
    fn test_deal_with_multiple_side_bets_size() {
        let mut side_bets = SideBets::none();
        side_bets.twenty_one_plus_3 = 50;  // ULEB128(50) = 1 byte
        side_bets.perfect_pairs = 75;      // ULEB128(75) = 1 byte
        side_bets.royal_match = 200;       // ULEB128(200) = 2 bytes

        let mov = BlackjackMove::Deal { side_bets };
        let payload = mov.encode_v2().unwrap();

        // 8 bits header + 5 bits mask + 1+1+2 bytes amounts = 13 bits + 4 bytes
        // = 2 bytes (header+mask) + 4 bytes (amounts) = 6 bytes
        assert!(payload.len() <= 6, "Deal with 3 side bets should be <=6 bytes");
    }

    // ========================================================================
    // AC-2.1: State blob compaction >= 35%
    // ========================================================================

    #[test]
    fn test_typical_state_compaction_ac_2_1() {
        // Typical mid-game state: 1 hand with 3 cards, dealer with 2 cards
        let state = BlackjackState {
            stage: BlackjackStage::PlayerTurn,
            hands: vec![BlackjackHand {
                cards: vec![10, 25, 40], // 3 cards
                bet_mult: 1,
                status: HandStatus::Active,
                was_split: false,
            }],
            active_hand_index: 0,
            dealer_cards: vec![5, 51], // 2 cards
            side_bets: SideBets::none(),
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
    fn test_split_hand_state_compaction_ac_2_1() {
        // State with split hands (4 hands, each with 2 cards)
        let state = BlackjackState {
            stage: BlackjackStage::PlayerTurn,
            hands: vec![
                BlackjackHand {
                    cards: vec![10, 25],
                    bet_mult: 1,
                    status: HandStatus::Stand,
                    was_split: true,
                },
                BlackjackHand {
                    cards: vec![10, 30],
                    bet_mult: 2, // doubled
                    status: HandStatus::Stand,
                    was_split: true,
                },
                BlackjackHand {
                    cards: vec![10, 45],
                    bet_mult: 1,
                    status: HandStatus::Active,
                    was_split: true,
                },
                BlackjackHand {
                    cards: vec![10, 15],
                    bet_mult: 1,
                    status: HandStatus::Active,
                    was_split: true,
                },
            ],
            active_hand_index: 2,
            dealer_cards: vec![5, 51],
            side_bets: SideBets::none(),
        };

        let v2_bytes = state.encode_v2().unwrap();
        let v1_estimate = state.estimate_v1_size();

        let reduction = 1.0 - (v2_bytes.len() as f64 / v1_estimate as f64);
        assert!(
            reduction >= 0.35,
            "AC-2.1: Split hand state compaction must be >= 35%, got {:.1}% (v1={}, v2={})",
            reduction * 100.0,
            v1_estimate,
            v2_bytes.len()
        );
    }

    #[test]
    fn test_state_with_side_bets_compaction_ac_2_1() {
        let mut side_bets = SideBets::none();
        side_bets.twenty_one_plus_3 = 50;
        side_bets.perfect_pairs = 100;

        let state = BlackjackState {
            stage: BlackjackStage::Complete,
            hands: vec![BlackjackHand {
                cards: vec![10, 25, 40],
                bet_mult: 1,
                status: HandStatus::Won,
                was_split: false,
            }],
            active_hand_index: 0,
            dealer_cards: vec![5, 51, 30],
            side_bets,
        };

        let v2_bytes = state.encode_v2().unwrap();
        let v1_estimate = state.estimate_v1_size();

        let reduction = 1.0 - (v2_bytes.len() as f64 / v1_estimate as f64);
        assert!(
            reduction >= 0.35,
            "AC-2.1: Side bet state compaction must be >= 35%, got {:.1}% (v1={}, v2={})",
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
        let mov = BlackjackMove::Hit;
        let payload = mov.encode_v2().unwrap();

        // Should decode successfully
        let decoded = BlackjackMove::decode_v2(&payload).unwrap();
        assert_eq!(decoded, mov, "AC-3.1: v2 payload must decode correctly");
    }

    #[test]
    fn test_v2_deal_roundtrip_ac_3_1() {
        let mut side_bets = SideBets::none();
        side_bets.lucky_ladies = 250;
        side_bets.bust_it = 100;

        let original = BlackjackMove::Deal { side_bets };
        let payload = original.encode_v2().unwrap();
        let decoded = BlackjackMove::decode_v2(&payload).unwrap();

        assert_eq!(decoded, original, "AC-3.1: Deal with side bets must roundtrip");
    }

    #[test]
    fn test_dual_decode_v2_payload_ac_3_1() {
        let mov = BlackjackMove::Stand;
        let payload = mov.encode_v2().unwrap();

        // Dual decode should return Some for v2
        let result = BlackjackMove::decode_dual(&payload).unwrap();
        assert!(result.is_some(), "AC-3.1: dual decode must return Some for v2");
        assert_eq!(result.unwrap(), mov);
    }

    #[test]
    fn test_dual_decode_v1_payload_returns_none_ac_3_1() {
        // Simulate a v1 payload (version bits = 1)
        let v1_payload = vec![0x01, 0x00, 0x00, 0x00];

        // Dual decode should return None for v1
        let result = BlackjackMove::decode_dual(&v1_payload).unwrap();
        assert!(result.is_none(), "AC-3.1: dual decode must return None for v1");
    }

    // ========================================================================
    // State blob roundtrip tests
    // ========================================================================

    #[test]
    fn test_state_roundtrip_empty() {
        let state = BlackjackState::default();
        let encoded = state.encode_v2().unwrap();
        let decoded = BlackjackState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_typical() {
        let state = BlackjackState {
            stage: BlackjackStage::PlayerTurn,
            hands: vec![BlackjackHand {
                cards: vec![10, 25],
                bet_mult: 1,
                status: HandStatus::Active,
                was_split: false,
            }],
            active_hand_index: 0,
            dealer_cards: vec![5],
            side_bets: SideBets::none(),
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = BlackjackState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_with_side_bets() {
        let mut side_bets = SideBets::none();
        side_bets.twenty_one_plus_3 = 100;
        side_bets.perfect_pairs = 50;

        let state = BlackjackState {
            stage: BlackjackStage::Complete,
            hands: vec![BlackjackHand {
                cards: vec![10, 25, 40],
                bet_mult: 2,
                status: HandStatus::Won,
                was_split: false,
            }],
            active_hand_index: 0,
            dealer_cards: vec![5, 51, 30],
            side_bets,
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = BlackjackState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn test_state_roundtrip_max_hands() {
        let state = BlackjackState {
            stage: BlackjackStage::PlayerTurn,
            hands: vec![
                BlackjackHand {
                    cards: vec![10, 25],
                    bet_mult: 1,
                    status: HandStatus::Stand,
                    was_split: true,
                },
                BlackjackHand {
                    cards: vec![10, 30, 45],
                    bet_mult: 2,
                    status: HandStatus::Bust,
                    was_split: true,
                },
                BlackjackHand {
                    cards: vec![10, 15],
                    bet_mult: 1,
                    status: HandStatus::Blackjack,
                    was_split: true,
                },
                BlackjackHand {
                    cards: vec![10, 20, 35, 5],
                    bet_mult: 1,
                    status: HandStatus::Active,
                    was_split: true,
                },
            ],
            active_hand_index: 3,
            dealer_cards: vec![5, 51],
            side_bets: SideBets::none(),
        };

        let encoded = state.encode_v2().unwrap();
        let decoded = BlackjackState::decode_v2(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    // ========================================================================
    // Move roundtrip tests
    // ========================================================================

    #[test]
    fn test_all_moves_roundtrip() {
        let moves = vec![
            BlackjackMove::Hit,
            BlackjackMove::Stand,
            BlackjackMove::Double,
            BlackjackMove::Split,
            BlackjackMove::Surrender,
            BlackjackMove::Reveal,
            BlackjackMove::Deal { side_bets: SideBets::none() },
            BlackjackMove::SetRules { rules_id: 42 },
        ];

        for mov in moves {
            let encoded = mov.encode_v2().unwrap();
            let decoded = BlackjackMove::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, mov, "Move {:?} must roundtrip", mov);
        }
    }

    #[test]
    fn test_set_rules_roundtrip() {
        let test_ids = [0, 1, 127, 128, 1000, u64::MAX];

        for rules_id in test_ids {
            let mov = BlackjackMove::SetRules { rules_id };
            let encoded = mov.encode_v2().unwrap();
            let decoded = BlackjackMove::decode_v2(&encoded).unwrap();
            assert_eq!(decoded, mov, "SetRules({}) must roundtrip", rules_id);
        }
    }

    // ========================================================================
    // Side bet encoding tests
    // ========================================================================

    #[test]
    fn test_side_bet_mask_encoding() {
        let mut side_bets = SideBets::none();
        assert_eq!(side_bets.mask(), 0b00000);

        side_bets.twenty_one_plus_3 = 1;
        assert_eq!(side_bets.mask(), 0b00001);

        side_bets.lucky_ladies = 1;
        assert_eq!(side_bets.mask(), 0b00011);

        side_bets.royal_match = 1;
        assert_eq!(side_bets.mask(), 0b10011);
    }

    #[test]
    fn test_side_bets_roundtrip() {
        let mut side_bets = SideBets::none();
        side_bets.twenty_one_plus_3 = 100;
        side_bets.perfect_pairs = 50;
        side_bets.bust_it = 200;

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
    fn test_hit_golden_vector() {
        let payload = BlackjackMove::Hit.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 0 (bits 00000) = 0b00000_010 = 0x02
        assert_eq!(payload, vec![0x02], "Hit golden vector");
    }

    #[test]
    fn test_stand_golden_vector() {
        let payload = BlackjackMove::Stand.encode_v2().unwrap();
        // Version 2 (bits 010) + opcode 1 (bits 00001) = 0b00001_010 = 0x0A
        assert_eq!(payload, vec![0x0A], "Stand golden vector");
    }

    #[test]
    fn test_deal_no_side_bets_golden_vector() {
        let mov = BlackjackMove::Deal { side_bets: SideBets::none() };
        let payload = mov.encode_v2().unwrap();
        // Version 2 (010) + opcode 4 (00100) = 0b00100_010 = 0x22
        // Then 5-bit mask = 00000, so byte 2 = 0b00000_000 (padded) = 0x00
        // Actually: 8 bits (0x22) + 5 bits (00000) = 13 bits
        // Byte 0: 0x22
        // Byte 1: remaining 5 bits (00000) padded to byte = 0x00
        assert_eq!(payload, vec![0x22, 0x00], "Deal (no side bets) golden vector");
    }

    #[test]
    fn test_encoding_deterministic() {
        // Same input must produce same output every time
        for _ in 0..10 {
            let mov = BlackjackMove::Hit;
            let payload = mov.encode_v2().unwrap();
            assert_eq!(payload, vec![0x02]);
        }
    }
}
