#!/bin/bash
set -euo pipefail

# Minimal QA stack: simulator + single node + website (no gateway/auth/convex).
# Does not write any .env files; exports runtime env for Vite instead.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="${CONFIG_DIR:-$ROOT_DIR/configs/qa-simple}"
NODES="${QA_NODES:-1}"
WEB_PORT="${WEB_PORT:-3000}"
QA_SEED="${QA_SEED:-4242}"
LOCALNET_LOG="${QA_LOCALNET_LOG:-/tmp/qa-simple-localnet.log}"
WEBSITE_LOG="${QA_WEBSITE_LOG:-/tmp/qa-simple-website.log}"

log() { printf "\033[1;36m[qa-simple-up]\033[0m %s\n" "$*"; }

cd "$ROOT_DIR"

if [ ! -f "$CONFIG_DIR/node0.yaml" ] || [ ! -f "$CONFIG_DIR/peers.yaml" ]; then
  log "Generating ${NODES}-node config in $CONFIG_DIR (seed=$QA_SEED)"
  cargo run --quiet --bin generate-keys -- \
    --nodes "$NODES" \
    --output "$CONFIG_DIR" \
    --seed "$QA_SEED" \
    --no-env
fi

FRESH_FLAG=()
if [ "${QA_FRESH:-0}" = "1" ]; then
  FRESH_FLAG=(--fresh)
fi

log "Starting local network"
ALLOW_HTTP_NO_ORIGIN=1 ALLOW_WS_NO_ORIGIN=1 ALLOW_PRIVATE_IPS=1 \
  ./scripts/start-local-network.sh "$CONFIG_DIR" "$NODES" "${FRESH_FLAG[@]}" >"$LOCALNET_LOG" 2>&1 &
echo $! > /tmp/qa-simple-localnet.pid

log "Waiting for simulator health"
for i in {1..60}; do
  if curl -sf http://127.0.0.1:8080/healthz >/dev/null; then
    break
  fi
  sleep 1
done

IDENTITY=""
if [ -f "$CONFIG_DIR/identity.hex" ]; then
  IDENTITY=$(tr -d '\r\n' < "$CONFIG_DIR/identity.hex")
else
  POLYNOMIAL=$(grep -E "^polynomial:" "$CONFIG_DIR/node0.yaml" | head -1 | awk '{print $2}' | tr -d '"')
  if [ -z "$POLYNOMIAL" ]; then
    log "Failed to read polynomial from $CONFIG_DIR/node0.yaml"
    exit 1
  fi
  IDENTITY="${POLYNOMIAL:0:192}"
fi

log "Starting website dev server on :$WEB_PORT"
(cd website && pnpm install --frozen-lockfile >/dev/null 2>&1 || true)
(cd website && \
  VITE_IDENTITY="$IDENTITY" \
  VITE_URL="http://127.0.0.1:8080" \
  VITE_QA_BETS="true" \
  pnpm dev -- --host 127.0.0.1 --port "$WEB_PORT" >"$WEBSITE_LOG" 2>&1 & echo $! > /tmp/qa-simple-website.pid)

log "Ready. Services: simulator:8080 website:${WEB_PORT}"
log "Logs: $LOCALNET_LOG $WEBSITE_LOG"
log "To stop: ./scripts/qa-simplify-down.sh"
