/**
 * useBetSubmission - Debounced bet submission to prevent double-tap duplicates
 * Tracks in-flight submissions and disables betting until response or timeout
 */
import { useState, useCallback, useRef, useEffect } from 'react';

const SUBMISSION_TIMEOUT_MS = 5000;

interface BetSubmissionResult {
  /** Whether a bet submission is currently in flight */
  isSubmitting: boolean;
  /** Submit a bet - returns false if already submitting or send failed */
  submitBet: (message: object) => boolean;
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
    setIsSubmitting(false);
  }, []);

  const submitBet = useCallback((message: object): boolean => {
    // Already submitting - reject duplicate
    if (isSubmitting) {
      return false;
    }

    // Try to send
    const success = send(message);
    if (!success) {
      return false;
    }

    // Mark as submitting
    setIsSubmitting(true);

    // Set timeout to re-enable if no response (shouldn't happen in normal operation)
    timeoutRef.current = setTimeout(() => {
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
