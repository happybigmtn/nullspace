#!/usr/bin/env bash
set -euo pipefail

# Load Test Harness for Gateway and Engine (AC-9.1)
#
# Exercises gateway WebSocket and engine HTTP API concurrency targets
# and reports pass/fail based on configurable thresholds.
#
# Usage:
#   ./scripts/load-test.sh                     # Run all load tests
#   ./scripts/load-test.sh --gateway-only      # Test gateway only
#   ./scripts/load-test.sh --engine-only       # Test engine only
#   ./scripts/load-test.sh --quick             # Quick test (lower targets)
#   ./scripts/load-test.sh --report FILE       # Write JSON report to FILE
#
# Environment Variables:
#   # Gateway targets
#   GATEWAY_URL=ws://localhost:9010           # Gateway WebSocket URL
#   GATEWAY_CONNECTIONS_TARGET=500            # Target concurrent connections
#   GATEWAY_P99_LATENCY_TARGET_MS=100         # P99 latency threshold (ms)
#   GATEWAY_SUCCESS_RATE_TARGET=0.95          # Min connection success rate
#
#   # Engine targets
#   ENGINE_URL=http://localhost:8080          # Engine HTTP URL
#   ENGINE_RPS_TARGET=100                     # Requests per second target
#   ENGINE_P99_LATENCY_TARGET_MS=200          # P99 latency threshold (ms)
#   ENGINE_ERROR_RATE_TARGET=0.01             # Max error rate
#
#   # General
#   LOAD_TEST_DURATION_S=30                   # Test duration in seconds
#   REPORT_FILE=load-test-report.json         # Output report path
#   VERBOSE=1                                 # Enable verbose output

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─────────────────────────────────────────────────────────────────────────────
# Configuration with defaults
# ─────────────────────────────────────────────────────────────────────────────

# Gateway configuration
GATEWAY_URL="${GATEWAY_URL:-ws://localhost:9010}"
GATEWAY_CONNECTIONS_TARGET="${GATEWAY_CONNECTIONS_TARGET:-500}"
GATEWAY_P99_LATENCY_TARGET_MS="${GATEWAY_P99_LATENCY_TARGET_MS:-100}"
GATEWAY_SUCCESS_RATE_TARGET="${GATEWAY_SUCCESS_RATE_TARGET:-0.95}"
GATEWAY_MESSAGE_ROUNDS="${GATEWAY_MESSAGE_ROUNDS:-5}"

# Engine configuration
ENGINE_URL="${ENGINE_URL:-http://localhost:8080}"
ENGINE_RPS_TARGET="${ENGINE_RPS_TARGET:-100}"
ENGINE_P99_LATENCY_TARGET_MS="${ENGINE_P99_LATENCY_TARGET_MS:-200}"
ENGINE_ERROR_RATE_TARGET="${ENGINE_ERROR_RATE_TARGET:-0.01}"

# General configuration
LOAD_TEST_DURATION_S="${LOAD_TEST_DURATION_S:-30}"
REPORT_FILE="${REPORT_FILE:-load-test-report.json}"
VERBOSE="${VERBOSE:-0}"

# Flags
TEST_GATEWAY=1
TEST_ENGINE=1
QUICK_MODE=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[1;36m'
BOLD='\033[1m'
NC='\033[0m'

# Results tracking
GATEWAY_PASSED=0
ENGINE_PASSED=0
GATEWAY_RESULTS=""
ENGINE_RESULTS=""
OVERALL_PASS=0

# ─────────────────────────────────────────────────────────────────────────────
# Argument parsing
# ─────────────────────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case "$1" in
        --gateway-only)
            TEST_ENGINE=0
            shift
            ;;
        --engine-only)
            TEST_GATEWAY=0
            shift
            ;;
        --quick)
            QUICK_MODE=1
            GATEWAY_CONNECTIONS_TARGET=100
            ENGINE_RPS_TARGET=50
            LOAD_TEST_DURATION_S=10
            GATEWAY_MESSAGE_ROUNDS=2
            shift
            ;;
        --report)
            REPORT_FILE="$2"
            shift 2
            ;;
        --verbose|-v)
            VERBOSE=1
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --gateway-only    Test gateway WebSocket only"
            echo "  --engine-only     Test engine HTTP API only"
            echo "  --quick           Quick test with lower targets"
            echo "  --report FILE     Write JSON report to FILE"
            echo "  --verbose, -v     Enable verbose output"
            echo "  --help, -h        Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# ─────────────────────────────────────────────────────────────────────────────
# Helper functions
# ─────────────────────────────────────────────────────────────────────────────

log() {
    echo -e "$@"
}

log_verbose() {
    if [[ "$VERBOSE" == "1" ]]; then
        echo -e "$@"
    fi
}

timestamp() {
    date -u +"%Y-%m-%dT%H:%M:%SZ"
}

check_command() {
    if ! command -v "$1" &> /dev/null; then
        log "${RED}Error: $1 is required but not installed${NC}"
        exit 1
    fi
}

# Floating-point arithmetic using awk
calc() {
    awk "BEGIN { printf \"%.4f\", $* }"
}

# Compare two floats: returns 0 if a < b
float_lt() {
    awk -v a="$1" -v b="$2" 'BEGIN { exit (a < b) ? 0 : 1 }'
}

# Compare two floats: returns 0 if a >= b
float_ge() {
    awk -v a="$1" -v b="$2" 'BEGIN { exit (a >= b) ? 0 : 1 }'
}

# Compare two floats: returns 0 if a <= b
float_le() {
    awk -v a="$1" -v b="$2" 'BEGIN { exit (a <= b) ? 0 : 1 }'
}

# ─────────────────────────────────────────────────────────────────────────────
# Gateway WebSocket Load Test
# ─────────────────────────────────────────────────────────────────────────────

test_gateway() {
    log ""
    log "${CYAN}${BOLD}═══════════════════════════════════════════════════════════════════${NC}"
    log "${CYAN}${BOLD} Gateway WebSocket Load Test${NC}"
    log "${CYAN}${BOLD}═══════════════════════════════════════════════════════════════════${NC}"
    log ""
    log "  URL:              $GATEWAY_URL"
    log "  Connections:      $GATEWAY_CONNECTIONS_TARGET"
    log "  P99 Target:       ${GATEWAY_P99_LATENCY_TARGET_MS}ms"
    log "  Success Rate:     ${GATEWAY_SUCCESS_RATE_TARGET}"
    log ""

    # Run the gateway stress test via npm
    log "  Running WebSocket stress test..."
    local start_time=$(date +%s)

    local test_output
    local test_exit=0

    # Set environment and run stress test
    export STRESS_CONNECTIONS="$GATEWAY_CONNECTIONS_TARGET"
    export STRESS_GATEWAY_URL="$GATEWAY_URL"
    export P99_LATENCY_TARGET_MS="$GATEWAY_P99_LATENCY_TARGET_MS"
    export MESSAGE_ROUNDS="$GATEWAY_MESSAGE_ROUNDS"
    export RUN_STRESS="true"

    # Run the vitest stress test and capture output
    test_output=$(cd "$ROOT_DIR/gateway" && pnpm exec vitest run tests/stress/websocket-stress.test.ts --reporter=json 2>&1) || test_exit=$?

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    # Parse results from JSON output
    local passed=0
    local failed=0
    local p99_latency=0
    local success_rate=0

    # Try to extract test results from JSON
    if echo "$test_output" | grep -q '"numPassedTests"'; then
        passed=$(echo "$test_output" | grep -o '"numPassedTests":[0-9]*' | grep -o '[0-9]*' | head -1 || echo "0")
        failed=$(echo "$test_output" | grep -o '"numFailedTests":[0-9]*' | grep -o '[0-9]*' | head -1 || echo "0")
    fi

    # Extract metrics from console output
    if echo "$test_output" | grep -q "P99:"; then
        p99_latency=$(echo "$test_output" | grep "P99:" | head -1 | grep -oE '[0-9]+\.?[0-9]*' | head -1 || echo "0")
    fi

    if echo "$test_output" | grep -q "Successful:"; then
        local successful=$(echo "$test_output" | grep "Successful:" | head -1 | grep -oE '[0-9]+' | head -1 || echo "0")
        local total=$(echo "$test_output" | grep "Total connections:" | head -1 | grep -oE '[0-9]+' | head -1 || echo "$GATEWAY_CONNECTIONS_TARGET")
        if [[ "$total" -gt 0 ]]; then
            success_rate=$(calc "$successful / $total")
        fi
    fi

    log ""
    log "  ${BOLD}Results:${NC}"
    log "  ────────────────────────────────"

    # Determine pass/fail
    local p99_pass=0
    local rate_pass=0

    if float_lt "$p99_latency" "$GATEWAY_P99_LATENCY_TARGET_MS"; then
        p99_pass=1
        log "  P99 Latency:      ${GREEN}${p99_latency}ms${NC} (target: <${GATEWAY_P99_LATENCY_TARGET_MS}ms) ✓"
    else
        log "  P99 Latency:      ${RED}${p99_latency}ms${NC} (target: <${GATEWAY_P99_LATENCY_TARGET_MS}ms) ✗"
    fi

    if float_ge "$success_rate" "$GATEWAY_SUCCESS_RATE_TARGET"; then
        rate_pass=1
        log "  Success Rate:     ${GREEN}${success_rate}${NC} (target: >=${GATEWAY_SUCCESS_RATE_TARGET}) ✓"
    else
        log "  Success Rate:     ${RED}${success_rate}${NC} (target: >=${GATEWAY_SUCCESS_RATE_TARGET}) ✗"
    fi

    log "  Test Duration:    ${duration}s"
    log "  Tests Passed:     $passed"
    log "  Tests Failed:     $failed"

    # Overall gateway result
    if [[ $test_exit -eq 0 && $p99_pass -eq 1 && $rate_pass -eq 1 ]]; then
        GATEWAY_PASSED=1
        log ""
        log "  ${GREEN}${BOLD}GATEWAY: PASS${NC}"
    else
        GATEWAY_PASSED=0
        log ""
        log "  ${RED}${BOLD}GATEWAY: FAIL${NC}"
    fi

    # Store results for report
    GATEWAY_RESULTS=$(cat <<EOF
{
    "component": "gateway",
    "passed": $( [[ $GATEWAY_PASSED -eq 1 ]] && echo "true" || echo "false" ),
    "metrics": {
        "connections_target": $GATEWAY_CONNECTIONS_TARGET,
        "p99_latency_ms": $p99_latency,
        "p99_target_ms": $GATEWAY_P99_LATENCY_TARGET_MS,
        "success_rate": $success_rate,
        "success_rate_target": $GATEWAY_SUCCESS_RATE_TARGET
    },
    "tests_passed": $passed,
    "tests_failed": $failed,
    "duration_s": $duration
}
EOF
)
}

# ─────────────────────────────────────────────────────────────────────────────
# Engine HTTP API Load Test
# ─────────────────────────────────────────────────────────────────────────────

test_engine() {
    log ""
    log "${CYAN}${BOLD}═══════════════════════════════════════════════════════════════════${NC}"
    log "${CYAN}${BOLD} Engine HTTP API Load Test${NC}"
    log "${CYAN}${BOLD}═══════════════════════════════════════════════════════════════════${NC}"
    log ""
    log "  URL:              $ENGINE_URL"
    log "  RPS Target:       $ENGINE_RPS_TARGET"
    log "  P99 Target:       ${ENGINE_P99_LATENCY_TARGET_MS}ms"
    log "  Error Rate Max:   ${ENGINE_ERROR_RATE_TARGET}"
    log "  Duration:         ${LOAD_TEST_DURATION_S}s"
    log ""

    # Check if engine is available
    if ! curl -s --max-time 5 "$ENGINE_URL/healthz" > /dev/null 2>&1; then
        log "  ${YELLOW}Warning: Engine not responding at $ENGINE_URL/healthz${NC}"
        log "  ${YELLOW}Skipping engine load test${NC}"
        ENGINE_PASSED=0
        ENGINE_RESULTS=$(cat <<EOF
{
    "component": "engine",
    "passed": false,
    "error": "Engine not available at $ENGINE_URL",
    "metrics": {}
}
EOF
)
        return
    fi

    log "  Running HTTP load test..."
    local start_time=$(date +%s)

    # Calculate requests based on duration and target RPS
    local total_target_requests=$((ENGINE_RPS_TARGET * LOAD_TEST_DURATION_S))
    local batch_size=$ENGINE_RPS_TARGET
    local batches=$LOAD_TEST_DURATION_S

    log "  Target requests:  $total_target_requests"
    log ""

    # Create temp files for latency data
    local latency_file=$(mktemp)
    local success_file=$(mktemp)
    local fail_file=$(mktemp)
    echo "0" > "$success_file"
    echo "0" > "$fail_file"

    # Run load test in batches (one batch per second)
    for ((batch=0; batch<batches; batch++)); do
        # Show progress
        if [[ $((batch % 5)) -eq 0 ]]; then
            log_verbose "    Batch $batch/$batches..."
        fi

        # Fire off batch_size parallel requests
        for ((i=0; i<batch_size; i++)); do
            (
                local req_start=$(date +%s%N)
                local http_code
                http_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$ENGINE_URL/healthz" 2>/dev/null) || http_code="000"
                local req_end=$(date +%s%N)
                local latency_ns=$((req_end - req_start))
                local latency_ms=$((latency_ns / 1000000))

                echo "$latency_ms" >> "$latency_file"

                if [[ "$http_code" == "200" ]]; then
                    flock "$success_file" bash -c 'n=$(cat '"$success_file"'); echo $((n+1)) > '"$success_file"
                else
                    flock "$fail_file" bash -c 'n=$(cat '"$fail_file"'); echo $((n+1)) > '"$fail_file"
                fi
            ) &
        done

        # Wait for batch to complete, then sleep to pace
        wait
        sleep 0.9  # Leave 0.1s for curl overhead
    done

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    if [[ $duration -eq 0 ]]; then duration=1; fi

    # Collect results
    local successful_requests=$(cat "$success_file")
    local failed_requests=$(cat "$fail_file")
    local total_requests=$((successful_requests + failed_requests))

    # Calculate latency percentiles
    mapfile -t sorted_latencies < <(sort -n "$latency_file")
    local n=${#sorted_latencies[@]}

    local p50=0
    local p95=0
    local p99=0
    local avg=0
    local max_lat=0
    local min_lat=0

    if [[ $n -gt 0 ]]; then
        p50="${sorted_latencies[$((n * 50 / 100))]:-0}"
        p95="${sorted_latencies[$((n * 95 / 100))]:-0}"
        p99="${sorted_latencies[$((n * 99 / 100))]:-0}"
        max_lat="${sorted_latencies[$((n - 1))]:-0}"
        min_lat="${sorted_latencies[0]:-0}"

        # Calculate average
        local sum=0
        for lat in "${sorted_latencies[@]}"; do
            sum=$((sum + lat))
        done
        avg=$((sum / n))
    fi

    # Calculate actual RPS and error rate
    local actual_rps=$(calc "$total_requests / $duration")
    local error_rate=0
    if [[ $total_requests -gt 0 ]]; then
        error_rate=$(calc "$failed_requests / $total_requests")
    fi

    # Clean up temp files
    rm -f "$latency_file" "$success_file" "$fail_file"

    log "  ${BOLD}Results:${NC}"
    log "  ────────────────────────────────"
    log "  Total Requests:   $total_requests"
    log "  Successful:       $successful_requests"
    log "  Failed:           $failed_requests"
    log "  Actual RPS:       $actual_rps"
    log ""
    log "  ${BOLD}Latency (ms):${NC}"
    log "    P50:            $p50"
    log "    P95:            $p95"
    log "    P99:            $p99"
    log "    Avg:            $avg"
    log "    Min:            $min_lat"
    log "    Max:            $max_lat"
    log ""

    # Determine pass/fail
    local p99_pass=0
    local error_pass=0
    local rps_pass=0

    if [[ $p99 -lt $ENGINE_P99_LATENCY_TARGET_MS ]]; then
        p99_pass=1
        log "  P99 Latency:      ${GREEN}${p99}ms${NC} (target: <${ENGINE_P99_LATENCY_TARGET_MS}ms) ✓"
    else
        log "  P99 Latency:      ${RED}${p99}ms${NC} (target: <${ENGINE_P99_LATENCY_TARGET_MS}ms) ✗"
    fi

    if float_le "$error_rate" "$ENGINE_ERROR_RATE_TARGET"; then
        error_pass=1
        log "  Error Rate:       ${GREEN}${error_rate}${NC} (target: <=${ENGINE_ERROR_RATE_TARGET}) ✓"
    else
        log "  Error Rate:       ${RED}${error_rate}${NC} (target: <=${ENGINE_ERROR_RATE_TARGET}) ✗"
    fi

    # RPS check (allow 10% variance)
    local rps_threshold=$(calc "$ENGINE_RPS_TARGET * 0.9")
    if float_ge "$actual_rps" "$rps_threshold"; then
        rps_pass=1
        log "  Actual RPS:       ${GREEN}${actual_rps}${NC} (target: >=${rps_threshold}) ✓"
    else
        log "  Actual RPS:       ${RED}${actual_rps}${NC} (target: >=${rps_threshold}) ✗"
    fi

    # Overall engine result
    if [[ $p99_pass -eq 1 && $error_pass -eq 1 && $rps_pass -eq 1 ]]; then
        ENGINE_PASSED=1
        log ""
        log "  ${GREEN}${BOLD}ENGINE: PASS${NC}"
    else
        ENGINE_PASSED=0
        log ""
        log "  ${RED}${BOLD}ENGINE: FAIL${NC}"
    fi

    # Store results for report
    ENGINE_RESULTS=$(cat <<EOF
{
    "component": "engine",
    "passed": $( [[ $ENGINE_PASSED -eq 1 ]] && echo "true" || echo "false" ),
    "metrics": {
        "total_requests": $total_requests,
        "successful_requests": $successful_requests,
        "failed_requests": $failed_requests,
        "actual_rps": $actual_rps,
        "target_rps": $ENGINE_RPS_TARGET,
        "p50_latency_ms": $p50,
        "p95_latency_ms": $p95,
        "p99_latency_ms": $p99,
        "p99_target_ms": $ENGINE_P99_LATENCY_TARGET_MS,
        "avg_latency_ms": $avg,
        "min_latency_ms": $min_lat,
        "max_latency_ms": $max_lat,
        "error_rate": $error_rate,
        "error_rate_target": $ENGINE_ERROR_RATE_TARGET
    },
    "duration_s": $duration
}
EOF
)
}

# ─────────────────────────────────────────────────────────────────────────────
# Generate Report
# ─────────────────────────────────────────────────────────────────────────────

generate_report() {
    local gateway_json="null"
    local engine_json="null"

    if [[ $TEST_GATEWAY -eq 1 && -n "$GATEWAY_RESULTS" ]]; then
        gateway_json="$GATEWAY_RESULTS"
    fi

    if [[ $TEST_ENGINE -eq 1 && -n "$ENGINE_RESULTS" ]]; then
        engine_json="$ENGINE_RESULTS"
    fi

    # Determine overall pass
    OVERALL_PASS=1
    if [[ $TEST_GATEWAY -eq 1 && $GATEWAY_PASSED -eq 0 ]]; then
        OVERALL_PASS=0
    fi
    if [[ $TEST_ENGINE -eq 1 && $ENGINE_PASSED -eq 0 ]]; then
        OVERALL_PASS=0
    fi

    local report=$(cat <<EOF
{
    "timestamp": "$(timestamp)",
    "passed": $( [[ $OVERALL_PASS -eq 1 ]] && echo "true" || echo "false" ),
    "quick_mode": $( [[ $QUICK_MODE -eq 1 ]] && echo "true" || echo "false" ),
    "configuration": {
        "gateway_url": "$GATEWAY_URL",
        "gateway_connections_target": $GATEWAY_CONNECTIONS_TARGET,
        "gateway_p99_target_ms": $GATEWAY_P99_LATENCY_TARGET_MS,
        "engine_url": "$ENGINE_URL",
        "engine_rps_target": $ENGINE_RPS_TARGET,
        "engine_p99_target_ms": $ENGINE_P99_LATENCY_TARGET_MS,
        "load_test_duration_s": $LOAD_TEST_DURATION_S
    },
    "results": {
        "gateway": $gateway_json,
        "engine": $engine_json
    }
}
EOF
)

    # Write report to file
    echo "$report" > "$REPORT_FILE"
    log ""
    log "${CYAN}Report written to: ${REPORT_FILE}${NC}"
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

main() {
    log ""
    log "${BOLD}╔═══════════════════════════════════════════════════════════════════╗${NC}"
    log "${BOLD}║                      LOAD TEST HARNESS (AC-9.1)                   ║${NC}"
    log "${BOLD}╚═══════════════════════════════════════════════════════════════════╝${NC}"
    log ""
    log "  Started:          $(timestamp)"
    if [[ $QUICK_MODE -eq 1 ]]; then
        log "  Mode:             ${YELLOW}QUICK${NC} (reduced targets)"
    else
        log "  Mode:             STANDARD"
    fi

    # Check dependencies
    check_command curl
    check_command awk
    check_command pnpm

    # Run tests
    if [[ $TEST_GATEWAY -eq 1 ]]; then
        test_gateway
    fi

    if [[ $TEST_ENGINE -eq 1 ]]; then
        test_engine
    fi

    # Generate report
    generate_report

    # Summary
    log ""
    log "${BOLD}═══════════════════════════════════════════════════════════════════${NC}"
    log "${BOLD} SUMMARY${NC}"
    log "${BOLD}═══════════════════════════════════════════════════════════════════${NC}"
    log ""

    if [[ $TEST_GATEWAY -eq 1 ]]; then
        if [[ $GATEWAY_PASSED -eq 1 ]]; then
            log "  Gateway:          ${GREEN}PASS${NC}"
        else
            log "  Gateway:          ${RED}FAIL${NC}"
        fi
    fi

    if [[ $TEST_ENGINE -eq 1 ]]; then
        if [[ $ENGINE_PASSED -eq 1 ]]; then
            log "  Engine:           ${GREEN}PASS${NC}"
        else
            log "  Engine:           ${RED}FAIL${NC}"
        fi
    fi

    log ""

    if [[ $OVERALL_PASS -eq 1 ]]; then
        log "  ${GREEN}${BOLD}OVERALL: PASS${NC}"
        log ""
        exit 0
    else
        log "  ${RED}${BOLD}OVERALL: FAIL${NC}"
        log ""
        exit 1
    fi
}

main "$@"
