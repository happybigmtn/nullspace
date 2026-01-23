# Mempool-Aware Nonce Management Spec

**Status**: Proposed
**Date**: 2026-01-23
**Author**: Claude

## Problem Statement

The gateway experiences `nonce_too_high` errors when sending rapid sequential transactions because:

1. Transaction N is submitted to the chain (nonce=0)
2. Gateway immediately increments local nonce to 1
3. Transaction N+1 is submitted (nonce=1) before N is confirmed
4. Chain still has committed nonce=0, rejects nonce=1 as "too high"

This is observable in stress tests where registration (nonce=0) completes, then immediate game actions (nonce=1+) fail with nonce errors. The root cause is the gateway's "fire-and-forget" transaction model that assumes mempool acceptance equals eventual confirmation.

## Solution Overview

Implement a **mempool-aware nonce manager** that tracks pending (unconfirmed) transactions and waits for confirmation before allowing subsequent transactions for the same account.

### Architecture

```
                                 ┌─────────────────────┐
                                 │   NonceManager      │
                                 │   (enhanced)        │
                                 └─────────────────────┘
                                          │
                                          ▼
┌──────────────┐   submit    ┌─────────────────────┐
│   Gateway    │────────────▶│  TransactionQueue   │
│   Handler    │             │  (per-account)      │
└──────────────┘             └─────────────────────┘
                                          │
                         ┌────────────────┴────────────────┐
                         ▼                                 ▼
              ┌─────────────────┐               ┌─────────────────┐
              │  Submit to      │               │  Confirmation   │
              │  Backend        │               │  Watcher        │
              └─────────────────┘               └─────────────────┘
                                                        │
                                                        ▼
                                               ┌─────────────────┐
                                               │  /updates WS    │
                                               │  (blocks)       │
                                               └─────────────────┘
```

## Acceptance Criteria

### AC-1: Sequential Transaction Ordering

1. **AC-1.1**: When a transaction is submitted, subsequent transactions for the same account MUST wait until the pending transaction is confirmed or times out
2. **AC-1.2**: Confirmation timeout MUST be configurable (default: 30s) via `GATEWAY_TX_CONFIRMATION_TIMEOUT_MS`
3. **AC-1.3**: On confirmation timeout, the pending transaction MUST be marked as failed and the queue unblocked

### AC-2: Confirmation Detection

1. **AC-2.1**: Transaction confirmation MUST be detected via the `/updates` WebSocket when the account's nonce increments
2. **AC-2.2**: Confirmation detection MUST be O(1) per block by tracking expected nonces
3. **AC-2.3**: If the updates WebSocket disconnects, the system MUST fallback to polling `/account/{pubkey}`

### AC-3: Queue Management

1. **AC-3.1**: Each account MUST have an independent transaction queue
2. **AC-3.2**: Queue MUST support concurrent reads but serialize writes (single writer)
3. **AC-3.3**: Queue depth MUST be bounded (default: 10) via `GATEWAY_TX_QUEUE_DEPTH`
4. **AC-3.4**: When queue is full, new submissions MUST return an error immediately

### AC-4: Error Handling

1. **AC-4.1**: If a transaction is rejected by the backend, the queue MUST be unblocked and nonce re-synced
2. **AC-4.2**: Nonce mismatch errors MUST trigger automatic resync from chain state
3. **AC-4.3**: All queue operations MUST have bounded memory usage

### AC-5: Performance

1. **AC-5.1**: For accounts with no pending transactions, submission latency overhead MUST be < 5ms
2. **AC-5.2**: For accounts with pending transactions, wait time MUST be bounded by confirmation timeout
3. **AC-5.3**: The system MUST handle 1000+ concurrent accounts

## Implementation Details

### NonceManager Changes

```typescript
interface PendingTransaction {
  nonce: bigint;
  submittedAt: number;
  timeoutMs: number;
  resolve: () => void;
  reject: (error: Error) => void;
}

class NonceManager {
  // Existing fields...
  private pendingTxs: Map<string, PendingTransaction[]> = new Map();
  private confirmationTimeoutMs: number;
  private maxQueueDepth: number;

  /**
   * Submit transaction and wait for confirmation before returning
   */
  async submitAndWaitForConfirmation(
    publicKeyHex: string,
    submit: () => Promise<SubmitResult>
  ): Promise<SubmitResult>;

  /**
   * Notify that a nonce was confirmed (called from updates watcher)
   */
  confirmNonce(publicKeyHex: string, confirmedNonce: bigint): void;

  /**
   * Check and process timed-out transactions
   */
  checkTimeouts(): void;
}
```

### ConfirmationWatcher

```typescript
class ConfirmationWatcher {
  private updatesClient: UpdatesClient;
  private nonceManager: NonceManager;
  private watching: Map<string, bigint>; // pubkey -> expected nonce

  /**
   * Watch for nonce confirmations for an account
   */
  watchAccount(publicKeyHex: string, expectedNonce: bigint): void;

  /**
   * Stop watching an account
   */
  unwatchAccount(publicKeyHex: string): void;

  /**
   * Handle block event from updates stream
   */
  private onBlock(block: BlockEvent): void;
}
```

### Session Manager Integration

The `submitWithRetry` method in SessionManager will be updated to use the new confirmation-aware submission:

```typescript
private async submitWithRetry(
  session: Session,
  instruction: Uint8Array,
  onSuccess: () => void,
  actionName: string
): Promise<boolean> {
  return this.nonceManager.submitAndWaitForConfirmation(
    session.publicKeyHex,
    async () => {
      const nonce = this.nonceManager.getAndIncrement(session.publicKeyHex);
      const tx = buildTransaction(nonce, instruction, session.privateKey);
      const submission = wrapSubmission(tx);
      return this.submitClient.submit(submission);
    }
  );
}
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `GATEWAY_TX_CONFIRMATION_TIMEOUT_MS` | 30000 | Max time to wait for tx confirmation |
| `GATEWAY_TX_QUEUE_DEPTH` | 10 | Max pending transactions per account |
| `GATEWAY_CONFIRMATION_POLL_INTERVAL_MS` | 1000 | Fallback polling interval |

## Migration Path

1. Feature flag `GATEWAY_MEMPOOL_AWARE_NONCE` (default: true)
2. When disabled, falls back to current fire-and-forget behavior
3. Enable by default after stress test validation

## Testing Strategy

### Unit Tests
- Transaction queue ordering
- Confirmation timeout handling
- Nonce sync on errors
- Queue depth enforcement

### Integration Tests
- Rapid sequential transactions confirm in order
- Timeout triggers resync
- WebSocket fallback to polling

### Stress Tests
- Existing casino stress tests pass with new nonce manager
- 100+ concurrent players with rapid transactions
- Network partition recovery

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Confirmation never arrives | Session stuck | Configurable timeout with auto-resync |
| WebSocket disconnects | Delayed confirmations | Automatic fallback to polling |
| Queue fills up | New requests rejected | Clear error message, configurable depth |
| Memory growth | OOM | Bounded queues, cleanup on session destroy |

## Open Questions

1. Should we implement batch transaction support (multiple txs in one submission)?
2. Should confirmation watching be global or per-session?
3. What's the right default timeout given typical block times?
