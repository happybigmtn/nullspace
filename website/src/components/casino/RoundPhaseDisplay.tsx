import React, { useMemo } from 'react';
import type { RoundPhaseLabel } from '../../hooks/useRoundPhase';
import { formatCountdown, ROUND_PHASE } from '../../hooks/useRoundPhase';

export interface RoundPhaseDisplayProps {
  /** Human-readable phase label */
  phaseLabel: RoundPhaseLabel;
  /** Countdown in milliseconds */
  countdownMs: number;
  /** Whether we have received any round data */
  hasRoundData?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Whether to show the countdown timer */
  showCountdown?: boolean;
  /** Whether to show the phase label */
  showLabel?: boolean;
  /** Compact mode for smaller displays */
  compact?: boolean;
  /** Urgency threshold in ms - countdown pulses when below this */
  urgencyThresholdMs?: number;
}

/**
 * Phase label styling configuration
 */
const PHASE_STYLES: Record<
  RoundPhaseLabel,
  { bg: string; text: string; glow: string; label: string }
> = {
  BETTING: {
    bg: 'bg-emerald-500/20 dark:bg-emerald-400/20',
    text: 'text-emerald-700 dark:text-emerald-300',
    glow: 'shadow-emerald-500/30',
    label: 'Place Bets',
  },
  LOCKED: {
    bg: 'bg-amber-500/20 dark:bg-amber-400/20',
    text: 'text-amber-700 dark:text-amber-300',
    glow: 'shadow-amber-500/30',
    label: 'Bets Locked',
  },
  REVEALING: {
    bg: 'bg-purple-500/20 dark:bg-purple-400/20',
    text: 'text-purple-700 dark:text-purple-300',
    glow: 'shadow-purple-500/30',
    label: 'Revealing',
  },
  SETTLING: {
    bg: 'bg-blue-500/20 dark:bg-blue-400/20',
    text: 'text-blue-700 dark:text-blue-300',
    glow: 'shadow-blue-500/30',
    label: 'Settling',
  },
  FINALIZED: {
    bg: 'bg-mono-200/20 dark:bg-mono-700/20',
    text: 'text-mono-600 dark:text-mono-400',
    glow: '',
    label: 'Complete',
  },
  IDLE: {
    bg: 'bg-mono-200/20 dark:bg-mono-700/20',
    text: 'text-mono-500 dark:text-mono-500',
    glow: '',
    label: 'Waiting',
  },
};

/**
 * RoundPhaseDisplay - Shows the current round phase and countdown timer.
 *
 * Displays:
 * - Phase label (BETTING, LOCKED, REVEALING, SETTLING, FINALIZED)
 * - Countdown timer synchronized to server time
 * - Visual urgency indicators when countdown is low
 *
 * AC-5.2: Table view shows countdown timers synchronized to server round phases.
 * AC-PQ.1: Countdown matches server phase within 250ms.
 *
 * @example
 * ```tsx
 * <RoundPhaseDisplay
 *   phaseLabel={phaseLabel}
 *   countdownMs={countdownMs}
 *   hasRoundData={hasRoundData}
 * />
 * ```
 */
export const RoundPhaseDisplay: React.FC<RoundPhaseDisplayProps> = ({
  phaseLabel,
  countdownMs,
  hasRoundData = false,
  className = '',
  showCountdown = true,
  showLabel = true,
  compact = false,
  urgencyThresholdMs = 10000, // 10 seconds
}) => {
  const formattedCountdown = useMemo(() => formatCountdown(countdownMs), [countdownMs]);
  const isUrgent = countdownMs > 0 && countdownMs <= urgencyThresholdMs;
  const style = PHASE_STYLES[phaseLabel];

  // Don't render if no data yet
  if (!hasRoundData) {
    return (
      <div
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-mono-100/50 dark:bg-mono-800/50 ${className}`}
        role="status"
        aria-live="polite"
        aria-label="Waiting for round data"
      >
        <span className="w-2 h-2 rounded-full bg-mono-400 animate-pulse" />
        <span className="text-xs font-medium text-mono-500">Connecting...</span>
      </div>
    );
  }

  return (
    <div
      className={`
        flex items-center gap-2
        ${compact ? 'px-2 py-1' : 'px-3 py-1.5'}
        rounded-full
        ${style.bg}
        ${isUrgent && countdownMs > 0 ? `shadow-lg ${style.glow}` : ''}
        transition-all duration-300
        ${className}
      `}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={`Round phase: ${style.label}${showCountdown && countdownMs > 0 ? `, ${formattedCountdown} remaining` : ''}`}
    >
      {/* Phase indicator dot */}
      <span
        className={`
          ${compact ? 'w-1.5 h-1.5' : 'w-2 h-2'}
          rounded-full
          ${phaseLabel === 'BETTING' ? 'bg-emerald-500 dark:bg-emerald-400' : ''}
          ${phaseLabel === 'LOCKED' ? 'bg-amber-500 dark:bg-amber-400' : ''}
          ${phaseLabel === 'REVEALING' ? 'bg-purple-500 dark:bg-purple-400' : ''}
          ${phaseLabel === 'SETTLING' ? 'bg-blue-500 dark:bg-blue-400' : ''}
          ${phaseLabel === 'FINALIZED' || phaseLabel === 'IDLE' ? 'bg-mono-400' : ''}
          ${isUrgent ? 'animate-pulse' : ''}
        `}
        aria-hidden="true"
      />

      {/* Phase label */}
      {showLabel && (
        <span
          className={`
            ${compact ? 'text-[10px]' : 'text-xs'}
            font-bold uppercase tracking-wider
            ${style.text}
          `}
        >
          {style.label}
        </span>
      )}

      {/* Countdown timer */}
      {showCountdown && countdownMs > 0 && (
        <span
          className={`
            ${compact ? 'text-[10px]' : 'text-xs'}
            font-mono font-bold tabular-nums
            ${style.text}
            ${isUrgent ? 'animate-pulse' : ''}
          `}
          data-testid="countdown-display"
        >
          {formattedCountdown}
        </span>
      )}
    </div>
  );
};

/**
 * TablePhaseHeader - Full-width header variant for table views.
 * Shows phase info prominently at the top of the table.
 */
export interface TablePhaseHeaderProps extends Omit<RoundPhaseDisplayProps, 'compact'> {
  /** Round ID for display */
  roundId?: bigint | null;
}

export const TablePhaseHeader: React.FC<TablePhaseHeaderProps> = ({
  phaseLabel,
  countdownMs,
  hasRoundData = false,
  roundId,
  className = '',
  showCountdown = true,
  urgencyThresholdMs = 10000,
}) => {
  const formattedCountdown = useMemo(() => formatCountdown(countdownMs), [countdownMs]);
  const isUrgent = countdownMs > 0 && countdownMs <= urgencyThresholdMs;
  const style = PHASE_STYLES[phaseLabel];

  if (!hasRoundData) {
    return (
      <div
        className={`flex items-center justify-center gap-4 px-6 py-4 rounded-2xl bg-mono-100/50 dark:bg-mono-800/50 ${className}`}
        role="status"
        aria-live="polite"
      >
        <span className="text-sm font-medium text-mono-500">Waiting for round...</span>
      </div>
    );
  }

  return (
    <div
      className={`
        flex items-center justify-between
        px-6 py-4
        rounded-2xl
        ${style.bg}
        ${isUrgent ? `shadow-xl ${style.glow}` : 'shadow-md'}
        transition-all duration-300
        ${className}
      `}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {/* Left: Phase info */}
      <div className="flex items-center gap-3">
        <span
          className={`
            w-3 h-3 rounded-full
            ${phaseLabel === 'BETTING' ? 'bg-emerald-500' : ''}
            ${phaseLabel === 'LOCKED' ? 'bg-amber-500' : ''}
            ${phaseLabel === 'REVEALING' ? 'bg-purple-500' : ''}
            ${phaseLabel === 'SETTLING' ? 'bg-blue-500' : ''}
            ${phaseLabel === 'FINALIZED' || phaseLabel === 'IDLE' ? 'bg-mono-400' : ''}
            ${isUrgent ? 'animate-pulse' : ''}
          `}
          aria-hidden="true"
        />
        <div className="flex flex-col">
          <span className={`text-sm font-bold uppercase tracking-wider ${style.text}`}>
            {style.label}
          </span>
          {roundId !== null && roundId !== undefined && (
            <span className="text-[10px] text-mono-500 font-mono">
              Round #{roundId.toString()}
            </span>
          )}
        </div>
      </div>

      {/* Right: Countdown */}
      {showCountdown && countdownMs > 0 && (
        <div
          className={`
            text-2xl font-mono font-black tabular-nums
            ${style.text}
            ${isUrgent ? 'animate-pulse scale-110' : ''}
            transition-transform duration-150
          `}
          data-testid="countdown-header"
        >
          {formattedCountdown}
        </div>
      )}
    </div>
  );
};

export default RoundPhaseDisplay;
