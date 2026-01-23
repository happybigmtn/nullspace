#!/bin/bash
# Comprehensive Casino Stress Test Runner
#
# Orchestrates all test phases as defined in COMPREHENSIVE_CASINO_TEST_SPEC.md
#
# Usage:
#   ./scripts/run-comprehensive-casino-test.sh              # Run all phases
#   ./scripts/run-comprehensive-casino-test.sh --phase 1    # Run specific phase
#   ./scripts/run-comprehensive-casino-test.sh --quick      # Quick smoke test
#   ./scripts/run-comprehensive-casino-test.sh --games      # Just game tests
#
# Environment variables:
#   STRESS_GATEWAY_URL    Gateway WebSocket URL (default: ws://localhost:9010)
#   STRESS_DURATION       Custom duration multiplier (default: 1.0)

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Configuration
GATEWAY_URL="${STRESS_GATEWAY_URL:-ws://localhost:9010}"
DURATION_MULTIPLIER="${STRESS_DURATION:-1.0}"
REPORT_DIR="stress-test-reports/$(date +%Y%m%d-%H%M%S)"
PHASE=""
QUICK_MODE=false
GAMES_ONLY=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --phase)
            PHASE="$2"
            shift 2
            ;;
        --quick)
            QUICK_MODE=true
            shift
            ;;
        --games)
            GAMES_ONLY=true
            shift
            ;;
        --gateway)
            GATEWAY_URL="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --phase <1-6>    Run specific phase only"
            echo "  --quick          Quick smoke test (reduced rounds)"
            echo "  --games          Run only game tests (Phase 2)"
            echo "  --gateway <url>  Gateway WebSocket URL"
            echo "  --help           Show this help"
            echo ""
            echo "Phases:"
            echo "  1: Baseline Functionality (30 min)"
            echo "  2: Single Game Tests (1 hour)"
            echo "  3: Load Tests (2 hours)"
            echo "  4: Stability Tests (1 hour)"
            echo "  5: Edge Case Tests (30 min)"
            echo "  6: Generate Report"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Setup report directory
mkdir -p "$REPORT_DIR"

# Header
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║       COMPREHENSIVE CASINO STRESS TEST SUITE                  ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}Gateway:${NC} $GATEWAY_URL"
echo -e "${CYAN}Report Dir:${NC} $REPORT_DIR"
echo -e "${CYAN}Started:${NC} $(date)"
echo ""

# Check gateway availability
echo -e "${YELLOW}Checking gateway availability...${NC}"
if ! timeout 10 bash -c "echo > /dev/tcp/${GATEWAY_URL#ws://}" 2>/dev/null; then
    echo -e "${RED}ERROR: Gateway not available at $GATEWAY_URL${NC}"
    echo "Please ensure the gateway is running before starting tests."
    exit 1
fi
echo -e "${GREEN}Gateway is available${NC}"
echo ""

# Export common environment
export RUN_STRESS=true
export STRESS_GATEWAY_URL="$GATEWAY_URL"

# Quick mode settings
if [ "$QUICK_MODE" = true ]; then
    echo -e "${YELLOW}Quick mode: Running with reduced iterations${NC}"
    export ROULETTE_SPINS=10
    export CRAPS_ROLLS=20
    export BLACKJACK_HANDS=10
    export BACCARAT_ROUNDS=10
    export SICBO_ROUNDS=10
    export VIDEOPOKER_HANDS=10
    export CASINOWAR_ROUNDS=10
    export HILO_ROUNDS=10
    export THREECARD_HANDS=10
    export ULTIMATE_HANDS=10
    export CONCURRENT_PLAYERS_PER_GAME=2
    export ROUNDS_PER_PLAYER=2
    export SUSTAINED_DURATION_MS=60000
    export PEAK_DURATION_MS=30000
    export STATE_TEST_ROUNDS=10
fi

# Phase functions
run_phase_1() {
    echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${BLUE}Phase 1: Baseline Functionality Tests${NC}"
    echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    # Run existing WebSocket stress test as baseline
    echo -e "${CYAN}Running WebSocket baseline test...${NC}"
    pnpm -C gateway test:stress -- --testPathPattern=websocket-stress 2>&1 | tee "$REPORT_DIR/phase1-websocket.log" || true

    echo -e "${GREEN}Phase 1 complete${NC}"
    echo ""
}

run_phase_2() {
    echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${BLUE}Phase 2: Single Game Tests${NC}"
    echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    GAMES=(
        "roulette"
        "craps"
        "blackjack"
        "baccarat"
        "sic-bo"
        "video-poker"
        "casino-war"
        "hilo"
        "three-card"
        "ultimate-texas"
    )

    for game in "${GAMES[@]}"; do
        echo -e "${CYAN}Testing $game...${NC}"
        pnpm -C gateway test:stress -- --testPathPattern="games/$game" 2>&1 | tee "$REPORT_DIR/phase2-$game.log" || true
        echo ""
    done

    echo -e "${GREEN}Phase 2 complete${NC}"
    echo ""
}

run_phase_3() {
    echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${BLUE}Phase 3: Load Tests${NC}"
    echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    echo -e "${CYAN}Running multi-game concurrent test...${NC}"
    pnpm -C gateway test:stress -- --testPathPattern=multi-game-concurrent 2>&1 | tee "$REPORT_DIR/phase3-concurrent.log" || true

    echo -e "${CYAN}Running sustained load test...${NC}"
    pnpm -C gateway test:stress -- --testPathPattern=sustained-load 2>&1 | tee "$REPORT_DIR/phase3-sustained.log" || true

    echo -e "${CYAN}Running peak load test...${NC}"
    pnpm -C gateway test:stress -- --testPathPattern=peak-load 2>&1 | tee "$REPORT_DIR/phase3-peak.log" || true

    echo -e "${GREEN}Phase 3 complete${NC}"
    echo ""
}

run_phase_4() {
    echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${BLUE}Phase 4: Stability Tests${NC}"
    echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    echo -e "${CYAN}Running state consistency tests...${NC}"
    pnpm -C gateway test:stress -- --testPathPattern=state-verification 2>&1 | tee "$REPORT_DIR/phase4-state.log" || true

    echo -e "${GREEN}Phase 4 complete${NC}"
    echo ""
}

run_phase_5() {
    echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${BLUE}Phase 5: Edge Case Tests${NC}"
    echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    echo -e "${CYAN}Running timing edge cases...${NC}"
    pnpm -C gateway test:stress -- --testPathPattern=edge-cases/timing 2>&1 | tee "$REPORT_DIR/phase5-timing.log" || true

    echo -e "${CYAN}Running balance edge cases...${NC}"
    pnpm -C gateway test:stress -- --testPathPattern=edge-cases/balance 2>&1 | tee "$REPORT_DIR/phase5-balance.log" || true

    echo -e "${GREEN}Phase 5 complete${NC}"
    echo ""
}

run_phase_6() {
    echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${BLUE}Phase 6: Generate Report${NC}"
    echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    # Generate summary report
    SUMMARY="$REPORT_DIR/SUMMARY.md"

    echo "# Casino Stress Test Summary" > "$SUMMARY"
    echo "" >> "$SUMMARY"
    echo "**Date:** $(date)" >> "$SUMMARY"
    echo "**Gateway:** $GATEWAY_URL" >> "$SUMMARY"
    echo "" >> "$SUMMARY"
    echo "## Test Results" >> "$SUMMARY"
    echo "" >> "$SUMMARY"

    # Count passes and failures
    PASS_COUNT=0
    FAIL_COUNT=0

    for log in "$REPORT_DIR"/*.log; do
        if [ -f "$log" ]; then
            name=$(basename "$log" .log)
            if grep -q "PASS\|✓" "$log" 2>/dev/null; then
                echo "- ✅ $name: PASS" >> "$SUMMARY"
                ((PASS_COUNT++))
            elif grep -q "FAIL\|✗\|Error" "$log" 2>/dev/null; then
                echo "- ❌ $name: FAIL" >> "$SUMMARY"
                ((FAIL_COUNT++))
            else
                echo "- ⚠️ $name: Unknown" >> "$SUMMARY"
            fi
        fi
    done

    echo "" >> "$SUMMARY"
    echo "## Summary" >> "$SUMMARY"
    echo "" >> "$SUMMARY"
    echo "- **Passed:** $PASS_COUNT" >> "$SUMMARY"
    echo "- **Failed:** $FAIL_COUNT" >> "$SUMMARY"
    echo "" >> "$SUMMARY"

    if [ $FAIL_COUNT -eq 0 ]; then
        echo "**Status:** ✅ All tests passed" >> "$SUMMARY"
    else
        echo "**Status:** ⚠️ Some tests failed" >> "$SUMMARY"
    fi

    echo -e "${GREEN}Report generated: $SUMMARY${NC}"
    cat "$SUMMARY"
    echo ""
}

# Main execution
START_TIME=$(date +%s)

if [ -n "$PHASE" ]; then
    # Run specific phase
    case $PHASE in
        1) run_phase_1 ;;
        2) run_phase_2 ;;
        3) run_phase_3 ;;
        4) run_phase_4 ;;
        5) run_phase_5 ;;
        6) run_phase_6 ;;
        *)
            echo -e "${RED}Invalid phase: $PHASE${NC}"
            exit 1
            ;;
    esac
elif [ "$GAMES_ONLY" = true ]; then
    run_phase_2
    run_phase_6
else
    # Run all phases
    run_phase_1
    run_phase_2
    run_phase_3
    run_phase_4
    run_phase_5
    run_phase_6
fi

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║                    TEST SUITE COMPLETE                         ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}Duration:${NC} $((DURATION / 60))m $((DURATION % 60))s"
echo -e "${CYAN}Reports:${NC} $REPORT_DIR"
echo ""
