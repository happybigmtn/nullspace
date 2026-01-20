import { useEffect, useMemo, useCallback, useState } from 'react';
import type { CasinoClient } from '../api/client';
import { useRoundOutcome } from './useRoundOutcome';
import type { ResultOutcome, CelebrationIntensity, PayoutBreakdownItem } from '../components/casino/ResultDisplay';
import { getBetTypeLabel } from './useRoundOutcome';

/**
 * Options for useRoundResultDisplay hook
 */
export interface UseRoundResultDisplayOptions {
  /** Casino client instance */
  client: CasinoClient | null;
  /** Player's public key */
  playerPublicKey?: Uint8Array;
  /** Auto-show result display when settlement received */
  autoShow?: boolean;
  /** Token decimal conversion factor */
  tokenDecimals?: number;
  /** Callback when result is shown */
  onShow?: () => void;
  /** Callback when result is hidden */
  onHide?: () => void;
}

/**
 * State returned by useRoundResultDisplay hook
 */
export interface RoundResultDisplayState {
  /** Whether the result display should be visible */
  isVisible: boolean;
  /** Outcome type for ResultDisplay */
  outcome: ResultOutcome;
  /** Message to display */
  message: string;
  /** Net payout amount (converted to display units) */
  payout: number;
  /** Total bet amount */
  bet: number;
  /** Breakdown of bets settled */
  breakdown: PayoutBreakdownItem[];
  /** Celebration intensity */
  intensity: CelebrationIntensity;
  /** Show the result display */
  show: () => void;
  /** Hide the result display */
  hide: () => void;
  /** Round outcome data */
  roundOutcome: ReturnType<typeof useRoundOutcome>;
}

/**
 * Determine celebration intensity based on payout
 */
function getCelebrationIntensity(payout: number, bet: number): CelebrationIntensity {
  if (bet === 0) return 'small';
  const multiplier = payout / bet;

  if (multiplier >= 10) return 'jackpot';
  if (multiplier >= 5) return 'big';
  if (multiplier >= 2) return 'medium';
  return 'small';
}

/**
 * Get outcome type for ResultDisplay
 */
function getOutcomeType(payoutAmount: number): ResultOutcome {
  if (payoutAmount > 0) return 'win';
  if (payoutAmount < 0) return 'loss';
  return 'push';
}

/**
 * Get message for the result
 */
function getResultMessage(payoutAmount: number, diceTotal?: number): string {
  if (payoutAmount > 0) {
    return diceTotal ? `${diceTotal} - You Win!` : 'You Win!';
  }
  if (payoutAmount < 0) {
    return diceTotal ? `${diceTotal} - Better luck next time` : 'Better luck next time';
  }
  return diceTotal ? `${diceTotal} - Push` : 'Push';
}

/**
 * Hook to integrate useRoundOutcome with ResultDisplay for animated reveals.
 *
 * Connects real-time settlement events to the animated ResultDisplay component.
 *
 * AC-5.4: Real-time updates display round outcomes and totals without manual refresh.
 *
 * @example
 * ```tsx
 * const result = useRoundResultDisplay({
 *   client,
 *   playerPublicKey: keypair?.publicKey,
 *   autoShow: true,
 * });
 *
 * return (
 *   <>
 *     <RoundOutcomeDisplay outcome={result.roundOutcome.outcome} />
 *     <ResultDisplay
 *       isVisible={result.isVisible}
 *       outcome={result.outcome}
 *       message={result.message}
 *       payout={result.payout}
 *       bet={result.bet}
 *       breakdown={result.breakdown}
 *       intensity={result.intensity}
 *       onDismiss={result.hide}
 *     />
 *   </>
 * );
 * ```
 */
export function useRoundResultDisplay({
  client,
  playerPublicKey,
  autoShow = true,
  tokenDecimals = 1e6,
  onShow,
  onHide,
}: UseRoundResultDisplayOptions): RoundResultDisplayState {
  const [isVisible, setIsVisible] = useState(false);

  // Get real-time outcome and settlement data
  const roundOutcome = useRoundOutcome({
    client,
    playerPublicKey,
    tokenDecimals,
  });

  const { settlement, settlementResult, payoutAmount, totalBetAmount, outcome } = roundOutcome;

  // Calculate breakdown from settled bets
  const breakdown: PayoutBreakdownItem[] = useMemo(() => {
    if (!settlement?.myBets?.length) return [];

    return settlement.myBets.map((bet) => ({
      label: getBetTypeLabel(bet.betType),
      amount: Number(bet.amount) / tokenDecimals,
    }));
  }, [settlement?.myBets, tokenDecimals]);

  // Calculate display properties
  const outcomeType = useMemo(() => getOutcomeType(payoutAmount), [payoutAmount]);
  const message = useMemo(
    () => getResultMessage(payoutAmount, outcome?.diceTotal),
    [payoutAmount, outcome?.diceTotal]
  );
  const intensity = useMemo(
    () => getCelebrationIntensity(payoutAmount, totalBetAmount),
    [payoutAmount, totalBetAmount]
  );

  // Show result when settlement received
  useEffect(() => {
    if (autoShow && settlement && settlementResult) {
      setIsVisible(true);
      onShow?.();
    }
  }, [autoShow, settlement, settlementResult, onShow]);

  // Show handler
  const show = useCallback(() => {
    setIsVisible(true);
    onShow?.();
  }, [onShow]);

  // Hide handler
  const hide = useCallback(() => {
    setIsVisible(false);
    onHide?.();
  }, [onHide]);

  return {
    isVisible,
    outcome: outcomeType,
    message,
    payout: payoutAmount,
    bet: totalBetAmount,
    breakdown,
    intensity,
    show,
    hide,
    roundOutcome,
  };
}

export default useRoundResultDisplay;
