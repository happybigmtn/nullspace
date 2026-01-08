/**
 * useBetHistory (US-165)
 *
 * Hook for recording bets to local history when games complete.
 * Integrates with existing game flow by hooking into game_result messages.
 */
import { useCallback } from 'react';
import { addBetToHistory } from '../services/storage';
import { getGameName } from '../types';

interface RecordBetParams {
  gameId: string;
  bet: number;
  payout: number;
  won: boolean;
  outcome?: string;
}

/**
 * Hook for recording bet results to local history.
 *
 * @returns recordBet - Call this when a game_result is received
 *
 * @example
 * ```tsx
 * const { recordBet } = useBetHistory();
 *
 * // In game_result handler:
 * recordBet({
 *   gameId: 'blackjack',
 *   bet: 100,
 *   payout: 200,
 *   won: true,
 *   outcome: 'Blackjack!'
 * });
 * ```
 */
export function useBetHistory() {
  const recordBet = useCallback((params: RecordBetParams) => {
    const { gameId, bet, payout, won, outcome } = params;

    // Don't record bets with 0 amount (shouldn't happen, but guard)
    if (bet <= 0) return;

    addBetToHistory({
      gameId,
      gameName: getGameName(gameId as never), // Get display name from constants
      bet,
      payout,
      won,
      timestamp: Date.now(),
      outcome,
    });
  }, []);

  return { recordBet };
}
