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
    DealCommitment, DealCommitmentAck, ProtocolVersion, RevealPhase, RevealShare, ShuffleContext,
    ShuffleContextMismatch, TimelockReveal, CURRENT_PROTOCOL_VERSION,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

// ─────────────────────────────────────────────────────────────────────────────
// Reveal Timeout Configuration
// ─────────────────────────────────────────────────────────────────────────────

/// Time-to-live for reveal phases in milliseconds.
///
/// When a reveal-only phase begins (after a betting round completes), the expected
/// player(s) have `REVEAL_TTL` milliseconds to provide their reveal shares. If the
/// timeout expires without receiving the reveal, the protocol falls back to timelock
/// decryption.
///
/// # Timeout Flow
///
/// 1. Betting round completes, validator enters reveal-only phase
/// 2. Timer starts at `reveal_phase_entered_at`
/// 3. Players submit `RevealShare` payloads
/// 4. If `current_time - reveal_phase_entered_at > REVEAL_TTL`:
///    - Normal `RevealShare` payloads are still accepted (player may just be slow)
///    - `TimelockReveal` becomes the fallback option
///    - A timeout error is raised only if NEITHER reveal type is received
///
/// # Rationale for 30 seconds
///
/// - Fast enough to prevent griefing (player can't stall indefinitely)
/// - Slow enough to tolerate network latency and slow clients
/// - Matches typical tournament clock increments for actions
///
/// # Configuration
///
/// This constant may be made configurable per-table in future versions.
/// For now, 30 seconds is the protocol-wide default.
pub const REVEAL_TTL: u64 = 30_000; // 30 seconds in milliseconds

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

    /// Reveal phase is out of order.
    ///
    /// Reveals must occur in sequential phase order:
    /// Preflop → Flop → Turn → River → Showdown.
    /// A reveal for an earlier phase after a later phase has been revealed is rejected.
    #[error("reveal phase out of order: expected {expected:?}, got {got:?}")]
    RevealPhaseOutOfOrder {
        expected: RevealPhase,
        got: RevealPhase,
    },

    /// Reveal phase has already been completed.
    ///
    /// Each phase can only be revealed once. Duplicate reveals for the same phase
    /// are rejected.
    #[error("reveal phase already completed: {phase:?}")]
    RevealPhaseAlreadyCompleted { phase: RevealPhase },

    /// Reveal received before the expected phase.
    ///
    /// The first reveal must be for Preflop. Reveals for later phases
    /// require the prior phase to be completed.
    #[error("reveal phase too early: received {got:?}, but {missing:?} has not been revealed yet")]
    RevealPhaseTooEarly {
        got: RevealPhase,
        missing: RevealPhase,
    },

    /// Game action received during a reveal-only phase.
    ///
    /// After a betting round completes, the validator enters a reveal-only phase
    /// where only reveals for the expected phase are accepted. Game actions are
    /// rejected until the reveal is received.
    #[error("game action during reveal-only phase: awaiting reveal for {expected_phase:?}")]
    ActionDuringRevealOnlyPhase { expected_phase: RevealPhase },

    /// Reveal timeout has expired.
    ///
    /// The reveal phase has been waiting longer than [`REVEAL_TTL`] without receiving
    /// the required reveal. At this point:
    /// - A `TimelockReveal` is required to continue the hand
    /// - Normal `RevealShare` payloads are still accepted if they arrive
    /// - The timed-out seat should be penalized according to table rules
    #[error("reveal timeout expired for {phase:?}: waited {elapsed_ms}ms (TTL: {ttl_ms}ms), seat {timeout_seat} failed to reveal")]
    RevealTimeout {
        phase: RevealPhase,
        elapsed_ms: u64,
        ttl_ms: u64,
        timeout_seat: u8,
    },

    /// TimelockReveal received before timeout expired.
    ///
    /// Timelock reveals are only valid as a fallback when the regular reveal
    /// timeout has expired. Submitting a timelock reveal before the timeout
    /// is a protocol violation (it may indicate an attempt to skip the normal
    /// reveal process or use knowledge of the timelock key prematurely).
    #[error("timelock reveal received before timeout: phase {phase:?}, {remaining_ms}ms remaining")]
    TimelockRevealBeforeTimeout {
        phase: RevealPhase,
        remaining_ms: u64,
    },

    /// TimelockReveal references an invalid timeout seat.
    ///
    /// The `timeout_seat` in a `TimelockReveal` must be a seat that was
    /// present in the original deal commitment's scope. This prevents
    /// attribution of timeouts to non-existent players.
    #[error("timelock reveal references invalid timeout seat {seat}: not in seat order {seat_order:?}")]
    InvalidTimelockTimeoutSeat { seat: u8, seat_order: Vec<u8> },

    /// TimelockReveal has card indices out of bounds.
    ///
    /// All card indices in a `TimelockReveal` must be less than the deck
    /// length specified in the deal commitment's scope. This prevents
    /// attempts to reveal cards that don't exist.
    #[error("timelock reveal has card index {index} out of bounds (deck length: {deck_length})")]
    TimelockCardIndexOutOfBounds { index: u8, deck_length: u8 },

    /// TimelockReveal has mismatched card indices and revealed values.
    ///
    /// The number of `card_indices` must match the number of `revealed_values`.
    /// Each card index corresponds to exactly one revealed value.
    #[error("timelock reveal has {indices_count} card indices but {values_count} revealed values")]
    TimelockCardValueMismatch {
        indices_count: usize,
        values_count: usize,
    },

    /// TimelockReveal is missing a proof when revealing values.
    ///
    /// When a `TimelockReveal` contains `revealed_values`, it must also
    /// contain a non-empty `timelock_proof` that can be used to verify
    /// the revealed values are correct.
    #[error("timelock reveal is missing proof for {values_count} revealed values")]
    TimelockMissingProof { values_count: usize },

    /// TimelockReveal proof failed verification.
    ///
    /// The `timelock_proof` did not cryptographically verify against the
    /// `revealed_values` and `card_indices`. This indicates either a
    /// malformed proof or an attempt to reveal incorrect values.
    #[error("timelock proof verification failed: {reason}")]
    TimelockProofInvalid { reason: String },
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
    /// Phases that have been completed (revealed) so far.
    ///
    /// Reveal gating enforces that phases must occur in order:
    /// Preflop → Flop → Turn → River → Showdown.
    /// Each phase can only be revealed once.
    completed_phases: Vec<RevealPhase>,
    /// When set, the validator is in a reveal-only phase and will reject
    /// game actions until the specified reveal phase is received.
    ///
    /// This is set by calling [`enter_reveal_only_phase`](Self::enter_reveal_only_phase)
    /// when a betting round completes and community cards need to be revealed.
    awaiting_reveal_phase: Option<RevealPhase>,
    /// Timestamp (unix milliseconds) when the current reveal-only phase began.
    ///
    /// This is set when [`enter_reveal_only_phase`](Self::enter_reveal_only_phase) is called.
    /// Used to determine if `REVEAL_TTL` has expired, enabling timelock fallback.
    ///
    /// The timestamp is cleared when the reveal is received (either `RevealShare`
    /// or `TimelockReveal`).
    reveal_phase_entered_at: Option<u64>,
    /// The seat expected to provide the reveal for the current phase.
    ///
    /// This is typically the dealer for community cards, or specific players
    /// for hole card reveals during showdown. Used to identify which seat
    /// timed out for penalty purposes.
    reveal_expected_from_seat: Option<u8>,
    /// Deck length from the deal commitment's scope.
    ///
    /// This is set when the `DealCommitment` is processed and used to validate
    /// that card indices in reveals are within bounds.
    deck_length: Option<u8>,
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
            completed_phases: Vec::new(),
            awaiting_reveal_phase: None,
            reveal_phase_entered_at: None,
            reveal_expected_from_seat: None,
            deck_length: None,
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
            completed_phases: Vec::new(),
            awaiting_reveal_phase: None,
            reveal_phase_entered_at: None,
            reveal_expected_from_seat: None,
            deck_length: None,
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

    /// Returns the deck length from the deal commitment's scope.
    ///
    /// This is `None` until a `DealCommitment` has been processed.
    pub fn deck_length(&self) -> Option<u8> {
        self.deck_length
    }

    /// Returns the list of reveal phases that have been completed.
    pub fn completed_phases(&self) -> &[RevealPhase] {
        &self.completed_phases
    }

    /// Returns the next expected reveal phase, or `None` if all phases are complete.
    ///
    /// The phase order is: Preflop → Flop → Turn → River → Showdown.
    pub fn next_expected_phase(&self) -> Option<RevealPhase> {
        match self.completed_phases.last() {
            None => Some(RevealPhase::Preflop),
            Some(RevealPhase::Preflop) => Some(RevealPhase::Flop),
            Some(RevealPhase::Flop) => Some(RevealPhase::Turn),
            Some(RevealPhase::Turn) => Some(RevealPhase::River),
            Some(RevealPhase::River) => Some(RevealPhase::Showdown),
            Some(RevealPhase::Showdown) => None, // All phases complete
        }
    }

    /// Returns true if all reveal phases have been completed.
    pub fn all_phases_complete(&self) -> bool {
        self.completed_phases.contains(&RevealPhase::Showdown)
    }

    /// Returns true if the given phase has been completed.
    pub fn is_phase_complete(&self, phase: RevealPhase) -> bool {
        self.completed_phases.contains(&phase)
    }

    /// Returns true if the validator is in a reveal-only phase.
    ///
    /// When in a reveal-only phase, game actions are rejected until
    /// the expected reveal is received.
    pub fn is_in_reveal_only_phase(&self) -> bool {
        self.awaiting_reveal_phase.is_some()
    }

    /// Returns the phase the validator is awaiting, if in reveal-only mode.
    pub fn awaiting_reveal_phase(&self) -> Option<RevealPhase> {
        self.awaiting_reveal_phase
    }

    /// Returns the timestamp when the current reveal phase started, if in reveal-only mode.
    pub fn reveal_phase_entered_at(&self) -> Option<u64> {
        self.reveal_phase_entered_at
    }

    /// Returns the seat expected to provide the reveal, if in reveal-only mode.
    pub fn reveal_expected_from_seat(&self) -> Option<u8> {
        self.reveal_expected_from_seat
    }

    /// Check if the reveal phase has timed out.
    ///
    /// Returns `true` if:
    /// - The validator is in a reveal-only phase
    /// - The timestamp when the phase started is set
    /// - `current_time_ms - reveal_phase_entered_at > REVEAL_TTL`
    ///
    /// When a timeout is detected, `TimelockReveal` becomes the only valid
    /// way to continue the hand. Normal `RevealShare` payloads are still
    /// accepted (in case the player is just slow), but any seat can submit
    /// the timelock fallback.
    ///
    /// # Returns
    ///
    /// - `Some((elapsed_ms, expected_seat))` if timed out
    /// - `None` if not in reveal-only phase or not yet timed out
    pub fn check_reveal_timeout(&self, current_time_ms: u64) -> Option<(u64, u8)> {
        let phase_started = self.reveal_phase_entered_at?;
        let expected_seat = self.reveal_expected_from_seat.unwrap_or(0xFF);

        if current_time_ms > phase_started {
            let elapsed = current_time_ms - phase_started;
            if elapsed > REVEAL_TTL {
                return Some((elapsed, expected_seat));
            }
        }
        None
    }

    /// Check if a timelock reveal is valid at the given time.
    ///
    /// Returns `Ok(())` if the reveal timeout has expired (timelock is valid).
    /// Returns `Err(TimelockRevealBeforeTimeout)` if the timeout hasn't expired yet.
    ///
    /// # Arguments
    ///
    /// * `current_time_ms` - Current unix timestamp in milliseconds
    ///
    /// # Usage
    ///
    /// Call this before accepting a `TimelockReveal` to ensure it's only used
    /// as a fallback after the normal reveal period has expired.
    pub fn validate_timelock_allowed(&self, current_time_ms: u64) -> Result<(), PayloadError> {
        if let Some(phase) = self.awaiting_reveal_phase {
            if let Some(entered_at) = self.reveal_phase_entered_at {
                if current_time_ms <= entered_at + REVEAL_TTL {
                    let remaining = (entered_at + REVEAL_TTL).saturating_sub(current_time_ms);
                    return Err(PayloadError::TimelockRevealBeforeTimeout {
                        phase,
                        remaining_ms: remaining,
                    });
                }
            }
        }
        Ok(())
    }

    /// Validate the scope binding and structural integrity of a timelock reveal.
    ///
    /// This validates that:
    /// 1. The `timeout_seat` is a valid seat from the commitment's scope
    /// 2. All `card_indices` are within the deck length bounds
    /// 3. The number of `card_indices` matches the number of `revealed_values`
    /// 4. If `revealed_values` is non-empty, `timelock_proof` must also be non-empty
    ///
    /// This method does NOT verify the cryptographic validity of the timelock proof.
    /// Cryptographic verification is delegated to a separate proof verifier that
    /// can be plugged in based on the timelock scheme in use.
    ///
    /// # Arguments
    ///
    /// * `tr` - The timelock reveal to validate
    ///
    /// # Errors
    ///
    /// - [`PayloadError::InvalidTimelockTimeoutSeat`] if `timeout_seat` is not in scope
    /// - [`PayloadError::TimelockCardIndexOutOfBounds`] if any card index >= deck_length
    /// - [`PayloadError::TimelockCardValueMismatch`] if card_indices.len() != revealed_values.len()
    /// - [`PayloadError::TimelockMissingProof`] if revealed_values is non-empty but proof is empty
    pub fn validate_timelock_scope_and_proof(
        &self,
        tr: &TimelockReveal,
    ) -> Result<(), PayloadError> {
        // Validate timeout_seat is in the commitment's seat order
        if !self.required_seats.contains(&tr.timeout_seat) {
            return Err(PayloadError::InvalidTimelockTimeoutSeat {
                seat: tr.timeout_seat,
                seat_order: self.required_seats.clone(),
            });
        }

        // Validate card indices are within deck bounds
        if let Some(deck_len) = self.deck_length {
            for &index in &tr.card_indices {
                if index >= deck_len {
                    return Err(PayloadError::TimelockCardIndexOutOfBounds {
                        index,
                        deck_length: deck_len,
                    });
                }
            }
        }

        // Validate card_indices and revealed_values have matching counts
        if tr.card_indices.len() != tr.revealed_values.len() {
            return Err(PayloadError::TimelockCardValueMismatch {
                indices_count: tr.card_indices.len(),
                values_count: tr.revealed_values.len(),
            });
        }

        // Validate that proof is present when revealing values
        if !tr.revealed_values.is_empty() && tr.timelock_proof.is_empty() {
            return Err(PayloadError::TimelockMissingProof {
                values_count: tr.revealed_values.len(),
            });
        }

        Ok(())
    }

    /// Enter a reveal-only phase, blocking game actions until the reveal is received.
    ///
    /// This is a convenience method that enters the phase without timeout tracking.
    /// For production use with timeout enforcement, use
    /// [`enter_reveal_only_phase_with_timeout`](Self::enter_reveal_only_phase_with_timeout).
    ///
    /// Call this after a betting round completes to signal that the next action
    /// must be a reveal for the specified phase. Game actions will be rejected
    /// until the reveal is received.
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - The phase has already been completed
    /// - The phase is not the next expected phase (would skip phases)
    /// - Already in a reveal-only phase for a different phase
    ///
    /// # Example
    ///
    /// ```
    /// use codexpoker_onchain::ActionLogValidator;
    /// use protocol_messages::RevealPhase;
    ///
    /// let mut validator = ActionLogValidator::new();
    /// // ... setup with commitment and acks ...
    ///
    /// // After preflop betting completes, enter reveal-only for Flop
    /// // validator.enter_reveal_only_phase(RevealPhase::Flop).unwrap();
    /// // Now game actions will be rejected until Flop reveal is received
    /// ```
    pub fn enter_reveal_only_phase(&mut self, phase: RevealPhase) -> Result<(), PayloadError> {
        self.enter_reveal_only_phase_impl(phase, None, None)
    }

    /// Enter a reveal-only phase with timeout tracking.
    ///
    /// This is the preferred method for production use. It records when the
    /// phase started and which seat is expected to reveal, enabling:
    ///
    /// - Timeout detection via [`check_reveal_timeout`](Self::check_reveal_timeout)
    /// - Timelock fallback validation via [`validate_timelock_allowed`](Self::validate_timelock_allowed)
    /// - Penalty attribution for timeout violations
    ///
    /// # Arguments
    ///
    /// * `phase` - The reveal phase to enter
    /// * `timestamp_ms` - Current unix timestamp in milliseconds
    /// * `expected_from_seat` - The seat index expected to provide the reveal
    ///
    /// # Errors
    ///
    /// Same as [`enter_reveal_only_phase`](Self::enter_reveal_only_phase).
    ///
    /// # Example
    ///
    /// ```
    /// use codexpoker_onchain::ActionLogValidator;
    /// use protocol_messages::RevealPhase;
    ///
    /// let mut validator = ActionLogValidator::new();
    /// // ... setup with commitment and acks ...
    ///
    /// // After preflop betting completes, enter reveal-only for Flop
    /// // The dealer (seat 0 in this example) has REVEAL_TTL to provide the reveal
    /// let current_time = 1700000000000u64; // unix ms
    /// // validator.enter_reveal_only_phase_with_timeout(
    /// //     RevealPhase::Flop,
    /// //     current_time,
    /// //     0, // dealer seat
    /// // ).unwrap();
    /// ```
    pub fn enter_reveal_only_phase_with_timeout(
        &mut self,
        phase: RevealPhase,
        timestamp_ms: u64,
        expected_from_seat: u8,
    ) -> Result<(), PayloadError> {
        self.enter_reveal_only_phase_impl(phase, Some(timestamp_ms), Some(expected_from_seat))
    }

    /// Internal implementation for entering reveal-only phase.
    fn enter_reveal_only_phase_impl(
        &mut self,
        phase: RevealPhase,
        timestamp_ms: Option<u64>,
        expected_from_seat: Option<u8>,
    ) -> Result<(), PayloadError> {
        // Validate this phase can be entered
        self.validate_reveal_phase(phase)?;

        // Check we're not already awaiting a different phase
        if let Some(existing) = self.awaiting_reveal_phase {
            if existing != phase {
                return Err(PayloadError::RevealPhaseOutOfOrder {
                    expected: existing,
                    got: phase,
                });
            }
            // Already awaiting this phase, just update timestamp if provided
            if timestamp_ms.is_some() {
                self.reveal_phase_entered_at = timestamp_ms;
            }
            if expected_from_seat.is_some() {
                self.reveal_expected_from_seat = expected_from_seat;
            }
            return Ok(());
        }

        self.awaiting_reveal_phase = Some(phase);
        self.reveal_phase_entered_at = timestamp_ms;
        self.reveal_expected_from_seat = expected_from_seat;
        Ok(())
    }

    /// Exit reveal-only mode without receiving a reveal.
    ///
    /// This is primarily for testing or recovery scenarios. In normal operation,
    /// the reveal-only phase is exited automatically when the expected reveal
    /// is received.
    ///
    /// This clears:
    /// - The awaiting reveal phase
    /// - The timestamp when the phase started
    /// - The seat expected to reveal
    pub fn exit_reveal_only_phase(&mut self) {
        self.awaiting_reveal_phase = None;
        self.reveal_phase_entered_at = None;
        self.reveal_expected_from_seat = None;
    }

    /// Validate that a reveal phase is valid for the current state.
    ///
    /// This enforces the phase ordering: Preflop → Flop → Turn → River → Showdown.
    /// Each phase can only be revealed once, and phases must occur in order.
    fn validate_reveal_phase(&self, phase: RevealPhase) -> Result<(), PayloadError> {
        // Check if this phase was already completed
        if self.completed_phases.contains(&phase) {
            return Err(PayloadError::RevealPhaseAlreadyCompleted { phase });
        }

        // Check phase ordering
        let expected = self.next_expected_phase();
        match expected {
            None => {
                // All phases complete, no more reveals allowed
                Err(PayloadError::RevealPhaseAlreadyCompleted { phase })
            }
            Some(expected_phase) => {
                if phase == expected_phase {
                    // Correct phase
                    Ok(())
                } else if (phase as u8) < (expected_phase as u8) {
                    // Trying to reveal an earlier phase (already completed)
                    Err(PayloadError::RevealPhaseAlreadyCompleted { phase })
                } else {
                    // Trying to reveal a later phase (skipping required phases)
                    Err(PayloadError::RevealPhaseTooEarly {
                        got: phase,
                        missing: expected_phase,
                    })
                }
            }
        }
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
    /// 6. **Reveal phase gating**: Reveals must occur in sequential phase order
    ///    (Preflop → Flop → Turn → River → Showdown). Each phase can only be
    ///    revealed once.
    /// 7. **Reveal-only phase enforcement**: When in reveal-only mode (after calling
    ///    [`enter_reveal_only_phase`](Self::enter_reveal_only_phase)), game actions
    ///    are rejected until the expected reveal is received.
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
    /// - [`PayloadError::RevealPhaseAlreadyCompleted`] if reveal is for an already-completed phase
    /// - [`PayloadError::RevealPhaseTooEarly`] if reveal is for a later phase than expected
    /// - [`PayloadError::ActionDuringRevealOnlyPhase`] if game action received during reveal-only phase
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
                    self.deck_length = Some(dc.scope.deck_length);
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
            ConsensusPayload::GameAction(_) => {
                // Actions require all acks to be received first
                if !self.all_acks_received() {
                    return Err(PayloadError::ActionBeforeAllAcks {
                        received: self.acked_seats.len(),
                        required: self.required_seats.len(),
                    });
                }

                // Actions are blocked during reveal-only phases
                if let Some(expected_phase) = self.awaiting_reveal_phase {
                    return Err(PayloadError::ActionDuringRevealOnlyPhase { expected_phase });
                }
            }
            ConsensusPayload::RevealShare(rs) => {
                // Reveals require all acks to be received first
                if !self.all_acks_received() {
                    return Err(PayloadError::ActionBeforeAllAcks {
                        received: self.acked_seats.len(),
                        required: self.required_seats.len(),
                    });
                }

                // Validate reveal phase ordering
                self.validate_reveal_phase(rs.phase)?;

                // Record this phase as completed
                self.completed_phases.push(rs.phase);

                // Clear reveal-only mode if this was the awaited phase
                if self.awaiting_reveal_phase == Some(rs.phase) {
                    self.awaiting_reveal_phase = None;
                    self.reveal_phase_entered_at = None;
                    self.reveal_expected_from_seat = None;
                }
            }
            ConsensusPayload::TimelockReveal(tr) => {
                // Timelock reveals require all acks to be received first
                if !self.all_acks_received() {
                    return Err(PayloadError::ActionBeforeAllAcks {
                        received: self.acked_seats.len(),
                        required: self.required_seats.len(),
                    });
                }

                // Validate reveal phase ordering
                self.validate_reveal_phase(tr.phase)?;

                // Validate scope binding and proof structure
                self.validate_timelock_scope_and_proof(tr)?;

                // Record this phase as completed
                self.completed_phases.push(tr.phase);

                // Clear reveal-only mode if this was the awaited phase
                if self.awaiting_reveal_phase == Some(tr.phase) {
                    self.awaiting_reveal_phase = None;
                    self.reveal_phase_entered_at = None;
                    self.reveal_expected_from_seat = None;
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

    /// Validate a payload with timestamp-aware timeout enforcement.
    ///
    /// This method performs all validation from [`validate`](Self::validate) plus:
    /// - Enforces `REVEAL_TTL` timeout for `TimelockReveal` payloads
    ///
    /// Use this method in production when consensus provides a timestamp. The
    /// timestamp should be consistent across all validators (e.g., block timestamp).
    ///
    /// # Timeout Enforcement
    ///
    /// For `TimelockReveal` payloads:
    /// - If the validator is in a reveal-only phase with timeout tracking enabled,
    ///   the timelock is only accepted if `current_time_ms > reveal_phase_entered_at + REVEAL_TTL`
    /// - If timeout tracking is not enabled (no timestamp was set when entering the phase),
    ///   the timelock is accepted (backward compatible behavior)
    ///
    /// # Arguments
    ///
    /// * `payload` - The consensus payload to validate
    /// * `current_time_ms` - Current unix timestamp in milliseconds (should be consistent across nodes)
    ///
    /// # Errors
    ///
    /// All errors from [`validate`](Self::validate), plus:
    /// - [`PayloadError::TimelockRevealBeforeTimeout`] if a `TimelockReveal` is submitted
    ///   before the reveal timeout has expired
    ///
    /// # Example
    ///
    /// ```
    /// use codexpoker_onchain::{ActionLogValidator, ConsensusPayload};
    /// use protocol_messages::{RevealPhase, TimelockReveal, ProtocolVersion};
    ///
    /// let mut validator = ActionLogValidator::new();
    /// // ... setup with commitment and acks ...
    ///
    /// // Enter reveal phase with timeout tracking
    /// let phase_start = 1700000000000u64;
    /// // validator.enter_reveal_only_phase_with_timeout(RevealPhase::Preflop, phase_start, 0).unwrap();
    ///
    /// // Timelock reveal will be rejected if submitted before timeout expires
    /// // let current_time = phase_start + 10_000; // 10 seconds in
    /// // let timelock = ConsensusPayload::TimelockReveal(...);
    /// // assert!(validator.validate_at_time(&timelock, current_time).is_err());
    ///
    /// // Timelock reveal will be accepted after timeout expires
    /// // let current_time = phase_start + 31_000; // 31 seconds in (> REVEAL_TTL)
    /// // assert!(validator.validate_at_time(&timelock, current_time).is_ok());
    /// ```
    pub fn validate_at_time(
        &mut self,
        payload: &ConsensusPayload,
        current_time_ms: u64,
    ) -> Result<(), PayloadError> {
        // For TimelockReveal payloads, validate that timeout has expired
        if let ConsensusPayload::TimelockReveal(_) = payload {
            self.validate_timelock_allowed(current_time_ms)?;
        }

        // Delegate to the standard validate method for all other checks
        self.validate(payload)
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

    // ─────────────────────────────────────────────────────────────────────────
    // Reveal Phase Gating Tests
    // ─────────────────────────────────────────────────────────────────────────

    /// Helper to create a validator with commitment and all acks done.
    fn setup_validator_ready_for_reveals() -> (ActionLogValidator, [u8; 32]) {
        let mut validator = ActionLogValidator::new();
        let dc = test_deal_commitment();
        let commitment_hash = dc.commitment_hash();

        // Add deal commitment
        validator
            .validate(&ConsensusPayload::DealCommitment(dc))
            .unwrap();

        // Add all acks
        for seat in [0, 1, 2, 3] {
            validator
                .validate(&ConsensusPayload::DealCommitmentAck(DealCommitmentAck {
                    version: ProtocolVersion::current(),
                    commitment_hash,
                    seat_index: seat,
                    player_signature: vec![],
                }))
                .unwrap();
        }

        (validator, commitment_hash)
    }

    fn make_reveal(commitment_hash: [u8; 32], phase: protocol_messages::RevealPhase) -> RevealShare {
        RevealShare {
            version: ProtocolVersion::current(),
            commitment_hash,
            phase,
            card_indices: vec![0, 1, 2],
            reveal_data: vec![vec![1], vec![2], vec![3]],
            from_seat: 0,
            signature: vec![],
        }
    }

    fn make_timelock_reveal(
        commitment_hash: [u8; 32],
        phase: protocol_messages::RevealPhase,
    ) -> TimelockReveal {
        TimelockReveal {
            version: ProtocolVersion::current(),
            commitment_hash,
            phase,
            card_indices: vec![0],
            timelock_proof: vec![0xAA, 0xBB],
            revealed_values: vec![vec![42]],
            timeout_seat: 1,
        }
    }

    #[test]
    fn test_reveal_phase_gating_accepts_preflop_first() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // First reveal must be Preflop
        let reveal = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        assert!(validator
            .validate(&ConsensusPayload::RevealShare(reveal))
            .is_ok());

        assert!(validator.is_phase_complete(protocol_messages::RevealPhase::Preflop));
        assert_eq!(validator.completed_phases().len(), 1);
    }

    #[test]
    fn test_reveal_phase_gating_rejects_flop_before_preflop() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Try to reveal Flop before Preflop
        let reveal = make_reveal(commitment_hash, protocol_messages::RevealPhase::Flop);
        let result = validator.validate(&ConsensusPayload::RevealShare(reveal));

        assert!(matches!(
            result,
            Err(PayloadError::RevealPhaseTooEarly {
                got: protocol_messages::RevealPhase::Flop,
                missing: protocol_messages::RevealPhase::Preflop,
            })
        ));
    }

    #[test]
    fn test_reveal_phase_gating_rejects_turn_before_flop() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Complete Preflop first
        let preflop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        validator
            .validate(&ConsensusPayload::RevealShare(preflop))
            .unwrap();

        // Try to reveal Turn (skipping Flop)
        let turn = make_reveal(commitment_hash, protocol_messages::RevealPhase::Turn);
        let result = validator.validate(&ConsensusPayload::RevealShare(turn));

        assert!(matches!(
            result,
            Err(PayloadError::RevealPhaseTooEarly {
                got: protocol_messages::RevealPhase::Turn,
                missing: protocol_messages::RevealPhase::Flop,
            })
        ));
    }

    #[test]
    fn test_reveal_phase_gating_accepts_full_sequence() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Complete all phases in order
        for phase in [
            protocol_messages::RevealPhase::Preflop,
            protocol_messages::RevealPhase::Flop,
            protocol_messages::RevealPhase::Turn,
            protocol_messages::RevealPhase::River,
            protocol_messages::RevealPhase::Showdown,
        ] {
            let reveal = make_reveal(commitment_hash, phase);
            assert!(
                validator
                    .validate(&ConsensusPayload::RevealShare(reveal))
                    .is_ok(),
                "phase {:?} should be accepted",
                phase
            );
            assert!(validator.is_phase_complete(phase));
        }

        assert!(validator.all_phases_complete());
        assert_eq!(validator.completed_phases().len(), 5);
    }

    #[test]
    fn test_reveal_phase_gating_rejects_duplicate_phase() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Complete Preflop
        let preflop1 = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        validator
            .validate(&ConsensusPayload::RevealShare(preflop1))
            .unwrap();

        // Try to reveal Preflop again
        let preflop2 = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        let result = validator.validate(&ConsensusPayload::RevealShare(preflop2));

        assert!(matches!(
            result,
            Err(PayloadError::RevealPhaseAlreadyCompleted {
                phase: protocol_messages::RevealPhase::Preflop,
            })
        ));
    }

    #[test]
    fn test_reveal_phase_gating_rejects_earlier_phase_after_later() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Complete Preflop and Flop
        for phase in [
            protocol_messages::RevealPhase::Preflop,
            protocol_messages::RevealPhase::Flop,
        ] {
            let reveal = make_reveal(commitment_hash, phase);
            validator
                .validate(&ConsensusPayload::RevealShare(reveal))
                .unwrap();
        }

        // Try to reveal Preflop again (already completed)
        let preflop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        let result = validator.validate(&ConsensusPayload::RevealShare(preflop));

        assert!(matches!(
            result,
            Err(PayloadError::RevealPhaseAlreadyCompleted {
                phase: protocol_messages::RevealPhase::Preflop,
            })
        ));
    }

    #[test]
    fn test_reveal_phase_gating_rejects_showdown_skipping_phases() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Complete only Preflop
        let preflop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        validator
            .validate(&ConsensusPayload::RevealShare(preflop))
            .unwrap();

        // Try to jump to Showdown (skipping Flop, Turn, River)
        let showdown = make_reveal(commitment_hash, protocol_messages::RevealPhase::Showdown);
        let result = validator.validate(&ConsensusPayload::RevealShare(showdown));

        assert!(matches!(
            result,
            Err(PayloadError::RevealPhaseTooEarly {
                got: protocol_messages::RevealPhase::Showdown,
                missing: protocol_messages::RevealPhase::Flop,
            })
        ));
    }

    #[test]
    fn test_reveal_phase_gating_timelock_reveal_follows_same_rules() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Try to use timelock reveal for Flop before Preflop
        let timelock = make_timelock_reveal(commitment_hash, protocol_messages::RevealPhase::Flop);
        let result = validator.validate(&ConsensusPayload::TimelockReveal(timelock));

        assert!(matches!(
            result,
            Err(PayloadError::RevealPhaseTooEarly {
                got: protocol_messages::RevealPhase::Flop,
                missing: protocol_messages::RevealPhase::Preflop,
            })
        ));
    }

    #[test]
    fn test_reveal_phase_gating_timelock_reveal_completes_phase() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Use timelock reveal for Preflop
        let timelock =
            make_timelock_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        assert!(validator
            .validate(&ConsensusPayload::TimelockReveal(timelock))
            .is_ok());

        assert!(validator.is_phase_complete(protocol_messages::RevealPhase::Preflop));

        // Now Flop should be expected
        assert_eq!(
            validator.next_expected_phase(),
            Some(protocol_messages::RevealPhase::Flop)
        );
    }

    #[test]
    fn test_reveal_phase_gating_mixed_reveal_and_timelock() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Preflop with regular reveal
        let preflop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        validator
            .validate(&ConsensusPayload::RevealShare(preflop))
            .unwrap();

        // Flop with timelock reveal
        let flop_timelock =
            make_timelock_reveal(commitment_hash, protocol_messages::RevealPhase::Flop);
        validator
            .validate(&ConsensusPayload::TimelockReveal(flop_timelock))
            .unwrap();

        // Turn with regular reveal
        let turn = make_reveal(commitment_hash, protocol_messages::RevealPhase::Turn);
        validator
            .validate(&ConsensusPayload::RevealShare(turn))
            .unwrap();

        assert!(validator.is_phase_complete(protocol_messages::RevealPhase::Preflop));
        assert!(validator.is_phase_complete(protocol_messages::RevealPhase::Flop));
        assert!(validator.is_phase_complete(protocol_messages::RevealPhase::Turn));
        assert_eq!(
            validator.next_expected_phase(),
            Some(protocol_messages::RevealPhase::River)
        );
    }

    #[test]
    fn test_reveal_phase_gating_next_expected_phase() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Initially expect Preflop
        assert_eq!(
            validator.next_expected_phase(),
            Some(protocol_messages::RevealPhase::Preflop)
        );

        // After each phase, check next expected
        let phases = [
            (
                protocol_messages::RevealPhase::Preflop,
                Some(protocol_messages::RevealPhase::Flop),
            ),
            (
                protocol_messages::RevealPhase::Flop,
                Some(protocol_messages::RevealPhase::Turn),
            ),
            (
                protocol_messages::RevealPhase::Turn,
                Some(protocol_messages::RevealPhase::River),
            ),
            (
                protocol_messages::RevealPhase::River,
                Some(protocol_messages::RevealPhase::Showdown),
            ),
            (protocol_messages::RevealPhase::Showdown, None),
        ];

        for (phase, expected_next) in phases {
            let reveal = make_reveal(commitment_hash, phase);
            validator
                .validate(&ConsensusPayload::RevealShare(reveal))
                .unwrap();
            assert_eq!(
                validator.next_expected_phase(),
                expected_next,
                "after {:?}, expected {:?}",
                phase,
                expected_next
            );
        }
    }

    #[test]
    fn test_reveal_phase_gating_all_phases_complete() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        assert!(!validator.all_phases_complete());

        // Complete all phases
        for phase in [
            protocol_messages::RevealPhase::Preflop,
            protocol_messages::RevealPhase::Flop,
            protocol_messages::RevealPhase::Turn,
            protocol_messages::RevealPhase::River,
            protocol_messages::RevealPhase::Showdown,
        ] {
            let reveal = make_reveal(commitment_hash, phase);
            validator
                .validate(&ConsensusPayload::RevealShare(reveal))
                .unwrap();
        }

        assert!(validator.all_phases_complete());
        assert!(validator.next_expected_phase().is_none());
    }

    #[test]
    fn test_reveal_phase_gating_rejects_after_all_phases_complete() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Complete all phases
        for phase in [
            protocol_messages::RevealPhase::Preflop,
            protocol_messages::RevealPhase::Flop,
            protocol_messages::RevealPhase::Turn,
            protocol_messages::RevealPhase::River,
            protocol_messages::RevealPhase::Showdown,
        ] {
            let reveal = make_reveal(commitment_hash, phase);
            validator
                .validate(&ConsensusPayload::RevealShare(reveal))
                .unwrap();
        }

        // Try to reveal any phase again
        let preflop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        let result = validator.validate(&ConsensusPayload::RevealShare(preflop));
        assert!(matches!(
            result,
            Err(PayloadError::RevealPhaseAlreadyCompleted { .. })
        ));
    }

    #[test]
    fn test_reveal_phase_error_display() {
        let err = PayloadError::RevealPhaseOutOfOrder {
            expected: protocol_messages::RevealPhase::Flop,
            got: protocol_messages::RevealPhase::Turn,
        };
        let msg = err.to_string();
        assert!(msg.contains("reveal phase out of order"));
        assert!(msg.contains("Flop"));
        assert!(msg.contains("Turn"));

        let err = PayloadError::RevealPhaseAlreadyCompleted {
            phase: protocol_messages::RevealPhase::Preflop,
        };
        let msg = err.to_string();
        assert!(msg.contains("already completed"));
        assert!(msg.contains("Preflop"));

        let err = PayloadError::RevealPhaseTooEarly {
            got: protocol_messages::RevealPhase::Turn,
            missing: protocol_messages::RevealPhase::Flop,
        };
        let msg = err.to_string();
        assert!(msg.contains("too early"));
        assert!(msg.contains("Turn"));
        assert!(msg.contains("Flop"));
    }

    #[test]
    fn test_reveal_phase_gating_game_actions_allowed_between_phases() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Complete Preflop
        let preflop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        validator
            .validate(&ConsensusPayload::RevealShare(preflop))
            .unwrap();

        // Game action between reveals should still work
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

        // Can still continue to Flop
        let flop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Flop);
        assert!(validator
            .validate(&ConsensusPayload::RevealShare(flop))
            .is_ok());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Reveal-Only Phase Enforcement Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_reveal_only_phase_blocks_game_actions() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Complete Preflop reveal first
        let preflop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        validator
            .validate(&ConsensusPayload::RevealShare(preflop))
            .unwrap();

        // Enter reveal-only phase for Flop
        validator
            .enter_reveal_only_phase(protocol_messages::RevealPhase::Flop)
            .unwrap();

        assert!(validator.is_in_reveal_only_phase());
        assert_eq!(
            validator.awaiting_reveal_phase(),
            Some(protocol_messages::RevealPhase::Flop)
        );

        // Game action should be rejected
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
            Err(PayloadError::ActionDuringRevealOnlyPhase {
                expected_phase: protocol_messages::RevealPhase::Flop,
            })
        ));
    }

    #[test]
    fn test_reveal_only_phase_accepts_expected_reveal() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Complete Preflop reveal first
        let preflop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        validator
            .validate(&ConsensusPayload::RevealShare(preflop))
            .unwrap();

        // Enter reveal-only phase for Flop
        validator
            .enter_reveal_only_phase(protocol_messages::RevealPhase::Flop)
            .unwrap();

        // Flop reveal should be accepted
        let flop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Flop);
        assert!(validator
            .validate(&ConsensusPayload::RevealShare(flop))
            .is_ok());

        // Reveal-only mode should be cleared
        assert!(!validator.is_in_reveal_only_phase());
        assert!(validator.awaiting_reveal_phase().is_none());
    }

    #[test]
    fn test_reveal_only_phase_cleared_by_timelock_reveal() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Complete Preflop reveal first
        let preflop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        validator
            .validate(&ConsensusPayload::RevealShare(preflop))
            .unwrap();

        // Enter reveal-only phase for Flop
        validator
            .enter_reveal_only_phase(protocol_messages::RevealPhase::Flop)
            .unwrap();

        // Timelock reveal for Flop should be accepted and clear reveal-only mode
        let timelock = make_timelock_reveal(commitment_hash, protocol_messages::RevealPhase::Flop);
        assert!(validator
            .validate(&ConsensusPayload::TimelockReveal(timelock))
            .is_ok());

        // Reveal-only mode should be cleared
        assert!(!validator.is_in_reveal_only_phase());
    }

    #[test]
    fn test_reveal_only_phase_allows_action_after_reveal() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Complete Preflop reveal first
        let preflop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        validator
            .validate(&ConsensusPayload::RevealShare(preflop))
            .unwrap();

        // Enter reveal-only phase for Flop
        validator
            .enter_reveal_only_phase(protocol_messages::RevealPhase::Flop)
            .unwrap();

        // Complete Flop reveal
        let flop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Flop);
        validator
            .validate(&ConsensusPayload::RevealShare(flop))
            .unwrap();

        // Now game actions should be allowed again
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
    fn test_reveal_only_phase_rejects_wrong_reveal() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Complete Preflop reveal first
        let preflop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        validator
            .validate(&ConsensusPayload::RevealShare(preflop))
            .unwrap();

        // Enter reveal-only phase for Flop
        validator
            .enter_reveal_only_phase(protocol_messages::RevealPhase::Flop)
            .unwrap();

        // Try to reveal Turn (skipping Flop) - should fail due to phase ordering
        let turn = make_reveal(commitment_hash, protocol_messages::RevealPhase::Turn);
        let result = validator.validate(&ConsensusPayload::RevealShare(turn));

        assert!(matches!(
            result,
            Err(PayloadError::RevealPhaseTooEarly {
                got: protocol_messages::RevealPhase::Turn,
                missing: protocol_messages::RevealPhase::Flop,
            })
        ));

        // Should still be in reveal-only mode
        assert!(validator.is_in_reveal_only_phase());
    }

    #[test]
    fn test_enter_reveal_only_phase_rejects_completed_phase() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Complete Preflop reveal
        let preflop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        validator
            .validate(&ConsensusPayload::RevealShare(preflop))
            .unwrap();

        // Trying to enter reveal-only for Preflop (already completed) should fail
        let result = validator.enter_reveal_only_phase(protocol_messages::RevealPhase::Preflop);
        assert!(matches!(
            result,
            Err(PayloadError::RevealPhaseAlreadyCompleted {
                phase: protocol_messages::RevealPhase::Preflop,
            })
        ));
    }

    #[test]
    fn test_enter_reveal_only_phase_rejects_skipped_phase() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Complete Preflop reveal
        let preflop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        validator
            .validate(&ConsensusPayload::RevealShare(preflop))
            .unwrap();

        // Trying to enter reveal-only for Turn (skipping Flop) should fail
        let result = validator.enter_reveal_only_phase(protocol_messages::RevealPhase::Turn);
        assert!(matches!(
            result,
            Err(PayloadError::RevealPhaseTooEarly {
                got: protocol_messages::RevealPhase::Turn,
                missing: protocol_messages::RevealPhase::Flop,
            })
        ));
    }

    #[test]
    fn test_enter_reveal_only_phase_idempotent() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Complete Preflop reveal
        let preflop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        validator
            .validate(&ConsensusPayload::RevealShare(preflop))
            .unwrap();

        // Enter reveal-only for Flop
        validator
            .enter_reveal_only_phase(protocol_messages::RevealPhase::Flop)
            .unwrap();

        // Entering again for the same phase should succeed (idempotent)
        assert!(validator
            .enter_reveal_only_phase(protocol_messages::RevealPhase::Flop)
            .is_ok());
    }

    #[test]
    fn test_enter_reveal_only_phase_rejects_different_phase_when_already_awaiting() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Complete Preflop reveal
        let preflop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        validator
            .validate(&ConsensusPayload::RevealShare(preflop))
            .unwrap();

        // Enter reveal-only for Flop
        validator
            .enter_reveal_only_phase(protocol_messages::RevealPhase::Flop)
            .unwrap();

        // Trying to enter reveal-only for Turn while already awaiting Flop should fail
        // (Turn is not valid anyway since Flop hasn't been revealed, but this tests
        // the specific "already awaiting different phase" logic)
        let result = validator.enter_reveal_only_phase(protocol_messages::RevealPhase::Turn);
        // This fails because Turn is not the next expected phase (Flop is)
        assert!(matches!(
            result,
            Err(PayloadError::RevealPhaseTooEarly { .. })
        ));
    }

    #[test]
    fn test_exit_reveal_only_phase() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Complete Preflop reveal
        let preflop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        validator
            .validate(&ConsensusPayload::RevealShare(preflop))
            .unwrap();

        // Enter reveal-only for Flop
        validator
            .enter_reveal_only_phase(protocol_messages::RevealPhase::Flop)
            .unwrap();
        assert!(validator.is_in_reveal_only_phase());

        // Manually exit reveal-only mode
        validator.exit_reveal_only_phase();
        assert!(!validator.is_in_reveal_only_phase());

        // Now game actions should work again
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
    fn test_reveal_only_phase_full_hand_flow() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Preflop: reveal hole cards
        let preflop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        validator
            .validate(&ConsensusPayload::RevealShare(preflop))
            .unwrap();

        // Preflop betting round
        let action1 = GameActionMessage {
            version: ProtocolVersion::current(),
            deal_commitment_hash: commitment_hash,
            seat_index: 0,
            action_type: action_codes::BET,
            amount: 100,
            sequence: 1,
            signature: vec![],
        };
        validator
            .validate(&ConsensusPayload::GameAction(action1))
            .unwrap();

        // End preflop betting, enter reveal-only for Flop
        validator
            .enter_reveal_only_phase(protocol_messages::RevealPhase::Flop)
            .unwrap();

        // Betting during reveal-only should fail
        let action2 = GameActionMessage {
            version: ProtocolVersion::current(),
            deal_commitment_hash: commitment_hash,
            seat_index: 1,
            action_type: action_codes::CALL,
            amount: 100,
            sequence: 2,
            signature: vec![],
        };
        let result = validator.validate(&ConsensusPayload::GameAction(action2.clone()));
        assert!(matches!(
            result,
            Err(PayloadError::ActionDuringRevealOnlyPhase { .. })
        ));

        // Flop reveal
        let flop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Flop);
        validator
            .validate(&ConsensusPayload::RevealShare(flop))
            .unwrap();

        // Flop betting round (action2 should now work)
        validator
            .validate(&ConsensusPayload::GameAction(action2))
            .unwrap();

        // End flop betting, enter reveal-only for Turn
        validator
            .enter_reveal_only_phase(protocol_messages::RevealPhase::Turn)
            .unwrap();

        // Turn reveal
        let turn = make_reveal(commitment_hash, protocol_messages::RevealPhase::Turn);
        validator
            .validate(&ConsensusPayload::RevealShare(turn))
            .unwrap();

        // End turn betting, enter reveal-only for River
        validator
            .enter_reveal_only_phase(protocol_messages::RevealPhase::River)
            .unwrap();

        // River reveal
        let river = make_reveal(commitment_hash, protocol_messages::RevealPhase::River);
        validator
            .validate(&ConsensusPayload::RevealShare(river))
            .unwrap();

        // Final betting, then showdown
        validator
            .enter_reveal_only_phase(protocol_messages::RevealPhase::Showdown)
            .unwrap();

        let showdown = make_reveal(commitment_hash, protocol_messages::RevealPhase::Showdown);
        validator
            .validate(&ConsensusPayload::RevealShare(showdown))
            .unwrap();

        assert!(validator.all_phases_complete());
        assert!(!validator.is_in_reveal_only_phase());
    }

    #[test]
    fn test_reveal_only_phase_error_display() {
        let err = PayloadError::ActionDuringRevealOnlyPhase {
            expected_phase: protocol_messages::RevealPhase::Flop,
        };
        let msg = err.to_string();
        assert!(msg.contains("game action during reveal-only phase"));
        assert!(msg.contains("Flop"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Reveal Timeout Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_reveal_ttl_constant_is_reasonable() {
        // REVEAL_TTL should be at least 10 seconds (10_000ms)
        assert!(REVEAL_TTL >= 10_000, "REVEAL_TTL should be at least 10 seconds");
        // REVEAL_TTL should be at most 5 minutes (300_000ms)
        assert!(REVEAL_TTL <= 300_000, "REVEAL_TTL should be at most 5 minutes");
    }

    #[test]
    fn test_enter_reveal_only_phase_with_timeout_sets_fields() {
        let (mut validator, _commitment_hash) = setup_validator_ready_for_reveals();

        let timestamp = 1700000000000u64;
        let seat = 2u8;

        validator
            .enter_reveal_only_phase_with_timeout(
                protocol_messages::RevealPhase::Preflop,
                timestamp,
                seat,
            )
            .unwrap();

        assert!(validator.is_in_reveal_only_phase());
        assert_eq!(
            validator.awaiting_reveal_phase(),
            Some(protocol_messages::RevealPhase::Preflop)
        );
        assert_eq!(validator.reveal_phase_entered_at(), Some(timestamp));
        assert_eq!(validator.reveal_expected_from_seat(), Some(seat));
    }

    #[test]
    fn test_check_reveal_timeout_no_timeout_before_ttl() {
        let (mut validator, _commitment_hash) = setup_validator_ready_for_reveals();

        let start_time = 1700000000000u64;
        validator
            .enter_reveal_only_phase_with_timeout(
                protocol_messages::RevealPhase::Preflop,
                start_time,
                0,
            )
            .unwrap();

        // Time within TTL should not trigger timeout
        let current_time = start_time + REVEAL_TTL - 1;
        assert!(
            validator.check_reveal_timeout(current_time).is_none(),
            "should not timeout before TTL expires"
        );

        // Exactly at TTL boundary should not trigger (we use > not >=)
        let current_time = start_time + REVEAL_TTL;
        assert!(
            validator.check_reveal_timeout(current_time).is_none(),
            "should not timeout exactly at TTL"
        );
    }

    #[test]
    fn test_check_reveal_timeout_triggers_after_ttl() {
        let (mut validator, _commitment_hash) = setup_validator_ready_for_reveals();

        let start_time = 1700000000000u64;
        let expected_seat = 3u8;
        validator
            .enter_reveal_only_phase_with_timeout(
                protocol_messages::RevealPhase::Preflop,
                start_time,
                expected_seat,
            )
            .unwrap();

        // Time after TTL should trigger timeout
        let current_time = start_time + REVEAL_TTL + 1;
        let result = validator.check_reveal_timeout(current_time);
        assert!(result.is_some(), "should timeout after TTL expires");

        let (elapsed, seat) = result.unwrap();
        assert_eq!(elapsed, REVEAL_TTL + 1);
        assert_eq!(seat, expected_seat);
    }

    #[test]
    fn test_check_reveal_timeout_none_when_not_in_reveal_phase() {
        let (validator, _commitment_hash) = setup_validator_ready_for_reveals();

        // Not in reveal-only phase
        assert!(!validator.is_in_reveal_only_phase());
        let current_time = 1700000000000u64;
        assert!(
            validator.check_reveal_timeout(current_time).is_none(),
            "should not timeout when not in reveal phase"
        );
    }

    #[test]
    fn test_validate_timelock_allowed_rejects_before_timeout() {
        let (mut validator, _commitment_hash) = setup_validator_ready_for_reveals();

        let start_time = 1700000000000u64;
        validator
            .enter_reveal_only_phase_with_timeout(
                protocol_messages::RevealPhase::Preflop,
                start_time,
                0,
            )
            .unwrap();

        // Before timeout expires, timelock should be rejected
        let current_time = start_time + 1000; // 1 second in
        let result = validator.validate_timelock_allowed(current_time);
        assert!(
            matches!(result, Err(PayloadError::TimelockRevealBeforeTimeout { .. })),
            "timelock should be rejected before timeout"
        );

        if let Err(PayloadError::TimelockRevealBeforeTimeout { phase, remaining_ms }) = result {
            assert_eq!(phase, protocol_messages::RevealPhase::Preflop);
            assert_eq!(remaining_ms, REVEAL_TTL - 1000);
        }
    }

    #[test]
    fn test_validate_timelock_allowed_accepts_after_timeout() {
        let (mut validator, _commitment_hash) = setup_validator_ready_for_reveals();

        let start_time = 1700000000000u64;
        validator
            .enter_reveal_only_phase_with_timeout(
                protocol_messages::RevealPhase::Preflop,
                start_time,
                0,
            )
            .unwrap();

        // After timeout expires, timelock should be accepted
        let current_time = start_time + REVEAL_TTL + 1;
        assert!(
            validator.validate_timelock_allowed(current_time).is_ok(),
            "timelock should be allowed after timeout"
        );
    }

    #[test]
    fn test_validate_timelock_allowed_ok_when_no_timeout_tracking() {
        let (mut validator, _commitment_hash) = setup_validator_ready_for_reveals();

        // Use old method without timestamp tracking
        validator
            .enter_reveal_only_phase(protocol_messages::RevealPhase::Preflop)
            .unwrap();

        // Without timestamp, timelock should be allowed (backward compatible behavior)
        let current_time = 1700000000000u64;
        assert!(
            validator.validate_timelock_allowed(current_time).is_ok(),
            "timelock should be allowed when no timeout tracking"
        );
    }

    #[test]
    fn test_reveal_clears_timeout_fields() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        let start_time = 1700000000000u64;
        validator
            .enter_reveal_only_phase_with_timeout(
                protocol_messages::RevealPhase::Preflop,
                start_time,
                2,
            )
            .unwrap();

        assert!(validator.reveal_phase_entered_at().is_some());
        assert!(validator.reveal_expected_from_seat().is_some());

        // Complete the reveal
        let reveal = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        validator
            .validate(&ConsensusPayload::RevealShare(reveal))
            .unwrap();

        // Timeout fields should be cleared
        assert!(validator.reveal_phase_entered_at().is_none());
        assert!(validator.reveal_expected_from_seat().is_none());
        assert!(!validator.is_in_reveal_only_phase());
    }

    #[test]
    fn test_timelock_reveal_clears_timeout_fields() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        let start_time = 1700000000000u64;
        validator
            .enter_reveal_only_phase_with_timeout(
                protocol_messages::RevealPhase::Preflop,
                start_time,
                2,
            )
            .unwrap();

        assert!(validator.reveal_phase_entered_at().is_some());
        assert!(validator.reveal_expected_from_seat().is_some());

        // Complete with timelock reveal
        let timelock =
            make_timelock_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        validator
            .validate(&ConsensusPayload::TimelockReveal(timelock))
            .unwrap();

        // Timeout fields should be cleared
        assert!(validator.reveal_phase_entered_at().is_none());
        assert!(validator.reveal_expected_from_seat().is_none());
        assert!(!validator.is_in_reveal_only_phase());
    }

    #[test]
    fn test_exit_reveal_only_phase_clears_timeout_fields() {
        let (mut validator, _commitment_hash) = setup_validator_ready_for_reveals();

        let start_time = 1700000000000u64;
        validator
            .enter_reveal_only_phase_with_timeout(
                protocol_messages::RevealPhase::Preflop,
                start_time,
                2,
            )
            .unwrap();

        assert!(validator.reveal_phase_entered_at().is_some());
        assert!(validator.reveal_expected_from_seat().is_some());

        // Manually exit
        validator.exit_reveal_only_phase();

        // All fields should be cleared
        assert!(validator.reveal_phase_entered_at().is_none());
        assert!(validator.reveal_expected_from_seat().is_none());
        assert!(!validator.is_in_reveal_only_phase());
    }

    #[test]
    fn test_reveal_timeout_error_display() {
        let err = PayloadError::RevealTimeout {
            phase: protocol_messages::RevealPhase::Flop,
            elapsed_ms: 35000,
            ttl_ms: 30000,
            timeout_seat: 2,
        };
        let msg = err.to_string();
        assert!(msg.contains("reveal timeout expired"));
        assert!(msg.contains("Flop"));
        assert!(msg.contains("35000ms"));
        assert!(msg.contains("30000ms"));
        assert!(msg.contains("seat 2"));
    }

    #[test]
    fn test_timelock_before_timeout_error_display() {
        let err = PayloadError::TimelockRevealBeforeTimeout {
            phase: protocol_messages::RevealPhase::Turn,
            remaining_ms: 15000,
        };
        let msg = err.to_string();
        assert!(msg.contains("timelock reveal received before timeout"));
        assert!(msg.contains("Turn"));
        assert!(msg.contains("15000ms"));
    }

    #[test]
    fn test_timeout_tracking_through_multiple_phases() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Phase 1: Preflop with timeout
        let t1 = 1700000000000u64;
        validator
            .enter_reveal_only_phase_with_timeout(protocol_messages::RevealPhase::Preflop, t1, 0)
            .unwrap();
        assert_eq!(validator.reveal_phase_entered_at(), Some(t1));

        // Complete preflop
        let preflop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        validator
            .validate(&ConsensusPayload::RevealShare(preflop))
            .unwrap();
        assert!(validator.reveal_phase_entered_at().is_none());

        // Phase 2: Flop with different timestamp
        let t2 = 1700000030000u64;
        validator
            .enter_reveal_only_phase_with_timeout(protocol_messages::RevealPhase::Flop, t2, 1)
            .unwrap();
        assert_eq!(validator.reveal_phase_entered_at(), Some(t2));
        assert_eq!(validator.reveal_expected_from_seat(), Some(1));

        // Check timeout at different times
        assert!(validator.check_reveal_timeout(t2 + REVEAL_TTL - 1).is_none());
        let timeout_result = validator.check_reveal_timeout(t2 + REVEAL_TTL + 5000);
        assert!(timeout_result.is_some());
        assert_eq!(timeout_result.unwrap().0, REVEAL_TTL + 5000);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // validate_at_time integration tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_validate_at_time_rejects_early_timelock() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        let start_time = 1700000000000u64;
        validator
            .enter_reveal_only_phase_with_timeout(
                protocol_messages::RevealPhase::Preflop,
                start_time,
                0,
            )
            .unwrap();

        // Create timelock reveal
        let timelock =
            make_timelock_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        let payload = ConsensusPayload::TimelockReveal(timelock);

        // Should be rejected before timeout
        let early_time = start_time + 1000; // 1 second in
        let result = validator.validate_at_time(&payload, early_time);
        assert!(
            matches!(
                result,
                Err(PayloadError::TimelockRevealBeforeTimeout { .. })
            ),
            "timelock should be rejected before TTL expires"
        );

        if let Err(PayloadError::TimelockRevealBeforeTimeout { phase, remaining_ms }) = result {
            assert_eq!(phase, protocol_messages::RevealPhase::Preflop);
            assert_eq!(remaining_ms, REVEAL_TTL - 1000);
        }
    }

    #[test]
    fn test_validate_at_time_accepts_timelock_after_timeout() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        let start_time = 1700000000000u64;
        validator
            .enter_reveal_only_phase_with_timeout(
                protocol_messages::RevealPhase::Preflop,
                start_time,
                0,
            )
            .unwrap();

        // Create timelock reveal
        let timelock =
            make_timelock_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        let payload = ConsensusPayload::TimelockReveal(timelock);

        // Should be accepted after timeout
        let late_time = start_time + REVEAL_TTL + 1;
        assert!(
            validator.validate_at_time(&payload, late_time).is_ok(),
            "timelock should be accepted after TTL expires"
        );

        // Phase should now be complete
        assert!(validator.is_phase_complete(protocol_messages::RevealPhase::Preflop));
        assert!(!validator.is_in_reveal_only_phase());
    }

    #[test]
    fn test_validate_at_time_allows_regular_reveal_anytime() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        let start_time = 1700000000000u64;
        validator
            .enter_reveal_only_phase_with_timeout(
                protocol_messages::RevealPhase::Preflop,
                start_time,
                0,
            )
            .unwrap();

        // Create regular reveal (not timelock)
        let reveal = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        let payload = ConsensusPayload::RevealShare(reveal);

        // Regular reveals should be accepted at any time (before timeout)
        let early_time = start_time + 1000;
        assert!(
            validator.validate_at_time(&payload, early_time).is_ok(),
            "regular reveal should be accepted before timeout"
        );
    }

    #[test]
    fn test_validate_at_time_accepts_game_action() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Not in reveal-only phase, game actions should be allowed
        let action = GameActionMessage {
            version: ProtocolVersion::current(),
            deal_commitment_hash: commitment_hash,
            seat_index: 0,
            action_type: action_codes::BET,
            amount: 100,
            sequence: 1,
            signature: vec![],
        };
        let payload = ConsensusPayload::GameAction(action);

        let current_time = 1700000000000u64;
        assert!(
            validator.validate_at_time(&payload, current_time).is_ok(),
            "game action should be accepted when not in reveal-only phase"
        );
    }

    #[test]
    fn test_validate_at_time_timelock_without_timeout_tracking() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Enter reveal phase WITHOUT timeout tracking (using old method)
        validator
            .enter_reveal_only_phase(protocol_messages::RevealPhase::Preflop)
            .unwrap();

        // Create timelock reveal
        let timelock =
            make_timelock_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        let payload = ConsensusPayload::TimelockReveal(timelock);

        // Should be accepted immediately (backward compatible behavior)
        let current_time = 1700000000000u64;
        assert!(
            validator.validate_at_time(&payload, current_time).is_ok(),
            "timelock should be accepted when no timeout tracking"
        );
    }

    #[test]
    fn test_validate_at_time_multiple_phases() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        let t1 = 1700000000000u64;

        // Phase 1: Preflop - complete with regular reveal
        validator
            .enter_reveal_only_phase_with_timeout(protocol_messages::RevealPhase::Preflop, t1, 0)
            .unwrap();
        let preflop = make_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        validator
            .validate_at_time(&ConsensusPayload::RevealShare(preflop), t1 + 5000)
            .unwrap();

        // Phase 2: Flop - try early timelock, should fail
        let t2 = t1 + 60_000; // 60 seconds later
        validator
            .enter_reveal_only_phase_with_timeout(protocol_messages::RevealPhase::Flop, t2, 1)
            .unwrap();

        let flop_timelock =
            make_timelock_reveal(commitment_hash, protocol_messages::RevealPhase::Flop);
        let early_time = t2 + 10_000; // 10 seconds in (before timeout)
        let result = validator.validate_at_time(
            &ConsensusPayload::TimelockReveal(flop_timelock.clone()),
            early_time,
        );
        assert!(
            matches!(
                result,
                Err(PayloadError::TimelockRevealBeforeTimeout { .. })
            ),
            "flop timelock should be rejected before timeout"
        );

        // Now wait for timeout and try again
        let late_time = t2 + REVEAL_TTL + 1;
        assert!(
            validator
                .validate_at_time(&ConsensusPayload::TimelockReveal(flop_timelock), late_time)
                .is_ok(),
            "flop timelock should be accepted after timeout"
        );

        assert!(validator.is_phase_complete(protocol_messages::RevealPhase::Flop));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Timelock Scope and Proof Validation Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_timelock_rejects_invalid_timeout_seat() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Create a timelock with timeout_seat not in the seat order (0, 1, 2, 3)
        let mut timelock =
            make_timelock_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        timelock.timeout_seat = 99; // Invalid seat

        let result = validator.validate(&ConsensusPayload::TimelockReveal(timelock));
        assert!(
            matches!(
                result,
                Err(PayloadError::InvalidTimelockTimeoutSeat { seat: 99, .. })
            ),
            "timelock with invalid timeout_seat should be rejected"
        );
    }

    #[test]
    fn test_timelock_accepts_valid_timeout_seat() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Create a timelock with a valid timeout_seat (seat 1 is in the seat order)
        let timelock =
            make_timelock_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        // Default make_timelock_reveal uses timeout_seat: 1, which is valid

        let result = validator.validate(&ConsensusPayload::TimelockReveal(timelock));
        assert!(result.is_ok(), "timelock with valid timeout_seat should be accepted");
    }

    #[test]
    fn test_timelock_rejects_card_index_out_of_bounds() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Create a timelock with card_indices out of bounds (deck_length is 52)
        let mut timelock =
            make_timelock_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        timelock.card_indices = vec![60]; // Out of bounds for deck_length 52
        timelock.revealed_values = vec![vec![42]]; // Must match card_indices count

        let result = validator.validate(&ConsensusPayload::TimelockReveal(timelock));
        assert!(
            matches!(
                result,
                Err(PayloadError::TimelockCardIndexOutOfBounds {
                    index: 60,
                    deck_length: 52
                })
            ),
            "timelock with card index out of bounds should be rejected"
        );
    }

    #[test]
    fn test_timelock_accepts_valid_card_indices() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Create a timelock with valid card indices (0 and 51 are valid for deck_length 52)
        let mut timelock =
            make_timelock_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        timelock.card_indices = vec![0, 51];
        timelock.revealed_values = vec![vec![42], vec![43]];

        let result = validator.validate(&ConsensusPayload::TimelockReveal(timelock));
        assert!(result.is_ok(), "timelock with valid card indices should be accepted");
    }

    #[test]
    fn test_timelock_rejects_mismatched_card_indices_and_values() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Create a timelock with mismatched card_indices and revealed_values counts
        let mut timelock =
            make_timelock_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        timelock.card_indices = vec![0, 1, 2]; // 3 indices
        timelock.revealed_values = vec![vec![42]]; // 1 value

        let result = validator.validate(&ConsensusPayload::TimelockReveal(timelock));
        assert!(
            matches!(
                result,
                Err(PayloadError::TimelockCardValueMismatch {
                    indices_count: 3,
                    values_count: 1
                })
            ),
            "timelock with mismatched counts should be rejected"
        );
    }

    #[test]
    fn test_timelock_rejects_missing_proof_when_revealing_values() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Create a timelock with revealed_values but no proof
        let mut timelock =
            make_timelock_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        timelock.timelock_proof = vec![]; // Empty proof
        timelock.revealed_values = vec![vec![42]]; // Non-empty values

        let result = validator.validate(&ConsensusPayload::TimelockReveal(timelock));
        assert!(
            matches!(
                result,
                Err(PayloadError::TimelockMissingProof { values_count: 1 })
            ),
            "timelock with missing proof should be rejected"
        );
    }

    #[test]
    fn test_timelock_accepts_empty_values_without_proof() {
        let (mut validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Create a timelock with empty revealed_values and empty proof (valid edge case)
        let mut timelock =
            make_timelock_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        timelock.card_indices = vec![];
        timelock.timelock_proof = vec![];
        timelock.revealed_values = vec![];

        let result = validator.validate(&ConsensusPayload::TimelockReveal(timelock));
        assert!(
            result.is_ok(),
            "timelock with empty values and empty proof should be accepted"
        );
    }

    #[test]
    fn test_timelock_error_display_invalid_seat() {
        let err = PayloadError::InvalidTimelockTimeoutSeat {
            seat: 99,
            seat_order: vec![0, 1, 2],
        };
        let msg = err.to_string();
        assert!(msg.contains("invalid timeout seat"));
        assert!(msg.contains("99"));
    }

    #[test]
    fn test_timelock_error_display_card_out_of_bounds() {
        let err = PayloadError::TimelockCardIndexOutOfBounds {
            index: 60,
            deck_length: 52,
        };
        let msg = err.to_string();
        assert!(msg.contains("out of bounds"));
        assert!(msg.contains("60"));
        assert!(msg.contains("52"));
    }

    #[test]
    fn test_timelock_error_display_card_value_mismatch() {
        let err = PayloadError::TimelockCardValueMismatch {
            indices_count: 3,
            values_count: 1,
        };
        let msg = err.to_string();
        assert!(msg.contains("3 card indices"));
        assert!(msg.contains("1 revealed values"));
    }

    #[test]
    fn test_timelock_error_display_missing_proof() {
        let err = PayloadError::TimelockMissingProof { values_count: 5 };
        let msg = err.to_string();
        assert!(msg.contains("missing proof"));
        assert!(msg.contains("5"));
    }

    #[test]
    fn test_validate_timelock_scope_and_proof_directly() {
        let (validator, commitment_hash) = setup_validator_ready_for_reveals();

        // Valid timelock
        let timelock =
            make_timelock_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        assert!(
            validator.validate_timelock_scope_and_proof(&timelock).is_ok(),
            "direct validation should accept valid timelock"
        );

        // Invalid timeout_seat
        let mut bad_seat =
            make_timelock_reveal(commitment_hash, protocol_messages::RevealPhase::Preflop);
        bad_seat.timeout_seat = 99;
        assert!(
            validator.validate_timelock_scope_and_proof(&bad_seat).is_err(),
            "direct validation should reject invalid timeout_seat"
        );
    }

    #[test]
    fn test_deck_length_getter() {
        let (validator, _) = setup_validator_ready_for_reveals();
        assert_eq!(validator.deck_length(), Some(52));
    }
}
