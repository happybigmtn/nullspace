# Gateway Chain Synchronization Robustness

**Status**: draft → **updated with root cause**
**Date**: 2026-01-16
**Scope**: Gateway resilience to chain resets, nonce drift, and backend connectivity issues.

This spec defines improvements to the transaction submission pipeline to ensure games remain playable after chain resets and during normal operation.

## 1. Problem Statement

### 1.1 Observed Symptoms

After chain resets, the following failure modes occur **repeatedly despite multiple resets**:

1. **"WAITING FOR CHAIN" indefinitely**: UI shows transactions pending forever
2. **tx_count=0 in all blocks**: Chain produces blocks but no transactions are included
3. **Nonce Drift**: Gateway's cached nonces diverge from on-chain nonces
4. **Silent Failures**: Services report healthy but transactions aren't flowing

### 1.2 Root Cause Analysis

**The fundamental issue is an architectural flaw in the mempool broadcast system.**

The simulator uses `tokio::sync::broadcast` for mempool distribution:

```rust
// simulator/src/lib.rs:366
let (mempool_tx, mempool_rx) = broadcast::channel(config.mempool_broadcast_capacity());

// simulator/src/state.rs:1025-1029
pub fn submit_transactions(&self, transactions: Vec<Transaction>) {
    if let Err(e) = self.mempool_tx.send(Pending { transactions }) {
        tracing::warn!("Failed to broadcast transactions (no subscribers): {}", e);
    }
}
```

**Critical Property of `broadcast::channel`**: Subscribers only receive messages sent AFTER they subscribe. Messages sent before subscription are **permanently lost**.

### 1.3 Race Condition During Startup/Reconnection

```
Timeline showing the race:

T0: Chain reset - validators restart
T1: Simulator starts, creates new broadcast channel (empty)
T2: Gateway submits bet transaction
T3: simulator.submit_transactions() broadcasts to mempool_tx
    → NO SUBSCRIBERS YET → Transaction LOST
T4: Validator's ReconnectingStream starts connecting
T5: WebSocket upgrade begins
T6: mempool_subscriber() called - subscription starts
T7: Future transactions would be received...
    → But T3's transaction is gone forever

Result: tx_count=0 in all blocks produced
```

### 1.4 Why Resets Don't Help

Each reset restarts the same broken initialization sequence:
1. Services restart with fresh state
2. Same race condition window exists during reconnection
3. First batch of transactions during window are lost
4. Problem repeats indefinitely

### 1.5 Supporting Evidence

From codebase analysis:

1. **simulator/src/state.rs:1027**: Warning "no subscribers" is logged but transaction is still lost
2. **simulator/src/lib.rs:322-327**: `_mempool_rx` kept alive only prevents channel closure, NOT message loss
3. **node/src/indexer.rs:259**: 200ms backoff is too short, race window still exists
4. **simulator/src/api/ws.rs**: Subscription happens INSIDE handler, AFTER WS upgrade completes

## 2. Goals

1. **Eliminate transaction loss**: No transaction should be lost due to subscriber timing
2. **Reliable startup**: System should work correctly from first transaction after reset
3. **Graceful reconnection**: Temporary disconnections shouldn't lose transactions
4. **Observable failures**: If transactions fail, provide clear error feedback
5. **Backward compatible**: Changes shouldn't break existing protocol

## 3. Non-Goals

- Changing the consensus algorithm
- Adding transaction persistence to disk (future improvement)
- Supporting guaranteed exactly-once delivery (at-least-once is acceptable)

## 4. Strategic Fix Architecture

### 4.1 Option A: Buffered Mempool with Replay Window (Recommended)

Replace lossy broadcast with a buffered queue that supports replay:

```rust
// New struct to manage mempool with buffering
pub struct BufferedMempool {
    // Recent transactions available for replay to new subscribers
    replay_buffer: Arc<RwLock<VecDeque<(Instant, Pending)>>>,
    // Notification channel for new transactions
    notify: Arc<Notify>,
    // Configuration
    replay_window_duration: Duration,
    max_replay_size: usize,
}

impl BufferedMempool {
    pub fn submit(&self, pending: Pending) {
        // Add to replay buffer (with timestamp)
        let mut buffer = self.replay_buffer.write().await;
        buffer.push_back((Instant::now(), pending));

        // Trim old entries
        let cutoff = Instant::now() - self.replay_window_duration;
        while buffer.front().map(|(t, _)| *t < cutoff).unwrap_or(false) {
            buffer.pop_front();
        }

        // Notify all waiters
        self.notify.notify_waiters();
    }

    pub async fn subscribe(&self) -> MempoolSubscriber {
        // New subscriber gets replay of recent transactions
        let buffer = self.replay_buffer.read().await;
        let replay: Vec<Pending> = buffer.iter().map(|(_, p)| p.clone()).collect();

        MempoolSubscriber {
            replay,
            replay_index: 0,
            notify: Arc::clone(&self.notify),
            buffer: Arc::clone(&self.replay_buffer),
            last_seen: Instant::now(),
        }
    }
}
```

**Acceptance Criteria:**
- AC-4.1: New subscribers receive all transactions from the last N seconds (configurable, default 30s)
- AC-4.2: No transactions lost during subscriber reconnection within replay window
- AC-4.3: Memory bounded by max_replay_size (default 10000 transactions)

### 4.2 Option B: Synchronous Subscriber Check

Before accepting transactions, verify at least one subscriber is ready:

```rust
pub fn submit_transactions(&self, transactions: Vec<Transaction>) -> Result<(), SubmitError> {
    // Check subscriber count before sending
    if self.mempool_tx.receiver_count() == 0 {
        return Err(SubmitError::NoSubscribers);
    }

    self.mempool_tx.send(Pending { transactions })
        .map_err(|_| SubmitError::SendFailed)?;

    Ok(())
}
```

**Limitations**: Returns error to gateway, but doesn't solve the fundamental timing issue.

### 4.3 Option C: Transaction Acknowledgment Protocol

Add acknowledgment from validators that transaction was received:

```rust
pub async fn submit_transactions_with_ack(
    &self,
    transactions: Vec<Transaction>,
    timeout: Duration,
) -> Result<(), SubmitError> {
    let tx_hash = compute_hash(&transactions);

    // Register pending ack
    let (ack_tx, ack_rx) = oneshot::channel();
    self.pending_acks.insert(tx_hash, ack_tx);

    // Broadcast
    self.mempool_tx.send(Pending { transactions, ack_id: tx_hash })?;

    // Wait for ack with timeout
    match timeout(timeout, ack_rx).await {
        Ok(Ok(_)) => Ok(()),
        Ok(Err(_)) => Err(SubmitError::AckChannelClosed),
        Err(_) => Err(SubmitError::AckTimeout),
    }
}
```

**Note**: Requires protocol changes to validators to send acks.

## 5. Recommended Implementation: Option A + Retry Logic

### 5.1 Simulator Changes

**File: `simulator/src/lib.rs`**

```rust
// Replace:
mempool_tx: broadcast::Sender<Pending>,

// With:
mempool: Arc<BufferedMempool>,
```

**File: `simulator/src/state.rs`**

```rust
// Replace submit_transactions:
pub async fn submit_transactions(&self, transactions: Vec<Transaction>) {
    self.mempool.submit(Pending { transactions }).await;
}

// Replace mempool_subscriber:
pub async fn mempool_subscriber(&self) -> MempoolSubscriber {
    self.mempool.subscribe().await
}
```

### 5.2 Gateway Changes

**File: `gateway/src/backend/http.ts`**

Add retry logic with exponential backoff for "no subscribers" errors:

```typescript
async submit(submission: Uint8Array, maxRetries = 3): Promise<SubmitResult> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const result = await this.submitOnce(submission);

        if (result.accepted) {
            return result;
        }

        // Retry on transient errors
        if (result.error?.includes('no subscribers') ||
            result.error?.includes('not ready')) {
            await sleep(100 * Math.pow(2, attempt)); // 100ms, 200ms, 400ms
            continue;
        }

        return result;
    }

    return { accepted: false, error: 'Max retries exceeded' };
}
```

### 5.3 Health Check Enhancement

**File: `scripts/health-check.sh`**

Add mempool subscriber count check:

```bash
check_mempool_subscribers() {
    local url="$1"
    echo -n "Checking mempool subscribers... "

    local metrics
    if ! metrics="$(fetch_metrics "$url")"; then
        echo -e "${RED}DOWN${NC}"
        ALL_HEALTHY=false
        return 1
    fi

    local subscriber_count
    subscriber_count="$(read_metric "$metrics" "mempool_subscriber_count")"

    if [ -z "$subscriber_count" ] || [ "$subscriber_count" -eq 0 ]; then
        echo -e "${RED}NO_SUBSCRIBERS${NC}"
        ALL_HEALTHY=false
        return 1
    fi

    echo -e "${GREEN}UP${NC} (${subscriber_count} subscribers)"
    return 0
}
```

## 6. Testing Requirements

### 6.1 Unit Tests

- BufferedMempool replay functionality
- Subscriber receives replayed transactions
- Buffer trimming based on time and size
- Memory bounds enforcement

### 6.2 Integration Tests

- Submit transaction with no subscribers → transaction available after subscriber connects
- Rapid restart sequence → no transaction loss
- High-volume submission during reconnection → all transactions delivered

### 6.3 Chaos Tests

- Kill validators mid-transaction → transactions delivered after restart
- Network partition → transactions replayed after reconnection
- Rapid service restarts → system recovers without tx loss

## 7. Acceptance Criteria

### AC-1: Nonce Drift Handling (Existing - Implemented)
- **AC-1.1**: Gateway detects nonce drift >= 100 and resets to on-chain value ✓
- **AC-1.2**: Small drift (< 100) keeps local nonce (indexer lag handling) ✓
- **AC-1.3**: After nonce reset, subsequent transactions use correct nonce ✓

### AC-2: Transaction Replay Buffer (NEW - Critical)
- **AC-2.1**: Transactions submitted with no subscribers are buffered
- **AC-2.2**: New subscribers receive buffered transactions (replay window)
- **AC-2.3**: Buffer bounded by time (30s default) and size (10K txs)
- **AC-2.4**: Replay window configurable via environment variable

### AC-3: Subscriber Health (NEW)
- **AC-3.1**: Metrics expose `mempool_subscriber_count` gauge
- **AC-3.2**: Health check fails if subscriber count is 0
- **AC-3.3**: Submit endpoint returns clear error when no subscribers

### AC-4: Gateway Retry Logic (NEW)
- **AC-4.1**: Gateway retries on "no subscribers" error (3 attempts)
- **AC-4.2**: Exponential backoff between retries (100ms, 200ms, 400ms)
- **AC-4.3**: Final failure surfaced to client with clear error message

### AC-5: Startup Reliability (NEW)
- **AC-5.1**: First transaction after fresh deployment succeeds
- **AC-5.2**: First transaction after chain reset succeeds
- **AC-5.3**: No transactions lost during normal validator reconnection

## 8. Implementation Map

| Component | File | Changes |
|-----------|------|---------|
| BufferedMempool | `simulator/src/mempool.rs` (new) | New buffered mempool implementation |
| Simulator | `simulator/src/lib.rs` | Replace broadcast with BufferedMempool |
| Simulator State | `simulator/src/state.rs` | Update submit/subscribe methods |
| Gateway Submit | `gateway/src/backend/http.ts` | Add retry logic |
| Health Check | `scripts/health-check.sh` | Add subscriber count check |
| Metrics | `simulator/src/metrics.rs` | Add subscriber count gauge |

## 9. Migration Plan

1. **Phase 1**: Add BufferedMempool alongside existing broadcast (feature flag)
2. **Phase 2**: Route new subscriptions through BufferedMempool
3. **Phase 3**: Remove broadcast channel, use BufferedMempool exclusively
4. **Phase 4**: Add gateway retry logic
5. **Phase 5**: Update health checks and monitoring

## 10. Success Metrics

- Transaction inclusion rate: 100% of submitted transactions appear in blocks
- Time to first transaction after reset: < 5 seconds
- Zero "WAITING FOR CHAIN" timeouts after fix deployed
- Health checks catch mempool issues before users see failures
