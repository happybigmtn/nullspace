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
    DealCommitment, DealCommitmentAck, ProtocolVersion, RevealShare, ShuffleContext,
    ShuffleContextMismatch, TimelockReveal, CURRENT_PROTOCOL_VERSION,
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

    /// First payload must be a DealCommitment.
    #[error("first payload must be a DealCommitment, got {got}")]
    MissingInitialCommitment { got: &'static str },

    /// Duplicate DealCommitment in action log.
    #[error("duplicate DealCommitment: only one allowed per hand")]
    DuplicateCommitment,

    /// Payload references wrong commitment hash.
    #[error("commitment hash mismatch: expected {expected:?}, got {got:?}")]
    CommitmentHashMismatch { expected: [u8; 32], got: [u8; 32] },

    /// Action received before all players acknowledged the deal commitment.
    #[error("action before all acks: received {received}/{required} acks")]
    ActionBeforeAllAcks { received: usize, required: usize },

    /// Duplicate ack from the same seat.
    #[error("duplicate ack from seat {seat}")]
    DuplicateAck { seat: u8 },

    /// Ack from a seat not in the scope's seat order.
    #[error("ack from invalid seat {seat}: not in seat order")]
    InvalidAckSeat { seat: u8 },

    /// Shuffle context mismatch.
    ///
    /// The deal commitment's scope doesn't match the expected shuffle context.
    /// This prevents replay attacks where a commitment is reused across different
    /// tables, hands, or player configurations.
    #[error("shuffle context mismatch: {0}")]
    ShuffleContextMismatch(#[from] ShuffleContextMismatch),
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

// ─────────────────────────────────────────────────────────────────────────────
// Action Log Validator
// ─────────────────────────────────────────────────────────────────────────────

/// Validates the ordering and commitment binding of an action log.
///
/// This validator enforces the critical invariants:
/// 1. The first payload in any hand must be a `DealCommitment`
/// 2. Exactly one `DealCommitment` is allowed per hand
/// 3. All subsequent payloads must reference the commitment hash
/// 4. **Ack gating**: All seated players must acknowledge the commitment before
///    any `GameAction` or reveal payloads are accepted
///
/// # Deterministic Validation
///
/// Given the same ordered sequence of payloads, this validator produces
/// identical accept/reject decisions on all validators. This is essential
/// for consensus: all honest nodes must agree on whether an action log
/// is valid.
///
/// # Ack Gating
///
/// After receiving a `DealCommitment`, the validator enters the "ack collection"
/// phase. During this phase:
/// - Only `DealCommitmentAck` payloads are accepted
/// - Each ack must come from a seat listed in the commitment's `scope.seat_order`
/// - Duplicate acks from the same seat are rejected
/// - Once all seats have acked, the validator transitions to accepting game actions
///
/// This prevents players from taking actions before confirming they received
/// the deal, which could enable griefing attacks.
///
/// # Usage
///
/// ```
/// use codexpoker_onchain::{ActionLogValidator, ConsensusPayload, GameActionMessage, action_codes};
/// use protocol_messages::{DealCommitment, DealCommitmentAck, ProtocolVersion, ScopeBinding};
///
/// let mut validator = ActionLogValidator::new();
///
/// // First payload must be a DealCommitment
/// let scope = ScopeBinding::new([1u8; 32], 1, vec![0, 1], 52);
/// let deal = DealCommitment {
///     version: ProtocolVersion::current(),
///     scope,
///     shuffle_commitment: [2u8; 32],
///     artifact_hashes: vec![],
///     timestamp_ms: 1700000000000,
///     dealer_signature: vec![],
/// };
/// let commitment_hash = deal.commitment_hash();
/// let payload = ConsensusPayload::DealCommitment(deal);
///
/// assert!(validator.validate(&payload).is_ok());
///
/// // All seats must ack before game actions are allowed
/// for seat in [0, 1] {
///     let ack = DealCommitmentAck {
///         version: ProtocolVersion::current(),
///         commitment_hash,
///         seat_index: seat,
///         player_signature: vec![],
///     };
///     assert!(validator.validate(&ConsensusPayload::DealCommitmentAck(ack)).is_ok());
/// }
///
/// // Now game actions are allowed
/// assert!(validator.all_acks_received());
/// ```
#[derive(Debug, Clone)]
pub struct ActionLogValidator {
    /// The commitment hash for this hand, set after seeing the first DealCommitment.
    commitment_hash: Option<[u8; 32]>,
    /// Number of payloads processed.
    payload_count: usize,
    /// Seats that must acknowledge (from scope.seat_order).
    required_seats: Vec<u8>,
    /// Seats that have acknowledged so far.
    acked_seats: Vec<u8>,
    /// Expected shuffle context for verification.
    ///
    /// When set, the validator will verify that the `DealCommitment`'s scope
    /// matches this expected context. This prevents replay attacks where a
    /// commitment from one table/hand is reused in a different context.
    expected_context: Option<ShuffleContext>,
}

impl Default for ActionLogValidator {
    fn default() -> Self {
        Self::new()
    }
}

impl ActionLogValidator {
    /// Create a new validator for a fresh action log.
    ///
    /// This creates a validator without shuffle context verification.
    /// Use [`with_expected_context`](Self::with_expected_context) to enable
    /// context verification.
    pub fn new() -> Self {
        Self {
            commitment_hash: None,
            payload_count: 0,
            required_seats: Vec::new(),
            acked_seats: Vec::new(),
            expected_context: None,
        }
    }

    /// Create a new validator with expected shuffle context verification.
    ///
    /// When the `DealCommitment` is received, the validator will verify that
    /// its scope matches the expected context. This prevents replay attacks
    /// where a commitment is reused across different tables, hands, or player
    /// configurations.
    ///
    /// # Example
    ///
    /// ```
    /// use codexpoker_onchain::ActionLogValidator;
    /// use protocol_messages::{ProtocolVersion, ShuffleContext};
    ///
    /// let expected = ShuffleContext::new(
    ///     ProtocolVersion::current(),
    ///     [1u8; 32],  // table_id
    ///     42,          // hand_id
    ///     vec![0, 1],  // seat_order
    ///     52,          // deck_length
    /// );
    ///
    /// let validator = ActionLogValidator::with_expected_context(expected);
    /// // Now any DealCommitment will be verified against this context
    /// ```
    pub fn with_expected_context(expected: ShuffleContext) -> Self {
        Self {
            commitment_hash: None,
            payload_count: 0,
            required_seats: Vec::new(),
            acked_seats: Vec::new(),
            expected_context: Some(expected),
        }
    }

    /// Returns the commitment hash if one has been established.
    pub fn commitment_hash(&self) -> Option<[u8; 32]> {
        self.commitment_hash
    }

    /// Returns the number of payloads processed.
    pub fn payload_count(&self) -> usize {
        self.payload_count
    }

    /// Returns true if the validator has seen a DealCommitment.
    pub fn has_commitment(&self) -> bool {
        self.commitment_hash.is_some()
    }

    /// Returns true if all required seats have acknowledged the commitment.
    ///
    /// This returns `false` if no commitment has been received yet.
    pub fn all_acks_received(&self) -> bool {
        !self.required_seats.is_empty()
            && self.acked_seats.len() == self.required_seats.len()
    }

    /// Returns the number of acks received so far.
    pub fn ack_count(&self) -> usize {
        self.acked_seats.len()
    }

    /// Returns the number of acks required (seats in the commitment scope).
    pub fn required_ack_count(&self) -> usize {
        self.required_seats.len()
    }

    /// Returns the seats that have acknowledged so far.
    pub fn acked_seats(&self) -> &[u8] {
        &self.acked_seats
    }

    /// Returns the seats that still need to acknowledge.
    pub fn pending_ack_seats(&self) -> Vec<u8> {
        self.required_seats
            .iter()
            .filter(|s| !self.acked_seats.contains(s))
            .copied()
            .collect()
    }

    /// Returns the expected shuffle context if one was set.
    pub fn expected_context(&self) -> Option<&ShuffleContext> {
        self.expected_context.as_ref()
    }

    /// Returns true if shuffle context verification is enabled.
    pub fn has_expected_context(&self) -> bool {
        self.expected_context.is_some()
    }

    /// Validate a payload and update validator state.
    ///
    /// This method enforces:
    /// 1. First payload must be `DealCommitment`
    /// 2. Only one `DealCommitment` allowed
    /// 3. All other payloads must reference the established commitment hash
    /// 4. All seats must ack before `GameAction` or reveal payloads are accepted
    /// 5. **Shuffle context verification** (if enabled): the `DealCommitment`'s scope
    ///    must match the expected context
    ///
    /// # Errors
    ///
    /// - [`PayloadError::MissingInitialCommitment`] if first payload is not a DealCommitment
    /// - [`PayloadError::DuplicateCommitment`] if a second DealCommitment is seen
    /// - [`PayloadError::CommitmentHashMismatch`] if payload references wrong commitment
    /// - [`PayloadError::ActionBeforeAllAcks`] if action/reveal received before all acks
    /// - [`PayloadError::DuplicateAck`] if same seat acks twice
    /// - [`PayloadError::InvalidAckSeat`] if ack comes from seat not in scope
    /// - [`PayloadError::ShuffleContextMismatch`] if commitment scope doesn't match expected context
    pub fn validate(&mut self, payload: &ConsensusPayload) -> Result<(), PayloadError> {
        // First payload must be a DealCommitment
        if self.payload_count == 0 {
            match payload {
                ConsensusPayload::DealCommitment(dc) => {
                    // Verify shuffle context if expected context is set
                    if let Some(expected) = &self.expected_context {
                        // Convert the commitment's scope to a ShuffleContext for comparison
                        let actual = ShuffleContext::from_scope(dc.version, &dc.scope);
                        expected.verify_matches(&actual)?;
                    }

                    self.commitment_hash = Some(dc.commitment_hash());
                    self.required_seats = dc.scope.seat_order.clone();
                    self.payload_count += 1;
                    return Ok(());
                }
                ConsensusPayload::DealCommitmentAck(_) => {
                    return Err(PayloadError::MissingInitialCommitment {
                        got: "DealCommitmentAck",
                    });
                }
                ConsensusPayload::GameAction(_) => {
                    return Err(PayloadError::MissingInitialCommitment {
                        got: "GameAction",
                    });
                }
                ConsensusPayload::RevealShare(_) => {
                    return Err(PayloadError::MissingInitialCommitment {
                        got: "RevealShare",
                    });
                }
                ConsensusPayload::TimelockReveal(_) => {
                    return Err(PayloadError::MissingInitialCommitment {
                        got: "TimelockReveal",
                    });
                }
            }
        }

        // After the first payload, no more DealCommitments allowed
        if payload.is_deal_commitment() {
            return Err(PayloadError::DuplicateCommitment);
        }

        // All other payloads must reference the established commitment hash
        let expected = self
            .commitment_hash
            .expect("commitment_hash must be set after first payload");

        if let Some(got) = payload.referenced_commitment_hash() {
            if got != expected {
                return Err(PayloadError::CommitmentHashMismatch { expected, got });
            }
        }

        // Handle ack gating
        match payload {
            ConsensusPayload::DealCommitmentAck(ack) => {
                // Validate seat is in required_seats
                if !self.required_seats.contains(&ack.seat_index) {
                    return Err(PayloadError::InvalidAckSeat {
                        seat: ack.seat_index,
                    });
                }

                // Reject duplicate acks
                if self.acked_seats.contains(&ack.seat_index) {
                    return Err(PayloadError::DuplicateAck {
                        seat: ack.seat_index,
                    });
                }

                // Record this ack
                self.acked_seats.push(ack.seat_index);
            }
            ConsensusPayload::GameAction(_)
            | ConsensusPayload::RevealShare(_)
            | ConsensusPayload::TimelockReveal(_) => {
                // Actions and reveals require all acks to be received first
                if !self.all_acks_received() {
                    return Err(PayloadError::ActionBeforeAllAcks {
                        received: self.acked_seats.len(),
                        required: self.required_seats.len(),
                    });
                }
            }
            ConsensusPayload::DealCommitment(_) => {
                // Already handled above (DuplicateCommitment check)
                unreachable!("DealCommitment handled above");
            }
        }

        self.payload_count += 1;
        Ok(())
    }

    /// Validate an entire action log at once.
    ///
    /// This is a convenience method that processes all payloads in order
    /// and returns the first error encountered, if any.
    ///
    /// This method does not perform shuffle context verification. Use
    /// [`validate_log_with_context`](Self::validate_log_with_context) for
    /// context-aware validation.
    pub fn validate_log(payloads: &[ConsensusPayload]) -> Result<[u8; 32], PayloadError> {
        if payloads.is_empty() {
            return Err(PayloadError::MissingField("action log is empty"));
        }

        let mut validator = Self::new();
        for payload in payloads {
            validator.validate(payload)?;
        }

        Ok(validator
            .commitment_hash
            .expect("commitment hash must be set after validating non-empty log"))
    }

    /// Validate an entire action log with shuffle context verification.
    ///
    /// This is a convenience method that processes all payloads in order,
    /// verifying that the `DealCommitment`'s scope matches the expected
    /// shuffle context.
    ///
    /// # Errors
    ///
    /// Returns [`PayloadError::ShuffleContextMismatch`] if the commitment's scope
    /// doesn't match the expected context.
    pub fn validate_log_with_context(
        payloads: &[ConsensusPayload],
        expected: ShuffleContext,
    ) -> Result<[u8; 32], PayloadError> {
        if payloads.is_empty() {
            return Err(PayloadError::MissingField("action log is empty"));
        }

        let mut validator = Self::with_expected_context(expected);
        for payload in payloads {
            validator.validate(payload)?;
        }

        Ok(validator
            .commitment_hash
            .expect("commitment hash must be set after validating non-empty log"))
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

    // ─────────────────────────────────────────────────────────────────────────
    // ActionLogValidator tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_validator_accepts_commitment_first() {
        let mut validator = ActionLogValidator::new();
        let dc = test_deal_commitment();
        let payload = ConsensusPayload::DealCommitment(dc);

        assert!(validator.validate(&payload).is_ok());
        assert!(validator.has_commitment());
        assert_eq!(validator.payload_count(), 1);
    }

    #[test]
    fn test_validator_rejects_action_before_commitment() {
        let mut validator = ActionLogValidator::new();
        let action = GameActionMessage {
            version: ProtocolVersion::current(),
            deal_commitment_hash: [0xAA; 32],
            seat_index: 0,
            action_type: action_codes::BET,
            amount: 100,
            sequence: 1,
            signature: vec![],
        };
        let payload = ConsensusPayload::GameAction(action);

        let result = validator.validate(&payload);
        assert!(matches!(
            result,
            Err(PayloadError::MissingInitialCommitment { got: "GameAction" })
        ));
    }

    #[test]
    fn test_validator_rejects_ack_before_commitment() {
        let mut validator = ActionLogValidator::new();
        let ack = DealCommitmentAck {
            version: ProtocolVersion::current(),
            commitment_hash: [0xAA; 32],
            seat_index: 0,
            player_signature: vec![],
        };
        let payload = ConsensusPayload::DealCommitmentAck(ack);

        let result = validator.validate(&payload);
        assert!(matches!(
            result,
            Err(PayloadError::MissingInitialCommitment {
                got: "DealCommitmentAck"
            })
        ));
    }

    #[test]
    fn test_validator_rejects_reveal_before_commitment() {
        let mut validator = ActionLogValidator::new();
        let reveal = RevealShare {
            version: ProtocolVersion::current(),
            commitment_hash: [0xAA; 32],
            phase: protocol_messages::RevealPhase::Flop,
            card_indices: vec![0, 1, 2],
            reveal_data: vec![vec![1], vec![2], vec![3]],
            from_seat: 0,
            signature: vec![],
        };
        let payload = ConsensusPayload::RevealShare(reveal);

        let result = validator.validate(&payload);
        assert!(matches!(
            result,
            Err(PayloadError::MissingInitialCommitment { got: "RevealShare" })
        ));
    }

    #[test]
    fn test_validator_rejects_timelock_before_commitment() {
        let mut validator = ActionLogValidator::new();
        let reveal = TimelockReveal {
            version: ProtocolVersion::current(),
            commitment_hash: [0xAA; 32],
            phase: protocol_messages::RevealPhase::Turn,
            card_indices: vec![3],
            timelock_proof: vec![],
            revealed_values: vec![vec![4]],
            timeout_seat: 1,
        };
        let payload = ConsensusPayload::TimelockReveal(reveal);

        let result = validator.validate(&payload);
        assert!(matches!(
            result,
            Err(PayloadError::MissingInitialCommitment {
                got: "TimelockReveal"
            })
        ));
    }

    #[test]
    fn test_validator_rejects_duplicate_commitment() {
        let mut validator = ActionLogValidator::new();
        let dc1 = test_deal_commitment();
        let dc2 = test_deal_commitment();

        assert!(validator
            .validate(&ConsensusPayload::DealCommitment(dc1))
            .is_ok());

        let result = validator.validate(&ConsensusPayload::DealCommitment(dc2));
        assert!(matches!(result, Err(PayloadError::DuplicateCommitment)));
    }

    #[test]
    fn test_validator_accepts_matching_commitment_hash() {
        let mut validator = ActionLogValidator::new();
        let dc = test_deal_commitment();
        let commitment_hash = dc.commitment_hash();

        assert!(validator
            .validate(&ConsensusPayload::DealCommitment(dc))
            .is_ok());

        // All seats (0, 1, 2, 3) must ack before actions are allowed
        for seat in [0, 1, 2, 3] {
            let ack = DealCommitmentAck {
                version: ProtocolVersion::current(),
                commitment_hash,
                seat_index: seat,
                player_signature: vec![],
            };
            assert!(validator
                .validate(&ConsensusPayload::DealCommitmentAck(ack))
                .is_ok());
        }

        // Now action with matching hash should be accepted
        let action = GameActionMessage {
            version: ProtocolVersion::current(),
            deal_commitment_hash: commitment_hash,
            seat_index: 0,
            action_type: action_codes::BET,
            amount: 100,
            sequence: 1,
            signature: vec![],
        };
        assert!(validator
            .validate(&ConsensusPayload::GameAction(action))
            .is_ok());

        assert_eq!(validator.payload_count(), 6); // 1 commitment + 4 acks + 1 action
    }

    #[test]
    fn test_validator_rejects_mismatched_commitment_hash() {
        let mut validator = ActionLogValidator::new();
        let dc = test_deal_commitment();
        let correct_hash = dc.commitment_hash();

        assert!(validator
            .validate(&ConsensusPayload::DealCommitment(dc))
            .is_ok());

        // Ack with wrong hash
        let wrong_hash = [0xFF; 32];
        let ack = DealCommitmentAck {
            version: ProtocolVersion::current(),
            commitment_hash: wrong_hash,
            seat_index: 0,
            player_signature: vec![],
        };

        let result = validator.validate(&ConsensusPayload::DealCommitmentAck(ack));
        assert!(matches!(
            result,
            Err(PayloadError::CommitmentHashMismatch { expected, got })
                if expected == correct_hash && got == wrong_hash
        ));
    }

    #[test]
    fn test_validator_rejects_mismatched_action_hash() {
        let mut validator = ActionLogValidator::new();
        let dc = test_deal_commitment();
        let correct_hash = dc.commitment_hash();

        assert!(validator
            .validate(&ConsensusPayload::DealCommitment(dc))
            .is_ok());

        // Add all required acks first
        for seat in [0, 1, 2, 3] {
            let ack = DealCommitmentAck {
                version: ProtocolVersion::current(),
                commitment_hash: correct_hash,
                seat_index: seat,
                player_signature: vec![],
            };
            assert!(validator
                .validate(&ConsensusPayload::DealCommitmentAck(ack))
                .is_ok());
        }

        // Action with wrong hash (now that acks are done, this should fail on hash mismatch)
        let wrong_hash = [0xEE; 32];
        let action = GameActionMessage {
            version: ProtocolVersion::current(),
            deal_commitment_hash: wrong_hash,
            seat_index: 0,
            action_type: action_codes::BET,
            amount: 100,
            sequence: 1,
            signature: vec![],
        };

        let result = validator.validate(&ConsensusPayload::GameAction(action));
        assert!(matches!(
            result,
            Err(PayloadError::CommitmentHashMismatch { expected, got })
                if expected == correct_hash && got == wrong_hash
        ));
    }

    #[test]
    fn test_validate_log_valid_sequence() {
        let dc = test_deal_commitment();
        let commitment_hash = dc.commitment_hash();

        // Build payload sequence: commitment + all acks + action
        let mut payloads = vec![ConsensusPayload::DealCommitment(dc)];

        // Add acks for all seats in scope (0, 1, 2, 3)
        for seat in [0, 1, 2, 3] {
            payloads.push(ConsensusPayload::DealCommitmentAck(DealCommitmentAck {
                version: ProtocolVersion::current(),
                commitment_hash,
                seat_index: seat,
                player_signature: vec![],
            }));
        }

        // Now add game action
        payloads.push(ConsensusPayload::GameAction(GameActionMessage {
            version: ProtocolVersion::current(),
            deal_commitment_hash: commitment_hash,
            seat_index: 0,
            action_type: action_codes::BET,
            amount: 100,
            sequence: 1,
            signature: vec![],
        }));

        let result = ActionLogValidator::validate_log(&payloads);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), commitment_hash);
    }

    #[test]
    fn test_validate_log_empty() {
        let result = ActionLogValidator::validate_log(&[]);
        assert!(matches!(result, Err(PayloadError::MissingField(_))));
    }

    #[test]
    fn test_validate_log_no_commitment() {
        let payloads = vec![ConsensusPayload::GameAction(GameActionMessage {
            version: ProtocolVersion::current(),
            deal_commitment_hash: [0xAA; 32],
            seat_index: 0,
            action_type: action_codes::BET,
            amount: 100,
            sequence: 1,
            signature: vec![],
        })];

        let result = ActionLogValidator::validate_log(&payloads);
        assert!(matches!(
            result,
            Err(PayloadError::MissingInitialCommitment { .. })
        ));
    }

    #[test]
    fn test_validate_log_duplicate_commitment() {
        let dc1 = test_deal_commitment();
        let dc2 = test_deal_commitment();

        let payloads = vec![
            ConsensusPayload::DealCommitment(dc1),
            ConsensusPayload::DealCommitment(dc2),
        ];

        let result = ActionLogValidator::validate_log(&payloads);
        assert!(matches!(result, Err(PayloadError::DuplicateCommitment)));
    }

    #[test]
    fn test_validator_commitment_hash_accessor() {
        let mut validator = ActionLogValidator::new();
        assert!(validator.commitment_hash().is_none());

        let dc = test_deal_commitment();
        let expected_hash = dc.commitment_hash();
        assert!(validator
            .validate(&ConsensusPayload::DealCommitment(dc))
            .is_ok());

        assert_eq!(validator.commitment_hash(), Some(expected_hash));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ack Gating Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_ack_gating_rejects_action_before_all_acks() {
        let mut validator = ActionLogValidator::new();
        let dc = test_deal_commitment();
        let commitment_hash = dc.commitment_hash();

        assert!(validator
            .validate(&ConsensusPayload::DealCommitment(dc))
            .is_ok());

        // Only ack 2 of 4 required seats
        for seat in [0, 1] {
            let ack = DealCommitmentAck {
                version: ProtocolVersion::current(),
                commitment_hash,
                seat_index: seat,
                player_signature: vec![],
            };
            assert!(validator
                .validate(&ConsensusPayload::DealCommitmentAck(ack))
                .is_ok());
        }

        // Attempt action with only partial acks
        let action = GameActionMessage {
            version: ProtocolVersion::current(),
            deal_commitment_hash: commitment_hash,
            seat_index: 0,
            action_type: action_codes::BET,
            amount: 100,
            sequence: 1,
            signature: vec![],
        };

        let result = validator.validate(&ConsensusPayload::GameAction(action));
        assert!(matches!(
            result,
            Err(PayloadError::ActionBeforeAllAcks { received: 2, required: 4 })
        ));
    }

    #[test]
    fn test_ack_gating_rejects_reveal_before_all_acks() {
        let mut validator = ActionLogValidator::new();
        let dc = test_deal_commitment();
        let commitment_hash = dc.commitment_hash();

        assert!(validator
            .validate(&ConsensusPayload::DealCommitment(dc))
            .is_ok());

        // No acks at all
        let reveal = RevealShare {
            version: ProtocolVersion::current(),
            commitment_hash,
            phase: protocol_messages::RevealPhase::Flop,
            card_indices: vec![0, 1, 2],
            reveal_data: vec![vec![1], vec![2], vec![3]],
            from_seat: 0,
            signature: vec![],
        };

        let result = validator.validate(&ConsensusPayload::RevealShare(reveal));
        assert!(matches!(
            result,
            Err(PayloadError::ActionBeforeAllAcks { received: 0, required: 4 })
        ));
    }

    #[test]
    fn test_ack_gating_rejects_duplicate_ack() {
        let mut validator = ActionLogValidator::new();
        let dc = test_deal_commitment();
        let commitment_hash = dc.commitment_hash();

        assert!(validator
            .validate(&ConsensusPayload::DealCommitment(dc))
            .is_ok());

        // First ack from seat 0 succeeds
        let ack1 = DealCommitmentAck {
            version: ProtocolVersion::current(),
            commitment_hash,
            seat_index: 0,
            player_signature: vec![],
        };
        assert!(validator
            .validate(&ConsensusPayload::DealCommitmentAck(ack1))
            .is_ok());

        // Duplicate ack from seat 0 fails
        let ack2 = DealCommitmentAck {
            version: ProtocolVersion::current(),
            commitment_hash,
            seat_index: 0,
            player_signature: vec![0xAB], // Different signature doesn't matter
        };
        let result = validator.validate(&ConsensusPayload::DealCommitmentAck(ack2));
        assert!(matches!(result, Err(PayloadError::DuplicateAck { seat: 0 })));
    }

    #[test]
    fn test_ack_gating_rejects_invalid_seat() {
        let mut validator = ActionLogValidator::new();
        let dc = test_deal_commitment();
        let commitment_hash = dc.commitment_hash();

        assert!(validator
            .validate(&ConsensusPayload::DealCommitment(dc))
            .is_ok());

        // Ack from seat 99 which is not in scope (0, 1, 2, 3)
        let ack = DealCommitmentAck {
            version: ProtocolVersion::current(),
            commitment_hash,
            seat_index: 99,
            player_signature: vec![],
        };
        let result = validator.validate(&ConsensusPayload::DealCommitmentAck(ack));
        assert!(matches!(result, Err(PayloadError::InvalidAckSeat { seat: 99 })));
    }

    #[test]
    fn test_ack_gating_allows_action_after_all_acks() {
        let mut validator = ActionLogValidator::new();
        let dc = test_deal_commitment();
        let commitment_hash = dc.commitment_hash();

        assert!(validator
            .validate(&ConsensusPayload::DealCommitment(dc))
            .is_ok());

        // All 4 seats ack
        for seat in [0, 1, 2, 3] {
            let ack = DealCommitmentAck {
                version: ProtocolVersion::current(),
                commitment_hash,
                seat_index: seat,
                player_signature: vec![],
            };
            assert!(validator
                .validate(&ConsensusPayload::DealCommitmentAck(ack))
                .is_ok());
        }

        // Now action should succeed
        let action = GameActionMessage {
            version: ProtocolVersion::current(),
            deal_commitment_hash: commitment_hash,
            seat_index: 0,
            action_type: action_codes::BET,
            amount: 100,
            sequence: 1,
            signature: vec![],
        };
        assert!(validator
            .validate(&ConsensusPayload::GameAction(action))
            .is_ok());
    }

    #[test]
    fn test_ack_gating_state_accessors() {
        let mut validator = ActionLogValidator::new();
        let dc = test_deal_commitment();
        let commitment_hash = dc.commitment_hash();

        // Before commitment
        assert!(!validator.all_acks_received());
        assert_eq!(validator.ack_count(), 0);
        assert_eq!(validator.required_ack_count(), 0);

        assert!(validator
            .validate(&ConsensusPayload::DealCommitment(dc))
            .is_ok());

        // After commitment, before acks
        assert!(!validator.all_acks_received());
        assert_eq!(validator.ack_count(), 0);
        assert_eq!(validator.required_ack_count(), 4);
        assert_eq!(validator.pending_ack_seats(), vec![0, 1, 2, 3]);

        // After first ack
        let ack = DealCommitmentAck {
            version: ProtocolVersion::current(),
            commitment_hash,
            seat_index: 2,
            player_signature: vec![],
        };
        assert!(validator
            .validate(&ConsensusPayload::DealCommitmentAck(ack))
            .is_ok());

        assert!(!validator.all_acks_received());
        assert_eq!(validator.ack_count(), 1);
        assert_eq!(validator.acked_seats(), &[2]);
        assert_eq!(validator.pending_ack_seats(), vec![0, 1, 3]);

        // After all acks
        for seat in [0, 1, 3] {
            let ack = DealCommitmentAck {
                version: ProtocolVersion::current(),
                commitment_hash,
                seat_index: seat,
                player_signature: vec![],
            };
            assert!(validator
                .validate(&ConsensusPayload::DealCommitmentAck(ack))
                .is_ok());
        }

        assert!(validator.all_acks_received());
        assert_eq!(validator.ack_count(), 4);
        assert!(validator.pending_ack_seats().is_empty());
    }

    #[test]
    fn test_ack_gating_with_two_player_scope() {
        // Test with smaller scope (2 players)
        let scope = ScopeBinding::new([1u8; 32], 42, vec![0, 1], 52);
        let dc = DealCommitment {
            version: ProtocolVersion::current(),
            scope,
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![],
        };
        let commitment_hash = dc.commitment_hash();

        let mut validator = ActionLogValidator::new();
        assert!(validator
            .validate(&ConsensusPayload::DealCommitment(dc))
            .is_ok());

        assert_eq!(validator.required_ack_count(), 2);

        // One ack - not enough
        let ack0 = DealCommitmentAck {
            version: ProtocolVersion::current(),
            commitment_hash,
            seat_index: 0,
            player_signature: vec![],
        };
        assert!(validator
            .validate(&ConsensusPayload::DealCommitmentAck(ack0))
            .is_ok());
        assert!(!validator.all_acks_received());

        // Second ack - now complete
        let ack1 = DealCommitmentAck {
            version: ProtocolVersion::current(),
            commitment_hash,
            seat_index: 1,
            player_signature: vec![],
        };
        assert!(validator
            .validate(&ConsensusPayload::DealCommitmentAck(ack1))
            .is_ok());
        assert!(validator.all_acks_received());

        // Action now allowed
        let action = GameActionMessage {
            version: ProtocolVersion::current(),
            deal_commitment_hash: commitment_hash,
            seat_index: 0,
            action_type: action_codes::FOLD,
            amount: 0,
            sequence: 1,
            signature: vec![],
        };
        assert!(validator
            .validate(&ConsensusPayload::GameAction(action))
            .is_ok());
    }

    #[test]
    fn test_ack_gating_allows_acks_in_any_order() {
        let mut validator = ActionLogValidator::new();
        let dc = test_deal_commitment();
        let commitment_hash = dc.commitment_hash();

        assert!(validator
            .validate(&ConsensusPayload::DealCommitment(dc))
            .is_ok());

        // Ack in reverse order (3, 2, 1, 0)
        for seat in [3, 2, 1, 0] {
            let ack = DealCommitmentAck {
                version: ProtocolVersion::current(),
                commitment_hash,
                seat_index: seat,
                player_signature: vec![],
            };
            assert!(validator
                .validate(&ConsensusPayload::DealCommitmentAck(ack))
                .is_ok());
        }

        assert!(validator.all_acks_received());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Shuffle Context Verification Tests
    // ─────────────────────────────────────────────────────────────────────────

    fn test_shuffle_context() -> ShuffleContext {
        ShuffleContext::new(ProtocolVersion::current(), [1u8; 32], 42, vec![0, 1, 2, 3], 52)
    }

    #[test]
    fn test_validator_with_expected_context_accepts_matching() {
        let expected = test_shuffle_context();
        let mut validator = ActionLogValidator::with_expected_context(expected.clone());

        // Create a deal commitment with matching scope
        let dc = DealCommitment {
            version: ProtocolVersion::current(),
            scope: ScopeBinding::new([1u8; 32], 42, vec![0, 1, 2, 3], 52),
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![],
        };

        assert!(validator.has_expected_context());
        assert!(validator.validate(&ConsensusPayload::DealCommitment(dc)).is_ok());
    }

    #[test]
    fn test_validator_with_expected_context_rejects_table_id_mismatch() {
        let expected = test_shuffle_context();
        let mut validator = ActionLogValidator::with_expected_context(expected);

        // Create a deal commitment with different table_id
        let dc = DealCommitment {
            version: ProtocolVersion::current(),
            scope: ScopeBinding::new([99u8; 32], 42, vec![0, 1, 2, 3], 52), // wrong table_id
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![],
        };

        let result = validator.validate(&ConsensusPayload::DealCommitment(dc));
        assert!(matches!(
            result,
            Err(PayloadError::ShuffleContextMismatch(ShuffleContextMismatch::TableId { .. }))
        ));
    }

    #[test]
    fn test_validator_with_expected_context_rejects_hand_id_mismatch() {
        let expected = test_shuffle_context();
        let mut validator = ActionLogValidator::with_expected_context(expected);

        // Create a deal commitment with different hand_id
        let dc = DealCommitment {
            version: ProtocolVersion::current(),
            scope: ScopeBinding::new([1u8; 32], 999, vec![0, 1, 2, 3], 52), // wrong hand_id
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![],
        };

        let result = validator.validate(&ConsensusPayload::DealCommitment(dc));
        assert!(matches!(
            result,
            Err(PayloadError::ShuffleContextMismatch(ShuffleContextMismatch::HandId {
                expected: 42,
                got: 999
            }))
        ));
    }

    #[test]
    fn test_validator_with_expected_context_rejects_seat_order_mismatch() {
        let expected = test_shuffle_context();
        let mut validator = ActionLogValidator::with_expected_context(expected);

        // Create a deal commitment with different seat_order
        let dc = DealCommitment {
            version: ProtocolVersion::current(),
            scope: ScopeBinding::new([1u8; 32], 42, vec![0, 1], 52), // different seats
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![],
        };

        let result = validator.validate(&ConsensusPayload::DealCommitment(dc));
        assert!(matches!(
            result,
            Err(PayloadError::ShuffleContextMismatch(ShuffleContextMismatch::SeatOrder { .. }))
        ));
    }

    #[test]
    fn test_validator_with_expected_context_rejects_deck_length_mismatch() {
        let expected = test_shuffle_context();
        let mut validator = ActionLogValidator::with_expected_context(expected);

        // Create a deal commitment with different deck_length
        let dc = DealCommitment {
            version: ProtocolVersion::current(),
            scope: ScopeBinding::new([1u8; 32], 42, vec![0, 1, 2, 3], 36), // short deck
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![],
        };

        let result = validator.validate(&ConsensusPayload::DealCommitment(dc));
        assert!(matches!(
            result,
            Err(PayloadError::ShuffleContextMismatch(ShuffleContextMismatch::DeckLength {
                expected: 52,
                got: 36
            }))
        ));
    }

    #[test]
    fn test_validator_without_expected_context_accepts_any_scope() {
        let mut validator = ActionLogValidator::new();

        // Create a deal commitment with any scope - should be accepted
        let dc = DealCommitment {
            version: ProtocolVersion::current(),
            scope: ScopeBinding::new([99u8; 32], 999, vec![0], 36),
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![],
        };

        assert!(!validator.has_expected_context());
        assert!(validator.validate(&ConsensusPayload::DealCommitment(dc)).is_ok());
    }

    #[test]
    fn test_validate_log_with_context_accepts_matching() {
        let expected = test_shuffle_context();

        // Create a valid action log
        let dc = DealCommitment {
            version: ProtocolVersion::current(),
            scope: ScopeBinding::new([1u8; 32], 42, vec![0, 1, 2, 3], 52),
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![],
        };
        let commitment_hash = dc.commitment_hash();

        let mut payloads = vec![ConsensusPayload::DealCommitment(dc)];

        // Add acks for all seats
        for seat in [0, 1, 2, 3] {
            payloads.push(ConsensusPayload::DealCommitmentAck(DealCommitmentAck {
                version: ProtocolVersion::current(),
                commitment_hash,
                seat_index: seat,
                player_signature: vec![],
            }));
        }

        let result = ActionLogValidator::validate_log_with_context(&payloads, expected);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), commitment_hash);
    }

    #[test]
    fn test_validate_log_with_context_rejects_mismatch() {
        let expected = test_shuffle_context();

        // Create a deal commitment with mismatched scope
        let dc = DealCommitment {
            version: ProtocolVersion::current(),
            scope: ScopeBinding::new([99u8; 32], 42, vec![0, 1, 2, 3], 52), // wrong table_id
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![],
        };

        let payloads = vec![ConsensusPayload::DealCommitment(dc)];

        let result = ActionLogValidator::validate_log_with_context(&payloads, expected);
        assert!(matches!(
            result,
            Err(PayloadError::ShuffleContextMismatch(ShuffleContextMismatch::TableId { .. }))
        ));
    }

    #[test]
    fn test_validator_context_accessors() {
        let expected = test_shuffle_context();
        let validator = ActionLogValidator::with_expected_context(expected.clone());

        assert!(validator.has_expected_context());
        assert_eq!(validator.expected_context(), Some(&expected));

        let validator_no_ctx = ActionLogValidator::new();
        assert!(!validator_no_ctx.has_expected_context());
        assert_eq!(validator_no_ctx.expected_context(), None);
    }

    #[test]
    fn test_shuffle_context_mismatch_error_display() {
        let err = PayloadError::ShuffleContextMismatch(ShuffleContextMismatch::HandId {
            expected: 1,
            got: 2,
        });
        let msg = err.to_string();
        assert!(msg.contains("shuffle context mismatch"));
        assert!(msg.contains("hand_id mismatch"));
    }
}
