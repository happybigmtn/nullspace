/**
 * useChipBetting - Shared hook for chip selection and betting logic
 * Handles chip placement with balance validation and haptic feedback
 *
 * Enhanced for US-122: Now tracks individual placed chips for pile visualization
 */
import { useState, useCallback } from 'react';
import { haptics } from '../services/haptics';
import { useGameStore } from '../stores/gameStore';
import type { ChipValue } from '../types';

/**
 * Represents a chip placed in the betting area
 * Used for ChipPile visualization (US-122)
 */
export interface PlacedChip {
  /** Unique identifier for animation tracking */
  id: string;
  /** Chip value */
  value: ChipValue;
  /** Random rotation angle (-15 to 15 degrees) */
  rotation: number;
  /** Time of placement for animation sequencing */
  placedAt: number;
}

/**
 * Helper to create a placed chip with random rotation
 */
function createPlacedChip(value: ChipValue): PlacedChip {
  return {
    id: `chip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    value,
    rotation: Math.random() * 30 - 15, // -15 to 15 degrees
    placedAt: Date.now(),
  };
}

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
  /** Array of placed chips for pile visualization (US-122) */
  placedChips: PlacedChip[];
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
  const [placedChips, setPlacedChips] = useState<PlacedChip[]>([]);

  const placeChip = useCallback((value: ChipValue): boolean => {
    // Use getState() for fresh balance to avoid stale closure issues
    const currentBalance = useGameStore.getState().balance;
    if (bet + value > currentBalance) {
      haptics.error().catch(() => {});
      return false;
    }

    haptics.chipPlace().catch(() => {});
    const newBet = bet + value;
    setBetInternal(newBet);

    // Track placed chip for pile visualization (US-122)
    const newChip = createPlacedChip(value);
    setPlacedChips((prev) => [...prev, newChip]);

    onBetChange?.(newBet);
    return true;
  }, [bet, onBetChange]);

  const clearBet = useCallback(() => {
    setBetInternal(0);
    setPlacedChips([]);
    onBetChange?.(0);
  }, [onBetChange]);

  const setBet = useCallback((amount: number) => {
    setBetInternal(amount);
    // Note: setBet doesn't populate placedChips since we don't know denomination breakdown
    // Use clearBet() + placeChip() for proper pile visualization
    onBetChange?.(amount);
  }, [onBetChange]);

  return {
    bet,
    selectedChip,
    balance,
    placedChips,
    setSelectedChip,
    placeChip,
    clearBet,
    setBet,
  };
}
