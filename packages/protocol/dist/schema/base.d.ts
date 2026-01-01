/**
 * Shared schema primitives used across protocol layers.
 */
import { z } from 'zod';
import { GameType } from '@nullspace/types';
/** Max value for u64 in Rust */
export declare const MAX_U64: bigint;
/**
 * Valid GameType values: 0-9 (must match Rust enum discriminants)
 * Per Kieran review: use Object.values(GameType).includes(val), not val in GameType
 */
export declare const gameTypeSchema: z.ZodEffects<z.ZodNumber, GameType, number>;
/**
 * Bet amount as string with bigint bounds validation
 * Per Kieran review: Add .refine(val => BigInt(val) <= 2n ** 64n - 1n)
 */
export declare const betAmountSchema: z.ZodEffects<z.ZodString, string, string>;
export declare const positiveBetAmountSchema: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
/** Session ID as numeric string */
export declare const sessionIdSchema: z.ZodString;
//# sourceMappingURL=base.d.ts.map