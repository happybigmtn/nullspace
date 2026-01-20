import React, { useMemo } from 'react';
import type {
  RoundOutcome,
  PlayerSettlement,
  RoundTotal,
} from '../../hooks/useRoundOutcome';
import {
  getBetTypeLabel,
  formatAmount,
  getTopTotals,
} from '../../hooks/useRoundOutcome';

/**
 * Simple className joiner
 */
const cn = (...args: (string | boolean | undefined | null)[]) =>
  args.filter(Boolean).join(' ');

export interface RoundOutcomeDisplayProps {
  /** Round outcome data (dice, totals, RNG) */
  outcome: RoundOutcome | null;
  /** Whether we have outcome data */
  hasOutcomeData?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Whether to show totals breakdown */
  showTotals?: boolean;
  /** Maximum totals to display */
  maxTotals?: number;
  /** Compact mode for smaller displays */
  compact?: boolean;
  /** Token decimal conversion factor (default: 1e6) */
  tokenDecimals?: number;
}

/**
 * Dice visual representation
 */
function DiceFace({ value, className = '' }: { value: number; className?: string }) {
  // Simplified dice face with dot positions
  const dotPositions: Record<number, Array<[number, number]>> = {
    1: [[50, 50]],
    2: [[25, 25], [75, 75]],
    3: [[25, 25], [50, 50], [75, 75]],
    4: [[25, 25], [75, 25], [25, 75], [75, 75]],
    5: [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]],
    6: [[25, 25], [75, 25], [25, 50], [75, 50], [25, 75], [75, 75]],
  };

  const dots = dotPositions[value] ?? [];

  return (
    <div
      className={cn(
        'relative bg-white dark:bg-mono-800 rounded-lg border-2 border-mono-200 dark:border-mono-600 shadow-md aspect-square',
        className
      )}
      role="img"
      aria-label={`Dice showing ${value}`}
    >
      {dots.map(([x, y], i) => (
        <div
          key={i}
          className="absolute w-2 h-2 bg-mono-900 dark:bg-mono-100 rounded-full"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            transform: 'translate(-50%, -50%)',
          }}
        />
      ))}
    </div>
  );
}

/**
 * RoundOutcomeDisplay - Shows the round outcome with dice and totals.
 *
 * Displays:
 * - Dice result visualization (d1 + d2 = total)
 * - Main point if established
 * - Aggregated bet totals by type
 *
 * AC-5.4: Real-time updates display round outcomes and totals without manual refresh.
 *
 * @example
 * ```tsx
 * <RoundOutcomeDisplay
 *   outcome={outcome}
 *   hasOutcomeData={hasOutcomeData}
 * />
 * ```
 */
export const RoundOutcomeDisplay: React.FC<RoundOutcomeDisplayProps> = ({
  outcome,
  hasOutcomeData = false,
  className = '',
  showTotals = true,
  maxTotals = 5,
  compact = false,
  tokenDecimals = 1e6,
}) => {
  const topTotals = useMemo(() => {
    if (!outcome?.totals) return [];
    return getTopTotals(outcome.totals, maxTotals);
  }, [outcome?.totals, maxTotals]);

  const totalWagered = useMemo(() => {
    if (!outcome?.totals) return 0n;
    return outcome.totals.reduce((sum, t) => sum + t.amount, 0n);
  }, [outcome?.totals]);

  // Loading state
  if (!hasOutcomeData || !outcome) {
    return (
      <div
        className={cn(
          'flex items-center justify-center p-4 rounded-xl bg-mono-100/50 dark:bg-mono-800/50',
          className
        )}
        role="status"
        aria-live="polite"
        aria-label="Waiting for outcome"
      >
        <span className="text-sm text-mono-500">Waiting for outcome...</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-4 p-4 rounded-xl bg-white/80 dark:bg-mono-900/80 border border-mono-200 dark:border-mono-700 shadow-lg',
        className
      )}
      role="region"
      aria-label="Round outcome"
      aria-live="polite"
      aria-atomic="true"
    >
      {/* Dice result */}
      <div className="flex items-center justify-center gap-4">
        <DiceFace value={outcome.d1} className={compact ? 'w-10 h-10' : 'w-14 h-14'} />
        <span
          className={cn(
            'font-bold text-mono-400',
            compact ? 'text-lg' : 'text-2xl'
          )}
          aria-hidden="true"
        >
          +
        </span>
        <DiceFace value={outcome.d2} className={compact ? 'w-10 h-10' : 'w-14 h-14'} />
        <span
          className={cn(
            'font-bold text-mono-400',
            compact ? 'text-lg' : 'text-2xl'
          )}
          aria-hidden="true"
        >
          =
        </span>
        <div
          className={cn(
            'flex items-center justify-center rounded-xl bg-mono-900 dark:bg-mono-100 font-black tabular-nums',
            compact ? 'w-10 h-10 text-lg' : 'w-14 h-14 text-3xl',
            'text-white dark:text-mono-900'
          )}
          aria-label={`Total: ${outcome.diceTotal}`}
        >
          {outcome.diceTotal}
        </div>
      </div>

      {/* Point display */}
      {outcome.mainPoint > 0 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <span className="text-mono-500">Point:</span>
          <span className="font-bold text-amber-600 dark:text-amber-400">
            {outcome.mainPoint}
          </span>
          {outcome.epochPointEstablished && (
            <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full">
              Just set
            </span>
          )}
        </div>
      )}

      {/* Totals breakdown */}
      {showTotals && topTotals.length > 0 && (
        <div className="border-t border-mono-200 dark:border-mono-700 pt-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-mono-500">
              Active Bets
            </h4>
            <span className="text-xs font-mono text-mono-400">
              Total: ${formatAmount(totalWagered, Math.log10(tokenDecimals))}
            </span>
          </div>
          <div className="space-y-2">
            {topTotals.map((total, idx) => (
              <TotalRow
                key={`${total.betType}-${total.target}-${idx}`}
                total={total}
                tokenDecimals={tokenDecimals}
                compact={compact}
              />
            ))}
          </div>
        </div>
      )}

      {/* Round info */}
      <div className="flex items-center justify-between text-xs text-mono-400 border-t border-mono-200 dark:border-mono-700 pt-3">
        <span className="font-mono">Round #{outcome.roundId.toString()}</span>
        <span className="font-mono truncate max-w-[100px]" title="RNG Commit">
          RNG: {bytesToHex(outcome.rngCommit).slice(0, 8)}...
        </span>
      </div>
    </div>
  );
};

/**
 * Single total row in the breakdown
 */
function TotalRow({
  total,
  tokenDecimals,
  compact,
}: {
  total: RoundTotal;
  tokenDecimals: number;
  compact?: boolean;
}) {
  const label = getBetTypeLabel(total.betType);
  const amountStr = formatAmount(total.amount, Math.log10(tokenDecimals));

  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'font-medium',
            compact ? 'text-xs' : 'text-sm',
            'text-mono-700 dark:text-mono-300'
          )}
        >
          {label}
        </span>
        {total.target > 0 && (
          <span className="text-xs text-mono-400">({total.target})</span>
        )}
      </div>
      <span
        className={cn(
          'font-mono font-bold tabular-nums',
          compact ? 'text-xs' : 'text-sm',
          'text-mono-900 dark:text-mono-100'
        )}
      >
        ${amountStr}
      </span>
    </div>
  );
}

/**
 * Convert bytes to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * SettlementResultDisplay - Shows the player's settlement result.
 *
 * Displays win/loss/push outcome with payout amount.
 * Designed to be used alongside ResultDisplay for the full reveal animation.
 */
export interface SettlementResultDisplayProps {
  /** Player settlement data */
  settlement: PlayerSettlement | null;
  /** Settlement result type */
  settlementResult: 'win' | 'loss' | 'push' | null;
  /** Net payout amount (already converted to display units) */
  payoutAmount: number;
  /** Total amount bet */
  totalBetAmount: number;
  /** Whether we have settlement data */
  hasSettlement?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Compact mode */
  compact?: boolean;
  /** Token decimal conversion factor */
  tokenDecimals?: number;
}

const RESULT_STYLES = {
  win: {
    bg: 'bg-emerald-100 dark:bg-emerald-900/30',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-300 dark:border-emerald-700',
    label: 'You Win!',
  },
  loss: {
    bg: 'bg-mono-100 dark:bg-mono-800/30',
    text: 'text-mono-500 dark:text-mono-400',
    border: 'border-mono-300 dark:border-mono-600',
    label: 'Better luck next time',
  },
  push: {
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-300 dark:border-amber-700',
    label: 'Push',
  },
};

export const SettlementResultDisplay: React.FC<SettlementResultDisplayProps> = ({
  settlement,
  settlementResult,
  payoutAmount,
  totalBetAmount,
  hasSettlement = false,
  className = '',
  compact = false,
  tokenDecimals = 1e6,
}) => {
  // No settlement yet
  if (!hasSettlement || !settlement || !settlementResult) {
    return null;
  }

  const style = RESULT_STYLES[settlementResult];

  return (
    <div
      className={cn(
        'flex flex-col gap-2 p-4 rounded-xl border-2',
        style.bg,
        style.border,
        className
      )}
      role="alert"
      aria-live="assertive"
      aria-label={`Settlement: ${style.label}, ${payoutAmount >= 0 ? '+' : ''}$${Math.abs(payoutAmount).toFixed(2)}`}
    >
      {/* Result label */}
      <div className={cn('font-bold text-center', compact ? 'text-sm' : 'text-lg', style.text)}>
        {style.label}
      </div>

      {/* Payout amount */}
      <div
        className={cn(
          'font-mono font-black tabular-nums text-center',
          compact ? 'text-xl' : 'text-3xl',
          payoutAmount > 0 && 'text-emerald-600 dark:text-emerald-400',
          payoutAmount < 0 && 'text-mono-500',
          payoutAmount === 0 && 'text-amber-600 dark:text-amber-400'
        )}
      >
        {payoutAmount >= 0 ? '+' : ''}${Math.abs(payoutAmount).toFixed(2)}
      </div>

      {/* Bet details */}
      {settlement.myBets.length > 0 && (
        <div className="text-xs text-center text-mono-500">
          {settlement.myBets.length} bet{settlement.myBets.length !== 1 ? 's' : ''} settled
          {totalBetAmount > 0 && ` • $${totalBetAmount.toFixed(2)} wagered`}
        </div>
      )}

      {/* Balance update */}
      {settlement.balanceSnapshot && (
        <div className="flex items-center justify-center gap-4 pt-2 border-t border-mono-200 dark:border-mono-700 text-xs text-mono-400">
          <span>Balance: ${formatAmount(settlement.balanceSnapshot.chips, Math.log10(tokenDecimals))}</span>
        </div>
      )}
    </div>
  );
};

/**
 * Combined outcome and settlement display
 */
export interface RoundResultPanelProps {
  /** Round outcome data */
  outcome: RoundOutcome | null;
  /** Player settlement data */
  settlement: PlayerSettlement | null;
  /** Settlement result type */
  settlementResult: 'win' | 'loss' | 'push' | null;
  /** Net payout amount */
  payoutAmount: number;
  /** Total amount bet */
  totalBetAmount: number;
  /** Whether we have outcome data */
  hasOutcomeData?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Compact mode */
  compact?: boolean;
  /** Token decimals */
  tokenDecimals?: number;
}

/**
 * RoundResultPanel - Combined panel showing outcome and settlement.
 *
 * AC-5.4: Real-time updates display round outcomes and totals without manual refresh.
 */
export const RoundResultPanel: React.FC<RoundResultPanelProps> = ({
  outcome,
  settlement,
  settlementResult,
  payoutAmount,
  totalBetAmount,
  hasOutcomeData = false,
  className = '',
  compact = false,
  tokenDecimals = 1e6,
}) => {
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Outcome display */}
      <RoundOutcomeDisplay
        outcome={outcome}
        hasOutcomeData={hasOutcomeData}
        compact={compact}
        tokenDecimals={tokenDecimals}
      />

      {/* Settlement result */}
      {settlement && (
        <SettlementResultDisplay
          settlement={settlement}
          settlementResult={settlementResult}
          payoutAmount={payoutAmount}
          totalBetAmount={totalBetAmount}
          hasSettlement={!!settlement}
          compact={compact}
          tokenDecimals={tokenDecimals}
        />
      )}
    </div>
  );
};

export default RoundOutcomeDisplay;
