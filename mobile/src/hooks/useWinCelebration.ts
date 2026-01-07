/**
 * useWinCelebration - Simple hook for win celebrations in game screens
 *
 * Drop-in hook that tracks win state and provides celebration props for GameLayout.
 * Automatically calculates intensity based on win/bet ratio.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { haptics } from '../services/haptics';
import type { CelebrationState, CelebrationIntensity } from './useCelebration';
import { CELEBRATION_DURATIONS } from './useCelebration';

/** Thresholds for celebration intensity */
const INTENSITY_THRESHOLDS = {
  jackpot: 5,
  big: 3,
  medium: 1.5,
} as const;

/**
 * Calculate celebration intensity based on win multiplier
 */
function calculateIntensity(winAmount: number, betAmount: number): CelebrationIntensity {
  if (betAmount <= 0) return 'small';
  const multiplier = (winAmount + betAmount) / betAmount; // Total return / bet

  if (multiplier >= INTENSITY_THRESHOLDS.jackpot) return 'jackpot';
  if (multiplier >= INTENSITY_THRESHOLDS.big) return 'big';
  if (multiplier >= INTENSITY_THRESHOLDS.medium) return 'medium';
  return 'small';
}

interface UseWinCelebrationReturn {
  /** Current celebration state - pass to GameLayout */
  celebrationState: CelebrationState;
  /** Trigger celebration on win */
  triggerWin: (winAmount: number, betAmount: number) => void;
  /** Clear celebration state */
  clearCelebration: () => void;
}

/**
 * Hook for managing win celebration effects in game screens
 *
 * @example
 * ```tsx
 * const { celebrationState, triggerWin } = useWinCelebration();
 *
 * // In game_result handler:
 * if (won) {
 *   triggerWin(payout, bet);
 * }
 *
 * // In render:
 * <GameLayout celebrationState={celebrationState} ... />
 * ```
 */
export function useWinCelebration(): UseWinCelebrationReturn {
  const [celebrationState, setCelebrationState] = useState<CelebrationState>({
    isActive: false,
    intensity: 'small',
    winAmount: 0,
  });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const triggerWin = useCallback((winAmount: number, betAmount: number) => {
    // Clear any pending celebration end
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    const intensity = calculateIntensity(winAmount, betAmount);
    const duration = CELEBRATION_DURATIONS[intensity];

    // Update state
    setCelebrationState({
      isActive: true,
      intensity,
      winAmount,
    });

    // Trigger appropriate haptic pattern
    if (intensity === 'jackpot') {
      haptics.jackpot().catch(() => {});
    } else if (intensity === 'big') {
      haptics.bigWin().catch(() => {});
    }
    // Note: standard win haptic is already triggered in game screens

    // Schedule celebration end
    timeoutRef.current = setTimeout(() => {
      setCelebrationState((prev) => ({
        ...prev,
        isActive: false,
      }));
      timeoutRef.current = null;
    }, duration);
  }, []);

  const clearCelebration = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setCelebrationState({
      isActive: false,
      intensity: 'small',
      winAmount: 0,
    });
  }, []);

  return {
    celebrationState,
    triggerWin,
    clearCelebration,
  };
}
