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
  selectedChip: 25,
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

    act(() => {
      getResult().placeChip(50);
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

    // Place 50, should succeed
    let ok = false;
    act(() => {
      ok = getResult().placeChip(50);
    });
    expect(ok).toBe(true);
    expect(getResult().bet).toBe(50);

    // Simulate balance update (e.g., server adjusted balance down)
    // This mimics what happens when another transaction consumes balance
    act(() => {
      useGameStore.setState({ balance: 60 });
    });

    // Try to place another 50, should fail (50 + 50 = 100 > new balance 60)
    act(() => {
      ok = getResult().placeChip(50);
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
});
