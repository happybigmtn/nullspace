# L08 - Simulator state, mempool, and update indexing (from scratch)

Focus file: `simulator/src/state.rs`

Goal: explain how the simulator stores state, broadcasts mempool transactions, indexes events, and serves state queries. For every excerpt, you will see **why it matters** and a **plain description of what the code does**. We only explain syntax when it is genuinely tricky.

---

## Concepts from scratch (expanded)

### 1) What is the mempool?
The mempool is the "waiting room" for transactions. When users submit actions, they enter the mempool first. The simulator broadcasts these pending transactions so the rest of the system can process them.

### 2) What is "state" in this file?
State here means the simulator's local, in-memory view of:
- seeds (randomness per round),
- state operations (key/value updates and deletes),
- events and progress checkpoints,
- and proofs needed to answer queries.

### 3) Why broadcast updates?
Clients need real-time updates. The simulator publishes:
- seed updates,
- event updates,
- and mempool updates
so that gateways, indexers, and explorers can keep in sync.

### 4) Why proofs and digests exist
The simulator does not just store values. It stores proofs and digests so that clients can verify data came from valid consensus and has not been tampered with.

### 5) Subscription filtering
Not everyone needs every event. Subscriptions let the simulator send only:
- all updates (full firehose),
- per-account updates (only for a player),
- or per-session updates (only for a table/session).

### 6) Locking and concurrency
State is shared across tasks. This file uses read/write locks:
- write locks for updates,
- read locks for queries,
so concurrent tasks do not corrupt data.

### 7) Why async + blocking split
Some proof operations are heavy. Those are pushed into `spawn_blocking` so they do not block the async runtime.

---

## Limits and management callouts (important)

1) **Submission and seed history limits**
- `DEFAULT_SUBMISSION_HISTORY_LIMIT = 10_000`
- `DEFAULT_SEED_HISTORY_LIMIT = 10_000`
These control how many checkpoints are kept. For long-running nodes, you may need higher values or external storage.

2) **State retention**
- `DEFAULT_STATE_MAX_KEY_VERSIONS = 1`
- `DEFAULT_STATE_MAX_PROGRESS_ENTRIES = 10_000`
With only 1 version per key, you cannot query older values unless you keep external history.

3) **HTTP limits (applied elsewhere but defined here)**
- `DEFAULT_HTTP_RATE_LIMIT_PER_SECOND = 1_000`
- `DEFAULT_HTTP_RATE_LIMIT_BURST = 5_000`
- `DEFAULT_SUBMIT_RATE_LIMIT_PER_MINUTE = 100`
- `DEFAULT_SUBMIT_RATE_LIMIT_BURST = 10`
- `DEFAULT_HTTP_BODY_LIMIT_BYTES = 8 MB`
These may be too low for public testnets with spikes, but are fine for early staging.

4) **WebSocket limits**
- `DEFAULT_WS_MAX_CONNECTIONS = 20_000`
- `DEFAULT_WS_MAX_CONNECTIONS_PER_IP = 10`
- `DEFAULT_WS_MAX_MESSAGE_BYTES = 4 MB`
These are generous but still require tuning based on hardware and traffic.

5) **Update fanout buffers**
- `DEFAULT_UPDATES_BROADCAST_BUFFER = 1_024`
- `DEFAULT_MEMPOOL_BROADCAST_BUFFER = 1_024`
If your consumers fall behind, messages can be dropped. Increase if you see lagged metrics.

6) **Update indexing concurrency**
- `DEFAULT_UPDATES_INDEX_CONCURRENCY = 8`
Higher values increase throughput but also CPU and memory usage.

---

## Walkthrough with code excerpts

### 1) Default limits (selected)
```rust
const DEFAULT_STATE_MAX_KEY_VERSIONS: usize = 1;
const DEFAULT_STATE_MAX_PROGRESS_ENTRIES: usize = 10_000;
const DEFAULT_SUBMISSION_HISTORY_LIMIT: usize = 10_000;
const DEFAULT_SEED_HISTORY_LIMIT: usize = 10_000;
const DEFAULT_HTTP_RATE_LIMIT_PER_SECOND: u64 = 1_000;
const DEFAULT_SUBMIT_RATE_LIMIT_PER_MINUTE: u64 = 100;
const DEFAULT_HTTP_BODY_LIMIT_BYTES: usize = 8 * 1024 * 1024;
const DEFAULT_WS_MAX_CONNECTIONS: usize = 20_000;
const DEFAULT_WS_MAX_MESSAGE_BYTES: usize = 4 * 1024 * 1024;
const DEFAULT_UPDATES_INDEX_CONCURRENCY: usize = 8;
```

Why this matters:
- These defaults are the real safety rails for load, memory, and DoS protection.

What this code does:
- Defines the baseline limits used across the simulator if no config overrides are provided.
- These constants are referenced by `SimulatorConfig::default()` and helper accessors.

---

### 2) Optional config with defaults
```rust
impl Default for SimulatorConfig {
    fn default() -> Self {
        Self {
            submission_history_limit: Some(DEFAULT_SUBMISSION_HISTORY_LIMIT),
            seed_history_limit: Some(DEFAULT_SEED_HISTORY_LIMIT),
            http_rate_limit_per_second: Some(DEFAULT_HTTP_RATE_LIMIT_PER_SECOND),
            submit_rate_limit_per_minute: Some(DEFAULT_SUBMIT_RATE_LIMIT_PER_MINUTE),
            http_body_limit_bytes: Some(DEFAULT_HTTP_BODY_LIMIT_BYTES),
            ws_max_connections: Some(DEFAULT_WS_MAX_CONNECTIONS),
            ws_max_message_bytes: Some(DEFAULT_WS_MAX_MESSAGE_BYTES),
            updates_index_concurrency: Some(DEFAULT_UPDATES_INDEX_CONCURRENCY),
            // many other fields omitted
        }
    }
}

impl SimulatorConfig {
    pub fn updates_index_concurrency(&self) -> usize {
        self.updates_index_concurrency
            .unwrap_or(DEFAULT_UPDATES_INDEX_CONCURRENCY)
            .max(1)
    }
}
```

Why this matters:
- Config values are optional. If a value is missing, the simulator must still behave safely.

What this code does:
- Supplies defaults for key limits by wrapping constants in `Some(...)`.
- Ensures concurrency is never less than 1 when accessed through helpers.
- Establishes safe behavior even when no explicit config is provided.

Syntax notes:
- `unwrap_or` picks a default when `Option` is `None`.
- `.max(1)` prevents zero or negative effective values.

---

### 3) Subscription tracking and snapshots
```rust
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
    fn register(&mut self, filter: &UpdatesFilter) { /* ... */ }
    fn unregister(&mut self, filter: &UpdatesFilter) { /* ... */ }
    fn total_count(&self) -> usize { /* ... */ }

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
```

Why this matters:
- Update filtering prevents unnecessary work and bandwidth. Without it, every client gets the full firehose.

What this code does:
- Tracks how many subscribers exist for all/account/session filters.
- Maintains per-account and per-session counts so unsubscribes can be handled correctly.
- Produces a snapshot to use while indexing events, with `None` meaning "no filter".

Syntax notes:
- `Option<HashSet<...>>` uses `None` to mean "no filter; include all".

---

### 4) EncodedUpdate and proof filtering
```rust
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

async fn build_filtered_update(
    events: &Events,
    proof_store: &ProofStore<Digest>,
    filtered_ops: Vec<(u64, EventOp)>,
) -> Option<EncodedUpdate> {
    if filtered_ops.is_empty() {
        return None;
    }
    let locations_to_include = filtered_ops
        .iter()
        .map(|(loc, _)| Location::from(*loc))
        .collect::<Vec<_>>();
    let filtered_proof = match create_multi_proof(proof_store, &locations_to_include).await {
        Ok(proof) => proof,
        Err(e) => {
            tracing::error!("Failed to generate filtered proof: {:?}", e);
            return None;
        }
    };
    Some(EncodedUpdate::new(Update::FilteredEvents(FilteredEvents {
        progress: events.progress,
        certificate: events.certificate.clone(),
        events_proof: filtered_proof,
        events_proof_ops: filtered_ops,
    })))
}
```

Why this matters:
- This turns raw events into compact, verifiable updates for a specific subscriber.

What this code does:
- Builds a filtered proof only for the requested event locations.
- Returns `None` if there are no filtered ops (nothing to send).
- Packages the filtered events into an `Update::FilteredEvents` and pre-encodes the bytes for reuse.

Syntax notes:
- `Arc<T>` is shared ownership; cloning the `Arc` is cheap.

---

### 5) Event indexing core (filters and routing)
```rust
pub(crate) async fn index_events(
    events: Arc<Events>,
    proof_store: Arc<ProofStore<Digest>>,
    subscriptions: Option<&SubscriptionSnapshot>,
    max_concurrent_proofs: usize,
    index_metrics: Arc<UpdateIndexMetrics>,
) -> IndexedEvents {
    let accounts_filter = subscriptions.and_then(|snapshot| snapshot.accounts.as_ref());
    let sessions_filter = subscriptions.and_then(|snapshot| snapshot.sessions.as_ref());
    let include_all_accounts = subscriptions.map_or(true, |snapshot| snapshot.accounts.is_none());
    let include_all_sessions = subscriptions.map_or(true, |snapshot| snapshot.sessions.is_none());
    let has_account_subs = include_all_accounts || accounts_filter.map_or(false, |set| !set.is_empty());
    let has_session_subs = include_all_sessions || sessions_filter.map_or(false, |set| !set.is_empty());
    let needs_public_ops = has_account_subs;
    let include_full_update = subscriptions.map_or(true, |snapshot| snapshot.all);
    // ... scan events and build per-account/per-session ops ...
```

Why this matters:
- This determines who gets which events. It is the heart of "filtered updates".

What this code does:
- Interprets the subscription snapshot.
- Decides whether to build full updates, public updates, and account/session updates.
- Computes flags like `needs_public_ops` to avoid extra work when nobody needs public data.

Syntax notes:
- `map_or(true, |snapshot| ...)` lets us handle the "no snapshot" case as "include all".

---

### 6) Update indexing concurrency
```rust
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
                    build_filtered_update(events.as_ref(), proof_store.as_ref(), merged_ops).await;
                index_metrics.dec_in_flight();
                index_metrics.record_proof_latency(start.elapsed());
                if update.is_none() {
                    index_metrics.inc_failure();
                }
                drop(permit);
                update.map(|update| (account, update))
            }));
        }
        // ... collect task results ...
    }
```

Why this matters:
- Proof building is expensive. Concurrency limits keep the simulator from melting under load.

What this code does:
- Uses a semaphore to cap parallel proof generation.
- Spawns tasks per account to build filtered updates concurrently.
- Merges public ops into account-specific ops when needed.
- Records metrics for latency and failures for each proof build.

Syntax notes:
- `FuturesUnordered` lets many tasks run in parallel and returns results as they finish.

---

### 7) State storage structure
```rust
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
}
```

Why this matters:
- This is the in-memory database. If these structures are wrong or inconsistent, every query and update is wrong.

What this code does:
- Tracks seeds by height, proof nodes, key history, progress checkpoints, and submitted summaries.
- Uses ordered structures to support pruning of old heights and histories.

Syntax notes:
- `BTreeMap` keeps keys sorted, which helps with "latest" lookups and pruning by height.

---

### 8) Seed submission and broadcast
```rust
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
```

Why this matters:
- Seeds are time-sensitive. If a seed update is missed, clients can no longer verify randomness.

What this code does:
- Inserts the seed keyed by view/height.
- If the seed already exists for that view, it returns early to avoid duplication.
- Prunes old seeds if the history limit is exceeded.
- Broadcasts the seed update outside the lock to avoid holding the write lock during I/O.

Syntax notes:
- The extra scope `{ ... }` ensures the write lock is dropped before broadcasting.

---

### 9) Mempool broadcast
```rust
pub fn submit_transactions(&self, transactions: Vec<Transaction>) {
    if let Err(e) = self.mempool_tx.send(Pending { transactions }) {
        tracing::warn!("Failed to broadcast transactions (no subscribers): {}", e);
    }
}
```

Why this matters:
- This is the only broadcast path for new transactions. If it fails, the rest of the system never sees user actions.

What this code does:
- Wraps transactions in a `Pending` object and sends them on a broadcast channel.
- Does not mutate state; it only publishes to mempool subscribers.

---

### 10) State submission: dedupe + history pruning
```rust
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
    // ... store nodes, keys, progress ...
}
```

Why this matters:
- Prevents re-processing the same summary and limits memory growth.

What this code does:
- Checks if this height was already submitted.
- Keeps a bounded history of submitted state heights for dedupe and pruning.
- Prevents unbounded growth of the `submitted_state` set.

---

### 11) State submission: node storage and key history
```rust
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
            StateOp::Delete(key) => { /* same idea for deletes */ }
            _ => {}
        }
    }
```

Why this matters:
- This is where the simulator's key/value state actually changes.

What this code does:
- Stores proof nodes and reference counts so proofs can be built later.
- Tracks which proof nodes belong to each height so they can be cleaned up.
- Applies each state operation and keeps only the latest version per key (by default).
- Removes keys whose history becomes empty after pruning.

Syntax notes:
- `checked_add` prevents overflow when computing operation locations.

---

### 12) State submission: progress and pruning
```rust
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
```

Why this matters:
- Keeps state memory bounded while preserving enough data for proofs.

What this code does:
- Stores progress data per height along with the aggregate certificate.
- Prunes the oldest entries and releases proof nodes when no longer referenced.
- Uses reference counts so shared nodes are only removed when their count reaches zero.

---

### 13) Events submission: dedupe, index, and broadcast
```rust
pub async fn submit_events(&self, summary: Summary, events_digests: Vec<(Position, Digest)>) {
    let height = summary.progress.height;
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

    self.index_block_from_summary(&summary.progress, &summary.events_proof_ops)
        .await;

    let receiver_count = self.update_tx.receiver_count();
    if receiver_count == 0 {
        return;
    }

    let subscriptions = self.subscription_snapshot(receiver_count);

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
```

Why this matters:
- Events are how clients see the results of transactions. If they are not indexed or broadcast, the UI looks frozen.

What this code does:
- Dedupes submissions by height and prunes history.
- Indexes events for explorer consumers.
- Skips heavy work entirely when there are no subscribers.
- Builds filtered updates and broadcasts them to the update channel.

Syntax notes:
- `receiver_count` lets the simulator skip work when nobody is listening.

---

### 14) Query state and build lookup proofs
```rust
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
        let (progress, certificate) = match state.progress.get(height) {
            Some(value) => value,
            None => return None,
        };
        // ... compute required digests and verify ...
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
        operation: StateOp::Update(variable::Update(*key, value)),
    })
}
```

Why this matters:
- State queries must return both the value and a proof that it is valid.

What this code does:
- Looks up the most recent value for a key.
- Gathers the required proof digests and verifies they are all present.
- Builds a lookup proof on a blocking thread to avoid stalling the async runtime.
- Returns a `Lookup` containing the value plus proof data for verification.

Syntax notes:
- `let StateOp::Update(update) = operation else { ... }` is a match-like pattern that exits early if the variant is wrong.

---

### 15) Update and mempool subscriptions
```rust
pub fn tracked_update_subscriber(
    &self,
    filter: UpdatesFilter,
) -> (broadcast::Receiver<crate::InternalUpdate>, SubscriptionGuard) {
    // IMPORTANT: Create receiver FIRST, then register.
    // This ensures we're subscribed before the tracker knows about us.
    let receiver = self.update_tx.subscribe();
    let guard = self.register_subscription(&filter);
    (receiver, guard)
}

pub fn mempool_subscriber(&self) -> broadcast::Receiver<Pending> {
    self.mempool_tx.subscribe()
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
```

Why this matters:
- Correct subscription tracking prevents missed updates and avoids unnecessary filtering work.

What this code does:
- Creates an update subscriber, then registers it to avoid race conditions.
- Provides a mempool subscriber for pending transactions.
- Builds a snapshot that accounts for "untracked" receivers (subscribers without filters).
- Returns a guard that auto-unregisters when dropped.

Syntax notes:
- The `SubscriptionGuard` removes the subscription when dropped, using Rust's `Drop` trait.

---

## Key takeaways
- The simulator keeps a bounded in-memory state with proofs, seeds, and progress checkpoints.
- Mempool transactions are broadcast on a dedicated channel.
- Event indexing builds filtered, verifiable updates for different subscription types.
- Query endpoints return both data and proofs, built off the stored digests.

## Next lesson
E03 - Node entrypoint + network wiring: `feynman/lessons/E03-node-entrypoint.md`
