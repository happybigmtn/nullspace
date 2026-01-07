/**
 * useResultReveal Hook Tests - US-119
 *
 * Tests for the result reveal state management hook.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { useResultReveal, determineOutcome, calculateIntensity } from '../useResultReveal';

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

describe('useResultReveal', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('initial state', () => {
    it('starts with isVisible false', () => {
      const { getResult } = renderHook(() => useResultReveal());
      expect(getResult().resultState.isVisible).toBe(false);
    });

    it('starts with empty state', () => {
      const { getResult } = renderHook(() => useResultReveal());
      expect(getResult().resultState.message).toBe('');
      expect(getResult().resultState.payout).toBe(0);
      expect(getResult().resultState.bet).toBe(0);
    });

    it('returns isResultVisible convenience getter', () => {
      const { getResult } = renderHook(() => useResultReveal());
      expect(getResult().isResultVisible).toBe(false);
    });
  });

  describe('showResult', () => {
    it('sets isVisible to true', () => {
      const { getResult } = renderHook(() => useResultReveal());

      act(() => {
        getResult().showResult({
          outcome: 'win',
          message: 'You Win!',
          payout: 100,
          bet: 100,
        });
      });

      expect(getResult().resultState.isVisible).toBe(true);
    });

    it('sets all config properties', () => {
      const { getResult } = renderHook(() => useResultReveal());

      act(() => {
        getResult().showResult({
          outcome: 'blackjack',
          message: 'Blackjack!',
          payout: 150,
          bet: 100,
          sessionDelta: 500,
          intensity: 'big',
        });
      });

      expect(getResult().resultState.outcome).toBe('blackjack');
      expect(getResult().resultState.message).toBe('Blackjack!');
      expect(getResult().resultState.payout).toBe(150);
      expect(getResult().resultState.bet).toBe(100);
      expect(getResult().resultState.sessionDelta).toBe(500);
      expect(getResult().resultState.intensity).toBe('big');
    });

    it('sets breakdown when provided', () => {
      const { getResult } = renderHook(() => useResultReveal());

      const breakdown = [
        { label: 'Main', amount: 100 },
        { label: 'Side', amount: 50 },
      ];

      act(() => {
        getResult().showResult({
          outcome: 'win',
          message: 'Win!',
          payout: 150,
          bet: 100,
          breakdown,
        });
      });

      expect(getResult().resultState.breakdown).toEqual(breakdown);
    });

    it('updates isResultVisible getter', () => {
      const { getResult } = renderHook(() => useResultReveal());

      act(() => {
        getResult().showResult({
          outcome: 'win',
          message: 'Win!',
          payout: 100,
          bet: 100,
        });
      });

      expect(getResult().isResultVisible).toBe(true);
    });
  });

  describe('hideResult', () => {
    it('sets isVisible to false', () => {
      const { getResult } = renderHook(() => useResultReveal());

      act(() => {
        getResult().showResult({
          outcome: 'win',
          message: 'Win!',
          payout: 100,
          bet: 100,
        });
      });

      expect(getResult().resultState.isVisible).toBe(true);

      act(() => {
        getResult().hideResult();
      });

      expect(getResult().resultState.isVisible).toBe(false);
    });

    it('resets state after animation delay', () => {
      const { getResult } = renderHook(() => useResultReveal());

      act(() => {
        getResult().showResult({
          outcome: 'blackjack',
          message: 'Blackjack!',
          payout: 150,
          bet: 100,
        });
      });

      act(() => {
        getResult().hideResult();
      });

      // State should still have values immediately
      expect(getResult().resultState.message).toBe('Blackjack!');

      // After animation delay, state resets
      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(getResult().resultState.message).toBe('');
      expect(getResult().resultState.payout).toBe(0);
    });
  });

  describe('show then show again', () => {
    it('clears pending hide and shows new result', () => {
      const { getResult } = renderHook(() => useResultReveal());

      act(() => {
        getResult().showResult({
          outcome: 'win',
          message: 'First Win!',
          payout: 100,
          bet: 100,
        });
      });

      act(() => {
        getResult().hideResult();
      });

      // Before hide completes, show again
      act(() => {
        getResult().showResult({
          outcome: 'blackjack',
          message: 'Blackjack!',
          payout: 200,
          bet: 100,
        });
      });

      expect(getResult().resultState.isVisible).toBe(true);
      expect(getResult().resultState.message).toBe('Blackjack!');
    });
  });

  describe('cleanup on unmount', () => {
    it('clears timeouts on unmount', () => {
      const { getResult, unmount } = renderHook(() => useResultReveal());

      act(() => {
        getResult().showResult({
          outcome: 'win',
          message: 'Win!',
          payout: 100,
          bet: 100,
        });
      });

      act(() => {
        getResult().hideResult();
      });

      // Unmount before timeout completes
      unmount();

      // Advancing timers should not throw
      act(() => {
        jest.advanceTimersByTime(500);
      });
    });
  });
});

describe('determineOutcome helper', () => {
  it('returns blackjack for won + isBlackjack', () => {
    expect(determineOutcome(true, false, true, false)).toBe('blackjack');
  });

  it('returns war for isWar', () => {
    expect(determineOutcome(false, false, false, true)).toBe('war');
  });

  it('returns push for push', () => {
    expect(determineOutcome(false, true, false, false)).toBe('push');
  });

  it('returns win for won', () => {
    expect(determineOutcome(true, false, false, false)).toBe('win');
  });

  it('returns loss for neither won nor push', () => {
    expect(determineOutcome(false, false, false, false)).toBe('loss');
  });

  it('handles undefined parameters', () => {
    expect(determineOutcome(undefined, undefined)).toBe('loss');
    expect(determineOutcome(true, undefined)).toBe('win');
    expect(determineOutcome(undefined, true)).toBe('push');
  });
});

describe('calculateIntensity helper', () => {
  it('returns jackpot for 5x+ multiplier', () => {
    // (400 + 100) / 100 = 5x
    expect(calculateIntensity(400, 100)).toBe('jackpot');
    // (500 + 100) / 100 = 6x
    expect(calculateIntensity(500, 100)).toBe('jackpot');
  });

  it('returns big for 3x-5x multiplier', () => {
    // (200 + 100) / 100 = 3x
    expect(calculateIntensity(200, 100)).toBe('big');
    // (300 + 100) / 100 = 4x
    expect(calculateIntensity(300, 100)).toBe('big');
  });

  it('returns medium for 1.5x-3x multiplier', () => {
    // (50 + 100) / 100 = 1.5x
    expect(calculateIntensity(50, 100)).toBe('medium');
    // (100 + 100) / 100 = 2x
    expect(calculateIntensity(100, 100)).toBe('medium');
  });

  it('returns small for under 1.5x', () => {
    // (25 + 100) / 100 = 1.25x
    expect(calculateIntensity(25, 100)).toBe('small');
    // (10 + 100) / 100 = 1.1x
    expect(calculateIntensity(10, 100)).toBe('small');
  });

  it('returns small for zero or negative bet', () => {
    expect(calculateIntensity(100, 0)).toBe('small');
    expect(calculateIntensity(100, -50)).toBe('small');
  });

  it('returns small for zero or negative payout', () => {
    expect(calculateIntensity(0, 100)).toBe('small');
    expect(calculateIntensity(-50, 100)).toBe('small');
  });
});
