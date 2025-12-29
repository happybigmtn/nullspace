/**
 * Zod schemas for validating incoming data.
 * Used by gateway to validate client messages before relaying to chain.
 *
 * IMPORTANT: Do NOT use z.nativeEnum() for numeric enums - it accepts
 * both numbers AND string keys (e.g., "Blackjack"), which breaks encoding.
 * Use z.number() with explicit range instead.
 */

import { z } from 'zod';
import { GameType } from '@nullspace/types';

/** Max value for u64 in Rust */
const MAX_U64 = 2n ** 64n - 1n;

/**
 * Valid GameType values: 0-9 (must match Rust enum discriminants)
 * Per Kieran review: use Object.values(GameType).includes(val), not val in GameType
 */
const gameTypeSchema = z.number().int().min(0).max(9).refine(
  (val): val is GameType => Object.values(GameType).filter((v): v is number => typeof v === 'number').includes(val),
  { message: 'Invalid game type' }
);

/**
 * Bet amount as string with bigint bounds validation
 * Per Kieran review: Add .refine(val => BigInt(val) <= 2n ** 64n - 1n)
 */
const betAmountSchema = z.string().regex(/^\d+$/, 'Bet must be numeric string').refine(
  (val) => {
    try {
      return BigInt(val) <= MAX_U64;
    } catch {
      return false;
    }
  },
  { message: 'Bet exceeds maximum value (u64 max)' }
);

/** Session ID as numeric string */
const sessionIdSchema = z.string().regex(/^\d+$/, 'Session ID must be numeric string');

export const startGameSchema = z.object({
  type: z.literal('start_game'),
  gameType: gameTypeSchema,
  bet: betAmountSchema,
  sideBets: z.array(z.object({
    type: z.number().int().min(0).max(255),
    amount: betAmountSchema,
  })).optional(),
  requestId: z.string().optional(),
});

/**
 * Game-specific move schemas
 * Each game has its own valid moves that map to encoders
 */
export const blackjackMoveSchema = z.object({
  type: z.literal('game_move'),
  sessionId: sessionIdSchema,
  game: z.literal('blackjack'),
  move: z.enum(['hit', 'stand', 'double', 'split', 'deal', 'surrender']),
  requestId: z.string().optional(),
});

// Roulette: place_bet requires betType, number, amount; others don't
const roulettePlaceBetSchema = z.object({
  type: z.literal('game_move'),
  sessionId: sessionIdSchema,
  game: z.literal('roulette'),
  move: z.literal('place_bet'),
  betType: z.number().int().min(0),       // Required
  number: z.number().int().min(0).max(36), // Required
  amount: betAmountSchema,                 // Required
  requestId: z.string().optional(),
});

const rouletteActionSchema = z.object({
  type: z.literal('game_move'),
  sessionId: sessionIdSchema,
  game: z.literal('roulette'),
  move: z.enum(['spin', 'clear_bets']),
  requestId: z.string().optional(),
});

export const rouletteMoveSchema = z.union([roulettePlaceBetSchema, rouletteActionSchema]);

// Craps: place_bet/add_odds require amount; roll/clear_bets don't
const crapsPlaceBetSchema = z.object({
  type: z.literal('game_move'),
  sessionId: sessionIdSchema,
  game: z.literal('craps'),
  move: z.literal('place_bet'),
  betType: z.number().int().min(0),
  target: z.number().int().min(0).max(12).optional(),
  amount: betAmountSchema,                 // Required for bets
  requestId: z.string().optional(),
});

const crapsAddOddsSchema = z.object({
  type: z.literal('game_move'),
  sessionId: sessionIdSchema,
  game: z.literal('craps'),
  move: z.literal('add_odds'),
  amount: betAmountSchema,                 // Required for odds
  requestId: z.string().optional(),
});

const crapsRollSchema = z.object({
  type: z.literal('game_move'),
  sessionId: sessionIdSchema,
  game: z.literal('craps'),
  move: z.literal('roll'),
  requestId: z.string().optional(),
});

const crapsClearBetsSchema = z.object({
  type: z.literal('game_move'),
  sessionId: sessionIdSchema,
  game: z.literal('craps'),
  move: z.literal('clear_bets'),
  requestId: z.string().optional(),
});

export const crapsMoveSchema = z.union([
  crapsPlaceBetSchema,
  crapsAddOddsSchema,
  crapsRollSchema,
  crapsClearBetsSchema,
]);

// Union of all game-specific move schemas
// Note: Can't use discriminatedUnion since roulette/craps are already unions
export const gameMoveSchema = z.union([
  blackjackMoveSchema,
  roulettePlaceBetSchema,
  rouletteActionSchema,
  crapsPlaceBetSchema,
  crapsAddOddsSchema,
  crapsRollSchema,
  crapsClearBetsSchema,
]);

export const clientMessageSchema = z.union([
  startGameSchema,
  gameMoveSchema,
]);

// Export individual schemas for direct use
export { gameTypeSchema, betAmountSchema, sessionIdSchema };

// Inferred types from schemas
export type ValidatedStartGame = z.infer<typeof startGameSchema>;
export type ValidatedBlackjackMove = z.infer<typeof blackjackMoveSchema>;
export type ValidatedRouletteMove = z.infer<typeof rouletteMoveSchema>;
export type ValidatedCrapsMove = z.infer<typeof crapsMoveSchema>;
export type ValidatedGameMove = z.infer<typeof gameMoveSchema>;
export type ValidatedClientMessage = z.infer<typeof clientMessageSchema>;
