#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

URL="${URL:-http://localhost:8080}"
IDENTITY="${IDENTITY:-}"
NUM_BOTS="${NUM_BOTS:-300}"
DURATION="${DURATION:-300}"
RATE="${RATE:-3.0}"
METRICS_INTERVAL="${METRICS_INTERVAL:-5}"
OUT_DIR="${OUT_DIR:-load-test-$(date +%Y%m%d-%H%M%S)}"

if [[ -z "${IDENTITY}" ]]; then
  echo "IDENTITY is required (validator identity hex)." >&2
  echo "Example: IDENTITY=<hex> URL=${URL} NUM_BOTS=${NUM_BOTS} DURATION=${DURATION} RATE=${RATE} $0" >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"
SYSTEM_LOG="${OUT_DIR}/system_metrics.log"
HTTP_LOG="${OUT_DIR}/http_metrics.log"

echo "ts=$(date +%s) start=1 url=${URL} bots=${NUM_BOTS} duration=${DURATION} rate=${RATE}" > "${OUT_DIR}/run.meta"

capture_metrics() {
  while true; do
    local ts
    ts="$(date +%s)"
    curl -s "${URL}/metrics/system" | sed "s/^/${ts} /" >> "${SYSTEM_LOG}" || true
    curl -s "${URL}/metrics/http" | sed "s/^/${ts} /" >> "${HTTP_LOG}" || true
    sleep "${METRICS_INTERVAL}"
  done
}

capture_metrics &
METRICS_PID=$!
trap 'kill "${METRICS_PID}" 2>/dev/null || true' EXIT

cargo run --release --bin stress-test -- \
  --url "${URL}" \
  --identity "${IDENTITY}" \
  --num-bots "${NUM_BOTS}" \
  --duration "${DURATION}" \
  --rate "${RATE}"
