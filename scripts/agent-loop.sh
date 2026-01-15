#!/usr/bin/env bash
set -euo pipefail

# End-to-end agent loop:
# 1) Bring up local stack (simulator/gateway/auth/convex/website)
# 2) Run quick verification suites (gateway integration, website unit tests)
# 3) Tear down stack
#
# Flags:
#   FAST=1           Skip heavy suites (only website unit tests)
#   KEEP_UP=1        Leave services running after tests
#   SMOKE_BACKEND=mock|real  Choose smoke backend (default: mock for determinism)
#   E2E_SEED         Seed for mock backend determinism (default: 1)
#   QA_SIMPLE=1      Use minimal QA stack (simulator + single node + website)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAST="${FAST:-0}"
KEEP_UP="${KEEP_UP:-0}"
SMOKE_BACKEND="${SMOKE_BACKEND:-mock}"
E2E_SEED="${E2E_SEED:-1}"
QA_SIMPLE="${QA_SIMPLE:-0}"
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

if [ "$QA_SIMPLE" = "1" ]; then
  log "Starting services via qa-simplify-up.sh"
  WEB_PORT="$WEB_PORT" ./scripts/qa-simplify-up.sh
  EXIT_CODE=0
  trap 'EXIT_CODE=$?; if [ "$KEEP_UP" != "1" ]; then ./scripts/qa-simplify-down.sh; fi; exit $EXIT_CODE' EXIT INT TERM
else
  log "Starting services via agent-up.sh"
  E2E_SEED="$E2E_SEED" SMOKE_BACKEND="$SMOKE_BACKEND" SKIP_AUTH="$SKIP_AUTH" SKIP_GATEWAY="$SKIP_GATEWAY" SKIP_WEBSITE="${SKIP_WEBSITE:-0}" SKIP_LOCALNET="$SKIP_LOCALNET" GATEWAY_SKIP_EVENT_WAIT=1 WEB_PORT="$WEB_PORT" ./scripts/agent-up.sh
  EXIT_CODE=0
  trap 'EXIT_CODE=$?; if [ "$KEEP_UP" != "1" ]; then ./scripts/agent-down.sh; fi; exit $EXIT_CODE' EXIT INT TERM
fi

run_or_fail() {
  local cmd="$1"
  log "Running: $cmd"
  bash -lc "$cmd"
}

if [ "$QA_SIMPLE" = "1" ]; then
  run_or_fail "npm -C website run test:unit"
else
  if [ "$FAST" != "1" ] && [ "$SKIP_GATEWAY" != "1" ]; then
    run_or_fail "GATEWAY_SKIP_EVENT_WAIT=1 pnpm -C gateway test:integration"
  fi

  run_or_fail "npm -C website run test:unit"
fi

log "Agent loop completed successfully"
