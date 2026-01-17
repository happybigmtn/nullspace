//! Buffered mempool with replay window for reliable transaction delivery.
//!
//! This module solves the race condition where transactions submitted before
//! validators subscribe are permanently lost. Instead of using a lossy broadcast
//! channel, we maintain a time-bounded replay buffer that new subscribers can
//! read from.

use nullspace_types::api::Pending;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Notify, RwLock};

/// Default replay window duration (30 seconds)
const DEFAULT_REPLAY_WINDOW_SECS: u64 = 30;

/// Default maximum replay buffer size (10000 transactions)
const DEFAULT_MAX_REPLAY_SIZE: usize = 10_000;

/// Configuration for the buffered mempool
#[derive(Debug, Clone)]
pub struct BufferedMempoolConfig {
    /// How long to keep transactions in the replay buffer
    pub replay_window_duration: Duration,
    /// Maximum number of Pending entries to keep in the buffer
    pub max_replay_size: usize,
}

impl Default for BufferedMempoolConfig {
    fn default() -> Self {
        Self {
            replay_window_duration: Duration::from_secs(DEFAULT_REPLAY_WINDOW_SECS),
            max_replay_size: DEFAULT_MAX_REPLAY_SIZE,
        }
    }
}

impl BufferedMempoolConfig {
    /// Load configuration from environment variables
    pub fn from_env() -> Self {
        let replay_secs = std::env::var("MEMPOOL_REPLAY_WINDOW_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(DEFAULT_REPLAY_WINDOW_SECS);

        let max_size = std::env::var("MEMPOOL_MAX_REPLAY_SIZE")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(DEFAULT_MAX_REPLAY_SIZE);

        Self {
            replay_window_duration: Duration::from_secs(replay_secs),
            max_replay_size: max_size,
        }
    }
}

/// Entry in the replay buffer with timestamp and sequence number
#[derive(Clone)]
struct BufferEntry {
    /// Unique sequence number for ordering
    seq: usize,
    timestamp: Instant,
    pending: Pending,
}

/// Buffered mempool that supports replay for late subscribers.
///
/// Unlike `tokio::sync::broadcast`, this ensures that transactions submitted
/// before a subscriber connects are still delivered, as long as they're within
/// the replay window.
pub struct BufferedMempool {
    /// Replay buffer with timestamps for expiration
    buffer: Arc<RwLock<VecDeque<BufferEntry>>>,
    /// Notification channel for new transactions
    notify: Arc<Notify>,
    /// Configuration
    config: BufferedMempoolConfig,
    /// Counter for monitoring subscriber count
    subscriber_count: Arc<AtomicUsize>,
    /// Sequence number for ordering (monotonically increasing)
    sequence: Arc<AtomicUsize>,
}

impl BufferedMempool {
    /// Create a new buffered mempool with default configuration
    pub fn new() -> Self {
        Self::with_config(BufferedMempoolConfig::default())
    }

    /// Create a new buffered mempool with custom configuration
    pub fn with_config(config: BufferedMempoolConfig) -> Self {
        Self {
            buffer: Arc::new(RwLock::new(VecDeque::new())),
            notify: Arc::new(Notify::new()),
            config,
            subscriber_count: Arc::new(AtomicUsize::new(0)),
            sequence: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// Submit transactions to the mempool.
    ///
    /// Transactions are added to the replay buffer and all waiters are notified.
    /// Unlike broadcast, this will NOT lose transactions if no subscribers exist.
    pub async fn submit(&self, pending: Pending) {
        // Increment sequence first to get unique ID for this entry
        let seq = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;

        let entry = BufferEntry {
            seq,
            timestamp: Instant::now(),
            pending,
        };

        {
            let mut buffer = self.buffer.write().await;
            buffer.push_back(entry);

            // Trim old entries by time
            let cutoff = Instant::now() - self.config.replay_window_duration;
            while buffer.front().map(|e| e.timestamp < cutoff).unwrap_or(false) {
                buffer.pop_front();
            }

            // Trim by size if needed
            while buffer.len() > self.config.max_replay_size {
                buffer.pop_front();
            }
        }

        // Notify all waiters
        self.notify.notify_waiters();
    }

    /// Create a new subscriber that receives all buffered transactions
    /// and future transactions.
    pub async fn subscribe(&self) -> MempoolSubscriber {
        // Read current buffer state
        let buffer = self.buffer.read().await;
        let replay: Vec<Pending> = buffer.iter().map(|e| e.pending.clone()).collect();
        // Get the highest sequence in the buffer (last entry) or current global seq
        let last_seq = buffer.back().map(|e| e.seq).unwrap_or(0);
        drop(buffer);

        // Increment subscriber count
        self.subscriber_count.fetch_add(1, Ordering::SeqCst);

        MempoolSubscriber {
            replay,
            replay_index: 0,
            notify: Arc::clone(&self.notify),
            buffer: Arc::clone(&self.buffer),
            subscriber_count: Arc::clone(&self.subscriber_count),
            last_seen_seq: last_seq,
            replay_window: self.config.replay_window_duration,
        }
    }

    /// Get the current number of subscribers
    pub fn subscriber_count(&self) -> usize {
        self.subscriber_count.load(Ordering::SeqCst)
    }

    /// Check if there are any subscribers
    pub fn has_subscribers(&self) -> bool {
        self.subscriber_count() > 0
    }

    /// Get the current buffer size
    pub async fn buffer_size(&self) -> usize {
        self.buffer.read().await.len()
    }
}

impl Default for BufferedMempool {
    fn default() -> Self {
        Self::new()
    }
}

/// A subscriber to the buffered mempool.
///
/// Receives replayed transactions first, then listens for new transactions.
pub struct MempoolSubscriber {
    /// Transactions to replay (buffered before subscription)
    replay: Vec<Pending>,
    /// Current position in replay buffer
    replay_index: usize,
    /// Notification channel for new transactions
    notify: Arc<Notify>,
    /// Shared buffer for reading new transactions
    buffer: Arc<RwLock<VecDeque<BufferEntry>>>,
    /// Reference to subscriber count for cleanup
    subscriber_count: Arc<AtomicUsize>,
    /// Last delivered entry sequence number
    last_seen_seq: usize,
    /// Replay window for filtering stale entries
    replay_window: Duration,
}

impl MempoolSubscriber {
    /// Receive the next batch of pending transactions.
    ///
    /// First returns replayed transactions, then waits for new ones.
    /// Each transaction is delivered exactly once in order.
    pub async fn recv(&mut self) -> Option<Pending> {
        // First, drain replay buffer
        if self.replay_index < self.replay.len() {
            let pending = self.replay[self.replay_index].clone();
            self.replay_index += 1;
            return Some(pending);
        }

        // Clear replay buffer once exhausted to free memory
        if !self.replay.is_empty() {
            self.replay.clear();
            self.replay.shrink_to_fit();
        }

        // Wait for new transactions
        loop {
            // Check for new transactions in buffer
            {
                let buffer = self.buffer.read().await;
                let cutoff = Instant::now() - self.replay_window;

                // Iterate FORWARD through buffer, find first entry we haven't seen
                for entry in buffer.iter() {
                    // Skip stale entries
                    if entry.timestamp < cutoff {
                        continue;
                    }
                    // Return first entry with seq > last_seen_seq
                    if entry.seq > self.last_seen_seq {
                        self.last_seen_seq = entry.seq;
                        return Some(entry.pending.clone());
                    }
                }
            }

            // Wait for notification of new transactions
            self.notify.notified().await;
        }
    }
}

impl Drop for MempoolSubscriber {
    fn drop(&mut self) {
        self.subscriber_count.fetch_sub(1, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_pending(_id: usize) -> Pending {
        // Create minimal pending - id is just for test readability
        Pending {
            transactions: Vec::new(),
        }
    }

    #[tokio::test]
    async fn test_submit_with_no_subscribers() {
        let mempool = BufferedMempool::new();

        // Submit before any subscribers
        mempool.submit(make_pending(1)).await;
        mempool.submit(make_pending(2)).await;

        assert_eq!(mempool.buffer_size().await, 2);
        assert!(!mempool.has_subscribers());
    }

    #[tokio::test]
    async fn test_late_subscriber_gets_replay() {
        let mempool = BufferedMempool::new();

        // Submit before subscription
        mempool.submit(make_pending(1)).await;
        mempool.submit(make_pending(2)).await;

        // Subscribe after submissions
        let mut subscriber = mempool.subscribe().await;

        // Should receive replayed transactions (2 entries from before subscription)
        let _pending1 = subscriber.recv().await.unwrap();
        let _pending2 = subscriber.recv().await.unwrap();
        // If we got here, replay worked
    }

    #[tokio::test]
    async fn test_subscriber_count() {
        let mempool = BufferedMempool::new();

        assert_eq!(mempool.subscriber_count(), 0);

        let sub1 = mempool.subscribe().await;
        assert_eq!(mempool.subscriber_count(), 1);

        let sub2 = mempool.subscribe().await;
        assert_eq!(mempool.subscriber_count(), 2);

        drop(sub1);
        assert_eq!(mempool.subscriber_count(), 1);

        drop(sub2);
        assert_eq!(mempool.subscriber_count(), 0);
    }

    #[tokio::test]
    async fn test_buffer_trimming_by_size() {
        let config = BufferedMempoolConfig {
            replay_window_duration: Duration::from_secs(300),
            max_replay_size: 3,
        };
        let mempool = BufferedMempool::with_config(config);

        // Submit more than max size
        for i in 0..5 {
            mempool.submit(make_pending(i + 1)).await;
        }

        // Buffer should be trimmed to max size
        assert_eq!(mempool.buffer_size().await, 3);

        // Subscribe and verify we get exactly 3 replayed entries
        let mut subscriber = mempool.subscribe().await;
        let _p1 = subscriber.recv().await.unwrap();
        let _p2 = subscriber.recv().await.unwrap();
        let _p3 = subscriber.recv().await.unwrap();
        // 3 entries received, buffer trimming worked
    }

    #[tokio::test]
    async fn test_new_transactions_after_subscribe() {
        let mempool = Arc::new(BufferedMempool::new());

        // Subscribe first
        let mut subscriber = mempool.subscribe().await;

        // Submit after subscription
        let mempool_clone = Arc::clone(&mempool);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(10)).await;
            mempool_clone.submit(make_pending(3)).await;
        });

        // Should receive the new transaction
        let _pending = tokio::time::timeout(Duration::from_secs(1), subscriber.recv())
            .await
            .expect("timeout waiting for transaction")
            .expect("expected transaction");
        // If we got here, new transaction was received
    }

    #[tokio::test]
    async fn test_multiple_new_transactions_all_delivered() {
        // This test verifies the fix for the bug where only the last transaction
        // was delivered when multiple transactions arrived after subscription.
        let mempool = Arc::new(BufferedMempool::new());

        // Subscribe first (with empty buffer)
        let mut subscriber = mempool.subscribe().await;

        // Submit multiple transactions after subscription
        let mempool_clone = Arc::clone(&mempool);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(10)).await;
            // Submit 3 transactions quickly
            mempool_clone.submit(make_pending(1)).await;
            mempool_clone.submit(make_pending(2)).await;
            mempool_clone.submit(make_pending(3)).await;
        });

        // ALL 3 transactions must be received (this was the bug - only 1 was delivered)
        for i in 1..=3 {
            let result = tokio::time::timeout(Duration::from_secs(1), subscriber.recv()).await;
            assert!(
                result.is_ok(),
                "Timeout waiting for transaction {i} - bug: not all transactions delivered"
            );
            assert!(
                result.unwrap().is_some(),
                "Expected transaction {i} to be Some"
            );
        }
    }
}
