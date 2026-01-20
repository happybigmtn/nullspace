// @vitest-environment jsdom
/**
 * Tests for useBetSubmission hook and validation logic - AC-5.3
 *
 * These are unit tests for the validateBetSlip function which provides
 * the core validation logic for the bet slip confirmation flow.
 */
import { describe, expect, it, vi } from 'vitest';
import { validateBetSlip, type BetSlipBet } from '../casino/shared/BetSlipWithConfirmation';

const createMockBet = (id: string = 'bet-1', overrides: Partial<BetSlipBet> = {}): BetSlipBet => ({
  id,
  type: 'RED',
  amount: 100,
  odds: 2,
  ...overrides,
});

describe('useBetSubmission validation logic', () => {
  describe('validateBetSlip function', () => {
    it('returns null for valid bets with sufficient balance', () => {
      const bets = [createMockBet()];
      const result = validateBetSlip(bets, 1000, true, true);
      expect(result).toBeNull();
    });

    it('returns CONNECTION_ERROR when disconnected', () => {
      const bets = [createMockBet()];
      const result = validateBetSlip(bets, 1000, true, false);
      expect(result?.code).toBe('CONNECTION_ERROR');
      expect(result?.retryable).toBe(true);
    });

    it('returns PHASE_LOCKED when betting is disabled', () => {
      const bets = [createMockBet()];
      const result = validateBetSlip(bets, 1000, false, true);
      expect(result?.code).toBe('PHASE_LOCKED');
      expect(result?.retryable).toBe(false);
    });

    it('returns VALIDATION_FAILED for empty bets', () => {
      const result = validateBetSlip([], 1000, true, true);
      expect(result?.code).toBe('VALIDATION_FAILED');
    });

    it('returns INVALID_AMOUNT for zero amount', () => {
      const bets = [createMockBet('1', { amount: 0 })];
      const result = validateBetSlip(bets, 1000, true, true);
      expect(result?.code).toBe('INVALID_AMOUNT');
    });

    it('returns INVALID_AMOUNT for negative amount', () => {
      const bets = [createMockBet('1', { amount: -50 })];
      const result = validateBetSlip(bets, 1000, true, true);
      expect(result?.code).toBe('INVALID_AMOUNT');
    });

    it('returns INVALID_AMOUNT for NaN amount', () => {
      const bets = [createMockBet('1', { amount: NaN })];
      const result = validateBetSlip(bets, 1000, true, true);
      expect(result?.code).toBe('INVALID_AMOUNT');
    });

    it('returns INSUFFICIENT_FUNDS when total exceeds balance', () => {
      const bets = [
        createMockBet('1', { amount: 600 }),
        createMockBet('2', { amount: 500 }),
      ];
      const result = validateBetSlip(bets, 1000, true, true);
      expect(result?.code).toBe('INSUFFICIENT_FUNDS');
      expect(result?.message).toContain('1,100');
      expect(result?.message).toContain('1,000');
    });

    it('passes when total equals balance exactly', () => {
      const bets = [createMockBet('1', { amount: 1000 })];
      const result = validateBetSlip(bets, 1000, true, true);
      expect(result).toBeNull();
    });

    describe('validation priority order', () => {
      it('checks connection before betting phase', () => {
        const bets = [createMockBet()];
        const result = validateBetSlip(bets, 1000, false, false);
        expect(result?.code).toBe('CONNECTION_ERROR');
      });

      it('checks betting phase before balance', () => {
        const bets = [createMockBet('1', { amount: 2000 })];
        const result = validateBetSlip(bets, 1000, false, true);
        expect(result?.code).toBe('PHASE_LOCKED');
      });

      it('checks empty bets before invalid amounts', () => {
        const result = validateBetSlip([], 1000, true, true);
        expect(result?.code).toBe('VALIDATION_FAILED');
      });

      it('checks invalid amounts before balance', () => {
        const bets = [createMockBet('1', { amount: -1 })];
        const result = validateBetSlip(bets, 1000, true, true);
        expect(result?.code).toBe('INVALID_AMOUNT');
      });
    });
  });

  describe('error message formatting', () => {
    it('formats INSUFFICIENT_FUNDS with both amounts', () => {
      const bets = [createMockBet('1', { amount: 1500 })];
      const result = validateBetSlip(bets, 1000, true, true);
      expect(result?.message).toContain('$1,500');
      expect(result?.message).toContain('$1,000');
    });

    it('includes bet type in INVALID_AMOUNT error', () => {
      const bets = [createMockBet('1', { type: 'SPLIT', amount: 0 })];
      const result = validateBetSlip(bets, 1000, true, true);
      expect(result?.message).toContain('SPLIT');
    });

    it('provides helpful message for CONNECTION_ERROR', () => {
      const bets = [createMockBet()];
      const result = validateBetSlip(bets, 1000, true, false);
      expect(result?.message).toContain('connection');
    });

    it('provides helpful message for PHASE_LOCKED', () => {
      const bets = [createMockBet()];
      const result = validateBetSlip(bets, 1000, false, true);
      expect(result?.message).toContain('locked');
    });
  });

  describe('retryable errors', () => {
    it('CONNECTION_ERROR is retryable', () => {
      const bets = [createMockBet()];
      const result = validateBetSlip(bets, 1000, true, false);
      expect(result?.retryable).toBe(true);
    });

    it('PHASE_LOCKED is not retryable', () => {
      const bets = [createMockBet()];
      const result = validateBetSlip(bets, 1000, false, true);
      expect(result?.retryable).toBe(false);
    });

    it('VALIDATION_FAILED is not retryable', () => {
      const result = validateBetSlip([], 1000, true, true);
      expect(result?.retryable).toBe(false);
    });

    it('INVALID_AMOUNT is not retryable', () => {
      const bets = [createMockBet('1', { amount: 0 })];
      const result = validateBetSlip(bets, 1000, true, true);
      expect(result?.retryable).toBe(false);
    });

    it('INSUFFICIENT_FUNDS is not retryable', () => {
      const bets = [createMockBet('1', { amount: 2000 })];
      const result = validateBetSlip(bets, 1000, true, true);
      expect(result?.retryable).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles very large bet amounts', () => {
      const bets = [createMockBet('1', { amount: 999_999_999 })];
      const result = validateBetSlip(bets, 1_000_000_000, true, true);
      expect(result).toBeNull();
    });

    it('handles Infinity in amount', () => {
      const bets = [createMockBet('1', { amount: Infinity })];
      const result = validateBetSlip(bets, Infinity, true, true);
      expect(result?.code).toBe('INVALID_AMOUNT');
    });

    it('handles many small bets summing to large total', () => {
      const bets = Array.from({ length: 100 }, (_, i) =>
        createMockBet(`bet-${i}`, { amount: 15 })
      );
      // Total = 1500
      const result = validateBetSlip(bets, 1000, true, true);
      expect(result?.code).toBe('INSUFFICIENT_FUNDS');
    });

    it('handles floating point bet amounts', () => {
      const bets = [createMockBet('1', { amount: 99.99 })];
      const result = validateBetSlip(bets, 100, true, true);
      expect(result).toBeNull();
    });

    it('handles zero balance with positive bet', () => {
      const bets = [createMockBet('1', { amount: 1 })];
      const result = validateBetSlip(bets, 0, true, true);
      expect(result?.code).toBe('INSUFFICIENT_FUNDS');
    });
  });
});
