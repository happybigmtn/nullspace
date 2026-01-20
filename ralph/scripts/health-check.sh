#!/usr/bin/env bash
set -euo pipefail

# Health Check Script for Local Stack
# Validates that all expected services are running and healthy.
# Returns non-zero on any failure (AC-1.5).
#
# Usage:
#   ./scripts/health-check.sh          # Check all services
#   ./scripts/health-check.sh --quick  # Quick check (endpoints only)
#   ./scripts/health-check.sh --remote # Check staging endpoints
#
# Environment Variables:
#   SKIP_SIMULATOR=1   Skip simulator health check
#   SKIP_GATEWAY=1     Skip gateway health check
#   SKIP_AUTH=1        Skip auth service health check
#   SKIP_WEBSITE=1     Skip website health check
#   SKIP_CONVEX=1      Skip convex health check
#   TIMEOUT=5          Curl timeout in seconds

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RALPH_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$RALPH_DIR/.." && pwd)"

# Configuration
TIMEOUT="${TIMEOUT:-5}"
QUICK_MODE=0
REMOTE_MODE=0

# Default ports for local stack
WEB_PORT="${WEB_PORT:-3000}"
GATEWAY_PORT="${GATEWAY_PORT:-9010}"
AUTH_PORT="${AUTH_PORT:-4000}"
SIMULATOR_PORT="${SIMULATOR_PORT:-8080}"
CONVEX_PORT="${CONVEX_PORT:-3210}"

# Skip flags (default to checking everything)
SKIP_SIMULATOR="${SKIP_SIMULATOR:-0}"
SKIP_GATEWAY="${SKIP_GATEWAY:-0}"
SKIP_AUTH="${SKIP_AUTH:-0}"
SKIP_WEBSITE="${SKIP_WEBSITE:-0}"
SKIP_CONVEX="${SKIP_CONVEX:-0}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[1;36m'
NC='\033[0m'

# Track overall health
ALL_HEALTHY=true
CHECKS_RUN=0
CHECKS_PASSED=0

# ─────────────────────────────────────────────────────────────────────────────
# Check endpoint health
# ─────────────────────────────────────────────────────────────────────────────
check_endpoint() {
    local name="$1"
    local url="$2"
    local extra_args="${3:-}"

    CHECKS_RUN=$((CHECKS_RUN + 1))
    printf "  %-20s " "$name"

    local http_code
    if http_code=$(eval "curl -s -f -L --max-time $TIMEOUT $extra_args -o /dev/null -w '%{http_code}' '$url'" 2>/dev/null); then
        printf "${GREEN}OK${NC} (HTTP $http_code)\n"
        CHECKS_PASSED=$((CHECKS_PASSED + 1))
        return 0
    else
        printf "${RED}FAIL${NC}\n"
        ALL_HEALTHY=false
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Check if port is listening
# ─────────────────────────────────────────────────────────────────────────────
check_port_listening() {
    local name="$1"
    local port="$2"

    CHECKS_RUN=$((CHECKS_RUN + 1))
    printf "  %-20s " "$name (port $port)"

    if nc -z 127.0.0.1 "$port" 2>/dev/null; then
        printf "${GREEN}LISTENING${NC}\n"
        CHECKS_PASSED=$((CHECKS_PASSED + 1))
        return 0
    else
        printf "${RED}NOT LISTENING${NC}\n"
        ALL_HEALTHY=false
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Check process is running (by PID file)
# ─────────────────────────────────────────────────────────────────────────────
check_process() {
    local name="$1"
    local pidfile="$2"

    CHECKS_RUN=$((CHECKS_RUN + 1))
    printf "  %-20s " "$name (pid)"

    if [ -f "$pidfile" ]; then
        local pid
        pid=$(cat "$pidfile")
        if kill -0 "$pid" 2>/dev/null; then
            printf "${GREEN}RUNNING${NC} (PID $pid)\n"
            CHECKS_PASSED=$((CHECKS_PASSED + 1))
            return 0
        else
            printf "${RED}DEAD${NC} (stale PID $pid)\n"
            ALL_HEALTHY=false
            return 1
        fi
    else
        printf "${YELLOW}NO PIDFILE${NC}\n"
        # Not a failure - service might not have been started
        return 0
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Local stack health checks
# ─────────────────────────────────────────────────────────────────────────────
check_local_stack() {
    echo ""
    printf "${CYAN}Local Stack Health Check${NC}\n"
    echo "=========================================="
    echo "Started at: $(date)"
    echo ""

    # Simulator/Indexer (AC-4.6: health and metrics endpoints)
    if [ "$SKIP_SIMULATOR" != "1" ]; then
        echo "Simulator/Indexer:"
        check_port_listening "simulator" "$SIMULATOR_PORT" || true
        check_endpoint "simulator /healthz" "http://127.0.0.1:$SIMULATOR_PORT/healthz" || true
        check_endpoint "simulator /livez" "http://127.0.0.1:$SIMULATOR_PORT/livez" || true
        check_endpoint "simulator /readyz" "http://127.0.0.1:$SIMULATOR_PORT/readyz" || true
        check_endpoint "simulator /health" "http://127.0.0.1:$SIMULATOR_PORT/health" || true
        check_process "simulator" "/tmp/localnet.pid" || true
        echo ""
    fi

    # Gateway
    if [ "$SKIP_GATEWAY" != "1" ]; then
        echo "Gateway:"
        check_port_listening "gateway" "$GATEWAY_PORT" || true
        check_endpoint "gateway /healthz" "http://127.0.0.1:$GATEWAY_PORT/healthz" || true
        check_process "gateway" "/tmp/gateway.pid" || true
        echo ""
    fi

    # Auth
    if [ "$SKIP_AUTH" != "1" ]; then
        echo "Auth Service:"
        check_port_listening "auth" "$AUTH_PORT" || true
        check_endpoint "auth /healthz" "http://127.0.0.1:$AUTH_PORT/healthz" || true
        check_process "auth" "/tmp/auth.pid" || true
        echo ""
    fi

    # Website
    if [ "$SKIP_WEBSITE" != "1" ]; then
        echo "Website:"
        check_port_listening "website" "$WEB_PORT" || true
        check_endpoint "website root" "http://127.0.0.1:$WEB_PORT" || true
        check_process "website" "/tmp/website.pid" || true
        echo ""
    fi

    # Convex
    if [ "$SKIP_CONVEX" != "1" ]; then
        echo "Convex:"
        check_port_listening "convex" "$CONVEX_PORT" || true
        # Convex may not have a healthz endpoint
        echo ""
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Quick mode - just check if ports are listening
# ─────────────────────────────────────────────────────────────────────────────
check_quick() {
    echo ""
    printf "${CYAN}Quick Health Check (ports only)${NC}\n"
    echo "=========================================="

    [ "$SKIP_SIMULATOR" != "1" ] && check_port_listening "simulator" "$SIMULATOR_PORT" || true
    [ "$SKIP_GATEWAY" != "1" ] && check_port_listening "gateway" "$GATEWAY_PORT" || true
    [ "$SKIP_AUTH" != "1" ] && check_port_listening "auth" "$AUTH_PORT" || true
    [ "$SKIP_WEBSITE" != "1" ] && check_port_listening "website" "$WEB_PORT" || true
    [ "$SKIP_CONVEX" != "1" ] && check_port_listening "convex" "$CONVEX_PORT" || true
}

# ─────────────────────────────────────────────────────────────────────────────
# Remote mode - check staging/production endpoints
# ─────────────────────────────────────────────────────────────────────────────
check_remote() {
    # Delegate to parent health-check.sh for remote checks
    exec "$ROOT_DIR/scripts/health-check.sh"
}

# ─────────────────────────────────────────────────────────────────────────────
# Parse arguments
# ─────────────────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --quick)
            QUICK_MODE=1
            shift
            ;;
        --remote)
            REMOTE_MODE=1
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --quick    Quick check (ports only)"
            echo "  --remote   Check remote staging endpoints"
            echo "  --help     Show this help"
            echo ""
            echo "Environment:"
            echo "  SKIP_SIMULATOR=1  Skip simulator checks"
            echo "  SKIP_GATEWAY=1    Skip gateway checks"
            echo "  SKIP_AUTH=1       Skip auth checks"
            echo "  SKIP_WEBSITE=1    Skip website checks"
            echo "  SKIP_CONVEX=1     Skip convex checks"
            echo "  TIMEOUT=5         Curl timeout seconds"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
main() {
    if [ "$REMOTE_MODE" = "1" ]; then
        check_remote
        exit $?
    fi

    if [ "$QUICK_MODE" = "1" ]; then
        check_quick
    else
        check_local_stack
    fi

    echo "=========================================="
    echo "Summary: $CHECKS_PASSED/$CHECKS_RUN checks passed"

    if [ "$ALL_HEALTHY" = true ]; then
        printf "${GREEN}All health checks passed!${NC}\n"
        exit 0
    else
        printf "${RED}Some health checks failed!${NC}\n"
        exit 1
    fi
}

main
