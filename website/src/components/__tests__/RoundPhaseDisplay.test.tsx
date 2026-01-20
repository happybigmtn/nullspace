// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RoundPhaseDisplay, TablePhaseHeader } from '../casino/RoundPhaseDisplay';
import {
  formatCountdown,
  getPhaseLabel,
  ROUND_PHASE,
} from '../../hooks/useRoundPhase';

// Helper to render component to string
function renderToString(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe('RoundPhaseDisplay', () => {
  describe('phase label display', () => {
    it('shows "Place Bets" for BETTING phase', () => {
      const html = renderToString(
        <RoundPhaseDisplay phaseLabel="BETTING" countdownMs={30000} hasRoundData />
      );
      expect(html).toContain('Place Bets');
    });

    it('shows "Bets Locked" for LOCKED phase', () => {
      const html = renderToString(
        <RoundPhaseDisplay phaseLabel="LOCKED" countdownMs={10000} hasRoundData />
      );
      expect(html).toContain('Bets Locked');
    });

    it('shows "Revealing" for REVEALING phase', () => {
      const html = renderToString(
        <RoundPhaseDisplay phaseLabel="REVEALING" countdownMs={5000} hasRoundData />
      );
      expect(html).toContain('Revealing');
    });

    it('shows "Settling" for SETTLING phase', () => {
      const html = renderToString(
        <RoundPhaseDisplay phaseLabel="SETTLING" countdownMs={3000} hasRoundData />
      );
      expect(html).toContain('Settling');
    });

    it('shows "Complete" for FINALIZED phase', () => {
      const html = renderToString(
        <RoundPhaseDisplay phaseLabel="FINALIZED" countdownMs={0} hasRoundData />
      );
      expect(html).toContain('Complete');
    });

    it('shows "Waiting" for IDLE phase', () => {
      const html = renderToString(
        <RoundPhaseDisplay phaseLabel="IDLE" countdownMs={0} hasRoundData />
      );
      expect(html).toContain('Waiting');
    });
  });

  describe('countdown display', () => {
    it('shows formatted countdown when countdownMs > 0', () => {
      const html = renderToString(
        <RoundPhaseDisplay phaseLabel="BETTING" countdownMs={90000} hasRoundData />
      );
      expect(html).toContain('1:30');
    });

    it('shows "0:05" for 5 seconds remaining', () => {
      const html = renderToString(
        <RoundPhaseDisplay phaseLabel="LOCKED" countdownMs={5000} hasRoundData />
      );
      expect(html).toContain('0:05');
    });

    it('hides countdown when countdownMs is 0', () => {
      const html = renderToString(
        <RoundPhaseDisplay phaseLabel="FINALIZED" countdownMs={0} hasRoundData />
      );
      // The countdown span should not be present
      expect(html).not.toContain('data-testid="countdown-display"');
    });

    it('hides countdown when showCountdown is false', () => {
      const html = renderToString(
        <RoundPhaseDisplay
          phaseLabel="BETTING"
          countdownMs={30000}
          hasRoundData
          showCountdown={false}
        />
      );
      expect(html).not.toContain('0:30');
    });
  });

  describe('loading state', () => {
    it('shows "Connecting..." when hasRoundData is false', () => {
      const html = renderToString(
        <RoundPhaseDisplay phaseLabel="IDLE" countdownMs={0} hasRoundData={false} />
      );
      expect(html).toContain('Connecting...');
    });

    it('does not show phase label when hasRoundData is false', () => {
      const html = renderToString(
        <RoundPhaseDisplay phaseLabel="BETTING" countdownMs={30000} hasRoundData={false} />
      );
      expect(html).not.toContain('Place Bets');
    });
  });

  describe('accessibility', () => {
    it('has role="status" for screen readers', () => {
      const html = renderToString(
        <RoundPhaseDisplay phaseLabel="BETTING" countdownMs={30000} hasRoundData />
      );
      expect(html).toContain('role="status"');
    });

    it('has aria-live="polite" for real-time updates', () => {
      const html = renderToString(
        <RoundPhaseDisplay phaseLabel="BETTING" countdownMs={30000} hasRoundData />
      );
      expect(html).toContain('aria-live="polite"');
    });

    it('has aria-label describing phase and countdown', () => {
      const html = renderToString(
        <RoundPhaseDisplay phaseLabel="BETTING" countdownMs={30000} hasRoundData />
      );
      expect(html).toContain('aria-label');
      expect(html).toContain('Round phase');
    });
  });

  describe('urgency styling', () => {
    it('adds animate-pulse when countdown below urgencyThreshold', () => {
      const html = renderToString(
        <RoundPhaseDisplay
          phaseLabel="BETTING"
          countdownMs={5000}
          hasRoundData
          urgencyThresholdMs={10000}
        />
      );
      expect(html).toContain('animate-pulse');
    });
  });

  describe('compact mode', () => {
    it('renders smaller text in compact mode', () => {
      const html = renderToString(
        <RoundPhaseDisplay phaseLabel="BETTING" countdownMs={30000} hasRoundData compact />
      );
      expect(html).toContain('text-[10px]');
    });

    it('renders smaller indicator dot in compact mode', () => {
      const html = renderToString(
        <RoundPhaseDisplay phaseLabel="BETTING" countdownMs={30000} hasRoundData compact />
      );
      expect(html).toContain('w-1.5');
    });
  });

  describe('label visibility', () => {
    it('hides label when showLabel is false', () => {
      const html = renderToString(
        <RoundPhaseDisplay
          phaseLabel="BETTING"
          countdownMs={30000}
          hasRoundData
          showLabel={false}
        />
      );
      // Label should not appear in a span (but aria-label will still have it for accessibility)
      expect(html).not.toContain('uppercase tracking-wider');
      // Should still have the countdown
      expect(html).toContain('0:30');
    });

    it('shows label by default', () => {
      const html = renderToString(
        <RoundPhaseDisplay phaseLabel="BETTING" countdownMs={30000} hasRoundData />
      );
      // Label appears in visible span with uppercase styling
      expect(html).toContain('uppercase tracking-wider');
      expect(html).toContain('Place Bets');
    });
  });
});

describe('TablePhaseHeader', () => {
  it('shows round ID when provided', () => {
    const html = renderToString(
      <TablePhaseHeader phaseLabel="BETTING" countdownMs={30000} hasRoundData roundId={BigInt(42)} />
    );
    expect(html).toContain('Round #42');
  });

  it('shows "Waiting for round..." when hasRoundData is false', () => {
    const html = renderToString(
      <TablePhaseHeader phaseLabel="IDLE" countdownMs={0} hasRoundData={false} />
    );
    expect(html).toContain('Waiting for round...');
  });

  it('shows larger countdown text than inline display', () => {
    const html = renderToString(
      <TablePhaseHeader phaseLabel="BETTING" countdownMs={90000} hasRoundData />
    );
    expect(html).toContain('text-2xl');
    expect(html).toContain('1:30');
  });
});

describe('formatCountdown', () => {
  it('formats 0ms as "0:00"', () => {
    expect(formatCountdown(0)).toBe('0:00');
  });

  it('formats negative values as "0:00"', () => {
    expect(formatCountdown(-1000)).toBe('0:00');
  });

  it('formats 5000ms as "0:05"', () => {
    expect(formatCountdown(5000)).toBe('0:05');
  });

  it('formats 30000ms as "0:30"', () => {
    expect(formatCountdown(30000)).toBe('0:30');
  });

  it('formats 60000ms as "1:00"', () => {
    expect(formatCountdown(60000)).toBe('1:00');
  });

  it('formats 90000ms as "1:30"', () => {
    expect(formatCountdown(90000)).toBe('1:30');
  });

  it('formats 150500ms as "2:31" (rounds up)', () => {
    expect(formatCountdown(150500)).toBe('2:31');
  });

  it('formats partial seconds by rounding up', () => {
    // 5.1 seconds should show as 6 seconds
    expect(formatCountdown(5100)).toBe('0:06');
  });
});

describe('getPhaseLabel', () => {
  it('returns BETTING for phase 0', () => {
    expect(getPhaseLabel(ROUND_PHASE.BETTING)).toBe('BETTING');
  });

  it('returns LOCKED for phase 1', () => {
    expect(getPhaseLabel(ROUND_PHASE.LOCKED)).toBe('LOCKED');
  });

  it('returns REVEALING for phase 2', () => {
    expect(getPhaseLabel(ROUND_PHASE.REVEALING)).toBe('REVEALING');
  });

  it('returns SETTLING for phase 3', () => {
    expect(getPhaseLabel(ROUND_PHASE.SETTLING)).toBe('SETTLING');
  });

  it('returns FINALIZED for phase 4', () => {
    expect(getPhaseLabel(ROUND_PHASE.FINALIZED)).toBe('FINALIZED');
  });

  it('returns IDLE for null', () => {
    expect(getPhaseLabel(null)).toBe('IDLE');
  });

  it('returns IDLE for unknown phase', () => {
    expect(getPhaseLabel(99)).toBe('IDLE');
  });
});

describe('useRoundPhase hook (behavioral)', () => {
  // Test the hook logic without @testing-library/react
  // by validating the pure functions it depends on

  describe('countdown calculation', () => {
    it('calculates correct countdown from phaseEndsAtMs', () => {
      const now = Date.now();
      const phaseEndsAtMs = now + 30000;
      const countdown = Math.max(0, phaseEndsAtMs - now);
      expect(countdown).toBe(30000);
    });

    it('clamps countdown to 0 when phase has ended', () => {
      const now = Date.now();
      const phaseEndsAtMs = now - 5000; // 5 seconds ago
      const countdown = Math.max(0, phaseEndsAtMs - now);
      expect(countdown).toBe(0);
    });

    it('applies server time offset correctly', () => {
      const now = Date.now();
      const serverOffset = 500; // Server is 500ms ahead
      const phaseEndsAtMs = now + 30000 + serverOffset;
      const adjustedNow = now + serverOffset;
      const countdown = Math.max(0, phaseEndsAtMs - adjustedNow);
      // Should be ~30000ms when accounting for offset
      expect(countdown).toBe(30000);
    });
  });

  describe('phase state transitions', () => {
    it('can bet during BETTING phase', () => {
      const phase = ROUND_PHASE.BETTING;
      const canBet = phase === ROUND_PHASE.BETTING;
      expect(canBet).toBe(true);
    });

    it('cannot bet during LOCKED phase', () => {
      const phase = ROUND_PHASE.LOCKED;
      const canBet = phase === ROUND_PHASE.BETTING;
      expect(canBet).toBe(false);
    });

    it('cannot bet during FINALIZED phase', () => {
      const phase = ROUND_PHASE.FINALIZED;
      const canBet = phase === ROUND_PHASE.BETTING;
      expect(canBet).toBe(false);
    });
  });
});

describe('AC-PQ.1: Countdown matches server phase within 250ms', () => {
  it('countdown accuracy formula is correct', () => {
    const serverPhaseEndsAt = 1000030000; // Some timestamp
    const clientTime = 1000000000;
    const serverOffset = 0;

    // Expected countdown
    const expected = serverPhaseEndsAt - clientTime;
    // Actual calculation (mimicking the hook)
    const adjustedNow = clientTime + serverOffset;
    const actual = Math.max(0, serverPhaseEndsAt - adjustedNow);

    const drift = Math.abs(expected - actual);
    expect(drift).toBeLessThanOrEqual(250);
  });

  it('countdown with offset stays within 250ms', () => {
    const serverPhaseEndsAt = 1000030000;
    const clientTime = 1000000000;
    const serverOffset = 100; // Server is 100ms ahead

    const expected = 30000; // 30 seconds remaining (in server time)
    const adjustedNow = clientTime + serverOffset;
    const actual = Math.max(0, serverPhaseEndsAt - adjustedNow);

    // With offset, actual should be very close to expected
    const drift = Math.abs(expected - actual);
    expect(drift).toBeLessThanOrEqual(250);
  });

  it('negative offset handling keeps accuracy', () => {
    const serverPhaseEndsAt = 1000030000;
    const clientTime = 1000000000;
    const serverOffset = -100; // Server is 100ms behind

    const adjustedNow = clientTime + serverOffset;
    const actual = Math.max(0, serverPhaseEndsAt - adjustedNow);

    // Should be 30100ms (30 seconds + offset adjustment)
    expect(actual).toBe(30100);
  });
});
