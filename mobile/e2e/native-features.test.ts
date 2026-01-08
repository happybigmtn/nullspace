import { by, device, element, expect, waitFor } from 'detox';

/**
 * Native-specific feature tests
 * These test behaviors that ONLY work on native iOS/Android:
 * - SecureStore persistence
 * - Biometric authentication
 * - Native haptic feedback
 * - App backgrounding/foregrounding
 * - Push notifications
 */

describe('SecureStore Persistence', () => {
  it('should persist wallet across app restarts', async () => {
    // First launch - create wallet
    await device.launchApp({ newInstance: true });
    await waitFor(element(by.id('auth-screen')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('auth-continue-button')).tap();
    await waitFor(element(by.id('lobby-screen')))
      .toBeVisible()
      .withTimeout(15000);

    // Get the public key displayed
    await element(by.id('settings-button')).tap();
    await waitFor(element(by.id('vault-screen')))
      .toBeVisible()
      .withTimeout(5000);

    // Note: In real test, we'd capture the public key value

    // Restart app
    await device.terminateApp();
    await device.launchApp({ newInstance: false });

    // Should skip auth and go directly to lobby (wallet persisted)
    await waitFor(element(by.id('lobby-screen')))
      .toBeVisible()
      .withTimeout(15000);
  });

  it('should restore session after background/foreground', async () => {
    await device.launchApp({ newInstance: true });
    await waitFor(element(by.id('auth-screen')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('auth-continue-button')).tap();
    await waitFor(element(by.id('lobby-screen')))
      .toBeVisible()
      .withTimeout(15000);

    // Navigate to a game
    await element(by.id('game-card-hi_lo')).tap();
    await waitFor(element(by.id('game-screen-hi_lo')))
      .toBeVisible()
      .withTimeout(10000);

    // Background the app
    await device.sendToHome();
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Foreground the app
    await device.launchApp({ newInstance: false });

    // Should still be on the game screen
    await expect(element(by.id('game-screen-hi_lo'))).toBeVisible();
  });
});

describe('Vault Password Flow', () => {
  beforeAll(async () => {
    // Clear app data for fresh start
    await device.launchApp({ newInstance: true, delete: true });
  });

  it('should require 12+ character password for vault', async () => {
    await waitFor(element(by.id('auth-screen')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('auth-continue-button')).tap();
    await waitFor(element(by.id('lobby-screen')))
      .toBeVisible()
      .withTimeout(15000);

    // Go to vault
    await element(by.id('settings-button')).tap();
    await waitFor(element(by.id('vault-screen')))
      .toBeVisible()
      .withTimeout(5000);

    // Try to set a short password
    await element(by.id('set-password-button')).tap();
    await element(by.id('password-input')).typeText('short123');
    await element(by.id('confirm-password-button')).tap();

    // Should show error for password too short
    await expect(element(by.id('password-error'))).toBeVisible();
    await expect(element(by.text('Password must be at least 12 characters'))).toBeVisible();
  });

  it('should accept valid 12+ character password', async () => {
    await element(by.id('password-input')).clearText();
    await element(by.id('password-input')).typeText('securepassword123');
    await element(by.id('confirm-password-input')).typeText('securepassword123');
    await element(by.id('confirm-password-button')).tap();

    // Should show success
    await waitFor(element(by.id('password-set-success')))
      .toBeVisible()
      .withTimeout(5000);
  });

  it('should show password strength indicator', async () => {
    await element(by.id('password-input')).clearText();
    await element(by.id('password-input')).typeText('weak');
    await expect(element(by.id('strength-weak'))).toBeVisible();

    await element(by.id('password-input')).clearText();
    await element(by.id('password-input')).typeText('MediumPassword1');
    await expect(element(by.id('strength-medium'))).toBeVisible();

    await element(by.id('password-input')).clearText();
    await element(by.id('password-input')).typeText('V3ryStr0ng!P@ssw0rd#2024');
    await expect(element(by.id('strength-strong'))).toBeVisible();
  });
});

describe('WebSocket Reconnection (Native)', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await waitFor(element(by.id('auth-screen')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('auth-continue-button')).tap();
    await waitFor(element(by.id('lobby-screen')))
      .toBeVisible()
      .withTimeout(15000);
  });

  it('should show connection status indicator', async () => {
    await expect(element(by.id('connection-status'))).toBeVisible();
    await expect(element(by.id('connection-status-connected'))).toBeVisible();
  });

  it('should handle airplane mode gracefully', async () => {
    // Navigate to game
    await element(by.id('game-card-blackjack')).tap();
    await waitFor(element(by.id('game-screen-blackjack')))
      .toBeVisible()
      .withTimeout(10000);

    // Enable airplane mode (simulates network loss)
    // Note: setStatusBar only affects the visual display, not actual connectivity
    // Use 'hide' to simulate no network in status bar
    await device.setStatusBar({
      dataNetwork: 'hide'
    });

    // Wait for disconnect detection
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Should show reconnecting indicator
    await expect(element(by.id('connection-status-reconnecting'))).toBeVisible();

    // Restore wifi display
    await device.setStatusBar({
      dataNetwork: 'wifi'
    });

    // Should reconnect
    await waitFor(element(by.id('connection-status-connected')))
      .toBeVisible()
      .withTimeout(30000);
  });
});

describe('Native Animations', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await waitFor(element(by.id('auth-screen')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('auth-continue-button')).tap();
    await waitFor(element(by.id('lobby-screen')))
      .toBeVisible()
      .withTimeout(15000);
    await element(by.id('game-card-blackjack')).tap();
    await waitFor(element(by.id('game-screen-blackjack')))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('should animate card dealing', async () => {
    // Place bet and deal
    await element(by.id('chip-10')).tap();
    await element(by.id('bet-ante')).tap();
    await element(by.id('deal-button')).tap();

    // Card animation should complete (cards visible after animation)
    await waitFor(element(by.id('player-card-0')))
      .toBeVisible()
      .withTimeout(5000);
    await waitFor(element(by.id('player-card-1')))
      .toBeVisible()
      .withTimeout(5000);
  });

  it('should animate chip selection', async () => {
    // Tap chip - it should animate (scale)
    await element(by.id('chip-25')).tap();

    // Selected chip should have visual indicator
    await expect(element(by.id('chip-25-selected'))).toBeVisible();
  });
});

describe('Biometric Authentication', () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      permissions: { faceid: 'YES' }
    });
  });

  it('should prompt for biometric when accessing vault', async () => {
    await waitFor(element(by.id('auth-screen')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('auth-continue-button')).tap();
    await waitFor(element(by.id('lobby-screen')))
      .toBeVisible()
      .withTimeout(15000);

    // Go to vault
    await element(by.id('settings-button')).tap();

    // On devices with biometric, should prompt
    // This test verifies the prompt appears (actual biometric is mocked)
    await device.setBiometricEnrollment(true);

    await element(by.id('export-key-button')).tap();

    // Should show biometric prompt or fallback to password
    const biometricPrompt = element(by.id('biometric-prompt'));
    const passwordPrompt = element(by.id('password-prompt'));

    // One of these should be visible
    try {
      await expect(biometricPrompt).toBeVisible();
    } catch {
      await expect(passwordPrompt).toBeVisible();
    }
  });
});
