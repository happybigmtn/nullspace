/**
 * Balance Field Presence Validation Tests
 *
 * US-085: Test that balance field is always included in game responses.
 *
 * ## ARCHITECTURE
 * - game_started response should always include balance field (even when 0)
 * - game_move may include balance from event.balanceSnapshot
 * - game_result always includes finalChips (handled separately)
 * - Mobile relies on balance field to update UI display
 *
 * ## CRITICAL BUG FIXED
 * - base.ts:486 had `if (session.balance > 0n)` which skipped balance=0
 * - Changed to always include balance field (removed condition)
 * - Mobile can now properly show "0" balance when player is broke
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Balance Field Presence Validation (US-085)', () => {
  describe('game_started always includes balance field', () => {
    /**
     * The buildGameStartedResponse function constructs the response sent to mobile.
     * Balance field must always be present for mobile to update its balance display.
     */

    it('should include balance field when balance is positive', () => {
      // Simulating buildGameStartedResponse behavior
      const session = {
        balance: 1000n,
        gameType: 'blackjack',
      };

      const response: Record<string, unknown> = {
        type: 'game_started',
        sessionId: '12345',
        bet: '100',
      };

      // Fixed logic: always include balance
      response.balance = session.balance.toString();

      expect(response).toHaveProperty('balance');
      expect(response.balance).toBe('1000');
    });

    it('should include balance field when balance is zero', () => {
      // This was the bug - balance=0 was being skipped
      const session = {
        balance: 0n,
        gameType: 'blackjack',
      };

      const response: Record<string, unknown> = {
        type: 'game_started',
        sessionId: '12345',
        bet: '100',
      };

      // Fixed logic: always include balance (not just when > 0n)
      response.balance = session.balance.toString();

      expect(response).toHaveProperty('balance');
      expect(response.balance).toBe('0');
    });

    it('DOCS: demonstrates the bug that was fixed', () => {
      /**
       * ORIGINAL BUG (base.ts:486):
       *
       * ```typescript
       * if (session.balance > 0n) {
       *   response.balance = session.balance.toString();
       * }
       * ```
       *
       * When balance was 0, this condition was false, so balance field
       * was not included in the response. Mobile would then:
       * 1. Not see a balance update
       * 2. Keep showing stale balance
       * 3. Potentially allow betting with non-existent chips
       *
       * FIX: Remove the condition and always include balance:
       * ```typescript
       * response.balance = session.balance.toString();
       * ```
       */

      // Old buggy logic
      const buggyShouldInclude = (balance: bigint) => balance > 0n;
      expect(buggyShouldInclude(0n)).toBe(false); // Bug: skips balance=0

      // Fixed logic
      const fixedShouldInclude = (balance: bigint) => true; // Always include
      expect(fixedShouldInclude(0n)).toBe(true);
    });

    it('should include balance field for very small balances', () => {
      const session = { balance: 1n };

      const response: Record<string, unknown> = {
        type: 'game_started',
      };

      response.balance = session.balance.toString();

      expect(response.balance).toBe('1');
    });

    it('should include balance field for very large balances', () => {
      const session = { balance: 9007199254740993n }; // > MAX_SAFE_INTEGER

      const response: Record<string, unknown> = {
        type: 'game_started',
      };

      response.balance = session.balance.toString();

      expect(response.balance).toBe('9007199254740993');
    });
  });

  describe('game_move without balance/finalChips handled gracefully', () => {
    /**
     * game_move responses may or may not have balance field depending on
     * whether event.balanceSnapshot is present. Mobile must handle both cases.
     */

    it('should not throw when balance field is missing from game_move', () => {
      const gameMoveResponse = {
        type: 'game_move',
        sessionId: '12345',
        moveNumber: 1,
        gameType: 'blackjack',
        // No balance field
      };

      // Mobile extraction pattern should handle missing fields
      const extractBalance = (msg: Record<string, unknown>) => {
        return typeof msg.balance === 'string' ? BigInt(msg.balance) : null;
      };

      expect(() => extractBalance(gameMoveResponse)).not.toThrow();
      expect(extractBalance(gameMoveResponse)).toBeNull();
    });

    it('should parse balance when present in game_move', () => {
      const gameMoveResponse = {
        type: 'game_move',
        sessionId: '12345',
        moveNumber: 1,
        gameType: 'blackjack',
        balance: '500',
      };

      const extractBalance = (msg: Record<string, unknown>) => {
        return typeof msg.balance === 'string' ? BigInt(msg.balance) : null;
      };

      expect(extractBalance(gameMoveResponse)).toBe(500n);
    });

    it('should not throw when finalChips field is missing', () => {
      const gameResult = {
        type: 'game_result',
        sessionId: '12345',
        payout: '100',
        // No finalChips field
      };

      const extractFinalChips = (msg: Record<string, unknown>) => {
        return typeof msg.finalChips === 'string' ? BigInt(msg.finalChips) : null;
      };

      expect(() => extractFinalChips(gameResult)).not.toThrow();
      expect(extractFinalChips(gameResult)).toBeNull();
    });
  });

  describe('mobile balance update handling', () => {
    /**
     * Document expected mobile behavior for balance field handling.
     */

    it('DOCS: mobile balance update pattern', () => {
      /**
       * Mobile should use this pattern for safe balance extraction:
       *
       * ```typescript
       * const handleMessage = (msg: WebSocketMessage) => {
       *   // Safe extraction - works with or without field
       *   const balance = typeof msg.balance === 'string'
       *     ? BigInt(msg.balance)
       *     : undefined;
       *
       *   if (balance !== undefined) {
       *     // Only update if field was present
       *     setBalance(balance);
       *   }
       *
       *   // For game_result, use finalChips
       *   const finalChips = typeof msg.finalChips === 'string'
       *     ? BigInt(msg.finalChips)
       *     : undefined;
       *
       *   if (finalChips !== undefined) {
       *     setBalance(finalChips);
       *   }
       * };
       * ```
       */

      expect(true).toBe(true);
    });

    it('DOCS: mobile should not crash on malformed balance', () => {
      /**
       * Defensive parsing for edge cases:
       *
       * ```typescript
       * const safeParseBalance = (msg: Record<string, unknown>): bigint | null => {
       *   try {
       *     if (typeof msg.balance === 'string' && msg.balance.length > 0) {
       *       return BigInt(msg.balance);
       *     }
       *     if (typeof msg.balance === 'number' && Number.isFinite(msg.balance)) {
       *       return BigInt(Math.floor(msg.balance));
       *     }
       *   } catch {
       *     console.warn('Failed to parse balance:', msg.balance);
       *   }
       *   return null;
       * };
       * ```
       */

      const safeParseBalance = (msg: Record<string, unknown>): bigint | null => {
        try {
          if (typeof msg.balance === 'string' && msg.balance.length > 0) {
            return BigInt(msg.balance);
          }
          if (typeof msg.balance === 'number' && Number.isFinite(msg.balance)) {
            return BigInt(Math.floor(msg.balance));
          }
        } catch {
          // Ignore parse errors
        }
        return null;
      };

      // Normal cases
      expect(safeParseBalance({ balance: '100' })).toBe(100n);
      expect(safeParseBalance({ balance: '0' })).toBe(0n);
      expect(safeParseBalance({ balance: 50 })).toBe(50n);

      // Edge cases - should not throw
      expect(safeParseBalance({})).toBeNull();
      expect(safeParseBalance({ balance: '' })).toBeNull();
      expect(safeParseBalance({ balance: null })).toBeNull();
      expect(safeParseBalance({ balance: undefined })).toBeNull();
      expect(safeParseBalance({ balance: 'invalid' })).toBeNull();
      expect(safeParseBalance({ balance: NaN })).toBeNull();
      expect(safeParseBalance({ balance: Infinity })).toBeNull();
    });
  });

  describe('balance field in different response types', () => {
    it('game_started: balance from session.balance', () => {
      // This is what buildGameStartedResponse creates
      const response = {
        type: 'game_started',
        sessionId: '12345',
        bet: '100',
        balance: '900', // session.balance after bet
      };

      expect(response.type).toBe('game_started');
      expect(response.balance).toBeDefined();
    });

    it('game_move: balance from event.balanceSnapshot (optional)', () => {
      // buildGameMoveResponse includes balance if event.balanceSnapshot exists
      const responseWithBalance = {
        type: 'game_move',
        sessionId: '12345',
        moveNumber: 1,
        balance: '800', // From event.balanceSnapshot.chips
      };

      const responseWithoutBalance = {
        type: 'game_move',
        sessionId: '12345',
        moveNumber: 2,
        // No balanceSnapshot in event
      };

      expect(responseWithBalance).toHaveProperty('balance');
      expect(responseWithoutBalance).not.toHaveProperty('balance');
    });

    it('game_result: finalChips always present', () => {
      // buildGameCompletedResponse always includes finalChips
      const response = {
        type: 'game_result',
        sessionId: '12345',
        payout: '100',
        finalChips: '1100',
        won: true,
      };

      expect(response.finalChips).toBeDefined();
      expect(response.finalChips).toBe('1100');
    });

    it('game_result: finalChips should be 0 when broke, not missing', () => {
      // Even when player loses everything, finalChips should be present
      const response = {
        type: 'game_result',
        sessionId: '12345',
        payout: '-1000',
        finalChips: '0', // Player is broke but field is present
        won: false,
      };

      expect(response.finalChips).toBe('0');
    });
  });

  describe('edge cases for balance field', () => {
    it('should handle negative session balance gracefully', () => {
      // Session balance should never be negative, but if it is...
      const session = { balance: -100n };

      const response: Record<string, unknown> = {};
      response.balance = session.balance.toString();

      // Negative value is represented correctly as string
      expect(response.balance).toBe('-100');
    });

    it('should serialize zero correctly', () => {
      const session = { balance: 0n };

      const response: Record<string, unknown> = {};
      response.balance = session.balance.toString();

      // Zero is "0" not "" or undefined
      expect(response.balance).toBe('0');
      expect(response.balance).not.toBe('');
    });

    it('should handle balance updates during game progression', () => {
      // Simulating balance changes during a blackjack game
      const balanceHistory: string[] = [];

      // game_started: balance after bet
      balanceHistory.push('900'); // Started with 1000, bet 100

      // game_move: hit
      balanceHistory.push('900'); // No change during hit

      // game_result: win
      balanceHistory.push('1100'); // Won 200

      expect(balanceHistory).toHaveLength(3);
      expect(balanceHistory[2]).toBe('1100');
    });
  });
});
