# Testnet Transaction Pipeline Fix

**Status**: ✅ Complete
**Date**: 2026-01-17
**Completed**: 2026-01-17
**Scope**: End-to-end transaction flow from browser to block inclusion

## 1. Problem Statement

### 1.1 Observed Symptoms

After multiple chain resets and infrastructure changes, the testnet exhibits:

1. **"WAITING FOR CHAIN" indefinitely**: Casino games show pending state forever
2. **tx_count=0 in all blocks**: Chain produces blocks but no transactions are included
3. **Website not rendering**: React app fails to mount (blank page with empty `#root`)
4. **Silent transaction rejection**: Validators drop transactions without feedback to users

### 1.2 Current Chain State (as of 2026-01-17 17:30 UTC)

```
Height: 15532
tx_count: 0 (all blocks)
Blocks producing: Yes (consensus working)
Explorer: Working (showing blocks)
API: Responding (seed, state endpoints working)
Website: Not rendering (WASM loads but React doesn't mount)
```

## 2. Investigation Timeline

### 2.1 BufferedMempool Implementation (Completed)

**Problem**: `tokio::sync::broadcast` loses transactions sent before subscribers connect.

**Solution Implemented**:
- Created `simulator/src/mempool.rs` with replay buffer
- 30-second replay window for late subscribers
- Sequence-based ordering for guaranteed delivery
- All unit tests passing

**Files Changed**:
- `simulator/src/mempool.rs` (new)
- `simulator/src/lib.rs` (integration)
- `simulator/src/state.rs` (updated to use BufferedMempool)
- `simulator/src/api/ws.rs` (updated mempool WebSocket handler)

**Status**: ✅ Merged and deployed

### 2.2 Nonce Floor Bug (Fixed)

**Problem**: `FLOOR_MAP` in `nonceManager.js` contains hardcoded nonce floors:
```javascript
const FLOOR_MAP = {
  '6aba3e7532fc030a7cd3be155b5a73d04efea737ad9a95f4226bc3781bae5b9f': 1720,
  'f4e4eb95ed3c2ec516faf73d61160e8f600389e1d983f18973a561f788177d24': 8
};
```

After chain reset, server nonce is 2 but floor overrides it to 8, causing validators to reject transactions with "nonce below next".

**Solution Implemented**:
```javascript
// Only apply floor if floor <= serverNonce
if (typeof floor === 'number' && floor > this.getCurrentNonce() && floor <= serverNonce) {
  this.setNonce(floor);
}
```

**Files Changed**:
- `website/src/api/nonceManager.js`

**Status**: ✅ Merged and deployed (commit c132e2c)

### 2.3 Consensus Recovery Attempts

Multiple `CONFIRM_RESET=1 ./scripts/testnet-consensus-recover.sh` runs:
- Wiped validator state
- Restarted simulator
- Cleared gateway nonce cache
- Restarted gateway and website containers

**Result**: Chain recovers but transactions still not included.

### 2.4 Browser Testing Attempts

**Tools Used**:
- agent-browser (primary)
- Playwright MCP (deprecated per user request)

**Findings**:
- All network requests succeed (200 status)
- WASM loads successfully
- CSS and JS bundles load
- React root exists but has 0 children
- No JavaScript errors in console
- Page shows blank gray/white background

## 3. Root Causes Identified

### 3.1 Nonce Synchronization (FIXED)

The `FLOOR_MAP` workaround for indexer lag caused nonce drift after chain resets.

### 3.2 Website Rendering Issue (UNRESOLVED)

React app fails to mount despite all resources loading:
```javascript
{
  rootExists: true,
  rootChildren: 0,
  rootHTML: "",
  reactRoot: false
}
```

**Possible causes**:
1. WASM initialization failing silently
2. WebSocket connection issue blocking app startup
3. Error boundary catching and hiding errors
4. Race condition in app initialization

### 3.3 Transaction Inclusion (UNRESOLVED)

Even with BufferedMempool deployed, `tx_count=0` in all blocks suggests:
1. No transactions reaching validators
2. Transactions reaching validators but being dropped
3. Validators not proposing transactions in blocks

## 4. What We Tried

| Attempt | Result |
|---------|--------|
| Implement BufferedMempool | ✅ Deployed, tests passing |
| Fix nonce floor override bug | ✅ Deployed |
| Consensus recovery (wipe validators) | Chain recovers but no tx flow |
| Clear gateway nonce cache | No improvement |
| Clear browser localStorage | No improvement |
| Restart all containers | No improvement |
| Browser testing (agent-browser) | Blank page, WASM loads |
| Browser testing (Playwright) | Same - blank page |
| Check console errors | No errors found |
| Check network requests | All succeed |

## 5. Issues Resolved

### 5.1 Website Not Rendering ✅

**Resolution**: Fixed via Phase 1 implementation:
- Added visible error boundaries (AC-1.1)
- Added WASM initialization logging (AC-1.2)
- Added startup health check endpoint (AC-1.3)
- Added visual loading states (AC-1.4)

### 5.2 Zero Transaction Blocks ✅

**Resolution**: Fixed via Phase 5 - WebSocket origin validation was blocking validators from connecting to the mempool WebSocket. Changed default behavior to allow non-browser clients (no Origin header) by default.

**Root Cause**: The `validate_origin()` function in `ws.rs` required `ALLOW_WS_NO_ORIGIN=1` to be set for non-browser clients (validators) to connect. Without this env var, validators were silently rejected.

## 6. Comprehensive Solution Plan

### Phase 1: Debug Website Rendering

**AC-1.1**: Add visible error boundaries with error messages
```typescript
// ErrorBoundary should render error details, not blank screen
componentDidCatch(error, info) {
  console.error('App crash:', error);
  this.setState({ hasError: true, error });
}
```

**AC-1.2**: Add WASM initialization logging
```javascript
// Log each step of WASM init
console.log('[WASM] Loading module...');
await init();
console.log('[WASM] Module loaded');
```

**AC-1.3**: Add startup health check endpoint
- `/api/health/startup` returns initialization status
- Includes: WASM loaded, WebSocket connected, seed received

**AC-1.4**: Add visual loading states
- Show "Loading WASM..." during initialization
- Show "Connecting to chain..." during WebSocket setup
- Show explicit error messages on failure

### Phase 2: Transaction Pipeline Observability

**AC-2.1**: Add transaction submission logging
```javascript
console.log('[TX] Submitting with nonce:', nonce);
// ... submit
console.log('[TX] Submit response:', response);
```

**AC-2.2**: Add validator transaction receipt logging
- Log when transaction arrives at validator
- Log nonce validation result
- Log inclusion/rejection reason

**AC-2.3**: Add mempool depth metric
- Expose `mempool_pending_count` gauge
- Alert if pending > 0 but tx_count = 0

**AC-2.4**: Add end-to-end transaction test
```bash
# scripts/test-transaction-flow.sh
# 1. Submit test transaction via API
# 2. Wait for block inclusion
# 3. Verify in explorer
# 4. Report success/failure with timing
```

### Phase 3: Recovery Automation

**AC-3.1**: Add nonce reset command
```bash
# Clear browser nonce state for fresh start
scripts/clear-browser-nonce.sh
```

**AC-3.2**: Add full-stack health check
```bash
# scripts/health-check-full.sh
# Check: validators, simulator, gateway, website, explorer
# Check: WebSocket connections, mempool subscribers
# Check: Recent tx_count > 0
```

**AC-3.3**: Add transaction flow smoke test
```bash
# scripts/smoke-test-transactions.sh
# Submit transaction, wait for inclusion, verify
```

### Phase 4: Defensive Improvements

**AC-4.1**: Remove FLOOR_MAP entirely
- Floors were workaround for indexer lag
- With proper nonce sync, floors are unnecessary
- Simplifies code and prevents future issues

**AC-4.2**: Add nonce sync on every transaction
```javascript
// Before submitting, always verify nonce from chain
const serverNonce = await fetchAccountNonce();
if (localNonce !== serverNonce) {
  this.setNonce(serverNonce);
}
```

**AC-4.3**: Add transaction rejection feedback
- Simulator should return rejection reason
- Gateway should surface rejection to browser
- Browser should show user-friendly error

## 7. Implementation Order

1. **Phase 1 (Critical)**: Debug website rendering
   - Users can't use the app at all
   - Need visible errors to diagnose

2. **Phase 2 (High)**: Transaction pipeline observability
   - Need visibility into where transactions are lost
   - Enables debugging without code diving

3. **Phase 3 (Medium)**: Recovery automation
   - Faster recovery from failures
   - Reduce manual intervention

4. **Phase 4 (Low)**: Defensive improvements
   - Prevent recurrence
   - Simplify architecture

## 8. Testing Requirements (All Implemented)

### 8.1 Website Rendering Tests
- [x] Page loads within 5 seconds
- [x] WASM initializes successfully
- [x] WebSocket connects
- [x] Game interface renders
- [x] Error states shown on failure

### 8.2 Transaction Flow Tests
- [x] Submit transaction from browser (`scripts/test-transaction-flow.sh`)
- [x] Transaction appears in mempool
- [x] Transaction included in block within 3 blocks
- [x] Explorer shows transaction
- [x] Balance updates correctly

### 8.3 Recovery Tests
- [x] After chain reset, first transaction succeeds
- [x] After container restart, transactions resume
- [x] After browser refresh, nonce syncs correctly (`scripts/clear-browser-nonce.sh`)

## 9. Notes

### 9.1 Tool Preferences
- Use `agent-browser` for all browser automation
- Do NOT use Playwright MCP tools

### 9.2 Related Specs
- `gateway-chain-sync-robustness.md` - BufferedMempool details
- `consensus-liveness-and-recovery-hardening.md` - Consensus recovery
