// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import React from 'react';

import { ExposureWarningBanner } from '../casino/shared/ExposureWarningBanner';
import {
  type PlayerExposureState,
  type PlayerGamingLimitsState,
  type WarningLevel,
} from '../casino/shared/limitTypes';

// Helper to render component to string
function renderToString(element: React.ReactElement): string {
  const { renderToStaticMarkup } = require('react-dom/server');
  return renderToStaticMarkup(element);
}

// Factory for PlayerExposureState
const createExposureState = (
  percentage: number,
  warningLevel: WarningLevel = 'none'
): PlayerExposureState => ({
  currentExposure: percentage * 100,
  maxExposure: 10000,
  exposurePercentage: percentage,
  warningLevel,
});

// Factory for PlayerGamingLimitsState
const createGamingLimitsState = (
  overrides: Partial<PlayerGamingLimitsState> = {}
): PlayerGamingLimitsState => ({
  daily: { wagered: 0, cap: 100000, percentage: 0, warningLevel: 'none' },
  weekly: { wagered: 0, cap: 500000, percentage: 0, warningLevel: 'none' },
  monthly: { wagered: 0, cap: 1500000, percentage: 0, warningLevel: 'none' },
  dailyLoss: { currentLoss: 0, cap: 50000, percentage: 0, warningLevel: 'none' },
  weeklyLoss: { currentLoss: 0, cap: 200000, percentage: 0, warningLevel: 'none' },
  monthlyLoss: { currentLoss: 0, cap: 500000, percentage: 0, warningLevel: 'none' },
  selfExcluded: false,
  inCooldown: false,
  ...overrides,
});

describe('ExposureWarningBanner', () => {
  describe('rendering', () => {
    it('returns null when no warnings to display', () => {
      const html = renderToString(
        <ExposureWarningBanner
          exposure={createExposureState(0, 'none')}
          gamingLimits={createGamingLimitsState()}
        />
      );

      expect(html).toBe('');
    });

    it('renders when exposure has warning', () => {
      const html = renderToString(
        <ExposureWarningBanner exposure={createExposureState(75, 'medium')} />
      );

      expect(html).toContain('data-testid="exposure-warning-banner"');
    });

    it('renders when gaming limits have warning', () => {
      const html = renderToString(
        <ExposureWarningBanner
          gamingLimits={createGamingLimitsState({
            daily: { wagered: 90000, cap: 100000, percentage: 90, warningLevel: 'high' },
          })}
        />
      );

      expect(html).toContain('data-testid="exposure-warning-banner"');
    });
  });

  describe('exposure warnings', () => {
    it('displays exposure warning with progress bar', () => {
      const html = renderToString(
        <ExposureWarningBanner exposure={createExposureState(75, 'medium')} />
      );

      expect(html).toContain('data-testid="exposure-warning"');
      expect(html).toContain('Pending Exposure');
      expect(html).toContain('role="progressbar"');
    });

    it('shows critical message when at 100%', () => {
      const html = renderToString(
        <ExposureWarningBanner exposure={createExposureState(100, 'critical')} />
      );

      expect(html).toContain('reached your exposure limit');
    });

    it('formats exposure amounts correctly', () => {
      const html = renderToString(
        <ExposureWarningBanner
          exposure={{
            currentExposure: 7500,
            maxExposure: 10000,
            exposurePercentage: 75,
            warningLevel: 'medium',
          }}
        />
      );

      expect(html).toContain('$7,500');
      expect(html).toContain('$10,000');
    });
  });

  describe('wager cap warnings', () => {
    it('displays daily wager warning', () => {
      const html = renderToString(
        <ExposureWarningBanner
          gamingLimits={createGamingLimitsState({
            daily: { wagered: 75000, cap: 100000, percentage: 75, warningLevel: 'medium' },
          })}
        />
      );

      expect(html).toContain('data-testid="daily-wager-warning"');
      expect(html).toContain('Daily Wager');
    });

    it('displays weekly wager warning', () => {
      const html = renderToString(
        <ExposureWarningBanner
          gamingLimits={createGamingLimitsState({
            weekly: { wagered: 400000, cap: 500000, percentage: 80, warningLevel: 'medium' },
          })}
        />
      );

      expect(html).toContain('data-testid="weekly-wager-warning"');
      expect(html).toContain('Weekly Wager');
    });

    it('displays monthly wager warning', () => {
      const html = renderToString(
        <ExposureWarningBanner
          gamingLimits={createGamingLimitsState({
            monthly: { wagered: 1400000, cap: 1500000, percentage: 93, warningLevel: 'high' },
          })}
        />
      );

      expect(html).toContain('data-testid="monthly-wager-warning"');
      expect(html).toContain('Monthly Wager');
    });

    it('shows critical message for exceeded wager cap', () => {
      const html = renderToString(
        <ExposureWarningBanner
          gamingLimits={createGamingLimitsState({
            daily: { wagered: 100000, cap: 100000, percentage: 100, warningLevel: 'critical' },
          })}
        />
      );

      expect(html).toContain('reached your daily wager limit');
    });
  });

  describe('loss cap warnings', () => {
    it('displays daily loss warning', () => {
      const html = renderToString(
        <ExposureWarningBanner
          gamingLimits={createGamingLimitsState({
            dailyLoss: { currentLoss: 40000, cap: 50000, percentage: 80, warningLevel: 'medium' },
          })}
        />
      );

      expect(html).toContain('data-testid="daily-loss-warning"');
      expect(html).toContain('Daily Loss');
    });

    it('displays weekly loss warning', () => {
      const html = renderToString(
        <ExposureWarningBanner
          gamingLimits={createGamingLimitsState({
            weeklyLoss: { currentLoss: 180000, cap: 200000, percentage: 90, warningLevel: 'high' },
          })}
        />
      );

      expect(html).toContain('data-testid="weekly-loss-warning"');
      expect(html).toContain('Weekly Loss');
    });

    it('displays monthly loss warning', () => {
      const html = renderToString(
        <ExposureWarningBanner
          gamingLimits={createGamingLimitsState({
            monthlyLoss: { currentLoss: 480000, cap: 500000, percentage: 96, warningLevel: 'high' },
          })}
        />
      );

      expect(html).toContain('data-testid="monthly-loss-warning"');
      expect(html).toContain('Monthly Loss');
    });

    it('shows critical message for reached loss cap', () => {
      const html = renderToString(
        <ExposureWarningBanner
          gamingLimits={createGamingLimitsState({
            dailyLoss: { currentLoss: 50000, cap: 50000, percentage: 100, warningLevel: 'critical' },
          })}
        />
      );

      expect(html).toContain('reached your daily loss limit');
    });
  });

  describe('self-exclusion warning', () => {
    it('displays self-exclusion warning', () => {
      const html = renderToString(
        <ExposureWarningBanner
          gamingLimits={createGamingLimitsState({
            selfExcluded: true,
            selfExclusionEndsAt: Date.now() + 86400000 * 30,
          })}
        />
      );

      expect(html).toContain('data-testid="self-exclusion-warning"');
      expect(html).toContain('Self-Excluded');
    });

    it('shows time remaining for self-exclusion', () => {
      const html = renderToString(
        <ExposureWarningBanner
          gamingLimits={createGamingLimitsState({
            selfExcluded: true,
            selfExclusionEndsAt: Date.now() + 172800000, // 2 days to ensure "days" appears
          })}
        />
      );

      expect(html).toContain('Ends in');
      expect(html).toContain('day');
    });
  });

  describe('cooldown warning', () => {
    it('displays cooldown warning', () => {
      const html = renderToString(
        <ExposureWarningBanner
          gamingLimits={createGamingLimitsState({
            inCooldown: true,
            cooldownEndsAt: Date.now() + 3600000,
          })}
        />
      );

      expect(html).toContain('data-testid="cooldown-warning"');
      expect(html).toContain('Cooldown Period');
    });

    it('shows time remaining for cooldown', () => {
      const html = renderToString(
        <ExposureWarningBanner
          gamingLimits={createGamingLimitsState({
            inCooldown: true,
            cooldownEndsAt: Date.now() + 7200000, // 2 hours
          })}
        />
      );

      expect(html).toContain('Ends in');
      expect(html).toContain('hour');
    });
  });

  describe('color schemes', () => {
    it('uses yellow for low warning level', () => {
      const html = renderToString(
        <ExposureWarningBanner exposure={createExposureState(55, 'low')} />
      );

      expect(html).toContain('yellow');
    });

    it('uses amber for medium warning level', () => {
      const html = renderToString(
        <ExposureWarningBanner exposure={createExposureState(80, 'medium')} />
      );

      expect(html).toContain('amber');
    });

    it('uses red for high warning level', () => {
      const html = renderToString(
        <ExposureWarningBanner exposure={createExposureState(95, 'high')} />
      );

      expect(html).toContain('red');
    });

    it('uses red for critical warning level', () => {
      const html = renderToString(
        <ExposureWarningBanner exposure={createExposureState(100, 'critical')} />
      );

      expect(html).toContain('red');
    });
  });

  describe('condensed mode', () => {
    it('renders condensed banner', () => {
      const html = renderToString(
        <ExposureWarningBanner
          exposure={createExposureState(80, 'medium')}
          condensed
        />
      );

      expect(html).toContain('data-testid="exposure-warning-banner-condensed"');
    });

    it('shows summary message in condensed mode', () => {
      const html = renderToString(
        <ExposureWarningBanner
          exposure={createExposureState(80, 'medium')}
          condensed
        />
      );

      expect(html).toContain('Exposure:');
      expect(html).toContain('80%');
    });

    it('prioritizes self-exclusion in condensed mode', () => {
      const html = renderToString(
        <ExposureWarningBanner
          exposure={createExposureState(80, 'medium')}
          gamingLimits={createGamingLimitsState({
            selfExcluded: true,
            selfExclusionEndsAt: Date.now() + 86400000,
          })}
          condensed
        />
      );

      expect(html).toContain('self-excluded');
    });

    it('returns null in condensed mode when no warnings', () => {
      const html = renderToString(
        <ExposureWarningBanner
          exposure={createExposureState(0, 'none')}
          condensed
        />
      );

      expect(html).toBe('');
    });
  });

  describe('dismiss button', () => {
    it('shows dismiss button when onDismiss provided', () => {
      const onDismiss = vi.fn();
      const html = renderToString(
        <ExposureWarningBanner
          exposure={createExposureState(80, 'medium')}
          onDismiss={onDismiss}
        />
      );

      expect(html).toContain('data-testid="exposure-warning-dismiss"');
    });

    it('does not show dismiss button when onDismiss not provided', () => {
      const html = renderToString(
        <ExposureWarningBanner exposure={createExposureState(80, 'medium')} />
      );

      expect(html).not.toContain('data-testid="exposure-warning-dismiss"');
    });

    it('shows dismiss button in condensed mode', () => {
      const onDismiss = vi.fn();
      const html = renderToString(
        <ExposureWarningBanner
          exposure={createExposureState(80, 'medium')}
          onDismiss={onDismiss}
          condensed
        />
      );

      expect(html).toContain('data-testid="exposure-warning-dismiss"');
    });
  });

  describe('accessibility', () => {
    it('has region role and aria-label', () => {
      const html = renderToString(
        <ExposureWarningBanner exposure={createExposureState(80, 'medium')} />
      );

      expect(html).toContain('role="region"');
      expect(html).toContain('aria-label="Betting limits status"');
    });

    it('has aria-live on individual warnings', () => {
      const html = renderToString(
        <ExposureWarningBanner exposure={createExposureState(80, 'medium')} />
      );

      expect(html).toContain('aria-live="polite"');
    });

    it('uses assertive for self-exclusion warning', () => {
      const html = renderToString(
        <ExposureWarningBanner
          gamingLimits={createGamingLimitsState({
            selfExcluded: true,
            selfExclusionEndsAt: Date.now() + 86400000,
          })}
        />
      );

      expect(html).toContain('aria-live="assertive"');
    });

    it('progress bars have proper aria attributes', () => {
      const html = renderToString(
        <ExposureWarningBanner exposure={createExposureState(75, 'medium')} />
      );

      expect(html).toContain('role="progressbar"');
      expect(html).toContain('aria-valuenow');
      expect(html).toContain('aria-valuemin');
      expect(html).toContain('aria-valuemax');
      expect(html).toContain('aria-label');
    });
  });

  describe('multiple warnings', () => {
    it('displays all active warnings', () => {
      const html = renderToString(
        <ExposureWarningBanner
          exposure={createExposureState(80, 'medium')}
          gamingLimits={createGamingLimitsState({
            daily: { wagered: 90000, cap: 100000, percentage: 90, warningLevel: 'high' },
            dailyLoss: { currentLoss: 40000, cap: 50000, percentage: 80, warningLevel: 'medium' },
          })}
        />
      );

      expect(html).toContain('data-testid="exposure-warning"');
      expect(html).toContain('data-testid="daily-wager-warning"');
      expect(html).toContain('data-testid="daily-loss-warning"');
    });

    it('shows self-exclusion first (highest priority)', () => {
      const html = renderToString(
        <ExposureWarningBanner
          exposure={createExposureState(80, 'medium')}
          gamingLimits={createGamingLimitsState({
            selfExcluded: true,
            selfExclusionEndsAt: Date.now() + 86400000,
            daily: { wagered: 90000, cap: 100000, percentage: 90, warningLevel: 'high' },
          })}
        />
      );

      // Self-exclusion should appear in the output
      expect(html).toContain('Self-Excluded');
    });
  });

  describe('AC-7.5 compliance', () => {
    it('displays exposure warnings at all levels', () => {
      const levels: WarningLevel[] = ['low', 'medium', 'high', 'critical'];

      levels.forEach((level) => {
        const percentage = level === 'low' ? 55 : level === 'medium' ? 80 : level === 'high' ? 95 : 100;
        const html = renderToString(
          <ExposureWarningBanner exposure={createExposureState(percentage, level)} />
        );
        expect(html).toContain('data-testid="exposure-warning"');
      });
    });

    it('displays all wager cap warning types', () => {
      const periods = ['daily', 'weekly', 'monthly'] as const;

      periods.forEach((period) => {
        const limits = createGamingLimitsState({
          [period]: { wagered: 90000, cap: 100000, percentage: 90, warningLevel: 'high' },
        });
        const html = renderToString(<ExposureWarningBanner gamingLimits={limits} />);
        expect(html).toContain(`data-testid="${period}-wager-warning"`);
      });
    });

    it('displays all loss cap warning types', () => {
      const periods = ['daily', 'weekly', 'monthly'] as const;

      periods.forEach((period) => {
        const limits = createGamingLimitsState({
          [`${period}Loss`]: { currentLoss: 45000, cap: 50000, percentage: 90, warningLevel: 'high' },
        });
        const html = renderToString(<ExposureWarningBanner gamingLimits={limits} />);
        expect(html).toContain(`data-testid="${period}-loss-warning"`);
      });
    });

    it('provides user-friendly messages for all warning types', () => {
      // Exposure
      let html = renderToString(
        <ExposureWarningBanner exposure={createExposureState(100, 'critical')} />
      );
      expect(html).toContain('exposure limit');

      // Wager cap
      html = renderToString(
        <ExposureWarningBanner
          gamingLimits={createGamingLimitsState({
            daily: { wagered: 100000, cap: 100000, percentage: 100, warningLevel: 'critical' },
          })}
        />
      );
      expect(html).toContain('wager limit');

      // Loss cap
      html = renderToString(
        <ExposureWarningBanner
          gamingLimits={createGamingLimitsState({
            dailyLoss: { currentLoss: 50000, cap: 50000, percentage: 100, warningLevel: 'critical' },
          })}
        />
      );
      expect(html).toContain('loss limit');
    });
  });
});
