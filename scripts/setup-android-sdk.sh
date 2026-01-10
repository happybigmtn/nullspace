#!/bin/bash
# Android SDK Setup Script for E2E Testing
#
# This script installs the Android SDK and creates an AVD for Detox testing.
# Run this on a fresh machine or CI environment.
#
# Usage:
#   ./scripts/setup-android-sdk.sh
#
# Requirements:
#   - curl, unzip
#   - Java 17+ (for SDK tools)
#   - ~10GB disk space

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Configuration
ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
AVD_NAME="${AVD_NAME:-Pixel_7_API_34}"
API_LEVEL="${API_LEVEL:-34}"
SYSTEM_IMAGE="system-images;android-${API_LEVEL};google_apis;x86_64"

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

# Check prerequisites
log_step "Checking prerequisites..."

if ! command -v curl &>/dev/null; then
    log_error "curl is required but not installed"
    exit 1
fi

if ! command -v unzip &>/dev/null; then
    log_error "unzip is required but not installed"
    exit 1
fi

if ! command -v java &>/dev/null; then
    log_error "Java is required but not installed"
    log_info "Install with: sudo apt install openjdk-17-jdk (Ubuntu)"
    exit 1
fi

JAVA_VERSION=$(java -version 2>&1 | head -1 | cut -d'"' -f2 | cut -d'.' -f1)
if [ "$JAVA_VERSION" -lt 17 ] 2>/dev/null; then
    log_warn "Java 17+ recommended, found: $JAVA_VERSION"
fi

# Check KVM for hardware acceleration
if [ -c /dev/kvm ]; then
    log_info "KVM available - emulator will use hardware acceleration"
else
    log_warn "KVM not available - emulator will be slow"
    log_info "Enable with: sudo apt install qemu-kvm && sudo usermod -aG kvm $USER"
fi

log_info "Prerequisites OK"

# Download Android command-line tools
log_step "Setting up Android SDK at $ANDROID_HOME..."

mkdir -p "$ANDROID_HOME"
cd "$ANDROID_HOME"

if [ -f "cmdline-tools/latest/bin/sdkmanager" ]; then
    log_info "Command-line tools already installed"
else
    log_info "Downloading Android command-line tools..."

    # Get latest version from Google
    CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"

    curl -sL "$CMDLINE_TOOLS_URL" -o cmdline-tools.zip
    unzip -q -o cmdline-tools.zip

    # Reorganize to expected structure
    mkdir -p cmdline-tools/latest
    mv cmdline-tools/bin cmdline-tools/latest/ 2>/dev/null || true
    mv cmdline-tools/lib cmdline-tools/latest/ 2>/dev/null || true
    rm -f cmdline-tools.zip

    log_info "Command-line tools installed"
fi

# Set up PATH
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

# Accept licenses
log_step "Accepting Android SDK licenses..."
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true

# Install SDK packages
log_step "Installing SDK packages (this may take a while)..."

PACKAGES=(
    "platform-tools"
    "emulator"
    "platforms;android-${API_LEVEL}"
    "$SYSTEM_IMAGE"
)

for pkg in "${PACKAGES[@]}"; do
    log_info "Installing: $pkg"
    "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "$pkg" --verbose 2>&1 | grep -E "^(Downloading|Installing|done)" || true
done

log_info "SDK packages installed"

# Create AVD
log_step "Creating AVD: $AVD_NAME..."

# Check if AVD already exists
if "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" list avd 2>/dev/null | grep -q "Name: $AVD_NAME"; then
    log_warn "AVD '$AVD_NAME' already exists"
    read -p "Recreate? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" delete avd -n "$AVD_NAME"
    else
        log_info "Keeping existing AVD"
    fi
fi

# Create AVD
echo "no" | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd \
    --force \
    --name "$AVD_NAME" \
    --package "$SYSTEM_IMAGE" \
    --device "pixel_7" 2>/dev/null || {
        log_warn "pixel_7 device not found, using generic device"
        echo "no" | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd \
            --force \
            --name "$AVD_NAME" \
            --package "$SYSTEM_IMAGE"
    }

log_info "AVD created"

# Configure AVD for better performance
AVD_CONFIG="$HOME/.config/.android/avd/${AVD_NAME}.avd/config.ini"
if [ -f "$AVD_CONFIG" ]; then
    log_info "Optimizing AVD configuration..."

    # Update config for headless testing
    cat >> "$AVD_CONFIG" << EOF

# Optimizations for headless testing
hw.ramSize=2048
hw.gpu.enabled=yes
hw.gpu.mode=swiftshader_indirect
disk.dataPartition.size=4G
hw.keyboard=yes
hw.lcd.density=420
hw.lcd.width=1080
hw.lcd.height=2400
EOF
fi

# Verify installation
log_step "Verifying installation..."

echo ""
echo "Available AVDs:"
"$ANDROID_HOME/emulator/emulator" -list-avds 2>/dev/null || \
    "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" list avd -c

echo ""
echo "ADB version:"
"$ANDROID_HOME/platform-tools/adb" version | head -1

# Create environment setup reminder
log_step "Setup complete!"

echo ""
echo "=========================================="
echo "  Android SDK Setup Complete"
echo "=========================================="
echo ""
echo "  ANDROID_HOME: $ANDROID_HOME"
echo "  AVD:          $AVD_NAME"
echo "  API Level:    $API_LEVEL"
echo ""
echo "  Add to your shell profile (~/.bashrc or ~/.zshrc):"
echo ""
echo "    export ANDROID_HOME=\"$ANDROID_HOME\""
echo "    export PATH=\"\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/emulator:\$PATH\""
echo ""
echo "  Or source the environment script:"
echo ""
echo "    source $PROJECT_ROOT/scripts/android-env.sh"
echo ""
echo "  To run E2E tests:"
echo ""
echo "    $PROJECT_ROOT/scripts/run-mobile-e2e.sh"
echo ""
echo "=========================================="
