# Observability

## Metrics Endpoints
- Simulator (HTTP 8080):
  - Prometheus: `/metrics/prometheus`
  - JSON snapshots: `/metrics/http`, `/metrics/ws`, `/metrics/system`,
    `/metrics/explorer`, `/metrics/updates`
- Auth service (HTTP 4000):
  - Prometheus: `/metrics/prometheus`
  - JSON snapshot: `/metrics`
- Node (metrics port, default 9100 in local configs):
  - Prometheus: `/metrics`

Note: production deployments require `METRICS_AUTH_TOKEN` for simulator + node
metrics (and auth metrics if enabled). Configure Prometheus with an auth header
(e.g. `authorization: Bearer <token>` or `x-metrics-token: <token>`).

Tracing note: OTLP traces are emitted only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
Recommended testnet defaults (5k target):
- `OTEL_EXPORTER_OTLP_ENDPOINT=http://<OTEL_COLLECTOR>:4318`
- `OTEL_SERVICE_NAME=nullspace-<service>`
- `OTEL_TRACES_SAMPLER=traceidratio`
- `OTEL_TRACES_SAMPLER_ARG=0.05` (5% sampling; raise during incident response)
- `OTEL_RESOURCE_ATTRIBUTES=deployment.environment=testnet,service.version=<git_sha>`

## Prometheus + Grafana Quickstart (Local)
Files live in `docker/observability/`.

1) Start the stack:
```bash
cd docker/observability
docker compose up -d
```
If metrics auth is enabled, add the auth header in `docker/observability/prometheus.yml`
(local stack defaults assume no auth).
2) Open Grafana: `http://localhost:3001` (admin/admin).
3) Use the preloaded dashboard: "Nullspace / Nullspace SLO Overview" (includes casino activity, node memory/CPU, and limit reject panels).
4) Optional: Alertmanager UI is available at `http://localhost:9093`.

## Alertmanager Configuration (Production)

For production, configure real notification receivers by setting environment variables
before starting the observability stack:

```bash
# Copy and edit the example file
cp docker/observability/alertmanager.env.example docker/observability/alertmanager.env
# Edit alertmanager.env with real webhook URLs

# Start with secrets
source docker/observability/alertmanager.env && docker compose up -d
```

**Required secrets:**
- `SLACK_WEBHOOK_URL` - Slack incoming webhook for `#nullspace-alerts` channel
- `PAGERDUTY_SERVICE_KEY` - PagerDuty Events API v2 integration key

**Alert routing:**
| Severity | Destination | Response Time |
|----------|-------------|---------------|
| `critical` | Slack (`#nullspace-critical`) + PagerDuty | 15 min ack |
| `warning` | Slack (`#nullspace-alerts`) only | Next business hour |

**On-call escalation policy:**
1. Primary on-call responds within 15 minutes
2. Secondary escalation if no ack within 30 minutes
3. Engineering lead escalation if downtime > 30 minutes

See `docs/RUNBOOK.md` Section 8.1 for full incident response procedures.

**Testing alerts:**
```bash
# Send a test alert to verify routing
curl -H "Content-Type: application/json" -d '[{
  "labels": {"alertname": "TestAlert", "severity": "warning"},
  "annotations": {"summary": "Test alert", "description": "Verifying alert routing"}
}]' http://localhost:9093/api/v1/alerts
```

Notes:
- `prometheus.yml` targets `host.docker.internal` for local dev. On Linux, the
  compose file includes `host-gateway` to resolve the host. For production,
  change targets to service IPs or internal DNS.
- Loki + Promtail are included for log aggregation. Promtail watches
  `*.log` files in the repo root (mounted read-only at `/var/log/nullspace`).
- Alert rules live in `docker/observability/alerts.yml`; wire receivers in
  `docker/observability/alertmanager.yml` for real notifications.
- Node configs default `metrics_port` to 9100+ to avoid clashing with the local
  Prometheus port (9090). Adjust targets accordingly if you change ports.

## Baseline SLOs (Phase 1)
These are initial targets; tighten after load tests and production telemetry.

- Availability (simulator + auth): 99.5% monthly.
- Simulator submit latency (p95): <= 250ms at 5k concurrent.
- Simulator submit latency (p99): <= 500ms at 5k concurrent.
- Auth request latency (p95): <= 200ms.
- WS send errors: 0 sustained rate; any non-zero sustained rate pages on-call.
- Explorer persistence drops: 0 sustained rate.
- Casino errors: 0 sustained rate; investigate any spike.

## Automated SLO Check
Use the Prometheus API to validate the baseline SLOs after load/soak tests:

```
node scripts/check-slo.mjs --prom-url http://localhost:9090 --window 5m
```

The script exits non-zero if any SLO is violated. Use `--allow-missing` only for
local dev; staging/prod sign-off requires zero missing metrics and zero failures.

## Alert Thresholds (Initial)
- `nullspace_simulator_update_index_failures_total` increases over 5m.
- `nullspace_simulator_ws_updates_send_errors_total` rate > 0 for 5m.
- `nullspace_simulator_explorer_persistence_queue_depth` > 50% buffer for 10m.
- Auth 5xx rate > 1% for 5m (derive from logs or add a counter).
- `nullspace_simulator_http_reject_*_total` increases over 5m.
- `nullspace_simulator_ws_*_queue_full_total` increases over 5m.
- `nullspace_simulator_ws_*_send_timeouts_total` rate > 0 for 5m.
- `nullspace_simulator_casino_errors_total` rate > 0 for 5m.
- `nullspace_simulator_casino_active_sessions` drops to 0 during expected peak.

## Logging + Aggregation Guidance
- All services already log structured JSON with request IDs.
- Recommended ingestion: Loki + Promtail or ELK.
- Required labels: `service`, `request_id`, `user_id` (when present), `event`.
- Alerts: consensus stalls, WS error spikes, auth 5xx spikes, webhook failures.
- Frontend: ensure error monitoring includes lazy-loaded routes (navigate all routes in staging).
- Mobile/WebSocket reconnect uses exponential backoff (1s -> 30s). Tune in `mobile/src/services/websocket.ts` if gateways are saturated.
- Health endpoints should remain fast and avoid slow downstream calls.

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
- Casino active sessions:
  `nullspace_simulator_casino_active_sessions`
- Casino completions rate:
  `rate(nullspace_simulator_casino_games_completed_total[5m])`
- Node memory (per instance):
  `runtime_process_rss{job="node"} / 1024 / 1024`
- Node CPU (per instance):
  `engine_system_process_cpu_percent{job="node"}`
- HTTP limit rejects:
  `rate(nullspace_simulator_http_reject_rate_limit_total[5m])`
