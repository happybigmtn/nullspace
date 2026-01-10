#!/bin/bash
# Unified Mobile E2E Test Runner for Claude Agents
#
# This script automates the full E2E test workflow:
# 1. (Optional) Start mock backend
# 2. Start Android emulator (headless)
# 3. Build app if needed
# 4. Run Detox tests
# 5. Clean up
#
# Usage:
#   ./scripts/run-mobile-e2e.sh              # Run all E2E tests
#   ./scripts/run-mobile-e2e.sh --build      # Force rebuild before tests
#   ./scripts/run-mobile-e2e.sh --test games # Run specific test file
#   ./scripts/run-mobile-e2e.sh --no-cleanup # Keep emulator running after tests

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Configuration
MOCK_PORT="${MOCK_PORT:-9010}"
USE_MOCK_BACKEND="${USE_MOCK_BACKEND:-false}"
TESTNET_GATEWAY_URL="${TESTNET_GATEWAY_URL:-wss://api.testnet.regenesis.dev}"
TESTNET_AUTH_URL="${TESTNET_AUTH_URL:-https://auth.testnet.regenesis.dev}"
TESTNET_WEBSITE_URL="${TESTNET_WEBSITE_URL:-https://testnet.regenesis.dev}"
DETOX_CONFIG="${DETOX_CONFIG:-android.emu.debug}"
BUILD_APP=false
CLEANUP=true
TEST_FILE=""
VERBOSE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --build)
            BUILD_APP=true
            shift
            ;;
        --no-cleanup)
            CLEANUP=false
            shift
            ;;
        --test)
            TEST_FILE="$2"
            shift 2
            ;;
        --mock-backend)
            USE_MOCK_BACKEND=true
            shift
            ;;
        --config)
            DETOX_CONFIG="$2"
            shift 2
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --help|-h)
            echo "Mobile E2E Test Runner"
            echo ""
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --build        Force rebuild the app before testing"
            echo "  --no-cleanup   Keep emulator and mock backend running after tests"
            echo "  --test <name>  Run specific test file (e.g., 'games', 'starter')"
            echo "  --mock-backend Use local mock backend instead of testnet"
            echo "  --config <cfg> Detox configuration (default: android.emu.debug)"
            echo "  --verbose, -v  Show verbose output"
            echo "  --help, -h     Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Load Android environment
source "$SCRIPT_DIR/android-env.sh" 2>/dev/null || {
    export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
    export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_step() { echo -e "\n${BLUE}==>${NC} $1"; }
log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# PID tracking for cleanup
MOCK_PID=""
CLEANUP_NEEDED=false

cleanup() {
    if [ "$CLEANUP" = true ] && [ "$CLEANUP_NEEDED" = true ]; then
        log_step "Cleaning up..."

        # Stop mock backend
        if [ -n "$MOCK_PID" ] && kill -0 "$MOCK_PID" 2>/dev/null; then
            log_info "Stopping mock backend (PID: $MOCK_PID)"
            kill "$MOCK_PID" 2>/dev/null || true
        fi
        if [ -f /tmp/mock-backend.pid ]; then
            kill "$(cat /tmp/mock-backend.pid)" 2>/dev/null || true
            rm -f /tmp/mock-backend.pid
        fi

        # Stop emulator
        log_info "Stopping emulator"
        "$SCRIPT_DIR/android-emulator.sh" stop 2>/dev/null || true
    else
        log_info "Skipping cleanup (--no-cleanup specified or cleanup not needed)"
    fi
}

trap cleanup EXIT

# Check prerequisites
log_step "Checking prerequisites..."

if [ ! -f "$ANDROID_HOME/emulator/emulator" ]; then
    log_error "Android SDK not found. Run: ./scripts/setup-android-sdk.sh"
    exit 1
fi

if ! command -v node &>/dev/null; then
    log_error "Node.js not found"
    exit 1
fi

if ! command -v pnpm &>/dev/null; then
    log_error "pnpm not found. Run: npm install -g pnpm"
    exit 1
fi

log_info "Prerequisites OK"

# Configure backend environment for the app build/test
if [ "$USE_MOCK_BACKEND" = true ]; then
    export EXPO_PUBLIC_WS_URL="${EXPO_PUBLIC_WS_URL:-ws://localhost:$MOCK_PORT}"
else
    export EXPO_PUBLIC_WS_URL="${EXPO_PUBLIC_WS_URL:-$TESTNET_GATEWAY_URL}"
    export EXPO_PUBLIC_AUTH_URL="${EXPO_PUBLIC_AUTH_URL:-$TESTNET_AUTH_URL}"
    export EXPO_PUBLIC_WEBSITE_URL="${EXPO_PUBLIC_WEBSITE_URL:-$TESTNET_WEBSITE_URL}"
    export EXPO_PUBLIC_ENVIRONMENT="${EXPO_PUBLIC_ENVIRONMENT:-testnet}"
fi

if [ "$USE_MOCK_BACKEND" = true ]; then
    # Start mock backend
    log_step "Starting mock backend on port $MOCK_PORT..."

    if curl -sf "http://localhost:$MOCK_PORT/healthz" >/dev/null 2>&1; then
        log_warn "Mock backend already running"
    else
        node "$SCRIPT_DIR/mock-backend.mjs" &
        MOCK_PID=$!
        echo "$MOCK_PID" > /tmp/mock-backend.pid
        CLEANUP_NEEDED=true

        # Wait for mock backend
        for i in {1..10}; do
            if curl -sf "http://localhost:$MOCK_PORT/healthz" >/dev/null 2>&1; then
                log_info "Mock backend ready (PID: $MOCK_PID)"
                break
            fi
            sleep 1
        done

        if ! curl -sf "http://localhost:$MOCK_PORT/healthz" >/dev/null 2>&1; then
            log_error "Mock backend failed to start"
            exit 1
        fi
    fi
else
    log_step "Using testnet backend"
    log_info "Gateway: $TESTNET_GATEWAY_URL"
fi

# Start emulator
log_step "Starting Android emulator..."

if "$SCRIPT_DIR/android-emulator.sh" status >/dev/null 2>&1; then
    log_warn "Emulator already running"
else
    CLEANUP_NEEDED=true
    "$SCRIPT_DIR/android-emulator.sh" start

    if ! "$SCRIPT_DIR/android-emulator.sh" status >/dev/null 2>&1; then
        log_error "Failed to start emulator"
        exit 1
    fi
fi

# Set up port forwarding (only needed for mock backend / local dev)
if [ "$USE_MOCK_BACKEND" = true ]; then
    log_step "Setting up port forwarding..."
    "$SCRIPT_DIR/android-emulator.sh" forward
else
    log_info "Skipping port forwarding (testnet backend)"
fi

# Install dependencies if needed
log_step "Checking dependencies..."
cd "$PROJECT_ROOT"

if [ ! -d "node_modules" ] || [ ! -d "mobile/node_modules" ]; then
    log_info "Installing dependencies..."
    pnpm install
fi

# Build app if needed
cd "$PROJECT_ROOT/mobile"

APK_PATH="android/app/build/outputs/apk/debug/app-debug.apk"

if [ "$BUILD_APP" = true ] || [ ! -f "$APK_PATH" ]; then
    log_step "Building Android app for Detox..."

    # Run expo prebuild if android folder doesn't exist
    if [ ! -d "android" ]; then
        log_info "Running expo prebuild..."
        npx expo prebuild --platform android --clean
    fi

    log_info "Building with Detox..."
    npx detox build --configuration "$DETOX_CONFIG"

    if [ ! -f "$APK_PATH" ]; then
        log_error "Build failed - APK not found"
        exit 1
    fi

    log_info "Build complete: $APK_PATH"
else
    log_info "Using existing build: $APK_PATH"
fi

# Run tests
log_step "Running Detox E2E tests..."

TEST_ARGS="--configuration $DETOX_CONFIG --cleanup"

if [ "$VERBOSE" = true ]; then
    TEST_ARGS="$TEST_ARGS --loglevel verbose"
fi

if [ -n "$TEST_FILE" ]; then
    # Find the test file
    if [ -f "e2e/${TEST_FILE}.test.ts" ]; then
        TEST_ARGS="$TEST_ARGS e2e/${TEST_FILE}.test.ts"
    elif [ -f "e2e/${TEST_FILE}" ]; then
        TEST_ARGS="$TEST_ARGS e2e/${TEST_FILE}"
    else
        log_warn "Test file not found: $TEST_FILE, running all tests"
    fi
fi

log_info "Running: npx detox test $TEST_ARGS"
echo ""

# Run tests and capture exit code
set +e
npx detox test $TEST_ARGS
TEST_EXIT_CODE=$?
set -e

# Report results
echo ""
if [ $TEST_EXIT_CODE -eq 0 ]; then
    log_step "Tests passed!"
else
    log_step "Tests failed with exit code: $TEST_EXIT_CODE"
fi

# Summary
echo ""
echo "=========================================="
echo "  E2E Test Run Complete"
echo "=========================================="
echo "  Configuration: $DETOX_CONFIG"
if [ "$USE_MOCK_BACKEND" = true ]; then
    echo "  Mock Backend:  http://localhost:$MOCK_PORT"
else
    echo "  Backend:       $TESTNET_GATEWAY_URL"
fi
echo "  Exit Code:     $TEST_EXIT_CODE"
if [ -d "artifacts" ]; then
    echo "  Artifacts:     mobile/artifacts/"
fi
echo "=========================================="

exit $TEST_EXIT_CODE
