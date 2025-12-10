# Supersociety Battleware Scaling Guide

## Executive Summary

This document outlines the scaling characteristics, limits, and optimization strategies for the supersociety-battleware application built on the commonware blockchain framework.

**Current Capacity**: 50-100 concurrent bot players at 30-50 TPS
**Optimized Capacity**: 1,000-10,000+ players with phased improvements

---

## Block Size Analysis & Tradeoffs

### Theoretical Maximum Block Size

The theoretical maximum for `MAX_BLOCK_TRANSACTIONS` is constrained by several factors:

#### Network Constraint: MAX_MESSAGE_SIZE = 10MB

```
Average transaction size breakdown:
- nonce (varint): ~3 bytes
- instruction: 10-100 bytes (avg ~50 bytes)
- public_key (ed25519): 32 bytes (fixed)
- signature (ed25519): 64 bytes (fixed)
= ~150 bytes average per transaction

Block overhead:
- parent digest: 32 bytes
- view (varint): ~3 bytes
- height (varint): ~3 bytes
- vec length prefix: ~3 bytes
= ~41 bytes fixed overhead

Theoretical max: (10,485,760 - 41) / 150 ≈ 69,900 transactions
```

However, practical limits are much lower due to processing constraints.

#### Processing Time Constraints

| Constraint | Current Value | Impact on Block Size |
|------------|---------------|---------------------|
| `LEADER_TIMEOUT` | 1 second | Must propose block within this time |
| `NOTARIZATION_TIMEOUT` | 2 seconds | Must verify & notarize within this time |
| `execution_concurrency` | 2 threads | State transition processing |
| Signature batch verification | ~1ms per 100 sigs | CPU bound verification |

#### Practical Block Size Limits

| Block Size | Verification Time | Execution Time | Network Propagation | Feasible? |
|------------|------------------|----------------|---------------------|-----------|
| 100 | ~1ms | ~50ms | ~100ms | Current |
| 500 | ~5ms | ~250ms | ~200ms | Safe |
| 1,000 | ~10ms | ~500ms | ~300ms | Aggressive |
| 5,000 | ~50ms | ~2.5s | ~1s | Requires timeout changes |
| 10,000 | ~100ms | ~5s | ~2s | Requires architecture changes |

### Block Size Tradeoffs

#### Benefits of Larger Blocks
1. **Higher throughput**: More transactions per second
2. **Better batching efficiency**: Amortizes consensus overhead
3. **Reduced latency variability**: Fewer blocks to wait for inclusion
4. **Lower per-transaction overhead**: Fixed costs spread across more txs

#### Costs of Larger Blocks
1. **Increased finalization latency**: Larger blocks take longer to propagate
2. **Memory pressure**: More transactions in flight simultaneously
3. **Verification bottleneck**: Signature verification scales linearly
4. **State execution time**: More state transitions per block
5. **Catchup difficulty**: Lagging nodes must process larger blocks
6. **Centralization risk**: Only powerful nodes can propose large blocks

#### Recommended Block Sizes by Use Case

| Use Case | Recommended Size | Rationale |
|----------|-----------------|-----------|
| Low-latency gaming | 100-200 | Minimize confirmation time |
| High-throughput casino | 500-1,000 | Balance throughput/latency |
| Batch processing | 2,000-5,000 | Maximize throughput |
| Stress testing | 1,000+ | Test limits |

---

## Current Architecture Limits

### Consensus Layer

| Parameter | Location | Current Value | Description |
|-----------|----------|---------------|-------------|
| `MAX_BLOCK_TRANSACTIONS` | `types/src/execution.rs:21` | 100 | Transactions per block |
| `LEADER_TIMEOUT` | `node/src/main.rs:36` | 1 second | Block proposal window |
| `NOTARIZATION_TIMEOUT` | `node/src/main.rs:37` | 2 seconds | Notarization window |
| `ACTIVITY_TIMEOUT` | `node/src/main.rs:39` | 256 views | Activity monitoring |

### Mempool Layer

| Parameter | Location | Current Value | Description |
|-----------|----------|---------------|-------------|
| `MAX_TRANSACTIONS` | `node/src/application/mempool.rs:11` | 32,768 | Global mempool capacity |
| `MAX_BACKLOG` | `node/src/application/mempool.rs:8` | 16 | Per-account pending limit |

### Network Layer

| Parameter | Location | Current Value | Description |
|-----------|----------|---------------|-------------|
| `MAX_MESSAGE_SIZE` | `node/src/main.rs:43` | 10 MB | Maximum P2P message |
| Broadcaster rate | `node/src/main.rs:227` | 8 msg/sec | Block broadcast limit |
| Pending rate | `node/src/main.rs:214` | 128 msg/sec | Transaction rate |

### Execution Layer

| Parameter | Location | Current Value | Description |
|-----------|----------|---------------|-------------|
| `execution_concurrency` | Deployment config | 2 | Parallel execution threads |
| `BUFFER_POOL_CAPACITY` | `node/src/main.rs` | 32,768 pages | Memory buffer pool |

---

## Scaling Implementation Plan

### Phase 1: Server-Side Quick Wins (10x improvement)

**Target**: 300-500 concurrent bots, 200-300 TPS

#### Changes Required

1. **Increase execution concurrency**
   - File: Deployment configuration / `node/src/main.rs`
   - Change: `execution_concurrency: 2` → `execution_concurrency: 16`
   - Impact: 8x parallel state processing

2. **Increase block size**
   - File: `types/src/execution.rs:21`
   - Change: `MAX_BLOCK_TRANSACTIONS: 100` → `MAX_BLOCK_TRANSACTIONS: 500`
   - Impact: 5x transactions per block

3. **Increase mempool capacity**
   - File: `node/src/application/mempool.rs:11`
   - Change: `MAX_TRANSACTIONS: 32_768` → `MAX_TRANSACTIONS: 100_000`
   - Impact: 3x pending transaction capacity

4. **Increase broadcaster rate limit**
   - File: `node/src/main.rs:227`
   - Change: `Quota::per_second(8)` → `Quota::per_second(32)`
   - Impact: 4x block propagation speed

5. **Increase per-account backlog**
   - File: `node/src/application/mempool.rs:8`
   - Change: `MAX_BACKLOG: 16` → `MAX_BACKLOG: 64`
   - Impact: 4x pending transactions per bot

#### Testing Criteria
- [ ] All 176 existing tests pass
- [ ] Stress test with 300 bots completes without errors
- [ ] Block finalization remains under 5 seconds
- [ ] No mempool overflow with sustained load
- [ ] Network propagation stable

---

### Phase 2: Client-Side Optimizations

**Target**: 500-1,000 concurrent bots

#### Changes Required

1. **Transaction batching**
   - File: `client/examples/stress_test.rs`
   - Change: Submit 5-10 transactions per API call
   - Impact: Reduced HTTP overhead

2. **Rate limiting with governor**
   - File: `client/examples/stress_test.rs`
   - Change: Add governor-based rate limiting
   - Impact: Prevent server overwhelm

3. **Optimize atomic ordering**
   - File: `client/examples/stress_test.rs`
   - Change: `Ordering::SeqCst` → `Ordering::Relaxed` for metrics
   - Impact: Reduced contention

4. **Connection pool configuration**
   - File: `client/src/client.rs`
   - Change: Explicit reqwest pool sizing
   - Impact: Better connection reuse

#### Testing Criteria
- [ ] Stress test with 800 bots completes
- [ ] Transaction success rate >99%
- [ ] Client memory usage stable
- [ ] No connection exhaustion

---

### Phase 3: State Layer Optimizations

**Target**: 1,000-3,000 concurrent bots, 10,000+ player state

#### Changes Required

1. **Reduce clone overhead**
   - File: `execution/src/lib.rs`
   - Change: Use `Arc<Player>` for shared state, copy-on-write patterns
   - Impact: Reduced memory churn

2. **Optimize leaderboard updates**
   - File: `types/src/casino.rs:423-443`
   - Change: Use binary heap instead of Vec + sort
   - Impact: O(log n) vs O(n log n) updates

3. **Tournament membership optimization**
   - File: `types/src/casino.rs:504-538`
   - Change: Use `HashSet<PublicKey>` for membership
   - Impact: O(1) vs O(n) lookups

4. **State blob compression**
   - File: `types/src/casino.rs:318-328`
   - Change: Compress state_blob for storage
   - Impact: Reduced I/O and memory

#### Testing Criteria
- [ ] 10,000 player state loads in <1 second
- [ ] Leaderboard updates complete in <10ms
- [ ] Memory usage scales linearly
- [ ] All game logic tests pass

---

### Phase 4: Architecture Changes (Future)

**Target**: 10,000+ concurrent players

#### Potential Changes

1. **Validator sharding**
   - Partition consensus across validator subsets
   - Requires protocol changes

2. **State partitioning**
   - Separate game sessions by shard key
   - Requires execution layer redesign

3. **Mempool federation**
   - Distributed transaction pools
   - Requires network protocol changes

4. **Gossip protocol**
   - Replace full broadcast for non-critical messages
   - Requires P2P layer changes

---

## Monitoring & Metrics

### Key Metrics to Track

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| TPS | >100 | <50 |
| Block finalization | <5s | >10s |
| Mempool size | <50,000 | >80,000 |
| Execution latency | <500ms | >2s |
| Network propagation | <1s | >3s |

### Prometheus Metrics Available

- `txs_considered` - Transactions considered per block
- `txs_executed` - Transactions executed per block
- `ancestry_latency` - Block ancestry lookup time
- `propose_latency` - Block proposal time
- `verify_latency` - Block verification time
- `execute_latency` - State execution time
- `finalize_latency` - Block finalization time

---

## Appendix: Configuration Reference

### Recommended Configurations by Scale

#### Small (100 players)
```rust
MAX_BLOCK_TRANSACTIONS = 100
MAX_TRANSACTIONS = 32_768
MAX_BACKLOG = 16
execution_concurrency = 2
broadcaster_quota = 8 msg/sec
```

#### Medium (1,000 players)
```rust
MAX_BLOCK_TRANSACTIONS = 500
MAX_TRANSACTIONS = 100_000
MAX_BACKLOG = 64
execution_concurrency = 16
broadcaster_quota = 32 msg/sec
```

#### Large (10,000 players)
```rust
MAX_BLOCK_TRANSACTIONS = 1000
MAX_TRANSACTIONS = 500_000
MAX_BACKLOG = 128
execution_concurrency = 32
broadcaster_quota = 64 msg/sec
```
