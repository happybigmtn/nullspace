//! Canonical message payload definitions.
//!
//! All payloads include:
//! - Protocol version for forward compatibility
//! - Domain separation prefix for security
//! - Scope binding for context verification

use serde::{Deserialize, Serialize};

/// Current protocol version for all messages.
pub const CURRENT_PROTOCOL_VERSION: u8 = 1;

/// Protocol version embedded in each message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtocolVersion(pub u8);

impl Default for ProtocolVersion {
    fn default() -> Self {
        Self(CURRENT_PROTOCOL_VERSION)
    }
}

impl ProtocolVersion {
    pub const fn new(version: u8) -> Self {
        Self(version)
    }

    pub const fn current() -> Self {
        Self(CURRENT_PROTOCOL_VERSION)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain separation prefixes
// ─────────────────────────────────────────────────────────────────────────────

/// Domain separation prefixes for message hashing.
///
/// Domain separation prevents cross-protocol hash collisions by ensuring
/// that messages of different types can never produce the same hash, even
/// if their content happens to be identical.
///
/// # Security Rationale
///
/// Without domain separation, an attacker might craft a message that is
/// valid as both type A and type B. For example, if `DealCommitment` and
/// `RevealShare` used the same hash format, an attacker might find a byte
/// sequence that parses validly as both, enabling protocol confusion attacks.
///
/// # Prefix Format
///
/// Each prefix follows the pattern: `b"nullspace.<message_type>.v<version>"`
///
/// The version suffix allows for hash-incompatible changes in future
/// protocol versions while maintaining backward compatibility during
/// migration windows.
///
/// # Usage
///
/// Every message type's `preimage()` method begins with its domain prefix:
/// ```text
/// preimage = domain_prefix || version || ... other fields ...
/// hash = blake3(preimage)
/// ```
pub mod domain {
    /// Domain prefix for [`super::DealCommitment`] messages.
    pub const DEAL_COMMITMENT: &[u8] = b"nullspace.deal_commitment.v1";
    /// Domain prefix for [`super::DealCommitmentAck`] messages.
    pub const DEAL_COMMITMENT_ACK: &[u8] = b"nullspace.deal_commitment_ack.v1";
    /// Domain prefix for [`super::RevealShare`] messages.
    pub const REVEAL_SHARE: &[u8] = b"nullspace.reveal_share.v1";
    /// Domain prefix for [`super::TimelockReveal`] messages.
    pub const TIMELOCK_REVEAL: &[u8] = b"nullspace.timelock_reveal.v1";
    /// Domain prefix for [`super::ArtifactRequest`] messages.
    pub const ARTIFACT_REQUEST: &[u8] = b"nullspace.artifact_request.v1";
    /// Domain prefix for [`super::ArtifactResponse`] messages.
    pub const ARTIFACT_RESPONSE: &[u8] = b"nullspace.artifact_response.v1";
    /// Domain prefix for [`super::ShuffleContext`] binding.
    pub const SHUFFLE_CONTEXT: &[u8] = b"nullspace.shuffle_context.v1";
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope Binding
// ─────────────────────────────────────────────────────────────────────────────

/// Binds a message to a specific table, hand, and seat configuration.
///
/// Scope binding is a critical security mechanism that prevents replay attacks
/// by ensuring messages are only valid within their intended context. A message
/// with scope S cannot be replayed in any context where the scope differs.
///
/// # Replay Prevention
///
/// Without scope binding, an attacker could:
/// - Replay a valid commitment from one table to manipulate another.
/// - Replay an old hand's commitment in a new hand.
/// - Replay a commitment intended for different players.
///
/// With scope binding, each message is cryptographically tied to:
/// - The specific table (`table_id`)
/// - The specific hand number (`hand_id`)
/// - The exact set and order of participants (`seat_order`)
/// - The deck configuration (`deck_length`)
///
/// # Deterministic Encoding
///
/// The scope encodes to bytes deterministically:
/// ```text
/// [table_id: 32 bytes][hand_id: 8 bytes LE][seat_count: 1 byte][seats: N bytes][deck_length: 1 byte]
/// ```
///
/// This encoding is included in message preimages before hashing, ensuring
/// the scope is bound into every message hash.
///
/// # Verification
///
/// Verifiers reconstruct the expected scope from current game state and
/// compare byte-for-byte. Any mismatch (wrong table, wrong hand, wrong
/// players) causes verification to fail deterministically.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScopeBinding {
    /// Unique 32-byte identifier for the game table/room.
    /// Typically derived from the table's creation parameters or a UUID.
    pub table_id: [u8; 32],
    /// Sequential hand number within the table session.
    /// Starts at 0 or 1 and increments with each new hand.
    pub hand_id: u64,
    /// Ordered list of seat indices participating in this hand.
    /// Order matters: `[0, 1, 2]` is different from `[2, 1, 0]`.
    pub seat_order: Vec<u8>,
    /// Number of cards in the deck (typically 52 for standard poker).
    /// Included to prevent attacks involving non-standard deck sizes.
    pub deck_length: u8,
}

impl ScopeBinding {
    /// Create a new scope binding.
    pub fn new(table_id: [u8; 32], hand_id: u64, seat_order: Vec<u8>, deck_length: u8) -> Self {
        Self {
            table_id,
            hand_id,
            seat_order,
            deck_length,
        }
    }

    /// Encode the scope binding to bytes for hashing.
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(32 + 8 + 1 + self.seat_order.len() + 1);
        buf.extend_from_slice(&self.table_id);
        buf.extend_from_slice(&self.hand_id.to_le_bytes());
        buf.push(self.seat_order.len() as u8);
        buf.extend_from_slice(&self.seat_order);
        buf.push(self.deck_length);
        buf
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shuffle Context
// ─────────────────────────────────────────────────────────────────────────────

/// Binds a shuffle to its execution context for verification.
///
/// `ShuffleContext` captures all parameters that must be agreed upon before
/// a mental poker shuffle begins. This context is hashed and bound into the
/// shuffle commitment, ensuring that:
///
/// 1. A shuffle proof is only valid for the specific table, hand, and players
///    it was created for.
/// 2. Changing any context parameter invalidates the shuffle commitment.
/// 3. Verifiers can deterministically reconstruct the expected context and
///    reject mismatches.
///
/// # Relationship to ScopeBinding
///
/// `ShuffleContext` contains a [`ScopeBinding`] plus protocol version info.
/// While `ScopeBinding` provides the raw table/hand/seat data, `ShuffleContext`
/// adds the domain separation and versioning needed for shuffle verification.
///
/// # Verification Flow
///
/// ```text
/// 1. Dealer proposes shuffle with ShuffleContext
/// 2. All players verify context matches their local state:
///    - table_id matches current table
///    - hand_id matches current hand
///    - seat_order matches current players (in order)
///    - deck_length matches expected deck size
/// 3. Players participate in shuffle protocol
/// 4. Final shuffle commitment includes context_hash()
/// 5. During verification, context is reconstructed and compared
/// ```
///
/// # Deterministic Encoding
///
/// The context encodes to bytes deterministically:
/// ```text
/// [domain prefix][version: 1 byte][scope encoding]
/// ```
///
/// This ensures the same context always produces the same hash,
/// enabling deterministic verification across all validators.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShuffleContext {
    /// Protocol version for this context.
    pub version: ProtocolVersion,
    /// The table identifier this shuffle is for.
    pub table_id: [u8; 32],
    /// The hand number this shuffle is for.
    pub hand_id: u64,
    /// Ordered list of seat indices participating in the shuffle.
    /// Order determines the shuffle contribution sequence.
    pub seat_order: Vec<u8>,
    /// Number of cards in the deck being shuffled.
    pub deck_length: u8,
}

impl ShuffleContext {
    /// Create a new shuffle context.
    pub fn new(
        version: ProtocolVersion,
        table_id: [u8; 32],
        hand_id: u64,
        seat_order: Vec<u8>,
        deck_length: u8,
    ) -> Self {
        Self {
            version,
            table_id,
            hand_id,
            seat_order,
            deck_length,
        }
    }

    /// Create a shuffle context from a scope binding.
    pub fn from_scope(version: ProtocolVersion, scope: &ScopeBinding) -> Self {
        Self {
            version,
            table_id: scope.table_id,
            hand_id: scope.hand_id,
            seat_order: scope.seat_order.clone(),
            deck_length: scope.deck_length,
        }
    }

    /// Convert this shuffle context to a scope binding.
    pub fn to_scope(&self) -> ScopeBinding {
        ScopeBinding {
            table_id: self.table_id,
            hand_id: self.hand_id,
            seat_order: self.seat_order.clone(),
            deck_length: self.deck_length,
        }
    }

    /// Domain-separated preimage for hashing.
    ///
    /// The preimage includes all context fields with domain separation,
    /// ensuring shuffle contexts cannot collide with other message types.
    pub fn preimage(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(domain::SHUFFLE_CONTEXT);
        buf.push(self.version.0);
        buf.extend_from_slice(&self.table_id);
        buf.extend_from_slice(&self.hand_id.to_le_bytes());
        buf.push(self.seat_order.len() as u8);
        buf.extend_from_slice(&self.seat_order);
        buf.push(self.deck_length);
        buf
    }

    /// Canonical hash of this shuffle context.
    ///
    /// This hash is included in shuffle commitments to bind the shuffle
    /// to its context. Verification fails if context hashes don't match.
    pub fn context_hash(&self) -> [u8; 32] {
        crate::canonical_hash(&self.preimage())
    }

    /// Verify that this context matches another.
    ///
    /// This is a byte-for-byte comparison that ensures:
    /// - Same table, hand, seats, and deck length
    /// - Same protocol version
    ///
    /// Returns `Ok(())` if contexts match, or an error describing the mismatch.
    pub fn verify_matches(&self, other: &ShuffleContext) -> Result<(), ShuffleContextMismatch> {
        if self.version != other.version {
            return Err(ShuffleContextMismatch::Version {
                expected: self.version.0,
                got: other.version.0,
            });
        }
        if self.table_id != other.table_id {
            return Err(ShuffleContextMismatch::TableId {
                expected: self.table_id,
                got: other.table_id,
            });
        }
        if self.hand_id != other.hand_id {
            return Err(ShuffleContextMismatch::HandId {
                expected: self.hand_id,
                got: other.hand_id,
            });
        }
        if self.seat_order != other.seat_order {
            return Err(ShuffleContextMismatch::SeatOrder {
                expected: self.seat_order.clone(),
                got: other.seat_order.clone(),
            });
        }
        if self.deck_length != other.deck_length {
            return Err(ShuffleContextMismatch::DeckLength {
                expected: self.deck_length,
                got: other.deck_length,
            });
        }
        Ok(())
    }
}

/// Error type for shuffle context mismatches during verification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShuffleContextMismatch {
    /// Protocol version mismatch.
    Version { expected: u8, got: u8 },
    /// Table ID mismatch.
    TableId { expected: [u8; 32], got: [u8; 32] },
    /// Hand ID mismatch.
    HandId { expected: u64, got: u64 },
    /// Seat order mismatch.
    SeatOrder { expected: Vec<u8>, got: Vec<u8> },
    /// Deck length mismatch.
    DeckLength { expected: u8, got: u8 },
}

impl std::fmt::Display for ShuffleContextMismatch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Version { expected, got } => {
                write!(f, "version mismatch: expected {}, got {}", expected, got)
            }
            Self::TableId { expected, got } => {
                write!(f, "table_id mismatch: expected {:?}, got {:?}", expected, got)
            }
            Self::HandId { expected, got } => {
                write!(f, "hand_id mismatch: expected {}, got {}", expected, got)
            }
            Self::SeatOrder { expected, got } => {
                write!(f, "seat_order mismatch: expected {:?}, got {:?}", expected, got)
            }
            Self::DeckLength { expected, got } => {
                write!(f, "deck_length mismatch: expected {}, got {}", expected, got)
            }
        }
    }
}

impl std::error::Error for ShuffleContextMismatch {}

// ─────────────────────────────────────────────────────────────────────────────
// DealCommitment
// ─────────────────────────────────────────────────────────────────────────────

/// A cryptographic commitment to a deal (shuffled deck).
///
/// The dealer broadcasts this before the first action. All players must
/// acknowledge before play proceeds. The commitment binds:
/// - The shuffled deck (as a hash)
/// - The scope (table, hand, seats)
/// - Deal artifacts needed for verification
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DealCommitment {
    /// Protocol version for this message.
    pub version: ProtocolVersion,
    /// Scope binding for replay protection.
    pub scope: ScopeBinding,
    /// Hash of the shuffled deck (before encryption).
    pub shuffle_commitment: [u8; 32],
    /// Hashes of deal artifacts (encryption keys, proofs, etc.).
    pub artifact_hashes: Vec<[u8; 32]>,
    /// Timestamp (unix millis) when commitment was created.
    pub timestamp_ms: u64,
    /// Dealer's signature over the commitment preimage.
    pub dealer_signature: Vec<u8>,
}

impl DealCommitment {
    /// Domain-separated preimage for hashing.
    pub fn preimage(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(domain::DEAL_COMMITMENT);
        buf.push(self.version.0);
        buf.extend_from_slice(&self.scope.encode());
        buf.extend_from_slice(&self.shuffle_commitment);
        buf.push(self.artifact_hashes.len() as u8);
        for hash in &self.artifact_hashes {
            buf.extend_from_slice(hash);
        }
        buf.extend_from_slice(&self.timestamp_ms.to_le_bytes());
        // Signature is not part of the preimage (it signs the preimage)
        buf
    }

    /// Canonical hash of this commitment.
    pub fn commitment_hash(&self) -> [u8; 32] {
        crate::canonical_hash(&self.preimage())
    }

    /// Verify that this commitment's scope matches an expected shuffle context.
    ///
    /// This is a critical verification step that prevents replay attacks where
    /// a commitment from one table/hand is reused in a different context.
    ///
    /// # Verification
    ///
    /// The commitment's `scope` is converted to a `ShuffleContext` using the
    /// commitment's protocol version, then compared field-by-field against the
    /// expected context.
    ///
    /// # Errors
    ///
    /// Returns [`ShuffleContextMismatch`] if any field differs:
    /// - `Version`: Protocol version mismatch
    /// - `TableId`: Commitment is for a different table
    /// - `HandId`: Commitment is for a different hand
    /// - `SeatOrder`: Commitment is for different players or seating
    /// - `DeckLength`: Commitment is for a different deck configuration
    ///
    /// # Example
    ///
    /// ```
    /// use protocol_messages::{DealCommitment, ProtocolVersion, ScopeBinding, ShuffleContext};
    ///
    /// let scope = ScopeBinding::new([1u8; 32], 42, vec![0, 1], 52);
    /// let commitment = DealCommitment {
    ///     version: ProtocolVersion::current(),
    ///     scope,
    ///     shuffle_commitment: [2u8; 32],
    ///     artifact_hashes: vec![],
    ///     timestamp_ms: 1700000000000,
    ///     dealer_signature: vec![],
    /// };
    ///
    /// // Create expected context from current game state
    /// let expected = ShuffleContext::new(
    ///     ProtocolVersion::current(),
    ///     [1u8; 32],
    ///     42,
    ///     vec![0, 1],
    ///     52,
    /// );
    ///
    /// // Verification succeeds for matching context
    /// assert!(commitment.verify_context(&expected).is_ok());
    ///
    /// // Verification fails for mismatched context
    /// let wrong_hand = ShuffleContext::new(
    ///     ProtocolVersion::current(),
    ///     [1u8; 32],
    ///     999,  // different hand_id
    ///     vec![0, 1],
    ///     52,
    /// );
    /// assert!(commitment.verify_context(&wrong_hand).is_err());
    /// ```
    pub fn verify_context(&self, expected: &ShuffleContext) -> Result<(), ShuffleContextMismatch> {
        let actual = ShuffleContext::from_scope(self.version, &self.scope);
        expected.verify_matches(&actual)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DealCommitmentAck
// ─────────────────────────────────────────────────────────────────────────────

/// Acknowledgment of receiving a deal commitment.
///
/// Each player sends this after verifying the commitment is well-formed.
/// Play cannot proceed until all seated players have acknowledged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DealCommitmentAck {
    /// Protocol version for this message.
    pub version: ProtocolVersion,
    /// Hash of the commitment being acknowledged.
    pub commitment_hash: [u8; 32],
    /// Seat index of the acknowledging player.
    pub seat_index: u8,
    /// Player's signature over the ack preimage.
    pub player_signature: Vec<u8>,
}

impl DealCommitmentAck {
    /// Domain-separated preimage for hashing.
    pub fn preimage(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(domain::DEAL_COMMITMENT_ACK);
        buf.push(self.version.0);
        buf.extend_from_slice(&self.commitment_hash);
        buf.push(self.seat_index);
        buf
    }

    /// Canonical hash of this ack.
    pub fn ack_hash(&self) -> [u8; 32] {
        crate::canonical_hash(&self.preimage())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// RevealShare
// ─────────────────────────────────────────────────────────────────────────────

/// The phase of the game for which cards are being revealed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum RevealPhase {
    /// Hole cards dealt to players.
    Preflop = 0,
    /// First three community cards.
    Flop = 1,
    /// Fourth community card.
    Turn = 2,
    /// Fifth community card.
    River = 3,
    /// Final showdown (may reveal all remaining).
    Showdown = 4,
}

impl RevealPhase {
    /// Convert from raw byte value.
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Preflop),
            1 => Some(Self::Flop),
            2 => Some(Self::Turn),
            3 => Some(Self::River),
            4 => Some(Self::Showdown),
            _ => None,
        }
    }
}

/// A selective reveal of specific card indices for a given phase.
///
/// Only the cards required by poker rules for the current phase are revealed.
/// This replaces full-deck reveals with minimal disclosure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RevealShare {
    /// Protocol version for this message.
    pub version: ProtocolVersion,
    /// Hash of the deal commitment this reveal is for.
    pub commitment_hash: [u8; 32],
    /// Game phase being revealed.
    pub phase: RevealPhase,
    /// Card indices being revealed (0-51 for standard deck).
    pub card_indices: Vec<u8>,
    /// Decryption shares or revealed values for each card index.
    /// Each entry corresponds to the card at the same position in `card_indices`.
    pub reveal_data: Vec<Vec<u8>>,
    /// Seat index of the player providing the reveal (or 0xFF for dealer).
    pub from_seat: u8,
    /// Signature over the reveal preimage.
    pub signature: Vec<u8>,
}

impl RevealShare {
    /// Domain-separated preimage for hashing.
    pub fn preimage(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(domain::REVEAL_SHARE);
        buf.push(self.version.0);
        buf.extend_from_slice(&self.commitment_hash);
        buf.push(self.phase as u8);
        buf.push(self.card_indices.len() as u8);
        buf.extend_from_slice(&self.card_indices);
        for data in &self.reveal_data {
            buf.extend_from_slice(&(data.len() as u16).to_le_bytes());
            buf.extend_from_slice(data);
        }
        buf.push(self.from_seat);
        buf
    }

    /// Canonical hash of this reveal.
    pub fn reveal_hash(&self) -> [u8; 32] {
        crate::canonical_hash(&self.preimage())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TimelockReveal
// ─────────────────────────────────────────────────────────────────────────────

/// Fallback reveal using timelock encryption.
///
/// When a player fails to provide their reveal share within `REVEAL_TTL`,
/// the timelock proof allows deterministic continuation without that player.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimelockReveal {
    /// Protocol version for this message.
    pub version: ProtocolVersion,
    /// Hash of the deal commitment this reveal is for.
    pub commitment_hash: [u8; 32],
    /// Game phase being revealed.
    pub phase: RevealPhase,
    /// Card indices being revealed via timelock.
    pub card_indices: Vec<u8>,
    /// Timelock proof data (format depends on timelock scheme).
    pub timelock_proof: Vec<u8>,
    /// Revealed values after timelock decryption.
    pub revealed_values: Vec<Vec<u8>>,
    /// The seat that failed to reveal (triggering timelock).
    pub timeout_seat: u8,
}

impl TimelockReveal {
    /// Domain-separated preimage for hashing.
    pub fn preimage(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(domain::TIMELOCK_REVEAL);
        buf.push(self.version.0);
        buf.extend_from_slice(&self.commitment_hash);
        buf.push(self.phase as u8);
        buf.push(self.card_indices.len() as u8);
        buf.extend_from_slice(&self.card_indices);
        buf.extend_from_slice(&(self.timelock_proof.len() as u32).to_le_bytes());
        buf.extend_from_slice(&self.timelock_proof);
        for value in &self.revealed_values {
            buf.extend_from_slice(&(value.len() as u16).to_le_bytes());
            buf.extend_from_slice(value);
        }
        buf.push(self.timeout_seat);
        buf
    }

    /// Canonical hash of this timelock reveal.
    pub fn timelock_hash(&self) -> [u8; 32] {
        crate::canonical_hash(&self.preimage())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Artifact Requests
// ─────────────────────────────────────────────────────────────────────────────

/// Request for deal artifacts by hash.
///
/// Used during verification or dispute resolution to retrieve
/// the original deal artifacts (proofs, encrypted shares, etc.).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactRequest {
    /// Protocol version for this message.
    pub version: ProtocolVersion,
    /// Hashes of artifacts being requested.
    pub artifact_hashes: Vec<[u8; 32]>,
    /// Optional: commitment hash to scope the request.
    pub commitment_hash: Option<[u8; 32]>,
}

impl ArtifactRequest {
    /// Domain-separated preimage for hashing.
    pub fn preimage(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(domain::ARTIFACT_REQUEST);
        buf.push(self.version.0);
        buf.push(self.artifact_hashes.len() as u8);
        for hash in &self.artifact_hashes {
            buf.extend_from_slice(hash);
        }
        if let Some(ch) = &self.commitment_hash {
            buf.push(1);
            buf.extend_from_slice(ch);
        } else {
            buf.push(0);
        }
        buf
    }
}

/// Response containing requested artifacts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactResponse {
    /// Protocol version for this message.
    pub version: ProtocolVersion,
    /// Artifacts keyed by their hash.
    /// Each entry is (hash, data). Hash is verified on receipt.
    pub artifacts: Vec<([u8; 32], Vec<u8>)>,
    /// Hashes of artifacts that were not found.
    pub missing: Vec<[u8; 32]>,
}

impl ArtifactResponse {
    /// Domain-separated preimage for hashing.
    pub fn preimage(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(domain::ARTIFACT_RESPONSE);
        buf.push(self.version.0);
        buf.push(self.artifacts.len() as u8);
        for (hash, data) in &self.artifacts {
            buf.extend_from_slice(hash);
            buf.extend_from_slice(&(data.len() as u32).to_le_bytes());
            buf.extend_from_slice(data);
        }
        buf.push(self.missing.len() as u8);
        for hash in &self.missing {
            buf.extend_from_slice(hash);
        }
        buf
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn test_scope() -> ScopeBinding {
        ScopeBinding::new([1u8; 32], 42, vec![0, 1, 2, 3], 52)
    }

    #[test]
    fn test_scope_binding_encode_deterministic() {
        let scope = test_scope();
        let encoded1 = scope.encode();
        let encoded2 = scope.encode();
        assert_eq!(encoded1, encoded2, "scope encoding must be deterministic");
    }

    #[test]
    fn test_deal_commitment_hash_stable() {
        let commitment = DealCommitment {
            version: ProtocolVersion::current(),
            scope: test_scope(),
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![[3u8; 32], [4u8; 32]],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![0xDE, 0xAD],
        };

        let hash1 = commitment.commitment_hash();
        let hash2 = commitment.commitment_hash();
        assert_eq!(hash1, hash2, "commitment hash must be stable");
    }

    #[test]
    fn test_deal_commitment_preimage_excludes_signature() {
        let mut commitment = DealCommitment {
            version: ProtocolVersion::current(),
            scope: test_scope(),
            shuffle_commitment: [2u8; 32],
            artifact_hashes: vec![[3u8; 32]],
            timestamp_ms: 1700000000000,
            dealer_signature: vec![0xDE, 0xAD],
        };

        let preimage1 = commitment.preimage();

        // Change signature
        commitment.dealer_signature = vec![0xBE, 0xEF, 0xCA, 0xFE];
        let preimage2 = commitment.preimage();

        assert_eq!(preimage1, preimage2, "signature must not affect preimage");
    }

    #[test]
    fn test_deal_commitment_ack_hash_stable() {
        let ack = DealCommitmentAck {
            version: ProtocolVersion::current(),
            commitment_hash: [5u8; 32],
            seat_index: 2,
            player_signature: vec![0xAB, 0xCD],
        };

        let hash1 = ack.ack_hash();
        let hash2 = ack.ack_hash();
        assert_eq!(hash1, hash2, "ack hash must be stable");
    }

    #[test]
    fn test_reveal_share_hash_stable() {
        let reveal = RevealShare {
            version: ProtocolVersion::current(),
            commitment_hash: [6u8; 32],
            phase: RevealPhase::Flop,
            card_indices: vec![0, 1, 2],
            reveal_data: vec![vec![10], vec![20], vec![30]],
            from_seat: 1,
            signature: vec![0x11, 0x22],
        };

        let hash1 = reveal.reveal_hash();
        let hash2 = reveal.reveal_hash();
        assert_eq!(hash1, hash2, "reveal hash must be stable");
    }

    #[test]
    fn test_reveal_phase_roundtrip() {
        for phase in [
            RevealPhase::Preflop,
            RevealPhase::Flop,
            RevealPhase::Turn,
            RevealPhase::River,
            RevealPhase::Showdown,
        ] {
            let byte = phase as u8;
            let decoded = RevealPhase::from_u8(byte).expect("valid phase");
            assert_eq!(decoded, phase, "phase must roundtrip");
        }
    }

    #[test]
    fn test_reveal_phase_invalid() {
        assert!(RevealPhase::from_u8(99).is_none(), "invalid phase must return None");
    }

    #[test]
    fn test_timelock_reveal_hash_stable() {
        let reveal = TimelockReveal {
            version: ProtocolVersion::current(),
            commitment_hash: [7u8; 32],
            phase: RevealPhase::Turn,
            card_indices: vec![10],
            timelock_proof: vec![0xAA, 0xBB, 0xCC],
            revealed_values: vec![vec![42]],
            timeout_seat: 3,
        };

        let hash1 = reveal.timelock_hash();
        let hash2 = reveal.timelock_hash();
        assert_eq!(hash1, hash2, "timelock hash must be stable");
    }

    #[test]
    fn test_artifact_request_preimage_deterministic() {
        let request = ArtifactRequest {
            version: ProtocolVersion::current(),
            artifact_hashes: vec![[8u8; 32], [9u8; 32]],
            commitment_hash: Some([10u8; 32]),
        };

        let preimage1 = request.preimage();
        let preimage2 = request.preimage();
        assert_eq!(preimage1, preimage2, "artifact request preimage must be deterministic");
    }

    #[test]
    fn test_artifact_response_preimage_deterministic() {
        let response = ArtifactResponse {
            version: ProtocolVersion::current(),
            artifacts: vec![([11u8; 32], vec![1, 2, 3, 4])],
            missing: vec![[12u8; 32]],
        };

        let preimage1 = response.preimage();
        let preimage2 = response.preimage();
        assert_eq!(preimage1, preimage2, "artifact response preimage must be deterministic");
    }

    #[test]
    fn test_domain_separation_prevents_collision() {
        // Same content, different domain => different hash
        let scope = test_scope();
        let _scope_bytes = scope.encode(); // Used to verify encoding works

        // Create two different message types with overlapping content patterns
        let commitment = DealCommitment {
            version: ProtocolVersion::current(),
            scope: scope.clone(),
            shuffle_commitment: [0u8; 32],
            artifact_hashes: vec![],
            timestamp_ms: 0,
            dealer_signature: vec![],
        };

        let ack = DealCommitmentAck {
            version: ProtocolVersion::current(),
            commitment_hash: [0u8; 32],
            seat_index: 0,
            player_signature: vec![],
        };

        // Even if content overlaps, domain prefixes ensure different hashes
        let commitment_preimage = commitment.preimage();
        let ack_preimage = ack.preimage();

        assert!(
            commitment_preimage.starts_with(domain::DEAL_COMMITMENT),
            "commitment must use its domain"
        );
        assert!(
            ack_preimage.starts_with(domain::DEAL_COMMITMENT_ACK),
            "ack must use its domain"
        );
        assert_ne!(
            commitment_preimage[..domain::DEAL_COMMITMENT.len()],
            ack_preimage[..domain::DEAL_COMMITMENT_ACK.len()],
            "domains must differ"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ShuffleContext Tests
    // ─────────────────────────────────────────────────────────────────────────

    fn test_shuffle_context() -> ShuffleContext {
        ShuffleContext::new(
            ProtocolVersion::current(),
            [1u8; 32],
            42,
            vec![0, 1, 2, 3],
            52,
        )
    }

    #[test]
    fn test_shuffle_context_hash_stable() {
        let ctx = test_shuffle_context();
        let hash1 = ctx.context_hash();
        let hash2 = ctx.context_hash();
        assert_eq!(hash1, hash2, "shuffle context hash must be stable");
    }

    #[test]
    fn test_shuffle_context_preimage_deterministic() {
        let ctx = test_shuffle_context();
        let preimage1 = ctx.preimage();
        let preimage2 = ctx.preimage();
        assert_eq!(preimage1, preimage2, "shuffle context preimage must be deterministic");
    }

    #[test]
    fn test_shuffle_context_includes_domain_prefix() {
        let ctx = test_shuffle_context();
        let preimage = ctx.preimage();
        assert!(
            preimage.starts_with(domain::SHUFFLE_CONTEXT),
            "shuffle context must use its domain prefix"
        );
    }

    #[test]
    fn test_shuffle_context_from_scope() {
        let scope = test_scope();
        let ctx = ShuffleContext::from_scope(ProtocolVersion::current(), &scope);

        assert_eq!(ctx.table_id, scope.table_id);
        assert_eq!(ctx.hand_id, scope.hand_id);
        assert_eq!(ctx.seat_order, scope.seat_order);
        assert_eq!(ctx.deck_length, scope.deck_length);
    }

    #[test]
    fn test_shuffle_context_to_scope() {
        let ctx = test_shuffle_context();
        let scope = ctx.to_scope();

        assert_eq!(scope.table_id, ctx.table_id);
        assert_eq!(scope.hand_id, ctx.hand_id);
        assert_eq!(scope.seat_order, ctx.seat_order);
        assert_eq!(scope.deck_length, ctx.deck_length);
    }

    #[test]
    fn test_shuffle_context_roundtrip_scope() {
        let original_scope = test_scope();
        let ctx = ShuffleContext::from_scope(ProtocolVersion::current(), &original_scope);
        let recovered_scope = ctx.to_scope();
        assert_eq!(original_scope, recovered_scope, "scope must roundtrip through shuffle context");
    }

    #[test]
    fn test_shuffle_context_hash_changes_with_table_id() {
        let ctx1 = test_shuffle_context();
        let mut ctx2 = test_shuffle_context();
        ctx2.table_id = [2u8; 32];

        assert_ne!(
            ctx1.context_hash(),
            ctx2.context_hash(),
            "different table_id must produce different hash"
        );
    }

    #[test]
    fn test_shuffle_context_hash_changes_with_hand_id() {
        let ctx1 = test_shuffle_context();
        let mut ctx2 = test_shuffle_context();
        ctx2.hand_id = 999;

        assert_ne!(
            ctx1.context_hash(),
            ctx2.context_hash(),
            "different hand_id must produce different hash"
        );
    }

    #[test]
    fn test_shuffle_context_hash_changes_with_seat_order() {
        let ctx1 = test_shuffle_context();
        let mut ctx2 = test_shuffle_context();
        ctx2.seat_order = vec![3, 2, 1, 0]; // reversed

        assert_ne!(
            ctx1.context_hash(),
            ctx2.context_hash(),
            "different seat_order must produce different hash"
        );
    }

    #[test]
    fn test_shuffle_context_hash_changes_with_deck_length() {
        let ctx1 = test_shuffle_context();
        let mut ctx2 = test_shuffle_context();
        ctx2.deck_length = 36; // short deck

        assert_ne!(
            ctx1.context_hash(),
            ctx2.context_hash(),
            "different deck_length must produce different hash"
        );
    }

    #[test]
    fn test_shuffle_context_verify_matches_success() {
        let ctx1 = test_shuffle_context();
        let ctx2 = test_shuffle_context();

        assert!(ctx1.verify_matches(&ctx2).is_ok(), "identical contexts must match");
    }

    #[test]
    fn test_shuffle_context_verify_matches_version_mismatch() {
        let ctx1 = test_shuffle_context();
        let mut ctx2 = test_shuffle_context();
        ctx2.version = ProtocolVersion::new(99);

        let result = ctx1.verify_matches(&ctx2);
        assert!(matches!(
            result,
            Err(ShuffleContextMismatch::Version { expected: 1, got: 99 })
        ));
    }

    #[test]
    fn test_shuffle_context_verify_matches_table_id_mismatch() {
        let ctx1 = test_shuffle_context();
        let mut ctx2 = test_shuffle_context();
        ctx2.table_id = [99u8; 32];

        let result = ctx1.verify_matches(&ctx2);
        assert!(matches!(
            result,
            Err(ShuffleContextMismatch::TableId { .. })
        ));
    }

    #[test]
    fn test_shuffle_context_verify_matches_hand_id_mismatch() {
        let ctx1 = test_shuffle_context();
        let mut ctx2 = test_shuffle_context();
        ctx2.hand_id = 999;

        let result = ctx1.verify_matches(&ctx2);
        assert!(matches!(
            result,
            Err(ShuffleContextMismatch::HandId { expected: 42, got: 999 })
        ));
    }

    #[test]
    fn test_shuffle_context_verify_matches_seat_order_mismatch() {
        let ctx1 = test_shuffle_context();
        let mut ctx2 = test_shuffle_context();
        ctx2.seat_order = vec![0, 1]; // fewer seats

        let result = ctx1.verify_matches(&ctx2);
        assert!(matches!(
            result,
            Err(ShuffleContextMismatch::SeatOrder { .. })
        ));
    }

    #[test]
    fn test_shuffle_context_verify_matches_deck_length_mismatch() {
        let ctx1 = test_shuffle_context();
        let mut ctx2 = test_shuffle_context();
        ctx2.deck_length = 36;

        let result = ctx1.verify_matches(&ctx2);
        assert!(matches!(
            result,
            Err(ShuffleContextMismatch::DeckLength { expected: 52, got: 36 })
        ));
    }

    #[test]
    fn test_shuffle_context_mismatch_display() {
        let err = ShuffleContextMismatch::Version { expected: 1, got: 2 };
        assert!(err.to_string().contains("version mismatch"));

        let err = ShuffleContextMismatch::HandId { expected: 42, got: 99 };
        assert!(err.to_string().contains("hand_id mismatch"));

        let err = ShuffleContextMismatch::DeckLength { expected: 52, got: 36 };
        assert!(err.to_string().contains("deck_length mismatch"));
    }

    #[test]
    fn test_shuffle_context_domain_differs_from_others() {
        // Ensure shuffle context domain is distinct from other domains
        assert_ne!(domain::SHUFFLE_CONTEXT, domain::DEAL_COMMITMENT);
        assert_ne!(domain::SHUFFLE_CONTEXT, domain::DEAL_COMMITMENT_ACK);
        assert_ne!(domain::SHUFFLE_CONTEXT, domain::REVEAL_SHARE);
        assert_ne!(domain::SHUFFLE_CONTEXT, domain::TIMELOCK_REVEAL);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DealCommitment::verify_context Tests
    // ─────────────────────────────────────────────────────────────────────────

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
    fn test_deal_commitment_verify_context_success() {
        let commitment = test_deal_commitment();
        let expected = test_shuffle_context();

        assert!(
            commitment.verify_context(&expected).is_ok(),
            "verification must succeed for matching context"
        );
    }

    #[test]
    fn test_deal_commitment_verify_context_rejects_table_id_mismatch() {
        let commitment = test_deal_commitment();
        let mut expected = test_shuffle_context();
        expected.table_id = [99u8; 32]; // different table

        let result = commitment.verify_context(&expected);
        assert!(
            matches!(result, Err(ShuffleContextMismatch::TableId { .. })),
            "verification must reject table_id mismatch"
        );
    }

    #[test]
    fn test_deal_commitment_verify_context_rejects_hand_id_mismatch() {
        let commitment = test_deal_commitment();
        let mut expected = test_shuffle_context();
        expected.hand_id = 999; // different hand

        let result = commitment.verify_context(&expected);
        // expected is from the parameter (999), got is from the commitment (42)
        assert!(
            matches!(
                result,
                Err(ShuffleContextMismatch::HandId { expected: 999, got: 42 })
            ),
            "verification must reject hand_id mismatch"
        );
    }

    #[test]
    fn test_deal_commitment_verify_context_rejects_seat_order_mismatch() {
        let commitment = test_deal_commitment();
        let mut expected = test_shuffle_context();
        expected.seat_order = vec![0, 1]; // different seats

        let result = commitment.verify_context(&expected);
        assert!(
            matches!(result, Err(ShuffleContextMismatch::SeatOrder { .. })),
            "verification must reject seat_order mismatch"
        );
    }

    #[test]
    fn test_deal_commitment_verify_context_rejects_deck_length_mismatch() {
        let commitment = test_deal_commitment();
        let mut expected = test_shuffle_context();
        expected.deck_length = 36; // short deck

        let result = commitment.verify_context(&expected);
        // expected is from the parameter (36), got is from the commitment (52)
        assert!(
            matches!(
                result,
                Err(ShuffleContextMismatch::DeckLength { expected: 36, got: 52 })
            ),
            "verification must reject deck_length mismatch"
        );
    }

    #[test]
    fn test_deal_commitment_verify_context_rejects_version_mismatch() {
        let commitment = test_deal_commitment();
        let mut expected = test_shuffle_context();
        expected.version = ProtocolVersion::new(99); // different version

        let result = commitment.verify_context(&expected);
        // expected is from the parameter (99), got is from the commitment (1)
        assert!(
            matches!(
                result,
                Err(ShuffleContextMismatch::Version { expected: 99, got: 1 })
            ),
            "verification must reject version mismatch"
        );
    }

    #[test]
    fn test_deal_commitment_verify_context_with_different_commitment_contents() {
        // Verify that the context comparison is independent of other commitment fields
        let mut commitment = test_deal_commitment();
        commitment.shuffle_commitment = [0xFF; 32];
        commitment.artifact_hashes = vec![[0xAA; 32], [0xBB; 32], [0xCC; 32]];
        commitment.timestamp_ms = 9999999999999;
        commitment.dealer_signature = vec![0x11, 0x22, 0x33, 0x44, 0x55];

        let expected = test_shuffle_context();

        assert!(
            commitment.verify_context(&expected).is_ok(),
            "context verification must succeed regardless of other commitment fields"
        );
    }
}
