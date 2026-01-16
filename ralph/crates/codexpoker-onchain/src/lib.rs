//! CodexPoker onchain consensus types.
//!
//! This crate provides the consensus payload schema and related types for
//! CodexPoker's onchain state machine. It builds on [`protocol_messages`]
//! to provide the wrapper types needed by the consensus layer.
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                    Consensus Layer                          │
//! │  ┌─────────────────────────────────────────────────────┐   │
//! │  │              ConsensusPayload                        │   │
//! │  │  ┌───────────────┬───────────────┬──────────────┐   │   │
//! │  │  │DealCommitment │ GameAction    │ RevealShare  │   │   │
//! │  │  │               │ (bound to DC) │ (bound to DC)│   │   │
//! │  │  └───────────────┴───────────────┴──────────────┘   │   │
//! │  └─────────────────────────────────────────────────────┘   │
//! │                         ▲                                   │
//! │                         │ wraps                             │
//! │  ┌─────────────────────────────────────────────────────┐   │
//! │  │              protocol_messages                       │   │
//! │  │  (canonical encodings, domain separation, hashing)   │   │
//! │  └─────────────────────────────────────────────────────┘   │
//! └─────────────────────────────────────────────────────────────┘
//! ```
//!
//! # Deal Commitment Binding
//!
//! The key security property enforced by this crate is **commitment binding**:
//!
//! 1. Every hand begins with a `DealCommitment` payload
//! 2. The commitment hash is computed from the deal parameters
//! 3. All subsequent actions (`GameAction`) include this hash in their signature
//! 4. All reveals (`RevealShare`, `TimelockReveal`) reference this hash
//!
//! This ensures that:
//! - Actions cannot be replayed across different deals
//! - If the deal is tampered, all signatures become invalid
//! - Verification is fully deterministic
//!
//! # Usage
//!
//! ```
//! use codexpoker_onchain::{ConsensusPayload, GameActionMessage, action_codes};
//! use protocol_messages::{DealCommitment, ProtocolVersion, ScopeBinding};
//!
//! // First, dealer broadcasts deal commitment
//! let scope = ScopeBinding::new([1u8; 32], 1, vec![0, 1], 52);
//! let deal = DealCommitment {
//!     version: ProtocolVersion::current(),
//!     scope,
//!     shuffle_commitment: [2u8; 32],
//!     artifact_hashes: vec![],
//!     timestamp_ms: 1700000000000,
//!     dealer_signature: vec![],
//! };
//! let commitment_hash = deal.commitment_hash();
//! let payload = ConsensusPayload::DealCommitment(deal);
//!
//! // Then, player actions reference the commitment
//! let action = GameActionMessage {
//!     version: ProtocolVersion::current(),
//!     deal_commitment_hash: commitment_hash,
//!     seat_index: 0,
//!     action_type: action_codes::BET,
//!     amount: 100,
//!     sequence: 1,
//!     signature: vec![],
//! };
//! let action_payload = ConsensusPayload::GameAction(action);
//!
//! // Verify binding is correct
//! assert_eq!(
//!     payload.referenced_commitment_hash(),
//!     action_payload.referenced_commitment_hash()
//! );
//! ```

pub mod artifact_registry;
pub mod block;
pub mod consensus;
pub mod messages;

pub use artifact_registry::{
    ArtifactMetadata, ArtifactRegistry, ArtifactRegistryError, ArtifactType, AuditEntry,
    AuditEventType, AuditLog, AuditedArtifactRegistry, BackfillResult, InMemoryArtifactRegistry,
    InMemoryAuditLog, RegistryConfig, DEFAULT_MAX_ARTIFACT_SIZE, DEFAULT_MAX_TOTAL_SIZE,
};
pub use block::{
    compute_receipts_root, Block, BlockBody, BlockHeader, Receipt, MAX_RECEIPT_ERROR_LEN,
};
pub use consensus::{Automaton, AutomatonError, Digest, Finalization, Marshal};
pub use messages::{
    action_codes, ActionLogValidator, ConsensusPayload, GameActionMessage, NoOpTimelockVerifier,
    PayloadError, TimelockProofVerifier, TimelockVerificationInput, GAME_ACTION_DOMAIN, REVEAL_TTL,
};

// Re-export core protocol types for convenience
pub use protocol_messages::{
    DealCommitment, DealCommitmentAck, ProtocolVersion, RevealPhase, RevealShare, ScopeBinding,
    ShuffleContext, ShuffleContextMismatch, TimelockReveal, CURRENT_PROTOCOL_VERSION,
};
