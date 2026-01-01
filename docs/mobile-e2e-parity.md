# End-to-End Integration Test Runbook: On-Chain Parity

**Objective:** Verify parity between the on-chain casino program and web/mobile
clients via the gateway protocol, across all games and bet types.

**Scope:** All 10 casino games and all bet types defined in `execution/src/casino/`.

---

## Environment Setup

### 1) Generate local configs (if needed)

```bash
cargo run --bin generate-keys -- --nodes 4 --output configs/local
cp configs/local/.env.local website/.env.local
```

### 2) Allow gateway origin access to simulator

```bash
export ALLOW_HTTP_NO_ORIGIN=true
export ALLOW_WS_NO_ORIGIN=true
export ALLOWED_HTTP_ORIGINS="http://localhost:9010"
export ALLOWED_WS_ORIGINS="http://localhost:9010"
```

### 3) Start local network

```bash
./scripts/start-local-network.sh configs/local 4 --fresh
# Optional: --no-build if release binaries already exist
```

---

## Gateway + Clients

### 1) Start gateway

```bash
GATEWAY_DATA_DIR=./.gateway-data \
BACKEND_URL=http://localhost:8080 \
GATEWAY_PORT=9010 \
GATEWAY_EVENT_TIMEOUT_MS=0 \
GATEWAY_SESSION_RATE_LIMIT_POINTS=10000 \
pnpm -C gateway start
```

Notes:
- `GATEWAY_EVENT_TIMEOUT_MS=0` is useful for integration tests to avoid waiting
  on updates-stream events.
- Session rate limits can be tuned via `GATEWAY_SESSION_RATE_LIMIT_*`.

### 2) Start web app

```bash
pnpm -C website dev
```

### 3) Start mobile app (Expo)

```bash
EXPO_PUBLIC_WS_URL=ws://<host-ip>:9010 pnpm -C mobile start
```

WebSocket URL by platform:
- iOS simulator: `ws://localhost:9010`
- Android emulator: `ws://10.0.2.2:9010`
- Physical device: `ws://<LAN-IP>:9010`

---

## Automated Parity Coverage

### Gateway bet coverage (all games, all bet types)

```bash
RUN_INTEGRATION=true pnpm -C gateway exec vitest run tests/all-bet-types.test.ts \
  --testTimeout 600000
```

### Web parser coverage (game state blobs)

```bash
pnpm -C website exec vitest run src/services/games/__tests__/game-state.test.ts
```

---

## Manual Spot Checks (Fast)

- Confirm `session_ready` and `balance` arrive within 5s on mobile.
- Claim faucet and verify balance updates on both web and mobile.
- Start a quick game (Hi-Lo or Blackjack) and verify a completed result.
- Background the mobile app for 30s and return; confirm reconnect + state
  restore.
- Toggle airplane mode mid-game and confirm reconnect banner + recovery.

---

## Troubleshooting

- If gateway rejects with `Invalid message payload`, ensure the mobile and
  gateway builds are from the same workspace revision and that
  `@nullspace/protocol` has been rebuilt.
- If sessions are rate-limited during test runs, increase
  `GATEWAY_SESSION_RATE_LIMIT_POINTS` or shorten the test suite.
- If the simulator is unreachable, confirm `ALLOW_*` env vars and
  `ALLOWED_*_ORIGINS` match the gateway origin (`http://localhost:9010`).
