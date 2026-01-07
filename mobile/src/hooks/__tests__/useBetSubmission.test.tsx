import React from 'react';
import { act, create } from 'react-test-renderer';
import { useBetSubmission } from '../useBetSubmission';
import { useGameStore } from '../../stores/gameStore';

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

describe('useBetSubmission', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('double-tap rejection (isSubmitting flag)', () => {
    it('starts with isSubmitting=false', () => {
      const send = jest.fn().mockReturnValue(true);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      expect(getResult().isSubmitting).toBe(false);
      unmount();
    });

    it('sets isSubmitting=true after successful submit', () => {
      const send = jest.fn().mockReturnValue(true);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      let ok = false;
      act(() => {
        ok = getResult().submitBet({ type: 'blackjack_deal', amount: 25 });
      });

      expect(ok).toBe(true);
      expect(getResult().isSubmitting).toBe(true);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({ type: 'blackjack_deal', amount: 25 });
      unmount();
    });

    it('rejects duplicate submission while isSubmitting=true', () => {
      const send = jest.fn().mockReturnValue(true);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      // First submission should succeed
      let ok1 = false;
      act(() => {
        ok1 = getResult().submitBet({ type: 'blackjack_deal', amount: 25 });
      });
      expect(ok1).toBe(true);
      expect(send).toHaveBeenCalledTimes(1);

      // Second submission should be rejected (double-tap)
      let ok2 = false;
      act(() => {
        ok2 = getResult().submitBet({ type: 'blackjack_deal', amount: 25 });
      });
      expect(ok2).toBe(false);
      expect(send).toHaveBeenCalledTimes(1); // send not called again

      // Third submission also rejected
      let ok3 = false;
      act(() => {
        ok3 = getResult().submitBet({ type: 'blackjack_deal', amount: 50 });
      });
      expect(ok3).toBe(false);
      expect(send).toHaveBeenCalledTimes(1); // still 1

      unmount();
    });

    it('allows new submission after clearSubmission()', () => {
      const send = jest.fn().mockReturnValue(true);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      // First submission
      act(() => {
        getResult().submitBet({ type: 'blackjack_deal', amount: 25 });
      });
      expect(getResult().isSubmitting).toBe(true);

      // Clear submission (simulates server response received)
      act(() => {
        getResult().clearSubmission();
      });
      expect(getResult().isSubmitting).toBe(false);

      // New submission should succeed
      let ok = false;
      act(() => {
        ok = getResult().submitBet({ type: 'blackjack_deal', amount: 50 });
      });
      expect(ok).toBe(true);
      expect(send).toHaveBeenCalledTimes(2);
      unmount();
    });
  });

  describe('timeout auto-recovery (5s fallback)', () => {
    it('auto-clears isSubmitting after 5 seconds', () => {
      const send = jest.fn().mockReturnValue(true);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      act(() => {
        getResult().submitBet({ type: 'blackjack_deal', amount: 25 });
      });
      expect(getResult().isSubmitting).toBe(true);

      // Advance time by 4999ms - still submitting
      act(() => {
        jest.advanceTimersByTime(4999);
      });
      expect(getResult().isSubmitting).toBe(true);

      // Advance time by 1 more ms (total 5000ms) - should auto-clear
      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(getResult().isSubmitting).toBe(false);

      unmount();
    });

    it('allows new submission after timeout recovery', () => {
      const send = jest.fn().mockReturnValue(true);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      // First submission
      act(() => {
        getResult().submitBet({ type: 'blackjack_deal', amount: 25 });
      });

      // Wait for timeout
      act(() => {
        jest.advanceTimersByTime(5000);
      });
      expect(getResult().isSubmitting).toBe(false);

      // New submission should work
      let ok = false;
      act(() => {
        ok = getResult().submitBet({ type: 'blackjack_deal', amount: 50 });
      });
      expect(ok).toBe(true);
      expect(send).toHaveBeenCalledTimes(2);

      unmount();
    });

    it('clearSubmission cancels pending timeout', () => {
      const send = jest.fn().mockReturnValue(true);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      act(() => {
        getResult().submitBet({ type: 'blackjack_deal', amount: 25 });
      });

      // Clear before timeout
      act(() => {
        jest.advanceTimersByTime(2000);
        getResult().clearSubmission();
      });
      expect(getResult().isSubmitting).toBe(false);

      // After full 5s, should still be false (timeout was cancelled)
      act(() => {
        jest.advanceTimersByTime(3000);
      });
      expect(getResult().isSubmitting).toBe(false);

      unmount();
    });
  });

  describe('clearSubmission() on response', () => {
    it('clearSubmission sets isSubmitting to false', () => {
      const send = jest.fn().mockReturnValue(true);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      act(() => {
        getResult().submitBet({ type: 'blackjack_deal', amount: 25 });
      });
      expect(getResult().isSubmitting).toBe(true);

      act(() => {
        getResult().clearSubmission();
      });
      expect(getResult().isSubmitting).toBe(false);

      unmount();
    });

    it('clearSubmission is safe to call when not submitting', () => {
      const send = jest.fn().mockReturnValue(true);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      // Not submitting initially
      expect(getResult().isSubmitting).toBe(false);

      // Calling clearSubmission should not throw
      act(() => {
        getResult().clearSubmission();
      });
      expect(getResult().isSubmitting).toBe(false);

      unmount();
    });

    it('clearSubmission can be called multiple times safely', () => {
      const send = jest.fn().mockReturnValue(true);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      act(() => {
        getResult().submitBet({ type: 'blackjack_deal', amount: 25 });
      });

      // Clear multiple times
      act(() => {
        getResult().clearSubmission();
        getResult().clearSubmission();
        getResult().clearSubmission();
      });
      expect(getResult().isSubmitting).toBe(false);

      unmount();
    });
  });

  describe('send failure returns false immediately', () => {
    it('returns false when send() returns false', () => {
      const send = jest.fn().mockReturnValue(false);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      let ok = true;
      act(() => {
        ok = getResult().submitBet({ type: 'blackjack_deal', amount: 25 });
      });

      expect(ok).toBe(false);
      expect(send).toHaveBeenCalledTimes(1);
      // isSubmitting should NOT be set on send failure
      expect(getResult().isSubmitting).toBe(false);

      unmount();
    });

    it('does not set timeout when send() fails', () => {
      const send = jest.fn().mockReturnValue(false);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      act(() => {
        getResult().submitBet({ type: 'blackjack_deal', amount: 25 });
      });
      expect(getResult().isSubmitting).toBe(false);

      // Advance full timeout - should not change anything
      act(() => {
        jest.advanceTimersByTime(5000);
      });
      expect(getResult().isSubmitting).toBe(false);

      unmount();
    });

    it('allows immediate retry after send failure', () => {
      const send = jest.fn()
        .mockReturnValueOnce(false) // First call fails
        .mockReturnValue(true);     // Subsequent calls succeed

      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      // First attempt fails
      let ok1 = false;
      act(() => {
        ok1 = getResult().submitBet({ type: 'blackjack_deal', amount: 25 });
      });
      expect(ok1).toBe(false);
      expect(getResult().isSubmitting).toBe(false);

      // Immediate retry should work (no debounce on failed send)
      let ok2 = false;
      act(() => {
        ok2 = getResult().submitBet({ type: 'blackjack_deal', amount: 25 });
      });
      expect(ok2).toBe(true);
      expect(getResult().isSubmitting).toBe(true);
      expect(send).toHaveBeenCalledTimes(2);

      unmount();
    });
  });

  describe('unmount cleanup', () => {
    it('clears timeout on unmount', () => {
      const send = jest.fn().mockReturnValue(true);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      act(() => {
        getResult().submitBet({ type: 'blackjack_deal', amount: 25 });
      });
      expect(getResult().isSubmitting).toBe(true);

      // Unmount before timeout
      act(() => {
        unmount();
      });

      // Advance past timeout - should not cause issues
      act(() => {
        jest.advanceTimersByTime(10000);
      });
      // No assertions - just verifying no errors thrown
    });
  });

  describe('concurrent submission scenarios', () => {
    it('rapid-fire taps only submit once', () => {
      const send = jest.fn().mockReturnValue(true);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      // Simulate 5 rapid taps - each tap is a separate act() to allow state updates
      const results: boolean[] = [];
      act(() => {
        results.push(getResult().submitBet({ type: 'blackjack_deal', amount: 25 }));
      });
      act(() => {
        results.push(getResult().submitBet({ type: 'blackjack_deal', amount: 25 }));
      });
      act(() => {
        results.push(getResult().submitBet({ type: 'blackjack_deal', amount: 25 }));
      });
      act(() => {
        results.push(getResult().submitBet({ type: 'blackjack_deal', amount: 25 }));
      });
      act(() => {
        results.push(getResult().submitBet({ type: 'blackjack_deal', amount: 25 }));
      });

      // Only first tap should succeed
      expect(results).toEqual([true, false, false, false, false]);
      expect(send).toHaveBeenCalledTimes(1);

      unmount();
    });

    it('maintains message integrity under rapid submission', () => {
      const send = jest.fn().mockReturnValue(true);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      const message = { type: 'blackjack_deal', amount: 25, timestamp: Date.now() };
      act(() => {
        getResult().submitBet(message);
      });

      // Verify the exact message was sent
      expect(send).toHaveBeenCalledWith(message);

      unmount();
    });
  });

  // US-090: Concurrent bet validation lock tests
  describe('concurrent bet validation lock (US-090)', () => {
    beforeEach(() => {
      // Reset game store to known state
      useGameStore.setState({
        balance: 100,
        balanceReady: true,
        lastBalanceSeq: 1,
        betValidationLocked: false,
        pendingBalanceUpdate: null,
      });
    });

    it('validates bet amount against balance when amount provided', () => {
      const send = jest.fn().mockReturnValue(true);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      // Bet within balance should succeed
      let ok = false;
      act(() => {
        ok = getResult().submitBet({ type: 'test', amount: 50 }, { amount: 50 });
      });
      expect(ok).toBe(true);
      expect(send).toHaveBeenCalled();

      unmount();
    });

    it('rejects bet when amount exceeds balance', () => {
      const send = jest.fn().mockReturnValue(true);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      // Bet exceeding balance should fail
      let ok = false;
      act(() => {
        ok = getResult().submitBet({ type: 'test', amount: 150 }, { amount: 150 });
      });
      expect(ok).toBe(false);
      expect(send).not.toHaveBeenCalled();
      expect(getResult().isSubmitting).toBe(false);

      unmount();
    });

    it('locks during validation to prevent concurrent balance updates', () => {
      const send = jest.fn().mockReturnValue(true);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      // Submit bet - should lock
      act(() => {
        getResult().submitBet({ type: 'test', amount: 80 }, { amount: 80 });
      });
      expect(useGameStore.getState().betValidationLocked).toBe(true);

      // Balance update during lock should be queued
      act(() => {
        useGameStore.getState().setBalanceWithSeq(50, 2);
      });
      expect(useGameStore.getState().balance).toBe(100); // Still 100, not applied
      expect(useGameStore.getState().pendingBalanceUpdate).toEqual({ balance: 50, balanceSeq: 2 });

      unmount();
    });

    it('applies pending balance update after clearSubmission', () => {
      const send = jest.fn().mockReturnValue(true);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      // Submit bet - locks
      act(() => {
        getResult().submitBet({ type: 'test', amount: 80 }, { amount: 80 });
      });

      // Queue balance update
      act(() => {
        useGameStore.getState().setBalanceWithSeq(50, 2);
      });
      expect(useGameStore.getState().balance).toBe(100);

      // Clear submission - should unlock and apply pending
      act(() => {
        getResult().clearSubmission();
      });

      expect(useGameStore.getState().betValidationLocked).toBe(false);
      expect(useGameStore.getState().balance).toBe(50);
      expect(useGameStore.getState().lastBalanceSeq).toBe(2);
      expect(useGameStore.getState().pendingBalanceUpdate).toBeNull();

      unmount();
    });

    it('unlocks on send failure', () => {
      const send = jest.fn().mockReturnValue(false);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      act(() => {
        getResult().submitBet({ type: 'test', amount: 50 }, { amount: 50 });
      });

      // Lock should be released on send failure
      expect(useGameStore.getState().betValidationLocked).toBe(false);

      unmount();
    });

    it('unlocks on timeout', () => {
      const send = jest.fn().mockReturnValue(true);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      act(() => {
        getResult().submitBet({ type: 'test', amount: 50 }, { amount: 50 });
      });
      expect(useGameStore.getState().betValidationLocked).toBe(true);

      // Wait for timeout
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(useGameStore.getState().betValidationLocked).toBe(false);

      unmount();
    });

    it('rejects bet if balance changes between chip placement and submission', () => {
      const send = jest.fn().mockReturnValue(true);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      // User placed chips thinking balance was 100
      // But balance dropped to 50 before they clicked submit

      act(() => {
        useGameStore.setState({ balance: 50 });
      });

      // Submission with old bet amount should fail
      let ok = true;
      act(() => {
        ok = getResult().submitBet({ type: 'test', amount: 80 }, { amount: 80 });
      });
      expect(ok).toBe(false);
      expect(send).not.toHaveBeenCalled();

      unmount();
    });

    it('backward compat: submits without amount validation when amount not provided', () => {
      const send = jest.fn().mockReturnValue(true);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      // No amount option - should bypass validation (backward compat)
      let ok = false;
      act(() => {
        ok = getResult().submitBet({ type: 'test', amount: 999 }); // No options
      });
      expect(ok).toBe(true);
      expect(send).toHaveBeenCalled();
      expect(useGameStore.getState().betValidationLocked).toBe(false); // Not locked

      unmount();
    });

    it('no bet exceeds actual balance due to race', () => {
      // This test simulates the race condition scenario:
      // 1. User has bet = 80, balance = 100
      // 2. User clicks DEAL -> submitBet() called
      // 3. Balance update arrives (balance = 50)
      // 4. With the lock, balance update is queued, bet validation uses original balance

      const send = jest.fn().mockReturnValue(true);
      const { getResult, unmount } = renderHook(() => useBetSubmission(send));

      // Simulate rapid sequence
      act(() => {
        // User submits bet
        const success = getResult().submitBet({ type: 'test', amount: 80 }, { amount: 80 });
        expect(success).toBe(true);
        // Lock is held, balance update arrives
        useGameStore.getState().setBalanceWithSeq(50, 2);
      });

      // Bet was sent successfully because balance was 100 at time of validation
      expect(send).toHaveBeenCalledWith({ type: 'test', amount: 80 });
      // Balance update was queued, not applied
      expect(useGameStore.getState().balance).toBe(100);
      expect(useGameStore.getState().pendingBalanceUpdate).toEqual({ balance: 50, balanceSeq: 2 });

      // After server response, pending is applied
      act(() => {
        getResult().clearSubmission();
      });
      expect(useGameStore.getState().balance).toBe(50);

      unmount();
    });
  });
});
