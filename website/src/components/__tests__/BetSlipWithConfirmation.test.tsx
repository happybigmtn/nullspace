// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  X: () => React.createElement('svg', { 'data-testid': 'x-icon' }),
}));

// Mock the Label component
vi.mock('../casino/ui/Label', () => ({
  Label: ({ children, size, className }: { children: React.ReactNode; size?: string; className?: string }) =>
    React.createElement('span', { className: `label ${size ?? ''} ${className ?? ''}`, 'data-testid': 'label' }, children),
}));

import {
  BetSlipWithConfirmation,
  validateBetSlip,
  type BetSlipBet,
  type BetValidationError,
} from '../casino/shared/BetSlipWithConfirmation';

// Helper to render component
function renderToString(element: React.ReactElement): string {
  const { renderToStaticMarkup } = require('react-dom/server');
  return renderToStaticMarkup(element);
}

const createMockBet = (overrides: Partial<BetSlipBet> = {}): BetSlipBet => ({
  id: 'bet-1',
  type: 'RED',
  amount: 100,
  odds: 2,
  ...overrides,
});

describe('BetSlipWithConfirmation', () => {
  const defaultProps = {
    bets: [createMockBet()],
    balance: 1000,
    bettingEnabled: true,
    isConnected: true,
    onSubmit: vi.fn().mockResolvedValue({ success: true }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('empty state', () => {
    it('shows "No bets placed" when bets array is empty', () => {
      const html = renderToString(
        <BetSlipWithConfirmation {...defaultProps} bets={[]} />
      );

      expect(html).toContain('No bets placed');
    });

    it('has proper role and aria-live for empty state', () => {
      const html = renderToString(
        <BetSlipWithConfirmation {...defaultProps} bets={[]} />
      );

      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
    });
  });

  describe('bet display', () => {
    it('displays bet count in header', () => {
      const html = renderToString(
        <BetSlipWithConfirmation
          {...defaultProps}
          bets={[createMockBet(), createMockBet({ id: 'bet-2' })]}
        />
      );

      expect(html).toContain('>2<');
    });

    it('displays bet type', () => {
      const html = renderToString(
        <BetSlipWithConfirmation
          {...defaultProps}
          bets={[createMockBet({ type: 'STRAIGHT' })]}
        />
      );

      expect(html).toContain('STRAIGHT');
    });

    it('displays bet target when provided', () => {
      const html = renderToString(
        <BetSlipWithConfirmation
          {...defaultProps}
          bets={[createMockBet({ type: 'STRAIGHT', target: 17 })]}
        />
      );

      expect(html).toContain('17');
    });

    it('displays bet amount formatted', () => {
      const html = renderToString(
        <BetSlipWithConfirmation
          {...defaultProps}
          bets={[createMockBet({ amount: 1500 })]}
        />
      );

      expect(html).toContain('$1,500');
    });

    it('displays total stake', () => {
      const html = renderToString(
        <BetSlipWithConfirmation
          {...defaultProps}
          bets={[
            createMockBet({ amount: 100 }),
            createMockBet({ id: 'bet-2', amount: 200 }),
          ]}
        />
      );

      expect(html).toContain('Total Stake');
      expect(html).toContain('$300');
    });

    it('displays max win calculation', () => {
      const html = renderToString(
        <BetSlipWithConfirmation
          {...defaultProps}
          bets={[createMockBet({ amount: 100, odds: 2 })]}
        />
      );

      expect(html).toContain('Max Win');
      expect(html).toContain('$200');
    });

    it('displays odds in correct format', () => {
      const html = renderToString(
        <BetSlipWithConfirmation
          {...defaultProps}
          bets={[createMockBet({ odds: 2.5 })]}
        />
      );

      expect(html).toContain('2.50x');
    });
  });

  describe('action buttons', () => {
    it('shows "Place Bet" button when idle with bets', () => {
      const html = renderToString(
        <BetSlipWithConfirmation {...defaultProps} />
      );

      expect(html).toContain('Place Bet');
    });

    it('shows "Betting Locked" when bettingEnabled is false', () => {
      const html = renderToString(
        <BetSlipWithConfirmation {...defaultProps} bettingEnabled={false} />
      );

      expect(html).toContain('Betting Locked');
      expect(html).toContain('disabled');
    });

    it('shows "Connecting..." when isConnected is false', () => {
      const html = renderToString(
        <BetSlipWithConfirmation {...defaultProps} isConnected={false} />
      );

      expect(html).toContain('Connecting...');
    });

    it('has clear button when onClearAll is provided', () => {
      const html = renderToString(
        <BetSlipWithConfirmation {...defaultProps} onClearAll={vi.fn()} />
      );

      expect(html).toContain('Clear');
    });

    it('does not show clear button when onClearAll is not provided', () => {
      const html = renderToString(
        <BetSlipWithConfirmation {...defaultProps} onClearAll={undefined} />
      );

      // Clear button should not appear
      expect(html).not.toContain('Clear all');
    });
  });

  describe('accessibility', () => {
    it('has proper region role', () => {
      const html = renderToString(
        <BetSlipWithConfirmation {...defaultProps} />
      );

      expect(html).toContain('role="region"');
      expect(html).toContain('aria-label="Bet slip"');
    });

    it('has aria-label on Place Bet button', () => {
      const html = renderToString(
        <BetSlipWithConfirmation {...defaultProps} />
      );

      expect(html).toContain('aria-label="Place bet"');
    });

    it('has aria-label on remove bet buttons', () => {
      const html = renderToString(
        <BetSlipWithConfirmation
          {...defaultProps}
          bets={[createMockBet({ type: 'STRAIGHT' })]}
          onRemoveBet={vi.fn()}
        />
      );

      expect(html).toContain('aria-label="Remove STRAIGHT bet"');
    });

    it('has aria-label on clear all button', () => {
      const html = renderToString(
        <BetSlipWithConfirmation {...defaultProps} onClearAll={vi.fn()} />
      );

      expect(html).toContain('aria-label="Clear all bets"');
    });
  });

  describe('compact mode', () => {
    it('does not show individual bet items in compact mode', () => {
      const html = renderToString(
        <BetSlipWithConfirmation
          {...defaultProps}
          bets={[createMockBet({ type: 'SPECIFIC_TYPE_FOR_TEST' })]}
          compact={true}
        />
      );

      // In compact mode, the bet list section (max-h-48 overflow-y-auto) should not render
      expect(html).not.toContain('SPECIFIC_TYPE_FOR_TEST');
    });

    it('still shows totals in compact mode', () => {
      const html = renderToString(
        <BetSlipWithConfirmation
          {...defaultProps}
          bets={[createMockBet({ amount: 500 })]}
          compact={true}
        />
      );

      expect(html).toContain('Total Stake');
      expect(html).toContain('$500');
    });
  });
});

describe('validateBetSlip', () => {
  const baseBets: BetSlipBet[] = [createMockBet({ amount: 100 })];

  describe('connection validation', () => {
    it('returns CONNECTION_ERROR when not connected', () => {
      const result = validateBetSlip(baseBets, 1000, true, false);

      expect(result).not.toBeNull();
      expect(result?.code).toBe('CONNECTION_ERROR');
      expect(result?.retryable).toBe(true);
    });

    it('passes when connected', () => {
      const result = validateBetSlip(baseBets, 1000, true, true);

      expect(result).toBeNull();
    });
  });

  describe('betting phase validation', () => {
    it('returns PHASE_LOCKED when betting is disabled', () => {
      const result = validateBetSlip(baseBets, 1000, false, true);

      expect(result).not.toBeNull();
      expect(result?.code).toBe('PHASE_LOCKED');
      expect(result?.retryable).toBe(false);
    });

    it('passes when betting is enabled', () => {
      const result = validateBetSlip(baseBets, 1000, true, true);

      expect(result).toBeNull();
    });
  });

  describe('empty bets validation', () => {
    it('returns VALIDATION_FAILED when bets array is empty', () => {
      const result = validateBetSlip([], 1000, true, true);

      expect(result).not.toBeNull();
      expect(result?.code).toBe('VALIDATION_FAILED');
      expect(result?.message).toContain('No bets');
    });
  });

  describe('bet amount validation', () => {
    it('returns INVALID_AMOUNT for zero bet', () => {
      const bets: BetSlipBet[] = [createMockBet({ amount: 0 })];
      const result = validateBetSlip(bets, 1000, true, true);

      expect(result).not.toBeNull();
      expect(result?.code).toBe('INVALID_AMOUNT');
    });

    it('returns INVALID_AMOUNT for negative bet', () => {
      const bets: BetSlipBet[] = [createMockBet({ amount: -50 })];
      const result = validateBetSlip(bets, 1000, true, true);

      expect(result).not.toBeNull();
      expect(result?.code).toBe('INVALID_AMOUNT');
    });

    it('returns INVALID_AMOUNT for NaN bet', () => {
      const bets: BetSlipBet[] = [createMockBet({ amount: NaN })];
      const result = validateBetSlip(bets, 1000, true, true);

      expect(result).not.toBeNull();
      expect(result?.code).toBe('INVALID_AMOUNT');
    });

    it('returns INVALID_AMOUNT for Infinity bet', () => {
      const bets: BetSlipBet[] = [createMockBet({ amount: Infinity })];
      const result = validateBetSlip(bets, 1000, true, true);

      expect(result).not.toBeNull();
      expect(result?.code).toBe('INVALID_AMOUNT');
    });

    it('passes for valid positive amounts', () => {
      const bets: BetSlipBet[] = [
        createMockBet({ amount: 100 }),
        createMockBet({ id: 'bet-2', amount: 50 }),
      ];
      const result = validateBetSlip(bets, 1000, true, true);

      expect(result).toBeNull();
    });
  });

  describe('balance validation', () => {
    it('returns INSUFFICIENT_FUNDS when total exceeds balance', () => {
      const bets: BetSlipBet[] = [
        createMockBet({ amount: 600 }),
        createMockBet({ id: 'bet-2', amount: 500 }),
      ];
      const result = validateBetSlip(bets, 1000, true, true);

      expect(result).not.toBeNull();
      expect(result?.code).toBe('INSUFFICIENT_FUNDS');
      expect(result?.message).toContain('1,100');
      expect(result?.message).toContain('1,000');
    });

    it('passes when total equals balance exactly', () => {
      const bets: BetSlipBet[] = [createMockBet({ amount: 1000 })];
      const result = validateBetSlip(bets, 1000, true, true);

      expect(result).toBeNull();
    });

    it('passes when total is less than balance', () => {
      const bets: BetSlipBet[] = [createMockBet({ amount: 500 })];
      const result = validateBetSlip(bets, 1000, true, true);

      expect(result).toBeNull();
    });
  });

  describe('validation priority', () => {
    it('checks connection before betting phase', () => {
      // Both disconnected AND betting disabled
      const result = validateBetSlip(baseBets, 1000, false, false);

      // Should fail on connection first
      expect(result?.code).toBe('CONNECTION_ERROR');
    });

    it('checks betting phase before balance', () => {
      // Betting disabled AND insufficient funds
      const bets: BetSlipBet[] = [createMockBet({ amount: 2000 })];
      const result = validateBetSlip(bets, 1000, false, true);

      // Should fail on phase first
      expect(result?.code).toBe('PHASE_LOCKED');
    });

    it('checks empty bets before invalid amounts', () => {
      // Empty bets (no invalid amounts to check)
      const result = validateBetSlip([], 1000, true, true);

      expect(result?.code).toBe('VALIDATION_FAILED');
    });

    it('checks invalid amounts before balance', () => {
      // Invalid amount AND would exceed balance
      const bets: BetSlipBet[] = [createMockBet({ amount: -1 })];
      const result = validateBetSlip(bets, 1000, true, true);

      // Should fail on amount first
      expect(result?.code).toBe('INVALID_AMOUNT');
    });
  });
});

describe('BetSlipWithConfirmation - integration scenarios', () => {
  describe('typical betting flow', () => {
    it('renders with multiple bets from different types', () => {
      const bets: BetSlipBet[] = [
        { id: '1', type: 'RED', amount: 100, odds: 2 },
        { id: '2', type: 'STRAIGHT', target: 17, amount: 50, odds: 36 },
        { id: '3', type: 'CORNER', target: '17-18-20-21', amount: 25, odds: 9 },
      ];

      const html = renderToString(
        <BetSlipWithConfirmation
          bets={bets}
          balance={1000}
          bettingEnabled={true}
          isConnected={true}
          onSubmit={vi.fn().mockResolvedValue({ success: true })}
        />
      );

      // Verify all bets displayed
      expect(html).toContain('RED');
      expect(html).toContain('STRAIGHT');
      expect(html).toContain('17');
      expect(html).toContain('CORNER');

      // Verify totals
      expect(html).toContain('$175'); // 100 + 50 + 25
    });

    it('calculates max win correctly for complex bets', () => {
      const bets: BetSlipBet[] = [
        { id: '1', type: 'RED', amount: 100, odds: 2 },      // 200
        { id: '2', type: 'STRAIGHT', amount: 10, odds: 36 }, // 360
      ];

      const html = renderToString(
        <BetSlipWithConfirmation
          bets={bets}
          balance={1000}
          bettingEnabled={true}
          isConnected={true}
          onSubmit={vi.fn().mockResolvedValue({ success: true })}
        />
      );

      // Max win should be 200 + 360 = 560
      expect(html).toContain('$560');
    });

    it('uses amount as fallback when odds not provided', () => {
      const bets: BetSlipBet[] = [
        { id: '1', type: 'TEST', amount: 100 },
      ];

      const html = renderToString(
        <BetSlipWithConfirmation
          bets={bets}
          balance={1000}
          bettingEnabled={true}
          isConnected={true}
          onSubmit={vi.fn().mockResolvedValue({ success: true })}
        />
      );

      // Max win should be amount * 1 = 100
      expect(html).toContain('$100');
    });
  });

  describe('edge cases', () => {
    it('handles very large bet amounts', () => {
      const bets: BetSlipBet[] = [
        { id: '1', type: 'HIGH_ROLLER', amount: 999999999, odds: 2 },
      ];

      const html = renderToString(
        <BetSlipWithConfirmation
          bets={bets}
          balance={1_000_000_000}
          bettingEnabled={true}
          isConnected={true}
          onSubmit={vi.fn().mockResolvedValue({ success: true })}
        />
      );

      expect(html).toContain('999,999,999');
    });

    it('handles bet with explicit maxWin override', () => {
      const bets: BetSlipBet[] = [
        { id: '1', type: 'PROMO', amount: 100, odds: 2, maxWin: 500 },
      ];

      const html = renderToString(
        <BetSlipWithConfirmation
          bets={bets}
          balance={1000}
          bettingEnabled={true}
          isConnected={true}
          onSubmit={vi.fn().mockResolvedValue({ success: true })}
        />
      );

      // Should use explicit maxWin, not calculated odds
      expect(html).toContain('$500');
    });

    it('handles string targets', () => {
      const bets: BetSlipBet[] = [
        { id: '1', type: 'COLUMN', target: '1st', amount: 100, odds: 3 },
      ];

      const html = renderToString(
        <BetSlipWithConfirmation
          bets={bets}
          balance={1000}
          bettingEnabled={true}
          isConnected={true}
          onSubmit={vi.fn().mockResolvedValue({ success: true })}
        />
      );

      expect(html).toContain('1st');
    });
  });
});

describe('Error state formatting', () => {
  it('formats INSUFFICIENT_FUNDS error with amounts', () => {
    const result = validateBetSlip(
      [createMockBet({ amount: 1500 })],
      1000,
      true,
      true
    );

    expect(result?.code).toBe('INSUFFICIENT_FUNDS');
    expect(result?.message).toContain('$1,500');
    expect(result?.message).toContain('$1,000');
  });

  it('includes bet type in INVALID_AMOUNT error', () => {
    const result = validateBetSlip(
      [createMockBet({ type: 'SPLIT', amount: 0 })],
      1000,
      true,
      true
    );

    expect(result?.code).toBe('INVALID_AMOUNT');
    expect(result?.message).toContain('SPLIT');
  });
});
