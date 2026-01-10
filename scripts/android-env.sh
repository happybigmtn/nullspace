#!/bin/bash
# Android SDK environment setup
# Source this file: source scripts/android-env.sh

export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_AVD_HOME="$HOME/.config/.android/avd"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

# Verify setup
if [ -f "$ANDROID_HOME/emulator/emulator" ]; then
    echo "Android SDK configured at: $ANDROID_HOME"
    echo "Available AVDs:"
    "$ANDROID_HOME/emulator/emulator" -list-avds 2>/dev/null || avdmanager list avd -c
else
    echo "Warning: Android SDK not found at $ANDROID_HOME"
    echo "Run: scripts/setup-android-sdk.sh to install"
fi
