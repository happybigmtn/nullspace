import React from 'react';
import { InteractionManager, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import {
  mockHaptics,
  mockUseChipBetting,
  mockUseGameConnection,
  pressAll,
  resetGameConnection,
  setGameConnectionMessage,
} from '../../../test-utils/gameScreenTestUtils';
import {
  createBlackjackPlayerTurnState,
  createBlackjackSplitableState,
} from '../../../test-utils/stateFixtures';
import { PrimaryButton } from '../../../components/ui';
import { BlackjackScreen } from '../BlackjackScreen';
import { parseBlackjackState as parseWrapper } from '../../../utils/state/blackjack';
import { decodeStateBytes } from '../../../utils/stateBytes';
import { parseBlackjackState as parseBlob } from '@nullspace/game-state';

const textMatches = (value: unknown, target: string): boolean => {
  if (typeof value === 'string') return value === target;
  if (Array.isArray(value)) return value.some((child) => textMatches(child, target));
  return false;
};

const findPrimaryButton = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAllByType(PrimaryButton).find((node) => node.props.label === label);

describe('BlackjackScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGameConnection();
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation((cb) => {
      if (typeof cb === 'function') cb();
      return { cancel: jest.fn(), then: jest.fn(), done: jest.fn() };
    });
  });

  it('parses state bytes correctly with real parser', () => {
    // Verify the parsing chain works with real parser (not mocked)
    const stateBytes = createBlackjackPlayerTurnState();
    const uint8 = decodeStateBytes(stateBytes);
    expect(uint8).not.toBeNull();

    // Test low-level parser from @nullspace/game-state
    const blobResult = parseBlob(new Uint8Array(stateBytes));
    expect(blobResult).not.toBeNull();
    expect(blobResult!.stage).toBe(1); // player_turn
    expect(blobResult!.actionMask).toBe(0b00000011); // hit + stand

    // Test mobile wrapper parser
    const wrapperResult = parseWrapper(uint8!);
    expect(wrapperResult).not.toBeNull();
    expect(wrapperResult!.phase).toBe('player_turn');
    expect(wrapperResult!.canDouble).toBe(false); // bit 2 not set
    expect(wrapperResult!.canSplit).toBe(false); // bit 3 not set
  });

  it('renders and handles actions', async () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<BlackjackScreen />);
    });

    await pressAll(tree);
    expect(tree.toJSON()).toBeTruthy();
  });

  it('handles game_result win and push states', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<BlackjackScreen />);
    });

    setGameConnectionMessage({
      type: 'game_result',
      won: true,
      hands: [{ cards: [0, 1], value: 20 }],
      dealer: { cards: [2, 3], value: 18 },
    });

    act(() => {
      tree.update(<BlackjackScreen />);
    });

    expect(mockHaptics.win).toHaveBeenCalled();

    setGameConnectionMessage({
      type: 'game_result',
      push: true,
      hands: [{ cards: [4, 5], value: 19 }],
      dealer: { cards: [6, 7], value: 19 },
    });

    act(() => {
      tree.update(<BlackjackScreen />);
    });

    expect(mockHaptics.push).toHaveBeenCalled();
  });

  it('sends stand action and updates to dealer turn', async () => {
    const sendSpy = mockUseGameConnection().send;

    // Create the component first in betting phase
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<BlackjackScreen />);
    });

    // Set up the game_started message with player turn state
    const stateBytes = createBlackjackPlayerTurnState();
    setGameConnectionMessage({
      type: 'game_started',
      state: stateBytes,
    });

    // Trigger re-render to process the message
    await act(async () => {
      tree.update(<BlackjackScreen />);
    });

    const standButton = findPrimaryButton(tree, 'STAND');
    expect(standButton).toBeDefined();

    await act(async () => {
      await standButton?.props.onPress?.();
    });

    expect(sendSpy).toHaveBeenCalledWith({ type: 'blackjack_stand' });
    const hasDealerTurn = tree.root
      .findAllByType(Text)
      .some((node) => textMatches(node.props.children, "Dealer's turn"));
    expect(hasDealerTurn).toBe(true);
  });

  it('sends double and split actions when allowed', async () => {
    const sendSpy = mockUseGameConnection().send;

    // Create the component first in betting phase
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<BlackjackScreen />);
    });

    // Set up a splitable state (pair of 8s) where double and split are allowed
    setGameConnectionMessage({
      type: 'game_started',
      state: createBlackjackSplitableState(),
    });

    // Trigger re-render to process the message
    await act(async () => {
      tree.update(<BlackjackScreen />);
    });

    const doubleButton = findPrimaryButton(tree, 'DOUBLE');
    expect(doubleButton).toBeDefined();
    await act(async () => {
      await doubleButton?.props.onPress?.();
    });

    expect(sendSpy).toHaveBeenCalledWith({ type: 'blackjack_double' });

    const splitButton = findPrimaryButton(tree, 'SPLIT');
    expect(splitButton).toBeDefined();
    await act(async () => {
      await splitButton?.props.onPress?.();
    });

    expect(sendSpy).toHaveBeenCalledWith({ type: 'blackjack_split' });
  });

  it('shows error message and TRY AGAIN button when state decode fails', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<BlackjackScreen />);
    });

    // Send a message with invalid state bytes (null/undefined)
    setGameConnectionMessage({
      type: 'game_started',
      state: null,
    });

    await act(async () => {
      tree.update(<BlackjackScreen />);
    });

    // Should show error message
    const hasErrorMessage = tree.root
      .findAllByType(Text)
      .some((node) => textMatches(node.props.children, 'Failed to load game state. Please try again.'));
    expect(hasErrorMessage).toBe(true);

    // Should show TRY AGAIN button
    const tryAgainButton = findPrimaryButton(tree, 'TRY AGAIN');
    expect(tryAgainButton).toBeDefined();
  });

  it('shows error message when state parse fails with empty bytes', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<BlackjackScreen />);
    });

    // Send a message with empty state bytes array (will decode but fail to parse)
    setGameConnectionMessage({
      type: 'game_started',
      state: [],
    });

    await act(async () => {
      tree.update(<BlackjackScreen />);
    });

    // Should show error message (either decode or parse failed)
    const hasErrorMessage = tree.root
      .findAllByType(Text)
      .some((node) =>
        textMatches(node.props.children, 'Failed to load game state. Please try again.') ||
        textMatches(node.props.children, 'Failed to parse game data. Please try again.')
      );
    expect(hasErrorMessage).toBe(true);

    // Should show TRY AGAIN button
    const tryAgainButton = findPrimaryButton(tree, 'TRY AGAIN');
    expect(tryAgainButton).toBeDefined();
  });

  it('recovers from error state when TRY AGAIN is pressed', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<BlackjackScreen />);
    });

    // Put into error state
    setGameConnectionMessage({
      type: 'game_started',
      state: null,
    });

    await act(async () => {
      tree.update(<BlackjackScreen />);
    });

    // Press TRY AGAIN
    const tryAgainButton = findPrimaryButton(tree, 'TRY AGAIN');
    expect(tryAgainButton).toBeDefined();
    await act(async () => {
      await tryAgainButton?.props.onPress?.();
    });

    // Should be back in betting phase with normal message
    const hasBettingMessage = tree.root
      .findAllByType(Text)
      .some((node) => textMatches(node.props.children, 'Place your bet'));
    expect(hasBettingMessage).toBe(true);

    // Should show DEAL button (betting phase)
    const dealButton = findPrimaryButton(tree, 'DEAL');
    expect(dealButton).toBeDefined();
  });

  describe('phase reversion after error', () => {
    beforeEach(() => {
      // Set up a non-zero bet so DEAL button is enabled
      mockUseChipBetting.mockReturnValue({
        bet: 100,
        selectedChip: 25,
        balance: 1000,
        setSelectedChip: jest.fn(),
        placeChip: jest.fn(() => true),
        clearBet: jest.fn(),
        setBet: jest.fn(),
      });
    });

    afterEach(() => {
      // Reset to default
      mockUseChipBetting.mockReturnValue({
        bet: 0,
        selectedChip: 25,
        balance: 1000,
        setSelectedChip: jest.fn(),
        placeChip: jest.fn(() => true),
        clearBet: jest.fn(),
        setBet: jest.fn(),
      });
    });

    it('reverts phase to betting after bet rejection error', async () => {
      let tree!: ReturnType<typeof create>;

      // Start in betting phase
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // Verify we're in betting phase with DEAL button
      let dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton).toBeDefined();

      // Simulate user pressing DEAL (phase changes optimistically to player_turn)
      await act(async () => {
        await dealButton?.props.onPress?.();
      });

      // Verify phase changed to player_turn (HIT/STAND buttons appear)
      const hitButton = findPrimaryButton(tree, 'HIT');
      expect(hitButton).toBeDefined();

      // Now simulate server rejecting the bet
      setGameConnectionMessage({
        type: 'error',
        message: 'Insufficient balance',
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // Should revert to betting phase with DEAL button
      dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton).toBeDefined();

      // Should show error message
      const hasErrorMessage = tree.root
        .findAllByType(Text)
        .some((node) => textMatches(node.props.children, 'Insufficient balance'));
      expect(hasErrorMessage).toBe(true);
    });

    it('DEAL button is re-enabled after error recovery', async () => {
      let tree!: ReturnType<typeof create>;

      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // Get DEAL button and check it's enabled (bet > 0 from beforeEach)
      let dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton).toBeDefined();
      expect(dealButton?.props.disabled).toBeFalsy();

      // Press DEAL
      await act(async () => {
        await dealButton?.props.onPress?.();
      });

      // Simulate error response
      setGameConnectionMessage({
        type: 'error',
        message: 'Network error',
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // DEAL button should be back and enabled
      dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton).toBeDefined();
      // isSubmitting should be cleared, so button should be enabled
      expect(dealButton?.props.disabled).toBeFalsy();
    });

    it('maintains betting state after multiple error recoveries', async () => {
      let tree!: ReturnType<typeof create>;

      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // First attempt
      let dealButton = findPrimaryButton(tree, 'DEAL');
      await act(async () => {
        await dealButton?.props.onPress?.();
      });

      setGameConnectionMessage({
        type: 'error',
        message: 'Error 1',
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // Should be back in betting phase
      dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton).toBeDefined();

      // Second attempt
      await act(async () => {
        await dealButton?.props.onPress?.();
      });

      setGameConnectionMessage({
        type: 'error',
        message: 'Error 2',
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // Should still be in betting phase
      dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton).toBeDefined();

      // Should show the latest error
      const hasErrorMessage = tree.root
        .findAllByType(Text)
        .some((node) => textMatches(node.props.children, 'Error 2'));
      expect(hasErrorMessage).toBe(true);
    });
  });

  describe('SESSION_EXPIRED during active game (US-068)', () => {
    beforeEach(() => {
      // Set up a non-zero bet for game interaction
      mockUseChipBetting.mockReturnValue({
        bet: 100,
        selectedChip: 25,
        balance: 1000,
        setSelectedChip: jest.fn(),
        placeChip: jest.fn(() => true),
        clearBet: jest.fn(),
        setBet: jest.fn(),
      });
    });

    afterEach(() => {
      // Reset to default
      mockUseChipBetting.mockReturnValue({
        bet: 0,
        selectedChip: 25,
        balance: 1000,
        setSelectedChip: jest.fn(),
        placeChip: jest.fn(() => true),
        clearBet: jest.fn(),
        setBet: jest.fn(),
      });
    });

    it('displays SESSION_EXPIRED message during active game', async () => {
      let tree!: ReturnType<typeof create>;

      // Start game
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // Get into playing phase
      const dealButton = findPrimaryButton(tree, 'DEAL');
      await act(async () => {
        await dealButton?.props.onPress?.();
      });

      // Simulate SESSION_EXPIRED error during game
      setGameConnectionMessage({
        type: 'error',
        code: 'SESSION_EXPIRED',
        message: 'Your session has expired. Please log in again.',
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // Should show the session expired message to user
      const hasSessionExpiredMessage = tree.root
        .findAllByType(Text)
        .some(
          (node) =>
            textMatches(node.props.children, 'Your session has expired. Please log in again.') ||
            textMatches(node.props.children, 'Session expired')
        );
      expect(hasSessionExpiredMessage).toBe(true);
    });

    it('reverts to betting phase when SESSION_EXPIRED received mid-game', async () => {
      let tree!: ReturnType<typeof create>;

      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // Get into player turn phase
      const stateBytes = createBlackjackPlayerTurnState();
      setGameConnectionMessage({
        type: 'game_started',
        state: stateBytes,
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // Verify we're in player turn
      const hitButton = findPrimaryButton(tree, 'HIT');
      expect(hitButton).toBeDefined();

      // Now session expires
      setGameConnectionMessage({
        type: 'error',
        code: 'SESSION_EXPIRED',
        message: 'Session has timed out',
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // Should revert to betting phase (can start a new game after re-auth)
      const dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton).toBeDefined();
    });

    it('shows appropriate message for session expiration vs regular errors', async () => {
      let tree!: ReturnType<typeof create>;

      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // Send a regular error first
      setGameConnectionMessage({
        type: 'error',
        code: 'INSUFFICIENT_BALANCE',
        message: 'Not enough chips',
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      const hasBalanceError = tree.root
        .findAllByType(Text)
        .some((node) => textMatches(node.props.children, 'Not enough chips'));
      expect(hasBalanceError).toBe(true);

      // Now send SESSION_EXPIRED
      setGameConnectionMessage({
        type: 'error',
        code: 'SESSION_EXPIRED',
        message: 'Your session has expired',
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // Should show session expired (supersedes balance error)
      const hasSessionExpired = tree.root
        .findAllByType(Text)
        .some((node) => textMatches(node.props.children, 'Your session has expired'));
      expect(hasSessionExpired).toBe(true);
    });
  });
});
