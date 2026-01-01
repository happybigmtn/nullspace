import { z } from 'zod';
import type { GameCodec } from './types.js';
export declare const roulettePlaceBetSchema: z.ZodObject<{
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
    betType: number;
    amount: string;
    type: "game_move";
    sessionId: string;
    game: "roulette";
    move: "place_bet";
    requestId?: string | undefined;
}, {
    number: number;
    betType: number;
    amount: string;
    type: "game_move";
    sessionId: string;
    game: "roulette";
    move: "place_bet";
    requestId?: string | undefined;
}>;
export declare const rouletteActionSchema: z.ZodObject<{
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
    betType: number;
    amount: string;
    type: "game_move";
    sessionId: string;
    game: "roulette";
    move: "place_bet";
    requestId?: string | undefined;
}, {
    number: number;
    betType: number;
    amount: string;
    type: "game_move";
    sessionId: string;
    game: "roulette";
    move: "place_bet";
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
export type RoulettePlaceBetMessage = z.infer<typeof roulettePlaceBetSchema>;
export type RouletteActionMessage = z.infer<typeof rouletteActionSchema>;
export type RouletteMoveMessage = z.infer<typeof rouletteMoveSchema>;
export declare const rouletteCodec: GameCodec<typeof rouletteMoveSchema, RouletteMoveMessage>;
//# sourceMappingURL=roulette.d.ts.map