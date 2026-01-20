import React from 'react';
import {
  type PlayerExposureState,
  type PlayerGamingLimitsState,
  type WarningLevel,
  formatLimitAmount,
  formatTimeUntil,
} from './limitTypes';

/**
 * ExposureWarningBanner - AC-7.5: Component for displaying proactive limit warnings
 *
 * This component displays warnings when a player is approaching their limits:
 * 1. Exposure warnings (approaching max pending bet exposure)
 * 2. Wager cap warnings (approaching daily/weekly/monthly caps)
 * 3. Loss cap warnings (approaching daily/weekly/monthly loss limits)
 * 4. Self-exclusion/cooldown status
 *
 * Features:
 * - Color-coded severity (yellow for low, amber for medium, red for high/critical)
 * - Progress bars showing percentage of limit used
 * - Collapsible to minimize screen space
 * - Accessibility: ARIA roles and progress bar semantics
 */

export interface ExposureWarningBannerProps {
  /** Player's current exposure state */
  exposure?: PlayerExposureState;
  /** Player's current gaming limits state */
  gamingLimits?: PlayerGamingLimitsState;
  /** Callback when banner is dismissed */
  onDismiss?: () => void;
  /** Optional additional CSS class */
  className?: string;
  /** Show only the most urgent warning */
  condensed?: boolean;
}

/**
 * Get color classes for a warning level
 */
function getWarningColors(level: WarningLevel): {
  border: string;
  bg: string;
  text: string;
  progress: string;
} {
  switch (level) {
    case 'critical':
      return {
        border: 'border-red-500/30',
        bg: 'bg-red-500/10',
        text: 'text-red-500',
        progress: 'bg-red-500',
      };
    case 'high':
      return {
        border: 'border-red-500/30',
        bg: 'bg-red-500/10',
        text: 'text-red-500',
        progress: 'bg-red-500',
      };
    case 'medium':
      return {
        border: 'border-amber-500/30',
        bg: 'bg-amber-500/10',
        text: 'text-amber-500',
        progress: 'bg-amber-500',
      };
    case 'low':
      return {
        border: 'border-yellow-500/30',
        bg: 'bg-yellow-500/10',
        text: 'text-yellow-500',
        progress: 'bg-yellow-500',
      };
    default:
      return {
        border: 'border-ns-border/60',
        bg: 'bg-ns-surface/50',
        text: 'text-ns-muted',
        progress: 'bg-ns-muted',
      };
  }
}

/**
 * Get the highest warning level from a list
 */
function getHighestWarningLevel(levels: WarningLevel[]): WarningLevel {
  const priority: Record<WarningLevel, number> = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };

  return levels.reduce((highest, current) =>
    priority[current] > priority[highest] ? current : highest
  , 'none' as WarningLevel);
}

/**
 * Progress bar component
 */
const ProgressBar: React.FC<{
  percentage: number;
  warningLevel: WarningLevel;
  label: string;
}> = ({ percentage, warningLevel, label }) => {
  const colors = getWarningColors(warningLevel);

  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ns-border/60">
      <div
        className={`h-full rounded-full transition-all duration-300 ${colors.progress}`}
        style={{ width: `${Math.min(100, percentage)}%` }}
        role="progressbar"
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      />
    </div>
  );
};

/**
 * Exposure warning section
 */
const ExposureWarning: React.FC<{
  exposure: PlayerExposureState;
}> = ({ exposure }) => {
  if (exposure.warningLevel === 'none') return null;

  const colors = getWarningColors(exposure.warningLevel);

  return (
    <div
      className={`rounded-lg ${colors.border} ${colors.bg} px-3 py-2`}
      role="status"
      aria-live="polite"
      data-testid="exposure-warning"
    >
      <div className="flex items-center justify-between text-[10px]">
        <span className={`font-medium ${colors.text}`}>Pending Exposure</span>
        <span className={colors.text}>
          {formatLimitAmount(exposure.currentExposure)} / {formatLimitAmount(exposure.maxExposure)}
        </span>
      </div>
      <ProgressBar
        percentage={exposure.exposurePercentage}
        warningLevel={exposure.warningLevel}
        label={`${Math.round(exposure.exposurePercentage)}% of exposure limit used`}
      />
      {exposure.warningLevel === 'critical' && (
        <p className={`mt-1 text-[10px] ${colors.text}`}>
          You've reached your exposure limit. Wait for bets to settle.
        </p>
      )}
    </div>
  );
};

/**
 * Wager cap warning section
 */
const WagerCapWarning: React.FC<{
  limits: PlayerGamingLimitsState;
  period: 'daily' | 'weekly' | 'monthly';
}> = ({ limits, period }) => {
  const data = limits[period];
  if (data.warningLevel === 'none') return null;

  const colors = getWarningColors(data.warningLevel);
  const periodLabel = period.charAt(0).toUpperCase() + period.slice(1);

  return (
    <div
      className={`rounded-lg ${colors.border} ${colors.bg} px-3 py-2`}
      role="status"
      aria-live="polite"
      data-testid={`${period}-wager-warning`}
    >
      <div className="flex items-center justify-between text-[10px]">
        <span className={`font-medium ${colors.text}`}>{periodLabel} Wager</span>
        <span className={colors.text}>
          {formatLimitAmount(data.wagered)} / {formatLimitAmount(data.cap)}
        </span>
      </div>
      <ProgressBar
        percentage={data.percentage}
        warningLevel={data.warningLevel}
        label={`${Math.round(data.percentage)}% of ${period} wager limit used`}
      />
      {data.warningLevel === 'critical' && (
        <p className={`mt-1 text-[10px] ${colors.text}`}>
          You've reached your {period} wager limit.
        </p>
      )}
    </div>
  );
};

/**
 * Loss cap warning section
 */
const LossCapWarning: React.FC<{
  limits: PlayerGamingLimitsState;
  period: 'daily' | 'weekly' | 'monthly';
}> = ({ limits, period }) => {
  const key = `${period}Loss` as 'dailyLoss' | 'weeklyLoss' | 'monthlyLoss';
  const data = limits[key];
  if (data.warningLevel === 'none') return null;

  const colors = getWarningColors(data.warningLevel);
  const periodLabel = period.charAt(0).toUpperCase() + period.slice(1);

  return (
    <div
      className={`rounded-lg ${colors.border} ${colors.bg} px-3 py-2`}
      role="status"
      aria-live="polite"
      data-testid={`${period}-loss-warning`}
    >
      <div className="flex items-center justify-between text-[10px]">
        <span className={`font-medium ${colors.text}`}>{periodLabel} Loss</span>
        <span className={colors.text}>
          {formatLimitAmount(data.currentLoss)} / {formatLimitAmount(data.cap)}
        </span>
      </div>
      <ProgressBar
        percentage={data.percentage}
        warningLevel={data.warningLevel}
        label={`${Math.round(data.percentage)}% of ${period} loss limit used`}
      />
      {data.warningLevel === 'critical' && (
        <p className={`mt-1 text-[10px] ${colors.text}`}>
          You've reached your {period} loss limit.
        </p>
      )}
    </div>
  );
};

/**
 * Self-exclusion/cooldown warning
 */
const ExclusionWarning: React.FC<{
  limits: PlayerGamingLimitsState;
}> = ({ limits }) => {
  if (!limits.selfExcluded && !limits.inCooldown) return null;

  const colors = getWarningColors('critical');

  if (limits.selfExcluded) {
    return (
      <div
        className={`rounded-lg ${colors.border} ${colors.bg} px-3 py-2`}
        role="alert"
        aria-live="assertive"
        data-testid="self-exclusion-warning"
      >
        <div className="flex items-center gap-2">
          <svg className={`h-4 w-4 ${colors.text}`} viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M4.5 4.5L11.5 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <div>
            <p className={`text-xs font-medium ${colors.text}`}>Account Self-Excluded</p>
            {limits.selfExclusionEndsAt && (
              <p className="text-[10px] text-ns-muted">
                Ends in {formatTimeUntil(limits.selfExclusionEndsAt)}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg ${colors.border} ${colors.bg} px-3 py-2`}
      role="alert"
      aria-live="assertive"
      data-testid="cooldown-warning"
    >
      <div className="flex items-center gap-2">
        <svg className={`h-4 w-4 ${colors.text}`} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 4.5V8L10.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div>
          <p className={`text-xs font-medium ${colors.text}`}>Cooldown Period Active</p>
          {limits.cooldownEndsAt && (
            <p className="text-[10px] text-ns-muted">
              Ends in {formatTimeUntil(limits.cooldownEndsAt)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Get a condensed summary of warnings
 */
function getCondensedSummary(
  exposure?: PlayerExposureState,
  gamingLimits?: PlayerGamingLimitsState
): { level: WarningLevel; message: string } | null {
  const warnings: { level: WarningLevel; message: string }[] = [];

  if (gamingLimits?.selfExcluded) {
    return { level: 'critical', message: 'Account self-excluded' };
  }

  if (gamingLimits?.inCooldown) {
    return { level: 'critical', message: 'Cooldown period active' };
  }

  if (exposure && exposure.warningLevel !== 'none') {
    warnings.push({
      level: exposure.warningLevel,
      message: `Exposure: ${Math.round(exposure.exposurePercentage)}%`,
    });
  }

  if (gamingLimits) {
    if (gamingLimits.daily.warningLevel !== 'none') {
      warnings.push({
        level: gamingLimits.daily.warningLevel,
        message: `Daily wager: ${Math.round(gamingLimits.daily.percentage)}%`,
      });
    }
    if (gamingLimits.dailyLoss.warningLevel !== 'none') {
      warnings.push({
        level: gamingLimits.dailyLoss.warningLevel,
        message: `Daily loss: ${Math.round(gamingLimits.dailyLoss.percentage)}%`,
      });
    }
  }

  if (warnings.length === 0) return null;

  const highestLevel = getHighestWarningLevel(warnings.map((w) => w.level));
  const criticalWarnings = warnings.filter(
    (w) => w.level === highestLevel
  );

  return {
    level: highestLevel,
    message: criticalWarnings.map((w) => w.message).join(' | '),
  };
}

export const ExposureWarningBanner: React.FC<ExposureWarningBannerProps> = ({
  exposure,
  gamingLimits,
  onDismiss,
  className = '',
  condensed = false,
}) => {
  // Check if there's anything to display
  const hasExposureWarning = exposure && exposure.warningLevel !== 'none';
  const hasGamingWarning =
    gamingLimits &&
    (gamingLimits.selfExcluded ||
      gamingLimits.inCooldown ||
      gamingLimits.daily.warningLevel !== 'none' ||
      gamingLimits.weekly.warningLevel !== 'none' ||
      gamingLimits.monthly.warningLevel !== 'none' ||
      gamingLimits.dailyLoss.warningLevel !== 'none' ||
      gamingLimits.weeklyLoss.warningLevel !== 'none' ||
      gamingLimits.monthlyLoss.warningLevel !== 'none');

  if (!hasExposureWarning && !hasGamingWarning) {
    return null;
  }

  // Condensed mode: single line summary
  if (condensed) {
    const summary = getCondensedSummary(exposure, gamingLimits);
    if (!summary) return null;

    const colors = getWarningColors(summary.level);

    return (
      <div
        className={`flex items-center justify-between rounded-lg ${colors.border} ${colors.bg} px-3 py-2 ${className}`}
        role="status"
        aria-live="polite"
        data-testid="exposure-warning-banner-condensed"
      >
        <div className="flex items-center gap-2">
          <svg className={`h-3 w-3 ${colors.text}`} viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 1L2 3.5V7.5C2 11.09 4.55 14.38 8 15C11.45 14.38 14 11.09 14 7.5V3.5L8 1Z" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 5V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="8" cy="11" r="0.5" fill="currentColor" />
          </svg>
          <span className={`text-[10px] font-medium ${colors.text}`}>{summary.message}</span>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded p-1 text-ns-muted hover:bg-ns-border/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-primary/50"
            aria-label="Dismiss warning"
            data-testid="exposure-warning-dismiss"
          >
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  // Full mode: all warnings displayed
  return (
    <div
      className={`rounded-xl border border-ns-border bg-ns-surface/50 p-3 ${className}`}
      role="region"
      aria-label="Betting limits status"
      data-testid="exposure-warning-banner"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-ns-muted" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 1L2 3.5V7.5C2 11.09 4.55 14.38 8 15C11.45 14.38 14 11.09 14 7.5V3.5L8 1Z" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span className="text-[10px] font-bold uppercase tracking-widest text-ns-muted">
            Limits
          </span>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded p-1 text-ns-muted hover:bg-ns-border/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-primary/50"
            aria-label="Dismiss warnings"
            data-testid="exposure-warning-dismiss"
          >
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      <div className="space-y-2">
        {/* Self-exclusion/cooldown (highest priority) */}
        {gamingLimits && <ExclusionWarning limits={gamingLimits} />}

        {/* Exposure warning */}
        {hasExposureWarning && exposure && <ExposureWarning exposure={exposure} />}

        {/* Wager cap warnings */}
        {gamingLimits && (
          <>
            <WagerCapWarning limits={gamingLimits} period="daily" />
            <WagerCapWarning limits={gamingLimits} period="weekly" />
            <WagerCapWarning limits={gamingLimits} period="monthly" />
          </>
        )}

        {/* Loss cap warnings */}
        {gamingLimits && (
          <>
            <LossCapWarning limits={gamingLimits} period="daily" />
            <LossCapWarning limits={gamingLimits} period="weekly" />
            <LossCapWarning limits={gamingLimits} period="monthly" />
          </>
        )}
      </div>
    </div>
  );
};

export default ExposureWarningBanner;
