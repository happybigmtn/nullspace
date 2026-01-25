# Project Progress & Status

**Date:** Sunday, January 25, 2026
**Current Focus:** Stabilization of Testnet Infrastructure (Sprint 10)

## ✅ Completed Changes

### Infrastructure & Operations
- **Validator Peering**: Fixed connectivity issues between validators on Hetzner by injecting `ALLOW_PRIVATE_IPS=1` into validator configuration, enabling successful block production.
- **Indexer/Simulator Resilience**: 
    - Implemented a "watchdog" (suicide timer) in `node/src/indexer.rs` that restarts the process if the mempool connection is lost for >60s.
    - Configured CORS on the Indexer to allow all origins (`*`), fixing Explorer API access.
- **Database**: Cleared deadlocks in Postgres (`ns-db-1`) to restore simulator indexing.

### Client Resilience (Website)
- **Nonce Management**: 
    - Updated `NonceManager` logic to detect and recover from `nonce_too_high` errors (server ahead of client).
    - Implemented a hard `reset()` method to clear all local transaction state.
- **User Interface**: 
    - Added a **"Reset Connection Data"** button to the Vault/Connection modal in `ConnectionStatus.tsx`. This provides users a self-service recovery option for stuck transaction states.

### Testing
- **Test Suite**: Created `scripts/run-comprehensive-casino-test.sh` to orchestrate stress tests across 10+ game types.
- **Verification**: Verified Validator block production and Indexer HTTP API availability (`/healthz`).

## ✅ Completed Changes

### Infrastructure & Operations
- **Consensus Recovery**: Successfully reset the testnet on Hetzner. Wiped divergent state, cleared simulator SQLite, and reset gateway nonce cache. The chain is now producing blocks normally from height 0.
- **Validator Resource Fix**: Identified and stopped an resource-intensive `trainer` process on `ns-db-1` that was causing high IO wait and blocking consensus finalization.
- **Indexer Resilience**: Confirmed indexer is actively re-indexing the new chain and writing to SQLite.

### Client & Gateway
- **Gateway Ingress Fix**: Identified that WebSocket connections to Staging must use the `/submit` path (e.g., `wss://api.testnet.regenesis.dev/submit`) to correctly pass through the Caddy reverse proxy to the Mobile Gateway.
- **Nonce Manager**: Robustness improvements for `nonce_too_high` scenarios verified.

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


