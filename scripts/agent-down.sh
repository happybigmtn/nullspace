#!/bin/bash
set -euo pipefail

log() { printf "\033[1;31m[agent-down]\033[0m %s\n" "$*"; }

log "Stopping website/gateway/auth/localnet/convex"

for pidfile in /tmp/website.pid /tmp/gateway.pid /tmp/auth.pid /tmp/localnet.pid; do
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    kill "$pid" 2>/dev/null || true
    rm -f "$pidfile"
  fi
done

log "Stopping Convex"
docker compose --env-file docker/convex/.env -f docker/convex/docker-compose.yml down -v || true

log "Done"
