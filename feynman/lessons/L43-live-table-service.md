# L43 - Live-table service engine (off-chain) (from scratch)

Focus file: `services/live-table/src/main.rs`

Goal: explain how the off-chain live-table service runs the craps loop, processes bets, and communicates over WebSockets. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Off-chain game loop
The live-table service runs a state machine (betting -> locked -> rolling -> payout -> cooldown). It advances time locally instead of waiting for on-chain blocks.

### 2) Deterministic RNG
Even though this is off-chain, it still uses the same game logic and seeded RNG as on-chain. That keeps results reproducible.

### 3) WebSocket fan-out
Clients connect via WebSocket. The server broadcasts state updates and sends player-specific results.

### 4) Concurrency model
The engine is wrapped in `Arc<Mutex<...>>`. Each WebSocket handler locks it briefly to update state, while a background tick loop advances phases.

---

## Limits & management callouts (important)

1) **Timing defaults**
- Betting: 18s, Lock: 2s, Payout: 2s, Cooldown: 8s.
- These are in `LIVE_TABLE_*` env vars and control UX and throughput.

2) **Broadcast buffer is 1024**
- `broadcast::channel::<OutboundEvent>(1024)` limits queued events.
- If clients are slow, messages may drop.

3) **Bot settings are defaults**
- `LIVE_TABLE_BOT_COUNT` defaults to 0 in production.
- Bot counts and bet sizes can distort economics if misconfigured.

---

## Walkthrough with code excerpts

### 1) Config from env
```rust
#[derive(Clone, Debug)]
struct LiveTableConfig {
    betting_ms: u64,
    lock_ms: u64,
    payout_ms: u64,
    cooldown_ms: u64,
    tick_ms: u64,
    bot_count: usize,
    bot_balance: i128,
    bot_bet_min: u64,
    bot_bet_max: u64,
    bot_bets_per_round_min: u8,
    bot_bets_per_round_max: u8,
    bot_max_active_bets: usize,
    bot_seed: u64,
}

impl LiveTableConfig {
    fn from_env() -> Self {
        Self {
            betting_ms: read_ms("LIVE_TABLE_BETTING_MS", 18_000),
            lock_ms: read_ms("LIVE_TABLE_LOCK_MS", 2_000),
            payout_ms: read_ms("LIVE_TABLE_PAYOUT_MS", 2_000),
            cooldown_ms: read_ms("LIVE_TABLE_COOLDOWN_MS", 8_000),
            tick_ms: read_ms("LIVE_TABLE_TICK_MS", 1_000),
            bot_count: read_usize("LIVE_TABLE_BOT_COUNT", 0),
            bot_balance: read_u64("LIVE_TABLE_BOT_BALANCE", 1_000_000) as i128,
            bot_bet_min: read_u64("LIVE_TABLE_BOT_BET_MIN", 10),
            bot_bet_max: read_u64("LIVE_TABLE_BOT_BET_MAX", 200),
            bot_bets_per_round_min: read_u8("LIVE_TABLE_BOT_BETS_MIN", 1),
            bot_bets_per_round_max: read_u8("LIVE_TABLE_BOT_BETS_MAX", 3),
            bot_max_active_bets: read_usize("LIVE_TABLE_BOT_MAX_ACTIVE_BETS", 12),
            bot_seed: read_u64("LIVE_TABLE_BOT_SEED", 42),
        }
    }
}
```

Why this matters:
- The timing and bot parameters control the entire live-table experience.

What this code does:
- Defines the configuration struct and reads values from environment variables.
- Uses safe defaults when env vars are missing.

---

### 2) Table state and roll application
```rust
#[derive(Clone, Debug)]
struct TableState {
    main_point: u8,
    d1: u8,
    d2: u8,
    made_points_mask: u8,
    epoch_point_established: bool,
    field_paytable: u8,
}

impl TableState {
    fn apply_roll(&mut self, d1: u8, d2: u8) {
        let total = d1.saturating_add(d2);
        let mut point_made: Option<u8> = None;
        let mut seven_out = false;

        if self.main_point == 0 {
            if ![2, 3, 7, 11, 12].contains(&total) {
                self.main_point = total;
                self.epoch_point_established = true;
            }
        } else {
            if total == self.main_point {
                point_made = Some(self.main_point);
                self.main_point = 0;
            } else if total == 7 {
                seven_out = true;
                self.main_point = 0;
                self.epoch_point_established = false;
            }
        }

        if let Some(point) = point_made {
            if let Some(bit) = point_to_fire_bit(point) {
                self.made_points_mask |= 1u8 << bit;
            }
        }

        if seven_out {
            self.made_points_mask = 0;
        }

        self.d1 = d1;
        self.d2 = d2;
    }
}
```

Why this matters:
- This keeps the table-level craps state in sync with each roll.

Syntax notes:
- `saturating_add` avoids overflow.
- `1u8 << bit` sets a bit in the mask.

What this code does:
- Updates the main point and fire bet mask based on the dice roll.
- Resets point or bonuses on seven-out.
- Stores the latest dice values for UI display.

---

### 3) Handling bets atomically
```rust
fn handle_bet(&mut self, player_id: &str, bets: Vec<BetInput>) -> Result<LiveTableStateMessage, LiveTableError> {
    if self.phase != Phase::Betting {
        return Err(LiveTableError::BettingClosed);
    }
    let needs_reset = {
        let player = self.players.get(player_id).ok_or(LiveTableError::NotSubscribed)?;
        player.session.is_complete || bet_count_from_blob(&player.session.state_blob) == 0
    };

    if needs_reset {
        let table_snapshot = self.table.clone();
        let seed = self.seed.clone();
        if let Some(player) = self.players.get_mut(player_id) {
            reset_session_if_needed(&seed, &mut player.session);
            sync_session_to_table(&mut player.session, &table_snapshot);
        }
    }

    let player = self.players.get_mut(player_id).ok_or(LiveTableError::NotSubscribed)?;

    let mut normalized_bets = Vec::with_capacity(bets.len());
    let mut total_amount: u64 = 0;
    for bet in bets {
        let amount = normalize_amount(bet.amount)?;
        let (bet_type, target) = normalize_bet_type(&bet.bet_type, bet.target)?;
        total_amount = total_amount.saturating_add(amount);
        normalized_bets.push((bet_type, target, amount));
    }

    if player.balance < total_amount as i128 {
        return Err(LiveTableError::InsufficientBalance);
    }

    let mut test_session = player.session.clone();
    for (bet_type, target, amount) in &normalized_bets {
        let payload = build_place_bet_payload(*bet_type, *target, *amount);
        test_session.move_count = test_session.move_count.saturating_add(1);
        let mut rng = GameRng::new(&self.seed, test_session.id, test_session.move_count);
        let _ = process_game_move(&mut test_session, &payload, &mut rng)?;
    }

    for (bet_type, target, amount) in &normalized_bets {
        let payload = build_place_bet_payload(*bet_type, *target, *amount);
        player.session.move_count = player.session.move_count.saturating_add(1);
        let mut rng = GameRng::new(&self.seed, player.session.id, player.session.move_count);
        let result = process_game_move(&mut player.session, &payload, &mut rng)?;
        let delta = result_delta(&result);
        player.balance = player.balance.saturating_add(delta as i128);
    }

    for (bet_type, target, amount) in normalized_bets {
        let key = bet_key_from_type(bet_type, target);
        *self.totals.entry(key).or_insert(0) += amount;
    }

    Ok(self.build_state_message(Some(player_id)))
}
```

Why this matters:
- This ensures bets are validated, applied atomically, and only accepted when funds are sufficient.

Syntax notes:
- The function clones the session for a dry-run to ensure all bets are valid before committing.

What this code does:
- Rejects bets outside the betting phase.
- Normalizes bets and checks the player’s balance.
- Simulates bets on a cloned session to validate them.
- Applies the bets to the real session and updates balances.
- Updates table totals and returns a state update.

---

### 4) Phase progression and rolls
```rust
fn tick(&mut self, now: Instant) -> Vec<OutboundEvent> {
    let mut events = Vec::new();
    if now >= self.phase_ends_at {
        self.advance_phase();
        if self.phase == Phase::Rolling {
            let roll_events = self.execute_roll();
            events.extend(roll_events);
        }
        if self.phase == Phase::Betting {
            self.seed_bot_bets();
        }
    }

    events.push(OutboundEvent::State {
        player_id: None,
        payload: self.build_state_message(None),
    });

    events
}
```

Why this matters:
- The tick loop keeps the game moving without needing external triggers.

What this code does:
- Advances the phase when the timer expires.
- Rolls dice during the rolling phase and emits results.
- Broadcasts a state update every tick.

---

### 5) WebSocket handling with broadcast
```rust
async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    let mut broadcast_rx = state.broadcaster.subscribe();

    let write_task = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            if sender.send(message).await.is_err() {
                break;
            }
        }
    });

    let broadcast_task = {
        let tx = tx.clone();
        tokio::spawn(async move {
            while let Ok(event) = broadcast_rx.recv().await {
                if let Ok(payload) = serde_json::to_string(&event) {
                    let _ = tx.send(Message::Text(payload));
                }
            }
        })
    };

    while let Some(Ok(message)) = receiver.next().await {
        match message {
            Message::Text(text) => {
                match serde_json::from_str::<InboundMessage>(&text) {
                    Ok(inbound) => {
                        handle_inbound(inbound, &state, &tx).await;
                    }
                    Err(err) => {
                        warn!(?err, "invalid inbound message");
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    write_task.abort();
    broadcast_task.abort();
}
```

Why this matters:
- This is how real-time state updates fan out to all connected clients.

Syntax notes:
- `socket.split()` gives a sender and receiver for async reading/writing.
- `broadcast::Sender` allows many subscribers to receive the same events.

What this code does:
- Spawns a task to write outbound messages.
- Spawns a task to forward broadcast events to this client.
- Reads inbound messages and routes them to `handle_inbound`.

---

### 6) Service startup
```rust
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let host = std::env::var("LIVE_TABLE_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port: u16 = std::env::var("LIVE_TABLE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(9123);

    let config = LiveTableConfig::from_env();
    let engine = Arc::new(Mutex::new(LiveTableEngine::new(config.clone())));
    let (broadcaster, _) = broadcast::channel::<OutboundEvent>(1024);

    let state = AppState { engine: engine.clone(), broadcaster: broadcaster.clone() };

    let tick_engine = engine.clone();
    let tick_broadcaster = broadcaster.clone();
    tokio::spawn(async move {
        let mut interval = time::interval(Duration::from_millis(config.tick_ms));
        loop {
            interval.tick().await;
            let events = {
                let mut engine = tick_engine.lock().unwrap();
                engine.tick(Instant::now())
            };
            for event in events {
                let _ = tick_broadcaster.send(event);
            }
        }
    });

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/healthz", get(healthz))
        .with_state(state);

    let addr: SocketAddr = format!("{host}:{port}").parse().context("invalid listen addr")?;
    info!(%addr, "live table service listening");

    axum::serve(tokio::net::TcpListener::bind(addr).await?, app).await?;
    Ok(())
}
```

Why this matters:
- This is the entrypoint that launches the live-table server.

What this code does:
- Initializes logging and reads host/port.
- Starts the tick loop that drives phase changes.
- Builds an Axum router with `/ws` and `/healthz` endpoints.
- Starts serving on the configured address.

---

## Key takeaways
- The live-table service runs a full off-chain state machine.
- Bets are validated and applied with the same game logic as on chain.
- WebSockets and a broadcast channel deliver state and results to clients.

## Next lesson
L44 - OnchainCrapsTable (global table orchestration): `feynman/lessons/L44-onchain-craps-table.md`
