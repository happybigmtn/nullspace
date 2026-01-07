/**
 * US-092: Game result message format validation tests
 *
 * These tests verify the TypeScript interfaces properly define the game_result
 * message format and can distinguish natural blackjack (21 with 2 cards) from
 * regular 21 wins.
 */

import { describe, it, expect } from 'vitest';
import {
  BlackjackGameResultMessageSchema,
  BlackjackGameResultDataSchema,
  BlackjackHandStatusSchema,
  BlackjackDealerSchema,
  BlackjackHandSchema,
  BaseGameResultMessageSchema,
  hasPlayerNaturalBlackjack,
  hasDealerNaturalBlackjack,
  getBlackjackOutcome,
  parseGameResultMessage,
  isBlackjackGameResult,
  type BlackjackGameResultMessage,
  type BlackjackHand,
} from '../src/schema/game-results.js';

// =============================================================================
// TEST FIXTURES
// =============================================================================

/**
 * Sample natural blackjack result (player has A + K = 21 with 2 cards)
 * This pays 3:2, not 1:1
 */
const NATURAL_BLACKJACK_RESULT: BlackjackGameResultMessage = {
  type: 'game_result',
  sessionId: '12345',
  gameType: 2, // GameType.Blackjack
  won: true,
  payout: '150', // 100 bet * 1.5 = 150 return (3:2 payout)
  finalChips: '1150',
  balance: '1150',
  message: 'Blackjack! You win 150!',
  summary: 'P: 21, D: 19',
  netPnl: 50, // Won 50 chips (150 - 100 bet)
  resolvedBets: [{ label: 'HAND', pnl: 50 }],
  hands: [
    {
      cards: [0, 12], // A♠ + K♠
      value: 21,
      soft: true,
      status: 'BLACKJACK', // Natural blackjack indicator
      bet: 100,
      return: 150,
    },
  ],
  dealer: {
    cards: [9, 22], // 10♠ + 10♥
    value: 19,
    blackjack: false,
  },
  sideBet21Plus3: 0,
  sideBet21Plus3Return: 0,
  sideBetReturn: 0,
  sideBetLuckyLadies: 0,
  sideBetLuckyLadiesReturn: 0,
  sideBetPerfectPairs: 0,
  sideBetPerfectPairsReturn: 0,
  sideBetRoyalMatch: 0,
  sideBetRoyalMatchReturn: 0,
  sideBetBustIt: 0,
  sideBetBustItReturn: 0,
  totalReturn: 150,
};

/**
 * Regular 21 win (player hits to 21, pays 1:1)
 */
const REGULAR_21_WIN_RESULT: BlackjackGameResultMessage = {
  type: 'game_result',
  sessionId: '12346',
  gameType: 2,
  won: true,
  payout: '200', // 100 bet * 2 = 200 return (1:1 payout)
  finalChips: '1200',
  balance: '1200',
  message: 'You win 200!',
  summary: 'P: 21, D: 18',
  netPnl: 100,
  resolvedBets: [{ label: 'HAND', pnl: 100 }],
  hands: [
    {
      cards: [9, 5, 6], // 10♠ + 6♠ + 5♠ = 21 (3 cards, not natural)
      value: 21,
      soft: false,
      status: 'STANDING', // Not a natural blackjack
      bet: 100,
      return: 200,
    },
  ],
  dealer: {
    cards: [8, 9], // 9♠ + 9♥
    value: 18,
    blackjack: false,
  },
  sideBet21Plus3: 0,
  sideBet21Plus3Return: 0,
  sideBetReturn: 0,
  sideBetLuckyLadies: 0,
  sideBetLuckyLadiesReturn: 0,
  sideBetPerfectPairs: 0,
  sideBetPerfectPairsReturn: 0,
  sideBetRoyalMatch: 0,
  sideBetRoyalMatchReturn: 0,
  sideBetBustIt: 0,
  sideBetBustItReturn: 0,
  totalReturn: 200,
};

/**
 * Push result (both player and dealer have blackjack)
 */
const BLACKJACK_PUSH_RESULT: BlackjackGameResultMessage = {
  type: 'game_result',
  sessionId: '12347',
  gameType: 2,
  won: false,
  push: true,
  payout: '0',
  finalChips: '1000',
  balance: '1000',
  message: 'Push - bet returned',
  summary: 'P: 21, D: 21',
  netPnl: 0,
  resolvedBets: [{ label: 'HAND', pnl: 0 }],
  hands: [
    {
      cards: [0, 10], // A♠ + J♠
      value: 21,
      soft: true,
      status: 'BLACKJACK',
      bet: 100,
      return: 100, // Bet returned
    },
  ],
  dealer: {
    cards: [13, 22], // A♥ + 10♥
    value: 21,
    blackjack: true, // Dealer also has natural blackjack
  },
  sideBet21Plus3: 0,
  sideBet21Plus3Return: 0,
  sideBetReturn: 0,
  sideBetLuckyLadies: 0,
  sideBetLuckyLadiesReturn: 0,
  sideBetPerfectPairs: 0,
  sideBetPerfectPairsReturn: 0,
  sideBetRoyalMatch: 0,
  sideBetRoyalMatchReturn: 0,
  sideBetBustIt: 0,
  sideBetBustItReturn: 0,
  totalReturn: 100,
};

/**
 * Loss to dealer blackjack
 */
const DEALER_BLACKJACK_LOSS_RESULT: BlackjackGameResultMessage = {
  type: 'game_result',
  sessionId: '12348',
  gameType: 2,
  won: false,
  payout: '-100',
  finalChips: '900',
  balance: '900',
  message: 'You lose!',
  summary: 'P: 18, D: 21',
  netPnl: -100,
  resolvedBets: [{ label: 'HAND', pnl: -100 }],
  hands: [
    {
      cards: [8, 9], // 9♠ + 9♥
      value: 18,
      soft: false,
      status: 'STANDING',
      bet: 100,
      return: 0,
    },
  ],
  dealer: {
    cards: [0, 12], // A♠ + K♠
    value: 21,
    blackjack: true, // Dealer has natural blackjack
  },
  sideBet21Plus3: 0,
  sideBet21Plus3Return: 0,
  sideBetReturn: 0,
  sideBetLuckyLadies: 0,
  sideBetLuckyLadiesReturn: 0,
  sideBetPerfectPairs: 0,
  sideBetPerfectPairsReturn: 0,
  sideBetRoyalMatch: 0,
  sideBetRoyalMatchReturn: 0,
  sideBetBustIt: 0,
  sideBetBustItReturn: 0,
  totalReturn: 0,
};

// =============================================================================
// TESTS
// =============================================================================

describe('US-092: Game result message format validation', () => {
  describe('BlackjackHandStatus distinguishes natural 21 from regular win', () => {
    it('should validate BLACKJACK status for natural 21', () => {
      const result = BlackjackHandStatusSchema.safeParse('BLACKJACK');
      expect(result.success).toBe(true);
      expect(result.data).toBe('BLACKJACK');
    });

    it('should validate all hand status values', () => {
      const statuses = ['PLAYING', 'STANDING', 'BUSTED', 'BLACKJACK', 'SURRENDERED'];
      for (const status of statuses) {
        const result = BlackjackHandStatusSchema.safeParse(status);
        expect(result.success, `Status '${status}' should be valid`).toBe(true);
      }
    });

    it('should reject invalid status values', () => {
      const result = BlackjackHandStatusSchema.safeParse('NATURAL_21');
      expect(result.success).toBe(false);
    });

    it('hasPlayerNaturalBlackjack returns true for BLACKJACK status', () => {
      expect(hasPlayerNaturalBlackjack(NATURAL_BLACKJACK_RESULT)).toBe(true);
    });

    it('hasPlayerNaturalBlackjack returns false for regular 21 win', () => {
      expect(hasPlayerNaturalBlackjack(REGULAR_21_WIN_RESULT)).toBe(false);
    });
  });

  describe('dealer.blackjack field', () => {
    it('should parse dealer blackjack as true when dealer has natural 21', () => {
      const result = BlackjackDealerSchema.safeParse({
        cards: [0, 12], // A♠ + K♠
        value: 21,
        blackjack: true,
      });
      expect(result.success).toBe(true);
      expect(result.data?.blackjack).toBe(true);
    });

    it('should parse dealer blackjack as false when dealer has regular 21', () => {
      const result = BlackjackDealerSchema.safeParse({
        cards: [9, 5, 6], // 10 + 6 + 5 = 21 (not natural)
        value: 21,
        blackjack: false,
      });
      expect(result.success).toBe(true);
      expect(result.data?.blackjack).toBe(false);
    });

    it('hasDealerNaturalBlackjack returns true for dealer BJ', () => {
      expect(hasDealerNaturalBlackjack(DEALER_BLACKJACK_LOSS_RESULT)).toBe(true);
    });

    it('hasDealerNaturalBlackjack returns false when dealer has no BJ', () => {
      expect(hasDealerNaturalBlackjack(NATURAL_BLACKJACK_RESULT)).toBe(false);
    });
  });

  describe('All required fields present: won, push, hands, dealer', () => {
    it('should validate complete blackjack game result with all fields', () => {
      const result = BlackjackGameResultMessageSchema.safeParse(NATURAL_BLACKJACK_RESULT);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.won).toBe(true);
        expect(result.data.push).toBeUndefined();
        expect(result.data.hands).toHaveLength(1);
        expect(result.data.dealer).toBeDefined();
        expect(result.data.dealer?.blackjack).toBe(false);
      }
    });

    it('should validate push result with push field', () => {
      const result = BlackjackGameResultMessageSchema.safeParse(BLACKJACK_PUSH_RESULT);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.won).toBe(false);
        expect(result.data.push).toBe(true);
        expect(result.data.hands?.[0].status).toBe('BLACKJACK');
        expect(result.data.dealer?.blackjack).toBe(true);
      }
    });

    it('should validate hand structure with all required fields', () => {
      const hand: BlackjackHand = {
        cards: [0, 12],
        value: 21,
        soft: true,
        status: 'BLACKJACK',
        bet: 100,
        return: 150,
      };
      const result = BlackjackHandSchema.safeParse(hand);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cards).toEqual([0, 12]);
        expect(result.data.value).toBe(21);
        expect(result.data.soft).toBe(true);
        expect(result.data.status).toBe('BLACKJACK');
        expect(result.data.bet).toBe(100);
        expect(result.data.return).toBe(150);
      }
    });

    it('should reject hand missing required fields', () => {
      const invalidHand = {
        cards: [0, 12],
        value: 21,
        // Missing: soft, status, bet, return
      };
      const result = BlackjackHandSchema.safeParse(invalidHand);
      expect(result.success).toBe(false);
    });

    it('should reject dealer missing blackjack field', () => {
      const invalidDealer = {
        cards: [0, 12],
        value: 21,
        // Missing: blackjack
      };
      const result = BlackjackDealerSchema.safeParse(invalidDealer);
      expect(result.success).toBe(false);
    });
  });

  describe('getBlackjackOutcome helper function', () => {
    it('should return blackjack_win for natural blackjack', () => {
      expect(getBlackjackOutcome(NATURAL_BLACKJACK_RESULT)).toBe('blackjack_win');
    });

    it('should return win for regular 21 win', () => {
      expect(getBlackjackOutcome(REGULAR_21_WIN_RESULT)).toBe('win');
    });

    it('should return push for push result', () => {
      expect(getBlackjackOutcome(BLACKJACK_PUSH_RESULT)).toBe('push');
    });

    it('should return loss for dealer blackjack loss', () => {
      expect(getBlackjackOutcome(DEALER_BLACKJACK_LOSS_RESULT)).toBe('loss');
    });
  });

  describe('BaseGameResultMessage schema', () => {
    it('should validate base game result fields', () => {
      const baseResult = {
        type: 'game_result',
        sessionId: '12345',
        gameType: 2,
        won: true,
        payout: '100',
        extraField: 'allowed', // passthrough
      };
      const result = BaseGameResultMessageSchema.safeParse(baseResult);
      expect(result.success).toBe(true);
    });

    it('should reject missing required fields', () => {
      const invalid = {
        type: 'game_result',
        // Missing: sessionId, gameType, won, payout
      };
      const result = BaseGameResultMessageSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('parseGameResultMessage function', () => {
    it('should parse valid game result message', () => {
      const parsed = parseGameResultMessage(NATURAL_BLACKJACK_RESULT);
      expect(parsed).not.toBeNull();
      expect(parsed?.type).toBe('game_result');
      expect(parsed?.won).toBe(true);
    });

    it('should return null for invalid message', () => {
      const parsed = parseGameResultMessage({ invalid: true });
      expect(parsed).toBeNull();
    });
  });

  describe('isBlackjackGameResult type guard', () => {
    it('should return true for blackjack game result', () => {
      const parsed = parseGameResultMessage(NATURAL_BLACKJACK_RESULT);
      expect(parsed).not.toBeNull();
      if (parsed) {
        expect(isBlackjackGameResult(parsed)).toBe(true);
      }
    });

    it('should return false for non-blackjack game result', () => {
      const rouletteResult = {
        type: 'game_result' as const,
        sessionId: '12345',
        gameType: 4, // GameType.Roulette
        won: true,
        payout: '350',
      };
      const parsed = parseGameResultMessage(rouletteResult);
      expect(parsed).not.toBeNull();
      if (parsed) {
        expect(isBlackjackGameResult(parsed)).toBe(false);
      }
    });
  });

  describe('Complete game result data schema', () => {
    it('should validate complete blackjack log data', () => {
      const logData = {
        summary: 'P: 21, D: 19',
        netPnl: 50,
        resolvedBets: [{ label: 'HAND', pnl: 50 }],
        hands: [
          {
            cards: [0, 12],
            value: 21,
            soft: true,
            status: 'BLACKJACK',
            bet: 100,
            return: 150,
          },
        ],
        dealer: {
          cards: [9, 22],
          value: 19,
          blackjack: false,
        },
        sideBet21Plus3: 0,
        sideBet21Plus3Return: 0,
        sideBetReturn: 0,
        sideBetLuckyLadies: 0,
        sideBetLuckyLadiesReturn: 0,
        sideBetPerfectPairs: 0,
        sideBetPerfectPairsReturn: 0,
        sideBetRoyalMatch: 0,
        sideBetRoyalMatchReturn: 0,
        sideBetBustIt: 0,
        sideBetBustItReturn: 0,
        totalReturn: 150,
      };
      const result = BlackjackGameResultDataSchema.safeParse(logData);
      expect(result.success).toBe(true);
    });
  });
});
