import React from 'react';
import { act, create } from 'react-test-renderer';
import { useGatewaySession } from '../useGatewaySession';
import { useWebSocketContext } from '../../context/WebSocketContext';
import { useGameStore } from '../../stores/gameStore';
import { initAnalytics, setAnalyticsContext, track } from '../../services/analytics';

jest.mock('../../context/WebSocketContext', () => ({
  useWebSocketContext: jest.fn(),
}));

jest.mock('../../services/analytics', () => ({
  initAnalytics: jest.fn(),
  setAnalyticsContext: jest.fn(),
  track: jest.fn(),
}));

jest.mock('../../stores/gameStore', () => {
  const mockStore = jest.fn() as jest.Mock & { getState: jest.Mock };
  // Add getState method for direct store access in timeout callback
  mockStore.getState = jest.fn();
  return {
    useGameStore: mockStore,
  };
});

const mockUseWebSocketContext = useWebSocketContext as jest.Mock;
const mockUseGameStore = useGameStore as unknown as jest.Mock & { getState: jest.Mock };

type HookResult<T> = {
  getResult: () => T;
  rerender: () => void;
  unmount: () => void;
};

function renderHook<T>(hook: () => T): HookResult<T> {
  let result!: T;
  const TestComponent = () => {
    result = hook();
    return null;
  };

  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(<TestComponent />);
  });

  return {
    getResult: () => result,
    rerender: () => act(() => renderer.update(<TestComponent />)),
    unmount: () => act(() => renderer.unmount()),
  };
}

describe('useGatewaySession', () => {
  let store: {
    setBalance: jest.Mock;
    setBalanceReady: jest.Mock;
    setBalanceWithSeq: jest.Mock;
    setSessionInfo: jest.Mock;
    setFaucetStatus: jest.Mock;
    setSessionExpired: jest.Mock;
    faucetStatus: 'idle' | 'pending' | 'success' | 'error';
    sessionExpired: boolean;
    lastBalanceSeq: number;
  };

  beforeEach(() => {
    store = {
      setBalance: jest.fn(),
      setBalanceReady: jest.fn(),
      setBalanceWithSeq: jest.fn((balance: number, balanceSeq: number) => {
        // Mimic the real store behavior: only accept if seq > lastBalanceSeq
        if (balanceSeq > store.lastBalanceSeq) {
          store.lastBalanceSeq = balanceSeq;
          return true;
        }
        return false;
      }),
      setSessionInfo: jest.fn(),
      setFaucetStatus: jest.fn((status: typeof store.faucetStatus) => {
        store.faucetStatus = status;
      }),
      setSessionExpired: jest.fn((expired: boolean) => {
        store.sessionExpired = expired;
      }),
      faucetStatus: 'idle',
      sessionExpired: false,
      lastBalanceSeq: 0,
    };

    mockUseGameStore.mockImplementation((selector: (state: typeof store) => unknown) => selector(store));
    // Set up getState to return the store for direct access
    mockUseGameStore.getState.mockImplementation(() => store);
    mockUseWebSocketContext.mockReset();
    (initAnalytics as jest.Mock).mockClear();
    (setAnalyticsContext as jest.Mock).mockClear();
    (track as jest.Mock).mockClear();
  });

  it('requests balance on connect and initializes analytics', () => {
    const send = jest.fn();
    const disconnect = jest.fn();
    mockUseWebSocketContext.mockReturnValue({
      connectionState: 'connected',
      send,
      lastMessage: null,
      disconnect,
    });

    const { unmount } = renderHook(() => useGatewaySession());

    expect(initAnalytics).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({ type: 'get_balance' });
    unmount();
  });

  it('handles session_ready and balance updates', () => {
    const send = jest.fn();
    const disconnect = jest.fn();
    const sessionMessage = {
      type: 'session_ready',
      sessionId: 'session-1',
      publicKey: 'pub',
      registered: true,
      hasBalance: true,
      balance: '100',
    };
    mockUseWebSocketContext.mockReturnValue({
      connectionState: 'connected',
      send,
      lastMessage: sessionMessage,
      disconnect,
    });

    const { getResult, rerender, unmount } = renderHook(() => useGatewaySession());

    expect(store.setSessionInfo).toHaveBeenCalledWith({
      sessionId: 'session-1',
      publicKey: 'pub',
      registered: true,
      hasBalance: true,
    });
    expect(setAnalyticsContext).toHaveBeenCalledWith({ publicKey: 'pub' });
    expect(track).toHaveBeenCalledWith('casino.session.started', expect.objectContaining({
      source: 'mobile',
      registered: true,
      hasBalance: true,
    }));
    expect(store.setBalance).toHaveBeenCalledWith(100);
    expect(store.setBalanceReady).toHaveBeenCalledWith(true);
    expect(send).toHaveBeenCalledWith({ type: 'get_balance' });
    rerender();
    expect(getResult().sessionId).toBe('session-1');
    unmount();
  });

  it('handles faucet claim and error state', () => {
    const send = jest.fn();
    const disconnect = jest.fn();
    store.faucetStatus = 'pending';
    mockUseWebSocketContext.mockReturnValue({
      connectionState: 'connected',
      send,
      lastMessage: { type: 'error', message: 'Denied' },
      disconnect,
    });

    renderHook(() => useGatewaySession());

    expect(store.setFaucetStatus).toHaveBeenCalledWith('error', 'Denied');
  });

  it('tracks completed games and updates balance', () => {
    const send = jest.fn();
    const disconnect = jest.fn();
    mockUseWebSocketContext.mockReturnValue({
      connectionState: 'connected',
      send,
      lastMessage: {
        type: 'game_result',
        gameType: 'blackjack',
        won: true,
        payout: '50',
        finalChips: '150',
        sessionId: 'session-1',
      },
      disconnect,
    });

    renderHook(() => useGatewaySession());

    expect(track).toHaveBeenCalledWith('casino.game.completed', expect.objectContaining({
      source: 'mobile',
      gameType: 'blackjack',
      won: true,
      sessionId: 'session-1',
    }));
    expect(store.setBalance).toHaveBeenCalledWith(150);
    expect(store.setBalanceReady).toHaveBeenCalledWith(true);
  });

  it('sends faucet requests with optional amount', () => {
    const send = jest.fn();
    const disconnect = jest.fn();
    mockUseWebSocketContext.mockReturnValue({
      connectionState: 'disconnected',
      send,
      lastMessage: null,
      disconnect,
    });

    const { getResult } = renderHook(() => useGatewaySession());
    act(() => {
      getResult().requestFaucet();
    });
    act(() => {
      getResult().requestFaucet(500);
    });

    expect(store.setFaucetStatus).toHaveBeenCalledWith('pending', 'Requesting faucet...');
    expect(send).toHaveBeenCalledWith({ type: 'faucet_claim' });
    expect(send).toHaveBeenCalledWith({ type: 'faucet_claim', amount: 500 });
  });

  describe('faucet status lifecycle', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('resets faucet status to idle after success', () => {
      const send = jest.fn();
      const disconnect = jest.fn();
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: {
          type: 'balance',
          publicKey: 'pub',
          registered: true,
          hasBalance: true,
          balance: '1000',
          message: 'FAUCET_CLAIMED',
        },
        disconnect,
      });

      renderHook(() => useGatewaySession());

      // Initially sets to success
      expect(store.setFaucetStatus).toHaveBeenCalledWith('success', 'Faucet claimed');

      // Advance timer to trigger reset
      act(() => {
        jest.advanceTimersByTime(3000);
      });

      // Should reset to idle after timeout
      expect(store.setFaucetStatus).toHaveBeenCalledWith('idle', null);
    });

    it('only attributes error to faucet when faucetStatus is pending', () => {
      const send = jest.fn();
      const disconnect = jest.fn();

      // Case 1: faucetStatus is 'idle' - error should NOT update faucet status
      store.faucetStatus = 'idle';
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: { type: 'error', message: 'Some other error' },
        disconnect,
      });

      const { unmount } = renderHook(() => useGatewaySession());
      expect(store.setFaucetStatus).not.toHaveBeenCalledWith('error', expect.any(String));
      unmount();
    });

    it('does not attribute error to faucet when status is success', () => {
      const send = jest.fn();
      const disconnect = jest.fn();

      // faucetStatus is 'success' - error should NOT update faucet status
      store.faucetStatus = 'success';
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: { type: 'error', message: 'Some other error' },
        disconnect,
      });

      const { unmount } = renderHook(() => useGatewaySession());
      expect(store.setFaucetStatus).not.toHaveBeenCalledWith('error', expect.any(String));
      unmount();
    });

    it('only attributes error to faucet when status is pending', () => {
      const send = jest.fn();
      const disconnect = jest.fn();

      // faucetStatus is 'pending' - error SHOULD update faucet status
      store.faucetStatus = 'pending';
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: { type: 'error', message: 'Faucet denied' },
        disconnect,
      });

      const { unmount } = renderHook(() => useGatewaySession());
      expect(store.setFaucetStatus).toHaveBeenCalledWith('error', 'Faucet denied');
      unmount();
    });

    it('subsequent faucet requests work after success', () => {
      const send = jest.fn();
      const disconnect = jest.fn();
      store.faucetStatus = 'success';

      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: null,
        disconnect,
      });

      const { getResult, unmount } = renderHook(() => useGatewaySession());

      // Request faucet even when status is 'success'
      act(() => {
        getResult().requestFaucet();
      });

      // Should set to pending (overwriting success)
      expect(store.setFaucetStatus).toHaveBeenCalledWith('pending', 'Requesting faucet...');
      expect(send).toHaveBeenCalledWith({ type: 'faucet_claim' });
      unmount();
    });

    it('subsequent faucet requests work after error', () => {
      const send = jest.fn();
      const disconnect = jest.fn();
      store.faucetStatus = 'error';

      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: null,
        disconnect,
      });

      const { getResult, unmount } = renderHook(() => useGatewaySession());

      // Request faucet even when status is 'error'
      act(() => {
        getResult().requestFaucet(1000);
      });

      // Should set to pending (overwriting error)
      expect(store.setFaucetStatus).toHaveBeenCalledWith('pending', 'Requesting faucet...');
      expect(send).toHaveBeenCalledWith({ type: 'faucet_claim', amount: 1000 });
      unmount();
    });

    it('timeout cleans up on unmount', () => {
      const send = jest.fn();
      const disconnect = jest.fn();
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: {
          type: 'balance',
          publicKey: 'pub',
          registered: true,
          hasBalance: true,
          balance: '1000',
          message: 'FAUCET_CLAIMED',
        },
        disconnect,
      });

      const { unmount } = renderHook(() => useGatewaySession());

      // Initially sets to success
      expect(store.setFaucetStatus).toHaveBeenCalledWith('success', 'Faucet claimed');
      store.setFaucetStatus.mockClear();

      // Unmount before timeout fires
      unmount();

      // Advance timer
      act(() => {
        jest.advanceTimersByTime(3000);
      });

      // Should NOT call setFaucetStatus after unmount
      expect(store.setFaucetStatus).not.toHaveBeenCalled();
    });

    it('timeout does not reset if faucetStatus changed to pending again', () => {
      const send = jest.fn();
      const disconnect = jest.fn();
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: null,
        disconnect,
      });

      const { getResult, unmount } = renderHook(() => useGatewaySession());

      // Manually trigger success first (simulating previous claim)
      store.faucetStatus = 'success';

      // Immediately request another faucet (user clicked again quickly)
      act(() => {
        getResult().requestFaucet();
      });

      expect(store.setFaucetStatus).toHaveBeenCalledWith('pending', 'Requesting faucet...');

      // Advance timer past the success reset timeout
      store.setFaucetStatus.mockClear();
      act(() => {
        jest.advanceTimersByTime(3000);
      });

      // Should NOT reset to idle since we're now pending
      expect(store.setFaucetStatus).not.toHaveBeenCalledWith('idle', null);
      unmount();
    });
  });

  describe('SESSION_EXPIRED handling (US-068)', () => {
    it('handles SESSION_EXPIRED error message', () => {
      const send = jest.fn();
      const disconnect = jest.fn();
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: {
          type: 'error',
          code: 'SESSION_EXPIRED',
          message: 'Your session has timed out',
        },
        disconnect,
      });

      const { unmount } = renderHook(() => useGatewaySession());

      // Should set session expired state
      expect(store.setSessionExpired).toHaveBeenCalledWith(
        true,
        'Your session has timed out'
      );
      // Should track the event
      expect(track).toHaveBeenCalledWith('casino.session.expired', { source: 'mobile' });
      // Store's sessionExpired was set via the mock
      expect(store.sessionExpired).toBe(true);
      unmount();
    });

    it('clears session info on SESSION_EXPIRED', () => {
      const send = jest.fn();
      const disconnect = jest.fn();
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: {
          type: 'error',
          code: 'SESSION_EXPIRED',
          message: 'Session expired',
        },
        disconnect,
      });

      const { unmount } = renderHook(() => useGatewaySession());

      // Should clear session info
      expect(store.setSessionInfo).toHaveBeenCalledWith({
        sessionId: null,
        publicKey: null,
        registered: false,
        hasBalance: false,
      });
      expect(store.setBalanceReady).toHaveBeenCalledWith(false);
      unmount();
    });

    it('disconnects WebSocket on SESSION_EXPIRED to prevent reconnect loop', () => {
      const send = jest.fn();
      const disconnect = jest.fn();
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: {
          type: 'error',
          code: 'SESSION_EXPIRED',
          message: 'Session expired',
        },
        disconnect,
      });

      const { unmount } = renderHook(() => useGatewaySession());

      // Should call disconnect to prevent auto-reconnect
      expect(disconnect).toHaveBeenCalled();
      unmount();
    });

    it('uses default message when SESSION_EXPIRED has no message', () => {
      const send = jest.fn();
      const disconnect = jest.fn();
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: {
          type: 'error',
          code: 'SESSION_EXPIRED',
        },
        disconnect,
      });

      const { unmount } = renderHook(() => useGatewaySession());

      expect(store.setSessionExpired).toHaveBeenCalledWith(
        true,
        'Your session has expired. Please log in again.'
      );
      unmount();
    });

    it('does not handle SESSION_EXPIRED for other error codes', () => {
      const send = jest.fn();
      const disconnect = jest.fn();
      store.faucetStatus = 'idle';
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: {
          type: 'error',
          code: 'INSUFFICIENT_BALANCE',
          message: 'Not enough chips',
        },
        disconnect,
      });

      const { unmount } = renderHook(() => useGatewaySession());

      // Should NOT set session expired
      expect(store.setSessionExpired).not.toHaveBeenCalled();
      // Should NOT disconnect
      expect(disconnect).not.toHaveBeenCalled();
      unmount();
    });

    it('SESSION_EXPIRED takes priority over faucet error handling', () => {
      const send = jest.fn();
      const disconnect = jest.fn();
      store.faucetStatus = 'pending';
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: {
          type: 'error',
          code: 'SESSION_EXPIRED',
          message: 'Session expired',
        },
        disconnect,
      });

      const { unmount } = renderHook(() => useGatewaySession());

      // Should set session expired (not faucet error)
      expect(store.setSessionExpired).toHaveBeenCalledWith(true, 'Session expired');
      // Should NOT set faucet error
      expect(store.setFaucetStatus).not.toHaveBeenCalledWith('error', expect.any(String));
      unmount();
    });
  });

  describe('Out-of-order balance update handling (US-089)', () => {
    it('balance messages arriving out of order should use balanceSeq to determine latest', () => {
      const send = jest.fn();
      const disconnect = jest.fn();

      // First message with seq 2 and balance 900
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: {
          type: 'balance',
          publicKey: 'pub',
          registered: true,
          hasBalance: true,
          balance: '900',
          balanceSeq: '2',
        },
        disconnect,
      });

      const { rerender, unmount } = renderHook(() => useGatewaySession());
      // setBalanceWithSeq is called (not setBalance) when balanceSeq is present
      expect(store.setBalanceWithSeq).toHaveBeenLastCalledWith(900, 2);
      expect(store.lastBalanceSeq).toBe(2);

      // Second message with LOWER seq 1 and balance 1000 (older message arrived late)
      store.setBalanceWithSeq.mockClear();
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: {
          type: 'balance',
          publicKey: 'pub',
          registered: true,
          hasBalance: true,
          balance: '1000',
          balanceSeq: '1', // Lower seq = older message
        },
        disconnect,
      });

      rerender();

      // With proper sequencing (US-089), the stale message is IGNORED
      // setBalanceWithSeq returns false, so balance is not updated
      expect(store.setBalanceWithSeq).toHaveBeenCalledWith(1000, 1);
      expect(store.lastBalanceSeq).toBe(2); // Unchanged - stale message rejected
      unmount();
    });

    it('faucet response after get_balance response shows correct final (race condition)', () => {
      const send = jest.fn();
      const disconnect = jest.fn();

      // User requests faucet
      // Then balance response arrives (from earlier get_balance)
      // Then faucet response arrives (should be used)

      // First: Old balance response arrives
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: {
          type: 'balance',
          publicKey: 'pub',
          registered: true,
          hasBalance: true,
          balance: '500', // Old balance before faucet
        },
        disconnect,
      });

      const { rerender, unmount } = renderHook(() => useGatewaySession());
      expect(store.setBalance).toHaveBeenLastCalledWith(500);

      // Then: Faucet response arrives (should override)
      store.setBalance.mockClear();
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: {
          type: 'balance',
          publicKey: 'pub',
          registered: true,
          hasBalance: true,
          balance: '1500', // New balance after faucet
          message: 'FAUCET_CLAIMED',
        },
        disconnect,
      });

      rerender();
      expect(store.setBalance).toHaveBeenCalledWith(1500);
      unmount();
    });

    it('game_result balance should not be overwritten by stale get_balance response', () => {
      const send = jest.fn();
      const disconnect = jest.fn();

      // game_result arrives with authoritative balance after bet
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: {
          type: 'game_result',
          gameType: 'blackjack',
          won: true,
          payout: '50',
          finalChips: '950',
          sessionId: 'session-1',
          balance: '950',
          balanceSeq: '5',
        },
        disconnect,
      });

      const { rerender, unmount } = renderHook(() => useGatewaySession());
      expect(store.setBalanceWithSeq).toHaveBeenLastCalledWith(950, 5);
      expect(store.lastBalanceSeq).toBe(5);

      // Then stale get_balance response arrives
      store.setBalanceWithSeq.mockClear();
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: {
          type: 'balance',
          publicKey: 'pub',
          registered: true,
          hasBalance: true,
          balance: '1000', // Stale - from before game started
          balanceSeq: '2', // Lower seq than game_result
        },
        disconnect,
      });

      rerender();

      // US-089 FIX: stale message is rejected, balance stays at 950
      expect(store.setBalanceWithSeq).toHaveBeenCalledWith(1000, 2);
      expect(store.lastBalanceSeq).toBe(5); // Unchanged - stale rejected
      unmount();
    });

    it('game_started deducts balance correctly even with out-of-order messages', () => {
      const send = jest.fn();
      const disconnect = jest.fn();

      // game_started with bet deducted
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: {
          type: 'game_started',
          gameType: 'blackjack',
          bet: '100',
          sessionId: 'session-1',
          balance: '900', // 1000 - 100 bet
          balanceSeq: '3',
        },
        disconnect,
      });

      const { rerender, unmount } = renderHook(() => useGatewaySession());
      expect(store.setBalanceWithSeq).toHaveBeenLastCalledWith(900, 3);
      expect(store.lastBalanceSeq).toBe(3);

      // Stale balance arrives (from before game started)
      store.setBalanceWithSeq.mockClear();
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: {
          type: 'balance',
          publicKey: 'pub',
          registered: true,
          hasBalance: true,
          balance: '1000',
          balanceSeq: '1', // Older sequence
        },
        disconnect,
      });

      rerender();

      // US-089 FIX: stale balance is rejected, bet deduction preserved
      expect(store.setBalanceWithSeq).toHaveBeenCalledWith(1000, 1);
      expect(store.lastBalanceSeq).toBe(3); // Unchanged - stale rejected
      unmount();
    });

    it('messages without balanceSeq use last-write-wins (backward compatible)', () => {
      const send = jest.fn();
      const disconnect = jest.fn();

      // Legacy message without balanceSeq
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: {
          type: 'balance',
          publicKey: 'pub',
          registered: true,
          hasBalance: true,
          balance: '500',
          // No balanceSeq field
        },
        disconnect,
      });

      const { rerender, unmount } = renderHook(() => useGatewaySession());
      expect(store.setBalance).toHaveBeenLastCalledWith(500);

      // Another legacy message
      store.setBalance.mockClear();
      mockUseWebSocketContext.mockReturnValue({
        connectionState: 'connected',
        send,
        lastMessage: {
          type: 'balance',
          publicKey: 'pub',
          registered: true,
          hasBalance: true,
          balance: '600',
          // No balanceSeq field
        },
        disconnect,
      });

      rerender();
      expect(store.setBalance).toHaveBeenCalledWith(600);
      unmount();
    });
  });
});
