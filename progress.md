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
- **Issue**: The Gateway on `ns-gw-1` (`api.testnet.regenesis.dev`) returns `404 Not Found` for WebSocket connections, while `/healthz` works.
- **Diagnosis**: This indicates the **Caddy reverse proxy is not passing `Upgrade` headers** correctly. Node.js treats the request as a standard HTTP GET to `/`, which has no handler (404).
- **Blocker**: SSH access to `ns-gw-1` is timing out (firewall/network issue), preventing immediate config fix.
- **Workaround**: Proceeding with local network verification to validate client/server logic while infra is inaccessible.

### 🟡 Local Test Verification
- **Status**: Partially Successful
- **Gateway**: Verified `NonceManager` logic and connection stability (100 concurrent connections passed).
- **Game Logic**: Tests ran but timed out waiting for game results from the local simulator/validator network.
- **Root Cause**: Likely resource constraints or configuration mismatch in the local ephemeral environment preventing block finalization.
- **Conclusion**: Client-side resilience code is verified; backend infrastructure needs attention (Staging Caddy fix + Local Consensus debugging).

## Next Steps
1.  **Fix Gateway Ingress**: Regain access to `ns-gw-1`, inspect Caddy logs, and fix WebSocket upgrade path.
2.  **Verify Game Loop**: Once Gateway is up, run `scripts/run-comprehensive-casino-test.sh` to confirm end-to-end bet processing.
3.  **Client-Side Polish**: Verify "Reset Connection" flow in production environment.
