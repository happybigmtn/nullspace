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
const gameTypeSchema = z.number().int().min(0).max(9).refine((val) => Object.values(GameType).filter((v) => typeof v === 'number').includes(val), { message: 'Invalid game type' });
/**
 * Bet amount as string with bigint bounds validation
 * Per Kieran review: Add .refine(val => BigInt(val) <= 2n ** 64n - 1n)
 */
const betAmountSchema = z.string().regex(/^\d+$/, 'Bet must be numeric string').refine((val) => {
    try {
        return BigInt(val) <= MAX_U64;
    }
    catch {
        return false;
    }
}, { message: 'Bet exceeds maximum value (u64 max)' });
const positiveBetAmountSchema = betAmountSchema.refine((val) => {
    try {
        return BigInt(val) > 0n;
    }
    catch {
        return false;
    }
}, { message: 'Bet must be greater than zero' });
const ZERO_BET_GAME_TYPES = new Set([
    GameType.Baccarat,
    GameType.Craps,
    GameType.Roulette,
    GameType.SicBo,
]);
/** Session ID as numeric string */
const sessionIdSchema = z.string().regex(/^\d+$/, 'Session ID must be numeric string');
export const startGameSchema = z.object({
    type: z.literal('start_game'),
    gameType: gameTypeSchema,
    bet: betAmountSchema,
    sideBets: z.array(z.object({
        type: z.number().int().min(0).max(255),
        amount: positiveBetAmountSchema,
    })).optional(),
    requestId: z.string().optional(),
}).superRefine((data, ctx) => {
    try {
        if (BigInt(data.bet) === 0n && !ZERO_BET_GAME_TYPES.has(data.gameType)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Bet must be greater than zero',
                path: ['bet'],
            });
        }
    }
    catch {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Bet must be numeric string',
            path: ['bet'],
        });
    }
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
    betType: z.number().int().min(0), // Required
    number: z.number().int().min(0).max(36), // Required
    amount: positiveBetAmountSchema, // Required
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
    amount: positiveBetAmountSchema, // Required for bets
    requestId: z.string().optional(),
});
const crapsAddOddsSchema = z.object({
    type: z.literal('game_move'),
    sessionId: sessionIdSchema,
    game: z.literal('craps'),
    move: z.literal('add_odds'),
    amount: positiveBetAmountSchema, // Required for odds
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
//# sourceMappingURL=validation.js.map