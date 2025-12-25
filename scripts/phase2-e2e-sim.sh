#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

RUN_PHASE1="${RUN_PHASE1:-true}"
RUN_PHASE2="${RUN_PHASE2:-true}"

PHASE1_DAYS="${PHASE1_DAYS:-365}"
PHASE1_DAY_SECONDS="${PHASE1_DAY_SECONDS:-1}"
PHASE1_BOTS="${PHASE1_BOTS:-100}"
PHASE1_DAILY_NEW="${PHASE1_DAILY_NEW:-0}"
PHASE1_CHURN_BPS="${PHASE1_CHURN_BPS:-0}"
PHASE1_ACTIVE_BPS="${PHASE1_ACTIVE_BPS:-10000}"
PHASE1_MEMBER_BPS="${PHASE1_MEMBER_BPS:-2000}"
PHASE1_OUTPUT="${PHASE1_OUTPUT:-phase1-sim.json}"
PHASE1_KEYS_OUT="${PHASE1_KEYS_OUT:-phase1-keys.json}"

PHASE2_NETWORK="${PHASE2_NETWORK:-sepolia}"
PHASE2_BIDDERS="${PHASE2_BIDDERS:-100}"
PHASE2_SEED="${PHASE2_SEED:-42}"

SIMULATOR_URL="${SIMULATOR_URL:-http://localhost:8080}"
EXECUTOR_BLOCK_INTERVAL_MS="${EXECUTOR_BLOCK_INTERVAL_MS:-50}"

SIMULATOR_PID=""
EXECUTOR_PID=""

cleanup() {
  if [[ -n "${EXECUTOR_PID}" ]] && kill -0 "${EXECUTOR_PID}" 2>/dev/null; then
    kill "${EXECUTOR_PID}" 2>/dev/null || true
  fi
  if [[ -n "${SIMULATOR_PID}" ]] && kill -0 "${SIMULATOR_PID}" 2>/dev/null; then
    kill "${SIMULATOR_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT

if [[ "${RUN_PHASE1}" == "true" ]]; then
  echo "=== Phase 1 accelerated simulation ==="

  if [[ ! -f "target/release/nullspace-simulator" || ! -f "target/release/dev-executor" ]]; then
    echo "Building simulator and dev-executor..."
    cargo build --release --bin nullspace-simulator --bin dev-executor
  fi

  IDENTITY="$(cargo run --release --example get_identity -p nullspace-simulator | tail -n 1)"
  if [[ -z "${IDENTITY}" ]]; then
    echo "Failed to derive network identity." >&2
    exit 1
  fi

  echo "Starting simulator..."
  ./target/release/nullspace-simulator --host 127.0.0.1 --port 8080 --identity "${IDENTITY}" > /tmp/simulator.log 2>&1 &
  SIMULATOR_PID=$!

  for i in {1..30}; do
    if curl -sf "${SIMULATOR_URL}/healthz" > /dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done

  echo "Starting dev-executor..."
  ./target/release/dev-executor --url "${SIMULATOR_URL}" --identity "${IDENTITY}" --block-interval-ms "${EXECUTOR_BLOCK_INTERVAL_MS}" > /tmp/dev-executor.log 2>&1 &
  EXECUTOR_PID=$!
  sleep 2

  echo "Running phase simulation..."
  IDENTITY="${IDENTITY}" \
    DAYS="${PHASE1_DAYS}" \
    DAY_SECONDS="${PHASE1_DAY_SECONDS}" \
    INITIAL_PLAYERS="${PHASE1_BOTS}" \
    DAILY_NEW_PLAYERS="${PHASE1_DAILY_NEW}" \
    DAILY_CHURN_BPS="${PHASE1_CHURN_BPS}" \
    DAILY_ACTIVE_BPS="${PHASE1_ACTIVE_BPS}" \
    MEMBER_SHARE_BPS="${PHASE1_MEMBER_BPS}" \
    OUTPUT="${PHASE1_OUTPUT}" \
    KEYS_OUT="${PHASE1_KEYS_OUT}" \
    SEED="${PHASE2_SEED}" \
    scripts/phase-sim.sh

  echo "Phase 1 simulation completed."
fi

if [[ "${RUN_PHASE2}" == "true" ]]; then
  echo "=== Phase 2 auction simulation ==="
  cd "${ROOT_DIR}/evm"

  if [[ ! -d "node_modules" ]]; then
    echo "Installing EVM dependencies..."
    npm install
  fi

  BIDDER_COUNT="${PHASE2_BIDDERS}" BIDDER_MNEMONIC="${BIDDER_MNEMONIC:-}" npm run bidders:generate
  export BIDDER_KEYS_FILE="${ROOT_DIR}/evm/data/bidder-keys.txt"
  export NUM_BIDDERS="${PHASE2_BIDDERS}"

  echo "Deploying Phase 2 contracts on ${PHASE2_NETWORK}..."
  npm run "deploy:${PHASE2_NETWORK}"

  echo "Submitting mock CCA bids..."
  npm run "simulate:cca:${PHASE2_NETWORK}"

  echo "Building BOGO claim snapshot..."
  npm run snapshot:eligibility -- "data/cca-bids-${PHASE2_NETWORK}.json"
fi

echo "E2E simulation run complete."
