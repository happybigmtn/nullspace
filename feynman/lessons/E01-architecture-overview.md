# E01 - Architecture overview (from scratch)

Focus file: `architecture.md`

Goal: explain the high-level architecture for global tables, live-table mode, and on-chain confirmation mode. For every excerpt, you will see **why it matters** and a **plain description of what the text means**.

---

## Concepts from scratch (expanded)

### 1) Single global table per game
Instead of spinning up many separate tables, each game has one shared table so all players see the same countdowns and outcomes.

### 2) Live-table vs on-chain table
- **Live-table (off-chain)**: fast feedback, easier to operate, but outcomes are not on-chain confirmed.
- **On-chain global table**: outcomes and bet acceptance are confirmed by the chain, but throughput is lower.

### 3) Stateless gateways
Gateways hold WebSocket connections but do not own game state. This makes them horizontally scalable.

---

## Limits & management callouts (important)

1) **Single table per game is a deliberate non-goal for sharding**
- The architecture explicitly avoids multiple tables per game.
- This simplifies UX but limits concurrency growth.

2) **Timing defaults are intentionally conservative**
- Default round timings are not aggressive to avoid rushing players.
- Expect to tune after telemetry.

---

## Walkthrough with key excerpts

### 1) Goals and non-goals
```rust
## Goals

- Single global table per game variant with shared presence and synchronized outcomes.
- Tens of thousands of concurrent players watching and betting in the same table.
- Timed outcomes (rolls/deals) that feel exciting but not rushed.
- Predictable, low-latency updates with strong fairness guarantees.
- Resilient to node failures and safe to recover without corrupting state.

## Non-goals

- Multiple concurrent tables per game (no sharding by table).
- Peer-to-peer authority (server remains authoritative).
```

Why this matters:
- These statements define the product and scaling constraints up front.

What this means:
- The system is optimized for one massive shared experience per game.
- It avoids per-table sharding or peer-to-peer authority models.

---

### 2) Core idea summary
```rust
Each game variant runs one authoritative "table engine" that owns the state and clock. Players connect to stateless edge gateways over WebSockets. Gateways relay bet intents to the table engine and fan out broadcast updates to clients via a pub/sub fabric.
```

Why this matters:
- This is the core data flow that everything else builds on.

What this means:
- There is a single authoritative engine per game.
- Gateways are fan-out nodes, not game logic owners.

---

### 3) Live-table mode (Phase 1)
```rust
Live tables are **opt-in per game** so the existing on-chain flows remain unchanged.
Phase 1 (Craps) uses a dedicated live-table service (`services/live-table`) that reuses the on-chain execution logic for full bet coverage; clients join using `craps_live_join` and receive `live_table_state`/`live_table_result`.
```

Why this matters:
- The rollout can be incremental without breaking existing games.

What this means:
- Craps is the first live-table game.
- The live-table service reuses on-chain logic to keep outcomes consistent.

---

### 4) On-chain global table data model
```rust
1. **GlobalTableConfig (PDA / account)**
   - Game type, max bets per round, min/max bet, allowed targets, timing config.
   - Authority/keeper key(s) for round transitions.

2. **GlobalTableRound (PDA / account)**
   - `round_id`, `phase`, `betting_ends_at`, `lock_ends_at`, `resolve_at`.
   - `rng_commit` (hash) + `rng_reveal` (optional).
   - Outcome (e.g., dice, total, point).
```

Why this matters:
- These are the core on-chain records that make global tables auditable.

What this means:
- The chain stores both config and each round’s state.
- Outcomes are tied to explicit RNG commitments and reveals.

---

### 5) Round timing defaults
```rust
- Dice/Craps: T_bet 18s, T_lock 2s, T_resolve 1s, T_payout 2s, T_cooldown 7s (30s total).
- Roulette: T_bet 15s, T_lock 2s, T_resolve 2s, T_payout 3s, T_cooldown 5s (27s total).
- Blackjack (global hand): T_bet 12s, T_lock 2s, T_resolve 3s, T_payout 3s (20s total).
```

Why this matters:
- Timing drives user experience, throughput, and fairness perception.

What this means:
- Craps is tuned for a 30-second cadence by default.
- These numbers are placeholders meant to evolve with telemetry.

---

## Key takeaways
- The architecture favors a single global table per game.
- Live-table is the fast path; on-chain tables add confirmations.
- Gateways are stateless fan-out nodes.

## Next lesson
E02 - Component roles + deployment topology: `feynman/lessons/E02-component-roles-topology.md`
