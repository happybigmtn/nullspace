import React from 'react';
import { act, create } from 'react-test-renderer';
import { useChipBetting } from '../useChipBetting';
import { useGameStore } from '../../stores/gameStore';
import { haptics } from '../../services/haptics';

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

jest.mock('../../services/haptics', () => ({
  haptics: {
    chipPlace: jest.fn(),
    error: jest.fn(),
  },
}));

const initialState = {
  balance: 0,
  balanceReady: false,
  selectedChip: 25 as const,
  sessionId: null,
  publicKey: null,
  registered: false,
  hasBalance: false,
  faucetStatus: 'idle' as const,
  faucetMessage: null,
};

beforeEach(() => {
  useGameStore.setState(initialState);
  (haptics.chipPlace as jest.Mock).mockClear();
  (haptics.error as jest.Mock).mockClear();
});

describe('useChipBetting', () => {
  it('initializes with defaults and updates selected chip', () => {
    useGameStore.setState({ balance: 100 });
    const { getResult, unmount } = renderHook(() => useChipBetting());

    expect(getResult().bet).toBe(0);
    expect(getResult().selectedChip).toBe(25);
    expect(getResult().balance).toBe(100);

    act(() => {
      getResult().setSelectedChip(100);
    });

    expect(getResult().selectedChip).toBe(100);
    unmount();
  });

  it('places chips within balance and notifies bet changes', () => {
    useGameStore.setState({ balance: 75 });
    const onBetChange = jest.fn();
    const { getResult, unmount } = renderHook(() =>
      useChipBetting({ initialChip: 5, onBetChange })
    );

    let ok = false;
    act(() => {
      ok = getResult().placeChip(25);
    });

    expect(ok).toBe(true);
    expect(haptics.chipPlace).toHaveBeenCalledTimes(1);
    expect(getResult().bet).toBe(25);
    expect(onBetChange).toHaveBeenCalledWith(25);

    // Place 25 twice to add 50 more (25 + 25 + 25 = 75)
    act(() => {
      getResult().placeChip(25);
    });
    act(() => {
      getResult().placeChip(25);
    });

    expect(getResult().bet).toBe(75);
    expect(onBetChange).toHaveBeenCalledWith(75);
    unmount();
  });

  it('rejects chips that exceed balance', () => {
    useGameStore.setState({ balance: 20 });
    const { getResult, unmount } = renderHook(() => useChipBetting());

    let ok = true;
    act(() => {
      ok = getResult().placeChip(25);
    });

    expect(ok).toBe(false);
    expect(getResult().bet).toBe(0);
    expect(haptics.error).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('clears and sets bets explicitly', () => {
    useGameStore.setState({ balance: 300 });
    const onBetChange = jest.fn();
    const { getResult, unmount } = renderHook(() => useChipBetting({ onBetChange }));

    act(() => {
      getResult().setBet(120);
    });

    expect(getResult().bet).toBe(120);
    expect(onBetChange).toHaveBeenCalledWith(120);

    act(() => {
      getResult().clearBet();
    });

    expect(getResult().bet).toBe(0);
    expect(onBetChange).toHaveBeenCalledWith(0);
    unmount();
  });

  it('rejects chip when cumulative bet would exceed balance', () => {
    // Balance of 50, try to place two 25 chips then a third
    useGameStore.setState({ balance: 50 });
    const { getResult, unmount } = renderHook(() => useChipBetting());

    // First chip should succeed
    let ok = false;
    act(() => {
      ok = getResult().placeChip(25);
    });
    expect(ok).toBe(true);
    expect(getResult().bet).toBe(25);

    // Second chip should succeed (25 + 25 = 50 = balance)
    act(() => {
      ok = getResult().placeChip(25);
    });
    expect(ok).toBe(true);
    expect(getResult().bet).toBe(50);

    // Third chip should fail (50 + 25 = 75 > 50)
    act(() => {
      ok = getResult().placeChip(25);
    });
    expect(ok).toBe(false);
    expect(getResult().bet).toBe(50); // unchanged
    expect(haptics.error).toHaveBeenCalled();
    unmount();
  });

  it('rejects all chips when balance is zero', () => {
    useGameStore.setState({ balance: 0 });
    const { getResult, unmount } = renderHook(() => useChipBetting());

    // Even $1 chip should be rejected
    let ok = true;
    act(() => {
      ok = getResult().placeChip(1);
    });
    expect(ok).toBe(false);
    expect(getResult().bet).toBe(0);
    expect(haptics.error).toHaveBeenCalledTimes(1);

    // $25 chip also rejected
    act(() => {
      ok = getResult().placeChip(25);
    });
    expect(ok).toBe(false);
    expect(getResult().bet).toBe(0);
    expect(haptics.error).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('uses fresh balance from getState() not stale closure', () => {
    // Start with balance of 100
    useGameStore.setState({ balance: 100 });
    const { getResult, unmount } = renderHook(() => useChipBetting());

    // Place 25 twice = 50, should succeed
    let ok = false;
    act(() => {
      ok = getResult().placeChip(25);
    });
    act(() => {
      ok = getResult().placeChip(25);
    });
    expect(ok).toBe(true);
    expect(getResult().bet).toBe(50);

    // Simulate balance update (e.g., server adjusted balance down)
    // This mimics what happens when another transaction consumes balance
    act(() => {
      useGameStore.setState({ balance: 60 });
    });

    // Try to place another 25, should fail (50 + 25 = 75 > new balance 60)
    act(() => {
      ok = getResult().placeChip(25);
    });
    expect(ok).toBe(false);
    expect(getResult().bet).toBe(50); // unchanged
    expect(haptics.error).toHaveBeenCalled();
    unmount();
  });

  it('reports balance correctly from store', () => {
    useGameStore.setState({ balance: 500 });
    const { getResult, unmount } = renderHook(() => useChipBetting());

    expect(getResult().balance).toBe(500);

    // Update store balance
    act(() => {
      useGameStore.setState({ balance: 250 });
    });

    // Hook should reflect updated balance
    expect(getResult().balance).toBe(250);
    unmount();
  });

  describe('balance race conditions', () => {
    it('handles balance update during betting phase without stale data', () => {
      // Start with sufficient balance
      useGameStore.setState({ balance: 200 });
      const { getResult, unmount } = renderHook(() => useChipBetting());

      // First chip during betting phase
      let ok = false;
      act(() => {
        ok = getResult().placeChip(100);
      });
      expect(ok).toBe(true);
      expect(getResult().bet).toBe(100);

      // Simulate server balance update mid-betting (e.g., faucet payout or another game result)
      act(() => {
        useGameStore.setState({ balance: 300 });
      });

      // Should now be able to place larger chips due to increased balance
      act(() => {
        ok = getResult().placeChip(100);
      });
      expect(ok).toBe(true);
      expect(getResult().bet).toBe(200);

      // Balance remaining = 300 - 200 = 100, can still add 100 more
      act(() => {
        ok = getResult().placeChip(100);
      });
      expect(ok).toBe(true);
      expect(getResult().bet).toBe(300);

      unmount();
    });

    it('handles concurrent chip placements with balance checks', () => {
      useGameStore.setState({ balance: 100 });
      const { getResult, unmount } = renderHook(() => useChipBetting());

      // Simulate rapid chip placements (each in separate act for state updates)
      const results: boolean[] = [];

      act(() => {
        results.push(getResult().placeChip(25)); // 25, ok (25 <= 100)
      });
      act(() => {
        results.push(getResult().placeChip(25)); // 50, ok (50 <= 100)
      });
      act(() => {
        results.push(getResult().placeChip(25)); // 75, ok (75 <= 100)
      });
      act(() => {
        results.push(getResult().placeChip(25)); // 100, ok (100 <= 100)
      });
      act(() => {
        results.push(getResult().placeChip(25)); // 125, fail (125 > 100)
      });

      expect(results).toEqual([true, true, true, true, false]);
      expect(getResult().bet).toBe(100);
      expect(haptics.error).toHaveBeenCalledTimes(1);
      unmount();
    });

    it('rejects bet when balance decreases below current bet + chip value', () => {
      // Start with balance that allows multiple chips
      useGameStore.setState({ balance: 150 });
      const { getResult, unmount } = renderHook(() => useChipBetting());

      // Place 100, should succeed
      act(() => {
        getResult().placeChip(100);
      });
      expect(getResult().bet).toBe(100);

      // Balance decreases (another transaction, server correction, etc.)
      act(() => {
        useGameStore.setState({ balance: 110 });
      });

      // Next chip should fail: 100 + 25 = 125 > 110
      let ok = true;
      act(() => {
        ok = getResult().placeChip(25);
      });
      expect(ok).toBe(false);
      expect(getResult().bet).toBe(100); // unchanged

      // But a smaller chip should work: 100 + 5 = 105 <= 110
      act(() => {
        ok = getResult().placeChip(5);
      });
      expect(ok).toBe(true);
      expect(getResult().bet).toBe(105);

      unmount();
    });

    it('detects exact boundary condition: bet + chip = balance', () => {
      useGameStore.setState({ balance: 100 });
      const { getResult, unmount } = renderHook(() => useChipBetting());

      // Place 25 twice to get 50
      act(() => {
        getResult().placeChip(25);
      });
      act(() => {
        getResult().placeChip(25);
      });
      expect(getResult().bet).toBe(50);

      // This should succeed: 50 + 25 + 25 = 100 = balance (exactly at limit)
      let ok = false;
      act(() => {
        ok = getResult().placeChip(25);
      });
      act(() => {
        ok = getResult().placeChip(25);
      });
      expect(ok).toBe(true);
      expect(getResult().bet).toBe(100);

      // Now any additional chip fails
      act(() => {
        ok = getResult().placeChip(1);
      });
      expect(ok).toBe(false);
      expect(getResult().bet).toBe(100);

      unmount();
    });

    it('handles balance decrease to below current bet gracefully', () => {
      // Edge case: balance decreases to less than what was already bet
      useGameStore.setState({ balance: 100 });
      const { getResult, unmount } = renderHook(() => useChipBetting());

      // Bet 75
      act(() => {
        getResult().placeChip(25);
      });
      act(() => {
        getResult().placeChip(25);
      });
      act(() => {
        getResult().placeChip(25);
      });
      expect(getResult().bet).toBe(75);

      // Balance mysteriously drops to 50 (less than current bet!)
      // This could happen in edge cases with concurrent transactions
      act(() => {
        useGameStore.setState({ balance: 50 });
      });

      // Any additional chip should fail since we're already over balance
      let ok = true;
      act(() => {
        ok = getResult().placeChip(1);
      });
      expect(ok).toBe(false);
      expect(getResult().bet).toBe(75); // bet unchanged - user needs to clear

      unmount();
    });

    it('multiple balance updates between chip placements', () => {
      useGameStore.setState({ balance: 50 });
      const { getResult, unmount } = renderHook(() => useChipBetting());

      // First chip
      act(() => {
        getResult().placeChip(25);
      });
      expect(getResult().bet).toBe(25);

      // Balance increases
      act(() => {
        useGameStore.setState({ balance: 100 });
      });

      // Second chip now works (place 25 twice to get 75 total)
      act(() => {
        getResult().placeChip(25);
      });
      act(() => {
        getResult().placeChip(25);
      });
      expect(getResult().bet).toBe(75);

      // Balance decreases
      act(() => {
        useGameStore.setState({ balance: 80 });
      });

      // Third chip fails: 75 + 25 = 100 > 80
      let ok = true;
      act(() => {
        ok = getResult().placeChip(25);
      });
      expect(ok).toBe(false);
      expect(getResult().bet).toBe(75);

      // But small chip works: 75 + 5 = 80 = 80
      act(() => {
        ok = getResult().placeChip(5);
      });
      expect(ok).toBe(true);
      expect(getResult().bet).toBe(80);

      unmount();
    });
  });
});
