/**
 * Bet Rejection Handling Tests
 *
 * Tests that verify server bet rejections are handled correctly across game screens.
 * Covers: error message types, insufficient balance, below minimum, UI recovery.
 *
 * US-032: Add server bet rejection tests
 */
import React from 'react';
import { InteractionManager, Text } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import {
  mockHaptics,
  mockUseGameConnection,
  mockUseChipBetting,
  pressAll,
  resetGameConnection,
  setGameConnectionMessage,
} from '../../../test-utils/gameScreenTestUtils';
import { PrimaryButton } from '../../../components/ui';
import { BlackjackScreen } from '../BlackjackScreen';

// Helper to find PrimaryButton by label
const findPrimaryButton = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAllByType(PrimaryButton).find((node) => node.props.label === label);

// Helper to find Text containing a substring
const findTextContaining = (tree: ReactTestRenderer, substring: string) =>
  tree.root.findAllByType(Text).find((node) => {
    const children = node.props.children;
    if (typeof children === 'string') {
      return children.includes(substring);
    }
    if (Array.isArray(children)) {
      return children.some((c) => typeof c === 'string' && c.includes(substring));
    }
    return false;
  });

// Mock useBetSubmission to control isSubmitting state
let mockIsSubmitting = false;
let mockSubmitBetReturnValue = true;
const mockClearSubmission = jest.fn();
const mockSubmitBet = jest.fn(() => mockSubmitBetReturnValue);

jest.mock('../../../hooks/useBetSubmission', () => ({
  useBetSubmission: jest.fn(() => ({
    isSubmitting: mockIsSubmitting,
    submitBet: mockSubmitBet,
    clearSubmission: mockClearSubmission,
  })),
}));

describe('Bet Rejection Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGameConnection();
    mockIsSubmitting = false;
    mockSubmitBetReturnValue = true;
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation((cb) => {
      if (typeof cb === 'function') cb();
      return { cancel: jest.fn(), then: jest.fn(), done: jest.fn() };
    });
    // Set up chip betting to have a valid bet
    mockUseChipBetting.mockReturnValue({
      bet: 25,
      selectedChip: 25,
      balance: 1000,
      setSelectedChip: jest.fn(),
      placeChip: jest.fn(() => true),
      clearBet: jest.fn(),
      setBet: jest.fn(),
    });
  });

  describe('handling error message type', () => {
    it('displays generic error message from server', async () => {
      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // Send an error message from server
      setGameConnectionMessage({
        type: 'error',
        code: 'TRANSACTION_REJECTED',
        message: 'Transaction failed',
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // Verify error message is displayed
      const errorText = findTextContaining(tree, 'Transaction failed');
      expect(errorText).toBeDefined();
    });

    it('calls clearSubmission on error message', async () => {
      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // Send error message
      setGameConnectionMessage({
        type: 'error',
        code: 'INVALID_BET',
        message: 'Invalid bet amount',
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // Verify clearSubmission was called to re-enable DEAL button
      expect(mockClearSubmission).toHaveBeenCalled();
    });

    it('displays fallback message when error has no message field', async () => {
      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // Send error with no message
      setGameConnectionMessage({
        type: 'error',
        code: 'INTERNAL_ERROR',
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // Should display fallback message
      const fallbackText = findTextContaining(tree, 'Action failed');
      expect(fallbackText).toBeDefined();
    });
  });

  describe('insufficient balance rejection', () => {
    it('displays INSUFFICIENT_BALANCE error message', async () => {
      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // Simulate insufficient balance rejection from server
      setGameConnectionMessage({
        type: 'error',
        code: 'INSUFFICIENT_BALANCE',
        message: 'Insufficient funds for this bet',
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // Verify insufficient balance message shown
      const errorText = findTextContaining(tree, 'Insufficient funds');
      expect(errorText).toBeDefined();
    });

    it('re-enables DEAL button after insufficient balance rejection', async () => {
      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // Send insufficient balance error
      setGameConnectionMessage({
        type: 'error',
        code: 'INSUFFICIENT_BALANCE',
        message: 'Not enough balance',
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // clearSubmission should be called to allow retry
      expect(mockClearSubmission).toHaveBeenCalled();
    });
  });

  describe('below minimum bet rejection', () => {
    it('displays INVALID_BET error for below-minimum bets', async () => {
      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // Simulate below-minimum bet rejection
      setGameConnectionMessage({
        type: 'error',
        code: 'INVALID_BET',
        message: 'Bet below minimum (10)',
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // Verify minimum bet message shown
      const errorText = findTextContaining(tree, 'Bet below minimum');
      expect(errorText).toBeDefined();
    });

    it('re-enables DEAL button after minimum bet rejection', async () => {
      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      setGameConnectionMessage({
        type: 'error',
        code: 'INVALID_BET',
        message: 'Bet must be at least 10',
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // clearSubmission should be called
      expect(mockClearSubmission).toHaveBeenCalled();
    });
  });

  describe('UI recovery after rejection', () => {
    it('DEAL button is disabled while isSubmitting is true', async () => {
      mockIsSubmitting = true;

      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      const dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton).toBeDefined();
      expect(dealButton?.props.disabled).toBe(true);
    });

    it('DEAL button re-enables after clearSubmission (simulating error response)', async () => {
      // Start with submitting state
      mockIsSubmitting = true;

      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // Button should be disabled
      let dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton?.props.disabled).toBe(true);

      // Simulate server error received - this triggers clearSubmission
      setGameConnectionMessage({
        type: 'error',
        code: 'INSUFFICIENT_BALANCE',
        message: 'Not enough balance',
      });

      // Mock state changes after clearSubmission
      mockIsSubmitting = false;

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // Button should now be enabled (bet > 0, not submitting, not disconnected)
      dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton?.props.disabled).toBe(false);
    });

    it('allows retry after bet rejection', async () => {
      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // First: receive rejection
      setGameConnectionMessage({
        type: 'error',
        code: 'TRANSACTION_REJECTED',
        message: 'Transaction failed - try again',
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // clearSubmission should have been called
      expect(mockClearSubmission).toHaveBeenCalled();
      mockClearSubmission.mockClear();

      // Second: user can try again (DEAL button pressable)
      const dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton).toBeDefined();

      if (dealButton) {
        await act(async () => {
          dealButton.props.onPress?.();
        });

        // submitBet should be called again
        expect(mockSubmitBet).toHaveBeenCalled();
      }
    });

    it('displays sequential error messages correctly', async () => {
      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // First error
      setGameConnectionMessage({
        type: 'error',
        code: 'INSUFFICIENT_BALANCE',
        message: 'First error: insufficient balance',
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      let errorText = findTextContaining(tree, 'First error');
      expect(errorText).toBeDefined();

      // Second error (different message)
      setGameConnectionMessage({
        type: 'error',
        code: 'INVALID_BET',
        message: 'Second error: invalid bet',
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // Should show second error message now
      errorText = findTextContaining(tree, 'Second error');
      expect(errorText).toBeDefined();
    });
  });

  describe('game in progress rejection', () => {
    it('displays GAME_IN_PROGRESS error when trying to start new game', async () => {
      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      setGameConnectionMessage({
        type: 'error',
        code: 'GAME_IN_PROGRESS',
        message: 'Cannot start new game while one is active',
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      const errorText = findTextContaining(tree, 'Cannot start new game');
      expect(errorText).toBeDefined();
    });
  });

  describe('backend errors', () => {
    it('displays BACKEND_UNAVAILABLE error', async () => {
      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      setGameConnectionMessage({
        type: 'error',
        code: 'BACKEND_UNAVAILABLE',
        message: 'Service temporarily unavailable',
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      const errorText = findTextContaining(tree, 'Service temporarily unavailable');
      expect(errorText).toBeDefined();
    });

    it('displays NONCE_MISMATCH error', async () => {
      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      setGameConnectionMessage({
        type: 'error',
        code: 'NONCE_MISMATCH',
        message: 'Transaction nonce mismatch - please retry',
      });

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      const errorText = findTextContaining(tree, 'nonce mismatch');
      expect(errorText).toBeDefined();
    });
  });
});
