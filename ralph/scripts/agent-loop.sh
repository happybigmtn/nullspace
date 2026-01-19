#!/usr/bin/env bash
set -euo pipefail

# End-to-end agent loop with bootstrap guardrails.
# 1) Validates environment and config preconditions
# 2) Checks for port availability (avoids silent failures)
# 3) Boots local stack with deterministic seeds
# 4) Runs verification suites
# 5) Tears down stack
#
# AC-1.1: Single command boots local validator network, gateway, auth, ops, website
# AC-1.5: Returns non-zero on any failure; validates running stack
#
# Environment Variables:
#   FAST=1            Skip heavy suites (only website unit tests)
#   KEEP_UP=1         Leave services running after tests
#   SMOKE_BACKEND     mock|real (default: mock for determinism)
#   E2E_SEED          Seed for mock backend (default: 1)
#   QA_SIMPLE=1       Use minimal QA stack
#   SKIP_PORT_CHECK=1 Skip port availability checks

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RALPH_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$RALPH_DIR/.." && pwd)"

# Configuration
FAST="${FAST:-0}"
KEEP_UP="${KEEP_UP:-0}"
SMOKE_BACKEND="${SMOKE_BACKEND:-mock}"
E2E_SEED="${E2E_SEED:-1}"
QA_SIMPLE="${QA_SIMPLE:-0}"
SKIP_PORT_CHECK="${SKIP_PORT_CHECK:-0}"
WEB_PORT="${WEB_PORT:-3000}"
GATEWAY_PORT="${GATEWAY_PORT:-9010}"
AUTH_PORT="${AUTH_PORT:-4000}"
SIMULATOR_PORT="${SIMULATOR_PORT:-8080}"
CONVEX_PORT="${CONVEX_PORT:-3210}"

# Colors and logging
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[1;36m'
NC='\033[0m'

log()     { printf "${CYAN}[agent-loop]${NC} %s\n" "$*"; }
log_ok()  { printf "${GREEN}[agent-loop]${NC} %s\n" "$*"; }
log_warn(){ printf "${YELLOW}[agent-loop]${NC} %s\n" "$*"; }
log_err() { printf "${RED}[agent-loop]${NC} %s\n" "$*" >&2; }

# ─────────────────────────────────────────────────────────────────────────────
# Guardrail: Check required commands
# ─────────────────────────────────────────────────────────────────────────────
check_required_commands() {
    local missing=()
    for cmd in cargo pnpm docker curl; do
        if ! command -v "$cmd" &>/dev/null; then
            missing+=("$cmd")
        fi
    done
    if [ ${#missing[@]} -gt 0 ]; then
        log_err "Missing required commands: ${missing[*]}"
        log_err "Please install them before running this script."
        exit 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Guardrail: Validate config files exist
# ─────────────────────────────────────────────────────────────────────────────
check_config_files() {
    local CONFIG_DIR="${CONFIG_DIR:-$ROOT_DIR/configs/local}"
    local errors=0

    log "Checking config directory: $CONFIG_DIR"

    # Template files must exist (used to create .env.local if missing)
    if [ ! -f "$CONFIG_DIR/.env.local.example" ] && [ ! -f "$CONFIG_DIR/.env.local" ] && [ ! -f "$CONFIG_DIR/.env.automation" ]; then
        log_warn "No env template found in $CONFIG_DIR"
        log_warn "Expected one of: .env.local, .env.local.example, .env.automation"
        errors=$((errors + 1))
    fi

    # If using real backend, validator configs are required
    if [ "$SMOKE_BACKEND" = "real" ] && [ ! -f "$CONFIG_DIR/node0.yaml" ]; then
        log_warn "Validator config not found: $CONFIG_DIR/node0.yaml"
        log_warn "Run: cargo run --bin generate-keys -- --nodes 1 --output $CONFIG_DIR"
        errors=$((errors + 1))
    fi

    if [ "$errors" -gt 0 ]; then
        log_err "Config validation failed with $errors error(s)"
        log_err "Fix the above issues or run with SMOKE_BACKEND=mock to skip validator setup"
        exit 1
    fi

    log_ok "Config validation passed"
}

# ─────────────────────────────────────────────────────────────────────────────
# Guardrail: Check if ports are available (port reuse handling)
# ─────────────────────────────────────────────────────────────────────────────
check_port() {
    local port="$1"
    local name="$2"
    if nc -z 127.0.0.1 "$port" 2>/dev/null; then
        return 1  # Port in use
    fi
    return 0  # Port available
}

check_port_availability() {
    if [ "$SKIP_PORT_CHECK" = "1" ]; then
        log "Skipping port checks (SKIP_PORT_CHECK=1)"
        return 0
    fi

    local ports_in_use=()

    # Only check ports for services we're starting
    if [ "$SMOKE_BACKEND" != "mock" ]; then
        if ! check_port "$WEB_PORT" "website"; then
            ports_in_use+=("$WEB_PORT (website)")
        fi
        if ! check_port "$GATEWAY_PORT" "gateway"; then
            ports_in_use+=("$GATEWAY_PORT (gateway)")
        fi
        if ! check_port "$AUTH_PORT" "auth"; then
            ports_in_use+=("$AUTH_PORT (auth)")
        fi
        if ! check_port "$SIMULATOR_PORT" "simulator"; then
            ports_in_use+=("$SIMULATOR_PORT (simulator)")
        fi
        if ! check_port "$CONVEX_PORT" "convex"; then
            ports_in_use+=("$CONVEX_PORT (convex)")
        fi
    fi

    if [ ${#ports_in_use[@]} -gt 0 ]; then
        log_err "The following ports are already in use:"
        for p in "${ports_in_use[@]}"; do
            log_err "  - $p"
        done
        log_err ""
        log_err "Resolution options:"
        log_err "  1) Stop existing services: ./scripts/agent-down.sh"
        log_err "  2) Use different ports: WEB_PORT=3001 GATEWAY_PORT=9011 $0"
        log_err "  3) Skip check (risky): SKIP_PORT_CHECK=1 $0"
        exit 1
    fi

    log_ok "Port availability check passed"
}

# ─────────────────────────────────────────────────────────────────────────────
# Guardrail: Check docker is running
# ─────────────────────────────────────────────────────────────────────────────
check_docker() {
    if [ "$SMOKE_BACKEND" = "mock" ]; then
        return 0
    fi

    if ! docker info &>/dev/null; then
        log_err "Docker daemon is not running."
        log_err "Start Docker and try again, or use SMOKE_BACKEND=mock"
        exit 1
    fi
    log_ok "Docker is running"
}

# ─────────────────────────────────────────────────────────────────────────────
# Run test suite
# ─────────────────────────────────────────────────────────────────────────────
run_or_fail() {
    local cmd="$1"
    log "Running: $cmd"
    if ! bash -lc "$cmd"; then
        log_err "Command failed: $cmd"
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
main() {
    log "Starting agent loop (SMOKE_BACKEND=$SMOKE_BACKEND, E2E_SEED=$E2E_SEED)"
    log "Ralph directory: $RALPH_DIR"
    log "Root directory: $ROOT_DIR"

    # Run all guardrails
    check_required_commands
    check_config_files
    check_docker
    check_port_availability

    cd "$ROOT_DIR"

    # Delegate to parent scripts/agent-loop.sh with our validated env
    log "Delegating to parent agent-loop.sh"
    E2E_SEED="$E2E_SEED" \
    SMOKE_BACKEND="$SMOKE_BACKEND" \
    FAST="$FAST" \
    KEEP_UP="$KEEP_UP" \
    QA_SIMPLE="$QA_SIMPLE" \
    WEB_PORT="$WEB_PORT" \
    exec "$ROOT_DIR/scripts/agent-loop.sh"
}

main "$@"
