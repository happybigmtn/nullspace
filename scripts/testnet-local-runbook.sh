#!/bin/bash
set -euo pipefail

CONFIG_DIR="${1:-configs/local}"
NODES="${2:-4}"
FRESH="${FRESH:-true}"
NO_BUILD="${NO_BUILD:-false}"
SOAK_SECONDS="${SOAK_SECONDS:-60}"
BOT_SECONDS="${BOT_SECONDS:-30}"
BOT_NUM="${BOT_NUM:-50}"
BOT_RATE="${BOT_RATE:-2.0}"
SCHEDULER_SECONDS="${SCHEDULER_SECONDS:-20}"
ADMIN_KEY_FILE="${ADMIN_KEY_FILE:-$CONFIG_DIR/casino-admin-key.hex}"
ALLOW_HTTP_NO_ORIGIN="${ALLOW_HTTP_NO_ORIGIN:-1}"
ALLOW_WS_NO_ORIGIN="${ALLOW_WS_NO_ORIGIN:-1}"
ALLOW_NODE_RESTART="${ALLOW_NODE_RESTART:-1}"

export ALLOW_HTTP_NO_ORIGIN
export ALLOW_WS_NO_ORIGIN
export ALLOW_NODE_RESTART

require_node() {
  if ! command -v node > /dev/null 2>&1; then
    echo "node is required to generate admin keys." >&2
    exit 1
  fi
}

derive_admin_public() {
  node -e "const fs=require('fs'); const { ed25519 } = require('@noble/curves/ed25519'); const hex=fs.readFileSync(process.argv[1],'utf8').trim(); if (!hex) process.exit(1); const pk=ed25519.getPublicKey(Buffer.from(hex,'hex')); console.log(Buffer.from(pk).toString('hex'));" "$1"
}

ensure_configs() {
  if [[ -f "$CONFIG_DIR/node0.yaml" ]]; then
    return
  fi
  echo "Generating configs in $CONFIG_DIR..."
  cargo run --release --bin generate-keys -- --nodes "$NODES" --output "$CONFIG_DIR"
}

ensure_admin_key() {
  if [[ -f "$ADMIN_KEY_FILE" ]]; then
    return
  fi
  require_node
  echo "Generating casino admin key at $ADMIN_KEY_FILE..."
  scripts/generate-admin-key.sh "$ADMIN_KEY_FILE" > /dev/null
}

get_metrics_port() {
  local config="$1"
  awk -F: '/^metrics_port:/{gsub(/ /, "", $2); print $2}' "$config"
}

wait_for_metrics() {
  local url="$1"
  local label="$2"
  local attempts=60
  for _ in $(seq 1 "$attempts"); do
    if curl -sf --max-time 2 "$url" > /dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "$label did not become ready within ${attempts}s." >&2
  return 1
}

run_soak_checks() {
  local end_time=$(( $(date +%s) + SOAK_SECONDS ))
  while [[ $(date +%s) -lt $end_time ]]; do
    if ! curl -sf --max-time 2 http://localhost:8080/metrics/prometheus > /dev/null; then
      echo "Simulator metrics scrape failed." >&2
      return 1
    fi
    for port in "${METRICS_PORTS[@]}"; do
      if ! curl -sf --max-time 2 "http://localhost:${port}/metrics" > /dev/null; then
        echo "Node metrics scrape failed on port ${port}." >&2
        return 1
      fi
    done
    sleep 5
  done
}

cleanup() {
  if [[ -n "${RESTARTED_NODE_PID:-}" ]] && kill -0 "$RESTARTED_NODE_PID" 2>/dev/null; then
    kill -TERM "$RESTARTED_NODE_PID" 2>/dev/null || true
  fi
  if [[ -n "${NETWORK_PID:-}" ]] && kill -0 "$NETWORK_PID" 2>/dev/null; then
    kill -TERM "$NETWORK_PID" 2>/dev/null || true
    for _ in {1..5}; do
      if ! kill -0 "$NETWORK_PID" 2>/dev/null; then
        break
      fi
      sleep 1
    done
    if kill -0 "$NETWORK_PID" 2>/dev/null; then
      kill -KILL "$NETWORK_PID" 2>/dev/null || true
    fi
    wait "$NETWORK_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

ensure_configs
ensure_admin_key

ADMIN_PUBLIC_HEX=$(derive_admin_public "$ADMIN_KEY_FILE")
export CASINO_ADMIN_PUBLIC_KEY_HEX="$ADMIN_PUBLIC_HEX"
export CASINO_ADMIN_PRIVATE_KEY_FILE="$ADMIN_KEY_FILE"

ARGS=("$CONFIG_DIR" "$NODES")
if [[ "$FRESH" == "true" ]]; then
  ARGS+=(--fresh)
fi
if [[ "$NO_BUILD" == "true" ]]; then
  ARGS+=(--no-build)
fi

echo "Starting local network..."
./scripts/start-local-network.sh "${ARGS[@]}" &
NETWORK_PID=$!

# Wait for simulator health
READY=false
for _ in {1..60}; do
  if curl -sf --max-time 2 http://localhost:8080/healthz > /dev/null; then
    READY=true
    break
  fi
  sleep 1
 done

if [[ "$READY" != "true" ]]; then
  echo "Simulator did not become ready." >&2
  exit 1
fi

METRICS_PORTS=()
for i in $(seq 0 $((NODES - 1))); do
  port="$(get_metrics_port "$CONFIG_DIR/node$i.yaml")"
  if [[ -z "$port" ]]; then
    echo "Missing metrics_port in $CONFIG_DIR/node$i.yaml" >&2
    exit 1
  fi
  METRICS_PORTS+=("$port")
 done

wait_for_metrics "http://localhost:8080/metrics/prometheus" "Simulator metrics"
for port in "${METRICS_PORTS[@]}"; do
  wait_for_metrics "http://localhost:${port}/metrics" "Node metrics on port ${port}"
 done

# Restart recovery check for node1
NODE_CONFIG="$CONFIG_DIR/node1.yaml"
PEERS="$CONFIG_DIR/peers.yaml"
if [[ -f "$NODE_CONFIG" ]]; then
  NODE_PID=$(pgrep -f "nullspace-node --config $NODE_CONFIG" | head -1 || true)
  if [[ -n "$NODE_PID" ]]; then
    echo "Restarting node1 (pid $NODE_PID)..."
    kill -TERM "$NODE_PID" 2>/dev/null || true
    sleep 2
    ./target/release/nullspace-node --config "$NODE_CONFIG" --peers "$PEERS" &
    RESTARTED_NODE_PID=$!
    sleep 2
  fi
fi

# Run tournament scheduler briefly
if command -v timeout > /dev/null 2>&1; then
  echo "Running tournament scheduler for ${SCHEDULER_SECONDS}s..."
  timeout "$SCHEDULER_SECONDS" ./scripts/run-tournament-scheduler.sh "$CONFIG_DIR" http://localhost:8080 || {
    status=$?
    if [[ "$status" != "124" ]]; then
      exit "$status"
    fi
  }
else
  ./scripts/run-tournament-scheduler.sh "$CONFIG_DIR" http://localhost:8080 &
  SCHED_PID=$!
  sleep "$SCHEDULER_SECONDS"
  kill -TERM "$SCHED_PID" 2>/dev/null || true
fi

# Run bots
echo "Running bots for ${BOT_SECONDS}s (${BOT_NUM} bots @ ${BOT_RATE}/s)..."
NUM_BOTS="$BOT_NUM" DURATION_SECONDS="$BOT_SECONDS" RATE_PER_SEC="$BOT_RATE" ./scripts/run-bots.sh "$CONFIG_DIR" http://localhost:8080

# Soak metrics
echo "Running metrics soak for ${SOAK_SECONDS}s..."
run_soak_checks

echo "Local testnet runbook smoke test complete."
