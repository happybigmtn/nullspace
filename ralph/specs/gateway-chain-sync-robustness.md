# Gateway Chain Synchronization Robustness

**Status**: draft
**Date**: 2026-01-16
**Scope**: Gateway resilience to chain resets, nonce drift, and backend connectivity issues.

This spec defines improvements to gateway chain synchronization to ensure games remain playable after chain resets, nonce drift, and temporary backend disconnections.

## 1. Problem Statement

After a chain WIPE/reset, the following failure modes have been observed:

1. **Nonce Drift**: Gateway caches nonces locally. After chain reset, on-chain nonces reset to 0 but gateway keeps using stale high nonces, causing all transactions to be rejected with "invalid nonce".

2. **Session State Corruption**: Sessions created before chain reset have references to old game states that no longer exist on-chain.

3. **Stuck "WAITING FOR CHAIN"**: UI shows transactions pending indefinitely because the gateway never receives confirmation and doesn't detect the chain reset.

4. **Silent Failures**: Gateway health checks pass (process is up) but transactions aren't being included in blocks.

## 2. Goals

1. **Automatic Nonce Recovery**: Detect large nonce drift and reset to on-chain values.
2. **Chain Reset Detection**: Identify when chain height has regressed significantly.
3. **Session Invalidation**: Clear stale session state after detected chain reset.
4. **Health Signal Enhancement**: Expose transaction inclusion health (not just backend connectivity).
5. **Operational Recovery**: Provide script-level support for coordinated gateway+chain resets.

## 3. Non-Goals

- Changing the underlying nonce algorithm.
- Implementing automatic chain WIPE detection in validators.
- Supporting live chain migration (this is for staging/testnet).

## 4. Architecture

### 4.1 Nonce Drift Detection

Modify `NonceManager.syncFromBackend()` to detect large backwards drift:

```typescript
const CHAIN_RESET_THRESHOLD = 100n; // If drift exceeds this, assume chain reset

// In syncFromBackend:
if (current > onChainNonce && drift >= CHAIN_RESET_THRESHOLD) {
  // Large drift indicates chain reset - prefer on-chain
  this.nonces.set(publicKeyHex, onChainNonce);
}
```

### 4.2 Chain Height Tracking

Add chain height monitoring to the gateway to detect resets:

```typescript
// Track last known chain height
let lastKnownHeight: number | null = null;
const RESET_DETECTION_THRESHOLD = 100; // Height regression > 100 blocks = reset

async function checkChainHeight(): Promise<boolean> {
  const currentHeight = await fetchChainHeight();
  if (lastKnownHeight && currentHeight < lastKnownHeight - RESET_DETECTION_THRESHOLD) {
    // Chain reset detected
    return true;
  }
  lastKnownHeight = currentHeight;
  return false;
}
```

### 4.3 Session Invalidation on Reset

When chain reset is detected:
1. Clear all pending nonces
2. Mark all active game states as stale
3. Force balance refresh on next interaction
4. Send `chain_reset` notification to connected clients

### 4.4 Transaction Inclusion Health

Extend health check to verify tx inclusion:

```typescript
// Track recent submission outcomes
const recentSubmissions: { timestamp: number; accepted: boolean; included: boolean }[] = [];

// Health signal: recent submissions are being included
function getInclusionHealth(): { healthy: boolean; acceptRate: number; includeRate: number } {
  const recent = recentSubmissions.filter(s => s.timestamp > Date.now() - 60_000);
  const accepted = recent.filter(s => s.accepted).length;
  const included = recent.filter(s => s.included).length;
  return {
    healthy: accepted > 0 && included / accepted > 0.8,
    acceptRate: accepted / recent.length,
    includeRate: accepted > 0 ? included / accepted : 0,
  };
}
```

### 4.5 Recovery Script Coordination

Update `scripts/testnet-consensus-recover.sh` to:
1. Clear gateway nonce cache before restart
2. Wait for chain to produce blocks with transactions
3. Verify gateway health after restart

## 5. Testing Requirements

### 5.1 Integration Tests
- Submit transaction with stale nonce > CHAIN_RESET_THRESHOLD; verify nonce resets
- Simulate chain height regression; verify reset detection
- After detected reset, verify sessions receive notification
- Run recovery script; verify games work afterward

### 5.2 Unit Tests
- `NonceManager.syncFromBackend()` with various drift scenarios
- Chain height tracking with regression detection
- Session invalidation on reset

## 6. Acceptance Criteria

### AC-1: Nonce Drift Handling
- **AC-1.1**: Gateway detects nonce drift >= 100 and resets to on-chain value
- **AC-1.2**: Small drift (< 100) keeps local nonce (indexer lag handling)
- **AC-1.3**: After nonce reset, subsequent transactions use correct nonce

### AC-2: Chain Reset Detection
- **AC-2.1**: Gateway detects chain height regression > 100 blocks
- **AC-2.2**: On reset detection, all pending nonces are cleared
- **AC-2.3**: Connected clients receive `chain_reset` notification

### AC-3: Session Recovery
- **AC-3.1**: Sessions automatically resync state after chain reset
- **AC-3.2**: Games can be restarted without reconnecting

### AC-4: Operational Recovery
- **AC-4.1**: Recovery script clears gateway nonces as part of reset
- **AC-4.2**: Recovery script verifies transaction inclusion before declaring success
- **AC-4.3**: Health check reports transaction inclusion rate

### AC-5: Health Signals
- **AC-5.1**: Health endpoint includes `inclusion_healthy` boolean
- **AC-5.2**: Metrics expose `gateway_tx_inclusion_rate` gauge

## 7. Implementation Map

- Nonce drift detection: `gateway/src/session/nonce.ts`
- Chain height tracking: `gateway/src/backend/index.ts` (new)
- Session invalidation: `gateway/src/session/manager.ts`
- Health signals: `gateway/src/index.ts` (healthz), `gateway/src/metrics/index.ts`
- Recovery script: `scripts/testnet-consensus-recover.sh`

## 8. Remedial Actions (Immediate)

Before implementing the full spec, these immediate fixes should be applied:

### 8.1 Clear Gateway Nonces on WIPE
Already implemented in `scripts/testnet-consensus-recover.sh`:
```bash
remote "$NS_GW_HOST" "docker exec nullspace-gateway rm -rf /app/.gateway-data/nonces.json 2>/dev/null || true"
```

### 8.2 Force Nonce Resync on Large Drift
Already implemented in `gateway/src/session/nonce.ts`:
```typescript
const CHAIN_RESET_THRESHOLD = 100n;
if (current > onChainNonce && drift >= CHAIN_RESET_THRESHOLD) {
  this.nonces.set(publicKeyHex, onChainNonce);
}
```

### 8.3 Restart Gateway After Chain Reset
Recovery script now restarts gateway after clearing nonces.

### 8.4 Verify Transaction Flow
Manual verification needed:
1. Check simulator logs for transaction ingestion
2. Check validator logs for transaction inclusion
3. Check block explorer for tx_count > 0
