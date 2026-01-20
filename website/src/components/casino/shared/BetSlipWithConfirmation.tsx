import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Label } from '../ui/Label';

/**
 * BetSlipWithConfirmation - AC-5.3: Bet placement flow with validation, confirmation, and error states
 *
 * This component wraps bet submission with:
 * 1. Pre-submission validation (balance check, bet amount, game phase)
 * 2. Confirmation step before actual submission
 * 3. Clear error state display with retry capability
 * 4. Loading state during submission
 */

export type BetSlipStatus = 'idle' | 'validating' | 'confirming' | 'submitting' | 'success' | 'error';

export interface BetValidationError {
  code: 'INSUFFICIENT_FUNDS' | 'INVALID_AMOUNT' | 'PHASE_LOCKED' | 'CONNECTION_ERROR' | 'SUBMISSION_FAILED' | 'VALIDATION_FAILED';
  message: string;
  retryable: boolean;
}

export interface BetSlipBet {
  id: string;
  type: string;
  target?: string | number;
  amount: number;
  odds?: number;
  maxWin?: number;
}

export interface BetSlipWithConfirmationProps {
  /** Array of pending bets to display and submit */
  bets: BetSlipBet[];
  /** Player's current balance */
  balance: number;
  /** Whether the betting phase is active (can accept bets) */
  bettingEnabled: boolean;
  /** Whether the player is connected to the gateway */
  isConnected: boolean;
  /** Callback to validate bets before confirmation */
  onValidate?: (bets: BetSlipBet[]) => Promise<BetValidationError | null>;
  /** Callback to submit bets after confirmation */
  onSubmit: (bets: BetSlipBet[]) => Promise<{ success: boolean; error?: BetValidationError }>;
  /** Callback when a bet is removed from the slip */
  onRemoveBet?: (betId: string) => void;
  /** Callback when all bets are cleared */
  onClearAll?: () => void;
  /** Additional CSS class */
  className?: string;
  /** Confirmation timeout in ms (auto-cancel if no action) */
  confirmationTimeoutMs?: number;
  /** Show compact variant */
  compact?: boolean;
}

const formatAmount = (amount: number): string => {
  if (!Number.isFinite(amount) || amount <= 0) return '0';
  return Math.floor(amount).toLocaleString();
};

const formatOdds = (odds: number | undefined): string => {
  if (odds === undefined || !Number.isFinite(odds)) return '—';
  if (odds >= 1) return `${odds.toFixed(2)}x`;
  return `1:${Math.round(1 / odds)}`;
};

/**
 * Validates a bet slip against balance and phase requirements
 */
export function validateBetSlip(
  bets: BetSlipBet[],
  balance: number,
  bettingEnabled: boolean,
  isConnected: boolean
): BetValidationError | null {
  // Check connection first
  if (!isConnected) {
    return {
      code: 'CONNECTION_ERROR',
      message: 'Not connected to server. Please check your connection.',
      retryable: true,
    };
  }

  // Check betting phase
  if (!bettingEnabled) {
    return {
      code: 'PHASE_LOCKED',
      message: 'Betting is currently locked. Wait for the next round.',
      retryable: false,
    };
  }

  // Check for empty bets
  if (bets.length === 0) {
    return {
      code: 'VALIDATION_FAILED',
      message: 'No bets to submit.',
      retryable: false,
    };
  }

  // Check for invalid amounts
  const invalidBet = bets.find(b => b.amount <= 0 || !Number.isFinite(b.amount));
  if (invalidBet) {
    return {
      code: 'INVALID_AMOUNT',
      message: `Invalid bet amount: ${invalidBet.type}`,
      retryable: false,
    };
  }

  // Check total against balance
  const totalBet = bets.reduce((sum, b) => sum + b.amount, 0);
  if (totalBet > balance) {
    return {
      code: 'INSUFFICIENT_FUNDS',
      message: `Insufficient balance. Need $${formatAmount(totalBet)}, have $${formatAmount(balance)}.`,
      retryable: false,
    };
  }

  return null;
}

export const BetSlipWithConfirmation: React.FC<BetSlipWithConfirmationProps> = ({
  bets,
  balance,
  bettingEnabled,
  isConnected,
  onValidate,
  onSubmit,
  onRemoveBet,
  onClearAll,
  className = '',
  confirmationTimeoutMs = 10000,
  compact = false,
}) => {
  const [status, setStatus] = useState<BetSlipStatus>('idle');
  const [error, setError] = useState<BetValidationError | null>(null);
  const [confirmationCountdown, setConfirmationCountdown] = useState<number>(0);
  const confirmationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);

  const totalBet = bets.reduce((sum, b) => sum + b.amount, 0);
  const totalMaxWin = bets.reduce((sum, b) => sum + (b.maxWin ?? b.amount * (b.odds ?? 1)), 0);

  // Clear confirmation timer on unmount or status change
  useEffect(() => {
    return () => {
      if (confirmationTimerRef.current) {
        clearInterval(confirmationTimerRef.current);
      }
    };
  }, []);

  // Handle confirmation countdown
  useEffect(() => {
    if (status === 'confirming') {
      const startTime = Date.now();
      const endTime = startTime + confirmationTimeoutMs;

      setConfirmationCountdown(Math.ceil(confirmationTimeoutMs / 1000));

      confirmationTimerRef.current = setInterval(() => {
        const remaining = Math.max(0, endTime - Date.now());
        setConfirmationCountdown(Math.ceil(remaining / 1000));

        if (remaining <= 0) {
          // Auto-cancel after timeout
          clearInterval(confirmationTimerRef.current!);
          confirmationTimerRef.current = null;
          setStatus('idle');
          setError(null);
        }
      }, 100);

      return () => {
        if (confirmationTimerRef.current) {
          clearInterval(confirmationTimerRef.current);
          confirmationTimerRef.current = null;
        }
      };
    }
  }, [status, confirmationTimeoutMs]);

  const handleValidateAndConfirm = useCallback(async () => {
    setStatus('validating');
    setError(null);

    // Run built-in validation
    const validationError = validateBetSlip(bets, balance, bettingEnabled, isConnected);
    if (validationError) {
      setError(validationError);
      setStatus('error');
      return;
    }

    // Run custom validation if provided
    if (onValidate) {
      try {
        const customError = await onValidate(bets);
        if (customError) {
          setError(customError);
          setStatus('error');
          return;
        }
      } catch {
        setError({
          code: 'VALIDATION_FAILED',
          message: 'Validation check failed. Please try again.',
          retryable: true,
        });
        setStatus('error');
        return;
      }
    }

    // Move to confirmation state
    setStatus('confirming');
    // Focus the confirm button for accessibility
    setTimeout(() => submitButtonRef.current?.focus(), 50);
  }, [bets, balance, bettingEnabled, isConnected, onValidate]);

  const handleConfirmSubmit = useCallback(async () => {
    if (confirmationTimerRef.current) {
      clearInterval(confirmationTimerRef.current);
      confirmationTimerRef.current = null;
    }

    setStatus('submitting');
    setError(null);

    try {
      const result = await onSubmit(bets);
      if (result.success) {
        setStatus('success');
        // Reset to idle after success display
        setTimeout(() => setStatus('idle'), 2000);
      } else {
        setError(result.error ?? {
          code: 'SUBMISSION_FAILED',
          message: 'Bet submission failed. Please try again.',
          retryable: true,
        });
        setStatus('error');
      }
    } catch {
      setError({
        code: 'SUBMISSION_FAILED',
        message: 'Bet submission failed. Please try again.',
        retryable: true,
      });
      setStatus('error');
    }
  }, [bets, onSubmit]);

  const handleCancel = useCallback(() => {
    if (confirmationTimerRef.current) {
      clearInterval(confirmationTimerRef.current);
      confirmationTimerRef.current = null;
    }
    setStatus('idle');
    setError(null);
  }, []);

  const handleRetry = useCallback(() => {
    setError(null);
    setStatus('idle');
    // Trigger validation again
    handleValidateAndConfirm();
  }, [handleValidateAndConfirm]);

  const handleDismissError = useCallback(() => {
    setError(null);
    setStatus('idle');
  }, []);

  // Empty state
  if (bets.length === 0 && status === 'idle') {
    return (
      <div
        className={`flex items-center justify-center rounded-2xl border border-dashed border-ns-border/60 bg-ns-surface/50 px-4 py-6 text-ns-muted text-sm ${className}`}
        role="status"
        aria-live="polite"
      >
        <span>No bets placed</span>
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl border border-ns-border bg-ns-surface shadow-soft backdrop-blur-md ${className}`}
      role="region"
      aria-label="Bet slip"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-ns-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Label size="micro">Bet Slip</Label>
          <span className="rounded-full bg-ns-border/60 px-2 py-0.5 text-[10px] font-bold tabular-nums text-ns-muted">
            {bets.length}
          </span>
        </div>
        {bets.length > 0 && status === 'idle' && onClearAll && (
          <button
            type="button"
            onClick={onClearAll}
            className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ns-muted hover:text-ns transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-primary/50 focus-visible:ring-offset-1 focus-visible:ring-offset-ns-surface"
            aria-label="Clear all bets"
          >
            Clear
          </button>
        )}
      </div>

      {/* Bet List */}
      {!compact && (
        <div className="max-h-48 overflow-y-auto scrollbar-hide">
          {bets.map((bet) => (
            <div
              key={bet.id}
              className="flex items-center justify-between border-b border-ns-border/30 px-4 py-2 last:border-b-0"
            >
              <div className="flex flex-col">
                <span className="text-xs font-medium text-ns">
                  {bet.type}
                  {bet.target !== undefined && <span className="text-ns-muted"> · {bet.target}</span>}
                </span>
                <span className="text-[10px] text-ns-muted">
                  {formatOdds(bet.odds)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold tabular-nums text-ns">
                  ${formatAmount(bet.amount)}
                </span>
                {onRemoveBet && status === 'idle' && (
                  <button
                    type="button"
                    onClick={() => onRemoveBet(bet.id)}
                    className="rounded-full p-1 text-ns-muted hover:bg-ns-border/60 hover:text-ns transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-primary/50"
                    aria-label={`Remove ${bet.type} bet`}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Totals */}
      <div className="flex items-center justify-between border-t border-ns-border/60 px-4 py-3">
        <div className="flex flex-col">
          <span className="text-[10px] font-medium uppercase tracking-widest text-ns-muted">
            Total Stake
          </span>
          <span className="text-sm font-bold tabular-nums text-ns">
            ${formatAmount(totalBet)}
          </span>
        </div>
        <div className="h-8 w-px bg-ns-border/60" />
        <div className="flex flex-col text-right">
          <span className="text-[10px] font-medium uppercase tracking-widest text-ns-muted">
            Max Win
          </span>
          <span className="text-sm font-bold tabular-nums text-green-500">
            ${formatAmount(totalMaxWin)}
          </span>
        </div>
      </div>

      {/* Error State */}
      {status === 'error' && error && (
        <div
          className="mx-4 mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3"
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-start gap-2">
            <svg
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 4.5V9M8 11.5V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div className="flex-1">
              <p className="text-xs font-medium text-red-500">{error.message}</p>
              <div className="mt-2 flex gap-2">
                {error.retryable && (
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="rounded-lg bg-red-500/20 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-red-500 hover:bg-red-500/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
                  >
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDismissError}
                  className="rounded-lg bg-ns-border/60 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-ns-muted hover:bg-ns-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-primary/50"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success State */}
      {status === 'success' && (
        <div
          className="mx-4 mb-3 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2">
            <svg
              className="h-4 w-4 text-green-500"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M5 8L7 10L11 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-xs font-medium text-green-500">Bet placed successfully!</p>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="px-4 pb-4">
        {status === 'idle' && bets.length > 0 && (
          <button
            type="button"
            onClick={handleValidateAndConfirm}
            disabled={!bettingEnabled || !isConnected}
            className="w-full rounded-xl bg-action-primary py-3 text-sm font-bold uppercase tracking-wider text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-primary focus-visible:ring-offset-2 focus-visible:ring-offset-ns-surface"
            aria-label="Place bet"
          >
            {!isConnected ? 'Connecting...' : !bettingEnabled ? 'Betting Locked' : 'Place Bet'}
          </button>
        )}

        {status === 'validating' && (
          <div
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-ns-border/60 py-3 text-sm font-medium text-ns-muted"
            role="status"
            aria-live="polite"
          >
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
              <path d="M14 8a6 6 0 01-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Validating...
          </div>
        )}

        {status === 'confirming' && (
          <div className="space-y-2">
            <div
              className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center"
              role="alert"
              aria-live="polite"
            >
              <p className="text-xs font-medium text-amber-500">
                Confirm bet of ${formatAmount(totalBet)}? ({confirmationCountdown}s)
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCancel}
                className="flex-1 rounded-xl border border-ns-border py-2.5 text-sm font-bold uppercase tracking-wider text-ns transition-all hover:bg-ns-border/60 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-ns-surface"
                aria-label="Cancel bet"
              >
                Cancel
              </button>
              <button
                ref={submitButtonRef}
                type="button"
                onClick={handleConfirmSubmit}
                className="flex-1 rounded-xl bg-action-primary py-2.5 text-sm font-bold uppercase tracking-wider text-white transition-all hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-primary focus-visible:ring-offset-2 focus-visible:ring-offset-ns-surface"
                aria-label="Confirm and submit bet"
              >
                Confirm
              </button>
            </div>
          </div>
        )}

        {status === 'submitting' && (
          <div
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-action-primary/80 py-3 text-sm font-medium text-white"
            role="status"
            aria-live="polite"
          >
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
              <path d="M14 8a6 6 0 01-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Submitting...
          </div>
        )}
      </div>
    </div>
  );
};

export default BetSlipWithConfirmation;
