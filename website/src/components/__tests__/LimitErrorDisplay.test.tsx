// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';

import { LimitErrorDisplay } from '../casino/shared/LimitErrorDisplay';
import {
  type ExtendedBetValidationError,
  type SingleBetExceededError,
  type PlayerExposureExceededError,
  type HouseExposureExceededError,
  type DailyWagerCapExceededError,
  type DailyLossCapReachedError,
  type SelfExcludedError,
  type InCooldownError,
  isExposureLimitError,
  isResponsibleGamingError,
  isLimitErrorRetryable,
  formatLimitAmount,
  formatTimeUntil,
  getLimitErrorMessage,
  calculateWarningLevel,
} from '../casino/shared/limitTypes';

// Helper to render component to string
function renderToString(element: React.ReactElement): string {
  const { renderToStaticMarkup } = require('react-dom/server');
  return renderToStaticMarkup(element);
}

describe('limitTypes helpers', () => {
  describe('isExposureLimitError', () => {
    it('returns true for SINGLE_BET_EXCEEDED', () => {
      expect(isExposureLimitError('SINGLE_BET_EXCEEDED')).toBe(true);
    });

    it('returns true for PLAYER_EXPOSURE_EXCEEDED', () => {
      expect(isExposureLimitError('PLAYER_EXPOSURE_EXCEEDED')).toBe(true);
    });

    it('returns true for HOUSE_EXPOSURE_EXCEEDED', () => {
      expect(isExposureLimitError('HOUSE_EXPOSURE_EXCEEDED')).toBe(true);
    });

    it('returns false for non-exposure errors', () => {
      expect(isExposureLimitError('INSUFFICIENT_FUNDS')).toBe(false);
      expect(isExposureLimitError('DAILY_WAGER_CAP_EXCEEDED')).toBe(false);
      expect(isExposureLimitError('SELF_EXCLUDED')).toBe(false);
    });
  });

  describe('isResponsibleGamingError', () => {
    it('returns true for SELF_EXCLUDED', () => {
      expect(isResponsibleGamingError('SELF_EXCLUDED')).toBe(true);
    });

    it('returns true for IN_COOLDOWN', () => {
      expect(isResponsibleGamingError('IN_COOLDOWN')).toBe(true);
    });

    it('returns true for wager cap errors', () => {
      expect(isResponsibleGamingError('DAILY_WAGER_CAP_EXCEEDED')).toBe(true);
      expect(isResponsibleGamingError('WEEKLY_WAGER_CAP_EXCEEDED')).toBe(true);
      expect(isResponsibleGamingError('MONTHLY_WAGER_CAP_EXCEEDED')).toBe(true);
    });

    it('returns true for loss cap errors', () => {
      expect(isResponsibleGamingError('DAILY_LOSS_CAP_REACHED')).toBe(true);
      expect(isResponsibleGamingError('WEEKLY_LOSS_CAP_REACHED')).toBe(true);
      expect(isResponsibleGamingError('MONTHLY_LOSS_CAP_REACHED')).toBe(true);
    });

    it('returns false for non-gaming errors', () => {
      expect(isResponsibleGamingError('INSUFFICIENT_FUNDS')).toBe(false);
      expect(isResponsibleGamingError('SINGLE_BET_EXCEEDED')).toBe(false);
    });
  });

  describe('isLimitErrorRetryable', () => {
    it('returns false for exposure limit errors', () => {
      expect(isLimitErrorRetryable('SINGLE_BET_EXCEEDED')).toBe(false);
      expect(isLimitErrorRetryable('PLAYER_EXPOSURE_EXCEEDED')).toBe(false);
      expect(isLimitErrorRetryable('HOUSE_EXPOSURE_EXCEEDED')).toBe(false);
    });

    it('returns false for responsible gaming errors', () => {
      expect(isLimitErrorRetryable('SELF_EXCLUDED')).toBe(false);
      expect(isLimitErrorRetryable('DAILY_WAGER_CAP_EXCEEDED')).toBe(false);
      expect(isLimitErrorRetryable('DAILY_LOSS_CAP_REACHED')).toBe(false);
    });

    it('returns false for insufficient funds and invalid amount', () => {
      expect(isLimitErrorRetryable('INSUFFICIENT_FUNDS')).toBe(false);
      expect(isLimitErrorRetryable('INVALID_AMOUNT')).toBe(false);
    });

    it('returns true for connection errors', () => {
      expect(isLimitErrorRetryable('CONNECTION_ERROR')).toBe(true);
    });

    it('returns true for submission failures', () => {
      expect(isLimitErrorRetryable('SUBMISSION_FAILED')).toBe(true);
    });
  });

  describe('formatLimitAmount', () => {
    it('formats positive amounts with dollar sign', () => {
      expect(formatLimitAmount(1000)).toBe('$1,000');
      expect(formatLimitAmount(1000000)).toBe('$1,000,000');
    });

    it('handles zero', () => {
      expect(formatLimitAmount(0)).toBe('$0');
    });

    it('handles decimals (floors them)', () => {
      expect(formatLimitAmount(1000.99)).toBe('$1,000');
    });

    it('handles negative numbers', () => {
      expect(formatLimitAmount(-100)).toBe('$0');
    });

    it('handles non-finite values', () => {
      expect(formatLimitAmount(Infinity)).toBe('$0');
      expect(formatLimitAmount(NaN)).toBe('$0');
    });
  });

  describe('formatTimeUntil', () => {
    it('returns "now" for past timestamps', () => {
      expect(formatTimeUntil(Date.now() - 1000)).toBe('now');
    });

    it('formats days correctly', () => {
      expect(formatTimeUntil(Date.now() + 86400000)).toBe('1 day');
      expect(formatTimeUntil(Date.now() + 172800000)).toBe('2 days');
    });

    it('formats hours correctly', () => {
      expect(formatTimeUntil(Date.now() + 3600000)).toBe('1 hour');
      expect(formatTimeUntil(Date.now() + 7200000)).toBe('2 hours');
    });

    it('formats minutes correctly', () => {
      expect(formatTimeUntil(Date.now() + 60000)).toBe('1 minute');
      expect(formatTimeUntil(Date.now() + 120000)).toBe('2 minutes');
    });

    it('formats seconds correctly', () => {
      expect(formatTimeUntil(Date.now() + 1000)).toBe('1 second');
      expect(formatTimeUntil(Date.now() + 30000)).toBe('30 seconds');
    });
  });

  describe('calculateWarningLevel', () => {
    it('returns none for percentage below 50', () => {
      expect(calculateWarningLevel(0)).toBe('none');
      expect(calculateWarningLevel(49)).toBe('none');
    });

    it('returns low for percentage 50-74', () => {
      expect(calculateWarningLevel(50)).toBe('low');
      expect(calculateWarningLevel(74)).toBe('low');
    });

    it('returns medium for percentage 75-89', () => {
      expect(calculateWarningLevel(75)).toBe('medium');
      expect(calculateWarningLevel(89)).toBe('medium');
    });

    it('returns high for percentage 90-99', () => {
      expect(calculateWarningLevel(90)).toBe('high');
      expect(calculateWarningLevel(99)).toBe('high');
    });

    it('returns critical for percentage 100+', () => {
      expect(calculateWarningLevel(100)).toBe('critical');
      expect(calculateWarningLevel(150)).toBe('critical');
    });
  });

  describe('getLimitErrorMessage', () => {
    it('generates message for single bet exceeded', () => {
      const error: SingleBetExceededError = {
        code: 'SINGLE_BET_EXCEEDED',
        betAmount: 5000,
        maxAllowed: 1000,
      };
      const msg = getLimitErrorMessage(error);
      expect(msg).toContain('$5,000');
      expect(msg).toContain('$1,000');
      expect(msg).toContain('exceeds');
    });

    it('generates message for player exposure exceeded', () => {
      const error: PlayerExposureExceededError = {
        code: 'PLAYER_EXPOSURE_EXCEEDED',
        currentExposure: 8000,
        newExposure: 12000,
        maxAllowed: 10000,
      };
      const msg = getLimitErrorMessage(error);
      expect(msg).toContain('$12,000');
      expect(msg).toContain('$10,000');
    });

    it('generates message for house exposure exceeded', () => {
      const error: HouseExposureExceededError = {
        code: 'HOUSE_EXPOSURE_EXCEEDED',
        currentExposure: 900000,
        newExposure: 1100000,
        maxAllowed: 1000000,
      };
      const msg = getLimitErrorMessage(error);
      expect(msg).toContain('house');
      expect(msg).toContain('exposure');
    });

    it('generates message for daily wager cap exceeded', () => {
      const error: DailyWagerCapExceededError = {
        code: 'DAILY_WAGER_CAP_EXCEEDED',
        current: 90000,
        cap: 100000,
        betAmount: 15000,
      };
      const msg = getLimitErrorMessage(error);
      expect(msg).toContain('daily wager');
      expect(msg).toContain('$90,000');
      expect(msg).toContain('$100,000');
    });

    it('generates message for daily loss cap reached', () => {
      const error: DailyLossCapReachedError = {
        code: 'DAILY_LOSS_CAP_REACHED',
        currentLoss: 50000,
        cap: 50000,
      };
      const msg = getLimitErrorMessage(error);
      expect(msg).toContain('daily loss');
      expect(msg).toContain('$50,000');
    });

    it('generates message for self-excluded', () => {
      const error: SelfExcludedError = {
        code: 'SELF_EXCLUDED',
        untilTs: Date.now() + 86400000 * 30,
      };
      const msg = getLimitErrorMessage(error);
      expect(msg).toContain('self-excluded');
    });
  });
});

describe('LimitErrorDisplay', () => {
  const createError = (
    code: ExtendedBetValidationError['code'],
    details?: ExtendedBetValidationError['details']
  ): ExtendedBetValidationError => ({
    code,
    message: `Error: ${code}`,
    retryable: isLimitErrorRetryable(code),
    details,
  });

  describe('rendering', () => {
    it('renders the error message', () => {
      const error = createError('INSUFFICIENT_FUNDS');
      const html = renderToString(<LimitErrorDisplay error={error} />);

      expect(html).toContain('Error: INSUFFICIENT_FUNDS');
      expect(html).toContain('role="alert"');
      expect(html).toContain('aria-live="assertive"');
    });

    it('renders with data-testid', () => {
      const error = createError('INSUFFICIENT_FUNDS');
      const html = renderToString(<LimitErrorDisplay error={error} />);

      expect(html).toContain('data-testid="limit-error-display"');
    });

    it('renders the detailed message for limit errors', () => {
      const error = createError('SINGLE_BET_EXCEEDED', {
        code: 'SINGLE_BET_EXCEEDED',
        betAmount: 5000,
        maxAllowed: 1000,
      });
      const html = renderToString(<LimitErrorDisplay error={error} />);

      expect(html).toContain('$5,000');
      expect(html).toContain('$1,000');
    });
  });

  describe('exposure limit errors', () => {
    it('displays single bet exceeded with details', () => {
      const error = createError('SINGLE_BET_EXCEEDED', {
        code: 'SINGLE_BET_EXCEEDED',
        betAmount: 5000,
        maxAllowed: 1000,
      });
      const html = renderToString(<LimitErrorDisplay error={error} />);

      expect(html).toContain('Your bet:');
      expect(html).toContain('Max allowed:');
      expect(html).toContain('$5,000');
      expect(html).toContain('$1,000');
    });

    it('displays player exposure exceeded with details', () => {
      const error = createError('PLAYER_EXPOSURE_EXCEEDED', {
        code: 'PLAYER_EXPOSURE_EXCEEDED',
        currentExposure: 8000,
        newExposure: 12000,
        maxAllowed: 10000,
      });
      const html = renderToString(<LimitErrorDisplay error={error} />);

      expect(html).toContain('Current:');
      expect(html).toContain('New total:');
      expect(html).toContain('Limit:');
    });

    it('displays house exposure exceeded message', () => {
      const error = createError('HOUSE_EXPOSURE_EXCEEDED', {
        code: 'HOUSE_EXPOSURE_EXCEEDED',
        currentExposure: 900000,
        newExposure: 1100000,
        maxAllowed: 1000000,
      });
      const html = renderToString(<LimitErrorDisplay error={error} />);

      expect(html).toContain('house');
    });
  });

  describe('responsible gaming errors', () => {
    it('displays wager cap exceeded with progress bar', () => {
      const error = createError('DAILY_WAGER_CAP_EXCEEDED', {
        code: 'DAILY_WAGER_CAP_EXCEEDED',
        current: 90000,
        cap: 100000,
        betAmount: 15000,
      });
      const html = renderToString(<LimitErrorDisplay error={error} />);

      expect(html).toContain('Daily wagered:');
      expect(html).toContain('role="progressbar"');
    });

    it('displays self-excluded with time remaining', () => {
      const error = createError('SELF_EXCLUDED', {
        code: 'SELF_EXCLUDED',
        untilTs: Date.now() + 172800000, // 2 days to ensure "days" appears
      });
      const html = renderToString(<LimitErrorDisplay error={error} />);

      expect(html).toContain('Ends in:');
      expect(html).toContain('day');
    });

    it('displays cooldown with time remaining', () => {
      const error = createError('IN_COOLDOWN', {
        code: 'IN_COOLDOWN',
        untilTs: Date.now() + 7200000, // 2 hours to ensure "hours" appears
      });
      const html = renderToString(<LimitErrorDisplay error={error} />);

      expect(html).toContain('Cooldown ends in:');
      expect(html).toContain('hour');
    });
  });

  describe('color schemes', () => {
    it('uses amber colors for exposure limit errors', () => {
      const error = createError('SINGLE_BET_EXCEEDED', {
        code: 'SINGLE_BET_EXCEEDED',
        betAmount: 5000,
        maxAllowed: 1000,
      });
      const html = renderToString(<LimitErrorDisplay error={error} />);

      expect(html).toContain('amber');
    });

    it('uses red colors for self-exclusion', () => {
      const error = createError('SELF_EXCLUDED', {
        code: 'SELF_EXCLUDED',
        untilTs: Date.now() + 86400000,
      });
      const html = renderToString(<LimitErrorDisplay error={error} />);

      expect(html).toContain('red');
    });

    it('uses red colors for loss cap reached', () => {
      const error = createError('DAILY_LOSS_CAP_REACHED', {
        code: 'DAILY_LOSS_CAP_REACHED',
        currentLoss: 50000,
        cap: 50000,
      });
      const html = renderToString(<LimitErrorDisplay error={error} />);

      expect(html).toContain('red');
    });
  });

  describe('action buttons', () => {
    it('shows retry button for retryable errors', () => {
      const error = createError('CONNECTION_ERROR');
      const onRetry = vi.fn();
      const html = renderToString(<LimitErrorDisplay error={error} onRetry={onRetry} />);

      expect(html).toContain('Retry');
      expect(html).toContain('data-testid="limit-error-retry"');
    });

    it('does not show retry button for non-retryable errors', () => {
      const error = createError('SINGLE_BET_EXCEEDED', {
        code: 'SINGLE_BET_EXCEEDED',
        betAmount: 5000,
        maxAllowed: 1000,
      });
      const onRetry = vi.fn();
      const html = renderToString(<LimitErrorDisplay error={error} onRetry={onRetry} />);

      expect(html).not.toContain('Retry');
    });

    it('shows dismiss button when onDismiss provided', () => {
      const error = createError('SINGLE_BET_EXCEEDED', {
        code: 'SINGLE_BET_EXCEEDED',
        betAmount: 5000,
        maxAllowed: 1000,
      });
      const onDismiss = vi.fn();
      const html = renderToString(<LimitErrorDisplay error={error} onDismiss={onDismiss} />);

      expect(html).toContain('data-testid="limit-error-dismiss"');
      expect(html).toContain('OK'); // Non-retryable shows "OK" instead of "Cancel"
    });

    it('shows Cancel for retryable errors', () => {
      const error = createError('CONNECTION_ERROR');
      const onDismiss = vi.fn();
      const html = renderToString(<LimitErrorDisplay error={error} onDismiss={onDismiss} />);

      expect(html).toContain('Cancel');
    });
  });

  describe('compact mode', () => {
    it('hides detailed info in compact mode', () => {
      const error = createError('SINGLE_BET_EXCEEDED', {
        code: 'SINGLE_BET_EXCEEDED',
        betAmount: 5000,
        maxAllowed: 1000,
      });
      const html = renderToString(<LimitErrorDisplay error={error} compact />);

      expect(html).not.toContain('Your bet:');
      expect(html).not.toContain('Max allowed:');
    });
  });

  describe('accessibility', () => {
    it('has role="alert"', () => {
      const error = createError('INSUFFICIENT_FUNDS');
      const html = renderToString(<LimitErrorDisplay error={error} />);

      expect(html).toContain('role="alert"');
    });

    it('has aria-live="assertive"', () => {
      const error = createError('INSUFFICIENT_FUNDS');
      const html = renderToString(<LimitErrorDisplay error={error} />);

      expect(html).toContain('aria-live="assertive"');
    });

    it('has aria-label on progress bar', () => {
      const error = createError('DAILY_WAGER_CAP_EXCEEDED', {
        code: 'DAILY_WAGER_CAP_EXCEEDED',
        current: 90000,
        cap: 100000,
        betAmount: 15000,
      });
      const html = renderToString(<LimitErrorDisplay error={error} />);

      expect(html).toContain('aria-label');
      expect(html).toContain('limit used');
    });
  });

  describe('AC-7.5 compliance', () => {
    it('displays all exposure limit error types', () => {
      const errors = [
        { code: 'SINGLE_BET_EXCEEDED' as const, betAmount: 5000, maxAllowed: 1000 },
        { code: 'PLAYER_EXPOSURE_EXCEEDED' as const, currentExposure: 8000, newExposure: 12000, maxAllowed: 10000 },
        { code: 'HOUSE_EXPOSURE_EXCEEDED' as const, currentExposure: 900000, newExposure: 1100000, maxAllowed: 1000000 },
      ];

      errors.forEach((details) => {
        const error = createError(details.code, details);
        const html = renderToString(<LimitErrorDisplay error={error} />);
        expect(html).toContain('data-testid="limit-error-display"');
      });
    });

    it('displays all responsible gaming error types', () => {
      const errors = [
        { code: 'SELF_EXCLUDED' as const, untilTs: Date.now() + 86400000 },
        { code: 'IN_COOLDOWN' as const, untilTs: Date.now() + 3600000 },
        { code: 'DAILY_WAGER_CAP_EXCEEDED' as const, current: 90000, cap: 100000, betAmount: 15000 },
        { code: 'WEEKLY_WAGER_CAP_EXCEEDED' as const, current: 450000, cap: 500000, betAmount: 75000 },
        { code: 'MONTHLY_WAGER_CAP_EXCEEDED' as const, current: 1400000, cap: 1500000, betAmount: 200000 },
        { code: 'DAILY_LOSS_CAP_REACHED' as const, currentLoss: 50000, cap: 50000 },
        { code: 'WEEKLY_LOSS_CAP_REACHED' as const, currentLoss: 200000, cap: 200000 },
        { code: 'MONTHLY_LOSS_CAP_REACHED' as const, currentLoss: 500000, cap: 500000 },
      ];

      errors.forEach((details) => {
        const error = createError(details.code, details);
        const html = renderToString(<LimitErrorDisplay error={error} />);
        expect(html).toContain('data-testid="limit-error-display"');
      });
    });
  });
});
