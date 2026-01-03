# E16 - Limits inventory + tuning checklist (from scratch)

Focus files: `docs/limits.md`, `execution/src/casino/limits.rs`

Goal: explain how limits are categorized, which ones are consensus-critical, and how to tune them safely before testnet. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) What a "limit" is
A limit is a hard cap or default that protects the system from overload or abuse (too many requests, too much memory, too many pending transactions).

### 2) Consensus-critical vs configurable
Consensus-critical limits define the rules of the network and must match across all nodes. Configurable limits are local knobs that can differ per deployment.

### 3) Rate limits vs capacity limits
Rate limits control how fast requests arrive (per second/minute). Capacity limits control how much state can be stored (queue sizes, cache sizes).

### 4) Tradeoffs
Raising a limit increases throughput but also increases risk (memory pressure, DoS blast radius, slower recovery).

### 5) Change management
Consensus-critical limits require coordinated upgrades; configurable limits require load tests and monitoring.

---

## Limits & management callouts (important)

1) **Default submit limits are dev-only**
- `submit_rate_limit_per_minute: 100` is far too low for public traffic.
- The doc already proposes high testnet overrides; treat those as a starting point, not final.

2) **Per-IP caps can block NATed users**
- Defaults like `ws_max_connections_per_ip: 10` can block many users behind a single NAT.
- The testnet override suggests `500`, which is more realistic but needs DDoS protection elsewhere.

3) **Large message sizes increase DoS risk**
- `max_message_size: 10 MB` and `ws_max_message_bytes: 4 MB` allow large payloads.
- Keep upstream proxy/body limits aligned or attackers can force buffering.

4) **Consensus-critical limits require coordinated upgrade**
- Casino and protocol caps are part of the consensus rules.
- Changing them without a versioned upgrade can fork the network.

5) **High mempool limits require memory budget**
- `mempool_max_transactions: 100000` can be large in RAM.
- Confirm memory usage under realistic transaction sizes.

---

## Walkthrough with code excerpts

### 1) Node defaults (queues, mempool, storage)
```rust
- message_backlog: 128
- mailbox_size: 1024
- mempool_max_backlog: 64
- mempool_max_transactions: 100000
- max_message_size: 10 MB
- buffer_pool_page_size: 4096
- buffer_pool_capacity: 32768
- freezer_journal_target_size: 1 GiB
```

Why this matters:
- These values define how much the node can buffer before it applies backpressure or drops work.

What this code does:
- Lists default node-level caps for queues, mempool size, and on-disk buffers.
- Establishes the baseline memory and disk footprint for a node deployment.

---

### 2) Simulator defaults (HTTP + WS + explorer)
```rust
- http_rate_limit_per_second: 1000
- submit_rate_limit_per_minute: 100
- http_body_limit_bytes: 8 MB
- ws_max_connections: 20000
- ws_max_connections_per_ip: 10
- ws_max_message_bytes: 4 MB
- explorer_max_blocks: 10000
- state_max_progress_entries: 10000
```

Why this matters:
- The simulator is the public edge for submissions and updates, so its limits gate overall traffic.

What this code does:
- Defines default HTTP and WebSocket rate limits, plus explorer pagination caps.
- Prevents runaway requests and unbounded memory growth.

---

### 3) Gateway connection + rate limits
```rust
- max_connections_per_ip: 5 (MAX_CONNECTIONS_PER_IP)
- max_total_sessions: 1000 (MAX_TOTAL_SESSIONS)
- session_rate_limit_points: 10
- session_rate_limit_window_ms: 3600000
- session_rate_limit_block_ms: 3600000
```

Why this matters:
- The gateway is the first choke point for sessions and will deny new sessions when limits are hit.

What this code does:
- Caps per-IP sessions and overall sessions.
- Rate-limits session creation so one client cannot exhaust the pool.

---

### 4) Testnet recommended overrides
```rust
Simulator:
- RATE_LIMIT_HTTP_PER_SEC=5000
- RATE_LIMIT_SUBMIT_PER_MIN=120000
- RATE_LIMIT_WS_CONNECTIONS=30000
- RATE_LIMIT_WS_CONNECTIONS_PER_IP=500

Gateway:
- MAX_CONNECTIONS_PER_IP=200
- MAX_TOTAL_SESSIONS=20000
- GATEWAY_SESSION_RATE_LIMIT_POINTS=1000
```

Why this matters:
- These values dramatically increase throughput but also expand the blast radius of abuse.

What this code does:
- Provides a concrete baseline for a 5k concurrent target.
- Documents environment variables needed to tune production traffic limits.

---

### 5) Consensus-critical casino limits
```rust
pub const BACCARAT_MAX_BETS: usize = 11;
pub const CRAPS_MAX_BETS: usize = 20;
pub const ROULETTE_MAX_BETS: usize = 20;
pub const SIC_BO_MAX_BETS: usize = 20;
```

Why this matters:
- These caps are part of the rules for how state transitions are validated.

What this code does:
- Hard-codes maximum bet counts for each game.
- Ensures all nodes enforce identical limits.

---

### 6) Protocol/API caps (consensus-critical)
```rust
- max_block_transactions: 500
- max_submission_transactions: 128
- max_state_proof_ops: 3000
- max_events_proof_ops: 2000
- max_lookup_proof_nodes: 500
```

Why this matters:
- These caps define the maximum size of blocks and proofs that nodes will accept.

What this code does:
- Lists protocol-level hard caps that must match across the network.
- Prevents oversized blocks or proofs from overwhelming validators.

---

## Key takeaways
- Defaults are intentionally conservative; testnet needs explicit overrides.
- Consensus-critical limits must be changed only through a coordinated upgrade.
- Rate limits protect entry points; capacity limits protect memory and disk.

## Next lesson
Return to the main flow at L01 or continue Ops lessons as needed.
