/**
 * Zod schemas for validating incoming data.
 * Used by gateway to validate client messages before relaying to chain.
 */
import { z } from 'zod';
import { GameType } from '@nullspace/types';
import { betAmountSchema, gameTypeSchema, sessionIdSchema } from './base.js';
import { blackjackMoveSchema, rouletteMoveSchema, crapsMoveSchema } from '../games/index.js';
export declare const startGameSchema: z.ZodEffects<z.ZodObject<{
    type: z.ZodLiteral<"start_game">;
    gameType: z.ZodEffects<z.ZodNumber, GameType, number>;
    bet: z.ZodEffects<z.ZodString, string, string>;
    sideBets: z.ZodOptional<z.ZodArray<z.ZodObject<{
        type: z.ZodNumber;
        amount: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
    }, "strip", z.ZodTypeAny, {
        type: number;
        amount: string;
    }, {
        type: number;
        amount: string;
    }>, "many">>;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "start_game";
    gameType: GameType;
    bet: string;
    requestId?: string | undefined;
    sideBets?: {
        type: number;
        amount: string;
    }[] | undefined;
}, {
    type: "start_game";
    gameType: number;
    bet: string;
    requestId?: string | undefined;
    sideBets?: {
        type: number;
        amount: string;
    }[] | undefined;
}>, {
    type: "start_game";
    gameType: GameType;
    bet: string;
    requestId?: string | undefined;
    sideBets?: {
        type: number;
        amount: string;
    }[] | undefined;
}, {
    type: "start_game";
    gameType: number;
    bet: string;
    requestId?: string | undefined;
    sideBets?: {
        type: number;
        amount: string;
    }[] | undefined;
}>;
/**
 * Union of all game-specific move schemas
 * Note: Can't use discriminatedUnion since roulette/craps are already unions
 */
export declare const gameMoveSchema: z.ZodUnion<[z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]>;
export declare const clientMessageSchema: z.ZodUnion<[z.ZodEffects<z.ZodObject<{
    type: z.ZodLiteral<"start_game">;
    gameType: z.ZodEffects<z.ZodNumber, GameType, number>;
    bet: z.ZodEffects<z.ZodString, string, string>;
    sideBets: z.ZodOptional<z.ZodArray<z.ZodObject<{
        type: z.ZodNumber;
        amount: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
    }, "strip", z.ZodTypeAny, {
        type: number;
        amount: string;
    }, {
        type: number;
        amount: string;
    }>, "many">>;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "start_game";
    gameType: GameType;
    bet: string;
    requestId?: string | undefined;
    sideBets?: {
        type: number;
        amount: string;
    }[] | undefined;
}, {
    type: "start_game";
    gameType: number;
    bet: string;
    requestId?: string | undefined;
    sideBets?: {
        type: number;
        amount: string;
    }[] | undefined;
}>, {
    type: "start_game";
    gameType: GameType;
    bet: string;
    requestId?: string | undefined;
    sideBets?: {
        type: number;
        amount: string;
    }[] | undefined;
}, {
    type: "start_game";
    gameType: number;
    bet: string;
    requestId?: string | undefined;
    sideBets?: {
        type: number;
        amount: string;
    }[] | undefined;
}>, z.ZodUnion<[z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]>]>;
export { gameTypeSchema, betAmountSchema, sessionIdSchema };
export { blackjackMoveSchema, rouletteMoveSchema, crapsMoveSchema };
export type ValidatedStartGame = z.infer<typeof startGameSchema>;
export type ValidatedBlackjackMove = z.infer<typeof blackjackMoveSchema>;
export type ValidatedRouletteMove = z.infer<typeof rouletteMoveSchema>;
export type ValidatedCrapsMove = z.infer<typeof crapsMoveSchema>;
export type ValidatedGameMove = z.infer<typeof gameMoveSchema>;
export type ValidatedClientMessage = z.infer<typeof clientMessageSchema>;
//# sourceMappingURL=gateway.d.ts.map