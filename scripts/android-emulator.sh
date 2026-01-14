#!/bin/bash
# Android Emulator management script for headless E2E testing
#
# Usage:
#   ./scripts/android-emulator.sh start    # Start emulator in background
#   ./scripts/android-emulator.sh stop     # Stop emulator
#   ./scripts/android-emulator.sh status   # Check emulator status
#   ./scripts/android-emulator.sh wait     # Wait for emulator to be ready
#   ./scripts/android-emulator.sh forward  # Set up port forwarding

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Load Android environment
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_AVD_HOME="${ANDROID_AVD_HOME:-$HOME/.config/.android/avd}"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

AVD_NAME="${AVD_NAME:-Pixel_7_API_34}"
EMULATOR_PID_FILE="/tmp/android-emulator.pid"
EMULATOR_LOG="/tmp/android-emulator.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

check_sdk() {
    if [ ! -f "$ANDROID_HOME/emulator/emulator" ]; then
        log_error "Android SDK not found at $ANDROID_HOME"
        log_info "Run: ./scripts/setup-android-sdk.sh to install"
        exit 1
    fi
}

check_avd() {
    if ! "$ANDROID_HOME/emulator/emulator" -list-avds 2>/dev/null | grep -q "^${AVD_NAME}$"; then
        log_error "AVD '$AVD_NAME' not found"
        log_info "Available AVDs:"
        "$ANDROID_HOME/emulator/emulator" -list-avds 2>/dev/null
        exit 1
    fi
}

is_emulator_running() {
    "$ANDROID_HOME/platform-tools/adb" devices 2>/dev/null | grep -q "emulator-"
}

get_emulator_device() {
    "$ANDROID_HOME/platform-tools/adb" devices 2>/dev/null | grep "emulator-" | cut -f1 | head -1
}

start_emulator() {
    check_sdk
    check_avd

    if is_emulator_running; then
        log_warn "Emulator already running"
        DEVICE=$(get_emulator_device)
        log_info "Device: $DEVICE"
        return 0
    fi

    log_info "Starting emulator '$AVD_NAME' in headless mode..."

    # Start emulator with headless options
    nohup "$ANDROID_HOME/emulator/emulator" \
        -avd "$AVD_NAME" \
        -no-window \
        -no-audio \
        -no-boot-anim \
        -gpu swiftshader_indirect \
        -no-snapshot-save \
        -memory 2048 \
        -partition-size 4096 \
        > "$EMULATOR_LOG" 2>&1 &

    echo $! > "$EMULATOR_PID_FILE"
    log_info "Emulator PID: $(cat $EMULATOR_PID_FILE)"
    log_info "Log: $EMULATOR_LOG"

    # Wait for emulator to start
    wait_for_boot
}

wait_for_boot() {
    log_info "Waiting for emulator to boot..."

    local timeout=180
    local elapsed=0

    while [ $elapsed -lt $timeout ]; do
        if is_emulator_running; then
            DEVICE=$(get_emulator_device)

            # Check boot completion
            BOOT_COMPLETE=$("$ANDROID_HOME/platform-tools/adb" -s "$DEVICE" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')

            if [ "$BOOT_COMPLETE" = "1" ]; then
                log_info "Emulator booted successfully! (${elapsed}s)"

                # Disable animations for testing
                "$ANDROID_HOME/platform-tools/adb" -s "$DEVICE" shell settings put global window_animation_scale 0 2>/dev/null || true
                "$ANDROID_HOME/platform-tools/adb" -s "$DEVICE" shell settings put global transition_animation_scale 0 2>/dev/null || true
                "$ANDROID_HOME/platform-tools/adb" -s "$DEVICE" shell settings put global animator_duration_scale 0 2>/dev/null || true

                log_info "Animations disabled"
                return 0
            fi
        fi

        sleep 2
        elapsed=$((elapsed + 2))
        printf "\r  Waiting... %ds / %ds" "$elapsed" "$timeout"
    done

    echo
    log_error "Emulator failed to boot within ${timeout}s"
    log_info "Check log: $EMULATOR_LOG"
    return 1
}

stop_emulator() {
    log_info "Stopping emulator..."

    # Try ADB shutdown first
    if is_emulator_running; then
        DEVICE=$(get_emulator_device)
        "$ANDROID_HOME/platform-tools/adb" -s "$DEVICE" emu kill 2>/dev/null || true
        sleep 2
    fi

    # Kill by PID if still running
    if [ -f "$EMULATOR_PID_FILE" ]; then
        PID=$(cat "$EMULATOR_PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            kill "$PID" 2>/dev/null || true
            sleep 1
            kill -9 "$PID" 2>/dev/null || true
        fi
        rm -f "$EMULATOR_PID_FILE"
    fi

    # Kill any remaining emulator processes
    pkill -f "emulator.*-avd.*$AVD_NAME" 2>/dev/null || true

    log_info "Emulator stopped"
}

status_emulator() {
    if is_emulator_running; then
        DEVICE=$(get_emulator_device)
        log_info "Emulator is running: $DEVICE"

        BOOT_COMPLETE=$("$ANDROID_HOME/platform-tools/adb" -s "$DEVICE" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
        if [ "$BOOT_COMPLETE" = "1" ]; then
            log_info "Status: Fully booted"
        else
            log_warn "Status: Booting..."
        fi

        return 0
    else
        log_info "Emulator is not running"
        return 1
    fi
}

setup_port_forward() {
    if ! is_emulator_running; then
        log_error "Emulator not running"
        return 1
    fi

    DEVICE=$(get_emulator_device)
    MOCK_PORT="${MOCK_PORT:-9010}"

    log_info "Setting up port forwarding: localhost:$MOCK_PORT -> emulator:$MOCK_PORT"
    "$ANDROID_HOME/platform-tools/adb" -s "$DEVICE" reverse tcp:$MOCK_PORT tcp:$MOCK_PORT

    # Also forward Metro bundler port
    "$ANDROID_HOME/platform-tools/adb" -s "$DEVICE" reverse tcp:8081 tcp:8081 2>/dev/null || true

    log_info "Port forwarding configured"
}

# Main
case "${1:-help}" in
    start)
        start_emulator
        ;;
    stop)
        stop_emulator
        ;;
    status)
        status_emulator
        ;;
    wait)
        wait_for_boot
        ;;
    forward)
        setup_port_forward
        ;;
    restart)
        stop_emulator
        sleep 2
        start_emulator
        ;;
    *)
        echo "Android Emulator Management Script"
        echo ""
        echo "Usage: $0 <command>"
        echo ""
        echo "Commands:"
        echo "  start    Start emulator in headless mode"
        echo "  stop     Stop emulator"
        echo "  status   Check emulator status"
        echo "  wait     Wait for emulator to finish booting"
        echo "  forward  Set up port forwarding for mock backend"
        echo "  restart  Stop and start emulator"
        echo ""
        echo "Environment variables:"
        echo "  ANDROID_HOME  Android SDK location (default: ~/Android/Sdk)"
        echo "  AVD_NAME      AVD name (default: Pixel_7_API_34)"
        echo "  MOCK_PORT     Mock backend port (default: 9010)"
        ;;
esac
