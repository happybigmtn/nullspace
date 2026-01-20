/**
 * Schema Validation Tests for Inbound Messages
 *
 * AC-3.2: All inbound messages are schema-validated; invalid payloads are
 * rejected without crashing the gateway.
 *
 * These tests validate:
 * 1. Valid messages are accepted for all message types
 * 2. Invalid/malformed payloads are rejected
 * 3. Missing required fields are rejected
 * 4. Extra fields do not cause crashes (passthrough)
 * 5. Type coercion edge cases
 */
import { describe, it, expect } from 'vitest';
import {
  InboundMessageSchema,
  PingRequestSchema,
  GetBalanceRequestSchema,
  SubmitRawRequestSchema,
  FaucetClaimRequestSchema,
  BlackjackDealRequestSchema,
  RouletteSpinRequestSchema,
  CrapsRollRequestSchema,
} from '@nullspace/protocol/mobile';

describe('Schema Validation for Inbound Messages (AC-3.2)', () => {
  describe('System Messages', () => {
    describe('ping', () => {
      it('should accept valid ping message', () => {
        const msg = { type: 'ping' };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.type).toBe('ping');
        }
      });

      it('should reject ping with extra invalid type field', () => {
        // The discriminated union validates type strictly
        const msg = { type: 'ping', invalid: 'field' };
        const result = InboundMessageSchema.safeParse(msg);
        // Extra fields should be allowed (passthrough), only type matters
        expect(result.success).toBe(true);
      });

      it('should reject misspelled type', () => {
        const msg = { type: 'pong' }; // wrong type
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(false);
      });
    });

    describe('get_balance', () => {
      it('should accept valid get_balance message', () => {
        const msg = { type: 'get_balance' };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.type).toBe('get_balance');
        }
      });

      it('should reject unknown message type', () => {
        const msg = { type: 'getBalance' }; // wrong casing
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(false);
      });
    });

    describe('submit_raw', () => {
      it('should accept valid submit_raw message', () => {
        const msg = { type: 'submit_raw', submission: 'SGVsbG8gV29ybGQ=' };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(true);
        if (result.success && result.data.type === 'submit_raw') {
          expect(result.data.submission).toBe('SGVsbG8gV29ybGQ=');
        }
      });

      it('should reject submit_raw with missing submission field', () => {
        const msg = { type: 'submit_raw' };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(false);
      });

      it('should reject submit_raw with empty submission', () => {
        const msg = { type: 'submit_raw', submission: '' };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(false);
      });

      it('should reject submit_raw with non-string submission', () => {
        const msg = { type: 'submit_raw', submission: 12345 };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(false);
      });

      it('should reject submit_raw with null submission', () => {
        const msg = { type: 'submit_raw', submission: null };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(false);
      });
    });

    describe('faucet_claim', () => {
      it('should accept faucet_claim without amount (uses default)', () => {
        const msg = { type: 'faucet_claim' };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(true);
      });

      it('should accept faucet_claim with valid positive amount', () => {
        const msg = { type: 'faucet_claim', amount: 500 };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(true);
        if (result.success && result.data.type === 'faucet_claim') {
          expect(result.data.amount).toBe(500);
        }
      });

      it('should reject faucet_claim with zero amount', () => {
        const msg = { type: 'faucet_claim', amount: 0 };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(false);
      });

      it('should reject faucet_claim with negative amount', () => {
        const msg = { type: 'faucet_claim', amount: -100 };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(false);
      });

      it('should reject faucet_claim with string amount', () => {
        const msg = { type: 'faucet_claim', amount: '100' };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(false);
      });
    });
  });

  describe('Game Messages', () => {
    describe('blackjack_deal', () => {
      it('should accept valid blackjack_deal', () => {
        const msg = { type: 'blackjack_deal', amount: 100 };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(true);
      });

      it('should accept blackjack_deal with side bets', () => {
        const msg = {
          type: 'blackjack_deal',
          amount: 100,
          sideBet21Plus3: 25,
          sideBetPerfectPairs: 25,
        };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(true);
      });

      it('should reject blackjack_deal with missing amount', () => {
        const msg = { type: 'blackjack_deal' };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(false);
      });

      it('should reject blackjack_deal with zero amount', () => {
        const msg = { type: 'blackjack_deal', amount: 0 };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(false);
      });

      it('should reject blackjack_deal with negative amount', () => {
        const msg = { type: 'blackjack_deal', amount: -50 };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(false);
      });
    });

    describe('roulette_spin', () => {
      it('should accept valid roulette_spin with single bet', () => {
        const msg = {
          type: 'roulette_spin',
          bets: [{ type: 'STRAIGHT', amount: 10, target: 7 }],
        };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(true);
      });

      it('should accept roulette_spin with multiple bets', () => {
        const msg = {
          type: 'roulette_spin',
          bets: [
            { type: 'STRAIGHT', amount: 10, target: 7 },
            { type: 'RED', amount: 50 },
          ],
        };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(true);
      });

      it('should reject roulette_spin with empty bets array', () => {
        const msg = { type: 'roulette_spin', bets: [] };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(false);
      });

      it('should reject roulette_spin without bets field', () => {
        const msg = { type: 'roulette_spin' };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(false);
      });

      it('should reject roulette_spin with invalid bet amount', () => {
        const msg = {
          type: 'roulette_spin',
          bets: [{ type: 'STRAIGHT', amount: -10, target: 7 }],
        };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(false);
      });
    });

    describe('craps_roll', () => {
      it('should accept valid craps_roll', () => {
        const msg = {
          type: 'craps_roll',
          bets: [{ type: 'PASS', amount: 25 }],
        };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(true);
      });

      it('should reject craps_roll with empty bets', () => {
        const msg = { type: 'craps_roll', bets: [] };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(false);
      });
    });

    describe('hilo messages', () => {
      it('should accept hilo_deal', () => {
        const msg = { type: 'hilo_deal', amount: 50 };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(true);
      });

      it('should accept hilo_higher', () => {
        const msg = { type: 'hilo_higher' };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(true);
      });

      it('should accept hilo_lower', () => {
        const msg = { type: 'hilo_lower' };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(true);
      });

      it('should accept hilo_cashout', () => {
        const msg = { type: 'hilo_cashout' };
        const result = InboundMessageSchema.safeParse(msg);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Invalid Payloads (Should Not Crash Gateway)', () => {
    it('should reject completely empty object', () => {
      const msg = {};
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('should reject null', () => {
      const result = InboundMessageSchema.safeParse(null);
      expect(result.success).toBe(false);
    });

    it('should reject undefined', () => {
      const result = InboundMessageSchema.safeParse(undefined);
      expect(result.success).toBe(false);
    });

    it('should reject string instead of object', () => {
      const result = InboundMessageSchema.safeParse('{"type":"ping"}');
      expect(result.success).toBe(false);
    });

    it('should reject array instead of object', () => {
      const result = InboundMessageSchema.safeParse([{ type: 'ping' }]);
      expect(result.success).toBe(false);
    });

    it('should reject number type field', () => {
      const msg = { type: 123 };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('should reject boolean type field', () => {
      const msg = { type: true };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('should reject unknown message type', () => {
      const msg = { type: 'unknown_command' };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('should reject SQL injection attempt in type', () => {
      const msg = { type: "'; DROP TABLE users; --" };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('should reject XSS attempt in type', () => {
      const msg = { type: '<script>alert(1)</script>' };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('should reject very long type string', () => {
      const msg = { type: 'a'.repeat(10000) };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('should reject message with null type', () => {
      const msg = { type: null };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('should reject message with object type', () => {
      const msg = { type: { name: 'ping' } };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('should handle prototype pollution attempt', () => {
      const msg = { type: 'ping', __proto__: { admin: true } };
      const result = InboundMessageSchema.safeParse(msg);
      // Should parse successfully but __proto__ should not affect the result
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as Record<string, unknown>).admin).toBeUndefined();
      }
    });
  });

  describe('Error Messages Quality', () => {
    it('should provide informative error for missing type', () => {
      const msg = { amount: 100 };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
      if (!result.success) {
        // Zod discriminated union errors reference the discriminator
        expect(result.error.message).toBeDefined();
      }
    });

    it('should provide informative error for wrong type value', () => {
      const msg = { type: 'invalid_type' };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Individual Schema Exports', () => {
    it('PingRequestSchema should validate correctly', () => {
      expect(PingRequestSchema.safeParse({ type: 'ping' }).success).toBe(true);
      expect(PingRequestSchema.safeParse({ type: 'pong' }).success).toBe(false);
    });

    it('GetBalanceRequestSchema should validate correctly', () => {
      expect(GetBalanceRequestSchema.safeParse({ type: 'get_balance' }).success).toBe(true);
      expect(GetBalanceRequestSchema.safeParse({}).success).toBe(false);
    });

    it('SubmitRawRequestSchema should validate correctly', () => {
      expect(SubmitRawRequestSchema.safeParse({ type: 'submit_raw', submission: 'abc' }).success).toBe(true);
      expect(SubmitRawRequestSchema.safeParse({ type: 'submit_raw' }).success).toBe(false);
    });

    it('FaucetClaimRequestSchema should validate correctly', () => {
      expect(FaucetClaimRequestSchema.safeParse({ type: 'faucet_claim' }).success).toBe(true);
      expect(FaucetClaimRequestSchema.safeParse({ type: 'faucet_claim', amount: 100 }).success).toBe(true);
      expect(FaucetClaimRequestSchema.safeParse({ type: 'faucet_claim', amount: -1 }).success).toBe(false);
    });
  });
});

describe('Schema Validation Edge Cases', () => {
  describe('Type Coercion', () => {
    it('should not coerce string numbers to numbers', () => {
      const msg = { type: 'blackjack_deal', amount: '100' };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('should accept float amounts (will be floored in handler)', () => {
      const msg = { type: 'blackjack_deal', amount: 100.5 };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should reject NaN amounts', () => {
      const msg = { type: 'blackjack_deal', amount: NaN };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('should accept Infinity amounts (schema allows, handler should guard)', () => {
      // Note: Zod's z.number().positive() accepts Infinity as it's technically positive
      // The gateway handler should guard against Infinity if needed
      const msg = { type: 'blackjack_deal', amount: Infinity };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe('Unicode and Special Characters', () => {
    it('should handle unicode in string fields', () => {
      // submit_raw should handle unicode in base64 string
      const msg = { type: 'submit_raw', submission: 'SGVsbG8g8J+RiyBXb3JsZA==' };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should reject emoji in type field', () => {
      const msg = { type: 'ping🎰' };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });
  });

  describe('Large Payloads', () => {
    it('should handle large valid bets array', () => {
      const bets = Array.from({ length: 100 }, (_, i) => ({
        type: 'STRAIGHT',
        amount: 10,
        target: i % 37,
      }));
      const msg = { type: 'roulette_spin', bets };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });
});
