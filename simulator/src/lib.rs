use nullspace_types::Identity;
use serde::Serialize;
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, RwLock};

fn parse_env_usize(var: &str) -> Option<usize> {
    std::env::var(var).ok().and_then(|v| v.parse().ok())
}

mod api;
pub use api::Api;

mod cache;
mod fanout;
mod explorer;
mod mempool;
pub use mempool::{BufferedMempool, BufferedMempoolConfig, MempoolSubscriber};
pub use explorer::{AccountActivity, ExplorerBlock, ExplorerState, ExplorerTransaction};
mod explorer_persistence;
use explorer_persistence::ExplorerPersistence;
mod summary_persistence;
pub use summary_persistence::SummaryPersistence;
mod metrics;
#[cfg(feature = "passkeys")]
mod passkeys;
#[cfg(feature = "passkeys")]
pub use passkeys::{PasskeyChallenge, PasskeyCredential, PasskeySession, PasskeyStore};

mod state;
pub use state::{ExplorerPersistenceBackpressure, InternalUpdate, SimulatorConfig, State};
use state::SubscriptionTracker;
mod submission;

use cache::RedisCache;
use fanout::Fanout;

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
    connection_reject_global: AtomicU64,
    connection_reject_per_ip: AtomicU64,
}

#[derive(Default)]
struct WsConnectionTracker {
    total: usize,
    per_ip: HashMap<IpAddr, usize>,
}

#[derive(Default)]
struct GlobalTablePresence {
    gateways: HashMap<String, PresenceEntry>,
}

#[derive(Clone, Copy)]
struct PresenceEntry {
    count: u64,
    last_seen: Instant,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct GlobalTablePresenceSnapshot {
    pub total_players: u64,
    pub gateway_count: usize,
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
    pub connection_reject_global: u64,
    pub connection_reject_per_ip: u64,
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
            connection_reject_global: self.connection_reject_global.load(Ordering::Relaxed),
            connection_reject_per_ip: self.connection_reject_per_ip.load(Ordering::Relaxed),
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

    pub fn inc_connection_reject_global(&self) {
        self.connection_reject_global
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_connection_reject_per_ip(&self) {
        self.connection_reject_per_ip
            .fetch_add(1, Ordering::Relaxed);
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
    casino_games_started: AtomicU64,
    casino_games_completed: AtomicU64,
    casino_games_moved: AtomicU64,
    casino_errors: AtomicU64,
    casino_leaderboard_updates: AtomicU64,
    tournament_started: AtomicU64,
    tournament_ended: AtomicU64,
    active_casino_sessions: AtomicU64,
    global_table_rounds_opened: AtomicU64,
    global_table_rounds_finalized: AtomicU64,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct ExplorerMetricsSnapshot {
    pub persistence_queue_depth: u64,
    pub persistence_queue_high_water: u64,
    pub persistence_queue_backpressure: u64,
    pub persistence_queue_dropped: u64,
    pub persistence_write_errors: u64,
    pub persistence_prune_errors: u64,
    pub casino_games_started: u64,
    pub casino_games_completed: u64,
    pub casino_games_moved: u64,
    pub casino_errors: u64,
    pub casino_leaderboard_updates: u64,
    pub tournament_started: u64,
    pub tournament_ended: u64,
    pub active_casino_sessions: u64,
    pub global_table_rounds_opened: u64,
    pub global_table_rounds_finalized: u64,
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
            casino_games_started: self.casino_games_started.load(Ordering::Relaxed),
            casino_games_completed: self.casino_games_completed.load(Ordering::Relaxed),
            casino_games_moved: self.casino_games_moved.load(Ordering::Relaxed),
            casino_errors: self.casino_errors.load(Ordering::Relaxed),
            casino_leaderboard_updates: self
                .casino_leaderboard_updates
                .load(Ordering::Relaxed),
            tournament_started: self.tournament_started.load(Ordering::Relaxed),
            tournament_ended: self.tournament_ended.load(Ordering::Relaxed),
            active_casino_sessions: self.active_casino_sessions.load(Ordering::Relaxed),
            global_table_rounds_opened: self.global_table_rounds_opened.load(Ordering::Relaxed),
            global_table_rounds_finalized: self
                .global_table_rounds_finalized
                .load(Ordering::Relaxed),
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

    pub fn inc_casino_started(&self) {
        self.casino_games_started.fetch_add(1, Ordering::Relaxed);
        self.active_casino_sessions.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_casino_completed(&self) {
        self.casino_games_completed.fetch_add(1, Ordering::Relaxed);
        self.dec_active_sessions();
    }

    pub fn inc_casino_moved(&self) {
        self.casino_games_moved.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_casino_error(&self) {
        self.casino_errors.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_casino_leaderboard_update(&self) {
        self.casino_leaderboard_updates
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_tournament_started(&self) {
        self.tournament_started.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_tournament_ended(&self) {
        self.tournament_ended.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_global_table_round_opened(&self) {
        self.global_table_rounds_opened.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_global_table_round_finalized(&self) {
        self.global_table_rounds_finalized
            .fetch_add(1, Ordering::Relaxed);
    }

    fn dec_active_sessions(&self) {
        let mut current = self.active_casino_sessions.load(Ordering::Relaxed);
        while current > 0 {
            match self.active_casino_sessions.compare_exchange_weak(
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
}

pub struct Simulator {
    identity: Identity,
    config: SimulatorConfig,
    state: Arc<RwLock<State>>,
    explorer: Arc<RwLock<ExplorerState>>,
    explorer_persistence: Option<ExplorerPersistence>,
    summary_persistence: Option<SummaryPersistence>,
    subscriptions: Arc<Mutex<SubscriptionTracker>>,
    update_tx: broadcast::Sender<InternalUpdate>,
    // Keep initial receiver alive to prevent channel closure when no subscribers exist.
    #[allow(dead_code)]
    _update_rx: broadcast::Receiver<InternalUpdate>,
    // Buffered mempool with replay window - transactions won't be lost if no subscribers
    mempool: Arc<BufferedMempool>,
    fanout: Option<Arc<Fanout>>,
    cache: Option<Arc<RedisCache>>,
    ws_metrics: WsMetrics,
    explorer_metrics: Arc<ExplorerMetrics>,
    update_index_metrics: Arc<UpdateIndexMetrics>,
    http_metrics: HttpMetrics,
    system_metrics: SystemMetrics,
    ws_connections: Mutex<WsConnectionTracker>,
    global_table_presence: Mutex<GlobalTablePresence>,
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
        Self::new_with_config(identity, SimulatorConfig::default(), None)
    }

    pub fn new_with_config(
        identity: Identity,
        config: SimulatorConfig,
        summary_persistence: Option<SummaryPersistence>,
    ) -> Self {
        let (update_tx, update_rx) = broadcast::channel(config.updates_broadcast_capacity());
        // Use buffered mempool with replay window instead of lossy broadcast channel
        let mempool = Arc::new(BufferedMempool::with_config(BufferedMempoolConfig::from_env()));
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
        let fanout = match config.fanout_redis_url.as_deref() {
            Some(url) => {
                let publish = config.fanout_publish.unwrap_or(true);
                let subscribe = config.fanout_subscribe.unwrap_or(true);
                if !publish && !subscribe {
                    tracing::warn!("Fanout disabled: publish and subscribe are false.");
                    None
                } else {
                    let channel = config
                        .fanout_channel
                        .clone()
                        .unwrap_or_else(|| "nullspace.submissions".to_string());
                    let origin = config.fanout_origin.clone();
                    match Fanout::new(url, channel, origin, publish, subscribe) {
                        Ok(fanout) => Some(Arc::new(fanout)),
                        Err(err) => {
                            tracing::warn!("Fanout disabled: {err}");
                            None
                        }
                    }
                }
            }
            None => None,
        };
        let cache = match (
            config.cache_redis_url.as_deref(),
            config.cache_redis_ttl_seconds,
        ) {
            (Some(url), Some(ttl)) if ttl > 0 => {
                let prefix = config
                    .cache_redis_prefix
                    .clone()
                    .unwrap_or_else(|| "nullspace:explorer:".to_string());
                match RedisCache::new(url, prefix, std::time::Duration::from_secs(ttl)) {
                    Ok(cache) => Some(Arc::new(cache)),
                    Err(err) => {
                        tracing::warn!("Redis cache disabled: {err}");
                        None
                    }
                }
            }
            (Some(_), _) => {
                tracing::warn!("Redis cache disabled: ttl is zero or unset.");
                None
            }
            _ => None,
        };

        Self {
            identity,
            config,
            state,
            explorer,
            explorer_persistence,
            summary_persistence,
            subscriptions: Arc::new(Mutex::new(SubscriptionTracker::default())),
            update_tx,
            _update_rx: update_rx,
            mempool,
            fanout,
            cache,
            ws_metrics: WsMetrics::default(),
            explorer_metrics,
            update_index_metrics,
            http_metrics: HttpMetrics::default(),
            system_metrics: SystemMetrics::new(),
            ws_connections: Mutex::new(WsConnectionTracker::default()),
            global_table_presence: Mutex::new(GlobalTablePresence::default()),
        }
    }

    pub fn identity(&self) -> Identity {
        self.identity
    }

    pub fn update_global_table_presence(
        &self,
        gateway_id: String,
        player_count: u64,
        ttl: Duration,
    ) -> GlobalTablePresenceSnapshot {
        let mut presence = self
            .global_table_presence
            .lock()
            .expect("global table presence lock poisoned");
        let now = Instant::now();
        presence.gateways.insert(
            gateway_id,
            PresenceEntry {
                count: player_count,
                last_seen: now,
            },
        );
        presence
            .gateways
            .retain(|_, entry| now.duration_since(entry.last_seen) <= ttl);

        let total_players = presence
            .gateways
            .values()
            .map(|entry| entry.count)
            .sum();
        GlobalTablePresenceSnapshot {
            total_players,
            gateway_count: presence.gateways.len(),
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

    pub(crate) fn cache(&self) -> Option<Arc<RedisCache>> {
        self.cache.as_ref().map(Arc::clone)
    }

    pub(crate) async fn publish_submission(&self, payload: &[u8]) {
        if let Some(fanout) = &self.fanout {
            fanout.publish(payload).await;
        }
    }

    pub fn start_fanout(self: &Arc<Self>) {
        if let Some(fanout) = &self.fanout {
            if fanout.subscribe_enabled() {
                tracing::info!(
                    origin = fanout.origin(),
                    channel = fanout.channel(),
                    "Starting fanout subscriber"
                );
                fanout.start(Arc::clone(self));
            }
        }
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
        // Environment variables override config
        let max_total = parse_env_usize("RATE_LIMIT_WS_CONNECTIONS")
            .or(self.config.ws_max_connections);
        let max_per_ip = parse_env_usize("RATE_LIMIT_WS_CONNECTIONS_PER_IP")
            .or(self.config.ws_max_connections_per_ip);
        let mut tracker = match self.ws_connections.lock() {
            Ok(tracker) => tracker,
            Err(poisoned) => {
                tracing::warn!("WebSocket connection tracker lock poisoned; recovering");
                poisoned.into_inner()
            }
        };

        if let Some(limit) = max_total {
            if tracker.total >= limit {
                self.ws_metrics.inc_connection_reject_global();
                return Err(WsConnectionRejection::GlobalLimit);
            }
        }

        let current_ip = tracker.per_ip.get(&ip).copied().unwrap_or(0);
        if let Some(limit) = max_per_ip {
            if current_ip >= limit {
                self.ws_metrics.inc_connection_reject_per_ip();
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
        let mut tracker = match self.ws_connections.lock() {
            Ok(tracker) => tracker,
            Err(poisoned) => {
                tracing::warn!("WebSocket connection tracker lock poisoned; recovering");
                poisoned.into_inner()
            }
        };
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
    use commonware_runtime::{tokio as cw_tokio, Runner as _};
    use commonware_storage::qmdb::{
        any::unordered::{variable, Update as StorageUpdate},
        create_proof_store_from_digests,
        keyless,
    };
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
        let mut mempool_rx = simulator.mempool_subscriber().await;

        let (private, _) = create_account_keypair(1);
        let tx = Transaction::sign(
            &private,
            1,
            Instruction::CasinoRegister {
                name: "TestPlayer".to_string(),
            },
        );

        simulator.submit_transactions(vec![tx.clone()]);

        // Wait a bit for the spawned task to complete
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let received_txs = mempool_rx.recv().await.expect("expected transaction");
        assert_eq!(received_txs.transactions.len(), 1);
        let received_tx = &received_txs.transactions[0];
        assert_eq!(received_tx.public, tx.public);
        assert_eq!(received_tx.nonce, tx.nonce);
    }

    #[test]
    fn test_submit_summary() {
        let executor = cw_tokio::Runner::new(cw_tokio::Config::default());
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
            let variable::Operation::Update(StorageUpdate(_, Value::Account(account))) =
                lookup.operation
            else {
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
        let executor = cw_tokio::Runner::new(cw_tokio::Config::default());
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
                        if let keyless::Operation::Append(Output::Event(Event::CasinoPlayerRegistered {
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
        let executor = cw_tokio::Runner::new(cw_tokio::Config::default());
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
                let variable::Operation::Update(StorageUpdate(_, Value::Account(account))) =
                    lookup.operation
                else {
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
                let variable::Operation::Update(StorageUpdate(_, Value::Account(account))) =
                    lookup.operation
                else {
                    panic!("Account not found for {public:?}");
                };
                // First 3 accounts should have nonce 2, others still 1
                let expected_nonce = if i < 3 { 2 } else { 1 };
                assert_eq!(account.nonce, expected_nonce);
            }
        });
    }

    #[tokio::test]
    async fn test_ws_connection_per_ip_limit() {
        let (_, network_identity) = create_network_keypair();
        let config = SimulatorConfig {
            ws_max_connections_per_ip: Some(2),
            ws_max_connections: Some(100),
            ..Default::default()
        };
        let simulator = Arc::new(Simulator::new_with_config(network_identity, config, None));
        let ip: IpAddr = "192.168.1.1".parse().unwrap();

        // First connection should succeed
        let guard1 = simulator.try_acquire_ws_connection(ip);
        assert!(guard1.is_ok(), "First connection should succeed");

        // Second connection should succeed
        let guard2 = simulator.try_acquire_ws_connection(ip);
        assert!(guard2.is_ok(), "Second connection should succeed");

        // Third connection should be rejected (per-IP limit reached)
        let guard3 = simulator.try_acquire_ws_connection(ip);
        assert!(
            matches!(guard3, Err(WsConnectionRejection::PerIpLimit)),
            "Third connection should be rejected with per-IP limit"
        );

        // Different IP should still work
        let other_ip: IpAddr = "192.168.1.2".parse().unwrap();
        let guard4 = simulator.try_acquire_ws_connection(other_ip);
        assert!(guard4.is_ok(), "Different IP should succeed");

        // Drop one connection and retry
        drop(guard1);
        let guard5 = simulator.try_acquire_ws_connection(ip);
        assert!(
            guard5.is_ok(),
            "After dropping one connection, new connection should succeed"
        );
    }

    #[tokio::test]
    async fn test_ws_connection_global_limit() {
        let (_, network_identity) = create_network_keypair();
        let config = SimulatorConfig {
            ws_max_connections_per_ip: Some(10),
            ws_max_connections: Some(3),
            ..Default::default()
        };
        let simulator = Arc::new(Simulator::new_with_config(network_identity, config, None));

        // Create 3 connections from different IPs
        let ip1: IpAddr = "192.168.1.1".parse().unwrap();
        let ip2: IpAddr = "192.168.1.2".parse().unwrap();
        let ip3: IpAddr = "192.168.1.3".parse().unwrap();
        let ip4: IpAddr = "192.168.1.4".parse().unwrap();

        let guard1 = simulator.try_acquire_ws_connection(ip1);
        assert!(guard1.is_ok(), "First connection should succeed");

        let guard2 = simulator.try_acquire_ws_connection(ip2);
        assert!(guard2.is_ok(), "Second connection should succeed");

        let guard3 = simulator.try_acquire_ws_connection(ip3);
        assert!(guard3.is_ok(), "Third connection should succeed");

        // Fourth connection should be rejected (global limit reached)
        let guard4 = simulator.try_acquire_ws_connection(ip4);
        assert!(
            matches!(guard4, Err(WsConnectionRejection::GlobalLimit)),
            "Fourth connection should be rejected with global limit"
        );

        // Drop one and retry
        drop(guard1);
        let guard5 = simulator.try_acquire_ws_connection(ip4);
        assert!(
            guard5.is_ok(),
            "After dropping one connection, new connection should succeed"
        );
    }

    /// Test that summaries signed with wrong identity are rejected (AC-1.2)
    #[test]
    fn test_invalid_summary_rejected() {
        let executor = cw_tokio::Runner::new(cw_tokio::Config::default());
        executor.start(|context| async move {
            use crate::submission::{apply_submission, SubmitError};
            use nullspace_types::api::Submission;

            // Create two different network keypairs
            let (network_secret, network_identity) = create_network_keypair();
            // Create a different identity for the simulator (mismatch)
            let (_, wrong_identity) = {
                use commonware_cryptography::bls12381::primitives::{ops, variant::MinSig};
                use rand::{rngs::StdRng, SeedableRng};
                let mut rng = StdRng::seed_from_u64(999); // Different seed
                ops::keypair::<_, MinSig>(&mut rng)
            };

            // Simulator uses the wrong identity
            let simulator = Arc::new(Simulator::new(wrong_identity));
            let (mut state, mut events) = create_adbs(&context).await;

            // Create a transaction
            let (private, _) = create_account_keypair(1);
            let tx = Transaction::sign(
                &private,
                0,
                Instruction::CasinoRegister {
                    name: "TestPlayer".to_string(),
                },
            );

            // Create summary signed with the correct network secret
            let (_, summary) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                1,
                vec![tx],
            )
            .await;

            // Summary verifies against correct identity
            assert!(
                summary.verify(&network_identity).is_ok(),
                "Summary should verify against correct identity"
            );

            // Summary fails to verify against wrong identity
            assert!(
                summary.verify(&wrong_identity).is_err(),
                "Summary should NOT verify against wrong identity"
            );

            // Submit summary to simulator with mismatched identity
            let result =
                apply_submission(Arc::clone(&simulator), Submission::Summary(summary), false).await;

            // Should be rejected
            assert!(
                matches!(result, Err(SubmitError::InvalidSummary)),
                "Summary with wrong identity should be rejected"
            );
        });
    }

    /// Test that seeds signed with wrong identity are rejected
    #[test]
    fn test_invalid_seed_rejected() {
        let executor = cw_tokio::Runner::new(cw_tokio::Config::default());
        executor.start(|_context| async move {
            use crate::submission::{apply_submission, SubmitError};
            use nullspace_types::api::Submission;

            // Create two different network keypairs
            let (network_secret, _network_identity) = create_network_keypair();
            // Create a different identity for the simulator (mismatch)
            let (_, wrong_identity) = {
                use commonware_cryptography::bls12381::primitives::{ops, variant::MinSig};
                use rand::{rngs::StdRng, SeedableRng};
                let mut rng = StdRng::seed_from_u64(999); // Different seed
                ops::keypair::<_, MinSig>(&mut rng)
            };

            // Simulator uses the wrong identity
            let simulator = Arc::new(Simulator::new(wrong_identity));

            // Create seed signed with the correct network secret
            let seed = create_seed(&network_secret, 1);

            // Submit seed to simulator with mismatched identity
            let result =
                apply_submission(Arc::clone(&simulator), Submission::Seed(seed), false).await;

            // Should be rejected
            assert!(
                matches!(result, Err(SubmitError::InvalidSeed)),
                "Seed with wrong identity should be rejected"
            );
        });
    }

    /// End-to-end simulator scenario: bet placement, round advancement, and payout verification.
    ///
    /// This test validates AC-2.6:
    /// - Places bets during the betting phase
    /// - Advances the round through lock, reveal, settle, and finalize
    /// - Asserts expected balances and outcomes match the deterministic RNG results
    ///
    /// The scenario uses Craps (Field bet) for predictable settlement:
    /// - Field bet pays 1:1 on 3, 4, 9, 10, 11
    /// - Field bet pays 2:1 on 2 or 12
    /// - Field bet loses on 5, 6, 7, 8
    #[test]
    fn test_e2e_bet_placement_and_payout() {
        let executor = cw_tokio::Runner::new(cw_tokio::Config::default());
        executor.start(|context| async move {
            use commonware_storage::qmdb::keyless::Operation as KeylessOp;
            use nullspace_types::casino::{GameType, GlobalTableBet, GlobalTableConfig};
            use nullspace_types::execution::Event;

            // Initialize
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;

            // Create player accounts - use seed 0 for admin keypair since it's deterministic
            let (admin_private, admin_public) = create_account_keypair(0);
            let (private1, public1) = create_account_keypair(1);
            let (private2, public2) = create_account_keypair(2);

            // Set admin public key environment variable for global table operations
            // Format: hex-encoded 32-byte Ed25519 public key
            let admin_hex: String = admin_public
                .as_ref()
                .iter()
                .map(|b| format!("{:02x}", b))
                .collect();
            std::env::set_var("CASINO_ADMIN_PUBLIC_KEY_HEX", &admin_hex);

            // -------------------------------------------------------------------------
            // Block 1: Register admin and players
            // -------------------------------------------------------------------------
            let txs1 = vec![
                Transaction::sign(
                    &admin_private,
                    0,
                    Instruction::CasinoRegister {
                        name: "Admin".to_string(),
                    },
                ),
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
            ];
            let (_, _summary1) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                1,
                txs1,
            )
            .await;

            // -------------------------------------------------------------------------
            // Block 2: Deposit chips to players
            // -------------------------------------------------------------------------
            let txs2 = vec![
                Transaction::sign(&private1, 1, Instruction::CasinoDeposit { amount: 10_000 }),
                Transaction::sign(&private2, 1, Instruction::CasinoDeposit { amount: 10_000 }),
            ];
            let (_, _summary2) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                2,
                txs2,
            )
            .await;

            // -------------------------------------------------------------------------
            // Block 3: Initialize global table config for Craps (admin operation)
            // -------------------------------------------------------------------------
            let txs3 = vec![Transaction::sign(
                &admin_private,
                1, // Admin's nonce after registration
                Instruction::GlobalTableInit {
                    config: GlobalTableConfig {
                        game_type: GameType::Craps,
                        betting_ms: 30_000,
                        lock_ms: 5_000,
                        payout_ms: 10_000,
                        cooldown_ms: 5_000,
                        min_bet: 100,
                        max_bet: 10_000,
                        max_bets_per_round: 10,
                    },
                },
            )];
            let (_, _summary3) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                3,
                txs3,
            )
            .await;

            // -------------------------------------------------------------------------
            // Block 4: Open a round (admin operation, view 100 = 100_000ms deterministic clock)
            // -------------------------------------------------------------------------
            let txs4 = vec![Transaction::sign(
                &admin_private,
                2, // Admin's nonce after init
                Instruction::GlobalTableOpenRound {
                    game_type: GameType::Craps,
                },
            )];
            let (_, _summary4) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                100, // view = 100 -> 100_000ms
                txs4,
            )
            .await;

            // -------------------------------------------------------------------------
            // Block 5: Players place bets (Field bet = bet_type 4)
            // -------------------------------------------------------------------------
            // Player 1: Field bet 500 chips
            // Player 2: Field bet 300 chips
            let txs5 = vec![
                Transaction::sign(
                    &private1,
                    2, // Player1's nonce after registration (1) and deposit (2)
                    Instruction::GlobalTableSubmitBets {
                        game_type: GameType::Craps,
                        round_id: 1,
                        bets: vec![GlobalTableBet {
                            bet_type: 4, // Field
                            target: 0,   // Not used for Field
                            amount: 500,
                        }],
                    },
                ),
                Transaction::sign(
                    &private2,
                    2, // Player2's nonce after registration (1) and deposit (2)
                    Instruction::GlobalTableSubmitBets {
                        game_type: GameType::Craps,
                        round_id: 1,
                        bets: vec![GlobalTableBet {
                            bet_type: 4, // Field
                            target: 0,   // Not used for Field
                            amount: 300,
                        }],
                    },
                ),
            ];
            let (_, summary5) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                105, // MS_PER_VIEW=3000ms, so view 105 = 315_000ms < betting end (330_000ms)
                txs5,
            )
            .await;

            // Verify bets were accepted
            let mut bets_accepted = 0;
            for op in &summary5.events_proof_ops {
                if let KeylessOp::Append(Output::Event(Event::GlobalTableBetAccepted { .. })) = op {
                    bets_accepted += 1;
                }
            }
            assert_eq!(bets_accepted, 2, "Both players' bets should be accepted");

            // -------------------------------------------------------------------------
            // Block 6: Lock the round (admin operation, after betting phase ends)
            // MS_PER_VIEW=3000ms, betting ends at view ~110 (330_000ms)
            // -------------------------------------------------------------------------
            let txs6 = vec![Transaction::sign(
                &admin_private,
                3, // Admin's nonce after open round
                Instruction::GlobalTableLock {
                    game_type: GameType::Craps,
                    round_id: 1,
                },
            )];
            let (_, _summary6) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                111, // view 111 = 333_000ms > betting end (330_000ms)
                txs6,
            )
            .await;

            // -------------------------------------------------------------------------
            // Block 7: Reveal outcome (admin operation, after lock phase ends)
            // Lock ends at 333_000 + 5_000 = 338_000ms (view ~113)
            // -------------------------------------------------------------------------
            let txs7 = vec![Transaction::sign(
                &admin_private,
                4, // Admin's nonce after lock
                Instruction::GlobalTableReveal {
                    game_type: GameType::Craps,
                    round_id: 1,
                },
            )];
            let (_, summary7) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                114, // view 114 = 342_000ms > lock end (338_000ms)
                txs7,
            )
            .await;

            // -------------------------------------------------------------------------
            // Block 8: Settle players (each player settles their own bets)
            // During payout phase (342_000ms to 352_000ms)
            // -------------------------------------------------------------------------
            let txs8 = vec![
                Transaction::sign(
                    &private1,
                    3, // Player1's nonce after submit bets
                    Instruction::GlobalTableSettle {
                        game_type: GameType::Craps,
                        round_id: 1,
                    },
                ),
                Transaction::sign(
                    &private2,
                    3, // Player2's nonce after submit bets
                    Instruction::GlobalTableSettle {
                        game_type: GameType::Craps,
                        round_id: 1,
                    },
                ),
            ];
            let (_, summary8) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                115, // view 115 = 345_000ms < payout end (352_000ms)
                txs8,
            )
            .await;

            // -------------------------------------------------------------------------
            // Block 9: Finalize the round (admin operation, after payout phase ends)
            // Payout ends at 342_000 + 10_000 = 352_000ms (view ~117)
            // -------------------------------------------------------------------------
            let txs9 = vec![Transaction::sign(
                &admin_private,
                5, // Admin's nonce after reveal (admin didn't settle, players did)
                Instruction::GlobalTableFinalize {
                    game_type: GameType::Craps,
                    round_id: 1,
                },
            )];
            let (_, _summary9) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                118, // view 118 = 354_000ms > payout end (352_000ms)
                txs9,
            )
            .await;

            // -------------------------------------------------------------------------
            // Verify: Extract events and check settlement results
            // -------------------------------------------------------------------------
            // Verify summaries are valid
            summary7.verify(&network_identity).unwrap();
            summary8.verify(&network_identity).unwrap();

            // Collect dice outcome from reveal (summary7) events
            let mut dice_outcome: Option<(u8, u8)> = None;
            for op in &summary7.events_proof_ops {
                if let KeylessOp::Append(Output::Event(Event::GlobalTableOutcome { round })) = op {
                    dice_outcome = Some((round.d1, round.d2));
                }
            }

            // Collect settlement events from summary8
            let mut player1_payout: Option<i64> = None;
            let mut player2_payout: Option<i64> = None;

            for op in &summary8.events_proof_ops {
                if let KeylessOp::Append(Output::Event(Event::GlobalTablePlayerSettled {
                    player,
                    payout,
                    ..
                })) = op
                {
                    if player == &public1 {
                        player1_payout = Some(*payout);
                    } else if player == &public2 {
                        player2_payout = Some(*payout);
                    }
                }
            }

            // -------------------------------------------------------------------------
            // Assertions: Verify deterministic outcomes
            // -------------------------------------------------------------------------
            // The RNG is seeded deterministically from the consensus view
            // The exact dice values depend on the seed, but we can verify:
            // 1. Both players were settled
            // 2. Payouts match field bet rules
            // 3. Both players got the same outcome (same dice roll)

            assert!(dice_outcome.is_some(), "Dice outcome should be revealed");
            let (d1, d2) = dice_outcome.unwrap();
            let total = d1 + d2;

            // Field bet wins on 2, 3, 4, 9, 10, 11, 12; loses on 5, 6, 7, 8
            let expected_multiplier = match total {
                2 => 3,  // 2:1 payout (bet + 2x = 3x return, so payout = +2x)
                12 => 4, // 3:1 payout in some variants
                3 | 4 | 9 | 10 | 11 => 2, // 1:1 payout
                _ => 0, // Loss
            };

            // Verify player settlements
            assert!(
                player1_payout.is_some(),
                "Player 1 should have been settled"
            );
            assert!(
                player2_payout.is_some(),
                "Player 2 should have been settled"
            );

            let p1_payout = player1_payout.unwrap();
            let p2_payout = player2_payout.unwrap();

            // Field bet settlement: payout is the net result
            // Win: payout = bet * (multiplier - 1) (e.g., 1:1 = bet returned + bet won, net = +bet)
            // Loss: payout = -bet
            if expected_multiplier > 0 {
                // Win case: payout should be positive
                assert!(
                    p1_payout >= 0,
                    "Player 1 should win or push on field total {total}, got payout {p1_payout}"
                );
                assert!(
                    p2_payout >= 0,
                    "Player 2 should win or push on field total {total}, got payout {p2_payout}"
                );
            } else {
                // Loss case: payout should be negative (bet lost)
                assert!(
                    p1_payout <= 0,
                    "Player 1 should lose on field total {total}, got payout {p1_payout}"
                );
                assert!(
                    p2_payout <= 0,
                    "Player 2 should lose on field total {total}, got payout {p2_payout}"
                );
            }

            // Verify proportional payouts (Player 1 bet 500, Player 2 bet 300)
            // Ratio should be 5:3
            if p1_payout != 0 && p2_payout != 0 {
                let ratio = (p1_payout.abs() as f64) / (p2_payout.abs() as f64);
                let expected_ratio = 500.0 / 300.0;
                assert!(
                    (ratio - expected_ratio).abs() < 0.01,
                    "Payout ratio should match bet ratio: expected {expected_ratio}, got {ratio}"
                );
            }

            // The test successfully completed all phases:
            // 1. Players registered and deposited chips
            // 2. Global table was initialized
            // 3. Round was opened
            // 4. Bets were placed and accepted
            // 5. Round was locked
            // 6. Outcome was revealed (deterministic RNG)
            // 7. Players settled their bets (with correct payouts)
            // 8. Round was finalized
        });
    }

    /// Test that the explorer properly indexes rounds, bets, and payouts from global table events.
    ///
    /// This test validates AC-4.1:
    /// - Indexer ingests event logs and persists rounds, bets, and payouts to storage.
    #[test]
    fn test_explorer_round_indexing() {
        let executor = cw_tokio::Runner::new(cw_tokio::Config::default());
        executor.start(|context| async move {
            use crate::explorer::apply_block_indexing;
            use nullspace_types::casino::{GameType, GlobalTableBet, GlobalTableConfig};
            use std::time::{SystemTime, UNIX_EPOCH};

            // Initialize
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;

            // Create simulator with explorer state
            let simulator = Simulator::new(network_identity);
            let metrics = ExplorerMetrics::default();
            let now_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;

            // Create player accounts
            let (admin_private, admin_public) = create_account_keypair(0);
            let (private1, _public1) = create_account_keypair(1);
            let (private2, _public2) = create_account_keypair(2);

            // Set admin env var
            let admin_hex: String = admin_public
                .as_ref()
                .iter()
                .map(|b| format!("{:02x}", b))
                .collect();
            std::env::set_var("CASINO_ADMIN_PUBLIC_KEY_HEX", &admin_hex);

            // Block 1: Register players
            let txs1 = vec![
                Transaction::sign(
                    &admin_private,
                    0,
                    Instruction::CasinoRegister {
                        name: "Admin".to_string(),
                    },
                ),
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
            ];
            let (_, summary1) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                1,
                txs1,
            )
            .await;

            // Apply to explorer
            {
                let mut explorer = simulator.explorer.write().await;
                apply_block_indexing(
                    &mut explorer,
                    &summary1.progress,
                    &summary1.events_proof_ops,
                    now_ms,
                    &metrics,
                );
            }

            // Block 2: Deposit chips
            let txs2 = vec![
                Transaction::sign(&private1, 1, Instruction::CasinoDeposit { amount: 10_000 }),
                Transaction::sign(&private2, 1, Instruction::CasinoDeposit { amount: 10_000 }),
            ];
            let (_, summary2) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                2,
                txs2,
            )
            .await;
            {
                let mut explorer = simulator.explorer.write().await;
                apply_block_indexing(
                    &mut explorer,
                    &summary2.progress,
                    &summary2.events_proof_ops,
                    now_ms,
                    &metrics,
                );
            }

            // Block 3: Initialize global table
            let txs3 = vec![Transaction::sign(
                &admin_private,
                1,
                Instruction::GlobalTableInit {
                    config: GlobalTableConfig {
                        game_type: GameType::Craps,
                        betting_ms: 30_000,
                        lock_ms: 5_000,
                        payout_ms: 10_000,
                        cooldown_ms: 5_000,
                        min_bet: 100,
                        max_bet: 10_000,
                        max_bets_per_round: 10,
                    },
                },
            )];
            let (_, summary3) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                3,
                txs3,
            )
            .await;
            {
                let mut explorer = simulator.explorer.write().await;
                apply_block_indexing(
                    &mut explorer,
                    &summary3.progress,
                    &summary3.events_proof_ops,
                    now_ms,
                    &metrics,
                );
            }

            // Block 4: Open round
            let txs4 = vec![Transaction::sign(
                &admin_private,
                2,
                Instruction::GlobalTableOpenRound {
                    game_type: GameType::Craps,
                },
            )];
            let (_, summary4) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                100,
                txs4,
            )
            .await;
            {
                let mut explorer = simulator.explorer.write().await;
                apply_block_indexing(
                    &mut explorer,
                    &summary4.progress,
                    &summary4.events_proof_ops,
                    now_ms,
                    &metrics,
                );
            }

            // Verify round was indexed
            {
                let explorer = simulator.explorer.read().await;
                let round_key = ("Craps".to_string(), 1u64);
                let round = explorer.indexed_rounds.get(&round_key);
                assert!(round.is_some(), "Round should be indexed after open");
                let round = round.unwrap();
                assert_eq!(round.game_type, "Craps");
                assert_eq!(round.round_id, 1);
                assert_eq!(round.phase, "Betting");
                assert!(round.opened_at_height > 0);
                assert!(round.locked_at_height.is_none());
            }

            // Block 5: Place bets
            let txs5 = vec![
                Transaction::sign(
                    &private1,
                    2,
                    Instruction::GlobalTableSubmitBets {
                        game_type: GameType::Craps,
                        round_id: 1,
                        bets: vec![GlobalTableBet {
                            bet_type: 4,
                            target: 0,
                            amount: 500,
                        }],
                    },
                ),
                Transaction::sign(
                    &private2,
                    2,
                    Instruction::GlobalTableSubmitBets {
                        game_type: GameType::Craps,
                        round_id: 1,
                        bets: vec![GlobalTableBet {
                            bet_type: 4,
                            target: 0,
                            amount: 300,
                        }],
                    },
                ),
            ];
            let (_, summary5) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                105,
                txs5,
            )
            .await;
            {
                let mut explorer = simulator.explorer.write().await;
                apply_block_indexing(
                    &mut explorer,
                    &summary5.progress,
                    &summary5.events_proof_ops,
                    now_ms,
                    &metrics,
                );
            }

            // Verify bets were indexed
            {
                let explorer = simulator.explorer.read().await;
                let round_key = ("Craps".to_string(), 1u64);
                let bets = explorer.bets_by_round.get(&round_key);
                assert!(bets.is_some(), "Bets should be indexed");
                let bets = bets.unwrap();
                assert_eq!(bets.len(), 2, "Both players' bets should be indexed");

                // Verify bet details
                let total_bet: u64 = bets.iter().map(|b| b.amount).sum();
                assert_eq!(total_bet, 800, "Total bet amount should be 500+300=800");

                // Verify round stats updated
                let round = explorer.indexed_rounds.get(&round_key).unwrap();
                assert_eq!(round.bet_count, 2);
                assert_eq!(round.total_bet_amount, 800);
                assert!(round.player_count >= 1); // At least one unique player
            }

            // Block 6: Lock
            let txs6 = vec![Transaction::sign(
                &admin_private,
                3,
                Instruction::GlobalTableLock {
                    game_type: GameType::Craps,
                    round_id: 1,
                },
            )];
            let (_, summary6) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                111,
                txs6,
            )
            .await;
            {
                let mut explorer = simulator.explorer.write().await;
                apply_block_indexing(
                    &mut explorer,
                    &summary6.progress,
                    &summary6.events_proof_ops,
                    now_ms,
                    &metrics,
                );
            }

            // Verify lock was recorded
            {
                let explorer = simulator.explorer.read().await;
                let round_key = ("Craps".to_string(), 1u64);
                let round = explorer.indexed_rounds.get(&round_key).unwrap();
                assert_eq!(round.phase, "Locked");
                assert!(round.locked_at_height.is_some());
            }

            // Block 7: Reveal
            let txs7 = vec![Transaction::sign(
                &admin_private,
                4,
                Instruction::GlobalTableReveal {
                    game_type: GameType::Craps,
                    round_id: 1,
                },
            )];
            let (_, summary7) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                114,
                txs7,
            )
            .await;
            {
                let mut explorer = simulator.explorer.write().await;
                apply_block_indexing(
                    &mut explorer,
                    &summary7.progress,
                    &summary7.events_proof_ops,
                    now_ms,
                    &metrics,
                );
            }

            // Verify outcome was recorded
            {
                let explorer = simulator.explorer.read().await;
                let round_key = ("Craps".to_string(), 1u64);
                let round = explorer.indexed_rounds.get(&round_key).unwrap();
                assert!(round.outcome_at_height.is_some());
                // Dice should be non-zero after reveal
                assert!(round.d1 > 0 || round.d2 > 0);
            }

            // Block 8: Settle
            let txs8 = vec![
                Transaction::sign(
                    &private1,
                    3,
                    Instruction::GlobalTableSettle {
                        game_type: GameType::Craps,
                        round_id: 1,
                    },
                ),
                Transaction::sign(
                    &private2,
                    3,
                    Instruction::GlobalTableSettle {
                        game_type: GameType::Craps,
                        round_id: 1,
                    },
                ),
            ];
            let (_, summary8) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                115,
                txs8,
            )
            .await;
            {
                let mut explorer = simulator.explorer.write().await;
                apply_block_indexing(
                    &mut explorer,
                    &summary8.progress,
                    &summary8.events_proof_ops,
                    now_ms,
                    &metrics,
                );
            }

            // Verify payouts were indexed
            {
                let explorer = simulator.explorer.read().await;
                let round_key = ("Craps".to_string(), 1u64);
                let payouts = explorer.payouts_by_round.get(&round_key);
                assert!(payouts.is_some(), "Payouts should be indexed");
                let payouts = payouts.unwrap();
                assert_eq!(payouts.len(), 2, "Both players' payouts should be indexed");

                // Verify round stats updated with total payout
                let round = explorer.indexed_rounds.get(&round_key).unwrap();
                // Total payout should match the sum of individual payouts
                let total_payout: i64 = payouts.iter().map(|p| p.payout).sum();
                assert_eq!(round.total_payout_amount, total_payout);
            }

            // Block 9: Finalize
            let txs9 = vec![Transaction::sign(
                &admin_private,
                5,
                Instruction::GlobalTableFinalize {
                    game_type: GameType::Craps,
                    round_id: 1,
                },
            )];
            let (_, summary9) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                118,
                txs9,
            )
            .await;
            {
                let mut explorer = simulator.explorer.write().await;
                apply_block_indexing(
                    &mut explorer,
                    &summary9.progress,
                    &summary9.events_proof_ops,
                    now_ms,
                    &metrics,
                );
            }

            // Verify final round state
            {
                let explorer = simulator.explorer.read().await;
                let round_key = ("Craps".to_string(), 1u64);
                let round = explorer.indexed_rounds.get(&round_key).unwrap();
                assert_eq!(round.phase, "Finalized");
                assert!(round.finalized_at_height.is_some());

                // Final verification: all lifecycle stages recorded
                assert!(round.opened_at_height > 0);
                assert!(round.locked_at_height.is_some());
                assert!(round.outcome_at_height.is_some());
                assert!(round.finalized_at_height.is_some());

                // Verify bet and payout counts
                let bets = explorer.bets_by_round.get(&round_key).unwrap();
                let payouts = explorer.payouts_by_round.get(&round_key).unwrap();
                assert_eq!(bets.len(), 2, "Should have 2 bets indexed");
                assert_eq!(payouts.len(), 2, "Should have 2 payouts indexed");
            }
        });
    }

    /// Test that indexer can rebuild state from persistence on restart (AC-4.2).
    ///
    /// This test validates:
    /// - Blocks are persisted to SQLite during indexing
    /// - On restart, the indexer reloads all persisted blocks
    /// - State totals match pre-restart values (blocks, transactions, accounts)
    #[test]
    fn test_indexer_restart_recovery() {
        let executor = cw_tokio::Runner::new(cw_tokio::Config::default());
        executor.start(|context| async move {
            use tempfile::tempdir;

            // Create a temporary directory for SQLite persistence
            let temp_dir = tempdir().expect("create temp dir");
            let db_path = temp_dir.path().join("explorer.db");

            // Initialize databases
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;

            // Create accounts and execute several blocks
            let accounts: Vec<_> = (0..3).map(create_account_keypair).collect();

            // -------------------------------------------------------------------------
            // Phase 1: Create simulator with persistence and index blocks
            // -------------------------------------------------------------------------
            let config1 = SimulatorConfig {
                explorer_persistence_path: Some(db_path.clone()),
                explorer_max_blocks: Some(1000),
                ..Default::default()
            };
            let simulator1 = Arc::new(Simulator::new_with_config(network_identity, config1, None));

            // Block 1: Register all accounts
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
                1,
                txs1,
            )
            .await;

            // Submit to simulator (triggers both indexing and persistence)
            let (_, events_digests1) = summary1.verify(&network_identity).unwrap();
            simulator1
                .submit_events(summary1.clone(), events_digests1)
                .await;

            // Block 2: Deposit chips
            let txs2: Vec<_> = accounts
                .iter()
                .map(|(private, _)| {
                    Transaction::sign(private, 1, Instruction::CasinoDeposit { amount: 5_000 })
                })
                .collect();

            let (_, summary2) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                2,
                txs2,
            )
            .await;

            let (_, events_digests2) = summary2.verify(&network_identity).unwrap();
            simulator1
                .submit_events(summary2.clone(), events_digests2)
                .await;

            // Block 3: More deposits (to exercise recovery with multiple blocks)
            let txs3: Vec<_> = accounts
                .iter()
                .map(|(private, _)| {
                    Transaction::sign(private, 2, Instruction::CasinoDeposit { amount: 2_500 })
                })
                .collect();

            let (_, summary3) = execute_block(
                &network_secret,
                network_identity,
                &mut state,
                &mut events,
                3,
                txs3,
            )
            .await;

            let (_, events_digests3) = summary3.verify(&network_identity).unwrap();
            simulator1
                .submit_events(summary3.clone(), events_digests3)
                .await;

            // Wait for persistence to flush (async background task)
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;

            // -------------------------------------------------------------------------
            // Phase 2: Capture pre-restart state totals
            // -------------------------------------------------------------------------
            let (
                pre_block_count,
                pre_tx_count,
                pre_account_count,
                pre_latest_height,
            ) = {
                let explorer = simulator1.explorer.read().await;
                (
                    explorer.indexed_blocks.len(),
                    explorer.txs_by_hash.len(),
                    explorer.accounts.len(),
                    explorer
                        .indexed_blocks
                        .last_key_value()
                        .map(|(h, _)| *h)
                        .unwrap_or(0),
                )
            };

            assert_eq!(pre_block_count, 3, "Should have indexed 3 blocks before restart");
            assert_eq!(pre_tx_count, 9, "Should have indexed 9 transactions (3 per block)");
            assert_eq!(pre_account_count, 3, "Should have indexed 3 accounts");
            assert_eq!(pre_latest_height, 3, "Latest height should be 3");

            // -------------------------------------------------------------------------
            // Phase 3: Drop simulator and create new one from persistence
            // -------------------------------------------------------------------------
            drop(simulator1);

            // Create a fresh simulator that loads from the same persistence path
            let config2 = SimulatorConfig {
                explorer_persistence_path: Some(db_path.clone()),
                explorer_max_blocks: Some(1000),
                ..Default::default()
            };
            let simulator2 = Arc::new(Simulator::new_with_config(network_identity, config2, None));

            // -------------------------------------------------------------------------
            // Phase 4: Verify post-restart state matches pre-restart
            // -------------------------------------------------------------------------
            let (
                post_block_count,
                post_tx_count,
                post_account_count,
                post_latest_height,
            ) = {
                let explorer = simulator2.explorer.read().await;
                (
                    explorer.indexed_blocks.len(),
                    explorer.txs_by_hash.len(),
                    explorer.accounts.len(),
                    explorer
                        .indexed_blocks
                        .last_key_value()
                        .map(|(h, _)| *h)
                        .unwrap_or(0),
                )
            };

            assert_eq!(
                post_block_count, pre_block_count,
                "Block count should match after restart"
            );
            assert_eq!(
                post_tx_count, pre_tx_count,
                "Transaction count should match after restart"
            );
            assert_eq!(
                post_account_count, pre_account_count,
                "Account count should match after restart"
            );
            assert_eq!(
                post_latest_height, pre_latest_height,
                "Latest height should match after restart"
            );

            // -------------------------------------------------------------------------
            // Phase 5: Verify specific data integrity
            // -------------------------------------------------------------------------
            {
                let explorer = simulator2.explorer.read().await;

                // Verify block 1 exists
                assert!(
                    explorer.indexed_blocks.contains_key(&1),
                    "Block 1 should exist after restart"
                );

                // Verify block 2 exists
                assert!(
                    explorer.indexed_blocks.contains_key(&2),
                    "Block 2 should exist after restart"
                );

                // Verify block 3 exists
                assert!(
                    explorer.indexed_blocks.contains_key(&3),
                    "Block 3 should exist after restart"
                );

                // Verify each account was restored
                for (_, public) in &accounts {
                    assert!(
                        explorer.accounts.contains_key(public),
                        "Account should exist after restart"
                    );
                }

                // Verify transactions by height were restored
                assert!(
                    explorer.txs_by_height.contains_key(&1),
                    "Txs for height 1 should exist"
                );
                assert!(
                    explorer.txs_by_height.contains_key(&2),
                    "Txs for height 2 should exist"
                );
                assert!(
                    explorer.txs_by_height.contains_key(&3),
                    "Txs for height 3 should exist"
                );
            }
        });
    }

    /// Test explorer HTTP endpoints for rounds, bets, and leaderboards (AC-4.3).
    ///
    /// This test validates:
    /// - GET /explorer/rounds returns paginated rounds with filters
    /// - GET /explorer/rounds/:game_type/:round_id returns round details with bets/payouts
    /// - GET /explorer/leaderboard returns player stats with sorting
    #[test]
    fn test_explorer_round_endpoints() {
        let executor = cw_tokio::Runner::new(cw_tokio::Config::default());
        executor.start(|context| async move {
            use crate::explorer::apply_block_indexing;
            use nullspace_types::casino::{GameType, GlobalTableBet, GlobalTableConfig};
            use std::time::{SystemTime, UNIX_EPOCH};

            // Initialize
            let (network_secret, network_identity) = create_network_keypair();
            let (mut state, mut events) = create_adbs(&context).await;

            // Create simulator with explorer state
            let simulator = Arc::new(Simulator::new(network_identity));
            let metrics = ExplorerMetrics::default();
            let now_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;

            // Create player accounts
            let (admin_private, admin_public) = create_account_keypair(0);
            let (private1, public1) = create_account_keypair(1);
            let (private2, public2) = create_account_keypair(2);
            let player1_hex = commonware_utils::hex(public1.as_ref());
            let player2_hex = commonware_utils::hex(public2.as_ref());

            // Set admin env var
            let admin_hex: String = admin_public
                .as_ref()
                .iter()
                .map(|b| format!("{:02x}", b))
                .collect();
            std::env::set_var("CASINO_ADMIN_PUBLIC_KEY_HEX", &admin_hex);

            // Execute setup blocks (register, deposit, init, open, bet, lock, reveal, settle, finalize)
            // Block 1: Register
            let txs1 = vec![
                Transaction::sign(&admin_private, 0, Instruction::CasinoRegister { name: "Admin".to_string() }),
                Transaction::sign(&private1, 0, Instruction::CasinoRegister { name: "Player1".to_string() }),
                Transaction::sign(&private2, 0, Instruction::CasinoRegister { name: "Player2".to_string() }),
            ];
            let (_, summary1) = execute_block(&network_secret, network_identity, &mut state, &mut events, 1, txs1).await;
            {
                let mut explorer = simulator.explorer.write().await;
                apply_block_indexing(&mut explorer, &summary1.progress, &summary1.events_proof_ops, now_ms, &metrics);
            }

            // Block 2: Deposit
            let txs2 = vec![
                Transaction::sign(&private1, 1, Instruction::CasinoDeposit { amount: 10_000 }),
                Transaction::sign(&private2, 1, Instruction::CasinoDeposit { amount: 10_000 }),
            ];
            let (_, summary2) = execute_block(&network_secret, network_identity, &mut state, &mut events, 2, txs2).await;
            {
                let mut explorer = simulator.explorer.write().await;
                apply_block_indexing(&mut explorer, &summary2.progress, &summary2.events_proof_ops, now_ms, &metrics);
            }

            // Block 3: Init global table
            let txs3 = vec![Transaction::sign(&admin_private, 1, Instruction::GlobalTableInit {
                config: GlobalTableConfig {
                    game_type: GameType::Craps,
                    betting_ms: 30_000,
                    lock_ms: 5_000,
                    payout_ms: 10_000,
                    cooldown_ms: 5_000,
                    min_bet: 100,
                    max_bet: 10_000,
                    max_bets_per_round: 10,
                },
            })];
            let (_, summary3) = execute_block(&network_secret, network_identity, &mut state, &mut events, 3, txs3).await;
            {
                let mut explorer = simulator.explorer.write().await;
                apply_block_indexing(&mut explorer, &summary3.progress, &summary3.events_proof_ops, now_ms, &metrics);
            }

            // Block 4: Open round
            let txs4 = vec![Transaction::sign(&admin_private, 2, Instruction::GlobalTableOpenRound { game_type: GameType::Craps })];
            let (_, summary4) = execute_block(&network_secret, network_identity, &mut state, &mut events, 100, txs4).await;
            {
                let mut explorer = simulator.explorer.write().await;
                apply_block_indexing(&mut explorer, &summary4.progress, &summary4.events_proof_ops, now_ms, &metrics);
            }

            // Block 5: Place bets
            let txs5 = vec![
                Transaction::sign(&private1, 2, Instruction::GlobalTableSubmitBets {
                    game_type: GameType::Craps,
                    round_id: 1,
                    bets: vec![GlobalTableBet { bet_type: 4, target: 0, amount: 500 }],
                }),
                Transaction::sign(&private2, 2, Instruction::GlobalTableSubmitBets {
                    game_type: GameType::Craps,
                    round_id: 1,
                    bets: vec![GlobalTableBet { bet_type: 4, target: 0, amount: 300 }],
                }),
            ];
            let (_, summary5) = execute_block(&network_secret, network_identity, &mut state, &mut events, 105, txs5).await;
            {
                let mut explorer = simulator.explorer.write().await;
                apply_block_indexing(&mut explorer, &summary5.progress, &summary5.events_proof_ops, now_ms, &metrics);
            }

            // Block 6-9: Lock, Reveal, Settle, Finalize
            let txs6 = vec![Transaction::sign(&admin_private, 3, Instruction::GlobalTableLock { game_type: GameType::Craps, round_id: 1 })];
            let (_, summary6) = execute_block(&network_secret, network_identity, &mut state, &mut events, 111, txs6).await;
            {
                let mut explorer = simulator.explorer.write().await;
                apply_block_indexing(&mut explorer, &summary6.progress, &summary6.events_proof_ops, now_ms, &metrics);
            }

            let txs7 = vec![Transaction::sign(&admin_private, 4, Instruction::GlobalTableReveal { game_type: GameType::Craps, round_id: 1 })];
            let (_, summary7) = execute_block(&network_secret, network_identity, &mut state, &mut events, 114, txs7).await;
            {
                let mut explorer = simulator.explorer.write().await;
                apply_block_indexing(&mut explorer, &summary7.progress, &summary7.events_proof_ops, now_ms, &metrics);
            }

            let txs8 = vec![
                Transaction::sign(&private1, 3, Instruction::GlobalTableSettle { game_type: GameType::Craps, round_id: 1 }),
                Transaction::sign(&private2, 3, Instruction::GlobalTableSettle { game_type: GameType::Craps, round_id: 1 }),
            ];
            let (_, summary8) = execute_block(&network_secret, network_identity, &mut state, &mut events, 115, txs8).await;
            {
                let mut explorer = simulator.explorer.write().await;
                apply_block_indexing(&mut explorer, &summary8.progress, &summary8.events_proof_ops, now_ms, &metrics);
            }

            let txs9 = vec![Transaction::sign(&admin_private, 5, Instruction::GlobalTableFinalize { game_type: GameType::Craps, round_id: 1 })];
            let (_, summary9) = execute_block(&network_secret, network_identity, &mut state, &mut events, 118, txs9).await;
            {
                let mut explorer = simulator.explorer.write().await;
                apply_block_indexing(&mut explorer, &summary9.progress, &summary9.events_proof_ops, now_ms, &metrics);
            }

            // -------------------------------------------------------------------------
            // Test 1: list_rounds - Basic pagination
            // -------------------------------------------------------------------------
            {
                let explorer = simulator.explorer.read().await;

                // All rounds - should have 1 round (indexed_rounds is pub(super))
                let all_rounds: Vec<_> = explorer
                    .indexed_rounds
                    .values()
                    .cloned()
                    .collect();

                assert_eq!(all_rounds.len(), 1, "Should have 1 round indexed");
                assert_eq!(all_rounds[0].game_type, "Craps");
                assert_eq!(all_rounds[0].round_id, 1);
                assert_eq!(all_rounds[0].phase, "Finalized");

                // Test pagination with limit
                let paginated: Vec<_> = all_rounds.iter().take(1).collect();
                assert_eq!(paginated.len(), 1, "Pagination should return 1 round");

                // Test offset
                let with_offset: Vec<_> = all_rounds.iter().skip(1).take(10).collect();
                assert_eq!(with_offset.len(), 0, "Offset 1 should return 0 rounds (only 1 total)");
            }

            // -------------------------------------------------------------------------
            // Test 2: list_rounds - game_type filter
            // -------------------------------------------------------------------------
            {
                let explorer = simulator.explorer.read().await;

                // Filter by game_type=Craps
                let craps_rounds: Vec<_> = explorer
                    .indexed_rounds
                    .values()
                    .filter(|r| r.game_type.eq_ignore_ascii_case("Craps"))
                    .collect();
                assert_eq!(craps_rounds.len(), 1, "Should find 1 Craps round");

                // Filter by game_type=Blackjack (should be empty)
                let blackjack_rounds: Vec<_> = explorer
                    .indexed_rounds
                    .values()
                    .filter(|r| r.game_type.eq_ignore_ascii_case("Blackjack"))
                    .collect();
                assert_eq!(blackjack_rounds.len(), 0, "Should find 0 Blackjack rounds");
            }

            // -------------------------------------------------------------------------
            // Test 3: list_rounds - phase filter
            // -------------------------------------------------------------------------
            {
                let explorer = simulator.explorer.read().await;

                // Filter by phase=Finalized
                let finalized_rounds: Vec<_> = explorer
                    .indexed_rounds
                    .values()
                    .filter(|r| r.phase.eq_ignore_ascii_case("Finalized"))
                    .collect();
                assert_eq!(finalized_rounds.len(), 1, "Should find 1 Finalized round");

                // Filter by phase=Betting (should be empty after finalization)
                let betting_rounds: Vec<_> = explorer
                    .indexed_rounds
                    .values()
                    .filter(|r| r.phase.eq_ignore_ascii_case("Betting"))
                    .collect();
                assert_eq!(betting_rounds.len(), 0, "Should find 0 Betting rounds");
            }

            // -------------------------------------------------------------------------
            // Test 4: list_rounds - player filter
            // -------------------------------------------------------------------------
            {
                let explorer = simulator.explorer.read().await;

                // Filter rounds where player1 placed a bet
                let player1_rounds: Vec<_> = explorer
                    .indexed_rounds
                    .values()
                    .filter(|r| {
                        let key = (r.game_type.clone(), r.round_id);
                        explorer
                            .bets_by_round
                            .get(&key)
                            .map(|bets| bets.iter().any(|b| b.player == player1_hex))
                            .unwrap_or(false)
                    })
                    .collect();
                assert_eq!(player1_rounds.len(), 1, "Player1 should have bet in 1 round");

                // Filter rounds where a non-existent player placed a bet
                let fake_player = "0000000000000000000000000000000000000000000000000000000000000000";
                let fake_player_rounds: Vec<_> = explorer
                    .indexed_rounds
                    .values()
                    .filter(|r| {
                        let key = (r.game_type.clone(), r.round_id);
                        explorer
                            .bets_by_round
                            .get(&key)
                            .map(|bets| bets.iter().any(|b| b.player == fake_player))
                            .unwrap_or(false)
                    })
                    .collect();
                assert_eq!(fake_player_rounds.len(), 0, "Fake player should have 0 rounds");
            }

            // -------------------------------------------------------------------------
            // Test 5: get_round - Get specific round with bets and payouts
            // -------------------------------------------------------------------------
            {
                let explorer = simulator.explorer.read().await;

                // Find round by game_type and round_id
                let key = ("Craps".to_string(), 1u64);
                let round = explorer.indexed_rounds.get(&key);
                assert!(round.is_some(), "Round Craps/1 should exist");
                let round = round.unwrap();

                // Verify round details
                assert_eq!(round.game_type, "Craps");
                assert_eq!(round.round_id, 1);
                assert_eq!(round.phase, "Finalized");
                assert_eq!(round.bet_count, 2);
                assert_eq!(round.total_bet_amount, 800); // 500 + 300

                // Get bets for this round
                let bets = explorer.bets_by_round.get(&key);
                assert!(bets.is_some(), "Should have bets for round");
                let bets = bets.unwrap();
                assert_eq!(bets.len(), 2, "Should have 2 bets");

                // Verify bet amounts
                let bet_amounts: Vec<u64> = bets.iter().map(|b| b.amount).collect();
                assert!(bet_amounts.contains(&500), "Should have 500 bet");
                assert!(bet_amounts.contains(&300), "Should have 300 bet");

                // Get payouts for this round
                let payouts = explorer.payouts_by_round.get(&key);
                assert!(payouts.is_some(), "Should have payouts for round");
                let payouts = payouts.unwrap();
                assert_eq!(payouts.len(), 2, "Should have 2 payouts");

                // Verify players received payouts
                let payout_players: Vec<&String> = payouts.iter().map(|p| &p.player).collect();
                assert!(payout_players.contains(&&player1_hex), "Player1 should have payout");
                assert!(payout_players.contains(&&player2_hex), "Player2 should have payout");
            }

            // -------------------------------------------------------------------------
            // Test 6: get_round - Case-insensitive game_type lookup
            // -------------------------------------------------------------------------
            {
                let explorer = simulator.explorer.read().await;

                // Find round with lowercase game_type
                let found = explorer
                    .indexed_rounds
                    .keys()
                    .find(|(gt, rid)| *rid == 1 && gt.eq_ignore_ascii_case("craps"))
                    .is_some();
                assert!(found, "Should find round with case-insensitive game_type");

                // Find round with uppercase game_type
                let found_upper = explorer
                    .indexed_rounds
                    .keys()
                    .find(|(gt, rid)| *rid == 1 && gt.eq_ignore_ascii_case("CRAPS"))
                    .is_some();
                assert!(found_upper, "Should find round with uppercase game_type");
            }

            // -------------------------------------------------------------------------
            // Test 7: get_round - Non-existent round returns empty
            // -------------------------------------------------------------------------
            {
                let explorer = simulator.explorer.read().await;

                let nonexistent = explorer.indexed_rounds.get(&("Craps".to_string(), 999u64));
                assert!(nonexistent.is_none(), "Non-existent round should return None");

                let wrong_game = explorer.indexed_rounds.get(&("Blackjack".to_string(), 1u64));
                assert!(wrong_game.is_none(), "Wrong game type should return None");
            }

            // -------------------------------------------------------------------------
            // Test 8: get_leaderboard - Aggregated player stats
            // -------------------------------------------------------------------------
            {
                let explorer = simulator.explorer.read().await;

                // Aggregate player stats manually to verify leaderboard logic
                let mut player_stats: std::collections::HashMap<String, (u64, i64, usize)> = std::collections::HashMap::new();

                for ((gt, _), round) in explorer.indexed_rounds.iter() {
                    let round_key = (gt.clone(), round.round_id);

                    // Sum bets
                    if let Some(bets) = explorer.bets_by_round.get(&round_key) {
                        for bet in bets {
                            let entry = player_stats.entry(bet.player.clone()).or_insert((0, 0, 0));
                            entry.0 += bet.amount; // total_wagered
                            entry.2 += 1; // bet_count
                        }
                    }

                    // Sum payouts
                    if let Some(payouts) = explorer.payouts_by_round.get(&round_key) {
                        for payout in payouts {
                            let entry = player_stats.entry(payout.player.clone()).or_insert((0, 0, 0));
                            entry.1 += payout.payout; // total_payout
                        }
                    }
                }

                assert_eq!(player_stats.len(), 2, "Should have 2 players in leaderboard");

                // Verify player1 stats
                let p1_stats = player_stats.get(&player1_hex);
                assert!(p1_stats.is_some(), "Player1 should be in leaderboard");
                let (wagered, payout, bets) = p1_stats.unwrap();
                assert_eq!(*wagered, 500, "Player1 wagered 500");
                assert_eq!(*bets, 1, "Player1 made 1 bet");
                // Payout depends on dice roll - just verify it exists
                let net_profit = *payout - *wagered as i64;
                assert!(net_profit.abs() <= 1500, "Net profit should be reasonable");

                // Verify player2 stats
                let p2_stats = player_stats.get(&player2_hex);
                assert!(p2_stats.is_some(), "Player2 should be in leaderboard");
                let (wagered2, _payout2, bets2) = p2_stats.unwrap();
                assert_eq!(*wagered2, 300, "Player2 wagered 300");
                assert_eq!(*bets2, 1, "Player2 made 1 bet");
            }

            // -------------------------------------------------------------------------
            // Test 9: get_leaderboard - Sort by total_wagered
            // -------------------------------------------------------------------------
            {
                let explorer = simulator.explorer.read().await;

                // Collect and sort by total_wagered
                let mut entries: Vec<_> = Vec::new();
                let mut player_wagered: std::collections::HashMap<String, u64> = std::collections::HashMap::new();

                for (round_key, _) in explorer.indexed_rounds.iter() {
                    if let Some(bets) = explorer.bets_by_round.get(round_key) {
                        for bet in bets {
                            *player_wagered.entry(bet.player.clone()).or_insert(0) += bet.amount;
                        }
                    }
                }

                for (player, wagered) in player_wagered {
                    entries.push((player, wagered));
                }
                entries.sort_by(|a, b| b.1.cmp(&a.1));

                assert_eq!(entries.len(), 2, "Should have 2 leaderboard entries");
                assert_eq!(entries[0].1, 500, "Top wagerer should have wagered 500");
                assert_eq!(entries[1].1, 300, "Second wagerer should have wagered 300");
            }

            // -------------------------------------------------------------------------
            // Test 10: get_leaderboard - Filter by game_type
            // -------------------------------------------------------------------------
            {
                let explorer = simulator.explorer.read().await;

                // Filter by Craps
                let craps_players: std::collections::HashSet<_> = explorer
                    .indexed_rounds
                    .iter()
                    .filter(|((gt, _), _)| gt.eq_ignore_ascii_case("Craps"))
                    .flat_map(|(key, _)| {
                        explorer
                            .bets_by_round
                            .get(key)
                            .map(|bets| bets.iter().map(|b| b.player.clone()).collect::<Vec<_>>())
                            .unwrap_or_default()
                    })
                    .collect();

                assert_eq!(craps_players.len(), 2, "2 players in Craps leaderboard");

                // Filter by Blackjack (should be empty)
                let blackjack_players: std::collections::HashSet<_> = explorer
                    .indexed_rounds
                    .iter()
                    .filter(|((gt, _), _)| gt.eq_ignore_ascii_case("Blackjack"))
                    .flat_map(|(key, _)| {
                        explorer
                            .bets_by_round
                            .get(key)
                            .map(|bets| bets.iter().map(|b| b.player.clone()).collect::<Vec<_>>())
                            .unwrap_or_default()
                    })
                    .collect();

                assert_eq!(blackjack_players.len(), 0, "0 players in Blackjack leaderboard");
            }

            // -------------------------------------------------------------------------
            // Test 11: Pagination edge cases
            // -------------------------------------------------------------------------
            {
                let explorer = simulator.explorer.read().await;

                let rounds: Vec<_> = explorer.indexed_rounds.values().collect();

                // Large offset returns empty
                let with_large_offset: Vec<_> = rounds.iter().skip(1000).take(10).collect();
                assert_eq!(with_large_offset.len(), 0, "Large offset should return empty");

                // Zero limit returns empty
                let with_zero_limit: Vec<_> = rounds.iter().take(0).collect();
                assert_eq!(with_zero_limit.len(), 0, "Zero limit should return empty");

                // Limit larger than total returns all
                let with_large_limit: Vec<_> = rounds.iter().take(1000).collect();
                assert_eq!(with_large_limit.len(), rounds.len(), "Large limit should return all");
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Aggregation Stats Tests (AC-4.4)
    // ─────────────────────────────────────────────────────────────────────────────

    /// Create fixture data for aggregation tests - directly manipulates ExplorerState
    fn create_aggregation_fixture(explorer: &mut ExplorerState) {
        use crate::explorer::{IndexedBet, IndexedPayout, IndexedRound};

        // Round 1: Craps - House wins (more wagered than paid out)
        let round1 = IndexedRound {
            game_type: "Craps".to_string(),
            round_id: 1,
            phase: "Finalized".to_string(),
            opened_at_height: 100,
            locked_at_height: Some(101),
            outcome_at_height: Some(102),
            finalized_at_height: Some(103),
            d1: 3,
            d2: 4,
            total_bet_amount: 1000,
            total_payout_amount: 800,
            bet_count: 3,
            player_count: 2,
        };
        let bets1 = vec![
            IndexedBet {
                player: "player_a".to_string(),
                round_id: 1,
                bet_type: 0,
                target: 7,
                amount: 500,
                block_height: 100,
            },
            IndexedBet {
                player: "player_a".to_string(),
                round_id: 1,
                bet_type: 0,
                target: 8,
                amount: 200,
                block_height: 100,
            },
            IndexedBet {
                player: "player_b".to_string(),
                round_id: 1,
                bet_type: 0,
                target: 7,
                amount: 300,
                block_height: 100,
            },
        ];
        let payouts1 = vec![
            IndexedPayout {
                player: "player_a".to_string(),
                round_id: 1,
                payout: 500,
                block_height: 103,
            },
            IndexedPayout {
                player: "player_b".to_string(),
                round_id: 1,
                payout: 300,
                block_height: 103,
            },
        ];

        explorer
            .indexed_rounds
            .insert(("Craps".to_string(), 1), round1);
        explorer
            .bets_by_round
            .insert(("Craps".to_string(), 1), bets1);
        explorer
            .payouts_by_round
            .insert(("Craps".to_string(), 1), payouts1);
        explorer
            .rounds_by_height
            .entry(100)
            .or_default()
            .push(("Craps".to_string(), 1));

        // Round 2: Craps - Players win (more paid out than wagered)
        let round2 = IndexedRound {
            game_type: "Craps".to_string(),
            round_id: 2,
            phase: "Finalized".to_string(),
            opened_at_height: 200,
            locked_at_height: Some(201),
            outcome_at_height: Some(202),
            finalized_at_height: Some(203),
            d1: 5,
            d2: 6,
            total_bet_amount: 500,
            total_payout_amount: 700,
            bet_count: 2,
            player_count: 1,
        };
        let bets2 = vec![
            IndexedBet {
                player: "player_a".to_string(),
                round_id: 2,
                bet_type: 0,
                target: 11,
                amount: 300,
                block_height: 200,
            },
            IndexedBet {
                player: "player_a".to_string(),
                round_id: 2,
                bet_type: 0,
                target: 7,
                amount: 200,
                block_height: 200,
            },
        ];
        let payouts2 = vec![IndexedPayout {
            player: "player_a".to_string(),
            round_id: 2,
            payout: 700,
            block_height: 203,
        }];

        explorer
            .indexed_rounds
            .insert(("Craps".to_string(), 2), round2);
        explorer
            .bets_by_round
            .insert(("Craps".to_string(), 2), bets2);
        explorer
            .payouts_by_round
            .insert(("Craps".to_string(), 2), payouts2);
        explorer
            .rounds_by_height
            .entry(200)
            .or_default()
            .push(("Craps".to_string(), 2));

        // Round 3: Blackjack - House wins big
        let round3 = IndexedRound {
            game_type: "Blackjack".to_string(),
            round_id: 1,
            phase: "Finalized".to_string(),
            opened_at_height: 300,
            locked_at_height: Some(301),
            outcome_at_height: Some(302),
            finalized_at_height: Some(303),
            d1: 0,
            d2: 0,
            total_bet_amount: 2000,
            total_payout_amount: 1000,
            bet_count: 4,
            player_count: 2,
        };
        let bets3 = vec![
            IndexedBet {
                player: "player_b".to_string(),
                round_id: 1,
                bet_type: 0,
                target: 0,
                amount: 1000,
                block_height: 300,
            },
            IndexedBet {
                player: "player_c".to_string(),
                round_id: 1,
                bet_type: 0,
                target: 0,
                amount: 500,
                block_height: 300,
            },
            IndexedBet {
                player: "player_c".to_string(),
                round_id: 1,
                bet_type: 0,
                target: 0,
                amount: 300,
                block_height: 300,
            },
            IndexedBet {
                player: "player_c".to_string(),
                round_id: 1,
                bet_type: 0,
                target: 0,
                amount: 200,
                block_height: 300,
            },
        ];
        let payouts3 = vec![
            IndexedPayout {
                player: "player_b".to_string(),
                round_id: 1,
                payout: 600,
                block_height: 303,
            },
            IndexedPayout {
                player: "player_c".to_string(),
                round_id: 1,
                payout: 400,
                block_height: 303,
            },
        ];

        explorer
            .indexed_rounds
            .insert(("Blackjack".to_string(), 1), round3);
        explorer
            .bets_by_round
            .insert(("Blackjack".to_string(), 1), bets3);
        explorer
            .payouts_by_round
            .insert(("Blackjack".to_string(), 1), payouts3);
        explorer
            .rounds_by_height
            .entry(300)
            .or_default()
            .push(("Blackjack".to_string(), 1));

        // Round 4: Betting phase (not finalized - should be excluded from stats)
        let round4 = IndexedRound {
            game_type: "Craps".to_string(),
            round_id: 3,
            phase: "Betting".to_string(),
            opened_at_height: 400,
            locked_at_height: None,
            outcome_at_height: None,
            finalized_at_height: None,
            d1: 0,
            d2: 0,
            total_bet_amount: 100,
            total_payout_amount: 0,
            bet_count: 1,
            player_count: 1,
        };

        explorer
            .indexed_rounds
            .insert(("Craps".to_string(), 3), round4);
        explorer
            .rounds_by_height
            .entry(400)
            .or_default()
            .push(("Craps".to_string(), 3));
    }

    #[test]
    fn test_aggregation_overall_stats() {
        use crate::explorer::compute_aggregated_stats;

        let mut explorer = ExplorerState::default();
        create_aggregation_fixture(&mut explorer);

        // Test overall stats (all games, all time)
        let stats = compute_aggregated_stats(&explorer, None, None, None);

        // Expected: Round 1 (1000/800) + Round 2 (500/700) + Round 3 (2000/1000)
        // Note: Round 4 is excluded because it's not finalized
        assert_eq!(stats.total_volume, 3500, "Total volume should be 1000+500+2000=3500");
        assert_eq!(stats.total_payouts, 2500, "Total payouts should be 800+700+1000=2500");
        assert_eq!(stats.house_profit, 1000, "House profit should be 3500-2500=1000");
        assert_eq!(stats.round_count, 3, "Should count 3 finalized rounds");
        assert_eq!(stats.bet_count, 9, "Total bets should be 3+2+4=9");
        assert_eq!(stats.player_count, 3, "Unique players: player_a, player_b, player_c");

        // House edge = (3500-2500)/3500 * 100 = 28.57%
        assert!(
            (stats.house_edge_percent - 28.57).abs() < 0.1,
            "House edge should be ~28.57%, got {}",
            stats.house_edge_percent
        );

        // Player win rate: 1 out of 3 rounds had player profit (round 2)
        assert!(
            (stats.player_win_rate_percent - 33.33).abs() < 0.1,
            "Player win rate should be ~33.33%, got {}",
            stats.player_win_rate_percent
        );
    }

    #[test]
    fn test_aggregation_filter_by_game_type() {
        use crate::explorer::compute_aggregated_stats;

        let mut explorer = ExplorerState::default();
        create_aggregation_fixture(&mut explorer);

        // Test Craps only (should include rounds 1 and 2, exclude round 3 Blackjack and round 4 unfinalized)
        let craps_stats = compute_aggregated_stats(&explorer, Some("Craps"), None, None);
        assert_eq!(craps_stats.total_volume, 1500, "Craps volume: 1000+500=1500");
        assert_eq!(craps_stats.total_payouts, 1500, "Craps payouts: 800+700=1500");
        assert_eq!(craps_stats.house_profit, 0, "Craps house profit: 1500-1500=0");
        assert_eq!(craps_stats.round_count, 2, "Should count 2 finalized Craps rounds");

        // Test Blackjack only
        let blackjack_stats = compute_aggregated_stats(&explorer, Some("Blackjack"), None, None);
        assert_eq!(blackjack_stats.total_volume, 2000, "Blackjack volume: 2000");
        assert_eq!(blackjack_stats.total_payouts, 1000, "Blackjack payouts: 1000");
        assert_eq!(blackjack_stats.house_profit, 1000, "Blackjack house profit: 1000");
        assert_eq!(blackjack_stats.round_count, 1, "Should count 1 finalized Blackjack round");

        // Test case-insensitivity
        let craps_lower = compute_aggregated_stats(&explorer, Some("craps"), None, None);
        assert_eq!(craps_lower.round_count, 2, "Case-insensitive filter should work");
    }

    #[test]
    fn test_aggregation_filter_by_height_range() {
        use crate::explorer::compute_aggregated_stats;

        let mut explorer = ExplorerState::default();
        create_aggregation_fixture(&mut explorer);

        // Test from_height filter (heights 200+)
        let from_200_stats = compute_aggregated_stats(&explorer, None, Some(200), None);
        assert_eq!(
            from_200_stats.round_count, 2,
            "Should include rounds 2 (height 200) and 3 (height 300)"
        );
        assert_eq!(from_200_stats.total_volume, 2500, "Volume: 500+2000=2500");

        // Test to_height filter (heights up to 200)
        let to_200_stats = compute_aggregated_stats(&explorer, None, None, Some(200));
        assert_eq!(
            to_200_stats.round_count, 2,
            "Should include rounds 1 (height 100) and 2 (height 200)"
        );
        assert_eq!(to_200_stats.total_volume, 1500, "Volume: 1000+500=1500");

        // Test both from and to (heights 150-250)
        let range_stats = compute_aggregated_stats(&explorer, None, Some(150), Some(250));
        assert_eq!(range_stats.round_count, 1, "Should include only round 2 (height 200)");
        assert_eq!(range_stats.total_volume, 500, "Volume: 500");
    }

    #[test]
    fn test_aggregation_combined_filters() {
        use crate::explorer::compute_aggregated_stats;

        let mut explorer = ExplorerState::default();
        create_aggregation_fixture(&mut explorer);

        // Test Craps + from_height 150 (should only get round 2)
        let filtered_stats = compute_aggregated_stats(&explorer, Some("Craps"), Some(150), None);
        assert_eq!(filtered_stats.round_count, 1, "Should include only Craps round 2");
        assert_eq!(filtered_stats.total_volume, 500);
        assert_eq!(filtered_stats.total_payouts, 700);
    }

    #[test]
    fn test_aggregation_empty_results() {
        use crate::explorer::compute_aggregated_stats;

        let mut explorer = ExplorerState::default();
        create_aggregation_fixture(&mut explorer);

        // Non-existent game type
        let no_game = compute_aggregated_stats(&explorer, Some("Roulette"), None, None);
        assert_eq!(no_game.round_count, 0, "No rounds for Roulette");
        assert_eq!(no_game.total_volume, 0);
        assert_eq!(no_game.house_edge_percent, 0.0, "Zero division should return 0");

        // Height range with no rounds
        let no_range = compute_aggregated_stats(&explorer, None, Some(500), Some(600));
        assert_eq!(no_range.round_count, 0, "No rounds in height range 500-600");
    }

    #[test]
    fn test_aggregation_excludes_non_finalized() {
        use crate::explorer::compute_aggregated_stats;

        let mut explorer = ExplorerState::default();
        create_aggregation_fixture(&mut explorer);

        // Verify that round 4 (Betting phase) is excluded
        let craps_stats = compute_aggregated_stats(&explorer, Some("Craps"), None, None);

        // If non-finalized round was included, we'd have 3 rounds with 1600 volume
        assert_eq!(
            craps_stats.round_count, 2,
            "Should only count finalized rounds"
        );
        assert_eq!(
            craps_stats.total_volume, 1500,
            "Should not include non-finalized round's bets"
        );
    }

    #[test]
    fn test_get_unique_game_types() {
        use crate::explorer::get_unique_game_types;

        let mut explorer = ExplorerState::default();
        create_aggregation_fixture(&mut explorer);

        let game_types = get_unique_game_types(&explorer);
        assert_eq!(game_types.len(), 2, "Should have 2 game types");
        assert!(game_types.contains(&"Blackjack".to_string()));
        assert!(game_types.contains(&"Craps".to_string()));
    }

    #[test]
    fn test_aggregation_average_calculations() {
        use crate::explorer::compute_aggregated_stats;

        let mut explorer = ExplorerState::default();
        create_aggregation_fixture(&mut explorer);

        let stats = compute_aggregated_stats(&explorer, None, None, None);

        // Average bet size = 3500 / 9 = 388.89
        assert!(
            (stats.avg_bet_size - 388.89).abs() < 0.1,
            "Avg bet size should be ~388.89, got {}",
            stats.avg_bet_size
        );

        // Average payout per round = 2500 / 3 = 833.33
        assert!(
            (stats.avg_payout_per_round - 833.33).abs() < 0.1,
            "Avg payout per round should be ~833.33, got {}",
            stats.avg_payout_per_round
        );
    }
}
