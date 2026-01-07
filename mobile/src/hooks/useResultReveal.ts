/**
 * useResultReveal - Hook for managing staged result reveal in game screens
 *
 * Provides simple API for game screens to show theatrical result reveals.
 * Integrates with existing celebration system for coordinated effects.
 *
 * @example
 * ```tsx
 * const { resultState, showResult, hideResult } = useResultReveal();
 *
 * // In game_result handler:
 * showResult({
 *   outcome: 'win',
 *   message: 'Blackjack!',
 *   payout: 150,
 *   bet: 100,
 * });
 *
 * // In render:
 * <ResultReveal {...resultState} onDismiss={hideResult} />
 * ```
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import type { ResultOutcome, PayoutBreakdownItem } from '../components/celebration/ResultReveal';
import type { CelebrationIntensity } from './useCelebration';

/** Configuration for showing a result */
export interface ShowResultConfig {
  /** Result outcome type */
  outcome: ResultOutcome;
  /** Main message text */
  message: string;
  /** Net payout (profit, not including original bet) */
  payout: number;
  /** Original bet amount */
  bet: number;
  /** Optional breakdown for complex wins */
  breakdown?: PayoutBreakdownItem[];
  /** Session net change */
  sessionDelta?: number;
  /** Auto-dismiss duration override (ms) */
  autoDismissMs?: number;
  /** Celebration intensity for win effects */
  intensity?: CelebrationIntensity;
}

/** Result reveal state */
export interface ResultRevealState {
  isVisible: boolean;
  outcome: ResultOutcome;
  message: string;
  payout: number;
  bet: number;
  breakdown?: PayoutBreakdownItem[];
  sessionDelta?: number;
  autoDismissMs?: number;
  intensity?: CelebrationIntensity;
}

const INITIAL_STATE: ResultRevealState = {
  isVisible: false,
  outcome: 'push',
  message: '',
  payout: 0,
  bet: 0,
};

interface UseResultRevealReturn {
  /** Current result reveal state - spread into ResultReveal component */
  resultState: ResultRevealState;
  /** Show result with staged reveal */
  showResult: (config: ShowResultConfig) => void;
  /** Hide result (for manual dismiss or cleanup) */
  hideResult: () => void;
  /** Whether result is currently visible */
  isResultVisible: boolean;
}

/**
 * Hook for managing result reveal state
 */
export function useResultReveal(): UseResultRevealReturn {
  const [resultState, setResultState] = useState<ResultRevealState>(INITIAL_STATE);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Track mount state for safe async updates
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const showResult = useCallback((config: ShowResultConfig) => {
    // Clear any pending hide
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    setResultState({
      isVisible: true,
      outcome: config.outcome,
      message: config.message,
      payout: config.payout,
      bet: config.bet,
      breakdown: config.breakdown,
      sessionDelta: config.sessionDelta,
      autoDismissMs: config.autoDismissMs,
      intensity: config.intensity,
    });
  }, []);

  const hideResult = useCallback(() => {
    if (!isMountedRef.current) return;

    setResultState((prev) => ({
      ...prev,
      isVisible: false,
    }));

    // Reset state after animation completes
    timeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setResultState(INITIAL_STATE);
      }
    }, 300); // Match dismiss animation duration
  }, []);

  return {
    resultState,
    showResult,
    hideResult,
    isResultVisible: resultState.isVisible,
  };
}

/**
 * Helper to determine outcome from game result
 */
export function determineOutcome(
  won: boolean | undefined,
  push: boolean | undefined,
  isBlackjack?: boolean,
  isWar?: boolean
): ResultOutcome {
  if (isBlackjack && won) return 'blackjack';
  if (isWar) return 'war';
  if (push) return 'push';
  if (won) return 'win';
  return 'loss';
}

/**
 * Helper to calculate intensity from payout ratio
 */
export function calculateIntensity(payout: number, bet: number): CelebrationIntensity {
  if (bet <= 0 || payout <= 0) return 'small';

  const multiplier = (payout + bet) / bet; // Total return / bet
  if (multiplier >= 5) return 'jackpot';
  if (multiplier >= 3) return 'big';
  if (multiplier >= 1.5) return 'medium';
  return 'small';
}
