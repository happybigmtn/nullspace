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

## 1) Config + secrets (staging/testnet)
- Generate node configs:
  ```bash
  NODES=4 OUTPUT=configs/testnet INDEXER=http://<INDEXER_HOST>:8080 \
    ./scripts/bootstrap-testnet.sh
  ```
- Set gateway data directory for nonce persistence:
  - `GATEWAY_DATA_DIR=/var/lib/nullspace/gateway`
- Enforce vault-only browser keys:
  - `VITE_ALLOW_LEGACY_KEYS=0`
  - `VITE_ENABLE_SIMULATOR_PASSKEYS=0`
- Disable AI strategy until Gemini keys + billing are provisioned:
  - `AI_STRATEGY_DISABLED=1`
- Use env templates:
  - `configs/staging/simulator.env.example`
  - `configs/staging/gateway.env.example`

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

## 3) Bring-up sequence (staging/testnet)
1) Start simulator/indexer with rate limits.
2) Start validators (one per host).
3) Start gateway pointing at simulator.
4) Start Auth service with Convex + Stripe configured.
5) Start website with vault-only defaults and correct Auth URL.

Reference: `docs/testnet-runbook.md`.

## 4) Smoke checks (must pass)
- Health endpoints:
  - `GET http://<INDEXER_HOST>:8080/healthz`
  - `GET http://<NODE_HOST>:9100/metrics`
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
- Game-state parser tests:
  ```bash
  pnpm -C packages/game-state test
  pnpm -C website exec vitest run src/services/games/__tests__/game-state.test.ts
  ```

## 6) Load tests + soak
- Soak test (10 min):
  ```bash
  ALLOW_HTTP_NO_ORIGIN=1 ALLOW_WS_NO_ORIGIN=1 DURATION_SECONDS=600 \
    ./scripts/soak-test.sh configs/testnet 4
  ```
- Bot load (5-10 min):
  ```bash
  NUM_BOTS=300 DURATION_SECONDS=300 RATE_PER_SEC=3.0 \
    ./scripts/run-bots.sh configs/testnet http://<INDEXER_HOST>:8080
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
