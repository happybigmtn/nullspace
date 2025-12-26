# Data Persistence Plan

## Data Stores and Ownership
| Service | Writes | Reads | Notes |
| --- | --- | --- | --- |
| Validators + executor | Chain state, blocks | Chain state | Consensus source of truth. |
| Simulator/indexer | Explorer persistence (optional Postgres/SQLite) | Chain state + explorer | Read-heavy HTTP/WS API. |
| Auth service | Convex (users, entitlements, Stripe events) | Convex | Uses service token + admin key for on-chain sync. |
| Website | None | Simulator + Auth + Convex | Read-only; no direct writes to chain. |

## Explorer Persistence Options
- In-memory (default): no persistence, fastest, not suitable for multi-node.
- SQLite: `--explorer-persistence-path ./explorer.db` for single-node or dev.
- Postgres (shared): `--explorer-persistence-url postgres://...` for multi-node.

Retention controls:
- `--explorer-max-blocks` (0 disables limit)
- `--explorer-max-account-entries`
- `--explorer-max-accounts`
- `--explorer-max-game-event-accounts`

## Migration Plan (SQLite -> Postgres)
1) Provision Postgres and create a dedicated database/user.
2) Start a new simulator/indexer with `--explorer-persistence-url` and the
   desired retention flags. It will rebuild the explorer state by replaying the
   chain.
3) Run the new indexer in parallel until it reaches the chain tip.
4) Switch reads (load balancer or service discovery) to the Postgres-backed
   indexer tier.
5) Retire the SQLite instance after verifying data parity.

## Backups + Restore Drills
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

## Data Access Boundaries
- Simulator is the only service that writes explorer persistence.
- Auth service is the only service that writes Convex (users/entitlements).
- Website is read-only; it should never write to chain or Convex directly.
- Admin keys are held by the Auth service only (for freeroll limit sync).
