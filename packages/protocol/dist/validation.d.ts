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
/**
 * Valid GameType values: 0-9 (must match Rust enum discriminants)
 * Per Kieran review: use Object.values(GameType).includes(val), not val in GameType
 */
declare const gameTypeSchema: z.ZodEffects<z.ZodNumber, GameType, number>;
/**
 * Bet amount as string with bigint bounds validation
 * Per Kieran review: Add .refine(val => BigInt(val) <= 2n ** 64n - 1n)
 */
declare const betAmountSchema: z.ZodEffects<z.ZodString, string, string>;
/** Session ID as numeric string */
declare const sessionIdSchema: z.ZodString;
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
    sideBets?: {
        type: number;
        amount: string;
    }[] | undefined;
    requestId?: string | undefined;
}, {
    type: "start_game";
    gameType: number;
    bet: string;
    sideBets?: {
        type: number;
        amount: string;
    }[] | undefined;
    requestId?: string | undefined;
}>, {
    type: "start_game";
    gameType: GameType;
    bet: string;
    sideBets?: {
        type: number;
        amount: string;
    }[] | undefined;
    requestId?: string | undefined;
}, {
    type: "start_game";
    gameType: number;
    bet: string;
    sideBets?: {
        type: number;
        amount: string;
    }[] | undefined;
    requestId?: string | undefined;
}>;
/**
 * Game-specific move schemas
 * Each game has its own valid moves that map to encoders
 */
export declare const blackjackMoveSchema: z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"blackjack">;
    move: z.ZodEnum<["hit", "stand", "double", "split", "deal", "surrender"]>;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "game_move";
    sessionId: string;
    game: "blackjack";
    move: "hit" | "stand" | "double" | "split" | "deal" | "surrender";
    requestId?: string | undefined;
}, {
    type: "game_move";
    sessionId: string;
    game: "blackjack";
    move: "hit" | "stand" | "double" | "split" | "deal" | "surrender";
    requestId?: string | undefined;
}>;
export declare const rouletteMoveSchema: z.ZodUnion<[z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"roulette">;
    move: z.ZodLiteral<"place_bet">;
    betType: z.ZodNumber;
    number: z.ZodNumber;
    amount: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    number: number;
    type: "game_move";
    amount: string;
    sessionId: string;
    game: "roulette";
    move: "place_bet";
    betType: number;
    requestId?: string | undefined;
}, {
    number: number;
    type: "game_move";
    amount: string;
    sessionId: string;
    game: "roulette";
    move: "place_bet";
    betType: number;
    requestId?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"roulette">;
    move: z.ZodEnum<["spin", "clear_bets"]>;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "game_move";
    sessionId: string;
    game: "roulette";
    move: "spin" | "clear_bets";
    requestId?: string | undefined;
}, {
    type: "game_move";
    sessionId: string;
    game: "roulette";
    move: "spin" | "clear_bets";
    requestId?: string | undefined;
}>]>;
export declare const crapsMoveSchema: z.ZodUnion<[z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"craps">;
    move: z.ZodLiteral<"place_bet">;
    betType: z.ZodNumber;
    target: z.ZodOptional<z.ZodNumber>;
    amount: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "game_move";
    amount: string;
    sessionId: string;
    game: "craps";
    move: "place_bet";
    betType: number;
    requestId?: string | undefined;
    target?: number | undefined;
}, {
    type: "game_move";
    amount: string;
    sessionId: string;
    game: "craps";
    move: "place_bet";
    betType: number;
    requestId?: string | undefined;
    target?: number | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"craps">;
    move: z.ZodLiteral<"add_odds">;
    amount: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "game_move";
    amount: string;
    sessionId: string;
    game: "craps";
    move: "add_odds";
    requestId?: string | undefined;
}, {
    type: "game_move";
    amount: string;
    sessionId: string;
    game: "craps";
    move: "add_odds";
    requestId?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"craps">;
    move: z.ZodLiteral<"roll">;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "roll";
    requestId?: string | undefined;
}, {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "roll";
    requestId?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"craps">;
    move: z.ZodLiteral<"clear_bets">;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "clear_bets";
    requestId?: string | undefined;
}, {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "clear_bets";
    requestId?: string | undefined;
}>]>;
export declare const gameMoveSchema: z.ZodUnion<[z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"blackjack">;
    move: z.ZodEnum<["hit", "stand", "double", "split", "deal", "surrender"]>;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "game_move";
    sessionId: string;
    game: "blackjack";
    move: "hit" | "stand" | "double" | "split" | "deal" | "surrender";
    requestId?: string | undefined;
}, {
    type: "game_move";
    sessionId: string;
    game: "blackjack";
    move: "hit" | "stand" | "double" | "split" | "deal" | "surrender";
    requestId?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"roulette">;
    move: z.ZodLiteral<"place_bet">;
    betType: z.ZodNumber;
    number: z.ZodNumber;
    amount: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    number: number;
    type: "game_move";
    amount: string;
    sessionId: string;
    game: "roulette";
    move: "place_bet";
    betType: number;
    requestId?: string | undefined;
}, {
    number: number;
    type: "game_move";
    amount: string;
    sessionId: string;
    game: "roulette";
    move: "place_bet";
    betType: number;
    requestId?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"roulette">;
    move: z.ZodEnum<["spin", "clear_bets"]>;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "game_move";
    sessionId: string;
    game: "roulette";
    move: "spin" | "clear_bets";
    requestId?: string | undefined;
}, {
    type: "game_move";
    sessionId: string;
    game: "roulette";
    move: "spin" | "clear_bets";
    requestId?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"craps">;
    move: z.ZodLiteral<"place_bet">;
    betType: z.ZodNumber;
    target: z.ZodOptional<z.ZodNumber>;
    amount: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "game_move";
    amount: string;
    sessionId: string;
    game: "craps";
    move: "place_bet";
    betType: number;
    requestId?: string | undefined;
    target?: number | undefined;
}, {
    type: "game_move";
    amount: string;
    sessionId: string;
    game: "craps";
    move: "place_bet";
    betType: number;
    requestId?: string | undefined;
    target?: number | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"craps">;
    move: z.ZodLiteral<"add_odds">;
    amount: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "game_move";
    amount: string;
    sessionId: string;
    game: "craps";
    move: "add_odds";
    requestId?: string | undefined;
}, {
    type: "game_move";
    amount: string;
    sessionId: string;
    game: "craps";
    move: "add_odds";
    requestId?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"craps">;
    move: z.ZodLiteral<"roll">;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "roll";
    requestId?: string | undefined;
}, {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "roll";
    requestId?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"craps">;
    move: z.ZodLiteral<"clear_bets">;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "clear_bets";
    requestId?: string | undefined;
}, {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "clear_bets";
    requestId?: string | undefined;
}>]>;
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
    sideBets?: {
        type: number;
        amount: string;
    }[] | undefined;
    requestId?: string | undefined;
}, {
    type: "start_game";
    gameType: number;
    bet: string;
    sideBets?: {
        type: number;
        amount: string;
    }[] | undefined;
    requestId?: string | undefined;
}>, {
    type: "start_game";
    gameType: GameType;
    bet: string;
    sideBets?: {
        type: number;
        amount: string;
    }[] | undefined;
    requestId?: string | undefined;
}, {
    type: "start_game";
    gameType: number;
    bet: string;
    sideBets?: {
        type: number;
        amount: string;
    }[] | undefined;
    requestId?: string | undefined;
}>, z.ZodUnion<[z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"blackjack">;
    move: z.ZodEnum<["hit", "stand", "double", "split", "deal", "surrender"]>;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "game_move";
    sessionId: string;
    game: "blackjack";
    move: "hit" | "stand" | "double" | "split" | "deal" | "surrender";
    requestId?: string | undefined;
}, {
    type: "game_move";
    sessionId: string;
    game: "blackjack";
    move: "hit" | "stand" | "double" | "split" | "deal" | "surrender";
    requestId?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"roulette">;
    move: z.ZodLiteral<"place_bet">;
    betType: z.ZodNumber;
    number: z.ZodNumber;
    amount: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    number: number;
    type: "game_move";
    amount: string;
    sessionId: string;
    game: "roulette";
    move: "place_bet";
    betType: number;
    requestId?: string | undefined;
}, {
    number: number;
    type: "game_move";
    amount: string;
    sessionId: string;
    game: "roulette";
    move: "place_bet";
    betType: number;
    requestId?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"roulette">;
    move: z.ZodEnum<["spin", "clear_bets"]>;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "game_move";
    sessionId: string;
    game: "roulette";
    move: "spin" | "clear_bets";
    requestId?: string | undefined;
}, {
    type: "game_move";
    sessionId: string;
    game: "roulette";
    move: "spin" | "clear_bets";
    requestId?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"craps">;
    move: z.ZodLiteral<"place_bet">;
    betType: z.ZodNumber;
    target: z.ZodOptional<z.ZodNumber>;
    amount: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "game_move";
    amount: string;
    sessionId: string;
    game: "craps";
    move: "place_bet";
    betType: number;
    requestId?: string | undefined;
    target?: number | undefined;
}, {
    type: "game_move";
    amount: string;
    sessionId: string;
    game: "craps";
    move: "place_bet";
    betType: number;
    requestId?: string | undefined;
    target?: number | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"craps">;
    move: z.ZodLiteral<"add_odds">;
    amount: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "game_move";
    amount: string;
    sessionId: string;
    game: "craps";
    move: "add_odds";
    requestId?: string | undefined;
}, {
    type: "game_move";
    amount: string;
    sessionId: string;
    game: "craps";
    move: "add_odds";
    requestId?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"craps">;
    move: z.ZodLiteral<"roll">;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "roll";
    requestId?: string | undefined;
}, {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "roll";
    requestId?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"craps">;
    move: z.ZodLiteral<"clear_bets">;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "clear_bets";
    requestId?: string | undefined;
}, {
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "clear_bets";
    requestId?: string | undefined;
}>]>]>;
export { gameTypeSchema, betAmountSchema, sessionIdSchema };
export type ValidatedStartGame = z.infer<typeof startGameSchema>;
export type ValidatedBlackjackMove = z.infer<typeof blackjackMoveSchema>;
export type ValidatedRouletteMove = z.infer<typeof rouletteMoveSchema>;
export type ValidatedCrapsMove = z.infer<typeof crapsMoveSchema>;
export type ValidatedGameMove = z.infer<typeof gameMoveSchema>;
export type ValidatedClientMessage = z.infer<typeof clientMessageSchema>;
//# sourceMappingURL=validation.d.ts.map