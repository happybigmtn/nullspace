# Operational Guide: Retention and Snapshot Schedules

This document describes the retention policies, snapshot schedules, and operational procedures for the CodexPoker on-chain system.

## Overview

The system persists several categories of data with different retention requirements:

| Data Category | Default Retention | Location | Purpose |
|--------------|------------------|----------|---------|
| Deal Artifacts | 7 days | `ArtifactRegistry` | Dispute resolution |
| Audit Logs | Configurable | `ProtocolAuditLog` | Debugging, compliance |
| Blocks | Permanent | `FileBlockStorage` | Chain history |
| Receipts | Permanent | `FileBlockStorage` | State verification |
| Finalizations | Permanent | `FileBlockStorage` | Consensus proof |
| State Snapshots | On-demand | `StateManager` | Fast restart |

## Artifact Retention

### Configuration

Artifact retention is configured via `ArtifactRetentionConfig`:

```rust
ArtifactRetentionConfig {
    retention_duration: Duration::from_secs(7 * 24 * 3600), // 7 days
    max_total_size: 10 * 1024 * 1024 * 1024,               // 10 GB
    max_artifact_size: 1024 * 1024,                         // 1 MB per artifact
}
```

### Retention Policy

1. **Age-Based Expiry**: Artifacts older than `retention_duration` are eligible for cleanup
2. **Size-Based Pressure**: When `max_total_size` is exceeded, oldest artifacts are evicted first
3. **Dispute Window Alignment**: Default 7-day retention aligns with the dispute resolution window

### Cleanup Schedule

The `ArtifactRegistry::cleanup()` method should be called periodically:

```rust
// Recommended: run every hour or after each finalized block
let stats = registry.cleanup(SystemTime::now())?;
log::info!(
    "Artifact cleanup: removed {} artifacts, freed {} bytes",
    stats.removed_count,
    stats.freed_bytes
);
```

### Operational Commands

```bash
# Check artifact registry status
# Returns: artifact count, total size, oldest artifact age

# Manual cleanup trigger
# Removes all expired artifacts and returns cleanup stats

# Backfill missing artifact from peers
# Uses ArtifactBackfillService to fetch by hash
```

### Monitoring

Key metrics for artifact health:

- `artifact_store_count`: Current artifact count
- `artifact_store_bytes`: Total storage used
- `artifact_backfill_latency_ms`: Time to fetch missing artifacts
- `artifact_miss_count`: Failed fetch attempts

Alert thresholds:
- `artifact_miss_count > 10/minute`: Investigate peer connectivity
- `artifact_store_bytes > 80% max_total_size`: Cleanup may be falling behind

## Block Storage

### Directory Layout

```
data/
├── blocks/
│   ├── 0000000000000000.block    # Genesis
│   ├── 0000000000000001.block
│   └── ...
├── finalizations/
│   ├── 0000000000000000.fin
│   └── ...
├── receipts/
│   ├── 0000000000000000.receipts
│   └── ...
└── chain_state.json              # Latest state checkpoint
```

### Durability

All writes use atomic write-rename pattern:
1. Write to `{filename}.tmp`
2. `fsync` to ensure data on disk
3. Atomic rename to final path

This ensures no partial writes survive crashes.

### Recovery

On startup, `FileBlockStorage::recover()`:
1. Loads `chain_state.json` if present
2. Validates against highest stored block
3. If mismatch, rebuilds state from blocks

```rust
let storage = FileBlockStorage::open("data/")?;
let chain_state = storage.recover()?;
match chain_state {
    Some(state) => log::info!("Recovered at height {}", state.height),
    None => log::info!("Fresh start, no blocks found"),
}
```

### Snapshot Schedule

State snapshots via `chain_state.json` are written after each finalized block:

```rust
storage.persist_finalized(&block, &finalization, &receipts, &chain_state)?;
// chain_state.json is updated atomically
```

For additional safety, operators may configure periodic full-state snapshots:

| Snapshot Type | Frequency | Purpose |
|--------------|-----------|---------|
| Incremental | Every block | Fast restart |
| Full state | Daily | Disaster recovery |
| Archive | Weekly | Long-term storage |

## Audit Log Retention

### Log Categories

The `ProtocolAuditLog` captures structured events:

- `commitment_received`: Deal commitment logged
- `reveal_received`: Reveal share processed
- `timelock_used`: Fallback reveal triggered
- `artifact_stored`: New artifact persisted
- `artifact_backfilled`: Missing artifact recovered

### Retention Configuration

Audit logs follow the application's logging configuration. For production:

```toml
[logging]
level = "info"
format = "json"
file = "logs/audit.log"
rotation = "daily"
retention_days = 30
```

### Compliance Considerations

For regulated environments, ensure:
- Audit logs are written to append-only storage
- Log rotation preserves complete records
- Retention meets regulatory requirements (typically 5-7 years for financial data)

## State Synchronization

### State Sync Protocol

Nodes can sync state without replaying all blocks using `StateSyncRequest`/`StateSyncResponse`:

1. Request state at target root/height
2. Receive state chunks with proofs
3. Verify proofs against claimed root
4. Apply state to local storage

### Sync Limits

```rust
MAX_SYNC_CHUNK_SIZE = 1 MB      // Per-response size limit
MAX_SYNC_KEYS_PER_REQUEST = 1000 // Keys per request
```

### Monitoring State Sync

- `state_sync_requests`: Incoming sync requests
- `state_sync_latency_ms`: Time to serve sync response
- `state_root_mismatches`: Verification failures (alert on any)

## Operational Procedures

### Startup Checklist

1. Verify `data/` directory permissions
2. Check disk space (recommend 2x expected storage)
3. Start with `--verify-state` for first boot after upgrade
4. Monitor `artifact_backfill_latency_ms` for missing data

### Graceful Shutdown

1. Stop accepting new payloads
2. Wait for pending finalizations
3. Flush audit logs
4. Verify `chain_state.json` matches latest block

### Disaster Recovery

1. Stop all nodes
2. Restore from latest archive snapshot
3. Verify state root matches expected value
4. Start nodes with `--recover` flag
5. Monitor state sync completion

### Storage Maintenance

Weekly tasks:
- Verify block file integrity (checksums)
- Check artifact cleanup is running
- Review audit log rotation
- Monitor disk usage trends

Monthly tasks:
- Archive old blocks to cold storage (if configured)
- Validate backup restore procedures
- Review retention policy alignment with business needs

## Metrics Reference

The metrics system uses `MetricEvent` variants recorded via `MetricsCollector::record()`.

### Backfill Metrics

| Event Type | Fields | Description |
|------------|--------|-------------|
| `backfill_latency` | `latency_ms`, `artifacts_requested`, `artifacts_received`, `hash_mismatches` | Completed backfill operation |
| `backfill_request_sent` | `artifact_count`, `commitment_hash` | Outgoing backfill request |
| `backfill_response_received` | `artifact_count`, `missing_count`, `round_trip_ms` | Incoming backfill response |

Summary metrics (via `MetricsSummary`):
- `backfill_total`: Total backfill operations
- `backfill_success`: Fully successful operations
- `backfill_partial`: Partial success (some missing/corrupted)
- `backfill_latency_p50_ms`, `p95`, `p99`, `max`: Latency percentiles

### Artifact Miss Metrics

| Event Type | Fields | Description |
|------------|--------|-------------|
| `artifact_miss` | `artifact_hash`, `commitment_hash`, `context` | Single artifact not found |
| `artifact_miss_batch` | `requested_count`, `missing_count`, `context` | Batch with missing artifacts |

Summary metrics:
- `artifact_misses_total`: Individual miss count
- `artifact_miss_batches_total`: Batch miss events
- `artifact_missing_in_batches`: Total artifacts missing in batches

### State Root Metrics

| Event Type | Fields | Description |
|------------|--------|-------------|
| `state_root_mismatch` | `expected`, `actual`, `height`, `context` | State root verification failed |
| `state_root_verified` | `height`, `verification_ms` | State root verification succeeded |
| `hash_mismatch` | `claimed`, `computed`, `context` | General hash mismatch |

Summary metrics:
- `state_root_mismatches_total`: Mismatch count (alert on any > 0)
- `state_root_verifications_total`: Successful verifications
- `state_root_verification_avg_ms`: Average verification time
- `hash_mismatches_total`: All hash mismatches
- `errors_total`: All error events

## Alerting Recommendations

### Critical Alerts

- `state_root_mismatches > 0`: Potential consensus divergence
- `artifact_backfill_failures > 5/hour`: Data availability issue
- `disk_usage > 90%`: Imminent storage exhaustion

### Warning Alerts

- `artifact_miss_count > 10/minute`: Elevated backfill traffic
- `artifact_cleanup_behind`: Retention falling behind schedule
- `state_sync_latency_ms_p99 > 10s`: Slow state serving

## Configuration Reference

### Environment Variables

```bash
# Storage paths
CODEXPOKER_DATA_DIR=/var/lib/codexpoker/data

# Artifact retention
ARTIFACT_RETENTION_DAYS=7
ARTIFACT_MAX_SIZE_GB=10

# Logging
LOG_LEVEL=info
AUDIT_LOG_PATH=/var/log/codexpoker/audit.log
```

### Config File (codexpoker.toml)

```toml
[storage]
data_dir = "/var/lib/codexpoker/data"
verify_on_startup = true

[artifacts]
retention_days = 7
max_total_size_gb = 10
max_artifact_size_mb = 1

[audit]
enabled = true
log_path = "/var/log/codexpoker/audit.log"
rotation = "daily"
retention_days = 30

[metrics]
enabled = true
endpoint = "0.0.0.0:9090"
```
