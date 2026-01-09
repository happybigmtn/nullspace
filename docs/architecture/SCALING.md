# Horizontal Scaling Strategy

This document describes the horizontal scaling strategy for the Nullspace game engine. It covers partitioning approaches, session affinity, and operational guidance for scaling beyond single-instance deployments.

## Table of Contents

1. [Current Architecture Constraints](#current-architecture-constraints)
2. [Scaling Dimensions](#scaling-dimensions)
3. [Gateway Scaling](#gateway-scaling)
4. [Simulator Scaling](#simulator-scaling)
5. [Validator Scaling](#validator-scaling)
6. [State Partitioning](#state-partitioning)
7. [Session Affinity](#session-affinity)
8. [Operational Runbook](#operational-runbook)
9. [Capacity Planning](#capacity-planning)

---

## Current Architecture Constraints

### Determinism Requirements

The execution layer is fully deterministic. Any scaling strategy must preserve:

1. **No wall-clock time** - Only consensus-derived timestamps
2. **No external randomness** - RNG from cryptographic seed chain
3. **Ordered iteration** - BTreeMap instead of HashMap
4. **Atomic commits** - All-or-nothing state transitions

### Current Limits

| Component | Limit | Bottleneck |
|-----------|-------|------------|
| Gateway sessions | 1,000 concurrent | In-memory session map |
| Gateway connections/IP | 5 | Rate limiter |
| Mempool per-account | 64 transactions | Fairness guarantee |
| Mempool total | 100,000 transactions | Memory |
| Simulator HTTP | 1,000 req/sec | Single-threaded handler |
| Validators | 3-5 nodes | BFT consensus latency |

### Global State (Non-Partitionable)

These structures are shared across all players and cannot be trivially partitioned:

- **HouseState**: Net P&L, total staked, progressive jackpots
- **AmmPool**: Liquidity reserves, LP shares
- **TournamentState**: Active tournaments, leaderboards
- **GlobalTable**: Multi-player game coordination (Craps, Roulette)

---

## Scaling Dimensions

### Vertical Scaling (Single Instance)

Before horizontal scaling, maximize single-instance capacity:

| Component | Optimization | Expected Gain |
|-----------|--------------|---------------|
| Gateway | Increase `MAX_TOTAL_SESSIONS` | 2-5x sessions |
| Gateway | Reduce nonce persistence interval | Lower disk I/O |
| Simulator | Enable Postgres (vs SQLite) | 10x write throughput |
| Simulator | Increase HTTP rate limit | Linear with CPU |
| Validator | Increase execution concurrency | 2-4x with cores |

### Horizontal Scaling Approaches

| Approach | Complexity | Consistency | Use Case |
|----------|------------|-------------|----------|
| Gateway replicas (stateless) | Low | Strong | High session count |
| Simulator read replicas | Medium | Eventual | Explorer queries |
| Account-based sharding | High | Strong | Millions of accounts |
| Game-type partitioning | Medium | Strong | Game-specific scaling |

---

## Gateway Scaling

### Architecture: Stateless Gateway Replicas

```
                    ┌─────────────────┐
                    │   Load Balancer │
                    │   (Caddy/HAProxy)│
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   Gateway 1   │    │   Gateway 2   │    │   Gateway 3   │
│  (sessions)   │    │  (sessions)   │    │  (sessions)   │
└───────────────┘    └───────────────┘    └───────────────┘
        │                    │                    │
        └────────────────────┼────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │    Simulator    │
                    │   (single/HA)   │
                    └─────────────────┘
```

### Session Isolation

Each gateway instance manages independent sessions:

- **Session keys**: Generated locally per gateway (ED25519)
- **Nonce tracking**: Persisted per gateway instance
- **No session migration**: Clients reconnect to any gateway on disconnect

### Configuration for Multi-Gateway

```bash
# Gateway 1
GATEWAY_INSTANCE_ID=gw-1
GATEWAY_DATA_DIR=/data/gateway-1

# Gateway 2
GATEWAY_INSTANCE_ID=gw-2
GATEWAY_DATA_DIR=/data/gateway-2

# Load balancer (Caddy)
# Use IP-hash for sticky sessions during active games
```

### Load Balancer Requirements

| Requirement | Implementation |
|-------------|----------------|
| WebSocket support | Required (long-lived connections) |
| Health checks | `/healthz` endpoint |
| Sticky sessions | IP-hash or cookie-based |
| Connection draining | Graceful shutdown support |

### Sticky Sessions

For active games, route returning clients to the same gateway:

```caddy
# Caddyfile example
:9010 {
    reverse_proxy gateway-1:9010 gateway-2:9010 gateway-3:9010 {
        lb_policy ip_hash
        health_uri /healthz
        health_interval 10s
    }
}
```

**Fallback behavior**: If a gateway dies mid-game, the client receives `SESSION_EXPIRED` and must reconnect. The game state is preserved on-chain and can be resumed.

---

## Simulator Scaling

### Read/Write Separation

The simulator has distinct workloads that can be scaled independently:

```
                    ┌─────────────────┐
                    │   Load Balancer │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  Simulator    │    │  Simulator    │    │  Simulator    │
│  (primary)    │    │  (read-only)  │    │  (read-only)  │
│  /submit      │    │  /state       │    │  /explorer/*  │
│  /state       │    │  /account     │    │               │
│  /account     │    │  /explorer/*  │    │               │
└───────────────┘    └───────────────┘    └───────────────┘
        │
        ▼
┌───────────────┐
│   Postgres    │
│  (primary)    │
└───────────────┘
```

### Write Path (Primary Only)

Only one simulator instance processes writes:

- `/submit` - Transaction submission
- Mempool management
- Event broadcasting to read replicas

### Read Path (Scalable)

Read replicas serve explorer and state queries:

- `/state` - Account state lookups
- `/account` - Balance/nonce queries
- `/explorer/*` - Historical data

### Postgres Configuration for Read Replicas

```sql
-- Primary
ALTER SYSTEM SET wal_level = replica;
ALTER SYSTEM SET max_wal_senders = 5;
ALTER SYSTEM SET wal_keep_size = '1GB';

-- Replica
primary_conninfo = 'host=primary port=5432 user=replicator'
primary_slot_name = 'simulator_replica_1'
```

### Event Propagation

For real-time updates across read replicas:

```
Primary Simulator                 Read Replicas
      │                                │
      │ ── (Block committed) ─────────▶│
      │                                │
      │ ── (WebSocket broadcast) ─────▶│
      │                                │
```

Options:
1. **Postgres NOTIFY/LISTEN** - Built-in, low latency
2. **Redis Pub/Sub** - Higher throughput, additional dependency
3. **Direct WebSocket** - Simplest, limited fanout

---

## Validator Scaling

### BFT Constraints

Validators operate under Byzantine Fault Tolerance rules:

- **Minimum nodes**: 3 (tolerates 0 failures)
- **Recommended nodes**: 4-7 (tolerates 1-2 failures)
- **Formula**: `f = (n-1)/3` failures tolerated for `n` validators

### Adding Validators

Validators cannot be added mid-epoch. The process:

1. Deploy new validator node with genesis config
2. Wait for current epoch to end
3. Update `participants` list in consensus config
4. Restart all validators with new config

### Validator Performance Tuning

```toml
# node/config.toml

# Increase execution parallelism (per-account)
execution_concurrency = 8

# Larger mempool for burst traffic
mempool_max_transactions = 500000
mempool_max_backlog = 128

# Aggressive state pruning
prune_interval = 1000
```

### Validator Latency Budget

| Phase | Budget | Notes |
|-------|--------|-------|
| Proposal | 200ms | Block creation |
| Broadcast | 100ms | P2P gossip |
| Verification | 300ms | Signature aggregation |
| Execution | 400ms | Transaction processing |
| **Total** | ~1s | Target block time |

---

## State Partitioning

### Account-Based Sharding

For millions of accounts, partition by public key prefix:

```
Shard 0: Accounts 0x00... - 0x3F...
Shard 1: Accounts 0x40... - 0x7F...
Shard 2: Accounts 0x80... - 0xBF...
Shard 3: Accounts 0xC0... - 0xFF...
```

### Partitioning Implementation

The validator already supports partition prefixes:

```rust
// node/src/application/mod.rs
pub struct Config<I: Indexer> {
    pub partition_prefix: String,  // Filter transactions by prefix
    // ...
}
```

### Cross-Shard Transactions

Global state updates require cross-shard coordination:

| Operation | Sharding Support | Notes |
|-----------|------------------|-------|
| Player balance | Shardable | Per-account isolation |
| Game sessions | Shardable | Session ID derived from account |
| AMM swaps | Not shardable | Touches global pool |
| Vault operations | Not shardable | Touches global debt tracking |
| Global tables | Not shardable | Multi-player coordination |

### Recommended Approach

Start with single-shard, scale vertically until:
- Account count exceeds 100,000
- Transaction throughput exceeds 10,000 TPS
- State size exceeds 100GB

Then implement account-based sharding with a dedicated coordinator for cross-shard operations.

---

## Session Affinity

### Why Session Affinity Matters

Games maintain in-progress state across multiple messages:

```
Client                    Gateway                   Chain
   │                         │                        │
   │ ── place_bet ─────────▶ │                        │
   │                         │ ── submit ───────────▶ │
   │                         │ ◀── bet_accepted ───── │
   │                         │                        │
   │ ── game_move ─────────▶ │                        │
   │                         │ ── submit ───────────▶ │
   │                         │ ◀── game_result ────── │
   │ ◀── payout ─────────────│                        │
```

If the client reconnects mid-game to a different gateway:
- The new gateway lacks the session context
- The nonce sequence must be recovered from disk
- The game can continue (state is on-chain)

### Affinity Strategies

| Strategy | Pros | Cons |
|----------|------|------|
| IP-hash | Simple, no cookies | NAT issues, mobile IP changes |
| Cookie-based | Consistent for browsers | Mobile apps need header |
| Session-ID header | Most reliable | Requires client cooperation |

### Recommended: Hybrid Approach

```javascript
// Client-side (mobile/web)
const headers = {
  'X-Session-Affinity': sessionId || ipAddress
};
```

```caddy
# Load balancer
header_up X-Session-Affinity {header.X-Session-Affinity}
lb_policy header X-Session-Affinity
```

### Recovery on Gateway Failure

When a gateway fails, clients experience:

1. WebSocket disconnect
2. `SESSION_EXPIRED` event (if reconnecting to same gateway)
3. Reconnect to different gateway via load balancer
4. New session created (new keypair)
5. Game state recovered from chain (if in-progress)

**Recovery time**: < 5 seconds with health checks

---

## Operational Runbook

### Scaling Up Gateways

```bash
# 1. Deploy new gateway instance
docker run -d \
  --name gateway-2 \
  -e GATEWAY_INSTANCE_ID=gw-2 \
  -e GATEWAY_DATA_DIR=/data \
  -v gateway-2-data:/data \
  nullspace-gateway:latest

# 2. Add to load balancer
# (Update Caddy/HAProxy upstream list)

# 3. Verify health
curl http://gateway-2:9010/healthz

# 4. Monitor session distribution
curl http://gateway-1:9010/metrics | grep sessions
curl http://gateway-2:9010/metrics | grep sessions
```

### Scaling Down Gateways

```bash
# 1. Mark gateway for drain
# (Remove from load balancer upstream)

# 2. Wait for active games to complete
# (Monitor activeGameId in sessions)

# 3. Stop gateway gracefully
docker stop gateway-2 --time 60

# 4. Verify sessions migrated
# (Clients reconnect to remaining gateways)
```

### Adding Read Replicas

```bash
# 1. Create Postgres replica
pg_basebackup -h primary -D /var/lib/postgresql/data -P

# 2. Deploy read-only simulator
docker run -d \
  --name simulator-ro-1 \
  -e DATABASE_URL=postgres://replica:5432/explorer \
  -e READ_ONLY=true \
  nullspace-simulator:latest

# 3. Add to load balancer for read endpoints
# (Route /state, /account, /explorer/* to replicas)
```

### Emergency: Gateway Failure

```bash
# 1. Check health status
curl http://gateway:9010/healthz || echo "Gateway down"

# 2. Load balancer should auto-remove unhealthy instance

# 3. Check client reconnection rate
# (Monitor new session creation on remaining gateways)

# 4. If nonce issues, recover from disk
ls /data/gateway/nonces/

# 5. Restart gateway if recoverable
docker restart gateway-1
```

---

## Capacity Planning

### Per-Gateway Capacity

| Metric | Value | Notes |
|--------|-------|-------|
| Sessions | 1,000 | Default limit, adjustable |
| Memory | 2-4GB | Session state + buffers |
| CPU | 2-4 cores | WebSocket handling |
| Network | 100Mbps | Per 1,000 sessions |

### Scaling Formula

```
Gateways needed = ceil(expected_concurrent_players / 800)
```

(Use 800 instead of 1,000 for headroom)

### Example Deployments

| Players | Gateways | Simulators | Validators |
|---------|----------|------------|------------|
| 1,000 | 2 | 1 | 3 |
| 5,000 | 7 | 1 + 2 read | 4 |
| 20,000 | 25 | 1 + 5 read | 5 |
| 100,000 | 125 | Sharded | 7 |

### Cost Estimates (Hetzner Cloud)

| Scale | Gateways | Simulators | Validators | Monthly |
|-------|----------|------------|------------|---------|
| 1K | 2× CPX21 | 1× CPX41 | 3× CPX31 | ~€150 |
| 5K | 7× CPX21 | 3× CPX41 | 4× CPX31 | ~€450 |
| 20K | 25× CPX21 | 6× CPX41 | 5× CPX31 | ~€1,500 |

---

## Future Considerations

### WebSocket Clustering

For very large scale (100K+ connections per gateway):

- **Redis adapter** for Socket.IO clustering
- **Shared session store** across gateway instances
- **Event sourcing** for session state recovery

### Geographic Distribution

For global latency optimization:

- **Regional gateway clusters** (NA, EU, APAC)
- **GeoDNS routing** to nearest cluster
- **Single validator cluster** (consensus requires low latency)

### State Channels

For ultra-high frequency games:

- **Off-chain game state** with periodic checkpoints
- **Dispute resolution** via main chain
- **Sub-second latency** for HiLo/slots

---

## Appendix: Key Files

| File | Purpose |
|------|---------|
| `gateway/src/session/manager.ts` | Session lifecycle |
| `gateway/src/session/limiter.ts` | Rate limiting |
| `node/src/application/mod.rs` | Validator config |
| `node/src/application/mempool.rs` | Transaction queue |
| `simulator/src/api/http.rs` | HTTP endpoints |
| `infrastructure/staging/docker-compose.yml` | Deployment config |
