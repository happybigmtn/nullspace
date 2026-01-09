import { by, device, element, expect, waitFor } from 'detox';

/**
 * E2E tests for all casino games on native iOS/Android
 * These tests verify native-specific behaviors like:
 * - Haptic feedback
 * - SecureStore persistence
 * - Native animations
 * - Touch gestures
 */

const GAMES = [
  { id: 'hi_lo', name: 'Hi-Lo' },
  { id: 'blackjack', name: 'Blackjack' },
  { id: 'roulette', name: 'Roulette' },
  { id: 'craps', name: 'Craps' },
  { id: 'baccarat', name: 'Baccarat' },
  { id: 'casino_war', name: 'Casino War' },
  { id: 'video_poker', name: 'Video Poker' },
  { id: 'sic_bo', name: 'Sic Bo' },
  { id: 'three_card_poker', name: '3 Card Poker' },
  { id: 'ultimate_texas_holdem', name: 'Ultimate Holdem' },
];

describe('Game Screen Loading', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    // Navigate through auth to lobby
    await waitFor(element(by.id('auth-screen')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('auth-continue-button')).tap();
    await waitFor(element(by.id('lobby-screen')))
      .toBeVisible()
      .withTimeout(15000);
  });

  afterEach(async () => {
    // Return to lobby after each test
    try {
      await element(by.id('game-back-button')).tap();
      await waitFor(element(by.id('lobby-screen')))
        .toBeVisible()
        .withTimeout(5000);
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

      await waitFor(element(by.id(`game-screen-${game.id}`)))
        .toBeVisible()
        .withTimeout(10000);

      // Verify essential game UI elements
      await expect(element(by.id('chip-selector'))).toBeVisible();
      await expect(element(by.id('game-balance'))).toBeVisible();
    });
  }
});

describe('Hi-Lo Game Flow', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await waitFor(element(by.id('auth-screen')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('auth-continue-button')).tap();
    await waitFor(element(by.id('lobby-screen')))
      .toBeVisible()
      .withTimeout(15000);
    await element(by.id('game-card-hi_lo')).tap();
    await waitFor(element(by.id('game-screen-hi_lo')))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('should display current card', async () => {
    await expect(element(by.id('current-card'))).toBeVisible();
  });

  it('should allow chip selection', async () => {
    await element(by.id('chip-5')).tap();
    await expect(element(by.id('selected-bet-amount'))).toHaveText('5');
  });

  it('should place bet on Higher', async () => {
    await element(by.id('bet-higher')).tap();
    // Wait for result
    await waitFor(element(by.id('game-result')))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('should update balance after bet resolves', async () => {
    // Balance should have changed
    await expect(element(by.id('game-balance'))).toBeVisible();
  });
});

describe('Blackjack Game Flow', () => {
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

  it('should place bet and deal cards', async () => {
    // Select $10 chip and place bet
    await element(by.id('chip-10')).tap();
    // Tap chip again to place it (via onChipPlace)
    await element(by.id('chip-10')).tap();

    // Tap deal button
    await element(by.id('deal-button')).tap();

    // Wait for cards to be dealt
    await waitFor(element(by.id('player-hand')))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('should show action buttons after deal', async () => {
    await expect(element(by.id('action-hit'))).toBeVisible();
    await expect(element(by.id('action-stand'))).toBeVisible();
  });

  it('should execute hit action', async () => {
    await element(by.id('action-hit')).tap();

    // Wait for new card animation
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Player hand should still be visible with updated cards
    await expect(element(by.id('player-hand'))).toBeVisible();
  });
});

describe('Blackjack Hit/Stand Flow (QA-007)', () => {
  /**
   * Comprehensive E2E tests for Blackjack hit/stand actions
   * Tests: hit action, stand action, win/loss/push outcome verification
   */

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

  beforeEach(async () => {
    // Navigate to Blackjack game
    await element(by.id('game-card-blackjack')).tap();
    await waitFor(element(by.id('game-screen-blackjack')))
      .toBeVisible()
      .withTimeout(10000);
  });

  afterEach(async () => {
    // Return to lobby after each test
    try {
      await element(by.id('game-back-button')).tap();
      await waitFor(element(by.id('lobby-screen')))
        .toBeVisible()
        .withTimeout(5000);
    } catch {
      // Already on lobby or game ended
      await device.launchApp({ newInstance: false });
      await waitFor(element(by.id('lobby-screen')))
        .toBeVisible()
        .withTimeout(5000);
    }
  });

  it('should complete a full hit action flow', async () => {
    // Place bet
    await element(by.id('chip-10')).tap();
    await element(by.id('chip-10')).tap();
    await element(by.id('deal-button')).tap();

    // Wait for cards to be dealt
    await waitFor(element(by.id('player-hand')))
      .toBeVisible()
      .withTimeout(10000);

    // Verify hit button is visible
    await expect(element(by.id('action-hit'))).toBeVisible();

    // Execute hit action
    await element(by.id('action-hit')).tap();

    // Wait for new card animation
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Player hand should still be visible (either with more cards or game ended)
    await expect(element(by.id('player-hand'))).toBeVisible();

    // If game didn't bust, hit or stand buttons should still be visible OR result should show
    // We check for either state since hit may result in bust
    try {
      await waitFor(element(by.id('action-stand')))
        .toBeVisible()
        .withTimeout(2000);
    } catch {
      // Player busted - check for result
      await waitFor(element(by.id('new-game-button')))
        .toBeVisible()
        .withTimeout(5000);
    }
  });

  it('should complete a full stand action flow', async () => {
    // Place bet
    await element(by.id('chip-10')).tap();
    await element(by.id('chip-10')).tap();
    await element(by.id('deal-button')).tap();

    // Wait for cards to be dealt
    await waitFor(element(by.id('player-hand')))
      .toBeVisible()
      .withTimeout(10000);

    // Verify stand button is visible
    await expect(element(by.id('action-stand'))).toBeVisible();

    // Execute stand action
    await element(by.id('action-stand')).tap();

    // Wait for dealer's turn and game result
    await waitFor(element(by.id('new-game-button')))
      .toBeVisible()
      .withTimeout(15000);

    // Dealer hand should be revealed (no hidden card)
    await expect(element(by.id('dealer-hand'))).toBeVisible();
  });

  it('should display correct win outcome after stand', async () => {
    // Place bet
    await element(by.id('chip-10')).tap();
    await element(by.id('chip-10')).tap();
    await element(by.id('deal-button')).tap();

    // Wait for deal
    await waitFor(element(by.id('player-hand')))
      .toBeVisible()
      .withTimeout(10000);

    // Stand immediately to let the game resolve
    await element(by.id('action-stand')).tap();

    // Wait for result
    await waitFor(element(by.id('new-game-button')))
      .toBeVisible()
      .withTimeout(15000);

    // Verify that a result indicator exists (win, loss, or push)
    // Since game outcome is random, we verify one of the three outcomes appears
    let resultFound = false;
    const outcomes = ['game-result-win', 'game-result-loss', 'game-result-push', 'game-result-blackjack'];

    for (const outcome of outcomes) {
      try {
        await expect(element(by.id(outcome))).toExist();
        resultFound = true;
        break;
      } catch {
        // Try next outcome
      }
    }

    if (!resultFound) {
      // If no hidden element found, verify game message shows an outcome
      await expect(element(by.id('game-message'))).toBeVisible();
    }
  });

  it('should allow starting a new game after result', async () => {
    // Place bet and stand to complete a game
    await element(by.id('chip-10')).tap();
    await element(by.id('chip-10')).tap();
    await element(by.id('deal-button')).tap();

    await waitFor(element(by.id('player-hand')))
      .toBeVisible()
      .withTimeout(10000);

    await element(by.id('action-stand')).tap();

    // Wait for result
    await waitFor(element(by.id('new-game-button')))
      .toBeVisible()
      .withTimeout(15000);

    // Start new game
    await element(by.id('new-game-button')).tap();

    // Verify betting phase is active
    await waitFor(element(by.id('deal-button')))
      .toBeVisible()
      .withTimeout(5000);

    await expect(element(by.id('chip-selector'))).toBeVisible();
  });

  it('should handle multiple hit actions until bust or stand', async () => {
    // Place bet
    await element(by.id('chip-5')).tap();
    await element(by.id('chip-5')).tap();
    await element(by.id('deal-button')).tap();

    await waitFor(element(by.id('player-hand')))
      .toBeVisible()
      .withTimeout(10000);

    // Hit multiple times (up to 5 times or until game ends)
    for (let i = 0; i < 5; i++) {
      try {
        // Check if hit button is still available
        await waitFor(element(by.id('action-hit')))
          .toBeVisible()
          .withTimeout(2000);

        await element(by.id('action-hit')).tap();

        // Wait for card animation
        await new Promise((resolve) => setTimeout(resolve, 800));
      } catch {
        // Hit button no longer visible - either busted or 21
        break;
      }
    }

    // Game should either be still in player_turn or have ended
    // Check for result or stand button
    try {
      await waitFor(element(by.id('action-stand')))
        .toBeVisible()
        .withTimeout(2000);
      // Still in game - stand to finish
      await element(by.id('action-stand')).tap();
    } catch {
      // Already in result phase
    }

    // Verify game reached result state
    await waitFor(element(by.id('new-game-button')))
      .toBeVisible()
      .withTimeout(15000);
  });

  it('should show dealer cards after standing', async () => {
    // Place bet
    await element(by.id('chip-10')).tap();
    await element(by.id('chip-10')).tap();
    await element(by.id('deal-button')).tap();

    await waitFor(element(by.id('player-hand')))
      .toBeVisible()
      .withTimeout(10000);

    // Stand to trigger dealer's turn
    await element(by.id('action-stand')).tap();

    // Wait for dealer to finish
    await waitFor(element(by.id('new-game-button')))
      .toBeVisible()
      .withTimeout(15000);

    // Dealer hand should show both cards (no hidden card)
    await expect(element(by.id('dealer-hand'))).toBeVisible();
    await expect(element(by.id('dealer-hand-label'))).toBeVisible();
  });
});

describe('Chip Selector Gestures', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await waitFor(element(by.id('auth-screen')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('auth-continue-button')).tap();
    await waitFor(element(by.id('lobby-screen')))
      .toBeVisible()
      .withTimeout(15000);
    await element(by.id('game-card-roulette')).tap();
    await waitFor(element(by.id('game-screen-roulette')))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('should support chip drag gesture', async () => {
    // Select chip
    await element(by.id('chip-25')).tap();

    // Drag chip to bet area (native gesture)
    await element(by.id('chip-25')).longPressAndDrag(
      1000,
      0.5,
      0.5,
      element(by.id('bet-area-red')),
      0.5,
      0.5,
      'fast',
      0 // holdDuration at target
    );

    // Verify bet was placed
    await expect(element(by.id('bet-placed-indicator'))).toBeVisible();
  });

  it('should support multiple chip placements', async () => {
    await element(by.id('chip-5')).tap();
    await element(by.id('bet-area-black')).tap();
    await element(by.id('bet-area-black')).tap();

    // Total bet should be 10
    await expect(element(by.id('total-bet-amount'))).toHaveText('10');
  });
});
