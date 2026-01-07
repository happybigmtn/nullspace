/**
 * useCelebration - Hook for coordinated win celebration effects
 *
 * Manages gold particle burst, balance animation, shimmer, and haptics.
 * Scales intensity based on win amount relative to bet.
 */
import { useCallback, useRef } from 'react';
import { haptics } from '../services/haptics';

/** Celebration intensity levels based on win multiplier */
export type CelebrationIntensity = 'small' | 'medium' | 'big' | 'jackpot';

/** Celebration state exposed to components */
export interface CelebrationState {
  isActive: boolean;
  intensity: CelebrationIntensity;
  winAmount: number;
}

/** Configuration for a celebration trigger */
export interface CelebrationConfig {
  /** Amount won (payout minus bet) */
  winAmount: number;
  /** Original bet amount for calculating multiplier */
  betAmount: number;
}

/** Thresholds for celebration intensity */
const INTENSITY_THRESHOLDS = {
  /** Win >= 5x bet triggers jackpot */
  jackpot: 5,
  /** Win >= 3x bet triggers big */
  big: 3,
  /** Win >= 1.5x bet triggers medium */
  medium: 1.5,
  /** Default is small */
} as const;

/**
 * Calculate celebration intensity based on win multiplier
 */
function calculateIntensity(winAmount: number, betAmount: number): CelebrationIntensity {
  if (betAmount <= 0) return 'small';
  const multiplier = winAmount / betAmount;

  if (multiplier >= INTENSITY_THRESHOLDS.jackpot) return 'jackpot';
  if (multiplier >= INTENSITY_THRESHOLDS.big) return 'big';
  if (multiplier >= INTENSITY_THRESHOLDS.medium) return 'medium';
  return 'small';
}

/** Particle count by intensity */
export const PARTICLE_COUNTS: Record<CelebrationIntensity, number> = {
  small: 8,
  medium: 16,
  big: 24,
  jackpot: 40,
};

/** Animation duration by intensity (ms) */
export const CELEBRATION_DURATIONS: Record<CelebrationIntensity, number> = {
  small: 800,
  medium: 1200,
  big: 1600,
  jackpot: 2400,
};

/**
 * Hook for managing win celebration state and effects
 */
export function useCelebration() {
  const celebrationRef = useRef<CelebrationState>({
    isActive: false,
    intensity: 'small',
    winAmount: 0,
  });
  const callbacksRef = useRef<Set<(state: CelebrationState) => void>>(new Set());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Subscribe to celebration state changes
   */
  const subscribe = useCallback((callback: (state: CelebrationState) => void) => {
    callbacksRef.current.add(callback);
    return () => {
      callbacksRef.current.delete(callback);
    };
  }, []);

  /**
   * Notify all subscribers of state change
   */
  const notify = useCallback(() => {
    callbacksRef.current.forEach((cb) => cb(celebrationRef.current));
  }, []);

  /**
   * Trigger a celebration with the given configuration
   */
  const trigger = useCallback(
    (config: CelebrationConfig) => {
      // Clear any pending celebration end
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      const intensity = calculateIntensity(config.winAmount, config.betAmount);
      const duration = CELEBRATION_DURATIONS[intensity];

      // Update state
      celebrationRef.current = {
        isActive: true,
        intensity,
        winAmount: config.winAmount,
      };
      notify();

      // Trigger appropriate haptic
      if (intensity === 'jackpot' || intensity === 'big') {
        haptics.bigWin().catch(() => {});
      } else {
        haptics.win().catch(() => {});
      }

      // Schedule celebration end
      timeoutRef.current = setTimeout(() => {
        celebrationRef.current = {
          ...celebrationRef.current,
          isActive: false,
        };
        notify();
        timeoutRef.current = null;
      }, duration);
    },
    [notify]
  );

  /**
   * Get current celebration state (for non-reactive reads)
   */
  const getState = useCallback(() => celebrationRef.current, []);

  /**
   * Clean up (call on unmount)
   */
  const cleanup = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    callbacksRef.current.clear();
  }, []);

  return {
    trigger,
    subscribe,
    getState,
    cleanup,
  };
}

export type UseCelebrationReturn = ReturnType<typeof useCelebration>;
