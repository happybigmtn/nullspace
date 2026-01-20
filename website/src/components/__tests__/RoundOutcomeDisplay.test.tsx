// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  RoundOutcomeDisplay,
  SettlementResultDisplay,
  RoundResultPanel,
} from '../casino/RoundOutcomeDisplay';
import type {
  RoundOutcome,
  PlayerSettlement,
  RoundTotal,
} from '../../hooks/useRoundOutcome';
import {
  getBetTypeLabel,
  formatAmount,
  getTopTotals,
  BET_TYPES,
  calculateTotalWagered,
} from '../../hooks/useRoundOutcome';

// Helper to render component to string
function renderToString(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

// Mock data factories
function createMockOutcome(overrides?: Partial<RoundOutcome>): RoundOutcome {
  return {
    roundId: 42n,
    gameType: 0,
    d1: 3,
    d2: 4,
    diceTotal: 7,
    mainPoint: 0,
    epochPointEstablished: false,
    totals: [
      { betType: BET_TYPES.PASS_LINE, target: 0, amount: 100_000_000n },
      { betType: BET_TYPES.FIELD, target: 0, amount: 50_000_000n },
    ],
    rngCommit: new Uint8Array([0xab, 0xcd, 0xef, 0x12]),
    rollSeed: new Uint8Array([0x12, 0x34, 0x56, 0x78]),
    receivedAt: Date.now(),
    ...overrides,
  };
}

function createMockSettlement(overrides?: Partial<PlayerSettlement>): PlayerSettlement {
  return {
    player: new Uint8Array([1, 2, 3, 4]),
    roundId: 42n,
    payout: 50_000_000n,
    balanceSnapshot: { chips: 1000_000_000n, vusdt: 0n, rng: 0n },
    myBets: [
      { betType: BET_TYPES.PASS_LINE, target: 0, amount: 50_000_000n },
    ],
    ...overrides,
  };
}

describe('RoundOutcomeDisplay', () => {
  describe('loading state', () => {
    it('shows "Waiting for outcome..." when hasOutcomeData is false', () => {
      const html = renderToString(
        <RoundOutcomeDisplay outcome={null} hasOutcomeData={false} />
      );
      expect(html).toContain('Waiting for outcome...');
    });

    it('shows loading state when outcome is null', () => {
      const html = renderToString(
        <RoundOutcomeDisplay outcome={null} hasOutcomeData={true} />
      );
      expect(html).toContain('Waiting for outcome...');
    });
  });

  describe('dice display', () => {
    it('renders dice faces for d1 and d2', () => {
      const outcome = createMockOutcome({ d1: 3, d2: 4 });
      const html = renderToString(
        <RoundOutcomeDisplay outcome={outcome} hasOutcomeData />
      );
      // Check dice face aria labels
      expect(html).toContain('Dice showing 3');
      expect(html).toContain('Dice showing 4');
    });

    it('displays correct dice total', () => {
      const outcome = createMockOutcome({ d1: 5, d2: 6, diceTotal: 11 });
      const html = renderToString(
        <RoundOutcomeDisplay outcome={outcome} hasOutcomeData />
      );
      expect(html).toContain('Total: 11');
    });

    it('handles snake eyes (1 + 1)', () => {
      const outcome = createMockOutcome({ d1: 1, d2: 1, diceTotal: 2 });
      const html = renderToString(
        <RoundOutcomeDisplay outcome={outcome} hasOutcomeData />
      );
      expect(html).toContain('Dice showing 1');
      expect(html).toContain('Total: 2');
    });

    it('handles boxcars (6 + 6)', () => {
      const outcome = createMockOutcome({ d1: 6, d2: 6, diceTotal: 12 });
      const html = renderToString(
        <RoundOutcomeDisplay outcome={outcome} hasOutcomeData />
      );
      expect(html).toContain('Dice showing 6');
      expect(html).toContain('Total: 12');
    });
  });

  describe('point display', () => {
    it('shows point when mainPoint is set', () => {
      const outcome = createMockOutcome({ mainPoint: 6 });
      const html = renderToString(
        <RoundOutcomeDisplay outcome={outcome} hasOutcomeData />
      );
      expect(html).toContain('Point:');
      expect(html).toContain('>6<');
    });

    it('does not show point when mainPoint is 0', () => {
      const outcome = createMockOutcome({ mainPoint: 0 });
      const html = renderToString(
        <RoundOutcomeDisplay outcome={outcome} hasOutcomeData />
      );
      expect(html).not.toContain('Point:');
    });

    it('shows "Just set" badge when point established this epoch', () => {
      const outcome = createMockOutcome({ mainPoint: 8, epochPointEstablished: true });
      const html = renderToString(
        <RoundOutcomeDisplay outcome={outcome} hasOutcomeData />
      );
      expect(html).toContain('Just set');
    });
  });

  describe('totals display', () => {
    it('shows totals when showTotals is true (default)', () => {
      const outcome = createMockOutcome();
      const html = renderToString(
        <RoundOutcomeDisplay outcome={outcome} hasOutcomeData />
      );
      expect(html).toContain('Active Bets');
      expect(html).toContain('Pass Line');
      expect(html).toContain('Field');
    });

    it('hides totals when showTotals is false', () => {
      const outcome = createMockOutcome();
      const html = renderToString(
        <RoundOutcomeDisplay outcome={outcome} hasOutcomeData showTotals={false} />
      );
      expect(html).not.toContain('Active Bets');
    });

    it('limits totals to maxTotals', () => {
      const outcome = createMockOutcome({
        totals: [
          { betType: BET_TYPES.PASS_LINE, target: 0, amount: 100n },
          { betType: BET_TYPES.DONT_PASS, target: 0, amount: 90n },
          { betType: BET_TYPES.COME, target: 0, amount: 80n },
          { betType: BET_TYPES.FIELD, target: 0, amount: 70n },
          { betType: BET_TYPES.PLACE_6, target: 0, amount: 60n },
          { betType: BET_TYPES.PLACE_8, target: 0, amount: 50n },
        ],
      });
      const html = renderToString(
        <RoundOutcomeDisplay outcome={outcome} hasOutcomeData maxTotals={3} />
      );
      // Should only show top 3 by amount
      expect(html).toContain('Pass Line');
      expect(html).toContain("Don&#x27;t Pass"); // HTML encoded apostrophe
      expect(html).toContain('Come');
      expect(html).not.toContain('Place 8');
    });

    it('formats amounts correctly', () => {
      const outcome = createMockOutcome({
        totals: [{ betType: BET_TYPES.PASS_LINE, target: 0, amount: 1_000_000n }],
      });
      const html = renderToString(
        <RoundOutcomeDisplay outcome={outcome} hasOutcomeData tokenDecimals={1e6} />
      );
      expect(html).toContain('$1.00');
    });
  });

  describe('round info', () => {
    it('shows round ID', () => {
      const outcome = createMockOutcome({ roundId: 123n });
      const html = renderToString(
        <RoundOutcomeDisplay outcome={outcome} hasOutcomeData />
      );
      expect(html).toContain('Round #123');
    });

    it('shows truncated RNG commit', () => {
      const outcome = createMockOutcome({
        rngCommit: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      });
      const html = renderToString(
        <RoundOutcomeDisplay outcome={outcome} hasOutcomeData />
      );
      expect(html).toContain('RNG: deadbeef...');
    });
  });

  describe('accessibility', () => {
    it('has role="region" for screen readers', () => {
      const outcome = createMockOutcome();
      const html = renderToString(
        <RoundOutcomeDisplay outcome={outcome} hasOutcomeData />
      );
      expect(html).toContain('role="region"');
    });

    it('has aria-live="polite" for real-time updates', () => {
      const outcome = createMockOutcome();
      const html = renderToString(
        <RoundOutcomeDisplay outcome={outcome} hasOutcomeData />
      );
      expect(html).toContain('aria-live="polite"');
    });

    it('has aria-label for outcome region', () => {
      const outcome = createMockOutcome();
      const html = renderToString(
        <RoundOutcomeDisplay outcome={outcome} hasOutcomeData />
      );
      expect(html).toContain('aria-label="Round outcome"');
    });
  });

  describe('compact mode', () => {
    it('renders smaller dice in compact mode', () => {
      const outcome = createMockOutcome();
      const html = renderToString(
        <RoundOutcomeDisplay outcome={outcome} hasOutcomeData compact />
      );
      expect(html).toContain('w-10');
    });
  });
});

describe('SettlementResultDisplay', () => {
  describe('no settlement', () => {
    it('returns null when no settlement', () => {
      const html = renderToString(
        <SettlementResultDisplay
          settlement={null}
          settlementResult={null}
          payoutAmount={0}
          totalBetAmount={0}
          hasSettlement={false}
        />
      );
      expect(html).toBe('');
    });

    it('returns null when hasSettlement is false', () => {
      const settlement = createMockSettlement();
      const html = renderToString(
        <SettlementResultDisplay
          settlement={settlement}
          settlementResult="win"
          payoutAmount={50}
          totalBetAmount={50}
          hasSettlement={false}
        />
      );
      expect(html).toBe('');
    });
  });

  describe('win result', () => {
    it('shows "You Win!" message', () => {
      const settlement = createMockSettlement({ payout: 100_000_000n });
      const html = renderToString(
        <SettlementResultDisplay
          settlement={settlement}
          settlementResult="win"
          payoutAmount={100}
          totalBetAmount={50}
          hasSettlement
        />
      );
      expect(html).toContain('You Win!');
    });

    it('shows positive payout with + prefix', () => {
      const settlement = createMockSettlement();
      const html = renderToString(
        <SettlementResultDisplay
          settlement={settlement}
          settlementResult="win"
          payoutAmount={50}
          totalBetAmount={50}
          hasSettlement
        />
      );
      expect(html).toContain('+$50.00');
    });

    it('has emerald/green styling', () => {
      const settlement = createMockSettlement();
      const html = renderToString(
        <SettlementResultDisplay
          settlement={settlement}
          settlementResult="win"
          payoutAmount={50}
          totalBetAmount={50}
          hasSettlement
        />
      );
      expect(html).toContain('emerald');
    });
  });

  describe('loss result', () => {
    it('shows loss message', () => {
      const settlement = createMockSettlement({ payout: -50_000_000n });
      const html = renderToString(
        <SettlementResultDisplay
          settlement={settlement}
          settlementResult="loss"
          payoutAmount={-50}
          totalBetAmount={50}
          hasSettlement
        />
      );
      expect(html).toContain('Better luck next time');
    });

    it('shows negative payout without extra sign', () => {
      const settlement = createMockSettlement({ payout: -50_000_000n });
      const html = renderToString(
        <SettlementResultDisplay
          settlement={settlement}
          settlementResult="loss"
          payoutAmount={-50}
          totalBetAmount={50}
          hasSettlement
        />
      );
      expect(html).toContain('$50.00');
    });
  });

  describe('push result', () => {
    it('shows "Push" message', () => {
      const settlement = createMockSettlement({ payout: 0n });
      const html = renderToString(
        <SettlementResultDisplay
          settlement={settlement}
          settlementResult="push"
          payoutAmount={0}
          totalBetAmount={50}
          hasSettlement
        />
      );
      expect(html).toContain('Push');
    });

    it('shows $0.00 payout', () => {
      const settlement = createMockSettlement({ payout: 0n });
      const html = renderToString(
        <SettlementResultDisplay
          settlement={settlement}
          settlementResult="push"
          payoutAmount={0}
          totalBetAmount={50}
          hasSettlement
        />
      );
      expect(html).toContain('+$0.00');
    });

    it('has amber styling', () => {
      const settlement = createMockSettlement({ payout: 0n });
      const html = renderToString(
        <SettlementResultDisplay
          settlement={settlement}
          settlementResult="push"
          payoutAmount={0}
          totalBetAmount={50}
          hasSettlement
        />
      );
      expect(html).toContain('amber');
    });
  });

  describe('bet details', () => {
    it('shows number of bets settled', () => {
      const settlement = createMockSettlement({
        myBets: [
          { betType: 0, target: 0, amount: 50n },
          { betType: 1, target: 0, amount: 50n },
        ],
      });
      const html = renderToString(
        <SettlementResultDisplay
          settlement={settlement}
          settlementResult="win"
          payoutAmount={100}
          totalBetAmount={100}
          hasSettlement
        />
      );
      expect(html).toContain('2 bets settled');
    });

    it('shows singular "bet" for one bet', () => {
      const settlement = createMockSettlement({
        myBets: [{ betType: 0, target: 0, amount: 50n }],
      });
      const html = renderToString(
        <SettlementResultDisplay
          settlement={settlement}
          settlementResult="win"
          payoutAmount={50}
          totalBetAmount={50}
          hasSettlement
        />
      );
      expect(html).toContain('1 bet settled');
    });

    it('shows total wagered', () => {
      const settlement = createMockSettlement();
      const html = renderToString(
        <SettlementResultDisplay
          settlement={settlement}
          settlementResult="win"
          payoutAmount={100}
          totalBetAmount={50}
          hasSettlement
        />
      );
      expect(html).toContain('$50.00 wagered');
    });
  });

  describe('balance snapshot', () => {
    it('shows updated balance', () => {
      const settlement = createMockSettlement({
        balanceSnapshot: { chips: 500_000_000n, vusdt: 0n, rng: 0n },
      });
      const html = renderToString(
        <SettlementResultDisplay
          settlement={settlement}
          settlementResult="win"
          payoutAmount={50}
          totalBetAmount={50}
          hasSettlement
          tokenDecimals={1e6}
        />
      );
      expect(html).toContain('Balance: $500.00');
    });
  });

  describe('accessibility', () => {
    it('has role="alert" for immediate attention', () => {
      const settlement = createMockSettlement();
      const html = renderToString(
        <SettlementResultDisplay
          settlement={settlement}
          settlementResult="win"
          payoutAmount={50}
          totalBetAmount={50}
          hasSettlement
        />
      );
      expect(html).toContain('role="alert"');
    });

    it('has aria-live="assertive" for settlement announcements', () => {
      const settlement = createMockSettlement();
      const html = renderToString(
        <SettlementResultDisplay
          settlement={settlement}
          settlementResult="win"
          payoutAmount={50}
          totalBetAmount={50}
          hasSettlement
        />
      );
      expect(html).toContain('aria-live="assertive"');
    });

    it('has descriptive aria-label', () => {
      const settlement = createMockSettlement();
      const html = renderToString(
        <SettlementResultDisplay
          settlement={settlement}
          settlementResult="win"
          payoutAmount={50}
          totalBetAmount={50}
          hasSettlement
        />
      );
      expect(html).toContain('aria-label');
      expect(html).toContain('Settlement');
    });
  });
});

describe('RoundResultPanel', () => {
  it('renders both outcome and settlement when available', () => {
    const outcome = createMockOutcome();
    const settlement = createMockSettlement();
    const html = renderToString(
      <RoundResultPanel
        outcome={outcome}
        settlement={settlement}
        settlementResult="win"
        payoutAmount={50}
        totalBetAmount={50}
        hasOutcomeData
      />
    );
    // Should have outcome
    expect(html).toContain('Round outcome');
    // Should have settlement
    expect(html).toContain('You Win!');
  });

  it('renders only outcome when no settlement', () => {
    const outcome = createMockOutcome();
    const html = renderToString(
      <RoundResultPanel
        outcome={outcome}
        settlement={null}
        settlementResult={null}
        payoutAmount={0}
        totalBetAmount={0}
        hasOutcomeData
      />
    );
    expect(html).toContain('Round outcome');
    expect(html).not.toContain('You Win!');
  });
});

describe('helper functions', () => {
  describe('getBetTypeLabel', () => {
    it('returns "Pass Line" for PASS_LINE', () => {
      expect(getBetTypeLabel(BET_TYPES.PASS_LINE)).toBe('Pass Line');
    });

    it('returns "Don\'t Pass" for DONT_PASS', () => {
      expect(getBetTypeLabel(BET_TYPES.DONT_PASS)).toBe("Don't Pass");
    });

    it('returns "Field" for FIELD', () => {
      expect(getBetTypeLabel(BET_TYPES.FIELD)).toBe('Field');
    });

    it('returns "Hard 6" for HARDWAY_6', () => {
      expect(getBetTypeLabel(BET_TYPES.HARDWAY_6)).toBe('Hard 6');
    });

    it('returns fallback for unknown bet type', () => {
      expect(getBetTypeLabel(999)).toBe('Bet 999');
    });
  });

  describe('formatAmount', () => {
    it('formats with 2 decimal places', () => {
      expect(formatAmount(1_000_000n, 6)).toBe('1.00');
    });

    it('formats larger amounts with commas', () => {
      expect(formatAmount(1_000_000_000n, 6)).toBe('1,000.00');
    });

    it('handles zero', () => {
      expect(formatAmount(0n, 6)).toBe('0.00');
    });
  });

  describe('getTopTotals', () => {
    it('returns top N by amount', () => {
      const totals: RoundTotal[] = [
        { betType: 0, target: 0, amount: 10n },
        { betType: 1, target: 0, amount: 30n },
        { betType: 2, target: 0, amount: 20n },
      ];
      const top = getTopTotals(totals, 2);
      expect(top).toHaveLength(2);
      expect(top[0].amount).toBe(30n);
      expect(top[1].amount).toBe(20n);
    });

    it('returns all if less than limit', () => {
      const totals: RoundTotal[] = [{ betType: 0, target: 0, amount: 10n }];
      const top = getTopTotals(totals, 5);
      expect(top).toHaveLength(1);
    });

    it('does not mutate original array', () => {
      const totals: RoundTotal[] = [
        { betType: 0, target: 0, amount: 10n },
        { betType: 1, target: 0, amount: 30n },
      ];
      getTopTotals(totals, 1);
      expect(totals[0].amount).toBe(10n);
    });
  });

  describe('calculateTotalWagered', () => {
    it('sums all total amounts', () => {
      const totals: RoundTotal[] = [
        { betType: 0, target: 0, amount: 100n },
        { betType: 1, target: 0, amount: 200n },
        { betType: 2, target: 0, amount: 300n },
      ];
      expect(calculateTotalWagered(totals)).toBe(600n);
    });

    it('returns 0n for empty array', () => {
      expect(calculateTotalWagered([])).toBe(0n);
    });
  });
});

describe('AC-5.4: Real-time updates without manual refresh', () => {
  it('component renders immediately with new outcome data', () => {
    // Simulate receiving outcome data
    const outcome = createMockOutcome({ d1: 4, d2: 3, diceTotal: 7 });
    const html = renderToString(
      <RoundOutcomeDisplay outcome={outcome} hasOutcomeData />
    );

    // Should immediately show the dice result
    expect(html).toContain('Dice showing 4');
    expect(html).toContain('Dice showing 3');
    expect(html).toContain('Total: 7');
  });

  it('settlement result displays immediately', () => {
    const settlement = createMockSettlement({ payout: 75_000_000n });
    const html = renderToString(
      <SettlementResultDisplay
        settlement={settlement}
        settlementResult="win"
        payoutAmount={75}
        totalBetAmount={50}
        hasSettlement
      />
    );

    // Should immediately show win result
    expect(html).toContain('You Win!');
    expect(html).toContain('+$75.00');
  });

  it('totals update reflects real-time aggregate amounts', () => {
    const outcome = createMockOutcome({
      totals: [
        { betType: BET_TYPES.PASS_LINE, target: 0, amount: 500_000_000n },
        { betType: BET_TYPES.FIELD, target: 0, amount: 250_000_000n },
      ],
    });
    const html = renderToString(
      <RoundOutcomeDisplay outcome={outcome} hasOutcomeData tokenDecimals={1e6} />
    );

    // Should show aggregate totals
    expect(html).toContain('Total: $750.00');
  });
});
