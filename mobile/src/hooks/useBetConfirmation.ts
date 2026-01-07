/**
 * useBetConfirmation - Hook for bet confirmation modal integration
 *
 * Provides state management and callbacks for the BetConfirmationModal.
 * Integrates with useBetSubmission for a seamless confirmation flow.
 *
 * @example
 * ```tsx
 * const { showConfirmation, confirmationProps, requestConfirmation } = useBetConfirmation({
 *   gameType: 'blackjack',
 *   onConfirm: () => submitBet({ type: 'blackjack_deal', amount: bet }),
 * });
 *
 * // In bet handler
 * const handleDeal = () => {
 *   requestConfirmation({
 *     amount: totalBet,
 *     sideBets: [{ name: '21+3', amount: sideBet }],
 *   });
 * };
 *
 * // In render
 * <BetConfirmationModal visible={showConfirmation} {...confirmationProps} />
 * ```
 */
import { useState, useCallback, useMemo } from 'react';
import { useGameStore } from '../stores/gameStore';
import type { BetDetails, GameType } from '../components/ui/BetConfirmationModal';

interface UseBetConfirmationOptions {
  /** Game type for payout display */
  gameType: GameType;
  /** Called when user confirms - should call submitBet */
  onConfirm: () => void;
  /** Optional callback when user cancels */
  onCancel?: () => void;
  /** Countdown duration in seconds (default: 5) */
  countdownSeconds?: number;
  /** Whether to auto-confirm when countdown completes (default: false) */
  autoConfirm?: boolean;
  /** Whether confirmation is enabled (default: true) */
  enabled?: boolean;
}

interface BetRequest {
  /** Total bet amount */
  amount: number;
  /** Side bets breakdown */
  sideBets?: { name: string; amount: number }[];
  /** Custom payout description override */
  payoutDescription?: string;
}

interface UseBetConfirmationResult {
  /** Whether confirmation modal is visible */
  showConfirmation: boolean;
  /** Props to spread on BetConfirmationModal */
  confirmationProps: {
    visible: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    bet: BetDetails;
    balance: number;
    countdownSeconds: number;
    autoConfirm: boolean;
  };
  /** Call to show confirmation modal with bet details */
  requestConfirmation: (request: BetRequest) => void;
  /** Close modal without confirming */
  cancelConfirmation: () => void;
  /** Whether confirmation is currently pending */
  isPending: boolean;
}

/**
 * Hook for managing bet confirmation modal state
 */
export function useBetConfirmation({
  gameType,
  onConfirm,
  onCancel,
  countdownSeconds = 5,
  autoConfirm = false,
  enabled = true,
}: UseBetConfirmationOptions): UseBetConfirmationResult {
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [pendingBet, setPendingBet] = useState<BetRequest | null>(null);

  // Get balance from store - use getState for fresh value
  const getBalance = useCallback(() => {
    return useGameStore.getState().balance;
  }, []);

  // Request confirmation
  const requestConfirmation = useCallback((request: BetRequest) => {
    if (!enabled) {
      // If confirmation is disabled, just call onConfirm directly
      onConfirm();
      return;
    }
    setPendingBet(request);
    setShowConfirmation(true);
  }, [enabled, onConfirm]);

  // Handle confirmation
  const handleConfirm = useCallback(() => {
    setShowConfirmation(false);
    setPendingBet(null);
    onConfirm();
  }, [onConfirm]);

  // Handle cancellation
  const handleCancel = useCallback(() => {
    setShowConfirmation(false);
    setPendingBet(null);
    onCancel?.();
  }, [onCancel]);

  // Build bet details from pending request
  const betDetails: BetDetails = useMemo(() => ({
    amount: pendingBet?.amount ?? 0,
    gameType,
    sideBets: pendingBet?.sideBets,
    payoutDescription: pendingBet?.payoutDescription,
  }), [pendingBet, gameType]);

  // Build props for the modal component
  const confirmationProps = useMemo(() => ({
    visible: showConfirmation,
    onConfirm: handleConfirm,
    onCancel: handleCancel,
    bet: betDetails,
    balance: getBalance(),
    countdownSeconds,
    autoConfirm,
  }), [
    showConfirmation,
    handleConfirm,
    handleCancel,
    betDetails,
    getBalance,
    countdownSeconds,
    autoConfirm,
  ]);

  return {
    showConfirmation,
    confirmationProps,
    requestConfirmation,
    cancelConfirmation: handleCancel,
    isPending: showConfirmation,
  };
}

export default useBetConfirmation;
