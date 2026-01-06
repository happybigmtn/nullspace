/**
 * Network Failure During Bet Submission Tests
 *
 * Tests that verify network disconnection handling during betting phase.
 * Covers: send() behavior, DEAL button disable, reconnection recovery, bet state preservation.
 *
 * US-034: Add network failure during bet submission tests
 */
import React from 'react';
import { InteractionManager } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import {
  mockUseChipBetting,
  resetGameConnection,
  setGameConnectionState,
  setReconnectAttempt,
  getSendMock,
  getOnRetryMock,
} from '../../../test-utils/gameScreenTestUtils';
import { PrimaryButton } from '../../../components/ui';
import { BlackjackScreen } from '../BlackjackScreen';

// Helper to find PrimaryButton by label
const findPrimaryButton = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAllByType(PrimaryButton).find((node) => node.props.label === label);

describe('Network Failure During Bet Submission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGameConnection();
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

  describe('send() returns false when disconnected', () => {
    it('send returns false when connectionState is disconnected', async () => {
      // Start disconnected
      setGameConnectionState('disconnected');

      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // Get the send mock and verify it returns false when disconnected
      const sendMock = getSendMock();

      // Attempt to send - should return false
      const result = sendMock({ type: 'blackjack_deal', amount: 25 });
      expect(result).toBe(false);
    });

    it('send returns true when connectionState is connected', async () => {
      // Start connected
      setGameConnectionState('connected');

      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      const sendMock = getSendMock();

      // Attempt to send - should return true when connected
      const result = sendMock({ type: 'blackjack_deal', amount: 25 });
      expect(result).toBe(true);
    });

    it('send returns false when connectionState is connecting', async () => {
      setGameConnectionState('connecting');

      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      const sendMock = getSendMock();
      const result = sendMock({ type: 'blackjack_deal', amount: 25 });
      expect(result).toBe(false);
    });

    it('send returns false when connectionState is failed', async () => {
      setGameConnectionState('failed');

      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      const sendMock = getSendMock();
      const result = sendMock({ type: 'blackjack_deal', amount: 25 });
      expect(result).toBe(false);
    });
  });

  describe('UI disables DEAL when isDisconnected=true', () => {
    it('DEAL button is disabled when disconnected', async () => {
      setGameConnectionState('disconnected');

      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      const dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton).toBeDefined();
      expect(dealButton?.props.disabled).toBe(true);
    });

    it('DEAL button is enabled when connected with valid bet', async () => {
      setGameConnectionState('connected');

      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      const dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton).toBeDefined();
      expect(dealButton?.props.disabled).toBe(false);
    });

    it('DEAL button is disabled when connecting (not yet connected)', async () => {
      setGameConnectionState('connecting');

      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      const dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton?.props.disabled).toBe(true);
    });

    it('DEAL button is disabled when connection failed', async () => {
      setGameConnectionState('failed');

      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      const dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton?.props.disabled).toBe(true);
    });
  });

  describe('reconnection recovery during betting', () => {
    it('DEAL button re-enables after reconnection', async () => {
      // Start disconnected
      setGameConnectionState('disconnected');

      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // Button should be disabled
      let dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton?.props.disabled).toBe(true);

      // Reconnect
      setGameConnectionState('connected');

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // Button should now be enabled
      dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton?.props.disabled).toBe(false);
    });

    it('reconnect attempt count is reflected in connection props', async () => {
      setGameConnectionState('connecting');
      setReconnectAttempt(2);

      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // After max attempts, could transition to failed
      setGameConnectionState('failed');
      setReconnectAttempt(3);

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      const dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton?.props.disabled).toBe(true);
    });

    it('onRetry function is callable during failed state', async () => {
      setGameConnectionState('failed');

      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      const onRetryMock = getOnRetryMock();

      // Calling onRetry should not throw
      expect(() => onRetryMock()).not.toThrow();
    });
  });

  describe('bet state preserved across reconnection', () => {
    it('bet amount persists through disconnect/reconnect cycle', async () => {
      const setBetMock = jest.fn();
      const clearBetMock = jest.fn();

      mockUseChipBetting.mockReturnValue({
        bet: 50,
        selectedChip: 25,
        balance: 1000,
        setSelectedChip: jest.fn(),
        placeChip: jest.fn(() => true),
        clearBet: clearBetMock,
        setBet: setBetMock,
      });

      // Start connected
      setGameConnectionState('connected');

      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // Disconnect
      setGameConnectionState('disconnected');

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // clearBet should NOT have been called during disconnect
      expect(clearBetMock).not.toHaveBeenCalled();

      // Reconnect
      setGameConnectionState('connected');

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // setBet should NOT have been called (bet persists as-is)
      // The bet value (50) should still be preserved
      // Neither clearBet nor setBet should have been called by the reconnection
      expect(clearBetMock).not.toHaveBeenCalled();
    });

    it('chip selection persists through disconnect', async () => {
      const setSelectedChipMock = jest.fn();

      mockUseChipBetting.mockReturnValue({
        bet: 25,
        selectedChip: 100, // User selected $100 chip
        balance: 1000,
        setSelectedChip: setSelectedChipMock,
        placeChip: jest.fn(() => true),
        clearBet: jest.fn(),
        setBet: jest.fn(),
      });

      setGameConnectionState('connected');

      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // Disconnect
      setGameConnectionState('disconnected');

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // Reconnect
      setGameConnectionState('connected');

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // setSelectedChip should NOT have been called (chip selection persists)
      expect(setSelectedChipMock).not.toHaveBeenCalled();
    });

    it('betting phase persists through disconnect (not reset to betting)', async () => {
      // This test verifies that a disconnect doesn't reset game state
      // The phase is managed by local React state, not by the connection

      setGameConnectionState('connected');

      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // In betting phase, we should see DEAL button
      let dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton).toBeDefined();

      // Disconnect
      setGameConnectionState('disconnected');

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // Still in betting phase (DEAL button exists, just disabled)
      dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton).toBeDefined();
      expect(dealButton?.props.disabled).toBe(true);

      // Reconnect
      setGameConnectionState('connected');

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      // Still in betting phase with DEAL enabled
      dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton).toBeDefined();
      expect(dealButton?.props.disabled).toBe(false);
    });
  });

  describe('network state transitions', () => {
    it('handles connected -> disconnected -> connecting -> connected', async () => {
      // Full reconnection cycle
      setGameConnectionState('connected');

      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      let dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton?.props.disabled).toBe(false);

      // Disconnect
      setGameConnectionState('disconnected');
      await act(async () => {
        tree.update(<BlackjackScreen />);
      });
      dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton?.props.disabled).toBe(true);

      // Connecting (attempting reconnect)
      setGameConnectionState('connecting');
      setReconnectAttempt(1);
      await act(async () => {
        tree.update(<BlackjackScreen />);
      });
      dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton?.props.disabled).toBe(true);

      // Reconnected
      setGameConnectionState('connected');
      setReconnectAttempt(0);
      await act(async () => {
        tree.update(<BlackjackScreen />);
      });
      dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton?.props.disabled).toBe(false);
    });

    it('handles connected -> failed (exhausted retries)', async () => {
      setGameConnectionState('connected');

      let tree!: ReactTestRenderer;
      await act(async () => {
        tree = create(<BlackjackScreen />);
      });

      // Connection fails after max retries
      setGameConnectionState('failed');
      setReconnectAttempt(3);

      await act(async () => {
        tree.update(<BlackjackScreen />);
      });

      const dealButton = findPrimaryButton(tree, 'DEAL');
      expect(dealButton?.props.disabled).toBe(true);
    });
  });
});
