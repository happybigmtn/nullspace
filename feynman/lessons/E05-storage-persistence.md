# E05 - Storage, proofs, and persistence (from scratch)

Focus file: `docs/persistence.md`

Goal: explain which services own data, how explorer persistence works, and how backups are expected to be done. For every excerpt, you will see **why it matters** and a **plain description of what the text means**.

---

## Concepts from scratch (expanded)

### 1) Data ownership
Different services own different data stores. Knowing who writes what prevents accidental corruption.

### 2) Explorer persistence
The simulator/indexer can optionally persist explorer data to SQLite or Postgres. This is separate from the chain state.

### 3) Backups and recovery
Backups focus on Postgres, Convex, and chain state. Recovery drills are explicitly required.

---

## Limits & management callouts (important)

1) **Retention limits are configurable**
- Explorer retention uses flags like `--explorer-max-blocks`.
- If set too low, historical data disappears.

2) **RPO/RTO targets are defined**
- RPO 15 minutes, RTO 4 hours are initial targets.
- These are aggressive and should be validated with drills.

---

## Walkthrough with key excerpts

### 1) Data ownership table
```rust
| Service | Writes | Reads | Notes |
| --- | --- | --- | --- |
| Validators | Chain state, blocks | Chain state | Consensus source of truth. |
| Simulator/indexer | Explorer persistence (optional Postgres/SQLite) | Chain state + explorer | Read-heavy HTTP/WS API. |
| Auth service | Convex (users, entitlements, Stripe events) | Convex | Uses service token + admin key for on-chain sync. |
| Website | None | Simulator + Auth + Convex | Read-only; no direct writes to chain. |
```

Why this matters:
- This table defines who is allowed to mutate which storage systems.

What this means:
- Validators own the chain state.
- The auth service is the only writer to Convex.
- The website is read-only.

---

### 2) Explorer persistence options
```rust
- In-memory (default): no persistence, fastest, not suitable for multi-node.
- SQLite: `--explorer-persistence-path ./explorer.db` for single-node or dev.
- Postgres (shared): `--explorer-persistence-url postgres://...` for multi-node.

Retention controls:
- `--explorer-max-blocks` (0 disables limit)
- `--explorer-max-account-entries`
- `--explorer-max-accounts`
- `--explorer-max-game-event-accounts`
```

Why this matters:
- Persistence determines whether explorer history survives restarts and scales beyond one node.

What this means:
- Use Postgres for staging/testnet.
- Configure retention so storage growth is bounded.

---

### 3) Backup and recovery targets
```rust
Targets (initial): RPO 15 minutes, RTO 4 hours.

- Postgres:
  - Daily base backup + WAL archiving (object storage).
  - Retain 7-14 days of WAL for point-in-time recovery.
  - Quarterly restore drill to a staging database.
- Convex backend:
  - Snapshot the data volume + metadata volume.
  - Store snapshots in object storage with 14-30 day retention.
  - Quarterly restore drill to a staging Convex deployment.
- Chain state:
  - Snapshot validator data directories prior to upgrades.
```

Why this matters:
- Backups are the only defense against data loss and corruption.

What this means:
- Both Postgres and Convex have explicit backup procedures.
- Restore drills are required, not optional.

---

## Key takeaways
- Data ownership is clearly partitioned by service.
- Explorer persistence is optional but required for multi-node setups.
- Backup and recovery are first-class operational requirements.

## Next lesson
E06 - Execution engine internals (game logic): `feynman/lessons/E06-execution-engine.md`
