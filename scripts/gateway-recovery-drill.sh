#!/bin/bash
#
# Gateway Recovery Drill (US-018)
#
# Tests that when the gateway restarts:
# 1. Active clients receive SESSION_EXPIRED before disconnection
# 2. New connections work immediately after restart
#
# This script runs the automated unit tests that verify this behavior.
# For manual drills against a running network, see RUNBOOK.md Section 5.6.2.
#
# Usage:
#   ./scripts/gateway-recovery-drill.sh
#
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}=== Gateway Recovery Drill (US-018) ===${NC}"
echo
echo "This drill runs automated tests verifying gateway restart behavior."
echo "The tests validate:"
echo "  1. SESSION_EXPIRED notification sent before WebSocket close"
echo "  2. Session cleanup on idle timeout (graceful shutdown pattern)"
echo "  3. New connections work after sessions are destroyed"
echo

# Run the session expiration tests
echo -e "${GREEN}Running session expiration notification tests...${NC}"
echo
START_TIME=$(date +%s)
TEST_OUTPUT=$(pnpm --filter @nullspace/gateway test -- --run session-expiration-notification 2>&1)
TEST_EXIT_CODE=$?
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# Show last part of output
echo "$TEST_OUTPUT" | tail -40

echo
if [ $TEST_EXIT_CODE -eq 0 ]; then
    # Run health check tests to verify startup behavior
    echo -e "${GREEN}Running health check tests (readiness verification)...${NC}"
    echo
    HEALTH_OUTPUT=$(pnpm --filter @nullspace/gateway test -- --run health-check 2>&1)
    HEALTH_EXIT_CODE=$?

    echo "$HEALTH_OUTPUT" | tail -30
    echo

    if [ $HEALTH_EXIT_CODE -eq 0 ]; then
        echo -e "${GREEN}=== DRILL PASSED ===${NC}"
        echo
        echo "Test Results:"
        echo "  - Test duration: ${DURATION}s"
        echo "  - Session expiration: All tests passed"
        echo "  - Health endpoints: All tests passed"
        echo
        echo "Recovery Characteristics (documented in RUNBOOK.md §5.6.2):"
        echo "  - Client notification: SESSION_EXPIRED WebSocket close"
        echo "  - Session state: Lost (clients must re-register)"
        echo "  - Reconnection time: < 1 second (stateless gateway)"
        echo "  - Manual intervention: None required"
        echo
        echo "Graceful Shutdown Behavior:"
        echo "  - Drain mode: Rejects new connections (HTTP 503, WS 1013)"
        echo "  - Active games: Waits up to GATEWAY_DRAIN_TIMEOUT_MS (30s default)"
        echo "  - Final close: SESSION_EXPIRED sent, then WS close code 1001"
        echo
        echo "For manual recovery drills, see RUNBOOK.md Section 5.6.2."
        exit 0
    else
        echo -e "${RED}=== DRILL FAILED (health check tests) ===${NC}"
        exit 1
    fi
else
    echo -e "${RED}=== DRILL FAILED (session expiration tests) ===${NC}"
    echo
    echo "The session expiration notification tests failed."
    echo "Review the output above for details."
    exit 1
fi
