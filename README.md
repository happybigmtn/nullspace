# Nullspace

A fully on-chain casino platform with global table architecture, supporting tens of thousands of concurrent players per game. Built with a validator network for consensus, execution layer for game logic, and real-time WebSocket fanout for low-latency updates.

## Table of Contents

- [Overview](#overview)
- [Quickstart](#quickstart)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Backend Services](#backend-services)
- [Data Persistence](#data-persistence)
- [Observability](#observability)
- [Resource Sizing](#resource-sizing)
- [Limits Reference](#limits-reference)
- [Security](#security)
- [Additional Documentation](#additional-documentation)

## Overview

### Goals

- Single global table per game variant with shared presence and synchronized outcomes
- Tens of thousands of concurrent players watching and betting in the same table
- Timed outcomes (rolls/deals) that feel exciting but not rushed
- Predictable, low-latency updates with strong fairness guarantees
- Resilient to node failures and safe to recover without corrupting state

### Non-goals

- Multiple concurrent tables per game (no sharding by table)
- Peer-to-peer authority (server remains authoritative)

### Core Concept

Each game variant runs one authoritative "table engine" that owns the state and clock. Players connect to stateless edge gateways over WebSockets. Gateways relay bet intents to the table engine and fan out broadcast updates to clients via a pub/sub fabric. The table engine advances in fixed "rounds" (betting window -> lock -> resolve -> payout -> cooldown). All clients see the same countdown and the same outcome at the same time.

## Quickstart

### Prerequisites

- Docker
- Node.js
- Rust
- wasm-pack

### Local Development Setup

```bash
cd /home/r/Coding/nullspace
set -euo pipefail

# Ensure website/.env.local exists (seeded from configs/local/.env.local if needed)
if [ ! -f website/.env.local ]; then
  if [ -f configs/local/.env.local ]; then
    cp configs/local/.env.local website/.env.local
  else
    echo "Missing website/.env.local and configs/local/.env.local. Run generate-keys or create website/.env.local first."
    exit 1
  fi
fi

# Build simulator + validator if missing
if [ ! -f target/release/nullspace-simulator ] || [ ! -f target/release/nullspace-node ]; then
  echo "Building nullspace-simulator and nullspace-node..."
  cargo build --release -p nullspace-simulator -p nullspace-node
fi

# Ensure Convex env file exists before starting
if [ ! -f docker/convex/.env ]; then
  echo "Missing docker/convex/.env. Create it before starting Convex."
  exit 1
fi

# Start Convex (self-hosted)
docker compose --env-file docker/convex/.env -f docker/convex/docker-compose.yml up -d --wait

# Start local validator network (simulator + validators)
WEB_PORT=5173
ALLOWED_ORIGINS="http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT},http://localhost:3000,http://127.0.0.1:3000"
ALLOW_HTTP_NO_ORIGIN=1 ALLOW_WS_NO_ORIGIN=1 ALLOWED_HTTP_ORIGINS="${ALLOWED_ORIGINS}" ALLOWED_WS_ORIGINS="${ALLOWED_ORIGINS}" \
  nohup ./scripts/start-local-network.sh configs/local 4 --no-build > network.log 2>&1 &
echo $! > network.pid

# Start services
( cd services/auth && nohup npm run dev > ../../auth.log 2>&1 & echo $! > ../../auth.pid )
( cd services/ops && nohup npm run dev > ../../ops.log 2>&1 & echo $! > ../../ops.pid )
( cd website && nohup npm run dev -- --host 127.0.0.1 --port "${WEB_PORT}" > ../website.log 2>&1 & echo $! > ../website.pid )

echo "UI: http://127.0.0.1:${WEB_PORT}"
```

### Stop Services

```bash
for pidfile in network.pid auth.pid ops.pid website.pid; do
  if [ -f "$pidfile" ]; then kill "$(cat "$pidfile")" 2>/dev/null || true; fi
done
```

## Architecture

### High-Level Architecture

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

#### Edge Gateways
- Maintain long-lived WebSocket connections
- Authenticate, rate-limit, validate payload shapes
- Provide latency hints and client clock sync
- Subscribe to table updates and fan out to clients

#### Global Table Engine (one per game variant)
- Single authoritative state machine with a fixed round schedule
- Accepts bet intents up to lock time, validates against rules and balances
- Produces outcomes and payouts deterministically
- Emits minimal deltas for fan-out and an append-only event log

#### Pub/Sub Fan-out
- Table engine publishes round updates once per tick
- Gateways subscribe and deliver updates to tens of thousands of clients

#### Event Log + Snapshots
- Append-only log is the source of truth for recovery/audit
- Snapshot the table state every N rounds for fast restart

### Round Timing Model

Each game runs a repeating schedule tuned for excitement and clarity:

| Phase | Description |
|-------|-------------|
| Betting window (T_bet) | Players place bets; UI shows live bet totals |
| Lock (T_lock) | Buffer period to close bets and commit RNG seed hash |
| Resolve (T_resolve) | Roll/deal and compute outcomes |
| Payout (T_payout) | Emit results and credits |
| Cooldown (T_cooldown) | Short gap before next round |

**Example Timings (defaults):**
- Craps: 18s bet, 2s lock, 1s resolve, 2s payout, 7s cooldown (30s total)
- Roulette: 15s bet, 2s lock, 2s resolve, 3s payout, 5s cooldown (27s total)
- Blackjack: 12s bet, 2s lock, 3s resolve, 3s payout (20s total)

### On-Chain Data Model

1. **GlobalTableConfig (PDA/account)** - Game type, max bets, timing config, authority keys
2. **GlobalTableRound (PDA/account)** - Round ID, phase, timing, RNG commit/reveal, outcome
3. **GlobalTableTotals (PDA/account)** - Aggregate totals per bet type for UI heatmaps
4. **PlayerRoundBets (per player, per round)** - Player's bets for settlement

### RNG/Fairness

Recommended: derive outcome from consensus RNG (seed) for the block after lock:
`roll = H(seed || round_id || game_id)` with the hash committed at lock time. This keeps outcomes deterministic and auditable on-chain.

## Project Structure

```
nullspace/
+-- client/              # Operational tooling (bridge relayer, stress tests, diagnostics)
+-- configs/             # Environment configs (local, staging, production)
+-- docker/              # Docker compose files (Convex, observability)
+-- docs/                # Additional documentation
+-- evm/                  # EVM contracts (BridgeLockbox, RNG token)
+-- execution/           # Rust execution layer (casino game logic)
+-- gateway/             # TypeScript WebSocket gateway
+-- mobile/              # React Native mobile app
+-- node/                # Rust consensus validators
+-- packages/            # Shared packages (protocol definitions)
+-- scripts/             # Operational scripts
+-- services/            # Backend services
    +-- auth/            # Session auth + AI proxy
    +-- ops/             # Analytics + league + CRM
+-- simulator/           # Rust HTTP API + indexer
+-- types/               # Shared Rust types
+-- website/             # Web frontend
```

### Key Components

| Component | Description |
|-----------|-------------|
| `nullspace-simulator` | HTTP API, WebSocket updates, explorer indexing/persistence, Prometheus metrics |
| `nullspace-node` | Consensus validators with metrics on port 9100+ |
| `services/auth` | Session auth + AI proxy endpoint (`POST /ai/strategy`) |
| `gateway` | WebSocket session manager for app clients (registration, deposits, updates stream) |
| `client` bins | Operational tooling (bridge relayer, tournament scheduler, stress-test bots, diagnostics) |

## Backend Services

### Error Handling
- Casino engine and execution handlers return Result-based errors (no `panic!`/`unwrap` in production paths)
- Player-facing failures emit `CasinoError` events
- Server logs include structured fields (player, session_id, error_code)
- Lock poisoning is handled gracefully in simulator/state tracking

### Configuration
- Deployment limits documented in `docs/limits.md`
- Node tunables configured via `configs/*/nodeN.yaml`
- Simulator rate limits via config/CLI and env overrides:
  - `RATE_LIMIT_HTTP_PER_SEC`, `RATE_LIMIT_HTTP_BURST`
  - `RATE_LIMIT_SUBMIT_PER_MIN`, `RATE_LIMIT_SUBMIT_BURST`
  - `ALLOW_HTTP_NO_ORIGIN=1` and `ALLOW_WS_NO_ORIGIN=1` for CLI health checks

### Gateway Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_CONNECTIONS_PER_IP` | 5 | Max WebSocket connections per IP |
| `MAX_TOTAL_SESSIONS` | 1000 | Max total sessions |
| `GATEWAY_DATA_DIR` | `./.gateway-data` | Nonce persistence directory |
| `GATEWAY_EVENT_TIMEOUT_MS` | 30000 | Event timeout |
| `GATEWAY_SUBMIT_TIMEOUT_MS` | 10000 | Submit timeout |

### Global Table Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_LIVE_TABLE_BETTING_MS` | 20000 | Betting window duration |
| `GATEWAY_LIVE_TABLE_LOCK_MS` | 2000 | Lock phase duration |
| `GATEWAY_LIVE_TABLE_PAYOUT_MS` | 4000 | Payout phase duration |
| `GATEWAY_LIVE_TABLE_COOLDOWN_MS` | 4000 | Cooldown between rounds |
| `GATEWAY_LIVE_TABLE_MIN_BET` | 5 | Minimum bet amount |
| `GATEWAY_LIVE_TABLE_MAX_BET` | 1000 | Maximum bet amount |
| `GATEWAY_LIVE_TABLE_MAX_BETS_PER_ROUND` | 12 | Max bets per player per round |

### Operational Tooling

- **Tournament scheduler**: `client/src/bin/tournament_scheduler.rs` (wrap via `scripts/run-tournament-scheduler.sh`)
- **Bot load runner**: `client/src/bin/stress_test.rs` (wrap via `scripts/run-bots.sh`)
- **Session diagnostics**: `client/src/bin/session_dump.rs` for quick state and history inspection
- **Multi-node soak test**: `scripts/soak-test.sh` (requires simulator + nodes)

## Data Persistence

### Data Stores and Ownership

| Service | Writes | Reads | Notes |
|---------|--------|-------|-------|
| Validators | Chain state, blocks | Chain state | Consensus source of truth |
| Simulator/indexer | Explorer persistence (Postgres/SQLite) | Chain state + explorer | Read-heavy HTTP/WS API |
| Auth service | Convex (users, entitlements, Stripe) | Convex | Uses service token + admin key |
| Website | None | Simulator + Auth + Convex | Read-only |

### Explorer Persistence Options

- **In-memory** (default): No persistence, fastest, not suitable for multi-node
- **SQLite**: `--explorer-persistence-path ./explorer.db` for single-node or dev
- **Postgres**: `--explorer-persistence-url postgres://...` for multi-node

**Backpressure policy:**
- `explorer_persistence_backpressure=block` (default): Stalls indexing when DB is slow
- `explorer_persistence_backpressure=drop`: Avoids stalls but drops explorer data

**Retention controls:**
- `--explorer-max-blocks` (0 disables limit)
- `--explorer-max-account-entries`
- `--explorer-max-accounts`
- `--explorer-max-game-event-accounts`

### Backup Targets

- **RPO**: 15 minutes
- **RTO**: 4 hours
- Quarterly restore drills, annual full failover rehearsal

## Observability

### Metrics Endpoints

| Service | Endpoint | Port |
|---------|----------|------|
| Simulator | `/metrics/prometheus` | 8080 |
| Simulator | `/metrics/http`, `/metrics/ws`, `/metrics/system` | 8080 |
| Auth service | `/metrics/prometheus`, `/metrics` | 4000 |
| Node | `/metrics` | 9100+ |

**Note**: Production deployments require `METRICS_AUTH_TOKEN` for metrics endpoints.

### Prometheus + Grafana (Local)

```bash
cd docker/observability
docker compose up -d
```

- Grafana: `http://localhost:3001` (admin/admin)
- Alertmanager: `http://localhost:9093`
- Preloaded dashboard: "Nullspace / Nullspace SLO Overview"

### Baseline SLOs

| Metric | Target |
|--------|--------|
| Availability (simulator + auth) | 99.5% monthly |
| Simulator submit latency (p95) | <= 250ms at 5k concurrent |
| Simulator submit latency (p99) | <= 500ms at 5k concurrent |
| Auth request latency (p95) | <= 200ms |
| WS send errors | 0 sustained rate |
| Explorer persistence drops | 0 sustained rate |
| Casino errors | 0 sustained rate |

### Alert Thresholds

- `nullspace_simulator_update_index_failures_total` increases over 5m
- `nullspace_simulator_ws_updates_send_errors_total` rate > 0 for 5m
- `nullspace_simulator_explorer_persistence_queue_depth` > 50% buffer for 10m
- Auth 5xx rate > 1% for 5m
- `nullspace_simulator_casino_errors_total` rate > 0 for 5m

### Tracing (OTLP)

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://<OTEL_COLLECTOR>:4318
OTEL_SERVICE_NAME=nullspace-<service>
OTEL_TRACES_SAMPLER=traceidratio
OTEL_TRACES_SAMPLER_ARG=0.05  # 5% sampling
```

## Resource Sizing

### 5k Concurrent Players (Baseline)

| Component | Sizing |
|-----------|--------|
| Simulator/indexer | 1x 8-16 vCPU, 16-32 GB RAM |
| Validators | 3x 4 vCPU, 8 GB RAM |
| Auth service | 1-2x 2 vCPU, 4 GB RAM |
| Convex backend | 1x 8 vCPU, 16 GB RAM + SSD |
| Postgres | 1x 8 vCPU, 16 GB RAM |

### 20k Concurrent Players

| Component | Sizing |
|-----------|--------|
| Simulator/indexer | 4x 16 vCPU, 32 GB RAM |
| WS gateways | 2-4x 4-8 vCPU, 8-16 GB RAM |
| Validators | 3x 4-8 vCPU, 8-16 GB RAM |
| Auth service | 2-3x 2-4 vCPU, 4-8 GB RAM |
| Convex backend | 1x 16 vCPU, 32 GB RAM |
| Postgres | 1x 16 vCPU, 32-64 GB RAM + SSD |

### 50k Concurrent Players

| Component | Sizing |
|-----------|--------|
| Simulator/indexer | 8-12x 32 vCPU, 64 GB RAM |
| WS gateways | 4-8x 8 vCPU, 16 GB RAM |
| Validators | 4-5x 8 vCPU, 16 GB RAM |
| Auth service | 4-6x 4 vCPU, 8 GB RAM |
| Convex backend | 1x 32 vCPU, 64 GB RAM |
| Postgres | 2x 32 vCPU, 128 GB RAM (primary + replicas) |

**Notes:**
- CPU-heavy paths: proof generation, update indexing, WS fanout
- Memory-heavy paths: explorer state retention, WS queues, caches
- Target hardware assumes SSD/NVMe storage and low-latency network

## Limits Reference

### Node Limits (Consensus-Critical)

| Limit | Value |
|-------|-------|
| `message_backlog` | 128 |
| `mempool_max_transactions` | 100000 |
| `max_message_size` | 10 MB |
| `leader_timeout_ms` | 1000 |
| `notarization_timeout_ms` | 2000 |

### Simulator Limits

| Limit | Value |
|-------|-------|
| `http_rate_limit_per_second` | 1000 |
| `http_rate_limit_burst` | 5000 |
| `submit_rate_limit_per_minute` | 100 |
| `ws_max_connections` | 20000 |
| `ws_max_connections_per_ip` | 10 |
| `ws_max_message_bytes` | 4 MB |

### Casino Engine Limits (Consensus-Critical)

| Limit | Value |
|-------|-------|
| `baccarat_max_bets` | 11 |
| `craps_max_bets` | 20 |
| `roulette_max_bets` | 20 |
| `sic_bo_max_bets` | 20 |
| `casino_max_payload_length` | 256 |
| `super_mode_fee` | 20% of bet |

### Protocol Limits

| Limit | Value |
|-------|-------|
| `max_block_transactions` | 500 |
| `max_submission_transactions` | 128 |
| `max_state_proof_ops` | 3000 |
| `max_events_proof_ops` | 2000 |

### Testnet Recommended Overrides (5k concurrent)

**Simulator:**
```bash
RATE_LIMIT_HTTP_PER_SEC=5000
RATE_LIMIT_HTTP_BURST=10000
RATE_LIMIT_SUBMIT_PER_MIN=120000
RATE_LIMIT_SUBMIT_BURST=20000
RATE_LIMIT_WS_CONNECTIONS=30000
```

**Gateway:**
```bash
MAX_CONNECTIONS_PER_IP=200
MAX_TOTAL_SESSIONS=20000
GATEWAY_SESSION_RATE_LIMIT_POINTS=1000
```

## Security

### Reporting Security Issues

Report vulnerabilities privately:
- GitHub Security: https://github.com/commonwarexyz/nullspace/security/advisories
- Email: security@nullspace.xyz

### Operational Security Checklist

- Never log private keys, admin keys, or service tokens (redact on error paths)
- Prefer file/secret-backed keys in production (env keys only for non-prod)
- Rotate service tokens at least every 90 days, after personnel changes, and immediately after any suspected leak
- Keep a rotation log and overlap new/old tokens for <24 hours before revoking

## Additional Documentation

| Document | Description |
|----------|-------------|
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Operations procedures, deployment, incident response |
| [docs/STRATEGY.md](docs/STRATEGY.md) | Business strategy, token economics, roadmap |
| [docs/convex-guidelines.md](docs/convex-guidelines.md) | Convex development guidelines |
| [docs/SERVERS.md](docs/SERVERS.md) | Staging infrastructure inventory |
| [AGENTS.md](AGENTS.md) | Agent/automation instructions |

## License

Licensed under Apache 2.0 and MIT. See [LICENSE-APACHE](LICENSE-APACHE) and [LICENSE-MIT](LICENSE-MIT).
