#!/bin/bash
set -euo pipefail

NODES="${NODES:-4}"
OUTPUT="${OUTPUT:-configs/testnet}"
SEED="${SEED:-2024}"
INDEXER="${INDEXER:-http://localhost:8080}"
BASE_PORT="${BASE_PORT:-9000}"
METRICS_BASE_PORT="${METRICS_BASE_PORT:-9100}"

usage() {
  cat <<'EOF'
Usage: NODES=4 OUTPUT=configs/testnet SEED=2024 INDEXER=http://host:8080 \
  BASE_PORT=9000 METRICS_BASE_PORT=9100 ./scripts/bootstrap-testnet.sh
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

is_number() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

require_number() {
  local name="$1"
  local value="$2"
  if ! is_number "$value"; then
    echo "Invalid ${name}: ${value}" >&2
    exit 1
  fi
}

if [[ -z "${OUTPUT}" ]]; then
  echo "OUTPUT must not be empty" >&2
  exit 1
fi

if [[ ! "${INDEXER}" =~ ^https?:// ]]; then
  echo "INDEXER must start with http:// or https:// (got: ${INDEXER})" >&2
  exit 1
fi

require_number "NODES" "${NODES}"
require_number "SEED" "${SEED}"
require_number "BASE_PORT" "${BASE_PORT}"
require_number "METRICS_BASE_PORT" "${METRICS_BASE_PORT}"

echo "Bootstrapping testnet configs..."
echo "  nodes: ${NODES}"
echo "  output: ${OUTPUT}"
echo "  seed: ${SEED}"
echo "  indexer: ${INDEXER}"
echo "  base port: ${BASE_PORT}"
echo "  metrics base port: ${METRICS_BASE_PORT}"
echo ""

cargo run --release --bin generate-keys -- \
  --nodes "${NODES}" \
  --output "${OUTPUT}" \
  --seed "${SEED}" \
  --indexer "${INDEXER}" \
  --base-port "${BASE_PORT}" \
  --metrics-base-port "${METRICS_BASE_PORT}"

echo ""
echo "Next steps:"
echo "  1) Edit ${OUTPUT}/peers.yaml with real node IPs/ports (or use --hosts)."
echo "  2) Verify bootstrappers in ${OUTPUT}/node*.yaml."
echo "  3) Start nodes with:"
echo "     ./target/release/nullspace-node --config ${OUTPUT}/node0.yaml --peers ${OUTPUT}/peers.yaml"
echo "  4) Run soak test (optional):"
echo "     DURATION_SECONDS=600 ./scripts/soak-test.sh ${OUTPUT} ${NODES}"
