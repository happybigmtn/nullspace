import { useState, useCallback, useRef } from 'react';
import type { BetSlipBet, BetValidationError, BetSlipStatus } from '../components/casino/shared/BetSlipWithConfirmation';

/**
 * useBetSubmission - AC-5.3: Hook for managing bet submission state and logic
 *
 * This hook provides:
 * 1. Bet submission state management (idle, submitting, success, error)
 * 2. Error handling with typed error codes
 * 3. Retry logic for transient failures
 * 4. Debouncing to prevent double submissions
 */

export interface BetSubmissionState {
  status: BetSlipStatus;
  error: BetValidationError | null;
  lastSubmittedBets: BetSlipBet[];
  submissionCount: number;
}

export interface BetSubmissionOptions {
  /** Minimum time between submissions in ms (debounce) */
  debounceMs?: number;
  /** Maximum retry attempts for retryable errors */
  maxRetries?: number;
  /** Callback when submission starts */
  onSubmitStart?: (bets: BetSlipBet[]) => void;
  /** Callback when submission succeeds */
  onSubmitSuccess?: (bets: BetSlipBet[]) => void;
  /** Callback when submission fails */
  onSubmitError?: (error: BetValidationError, bets: BetSlipBet[]) => void;
}

export interface UseBetSubmissionResult {
  /** Current submission state */
  state: BetSubmissionState;
  /** Submit bets through the provided handler */
  submit: (
    bets: BetSlipBet[],
    handler: (bets: BetSlipBet[]) => Promise<{ success: boolean; error?: BetValidationError }>
  ) => Promise<boolean>;
  /** Reset state to idle */
  reset: () => void;
  /** Clear the current error */
  clearError: () => void;
  /** Whether a submission is currently in progress */
  isSubmitting: boolean;
}

const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_MAX_RETRIES = 0;

export function useBetSubmission(options: BetSubmissionOptions = {}): UseBetSubmissionResult {
  const {
    debounceMs = DEFAULT_DEBOUNCE_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    onSubmitStart,
    onSubmitSuccess,
    onSubmitError,
  } = options;

  const [state, setState] = useState<BetSubmissionState>({
    status: 'idle',
    error: null,
    lastSubmittedBets: [],
    submissionCount: 0,
  });

  const lastSubmitTimeRef = useRef<number>(0);
  const retryCountRef = useRef<number>(0);

  const submit = useCallback(
    async (
      bets: BetSlipBet[],
      handler: (bets: BetSlipBet[]) => Promise<{ success: boolean; error?: BetValidationError }>
    ): Promise<boolean> => {
      // Debounce check
      const now = Date.now();
      if (now - lastSubmitTimeRef.current < debounceMs) {
        return false;
      }
      lastSubmitTimeRef.current = now;

      // Prevent double submission
      if (state.status === 'submitting') {
        return false;
      }

      setState((prev) => ({
        ...prev,
        status: 'submitting',
        error: null,
        lastSubmittedBets: bets,
      }));

      onSubmitStart?.(bets);

      try {
        const result = await handler(bets);

        if (result.success) {
          setState((prev) => ({
            ...prev,
            status: 'success',
            error: null,
            submissionCount: prev.submissionCount + 1,
          }));
          retryCountRef.current = 0;
          onSubmitSuccess?.(bets);
          return true;
        }

        const error = result.error ?? {
          code: 'SUBMISSION_FAILED' as const,
          message: 'Bet submission failed. Please try again.',
          retryable: true,
        };

        // Check if we should auto-retry
        if (error.retryable && retryCountRef.current < maxRetries) {
          retryCountRef.current += 1;
          // Exponential backoff: 500ms, 1000ms, 2000ms...
          const backoffMs = debounceMs * Math.pow(2, retryCountRef.current - 1);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          return submit(bets, handler);
        }

        setState((prev) => ({
          ...prev,
          status: 'error',
          error,
        }));
        retryCountRef.current = 0;
        onSubmitError?.(error, bets);
        return false;
      } catch (err) {
        const error: BetValidationError = {
          code: 'SUBMISSION_FAILED',
          message: err instanceof Error ? err.message : 'Bet submission failed. Please try again.',
          retryable: true,
        };

        setState((prev) => ({
          ...prev,
          status: 'error',
          error,
        }));
        retryCountRef.current = 0;
        onSubmitError?.(error, bets);
        return false;
      }
    },
    [state.status, debounceMs, maxRetries, onSubmitStart, onSubmitSuccess, onSubmitError]
  );

  const reset = useCallback(() => {
    setState({
      status: 'idle',
      error: null,
      lastSubmittedBets: [],
      submissionCount: 0,
    });
    retryCountRef.current = 0;
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({
      ...prev,
      status: prev.status === 'error' ? 'idle' : prev.status,
      error: null,
    }));
  }, []);

  return {
    state,
    submit,
    reset,
    clearError,
    isSubmitting: state.status === 'submitting',
  };
}

export default useBetSubmission;
