//! Operational metrics for backfill, artifacts, and state verification.
//!
//! This module provides metrics collection for monitoring and alerting:
//!
//! - **Backfill latency**: How long artifact backfill operations take
//! - **Artifact misses**: When requested artifacts are not found
//! - **State root mismatches**: When computed state roots differ from expected
//!
//! # Metrics vs Audit Logs
//!
//! Metrics are quantitative summaries for monitoring dashboards and alerting.
//! Audit logs (see [`crate::protocol_audit`] and [`crate::artifact_registry::AuditLog`])
//! are detailed event records for forensic analysis.
//!
//! # Usage
//!
//! ```
//! use codexpoker_onchain::metrics::{
//!     MetricsCollector, InMemoryMetricsCollector, MetricEvent,
//! };
//!
//! let mut metrics = InMemoryMetricsCollector::new();
//!
//! // Record a backfill operation
//! metrics.record(MetricEvent::BackfillLatency {
//!     latency_ms: 150,
//!     artifacts_requested: 10,
//!     artifacts_received: 8,
//!     hash_mismatches: 1,
//! });
//!
//! // Record an artifact miss
//! metrics.record(MetricEvent::ArtifactMiss {
//!     artifact_hash: [1u8; 32],
//!     commitment_hash: Some([2u8; 32]),
//!     context: "backfill_request".to_string(),
//! });
//!
//! // Query metrics
//! let summary = metrics.summary();
//! println!("Backfill p50 latency: {:?}", summary.backfill_latency_p50_ms);
//! ```
//!
//! # Integration Points
//!
//! Metrics are recorded from:
//! - [`crate::artifact_registry::ArtifactRegistry::process_backfill_response`] - backfill metrics
//! - [`crate::artifact_registry::ArtifactRegistry::handle_artifact_request`] - miss metrics
//! - [`crate::state::verify_state_root_on_restart`] - state root mismatch metrics
//!
//! # Prometheus Integration
//!
//! The metrics types are designed to map easily to Prometheus:
//! - `BackfillLatency` → histogram
//! - `ArtifactMiss` → counter with labels
//! - `StateRootMismatch` → counter with labels

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::time::{Duration, Instant};

// ─────────────────────────────────────────────────────────────────────────────
// Metric Events
// ─────────────────────────────────────────────────────────────────────────────

/// A metric event to be recorded.
///
/// Each variant captures the essential quantitative data for one type of
/// operational metric. These events are recorded by the system and aggregated
/// into summaries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum MetricEvent {
    // ─────────────────────────────────────────────────────────────────────────
    // Backfill Metrics
    // ─────────────────────────────────────────────────────────────────────────
    /// A backfill operation completed (success or partial).
    BackfillLatency {
        /// Time to complete the backfill operation in milliseconds.
        latency_ms: u64,
        /// Number of artifacts requested.
        artifacts_requested: usize,
        /// Number of artifacts successfully received and stored.
        artifacts_received: usize,
        /// Number of artifacts with hash mismatches (corrupted/invalid).
        hash_mismatches: usize,
    },

    /// A backfill request was sent.
    BackfillRequestSent {
        /// Number of artifact hashes requested.
        artifact_count: usize,
        /// Optional commitment hash context.
        commitment_hash: Option<[u8; 32]>,
    },

    /// A backfill response was received.
    BackfillResponseReceived {
        /// Number of artifacts in the response.
        artifact_count: usize,
        /// Number of missing artifacts reported.
        missing_count: usize,
        /// Time since request was sent (if tracked).
        round_trip_ms: Option<u64>,
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Artifact Miss Metrics
    // ─────────────────────────────────────────────────────────────────────────
    /// An artifact was requested but not found locally.
    ArtifactMiss {
        /// Hash of the missing artifact.
        artifact_hash: [u8; 32],
        /// Associated deal commitment (if known).
        commitment_hash: Option<[u8; 32]>,
        /// Context where the miss occurred (e.g., "verification", "backfill_request").
        context: String,
    },

    /// Multiple artifacts were requested and some were missing.
    ArtifactMissBatch {
        /// Number of artifacts requested.
        requested_count: usize,
        /// Number of artifacts missing.
        missing_count: usize,
        /// Context where the miss occurred.
        context: String,
    },

    // ─────────────────────────────────────────────────────────────────────────
    // State Root Metrics
    // ─────────────────────────────────────────────────────────────────────────
    /// A state root mismatch was detected.
    StateRootMismatch {
        /// The expected state root.
        expected: [u8; 32],
        /// The computed state root.
        actual: [u8; 32],
        /// Block height where mismatch occurred (if applicable).
        height: Option<u64>,
        /// Context (e.g., "restart_verification", "block_execution", "sync").
        context: String,
    },

    /// State root verification succeeded.
    StateRootVerified {
        /// Block height verified.
        height: u64,
        /// Time to verify in milliseconds.
        verification_ms: u64,
    },

    // ─────────────────────────────────────────────────────────────────────────
    // General Operations
    // ─────────────────────────────────────────────────────────────────────────
    /// A hash mismatch was detected during any operation.
    HashMismatch {
        /// The claimed hash.
        claimed: [u8; 32],
        /// The computed hash.
        computed: [u8; 32],
        /// Context (e.g., "artifact_store", "backfill", "proof_verification").
        context: String,
    },
}

impl MetricEvent {
    /// Returns the metric type name for labeling.
    pub fn metric_type(&self) -> &'static str {
        match self {
            MetricEvent::BackfillLatency { .. } => "backfill_latency",
            MetricEvent::BackfillRequestSent { .. } => "backfill_request_sent",
            MetricEvent::BackfillResponseReceived { .. } => "backfill_response_received",
            MetricEvent::ArtifactMiss { .. } => "artifact_miss",
            MetricEvent::ArtifactMissBatch { .. } => "artifact_miss_batch",
            MetricEvent::StateRootMismatch { .. } => "state_root_mismatch",
            MetricEvent::StateRootVerified { .. } => "state_root_verified",
            MetricEvent::HashMismatch { .. } => "hash_mismatch",
        }
    }

    /// Returns true if this is an error/failure event.
    pub fn is_error(&self) -> bool {
        matches!(
            self,
            MetricEvent::ArtifactMiss { .. }
                | MetricEvent::ArtifactMissBatch { .. }
                | MetricEvent::StateRootMismatch { .. }
                | MetricEvent::HashMismatch { .. }
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Timestamped Metric
// ─────────────────────────────────────────────────────────────────────────────

/// A metric event with a timestamp.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimestampedMetric {
    /// Unix timestamp (milliseconds) when the metric was recorded.
    pub timestamp_ms: u64,
    /// The metric event.
    pub event: MetricEvent,
}

impl TimestampedMetric {
    /// Create a new timestamped metric.
    pub fn new(timestamp_ms: u64, event: MetricEvent) -> Self {
        Self { timestamp_ms, event }
    }

    /// Create with current timestamp.
    pub fn now(event: MetricEvent) -> Self {
        let timestamp_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        Self::new(timestamp_ms, event)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics Summary
// ─────────────────────────────────────────────────────────────────────────────

/// Aggregated metrics summary for monitoring dashboards.
///
/// This provides pre-computed statistics that can be scraped by Prometheus
/// or displayed in operational dashboards.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MetricsSummary {
    // ─────────────────────────────────────────────────────────────────────────
    // Backfill Metrics
    // ─────────────────────────────────────────────────────────────────────────
    /// Total number of backfill operations.
    pub backfill_total: u64,
    /// Number of successful backfill operations (all artifacts received).
    pub backfill_success: u64,
    /// Number of partial backfill operations (some artifacts missing).
    pub backfill_partial: u64,
    /// Total artifacts requested across all backfill operations.
    pub backfill_artifacts_requested: u64,
    /// Total artifacts received across all backfill operations.
    pub backfill_artifacts_received: u64,
    /// Total hash mismatches in backfill operations.
    pub backfill_hash_mismatches: u64,
    /// Median backfill latency in milliseconds (p50).
    pub backfill_latency_p50_ms: Option<u64>,
    /// 95th percentile backfill latency in milliseconds.
    pub backfill_latency_p95_ms: Option<u64>,
    /// 99th percentile backfill latency in milliseconds.
    pub backfill_latency_p99_ms: Option<u64>,
    /// Maximum backfill latency observed in milliseconds.
    pub backfill_latency_max_ms: Option<u64>,

    // ─────────────────────────────────────────────────────────────────────────
    // Artifact Miss Metrics
    // ─────────────────────────────────────────────────────────────────────────
    /// Total individual artifact misses.
    pub artifact_misses_total: u64,
    /// Total batch artifact miss events.
    pub artifact_miss_batches_total: u64,
    /// Total artifacts missing across all batch events.
    pub artifact_missing_in_batches: u64,

    // ─────────────────────────────────────────────────────────────────────────
    // State Root Metrics
    // ─────────────────────────────────────────────────────────────────────────
    /// Total state root mismatch events.
    pub state_root_mismatches_total: u64,
    /// Total successful state root verifications.
    pub state_root_verifications_total: u64,
    /// Average verification time in milliseconds.
    pub state_root_verification_avg_ms: Option<u64>,

    // ─────────────────────────────────────────────────────────────────────────
    // General
    // ─────────────────────────────────────────────────────────────────────────
    /// Total hash mismatch events (all contexts).
    pub hash_mismatches_total: u64,
    /// Total error events.
    pub errors_total: u64,
    /// Time period covered by these metrics (milliseconds).
    pub period_ms: u64,
    /// Timestamp when summary was computed.
    pub computed_at_ms: u64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics Collector Trait
// ─────────────────────────────────────────────────────────────────────────────

/// Trait for collecting and querying operational metrics.
///
/// Implementations may store metrics in memory, persist to disk, or export
/// to external monitoring systems (Prometheus, etc.).
pub trait MetricsCollector: Send + Sync {
    /// Record a metric event.
    fn record(&mut self, event: MetricEvent);

    /// Record a metric event with explicit timestamp.
    fn record_at(&mut self, timestamp_ms: u64, event: MetricEvent);

    /// Get the current aggregated summary.
    fn summary(&self) -> MetricsSummary;

    /// Get metrics in a time range.
    fn metrics_in_range(&self, start_ms: u64, end_ms: u64) -> Vec<&TimestampedMetric>;

    /// Get all metrics of a specific type.
    fn metrics_by_type(&self, metric_type: &str) -> Vec<&TimestampedMetric>;

    /// Get the total number of recorded metrics.
    fn len(&self) -> usize;

    /// Check if no metrics have been recorded.
    fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Clear all recorded metrics.
    fn clear(&mut self);

    /// Get all error metrics.
    fn error_metrics(&self) -> Vec<&TimestampedMetric>;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Metrics Collector
// ─────────────────────────────────────────────────────────────────────────────

/// In-memory metrics collector for testing and development.
///
/// Stores metrics in a bounded buffer with configurable retention. Old metrics
/// are evicted when the buffer is full (FIFO).
///
/// # Configuration
///
/// - `max_metrics`: Maximum number of metrics to retain (default: 10,000)
/// - `max_latency_samples`: Maximum latency samples for percentile calculation
#[derive(Debug)]
pub struct InMemoryMetricsCollector {
    /// All recorded metrics.
    metrics: VecDeque<TimestampedMetric>,
    /// Maximum metrics to retain.
    max_metrics: usize,
    /// Backfill latencies for percentile calculation.
    backfill_latencies: VecDeque<u64>,
    /// Maximum latency samples to retain.
    max_latency_samples: usize,
    /// Verification times for average calculation.
    verification_times: VecDeque<u64>,
    /// Running counters for summary.
    counters: MetricsCounters,
}

/// Internal counters for efficient summary computation.
#[derive(Debug, Default)]
struct MetricsCounters {
    backfill_total: u64,
    backfill_success: u64,
    backfill_partial: u64,
    backfill_artifacts_requested: u64,
    backfill_artifacts_received: u64,
    backfill_hash_mismatches: u64,
    artifact_misses_total: u64,
    artifact_miss_batches_total: u64,
    artifact_missing_in_batches: u64,
    state_root_mismatches_total: u64,
    state_root_verifications_total: u64,
    hash_mismatches_total: u64,
    errors_total: u64,
    first_metric_ms: Option<u64>,
    last_metric_ms: Option<u64>,
}

impl Default for InMemoryMetricsCollector {
    fn default() -> Self {
        Self::new()
    }
}

impl InMemoryMetricsCollector {
    /// Default maximum metrics to retain.
    pub const DEFAULT_MAX_METRICS: usize = 10_000;
    /// Default maximum latency samples for percentiles.
    pub const DEFAULT_MAX_LATENCY_SAMPLES: usize = 1_000;

    /// Create a new in-memory metrics collector with default settings.
    pub fn new() -> Self {
        Self::with_capacity(Self::DEFAULT_MAX_METRICS, Self::DEFAULT_MAX_LATENCY_SAMPLES)
    }

    /// Create a new in-memory metrics collector with custom capacity.
    pub fn with_capacity(max_metrics: usize, max_latency_samples: usize) -> Self {
        Self {
            metrics: VecDeque::with_capacity(max_metrics.min(1000)),
            max_metrics,
            backfill_latencies: VecDeque::with_capacity(max_latency_samples.min(100)),
            max_latency_samples,
            verification_times: VecDeque::with_capacity(100),
            counters: MetricsCounters::default(),
        }
    }

    /// Compute percentile from sorted latencies.
    fn percentile(sorted: &[u64], p: f64) -> Option<u64> {
        if sorted.is_empty() {
            return None;
        }
        let idx = ((sorted.len() as f64 * p) as usize).min(sorted.len() - 1);
        Some(sorted[idx])
    }

    /// Update counters based on event.
    fn update_counters(&mut self, timestamp_ms: u64, event: &MetricEvent) {
        // Track time range
        if self.counters.first_metric_ms.is_none() {
            self.counters.first_metric_ms = Some(timestamp_ms);
        }
        self.counters.last_metric_ms = Some(timestamp_ms);

        // Update type-specific counters
        match event {
            MetricEvent::BackfillLatency {
                latency_ms,
                artifacts_requested,
                artifacts_received,
                hash_mismatches,
            } => {
                self.counters.backfill_total += 1;
                self.counters.backfill_artifacts_requested += *artifacts_requested as u64;
                self.counters.backfill_artifacts_received += *artifacts_received as u64;
                self.counters.backfill_hash_mismatches += *hash_mismatches as u64;

                if artifacts_received == artifacts_requested && *hash_mismatches == 0 {
                    self.counters.backfill_success += 1;
                } else {
                    self.counters.backfill_partial += 1;
                }

                // Track latency for percentiles
                if self.backfill_latencies.len() >= self.max_latency_samples {
                    self.backfill_latencies.pop_front();
                }
                self.backfill_latencies.push_back(*latency_ms);
            }
            MetricEvent::ArtifactMiss { .. } => {
                self.counters.artifact_misses_total += 1;
                self.counters.errors_total += 1;
            }
            MetricEvent::ArtifactMissBatch { missing_count, .. } => {
                self.counters.artifact_miss_batches_total += 1;
                self.counters.artifact_missing_in_batches += *missing_count as u64;
                self.counters.errors_total += 1;
            }
            MetricEvent::StateRootMismatch { .. } => {
                self.counters.state_root_mismatches_total += 1;
                self.counters.errors_total += 1;
            }
            MetricEvent::StateRootVerified { verification_ms, .. } => {
                self.counters.state_root_verifications_total += 1;
                if self.verification_times.len() >= 100 {
                    self.verification_times.pop_front();
                }
                self.verification_times.push_back(*verification_ms);
            }
            MetricEvent::HashMismatch { .. } => {
                self.counters.hash_mismatches_total += 1;
                self.counters.errors_total += 1;
            }
            MetricEvent::BackfillRequestSent { .. } | MetricEvent::BackfillResponseReceived { .. } => {
                // These are informational, no counter updates
            }
        }
    }

    /// Get all metrics (for inspection/debugging).
    pub fn all_metrics(&self) -> impl Iterator<Item = &TimestampedMetric> {
        self.metrics.iter()
    }

    /// Get count of each metric type.
    pub fn counts_by_type(&self) -> std::collections::HashMap<&'static str, usize> {
        let mut counts = std::collections::HashMap::new();
        for m in &self.metrics {
            *counts.entry(m.event.metric_type()).or_insert(0) += 1;
        }
        counts
    }
}

impl MetricsCollector for InMemoryMetricsCollector {
    fn record(&mut self, event: MetricEvent) {
        let metric = TimestampedMetric::now(event);
        self.record_at(metric.timestamp_ms, metric.event.clone());
    }

    fn record_at(&mut self, timestamp_ms: u64, event: MetricEvent) {
        // Update counters
        self.update_counters(timestamp_ms, &event);

        // Store metric
        if self.metrics.len() >= self.max_metrics {
            self.metrics.pop_front();
        }
        self.metrics.push_back(TimestampedMetric::new(timestamp_ms, event));
    }

    fn summary(&self) -> MetricsSummary {
        // Compute percentiles from latencies
        let mut sorted_latencies: Vec<u64> = self.backfill_latencies.iter().copied().collect();
        sorted_latencies.sort_unstable();

        let verification_avg = if self.verification_times.is_empty() {
            None
        } else {
            let sum: u64 = self.verification_times.iter().sum();
            Some(sum / self.verification_times.len() as u64)
        };

        let period_ms = match (self.counters.first_metric_ms, self.counters.last_metric_ms) {
            (Some(first), Some(last)) => last.saturating_sub(first),
            _ => 0,
        };

        let computed_at_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        MetricsSummary {
            backfill_total: self.counters.backfill_total,
            backfill_success: self.counters.backfill_success,
            backfill_partial: self.counters.backfill_partial,
            backfill_artifacts_requested: self.counters.backfill_artifacts_requested,
            backfill_artifacts_received: self.counters.backfill_artifacts_received,
            backfill_hash_mismatches: self.counters.backfill_hash_mismatches,
            backfill_latency_p50_ms: Self::percentile(&sorted_latencies, 0.50),
            backfill_latency_p95_ms: Self::percentile(&sorted_latencies, 0.95),
            backfill_latency_p99_ms: Self::percentile(&sorted_latencies, 0.99),
            backfill_latency_max_ms: sorted_latencies.last().copied(),
            artifact_misses_total: self.counters.artifact_misses_total,
            artifact_miss_batches_total: self.counters.artifact_miss_batches_total,
            artifact_missing_in_batches: self.counters.artifact_missing_in_batches,
            state_root_mismatches_total: self.counters.state_root_mismatches_total,
            state_root_verifications_total: self.counters.state_root_verifications_total,
            state_root_verification_avg_ms: verification_avg,
            hash_mismatches_total: self.counters.hash_mismatches_total,
            errors_total: self.counters.errors_total,
            period_ms,
            computed_at_ms,
        }
    }

    fn metrics_in_range(&self, start_ms: u64, end_ms: u64) -> Vec<&TimestampedMetric> {
        self.metrics
            .iter()
            .filter(|m| m.timestamp_ms >= start_ms && m.timestamp_ms <= end_ms)
            .collect()
    }

    fn metrics_by_type(&self, metric_type: &str) -> Vec<&TimestampedMetric> {
        self.metrics
            .iter()
            .filter(|m| m.event.metric_type() == metric_type)
            .collect()
    }

    fn len(&self) -> usize {
        self.metrics.len()
    }

    fn clear(&mut self) {
        self.metrics.clear();
        self.backfill_latencies.clear();
        self.verification_times.clear();
        self.counters = MetricsCounters::default();
    }

    fn error_metrics(&self) -> Vec<&TimestampedMetric> {
        self.metrics.iter().filter(|m| m.event.is_error()).collect()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Backfill Timer
// ─────────────────────────────────────────────────────────────────────────────

/// Helper for timing backfill operations.
///
/// Use this to track the latency of backfill operations from request to completion.
///
/// # Example
///
/// ```ignore
/// let timer = BackfillTimer::start(10);
///
/// // ... perform backfill ...
///
/// let event = timer.complete(8, 1);
/// metrics.record(event);
/// ```
pub struct BackfillTimer {
    start: Instant,
    artifacts_requested: usize,
}

impl BackfillTimer {
    /// Start timing a backfill operation.
    pub fn start(artifacts_requested: usize) -> Self {
        Self {
            start: Instant::now(),
            artifacts_requested,
        }
    }

    /// Complete the timer and generate a metric event.
    pub fn complete(self, artifacts_received: usize, hash_mismatches: usize) -> MetricEvent {
        let latency = self.start.elapsed();
        MetricEvent::BackfillLatency {
            latency_ms: latency.as_millis() as u64,
            artifacts_requested: self.artifacts_requested,
            artifacts_received,
            hash_mismatches,
        }
    }

    /// Get elapsed time without completing.
    pub fn elapsed(&self) -> Duration {
        self.start.elapsed()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ─────────────────────────────────────────────────────────────────────────
    // MetricEvent Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_metric_event_type_names() {
        assert_eq!(
            MetricEvent::BackfillLatency {
                latency_ms: 0,
                artifacts_requested: 0,
                artifacts_received: 0,
                hash_mismatches: 0,
            }
            .metric_type(),
            "backfill_latency"
        );

        assert_eq!(
            MetricEvent::ArtifactMiss {
                artifact_hash: [0; 32],
                commitment_hash: None,
                context: "test".to_string(),
            }
            .metric_type(),
            "artifact_miss"
        );

        assert_eq!(
            MetricEvent::StateRootMismatch {
                expected: [0; 32],
                actual: [1; 32],
                height: Some(100),
                context: "test".to_string(),
            }
            .metric_type(),
            "state_root_mismatch"
        );
    }

    #[test]
    fn test_metric_event_is_error() {
        assert!(MetricEvent::ArtifactMiss {
            artifact_hash: [0; 32],
            commitment_hash: None,
            context: "test".to_string(),
        }
        .is_error());

        assert!(MetricEvent::StateRootMismatch {
            expected: [0; 32],
            actual: [1; 32],
            height: None,
            context: "test".to_string(),
        }
        .is_error());

        assert!(!MetricEvent::BackfillLatency {
            latency_ms: 100,
            artifacts_requested: 10,
            artifacts_received: 10,
            hash_mismatches: 0,
        }
        .is_error());

        assert!(!MetricEvent::StateRootVerified {
            height: 100,
            verification_ms: 50,
        }
        .is_error());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TimestampedMetric Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_timestamped_metric_new() {
        let event = MetricEvent::BackfillLatency {
            latency_ms: 100,
            artifacts_requested: 5,
            artifacts_received: 5,
            hash_mismatches: 0,
        };
        let metric = TimestampedMetric::new(1000, event.clone());

        assert_eq!(metric.timestamp_ms, 1000);
        assert_eq!(metric.event, event);
    }

    #[test]
    fn test_timestamped_metric_now() {
        let event = MetricEvent::ArtifactMiss {
            artifact_hash: [1; 32],
            commitment_hash: None,
            context: "test".to_string(),
        };
        let metric = TimestampedMetric::now(event);

        // Timestamp should be recent (within last minute)
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        assert!(metric.timestamp_ms <= now);
        assert!(metric.timestamp_ms > now - 60_000);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // InMemoryMetricsCollector Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_collector_new() {
        let collector = InMemoryMetricsCollector::new();
        assert!(collector.is_empty());
        assert_eq!(collector.len(), 0);
    }

    #[test]
    fn test_collector_record_backfill() {
        let mut collector = InMemoryMetricsCollector::new();

        collector.record(MetricEvent::BackfillLatency {
            latency_ms: 150,
            artifacts_requested: 10,
            artifacts_received: 8,
            hash_mismatches: 1,
        });

        assert_eq!(collector.len(), 1);

        let summary = collector.summary();
        assert_eq!(summary.backfill_total, 1);
        assert_eq!(summary.backfill_partial, 1); // Not all received
        assert_eq!(summary.backfill_success, 0);
        assert_eq!(summary.backfill_artifacts_requested, 10);
        assert_eq!(summary.backfill_artifacts_received, 8);
        assert_eq!(summary.backfill_hash_mismatches, 1);
        assert_eq!(summary.backfill_latency_p50_ms, Some(150));
    }

    #[test]
    fn test_collector_record_success_backfill() {
        let mut collector = InMemoryMetricsCollector::new();

        collector.record(MetricEvent::BackfillLatency {
            latency_ms: 100,
            artifacts_requested: 5,
            artifacts_received: 5,
            hash_mismatches: 0,
        });

        let summary = collector.summary();
        assert_eq!(summary.backfill_total, 1);
        assert_eq!(summary.backfill_success, 1);
        assert_eq!(summary.backfill_partial, 0);
    }

    #[test]
    fn test_collector_record_artifact_miss() {
        let mut collector = InMemoryMetricsCollector::new();

        collector.record(MetricEvent::ArtifactMiss {
            artifact_hash: [1; 32],
            commitment_hash: Some([2; 32]),
            context: "verification".to_string(),
        });

        assert_eq!(collector.len(), 1);

        let summary = collector.summary();
        assert_eq!(summary.artifact_misses_total, 1);
        assert_eq!(summary.errors_total, 1);
    }

    #[test]
    fn test_collector_record_artifact_miss_batch() {
        let mut collector = InMemoryMetricsCollector::new();

        collector.record(MetricEvent::ArtifactMissBatch {
            requested_count: 10,
            missing_count: 3,
            context: "backfill".to_string(),
        });

        let summary = collector.summary();
        assert_eq!(summary.artifact_miss_batches_total, 1);
        assert_eq!(summary.artifact_missing_in_batches, 3);
        assert_eq!(summary.errors_total, 1);
    }

    #[test]
    fn test_collector_record_state_root_mismatch() {
        let mut collector = InMemoryMetricsCollector::new();

        collector.record(MetricEvent::StateRootMismatch {
            expected: [1; 32],
            actual: [2; 32],
            height: Some(100),
            context: "restart_verification".to_string(),
        });

        let summary = collector.summary();
        assert_eq!(summary.state_root_mismatches_total, 1);
        assert_eq!(summary.errors_total, 1);
    }

    #[test]
    fn test_collector_record_state_root_verified() {
        let mut collector = InMemoryMetricsCollector::new();

        collector.record(MetricEvent::StateRootVerified {
            height: 100,
            verification_ms: 50,
        });
        collector.record(MetricEvent::StateRootVerified {
            height: 101,
            verification_ms: 70,
        });

        let summary = collector.summary();
        assert_eq!(summary.state_root_verifications_total, 2);
        assert_eq!(summary.state_root_verification_avg_ms, Some(60)); // (50 + 70) / 2
    }

    #[test]
    fn test_collector_latency_percentiles() {
        let mut collector = InMemoryMetricsCollector::new();

        // Record several latencies
        for latency in [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] {
            collector.record_at(
                latency as u64,
                MetricEvent::BackfillLatency {
                    latency_ms: latency,
                    artifacts_requested: 1,
                    artifacts_received: 1,
                    hash_mismatches: 0,
                },
            );
        }

        let summary = collector.summary();
        assert_eq!(summary.backfill_total, 10);
        // p50 for 10 items: index = (10 * 0.50) = 5, which is 60 (0-indexed)
        assert_eq!(summary.backfill_latency_p50_ms, Some(60));
        // p95 for 10 items: index = (10 * 0.95) = 9, which is 100
        assert_eq!(summary.backfill_latency_p95_ms, Some(100));
        assert_eq!(summary.backfill_latency_max_ms, Some(100));
    }

    #[test]
    fn test_collector_metrics_in_range() {
        let mut collector = InMemoryMetricsCollector::new();

        collector.record_at(100, MetricEvent::ArtifactMiss {
            artifact_hash: [1; 32],
            commitment_hash: None,
            context: "test".to_string(),
        });
        collector.record_at(200, MetricEvent::ArtifactMiss {
            artifact_hash: [2; 32],
            commitment_hash: None,
            context: "test".to_string(),
        });
        collector.record_at(300, MetricEvent::ArtifactMiss {
            artifact_hash: [3; 32],
            commitment_hash: None,
            context: "test".to_string(),
        });

        let in_range = collector.metrics_in_range(150, 250);
        assert_eq!(in_range.len(), 1);
        assert_eq!(in_range[0].timestamp_ms, 200);
    }

    #[test]
    fn test_collector_metrics_by_type() {
        let mut collector = InMemoryMetricsCollector::new();

        collector.record(MetricEvent::ArtifactMiss {
            artifact_hash: [1; 32],
            commitment_hash: None,
            context: "test".to_string(),
        });
        collector.record(MetricEvent::BackfillLatency {
            latency_ms: 100,
            artifacts_requested: 1,
            artifacts_received: 1,
            hash_mismatches: 0,
        });
        collector.record(MetricEvent::ArtifactMiss {
            artifact_hash: [2; 32],
            commitment_hash: None,
            context: "test".to_string(),
        });

        let misses = collector.metrics_by_type("artifact_miss");
        assert_eq!(misses.len(), 2);

        let latencies = collector.metrics_by_type("backfill_latency");
        assert_eq!(latencies.len(), 1);
    }

    #[test]
    fn test_collector_error_metrics() {
        let mut collector = InMemoryMetricsCollector::new();

        collector.record(MetricEvent::ArtifactMiss {
            artifact_hash: [1; 32],
            commitment_hash: None,
            context: "test".to_string(),
        });
        collector.record(MetricEvent::BackfillLatency {
            latency_ms: 100,
            artifacts_requested: 1,
            artifacts_received: 1,
            hash_mismatches: 0,
        });
        collector.record(MetricEvent::StateRootMismatch {
            expected: [0; 32],
            actual: [1; 32],
            height: None,
            context: "test".to_string(),
        });

        let errors = collector.error_metrics();
        assert_eq!(errors.len(), 2); // ArtifactMiss and StateRootMismatch
    }

    #[test]
    fn test_collector_clear() {
        let mut collector = InMemoryMetricsCollector::new();

        collector.record(MetricEvent::ArtifactMiss {
            artifact_hash: [1; 32],
            commitment_hash: None,
            context: "test".to_string(),
        });

        assert_eq!(collector.len(), 1);

        collector.clear();

        assert!(collector.is_empty());
        let summary = collector.summary();
        assert_eq!(summary.errors_total, 0);
    }

    #[test]
    fn test_collector_max_metrics_eviction() {
        let mut collector = InMemoryMetricsCollector::with_capacity(3, 10);

        for i in 0..5 {
            collector.record_at(
                i as u64,
                MetricEvent::ArtifactMiss {
                    artifact_hash: [i as u8; 32],
                    commitment_hash: None,
                    context: format!("test_{}", i),
                },
            );
        }

        // Should only have last 3 metrics
        assert_eq!(collector.len(), 3);

        // Oldest should be evicted
        let all: Vec<_> = collector.all_metrics().collect();
        assert_eq!(all[0].timestamp_ms, 2);
        assert_eq!(all[2].timestamp_ms, 4);
    }

    #[test]
    fn test_collector_counts_by_type() {
        let mut collector = InMemoryMetricsCollector::new();

        collector.record(MetricEvent::ArtifactMiss {
            artifact_hash: [1; 32],
            commitment_hash: None,
            context: "test".to_string(),
        });
        collector.record(MetricEvent::ArtifactMiss {
            artifact_hash: [2; 32],
            commitment_hash: None,
            context: "test".to_string(),
        });
        collector.record(MetricEvent::StateRootMismatch {
            expected: [0; 32],
            actual: [1; 32],
            height: None,
            context: "test".to_string(),
        });

        let counts = collector.counts_by_type();
        assert_eq!(counts.get("artifact_miss"), Some(&2));
        assert_eq!(counts.get("state_root_mismatch"), Some(&1));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BackfillTimer Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_backfill_timer() {
        let timer = BackfillTimer::start(10);

        // Wait a tiny bit
        std::thread::sleep(std::time::Duration::from_millis(1));

        let event = timer.complete(8, 1);

        match event {
            MetricEvent::BackfillLatency {
                latency_ms,
                artifacts_requested,
                artifacts_received,
                hash_mismatches,
            } => {
                assert!(latency_ms >= 1, "latency should be at least 1ms");
                assert_eq!(artifacts_requested, 10);
                assert_eq!(artifacts_received, 8);
                assert_eq!(hash_mismatches, 1);
            }
            _ => panic!("expected BackfillLatency event"),
        }
    }

    #[test]
    fn test_backfill_timer_elapsed() {
        let timer = BackfillTimer::start(5);
        std::thread::sleep(std::time::Duration::from_millis(1));

        let elapsed = timer.elapsed();
        assert!(elapsed >= std::time::Duration::from_millis(1));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Serialization Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_metric_event_serialize() {
        let event = MetricEvent::BackfillLatency {
            latency_ms: 150,
            artifacts_requested: 10,
            artifacts_received: 8,
            hash_mismatches: 1,
        };

        let json = serde_json::to_string(&event).unwrap();
        let deserialized: MetricEvent = serde_json::from_str(&json).unwrap();

        assert_eq!(event, deserialized);
    }

    #[test]
    fn test_timestamped_metric_serialize() {
        let metric = TimestampedMetric::new(
            1000,
            MetricEvent::StateRootMismatch {
                expected: [1; 32],
                actual: [2; 32],
                height: Some(100),
                context: "test".to_string(),
            },
        );

        let json = serde_json::to_string(&metric).unwrap();
        let deserialized: TimestampedMetric = serde_json::from_str(&json).unwrap();

        assert_eq!(metric, deserialized);
    }

    #[test]
    fn test_metrics_summary_serialize() {
        let summary = MetricsSummary {
            backfill_total: 10,
            backfill_success: 8,
            backfill_partial: 2,
            artifact_misses_total: 5,
            state_root_mismatches_total: 1,
            ..Default::default()
        };

        let json = serde_json::to_string(&summary).unwrap();
        let deserialized: MetricsSummary = serde_json::from_str(&json).unwrap();

        assert_eq!(summary.backfill_total, deserialized.backfill_total);
        assert_eq!(summary.artifact_misses_total, deserialized.artifact_misses_total);
    }
}
