# Testnet Readiness Runbook

This runbook defines the minimum sequence and checks required to declare the
repo "testnet ready". It assumes you already have staging/testnet hosts and
secrets available.

## 0) Inputs required (blocking)
- Staging/testnet hosts with SSH access (simulator/indexer, validators, gateway, auth, website).
- Hosting runbooks: `docs/hetzner-deployment-runbook.md` and `docs/postgres-ops-runbook.md`.
- Domains + TLS termination plan (LB/CDN).
- Admin key files (casino admin ed25519).
- Convex self-hosted backend provisioned (URL + service token).
- Stripe testnet prices (if membership flows are enabled on testnet).
- Validator network identity (`VITE_IDENTITY` from configs) and indexer URL.
- Metrics auth token for simulator + validators + auth (`METRICS_AUTH_TOKEN`).
- Ops admin token if running ops service (`OPS_ADMIN_TOKEN`).
- Ops origin allowlist if running ops service (`OPS_ALLOWED_ORIGINS`).
- Convex admin nonce store reachable (auth falls back to in-memory nonces if unavailable).

## 1) Config + secrets (staging/testnet)
- Generate node configs:
  ```bash
  NODES=4 OUTPUT=configs/testnet INDEXER=http://<INDEXER_HOST>:8080 \
    ./scripts/bootstrap-testnet.sh
  ```
- Set gateway data directory for nonce persistence:
  - `GATEWAY_DATA_DIR=/var/lib/nullspace/gateway`
- Set gateway origin for backend sync:
  - `GATEWAY_ORIGIN=https://gateway.example.com`
- Lock down gateway origins:
  - `GATEWAY_ALLOWED_ORIGINS=https://app.example.com,https://auth.example.com`
  - `GATEWAY_ALLOW_NO_ORIGIN=1` (for native mobile clients)
- Require authenticated metrics in production:
  - `METRICS_AUTH_TOKEN=<secure-token>`
  - `AUTH_REQUIRE_METRICS_AUTH=1` (auth service)
- Ensure production checks are enabled:
  - `NODE_ENV=production` for simulator, validators, gateway, and ops
- Ops service hardening (if enabled):
  - `OPS_ALLOWED_ORIGINS=https://staging.example.com`
  - `OPS_REQUIRE_ALLOWED_ORIGINS=1`
  - `OPS_REQUIRE_ADMIN_TOKEN=1`
- Global table coordinator (on-chain):
  - `GATEWAY_LIVE_TABLE_CRAPS=1`
  - `GATEWAY_LIVE_TABLE_ADMIN_KEY_FILE=/etc/nullspace/casino-admin-key.hex`
  - Set `GATEWAY_LIVE_TABLE_ALLOW_ADMIN_ENV=1` only if you must use env keys in production.
- Enforce vault-only browser keys:
  - `VITE_ALLOW_LEGACY_KEYS=0`
  - `VITE_ENABLE_SIMULATOR_PASSKEYS=0`
- Disable AI strategy until Gemini keys + billing are provisioned:
  - `AI_STRATEGY_DISABLED=1`
- Use env templates:
  - `configs/staging/simulator.env.example`
  - `configs/staging/gateway.env.example`
  - Run preflight checks before first boot:
    - `node scripts/preflight-management.mjs gateway /etc/nullspace/gateway.env simulator /etc/nullspace/simulator.env auth /etc/nullspace/auth.env website /etc/nullspace/website.env`
- Website required envs:
  - `VITE_IDENTITY`, `VITE_URL`, `VITE_AUTH_URL`, `VITE_AUTH_PROXY_URL`
  - Stripe UI optional: `VITE_STRIPE_TIERS`, `VITE_STRIPE_PRICE_ID`

## 2) Rate-limit profile (testnet default)
Use the baseline profile from `docs/limits.md`. Recommended defaults:

Simulator:
- `RATE_LIMIT_HTTP_PER_SEC=5000`
- `RATE_LIMIT_HTTP_BURST=10000`
- `RATE_LIMIT_SUBMIT_PER_MIN=120000`
- `RATE_LIMIT_SUBMIT_BURST=20000`
- `RATE_LIMIT_WS_CONNECTIONS=30000`
- `RATE_LIMIT_WS_CONNECTIONS_PER_IP=500`

Gateway:
- `MAX_CONNECTIONS_PER_IP=200`
- `MAX_TOTAL_SESSIONS=20000`
- `GATEWAY_SESSION_RATE_LIMIT_POINTS=1000`
- `GATEWAY_SESSION_RATE_LIMIT_WINDOW_MS=3600000`
- `GATEWAY_SESSION_RATE_LIMIT_BLOCK_MS=600000`
- `GATEWAY_EVENT_TIMEOUT_MS=30000`

Notes:
- For NAT-heavy mobile traffic, keep per-IP caps at or above these defaults
  to avoid false throttling; raise if you see 429s on clean traffic.

## 3) Bring-up sequence (staging/testnet)
1) Start simulator/indexer with rate limits.
2) Start validators (one per host).
3) Start gateway pointing at simulator.
4) Start Auth service with Convex + Stripe configured.
5) Start website with vault-only defaults and correct Auth URL.
6) Enable the global craps table in the gateway (`GATEWAY_LIVE_TABLE_CRAPS=1`).
7) (Optional) Start ops service for analytics.

Reference: `docs/testnet-runbook.md`.

## 4) Smoke checks (must pass)
- Health endpoints:
  - `GET http://<INDEXER_HOST>:8080/healthz`
  - `GET http://<GATEWAY_HOST>:9010/healthz`
  - `GET http://<AUTH_HOST>:4000/healthz`
  - `GET http://<NODE_HOST>:9100/metrics` (send `x-metrics-token: <METRICS_AUTH_TOKEN>`)
- Metrics sanity:
  - `GET http://<INDEXER_HOST>:8080/metrics/prometheus` (send `x-metrics-token: <METRICS_AUTH_TOKEN>`)
  - `GET http://<AUTH_HOST>:4000/metrics/prometheus` (send `x-metrics-token: <METRICS_AUTH_TOKEN>`)
- Optional:
  - `GET http://<OPS_HOST>:9020/healthz`
- Metrics scrape sanity: simulator + nodes visible in Prometheus.
- Faucet flow: register, claim, verify balance changes.
- One full game flow each for:
  - Blackjack, Roulette, Craps, Sic Bo, Baccarat, Video Poker, Casino War.
- Tournament scheduler run for 1-2 intervals.

## 5) Bet coverage + parser tests
- Gateway bet coverage (all bet types):
  ```bash
  RUN_INTEGRATION=true pnpm -C gateway exec vitest run tests/all-bet-types.test.ts
  ```
  - Requires a running gateway (`TEST_GATEWAY_PORT` if non-default).
  - Adjust `TEST_TIMEOUT_MS` / `TEST_RESPONSE_TIMEOUT_MS` for slow environments.
- Game-state parser tests:
  ```bash
  pnpm -C packages/game-state test
  pnpm -C website exec vitest run src/services/games/__tests__/game-state.test.ts
  ```

## 6) Load tests + soak

### Capacity Limits (validated via stress testing)

**Gateway WebSocket Limits:**
| Metric | Default | Production | Notes |
|--------|---------|------------|-------|
| `MAX_CONNECTIONS_PER_IP` | 5 | 200 | Per-IP connection limit |
| `MAX_TOTAL_SESSIONS` | 1000 | 20000 | Total concurrent sessions |
| Connection P99 Latency | - | <100ms | Target at 1k connections |
| Connection Success Rate | - | >95% | At configured capacity |

**Simulator Limits:**
| Metric | Default | Production | Notes |
|--------|---------|------------|-------|
| `RATE_LIMIT_WS_CONNECTIONS` | 30000 | 30000 | Total WS connection cap |
| `RATE_LIMIT_WS_CONNECTIONS_PER_IP` | 500 | 500 | Per-IP limit on simulator |

### WebSocket Stress Test
Run stress tests to validate capacity before production:

```bash
# 1k concurrent connections (local)
pnpm -C gateway test:stress:1k

# 10k connections (staging)
STRESS_CONNECTIONS=10000 STRESS_GATEWAY_URL=ws://staging-gateway:9010 \
  pnpm -C gateway test:stress

# Standalone script with detailed output
CONNECTIONS=1000 GATEWAY_URL=ws://localhost:9010 \
  node scripts/ws-stress-test.mjs
```

**Expected results at 1k connections:**
- Success rate: >95%
- P99 latency: <100ms
- No gateway crashes or memory leaks

### Soak test (10 min)
```bash
ALLOW_HTTP_NO_ORIGIN=1 ALLOW_WS_NO_ORIGIN=1 DURATION_SECONDS=600 \
  ./scripts/soak-test.sh configs/testnet 4
```

### Bot load (5-10 min)
```bash
NUM_BOTS=300 DURATION_SECONDS=300 RATE_PER_SEC=3.0 \
  ./scripts/run-bots.sh configs/testnet http://<INDEXER_HOST>:8080
```

### Global table fanout (5-10 min)
```bash
URL=ws://<GATEWAY_HOST>:9010 ORIGIN=https://gateway.example.com \
  TOTAL=5000 RAMP_PER_SEC=500 DURATION=300 \
  node scripts/load-test-global-table.mjs
```

## 7) Recovery drills
- Restart a validator and confirm it rejoins.
- Restart gateway and confirm sessions can re-register.
- (Optional) Restart simulator and verify indexer recovery.

## 8) Observability + alerts
- Prometheus/Grafana running and scraping all targets.
- Alert rules enabled for:
  - WS send errors, update indexing failures, explorer persistence backlog.
  - Simulator rate-limit reject spikes.
  - Auth 5xx spikes.

## 9) Backup + restore drills
- Convex backup/restore validated.
- Explorer/indexer persistence backups validated (if enabled).
- Gateway nonces persistence verified (`GATEWAY_DATA_DIR`).

## 10) Go / No-Go
Approve testnet launch only if all of the following are true:
- All smoke checks pass without manual retries.
- Bet coverage test passes (87/87).
- Soak + bot load complete without sustained errors.
- Observability is live and alerting verified.
- Vault-only login works on iOS and Android with recovery key export/import.
