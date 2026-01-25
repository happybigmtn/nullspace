# Implementation Plan

**Phase**: Stabilization & Infrastructure
**Date**: 2026-01-24
**Scope**: Fix critical testnet issues and finalize production readiness.

## Sprint 09 - Production Readiness (Remaining)
- [ ] Add staging pipeline smoke tests and regression gates
  - Specs: `specs/sprint-09-production-readiness.md` AC-9.5
  - Tests/backpressure:
    - Programmatic: `scripts/agent-review.sh`
    - Perceptual: None

## Sprint 10 - Infrastructure Reliability & Network Stability
- [x] Fix Validator Peer Connectivity (ALLOW_PRIVATE_IPS)
  - **Context**: Validators on `ns-db-1` sharing a host need `ALLOW_PRIVATE_IPS=1` to peer via loopback addresses defined in `peers.yaml`.
  - **Action**: Created `scripts/ops/fix_validator_peers.sh` to inject the env var and restart validators. Verified via `docker inspect`.
  - **Verification**: Validators are proposing blocks (logs show `proposed block`).
- [x] Implement Mempool Connection Health Check
  - **Context**: Block production stalls if the validator loses connection to the simulator mempool.
  - **Action**: Modified `node/src/indexer.rs` to include a 60s suicide timer if disconnected.
  - **Verification**: Verified via code review; logic ensures process exit on prolonged disconnect.
- [ ] Fix BLS Signature Verification (Remove Bypass)
  - **Context**: `nullspace-simulator:bypass` image is currently used to bypass signature verification due to a polynomial identity mismatch.
  - **Action**: Investigate and fix the underlying BLS polynomial generation/verification compatibility between nodes and simulator.
  - **Verification**: Run with standard image and verify signatures pass.
- [x] Resolve CORS Issues for Indexer/Explorer
  - **Context**: Direct browser connections to indexer fail due to CORS.
  - **Action**: Created `scripts/ops/fix_indexer_cors.sh` to inject `ALLOWED_HTTP_ORIGINS=*`.
  - **Verification**: Verified `curl -v` to indexer returns `200 OK` (when not locked).
- [x] Client-Side Nonce Recovery Improvements
  - **Context**: Users get `nonce_too_low`/`nonce_too_high` errors.
  - **Action**: Enhanced `NonceManager` to auto-recover from `nonce_too_high`. Added **"Reset Connection Data"** button to UI for manual recovery.
  - **Verification**: Verified logic in local tests; manual reset available in staging.
- [x] Fix Gateway Ingress (WebSocket Path)
  - **Context**: Caddy ingress on Staging was blocking WebSocket upgrades at the root path (404/200 OK).
  - **Action**: Identified `wss://api.testnet.regenesis.dev/submit` as the correct path. Validated with local scripts.
  - **Verification**: `run-comprehensive-casino-test.sh` connects successfully to `/submit`.
- [x] Consensus Recovery (Staging)
  - **Context**: Chain stalled at height 603k due to IO starvation on `ns-db-1`.
  - **Action**: Performed full reset (validators, simulator DB, gateway cache). Stopped resource-hogging `trainer` process.
  - **Verification**: Chain producing blocks from height 0; indexer catching up.

## Missing/Unknown
- **Indexer Lock Contention**: The indexer API hangs during heavy catch-up because `apply_block_indexing` holds a write lock, starving read requests. This causes "STALE" health checks and "DOWN" API status during recovery. Long-term fix requires optimizing the locking strategy or using a read-replica DB.
