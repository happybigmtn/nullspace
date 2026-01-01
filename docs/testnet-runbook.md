# Nullspace Chain Testnet Runbook

This runbook documents the repeatable flow for standing up a multi-node testnet.
Use `docs/testnet-readiness-runbook.md` for the full go/no-go checklist.

## Local Smoke Run (preflight)
For a local end-to-end smoke test (health + metrics + restart + bots + scheduler):

```bash
./scripts/testnet-local-runbook.sh configs/local 4
```

## 1) Generate validator configs
Use the bootstrap script to generate per-node configs plus a peers file:

```bash
NODES=4 OUTPUT=configs/testnet INDEXER=http://<INDEXER_HOST>:8080 \
  ./scripts/bootstrap-testnet.sh
```

This produces:
- `configs/testnet/nodeN.yaml` (validator config + key material)
- `configs/testnet/peers.yaml` (needs real IPs)
- `configs/testnet/.env.local` (identity for frontends)

## 2) Replace peer addresses
Edit `configs/testnet/peers.yaml` to point at real node IPs and ports.
Use `configs/testnet/peers.yaml.example` as a template.
If you prefer `--hosts`, populate `configs/testnet/hosts.yaml` from
`configs/testnet/hosts.yaml.example`.

## 3) Distribute configs
Each validator host needs:
- its own `nodeN.yaml`
- a shared `peers.yaml` with real addresses

## 4) Start the indexer/simulator
Run the simulator on your chosen indexer host:

```bash
RATE_LIMIT_HTTP_PER_SEC=5000 RATE_LIMIT_HTTP_BURST=10000 \
RATE_LIMIT_SUBMIT_PER_MIN=120000 RATE_LIMIT_SUBMIT_BURST=20000 \
RATE_LIMIT_WS_CONNECTIONS=30000 RATE_LIMIT_WS_CONNECTIONS_PER_IP=500 \
./target/release/nullspace-simulator --host 0.0.0.0 --port 8080 --identity <IDENTITY_HEX>
```

## 4b) Start the gateway (mobile/web)
Run the gateway on a public host, pointing at the simulator:

```bash
MAX_CONNECTIONS_PER_IP=200 MAX_TOTAL_SESSIONS=20000 \
GATEWAY_SESSION_RATE_LIMIT_POINTS=1000 \
GATEWAY_SESSION_RATE_LIMIT_WINDOW_MS=3600000 \
GATEWAY_SESSION_RATE_LIMIT_BLOCK_MS=600000 \
GATEWAY_EVENT_TIMEOUT_MS=30000 \
BACKEND_URL=http://<INDEXER_HOST>:8080 GATEWAY_PORT=9010 \
pnpm -C gateway start
```

## 4c) Start Auth + Convex (membership + AI proxy)
Stand up the self-hosted Convex backend first (see `docs/golive.md`), then start Auth:

```bash
# Use services/auth/.env.staging.example as a template.
AI_STRATEGY_DISABLED=1 \
pnpm -C services/auth build
pnpm -C services/auth start
```

## 4d) Frontend config (vault-only keys)
For staging/testnet, enforce non-custodial vaults and disable legacy browser keys:

```bash
VITE_ALLOW_LEGACY_KEYS=0
VITE_ENABLE_SIMULATOR_PASSKEYS=0
VITE_AUTH_URL=https://auth-staging.example.com
```

## 5) Start validators
On each validator host:

```bash
./target/release/nullspace-node --config configs/testnet/nodeN.yaml --peers configs/testnet/peers.yaml
```

Or with hosts:

```bash
./target/release/nullspace-node --config configs/testnet/nodeN.yaml --hosts configs/testnet/hosts.yaml
```

## 6) Health + metrics checks
Verify metrics endpoints per node (default 9100+):
- `http://<NODE_IP>:9100/metrics`
- `http://<INDEXER_IP>:8080/metrics/prometheus`

If using curl/CLI without browser origins, set:
`ALLOW_HTTP_NO_ORIGIN=1 ALLOW_WS_NO_ORIGIN=1` when running the simulator.

## 7) Soak test
Run a multi-node soak test to detect deadlocks/crashes:

```bash
ALLOW_HTTP_NO_ORIGIN=1 ALLOW_WS_NO_ORIGIN=1 DURATION_SECONDS=600 \
  ./scripts/soak-test.sh configs/testnet 4
```

## 8) Restart recovery check
Stop a validator and restart it with the same `directory` path.
Confirm it rejoins and continues at the current height.

## 9) Tournament scheduler (backend)
Run the scheduler to start/end freeroll tournaments on schedule:

```bash
CASINO_ADMIN_PRIVATE_KEY_FILE=/path/to/casino-admin-key.hex \
  ./scripts/run-tournament-scheduler.sh configs/testnet http://<INDEXER_HOST>:8080
```

## 10) Bot load runner (backend)
Spawn tournament-style bot traffic from a server host:

```bash
NUM_BOTS=300 DURATION_SECONDS=300 RATE_PER_SEC=3.0 \
  ./scripts/run-bots.sh configs/testnet http://<INDEXER_HOST>:8080
```

## 11) Bridge relayer (optional)
If the testnet integrates the EVM lockbox, run the relayer:

```bash
cargo run --release --bin bridge-relayer -- \
  --url http://<INDEXER_HOST>:8080 \
  --identity <IDENTITY_HEX> \
  --admin-key <ADMIN_KEY_HEX> \
  --evm-rpc-url <RPC_URL> \
  --evm-private-key <EVM_KEY> \
  --lockbox-address <LOCKBOX_ADDR> \
  --evm-chain-id <CHAIN_ID>
```

## 12) Diagnostics: session dump
Use this to capture state for a specific session or player:

```bash
cargo run --release --bin session-dump -- \
  --url http://<INDEXER_HOST>:8080 \
  --identity <IDENTITY_HEX> \
  --session-id <SESSION_ID>
```

## 13) Observability stack
Use the local Prometheus/Grafana stack and point targets at testnet hosts:

```bash
cd docker/observability
docker compose up -d
```

Update `docker/observability/prometheus.yml` targets to match your host IPs.
