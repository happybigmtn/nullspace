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
pub const EXPORT_SCHEMA_VERSION: u32 = 2;

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
/// assert!(json.contains("\"schema_version\": 2")); // pretty-printed with space
/// assert!(json.contains("\"current\": 1")); // versions.current
/// assert!(json.contains("\"consensus_payload_tags\"")); // AC-1.1 tags
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
            EXPORT_SCHEMA_VERSION, 2,
            "Schema version 2 adds consensus_payload_tags, game_action_codes, disabled_features (AC-1.1)"
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
}
