# Project Progress & Status

**Date:** Sunday, January 25, 2026
**Current Focus:** Stabilization of Testnet Infrastructure (Sprint 10)

## ✅ Completed Changes

### Infrastructure & Operations
- **Consensus Recovery**: Successfully reset the testnet on Hetzner. Wiped divergent state, cleared simulator SQLite, and reset gateway nonce cache. The chain is now producing blocks normally from height 0.
- **Validator Resource Fix**: Identified and stopped a resource-intensive `trainer` process on `ns-db-1` that was causing high IO wait and blocking consensus finalization.
- **Validator Peering**: Fixed connectivity issues between validators on Hetzner by injecting `ALLOW_PRIVATE_IPS=1` into validator configuration.
- **Indexer Resilience**: 
    - Implemented a "watchdog" (suicide timer) in `node/src/indexer.rs` to restart the process if the mempool connection is lost.
    - Configured CORS on the Indexer to allow all origins (`*`).
    - Confirmed indexer is actively re-indexing the new chain.

### Client & Gateway
- **Gateway Ingress Fix**: Identified that WebSocket connections to Staging must use the `/submit` path (e.g., `wss://api.testnet.regenesis.dev/submit`).
- **Nonce Management**: Updated `NonceManager` to handle `nonce_too_high` errors and added a `reset()` method.
- **User Interface**: Added a **"Reset Connection Data"** button to the Vault/Connection modal for user self-recovery.

### Testing
- **Test Suite**: Created `scripts/run-comprehensive-casino-test.sh`.
- **Verification**: Verified Validator block production, Indexer HTTP API, and WebSocket connectivity (on `/submit`).

## 🚀 Deployment Status

### testnet.regenesis.dev (Staging)
- **Website**: 🟡 **PENDING DEPLOY** (Currently `177f8ed`, waiting for CI to build `6fa0450`).
- **Gateway**: 🟡 **PENDING DEPLOY** (Running `local` tag).
- **Simulator**: 🟡 **PENDING DEPLOY** (Running `bypass` image, waiting for CI to build `6fa0450`).
- **Validators**: ✅ **UPDATED** (Running `sha-569e67e`).

## 🚧 Work in Progress / Known Issues

### 🟡 Indexer Catch-up (Staging)
- **Issue**: The indexer is currently catching up on the reset chain (view ~33k while validators are at ~76k).
- **Impact**: Stress tests and game results may timeout until the indexer reaches the chain tip.
- **Status**: Monitoring progress.

### ⚠️ BLS Signature Bypass
- **Issue**: Still running with BLS signature bypass due to serialization mismatch.
- **Status**: Deferred to Sprint 11.

## Next Steps
1.  **Verify Game Loop**: Once Indexer reaches tip, run `scripts/run-comprehensive-casino-test.sh` using the `/submit` WebSocket path.
2.  **Restore robopoker**: Gradually restart other services on `ns-db-1` with proper resource limits.