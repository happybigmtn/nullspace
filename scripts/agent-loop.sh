#!/usr/bin/env bash
set -euo pipefail

# End-to-end agent loop:
# 1) Bring up local stack (simulator/gateway/auth/convex/website)
# 2) Run quick verification suites (gateway integration, website smoke, perf budget)
# 3) Tear down stack
#
# Flags:
#   FAST=1           Skip heavy suites (only smoke + perf)
#   KEEP_UP=1        Leave services running after tests
#   SMOKE_BACKEND=mock|real  Choose smoke backend (default: mock for determinism)
#   E2E_SEED         Seed for mock backend determinism (default: 1)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAST="${FAST:-0}"
KEEP_UP="${KEEP_UP:-0}"
SMOKE_BACKEND="${SMOKE_BACKEND:-mock}"
E2E_SEED="${E2E_SEED:-1}"
SKIP_AUTH="${SKIP_AUTH:-1}"
SKIP_GATEWAY="${SKIP_GATEWAY:-0}"
SMOKE_PREVIEW="${SMOKE_PREVIEW:-1}"
SMOKE_SKIP_BUILD="${SMOKE_SKIP_BUILD:-0}"
SMOKE_KILL_PORT="${SMOKE_KILL_PORT:-0}"
SKIP_LOCALNET="${SKIP_LOCALNET:-0}"
SKIP_WEBSITE="${SKIP_WEBSITE:-1}"
WEB_PORT="${WEB_PORT:-3000}"

log() { printf "\033[1;36m[agent-loop]\033[0m %s\n" "$*"; }

cd "$ROOT_DIR"

if [ "$SMOKE_BACKEND" = "mock" ]; then
  SKIP_GATEWAY=1
  SKIP_WEBSITE=1
  SKIP_LOCALNET=1
  SMOKE_PREVIEW=1
  SMOKE_SKIP_BUILD=1
  SMOKE_KILL_PORT=1
fi

log "Starting services via agent-up.sh"
E2E_SEED="$E2E_SEED" SMOKE_BACKEND="$SMOKE_BACKEND" SKIP_AUTH="$SKIP_AUTH" SKIP_GATEWAY="$SKIP_GATEWAY" SKIP_WEBSITE="${SKIP_WEBSITE:-0}" SKIP_LOCALNET="$SKIP_LOCALNET" GATEWAY_SKIP_EVENT_WAIT=1 WEB_PORT="$WEB_PORT" ./scripts/agent-up.sh

EXIT_CODE=0
trap 'EXIT_CODE=$?; if [ "$KEEP_UP" != "1" ]; then ./scripts/agent-down.sh; fi; exit $EXIT_CODE' EXIT INT TERM

run_or_fail() {
  local cmd="$1"
  log "Running: $cmd"
  bash -lc "$cmd"
}

if [ "$FAST" != "1" ] && [ "$SKIP_GATEWAY" != "1" ]; then
  run_or_fail "GATEWAY_SKIP_EVENT_WAIT=1 pnpm -C gateway test:integration"
fi

if [ "${SKIP_WEBSITE:-0}" = "1" ]; then
  run_or_fail "SMOKE_BACKEND=${SMOKE_BACKEND} E2E_SEED=${E2E_SEED} SMOKE_PORT=4173 SMOKE_PREVIEW=${SMOKE_PREVIEW} SMOKE_PREVIEW_PORT=4180 SMOKE_SKIP_BUILD=${SMOKE_SKIP_BUILD} SMOKE_KILL_PORT=${SMOKE_KILL_PORT} npm -C website run smoke"
else
  run_or_fail "SMOKE_BACKEND=${SMOKE_BACKEND} E2E_SEED=${E2E_SEED} SMOKE_USE_EXISTING=1 SMOKE_BASE_URL=http://127.0.0.1:${WEB_PORT} SMOKE_PREVIEW_PORT=4180 npm -C website run smoke"
fi
run_or_fail "PREVIEW_PORT=4181 BASE_URL=http://127.0.0.1:4181 npm -C website run perf:budget"

log "Agent loop completed successfully"
