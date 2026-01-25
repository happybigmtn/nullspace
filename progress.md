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

## 🚧 Work in Progress / Known Issues

### 🔴 Critical: Gateway WebSocket Ingress (Staging)
- **Issue**: The Gateway on `ns-gw-1` (`api.testnet.regenesis.dev`) is reachable via HTTPS but fails to upgrade WebSocket connections (returns 404 or 200 instead of 101 Switching Protocols).
- **Impact**: Clients cannot connect to the game server; "Connecting..." state persists.
- **Diagnosis**: Likely a misconfiguration in the Caddy reverse proxy or the Gateway's WebSocket server binding. SSH access to `ns-gw-1` timed out, delaying fix.

### ⚠️ BLS Signature Bypass
- **Issue**: The system currently runs with a bypass for BLS signature verification (`nullspace-simulator:bypass` image) due to a DKG/serialization mismatch.
- **Status**: Deferred. Removing the bypass now would crash the chain. Root cause analysis required in `commonware-cryptography`.

### ⚠️ Explorer Latency
- **Issue**: The Explorer API reports "STALE" status intermittently during heavy indexing catch-up periods due to lock contention in `ExplorerState`.
- **Mitigation**: Watchdog ensures eventual consistency, but API response times can be high.

## Next Steps
1.  **Fix Gateway Ingress**: Regain access to `ns-gw-1`, inspect Caddy logs, and fix WebSocket upgrade path.
2.  **Verify Game Loop**: Once Gateway is up, run `scripts/run-comprehensive-casino-test.sh` to confirm end-to-end bet processing.
3.  **Client-Side Polish**: Verify "Reset Connection" flow in production environment.
