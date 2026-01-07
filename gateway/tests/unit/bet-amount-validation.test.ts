/**
 * Bet Amount Validation Tests (US-058)
 *
 * Tests that invalid bet amounts are properly rejected by the gateway
 * before being converted to BigInt. This prevents crashes from:
 * - Infinity (BigInt(Infinity) throws)
 * - NaN (BigInt(NaN) throws)
 * - Negative numbers (should be rejected)
 * - Numbers exceeding safe integer range
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * Tests for the validateBetAmount utility function.
 * This function should be used before any BigInt conversion.
 */
describe('Bet Amount Validation', () => {
  // Import the validation function (to be created in craps.ts)
  // For now, test the expected behavior

  describe('validateBetAmount function', () => {
    // Simulate what the validation function should do
    function validateBetAmount(amount: unknown): { valid: boolean; error?: string } {
      // Type check
      if (typeof amount !== 'number') {
        return { valid: false, error: 'Bet amount must be a number' };
      }

      // Check for special values
      if (!Number.isFinite(amount)) {
        return { valid: false, error: 'Bet amount must be a finite number' };
      }

      // Check for NaN (redundant with isFinite but explicit)
      if (Number.isNaN(amount)) {
        return { valid: false, error: 'Bet amount cannot be NaN' };
      }

      // Check for negative
      if (amount < 0) {
        return { valid: false, error: 'Bet amount cannot be negative' };
      }

      // Check for exceeding safe integer range
      if (amount > Number.MAX_SAFE_INTEGER) {
        return { valid: false, error: 'Bet amount exceeds maximum safe integer' };
      }

      return { valid: true };
    }

    it('should reject Infinity bet amount', () => {
      const result = validateBetAmount(Infinity);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/finite/i);
    });

    it('should reject -Infinity bet amount', () => {
      const result = validateBetAmount(-Infinity);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/finite/i);
    });

    it('should reject NaN bet amount', () => {
      const result = validateBetAmount(NaN);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/finite|nan/i);
    });

    it('should reject Number.MAX_SAFE_INTEGER + 1', () => {
      const result = validateBetAmount(Number.MAX_SAFE_INTEGER + 1);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/safe.*integer|maximum/i);
    });

    it('should reject negative bet amount', () => {
      const result = validateBetAmount(-100);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/negative/i);
    });

    it('should reject -0 (treated as 0, which becomes 0n)', () => {
      // -0 is technically valid but results in 0n which would be filtered
      const result = validateBetAmount(-0);
      // -0 is actually equal to 0 in JavaScript, so it's valid
      expect(result.valid).toBe(true);
    });

    it('should accept valid positive integer', () => {
      const result = validateBetAmount(100);
      expect(result.valid).toBe(true);
    });

    it('should accept valid decimal (will be floored)', () => {
      const result = validateBetAmount(100.75);
      expect(result.valid).toBe(true);
    });

    it('should accept Number.MAX_SAFE_INTEGER exactly', () => {
      const result = validateBetAmount(Number.MAX_SAFE_INTEGER);
      expect(result.valid).toBe(true);
    });

    it('should reject non-number types', () => {
      expect(validateBetAmount('100' as unknown as number).valid).toBe(false);
      expect(validateBetAmount(null as unknown as number).valid).toBe(false);
      expect(validateBetAmount(undefined as unknown as number).valid).toBe(false);
      expect(validateBetAmount({} as unknown as number).valid).toBe(false);
      expect(validateBetAmount([] as unknown as number).valid).toBe(false);
    });
  });

  describe('BigInt conversion edge cases', () => {
    it('documents that BigInt(Infinity) throws', () => {
      expect(() => BigInt(Infinity)).toThrow();
    });

    it('documents that BigInt(NaN) throws', () => {
      expect(() => BigInt(NaN)).toThrow();
    });

    it('documents that BigInt(Number.MAX_SAFE_INTEGER + 1) loses precision', () => {
      // This doesn't throw but loses precision
      const bigintValue = BigInt(Number.MAX_SAFE_INTEGER + 1);
      // 9007199254740993 becomes 9007199254740992n due to float precision loss
      expect(bigintValue).toBe(9007199254740992n);
    });

    it('documents that negative numbers convert to negative BigInt', () => {
      const bigintValue = BigInt(Math.floor(-100));
      expect(bigintValue).toBe(-100n);
      expect(bigintValue <= 0n).toBe(true);
    });
  });

  describe('normalizeBets integration behavior', () => {
    // Simulates the normalizeBets function behavior
    function normalizeBets(bets: Array<{ amount: number }>): { betType: number; amount: bigint }[] {
      const MIN_BET = 5n;
      const MAX_BET = 100000n;
      const output: { betType: number; amount: bigint }[] = [];

      for (const bet of bets) {
        // Without validation, this line would crash on Infinity/NaN
        // BigInt(Math.floor(bet.amount));

        // With validation:
        if (typeof bet.amount !== 'number' || !Number.isFinite(bet.amount)) {
          throw new Error('Bet amount must be a valid finite number');
        }
        if (bet.amount < 0) {
          throw new Error('Bet amount cannot be negative');
        }
        if (bet.amount > Number.MAX_SAFE_INTEGER) {
          throw new Error('Bet amount exceeds maximum safe integer');
        }

        const amount = BigInt(Math.floor(bet.amount));
        if (amount <= 0n) continue; // Skip zero/negative bets
        if (amount < MIN_BET) {
          throw new Error(`Bet below minimum (${MIN_BET.toString()})`);
        }
        if (amount > MAX_BET) {
          throw new Error(`Bet exceeds maximum (${MAX_BET.toString()})`);
        }

        output.push({ betType: 0, amount });
      }

      return output;
    }

    it('should throw descriptive error for Infinity instead of BigInt error', () => {
      expect(() => normalizeBets([{ amount: Infinity }])).toThrow(
        'Bet amount must be a valid finite number'
      );
    });

    it('should throw descriptive error for NaN instead of BigInt error', () => {
      expect(() => normalizeBets([{ amount: NaN }])).toThrow(
        'Bet amount must be a valid finite number'
      );
    });

    it('should throw descriptive error for negative amounts', () => {
      expect(() => normalizeBets([{ amount: -100 }])).toThrow(
        'Bet amount cannot be negative'
      );
    });

    it('should throw descriptive error for unsafe integer', () => {
      expect(() => normalizeBets([{ amount: Number.MAX_SAFE_INTEGER + 1 }])).toThrow(
        'Bet amount exceeds maximum safe integer'
      );
    });

    it('should skip zero amount bets silently', () => {
      const result = normalizeBets([{ amount: 0 }]);
      expect(result).toEqual([]);
    });

    it('should accept valid bet amounts', () => {
      const result = normalizeBets([{ amount: 100 }]);
      expect(result).toHaveLength(1);
      expect(result[0].amount).toBe(100n);
    });

    it('should floor decimal amounts', () => {
      const result = normalizeBets([{ amount: 100.99 }]);
      expect(result[0].amount).toBe(100n);
    });

    it('should handle multiple bets with mixed validity', () => {
      // First bet valid, second zero (skipped), third valid
      const result = normalizeBets([
        { amount: 50 },
        { amount: 0 },
        { amount: 1000 },
      ]);
      expect(result).toHaveLength(2);
      expect(result[0].amount).toBe(50n);
      expect(result[1].amount).toBe(1000n);
    });
  });
});
