# Observability

## Metrics Endpoints
- Simulator (HTTP 8080):
  - Prometheus: `/metrics/prometheus`
  - JSON snapshots: `/metrics/http`, `/metrics/ws`, `/metrics/system`,
    `/metrics/explorer`, `/metrics/updates`
- Auth service (HTTP 4000):
  - Prometheus: `/metrics/prometheus`
  - JSON snapshot: `/metrics`

## Prometheus + Grafana Quickstart (Local)
Files live in `docker/observability/`.

1) Start the stack:
```bash
cd docker/observability
docker compose up -d
```
2) Open Grafana: `http://localhost:3001` (admin/admin).
3) Use the preloaded dashboard: "Nullspace / Nullspace SLO Overview".

Notes:
- `prometheus.yml` targets `host.docker.internal` for local dev. On Linux, the
  compose file includes `host-gateway` to resolve the host. For production,
  change targets to service IPs or internal DNS.
- Loki + Promtail are included for log aggregation. Promtail watches
  `*.log` files in the repo root (mounted read-only at `/var/log/nullspace`).

## Baseline SLOs (Phase 1)
These are initial targets; tighten after load tests and production telemetry.

- Availability (simulator + auth): 99.5% monthly.
- Simulator submit latency (p95): <= 250ms at 5k concurrent.
- Simulator submit latency (p99): <= 500ms at 5k concurrent.
- Auth request latency (p95): <= 200ms.
- WS send errors: 0 sustained rate; any non-zero sustained rate pages on-call.
- Explorer persistence drops: 0 sustained rate.

## Alert Thresholds (Initial)
- `nullspace_simulator_update_index_failures_total` increases over 5m.
- `nullspace_simulator_ws_updates_send_errors_total` rate > 0 for 5m.
- `nullspace_simulator_explorer_persistence_queue_depth` > 50% buffer for 10m.
- Auth 5xx rate > 1% for 5m (derive from logs or add a counter).

## Logging + Aggregation Guidance
- All services already log structured JSON with request IDs.
- Recommended ingestion: Loki + Promtail or ELK.
- Required labels: `service`, `request_id`, `user_id` (when present), `event`.
- Alerts: consensus stalls, WS error spikes, auth 5xx spikes, webhook failures.

## Local Log Aggregation (Loki)
1) Ensure logs are written to files in the repo root (e.g. `simulator.log`).
2) Start the observability stack (see above).
3) In Grafana, use the Loki datasource and query:
   `{job="nullspace"}`

## PromQL Cheatsheet
- Submit p95:
  `histogram_quantile(0.95, sum(rate(nullspace_simulator_http_submit_latency_ms_bucket[5m])) by (le))`
- Auth request avg:
  `avg_over_time(nullspace_auth_timing_avg_ms{key="http.request_ms"}[5m])`
- WS send error rate:
  `rate(nullspace_simulator_ws_updates_send_errors_total[5m])`
- Update index failure rate:
  `rate(nullspace_simulator_update_index_failures_total[5m])`
