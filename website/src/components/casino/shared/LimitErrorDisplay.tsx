import React from 'react';
import {
  type ExtendedBetValidationError,
  type ExposureLimitError,
  type ResponsibleGamingError,
  isExposureLimitError,
  isResponsibleGamingError,
  isLimitErrorRetryable,
  getLimitErrorMessage,
  formatLimitAmount,
  formatTimeUntil,
} from './limitTypes';

/**
 * LimitErrorDisplay - AC-7.5: Component for displaying limit-related errors
 *
 * This component provides specialized error displays for:
 * 1. Exposure limit errors (single bet, player exposure, house exposure)
 * 2. Responsible gaming errors (wager caps, loss caps, self-exclusion)
 * 3. Standard bet validation errors (insufficient funds, etc.)
 *
 * Features:
 * - Color-coded severity (amber for warnings, red for blocks)
 * - Structured data display (amounts, limits, percentages)
 * - Appropriate retry vs dismiss actions based on error type
 * - Accessibility: ARIA roles and live regions
 */

export interface LimitErrorDisplayProps {
  /** The error to display */
  error: ExtendedBetValidationError;
  /** Callback when user requests retry (only shown for retryable errors) */
  onRetry?: () => void;
  /** Callback when user dismisses the error */
  onDismiss?: () => void;
  /** Optional additional CSS class */
  className?: string;
  /** Show compact variant */
  compact?: boolean;
}

/**
 * Icon component for exposure limit errors (shield)
 */
const ExposureIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M8 1L2 3.5V7.5C2 11.09 4.55 14.38 8 15C11.45 14.38 14 11.09 14 7.5V3.5L8 1Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M8 5V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="8" cy="11" r="0.5" fill="currentColor" />
  </svg>
);

/**
 * Icon component for responsible gaming errors (clock/timer)
 */
const GamingLimitIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 4.5V8L10.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Icon component for self-exclusion errors (block)
 */
const BlockIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M4.5 4.5L11.5 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/**
 * Icon component for standard errors (alert)
 */
const AlertIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 4.5V9M8 11.5V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/**
 * Get the appropriate icon for an error code
 */
function getErrorIcon(code: string): React.FC<{ className?: string }> {
  if (code === 'SELF_EXCLUDED' || code === 'IN_COOLDOWN') {
    return BlockIcon;
  }
  if (isExposureLimitError(code)) {
    return ExposureIcon;
  }
  if (isResponsibleGamingError(code)) {
    return GamingLimitIcon;
  }
  return AlertIcon;
}

/**
 * Get the color scheme for an error
 */
function getErrorColorScheme(code: string): {
  border: string;
  bg: string;
  text: string;
  icon: string;
  buttonBg: string;
  buttonHover: string;
} {
  // Self-exclusion and cooldown are severe - use red
  if (code === 'SELF_EXCLUDED' || code === 'IN_COOLDOWN') {
    return {
      border: 'border-red-500/30',
      bg: 'bg-red-500/10',
      text: 'text-red-500',
      icon: 'text-red-500',
      buttonBg: 'bg-red-500/20',
      buttonHover: 'hover:bg-red-500/30',
    };
  }

  // Loss cap reached is severe - use red
  if (
    code === 'DAILY_LOSS_CAP_REACHED' ||
    code === 'WEEKLY_LOSS_CAP_REACHED' ||
    code === 'MONTHLY_LOSS_CAP_REACHED'
  ) {
    return {
      border: 'border-red-500/30',
      bg: 'bg-red-500/10',
      text: 'text-red-500',
      icon: 'text-red-500',
      buttonBg: 'bg-red-500/20',
      buttonHover: 'hover:bg-red-500/30',
    };
  }

  // Exposure and wager cap errors are warnings - use amber
  if (isExposureLimitError(code) || isResponsibleGamingError(code)) {
    return {
      border: 'border-amber-500/30',
      bg: 'bg-amber-500/10',
      text: 'text-amber-500',
      icon: 'text-amber-500',
      buttonBg: 'bg-amber-500/20',
      buttonHover: 'hover:bg-amber-500/30',
    };
  }

  // Standard errors use red
  return {
    border: 'border-red-500/30',
    bg: 'bg-red-500/10',
    text: 'text-red-500',
    icon: 'text-red-500',
    buttonBg: 'bg-red-500/20',
    buttonHover: 'hover:bg-red-500/30',
  };
}

/**
 * Render additional context for exposure limit errors
 */
const ExposureLimitDetails: React.FC<{
  error: ExposureLimitError;
  textColor: string;
}> = ({ error, textColor }) => {
  switch (error.code) {
    case 'SINGLE_BET_EXCEEDED':
      return (
        <div className="mt-2 flex gap-4 text-[10px]" aria-label="Bet limit details">
          <div>
            <span className="text-ns-muted">Your bet:</span>{' '}
            <span className={textColor}>{formatLimitAmount(error.betAmount)}</span>
          </div>
          <div>
            <span className="text-ns-muted">Max allowed:</span>{' '}
            <span className={textColor}>{formatLimitAmount(error.maxAllowed)}</span>
          </div>
        </div>
      );

    case 'PLAYER_EXPOSURE_EXCEEDED':
      return (
        <div className="mt-2 flex gap-4 text-[10px]" aria-label="Exposure details">
          <div>
            <span className="text-ns-muted">Current:</span>{' '}
            <span className={textColor}>{formatLimitAmount(error.currentExposure)}</span>
          </div>
          <div>
            <span className="text-ns-muted">New total:</span>{' '}
            <span className={textColor}>{formatLimitAmount(error.newExposure)}</span>
          </div>
          <div>
            <span className="text-ns-muted">Limit:</span>{' '}
            <span className={textColor}>{formatLimitAmount(error.maxAllowed)}</span>
          </div>
        </div>
      );

    case 'HOUSE_EXPOSURE_EXCEEDED':
      return (
        <div className="mt-2 text-[10px] text-ns-muted" aria-label="House exposure info">
          The house has reached its exposure limit. Please try a smaller bet or wait for other rounds to settle.
        </div>
      );

    default:
      return null;
  }
};

/**
 * Render additional context for responsible gaming errors
 */
const ResponsibleGamingDetails: React.FC<{
  error: ResponsibleGamingError;
  textColor: string;
}> = ({ error, textColor }) => {
  switch (error.code) {
    case 'SELF_EXCLUDED':
      return (
        <div className="mt-2 text-[10px]" aria-label="Self-exclusion details">
          <span className="text-ns-muted">Ends in:</span>{' '}
          <span className={textColor}>{formatTimeUntil(error.untilTs)}</span>
        </div>
      );

    case 'IN_COOLDOWN':
      return (
        <div className="mt-2 text-[10px]" aria-label="Cooldown details">
          <span className="text-ns-muted">Cooldown ends in:</span>{' '}
          <span className={textColor}>{formatTimeUntil(error.untilTs)}</span>
        </div>
      );

    case 'DAILY_WAGER_CAP_EXCEEDED':
    case 'WEEKLY_WAGER_CAP_EXCEEDED':
    case 'MONTHLY_WAGER_CAP_EXCEEDED': {
      const period = error.code === 'DAILY_WAGER_CAP_EXCEEDED' ? 'Daily' : error.code === 'WEEKLY_WAGER_CAP_EXCEEDED' ? 'Weekly' : 'Monthly';
      const percentage = Math.min(100, Math.round((error.current / error.cap) * 100));
      return (
        <div className="mt-2" aria-label={`${period} wager details`}>
          <div className="flex justify-between text-[10px]">
            <span className="text-ns-muted">{period} wagered:</span>
            <span className={textColor}>
              {formatLimitAmount(error.current)} / {formatLimitAmount(error.cap)}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ns-border/60">
            <div
              className={`h-full rounded-full ${percentage >= 100 ? 'bg-red-500' : 'bg-amber-500'}`}
              style={{ width: `${Math.min(100, percentage)}%` }}
              role="progressbar"
              aria-valuenow={percentage}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${percentage}% of ${period.toLowerCase()} limit used`}
            />
          </div>
        </div>
      );
    }

    case 'DAILY_LOSS_CAP_REACHED':
    case 'WEEKLY_LOSS_CAP_REACHED':
    case 'MONTHLY_LOSS_CAP_REACHED': {
      const period = error.code === 'DAILY_LOSS_CAP_REACHED' ? 'Daily' : error.code === 'WEEKLY_LOSS_CAP_REACHED' ? 'Weekly' : 'Monthly';
      return (
        <div className="mt-2 flex gap-4 text-[10px]" aria-label={`${period} loss details`}>
          <div>
            <span className="text-ns-muted">{period} loss:</span>{' '}
            <span className={textColor}>{formatLimitAmount(error.currentLoss)}</span>
          </div>
          <div>
            <span className="text-ns-muted">Limit:</span>{' '}
            <span className={textColor}>{formatLimitAmount(error.cap)}</span>
          </div>
        </div>
      );
    }

    default:
      return null;
  }
};

export const LimitErrorDisplay: React.FC<LimitErrorDisplayProps> = ({
  error,
  onRetry,
  onDismiss,
  className = '',
  compact = false,
}) => {
  const colors = getErrorColorScheme(error.code);
  const Icon = getErrorIcon(error.code);
  const isRetryable = error.retryable && isLimitErrorRetryable(error.code);

  // Determine the message to display
  const message = error.details ? getLimitErrorMessage(error.details) : error.message;

  return (
    <div
      className={`rounded-xl border ${colors.border} ${colors.bg} px-4 py-3 ${className}`}
      role="alert"
      aria-live="assertive"
      data-testid="limit-error-display"
    >
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${colors.icon}`} />
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-medium ${colors.text}`} data-testid="limit-error-message">
            {message}
          </p>

          {/* Render detailed info for limit errors if not compact */}
          {!compact && error.details && isExposureLimitError(error.code) && (
            <ExposureLimitDetails
              error={error.details as ExposureLimitError}
              textColor={colors.text}
            />
          )}

          {!compact && error.details && isResponsibleGamingError(error.code) && (
            <ResponsibleGamingDetails
              error={error.details as ResponsibleGamingError}
              textColor={colors.text}
            />
          )}

          {/* Action buttons */}
          {(isRetryable || onDismiss) && (
            <div className="mt-2 flex gap-2">
              {isRetryable && onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className={`rounded-lg ${colors.buttonBg} px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider ${colors.text} ${colors.buttonHover} transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-ns-surface`}
                  style={{ '--tw-ring-color': colors.text.replace('text-', 'rgb(var(--') + '/0.5)' } as React.CSSProperties}
                  data-testid="limit-error-retry"
                >
                  Retry
                </button>
              )}
              {onDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="rounded-lg bg-ns-border/60 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-ns-muted hover:bg-ns-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-primary/50 focus-visible:ring-offset-1 focus-visible:ring-offset-ns-surface"
                  data-testid="limit-error-dismiss"
                >
                  {isRetryable ? 'Cancel' : 'OK'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LimitErrorDisplay;
