# Sprint 04 - Simulator/Indexer and Explorer APIs

## Goal
Deliver an indexer that persists event logs and exposes explorer APIs for rounds, bets, and analytics.

## Demo
- Run the indexer against a local engine and query recent rounds and leaderboard metrics via HTTP.

## Acceptance Criteria
- AC-4.1: Indexer ingests event logs and persists rounds, bets, and payouts to storage.
- AC-4.2: Indexer can rebuild state from snapshots and catch up from the log on restart.
- AC-4.3: Explorer APIs return recent rounds, player history, and leaderboard summaries.
- AC-4.4: Aggregated metrics (volume, house edge, payouts) are computed per game and per period.
- AC-4.5: Indexer backfills from genesis on empty storage.
- AC-4.6: Indexer exposes health and metrics endpoints suitable for monitoring.

## Tasks/Tickets
- T1: Implement event ingestion pipeline and persistence schema.
  - Validation: `cargo test -p simulator` or integration tests verify stored rounds.
- T2: Add snapshot replay + log catch-up on indexer startup.
  - Validation: restart test ensures state matches pre-restart totals.
- T3: Implement explorer HTTP endpoints for rounds, bets, leaderboards.
  - Validation: API tests exercise pagination and filters.
- T4: Add aggregation jobs for volume, house edge, and payout stats.
  - Validation: unit tests with fixture data.
- T5: Add backfill process from genesis for new storage.
  - Validation: integration test starts from empty DB and catches up.
- T6: Expose health and metrics endpoints (Prometheus or JSON).
  - Validation: `scripts/health-check.sh` includes indexer health.
