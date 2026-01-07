import { create } from 'zustand';
import type { ChipValue } from '../types';

interface GameState {
  balance: number;
  balanceReady: boolean;
  selectedChip: ChipValue;
  sessionId: string | null;
  publicKey: string | null;
  registered: boolean;
  hasBalance: boolean;
  faucetStatus: 'idle' | 'pending' | 'success' | 'error';
  faucetMessage: string | null;
  sessionExpired: boolean;
  sessionExpiredMessage: string | null;

  // Actions
  setBalance: (balance: number) => void;
  setBalanceReady: (ready: boolean) => void;
  setSelectedChip: (chip: ChipValue) => void;
  setSessionInfo: (info: {
    sessionId?: string | null;
    publicKey?: string | null;
    registered?: boolean;
    hasBalance?: boolean;
  }) => void;
  setFaucetStatus: (status: GameState['faucetStatus'], message?: string | null) => void;
  setSessionExpired: (expired: boolean, message?: string | null) => void;
  clearSession: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  balance: 0,
  balanceReady: false,
  selectedChip: 25,
  sessionId: null,
  publicKey: null,
  registered: false,
  hasBalance: false,
  faucetStatus: 'idle',
  faucetMessage: null,
  sessionExpired: false,
  sessionExpiredMessage: null,

  setBalance: (balance) => set({ balance }),
  setBalanceReady: (ready) => set({ balanceReady: ready }),
  setSelectedChip: (chip) => set({ selectedChip: chip }),
  setSessionInfo: (info) =>
    set((state) => ({
      sessionId: info.sessionId ?? state.sessionId,
      publicKey: info.publicKey ?? state.publicKey,
      registered: info.registered ?? state.registered,
      hasBalance: info.hasBalance ?? state.hasBalance,
    })),
  setFaucetStatus: (status, message = null) =>
    set({
      faucetStatus: status,
      faucetMessage: message,
    }),
  setSessionExpired: (expired, message = null) =>
    set({
      sessionExpired: expired,
      sessionExpiredMessage: message,
    }),
  clearSession: () =>
    set({
      sessionId: null,
      publicKey: null,
      registered: false,
      hasBalance: false,
      balanceReady: false,
      balance: 0,
      sessionExpired: false,
      sessionExpiredMessage: null,
      faucetStatus: 'idle',
      faucetMessage: null,
    }),
}));
