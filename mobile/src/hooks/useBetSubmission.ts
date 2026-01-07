/**
 * useBetSubmission - Debounced bet submission to prevent double-tap duplicates
 * Tracks in-flight submissions and disables betting until response or timeout
 *
 * US-090: Now includes atomic bet validation with balance locking to prevent
 * race conditions where balance changes between validation and submission.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useGameStore } from '../stores/gameStore';

const SUBMISSION_TIMEOUT_MS = 5000;

interface BetSubmissionOptions {
  /** Bet amount to validate against balance before sending (optional for backward compat) */
  amount?: number;
}

interface BetSubmissionResult {
  /** Whether a bet submission is currently in flight */
  isSubmitting: boolean;
  /**
   * Submit a bet - returns false if already submitting, validation fails, or send failed.
   * If options.amount is provided, validates bet against current balance atomically.
   */
  submitBet: (message: object, options?: BetSubmissionOptions) => boolean;
  /** Manually clear submission state (call on response or phase change) */
  clearSubmission: () => void;
}

/**
 * Hook that debounces bet submissions to prevent double-tap duplicates
 *
 * @param send - The WebSocket send function from useGameConnection
 * @returns Object with isSubmitting state and submitBet function
 *
 * @example
 * const { isSubmitting, submitBet, clearSubmission } = useBetSubmission(send);
 *
 * // In bet handler
 * const handleDeal = () => {
 *   if (!submitBet({ type: 'blackjack_deal', amount: bet })) return;
 *   // Update local state optimistically
 * };
 *
 * // In message handler when response received
 * useEffect(() => {
 *   if (lastMessage?.type === 'game_started') {
 *     clearSubmission();
 *   }
 * }, [lastMessage, clearSubmission]);
 *
 * // Disable button
 * <Button disabled={isSubmitting || isDisconnected} onPress={handleDeal} />
 */
export function useBetSubmission(
  send: (message: object) => boolean
): BetSubmissionResult {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const clearSubmission = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    // Release the bet validation lock if held (US-090)
    useGameStore.getState().unlockBetValidation();
    setIsSubmitting(false);
  }, []);

  const submitBet = useCallback((message: object, options?: BetSubmissionOptions): boolean => {
    // Already submitting - reject duplicate
    if (isSubmitting) {
      return false;
    }

    // US-090: If amount provided, validate and lock atomically
    const amount = options?.amount;
    if (amount !== undefined) {
      const validationOk = useGameStore.getState().validateAndLockBet(amount);
      if (!validationOk) {
        // Bet exceeds current balance or already locked
        return false;
      }
    }

    // Try to send
    const success = send(message);
    if (!success) {
      // Release the lock on send failure
      if (amount !== undefined) {
        useGameStore.getState().unlockBetValidation();
      }
      return false;
    }

    // Mark as submitting
    setIsSubmitting(true);

    // Set timeout to re-enable if no response (shouldn't happen in normal operation)
    timeoutRef.current = setTimeout(() => {
      // Release the lock on timeout
      useGameStore.getState().unlockBetValidation();
      setIsSubmitting(false);
      timeoutRef.current = null;
    }, SUBMISSION_TIMEOUT_MS);

    return true;
  }, [isSubmitting, send]);

  return {
    isSubmitting,
    submitBet,
    clearSubmission,
  };
}
