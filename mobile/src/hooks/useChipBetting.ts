/**
 * useChipBetting - Shared hook for chip selection and betting logic
 * Handles chip placement with balance validation and haptic feedback
 */
import { useState, useCallback } from 'react';
import { haptics } from '../services/haptics';
import { useGameStore } from '../stores/gameStore';
import type { ChipValue } from '../types';

interface ChipBettingOptions {
  /** Initial chip selection value (default: 25) */
  initialChip?: ChipValue;
  /** Callback when bet changes */
  onBetChange?: (newBet: number) => void;
}

interface ChipBettingResult {
  /** Current total bet amount */
  bet: number;
  /** Currently selected chip value */
  selectedChip: ChipValue;
  /** Player's current balance from store */
  balance: number;
  /** Set the selected chip value */
  setSelectedChip: (value: ChipValue) => void;
  /** Add a chip to the bet (validates against balance) */
  placeChip: (value: ChipValue) => boolean;
  /** Clear the current bet */
  clearBet: () => void;
  /** Set bet to a specific amount */
  setBet: (amount: number) => void;
}

/**
 * Hook that manages chip betting state with balance validation
 *
 * @example
 * const { bet, selectedChip, setSelectedChip, placeChip, clearBet, balance } = useChipBetting();
 *
 * // In betting phase
 * <ChipSelector
 *   selectedValue={selectedChip}
 *   onSelect={setSelectedChip}
 *   onChipPlace={placeChip}
 * />
 */
export function useChipBetting(options: ChipBettingOptions = {}): ChipBettingResult {
  const { initialChip = 25, onBetChange } = options;
  const { balance } = useGameStore();

  const [bet, setBetInternal] = useState(0);
  const [selectedChip, setSelectedChip] = useState<ChipValue>(initialChip);

  const placeChip = useCallback((value: ChipValue): boolean => {
    // Use getState() for fresh balance to avoid stale closure issues
    const currentBalance = useGameStore.getState().balance;
    if (bet + value > currentBalance) {
      haptics.error();
      return false;
    }

    haptics.chipPlace();
    const newBet = bet + value;
    setBetInternal(newBet);
    onBetChange?.(newBet);
    return true;
  }, [bet, onBetChange]);

  const clearBet = useCallback(() => {
    setBetInternal(0);
    onBetChange?.(0);
  }, [onBetChange]);

  const setBet = useCallback((amount: number) => {
    setBetInternal(amount);
    onBetChange?.(amount);
  }, [onBetChange]);

  return {
    bet,
    selectedChip,
    balance,
    setSelectedChip,
    placeChip,
    clearBet,
    setBet,
  };
}
