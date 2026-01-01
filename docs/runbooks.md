# Incident Runbooks

## Testnet Readiness
- `docs/testnet-readiness-runbook.md`
- `docs/testnet-runbook.md`
- `docs/mobile-vault-qa-runbook.md`
- `docs/hetzner-deployment-runbook.md`
- `docs/postgres-ops-runbook.md`

## On-Call Basics
- Primary responds within 15 minutes; secondary within 30 minutes.
- Escalate to engineering lead if downtime > 30 minutes.
- Document every incident in `docs/updates.md` (root cause + follow-ups).

## Consensus Stall
**Symptoms:** no new blocks, validators idle, simulator height not advancing.

1) Check validator logs for quorum or networking errors.
2) Verify peer connectivity and clock sync (NTP).
3) Restart the executor if block production is stalled.
4) If still stalled, restart one validator at a time to rejoin quorum.
5) Post-incident: collect logs and review consensus configs.

## WS Error Spike
**Symptoms:** `ws_*_send_errors_total` or `ws_*_queue_full_total` rising.

1) Confirm simulator CPU/memory headroom.
2) Check WS connection limits and outbound buffer sizes.
3) Scale read/indexer nodes or increase `ws_outbound_buffer`.
4) Inspect network drops or LB idle timeouts.

## Auth Service Outage
**Symptoms:** `/healthz` fails, 5xx spike, login failures.

1) Check Auth service logs and Convex health.
2) Roll back to the last known-good deploy.
3) Validate Convex service token and Stripe env vars.
4) Confirm `AUTH_ALLOWED_ORIGINS` and CORS settings.

## Stripe Webhook Backlog
**Symptoms:** delayed entitlements, webhook retries.

1) Check Convex webhook logs for failures.
2) Verify Stripe signing secret matches Convex env.
3) Re-run entitlement reconciliation endpoint.
4) Confirm Auth service can reach Convex.

## Explorer Persistence Backpressure
**Symptoms:** `explorer_persistence_queue_depth` rising, drops reported.

1) Check Postgres latency and connection pool health.
2) Increase persistence buffer or batch size.
3) Scale Postgres or move to faster storage.
4) If persistent, lower retention limits temporarily.

## Oracle Feed Staleness
**Symptoms:** oracle timestamp lag, AMM risk controls tripping.

1) Check oracle ingestion job and data source health.
2) Confirm `UpdateOracle` submissions are being accepted.
3) If feed is stale, reduce borrow caps or pause new borrows.
