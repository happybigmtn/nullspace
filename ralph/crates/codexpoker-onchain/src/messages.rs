//! Consensus payload schema for CodexPoker onchain messages.
//!
//! This module defines the [`ConsensusPayload`] enum which wraps all message types
//! that the consensus layer can process. By centralizing all payload types here,
//! we ensure:
//!
//! 1. **Type-safe dispatch**: Pattern matching ensures all payload variants are handled.
//! 2. **Canonical encoding**: All payloads use deterministic encoding for replay.
//! 3. **Version binding**: Protocol version is embedded in each payload.
//!
//! # Deal Commitment Flow
//!
//! The deal commitment must be the first payload in any hand's action log:
//!
//! ```text
//! 1. DealCommitment (broadcast by dealer, includes shuffle commitment)
//! 2. DealCommitmentAck (one per player, gates play)
//! 3. GameAction (player actions, each bound to commitment hash)
//! 4. RevealShare / TimelockReveal (card reveals at each street)
//! ```
//!
//! Consensus rejects action logs that:
//! - Begin with anything other than a `DealCommitment`
//! - Have actions not bound to the commitment hash
//! - Have reveals for a different commitment

use protocol_messages::{
    DealCommitment, DealCommitmentAck, ProtocolVersion, RevealShare, TimelockReveal,
    CURRENT_PROTOCOL_VERSION,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Errors that can occur when validating consensus payloads.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum PayloadError {
    /// Protocol version mismatch.
    #[error("unsupported protocol version: expected {expected}, got {got}")]
    UnsupportedVersion { expected: u8, got: u8 },

    /// Payload encoding error.
    #[error("payload encoding error: {0}")]
    EncodingError(String),

    /// Missing required field.
    #[error("missing required field: {0}")]
    MissingField(&'static str),

    /// Invalid commitment hash.
    #[error("invalid commitment hash")]
    InvalidCommitmentHash,

    /// Scope mismatch.
    #[error("scope mismatch: expected {expected}, got {got}")]
    ScopeMismatch { expected: String, got: String },
}

/// The consensus payload schema wrapping all onchain message types.
///
/// This enum represents every type of message that can appear in the
/// consensus-ordered action log. Each variant maps to a specific protocol
/// message type from [`protocol_messages`].
///
/// # Ordering Guarantees
///
/// The consensus layer orders payloads deterministically. Given the same
/// ordered sequence of payloads, all validators will produce identical
/// state transitions and settlement outcomes.
///
/// # Commitment Binding
///
/// The first payload in any hand must be [`ConsensusPayload::DealCommitment`].
/// All subsequent payloads (actions, reveals) must reference this commitment's
/// hash in their structure or signature preimage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConsensusPayload {
    /// A deal commitment broadcast by the dealer before the hand begins.
    ///
    /// This is the anchor for all subsequent actions in the hand. The
    /// commitment hash is bound into every action signature.
    DealCommitment(DealCommitment),

    /// Acknowledgment that a player received and verified the deal commitment.
    ///
    /// Play cannot proceed until all seated players have acknowledged.
    DealCommitmentAck(DealCommitmentAck),

    /// A game action (bet, call, fold, etc.) from a player.
    ///
    /// The action's signature preimage must include the deal commitment hash.
    GameAction(GameActionMessage),

    /// A selective card reveal for a specific game phase.
    ///
    /// Only reveals the cards required by poker rules for that phase.
    RevealShare(RevealShare),

    /// A timelock-based reveal when a player times out.
    ///
    /// Allows deterministic continuation without the unresponsive player.
    TimelockReveal(TimelockReveal),
}

impl ConsensusPayload {
    /// Extract the protocol version from any payload variant.
    pub fn version(&self) -> ProtocolVersion {
        match self {
            ConsensusPayload::DealCommitment(dc) => dc.version,
            ConsensusPayload::DealCommitmentAck(ack) => ack.version,
            ConsensusPayload::GameAction(ga) => ga.version,
            ConsensusPayload::RevealShare(rs) => rs.version,
            ConsensusPayload::TimelockReveal(tr) => tr.version,
        }
    }

    /// Validate that the payload uses a supported protocol version.
    pub fn validate_version(&self) -> Result<(), PayloadError> {
        let v = self.version();
        if v.0 != CURRENT_PROTOCOL_VERSION {
            return Err(PayloadError::UnsupportedVersion {
                expected: CURRENT_PROTOCOL_VERSION,
                got: v.0,
            });
        }
        Ok(())
    }

    /// Returns true if this payload is a deal commitment.
    pub fn is_deal_commitment(&self) -> bool {
        matches!(self, ConsensusPayload::DealCommitment(_))
    }

    /// Extract the deal commitment if this payload is one.
    pub fn as_deal_commitment(&self) -> Option<&DealCommitment> {
        match self {
            ConsensusPayload::DealCommitment(dc) => Some(dc),
            _ => None,
        }
    }

    /// Extract the commitment hash this payload references.
    ///
    /// - `DealCommitment`: returns its own hash
    /// - `DealCommitmentAck`: returns the hash it acknowledges
    /// - `GameAction`: returns the commitment hash bound in the action
    /// - `RevealShare` / `TimelockReveal`: returns the commitment hash they reference
    pub fn referenced_commitment_hash(&self) -> Option<[u8; 32]> {
        match self {
            ConsensusPayload::DealCommitment(dc) => Some(dc.commitment_hash()),
            ConsensusPayload::DealCommitmentAck(ack) => Some(ack.commitment_hash),
            ConsensusPayload::GameAction(ga) => Some(ga.deal_commitment_hash),
            ConsensusPayload::RevealShare(rs) => Some(rs.commitment_hash),
            ConsensusPayload::TimelockReveal(tr) => Some(tr.commitment_hash),
        }
    }
}

/// Domain separation prefix for game action messages.
pub const GAME_ACTION_DOMAIN: &[u8] = b"nullspace.game_action.v1";

/// A game action message with commitment binding.
///
/// This represents any player action (bet, call, raise, fold, check, all-in)
/// with the deal commitment hash bound into the signature preimage.
///
/// # Commitment Binding Security
///
/// The `deal_commitment_hash` field is included in the signature preimage.
/// This ensures that:
///
/// 1. An action signed for one deal cannot be replayed for a different deal.
/// 2. If the commitment is tampered with, all action signatures become invalid.
/// 3. Verification is deterministic: given the commitment hash and action data,
///    signature verification succeeds or fails identically on all validators.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GameActionMessage {
    /// Protocol version for this message.
    pub version: ProtocolVersion,

    /// Hash of the deal commitment this action is bound to.
    ///
    /// This field MUST match the commitment hash of the hand's `DealCommitment`.
    /// Consensus rejects actions with mismatched commitment hashes.
    pub deal_commitment_hash: [u8; 32],

    /// Seat index of the player taking the action.
    pub seat_index: u8,

    /// Action type code.
    ///
    /// Common codes:
    /// - 0: Fold
    /// - 1: Check
    /// - 2: Call
    /// - 3: Bet
    /// - 4: Raise
    /// - 5: All-in
    pub action_type: u8,

    /// Amount associated with the action (for bets/raises/calls).
    /// Zero for fold/check.
    pub amount: u64,

    /// Monotonically increasing sequence number within the hand.
    /// Prevents replay of actions within the same hand.
    pub sequence: u32,

    /// Player's signature over the action preimage.
    pub signature: Vec<u8>,
}

impl GameActionMessage {
    /// Domain-separated preimage for hashing/signing.
    ///
    /// The preimage includes the deal commitment hash, binding this action
    /// to a specific deal. The signature is not part of the preimage.
    pub fn preimage(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(GAME_ACTION_DOMAIN);
        buf.push(self.version.0);
        buf.extend_from_slice(&self.deal_commitment_hash);
        buf.push(self.seat_index);
        buf.push(self.action_type);
        buf.extend_from_slice(&self.amount.to_le_bytes());
        buf.extend_from_slice(&self.sequence.to_le_bytes());
        buf
    }

    /// Canonical hash of this action message.
    pub fn action_hash(&self) -> [u8; 32] {
        protocol_messages::canonical_hash(&self.preimage())
    }
}

/// Action type codes for game actions.
///
/// These codes are used in [`GameActionMessage::action_type`].
pub mod action_codes {
    /// Player folds their hand.
    pub const FOLD: u8 = 0;
    /// Player checks (no bet, passes action).
    pub const CHECK: u8 = 1;
    /// Player calls the current bet.
    pub const CALL: u8 = 2;
    /// Player makes an initial bet.
    pub const BET: u8 = 3;
    /// Player raises the current bet.
    pub const RAISE: u8 = 4;
    /// Player goes all-in.
    pub const ALL_IN: u8 = 5;
}

#[cfg(test)]
mod tests {
    use super::*;
    use protocol_messages::ScopeBinding;

    fn test_scope() -> ScopeBinding {
        ScopeBinding::new([1u8; 32], 42, vec![0, 1, 2, 3], 52)
    }

    fn test_deal_commitment() -> DealCommitment {
        DealCommitment {
            version: ProtocolVersion::current(),
            scope: test_scope(),
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![[3u8; 32]],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![0xDE, 0xAD],
        }
    }

    #[test]
    fn test_consensus_payload_deal_commitment() {
        let dc = test_deal_commitment();
        let hash = dc.commitment_hash();
        let payload = ConsensusPayload::DealCommitment(dc);

        assert!(payload.is_deal_commitment());
        assert!(payload.as_deal_commitment().is_some());
        assert_eq!(payload.referenced_commitment_hash(), Some(hash));
        assert!(payload.validate_version().is_ok());
    }

    #[test]
    fn test_consensus_payload_game_action_binding() {
        let dc = test_deal_commitment();
        let commitment_hash = dc.commitment_hash();

        let action = GameActionMessage {
            version: ProtocolVersion::current(),
            deal_commitment_hash: commitment_hash,
            seat_index: 0,
            action_type: action_codes::BET,
            amount: 100,
            sequence: 1,
            signature: vec![0xAB, 0xCD],
        };

        let payload = ConsensusPayload::GameAction(action);
        assert_eq!(payload.referenced_commitment_hash(), Some(commitment_hash));
    }

    #[test]
    fn test_game_action_preimage_includes_commitment() {
        let commitment_hash = [0xAA; 32];

        let action = GameActionMessage {
            version: ProtocolVersion::current(),
            deal_commitment_hash: commitment_hash,
            seat_index: 0,
            action_type: action_codes::BET,
            amount: 100,
            sequence: 1,
            signature: vec![],
        };

        let preimage = action.preimage();

        // Verify domain prefix
        assert!(preimage.starts_with(GAME_ACTION_DOMAIN));

        // Verify commitment hash is in preimage (after domain + version)
        let offset = GAME_ACTION_DOMAIN.len() + 1; // +1 for version byte
        assert_eq!(
            &preimage[offset..offset + 32],
            &commitment_hash,
            "commitment hash must be in preimage"
        );
    }

    #[test]
    fn test_game_action_hash_changes_with_commitment() {
        let mut action = GameActionMessage {
            version: ProtocolVersion::current(),
            deal_commitment_hash: [0xAA; 32],
            seat_index: 0,
            action_type: action_codes::BET,
            amount: 100,
            sequence: 1,
            signature: vec![],
        };

        let hash1 = action.action_hash();

        // Change commitment hash
        action.deal_commitment_hash = [0xBB; 32];
        let hash2 = action.action_hash();

        assert_ne!(hash1, hash2, "different commitment hash must produce different action hash");
    }

    #[test]
    fn test_game_action_signature_excluded_from_preimage() {
        let mut action = GameActionMessage {
            version: ProtocolVersion::current(),
            deal_commitment_hash: [0xAA; 32],
            seat_index: 0,
            action_type: action_codes::BET,
            amount: 100,
            sequence: 1,
            signature: vec![0x11, 0x22],
        };

        let preimage1 = action.preimage();

        action.signature = vec![0x33, 0x44, 0x55, 0x66];
        let preimage2 = action.preimage();

        assert_eq!(preimage1, preimage2, "signature must not affect preimage");
    }

    #[test]
    fn test_version_validation_current() {
        let dc = test_deal_commitment();
        let payload = ConsensusPayload::DealCommitment(dc);
        assert!(payload.validate_version().is_ok());
    }

    #[test]
    fn test_version_validation_mismatch() {
        let mut dc = test_deal_commitment();
        dc.version = ProtocolVersion::new(99);
        let payload = ConsensusPayload::DealCommitment(dc);

        let result = payload.validate_version();
        assert!(result.is_err());
        if let Err(PayloadError::UnsupportedVersion { expected, got }) = result {
            assert_eq!(expected, CURRENT_PROTOCOL_VERSION);
            assert_eq!(got, 99);
        } else {
            panic!("expected UnsupportedVersion error");
        }
    }

    #[test]
    fn test_all_payload_variants_have_version() {
        let dc = test_deal_commitment();
        let commitment_hash = dc.commitment_hash();

        let payloads = vec![
            ConsensusPayload::DealCommitment(dc),
            ConsensusPayload::DealCommitmentAck(DealCommitmentAck {
                version: ProtocolVersion::current(),
                commitment_hash,
                seat_index: 0,
                player_signature: vec![],
            }),
            ConsensusPayload::GameAction(GameActionMessage {
                version: ProtocolVersion::current(),
                deal_commitment_hash: commitment_hash,
                seat_index: 0,
                action_type: action_codes::FOLD,
                amount: 0,
                sequence: 1,
                signature: vec![],
            }),
            ConsensusPayload::RevealShare(RevealShare {
                version: ProtocolVersion::current(),
                commitment_hash,
                phase: protocol_messages::RevealPhase::Flop,
                card_indices: vec![0, 1, 2],
                reveal_data: vec![vec![1], vec![2], vec![3]],
                from_seat: 0,
                signature: vec![],
            }),
            ConsensusPayload::TimelockReveal(TimelockReveal {
                version: ProtocolVersion::current(),
                commitment_hash,
                phase: protocol_messages::RevealPhase::Turn,
                card_indices: vec![3],
                timelock_proof: vec![],
                revealed_values: vec![vec![4]],
                timeout_seat: 1,
            }),
        ];

        for payload in payloads {
            assert_eq!(
                payload.version(),
                ProtocolVersion::current(),
                "all payloads must have current version"
            );
        }
    }

    #[test]
    fn test_all_payload_variants_reference_commitment() {
        let dc = test_deal_commitment();
        let commitment_hash = dc.commitment_hash();

        let payloads = vec![
            ConsensusPayload::DealCommitment(dc),
            ConsensusPayload::DealCommitmentAck(DealCommitmentAck {
                version: ProtocolVersion::current(),
                commitment_hash,
                seat_index: 0,
                player_signature: vec![],
            }),
            ConsensusPayload::GameAction(GameActionMessage {
                version: ProtocolVersion::current(),
                deal_commitment_hash: commitment_hash,
                seat_index: 0,
                action_type: action_codes::FOLD,
                amount: 0,
                sequence: 1,
                signature: vec![],
            }),
            ConsensusPayload::RevealShare(RevealShare {
                version: ProtocolVersion::current(),
                commitment_hash,
                phase: protocol_messages::RevealPhase::Flop,
                card_indices: vec![0, 1, 2],
                reveal_data: vec![vec![1], vec![2], vec![3]],
                from_seat: 0,
                signature: vec![],
            }),
            ConsensusPayload::TimelockReveal(TimelockReveal {
                version: ProtocolVersion::current(),
                commitment_hash,
                phase: protocol_messages::RevealPhase::Turn,
                card_indices: vec![3],
                timelock_proof: vec![],
                revealed_values: vec![vec![4]],
                timeout_seat: 1,
            }),
        ];

        for payload in &payloads {
            assert!(
                payload.referenced_commitment_hash().is_some(),
                "all payloads must reference a commitment"
            );
        }

        // Non-DealCommitment payloads should reference the same hash
        for payload in payloads.iter().skip(1) {
            assert_eq!(
                payload.referenced_commitment_hash(),
                Some(commitment_hash),
                "all non-commitment payloads must reference the deal commitment hash"
            );
        }
    }
}
