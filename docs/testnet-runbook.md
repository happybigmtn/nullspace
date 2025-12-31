# Nullspace Chain Testnet Runbook

This runbook documents the repeatable flow for standing up a multi-node testnet.

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
./target/release/nullspace-simulator --host 0.0.0.0 --port 8080 --identity <IDENTITY_HEX>
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
