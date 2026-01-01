/**
 * Shared schema primitives used across protocol layers.
 */
import { z } from 'zod';
import { GameType } from '@nullspace/types';
/** Max value for u64 in Rust */
export const MAX_U64 = 2n ** 64n - 1n;
/**
 * Valid GameType values: 0-9 (must match Rust enum discriminants)
 * Per Kieran review: use Object.values(GameType).includes(val), not val in GameType
 */
export const gameTypeSchema = z.number().int().min(0).max(9).refine((val) => Object.values(GameType).filter((v) => typeof v === 'number').includes(val), { message: 'Invalid game type' });
/**
 * Bet amount as string with bigint bounds validation
 * Per Kieran review: Add .refine(val => BigInt(val) <= 2n ** 64n - 1n)
 */
export const betAmountSchema = z.string().regex(/^\d+$/, 'Bet must be numeric string').refine((val) => {
    try {
        return BigInt(val) <= MAX_U64;
    }
    catch {
        return false;
    }
}, { message: 'Bet exceeds maximum value (u64 max)' });
export const positiveBetAmountSchema = betAmountSchema.refine((val) => {
    try {
        return BigInt(val) > 0n;
    }
    catch {
        return false;
    }
}, { message: 'Bet must be greater than zero' });
/** Session ID as numeric string */
export const sessionIdSchema = z.string().regex(/^\d+$/, 'Session ID must be numeric string');
//# sourceMappingURL=base.js.map