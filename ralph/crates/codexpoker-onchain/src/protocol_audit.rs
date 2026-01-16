//! Protocol-level structured audit logging for deal lifecycle events.
//!
//! This module provides structured audit logging for the deal commitment,
//! reveal, and timelock lifecycle. These logs enable:
//!
//! 1. **Operational visibility**: Track the flow of commitments and reveals
//! 2. **Security monitoring**: Detect anomalies like timelock usage patterns
//! 3. **Forensic analysis**: Reconstruct deal history for dispute resolution
//! 4. **Performance monitoring**: Track reveal latencies and timeouts
//!
//! # Event Types
//!
//! The [`ProtocolAuditEvent`] enum covers the full deal lifecycle:
//!
//! - **Commitment phase**: `CommitmentReceived`, `CommitmentAckReceived`, `AllAcksReceived`
//! - **Reveal phase**: `RevealShareReceived`, `RevealPhaseEntered`, `RevealPhaseCompleted`
//! - **Timelock fallback**: `TimelockRevealReceived`, `TimelockTimeout`
//! - **Errors**: `CommitmentRejected`, `RevealRejected`, `TimelockRejected`
//!
//! # Usage
//!
//! ```
//! use codexpoker_onchain::protocol_audit::{
//!     ProtocolAuditEvent, ProtocolAuditEntry, ProtocolAuditLog, InMemoryProtocolAuditLog,
//! };
//! use protocol_messages::RevealPhase;
//!
//! let mut log = InMemoryProtocolAuditLog::new();
//!
//! // Record a commitment
//! log.record(ProtocolAuditEntry::new(
//!     1000,
//!     ProtocolAuditEvent::CommitmentReceived {
//!         commitment_hash: [1u8; 32],
//!         table_id: [2u8; 32],
//!         hand_id: 1,
//!         seat_count: 2,
//!     },
//! ));
//!
//! // Later, record a timelock usage
//! log.record(ProtocolAuditEntry::new(
//!     5000,
//!     ProtocolAuditEvent::TimelockRevealReceived {
//!         commitment_hash: [1u8; 32],
//!         phase: RevealPhase::Flop,
//!         timeout_seat: 0,
//!         elapsed_ms: 31000,
//!     },
//! ));
//!
//! // Query timelock events for monitoring
//! let timelocks = log.timelock_events();
//! assert_eq!(timelocks.len(), 1);
//! ```
//!
//! # Integration
//!
//! The audit log integrates with the [`ActionLogValidator`](crate::ActionLogValidator)
//! to automatically record events as payloads are processed. Use
//! [`AuditedActionLogValidator`] to wrap a validator with audit logging.

use protocol_messages::RevealPhase;
use serde::{Deserialize, Serialize};

// ─────────────────────────────────────────────────────────────────────────────
// Protocol Audit Events
// ─────────────────────────────────────────────────────────────────────────────

/// Classification of protocol-level audit events.
///
/// These events track the deal commitment, reveal, and timelock lifecycle.
/// Each event captures the essential information for operational monitoring
/// and forensic analysis.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum ProtocolAuditEvent {
    // ─────────────────────────────────────────────────────────────────────────
    // Commitment Phase
    // ─────────────────────────────────────────────────────────────────────────
    /// A deal commitment was received and accepted.
    CommitmentReceived {
        /// Hash of the deal commitment.
        commitment_hash: [u8; 32],
        /// Table identifier from the scope.
        table_id: [u8; 32],
        /// Hand number.
        hand_id: u64,
        /// Number of seats in the deal.
        seat_count: usize,
    },

    /// A deal commitment was rejected.
    CommitmentRejected {
        /// Computed hash of the rejected commitment.
        commitment_hash: [u8; 32],
        /// Reason for rejection.
        reason: String,
    },

    /// A deal commitment acknowledgment was received.
    CommitmentAckReceived {
        /// Hash of the commitment being acknowledged.
        commitment_hash: [u8; 32],
        /// Seat that sent the ack.
        seat: u8,
        /// Number of acks received so far.
        acks_received: usize,
        /// Total acks required.
        acks_required: usize,
    },

    /// All required acks have been received for a commitment.
    AllAcksReceived {
        /// Hash of the commitment.
        commitment_hash: [u8; 32],
        /// Time from commitment to all acks (milliseconds).
        elapsed_ms: u64,
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Reveal Phase
    // ─────────────────────────────────────────────────────────────────────────
    /// Entered a reveal-only phase (awaiting card reveal).
    RevealPhaseEntered {
        /// Hash of the commitment.
        commitment_hash: [u8; 32],
        /// Phase being entered.
        phase: RevealPhase,
        /// Seat expected to provide the reveal.
        expected_seat: u8,
    },

    /// A reveal share was received and accepted.
    RevealShareReceived {
        /// Hash of the commitment.
        commitment_hash: [u8; 32],
        /// Phase being revealed.
        phase: RevealPhase,
        /// Seat that provided the reveal.
        from_seat: u8,
        /// Number of cards revealed.
        card_count: usize,
        /// Time from entering reveal phase to receiving reveal (milliseconds).
        /// None if reveal was received before entering reveal-only phase.
        latency_ms: Option<u64>,
    },

    /// A reveal share was rejected.
    RevealRejected {
        /// Hash of the commitment.
        commitment_hash: [u8; 32],
        /// Phase the reveal was for.
        phase: RevealPhase,
        /// Seat that sent the reveal.
        from_seat: u8,
        /// Reason for rejection.
        reason: String,
    },

    /// A reveal phase was completed successfully.
    RevealPhaseCompleted {
        /// Hash of the commitment.
        commitment_hash: [u8; 32],
        /// Phase that was completed.
        phase: RevealPhase,
        /// Whether this was via timelock fallback.
        via_timelock: bool,
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Timelock Events
    // ─────────────────────────────────────────────────────────────────────────
    /// A timelock reveal was received and accepted.
    TimelockRevealReceived {
        /// Hash of the commitment.
        commitment_hash: [u8; 32],
        /// Phase being revealed.
        phase: RevealPhase,
        /// Seat that timed out (blamed for the fallback).
        timeout_seat: u8,
        /// Time from entering reveal phase to timelock (milliseconds).
        elapsed_ms: u64,
    },

    /// A timelock reveal was rejected.
    TimelockRejected {
        /// Hash of the commitment.
        commitment_hash: [u8; 32],
        /// Phase the timelock was for.
        phase: RevealPhase,
        /// Seat blamed for timeout.
        timeout_seat: u8,
        /// Reason for rejection.
        reason: String,
    },

    /// A reveal phase timed out (REVEAL_TTL expired).
    ///
    /// This is logged when the timeout is detected, before a timelock
    /// reveal is received. It alerts operators to a potential griefing
    /// situation.
    TimelockTimeout {
        /// Hash of the commitment.
        commitment_hash: [u8; 32],
        /// Phase that timed out.
        phase: RevealPhase,
        /// Seat that failed to reveal in time.
        timeout_seat: u8,
        /// Configured TTL that expired.
        ttl_ms: u64,
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Hand Lifecycle
    // ─────────────────────────────────────────────────────────────────────────
    /// A hand has been fully completed (showdown or all folded).
    HandCompleted {
        /// Hash of the commitment.
        commitment_hash: [u8; 32],
        /// Total duration from commitment to completion (milliseconds).
        duration_ms: u64,
        /// Number of timelock fallbacks used during this hand.
        timelock_count: u32,
        /// Final phase reached (Preflop if folded early, Showdown if complete).
        final_phase: RevealPhase,
    },
}

impl ProtocolAuditEvent {
    /// Returns the event type name for logging/metrics.
    pub fn event_type(&self) -> &'static str {
        match self {
            ProtocolAuditEvent::CommitmentReceived { .. } => "commitment_received",
            ProtocolAuditEvent::CommitmentRejected { .. } => "commitment_rejected",
            ProtocolAuditEvent::CommitmentAckReceived { .. } => "commitment_ack_received",
            ProtocolAuditEvent::AllAcksReceived { .. } => "all_acks_received",
            ProtocolAuditEvent::RevealPhaseEntered { .. } => "reveal_phase_entered",
            ProtocolAuditEvent::RevealShareReceived { .. } => "reveal_share_received",
            ProtocolAuditEvent::RevealRejected { .. } => "reveal_rejected",
            ProtocolAuditEvent::RevealPhaseCompleted { .. } => "reveal_phase_completed",
            ProtocolAuditEvent::TimelockRevealReceived { .. } => "timelock_reveal_received",
            ProtocolAuditEvent::TimelockRejected { .. } => "timelock_rejected",
            ProtocolAuditEvent::TimelockTimeout { .. } => "timelock_timeout",
            ProtocolAuditEvent::HandCompleted { .. } => "hand_completed",
        }
    }

    /// Returns the commitment hash associated with this event.
    pub fn commitment_hash(&self) -> [u8; 32] {
        match self {
            ProtocolAuditEvent::CommitmentReceived { commitment_hash, .. }
            | ProtocolAuditEvent::CommitmentRejected { commitment_hash, .. }
            | ProtocolAuditEvent::CommitmentAckReceived { commitment_hash, .. }
            | ProtocolAuditEvent::AllAcksReceived { commitment_hash, .. }
            | ProtocolAuditEvent::RevealPhaseEntered { commitment_hash, .. }
            | ProtocolAuditEvent::RevealShareReceived { commitment_hash, .. }
            | ProtocolAuditEvent::RevealRejected { commitment_hash, .. }
            | ProtocolAuditEvent::RevealPhaseCompleted { commitment_hash, .. }
            | ProtocolAuditEvent::TimelockRevealReceived { commitment_hash, .. }
            | ProtocolAuditEvent::TimelockRejected { commitment_hash, .. }
            | ProtocolAuditEvent::TimelockTimeout { commitment_hash, .. }
            | ProtocolAuditEvent::HandCompleted { commitment_hash, .. } => *commitment_hash,
        }
    }

    /// Returns true if this is a timelock-related event.
    pub fn is_timelock_event(&self) -> bool {
        matches!(
            self,
            ProtocolAuditEvent::TimelockRevealReceived { .. }
                | ProtocolAuditEvent::TimelockRejected { .. }
                | ProtocolAuditEvent::TimelockTimeout { .. }
        )
    }

    /// Returns true if this is an error/rejection event.
    pub fn is_error_event(&self) -> bool {
        matches!(
            self,
            ProtocolAuditEvent::CommitmentRejected { .. }
                | ProtocolAuditEvent::RevealRejected { .. }
                | ProtocolAuditEvent::TimelockRejected { .. }
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit Entry
// ─────────────────────────────────────────────────────────────────────────────

/// A structured audit log entry for protocol events.
///
/// Each entry captures:
/// - Timestamp when the event occurred
/// - The event details
/// - Optional additional context (e.g., validator node ID)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtocolAuditEntry {
    /// Unix timestamp (milliseconds) when the event occurred.
    pub timestamp_ms: u64,
    /// The audit event.
    pub event: ProtocolAuditEvent,
    /// Optional node identifier for distributed debugging.
    pub node_id: Option<String>,
}

impl ProtocolAuditEntry {
    /// Create a new audit entry with just timestamp and event.
    pub fn new(timestamp_ms: u64, event: ProtocolAuditEvent) -> Self {
        Self {
            timestamp_ms,
            event,
            node_id: None,
        }
    }

    /// Set the node identifier.
    pub fn with_node_id(mut self, node_id: &str) -> Self {
        self.node_id = Some(node_id.to_string());
        self
    }

    /// Returns the event type name.
    pub fn event_type(&self) -> &'static str {
        self.event.event_type()
    }

    /// Returns the commitment hash for this entry.
    pub fn commitment_hash(&self) -> [u8; 32] {
        self.event.commitment_hash()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit Log Trait
// ─────────────────────────────────────────────────────────────────────────────

/// Trait for protocol audit log storage.
///
/// Implementations may store logs in memory, write to disk, send to a
/// logging service, or export to metrics systems.
pub trait ProtocolAuditLog: Send + Sync {
    /// Record an audit entry.
    fn record(&mut self, entry: ProtocolAuditEntry);

    /// Get the number of recorded entries.
    fn len(&self) -> usize;

    /// Check if the log is empty.
    fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Get all entries (for testing/inspection).
    fn entries(&self) -> &[ProtocolAuditEntry];

    /// Get entries for a specific commitment hash.
    fn entries_for_commitment(&self, commitment_hash: &[u8; 32]) -> Vec<&ProtocolAuditEntry>;

    /// Get all timelock-related events.
    fn timelock_events(&self) -> Vec<&ProtocolAuditEntry>;

    /// Get all error/rejection events.
    fn error_events(&self) -> Vec<&ProtocolAuditEntry>;

    /// Get entries in a time range (inclusive).
    fn entries_in_range(&self, start_ms: u64, end_ms: u64) -> Vec<&ProtocolAuditEntry>;

    /// Clear all entries (primarily for testing).
    fn clear(&mut self);
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Implementation
// ─────────────────────────────────────────────────────────────────────────────

/// In-memory protocol audit log implementation.
///
/// Stores audit entries in a vector, suitable for testing and short-lived
/// processes. For production, consider a persistent or streaming implementation.
#[derive(Debug, Default)]
pub struct InMemoryProtocolAuditLog {
    entries: Vec<ProtocolAuditEntry>,
    /// Maximum entries to retain (0 = unlimited).
    max_entries: usize,
}

impl InMemoryProtocolAuditLog {
    /// Create a new in-memory audit log with no entry limit.
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            max_entries: 0,
        }
    }

    /// Create a new in-memory audit log with a maximum entry limit.
    ///
    /// When the limit is reached, oldest entries are evicted (FIFO).
    pub fn with_max_entries(max_entries: usize) -> Self {
        Self {
            entries: Vec::new(),
            max_entries,
        }
    }

    /// Get entries filtered by event type name.
    pub fn entries_by_type(&self, event_type: &str) -> Vec<&ProtocolAuditEntry> {
        self.entries
            .iter()
            .filter(|e| e.event_type() == event_type)
            .collect()
    }

    /// Count events by type (for metrics).
    pub fn count_by_type(&self) -> std::collections::HashMap<&'static str, usize> {
        let mut counts = std::collections::HashMap::new();
        for entry in &self.entries {
            *counts.entry(entry.event_type()).or_insert(0) += 1;
        }
        counts
    }
}

impl ProtocolAuditLog for InMemoryProtocolAuditLog {
    fn record(&mut self, entry: ProtocolAuditEntry) {
        if self.max_entries > 0 && self.entries.len() >= self.max_entries {
            self.entries.remove(0);
        }
        self.entries.push(entry);
    }

    fn len(&self) -> usize {
        self.entries.len()
    }

    fn entries(&self) -> &[ProtocolAuditEntry] {
        &self.entries
    }

    fn entries_for_commitment(&self, commitment_hash: &[u8; 32]) -> Vec<&ProtocolAuditEntry> {
        self.entries
            .iter()
            .filter(|e| &e.commitment_hash() == commitment_hash)
            .collect()
    }

    fn timelock_events(&self) -> Vec<&ProtocolAuditEntry> {
        self.entries
            .iter()
            .filter(|e| e.event.is_timelock_event())
            .collect()
    }

    fn error_events(&self) -> Vec<&ProtocolAuditEntry> {
        self.entries
            .iter()
            .filter(|e| e.event.is_error_event())
            .collect()
    }

    fn entries_in_range(&self, start_ms: u64, end_ms: u64) -> Vec<&ProtocolAuditEntry> {
        self.entries
            .iter()
            .filter(|e| e.timestamp_ms >= start_ms && e.timestamp_ms <= end_ms)
            .collect()
    }

    fn clear(&mut self) {
        self.entries.clear();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_type_names() {
        let event = ProtocolAuditEvent::CommitmentReceived {
            commitment_hash: [0u8; 32],
            table_id: [0u8; 32],
            hand_id: 1,
            seat_count: 2,
        };
        assert_eq!(event.event_type(), "commitment_received");

        let event = ProtocolAuditEvent::TimelockRevealReceived {
            commitment_hash: [0u8; 32],
            phase: RevealPhase::Flop,
            timeout_seat: 0,
            elapsed_ms: 31000,
        };
        assert_eq!(event.event_type(), "timelock_reveal_received");
    }

    #[test]
    fn test_commitment_hash_extraction() {
        let hash = [42u8; 32];
        let event = ProtocolAuditEvent::RevealShareReceived {
            commitment_hash: hash,
            phase: RevealPhase::Turn,
            from_seat: 1,
            card_count: 1,
            latency_ms: Some(500),
        };
        assert_eq!(event.commitment_hash(), hash);
    }

    #[test]
    fn test_is_timelock_event() {
        assert!(ProtocolAuditEvent::TimelockRevealReceived {
            commitment_hash: [0u8; 32],
            phase: RevealPhase::River,
            timeout_seat: 0,
            elapsed_ms: 31000,
        }
        .is_timelock_event());

        assert!(ProtocolAuditEvent::TimelockTimeout {
            commitment_hash: [0u8; 32],
            phase: RevealPhase::Flop,
            timeout_seat: 1,
            ttl_ms: 30000,
        }
        .is_timelock_event());

        assert!(!ProtocolAuditEvent::RevealShareReceived {
            commitment_hash: [0u8; 32],
            phase: RevealPhase::Flop,
            from_seat: 0,
            card_count: 3,
            latency_ms: None,
        }
        .is_timelock_event());
    }

    #[test]
    fn test_is_error_event() {
        assert!(ProtocolAuditEvent::CommitmentRejected {
            commitment_hash: [0u8; 32],
            reason: "test".to_string(),
        }
        .is_error_event());

        assert!(ProtocolAuditEvent::RevealRejected {
            commitment_hash: [0u8; 32],
            phase: RevealPhase::Flop,
            from_seat: 0,
            reason: "test".to_string(),
        }
        .is_error_event());

        assert!(!ProtocolAuditEvent::RevealShareReceived {
            commitment_hash: [0u8; 32],
            phase: RevealPhase::Flop,
            from_seat: 0,
            card_count: 3,
            latency_ms: None,
        }
        .is_error_event());
    }

    #[test]
    fn test_audit_entry_builder() {
        let entry = ProtocolAuditEntry::new(
            1000,
            ProtocolAuditEvent::CommitmentReceived {
                commitment_hash: [1u8; 32],
                table_id: [2u8; 32],
                hand_id: 5,
                seat_count: 4,
            },
        )
        .with_node_id("validator-1");

        assert_eq!(entry.timestamp_ms, 1000);
        assert_eq!(entry.event_type(), "commitment_received");
        assert_eq!(entry.node_id, Some("validator-1".to_string()));
        assert_eq!(entry.commitment_hash(), [1u8; 32]);
    }

    #[test]
    fn test_in_memory_log_record_and_retrieve() {
        let mut log = InMemoryProtocolAuditLog::new();

        assert!(log.is_empty());
        assert_eq!(log.len(), 0);

        log.record(ProtocolAuditEntry::new(
            1,
            ProtocolAuditEvent::CommitmentReceived {
                commitment_hash: [1u8; 32],
                table_id: [0u8; 32],
                hand_id: 1,
                seat_count: 2,
            },
        ));
        log.record(ProtocolAuditEntry::new(
            2,
            ProtocolAuditEvent::RevealShareReceived {
                commitment_hash: [1u8; 32],
                phase: RevealPhase::Preflop,
                from_seat: 0,
                card_count: 2,
                latency_ms: None,
            },
        ));

        assert!(!log.is_empty());
        assert_eq!(log.len(), 2);
        assert_eq!(log.entries().len(), 2);
    }

    #[test]
    fn test_in_memory_log_filter_by_commitment() {
        let mut log = InMemoryProtocolAuditLog::new();
        let hash1 = [1u8; 32];
        let hash2 = [2u8; 32];

        log.record(ProtocolAuditEntry::new(
            1,
            ProtocolAuditEvent::CommitmentReceived {
                commitment_hash: hash1,
                table_id: [0u8; 32],
                hand_id: 1,
                seat_count: 2,
            },
        ));
        log.record(ProtocolAuditEntry::new(
            2,
            ProtocolAuditEvent::CommitmentReceived {
                commitment_hash: hash2,
                table_id: [0u8; 32],
                hand_id: 2,
                seat_count: 2,
            },
        ));
        log.record(ProtocolAuditEntry::new(
            3,
            ProtocolAuditEvent::RevealShareReceived {
                commitment_hash: hash1,
                phase: RevealPhase::Flop,
                from_seat: 0,
                card_count: 3,
                latency_ms: Some(100),
            },
        ));

        let hash1_entries = log.entries_for_commitment(&hash1);
        assert_eq!(hash1_entries.len(), 2);

        let hash2_entries = log.entries_for_commitment(&hash2);
        assert_eq!(hash2_entries.len(), 1);
    }

    #[test]
    fn test_in_memory_log_timelock_events() {
        let mut log = InMemoryProtocolAuditLog::new();

        log.record(ProtocolAuditEntry::new(
            1,
            ProtocolAuditEvent::RevealShareReceived {
                commitment_hash: [0u8; 32],
                phase: RevealPhase::Flop,
                from_seat: 0,
                card_count: 3,
                latency_ms: None,
            },
        ));
        log.record(ProtocolAuditEntry::new(
            2,
            ProtocolAuditEvent::TimelockTimeout {
                commitment_hash: [0u8; 32],
                phase: RevealPhase::Turn,
                timeout_seat: 1,
                ttl_ms: 30000,
            },
        ));
        log.record(ProtocolAuditEntry::new(
            3,
            ProtocolAuditEvent::TimelockRevealReceived {
                commitment_hash: [0u8; 32],
                phase: RevealPhase::Turn,
                timeout_seat: 1,
                elapsed_ms: 31000,
            },
        ));

        let timelocks = log.timelock_events();
        assert_eq!(timelocks.len(), 2);
    }

    #[test]
    fn test_in_memory_log_error_events() {
        let mut log = InMemoryProtocolAuditLog::new();

        log.record(ProtocolAuditEntry::new(
            1,
            ProtocolAuditEvent::CommitmentReceived {
                commitment_hash: [0u8; 32],
                table_id: [0u8; 32],
                hand_id: 1,
                seat_count: 2,
            },
        ));
        log.record(ProtocolAuditEntry::new(
            2,
            ProtocolAuditEvent::CommitmentRejected {
                commitment_hash: [1u8; 32],
                reason: "invalid scope".to_string(),
            },
        ));
        log.record(ProtocolAuditEntry::new(
            3,
            ProtocolAuditEvent::RevealRejected {
                commitment_hash: [0u8; 32],
                phase: RevealPhase::Flop,
                from_seat: 0,
                reason: "out of order".to_string(),
            },
        ));

        let errors = log.error_events();
        assert_eq!(errors.len(), 2);
    }

    #[test]
    fn test_in_memory_log_max_entries() {
        let mut log = InMemoryProtocolAuditLog::with_max_entries(3);

        for i in 0..5 {
            log.record(ProtocolAuditEntry::new(
                i as u64,
                ProtocolAuditEvent::CommitmentReceived {
                    commitment_hash: [i as u8; 32],
                    table_id: [0u8; 32],
                    hand_id: i as u64,
                    seat_count: 2,
                },
            ));
        }

        assert_eq!(log.len(), 3);
        // Oldest entries should be evicted
        assert_eq!(log.entries()[0].timestamp_ms, 2);
        assert_eq!(log.entries()[2].timestamp_ms, 4);
    }

    #[test]
    fn test_in_memory_log_entries_in_range() {
        let mut log = InMemoryProtocolAuditLog::new();

        for i in 0..10 {
            log.record(ProtocolAuditEntry::new(
                i * 100,
                ProtocolAuditEvent::CommitmentReceived {
                    commitment_hash: [i as u8; 32],
                    table_id: [0u8; 32],
                    hand_id: i as u64,
                    seat_count: 2,
                },
            ));
        }

        let range = log.entries_in_range(200, 500);
        assert_eq!(range.len(), 4); // 200, 300, 400, 500
        assert_eq!(range[0].timestamp_ms, 200);
        assert_eq!(range[3].timestamp_ms, 500);
    }

    #[test]
    fn test_in_memory_log_entries_by_type() {
        let mut log = InMemoryProtocolAuditLog::new();

        log.record(ProtocolAuditEntry::new(
            1,
            ProtocolAuditEvent::CommitmentReceived {
                commitment_hash: [0u8; 32],
                table_id: [0u8; 32],
                hand_id: 1,
                seat_count: 2,
            },
        ));
        log.record(ProtocolAuditEntry::new(
            2,
            ProtocolAuditEvent::CommitmentReceived {
                commitment_hash: [1u8; 32],
                table_id: [0u8; 32],
                hand_id: 2,
                seat_count: 2,
            },
        ));
        log.record(ProtocolAuditEntry::new(
            3,
            ProtocolAuditEvent::RevealShareReceived {
                commitment_hash: [0u8; 32],
                phase: RevealPhase::Flop,
                from_seat: 0,
                card_count: 3,
                latency_ms: None,
            },
        ));

        let commitments = log.entries_by_type("commitment_received");
        assert_eq!(commitments.len(), 2);

        let reveals = log.entries_by_type("reveal_share_received");
        assert_eq!(reveals.len(), 1);
    }

    #[test]
    fn test_in_memory_log_count_by_type() {
        let mut log = InMemoryProtocolAuditLog::new();

        log.record(ProtocolAuditEntry::new(
            1,
            ProtocolAuditEvent::CommitmentReceived {
                commitment_hash: [0u8; 32],
                table_id: [0u8; 32],
                hand_id: 1,
                seat_count: 2,
            },
        ));
        log.record(ProtocolAuditEntry::new(
            2,
            ProtocolAuditEvent::CommitmentAckReceived {
                commitment_hash: [0u8; 32],
                seat: 0,
                acks_received: 1,
                acks_required: 2,
            },
        ));
        log.record(ProtocolAuditEntry::new(
            3,
            ProtocolAuditEvent::CommitmentAckReceived {
                commitment_hash: [0u8; 32],
                seat: 1,
                acks_received: 2,
                acks_required: 2,
            },
        ));
        log.record(ProtocolAuditEntry::new(
            4,
            ProtocolAuditEvent::AllAcksReceived {
                commitment_hash: [0u8; 32],
                elapsed_ms: 100,
            },
        ));

        let counts = log.count_by_type();
        assert_eq!(counts.get("commitment_received"), Some(&1));
        assert_eq!(counts.get("commitment_ack_received"), Some(&2));
        assert_eq!(counts.get("all_acks_received"), Some(&1));
    }

    #[test]
    fn test_in_memory_log_clear() {
        let mut log = InMemoryProtocolAuditLog::new();

        log.record(ProtocolAuditEntry::new(
            1,
            ProtocolAuditEvent::CommitmentReceived {
                commitment_hash: [0u8; 32],
                table_id: [0u8; 32],
                hand_id: 1,
                seat_count: 2,
            },
        ));
        log.record(ProtocolAuditEntry::new(
            2,
            ProtocolAuditEvent::RevealShareReceived {
                commitment_hash: [0u8; 32],
                phase: RevealPhase::Flop,
                from_seat: 0,
                card_count: 3,
                latency_ms: None,
            },
        ));

        assert_eq!(log.len(), 2);

        log.clear();

        assert!(log.is_empty());
        assert_eq!(log.len(), 0);
    }

    #[test]
    fn test_full_hand_lifecycle_audit_trail() {
        let mut log = InMemoryProtocolAuditLog::new();
        let commitment_hash = [42u8; 32];
        let table_id = [1u8; 32];

        // 1. Commitment received
        log.record(ProtocolAuditEntry::new(
            1000,
            ProtocolAuditEvent::CommitmentReceived {
                commitment_hash,
                table_id,
                hand_id: 1,
                seat_count: 2,
            },
        ));

        // 2. Acks received
        log.record(ProtocolAuditEntry::new(
            1050,
            ProtocolAuditEvent::CommitmentAckReceived {
                commitment_hash,
                seat: 0,
                acks_received: 1,
                acks_required: 2,
            },
        ));
        log.record(ProtocolAuditEntry::new(
            1100,
            ProtocolAuditEvent::CommitmentAckReceived {
                commitment_hash,
                seat: 1,
                acks_received: 2,
                acks_required: 2,
            },
        ));
        log.record(ProtocolAuditEntry::new(
            1100,
            ProtocolAuditEvent::AllAcksReceived {
                commitment_hash,
                elapsed_ms: 100,
            },
        ));

        // 3. Preflop reveal
        log.record(ProtocolAuditEntry::new(
            1200,
            ProtocolAuditEvent::RevealPhaseEntered {
                commitment_hash,
                phase: RevealPhase::Preflop,
                expected_seat: 255, // dealer
            },
        ));
        log.record(ProtocolAuditEntry::new(
            1300,
            ProtocolAuditEvent::RevealShareReceived {
                commitment_hash,
                phase: RevealPhase::Preflop,
                from_seat: 255,
                card_count: 4, // 2 per player
                latency_ms: Some(100),
            },
        ));
        log.record(ProtocolAuditEntry::new(
            1300,
            ProtocolAuditEvent::RevealPhaseCompleted {
                commitment_hash,
                phase: RevealPhase::Preflop,
                via_timelock: false,
            },
        ));

        // 4. Flop reveal (timelock fallback)
        log.record(ProtocolAuditEntry::new(
            5000,
            ProtocolAuditEvent::RevealPhaseEntered {
                commitment_hash,
                phase: RevealPhase::Flop,
                expected_seat: 255,
            },
        ));
        log.record(ProtocolAuditEntry::new(
            35000,
            ProtocolAuditEvent::TimelockTimeout {
                commitment_hash,
                phase: RevealPhase::Flop,
                timeout_seat: 255,
                ttl_ms: 30000,
            },
        ));
        log.record(ProtocolAuditEntry::new(
            35500,
            ProtocolAuditEvent::TimelockRevealReceived {
                commitment_hash,
                phase: RevealPhase::Flop,
                timeout_seat: 255,
                elapsed_ms: 30500,
            },
        ));
        log.record(ProtocolAuditEntry::new(
            35500,
            ProtocolAuditEvent::RevealPhaseCompleted {
                commitment_hash,
                phase: RevealPhase::Flop,
                via_timelock: true,
            },
        ));

        // 5. Hand completes (at showdown)
        log.record(ProtocolAuditEntry::new(
            50000,
            ProtocolAuditEvent::HandCompleted {
                commitment_hash,
                duration_ms: 49000,
                timelock_count: 1,
                final_phase: RevealPhase::Showdown,
            },
        ));

        // Verify the audit trail
        let hand_events = log.entries_for_commitment(&commitment_hash);
        assert_eq!(hand_events.len(), 12);

        let timelocks = log.timelock_events();
        assert_eq!(timelocks.len(), 2); // Timeout + Reveal

        // Verify no errors
        let errors = log.error_events();
        assert!(errors.is_empty());
    }

    #[test]
    fn test_serialize_deserialize() {
        let entry = ProtocolAuditEntry::new(
            1000,
            ProtocolAuditEvent::TimelockRevealReceived {
                commitment_hash: [42u8; 32],
                phase: RevealPhase::Turn,
                timeout_seat: 1,
                elapsed_ms: 31234,
            },
        )
        .with_node_id("validator-1");

        let json = serde_json::to_string(&entry).expect("serialize");
        let deserialized: ProtocolAuditEntry =
            serde_json::from_str(&json).expect("deserialize");

        assert_eq!(entry, deserialized);
    }
}
