import { useGameStore } from '../gameStore';
import type { ChipValue } from '../../types';

const initialState = {
  balance: 0,
  balanceReady: false,
  selectedChip: 25 as ChipValue,
  sessionId: null,
  publicKey: null,
  registered: false,
  hasBalance: false,
  faucetStatus: 'idle' as const,
  faucetMessage: null,
};

beforeEach(() => {
  useGameStore.setState(initialState);
});

describe('gameStore', () => {
  it('initializes with defaults', () => {
    const state = useGameStore.getState();
    expect(state.balance).toBe(0);
    expect(state.selectedChip).toBe(25);
    expect(state.sessionId).toBeNull();
    expect(state.faucetStatus).toBe('idle');
  });

  it('updates balance and readiness flags', () => {
    const state = useGameStore.getState();
    state.setBalance(250);
    state.setBalanceReady(true);

    const updated = useGameStore.getState();
    expect(updated.balance).toBe(250);
    expect(updated.balanceReady).toBe(true);
  });

  it('merges session info updates', () => {
    const state = useGameStore.getState();
    state.setSessionInfo({
      sessionId: 'session-1',
      publicKey: 'pubkey-1',
      registered: true,
    });

    state.setSessionInfo({ hasBalance: true });

    const updated = useGameStore.getState();
    expect(updated.sessionId).toBe('session-1');
    expect(updated.publicKey).toBe('pubkey-1');
    expect(updated.registered).toBe(true);
    expect(updated.hasBalance).toBe(true);
  });

  it('updates chip selection and faucet status', () => {
    const state = useGameStore.getState();
    state.setSelectedChip(100);
    state.setFaucetStatus('pending', 'waiting');

    const updated = useGameStore.getState();
    expect(updated.selectedChip).toBe(100);
    expect(updated.faucetStatus).toBe('pending');
    expect(updated.faucetMessage).toBe('waiting');
  });
});
