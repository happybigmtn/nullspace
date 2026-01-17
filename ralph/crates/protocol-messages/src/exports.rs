//! Canonical protocol exports for cross-language consumption.
//!
//! This module provides a structured export of all protocol constants, tags,
//! and wire format definitions. These exports are the **single source of truth**
//! for protocol encoding across all languages (Rust, TypeScript, etc.).
//!
//! # AC-1.1 Compliance
//!
//! This module satisfies AC-1.1: "Protocol tags, wire formats, and version
//! constants are defined in Rust and exported to JS/TS."
//!
//! # Usage
//!
//! ```
//! use protocol_messages::exports::{ProtocolExports, export_json};
//!
//! // Get structured exports
//! let exports = ProtocolExports::canonical();
//! assert_eq!(exports.versions.current, 1);
//!
//! // Export to JSON for JS/TS codegen
//! let json = export_json();
//! assert!(json.contains("\"current\": 1")); // version value
//! ```
//!
//! # Export Format
//!
//! The export includes:
//!
//! - **Version constants**: `CURRENT_PROTOCOL_VERSION`, `MIN_SUPPORTED_PROTOCOL_VERSION`, etc.
//! - **Size bounds**: `MAX_SEATS`, `MAX_REVEAL_CARDS`, etc.
//! - **Domain prefixes**: `domain.DEAL_COMMITMENT`, etc.
//! - **Reveal phases**: Enum values for `RevealPhase`
//! - **Wire format specifications**: Field sizes, encoding rules
//!
//! # Versioning
//!
//! The export itself is versioned via `EXPORT_SCHEMA_VERSION`. When the export
//! format changes (new fields, renamed fields), this version is bumped.
//! JS/TS consumers can use this to detect incompatible changes.

use serde::{Deserialize, Serialize};

use crate::{
    domain, CURRENT_PROTOCOL_VERSION, MAX_ARTIFACT_HASHES, MAX_ARTIFACT_SIZE, MAX_REVEAL_CARDS,
    MAX_REVEAL_DATA_SIZE, MAX_SEATS, MAX_SIGNATURE_SIZE, MAX_SUPPORTED_PROTOCOL_VERSION,
    MAX_TIMELOCK_PROOF_SIZE, MIN_SUPPORTED_PROTOCOL_VERSION,
};

/// Schema version for the export format.
///
/// Bump this when the export structure changes in a breaking way.
/// JS/TS consumers can check this to ensure compatibility.
///
/// Version history:
/// - v1: Initial export format (versions, size_bounds, domain_prefixes, reveal_phases, wire_formats)
/// - v2: Added consensus_payload_tags, game_action_codes, disabled_features (AC-1.1)
/// - v3: Added game_encodings with per-game v2 compact encoding opcodes (AC-3.1, AC-3.2)
pub const EXPORT_SCHEMA_VERSION: u32 = 3;

/// Complete protocol exports for cross-language consumption.
///
/// This struct contains all protocol constants needed to implement
/// encoding/decoding in other languages. It is serializable to JSON
/// for use by codegen tools.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProtocolExports {
    /// Schema version for this export format.
    pub schema_version: u32,

    /// Protocol version constants.
    pub versions: VersionConstants,

    /// Size bounds for DoS protection.
    pub size_bounds: SizeBounds,

    /// Domain separation prefixes for message hashing.
    pub domain_prefixes: DomainPrefixes,

    /// Reveal phase enum values.
    pub reveal_phases: RevealPhases,

    /// Wire format specifications.
    pub wire_formats: WireFormats,

    /// Consensus payload type tags.
    pub consensus_payload_tags: ConsensusPayloadTags,

    /// Game action type codes.
    pub game_action_codes: GameActionCodes,

    /// Disabled feature tags.
    pub disabled_features: DisabledFeatureTags,

    /// Game-specific v2 compact encodings (AC-3.1, AC-3.2).
    ///
    /// These define the opcode values and bit layouts for each casino game's
    /// compact encoding format. JS/TS should use these values instead of
    /// hand-maintained codec logic.
    pub game_encodings: GameEncodings,
}

impl ProtocolExports {
    /// Create the canonical protocol exports.
    ///
    /// This returns the authoritative protocol constants as defined in Rust.
    /// All other languages should derive their constants from this export.
    pub fn canonical() -> Self {
        Self {
            schema_version: EXPORT_SCHEMA_VERSION,
            versions: VersionConstants::canonical(),
            size_bounds: SizeBounds::canonical(),
            domain_prefixes: DomainPrefixes::canonical(),
            reveal_phases: RevealPhases::canonical(),
            wire_formats: WireFormats::canonical(),
            consensus_payload_tags: ConsensusPayloadTags::canonical(),
            game_action_codes: GameActionCodes::canonical(),
            disabled_features: DisabledFeatureTags::canonical(),
            game_encodings: GameEncodings::canonical(),
        }
    }
}

/// Protocol version constants.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VersionConstants {
    /// Current protocol version for new messages.
    pub current: u8,
    /// Minimum supported protocol version (inclusive).
    pub minimum: u8,
    /// Maximum supported protocol version (inclusive).
    pub maximum: u8,
}

impl VersionConstants {
    fn canonical() -> Self {
        Self {
            current: CURRENT_PROTOCOL_VERSION,
            minimum: MIN_SUPPORTED_PROTOCOL_VERSION,
            maximum: MAX_SUPPORTED_PROTOCOL_VERSION,
        }
    }
}

/// Size bounds for protocol fields (DoS protection).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SizeBounds {
    /// Maximum number of seats (players) in a hand.
    pub max_seats: usize,
    /// Maximum number of artifact hashes in a deal commitment.
    pub max_artifact_hashes: usize,
    /// Maximum number of cards that can be revealed in a single message.
    pub max_reveal_cards: usize,
    /// Maximum size of a single reveal data entry in bytes.
    pub max_reveal_data_size: usize,
    /// Maximum size of a timelock proof in bytes.
    pub max_timelock_proof_size: usize,
    /// Maximum signature size in bytes.
    pub max_signature_size: usize,
    /// Maximum artifact data size in bytes.
    pub max_artifact_size: usize,
}

impl SizeBounds {
    fn canonical() -> Self {
        Self {
            max_seats: MAX_SEATS,
            max_artifact_hashes: MAX_ARTIFACT_HASHES,
            max_reveal_cards: MAX_REVEAL_CARDS,
            max_reveal_data_size: MAX_REVEAL_DATA_SIZE,
            max_timelock_proof_size: MAX_TIMELOCK_PROOF_SIZE,
            max_signature_size: MAX_SIGNATURE_SIZE,
            max_artifact_size: MAX_ARTIFACT_SIZE,
        }
    }
}

/// Domain separation prefixes for message hashing.
///
/// These prefixes are prepended to message preimages before hashing
/// to prevent cross-protocol hash collisions.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DomainPrefixes {
    /// Prefix for DealCommitment messages.
    pub deal_commitment: String,
    /// Prefix for DealCommitmentAck messages.
    pub deal_commitment_ack: String,
    /// Prefix for RevealShare messages.
    pub reveal_share: String,
    /// Prefix for TimelockReveal messages.
    pub timelock_reveal: String,
    /// Prefix for ArtifactRequest messages.
    pub artifact_request: String,
    /// Prefix for ArtifactResponse messages.
    pub artifact_response: String,
    /// Prefix for ShuffleContext binding.
    pub shuffle_context: String,
}

impl DomainPrefixes {
    fn canonical() -> Self {
        Self {
            deal_commitment: String::from_utf8_lossy(domain::DEAL_COMMITMENT).into_owned(),
            deal_commitment_ack: String::from_utf8_lossy(domain::DEAL_COMMITMENT_ACK).into_owned(),
            reveal_share: String::from_utf8_lossy(domain::REVEAL_SHARE).into_owned(),
            timelock_reveal: String::from_utf8_lossy(domain::TIMELOCK_REVEAL).into_owned(),
            artifact_request: String::from_utf8_lossy(domain::ARTIFACT_REQUEST).into_owned(),
            artifact_response: String::from_utf8_lossy(domain::ARTIFACT_RESPONSE).into_owned(),
            shuffle_context: String::from_utf8_lossy(domain::SHUFFLE_CONTEXT).into_owned(),
        }
    }
}

/// Reveal phase enum values.
///
/// These map directly to the `RevealPhase` enum discriminants.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RevealPhases {
    /// Hole cards dealt to players.
    pub preflop: u8,
    /// First three community cards.
    pub flop: u8,
    /// Fourth community card.
    pub turn: u8,
    /// Fifth community card.
    pub river: u8,
    /// Final showdown.
    pub showdown: u8,
}

impl RevealPhases {
    fn canonical() -> Self {
        use crate::RevealPhase;
        Self {
            preflop: RevealPhase::Preflop as u8,
            flop: RevealPhase::Flop as u8,
            turn: RevealPhase::Turn as u8,
            river: RevealPhase::River as u8,
            showdown: RevealPhase::Showdown as u8,
        }
    }
}

/// Wire format specifications for encoding/decoding.
///
/// This documents the byte layout of protocol messages to ensure
/// consistent encoding across languages.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WireFormats {
    /// Encoding specifications for fixed-size fields.
    pub fixed_sizes: FixedSizes,
    /// Encoding specifications for variable-length fields.
    pub variable_length: VariableLengthSpecs,
    /// Integer encoding rules.
    pub integers: IntegerEncoding,
}

impl WireFormats {
    fn canonical() -> Self {
        Self {
            fixed_sizes: FixedSizes::canonical(),
            variable_length: VariableLengthSpecs::canonical(),
            integers: IntegerEncoding::canonical(),
        }
    }
}

/// Fixed-size field specifications.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FixedSizes {
    /// Hash size in bytes (blake3).
    pub hash_size: usize,
    /// Table ID size in bytes.
    pub table_id_size: usize,
    /// Hand ID size in bytes (u64 little-endian).
    pub hand_id_size: usize,
    /// Timestamp size in bytes (u64 little-endian).
    pub timestamp_size: usize,
    /// Protocol version size in bytes.
    pub version_size: usize,
    /// Seat index size in bytes.
    pub seat_index_size: usize,
    /// Deck length size in bytes.
    pub deck_length_size: usize,
}

impl FixedSizes {
    fn canonical() -> Self {
        Self {
            hash_size: 32,
            table_id_size: 32,
            hand_id_size: 8,
            timestamp_size: 8,
            version_size: 1,
            seat_index_size: 1,
            deck_length_size: 1,
        }
    }
}

/// Variable-length field encoding specifications.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VariableLengthSpecs {
    /// Length prefix size for seat_order (u8).
    pub seat_order_length_prefix: usize,
    /// Length prefix size for artifact_hashes (u8).
    pub artifact_hashes_length_prefix: usize,
    /// Length prefix size for card_indices (u8).
    pub card_indices_length_prefix: usize,
    /// Length prefix size for reveal_data entries (u16 little-endian).
    pub reveal_data_entry_length_prefix: usize,
    /// Length prefix size for timelock_proof (u32 little-endian).
    pub timelock_proof_length_prefix: usize,
}

impl VariableLengthSpecs {
    fn canonical() -> Self {
        Self {
            seat_order_length_prefix: 1,
            artifact_hashes_length_prefix: 1,
            card_indices_length_prefix: 1,
            reveal_data_entry_length_prefix: 2,
            timelock_proof_length_prefix: 4,
        }
    }
}

/// Integer encoding rules.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IntegerEncoding {
    /// Byte order for multi-byte integers.
    pub byte_order: String,
    /// u64 encoding size in bytes.
    pub u64_size: usize,
    /// u32 encoding size in bytes.
    pub u32_size: usize,
    /// u16 encoding size in bytes.
    pub u16_size: usize,
}

impl IntegerEncoding {
    fn canonical() -> Self {
        Self {
            byte_order: "little-endian".to_string(),
            u64_size: 8,
            u32_size: 4,
            u16_size: 2,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Consensus Payload Tags
// ─────────────────────────────────────────────────────────────────────────────

/// Consensus payload type tags.
///
/// These are the discriminant values for the `ConsensusPayload` enum in the
/// onchain consensus layer. They identify the type of each message in the
/// consensus-ordered action log.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConsensusPayloadTags {
    /// Tag for DealCommitment payloads.
    pub deal_commitment: u8,
    /// Tag for DealCommitmentAck payloads.
    pub deal_commitment_ack: u8,
    /// Tag for GameAction payloads.
    pub game_action: u8,
    /// Tag for RevealShare payloads.
    pub reveal_share: u8,
    /// Tag for TimelockReveal payloads.
    pub timelock_reveal: u8,
}

impl ConsensusPayloadTags {
    fn canonical() -> Self {
        Self {
            deal_commitment: 0,
            deal_commitment_ack: 1,
            game_action: 2,
            reveal_share: 3,
            timelock_reveal: 4,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Game Action Codes
// ─────────────────────────────────────────────────────────────────────────────

/// Game action type codes.
///
/// These codes identify the type of action a player takes during a hand.
/// They are used in the `action_type` field of `GameActionMessage`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GameActionCodes {
    /// Player folds their hand.
    pub fold: u8,
    /// Player checks (no bet, passes action).
    pub check: u8,
    /// Player calls the current bet.
    pub call: u8,
    /// Player makes an initial bet.
    pub bet: u8,
    /// Player raises the current bet.
    pub raise_action: u8,
    /// Player goes all-in.
    pub all_in: u8,
}

impl GameActionCodes {
    fn canonical() -> Self {
        Self {
            fold: 0,
            check: 1,
            call: 2,
            bet: 3,
            raise_action: 4,
            all_in: 5,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Disabled Feature Tags
// ─────────────────────────────────────────────────────────────────────────────

/// Tags for disabled features.
///
/// These are instruction tags that are disabled in the current protocol version.
/// Validators can use this list to immediately reject transactions containing
/// these tags without further processing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DisabledFeatureTags {
    /// Bridge functionality is disabled.
    pub bridge_disabled: bool,
    /// Liquidity/AMM functionality is disabled.
    pub liquidity_disabled: bool,
    /// Staking functionality is disabled.
    pub staking_disabled: bool,
    /// Tag for BridgeWithdraw instruction (DISABLED).
    pub tag_bridge_withdraw: u8,
    /// Tag for BridgeDeposit instruction (DISABLED).
    pub tag_bridge_deposit: u8,
    /// Tag for FinalizeBridgeWithdrawal instruction (DISABLED).
    pub tag_finalize_bridge_withdrawal: u8,
}

impl DisabledFeatureTags {
    fn canonical() -> Self {
        Self {
            bridge_disabled: true,
            liquidity_disabled: true,
            staking_disabled: true,
            tag_bridge_withdraw: 53,
            tag_bridge_deposit: 54,
            tag_finalize_bridge_withdrawal: 55,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Game Encodings (v2 Compact) - AC-3.1, AC-3.2
// ─────────────────────────────────────────────────────────────────────────────

/// Complete game encoding exports for v2 compact format.
///
/// These define the canonical opcodes, bit layouts, and enum values for
/// each casino game's compact encoding. JS/TS should use these instead
/// of hand-maintained codec logic.
///
/// # AC-3.1 Compliance
///
/// Rust defines all bit layouts and versioning. These exports make those
/// definitions available to JS/TS.
///
/// # AC-3.2 Compliance
///
/// JS/TS uses these Rust-derived artifacts for encoding/decoding.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GameEncodings {
    /// Common header format for all v2 payloads.
    pub header: HeaderFormat,
    /// Blackjack game encoding.
    pub blackjack: BlackjackEncoding,
    /// Baccarat game encoding.
    pub baccarat: BaccaratEncoding,
    /// Roulette game encoding.
    pub roulette: RouletteEncoding,
    /// Craps game encoding.
    pub craps: CrapsEncoding,
    /// Sic Bo game encoding.
    pub sic_bo: SicBoEncoding,
    /// Three Card Poker game encoding.
    pub three_card: ThreeCardEncoding,
    /// Ultimate Texas Hold'em game encoding.
    pub ultimate_holdem: UltimateHoldemEncoding,
    /// Casino War game encoding.
    pub casino_war: CasinoWarEncoding,
    /// Video Poker game encoding.
    pub video_poker: VideoPokerEncoding,
    /// Hi-Lo game encoding.
    pub hilo: HiLoEncoding,
}

impl GameEncodings {
    fn canonical() -> Self {
        Self {
            header: HeaderFormat::canonical(),
            blackjack: BlackjackEncoding::canonical(),
            baccarat: BaccaratEncoding::canonical(),
            roulette: RouletteEncoding::canonical(),
            craps: CrapsEncoding::canonical(),
            sic_bo: SicBoEncoding::canonical(),
            three_card: ThreeCardEncoding::canonical(),
            ultimate_holdem: UltimateHoldemEncoding::canonical(),
            casino_war: CasinoWarEncoding::canonical(),
            video_poker: VideoPokerEncoding::canonical(),
            hilo: HiLoEncoding::canonical(),
        }
    }
}

/// Common header format for v2 compact payloads.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeaderFormat {
    /// Total header size in bits.
    pub size_bits: u8,
    /// Version field bit width.
    pub version_bits: u8,
    /// Opcode field bit width.
    pub opcode_bits: u8,
    /// Protocol version value for v2 encoding.
    pub v2_version_value: u8,
}

impl HeaderFormat {
    fn canonical() -> Self {
        Self {
            size_bits: 8,
            version_bits: 3,
            opcode_bits: 5,
            v2_version_value: 2,
        }
    }
}

/// Blackjack v2 compact encoding opcodes and bit layouts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BlackjackEncoding {
    /// Opcode values.
    pub opcodes: BlackjackOpcodes,
    /// Side bet type values.
    pub side_bet_types: BlackjackSideBetTypes,
    /// Bit layout specifications.
    pub bit_layouts: BlackjackBitLayouts,
}

impl BlackjackEncoding {
    fn canonical() -> Self {
        Self {
            opcodes: BlackjackOpcodes::canonical(),
            side_bet_types: BlackjackSideBetTypes::canonical(),
            bit_layouts: BlackjackBitLayouts::canonical(),
        }
    }
}

/// Blackjack opcode values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BlackjackOpcodes {
    /// Player requests another card.
    pub hit: u8,
    /// Player stands with current hand.
    pub stand: u8,
    /// Player doubles down.
    pub double: u8,
    /// Player splits a pair.
    pub split: u8,
    /// Start a new hand with optional side bets.
    pub deal: u8,
    /// Player surrenders.
    pub surrender: u8,
    /// Dealer reveals hole card.
    pub reveal: u8,
    /// Set table rules variant.
    pub set_rules: u8,
}

impl BlackjackOpcodes {
    fn canonical() -> Self {
        Self {
            hit: 0,
            stand: 1,
            double: 2,
            split: 3,
            deal: 4,
            surrender: 5,
            reveal: 6,
            set_rules: 7,
        }
    }
}

/// Blackjack side bet type values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BlackjackSideBetTypes {
    /// 21+3: Player's two cards + dealer upcard form poker hand.
    pub twenty_one_plus_3: u8,
    /// Lucky Ladies: Player's first two cards total 20.
    pub lucky_ladies: u8,
    /// Perfect Pairs: Player's first two cards are a pair.
    pub perfect_pairs: u8,
    /// Bust It: Dealer busts with specific card count.
    pub bust_it: u8,
    /// Royal Match: Player's first two cards are suited.
    pub royal_match: u8,
}

impl BlackjackSideBetTypes {
    fn canonical() -> Self {
        Self {
            twenty_one_plus_3: 0,
            lucky_ladies: 1,
            perfect_pairs: 2,
            bust_it: 3,
            royal_match: 4,
        }
    }
}

/// Blackjack bit layout specifications.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BlackjackBitLayouts {
    /// Number of side bet types.
    pub side_bet_count: u8,
    /// Bit width for side bet mask.
    pub side_bet_mask_bits: u8,
    /// Bit width for card ID (0-51).
    pub card_id_bits: u8,
    /// Bit width for bet multiplier (1x, 2x, etc.).
    pub bet_multiplier_bits: u8,
    /// Bit width for hand status enum.
    pub hand_status_bits: u8,
}

impl BlackjackBitLayouts {
    fn canonical() -> Self {
        Self {
            side_bet_count: 5,
            side_bet_mask_bits: 5,
            card_id_bits: 6,
            bet_multiplier_bits: 2,
            hand_status_bits: 3,
        }
    }
}

/// Baccarat v2 compact encoding opcodes and bit layouts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BaccaratEncoding {
    /// Opcode values.
    pub opcodes: BaccaratOpcodes,
    /// Bet type values.
    pub bet_types: BaccaratBetTypes,
    /// Bit layout specifications.
    pub bit_layouts: BaccaratBitLayouts,
}

impl BaccaratEncoding {
    fn canonical() -> Self {
        Self {
            opcodes: BaccaratOpcodes::canonical(),
            bet_types: BaccaratBetTypes::canonical(),
            bit_layouts: BaccaratBitLayouts::canonical(),
        }
    }
}

/// Baccarat opcode values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BaccaratOpcodes {
    /// Place a single bet.
    pub place_bet: u8,
    /// Deal the cards.
    pub deal: u8,
    /// Clear all bets.
    pub clear_bets: u8,
    /// Place multiple bets atomically.
    pub atomic_batch: u8,
    /// Set table rules variant.
    pub set_rules: u8,
}

impl BaccaratOpcodes {
    fn canonical() -> Self {
        Self {
            place_bet: 0,
            deal: 1,
            clear_bets: 2,
            atomic_batch: 3,
            set_rules: 4,
        }
    }
}

/// Baccarat bet type values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BaccaratBetTypes {
    /// Bet on player winning.
    pub player: u8,
    /// Bet on banker winning.
    pub banker: u8,
    /// Bet on tie.
    pub tie: u8,
    /// Bet on player pair.
    pub player_pair: u8,
    /// Bet on banker pair.
    pub banker_pair: u8,
}

impl BaccaratBetTypes {
    fn canonical() -> Self {
        Self {
            player: 0,
            banker: 1,
            tie: 2,
            player_pair: 3,
            banker_pair: 4,
        }
    }
}

/// Baccarat bit layout specifications.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BaccaratBitLayouts {
    /// Bit width for bet type.
    pub bet_type_bits: u8,
    /// Bit width for card ID (0-51).
    pub card_id_bits: u8,
    /// Bit width for batch bet count.
    pub batch_count_bits: u8,
}

impl BaccaratBitLayouts {
    fn canonical() -> Self {
        Self {
            bet_type_bits: 3,
            card_id_bits: 6,
            batch_count_bits: 4,
        }
    }
}

/// Roulette v2 compact encoding opcodes and bit layouts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RouletteEncoding {
    /// Opcode values.
    pub opcodes: RouletteOpcodes,
    /// Bet type values.
    pub bet_types: RouletteBetTypes,
    /// Bit layout specifications.
    pub bit_layouts: RouletteBitLayouts,
}

impl RouletteEncoding {
    fn canonical() -> Self {
        Self {
            opcodes: RouletteOpcodes::canonical(),
            bet_types: RouletteBetTypes::canonical(),
            bit_layouts: RouletteBitLayouts::canonical(),
        }
    }
}

/// Roulette opcode values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RouletteOpcodes {
    /// Place a single bet.
    pub place_bet: u8,
    /// Spin the wheel.
    pub spin: u8,
    /// Clear all bets.
    pub clear_bets: u8,
    /// Set table rules variant.
    pub set_rules: u8,
    /// Place multiple bets atomically.
    pub atomic_batch: u8,
}

impl RouletteOpcodes {
    fn canonical() -> Self {
        Self {
            place_bet: 0,
            spin: 1,
            clear_bets: 2,
            set_rules: 3,
            atomic_batch: 4,
        }
    }
}

/// Roulette bet type values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RouletteBetTypes {
    /// Bet on a single number.
    pub straight: u8,
    /// Bet on two adjacent numbers.
    pub split: u8,
    /// Bet on three numbers in a row.
    pub street: u8,
    /// Bet on four numbers in a square.
    pub corner: u8,
    /// Bet on six numbers (two rows).
    pub six_line: u8,
    /// Bet on 12 numbers (first, second, third dozen).
    pub dozen: u8,
    /// Bet on 12 numbers (column).
    pub column: u8,
    /// Bet on red numbers.
    pub red: u8,
    /// Bet on black numbers.
    pub black: u8,
    /// Bet on even numbers.
    pub even: u8,
    /// Bet on odd numbers.
    pub odd: u8,
    /// Bet on low numbers (1-18).
    pub low: u8,
    /// Bet on high numbers (19-36).
    pub high: u8,
    /// Basket bet (0, 00, 1, 2, 3).
    pub basket: u8,
}

impl RouletteBetTypes {
    fn canonical() -> Self {
        Self {
            straight: 0,
            split: 1,
            street: 2,
            corner: 3,
            six_line: 4,
            dozen: 5,
            column: 6,
            red: 7,
            black: 8,
            even: 9,
            odd: 10,
            low: 11,
            high: 12,
            basket: 13,
        }
    }
}

/// Roulette bit layout specifications.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RouletteBitLayouts {
    /// Bit width for bet type.
    pub bet_type_bits: u8,
    /// Bit width for bet value (number, index, etc.).
    pub bet_value_bits: u8,
    /// Bit width for spin result (0-37 for American).
    pub result_bits: u8,
    /// Bit width for batch bet count.
    pub batch_count_bits: u8,
}

impl RouletteBitLayouts {
    fn canonical() -> Self {
        Self {
            bet_type_bits: 4,
            bet_value_bits: 6,
            result_bits: 6,
            batch_count_bits: 5,
        }
    }
}

/// Craps v2 compact encoding opcodes and bit layouts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CrapsEncoding {
    /// Opcode values.
    pub opcodes: CrapsOpcodes,
    /// Bet type values.
    pub bet_types: CrapsBetTypes,
    /// Bit layout specifications.
    pub bit_layouts: CrapsBitLayouts,
}

impl CrapsEncoding {
    fn canonical() -> Self {
        Self {
            opcodes: CrapsOpcodes::canonical(),
            bet_types: CrapsBetTypes::canonical(),
            bit_layouts: CrapsBitLayouts::canonical(),
        }
    }
}

/// Craps opcode values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CrapsOpcodes {
    /// Place a single bet.
    pub place_bet: u8,
    /// Add odds to an existing bet.
    pub add_odds: u8,
    /// Roll the dice.
    pub roll: u8,
    /// Clear all bets.
    pub clear_bets: u8,
    /// Place multiple bets atomically.
    pub atomic_batch: u8,
}

impl CrapsOpcodes {
    fn canonical() -> Self {
        Self {
            place_bet: 0,
            add_odds: 1,
            roll: 2,
            clear_bets: 3,
            atomic_batch: 4,
        }
    }
}

/// Craps bet type values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CrapsBetTypes {
    /// Pass line bet.
    pub pass_line: u8,
    /// Don't pass bet.
    pub dont_pass: u8,
    /// Come bet.
    pub come: u8,
    /// Don't come bet.
    pub dont_come: u8,
    /// Place bet on specific number.
    pub place: u8,
    /// Field bet.
    pub field: u8,
    /// Big 6/8 bet.
    pub big: u8,
    /// Hardway bet.
    pub hardway: u8,
    /// Any craps bet.
    pub any_craps: u8,
    /// Any seven bet.
    pub any_seven: u8,
    /// Hop bet.
    pub hop: u8,
    /// Horn bet.
    pub horn: u8,
}

impl CrapsBetTypes {
    fn canonical() -> Self {
        Self {
            pass_line: 0,
            dont_pass: 1,
            come: 2,
            dont_come: 3,
            place: 4,
            field: 5,
            big: 6,
            hardway: 7,
            any_craps: 8,
            any_seven: 9,
            hop: 10,
            horn: 11,
        }
    }
}

/// Craps bit layout specifications.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CrapsBitLayouts {
    /// Bit width for bet type.
    pub bet_type_bits: u8,
    /// Bit width for bet target (point number, etc.).
    pub bet_target_bits: u8,
    /// Bit width for each die value (1-6).
    pub die_value_bits: u8,
    /// Bit width for made points mask (ATS/Fire tracking).
    pub made_points_mask_bits: u8,
    /// Bit width for batch bet count.
    pub batch_count_bits: u8,
}

impl CrapsBitLayouts {
    fn canonical() -> Self {
        Self {
            bet_type_bits: 4,
            bet_target_bits: 4,
            die_value_bits: 3,
            made_points_mask_bits: 6,
            batch_count_bits: 5,
        }
    }
}

/// Sic Bo v2 compact encoding opcodes and bit layouts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SicBoEncoding {
    /// Opcode values.
    pub opcodes: SicBoOpcodes,
    /// Bet type values.
    pub bet_types: SicBoBetTypes,
    /// Bit layout specifications.
    pub bit_layouts: SicBoBitLayouts,
}

impl SicBoEncoding {
    fn canonical() -> Self {
        Self {
            opcodes: SicBoOpcodes::canonical(),
            bet_types: SicBoBetTypes::canonical(),
            bit_layouts: SicBoBitLayouts::canonical(),
        }
    }
}

/// Sic Bo opcode values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SicBoOpcodes {
    /// Place a single bet.
    pub place_bet: u8,
    /// Roll the dice.
    pub roll: u8,
    /// Clear all bets.
    pub clear_bets: u8,
    /// Place multiple bets atomically.
    pub atomic_batch: u8,
    /// Set table rules variant.
    pub set_rules: u8,
}

impl SicBoOpcodes {
    fn canonical() -> Self {
        Self {
            place_bet: 0,
            roll: 1,
            clear_bets: 2,
            atomic_batch: 3,
            set_rules: 4,
        }
    }
}

/// Sic Bo bet type values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SicBoBetTypes {
    /// Bet on small (4-10).
    pub small: u8,
    /// Bet on big (11-17).
    pub big: u8,
    /// Bet on specific total.
    pub total: u8,
    /// Bet on any triple.
    pub any_triple: u8,
    /// Bet on specific triple.
    pub specific_triple: u8,
    /// Bet on specific double.
    pub specific_double: u8,
    /// Bet on two-dice combination.
    pub two_dice_combo: u8,
    /// Bet on single die face.
    pub single: u8,
    /// Bet on pair (two of same face).
    pub pair: u8,
}

impl SicBoBetTypes {
    fn canonical() -> Self {
        Self {
            small: 0,
            big: 1,
            total: 2,
            any_triple: 3,
            specific_triple: 4,
            specific_double: 5,
            two_dice_combo: 6,
            single: 7,
            pair: 8,
        }
    }
}

/// Sic Bo bit layout specifications.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SicBoBitLayouts {
    /// Bit width for bet type.
    pub bet_type_bits: u8,
    /// Bit width for bet target (total, face, etc.).
    pub bet_target_bits: u8,
    /// Bit width for each die value (1-6).
    pub die_value_bits: u8,
    /// Bit width for dice history entry.
    pub history_entry_bits: u8,
    /// Bit width for batch bet count.
    pub batch_count_bits: u8,
}

impl SicBoBitLayouts {
    fn canonical() -> Self {
        Self {
            bet_type_bits: 4,
            bet_target_bits: 4,
            die_value_bits: 3,
            history_entry_bits: 9,
            batch_count_bits: 5,
        }
    }
}

/// Three Card Poker v2 compact encoding opcodes and bit layouts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ThreeCardEncoding {
    /// Opcode values.
    pub opcodes: ThreeCardOpcodes,
    /// Side bet type values.
    pub side_bet_types: ThreeCardSideBetTypes,
    /// Bit layout specifications.
    pub bit_layouts: ThreeCardBitLayouts,
}

impl ThreeCardEncoding {
    fn canonical() -> Self {
        Self {
            opcodes: ThreeCardOpcodes::canonical(),
            side_bet_types: ThreeCardSideBetTypes::canonical(),
            bit_layouts: ThreeCardBitLayouts::canonical(),
        }
    }
}

/// Three Card Poker opcode values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ThreeCardOpcodes {
    /// Player plays (makes play bet).
    pub play: u8,
    /// Player folds.
    pub fold: u8,
    /// Start a new hand.
    pub deal: u8,
    /// Reveal hands.
    pub reveal: u8,
    /// Set table rules variant.
    pub set_rules: u8,
}

impl ThreeCardOpcodes {
    fn canonical() -> Self {
        Self {
            play: 0,
            fold: 1,
            deal: 2,
            reveal: 3,
            set_rules: 4,
        }
    }
}

/// Three Card Poker side bet type values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ThreeCardSideBetTypes {
    /// Pair Plus side bet.
    pub pair_plus: u8,
    /// Six Card Bonus side bet.
    pub six_card_bonus: u8,
    /// Prime side bet.
    pub prime: u8,
}

impl ThreeCardSideBetTypes {
    fn canonical() -> Self {
        Self {
            pair_plus: 0,
            six_card_bonus: 1,
            prime: 2,
        }
    }
}

/// Three Card Poker bit layout specifications.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ThreeCardBitLayouts {
    /// Bit width for card ID (0-51).
    pub card_id_bits: u8,
    /// Bit width for side bet mask.
    pub side_bet_mask_bits: u8,
    /// Number of side bet types.
    pub side_bet_count: u8,
}

impl ThreeCardBitLayouts {
    fn canonical() -> Self {
        Self {
            card_id_bits: 6,
            side_bet_mask_bits: 3,
            side_bet_count: 3,
        }
    }
}

/// Ultimate Texas Hold'em v2 compact encoding opcodes and bit layouts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UltimateHoldemEncoding {
    /// Opcode values.
    pub opcodes: UltimateHoldemOpcodes,
    /// Side bet type values.
    pub side_bet_types: UltimateHoldemSideBetTypes,
    /// Bit layout specifications.
    pub bit_layouts: UltimateHoldemBitLayouts,
}

impl UltimateHoldemEncoding {
    fn canonical() -> Self {
        Self {
            opcodes: UltimateHoldemOpcodes::canonical(),
            side_bet_types: UltimateHoldemSideBetTypes::canonical(),
            bit_layouts: UltimateHoldemBitLayouts::canonical(),
        }
    }
}

/// Ultimate Texas Hold'em opcode values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UltimateHoldemOpcodes {
    /// Player checks.
    pub check: u8,
    /// Player makes a bet (with multiplier).
    pub bet: u8,
    /// Player folds.
    pub fold: u8,
    /// Start a new hand.
    pub deal: u8,
    /// Reveal hands.
    pub reveal: u8,
    /// Set table rules variant.
    pub set_rules: u8,
}

impl UltimateHoldemOpcodes {
    fn canonical() -> Self {
        Self {
            check: 0,
            bet: 1,
            fold: 2,
            deal: 3,
            reveal: 4,
            set_rules: 5,
        }
    }
}

/// Ultimate Texas Hold'em side bet type values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UltimateHoldemSideBetTypes {
    /// Trips bonus side bet.
    pub trips: u8,
}

impl UltimateHoldemSideBetTypes {
    fn canonical() -> Self {
        Self { trips: 0 }
    }
}

/// Ultimate Texas Hold'em bit layout specifications.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UltimateHoldemBitLayouts {
    /// Bit width for card ID (0-51).
    pub card_id_bits: u8,
    /// Bit width for bet multiplier (1x, 2x, 3x, 4x).
    pub bet_multiplier_bits: u8,
    /// Bit width for game stage enum.
    pub stage_bits: u8,
    /// Bit width for side bet mask.
    pub side_bet_mask_bits: u8,
}

impl UltimateHoldemBitLayouts {
    fn canonical() -> Self {
        Self {
            card_id_bits: 6,
            bet_multiplier_bits: 2,
            stage_bits: 2,
            side_bet_mask_bits: 1,
        }
    }
}

/// Casino War v2 compact encoding opcodes and bit layouts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CasinoWarEncoding {
    /// Opcode values.
    pub opcodes: CasinoWarOpcodes,
    /// Bit layout specifications.
    pub bit_layouts: CasinoWarBitLayouts,
}

impl CasinoWarEncoding {
    fn canonical() -> Self {
        Self {
            opcodes: CasinoWarOpcodes::canonical(),
            bit_layouts: CasinoWarBitLayouts::canonical(),
        }
    }
}

/// Casino War opcode values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CasinoWarOpcodes {
    /// Player plays (initial ante).
    pub play: u8,
    /// Player goes to war.
    pub war: u8,
    /// Player surrenders.
    pub surrender: u8,
    /// Set tie bet amount.
    pub set_tie_bet: u8,
    /// Set table rules variant.
    pub set_rules: u8,
}

impl CasinoWarOpcodes {
    fn canonical() -> Self {
        Self {
            play: 0,
            war: 1,
            surrender: 2,
            set_tie_bet: 3,
            set_rules: 4,
        }
    }
}

/// Casino War bit layout specifications.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CasinoWarBitLayouts {
    /// Bit width for card ID (0-51).
    pub card_id_bits: u8,
}

impl CasinoWarBitLayouts {
    fn canonical() -> Self {
        Self { card_id_bits: 6 }
    }
}

/// Video Poker v2 compact encoding opcodes and bit layouts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VideoPokerEncoding {
    /// Opcode values.
    pub opcodes: VideoPokerOpcodes,
    /// Bit layout specifications.
    pub bit_layouts: VideoPokerBitLayouts,
}

impl VideoPokerEncoding {
    fn canonical() -> Self {
        Self {
            opcodes: VideoPokerOpcodes::canonical(),
            bit_layouts: VideoPokerBitLayouts::canonical(),
        }
    }
}

/// Video Poker opcode values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VideoPokerOpcodes {
    /// Hold cards (5-bit mask).
    pub hold_mask: u8,
    /// Set game rules variant.
    pub set_rules: u8,
}

impl VideoPokerOpcodes {
    fn canonical() -> Self {
        Self {
            hold_mask: 0,
            set_rules: 1,
        }
    }
}

/// Video Poker bit layout specifications.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VideoPokerBitLayouts {
    /// Bit width for card ID (0-51).
    pub card_id_bits: u8,
    /// Bit width for hold mask (5 cards).
    pub hold_mask_bits: u8,
    /// Bit width for game stage enum.
    pub stage_bits: u8,
    /// Bit width for hand rank enum.
    pub hand_rank_bits: u8,
    /// Bit width for payout multiplier.
    pub multiplier_bits: u8,
}

impl VideoPokerBitLayouts {
    fn canonical() -> Self {
        Self {
            card_id_bits: 6,
            hold_mask_bits: 5,
            stage_bits: 2,
            hand_rank_bits: 6,
            multiplier_bits: 4,
        }
    }
}

/// Hi-Lo v2 compact encoding opcodes and bit layouts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HiLoEncoding {
    /// Opcode values.
    pub opcodes: HiLoOpcodes,
    /// Bit layout specifications.
    pub bit_layouts: HiLoBitLayouts,
}

impl HiLoEncoding {
    fn canonical() -> Self {
        Self {
            opcodes: HiLoOpcodes::canonical(),
            bit_layouts: HiLoBitLayouts::canonical(),
        }
    }
}

/// Hi-Lo opcode values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HiLoOpcodes {
    /// Guess higher.
    pub higher: u8,
    /// Guess lower.
    pub lower: u8,
    /// Guess same.
    pub same: u8,
    /// Cash out.
    pub cashout: u8,
}

impl HiLoOpcodes {
    fn canonical() -> Self {
        Self {
            higher: 0,
            lower: 1,
            same: 2,
            cashout: 3,
        }
    }
}

/// Hi-Lo bit layout specifications.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HiLoBitLayouts {
    /// Bit width for card ID (0-51).
    pub card_id_bits: u8,
    /// Bit width for game stage enum.
    pub stage_bits: u8,
}

impl HiLoBitLayouts {
    fn canonical() -> Self {
        Self {
            card_id_bits: 6,
            stage_bits: 2,
        }
    }
}

/// Export protocol constants to JSON.
///
/// This function produces a JSON representation of all protocol constants
/// that can be consumed by JS/TS codegen tools.
///
/// # Example
///
/// ```
/// use protocol_messages::exports::export_json;
///
/// let json = export_json();
/// assert!(json.contains("\"schema_version\": 3")); // pretty-printed with space
/// assert!(json.contains("\"current\": 1")); // versions.current
/// assert!(json.contains("\"game_encodings\"")); // AC-3.1, AC-3.2 game encodings
/// ```
pub fn export_json() -> String {
    let exports = ProtocolExports::canonical();
    serde_json::to_string_pretty(&exports).expect("ProtocolExports serialization cannot fail")
}

/// Export protocol constants to compact JSON (no whitespace).
///
/// Useful for embedding in code or minimizing file size.
pub fn export_json_compact() -> String {
    let exports = ProtocolExports::canonical();
    serde_json::to_string(&exports).expect("ProtocolExports serialization cannot fail")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// AC-1.1: Protocol tags, wire formats, and version constants are defined
    /// in Rust and exported to JS/TS.
    ///
    /// This test verifies that:
    /// 1. Version constants are exported correctly
    /// 2. The export is serializable to JSON
    /// 3. All required fields are present
    #[test]
    fn test_protocol_exports_canonical_ac_1_1() {
        let exports = ProtocolExports::canonical();

        // Version constants are correct
        assert_eq!(exports.versions.current, CURRENT_PROTOCOL_VERSION);
        assert_eq!(exports.versions.minimum, MIN_SUPPORTED_PROTOCOL_VERSION);
        assert_eq!(exports.versions.maximum, MAX_SUPPORTED_PROTOCOL_VERSION);

        // Schema version is present
        assert_eq!(exports.schema_version, EXPORT_SCHEMA_VERSION);
    }

    /// AC-1.1: Size bounds are exported for DoS protection.
    #[test]
    fn test_size_bounds_exported_ac_1_1() {
        let exports = ProtocolExports::canonical();

        assert_eq!(exports.size_bounds.max_seats, MAX_SEATS);
        assert_eq!(exports.size_bounds.max_artifact_hashes, MAX_ARTIFACT_HASHES);
        assert_eq!(exports.size_bounds.max_reveal_cards, MAX_REVEAL_CARDS);
        assert_eq!(exports.size_bounds.max_reveal_data_size, MAX_REVEAL_DATA_SIZE);
        assert_eq!(exports.size_bounds.max_timelock_proof_size, MAX_TIMELOCK_PROOF_SIZE);
        assert_eq!(exports.size_bounds.max_signature_size, MAX_SIGNATURE_SIZE);
        assert_eq!(exports.size_bounds.max_artifact_size, MAX_ARTIFACT_SIZE);
    }

    /// AC-1.1: Domain prefixes are exported for message hashing.
    #[test]
    fn test_domain_prefixes_exported_ac_1_1() {
        let exports = ProtocolExports::canonical();

        assert_eq!(
            exports.domain_prefixes.deal_commitment,
            "nullspace.deal_commitment.v1"
        );
        assert_eq!(
            exports.domain_prefixes.deal_commitment_ack,
            "nullspace.deal_commitment_ack.v1"
        );
        assert_eq!(
            exports.domain_prefixes.reveal_share,
            "nullspace.reveal_share.v1"
        );
        assert_eq!(
            exports.domain_prefixes.timelock_reveal,
            "nullspace.timelock_reveal.v1"
        );
        assert_eq!(
            exports.domain_prefixes.artifact_request,
            "nullspace.artifact_request.v1"
        );
        assert_eq!(
            exports.domain_prefixes.artifact_response,
            "nullspace.artifact_response.v1"
        );
        assert_eq!(
            exports.domain_prefixes.shuffle_context,
            "nullspace.shuffle_context.v1"
        );
    }

    /// AC-1.1: Reveal phase enum values are exported.
    #[test]
    fn test_reveal_phases_exported_ac_1_1() {
        let exports = ProtocolExports::canonical();

        assert_eq!(exports.reveal_phases.preflop, 0);
        assert_eq!(exports.reveal_phases.flop, 1);
        assert_eq!(exports.reveal_phases.turn, 2);
        assert_eq!(exports.reveal_phases.river, 3);
        assert_eq!(exports.reveal_phases.showdown, 4);
    }

    /// AC-1.1: Wire format specifications are exported.
    #[test]
    fn test_wire_formats_exported_ac_1_1() {
        let exports = ProtocolExports::canonical();

        // Fixed sizes
        assert_eq!(exports.wire_formats.fixed_sizes.hash_size, 32);
        assert_eq!(exports.wire_formats.fixed_sizes.table_id_size, 32);
        assert_eq!(exports.wire_formats.fixed_sizes.hand_id_size, 8);
        assert_eq!(exports.wire_formats.fixed_sizes.version_size, 1);

        // Variable length specs
        assert_eq!(exports.wire_formats.variable_length.seat_order_length_prefix, 1);
        assert_eq!(exports.wire_formats.variable_length.reveal_data_entry_length_prefix, 2);
        assert_eq!(exports.wire_formats.variable_length.timelock_proof_length_prefix, 4);

        // Integer encoding
        assert_eq!(exports.wire_formats.integers.byte_order, "little-endian");
        assert_eq!(exports.wire_formats.integers.u64_size, 8);
    }

    /// AC-1.1: Export to JSON works and contains expected fields.
    #[test]
    fn test_export_json_ac_1_1() {
        let json = export_json();

        // JSON must be valid
        let parsed: serde_json::Value = serde_json::from_str(&json)
            .expect("export_json must produce valid JSON");

        // Required top-level fields are present
        assert!(parsed.get("schema_version").is_some());
        assert!(parsed.get("versions").is_some());
        assert!(parsed.get("size_bounds").is_some());
        assert!(parsed.get("domain_prefixes").is_some());
        assert!(parsed.get("reveal_phases").is_some());
        assert!(parsed.get("wire_formats").is_some());

        // Version values are correct
        assert_eq!(
            parsed["versions"]["current"].as_u64().unwrap(),
            CURRENT_PROTOCOL_VERSION as u64
        );
    }

    /// AC-1.1: Export is deterministic (same output every time).
    #[test]
    fn test_export_deterministic_ac_1_1() {
        let json1 = export_json();
        let json2 = export_json();
        assert_eq!(json1, json2, "export must be deterministic");

        let compact1 = export_json_compact();
        let compact2 = export_json_compact();
        assert_eq!(compact1, compact2, "compact export must be deterministic");
    }

    /// AC-1.1: Exports can be deserialized back to struct.
    #[test]
    fn test_export_roundtrip_ac_1_1() {
        let exports = ProtocolExports::canonical();
        let json = serde_json::to_string(&exports).unwrap();
        let parsed: ProtocolExports = serde_json::from_str(&json).unwrap();
        assert_eq!(exports, parsed, "export must roundtrip through JSON");
    }

    /// Verify schema version is bumped when format changes.
    #[test]
    fn test_schema_version_documented() {
        // This test documents the current schema version.
        // When the export format changes, update EXPORT_SCHEMA_VERSION and this test.
        assert_eq!(
            EXPORT_SCHEMA_VERSION, 3,
            "Schema version 3 adds game_encodings with v2 compact encoding opcodes (AC-3.1, AC-3.2)"
        );
    }

    /// Verify domain prefixes match the canonical constants.
    #[test]
    fn test_domain_prefixes_match_source() {
        let exports = ProtocolExports::canonical();

        // These must match exactly (byte-for-byte when converted back)
        assert_eq!(
            exports.domain_prefixes.deal_commitment.as_bytes(),
            domain::DEAL_COMMITMENT
        );
        assert_eq!(
            exports.domain_prefixes.deal_commitment_ack.as_bytes(),
            domain::DEAL_COMMITMENT_ACK
        );
        assert_eq!(
            exports.domain_prefixes.reveal_share.as_bytes(),
            domain::REVEAL_SHARE
        );
        assert_eq!(
            exports.domain_prefixes.timelock_reveal.as_bytes(),
            domain::TIMELOCK_REVEAL
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Consensus Payload Tags Tests (AC-1.1)
    // ─────────────────────────────────────────────────────────────────────────

    /// AC-1.1: Consensus payload type tags are exported.
    ///
    /// These tags identify the type of each message in the consensus-ordered
    /// action log. They must be sequential starting from 0.
    #[test]
    fn test_consensus_payload_tags_exported_ac_1_1() {
        let exports = ProtocolExports::canonical();

        // Tags must be sequential starting from 0
        assert_eq!(exports.consensus_payload_tags.deal_commitment, 0);
        assert_eq!(exports.consensus_payload_tags.deal_commitment_ack, 1);
        assert_eq!(exports.consensus_payload_tags.game_action, 2);
        assert_eq!(exports.consensus_payload_tags.reveal_share, 3);
        assert_eq!(exports.consensus_payload_tags.timelock_reveal, 4);
    }

    /// AC-1.1: Consensus payload tags are exported in JSON.
    #[test]
    fn test_consensus_payload_tags_in_json_ac_1_1() {
        let json = export_json();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // consensus_payload_tags must be present
        let tags = parsed
            .get("consensus_payload_tags")
            .expect("consensus_payload_tags must be in export");

        assert_eq!(tags["deal_commitment"].as_u64(), Some(0));
        assert_eq!(tags["deal_commitment_ack"].as_u64(), Some(1));
        assert_eq!(tags["game_action"].as_u64(), Some(2));
        assert_eq!(tags["reveal_share"].as_u64(), Some(3));
        assert_eq!(tags["timelock_reveal"].as_u64(), Some(4));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Game Action Codes Tests (AC-1.1)
    // ─────────────────────────────────────────────────────────────────────────

    /// AC-1.1: Game action codes are exported.
    ///
    /// These codes identify the type of action a player takes during a hand.
    /// They must match the action_codes module in codexpoker-onchain.
    #[test]
    fn test_game_action_codes_exported_ac_1_1() {
        let exports = ProtocolExports::canonical();

        // Action codes must be sequential starting from 0
        assert_eq!(exports.game_action_codes.fold, 0);
        assert_eq!(exports.game_action_codes.check, 1);
        assert_eq!(exports.game_action_codes.call, 2);
        assert_eq!(exports.game_action_codes.bet, 3);
        assert_eq!(exports.game_action_codes.raise_action, 4);
        assert_eq!(exports.game_action_codes.all_in, 5);
    }

    /// AC-1.1: Game action codes are exported in JSON.
    #[test]
    fn test_game_action_codes_in_json_ac_1_1() {
        let json = export_json();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // game_action_codes must be present
        let codes = parsed
            .get("game_action_codes")
            .expect("game_action_codes must be in export");

        assert_eq!(codes["fold"].as_u64(), Some(0));
        assert_eq!(codes["check"].as_u64(), Some(1));
        assert_eq!(codes["call"].as_u64(), Some(2));
        assert_eq!(codes["bet"].as_u64(), Some(3));
        assert_eq!(codes["raise_action"].as_u64(), Some(4));
        assert_eq!(codes["all_in"].as_u64(), Some(5));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Disabled Feature Tags Tests (AC-1.1)
    // ─────────────────────────────────────────────────────────────────────────

    /// AC-1.1: Disabled feature flags and tags are exported.
    ///
    /// These identify which features are disabled and their instruction tags.
    /// Validators can use this list to reject disabled instructions.
    #[test]
    fn test_disabled_features_exported_ac_1_1() {
        let exports = ProtocolExports::canonical();

        // Feature flags
        assert!(exports.disabled_features.bridge_disabled);
        assert!(exports.disabled_features.liquidity_disabled);
        assert!(exports.disabled_features.staking_disabled);

        // Instruction tags for disabled features
        assert_eq!(exports.disabled_features.tag_bridge_withdraw, 53);
        assert_eq!(exports.disabled_features.tag_bridge_deposit, 54);
        assert_eq!(exports.disabled_features.tag_finalize_bridge_withdrawal, 55);
    }

    /// AC-1.1: Disabled feature tags are exported in JSON.
    #[test]
    fn test_disabled_features_in_json_ac_1_1() {
        let json = export_json();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // disabled_features must be present
        let features = parsed
            .get("disabled_features")
            .expect("disabled_features must be in export");

        // Feature flags
        assert_eq!(features["bridge_disabled"].as_bool(), Some(true));
        assert_eq!(features["liquidity_disabled"].as_bool(), Some(true));
        assert_eq!(features["staking_disabled"].as_bool(), Some(true));

        // Instruction tags
        assert_eq!(features["tag_bridge_withdraw"].as_u64(), Some(53));
        assert_eq!(features["tag_bridge_deposit"].as_u64(), Some(54));
        assert_eq!(features["tag_finalize_bridge_withdrawal"].as_u64(), Some(55));
    }

    /// AC-1.1: All new tag fields are included in JSON export.
    #[test]
    fn test_all_tag_fields_in_json_ac_1_1() {
        let json = export_json();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // All new top-level fields must be present
        assert!(
            parsed.get("consensus_payload_tags").is_some(),
            "consensus_payload_tags must be in export"
        );
        assert!(
            parsed.get("game_action_codes").is_some(),
            "game_action_codes must be in export"
        );
        assert!(
            parsed.get("disabled_features").is_some(),
            "disabled_features must be in export"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Game Encodings Tests (AC-3.1, AC-3.2)
    // ─────────────────────────────────────────────────────────────────────────

    /// AC-3.1: Game encodings are exported with canonical opcodes.
    ///
    /// Rust defines all bit layouts and versioning. These exports make those
    /// definitions available to JS/TS.
    #[test]
    fn test_game_encodings_exported_ac_3_1() {
        let exports = ProtocolExports::canonical();

        // Header format
        assert_eq!(exports.game_encodings.header.size_bits, 8);
        assert_eq!(exports.game_encodings.header.version_bits, 3);
        assert_eq!(exports.game_encodings.header.opcode_bits, 5);
        assert_eq!(exports.game_encodings.header.v2_version_value, 2);

        // Blackjack opcodes
        assert_eq!(exports.game_encodings.blackjack.opcodes.hit, 0);
        assert_eq!(exports.game_encodings.blackjack.opcodes.stand, 1);
        assert_eq!(exports.game_encodings.blackjack.opcodes.double, 2);
        assert_eq!(exports.game_encodings.blackjack.opcodes.split, 3);
        assert_eq!(exports.game_encodings.blackjack.opcodes.deal, 4);
        assert_eq!(exports.game_encodings.blackjack.opcodes.surrender, 5);
        assert_eq!(exports.game_encodings.blackjack.opcodes.reveal, 6);
        assert_eq!(exports.game_encodings.blackjack.opcodes.set_rules, 7);

        // Roulette opcodes
        assert_eq!(exports.game_encodings.roulette.opcodes.place_bet, 0);
        assert_eq!(exports.game_encodings.roulette.opcodes.spin, 1);
        assert_eq!(exports.game_encodings.roulette.opcodes.clear_bets, 2);

        // Craps opcodes
        assert_eq!(exports.game_encodings.craps.opcodes.place_bet, 0);
        assert_eq!(exports.game_encodings.craps.opcodes.roll, 2);

        // Hi-Lo opcodes
        assert_eq!(exports.game_encodings.hilo.opcodes.higher, 0);
        assert_eq!(exports.game_encodings.hilo.opcodes.lower, 1);
        assert_eq!(exports.game_encodings.hilo.opcodes.same, 2);
        assert_eq!(exports.game_encodings.hilo.opcodes.cashout, 3);
    }

    /// AC-3.1: Game bet types are exported.
    #[test]
    fn test_game_bet_types_exported_ac_3_1() {
        let exports = ProtocolExports::canonical();

        // Baccarat bet types
        assert_eq!(exports.game_encodings.baccarat.bet_types.player, 0);
        assert_eq!(exports.game_encodings.baccarat.bet_types.banker, 1);
        assert_eq!(exports.game_encodings.baccarat.bet_types.tie, 2);

        // Roulette bet types
        assert_eq!(exports.game_encodings.roulette.bet_types.straight, 0);
        assert_eq!(exports.game_encodings.roulette.bet_types.split, 1);
        assert_eq!(exports.game_encodings.roulette.bet_types.red, 7);
        assert_eq!(exports.game_encodings.roulette.bet_types.black, 8);

        // Craps bet types
        assert_eq!(exports.game_encodings.craps.bet_types.pass_line, 0);
        assert_eq!(exports.game_encodings.craps.bet_types.dont_pass, 1);

        // Sic Bo bet types
        assert_eq!(exports.game_encodings.sic_bo.bet_types.small, 0);
        assert_eq!(exports.game_encodings.sic_bo.bet_types.big, 1);
    }

    /// AC-3.1: Game bit layouts are exported.
    #[test]
    fn test_game_bit_layouts_exported_ac_3_1() {
        let exports = ProtocolExports::canonical();

        // Card ID is consistently 6 bits across games
        assert_eq!(exports.game_encodings.blackjack.bit_layouts.card_id_bits, 6);
        assert_eq!(exports.game_encodings.baccarat.bit_layouts.card_id_bits, 6);
        assert_eq!(exports.game_encodings.three_card.bit_layouts.card_id_bits, 6);
        assert_eq!(exports.game_encodings.ultimate_holdem.bit_layouts.card_id_bits, 6);
        assert_eq!(exports.game_encodings.casino_war.bit_layouts.card_id_bits, 6);
        assert_eq!(exports.game_encodings.video_poker.bit_layouts.card_id_bits, 6);
        assert_eq!(exports.game_encodings.hilo.bit_layouts.card_id_bits, 6);

        // Roulette-specific
        assert_eq!(exports.game_encodings.roulette.bit_layouts.bet_type_bits, 4);
        assert_eq!(exports.game_encodings.roulette.bit_layouts.bet_value_bits, 6);

        // Craps-specific
        assert_eq!(exports.game_encodings.craps.bit_layouts.die_value_bits, 3);

        // Sic Bo-specific
        assert_eq!(exports.game_encodings.sic_bo.bit_layouts.die_value_bits, 3);
    }

    /// AC-3.2: Game encodings are exported in JSON for JS/TS consumption.
    #[test]
    fn test_game_encodings_in_json_ac_3_2() {
        let json = export_json();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // game_encodings must be present
        let encodings = parsed
            .get("game_encodings")
            .expect("game_encodings must be in export");

        // Header format
        let header = encodings.get("header").expect("header must be in game_encodings");
        assert_eq!(header["size_bits"].as_u64(), Some(8));
        assert_eq!(header["v2_version_value"].as_u64(), Some(2));

        // All games must be present
        assert!(encodings.get("blackjack").is_some(), "blackjack must be in game_encodings");
        assert!(encodings.get("baccarat").is_some(), "baccarat must be in game_encodings");
        assert!(encodings.get("roulette").is_some(), "roulette must be in game_encodings");
        assert!(encodings.get("craps").is_some(), "craps must be in game_encodings");
        assert!(encodings.get("sic_bo").is_some(), "sic_bo must be in game_encodings");
        assert!(encodings.get("three_card").is_some(), "three_card must be in game_encodings");
        assert!(encodings.get("ultimate_holdem").is_some(), "ultimate_holdem must be in game_encodings");
        assert!(encodings.get("casino_war").is_some(), "casino_war must be in game_encodings");
        assert!(encodings.get("video_poker").is_some(), "video_poker must be in game_encodings");
        assert!(encodings.get("hilo").is_some(), "hilo must be in game_encodings");
    }

    /// AC-3.2: Blackjack encoding JSON structure is complete.
    #[test]
    fn test_blackjack_encoding_json_ac_3_2() {
        let json = export_json();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        let blackjack = &parsed["game_encodings"]["blackjack"];

        // Opcodes
        assert_eq!(blackjack["opcodes"]["hit"].as_u64(), Some(0));
        assert_eq!(blackjack["opcodes"]["stand"].as_u64(), Some(1));
        assert_eq!(blackjack["opcodes"]["deal"].as_u64(), Some(4));

        // Side bet types
        assert_eq!(blackjack["side_bet_types"]["twenty_one_plus_3"].as_u64(), Some(0));
        assert_eq!(blackjack["side_bet_types"]["perfect_pairs"].as_u64(), Some(2));

        // Bit layouts
        assert_eq!(blackjack["bit_layouts"]["card_id_bits"].as_u64(), Some(6));
        assert_eq!(blackjack["bit_layouts"]["side_bet_mask_bits"].as_u64(), Some(5));
    }

    /// AC-3.2: Roulette encoding JSON structure is complete.
    #[test]
    fn test_roulette_encoding_json_ac_3_2() {
        let json = export_json();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        let roulette = &parsed["game_encodings"]["roulette"];

        // Opcodes
        assert_eq!(roulette["opcodes"]["place_bet"].as_u64(), Some(0));
        assert_eq!(roulette["opcodes"]["spin"].as_u64(), Some(1));
        assert_eq!(roulette["opcodes"]["atomic_batch"].as_u64(), Some(4));

        // Bet types
        assert_eq!(roulette["bet_types"]["straight"].as_u64(), Some(0));
        assert_eq!(roulette["bet_types"]["red"].as_u64(), Some(7));
        assert_eq!(roulette["bet_types"]["basket"].as_u64(), Some(13));

        // Bit layouts
        assert_eq!(roulette["bit_layouts"]["bet_type_bits"].as_u64(), Some(4));
        assert_eq!(roulette["bit_layouts"]["result_bits"].as_u64(), Some(6));
    }

    /// AC-3.2: Game encodings roundtrip through JSON.
    #[test]
    fn test_game_encodings_roundtrip_ac_3_2() {
        let exports = ProtocolExports::canonical();
        let json = serde_json::to_string(&exports).unwrap();
        let parsed: ProtocolExports = serde_json::from_str(&json).unwrap();

        // Game encodings must roundtrip exactly
        assert_eq!(
            exports.game_encodings, parsed.game_encodings,
            "game_encodings must roundtrip through JSON"
        );
    }

    /// AC-3.1/AC-3.2: All 10 games are exported with complete encoding info.
    #[test]
    fn test_all_games_have_complete_encoding_ac_3_1_ac_3_2() {
        let exports = ProtocolExports::canonical();

        // Verify each game has opcodes (by checking at least one opcode field exists)
        // This ensures we don't accidentally export empty structs

        // Blackjack: 8 opcodes
        assert!(exports.game_encodings.blackjack.opcodes.set_rules <= 7);

        // Baccarat: 5 opcodes
        assert!(exports.game_encodings.baccarat.opcodes.set_rules <= 4);

        // Roulette: 5 opcodes
        assert!(exports.game_encodings.roulette.opcodes.atomic_batch <= 4);

        // Craps: 5 opcodes
        assert!(exports.game_encodings.craps.opcodes.atomic_batch <= 4);

        // Sic Bo: 5 opcodes
        assert!(exports.game_encodings.sic_bo.opcodes.set_rules <= 4);

        // Three Card: 5 opcodes
        assert!(exports.game_encodings.three_card.opcodes.set_rules <= 4);

        // Ultimate Hold'em: 6 opcodes
        assert!(exports.game_encodings.ultimate_holdem.opcodes.set_rules <= 5);

        // Casino War: 5 opcodes
        assert!(exports.game_encodings.casino_war.opcodes.set_rules <= 4);

        // Video Poker: 2 opcodes
        assert!(exports.game_encodings.video_poker.opcodes.set_rules <= 1);

        // Hi-Lo: 4 opcodes
        assert!(exports.game_encodings.hilo.opcodes.cashout <= 3);
    }
}
