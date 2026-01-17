# Implementation Plan

**Phase**: Active
**Date**: 2026-01-17
**Scope**: Fix testnet transaction pipeline - website rendering and transaction flow.

## Source of Truth

- `ralph/specs/testnet-transaction-pipeline-fix.md` - End-to-end transaction flow debugging

Completed work archived to `ralph/specs/archive/IMPLEMENTATION_PLAN_ARCHIVE.md`.
All other specs archived to `ralph/specs/archive/`.

## Current Blocking Issues

### Website Not Rendering (Critical)

**Symptoms**:
- Blank page with gray background
- React `#root` element exists but empty (0 children)
- No console errors visible
- All resources load successfully (WASM, JS, CSS)

**Solution**: See spec Phase 1 (AC-1.1 through AC-1.4)

### Zero Transaction Blocks

**Symptoms**:
- Chain producing blocks (height 15532+)
- tx_count=0 in every block
- Cannot test until website rendering is fixed

**Solution**: See spec Phase 2 (AC-2.1 through AC-2.4)

## Implementation Order

Phases 1-4 completed - see `specs/archive/IMPLEMENTATION_PLAN_ARCHIVE.md`

### Phase 5: WebSocket Origin Validation Fix (Critical)

- [x] Fix WebSocket origin validation blocking validators
  - Tests: Validators can connect to `/mempool` WebSocket, transactions included in blocks
  - Files Changed: `simulator/src/api/ws.rs`

**Root Cause**: The `validate_origin()` function in `ws.rs` required `ALLOW_WS_NO_ORIGIN=1` to be set for non-browser clients (validators) to connect. Without this env var, validators were silently rejected from the mempool WebSocket, causing tx_count=0 in all blocks.

**Fix**: Changed default behavior to allow non-browser clients (no Origin header) by default. The restrictive behavior is now opt-in via `ALLOW_WS_NO_ORIGIN=0`.

**Validation Required**: After deployment, verify:
1. Mempool subscriber count > 0 (validators connected)
2. tx_count > 0 in blocks after user interaction

## Quick Commands

```bash
# Standard consensus recovery
CONFIRM_RESET=1 ./scripts/testnet-consensus-recover.sh

# Health check
./scripts/health-check.sh

# End-to-end transaction flow test (AC-2.4)
./scripts/test-transaction-flow.sh

# Nonce reset (AC-3.1) - shows browser console commands
./scripts/clear-browser-nonce.sh

# Transaction flow smoke test (AC-3.3) - quick pass/fail for CI/CD
./scripts/smoke-test-transactions.sh

# Check chain status
curl -s https://testnet.regenesis.dev/api/explorer/blocks?limit=1 | jq .
```
