use commonware_cryptography::ed25519::PublicKey;
use commonware_runtime::Metrics;
use nullspace_types::execution::Transaction;
use prometheus_client::metrics::{counter::Counter, gauge::Gauge};
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::AtomicU64;

#[derive(Clone)]
struct MempoolEntry {
    tx: Transaction,
    inserted_at_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddRejectReason {
    GlobalCapacity,
    DuplicateNonce,
    BacklogLimit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddResult {
    Added { trimmed: bool },
    Rejected(AddRejectReason),
}

/// The maximum number of transactions a single account can have in the mempool.
// Increased for higher transaction throughput per account
#[cfg(test)]
const DEFAULT_MAX_BACKLOG: usize = 64;

/// The maximum number of transactions in the mempool.
// Scaled for 1000+ concurrent players
#[cfg(test)]
const DEFAULT_MAX_TRANSACTIONS: usize = 100_000;

/// A mempool for transactions.
pub struct Mempool {
    max_backlog: usize,
    max_transactions: usize,
    total_transactions: usize,
    tracked: HashMap<PublicKey, BTreeMap<u64, MempoolEntry>>,
    min_inserted_at_ms: Option<i64>,
    /// We store the public keys of the transactions to be processed next (rather than transactions
    /// received by digest) because we may receive transactions out-of-order (and/or some may have
    /// already been processed) and should just try return the transaction with the lowest nonce we
    /// are currently tracking.
    ///
    /// This is implemented as a round-robin ring over accounts with pending transactions, backed
    /// by a `Vec` + cursor. A `HashMap` index allows removing accounts in `O(1)` when their
    /// backlog becomes empty, avoiding stale entries and periodic compaction scans.
    queue: Vec<PublicKey>,
    queue_positions: HashMap<PublicKey, usize>,
    queue_cursor: usize,

    unique: Gauge,
    accounts: Gauge,
    rejected_total: Counter<u64, AtomicU64>,
    trimmed_total: Counter<u64, AtomicU64>,
}

impl Mempool {
    /// Create a new mempool.
    #[cfg(test)]
    pub fn new(context: impl Metrics) -> Self {
        Self::new_with_limits(context, DEFAULT_MAX_BACKLOG, DEFAULT_MAX_TRANSACTIONS)
    }

    pub fn new_with_limits(
        context: impl Metrics,
        max_backlog: usize,
        max_transactions: usize,
    ) -> Self {
        // Initialize metrics
        let unique = Gauge::default();
        let accounts = Gauge::default();
        let rejected_total: Counter<u64, AtomicU64> = Counter::default();
        let trimmed_total: Counter<u64, AtomicU64> = Counter::default();
        context.register(
            "transactions",
            "Number of transactions in the mempool",
            unique.clone(),
        );
        context.register(
            "mempool_pending_total",
            "Number of pending transactions in the mempool",
            unique.clone(),
        );
        context.register(
            "accounts",
            "Number of accounts in the mempool",
            accounts.clone(),
        );
        context.register(
            "rejected_total",
            "Number of transactions rejected due to mempool limits",
            rejected_total.clone(),
        );
        context.register(
            "trimmed_total",
            "Number of transactions trimmed due to per-account backlog limits",
            trimmed_total.clone(),
        );

        // Initialize mempool
        Self {
            max_backlog,
            max_transactions,
            total_transactions: 0,
            tracked: HashMap::new(),
            min_inserted_at_ms: None,
            queue: Vec::new(),
            queue_positions: HashMap::new(),
            queue_cursor: 0,

            unique,
            accounts,
            rejected_total,
            trimmed_total,
        }
    }

    fn rebuild_queue(&mut self) {
        self.queue.clear();
        self.queue_positions.clear();
        for public in self.tracked.keys() {
            self.queue_positions.insert(public.clone(), self.queue.len());
            self.queue.push(public.clone());
        }
        self.queue_cursor = 0;
    }

    fn ensure_queue(&mut self) {
        if self.queue.is_empty() && !self.tracked.is_empty() {
            self.rebuild_queue();
        }
    }

    fn remove_from_queue(&mut self, public: &PublicKey) {
        let Some(idx) = self.queue_positions.remove(public) else {
            return;
        };

        let last_index = self.queue.len().saturating_sub(1);
        let removed = self.queue.swap_remove(idx);
        debug_assert_eq!(&removed, public);

        // Update position for the element that was moved into `idx`.
        if idx < self.queue.len() {
            let moved = self.queue[idx].clone();
            self.queue_positions.insert(moved, idx);
        }

        if self.queue.is_empty() {
            self.queue_cursor = 0;
            return;
        }

        // If the cursor pointed at the last element, it either moved to `idx` or was removed.
        if self.queue_cursor == last_index {
            if idx < self.queue.len() {
                self.queue_cursor = idx;
            } else {
                self.queue_cursor = 0;
            }
        }

        if self.queue_cursor >= self.queue.len() {
            self.queue_cursor = 0;
        }
    }

    /// Add a transaction to the mempool.
    pub fn add(&mut self, tx: Transaction, now_ms: i64) -> AddResult {
        // If there are too many transactions, ignore
        if self.total_transactions >= self.max_transactions {
            self.rejected_total.inc();
            return AddResult::Rejected(AddRejectReason::GlobalCapacity);
        }

        // Track the transaction.
        let tx_nonce = tx.nonce;
        let public = tx.public.clone();
        let (was_empty, entry_len, trimmed, trimmed_new_tx) = {
            let entry = self.tracked.entry(public.clone()).or_default();
            let was_empty = entry.is_empty();

            // If there already exists a transaction at some nonce, return.
            if entry.contains_key(&tx.nonce) {
                return AddResult::Rejected(AddRejectReason::DuplicateNonce);
            }

            // Insert the transaction into the mempool.
            let replaced = entry.insert(
                tx.nonce,
                MempoolEntry {
                    tx,
                    inserted_at_ms: now_ms,
                },
            );
            debug_assert!(
                replaced.is_none(),
                "duplicate nonce per account should have been filtered"
            );
            self.total_transactions += 1;
            match self.min_inserted_at_ms {
                Some(current_min) => {
                    if now_ms < current_min {
                        self.min_inserted_at_ms = Some(now_ms);
                    }
                }
                None => {
                    self.min_inserted_at_ms = Some(now_ms);
                }
            }

            // If there are too many transactions, remove the furthest in the future.
            let mut trimmed = false;
            let mut trimmed_new_tx = false;
            if entry.len() > self.max_backlog {
                trimmed = true;
                let removed = entry.pop_last();
                if let Some((removed_nonce, removed)) = removed {
                    if removed_nonce == tx_nonce {
                        trimmed_new_tx = true;
                    }
                    if Some(removed.inserted_at_ms) == self.min_inserted_at_ms {
                        self.min_inserted_at_ms = None;
                    }
                }
                self.total_transactions = self.total_transactions.saturating_sub(1);
                self.trimmed_total.inc();
            }

            (was_empty, entry.len(), trimmed, trimmed_new_tx)
        };

        // Avoid tracking empty per-account entries (can happen if `max_backlog == 0`).
        if entry_len == 0 {
            self.tracked.remove(&public);
            self.remove_from_queue(&public);
        } else if was_empty {
            // Add to queue if this is the first entry for this account.
            if self.queue_positions.contains_key(&public) {
                // Defensive: `tracked` should not contain empty entries, but avoid duplicating
                // queue entries if invariants were violated by earlier versions.
            } else {
                self.queue_positions
                    .insert(public.clone(), self.queue.len());
                self.queue.push(public);
            }
        }

        // Update metrics
        self.unique.set(self.total_transactions as i64);
        self.accounts.set(self.tracked.len() as i64);

        if trimmed_new_tx {
            return AddResult::Rejected(AddRejectReason::BacklogLimit);
        }

        AddResult::Added { trimmed }
    }

    /// Retain transactions for a given account with a minimum nonce.
    pub fn retain(&mut self, public: &PublicKey, min: u64) {
        // Remove any items no longer present
        let Some(tracked) = self.tracked.get_mut(public) else {
            return;
        };
        let removed_account = loop {
            let Some((nonce, entry)) = tracked.first_key_value() else {
                break true;
            };
            if nonce >= &min {
                break false;
            }
            if Some(entry.inserted_at_ms) == self.min_inserted_at_ms {
                self.min_inserted_at_ms = None;
            }
            tracked.pop_first();
            self.total_transactions = self.total_transactions.saturating_sub(1);
        };

        // If the account has no remaining transactions, remove it from the mempool.
        if removed_account {
            self.tracked.remove(public);
            self.remove_from_queue(public);
        }

        // Update metrics
        self.unique.set(self.total_transactions as i64);
        self.accounts.set(self.tracked.len() as i64);
    }

    /// Get the next transaction to process from the mempool (destructive).
    /// Note: This removes the transaction from the mempool. For non-destructive
    /// iteration, use `peek_batch` instead.
    #[allow(dead_code)]
    pub fn next(&mut self) -> Option<Transaction> {
        loop {
            self.ensure_queue();
            // Fast-path for empty mempool.
            if self.queue.is_empty() {
                self.unique.set(self.total_transactions as i64);
                self.accounts.set(self.tracked.len() as i64);
                return None;
            }

            if self.queue_cursor >= self.queue.len() {
                self.queue_cursor = 0;
            }

            // Pick the next account in round-robin order.
            let public = self.queue[self.queue_cursor].clone();

            let Some(tracked) = self.tracked.get_mut(&public) else {
                // Stale queue entry (shouldn't happen, but keep defensive hygiene).
                self.remove_from_queue(&public);
                continue;
            };

            let (tx, became_empty) = match tracked.pop_first() {
                Some((_, entry)) => {
                    if Some(entry.inserted_at_ms) == self.min_inserted_at_ms {
                        self.min_inserted_at_ms = None;
                    }
                    (Some(entry.tx), tracked.is_empty())
                }
                None => (None, true),
            };

            let Some(tx) = tx else {
                // Account has no transactions; drop it.
                self.tracked.remove(&public);
                self.remove_from_queue(&public);
                continue;
            };

            self.total_transactions = self.total_transactions.saturating_sub(1);
            if became_empty {
                self.tracked.remove(&public);
                self.remove_from_queue(&public);
            } else {
                // Move to the next account.
                self.queue_cursor = (self.queue_cursor + 1) % self.queue.len();
            }

            // Update metrics
            self.unique.set(self.total_transactions as i64);
            self.accounts.set(self.tracked.len() as i64);

            return Some(tx);
        }
    }

    /// Peek at the lowest-nonce transaction for each account (non-destructive).
    /// Returns up to `max_count` transactions without removing them from the mempool.
    /// Transactions are returned in round-robin order across accounts.
    pub fn peek_batch(&mut self, max_count: usize) -> Vec<Transaction> {
        if max_count == 0 {
            return Vec::new();
        }

        let mut attempt = 0;
        loop {
            self.ensure_queue();
            let mut result = Vec::with_capacity(max_count);
            if self.queue.is_empty() {
                if !self.tracked.is_empty() {
                    // Fallback: queue is stale; iterate tracked directly.
                    for tracked in self.tracked.values() {
                        if let Some((_, entry)) = tracked.first_key_value() {
                            result.push(entry.tx.clone());
                            if result.len() >= max_count {
                                break;
                            }
                        }
                    }
                }
                return result;
            }

            let mut cursor = self.queue_cursor;
            let mut accounts_visited = 0;
            let total_accounts = self.queue.len();

            // Visit each account at most once
            while result.len() < max_count && accounts_visited < total_accounts {
                if cursor >= self.queue.len() {
                    cursor = 0;
                }

                let public = &self.queue[cursor];
                if let Some(tracked) = self.tracked.get(public) {
                    if let Some((_, entry)) = tracked.first_key_value() {
                        result.push(entry.tx.clone());
                    }
                }

                cursor = (cursor + 1) % self.queue.len();
                accounts_visited += 1;
            }

            if !result.is_empty() || self.tracked.is_empty() || attempt > 0 {
                return result;
            }

            // If we saw only stale queue entries, rebuild and retry once.
            self.rebuild_queue();
            attempt += 1;
        }
    }

    pub fn stats(&self) -> (usize, usize) {
        (self.total_transactions, self.tracked.len())
    }

    /// Return the age in milliseconds of the oldest pending transaction, if any.
    pub fn oldest_age_ms(&mut self, now_ms: i64) -> Option<u64> {
        if self.total_transactions == 0 {
            self.min_inserted_at_ms = None;
            return None;
        }

        if self.min_inserted_at_ms.is_none() {
            let mut min: Option<i64> = None;
            for entries in self.tracked.values() {
                for entry in entries.values() {
                    min = match min {
                        Some(current) => Some(current.min(entry.inserted_at_ms)),
                        None => Some(entry.inserted_at_ms),
                    };
                }
            }
            self.min_inserted_at_ms = min;
        }

        let min = self.min_inserted_at_ms?;
        let age = now_ms.saturating_sub(min).max(0) as u64;
        Some(age)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use commonware_cryptography::Digestible;
    use commonware_cryptography::{ed25519::PrivateKey, Signer};
    use commonware_runtime::{deterministic, Metrics, Runner};
    use nullspace_types::execution::Instruction;

    #[test]
    fn test_add_single_transaction() {
        let runner = deterministic::Runner::default();
        runner.start(|ctx| async move {
            let mut mempool = Mempool::new(ctx);

            let private = PrivateKey::from_seed(1);
            let tx = Transaction::sign(&private, 0, Instruction::CasinoDeposit { amount: 100 });
            let public = tx.public.clone();

            mempool.add(tx, 0);

            assert_eq!(mempool.total_transactions, 1);
            assert_eq!(mempool.tracked.len(), 1);
            assert!(mempool.tracked.contains_key(&public));
            assert_eq!(mempool.queue.len(), 1);

            let tracked = mempool.tracked.get(&public).unwrap();
            let stored_tx = &tracked.get(&0).unwrap().tx;
            assert_eq!(stored_tx.public, public);
            assert_eq!(stored_tx.nonce, 0);
        });
    }

    #[test]
    fn test_add_duplicate_transaction() {
        let runner = deterministic::Runner::default();
        runner.start(|ctx| async move {
            let mut mempool = Mempool::new(ctx);

            let private = PrivateKey::from_seed(1);
            let tx = Transaction::sign(&private, 0, Instruction::CasinoDeposit { amount: 100 });

            mempool.add(tx.clone(), 0);
            mempool.add(tx, 0);

            assert_eq!(mempool.total_transactions, 1);
            assert_eq!(mempool.tracked.len(), 1);
            assert_eq!(mempool.queue.len(), 1);
        });
    }

    #[test]
    fn test_add_transaction_with_same_nonce_dropped() {
        let runner = deterministic::Runner::default();
        runner.start(|ctx| async move {
            let mut mempool = Mempool::new(ctx);

            let private = PrivateKey::from_seed(1);
            let tx1 = Transaction::sign(&private, 0, Instruction::CasinoDeposit { amount: 100 });
            let tx2 = Transaction::sign(&private, 0, Instruction::CasinoPlayerAction {
                action: nullspace_types::casino::PlayerAction::ToggleShield
            });
            let digest1 = tx1.digest();
            let digest2 = tx2.digest();
            let public = tx1.public.clone();

            mempool.add(tx1, 0);
            let tracked = mempool.tracked.get(&public).unwrap();
            assert_eq!(tracked.len(), 1);
            assert_eq!(tracked.get(&0).unwrap().tx.digest(), digest1);

            mempool.add(tx2, 0);
            let tracked = mempool.tracked.get(&public).unwrap();
            assert_eq!(tracked.len(), 1);
            assert_eq!(tracked.get(&0).unwrap().tx.digest(), digest1);
            assert_ne!(tracked.get(&0).unwrap().tx.digest(), digest2);
            assert_eq!(mempool.total_transactions, 1);
        });
    }

    #[test]
    fn test_add_multiple_transactions_same_account() {
        let runner = deterministic::Runner::default();
        runner.start(|ctx| async move {
            let mut mempool = Mempool::new(ctx);

            let private = PrivateKey::from_seed(1);

            for nonce in 0..5 {
                let tx =
                    Transaction::sign(&private, nonce, Instruction::CasinoDeposit { amount: 100 });
                mempool.add(tx, 0);
            }

            assert_eq!(mempool.total_transactions, 5);
            assert_eq!(mempool.tracked.len(), 1);
            assert_eq!(mempool.queue.len(), 1);
        });
    }

    #[test]
    fn test_add_exceeds_max_backlog() {
        let runner = deterministic::Runner::default();
        runner.start(|ctx| async move {
            let mut mempool = Mempool::new(ctx);

            let private = PrivateKey::from_seed(1);

            for nonce in 0..=DEFAULT_MAX_BACKLOG {
                let tx = Transaction::sign(
                    &private,
                    nonce as u64,
                    Instruction::CasinoDeposit { amount: 100 },
                );
                mempool.add(tx, 0);
            }

            assert_eq!(mempool.total_transactions, DEFAULT_MAX_BACKLOG);
            assert_eq!(mempool.tracked.len(), 1);

            let tracked = mempool.tracked.get(&private.public_key()).unwrap();
            assert_eq!(tracked.len(), DEFAULT_MAX_BACKLOG);
            assert!(tracked.contains_key(&0));
            assert!(!tracked.contains_key(&(DEFAULT_MAX_BACKLOG as u64))); // remove oldest when full
        });
    }

    #[test]
    fn test_add_multiple_accounts() {
        let runner = deterministic::Runner::default();
        runner.start(|ctx| async move {
            let mut mempool = Mempool::new(ctx);

            for seed in 0..5 {
                let private = PrivateKey::from_seed(seed);
                let tx = Transaction::sign(&private, 0, Instruction::CasinoDeposit { amount: 100 });
                mempool.add(tx, 0);
            }

            assert_eq!(mempool.total_transactions, 5);
            assert_eq!(mempool.tracked.len(), 5);
            assert_eq!(mempool.queue.len(), 5);
        });
    }

    #[test]
    fn test_retain_removes_old_transactions() {
        let runner = deterministic::Runner::default();
        runner.start(|ctx| async move {
            let mut mempool = Mempool::new(ctx);

            let private = PrivateKey::from_seed(1);
            let public = private.public_key();

            for nonce in 0..5 {
                let tx =
                    Transaction::sign(&private, nonce, Instruction::CasinoDeposit { amount: 100 });
                mempool.add(tx, 0);
            }

            mempool.retain(&public, 3);

            assert_eq!(mempool.total_transactions, 2);
            let tracked = mempool.tracked.get(&public).unwrap();
            assert!(!tracked.contains_key(&0));
            assert!(!tracked.contains_key(&1));
            assert!(!tracked.contains_key(&2));
            assert!(tracked.contains_key(&3));
            assert!(tracked.contains_key(&4));
        });
    }

    #[test]
    fn test_retain_removes_all_transactions() {
        let runner = deterministic::Runner::default();
        runner.start(|ctx| async move {
            let mut mempool = Mempool::new(ctx);

            let private = PrivateKey::from_seed(1);
            let public = private.public_key();

            for nonce in 0..3 {
                let tx =
                    Transaction::sign(&private, nonce, Instruction::CasinoDeposit { amount: 100 });
                mempool.add(tx, 0);
            }

            mempool.retain(&public, 5);

            assert_eq!(mempool.total_transactions, 0);
            assert!(!mempool.tracked.contains_key(&public));
        });
    }

    #[test]
    fn test_retain_nonexistent_account() {
        let runner = deterministic::Runner::default();
        runner.start(|ctx| async move {
            let mut mempool = Mempool::new(ctx);

            let private = PrivateKey::from_seed(1);
            let public = private.public_key();

            mempool.retain(&public, 0);

            assert_eq!(mempool.total_transactions, 0);
            assert_eq!(mempool.tracked.len(), 0);
        });
    }

    #[test]
    fn test_next_single_transaction() {
        let runner = deterministic::Runner::default();
        runner.start(|ctx| async move {
            let mut mempool = Mempool::new(ctx);

            let private = PrivateKey::from_seed(1);
            let tx = Transaction::sign(&private, 0, Instruction::CasinoDeposit { amount: 100 });
            let expected_nonce = tx.nonce;

            mempool.add(tx, 0);

            let next = mempool.next();
            assert!(next.is_some());
            assert_eq!(next.unwrap().nonce, expected_nonce);

            assert_eq!(mempool.total_transactions, 0);
            assert_eq!(mempool.tracked.len(), 0);
            assert_eq!(mempool.queue.len(), 0);
        });
    }

    #[test]
    fn test_next_multiple_transactions_same_account() {
        let runner = deterministic::Runner::default();
        runner.start(|ctx| async move {
            let mut mempool = Mempool::new(ctx);

            let private = PrivateKey::from_seed(1);

            for nonce in 0..3 {
                let tx =
                    Transaction::sign(&private, nonce, Instruction::CasinoDeposit { amount: 100 });
                mempool.add(tx, 0);
            }

            for expected_nonce in 0..3 {
                let next = mempool.next();
                assert!(next.is_some());
                assert_eq!(next.unwrap().nonce, expected_nonce);
            }

            assert_eq!(mempool.total_transactions, 0);
            assert_eq!(mempool.tracked.len(), 0);
            assert_eq!(mempool.queue.len(), 0);
        });
    }

    #[test]
    fn test_next_round_robin_between_accounts() {
        let runner = deterministic::Runner::default();
        runner.start(|ctx| async move {
            let mut mempool = Mempool::new(ctx);

            let mut privates = Vec::new();
            for seed in 0..3 {
                let private = PrivateKey::from_seed(seed);
                privates.push(private.clone());

                for nonce in 0..2 {
                    let tx = Transaction::sign(
                        &private,
                        nonce,
                        Instruction::CasinoDeposit { amount: 100 },
                    );
                    mempool.add(tx, 0);
                }
            }

            let mut account_counts = std::collections::HashMap::new();
            for _ in 0..6 {
                let next = mempool.next().unwrap();
                *account_counts.entry(next.public.clone()).or_insert(0) += 1;
            }

            for private in privates {
                assert_eq!(*account_counts.get(&private.public_key()).unwrap(), 2);
            }
        });
    }

    #[test]
    fn test_next_empty_mempool() {
        let runner = deterministic::Runner::default();
        runner.start(|ctx| async move {
            let mut mempool = Mempool::new(ctx);

            let next = mempool.next();
            assert!(next.is_none());
        });
    }

    #[test]
    fn test_next_skips_removed_addresses() {
        let runner = deterministic::Runner::default();
        runner.start(|ctx| async move {
            let mut mempool = Mempool::new(ctx);

            let private1 = PrivateKey::from_seed(1);
            let public1 = private1.public_key();

            let private2 = PrivateKey::from_seed(2);

            let tx1 = Transaction::sign(&private1, 0, Instruction::CasinoDeposit { amount: 100 });
            let tx2 = Transaction::sign(&private2, 0, Instruction::CasinoDeposit { amount: 200 });

            mempool.add(tx1, 0);
            mempool.add(tx2, 0);

            mempool.retain(&public1, 1);

            let next = mempool.next();
            assert!(next.is_some());
            assert_eq!(next.unwrap().public, private2.public_key());
        });
    }

    #[test]
    fn test_next_compacts_stale_queue_entries() {
        // Regression coverage: removing accounts via `retain` should also remove them
        // from the scheduling queue (no stale queue entries).
        let runner = deterministic::Runner::default();
        runner.start(|ctx| async move {
            let mut mempool = Mempool::new(ctx);

            let account_count = 1_025;
            let mut accounts = Vec::with_capacity(account_count);
            for seed in 0..account_count {
                let private = PrivateKey::from_seed(seed as u64);
                let public = private.public_key();
                accounts.push(public.clone());
                mempool.add(
                    Transaction::sign(&private, 0, Instruction::CasinoDeposit { amount: 1 }),
                    0,
                );
            }
            assert_eq!(mempool.total_transactions, account_count);
            assert_eq!(mempool.queue.len(), account_count);
            assert_eq!(mempool.queue_positions.len(), account_count);

            // Remove all transactions; this should also remove all queue entries.
            for public in accounts {
                mempool.retain(&public, 1);
            }
            assert_eq!(mempool.total_transactions, 0);
            assert_eq!(mempool.tracked.len(), 0);
            assert_eq!(mempool.queue_positions.len(), 0);
            assert_eq!(mempool.queue.len(), 0);

            // Calling `next()` should return `None`.
            assert!(mempool.next().is_none());
            assert_eq!(mempool.queue.len(), 0);
        });
    }

    #[test]
    fn test_max_transactions_limit() {
        let runner = deterministic::Runner::default();
        runner.start(|ctx| async move {
            let mut mempool = Mempool::new(ctx);

            for seed in 0..=DEFAULT_MAX_TRANSACTIONS {
                let private = PrivateKey::from_seed(seed as u64);
                let tx = Transaction::sign(&private, 0, Instruction::CasinoDeposit { amount: 100 });
                mempool.add(tx, 0);
            }

            assert_eq!(mempool.total_transactions, DEFAULT_MAX_TRANSACTIONS);
        });
    }

    #[test]
    fn test_metrics_updates() {
        let runner = deterministic::Runner::default();
        runner.start(|ctx| async move {
            let mut mempool = Mempool::new(ctx);

            assert_eq!(mempool.unique.get(), 0);
            assert_eq!(mempool.accounts.get(), 0);

            let private = PrivateKey::from_seed(1);
            let tx = Transaction::sign(&private, 0, Instruction::CasinoDeposit { amount: 100 });
            mempool.add(tx, 0);

            assert_eq!(mempool.unique.get(), 1);
            assert_eq!(mempool.accounts.get(), 1);

            mempool.next();

            assert_eq!(mempool.unique.get(), 0);
            assert_eq!(mempool.accounts.get(), 0);
        });
    }

    /// Helper to parse a prometheus gauge metric value from encoded metrics.
    fn parse_metric(metrics: &str, suffix: &str) -> Option<i64> {
        for line in metrics.lines() {
            if line.starts_with('#') {
                continue;
            }
            let mut parts = line.split_whitespace();
            let name = parts.next()?;
            let value_str = parts.next()?;
            if name.ends_with(suffix) {
                return value_str.parse::<i64>().ok();
            }
        }
        None
    }

    /// AC-1.2: mempool_pending_total stays in sync with internal count.
    #[test]
    fn test_mempool_pending_total_exported_via_prometheus() {
        let runner = deterministic::Runner::default();
        runner.start(|ctx| async move {
            let ctx = ctx.with_label("test_mempool");
            let mut mempool = Mempool::new(ctx.clone());

            // Initially empty
            let metrics = ctx.encode();
            let pending = parse_metric(&metrics, "_mempool_pending_total");
            assert_eq!(pending, Some(0), "mempool_pending_total should start at 0");

            // Add transactions
            let private = PrivateKey::from_seed(1);
            for nonce in 0..5 {
                let tx =
                    Transaction::sign(&private, nonce, Instruction::CasinoDeposit { amount: 100 });
                mempool.add(tx, 0);
            }

            let metrics = ctx.encode();
            let pending = parse_metric(&metrics, "_mempool_pending_total");
            assert_eq!(
                pending,
                Some(5),
                "mempool_pending_total should reflect 5 transactions"
            );

            // Remove some via retain
            mempool.retain(&private.public_key(), 3);

            let metrics = ctx.encode();
            let pending = parse_metric(&metrics, "_mempool_pending_total");
            assert_eq!(
                pending,
                Some(2),
                "mempool_pending_total should reflect 2 remaining transactions"
            );

            // Remove all
            mempool.retain(&private.public_key(), 10);

            let metrics = ctx.encode();
            let pending = parse_metric(&metrics, "_mempool_pending_total");
            assert_eq!(
                pending,
                Some(0),
                "mempool_pending_total should be 0 after all removed"
            );
        });
    }
}
