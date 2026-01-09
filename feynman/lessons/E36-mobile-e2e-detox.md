# E36 - Mobile E2E Testing with Detox (textbook-style deep dive)

Focus files:
- `.github/workflows/mobile-e2e.yml`
- `mobile/.detoxrc.js`
- `mobile/e2e/` directory

Goal: provide a rigorous explanation of end-to-end testing on native mobile platforms using Detox, covering the framework's architecture, test patterns, CI integration, and mobile-specific testing challenges. This lesson should enable you to write effective E2E tests that verify complete user flows on iOS and Android.

---

## Learning objectives

After this lesson you should be able to:

1) Explain what Detox is and why E2E tests on real native apps differ from web tests.
2) Describe the Detox configuration structure (apps, devices, configurations).
3) Write Detox tests using matchers, actions, and waitFor patterns.
4) Understand testID-based element selection and why it is the preferred approach.
5) Trace the CI workflow for iOS simulator and Android emulator tests.
6) Identify common mobile E2E test patterns and anti-patterns.
7) Debug failing E2E tests using artifacts, logs, and videos.

---

## 0) Big idea (Feynman summary)

Imagine testing your mobile app by actually launching it on a real iPhone or Android emulator, tapping buttons, typing text, and watching the screen - just like a real user would. Detox is a framework that automates this process: it builds your native app, boots a simulator, launches your app, and executes a sequence of interactions while asserting that the UI responds correctly.

Unlike unit tests that verify isolated functions, or integration tests that check component interactions, E2E tests verify the entire stack from UI to backend. Detox synchronizes with React Native's rendering engine to wait for animations and async operations automatically, avoiding the flaky sleeps and timing issues that plague traditional UI automation.

The key insight is that mobile E2E tests run against compiled native binaries (not web browsers), require platform-specific simulators/emulators, and must handle native behaviors like biometric authentication, app backgrounding, and haptic feedback. This makes them slower and more resource-intensive than web tests, but they catch real-world issues that no other testing layer can find.

---

## 1) Problem framing: why E2E tests matter for mobile

Mobile apps have unique failure modes that unit and integration tests cannot catch:

### 1.1 Native integration failures
- SecureStore not persisting wallet keys
- Expo prebuild misconfiguration breaking native modules
- iOS/Android permission dialogs blocking flows
- Biometric authentication failing on certain devices

### 1.2 Cross-screen navigation bugs
- Deep links not routing correctly
- Navigation stack corruption after backgrounding
- Back button behavior inconsistent across platforms
- Modal dismissal interrupting critical flows

### 1.3 Real-world async timing issues
- WebSocket reconnection not resuming game state
- Balance updates arriving after bet placement
- Animation timing breaking tap targets
- Network timeouts not handled gracefully

### 1.4 Platform-specific rendering bugs
- Android keyboard covering input fields
- iOS safe area insets misaligned
- Text truncation on smaller screens
- Gesture conflicts with system gestures

E2E tests are the only way to verify these behaviors in an environment that matches production. They are expensive to run (minutes per test suite) but catch critical issues before users encounter them.

---

## 2) What is Detox?

Detox is a "gray box" end-to-end testing framework for React Native. It differs from "black box" tools like Appium in several ways:

### 2.1 Gray box synchronization
Detox injects a native module into your app that hooks into React Native's event loop. This allows it to:
- Wait for JavaScript to become idle before proceeding
- Wait for animations to complete automatically
- Detect when async operations (like network requests) finish
- Avoid explicit sleeps and polling

This makes tests faster and more reliable than traditional Selenium-style automation.

### 2.2 Native test runner integration
Detox uses platform-native test runners:
- **iOS**: XCTest framework via xcrun simctl
- **Android**: Espresso and androidx.test

This means tests run at native speed, not through a slow remote protocol.

### 2.3 Developer-friendly API
Detox provides a Jest-style API with familiar patterns:
```typescript
await element(by.id('login-button')).tap();
await expect(element(by.text('Welcome'))).toBeVisible();
```

This lowers the learning curve compared to XCTest or Espresso directly.

---

## 3) Detox configuration architecture

The Detox configuration in `mobile/.detoxrc.js` defines three core concepts: **apps**, **devices**, and **configurations**.

### 3.1 Apps: the binaries to test

```javascript
apps: {
  'ios.debug': {
    type: 'ios.app',
    binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/nullspacemobile.app',
    build: 'xcodebuild -workspace ios/nullspacemobile.xcworkspace -scheme nullspacemobile -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build'
  },
  'android.debug': {
    type: 'android.apk',
    binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
    build: 'cd android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug',
    reversePorts: [8080, 8081]
  }
}
```

Each app definition specifies:
- **type**: Platform-specific app format (ios.app or android.apk)
- **binaryPath**: Where the built app lives (relative to mobile/)
- **build**: Command to compile the app for testing
- **reversePorts** (Android only): Port forwarding from emulator to host

The `build` command is critical. For iOS, it uses Xcode's command-line tools to build a simulator binary. For Android, it uses Gradle to assemble a debug APK and the test instrumentation APK.

### 3.2 Devices: where to run tests

```javascript
devices: {
  simulator: {
    type: 'ios.simulator',
    device: { type: 'iPhone 15' }
  },
  emulator: {
    type: 'android.emulator',
    device: { avdName: 'Pixel_7_API_34' }
  },
  attached: {
    type: 'android.attached',
    device: { adbName: '.*' }  // Any connected device
  }
}
```

Device definitions specify:
- **type**: Simulator, emulator, or physical device
- **device**: Selection criteria (model name, AVD name, or ADB identifier)

iOS simulators are created via `xcrun simctl create`, while Android emulators are managed via `avdmanager` and must be pre-created.

### 3.3 Configurations: app + device pairs

```javascript
configurations: {
  'ios.sim.debug': {
    device: 'simulator',
    app: 'ios.debug'
  },
  'android.emu.debug': {
    device: 'emulator',
    app: 'android.debug'
  }
}
```

A configuration combines an app and a device to create a runnable test environment. You run tests by specifying a configuration:

```bash
detox test --configuration ios.sim.debug
```

This architecture allows you to define multiple variants (debug/release, phone/tablet) without duplicating test code.

---

## 4) Writing Detox tests: patterns and idioms

Detox tests follow a Jest-style structure with `describe`, `beforeAll`, `it`, and async/await.

### 4.1 Test lifecycle and setup

```typescript
describe('Authentication Flow', () => {
  beforeAll(async () => {
    // Launch app fresh
    await device.launchApp({ newInstance: true });

    // Wait for initial screen
    await waitFor(element(by.id('auth-screen')))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('should navigate to lobby after auth', async () => {
    await element(by.id('auth-continue-button')).tap();
    await waitFor(element(by.id('lobby-screen')))
      .toBeVisible()
      .withTimeout(15000);
  });
});
```

Key lifecycle methods:
- `device.launchApp({ newInstance: true })`: Kills and restarts app
- `device.launchApp({ newInstance: false })`: Resumes existing app instance
- `device.terminateApp()`: Kills app without relaunching
- `device.sendToHome()`: Backgrounds app (tests foreground/background behavior)
- `device.reloadReactNative()`: Fast refresh without full relaunch

### 4.2 Element selection with testID

The most reliable way to find elements is via `testID`:

```typescript
// In React Native component
<Pressable testID="game-card-hi_lo" onPress={handlePress}>
  <Text>Hi-Lo</Text>
</Pressable>

// In Detox test
await element(by.id('game-card-hi_lo')).tap();
```

Why `testID` is preferred over text/label:
1. **Localization-safe**: Text changes in different languages
2. **Style-independent**: Visual changes do not break tests
3. **Unambiguous**: Multiple elements can have the same text
4. **Semantic**: `testID` encodes intent, not implementation

Other selectors exist but are fragile:
- `by.text('Login')`: Breaks if wording changes
- `by.label('username')`: iOS accessibility label (platform-specific)
- `by.type('RCTTextInput')`: Breaks on React Native upgrades

### 4.3 Matchers and expectations

Detox provides assertions similar to Jest but for UI state:

```typescript
// Visibility
await expect(element(by.id('balance-display'))).toBeVisible();
await expect(element(by.id('error-modal'))).not.toBeVisible();

// Text content
await expect(element(by.id('selected-bet-amount'))).toHaveText('5');

// Existence (in DOM, even if not visible)
await expect(element(by.id('hidden-input'))).toExist();

// Value (for inputs)
await expect(element(by.id('username-input'))).toHaveValue('alice');
```

The distinction between `toBeVisible()` and `toExist()` matters:
- `toBeVisible()`: Element is in the view hierarchy AND not hidden/off-screen
- `toExist()`: Element is in the view hierarchy (may be hidden)

### 4.4 Actions on elements

```typescript
// Tap (most common)
await element(by.id('submit-button')).tap();

// Type text
await element(by.id('password-input')).typeText('securepassword123');

// Clear text
await element(by.id('search-input')).clearText();

// Replace text (clear + type)
await element(by.id('amount-input')).replaceText('100');

// Long press
await element(by.id('menu-trigger')).longPress();

// Swipe
await element(by.id('carousel')).swipe('left', 'fast', 0.5);

// Scroll (for ScrollView/FlatList)
await element(by.id('game-list')).scroll(200, 'down');

// Scroll to element
await waitFor(element(by.id('game-card-sic_bo')))
  .toBeVisible()
  .whileElement(by.id('game-list'))
  .scroll(200, 'down');
```

The `.whileElement()` pattern is crucial for long lists: it scrolls the container until the target element appears.

### 4.5 Waiting for asynchronous behavior

Detox auto-waits for most operations, but you must explicitly wait for:
- Screen transitions
- Network-dependent state changes
- Custom animations that Detox cannot detect

```typescript
// Wait for element to appear
await waitFor(element(by.id('game-result')))
  .toBeVisible()
  .withTimeout(10000);

// Wait for element to disappear
await waitFor(element(by.id('loading-spinner')))
  .not.toBeVisible()
  .withTimeout(5000);

// Wait with custom condition (polling)
await waitFor(element(by.id('balance-display')))
  .toHaveText('10000')
  .withTimeout(15000);
```

`withTimeout()` sets a deadline. If the condition is not met, the test fails with a descriptive error.

### 4.6 Multi-element selection and iteration

```typescript
// Tap first match
await element(by.text('Delete')).atIndex(0).tap();

// Assert count (for multiple elements)
await expect(element(by.id('game-card'))).toExist().withTimeout(5000);
```

Detox does not provide a `.length` or `.count()` API by default, which discourages brittle tests that depend on exact counts. If you need to verify a count, use `getAttributes()` (advanced) or restructure the test to verify specific items.

---

## 5) Mobile-specific test patterns

### 5.1 App persistence across restarts

```typescript
it('should persist wallet across app restarts', async () => {
  // First launch - create wallet
  await device.launchApp({ newInstance: true });
  await element(by.id('auth-continue-button')).tap();
  await waitFor(element(by.id('lobby-screen'))).toBeVisible().withTimeout(15000);

  // Capture some state (e.g., public key)

  // Terminate and relaunch
  await device.terminateApp();
  await device.launchApp({ newInstance: false });

  // Should skip auth (wallet persisted via SecureStore)
  await waitFor(element(by.id('lobby-screen'))).toBeVisible().withTimeout(15000);
});
```

This verifies that `expo-secure-store` correctly persists data across app lifecycles.

### 5.2 App backgrounding and foregrounding

```typescript
it('should restore session after background/foreground', async () => {
  await device.launchApp({ newInstance: true });
  // Navigate to game screen
  await element(by.id('game-card-hi_lo')).tap();

  // Background the app
  await device.sendToHome();
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Foreground the app
  await device.launchApp({ newInstance: false });

  // Should still be on game screen
  await expect(element(by.id('game-screen-hi_lo'))).toBeVisible();
});
```

This catches bugs where WebSocket connections do not reconnect or state is lost during backgrounding.

### 5.3 Platform-specific behaviors

```typescript
describe('Biometric Authentication', () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      permissions: { faceid: 'YES' }
    });
  });

  it('should prompt for biometric when accessing vault', async () => {
    await device.setBiometricEnrollment(true);
    await element(by.id('export-key-button')).tap();

    // Should show biometric prompt (iOS) or fallback to password
    try {
      await expect(element(by.id('biometric-prompt'))).toBeVisible();
    } catch {
      await expect(element(by.id('password-prompt'))).toBeVisible();
    }
  });
});
```

iOS-specific: `device.setBiometricEnrollment()` and `permissions.faceid` simulate Face ID.

Android-specific: `device.setStatusBar({ dataNetwork: 'hide' })` simulates airplane mode (visual only).

### 5.4 Gesture-based interactions

```typescript
it('should support chip drag gesture', async () => {
  await element(by.id('chip-25')).tap();

  // Drag chip to bet area (native long-press-and-drag)
  await element(by.id('chip-25')).longPressAndDrag(
    1000,           // Long press duration (ms)
    0.5, 0.5,       // Start position (normalized 0-1)
    element(by.id('bet-area-red')),  // Target element
    0.5, 0.5,       // Target position
    'fast',         // Speed
    0               // Hold duration at target
  );

  await expect(element(by.id('bet-placed-indicator'))).toBeVisible();
});
```

This tests native gesture recognizers that cannot be verified via unit tests.

---

## 6) CI integration: GitHub Actions workflow

The workflow in `.github/workflows/mobile-e2e.yml` orchestrates E2E tests in CI. It has two parallel jobs: `ios` and `android`.

### 6.1 iOS job structure

```yaml
ios:
  name: iOS E2E Tests
  runs-on: macos-14
  timeout-minutes: 60
  env:
    DETOX_CONFIGURATION: ios.sim.debug
```

Key decisions:
- **runs-on: macos-14**: macOS runners are required for iOS simulators (Linux cannot run Xcode)
- **timeout-minutes: 60**: E2E tests can hang; this prevents jobs from running indefinitely
- **DETOX_CONFIGURATION**: Specifies which configuration from `.detoxrc.js` to use

### 6.2 iOS simulator setup

```yaml
- name: Boot iOS Simulator
  run: |
    xcrun simctl list devices available
    DEVICE_ID=$(xcrun simctl list devices available | grep "iPhone 15" | head -1 | grep -oE '\([A-F0-9-]+\)' | tr -d '()')
    if [ -z "$DEVICE_ID" ]; then
      # Create iPhone 15 if not available
      DEVICE_ID=$(xcrun simctl create "iPhone 15" "com.apple.CoreSimulator.SimDeviceType.iPhone-15" "com.apple.CoreSimulator.SimRuntime.iOS-17-5")
    fi
    xcrun simctl boot "$DEVICE_ID" || true
    echo "SIMULATOR_DEVICE_ID=$DEVICE_ID" >> $GITHUB_ENV
```

This script:
1. Lists available simulators
2. Searches for an existing iPhone 15 simulator
3. Creates one if missing (with iOS 17.5 runtime)
4. Boots the simulator
5. Exports the device ID for cleanup

The `|| true` ensures the step does not fail if the simulator is already booted.

### 6.3 Mock backend for E2E tests

```yaml
- name: Start mock backend
  run: |
    cat > /tmp/mock-server.mjs << 'EOF'
    import { WebSocketServer } from 'ws';
    import { createServer } from 'http';

    const http = createServer((req, res) => {
      if (req.url === '/healthz') {
        res.writeHead(200);
        res.end('OK');
      }
    });

    const wss = new WebSocketServer({ server: http });
    const MOCK_BALANCE = 10000n;

    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'balance', balance: MOCK_BALANCE.toString() }));
      ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.type === 'authenticate') {
          ws.send(JSON.stringify({ type: 'authenticated', balance: MOCK_BALANCE.toString() }));
        }
        // ... other mock responses
      });
    });

    http.listen(9010, () => console.log('Mock backend running on :9010'));
    EOF
    node /tmp/mock-server.mjs &
    echo $! > /tmp/mock-server.pid
```

Why mock the backend?
1. **Speed**: No need to deploy a real backend for every PR
2. **Determinism**: Tests do not depend on external state or flaky networks
3. **Isolation**: Tests can run in parallel without conflicts

The mock server responds to `authenticate`, `join_game`, and `place_bet` messages with canned responses.

### 6.4 Running Detox tests

```yaml
- name: Run Detox tests
  working-directory: mobile
  run: |
    npx detox test --configuration ${{ env.DETOX_CONFIGURATION }} \
      --headless \
      --record-logs all \
      --record-videos failing \
      --cleanup 2>&1 | tee /tmp/detox-output.txt
```

Flags explained:
- `--headless`: Simulator runs without GUI (faster in CI)
- `--record-logs all`: Captures device logs for debugging
- `--record-videos failing`: Records screen video only for failed tests (saves space)
- `--cleanup`: Shuts down simulator after tests
- `2>&1 | tee`: Captures output to file for artifacts

### 6.5 Android job differences

```yaml
android:
  runs-on: ubuntu-latest  # Linux is fine for Android
  env:
    DETOX_CONFIGURATION: android.emu.debug
```

Android emulators run on Linux, so we use `ubuntu-latest` (cheaper and faster than macOS).

### 6.6 Android emulator setup

```yaml
- name: Enable KVM
  run: |
    echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules
    sudo udevadm control --reload-rules
    sudo udevadm trigger --name-match=kvm
```

KVM (Kernel-based Virtual Machine) is required for fast Android emulation on Linux. Without it, the emulator runs in software mode and is 10-100x slower.

### 6.7 Android emulator execution

```yaml
- name: Run Detox tests
  uses: reactivecircus/android-emulator-runner@v2
  with:
    api-level: 34
    arch: x86_64
    target: google_apis
    avd-name: Pixel_7_API_34
    emulator-options: -no-snapshot-save -no-window -gpu swiftshader_indirect -noaudio -no-boot-anim
    disable-animations: true
    script: |
      cd mobile
      adb reverse tcp:9010 tcp:9010  # Forward port to host
      npx detox test --configuration ${{ env.DETOX_CONFIGURATION }} \
        --headless --record-logs all --record-videos failing --cleanup
```

Key differences from iOS:
- Uses `android-emulator-runner` action to manage emulator lifecycle
- `adb reverse` forwards emulator port 9010 to host (for mock backend)
- `disable-animations: true` speeds up tests and reduces flakiness

### 6.8 Artifact upload

```yaml
- name: Upload test artifacts
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: detox-ios-artifacts
    path: |
      mobile/artifacts/
      /tmp/detox-output.txt
    retention-days: 7
```

Artifacts include:
- **mobile/artifacts/**: Screenshots and videos from failed tests
- **detox-output.txt**: Full console output for debugging

`if: always()` ensures artifacts are uploaded even if tests fail.

---

## 7) Debugging failed E2E tests

### 7.1 Common failure modes

**Symptom**: Test times out waiting for element
```
Error: Timeout waiting for element by.id('lobby-screen') to be visible
```

Possible causes:
1. Element never appears (navigation bug)
2. Wrong `testID` (typo or renamed)
3. Timeout too short for slow CI environment
4. App crashed (check device logs)

Fix: Increase timeout, verify `testID` in code, check screenshots.

**Symptom**: Element not visible but exists
```
Error: Element by.id('submit-button') exists but is not visible
```

Possible causes:
1. Element is off-screen (scroll needed)
2. Element is covered by modal or overlay
3. Element has `opacity: 0` or `display: none`

Fix: Add scroll action, dismiss overlays, check CSS.

**Symptom**: Tap has no effect
```
Error: Expected element by.id('lobby-screen') to be visible after tap
```

Possible causes:
1. Tap target is wrong element
2. Button is disabled
3. Async action not completing (spinner never disappears)
4. Gesture conflict with native behavior

Fix: Verify button state, add `waitFor()` for spinner, check logs.

### 7.2 Using artifacts to debug

When a test fails, Detox records:
1. **Screenshot**: The UI state at failure
2. **Video** (if `--record-videos failing`): Full screen recording of test
3. **Device logs**: Console output from app

To download artifacts locally:
```bash
# From GitHub Actions UI, click "Summary" → "Artifacts" → Download
# Or use gh CLI
gh run download <run-id> -n detox-ios-artifacts
```

Then inspect:
```bash
ls mobile/artifacts/
# ✓ ios.sim.debug.2024-01-08/
#   ✓ Authentication_Flow_should_navigate_to_lobby/
#     ✓ test.mp4
#     ✓ screenshot.png
#   ✓ device.log
```

**Reading device logs**:
```bash
cat mobile/artifacts/ios.sim.debug.*/device.log | grep ERROR
```

Look for:
- JavaScript exceptions
- Native crashes (EXC_BAD_ACCESS)
- Network errors (failed to connect)
- Unhandled promise rejections

### 7.3 Running tests locally

```bash
# iOS
cd mobile
npm run e2e:build:ios
npm run e2e:test:ios

# Android (requires emulator already running)
npm run e2e:build:android
npm run e2e:test:android

# Or run single test file
npx detox test e2e/starter.test.ts --configuration ios.sim.debug
```

Local runs are faster for iteration and allow you to see the simulator UI.

### 7.4 Detox debug logs

```bash
# Enable verbose Detox logs
DEBUG=detox:* npx detox test --configuration ios.sim.debug
```

This shows:
- WebSocket messages between test runner and app
- Synchronization events (JavaScript idle, animations complete)
- Element queries and their results

---

## 8) Code walkthrough: real test patterns

### 8.1 Navigation flow with cleanup (`mobile/e2e/starter.test.ts`)

```typescript
describe('Lobby Navigation', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    // Complete auth flow
    await waitFor(element(by.id('auth-screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('auth-continue-button')).tap();
    await waitFor(element(by.id('lobby-screen'))).toBeVisible().withTimeout(15000);
  });

  it('should navigate to game when card tapped', async () => {
    await element(by.id('game-card-hi_lo')).tap();
    await waitFor(element(by.id('game-screen-hi_lo'))).toBeVisible().withTimeout(10000);
  });

  it('should return to lobby with back button', async () => {
    await element(by.id('game-back-button')).tap();
    await waitFor(element(by.id('lobby-screen'))).toBeVisible().withTimeout(5000);
  });
});
```

Pattern: `beforeAll` sets up shared state (authenticated user at lobby), then each `it` verifies one user action. The second test depends on the first, which is acceptable for E2E tests (unlike unit tests, where isolation is critical).

### 8.2 Testing all game screens (`mobile/e2e/games.test.ts`)

```typescript
const GAMES = [
  { id: 'hi_lo', name: 'Hi-Lo' },
  { id: 'blackjack', name: 'Blackjack' },
  // ... 10 games total
];

describe('Game Screen Loading', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    // Navigate to lobby
  });

  afterEach(async () => {
    // Return to lobby after each test
    try {
      await element(by.id('game-back-button')).tap();
      await waitFor(element(by.id('lobby-screen'))).toBeVisible().withTimeout(5000);
    } catch {
      // Already on lobby
    }
  });

  for (const game of GAMES) {
    it(`should load ${game.name} game screen`, async () => {
      // Scroll to find game if needed
      await waitFor(element(by.id(`game-card-${game.id}`)))
        .toBeVisible()
        .whileElement(by.id('game-list'))
        .scroll(200, 'down');

      await element(by.id(`game-card-${game.id}`)).tap();
      await waitFor(element(by.id(`game-screen-${game.id}`))).toBeVisible().withTimeout(10000);

      // Verify essential game UI elements
      await expect(element(by.id('chip-selector'))).toBeVisible();
      await expect(element(by.id('game-balance'))).toBeVisible();
    });
  }
});
```

Pattern: Data-driven tests with `for` loop. The `afterEach` ensures each test starts from the lobby, even if the previous test failed. The `try/catch` handles the case where we are already on the lobby (e.g., game screen never loaded).

### 8.3 Testing persistence (`mobile/e2e/native-features.test.ts`)

```typescript
it('should persist wallet across app restarts', async () => {
  // First launch - create wallet
  await device.launchApp({ newInstance: true });
  await waitFor(element(by.id('auth-screen'))).toBeVisible().withTimeout(10000);
  await element(by.id('auth-continue-button')).tap();
  await waitFor(element(by.id('lobby-screen'))).toBeVisible().withTimeout(15000);

  // Get the public key displayed
  await element(by.id('settings-button')).tap();
  await waitFor(element(by.id('vault-screen'))).toBeVisible().withTimeout(5000);

  // Restart app
  await device.terminateApp();
  await device.launchApp({ newInstance: false });

  // Should skip auth and go directly to lobby (wallet persisted)
  await waitFor(element(by.id('lobby-screen'))).toBeVisible().withTimeout(15000);
});
```

Pattern: This test verifies the critical path for SecureStore persistence. If this fails, users lose their wallets on app restart - a catastrophic bug. The test does not assert the exact public key (that would require extracting text, which is brittle), but verifies that auth is skipped (proving the wallet was restored).

### 8.4 Testing password validation (`mobile/e2e/native-features.test.ts`)

```typescript
it('should require 12+ character password for vault', async () => {
  // Navigate to vault
  await element(by.id('settings-button')).tap();
  await waitFor(element(by.id('vault-screen'))).toBeVisible().withTimeout(5000);

  // Try to set a short password
  await element(by.id('set-password-button')).tap();
  await element(by.id('password-input')).typeText('short123');
  await element(by.id('confirm-password-button')).tap();

  // Should show error for password too short
  await expect(element(by.id('password-error'))).toBeVisible();
  await expect(element(by.text('Password must be at least 12 characters'))).toBeVisible();
});
```

Pattern: Test the unhappy path first, then verify the error message. This catches regressions where validation is accidentally removed. The follow-up test verifies the happy path with a valid password.

---

## 9) Limits and management callouts

### 9.1 E2E tests are slow

A full E2E test suite takes **5-15 minutes** per platform. This is because:
1. Building native binaries (Xcode, Gradle) takes 2-5 minutes
2. Booting simulators/emulators takes 30-60 seconds
3. Each test involves real UI rendering and animations
4. iOS tests require macOS runners (expensive in CI)

**Management strategy**:
- Run E2E tests **only on mobile-related PRs** (via `paths` filter in workflow)
- Do not block merges on E2E tests; run them post-merge or nightly
- Keep E2E test count low (<50 tests); focus on critical user paths
- Use `workflow_dispatch` to allow manual triggers with platform selection

### 9.2 E2E tests are flaky

Common sources of flakiness:
1. **Timing issues**: Animations or async operations take longer in CI
2. **Simulator variability**: macOS-14 runners have different CPU speeds
3. **Network instability**: Mock server not ready before tests start
4. **Detox synchronization bugs**: Rare cases where Detox does not wait long enough

**Mitigation**:
- Use generous timeouts (`withTimeout(15000)` for initial screens)
- Retry failed tests once (`jest-circus` supports retries)
- Use `waitFor()` instead of explicit sleeps
- Verify mock server is healthy before starting tests (`curl healthz`)

### 9.3 Detox does not test real backend

The CI workflow uses a mock WebSocket server. This means:
1. **Network errors** (timeouts, disconnects) are not fully tested
2. **Backend bugs** (wrong game logic, payout errors) are not caught
3. **API schema changes** may break the app in production

**Management strategy**:
- Run **integration tests** separately against a real staging backend
- Use Detox E2E tests for UI and navigation flows
- Use API integration tests for backend contract verification
- Consider a nightly E2E run against staging backend

### 9.4 Platform-specific test gaps

Some behaviors cannot be tested in CI:
1. **Push notifications**: Require real device or manual approval
2. **Biometric authentication**: Simulator support is limited and flaky
3. **In-app purchases**: Require sandbox Apple/Google accounts
4. **Real network conditions**: Simulator is always on fast WiFi

**Management strategy**:
- Test these features **manually** on physical devices before release
- Use TestFlight/Play Internal Testing for beta user validation
- Document manual test checklist for release QA

---

## 10) Key takeaways

1. **Detox is a gray-box framework** that synchronizes with React Native's event loop, avoiding explicit sleeps and making tests faster and more reliable than Appium.

2. **testID-based selectors** are the most reliable way to find elements, as they are immune to text changes, styling, and localization.

3. **Configurations separate concerns**: apps (what to test), devices (where to test), and configurations (app+device pairs) allow flexible test environments without duplicating test code.

4. **waitFor() is essential** for screen transitions, async state changes, and network-dependent UI. Always use `.withTimeout()` to fail fast.

5. **CI integration requires platform-specific setup**: iOS needs macOS runners and xcrun simctl, Android needs KVM and adb reverse for port forwarding.

6. **Mock backends enable fast, deterministic tests**: The workflow creates an in-memory WebSocket server that responds to game actions without requiring a deployed backend.

7. **Artifacts (screenshots, videos, logs) are critical for debugging** CI failures, as you cannot see the simulator UI during test runs.

8. **E2E tests are expensive but irreplaceable**: They catch real-world bugs (navigation, persistence, native integration) that no other testing layer can find.

---

## 11) Feynman recap

Imagine you are teaching a junior developer how to test a mobile app. They know how to write unit tests, but they have never tested a full user flow on a real device.

You would say: "Detox lets you write tests that actually launch the app on a simulator, tap buttons, and verify the screen looks correct. It is like having a robot user that follows a script. The key insight is that Detox hooks into React Native's internals to automatically wait for animations and async operations, so you do not need to guess how long to wait.

To use Detox, you define **apps** (the compiled binaries), **devices** (iPhone 15, Pixel 7), and **configurations** (which app runs on which device). Then you write tests using `by.id()` to find elements (always add a `testID` to your components!) and `tap()`, `typeText()`, and `expect().toBeVisible()` to interact and assert.

In CI, we build the app from scratch, boot a simulator, run all tests, and upload videos of any failures. It takes 10 minutes, but it catches bugs that would ruin the user experience - like the wallet not persisting after restart, or the back button not working. That is why E2E tests are worth the cost."

---

## 12) Exercises

### Exercise 1: Write a new E2E test
Add a test to `mobile/e2e/games.test.ts` that verifies the following flow:
1. Navigate to the Blackjack game
2. Select a chip (chip-10)
3. Place an ante bet
4. Tap the deal button
5. Verify that player cards appear (`player-card-0` and `player-card-1`)
6. Take a screenshot and save it to artifacts

**Hints**:
- Use `waitFor()` after deal to wait for cards to animate in
- Use `device.takeScreenshot('blackjack-dealt')` to save screenshot
- Check existing tests for chip selection patterns

### Exercise 2: Debug a flaky test
Suppose the test "should persist wallet across app restarts" fails intermittently in CI with:
```
Timeout waiting for element by.id('lobby-screen') after restart
```

List three possible root causes and how you would investigate each using Detox artifacts (logs, screenshots, videos).

### Exercise 3: Add a native feature test
Write a test in `mobile/e2e/native-features.test.ts` that:
1. Backgrounds the app using `device.sendToHome()`
2. Waits 5 seconds
3. Foregrounds the app using `device.launchApp({ newInstance: false })`
4. Verifies that the WebSocket reconnects (by checking `connection-status-connected` element)

**Bonus**: Simulate airplane mode using `device.setStatusBar({ dataNetwork: 'hide' })` and verify the app shows a reconnecting indicator.

### Exercise 4: Optimize CI runtime
The CI workflow currently takes 12 minutes per platform. Propose three changes to reduce runtime without removing tests or reducing coverage. Consider:
- Caching strategies (what is already cached?)
- Build parallelization
- Test parallelization (what is the current `maxWorkers` setting?)
- Artifact upload size

Explain the tradeoff of each optimization (e.g., "Caching X saves Y minutes but uses Z GB of storage").
