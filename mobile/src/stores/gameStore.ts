import { create } from 'zustand';
import type { ChipValue } from '../types';

interface GameState {
  balance: number;
  balanceReady: boolean;
  /**
   * Last seen balance sequence number from gateway.
   * Used to ignore out-of-order balance updates (US-089).
   * Messages with balanceSeq <= lastBalanceSeq are stale and ignored.
   */
  lastBalanceSeq: number;
  /**
   * Lock to prevent bet validation races (US-090).
   * When true, a bet is being validated and submitted - balance updates
   * should be queued until the bet is either accepted or rejected.
   */
  betValidationLocked: boolean;
  /**
   * Pending balance update received while bet validation was locked.
   * Applied after unlockBetValidation() is called.
   */
  pendingBalanceUpdate: { balance: number; balanceSeq: number } | null;
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
  /**
   * Update balance only if balanceSeq is higher than lastBalanceSeq.
   * Returns true if balance was updated, false if update was stale.
   * If betValidationLocked is true, queues the update instead.
   */
  setBalanceWithSeq: (balance: number, balanceSeq: number) => boolean;
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
  /**
   * Atomically validate bet amount against current balance and lock for submission.
   * Returns true if bet is valid and lock acquired, false if bet exceeds balance.
   * Must call unlockBetValidation() after bet is sent (success or failure).
   */
  validateAndLockBet: (amount: number) => boolean;
  /**
   * Release the bet validation lock and apply any pending balance updates.
   */
  unlockBetValidation: () => void;
}

export const useGameStore = create<GameState>((set, get) => ({
  balance: 0,
  balanceReady: false,
  lastBalanceSeq: 0,
  betValidationLocked: false,
  pendingBalanceUpdate: null,
  selectedChip: 25,
  sessionId: null,
  publicKey: null,
  registered: false,
  hasBalance: false,
  faucetStatus: 'idle',
  faucetMessage: null,
  sessionExpired: false,
  sessionExpiredMessage: null,

  setBalanceWithSeq: (balance, balanceSeq) => {
    const state = get();
    // If bet validation is locked, queue the update for later
    if (state.betValidationLocked) {
      // Only queue if this is a newer update than any pending one
      const pending = state.pendingBalanceUpdate;
      if (!pending || balanceSeq > pending.balanceSeq) {
        set({ pendingBalanceUpdate: { balance, balanceSeq } });
      }
      return false; // Update queued, not applied
    }
    // Normal case: apply if newer than last seen
    if (balanceSeq > state.lastBalanceSeq) {
      set({ balance, lastBalanceSeq: balanceSeq });
      return true;
    }
    // Stale update - ignore
    return false;
  },
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
      lastBalanceSeq: 0,
      betValidationLocked: false,
      pendingBalanceUpdate: null,
      sessionExpired: false,
      sessionExpiredMessage: null,
      faucetStatus: 'idle',
      faucetMessage: null,
    }),

  validateAndLockBet: (amount) => {
    const state = get();
    // Already locked - reject (shouldn't happen if callers use useBetSubmission correctly)
    if (state.betValidationLocked) {
      return false;
    }
    // Validate bet against current balance
    if (amount > state.balance) {
      return false;
    }
    // Lock and return success
    set({ betValidationLocked: true });
    return true;
  },

  unlockBetValidation: () => {
    const state = get();
    const pending = state.pendingBalanceUpdate;
    if (pending && pending.balanceSeq > state.lastBalanceSeq) {
      // Apply the pending balance update
      set({
        betValidationLocked: false,
        pendingBalanceUpdate: null,
        balance: pending.balance,
        lastBalanceSeq: pending.balanceSeq,
      });
    } else {
      // Just unlock, no pending update to apply
      set({
        betValidationLocked: false,
        pendingBalanceUpdate: null,
      });
    }
  },
}));
