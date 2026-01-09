# E32 - Client utilities (operational command-line tools)

Focus files:
- `client/src/bin/stress_test.rs` (load testing infrastructure)
- `client/src/bin/sybil_scan.rs` (anti-fraud detection)
- `client/src/bin/bridge_relayer.rs` (EVM-Commonware bridge relay)
- `client/src/bin/phase_simulation.rs` (economic simulation)
- `client/src/bin/freeroll_snapshot.rs` (tournament snapshot export)
- `client/src/bin/recovery_pool.rs` (vault recovery admin)
- `client/src/bin/session_dump.rs` (session diagnostic tool)
- `client/src/bin/tournament_scheduler.rs` (tournament automation)

Goal: explain the operational tooling ecosystem built on the Nullspace client library. Each utility addresses a specific operational need: load testing, fraud detection, cross-chain bridging, economic modeling, tournament management, and diagnostics. For every excerpt, you will see why it matters and a plain description of what the code does. This lesson reads like a textbook chapter: it introduces the utility philosophy, then walks through each tool with Feynman-style explanations.

---

## 0) Feynman summary (why this lesson matters)

A production blockchain application needs more than just runtime nodes and client APIs. It needs operational tools for testing, monitoring, administration, and incident response. The client utilities are command-line programs built on the Nullspace client library that operators, developers, and administrators use to:

1) Load test the system before production launch (stress_test.rs)
2) Detect fraud patterns in player registration (sybil_scan.rs)
3) Bridge assets between EVM chains and Commonware (bridge_relayer.rs)
4) Model economic behavior for token phase planning (phase_simulation.rs)
5) Export tournament snapshots for eligibility verification (freeroll_snapshot.rs)
6) Administer vault recovery in crisis scenarios (recovery_pool.rs)
7) Debug player and session state for support tickets (session_dump.rs)
8) Automate tournament start/end operations (tournament_scheduler.rs)

Each utility is a standalone binary that imports the client library and executes a specific workflow. They demonstrate how to build higher-level tools on top of the core protocol: transaction signing, state queries, nonce tracking, batch submission, and error handling. If you understand these utilities, you understand the operational layer that keeps a blockchain application running smoothly.

---

## 1) Utility ecosystem overview

### 1.1 Design principles

All utilities share common design patterns:

**Identity verification**: Every utility requires the network identity as a command-line argument. This ensures the utility is talking to the correct chain and can verify state proofs.

**Client library reuse**: All utilities import `nullspace_client::Client` and use its high-level APIs for transaction submission and state queries. No utility directly implements HTTP or encoding logic.

**Structured output**: Utilities that produce reports output JSON with timestamps, metadata, and provenance information (view, height, block number). This makes output machine-readable and auditable.

**Error context**: Utilities use `anyhow::Context` to wrap errors with human-readable descriptions. When a utility fails, the error message explains what went wrong and where.

**Secret handling**: Admin keys and private keys are accepted via command-line flags, environment variables, or file paths. This supports both interactive use and secure production deployment (where keys live in files with restricted permissions).

**Idempotency**: Stateful utilities (bridge relayer, tournament scheduler) persist their progress to disk. If the utility crashes and restarts, it resumes from where it left off without duplicating work.

### 1.2 When to use each utility

| Utility | Use case | Typical user | Frequency |
|---------|----------|--------------|-----------|
| stress_test | Load testing, capacity planning | Developer, DevOps | Before launch, after major changes |
| sybil_scan | Fraud detection, airdrop eligibility | Admin, Analyst | Weekly or on-demand |
| bridge_relayer | Cross-chain asset bridging | Admin, Automated service | Continuous (long-running) |
| phase_simulation | Economic modeling, tokenomics validation | Economist, PM | During planning phase |
| freeroll_snapshot | Tournament eligibility export | Admin | Before Phase 2 launch |
| recovery_pool | Vault crisis management | Admin | Emergency only |
| session_dump | Support ticket investigation | Support, Developer | On-demand per ticket |
| tournament_scheduler | Tournament automation | Automated service | Continuous (long-running) |

### 1.3 Common patterns

All utilities follow this structure:

```rust
// 1. Define CLI arguments with clap
#[derive(Parser, Debug)]
struct Args { ... }

// 2. Decode identity and create client
let identity = decode_identity(&args.identity)?;
let client = Client::new(&args.url, identity)?;

// 3. Execute utility-specific logic
// - Query state
// - Build transactions
// - Submit transactions
// - Generate reports

// 4. Handle errors and output results
```

This consistency makes utilities easy to maintain and extend.

---

## 2) Stress test utility: load testing infrastructure

File: `client/src/bin/stress_test.rs`

### 2.1 Purpose

The stress test utility simulates hundreds of concurrent casino bots playing games at high rates. It measures throughput (transactions per second), latency (submission to completion time), and system stability under load. This is the tool you run before a production launch to verify the chain can handle peak load.

### 2.2 Bot architecture

The utility spawns multiple `BotState` actors, each with its own keypair and nonce counter (lines 56-88):

```rust
struct BotState {
    keypair: PrivateKey,
    name: String,
    nonce: AtomicU64,
    session_counter: AtomicU64,
    games_played: AtomicU64,
}
```

Each bot maintains atomic counters so it can run concurrently without locks. The `next_nonce()` and `next_session_id()` methods use `fetch_add` with `Ordering::Relaxed` (lines 77-83), which means nonces increment atomically even when multiple threads access the same bot.

Why atomic? Because bots run in separate tokio tasks. Without atomics, nonce updates would race and produce duplicate nonces, causing transaction rejections.

### 2.3 Game move generation

The utility includes a full `generate_move_payload` function (lines 121-247) that knows how to play every casino game. For example, Baccarat (lines 123-143):

```rust
GameType::Baccarat => {
    match move_number {
        0 => {
            // Place a bet: [0, bet_type, amount:u64 BE]
            let bet_type = if rng.gen_bool(0.08) {
                2u8 // Tie (rare)
            } else if rng.gen_bool(0.5) {
                0u8 // Player
            } else {
                1u8 // Banker
            };
            let amount = rng.gen_range(5u64..=25u64);
            let mut payload = vec![0, bet_type];
            payload.extend_from_slice(&amount.to_be_bytes());
            payload
        }
        1 => vec![1], // Deal
        _ => vec![],
    }
}
```

Move 0 places a bet (Player, Banker, or Tie), move 1 deals. The bet distribution matches realistic player behavior: Tie bets are rare (8%), Player and Banker are common (50/50 split). Amounts are randomized between 5 and 25 chips.

Why this matters: The stress test exercises realistic game sequences, not just dummy transactions. If the test passes, it proves the game engines can handle real player patterns.

### 2.4 Batch submission

Bots accumulate transactions in a local `Vec<Transaction>` and flush them in batches (lines 249-280):

```rust
async fn flush_batch(
    client: &Arc<Client>,
    pending_txs: &mut Vec<Transaction>,
    metrics: &Arc<Metrics>,
) {
    if pending_txs.is_empty() {
        return;
    }

    let start = Instant::now();
    let num_txs = pending_txs.len();

    match client
        .submit_transactions(std::mem::take(pending_txs))
        .await
    {
        Ok(_) => {
            let latency = start.elapsed().as_millis() as u64;
            for _ in 0..num_txs {
                metrics.record_submit(true, latency);
            }
        }
        Err(e) => {
            warn!("Transaction failed: {}", e);
            let latency = start.elapsed().as_millis() as u64;
            for _ in 0..num_txs {
                metrics.record_submit(false, latency);
            }
        }
    }
}
```

Batching reduces HTTP overhead: instead of one request per transaction, the bot sends 5-10 transactions per request. The `std::mem::take` call (line 263) moves the pending vector out, leaving an empty vector in its place. This is cheaper than cloning.

Metrics (lines 90-118) track success/failure counts and latency. After the test completes, the utility reports aggregated metrics (lines 522-530):

```rust
info!("=== TOURNAMENT SIMULATION RESULTS ===");
info!("Duration: {:.2}s", elapsed.as_secs_f64());
info!("Total Games Played: {}", games_played);
info!(
    "Transactions: {} submitted, {} success, {} failed",
    submitted, success, failed
);
info!("TPS: {:.2}", tps);
info!("Average Latency: {:.2}ms", avg_latency);
```

This is the data you present to stakeholders: "The chain sustained 2500 TPS with 45ms average latency for 5 minutes straight."

### 2.5 Monitor task

The stress test spawns a separate monitor task (lines 375-425) that queries the leaderboard and player state every 5 seconds. This verifies that the chain is processing transactions correctly: if games are played but the leaderboard doesn't update, something is broken.

The monitor uses `client.query_state(&Key::CasinoLeaderboard)` to fetch the current leaderboard and logs the top entries. If the leaderboard is empty or missing, the test logs a warning (lines 394-395).

Why this matters: Submitting transactions is not enough. The monitor proves that transactions are being executed, state is updating, and the chain is producing correct outputs under load.

### 2.6 Running the stress test

Typical invocation:

```bash
cargo run --release --bin stress-test -- \
  --identity <IDENTITY_HEX> \
  --url http://localhost:8080 \
  --num-bots 300 \
  --duration 300 \
  --rate 3.0
```

This spawns 300 bots, each playing games at 3 bets per second, for 5 minutes. Total load: 900 bets per second, plus registration and game moves, so approximately 2500-3000 transactions per second.

---

## 3) Sybil scan utility: anti-fraud detection

File: `client/src/bin/sybil_scan.rs`

### 3.1 Purpose

The sybil scan utility detects clusters of accounts that might be controlled by the same entity. This matters for airdrops, freerolls, and anti-abuse: if one person creates 100 accounts to claim 100x the rewards, that's fraud.

The utility uses heuristic clustering: it groups accounts by IP address, device fingerprint, and registration time. Any cluster above a threshold (default: 3 accounts) is flagged.

### 3.2 Signal collection

The utility fetches all registered players from the on-chain registry (lines 138-174):

```rust
let registry_lookup = client
    .query_state(&Key::PlayerRegistry)
    .await?
    .ok_or_else(|| anyhow!("Player registry not found"))?;

let registry = match operation_value(&registry_lookup.operation) {
    Some(Value::PlayerRegistry(registry)) => registry.clone(),
    _ => return Err(anyhow!("Unexpected registry value")),
};

let mut players: HashMap<String, PlayerSignal> = HashMap::new();
for public in registry.players.iter() {
    let lookup = client.query_state(&Key::CasinoPlayer(public.clone())).await?;
    let Some(lookup) = lookup else {
        continue;
    };
    let Some(Value::CasinoPlayer(player)) = operation_value(&lookup.operation) else {
        continue;
    };

    let public_key_hex = hex(&public.encode());
    players.insert(
        public_key_hex.clone(),
        PlayerSignal {
            public_key_hex,
            name: player.profile.name.clone(),
            created_ts: player.profile.created_ts,
            last_session_ts: player.session.last_session_ts,
            sessions_played: player.session.sessions_played,
            play_seconds: player.session.play_seconds,
            last_tournament_ts: player.tournament.last_tournament_ts,
            ips: Vec::new(),
            device_ids: Vec::new(),
            user_agents: Vec::new(),
            flags: Vec::new(),
        },
    );
}
```

At this point, the utility has on-chain data (registration timestamp, session stats) but no off-chain signals (IP, device). The `PlayerSignal` struct (lines 83-97) stores both types of data.

### 3.3 Metadata enrichment

The utility accepts an optional metadata file (lines 176-208):

```rust
if let Some(path) = args.metadata.as_ref() {
    let entries = load_metadata(Path::new(path))?;
    metadata_records = entries.len();
    for entry in entries {
        let public_key_hex = match normalize_public_key_hex(&entry.public_key_hex) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let Some(signal) = players.get_mut(&public_key_hex) else {
            continue;
        };
        metadata_matched += 1;
        if let Some(ip) = clean_optional(entry.ip) {
            push_unique(&mut signal.ips, ip);
        }
        if let Some(device) = clean_optional(entry.device_id) {
            push_unique(&mut signal.device_ids, device);
        }
        if let Some(ua) = clean_optional(entry.user_agent) {
            push_unique(&mut signal.user_agents, ua);
        }
        // ...
    }
}
```

The metadata file is a JSON array or JSONL file with fields like `public_key_hex`, `ip`, `device_id`, `user_agent`, `created_ts`, `last_seen_ts`. The utility uses flexible field aliases (lines 58-80) to handle different data sources:

```rust
#[serde(
    alias = "public_key",
    alias = "player",
    alias = "player_public_key_hex"
)]
public_key_hex: String,
```

This means the metadata can come from a gateway log, an analytics database, or a third-party service—the utility adapts to the schema.

### 3.4 Cluster detection

The utility builds three types of clusters (lines 210-257):

1. **IP clusters**: All accounts sharing an IP address
2. **Device clusters**: All accounts sharing a device fingerprint
3. **Time clusters**: All accounts registered in the same time bucket

Time clustering (lines 214-225):

```rust
if args.bucket_seconds > 0 {
    for (pk, player) in players.iter() {
        if player.created_ts == 0 {
            continue;
        }
        let bucket = player.created_ts / args.bucket_seconds;
        let bucket_start = bucket.saturating_mul(args.bucket_seconds);
        let bucket_end = bucket_start.saturating_add(args.bucket_seconds);
        let key = format!("{bucket_start}-{bucket_end}");
        time_clusters.entry(key).or_default().push(pk.clone());
    }
}
```

The default bucket is 3600 seconds (1 hour). If 10 accounts register in the same hour, that's a cluster. This catches automated bot registration scripts.

The `build_clusters` function (lines 376-436) filters clusters by minimum size and computes aggregate statistics:

```rust
fn build_clusters(
    kind: &str,
    clusters: HashMap<String, Vec<String>>,
    players: &HashMap<String, PlayerSignal>,
    min_cluster_size: usize,
) -> Vec<Cluster> {
    let mut out = Vec::new();
    for (key, mut members) in clusters {
        members.sort();
        members.dedup();
        if members.len() < min_cluster_size {
            continue;
        }

        let mut created_min: Option<u64> = None;
        let mut created_max: Option<u64> = None;
        let mut sessions_sum: u128 = 0;
        let mut play_sum: u128 = 0;
        let count = members.len();

        for pk in members.iter() {
            if let Some(player) = players.get(pk) {
                if player.created_ts > 0 {
                    created_min = Some(match created_min {
                        Some(value) => value.min(player.created_ts),
                        None => player.created_ts,
                    });
                    created_max = Some(match created_max {
                        Some(value) => value.max(player.created_ts),
                        None => player.created_ts,
                    });
                }
                sessions_sum = sessions_sum.saturating_add(player.sessions_played as u128);
                play_sum = play_sum.saturating_add(player.play_seconds as u128);
            }
        }

        let avg_sessions_played = if count == 0 {
            0.0
        } else {
            sessions_sum as f64 / count as f64
        };
        let avg_play_seconds = if count == 0 {
            0.0
        } else {
            play_sum as f64 / count as f64
        };

        out.push(Cluster {
            kind: kind.to_string(),
            key,
            player_count: count,
            players: members,
            created_ts_min: created_min,
            created_ts_max: created_max,
            avg_sessions_played,
            avg_play_seconds,
        });
    }
    out
}
```

The aggregates help distinguish bots from legitimate shared-IP scenarios. If 10 accounts share an IP but all have 50+ sessions and 5+ hours of playtime, they're probably a family or internet cafe. If they have 0-1 sessions each, they're likely sybils.

### 3.5 Output format

The utility writes a JSON report with clusters and flagged players (lines 278-313):

```rust
let payload = Output {
    generated_at_unix,
    view: registry_lookup.progress.view.get(),
    height: registry_lookup.progress.height,
    bucket_seconds: args.bucket_seconds,
    min_cluster_size: args.min_cluster_size,
    metadata_records,
    metadata_matched,
    total_players: registry.players.len(),
    flagged_players: output_players.len(),
    clusters,
    players: output_players,
};
```

Each player in the output has a `flags` array (lines 259-276):

```rust
for cluster in &clusters {
    let flag = format!("{}:{}", cluster.kind, cluster.key);
    for player in &cluster.players {
        flags_by_player
            .entry(player.clone())
            .or_default()
            .push(flag.clone());
    }
}
```

A player with flags `["ip:192.168.1.1", "created_bucket:1609459200-1609462800"]` is in both an IP cluster and a time cluster. That's strong evidence of abuse.

### 3.6 Running the scan

Typical invocation:

```bash
cargo run --release --bin sybil-scan -- \
  --identity <IDENTITY_HEX> \
  --url http://localhost:8080 \
  --metadata data/player-metadata.json \
  --output data/sybil-scan.json \
  --bucket-seconds 3600 \
  --min-cluster-size 3
```

The output JSON is then reviewed manually or fed into an automated airdrop eligibility filter.

---

## 4) Bridge relayer utility: EVM-Commonware bridge operations

File: `client/src/bin/bridge_relayer.rs`

### 4.1 Purpose

The bridge relayer is a long-running service that syncs deposits and withdrawals between an EVM lockbox contract and the Commonware bridge state. When a user deposits USDT on Ethereum, the relayer sees the event and submits a `BridgeDeposit` instruction to credit the user's account on Commonware. When a user requests a withdrawal, the relayer calls the lockbox contract's `withdraw` function to send tokens back to their EVM address.

This is a critical production service: if the relayer is down, deposits and withdrawals stop flowing.

### 4.2 EVM event scanning

The relayer uses the `ethers` library to query logs from the lockbox contract (lines 384-491):

```rust
async fn scan_evm_deposits(
    config: &RelayerConfig,
    client: &Client,
    admin_private: &PrivateKey,
    admin_public: &PublicKey,
    evm: &EvmContext,
    nonce_tracker: &mut NonceTracker,
    state: &mut RelayerState,
) -> Result<()> {
    let latest_block = evm.provider.get_block_number().await?.as_u64();
    if latest_block < evm.confirmations {
        return Ok(());
    }
    let finalized_block = latest_block.saturating_sub(evm.confirmations);

    if finalized_block < state.last_evm_block {
        return Ok(());
    }

    let mut to_block = finalized_block;
    let max_to = state.last_evm_block.saturating_add(config.evm_log_range);
    if to_block > max_to {
        to_block = max_to;
    }

    let from_block = state.last_evm_block;
    let events = evm
        .lockbox
        .event::<DepositedFilter>()
        .from_block(from_block)
        .to_block(to_block)
        .query_with_meta()
        .await?;
```

The relayer maintains a cursor (`state.last_evm_block`, `state.last_evm_log_index`) so it doesn't process the same event twice. It queries logs in chunks (`evm_log_range`, default 2000 blocks) to avoid RPC timeouts on providers like Infura.

Confirmations (line 394-397): The relayer only processes events that are at least `evm_confirmations` blocks deep (default: 3). This protects against chain reorgs: if a deposit is in block N and the chain reorgs at N+1, the relayer hasn't credited the deposit yet.

### 4.3 Deposit processing

For each `Deposited` event (lines 428-488):

```rust
for (event, meta) in events {
    let block_number = meta.block_number.as_u64();
    let log_index = meta.log_index.as_u64();

    if block_number < state.last_evm_block {
        continue;
    }
    if block_number == state.last_evm_block && log_index <= state.last_evm_log_index {
        continue;
    }

    let recipient = match destination_to_public_key(event.destination) {
        Some(public) => public,
        None => {
            warn!(block_number, log_index, "Invalid deposit destination");
            state.last_evm_block = block_number;
            state.last_evm_log_index = log_index;
            save_state(&config.state_path, state)?;
            continue;
        }
    };

    let amount_rng = match evm_amount_to_rng(event.amount, evm.decimals) {
        Some(amount) => amount,
        None => {
            warn!(block_number, log_index, "Invalid deposit amount");
            state.last_evm_block = block_number;
            state.last_evm_log_index = log_index;
            save_state(&config.state_path, state)?;
            continue;
        }
    };

    let tx_hash = meta.transaction_hash;

    let source = tx_hash.as_bytes().to_vec();
    submit_instruction(
        client,
        admin_private,
        admin_public,
        nonce_tracker,
        Instruction::BridgeDeposit {
            recipient,
            amount: amount_rng,
            source,
        },
    )
    .await
    .with_context(|| "Failed to submit bridge deposit")?;

    info!(
        block_number,
        log_index,
        amount_rng,
        "Bridge deposit credited"
    );

    state.last_evm_block = block_number;
    state.last_evm_log_index = log_index;
    save_state(&config.state_path, state)?;
}
```

The event's `destination` field is a 32-byte value that encodes the recipient's public key. The relayer decodes it (lines 696-703):

```rust
fn destination_to_public_key(destination: [u8; 32]) -> Option<PublicKey> {
    let mut reader: &[u8] = &destination;
    let public = PublicKey::read(&mut reader).ok()?;
    if !reader.is_empty() {
        return None;
    }
    Some(public)
}
```

If decoding fails or there are trailing bytes, the deposit is invalid and the relayer skips it (but still updates the cursor so it doesn't retry forever).

The `evm_amount_to_rng` function (lines 719-733) converts EVM amounts (with 18 decimals) to RNG amounts (whole units):

```rust
fn evm_amount_to_rng(amount: U256, decimals: u32) -> Option<u64> {
    let scale = U256::from(10u64).pow(U256::from(decimals));
    if scale.is_zero() {
        return None;
    }
    let remainder = amount % scale;
    if !remainder.is_zero() {
        return None;
    }
    let whole = amount / scale;
    if whole > U256::from(u64::MAX) {
        return None;
    }
    Some(whole.as_u64())
}
```

Only whole-unit deposits are accepted. If someone deposits 1.5 USDT on Ethereum, the relayer rejects it (to avoid precision loss).

### 4.4 Withdrawal processing

Withdrawals are more complex because they involve three states (lines 493-630):

1. **Unfulfilled**: Withdrawal exists on Commonware but hasn't been submitted to EVM yet
2. **Pending**: EVM transaction submitted but not confirmed
3. **Fulfilled**: EVM transaction confirmed and finalized on Commonware

The relayer maintains a `pending_withdrawals` map in its state (lines 116-155):

```rust
#[derive(Debug, Serialize, Deserialize)]
struct PendingWithdrawal {
    evm_tx_hash: Option<String>,
    blocked: bool,
    blocked_reason: Option<String>,
}
```

For each unfulfilled withdrawal (lines 505-527):

```rust
let now = current_view_time(client).await?;
let latest_block = evm.provider.get_block_number().await?.as_u64();

let pending_ids: Vec<u64> = state.pending_withdrawals.keys().cloned().collect();
for id in pending_ids {
    let pending = match state.pending_withdrawals.get_mut(&id) {
        Some(pending) => pending,
        None => continue,
    };
    if pending.blocked {
        continue;
    }
    let withdrawal = match fetch_withdrawal(client, id).await {
        Ok(withdrawal) => withdrawal,
        Err(err) => {
            warn!(?err, id, "Failed to fetch withdrawal");
            continue;
        }
    };
    if withdrawal.fulfilled {
        state.pending_withdrawals.remove(&id);
        save_state(&config.state_path, state)?;
        continue;
    }
    if now < withdrawal.available_ts {
        continue;
    }
```

If the withdrawal has `available_ts` in the future, the relayer waits. This enforces time-lock withdrawals (security feature: users can't instantly withdraw in case of account compromise).

When ready, the relayer submits an EVM transaction (lines 555-578):

```rust
if pending.evm_tx_hash.is_none() {
    let to = match destination_to_evm_address(&withdrawal.destination) {
        Some(addr) => addr,
        None => {
            pending.block("Invalid withdrawal destination");
            save_state(&config.state_path, state)?;
            warn!(id, "Withdrawal destination invalid");
            continue;
        }
    };
    let amount = rng_to_evm_amount(withdrawal.amount, evm.decimals)?;
    let source = withdrawal_source(&withdrawal);
    let lockbox = evm.lockbox.clone();
    let call = lockbox.withdraw(to, amount, source);
    let pending_tx = call
        .send()
        .await
        .context("Failed to send EVM withdrawal")?;
    let tx_hash = pending_tx.tx_hash();
    pending.evm_tx_hash = Some(format!("{:#x}", tx_hash));
    save_state(&config.state_path, state)?;
    info!(id, tx_hash = %format!("{:#x}", tx_hash), "EVM withdrawal submitted");
    continue;
}
```

Once the transaction is mined and confirmed (lines 580-609):

```rust
let receipt = evm.provider.get_transaction_receipt(tx_hash).await?;
let Some(receipt) = receipt else {
    continue;
};
if receipt.status == Some(U64::zero()) {
    warn!(id, tx_hash = %format!("{:#x}", tx_hash), "EVM withdrawal reverted");
    pending.evm_tx_hash = None;
    save_state(&config.state_path, state)?;
    continue;
}
let receipt_block = receipt
    .block_number
    .map(|num| num.as_u64())
    .unwrap_or(0);
if latest_block < receipt_block.saturating_add(evm.confirmations) {
    continue;
}

submit_instruction(
    client,
    admin_private,
    admin_public,
    nonce_tracker,
    Instruction::FinalizeBridgeWithdrawal {
        withdrawal_id: id,
        source: tx_hash.as_bytes().to_vec(),
    },
)
.await
.context("Failed to finalize withdrawal")?;

info!(id, "Bridge withdrawal finalized");
state.pending_withdrawals.remove(&id);
save_state(&config.state_path, state)?;
```

The relayer submits `FinalizeBridgeWithdrawal` only after the EVM transaction has enough confirmations. This prevents finalization before the EVM transaction is truly final.

### 4.5 State persistence

The relayer uses a JSON state file (lines 336-351):

```rust
fn load_state(path: &str, evm_start_block: u64, withdraw_start_id: u64) -> Result<RelayerState> {
    if !Path::new(path).exists() {
        return Ok(RelayerState::new(evm_start_block, withdraw_start_id));
    }
    let data = fs::read(path).context("Failed to read relayer state")?;
    let state: RelayerState = serde_json::from_slice(&data).context("Failed to parse relayer state")?;
    Ok(state)
}

fn save_state(path: &str, state: &RelayerState) -> Result<()> {
    let data = serde_json::to_vec_pretty(state).context("Failed to serialize relayer state")?;
    let tmp_path = format!("{path}.tmp");
    fs::write(&tmp_path, data).context("Failed to write relayer state")?;
    fs::rename(tmp_path, path).context("Failed to replace relayer state")?;
    Ok(())
}
```

The state contains:

```rust
struct RelayerState {
    last_evm_block: u64,
    last_evm_log_index: u64,
    last_withdrawal_id: u64,
    pending_withdrawals: HashMap<u64, PendingWithdrawal>,
}
```

The atomic write pattern (write to temp file, then rename) ensures the state file is never corrupted: if the process crashes during write, the old state file is still intact.

### 4.6 Running the relayer

Typical invocation:

```bash
cargo run --release --bin bridge-relayer -- \
  --identity <IDENTITY_HEX> \
  --url http://localhost:8080 \
  --admin-key-file /secrets/admin-key.hex \
  --evm-rpc-url https://mainnet.infura.io/v3/PROJECT_ID \
  --evm-private-key <EVM_PRIVATE_KEY> \
  --lockbox-address 0x1234... \
  --evm-chain-id 1 \
  --evm-confirmations 12 \
  --state-path bridge-relayer-state.json \
  --poll-secs 30
```

The relayer polls every 30 seconds, scans for new deposits, checks pending withdrawals, and updates state. It runs forever as a systemd service or Docker container.

---

## 5) Phase simulation utility: economic modeling

File: `client/src/bin/phase_simulation.rs`

### 5.1 Purpose

The phase simulation utility models economic behavior for Phase 1 and Phase 2 of the token launch. It simulates hundreds of days of activity with different player archetypes (grinders, casuals, whales, DeFi users) to validate tokenomics assumptions before launch.

Key outputs:

- How many tokens are staked over time?
- What is the average vault utilization?
- How much swap volume occurs per day?
- Do liquidity pools stay balanced?

This is the tool economists and product managers use to stress-test the economic model.

### 5.2 Actor archetypes

The simulation defines six actor types (lines 71-79):

```rust
enum ActorKind {
    Grinder,    // Plays many sessions daily
    Casual,     // Plays occasionally
    Whale,      // Large bets, swaps, vault usage
    DeFi,       // Heavy DeFi user (swaps, LP, vaults)
    Subscriber, // Pays for subscription via staking
    Lurker,     // Registers but rarely plays
}
```

Each archetype has different daily behavior (lines 199-244):

```rust
fn plan_day(actor: &ActorState, rng: &mut StdRng) -> DayPlan {
    let mut sessions = match actor.kind {
        ActorKind::Grinder => rng.gen_range(6..=14),
        ActorKind::Casual => rng.gen_range(1..=4),
        ActorKind::Whale => rng.gen_range(3..=6),
        ActorKind::DeFi => rng.gen_range(1..=3),
        ActorKind::Subscriber => rng.gen_range(8..=16),
        ActorKind::Lurker => rng.gen_range(0..=1),
    };

    if actor.member {
        sessions += 2;
    }

    let swaps = match actor.kind {
        ActorKind::Whale => rng.gen_range(1..=3),
        ActorKind::DeFi => rng.gen_range(2..=5),
        _ => rng.gen_range(0..=1),
    };

    let vault_actions = match actor.kind {
        ActorKind::Whale => rng.gen_range(1..=2),
        ActorKind::DeFi => rng.gen_range(1..=3),
        _ => 0,
    };

    let liquidity_actions = match actor.kind {
        ActorKind::DeFi => rng.gen_range(0..=2),
        ActorKind::Whale => rng.gen_range(0..=1),
        _ => 0,
    };

    let stake_actions = match actor.kind {
        ActorKind::Subscriber => 1,
        ActorKind::Whale => rng.gen_range(0..=1),
        _ => 0,
    };

    DayPlan {
        sessions,
        swaps,
        vault_actions,
        liquidity_actions,
        stake_actions,
    }
}
```

Grinders play 6-14 sessions per day. Subscribers play 8-16 sessions (they paid for access). Lurkers play 0-1 sessions. This distribution matches observed player behavior in existing casino platforms.

### 5.3 Daily simulation loop

The simulation runs for N days (default: 365) with a configurable `day_seconds` parameter (default: 5 seconds per day, for fast simulation). Each day (lines 565-604):

1. **Churn**: Remove a percentage of existing actors (line 569-578)
2. **Registration**: Add new actors (lines 580-587)
3. **Activity**: Each active actor executes their daily plan (lines 589-598)
4. **Throttle**: Sleep to enforce `day_seconds` pacing (lines 600-603)

```rust
for day in 0..args.days {
    let day_start = Instant::now();
    info!("Simulating day {} (actors: {})", day + 1, actors.len());

    let churned = actors
        .iter()
        .filter(|_| rng.gen_ratio(args.daily_churn_bps, 10_000))
        .count();
    for _ in 0..churned {
        if !actors.is_empty() {
            let idx = rng.gen_range(0..actors.len());
            actors.swap_remove(idx);
        }
    }

    let start_id = actors.len();
    for id in start_id..start_id + args.daily_new_players {
        let kind = choose_actor_kind(&mut rng);
        let member = rng.gen_ratio(args.member_share_bps, 10_000);
        let mut actor = ActorState::new(id, kind, member, &mut rng);
        register_actor(&client, &mut actor, args.initial_deposit, args.dry_run).await;
        actors.push(actor);
    }

    for actor in actors.iter_mut() {
        if !rng.gen_ratio(args.daily_active_bps, 10_000) {
            continue;
        }
        let plan = plan_day(actor, &mut rng);
        for _ in 0..plan.sessions {
            play_session(&client, actor, &mut rng, args.dry_run).await;
        }
        perform_defi_actions(&client, actor, &mut rng, &plan, args.dry_run).await;
    }

    let elapsed = day_start.elapsed();
    if elapsed < Duration::from_secs(args.day_seconds) {
        time::sleep(Duration::from_secs(args.day_seconds) - elapsed).await;
    }
}
```

The `daily_active_bps` parameter (default: 2500 = 25%) controls what fraction of actors are active each day. This matches real-world retention curves: most users don't play every single day.

### 5.4 DeFi action simulation

DeFi actions (swaps, vaults, liquidity) are batched together (lines 442-536):

```rust
async fn perform_defi_actions(
    client: &Client,
    actor: &mut ActorState,
    rng: &mut StdRng,
    plan: &DayPlan,
    dry_run: bool,
) {
    let mut txs = Vec::with_capacity(6);

    for _ in 0..plan.swaps {
        let amount_in = rng.gen_range(10u64..=150u64);
        let is_buying_rng = rng.gen_bool(0.5);
        let swap_nonce = actor.next_nonce();
        let tx = Transaction::sign(
            &actor.keypair,
            swap_nonce,
            Instruction::Swap {
                amount_in,
                min_amount_out: 0,
                is_buying_rng,
            },
        );
        txs.push(tx);
        actor.swaps += 1;
    }

    for _ in 0..plan.liquidity_actions {
        let rng_amount = rng.gen_range(20u64..=200u64);
        let usdt_amount = rng.gen_range(20u64..=200u64);
        let lp_nonce = actor.next_nonce();
        let tx = Transaction::sign(
            &actor.keypair,
            lp_nonce,
            Instruction::AddLiquidity {
                rng_amount,
                usdt_amount,
            },
        );
        txs.push(tx);
        actor.liquidity_actions += 1;
    }

    for _ in 0..plan.vault_actions {
        if !actor.has_vault {
            let vault_nonce = actor.next_nonce();
            let tx = Transaction::sign(
                &actor.keypair,
                vault_nonce,
                Instruction::CreateVault,
            );
            txs.push(tx);
            actor.has_vault = true;
        }
        let collateral = rng.gen_range(25u64..=150u64);
        let borrow = rng.gen_range(10u64..=75u64);
        let deposit_nonce = actor.next_nonce();
        let deposit_tx = Transaction::sign(
            &actor.keypair,
            deposit_nonce,
            Instruction::DepositCollateral { amount: collateral },
        );
        let borrow_nonce = actor.next_nonce();
        let borrow_tx = Transaction::sign(
            &actor.keypair,
            borrow_nonce,
            Instruction::BorrowUSDT { amount: borrow },
        );
        txs.push(deposit_tx);
        txs.push(borrow_tx);
        actor.vault_actions += 1;
    }

    for _ in 0..plan.stake_actions {
        if !actor.staked_once {
            let duration = rng.gen_range(7u64..=30u64);
            let amount = rng.gen_range(50u64..=200u64);
            let stake_nonce = actor.next_nonce();
            let tx = Transaction::sign(
                &actor.keypair,
                stake_nonce,
                Instruction::Stake { amount, duration },
            );
            txs.push(tx);
            actor.staked_once = true;
            actor.stakes += 1;
        } else if rng.gen_bool(0.3) {
            let claim_nonce = actor.next_nonce();
            let tx = Transaction::sign(&actor.keypair, claim_nonce, Instruction::ClaimRewards);
            txs.push(tx);
            actor.stakes += 1;
        }
    }

    submit_batch(client, &mut txs, dry_run).await;
}
```

Vault usage is especially interesting: the actor creates a vault (once), deposits collateral, then borrows USDT. This models leveraged gameplay: users deposit RNG as collateral, borrow USDT, play with USDT, potentially win, repay debt, keep profits.

Staking is one-time: once an actor stakes, they only claim rewards afterward (with 30% probability per day).

### 5.5 Output and analysis

The simulation produces a JSON report with per-actor summaries (lines 606-614):

```rust
let snapshots: Vec<ActorSnapshot> = actors.iter().map(|actor| actor.snapshot()).collect();
if let Some(output) = args.output {
    let payload = serde_json::json!({
        "days": args.days,
        "elapsed_seconds": start.elapsed().as_secs(),
        "actors": snapshots,
    });
    std::fs::write(output, serde_json::to_string_pretty(&payload)?)?;
}
```

Each snapshot includes:

```rust
struct ActorSnapshot {
    name: String,
    public_key_hex: String,
    kind: ActorKind,
    member: bool,
    sessions: u64,
    swaps: u64,
    vault_actions: u64,
    liquidity_actions: u64,
    stakes: u64,
}
```

Analysts load the JSON into a spreadsheet or Jupyter notebook and compute:

- Total sessions per actor archetype
- Average swaps per whale vs. grinder
- Vault utilization by user segment
- Staking adoption rate over time

This informs decisions like "Should we reduce vault collateral requirements?" or "Do we need higher LP incentives?"

### 5.6 Running the simulation

Typical invocation:

```bash
cargo run --release --bin phase-simulation -- \
  --identity <IDENTITY_HEX> \
  --url http://localhost:8080 \
  --days 365 \
  --day-seconds 5 \
  --initial-players 1000 \
  --daily-new-players 25 \
  --daily-churn-bps 50 \
  --daily-active-bps 2500 \
  --member-share-bps 1000 \
  --output simulation-results.json \
  --export-keys actor-keys.json
```

This simulates 365 days in ~30 minutes (5 seconds per day). The output files contain all actor behavior and keys (for follow-up queries).

---

## 6) Freeroll snapshot utility: tournament eligibility export

File: `client/src/bin/freeroll_snapshot.rs`

### 6.1 Purpose

The freeroll snapshot utility exports a JSON file listing all players with freeroll credits above a threshold. This is used for Phase 2 eligibility: players who participated in Phase 1 freeroll tournaments get bonus credits in Phase 2.

The snapshot is a point-in-time record with view, height, and timestamp metadata for auditability.

### 6.2 Snapshot structure

The utility queries the player registry and fetches each player's freeroll credits (lines 81-124):

```rust
let client = Client::new(&args.url, identity)?;
let registry_lookup = client.query_state(&Key::PlayerRegistry).await?;
let Some(registry_lookup) = registry_lookup else {
    return Err("Player registry not found".into());
};

let registry = match operation_value(&registry_lookup.operation) {
    Some(Value::PlayerRegistry(registry)) => registry.clone(),
    _ => return Err("Unexpected registry value".into()),
};

let mut players = Vec::new();
let mut total_credits: u128 = 0;

for public in registry.players.iter() {
    let lookup = client.query_state(&Key::CasinoPlayer(public.clone())).await?;
    let Some(lookup) = lookup else {
        continue;
    };
    let Some(Value::CasinoPlayer(player)) = operation_value(&lookup.operation) else {
        continue;
    };

    let unlocked = player.balances.freeroll_credits;
    let locked = player.balances.freeroll_credits_locked;
    let total = if args.unlocked_only {
        unlocked
    } else {
        unlocked.saturating_add(locked)
    };
    if total < args.min_credits {
        continue;
    }

    total_credits = total_credits.saturating_add(total as u128);
    players.push(PlayerSnapshot {
        public_key_hex: hex(&public.encode()),
        name: player.profile.name.clone(),
        freeroll_credits: unlocked,
        freeroll_credits_locked: locked,
        freeroll_credits_total: total,
        created_ts: player.profile.created_ts,
        last_tournament_ts: player.tournament.last_tournament_ts,
    });
}
```

The `--unlocked-only` flag (line 105) controls whether locked credits count. Locked credits are credits from ongoing tournaments; unlocked credits are from completed tournaments. For Phase 2 eligibility, you might only count unlocked credits to avoid users gaming the system by joining tournaments without playing.

### 6.3 Output format

The snapshot includes provenance metadata (lines 126-142):

```rust
let generated_at_unix = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0);

let payload = Snapshot {
    generated_at_unix,
    view: registry_lookup.progress.view.get(),
    height: registry_lookup.progress.height,
    unlocked_only: args.unlocked_only,
    min_credits: args.min_credits,
    total_players: registry.players.len(),
    total_eligible: players.len(),
    total_credits: total_credits.to_string(),
    players,
};
```

The `view` and `height` fields prove the snapshot was taken at a specific consensus point. If someone disputes eligibility, you can replay the chain to that height and verify the snapshot is correct.

### 6.4 Running the snapshot

Typical invocation:

```bash
cargo run --release --bin freeroll-snapshot -- \
  --identity <IDENTITY_HEX> \
  --url http://localhost:8080 \
  --output data/phase1-freeroll-snapshot.json \
  --min-credits 10 \
  --unlocked-only
```

The output JSON is then published (e.g., on IPFS) and used as the eligibility list for Phase 2 airdrops or tournament invitations.

---

## 7) Recovery pool utility: vault recovery administration

File: `client/src/bin/recovery_pool.rs`

### 7.1 Purpose

The recovery pool utility is an admin tool for managing the vault recovery pool. The recovery pool is a reserve of USDT that's used to retire bad debt when vaults become insolvent (collateral value falls below debt value).

This is a crisis management tool: if the market crashes and many vaults become underwater, the admin uses this utility to inject funds and retire debt to keep the system solvent.

### 7.2 Command structure

The utility has three subcommands (lines 42-57):

```rust
enum Command {
    /// Fund the on-chain recovery pool accounting (vUSDT units).
    Fund {
        amount: u64,
    },
    /// Retire debt for a specific vault.
    Retire {
        target: String,
        amount: u64,
    },
    /// Retire debt for the worst LTV vault.
    RetireWorst {
        amount: u64,
    },
}
```

**Fund**: Adds USDT to the recovery pool balance (on-chain accounting). This doesn't transfer real tokens; it's an accounting entry that authorizes the recovery pool to use up to `amount` USDT for debt retirement.

**Retire**: Retires a specific vault's debt by `amount`. The admin specifies the target player's public key. The on-chain handler reduces the vault's debt and deducts from the recovery pool balance.

**RetireWorst**: Automatically retires debt for the vault with the worst LTV (loan-to-value ratio). This is the most at-risk vault. The on-chain handler identifies it and retires `amount` of its debt.

### 7.3 Execution flow

The utility fetches the admin's nonce, signs a transaction, and submits it (lines 78-99):

```rust
let nonce = fetch_nonce(&client, &admin_public).await?;

let instruction = match args.command {
    Command::Fund { amount } => Instruction::FundRecoveryPool { amount },
    Command::Retire { target, amount } => {
        let target_key = decode_public_key(&target)?;
        Instruction::RetireVaultDebt {
            target: target_key,
            amount,
        }
    }
    Command::RetireWorst { amount } => Instruction::RetireWorstVaultDebt { amount },
};

let tx = Transaction::sign(&admin_private, nonce, instruction);
client
    .submit_transactions(vec![tx])
    .await
    .context("Failed to submit recovery pool transaction")?;

info!(nonce, "Recovery pool transaction submitted");
```

Admin keys are loaded from environment variables or files (lines 69-74):

```rust
let admin_key = require_arg_or_env_or_file(
    args.admin_key,
    args.admin_key_file,
    "CASINO_ADMIN_PRIVATE_KEY_HEX",
    "CASINO_ADMIN_PRIVATE_KEY_FILE",
);
```

This allows production deployments to store keys in secret management systems (AWS Secrets Manager, Vault) without hardcoding them in scripts.

### 7.4 Running the utility

Typical invocations:

```bash
# Fund the recovery pool with 100,000 USDT
cargo run --release --bin recovery-pool -- \
  --identity <IDENTITY_HEX> \
  --url http://localhost:8080 \
  --admin-key-file /secrets/admin-key.hex \
  fund 100000

# Retire 5,000 USDT of debt for a specific vault
cargo run --release --bin recovery-pool -- \
  --identity <IDENTITY_HEX> \
  --url http://localhost:8080 \
  --admin-key-file /secrets/admin-key.hex \
  retire <PLAYER_PUBKEY_HEX> 5000

# Retire 10,000 USDT from the worst vault
cargo run --release --bin recovery-pool -- \
  --identity <IDENTITY_HEX> \
  --url http://localhost:8080 \
  --admin-key-file /secrets/admin-key.hex \
  retire-worst 10000
```

The admin monitors vault health with analytics dashboards and invokes these commands during market volatility.

---

## 8) Session dump utility: session diagnostics

File: `client/src/bin/session_dump.rs`

### 8.1 Purpose

The session dump utility is a support tool for investigating player issues. When a player reports "My game is stuck" or "I didn't get my payout", support uses this utility to dump the session state, player state, tournament state, leaderboard, and recent game history.

The output is a JSON document that contains all relevant information for debugging.

### 8.2 Session and player queries

The utility accepts either `--session-id` or `--player` (lines 124-164):

```rust
if args.session_id.is_none() && args.player.is_none() {
    return Err(anyhow!("Provide --session-id or --player"));
}

let identity = decode_identity(&args.identity)?;
let client = Client::new(&args.url, identity)?;

let mut session_summary = None;
let mut player_hex = args.player.as_deref().map(|s| s.to_string());
let mut tournament_debug = None;

if let Some(session_id) = args.session_id {
    let lookup = client.query_state(&Key::CasinoSession(session_id)).await?;
    if let Some(Value::CasinoSession(session)) =
        lookup.and_then(|lookup| operation_value(&lookup.operation).cloned())
    {
        let pk_hex = hex(&session.player.encode());
        player_hex = Some(pk_hex.clone());
        session_summary = Some(SessionSummary {
            id: session.id,
            player: pk_hex,
            game_type: format!("{:?}", session.game_type),
            bet: session.bet,
            move_count: session.move_count,
            created_at: session.created_at,
            is_complete: session.is_complete,
            is_tournament: session.is_tournament,
            tournament_id: session.tournament_id,
            state_blob_len: session.state_blob.len(),
            state_blob_head_hex: state_blob_head_hex(&session.state_blob),
        });

        if let Some(tournament_id) = session.tournament_id {
            if let Ok(Some(tournament)) = fetch_tournament(&client, tournament_id).await {
                tournament_debug = Some(format!("{tournament:?}"));
            }
        }
    } else {
        warn!(session_id, "casino session not found");
    }
}
```

If `--session-id` is provided, the utility fetches the session and extracts the player key. It also fetches the tournament state if the session is a tournament session.

The `state_blob_head_hex` function (lines 80-83) previews the first 64 bytes of the session's binary state:

```rust
fn state_blob_head_hex(blob: &[u8]) -> String {
    let preview_len = blob.len().min(64);
    hex(&blob[..preview_len])
}
```

This is useful for spotting corrupted state (e.g., all zeros, or unexpected length).

### 8.3 Player and leaderboard queries

The utility fetches the player's full state and the global leaderboard (lines 166-184):

```rust
let mut player_debug = None;
if let Some(pk_hex) = player_hex.as_deref() {
    let raw = commonware_utils::from_hex(pk_hex).ok_or_else(|| anyhow!("Invalid player hex"))?;
    let public = commonware_cryptography::ed25519::PublicKey::decode(&mut raw.as_slice())
        .context("Failed to decode player public key")?;
    let lookup = client.query_state(&Key::CasinoPlayer(public)).await?;
    if let Some(Value::CasinoPlayer(player)) =
        lookup.and_then(|lookup| operation_value(&lookup.operation).cloned())
    {
        player_debug = Some(format!("{player:?}"));
    } else {
        warn!(player = %pk_hex, "casino player not found");
    }
}

let leaderboard_debug = fetch_leaderboard(&client)
    .await?
    .map(|leaderboard| format!("{leaderboard:?}"));
```

The `player_debug` field contains the full Rust `Debug` output of the player struct. This includes balances, session counts, tournament participation, etc. It's verbose but comprehensive.

### 8.4 Game history integration

If the explorer service is running, the utility fetches recent game history (lines 101-115):

```rust
async fn fetch_game_history(
    client: &Client,
    player_hex: &str,
    limit: usize,
) -> Result<Option<JsonValue>> {
    let url = client
        .base_url
        .join(&format!("explorer/games/{player_hex}?limit={limit}"))?;
    let response = client.http_client.get(url).send().await?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let data = response.json::<JsonValue>().await?;
    Ok(Some(data))
}
```

This hits the `/explorer/games/{player}` endpoint which returns the last N games with outcomes, payouts, and timestamps. Combined with the session state, this gives a complete picture of the player's recent activity.

### 8.5 Output structure

The utility outputs a structured JSON document (lines 191-202):

```rust
let output = SessionDump {
    generated_at_ms: now_ms(),
    session_id: args.session_id,
    player_public_key: player_hex,
    session: session_summary,
    player_debug,
    tournament_debug,
    leaderboard_debug,
    game_history,
};

println!("{}", serde_json::to_string_pretty(&output)?);
```

Support agents copy-paste this JSON into a support ticket or share it with developers for investigation.

### 8.6 Running the dump

Typical invocation:

```bash
# Dump by session ID
cargo run --release --bin session-dump -- \
  --identity <IDENTITY_HEX> \
  --url http://localhost:8080 \
  --session-id 123456789 \
  --history-limit 10

# Dump by player
cargo run --release --bin session-dump -- \
  --identity <IDENTITY_HEX> \
  --url http://localhost:8080 \
  --player <PLAYER_PUBKEY_HEX> \
  --history-limit 10
```

The output goes to stdout; redirect to a file for archival: `... > session-123456789.json`.

---

## 9) Tournament scheduler utility: tournament automation

File: `client/src/bin/tournament_scheduler.rs`

### 9.1 Purpose

The tournament scheduler is a long-running service that automatically starts and ends freeroll tournaments on a fixed schedule. Tournaments run every N hours (default: 4 per day, so every 6 hours), with a registration period followed by an active period.

This is critical for production: without the scheduler, tournaments don't start automatically, and players can't participate.

### 9.2 Schedule calculation

The scheduler uses deterministic slot-based scheduling (lines 97-112):

```rust
fn schedule_for_time(now_ms: u64) -> ScheduleSlot {
    let cycle_ms = DAY_MS / TOURNAMENTS_PER_DAY.max(1);
    let tournament_ms = TOURNAMENT_DURATION_SECS.saturating_mul(1000);
    let registration_ms = cycle_ms.saturating_sub(tournament_ms);

    let slot = now_ms / cycle_ms.max(1);
    let slot_start_ms = slot * cycle_ms;
    let start_time_ms = slot_start_ms.saturating_add(registration_ms);
    let end_time_ms = start_time_ms.saturating_add(tournament_ms);

    ScheduleSlot {
        slot,
        start_time_ms,
        end_time_ms,
    }
}
```

Example with 4 tournaments per day and 30-minute duration:

- `cycle_ms` = 86,400,000 / 4 = 21,600,000 ms (6 hours)
- `tournament_ms` = 30 * 60 * 1000 = 1,800,000 ms (30 minutes)
- `registration_ms` = 21,600,000 - 1,800,000 = 19,800,000 ms (5.5 hours)

So each 6-hour slot has 5.5 hours of registration, then 30 minutes of active tournament.

The `slot` calculation (line 102) converts any timestamp to a slot number: `now_ms / cycle_ms`. This ensures that if the scheduler restarts, it computes the same slot for the same wall-clock time.

### 9.3 Main loop

The scheduler polls every N seconds (default: 5) and checks if it's time to start or end tournaments (lines 207-292):

```rust
let mut ticker = interval(Duration::from_secs(args.poll_secs.max(1)));
loop {
    ticker.tick().await;
    let now_ms = now_ms()?;
    let slot = schedule_for_time(now_ms);
    let prev_slot = slot.slot.saturating_sub(1);
    let slots = if prev_slot == slot.slot {
        vec![slot.slot]
    } else {
        vec![prev_slot, slot.slot]
    };

    for tournament_id in slots {
        let schedule = if tournament_id == slot.slot {
            slot
        } else {
            let slot_start = schedule_for_time(slot.start_time_ms.saturating_sub(1));
            ScheduleSlot {
                slot: prev_slot,
                start_time_ms: slot_start.start_time_ms,
                end_time_ms: slot_start.end_time_ms,
            }
        };

        let tournament = fetch_tournament(&client, tournament_id).await?;
        let phase = tournament
            .as_ref()
            .map(|t| t.phase)
            .unwrap_or(TournamentPhase::Registration);

        if now_ms >= schedule.end_time_ms {
            if phase == TournamentPhase::Active && last_ended_slot != Some(tournament_id) {
                info!(
                    tournament_id,
                    end_time_ms = schedule.end_time_ms,
                    "ending tournament"
                );
                if let Err(err) = submit_instruction(
                    &client,
                    &admin_private,
                    &admin_public,
                    &mut nonce_tracker,
                    Instruction::CasinoEndTournament { tournament_id },
                )
                .await
                {
                    warn!(tournament_id, "failed to end tournament: {err}");
                } else {
                    last_ended_slot = Some(tournament_id);
                }
            }
            continue;
        }

        if now_ms >= schedule.start_time_ms
            && now_ms < schedule.end_time_ms
            && phase != TournamentPhase::Active
            && phase != TournamentPhase::Complete
            && last_started_slot != Some(tournament_id)
        {
            info!(
                tournament_id,
                start_time_ms = schedule.start_time_ms,
                end_time_ms = schedule.end_time_ms,
                "starting tournament"
            );
            if let Err(err) = submit_instruction(
                &client,
                &admin_private,
                &admin_public,
                &mut nonce_tracker,
                Instruction::CasinoStartTournament {
                    tournament_id,
                    start_time_ms: schedule.start_time_ms,
                    end_time_ms: schedule.end_time_ms,
                },
            )
            .await
            {
                warn!(tournament_id, "failed to start tournament: {err}");
            } else {
                last_started_slot = Some(tournament_id);
            }
        }
    }
}
```

The scheduler checks both the current slot and the previous slot (lines 211-217). This handles edge cases where the scheduler is down for a full cycle: when it comes back up, it sees the previous slot's tournament is stuck in Active phase and ends it.

The `last_started_slot` and `last_ended_slot` variables prevent double-submission (lines 198-199): if the scheduler already started slot 42's tournament, it won't try to start it again on the next poll.

### 9.4 Nonce tracking

The scheduler uses a `NonceTracker` (lines 52-81) identical to the bridge relayer's nonce tracker:

```rust
struct NonceTracker {
    next_nonce: Option<u64>,
}

impl NonceTracker {
    fn new() -> Self {
        Self { next_nonce: None }
    }

    async fn sync(&mut self, client: &Client, public: &PublicKey) -> Result<u64> {
        let lookup = client.query_state(&Key::Account(public.clone())).await?;
        let nonce = match lookup.and_then(|lookup| operation_value(&lookup.operation).cloned()) {
            Some(Value::Account(account)) => account.nonce,
            _ => 0,
        };
        self.next_nonce = Some(nonce);
        Ok(nonce)
    }

    async fn next(&mut self, client: &Client, public: &PublicKey) -> Result<u64> {
        if let Some(nonce) = self.next_nonce {
            self.next_nonce = Some(nonce.saturating_add(1));
            Ok(nonce)
        } else {
            let nonce = self.sync(client, public).await?;
            self.next_nonce = Some(nonce.saturating_add(1));
            Ok(nonce)
        }
    }
}
```

If a transaction fails, the scheduler calls `sync` to re-fetch the nonce from the chain (line 171). This handles cases where another process used the admin key.

### 9.5 Running the scheduler

Typical invocation:

```bash
cargo run --release --bin tournament-scheduler -- \
  --identity <IDENTITY_HEX> \
  --url http://localhost:8080 \
  --admin-key-file /secrets/admin-key.hex \
  --poll-secs 5
```

The scheduler runs forever as a systemd service or Docker container. Logs show start/end events for observability.

---

## 10) Limits and operational considerations

### 10.1 Rate limits and quotas

All utilities must respect node rate limits:

- **Stress test**: Batches transactions (5-10 per request) to avoid hitting per-second submission limits. If the node rate-limits, the bot backs off (via HTTP 429 responses).
- **Bridge relayer**: Polls every 30 seconds (configurable). More frequent polling is wasteful and increases RPC costs (for EVM providers).
- **Tournament scheduler**: Polls every 5 seconds. Starting/ending tournaments is infrequent (every 6 hours), so aggressive polling is unnecessary.

### 10.2 Secret management

Production deployments must protect admin keys:

- **Environment variables**: `CASINO_ADMIN_PRIVATE_KEY_HEX` is fine for development but risky in production (env vars are visible in process listings).
- **File paths**: Store keys in files with 0600 permissions, owned by the service user. Example: `/secrets/admin-key.hex`.
- **Secret managers**: In cloud environments, fetch keys from AWS Secrets Manager, GCP Secret Manager, or HashiCorp Vault at startup.

### 10.3 Idempotency and state persistence

Stateful utilities (bridge relayer, tournament scheduler) must handle restarts gracefully:

- **Bridge relayer**: Persists `last_evm_block`, `last_evm_log_index`, `last_withdrawal_id`, and `pending_withdrawals` to a JSON file. On restart, it resumes from the saved state.
- **Tournament scheduler**: Tracks `last_started_slot` and `last_ended_slot` in memory. If the scheduler restarts mid-tournament, it recomputes the schedule and sees the tournament is already in the correct phase (idempotent).

### 10.4 Error handling and retries

All utilities use `anyhow::Context` for error messages:

```rust
.await
.context("Failed to submit bridge deposit")?;
```

This produces errors like:

```
Failed to submit bridge deposit: HTTP error 500 Internal Server Error
```

The context explains *what* failed (deposit submission) and *why* (HTTP 500). This is essential for debugging production issues.

Long-running utilities (bridge relayer, tournament scheduler) log warnings on transient errors and continue:

```rust
if let Err(err) = scan_evm_deposits(...).await {
    warn!(?err, "EVM deposit scan failed");
}
```

They do not crash on first error. This is critical for uptime: a transient EVM RPC timeout shouldn't kill the relayer.

### 10.5 Monitoring and alerting

Production deployments should monitor:

- **Bridge relayer**: Alert if `pending_withdrawals` grows without bound (indicates EVM transactions are failing). Alert if no deposits are processed for N minutes (indicates relayer is stuck or EVM RPC is down).
- **Tournament scheduler**: Alert if a tournament fails to start or end within 5 minutes of scheduled time. Alert if the scheduler crashes (monitor with systemd or Docker health checks).
- **Stress test**: Run in CI/CD before production deployments. If TPS or latency degrade, block the deployment.

---

## 11) Feynman recap

The client utilities are operational tools that demonstrate how to build production systems on top of the Nullspace protocol. They share common patterns:

1. **Stress test utility** simulates hundreds of bots playing casino games at high rates to measure throughput, latency, and system stability under load. It uses atomic counters for nonce tracking, batches transactions to reduce HTTP overhead, and monitors the leaderboard to verify correctness.

2. **Sybil scan utility** detects fraud by clustering accounts that share IP addresses, device fingerprints, or registration times. It fetches on-chain state, enriches it with off-chain metadata, and produces a JSON report flagging suspicious accounts.

3. **Bridge relayer utility** syncs deposits and withdrawals between an EVM lockbox contract and Commonware bridge state. It scans EVM events with confirmation delays, maintains persistent state across restarts, and handles three-state withdrawals (unfulfilled, pending, fulfilled).

4. **Phase simulation utility** models economic behavior over hundreds of simulated days with different player archetypes. It generates realistic game sessions, DeFi transactions, and outputs JSON for economic analysis.

5. **Freeroll snapshot utility** exports a point-in-time record of all players with freeroll credits above a threshold. It includes view, height, and timestamp metadata for auditability.

6. **Recovery pool utility** is an admin tool for managing the vault recovery pool during crisis scenarios. It supports funding the pool, retiring specific vaults' debt, or automatically retiring the worst vault.

7. **Session dump utility** is a support tool for investigating player issues. It dumps session state, player state, tournament state, leaderboard, and recent game history in a single JSON document.

8. **Tournament scheduler utility** is a long-running service that automatically starts and ends tournaments on a fixed schedule. It uses slot-based scheduling, nonce tracking, and idempotent logic to handle restarts.

These utilities demonstrate critical patterns for blockchain operations: nonce management, batch submission, state queries, error handling, secret management, idempotency, and monitoring. If you understand these utilities, you understand how to operate a production blockchain application beyond just running validator nodes.

---

## 12) Key takeaways

1. **Utilities are operational tools**, not runtime components. They're invoked by operators, developers, and automated systems to test, monitor, administer, and debug the blockchain.

2. **All utilities import the client library**. They don't reimplement HTTP, encoding, or signing. This ensures consistency and reduces maintenance burden.

3. **Structured output is critical**. JSON with timestamps, view, height, and metadata makes output auditable and machine-readable.

4. **Secret handling must be flexible**. Support command-line flags, environment variables, and file paths to accommodate different deployment environments.

5. **Idempotency is non-negotiable**. Stateful utilities must persist progress and handle restarts gracefully without duplicating work.

6. **Error messages must have context**. Use `anyhow::Context` to wrap errors with human-readable descriptions of what failed and why.

7. **Long-running utilities don't crash on transient errors**. They log warnings and retry. This is essential for production uptime.

8. **Monitoring and alerting are production requirements**. Utilities should expose metrics (via logs or structured output) that feed into alerting systems.

---

## 13) Exercises

1. **Extend stress test with new game**: Add support for a new casino game (e.g., Dice) to `generate_move_payload`. Verify the stress test can play the new game without errors.

2. **Add sybil detection heuristic**: Extend the sybil scan utility to detect accounts with identical session timings (e.g., all sessions start at the same second of the hour). This catches bots running on cron schedules.

3. **Implement bridge relayer metrics**: Extend the bridge relayer to expose Prometheus metrics: `deposits_processed_total`, `withdrawals_fulfilled_total`, `pending_withdrawals_count`, `last_scan_timestamp_seconds`. Use these metrics to build Grafana dashboards.

4. **Simulate vault liquidation scenario**: Extend the phase simulation utility to include a "market crash" event on day 100: all RNG prices drop by 50%. Measure how many vaults become insolvent and how much recovery pool funding is needed.

5. **Build player support dashboard**: Create a web UI that calls the session dump utility and renders the output in a human-friendly format. Include links to the explorer, transaction history, and on-chain state.
