# Global Table Architecture (Single Table Per Game)

## Goals

- Single global table per game variant with shared presence and synchronized outcomes.
- Tens of thousands of concurrent players watching and betting in the same table.
- Timed outcomes (rolls/deals) that feel exciting but not rushed.
- Predictable, low-latency updates with strong fairness guarantees.
- Resilient to node failures and safe to recover without corrupting state.

## Non-goals

- Multiple concurrent tables per game (no sharding by table).
- Peer-to-peer authority (server remains authoritative).

## Core idea

Each game variant runs one authoritative "table engine" that owns the state and clock. Players connect to stateless edge gateways over WebSockets. Gateways relay bet intents to the table engine and fan out broadcast updates to clients via a pub/sub fabric. The table engine advances in fixed "rounds" (betting window -> lock -> resolve -> payout -> cooldown). All clients see the same countdown and the same outcome at the same time.

## Live table mode (incremental rollout)

- Live tables are **opt-in per game** so the existing on-chain flows remain unchanged.
- Phase 1 (Craps) uses a dedicated live-table service (`services/live-table`) that reuses the on-chain execution logic for full bet coverage; clients join using `craps_live_join` and receive `live_table_state`/`live_table_result`.
- Gateway config (env):
  - `GATEWAY_LIVE_TABLE_CRAPS` (enable)
  - `GATEWAY_LIVE_TABLE_CRAPS_URL` (WebSocket URL for live-table service, default `ws://127.0.0.1:9123/ws`)
  - `GATEWAY_LIVE_TABLE_TIMEOUT_MS`, `GATEWAY_LIVE_TABLE_RECONNECT_MS`
- Live-table service config (env):
  - `LIVE_TABLE_HOST`, `LIVE_TABLE_PORT`
  - `LIVE_TABLE_BETTING_MS`, `LIVE_TABLE_LOCK_MS`, `LIVE_TABLE_PAYOUT_MS`, `LIVE_TABLE_COOLDOWN_MS`, `LIVE_TABLE_TICK_MS`
  - `LIVE_TABLE_BOT_COUNT`, `LIVE_TABLE_BOT_BALANCE`, `LIVE_TABLE_BOT_BET_MIN`, `LIVE_TABLE_BOT_BET_MAX`, `LIVE_TABLE_BOT_BETS_MIN`, `LIVE_TABLE_BOT_BETS_MAX`, `LIVE_TABLE_BOT_MAX_ACTIVE_BETS`
- Client config (env):
  - `EXPO_PUBLIC_LIVE_TABLE_CRAPS` (mobile opt-in)

## On-chain global table mode (Phase 2: real confirmations)

Goal: move the **single global table** onto the chain so bet acceptance and round results are
confirmed by on-chain events (and can be surfaced in the UI as pending → confirmed/failed).

This mode **replaces the off-chain live-table service** for games that require true on-chain
confirmation semantics. Gateways still provide low-latency fan-out and UX helpers, but
the canonical bet acceptance and outcomes come from the updates stream.

### On-chain data model (per game)

1. **GlobalTableConfig (PDA / account)**
   - Game type, max bets per round, min/max bet, allowed targets, timing config.
   - Authority/keeper key(s) for round transitions.

2. **GlobalTableRound (PDA / account)**
   - `round_id`, `phase`, `betting_ends_at`, `lock_ends_at`, `resolve_at`.
   - `rng_commit` (hash) + `rng_reveal` (optional).
   - Outcome (e.g., dice, total, point).

3. **GlobalTableTotals (PDA / account)**
   - Aggregate totals per bet type/target for UI heatmaps.
   - Fixed-size array for hot-path reads; updated by bet acceptance.

4. **PlayerRoundBets (per player, per round)**
   - Stores the player’s bets for this round.
   - Used for settlement and to drive player-specific UI (my bets, net win).

### On-chain instructions (high level)

- `global_table_init(game)` → create config/state accounts.
- `global_table_open_round(round_id, timing, rng_commit)` → opens betting.
- `global_table_submit_bets(round_id, bets[])` → validates + records player bets, updates totals.
- `global_table_lock(round_id)` → closes betting window.
- `global_table_reveal(round_id, rng_reveal)` → reveals seed and computes outcome.
- `global_table_settle(round_id, player)` → settles one player’s bets (batchable).
- `global_table_finalize(round_id)` → clears transient state, advances round.

**Settlement model:** to scale to tens of thousands of players, settlement is done in **batches**.
Validators (or dedicated keepers) repeatedly call `global_table_settle` for slices of players.
This keeps per-transaction compute bounded while still providing fully on-chain outcomes.

### RNG / fairness

Recommended: derive outcome from **consensus RNG** (seed) for the block after lock:
`roll = H(seed || round_id || game_id)` with the hash committed at lock time. This avoids
centralized reveal keys and keeps outcomes deterministic and auditable on-chain.

### On-chain confirmation events (UI)

Emit dedicated events for UI consumption:
- `GlobalTableBetAccepted` / `GlobalTableBetRejected`
- `GlobalTableLocked` / `GlobalTableOutcome` / `GlobalTableSettled`

Gateways already consume the updates stream; they should forward:
- **pending** immediately on client submit,
- **confirmed** when `GlobalTableBetAccepted` arrives,
- **failed** when a rejection or error event arrives.

This aligns with `docs/ux.md` guidance: surface a lightweight activity ledger with
pending/confirmed/failed states close to the bet slip.

### Scalability impact (vs. off-chain live table)

**Costs / risks**
- On-chain confirmations add write load proportional to bets.
- Large `PlayerRoundBets` sets and settlement transactions can become the hot path.

**Mitigations**
- **Batch bets**: players submit multiple bets in one transaction.
- **Batch settlement**: settle N players per tx to keep compute bounded.
- **Aggregate totals** on-chain for heatmaps instead of per-bet broadcasts.
- **Rate limits**: cap bets per player per round; enforce max active bets.
- **Optional fast path**: keep WebSocket fan-out for UI while the chain confirms in the background.

Net effect: on-chain global tables improve trust and UI clarity (real confirmations) but
**reduce maximum throughput** compared to off-chain tables. The batching model above is
required to keep tens-of-thousands concurrency viable.

## High-level architecture

```
Clients (web/mobile)
   |  WebSocket (subscribe, bet, presence)
   v
Edge Gateways (stateless, horizontally scaled)
   |  bet intents (gRPC/HTTP)
   |  broadcast updates (pub/sub)
   v
Global Table Engine (authoritative per game)
   |  event log (append-only)
   |  snapshots (periodic)
   v
Persistence + Analytics
```

### Components

1. **Edge Gateways**
   - Maintain long-lived WebSocket connections.
   - Authenticate, rate-limit, validate payload shapes.
   - Provide latency hints and client clock sync.
   - Subscribe to table updates and fan out to clients.

2. **Global Table Engine (one per game variant)**
   - Single authoritative state machine with a fixed round schedule.
   - Accepts bet intents up to lock time, validates against rules and balances.
   - Produces outcomes and payouts deterministically.
   - Emits minimal deltas for fan-out and an append-only event log.

3. **Pub/Sub Fan-out**
   - Table engine publishes round updates once per tick.
   - Gateways subscribe and deliver updates to tens of thousands of clients.

4. **Event Log + Snapshots**
   - Append-only log is the source of truth for recovery/audit.
   - Snapshot the table state every N rounds for fast restart.

5. **Bot Manager**
   - Generates 100 bot bettors per game, always connected (see bots section).
   - Produces bets through the same validation path as players.

## Round timing model

Each game runs a repeating schedule tuned for excitement and clarity. The schedule is per game and can be dynamically tuned based on latency and activity.

### Round phases

- **Betting window (T_bet)**: players place bets; UI shows live bet totals.
- **Lock (T_lock)**: buffer period to close bets and commit RNG seed hash.
- **Resolve (T_resolve)**: roll/deal and compute outcomes.
- **Payout (T_payout)**: emit results and credits.
- **Cooldown (T_cooldown)**: short gap before next round.

### Example targets (initial defaults)

- Dice/Craps: T_bet 18s, T_lock 2s, T_resolve 1s, T_payout 2s, T_cooldown 7s (30s total).
- Roulette: T_bet 15s, T_lock 2s, T_resolve 2s, T_payout 3s, T_cooldown 5s (27s total).
- Blackjack (global hand): T_bet 12s, T_lock 2s, T_resolve 3s, T_payout 3s (20s total).

These are intentionally not aggressive; they can tighten later if telemetry shows players are not rushed.

### Timing safeguards

- **Soft lock** at T_lock minus p95 network latency buffer to prevent late bets.
- **Countdown broadcast** every second (or 2s) to reduce chatter, with a final 3-2-1 tick near lock for excitement.
- **Tick overrun protection**: if resolve+payout exceeds the tick window, shorten cooldown (never betting window) to keep cadence predictable.

## State management

- Table engine keeps the authoritative state in memory and persists every action to the event log.
- The event log records: round start, bet accepted, bets locked, RNG commit, outcome reveal, payouts.
- Snapshots capture the current round state, outstanding bets, and RNG commitments.

## RNG fairness (recommended)

- Commit-reveal: hash RNG seed at lock time, reveal seed at resolve.
- Record commitment and reveal in the event log for auditability.

## Data flow

1. Client subscribes to table updates via gateway.
2. Client submits bet intent with round id and client timestamp.
3. Gateway validates payload and rate-limits, forwards to table engine.
4. Table engine validates balance, rules, and lock time; accepts or rejects.
5. Accepted bet is appended to event log and reflected in the next update.
6. At lock: engine commits RNG hash and closes the betting window.
7. At resolve: engine reveals RNG, computes outcome, emits result.
8. Payouts are applied and emitted; round advances.

## Scaling strategy

### Where we scale

- **Gateways**: horizontally scale to handle WebSockets and fan-out.
- **Pub/Sub**: partitions by game variant and message type.
- **Persistence**: event log scales with append throughput and compaction.

### Where we do not scale

- **Table engine**: single authoritative instance per game variant.
  - This is a deliberate constraint to keep a single global table.
  - The engine is CPU-light if round logic is simple and batched.

### Keeping the hot shard healthy

- **Batching**: accept bets in a ring buffer, process once per tick.
- **Delta updates**: broadcast only changes (totals per bet type) instead of per-bet events.
- **Compression**: use binary protocol and zstd for updates.
- **Backpressure**: if gateways are slow, drop optional deltas but keep outcome events.

## Bots (100 always-on)

- Bots are implemented as server-side actors colocated with the table engine.
- Bots place bets through the same validation path but without extra WebSocket connections.
- Bot activity is rate-limited and capped per round to avoid masking real player flow.

## Reliability and recovery

- On engine restart, replay the event log to rebuild state and resume at next round boundary.
- If replay exceeds a timeout, load the latest snapshot then replay remaining events.
- If the engine is unavailable, gateways show a "table paused" state and stop accepting bets.

## Observability

- Core metrics: round duration, tick overruns, bet acceptance rate, p95 end-to-end latency.
- Fan-out health: gateway queue depth, dropped updates, connection churn.
- RNG integrity: commitment and reveal counts must match.

## Security and abuse

- Enforce max bet rate per player per round.
- Reject bet replays (idempotency key per bet).
- Gateways validate signatures to prevent spoofed clients.

## Capacity sketch (order-of-magnitude)

- If 50k concurrent players are connected to a table and you broadcast 1 update per second, that is 50k fan-outs/sec.
- Keep updates small (e.g., 300-800 bytes) to keep egress manageable.
- The table engine should process bets in batches and only emit totals per bet type.

## Open design choices

- Primary region for authoritative engine vs. multi-region consensus.
- Pub/sub tech selection (Kafka, NATS, Redis, or internal bus).
- Gateway implementation and protocol (custom WS vs. managed services).

## Rollout plan

1. Implement single-table engine for one game with synthetic bot load.
2. Add event log + snapshots + recovery tests.
3. Add gateway fan-out and backpressure with tens of thousands of simulated clients.
4. Tune round timings based on engagement and latency.
