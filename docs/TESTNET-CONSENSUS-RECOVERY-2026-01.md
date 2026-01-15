# Testnet Consensus Recovery (Jan 2026)

This document summarizes how we restored the testnet chain after multi‑day instability and outlines operational learnings so the issue doesn’t recur.

## Executive Summary
- The chain was stalled for days: no new blocks, no finalized transactions, and the site showed **“waiting for chain”**.
- Root symptoms indicated consensus progression had stopped (no aggregation certificates advancing) and the indexer was stuck.
- The fix was a **full validator data reset + coordinated service restarts** on staging, followed by re‑enabling the consensus watchdog.
- The chain resumed finalizing blocks immediately after reset, but remains **somewhat unstable** due to intermittent missed updates; additional resiliency is required.

## Symptoms Observed
- Website: “waiting for chain”; gameplay stalled; sessions not updating.
- Mempool showed pending txs but blocks had **tx_count=0**.
- Indexer explorer height was stale.
- Validators showed **aggregation certificates not advancing** and **summary uploads stuck at 0**.

## Likely Root Cause (Most Plausible)
- Consensus stalled due to **corrupted or inconsistent validator state** after prolonged failures. The aggregation layer could no longer advance.
- Secondary contributing issues:
  - Stale processes / port contention prevented nodes from binding at restart.
  - WS event delivery sometimes dropped, leaving UI in a pending state even after on‑chain state advanced.

## Recovery Actions (What Fixed It)
> All actions were in staging (testnet.regenesis.dev).

### 1) Reset validator state on `ns-db-1`
- Stop validators (docker/systemd depending on deployment).
- Wipe on‑disk chain data:
  - `/var/lib/nullspace/node-0`
  - `/var/lib/nullspace/node-1`
  - `/var/lib/nullspace/node-2`
  - `/var/lib/nullspace/node-3`
- Recreate directories and restore ownership to the `nullspace` user.

### 2) Restart services in order
- Validators on `ns-db-1`.
- Simulator on `ns-sim-1`.
- Gateway on `ns-gw-1`.

### 3) Re‑enable consensus watchdog
- `systemctl enable --now nullspace-consensus-watchdog.timer`

### 4) Verify recovery
- Aggregation certificates incrementing (`aggregation_tip` advancing).
- Indexer explorer height increasing.
- Blocks finalizing and transactions confirming.

## Verification Signals (Post‑Recovery)
- **Aggregation certificates advanced** steadily.
- **Finalized height increased** on validators.
- **Explorer latest height** advanced beyond old stall height.

## Remaining Instability
- Gameplay sometimes stalls mid‑round (e.g., Casino War “choose your move”).
- This correlates with **missed WebSocket events** and pending client state not clearing.
- We added a **move‑level chain response timeout** to recover from dropped events (front‑end resiliency).

## Operational Learnings

### A) Runbook Additions
- If **aggregation certs stall**, do a full validator data reset instead of piecemeal restarts.
- Always check for stale processes and port conflicts before restart.
- Confirm `node connected to mempool stream` after restart (required for tx inclusion).

### B) Monitoring & Alerts
- Alert if:
  - `aggregation_tip` stops advancing for >2m
  - `finalized_height` flatlines
  - `summary_uploads` remains 0 for >5m
- Expose a health endpoint for **consensus liveness** (not just process health).

### C) Deployment/Process Hygiene
- Use a clean **stop → wipe → start** flow for consensus recovery.
- Keep a single authoritative restart script with idempotent checks (ports free, services healthy).
- Ensure watchdog stays enabled after any manual interventions.

### D) Client Resiliency
- Add **move‑level watchdogs** so missing WS events don’t stall gameplay.
- Poll `getCasinoSession` on timeout to restore UI state.
- Log sessionId + moveNumber for all pending moves to diagnose gaps.

## Recommended Follow‑Ups
- Add a **consensus health check** to `scripts/health-check.sh` that fails if aggregation certs are stale.
- Add on‑call alerting for stalled aggregation tip.
- Bake a scripted recovery path into `scripts/agent-up.sh` or a dedicated `scripts/recover-consensus.sh`.
- Investigate why **seeder uploads are always 0** and whether it impacts stability.

## Checklist (Next Time It Happens)
1. Confirm symptoms: `aggregation_tip` stalled + explorer height frozen.
2. Stop validators, wipe `/var/lib/nullspace/node-*`.
3. Restart validators → simulator → gateway.
4. Ensure watchdog enabled.
5. Verify liveness metrics and explorer height.
6. If UI stalls, verify WS events and timeout recovery.

## Notes
- This recovery resets the chain state (fresh history). Use only for staging/testnet.
- Production recovery should prefer state repair before full wipe.
