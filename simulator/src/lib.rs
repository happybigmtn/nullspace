use nullspace_types::{api::Pending, Identity};
use serde::Serialize;
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::{broadcast, RwLock};

mod api;
pub use api::Api;

mod explorer;
pub use explorer::{AccountActivity, ExplorerBlock, ExplorerState, ExplorerTransaction};
mod explorer_persistence;
use explorer_persistence::ExplorerPersistence;
mod metrics;
#[cfg(feature = "passkeys")]
mod passkeys;
#[cfg(feature = "passkeys")]
pub use passkeys::{PasskeyChallenge, PasskeyCredential, PasskeySession, PasskeyStore};

mod state;
pub use state::{ExplorerPersistenceBackpressure, InternalUpdate, SimulatorConfig, State};
use state::SubscriptionTracker;

use metrics::{
    HttpMetrics, HttpMetricsSnapshot, SystemMetrics, SystemMetricsSnapshot, UpdateIndexMetrics,
    UpdateIndexMetricsSnapshot,
};

#[derive(Default)]
pub struct WsMetrics {
    updates_lagged: AtomicU64,
    mempool_lagged: AtomicU64,
    updates_queue_full: AtomicU64,
    mempool_queue_full: AtomicU64,
    updates_send_errors: AtomicU64,
    mempool_send_errors: AtomicU64,
    updates_send_timeouts: AtomicU64,
    mempool_send_timeouts: AtomicU64,
}

#[derive(Default)]
struct WsConnectionTracker {
    total: usize,
    per_ip: HashMap<IpAddr, usize>,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct WsMetricsSnapshot {
    pub updates_lagged: u64,
    pub mempool_lagged: u64,
    pub updates_queue_full: u64,
    pub mempool_queue_full: u64,
    pub updates_send_errors: u64,
    pub mempool_send_errors: u64,
    pub updates_send_timeouts: u64,
    pub mempool_send_timeouts: u64,
}

impl WsMetrics {
    pub fn snapshot(&self) -> WsMetricsSnapshot {
        WsMetricsSnapshot {
            updates_lagged: self.updates_lagged.load(Ordering::Relaxed),
            mempool_lagged: self.mempool_lagged.load(Ordering::Relaxed),
            updates_queue_full: self.updates_queue_full.load(Ordering::Relaxed),
            mempool_queue_full: self.mempool_queue_full.load(Ordering::Relaxed),
            updates_send_errors: self.updates_send_errors.load(Ordering::Relaxed),
            mempool_send_errors: self.mempool_send_errors.load(Ordering::Relaxed),
            updates_send_timeouts: self.updates_send_timeouts.load(Ordering::Relaxed),
            mempool_send_timeouts: self.mempool_send_timeouts.load(Ordering::Relaxed),
        }
    }

    pub fn add_updates_lagged(&self, skipped: u64) {
        self.updates_lagged.fetch_add(skipped, Ordering::Relaxed);
    }

    pub fn add_mempool_lagged(&self, skipped: u64) {
        self.mempool_lagged.fetch_add(skipped, Ordering::Relaxed);
    }

    pub fn inc_updates_queue_full(&self) {
        self.updates_queue_full.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_mempool_queue_full(&self) {
        self.mempool_queue_full.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_updates_send_error(&self) {
        self.updates_send_errors.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_mempool_send_error(&self) {
        self.mempool_send_errors.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_updates_send_timeout(&self) {
        self.updates_send_timeouts.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_mempool_send_timeout(&self) {
        self.mempool_send_timeouts.fetch_add(1, Ordering::Relaxed);
    }
}

#[derive(Default)]
pub struct ExplorerMetrics {
    persistence_queue_depth: AtomicU64,
    persistence_queue_high_water: AtomicU64,
    persistence_queue_backpressure: AtomicU64,
    persistence_queue_dropped: AtomicU64,
    persistence_write_errors: AtomicU64,
    persistence_prune_errors: AtomicU64,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct ExplorerMetricsSnapshot {
    pub persistence_queue_depth: u64,
    pub persistence_queue_high_water: u64,
    pub persistence_queue_backpressure: u64,
    pub persistence_queue_dropped: u64,
    pub persistence_write_errors: u64,
    pub persistence_prune_errors: u64,
}

impl ExplorerMetrics {
    pub fn snapshot(&self) -> ExplorerMetricsSnapshot {
        ExplorerMetricsSnapshot {
            persistence_queue_depth: self.persistence_queue_depth.load(Ordering::Relaxed),
            persistence_queue_high_water: self
                .persistence_queue_high_water
                .load(Ordering::Relaxed),
            persistence_queue_backpressure: self
                .persistence_queue_backpressure
                .load(Ordering::Relaxed),
            persistence_queue_dropped: self.persistence_queue_dropped.load(Ordering::Relaxed),
            persistence_write_errors: self.persistence_write_errors.load(Ordering::Relaxed),
            persistence_prune_errors: self.persistence_prune_errors.load(Ordering::Relaxed),
        }
    }

    pub fn inc_queue_depth(&self) {
        let depth = self.persistence_queue_depth.fetch_add(1, Ordering::Relaxed) + 1;
        let mut current = self.persistence_queue_high_water.load(Ordering::Relaxed);
        while depth > current {
            match self.persistence_queue_high_water.compare_exchange_weak(
                current,
                depth,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(next) => current = next,
            }
        }
    }

    pub fn dec_queue_depth(&self) {
        let mut current = self.persistence_queue_depth.load(Ordering::Relaxed);
        while current > 0 {
            match self.persistence_queue_depth.compare_exchange_weak(
                current,
                current - 1,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(next) => current = next,
            }
        }
    }

    pub fn inc_queue_backpressure(&self) {
        self.persistence_queue_backpressure
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_queue_dropped(&self) {
        self.persistence_queue_dropped
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_write_error(&self) {
        self.persistence_write_errors.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_prune_error(&self) {
        self.persistence_prune_errors.fetch_add(1, Ordering::Relaxed);
    }
}

pub struct Simulator {
    identity: Identity,
    config: SimulatorConfig,
    state: Arc<RwLock<State>>,
    explorer: Arc<RwLock<ExplorerState>>,
    explorer_persistence: Option<ExplorerPersistence>,
    subscriptions: Arc<Mutex<SubscriptionTracker>>,
    update_tx: broadcast::Sender<InternalUpdate>,
    mempool_tx: broadcast::Sender<Pending>,
    ws_metrics: WsMetrics,
    explorer_metrics: Arc<ExplorerMetrics>,
    update_index_metrics: Arc<UpdateIndexMetrics>,
    http_metrics: HttpMetrics,
    system_metrics: SystemMetrics,
    ws_connections: Mutex<WsConnectionTracker>,
}

pub enum WsConnectionRejection {
    GlobalLimit,
    PerIpLimit,
}

pub struct WsConnectionGuard {
    simulator: Arc<Simulator>,
    ip: IpAddr,
}

impl Drop for WsConnectionGuard {
    fn drop(&mut self) {
        self.simulator.release_ws_connection(self.ip);
    }
}

impl Simulator {
    pub fn new(identity: Identity) -> Self {
        Self::new_with_config(identity, SimulatorConfig::default())
    }

    pub fn new_with_config(identity: Identity, config: SimulatorConfig) -> Self {
        let (update_tx, _) = broadcast::channel(config.updates_broadcast_capacity());
        let (mempool_tx, _) = broadcast::channel(config.mempool_broadcast_capacity());
        let state = Arc::new(RwLock::new(State::default()));
        let mut explorer = ExplorerState::default();
        explorer.set_retention(
            config.explorer_max_blocks,
            config.explorer_max_account_entries,
            config.explorer_max_accounts,
            config.explorer_max_game_event_accounts,
        );
        let explorer_metrics = Arc::new(ExplorerMetrics::default());
        let update_index_metrics = Arc::new(UpdateIndexMetrics::default());
        let explorer_persistence = if let Some(url) = config.explorer_persistence_url.as_deref() {
            if config.explorer_persistence_path.is_some() {
                tracing::warn!("Explorer persistence URL set; ignoring SQLite path.");
            }
            match ExplorerPersistence::load_and_start_postgres(
                url,
                &mut explorer,
                config.explorer_max_blocks,
                config.explorer_persistence_buffer_capacity(),
                config.explorer_persistence_batch_size(),
                config.explorer_persistence_backpressure_policy(),
                Arc::clone(&explorer_metrics),
            ) {
                Ok(persistence) => Some(persistence),
                Err(err) => {
                    tracing::warn!("Explorer persistence disabled: {err}");
                    None
                }
            }
        } else {
            match config.explorer_persistence_path.as_ref() {
                Some(path) => match ExplorerPersistence::load_and_start_sqlite(
                    path,
                    &mut explorer,
                    config.explorer_max_blocks,
                    config.explorer_persistence_buffer_capacity(),
                    config.explorer_persistence_batch_size(),
                    config.explorer_persistence_backpressure_policy(),
                    Arc::clone(&explorer_metrics),
                ) {
                    Ok(persistence) => Some(persistence),
                    Err(err) => {
                        tracing::warn!("Explorer persistence disabled: {err}");
                        None
                    }
                },
                None => None,
            }
        };
        let explorer = Arc::new(RwLock::new(explorer));

        Self {
            identity,
            config,
            state,
            explorer,
            explorer_persistence,
            subscriptions: Arc::new(Mutex::new(SubscriptionTracker::default())),
            update_tx,
            mempool_tx,
            ws_metrics: WsMetrics::default(),
            explorer_metrics,
            update_index_metrics,
            http_metrics: HttpMetrics::default(),
            system_metrics: SystemMetrics::new(),
            ws_connections: Mutex::new(WsConnectionTracker::default()),
        }
    }

    pub(crate) fn ws_metrics(&self) -> &WsMetrics {
        &self.ws_metrics
    }

    pub(crate) fn ws_metrics_snapshot(&self) -> WsMetricsSnapshot {
        self.ws_metrics.snapshot()
    }

    pub(crate) fn explorer_metrics_snapshot(&self) -> ExplorerMetricsSnapshot {
        self.explorer_metrics.snapshot()
    }

    pub(crate) fn update_index_metrics_snapshot(&self) -> UpdateIndexMetricsSnapshot {
        self.update_index_metrics.snapshot()
    }

    pub(crate) fn http_metrics(&self) -> &HttpMetrics {
        &self.http_metrics
    }

    pub(crate) fn http_metrics_snapshot(&self) -> HttpMetricsSnapshot {
        self.http_metrics.snapshot()
    }

    pub(crate) fn system_metrics_snapshot(&self) -> SystemMetricsSnapshot {
        self.system_metrics.snapshot()
    }

    pub(crate) fn try_acquire_ws_connection(
        self: &Arc<Self>,
        ip: IpAddr,
    ) -> Result<WsConnectionGuard, WsConnectionRejection> {
        let max_total = self.config.ws_max_connections;
        let max_per_ip = self.config.ws_max_connections_per_ip;
        let mut tracker = self.ws_connections.lock().unwrap();

        if let Some(limit) = max_total {
            if tracker.total >= limit {
                return Err(WsConnectionRejection::GlobalLimit);
            }
        }

        let current_ip = tracker.per_ip.get(&ip).copied().unwrap_or(0);
        if let Some(limit) = max_per_ip {
            if current_ip >= limit {
                return Err(WsConnectionRejection::PerIpLimit);
            }
        }

        tracker.total = tracker.total.saturating_add(1);
        tracker.per_ip.insert(ip, current_ip.saturating_add(1));
        Ok(WsConnectionGuard {
            simulator: Arc::clone(self),
            ip,
        })
    }

    fn release_ws_connection(&self, ip: IpAddr) {
        let mut tracker = self.ws_connections.lock().unwrap();
        tracker.total = tracker.total.saturating_sub(1);
        match tracker.per_ip.get_mut(&ip) {
            Some(count) if *count > 1 => {
                *count -= 1;
            }
            Some(_) => {
                tracker.per_ip.remove(&ip);
            }
            None => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use commonware_codec::Encode;
    use commonware_cryptography::{Hasher, Sha256};
    use commonware_runtime::{deterministic::Runner, Runner as _};
    use commonware_storage::adb::create_proof_store_from_digests;
    use commonware_storage::store::operation::{Keyless, Variable};
    use nullspace_execution::mocks::{
        create_account_keypair, create_adbs, create_network_keypair, create_seed, execute_block,
    };
    use nullspace_types::{
        api::{Events, Update, UpdatesFilter},
        execution::{Event, Instruction, Key, Output, Transaction, Value},
        Query as ChainQuery,
    };
    use std::sync::Arc;

    #[tokio::test]
    async fn test_submit_seed() {
        let (network_secret, network_identity) = create_network_keypair();
        let simulator = Simulator::new(network_identity);
        let (mut update_stream, _guard) =
            simulator.tracked_update_subscriber(UpdatesFilter::All);

        // Submit seed
        let seed = create_seed(&network_secret, 1);
        simulator.submit_seed(seed.clone()).await;
        let received_update = update_stream.recv().await.unwrap();
        match received_update {
            InternalUpdate::Seed(received_seed) => assert_eq!(received_seed, seed),
            _ => panic!("Expected seed update"),
        }
        assert_eq!(
            simulator.query_seed(&ChainQuery::Latest).await,
            Some(seed.clone())
        );
        assert_eq!(
            simulator.query_seed(&ChainQuery::Index(1)).await,
            Some(seed)
        );

        // Submit another seed
        let seed = create_seed(&network_secret, 3);
        simulator.submit_seed(seed.clone()).await;
        let received_update = update_stream.recv().await.unwrap();
        match received_update {
            InternalUpdate::Seed(received_seed) => assert_eq!(received_seed, seed),
            _ => panic!("Expected seed update"),
        }
        assert_eq!(
            simulator.query_seed(&ChainQuery::Latest).await,
            Some(seed.clone())
        );
        assert_eq!(simulator.query_seed(&ChainQuery::Index(2)).await, None);
        assert_eq!(
            simulator.query_seed(&ChainQuery::Index(3)).await,
            Some(seed.clone())
        );
    }

    #[tokio::test]
    async fn test_submit_transaction() {
        let (_, network_identity) = create_network_keypair();
        let simulator = Simulator::new(network_identity);
        let mut mempool_rx = simulator.mempool_subscriber();

        let (private, _) = create_account_keypair(1);
        let tx = Transaction::sign(
            &private,
            1,
            Instruction::CasinoRegister {
                name: "TestPlayer".to_string(),
            },
        );

        simulator.submit_transactions(vec![tx.clone()]);

        let received_txs = mempool_rx.recv().await.unwrap();
        assert_eq!(received_txs.transactions.len(), 1);
        let received_tx = &received_txs.transactions[0];
        assert_eq!(received_tx.public, tx.public);
        assert_eq!(received_tx.nonce, tx.nonce);
    }

    #[test]
    fn test_submit_summary() {
        let executor = Runner::default();
        executor.start(|context| async move {
            // Initialize databases
            let (network_secret, network_identity) = create_network_keypair();
            let simulator = Simulator::new(network_identity);
            let (mut state, mut events) = create_adbs(&context).await;

            // Create mock transaction - register a casino player
            let (private, public) = create_account_keypair(1);
            let tx = Transaction::sign(
                &private,
                0,
                Instruction::CasinoRegister {
                    name: "TestPlayer".to_string(),
                },
            );

            // Create summary using helper
            let (_, summary) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                1, // view
                vec![tx],
            )
            .await;

            // Verify the summary
            let (state_digests, events_digests) = summary
                .verify(&network_identity)
                .expect("Summary verification failed");

            // Submit events
            let (mut update_stream, _guard) =
                simulator.tracked_update_subscriber(UpdatesFilter::All);
            simulator
                .submit_events(summary.clone(), events_digests)
                .await;

            // Wait for events
            let update_recv = update_stream.recv().await.unwrap();
            match update_recv {
                InternalUpdate::Events(indexed) => {
                    let events_recv = indexed.events.as_ref();
                    events_recv.verify(&network_identity).unwrap();
                    assert_eq!(events_recv.events_proof, summary.events_proof);
                    assert_eq!(events_recv.events_proof_ops, summary.events_proof_ops);
                }
                _ => panic!("Expected events update"),
            }

            // Submit state
            simulator.submit_state(summary.clone(), state_digests).await;

            // Query for state
            let account_key = Sha256::hash(&Key::Account(public.clone()).encode());
            let lookup = simulator.query_state(&account_key).await.unwrap();
            lookup.verify(&network_identity).unwrap();
            let Variable::Update(_, Value::Account(account)) = lookup.operation else {
                panic!("account not found");
            };
            assert_eq!(account.nonce, 1);

            // Query for non-existent account
            let (_, other_public) = create_account_keypair(2);
            let other_key = Sha256::hash(&Key::Account(other_public).encode());
            assert!(simulator.query_state(&other_key).await.is_none());
        });
    }

    #[test]
    fn test_filtered_events() {
        let executor = Runner::default();
        executor.start(|context| async move {
            // Initialize
            let (network_secret, network_identity) = create_network_keypair();
            let simulator = Simulator::new(network_identity);
            let (mut state, mut events) = create_adbs(&context).await;

            // Create multiple accounts
            let (private1, public1) = create_account_keypair(1);
            let (private2, _public2) = create_account_keypair(2);
            let (private3, _public3) = create_account_keypair(3);

            // Create transactions from all accounts - register casino players
            let txs = vec![
                Transaction::sign(
                    &private1,
                    0,
                    Instruction::CasinoRegister {
                        name: "Player1".to_string(),
                    },
                ),
                Transaction::sign(
                    &private2,
                    0,
                    Instruction::CasinoRegister {
                        name: "Player2".to_string(),
                    },
                ),
                Transaction::sign(
                    &private3,
                    0,
                    Instruction::CasinoRegister {
                        name: "Player3".to_string(),
                    },
                ),
            ];

            // Execute block
            let (_, summary) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                1, // view
                txs,
            )
            .await;

            // Submit the summary
            let (state_digests, events_digests) = summary.verify(&network_identity).unwrap();
            simulator
                .submit_events(summary.clone(), events_digests.clone())
                .await;
            simulator.submit_state(summary.clone(), state_digests).await;

            // Store original count before moving
            let original_ops_count = summary.events_proof_ops.len();

            let events = Arc::new(Events {
                progress: summary.progress,
                certificate: summary.certificate,
                events_proof: summary.events_proof,
                events_proof_ops: summary.events_proof_ops,
            });
            let proof_store =
                Arc::new(create_proof_store_from_digests(&events.events_proof, events_digests));

            // Apply filter
            let indexed = crate::state::index_events(
                events,
                proof_store,
                None,
                SimulatorConfig::default().updates_index_concurrency(),
                Arc::new(UpdateIndexMetrics::default()),
            )
            .await;
            let filtered = indexed.update_for_account(&public1).unwrap();

            // Verify filtered events
            match filtered.update.as_ref() {
                Update::FilteredEvents(filtered_events) => {
                    // Count how many events are included
                    let included_count = filtered_events.events_proof_ops.len();

                    // Verify we only have events related to account1
                    for (_loc, op) in &filtered_events.events_proof_ops {
                        if let Keyless::Append(Output::Event(Event::CasinoPlayerRegistered {
                            player,
                            ..
                        })) = op
                        {
                            assert_eq!(
                                player, &public1,
                                "Filtered events should only contain account1"
                            );
                        }
                    }

                    // We should have filtered out events for account2 and account3
                    assert!(
                        included_count > 0,
                        "Should have at least one included event"
                    );
                    assert!(
                        included_count < original_ops_count,
                        "Should have filtered out some events"
                    );

                    // Verify the proof still validates with multi-proof verification
                    filtered_events
                        .verify(&network_identity)
                        .expect("Multi-proof verification should pass");
                }
                _ => panic!("Expected FilteredEvents"),
            }
        });
    }

    #[test]
    fn test_multiple_transactions_per_block() {
        let executor = Runner::default();
        executor.start(|context| async move {
            // Initialize
            let (network_secret, network_identity) = create_network_keypair();
            let simulator = Simulator::new(network_identity);
            let (mut state, mut events) = create_adbs(&context).await;

            // Create multiple accounts
            let accounts: Vec<_> = (0..5).map(create_account_keypair).collect();

            // Block 1: Multiple casino registrations in a single block
            let txs1: Vec<_> = accounts
                .iter()
                .enumerate()
                .map(|(i, (private, _))| {
                    Transaction::sign(
                        private,
                        0,
                        Instruction::CasinoRegister {
                            name: format!("Player{}", i),
                        },
                    )
                })
                .collect();

            let (_, summary1) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                1, // view
                txs1.clone(),
            )
            .await;

            // Verify and submit
            let (state_digests1, events_digests1) = summary1
                .verify(&network_identity)
                .expect("Summary 1 verification failed");
            simulator
                .submit_events(summary1.clone(), events_digests1)
                .await;
            simulator
                .submit_state(summary1.clone(), state_digests1)
                .await;

            // Verify height was inferred correctly (should be 1)
            assert_eq!(summary1.progress.height, 1);

            // Query each account to verify they were created
            for (_, public) in accounts.iter() {
                let account_key = Sha256::hash(&Key::Account(public.clone()).encode());
                let lookup = simulator.query_state(&account_key).await.unwrap();
                lookup.verify(&network_identity).unwrap();
                let Variable::Update(_, Value::Account(account)) = lookup.operation else {
                    panic!("Account not found for {public:?}");
                };
                assert_eq!(account.nonce, 1);
            }

            // Block 2: Deposit chips to subset of accounts
            let txs2: Vec<_> = accounts
                .iter()
                .take(3)
                .map(|(private, _)| {
                    Transaction::sign(private, 1, Instruction::CasinoDeposit { amount: 1000 })
                })
                .collect();

            let (_, summary2) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                5, // view
                txs2,
            )
            .await;

            // Verify and submit
            let (state_digests2, events_digests2) = summary2
                .verify(&network_identity)
                .expect("Summary 2 verification failed");
            simulator
                .submit_events(summary2.clone(), events_digests2)
                .await;
            simulator
                .submit_state(summary2.clone(), state_digests2)
                .await;

            // Verify height was inferred correctly (should be 2)
            assert_eq!(summary2.progress.height, 2);

            // Query accounts to verify nonce updates
            for (i, (_, public)) in accounts.iter().enumerate() {
                let account_key = Sha256::hash(&Key::Account(public.clone()).encode());
                let lookup = simulator.query_state(&account_key).await.unwrap();
                lookup.verify(&network_identity).unwrap();
                let Variable::Update(_, Value::Account(account)) = lookup.operation else {
                    panic!("Account not found for {public:?}");
                };
                // First 3 accounts should have nonce 2, others still 1
                let expected_nonce = if i < 3 { 2 } else { 1 };
                assert_eq!(account.nonce, expected_nonce);
            }
        });
    }
}
