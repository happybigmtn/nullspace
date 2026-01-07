import { by, device, element, expect } from 'detox';

describe('App Launch', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('should show splash screen on launch', async () => {
    // Splash screen should be visible initially
    await expect(element(by.id('splash-screen'))).toBeVisible();
  });

  it('should transition to auth screen', async () => {
    // Wait for splash to complete and auth to appear
    await waitFor(element(by.id('auth-screen')))
      .toBeVisible()
      .withTimeout(10000);
  });
});

describe('Authentication Flow', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    // Wait for auth screen
    await waitFor(element(by.id('auth-screen')))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('should show continue button for new user', async () => {
    await expect(element(by.id('auth-continue-button'))).toBeVisible();
  });

  it('should navigate to lobby after auth', async () => {
    await element(by.id('auth-continue-button')).tap();

    await waitFor(element(by.id('lobby-screen')))
      .toBeVisible()
      .withTimeout(15000);
  });
});

describe('Lobby Navigation', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    // Complete auth flow
    await waitFor(element(by.id('auth-screen')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('auth-continue-button')).tap();
    await waitFor(element(by.id('lobby-screen')))
      .toBeVisible()
      .withTimeout(15000);
  });

  it('should display balance', async () => {
    await expect(element(by.id('balance-display'))).toBeVisible();
  });

  it('should show all game cards', async () => {
    // Check for game cards by testID
    await expect(element(by.id('game-card-hi_lo'))).toBeVisible();
    await expect(element(by.id('game-card-blackjack'))).toBeVisible();
  });

  it('should navigate to game when card tapped', async () => {
    await element(by.id('game-card-hi_lo')).tap();

    await waitFor(element(by.id('game-screen-hi_lo')))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('should return to lobby with back button', async () => {
    await element(by.id('game-back-button')).tap();

    await waitFor(element(by.id('lobby-screen')))
      .toBeVisible()
      .withTimeout(5000);
  });
});
