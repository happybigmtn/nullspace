use commonware_codec::Encode;
use commonware_consensus::{
    aggregation::{scheme::bls12381_threshold, types::Certificate},
    Viewable,
};
use commonware_cryptography::{
    bls12381::primitives::variant::MinSig, ed25519::PublicKey, sha256::Digest,
};
use commonware_storage::{
    mmr::{Location, Position},
    qmdb::{
        any::unordered::{variable, Update as StorageUpdate},
        create_multi_proof, create_proof, create_proof_store_from_digests,
        digests_required_for_proof, Error as QmdbError,
        keyless,
    },
};
use futures::stream::{FuturesUnordered, StreamExt};
use nullspace_types::{
    api::{Events, FilteredEvents, Lookup, Pending, Summary, Update, UpdatesFilter},
    execution::{Event, Output, Progress, Seed, Transaction, Value},
    Query as ChainQuery,
};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::{broadcast, Semaphore};
use commonware_storage::mmr::verification::ProofStore;

#[cfg(feature = "passkeys")]
use crate::PasskeyStore;
use crate::metrics::UpdateIndexMetrics;
use crate::Simulator;

type AggregationScheme = bls12381_threshold::Scheme<PublicKey, MinSig>;
type AggregationCertificate = Certificate<AggregationScheme, Digest>;
type StateOp = variable::Operation<Digest, Value>;
type EventOp = keyless::Operation<Output>;

const DEFAULT_EXPLORER_MAX_BLOCKS: usize = 10_000;
const DEFAULT_EXPLORER_MAX_ACCOUNT_ENTRIES: usize = 2_000;
const DEFAULT_EXPLORER_MAX_ACCOUNTS: usize = 10_000;
const DEFAULT_EXPLORER_MAX_GAME_EVENT_ACCOUNTS: usize = 10_000;
const DEFAULT_EXPLORER_PERSISTENCE_BUFFER: usize = 1_024;
const DEFAULT_EXPLORER_PERSISTENCE_BATCH_SIZE: usize = 64;
const DEFAULT_STATE_MAX_KEY_VERSIONS: usize = 1;
const DEFAULT_STATE_MAX_PROGRESS_ENTRIES: usize = 10_000;
const DEFAULT_SUBMISSION_HISTORY_LIMIT: usize = 10_000;
const DEFAULT_SEED_HISTORY_LIMIT: usize = 10_000;
const DEFAULT_HTTP_RATE_LIMIT_PER_SECOND: u64 = 1_000;
const DEFAULT_HTTP_RATE_LIMIT_BURST: u32 = 5_000;
const DEFAULT_SUBMIT_RATE_LIMIT_PER_MINUTE: u64 = 100;
const DEFAULT_SUBMIT_RATE_LIMIT_BURST: u32 = 10;
const DEFAULT_HTTP_BODY_LIMIT_BYTES: usize = 8 * 1024 * 1024;
const DEFAULT_WS_OUTBOUND_BUFFER: usize = 256;
const DEFAULT_WS_MAX_CONNECTIONS: usize = 20_000;
const DEFAULT_WS_MAX_CONNECTIONS_PER_IP: usize = 10;
const DEFAULT_WS_MAX_MESSAGE_BYTES: usize = 4 * 1024 * 1024;
const DEFAULT_UPDATES_BROADCAST_BUFFER: usize = 1_024;
const DEFAULT_MEMPOOL_BROADCAST_BUFFER: usize = 1_024;
const DEFAULT_UPDATES_INDEX_CONCURRENCY: usize = 8;
const DEFAULT_FANOUT_CHANNEL: &str = "nullspace.submissions";
const DEFAULT_CACHE_REDIS_PREFIX: &str = "nullspace:explorer:";
const DEFAULT_CACHE_REDIS_TTL_SECONDS: u64 = 2;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExplorerPersistenceBackpressure {
    Block,
    Drop,
}

impl std::str::FromStr for ExplorerPersistenceBackpressure {
    type Err = &'static str;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.to_ascii_lowercase().as_str() {
            "block" => Ok(Self::Block),
            "drop" => Ok(Self::Drop),
            _ => Err("valid values: block, drop"),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct SimulatorConfig {
    pub explorer_max_blocks: Option<usize>,
    pub explorer_max_account_entries: Option<usize>,
    pub explorer_max_accounts: Option<usize>,
    pub explorer_max_game_event_accounts: Option<usize>,
    pub explorer_persistence_path: Option<PathBuf>,
    pub explorer_persistence_url: Option<String>,
    pub explorer_persistence_buffer: Option<usize>,
    pub explorer_persistence_batch_size: Option<usize>,
    pub explorer_persistence_backpressure: Option<ExplorerPersistenceBackpressure>,
    pub summary_persistence_path: Option<PathBuf>,
    pub summary_persistence_max_blocks: Option<usize>,
    pub state_max_key_versions: Option<usize>,
    pub state_max_progress_entries: Option<usize>,
    pub submission_history_limit: Option<usize>,
    pub seed_history_limit: Option<usize>,
    pub http_rate_limit_per_second: Option<u64>,
    pub http_rate_limit_burst: Option<u32>,
    pub submit_rate_limit_per_minute: Option<u64>,
    pub submit_rate_limit_burst: Option<u32>,
    pub http_body_limit_bytes: Option<usize>,
    pub ws_outbound_buffer: Option<usize>,
    pub ws_max_connections: Option<usize>,
    pub ws_max_connections_per_ip: Option<usize>,
    pub ws_max_message_bytes: Option<usize>,
    pub updates_broadcast_buffer: Option<usize>,
    pub mempool_broadcast_buffer: Option<usize>,
    pub updates_index_concurrency: Option<usize>,
    pub fanout_redis_url: Option<String>,
    pub fanout_channel: Option<String>,
    pub fanout_origin: Option<String>,
    pub fanout_publish: Option<bool>,
    pub fanout_subscribe: Option<bool>,
    pub cache_redis_url: Option<String>,
    pub cache_redis_prefix: Option<String>,
    pub cache_redis_ttl_seconds: Option<u64>,
    pub enforce_signature_verification: bool,
}

impl Default for SimulatorConfig {
    fn default() -> Self {
        Self {
            explorer_max_blocks: Some(DEFAULT_EXPLORER_MAX_BLOCKS),
            explorer_max_account_entries: Some(DEFAULT_EXPLORER_MAX_ACCOUNT_ENTRIES),
            explorer_max_accounts: Some(DEFAULT_EXPLORER_MAX_ACCOUNTS),
            explorer_max_game_event_accounts: Some(DEFAULT_EXPLORER_MAX_GAME_EVENT_ACCOUNTS),
            explorer_persistence_path: None,
            explorer_persistence_url: None,
            explorer_persistence_buffer: Some(DEFAULT_EXPLORER_PERSISTENCE_BUFFER),
            explorer_persistence_batch_size: Some(DEFAULT_EXPLORER_PERSISTENCE_BATCH_SIZE),
            explorer_persistence_backpressure: Some(ExplorerPersistenceBackpressure::Block),
            summary_persistence_path: None,
            summary_persistence_max_blocks: None,
            state_max_key_versions: Some(DEFAULT_STATE_MAX_KEY_VERSIONS),
            state_max_progress_entries: Some(DEFAULT_STATE_MAX_PROGRESS_ENTRIES),
            submission_history_limit: Some(DEFAULT_SUBMISSION_HISTORY_LIMIT),
            seed_history_limit: Some(DEFAULT_SEED_HISTORY_LIMIT),
            http_rate_limit_per_second: Some(DEFAULT_HTTP_RATE_LIMIT_PER_SECOND),
            http_rate_limit_burst: Some(DEFAULT_HTTP_RATE_LIMIT_BURST),
            submit_rate_limit_per_minute: Some(DEFAULT_SUBMIT_RATE_LIMIT_PER_MINUTE),
            submit_rate_limit_burst: Some(DEFAULT_SUBMIT_RATE_LIMIT_BURST),
            http_body_limit_bytes: Some(DEFAULT_HTTP_BODY_LIMIT_BYTES),
            ws_outbound_buffer: Some(DEFAULT_WS_OUTBOUND_BUFFER),
            ws_max_connections: Some(DEFAULT_WS_MAX_CONNECTIONS),
            ws_max_connections_per_ip: Some(DEFAULT_WS_MAX_CONNECTIONS_PER_IP),
            ws_max_message_bytes: Some(DEFAULT_WS_MAX_MESSAGE_BYTES),
            updates_broadcast_buffer: Some(DEFAULT_UPDATES_BROADCAST_BUFFER),
            mempool_broadcast_buffer: Some(DEFAULT_MEMPOOL_BROADCAST_BUFFER),
            updates_index_concurrency: Some(DEFAULT_UPDATES_INDEX_CONCURRENCY),
            fanout_redis_url: None,
            fanout_channel: Some(DEFAULT_FANOUT_CHANNEL.to_string()),
            fanout_origin: None,
            fanout_publish: Some(true),
            fanout_subscribe: Some(true),
            cache_redis_url: None,
            cache_redis_prefix: Some(DEFAULT_CACHE_REDIS_PREFIX.to_string()),
            cache_redis_ttl_seconds: Some(DEFAULT_CACHE_REDIS_TTL_SECONDS),
            enforce_signature_verification: false,
        }
    }
}

impl SimulatorConfig {
    pub fn ws_outbound_capacity(&self) -> usize {
        self.ws_outbound_buffer.unwrap_or(DEFAULT_WS_OUTBOUND_BUFFER).max(1)
    }

    pub fn ws_max_message_bytes(&self) -> usize {
        self.ws_max_message_bytes
            .unwrap_or(DEFAULT_WS_MAX_MESSAGE_BYTES)
            .max(1)
    }

    pub fn updates_broadcast_capacity(&self) -> usize {
        self.updates_broadcast_buffer
            .unwrap_or(DEFAULT_UPDATES_BROADCAST_BUFFER)
            .max(1)
    }

    pub fn mempool_broadcast_capacity(&self) -> usize {
        self.mempool_broadcast_buffer
            .unwrap_or(DEFAULT_MEMPOOL_BROADCAST_BUFFER)
            .max(1)
    }

    pub fn explorer_persistence_buffer_capacity(&self) -> usize {
        self.explorer_persistence_buffer
            .unwrap_or(DEFAULT_EXPLORER_PERSISTENCE_BUFFER)
            .max(1)
    }

    pub fn explorer_persistence_batch_size(&self) -> usize {
        self.explorer_persistence_batch_size
            .unwrap_or(DEFAULT_EXPLORER_PERSISTENCE_BATCH_SIZE)
            .max(1)
    }

    pub fn explorer_persistence_backpressure_policy(&self) -> ExplorerPersistenceBackpressure {
        self.explorer_persistence_backpressure
            .unwrap_or(ExplorerPersistenceBackpressure::Block)
    }

    pub fn updates_index_concurrency(&self) -> usize {
        self.updates_index_concurrency
            .unwrap_or(DEFAULT_UPDATES_INDEX_CONCURRENCY)
            .max(1)
    }
}

#[derive(Clone)]
#[allow(clippy::large_enum_variant)]
pub enum InternalUpdate {
    Seed(Seed),
    Events(Arc<IndexedEvents>),
}

#[derive(Clone)]
pub struct EncodedUpdate {
    pub update: Arc<Update>,
    pub bytes: Arc<Vec<u8>>,
}

impl EncodedUpdate {
    pub(crate) fn new(update: Update) -> Self {
        let update = Arc::new(update);
        let bytes = Arc::new(update.as_ref().encode().to_vec());
        Self { update, bytes }
    }
}

#[derive(Clone, Debug)]
pub struct SubscriptionSnapshot {
    pub all: bool,
    pub accounts: Option<HashSet<PublicKey>>,
    pub sessions: Option<HashSet<u64>>,
}

#[derive(Default)]
pub struct SubscriptionTracker {
    all_count: usize,
    accounts: HashMap<PublicKey, usize>,
    sessions: HashMap<u64, usize>,
}

impl SubscriptionTracker {
    fn register(&mut self, filter: &UpdatesFilter) {
        match filter {
            UpdatesFilter::All => {
                self.all_count = self.all_count.saturating_add(1);
            }
            UpdatesFilter::Account(account) => {
                *self.accounts.entry(account.clone()).or_insert(0) += 1;
            }
            UpdatesFilter::Session(session_id) => {
                *self.sessions.entry(*session_id).or_insert(0) += 1;
            }
        }
    }

    fn unregister(&mut self, filter: &UpdatesFilter) {
        match filter {
            UpdatesFilter::All => {
                self.all_count = self.all_count.saturating_sub(1);
            }
            UpdatesFilter::Account(account) => {
                if let Some(count) = self.accounts.get_mut(account) {
                    if *count > 1 {
                        *count -= 1;
                    } else {
                        self.accounts.remove(account);
                    }
                }
            }
            UpdatesFilter::Session(session_id) => {
                if let Some(count) = self.sessions.get_mut(session_id) {
                    if *count > 1 {
                        *count -= 1;
                    } else {
                        self.sessions.remove(session_id);
                    }
                }
            }
        }
    }

    fn total_count(&self) -> usize {
        let account_total: usize = self.accounts.values().sum();
        let session_total: usize = self.sessions.values().sum();
        self.all_count + account_total + session_total
    }

    fn snapshot(&self, include_all_accounts: bool, include_all_sessions: bool) -> SubscriptionSnapshot {
        SubscriptionSnapshot {
            all: self.all_count > 0,
            accounts: if include_all_accounts {
                None
            } else {
                Some(self.accounts.keys().cloned().collect())
            },
            sessions: if include_all_sessions {
                None
            } else {
                Some(self.sessions.keys().cloned().collect())
            },
        }
    }
}

pub struct SubscriptionGuard {
    tracker: Arc<Mutex<SubscriptionTracker>>,
    filter: UpdatesFilter,
}

impl Drop for SubscriptionGuard {
    fn drop(&mut self) {
        let mut tracker = match self.tracker.lock() {
            Ok(tracker) => tracker,
            Err(poisoned) => {
                tracing::warn!("Subscription tracker lock poisoned; recovering");
                poisoned.into_inner()
            }
        };
        tracker.unregister(&self.filter);
    }
}

pub struct IndexedEvents {
    pub events: Arc<Events>,
    pub proof_store: Arc<ProofStore<Digest>>,
    pub full_update: Option<EncodedUpdate>,
    pub public_update: Option<EncodedUpdate>,
    pub account_updates: HashMap<PublicKey, EncodedUpdate>,
    pub session_updates: HashMap<u64, EncodedUpdate>,
}

impl IndexedEvents {
    pub fn update_for_account(&self, account: &PublicKey) -> Option<EncodedUpdate> {
        self.account_updates
            .get(account)
            .cloned()
            .or_else(|| self.public_update.clone())
    }

    pub fn update_for_session(&self, session_id: u64) -> Option<EncodedUpdate> {
        self.session_updates.get(&session_id).cloned()
    }
}

fn merge_ops(
    public_ops: &[(u64, EventOp)],
    account_ops: &[(u64, EventOp)],
) -> Vec<(u64, EventOp)> {
    let mut merged = Vec::with_capacity(public_ops.len() + account_ops.len());
    let mut i = 0;
    let mut j = 0;
    while i < public_ops.len() && j < account_ops.len() {
        if public_ops[i].0 <= account_ops[j].0 {
            merged.push(public_ops[i].clone());
            i += 1;
        } else {
            merged.push(account_ops[j].clone());
            j += 1;
        }
    }
    while i < public_ops.len() {
        merged.push(public_ops[i].clone());
        i += 1;
    }
    while j < account_ops.len() {
        merged.push(account_ops[j].clone());
        j += 1;
    }
    merged
}

async fn build_filtered_update(
    events: &Events,
    proof_store: &ProofStore<Digest>,
    filtered_ops: Vec<(u64, EventOp)>,
) -> Result<Option<EncodedUpdate>, QmdbError> {
    if filtered_ops.is_empty() {
        return Ok(None);
    }

    let locations_to_include = filtered_ops
        .iter()
        .map(|(loc, _)| Location::from(*loc))
        .collect::<Vec<_>>();
    let filtered_proof = create_multi_proof(proof_store, &locations_to_include).await?;

    Ok(Some(EncodedUpdate::new(Update::FilteredEvents(FilteredEvents {
        progress: events.progress,
        certificate: events.certificate.clone(),
        events_proof: filtered_proof,
        events_proof_ops: filtered_ops,
    }))))
}

pub(crate) async fn index_events(
    events: Arc<Events>,
    proof_store: Arc<ProofStore<Digest>>,
    subscriptions: Option<&SubscriptionSnapshot>,
    max_concurrent_proofs: usize,
    index_metrics: Arc<UpdateIndexMetrics>,
) -> IndexedEvents {
    let accounts_filter = subscriptions.and_then(|snapshot| snapshot.accounts.as_ref());
    let sessions_filter = subscriptions.and_then(|snapshot| snapshot.sessions.as_ref());
    let include_all_accounts = subscriptions.is_none_or(|snapshot| snapshot.accounts.is_none());
    let include_all_sessions = subscriptions.is_none_or(|snapshot| snapshot.sessions.is_none());
    let has_account_subs = include_all_accounts || accounts_filter.is_some_and(|set| !set.is_empty());
    let has_session_subs = include_all_sessions || sessions_filter.is_some_and(|set| !set.is_empty());
    let needs_public_ops = has_account_subs;
    let include_full_update = subscriptions.is_none_or(|snapshot| snapshot.all);

    let mut public_ops: Vec<(u64, EventOp)> = Vec::new();
    let mut account_ops: HashMap<PublicKey, Vec<(u64, EventOp)>> = HashMap::new();
    let mut session_ops: HashMap<u64, Vec<(u64, EventOp)>> = HashMap::new();

    for (i, op) in events.events_proof_ops.iter().enumerate() {
        let loc = events.progress.events_start_op + i as u64;
        match op {
            EventOp::Append(output) => match output {
                Output::Event(event) => match event {
                    Event::CasinoPlayerRegistered { player, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(player))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(player.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::CasinoDeposited { player, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(player))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(player.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::CasinoGameStarted { player, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(player))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(player.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::CasinoGameMoved { session_id, .. } => {
                        if has_session_subs
                            && (include_all_sessions
                                || sessions_filter
                                    .map(|set| set.contains(session_id))
                                    .unwrap_or(true))
                        {
                            session_ops
                                .entry(*session_id)
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::CasinoGameCompleted { player, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(player))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(player.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::CasinoLeaderboardUpdated { .. } => {
                        if needs_public_ops {
                            public_ops.push((loc, op.clone()));
                        }
                    }
                    Event::CasinoError { player, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(player))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(player.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::PlayerModifierToggled { player, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(player))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(player.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::GlobalTableRoundOpened { .. }
                    | Event::GlobalTableLocked { .. }
                    | Event::GlobalTableOutcome { .. }
                    | Event::GlobalTableFinalized { .. } => {
                        if needs_public_ops {
                            public_ops.push((loc, op.clone()));
                        }
                    }
                    Event::GlobalTableBetAccepted { player, .. }
                    | Event::GlobalTableBetRejected { player, .. }
                    | Event::GlobalTablePlayerSettled { player, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(player))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(player.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::TournamentStarted { .. } => {
                        if needs_public_ops {
                            public_ops.push((loc, op.clone()));
                        }
                    }
                    Event::PlayerJoined { player, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(player))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(player.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::TournamentPhaseChanged { .. } => {
                        if needs_public_ops {
                            public_ops.push((loc, op.clone()));
                        }
                    }
                    Event::TournamentEnded { rankings, .. } => {
                        if has_account_subs {
                            for (player, _) in rankings {
                                if include_all_accounts
                                    || accounts_filter
                                        .map(|set| set.contains(player))
                                        .unwrap_or(true)
                                {
                                    account_ops
                                        .entry(player.clone())
                                        .or_default()
                                        .push((loc, op.clone()));
                                }
                            }
                        }
                    }
                    Event::VaultCreated { player, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(player))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(player.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::CollateralDeposited { player, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(player))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(player.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::VusdtBorrowed { player, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(player))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(player.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::VusdtRepaid { player, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(player))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(player.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::AmmSwapped { player, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(player))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(player.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::LiquidityAdded { player, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(player))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(player.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::LiquidityRemoved { player, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(player))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(player.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::AmmBootstrapped { .. }
                    | Event::AmmBootstrapFinalized { .. }
                    | Event::PolicyUpdated { .. }
                    | Event::OracleUpdated { .. }
                    | Event::TreasuryUpdated { .. }
                    | Event::TreasuryVestingUpdated { .. }
                    | Event::TreasuryAllocationReleased { .. }
                    | Event::RecoveryPoolFunded { .. }
                    | Event::BridgeWithdrawalFinalized { .. } => {
                        if needs_public_ops {
                            public_ops.push((loc, op.clone()));
                        }
                    }
                    Event::BridgeWithdrawalRequested { player, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(player))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(player.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::BridgeDepositCredited { recipient, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(recipient))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(recipient.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::VaultLiquidated {
                        liquidator,
                        target,
                        ..
                    } => {
                        if has_account_subs {
                            if include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(liquidator))
                                    .unwrap_or(true)
                            {
                                account_ops
                                    .entry(liquidator.clone())
                                    .or_default()
                                    .push((loc, op.clone()));
                            }
                            if include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(target))
                                    .unwrap_or(true)
                            {
                                account_ops
                                    .entry(target.clone())
                                    .or_default()
                                    .push((loc, op.clone()));
                            }
                        }
                    }
                    Event::RecoveryPoolRetired { target, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(target))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(target.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::SavingsDeposited { player, .. }
                    | Event::SavingsWithdrawn { player, .. }
                    | Event::SavingsRewardsClaimed { player, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(player))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(player.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::Staked { player, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(player))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(player.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::Unstaked { player, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(player))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(player.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::RewardsClaimed { player, .. } => {
                        if has_account_subs
                            && (include_all_accounts
                                || accounts_filter
                                    .map(|set| set.contains(player))
                                    .unwrap_or(true))
                        {
                            account_ops
                                .entry(player.clone())
                                .or_default()
                                .push((loc, op.clone()));
                        }
                    }
                    Event::EpochProcessed { .. } => {
                        if needs_public_ops {
                            public_ops.push((loc, op.clone()));
                        }
                    }
                },
                Output::Transaction(tx) => {
                    if has_account_subs
                        && (include_all_accounts
                            || accounts_filter
                                .map(|set| set.contains(&tx.public))
                                .unwrap_or(true))
                    {
                        account_ops
                            .entry(tx.public.clone())
                            .or_default()
                            .push((loc, op.clone()));
                    }
                }
                Output::Commit { .. } => {}
            },
            EventOp::Commit(_) => {}
        }
    }

    let public_update = if needs_public_ops {
        index_metrics.inc_in_flight();
        let start = Instant::now();
        let update = match build_filtered_update(
            events.as_ref(),
            proof_store.as_ref(),
            public_ops.clone(),
        )
        .await
        {
            Ok(update) => update,
            Err(err) => {
                index_metrics.inc_failure();
                tracing::error!(?err, "Failed to generate public filtered proof");
                None
            }
        };
        index_metrics.dec_in_flight();
        index_metrics.record_proof_latency(start.elapsed());
        update
    } else {
        None
    };

    let public_ops = Arc::new(public_ops);
    let semaphore = Arc::new(Semaphore::new(max_concurrent_proofs.max(1)));

    let mut account_updates = HashMap::new();
    if has_account_subs {
        let mut tasks = FuturesUnordered::new();
        for (account, ops) in account_ops {
            let permit = match semaphore.clone().acquire_owned().await {
                Ok(permit) => permit,
                Err(err) => {
                    tracing::warn!("Update indexing semaphore closed: {err}");
                    break;
                }
            };
            let events = Arc::clone(&events);
            let proof_store = Arc::clone(&proof_store);
            let public_ops = Arc::clone(&public_ops);
            let index_metrics = Arc::clone(&index_metrics);
            tasks.push(tokio::spawn(async move {
                index_metrics.inc_in_flight();
                let start = Instant::now();
                let merged_ops = if public_ops.is_empty() {
                    ops
                } else {
                    merge_ops(public_ops.as_slice(), &ops)
                };
                let update =
                    match build_filtered_update(events.as_ref(), proof_store.as_ref(), merged_ops)
                        .await
                    {
                        Ok(update) => update,
                        Err(err) => {
                            index_metrics.inc_failure();
                            tracing::error!(
                                ?err,
                                public_key = ?account,
                                "Failed to generate account filtered proof"
                            );
                            None
                        }
                    };
                index_metrics.dec_in_flight();
                index_metrics.record_proof_latency(start.elapsed());
                drop(permit);
                update.map(|update| (account, update))
            }));
        }
        while let Some(result) = tasks.next().await {
            match result {
                Ok(Some((account, update))) => {
                    account_updates.insert(account, update);
                }
                Ok(None) => {}
                Err(err) => {
                    tracing::warn!("Account update indexing task failed: {err}");
                }
            }
        }
    }

    let mut session_updates = HashMap::new();
    if has_session_subs {
        let mut tasks = FuturesUnordered::new();
        for (session_id, ops) in session_ops {
            let permit = match semaphore.clone().acquire_owned().await {
                Ok(permit) => permit,
                Err(err) => {
                    tracing::warn!("Update indexing semaphore closed: {err}");
                    break;
                }
            };
            let events = Arc::clone(&events);
            let proof_store = Arc::clone(&proof_store);
            let index_metrics = Arc::clone(&index_metrics);
            tasks.push(tokio::spawn(async move {
                index_metrics.inc_in_flight();
                let start = Instant::now();
                let update = match build_filtered_update(events.as_ref(), proof_store.as_ref(), ops)
                    .await
                {
                    Ok(update) => update,
                    Err(err) => {
                        index_metrics.inc_failure();
                        tracing::error!(
                            ?err,
                            session_id,
                            "Failed to generate session filtered proof"
                        );
                        None
                    }
                };
                index_metrics.dec_in_flight();
                index_metrics.record_proof_latency(start.elapsed());
                drop(permit);
                update.map(|update| (session_id, update))
            }));
        }
        while let Some(result) = tasks.next().await {
            match result {
                Ok(Some((session_id, update))) => {
                    session_updates.insert(session_id, update);
                }
                Ok(None) => {}
                Err(err) => {
                    tracing::warn!("Session update indexing task failed: {err}");
                }
            }
        }
    }

    let full_update = if include_full_update {
        Some(EncodedUpdate::new(Update::Events(events.as_ref().clone())))
    } else {
        None
    };

    IndexedEvents {
        events,
        proof_store,
        full_update,
        public_update,
        account_updates,
        session_updates,
    }
}

#[derive(Default)]
pub struct State {
    seeds: BTreeMap<u64, Seed>,

    nodes: BTreeMap<Position, Digest>,
    node_ref_counts: HashMap<Position, usize>,
    #[allow(clippy::type_complexity)]
    keys: HashMap<Digest, BTreeMap<u64, (Location, StateOp)>>,
    progress: BTreeMap<u64, (Progress, AggregationCertificate)>,
    progress_nodes: BTreeMap<u64, Vec<Position>>,

    submitted_events: HashSet<u64>,
    submitted_state: HashSet<u64>,
    submitted_events_order: VecDeque<u64>,
    submitted_state_order: VecDeque<u64>,

    #[cfg(feature = "passkeys")]
    pub(super) passkeys: PasskeyStore,
}

impl Simulator {
    pub async fn submit_seed(&self, seed: Seed) {
        {
            let mut state = self.state.write().await;
            if state.seeds.insert(seed.view().get(), seed.clone()).is_some() {
                return;
            }
            if let Some(limit) = self.config.seed_history_limit {
                while state.seeds.len() > limit {
                    state.seeds.pop_first();
                }
            }
        } // Release lock before broadcasting
        if let Err(e) = self.update_tx.send(InternalUpdate::Seed(seed)) {
            tracing::warn!("Failed to broadcast seed update (no subscribers): {}", e);
        }
    }

    pub fn submit_transactions(&self, transactions: Vec<Transaction>) {
        if let Err(e) = self.mempool_tx.send(Pending { transactions }) {
            tracing::warn!("Failed to broadcast transactions (no subscribers): {}", e);
        }
    }

    pub async fn submit_state(&self, summary: Summary, inner: Vec<(Position, Digest)>) {
        let mut state = self.state.write().await;
        let height = summary.progress.height;
        if !state.submitted_state.insert(height) {
            return;
        }
        if let Some(limit) = self.config.submission_history_limit {
            state.submitted_state_order.push_back(height);
            while state.submitted_state_order.len() > limit {
                if let Some(oldest) = state.submitted_state_order.pop_front() {
                    state.submitted_state.remove(&oldest);
                }
            }
        }

        let mut node_positions = Vec::with_capacity(inner.len());
        for (pos, digest) in inner {
            state.nodes.insert(pos, digest);
            node_positions.push(pos);
            *state.node_ref_counts.entry(pos).or_insert(0) += 1;
        }
        if !node_positions.is_empty() {
            state.progress_nodes.insert(height, node_positions);
        }

        let max_versions = self.config.state_max_key_versions;
        let start_loc = Location::from(summary.progress.state_start_op);
        for (i, value) in summary.state_proof_ops.into_iter().enumerate() {
            // Store in keys
            let loc = start_loc
                .checked_add(i as u64)
                .expect("state operation location overflow");
            match value {
                StateOp::Update(update) => {
                    let key = update.0;
                    let remove_key = {
                        let history = state.keys.entry(key).or_default();
                        history.insert(height, (loc, StateOp::Update(update)));
                        if let Some(limit) = max_versions {
                            while history.len() > limit {
                                history.pop_first();
                            }
                        }
                        history.is_empty()
                    };
                    if remove_key {
                        state.keys.remove(&key);
                    }
                }
                StateOp::Delete(key) => {
                    let remove_key = {
                        let history = state.keys.entry(key).or_default();
                        history.insert(height, (loc, StateOp::Delete(key)));
                        if let Some(limit) = max_versions {
                            while history.len() > limit {
                                history.pop_first();
                            }
                        }
                        history.is_empty()
                    };
                    if remove_key {
                        state.keys.remove(&key);
                    }
                }
                _ => {}
            }
        }

        // Store progress at height to build proofs
        state.progress.insert(height, (summary.progress, summary.certificate));

        if let Some(limit) = self.config.state_max_progress_entries {
            while state.progress.len() > limit {
                let Some((oldest_height, _)) = state.progress.pop_first() else {
                    break;
                };
                if let Some(positions) = state.progress_nodes.remove(&oldest_height) {
                    for pos in positions {
                        match state.node_ref_counts.get_mut(&pos) {
                            Some(count) if *count > 1 => {
                                *count -= 1;
                            }
                            Some(_) => {
                                state.node_ref_counts.remove(&pos);
                                state.nodes.remove(&pos);
                            }
                            None => {}
                        }
                    }
                }
            }
        }
    }

    pub async fn submit_events(&self, summary: Summary, events_digests: Vec<(Position, Digest)>) {
        let height = summary.progress.height;

        // Check if already submitted before acquiring lock
        {
            let mut state = self.state.write().await;
            if !state.submitted_events.insert(height) {
                return;
            }
            if let Some(limit) = self.config.submission_history_limit {
                state.submitted_events_order.push_back(height);
                while state.submitted_events_order.len() > limit {
                    if let Some(oldest) = state.submitted_events_order.pop_front() {
                        state.submitted_events.remove(&oldest);
                    }
                }
            }
        } // Release lock before broadcasting

        // Index blocks/transactions for explorer consumers
        self.index_block_from_summary(&summary.progress, &summary.events_proof_ops)
            .await;

        let receiver_count = self.update_tx.receiver_count();
        if receiver_count == 0 {
            return;
        }

        let subscriptions = self.subscription_snapshot(receiver_count);

        // Broadcast events with digests for efficient filtering
        let events = Arc::new(Events {
            progress: summary.progress,
            certificate: summary.certificate,
            events_proof: summary.events_proof,
            events_proof_ops: summary.events_proof_ops,
        });
        let proof_store = Arc::new(create_proof_store_from_digests(
            &events.events_proof,
            events_digests,
        ));
        let indexed = index_events(
            events,
            proof_store,
            Some(&subscriptions),
            self.config.updates_index_concurrency(),
            Arc::clone(&self.update_index_metrics),
        )
        .await;
        if let Err(e) = self
            .update_tx
            .send(InternalUpdate::Events(Arc::new(indexed)))
        {
            tracing::warn!("Failed to broadcast events update (no subscribers): {}", e);
        }
    }

    pub async fn query_state(&self, key: &Digest) -> Option<Lookup> {
        self.try_query_state(key).await
    }

    async fn try_query_state(&self, key: &Digest) -> Option<Lookup> {
        let (progress, certificate, location, value, required_digests) = {
            let state = self.state.read().await;

            let key_history = match state.keys.get(key) {
                Some(key_history) => key_history,
                None => return None,
            };
            let (height, operation) = match key_history.last_key_value() {
                Some((height, operation)) => (height, operation),
                None => return None,
            };
            let (loc, operation) = operation;
            let StateOp::Update(update) = operation else {
                return None;
            };
            let value = update.1.clone();

            // Get progress and certificate
            let (progress, certificate) = match state.progress.get(height) {
                Some(value) => value,
                None => return None,
            };

            // Get required nodes
            let end_loc = loc
                .checked_add(1)
                .expect("state proof lookup location overflow");
            let required_digest_positions = match digests_required_for_proof::<Digest>(
                Location::from(progress.state_end_op),
                *loc..end_loc,
            ) {
                Ok(positions) => positions,
                Err(err) => {
                    tracing::error!(
                        "Failed to compute required digests for lookup proof: {:?}",
                        err
                    );
                    return None;
                }
            };
            let required_digests = required_digest_positions
                .iter()
                .filter_map(|pos| state.nodes.get(pos).cloned())
                .collect::<Vec<_>>();

            // Verify we got all required digests
            if required_digests.len() != required_digest_positions.len() {
                tracing::error!(
                    "Missing node digests: expected {}, got {}",
                    required_digest_positions.len(),
                    required_digests.len()
                );
                return None;
            }

            (*progress, certificate.clone(), *loc, value, required_digests)
        };

        // Construct proof outside the lock on a blocking thread.
        let proof = {
            let op_count = Location::from(progress.state_end_op);
            let required_digests_clone = required_digests.clone();
            let proof_result = match tokio::task::spawn_blocking(move || {
                create_proof(op_count, required_digests_clone)
            })
            .await
            {
                Ok(result) => result,
                Err(err) => {
                    tracing::warn!("Proof build task failed; retrying inline: {err}");
                    create_proof(op_count, required_digests)
                }
            };
            match proof_result {
                Ok(proof) => proof,
                Err(err) => {
                    tracing::error!("Failed to build lookup proof: {:?}", err);
                    return None;
                }
            }
        };

        Some(Lookup {
            progress,
            certificate,
            proof,
            location: location.as_u64(),
            operation: StateOp::Update(StorageUpdate(*key, value)),
        })
    }

    pub async fn query_seed(&self, query: &ChainQuery) -> Option<Seed> {
        self.try_query_seed(query).await
    }

    async fn try_query_seed(&self, query: &ChainQuery) -> Option<Seed> {
        let state = self.state.read().await;
        match query {
            ChainQuery::Latest => state.seeds.last_key_value().map(|(_, seed)| seed.clone()),
            ChainQuery::Index(index) => state.seeds.get(index).cloned(),
        }
    }

    #[deprecated(note = "Use tracked_update_subscriber to register filters for update indexing")]
    pub fn update_subscriber(&self) -> broadcast::Receiver<crate::InternalUpdate> {
        self.update_tx.subscribe()
    }

    pub fn tracked_update_subscriber(
        &self,
        filter: UpdatesFilter,
    ) -> (broadcast::Receiver<crate::InternalUpdate>, SubscriptionGuard) {
        // IMPORTANT: Create receiver FIRST, then register.
        // This ensures we're subscribed before the tracker knows about us,
        // preventing race conditions where messages are sent after registration
        // but before the receiver is created.
        let receiver = self.update_tx.subscribe();
        let guard = self.register_subscription(&filter);
        (receiver, guard)
    }

    pub fn mempool_subscriber(&self) -> broadcast::Receiver<Pending> {
        self.mempool_tx.subscribe()
    }

    pub fn register_subscription(&self, filter: &UpdatesFilter) -> SubscriptionGuard {
        let mut tracker = match self.subscriptions.lock() {
            Ok(tracker) => tracker,
            Err(poisoned) => {
                tracing::warn!("Subscriptions lock poisoned; recovering");
                poisoned.into_inner()
            }
        };
        tracker.register(filter);
        SubscriptionGuard {
            tracker: Arc::clone(&self.subscriptions),
            filter: filter.clone(),
        }
    }

    fn subscription_snapshot(&self, receiver_count: usize) -> SubscriptionSnapshot {
        let tracker = match self.subscriptions.lock() {
            Ok(tracker) => tracker,
            Err(poisoned) => {
                tracing::warn!("Subscriptions lock poisoned; recovering");
                poisoned.into_inner()
            }
        };
        let tracked = tracker.total_count();
        let has_untracked = receiver_count > tracked;
        tracker.snapshot(has_untracked, has_untracked)
    }
}
