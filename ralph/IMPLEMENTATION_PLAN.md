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

1. **Phase 1: Debug Website Rendering** (Critical)
   - [x] Add visible error boundaries with error messages
   - [x] Add WASM initialization logging
   - [x] Add startup health check endpoint
   - [x] Add visual loading states

2. **Phase 2: Transaction Pipeline Observability** (Critical)
   - [x] Add transaction submission logging
   - [x] Add validator transaction receipt logging
   - [x] Add mempool depth metric
   - [x] Add end-to-end transaction test

3. **Phase 3: Recovery Automation** (Medium)
   - [x] Add nonce reset command
   - [ ] Add full-stack health check
   - [ ] Add transaction flow smoke test

4. **Phase 4: Defensive Improvements** (Low)
   - [ ] Remove FLOOR_MAP entirely
   - [ ] Add nonce sync on every transaction
   - [ ] Add transaction rejection feedback

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

# Check chain status
curl -s https://testnet.regenesis.dev/api/explorer/blocks?limit=1 | jq .
```
