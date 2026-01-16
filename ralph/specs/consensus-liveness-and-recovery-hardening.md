# Consensus Liveness and Recovery Hardening

**Status**: draft  
**Date**: 2026-01-16  
**Scope**: Liveness detection, recovery automation, and operational safeguards for validator, simulator, and gateway consensus flows.

This spec defines a hardened liveness and recovery layer for the consensus stack. It is motivated by recent stalls where aggregation certificates stopped advancing, blocks finalized with `tx_count=0`, and the indexer fell behind, requiring manual resets.

## 1. Goals

1. **Detect stalls early**: Expose objective liveness signals for aggregation tips and finalized heights.
2. **Automate recovery**: Provide an idempotent recovery script that resets or restarts services in a safe order.
3. **Reduce manual intervention**: Make the default recovery path deterministic and scriptable.
4. **Prevent silent failures**: Fail health checks when consensus is stalled even if processes are up.
5. **Operational clarity**: Emit logs and metrics that pinpoint the stall stage (mempool, aggregation, summary upload, indexer).

## 2. Non-Goals

- Changing the underlying consensus algorithm.
- Adding new consensus features (reconfiguration, sharding, etc.).
- Production-grade disaster recovery (staging/testnet focus for now).

## 3. Architecture

### 3.1 Liveness Signals

Expose the following metrics in nodes and simulator:
- `aggregation_tip` (height or index)
- `finalized_height`
- `summary_uploads_outstanding`
- `mempool_connected` (boolean)
- `mempool_pending_total`

### 3.2 Health Check Contract

Extend `scripts/health-check.sh` to fail if:
- `aggregation_tip` or `finalized_height` are stale for >2 minutes.
- `mempool_connected` is false for >30 seconds.
- `summary_uploads_outstanding` stays at 0 while finalized height advances.

### 3.3 Recovery Automation

Add `scripts/recover-consensus.sh` (idempotent) that:
1. Verifies ports are free and no stale processes remain.
2. Stops validators, simulator, and gateway in order.
3. Optionally wipes validator data in staging/testnet mode.
4. Restarts validators → simulator → gateway.
5. Verifies liveness metrics and exits non-zero if recovery fails.

### 3.4 Watchdog

Ensure consensus watchdog is enabled after recovery:
- `systemctl enable --now nullspace-consensus-watchdog.timer`

## 4. Testing Requirements

### 4.1 Integration Tests
- Simulate stalled aggregation; health check fails within 2 minutes.
- Recovery script brings system back to healthy liveness state.
- Recovery script is idempotent (run twice without error).

### 4.2 Observability Tests
- Liveness metrics appear in Prometheus scrape.
- Health check prints actionable error messages.

## 5. Acceptance Criteria

### AC-1: Liveness Detection
- **AC-1.1**: Health check fails if `aggregation_tip` is stale >2 minutes.
- **AC-1.2**: Health check fails if `finalized_height` is stale >2 minutes.
- **AC-1.3**: Health check fails if `mempool_connected` is false >30 seconds.

### AC-2: Recovery Automation
- **AC-2.1**: `scripts/recover-consensus.sh` restores liveness on a stalled staging node.
- **AC-2.2**: Script exits non-zero if liveness does not recover within a bounded timeout.
- **AC-2.3**: Script can be safely rerun without manual cleanup.

### AC-3: Operational Signals
- **AC-3.1**: Logs identify which stage stalled (mempool, aggregation, summary uploads, indexer).
- **AC-3.2**: Prometheus metrics expose the same liveness indicators.

### AC-4: Consensus Watchdog
- **AC-4.1**: Watchdog is enabled and active after recovery.

## 6. Implementation Map

- Health check: `scripts/health-check.sh`
- Recovery script: `scripts/recover-consensus.sh`
- Liveness metrics: `node/src/system_metrics.rs`, `node/src/engine.rs`, `simulator/src/metrics.rs`
- Mempool connectivity: `node/src/application/ingress.rs`, `simulator/src/api/ws.rs`
