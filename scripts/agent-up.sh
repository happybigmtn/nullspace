#!/bin/bash
set -euo pipefail

# One-shot hermetic bootstrap for local agent/dev runs.
# Brings up Convex, simulator + validators, gateway, auth, and seeds minimal data.
# Idempotent and safe to rerun; avoids touching user env files.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="${CONFIG_DIR:-$ROOT_DIR/configs/local}"
NODES="${NODES:-1}"
WEB_PORT="${WEB_PORT:-3000}"
SKIP_AUTH="${SKIP_AUTH:-0}"
SKIP_GATEWAY="${SKIP_GATEWAY:-0}"
SKIP_WEBSITE="${SKIP_WEBSITE:-0}"
SKIP_LOCALNET="${SKIP_LOCALNET:-0}"
ALLOW_HTTP_NO_ORIGIN=1
ALLOW_WS_NO_ORIGIN=1
ALLOW_PRIVATE_IPS=1
DEFAULT_ORIGINS="http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT},http://localhost:9010,http://127.0.0.1:9010"
ALLOWED_HTTP_ORIGINS="${ALLOWED_HTTP_ORIGINS:-$DEFAULT_ORIGINS}"
ALLOWED_WS_ORIGINS="${ALLOWED_WS_ORIGINS:-$ALLOWED_HTTP_ORIGINS}"

export ALLOW_HTTP_NO_ORIGIN ALLOW_WS_NO_ORIGIN ALLOW_PRIVATE_IPS ALLOWED_HTTP_ORIGINS ALLOWED_WS_ORIGINS

cd "$ROOT_DIR"

log() { printf "\033[1;36m[agent-up]\033[0m %s\n" "$*"; }

# 1) Create throwaway website/.env.local from template
if [ ! -f website/.env.local ]; then
  log "Seeding website/.env.local"
  if [ -f "$CONFIG_DIR/.env.automation" ]; then
    cp "$CONFIG_DIR/.env.automation" website/.env.local
  else
    cp "$CONFIG_DIR/.env.local" website/.env.local
  fi
  # Ensure gateway/auth URLs point to localhost
  cat >> website/.env.local <<EOF
VITE_GATEWAY_URL=ws://127.0.0.1:9010
VITE_AUTH_URL=http://127.0.0.1:4000
EOF
fi

if [ "$SKIP_LOCALNET" != "1" ]; then
  # 2) Generate local keys/configs if missing
  if [ ! -f "$CONFIG_DIR/node0.yaml" ]; then
    log "Generating local validator keys into $CONFIG_DIR"
    cargo run --quiet --bin generate-keys -- --nodes "$NODES" --output "$CONFIG_DIR"
  fi

  # 3) Convex env
  if [ ! -f docker/convex/.env ]; then
    log "Creating docker/convex/.env (dev-scoped)"
    cat > docker/convex/.env <<'EOF'
PORT=3210
SITE_PROXY_PORT=3211
CONVEX_SERVICE_TOKEN=dev-local-token
INSTANCE_NAME=local-dev
INSTANCE_SECRET=local-instance-secret
RUST_LOG=info
EOF
  fi

  # 4) Build binaries if missing
  if [ ! -f target/release/nullspace-simulator ] || [ ! -f target/release/nullspace-node ]; then
    log "Building simulator/node (release)"
    cargo build --release -p nullspace-simulator -p nullspace-node
  fi

  # 5) Start Convex via docker compose
  log "Starting Convex"
  docker compose --env-file docker/convex/.env -f docker/convex/docker-compose.yml up -d --wait

  # 6) Start local consensus (simulator + validators)
  log "Starting simulator + validators"
  ./scripts/start-local-network.sh "$CONFIG_DIR" "$NODES" --no-build --fresh >/tmp/localnet.log 2>&1 &
  echo $! > /tmp/localnet.pid
else
  log "Skipping local network + Convex bootstrap (SKIP_LOCALNET=1)"
fi

# 7) Start auth (dev mode)
if [ "$SKIP_AUTH" != "1" ]; then
  log "Starting auth service"
  pnpm -C services/auth install --frozen-lockfile >/tmp/auth-install.log 2>&1
  (cd services/auth && pnpm dev >/tmp/auth.log 2>&1 & echo $! > /tmp/auth.pid)
else
  log "Skipping auth service (SKIP_AUTH=1)"
fi

# 8) Start gateway
if [ "$SKIP_GATEWAY" != "1" ]; then
  log "Starting gateway"
  pnpm -C gateway install --frozen-lockfile >/tmp/gateway-install.log 2>&1
  GATEWAY_SKIP_EVENT_WAIT="${GATEWAY_SKIP_EVENT_WAIT:-0}" \
  pnpm -C gateway start >/tmp/gateway.log 2>&1 & echo $! > /tmp/gateway.pid
else
  log "Skipping gateway (SKIP_GATEWAY=1)"
fi

# 9) Start website (vite)
if [ "$SKIP_WEBSITE" != "1" ]; then
  log "Starting website dev server on :$WEB_PORT"
  (cd website && pnpm install --frozen-lockfile && pnpm dev -- --host 127.0.0.1 --port "$WEB_PORT" >/tmp/website.log 2>&1 & echo $! > /tmp/website.pid)
else
  log "Skipping website dev server (SKIP_WEBSITE=1)"
fi

log "Waiting for health checks"
for i in {1..60}; do
  OK=0
  TARGET=0
  if [ "$SKIP_LOCALNET" != "1" ]; then
    TARGET=$((TARGET+1))
    curl -sf http://127.0.0.1:8080/healthz >/dev/null && OK=$((OK+1))
  fi
  if [ "$SKIP_GATEWAY" != "1" ]; then
    TARGET=$((TARGET+1))
    curl -sf http://127.0.0.1:9010/healthz >/dev/null && OK=$((OK+1))
  fi
  if [ "$SKIP_AUTH" != "1" ]; then
    TARGET=$((TARGET+1))
    curl -sf http://127.0.0.1:4000/healthz >/dev/null && OK=$((OK+1))
  fi
  if [ "$SKIP_WEBSITE" != "1" ]; then
    TARGET=$((TARGET+1))
    curl -sf http://127.0.0.1:${WEB_PORT} >/dev/null && OK=$((OK+1))
  fi
  if [ "$OK" -ge "$TARGET" ]; then break; fi
  sleep 1
done

ready=()
[ "$SKIP_LOCALNET" != "1" ] && ready+=("simulator:8080" "convex:3210")
[ "$SKIP_GATEWAY" != "1" ] && ready+=("gateway:9010")
[ "$SKIP_AUTH" != "1" ] && ready+=("auth:4000")
[ "$SKIP_WEBSITE" != "1" ] && ready+=("website:${WEB_PORT}")
log "Ready. Services: ${ready[*]:-none}"
log "To stop: ./scripts/agent-down.sh"
