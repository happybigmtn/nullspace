import { z } from 'zod';
import type { GameCodec } from './types.js';
export declare const crapsPlaceBetSchema: z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"craps">;
    move: z.ZodLiteral<"place_bet">;
    betType: z.ZodNumber;
    target: z.ZodOptional<z.ZodNumber>;
    amount: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    betType: number;
    amount: string;
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "place_bet";
    requestId?: string | undefined;
    target?: number | undefined;
}, {
    betType: number;
    amount: string;
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "place_bet";
    requestId?: string | undefined;
    target?: number | undefined;
}>;
export declare const crapsAddOddsSchema: z.ZodObject<{
    type: z.ZodLiteral<"game_move">;
    sessionId: z.ZodString;
    game: z.ZodLiteral<"craps">;
    move: z.ZodLiteral<"add_odds">;
    amount: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    amount: string;
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "add_odds";
    requestId?: string | undefined;
}, {
    amount: string;
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "add_odds";
    requestId?: string | undefined;
}>;
export declare const crapsRollSchema: z.ZodObject<{
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
}>;
export declare const crapsClearBetsSchema: z.ZodObject<{
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
}>;
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
    betType: number;
    amount: string;
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "place_bet";
    requestId?: string | undefined;
    target?: number | undefined;
}, {
    betType: number;
    amount: string;
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "place_bet";
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
    amount: string;
    type: "game_move";
    sessionId: string;
    game: "craps";
    move: "add_odds";
    requestId?: string | undefined;
}, {
    amount: string;
    type: "game_move";
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
export type CrapsPlaceBetMessage = z.infer<typeof crapsPlaceBetSchema>;
export type CrapsAddOddsMessage = z.infer<typeof crapsAddOddsSchema>;
export type CrapsRollMessage = z.infer<typeof crapsRollSchema>;
export type CrapsClearBetsMessage = z.infer<typeof crapsClearBetsSchema>;
export type CrapsMoveMessage = z.infer<typeof crapsMoveSchema>;
export declare const crapsCodec: GameCodec<typeof crapsMoveSchema, CrapsMoveMessage>;
//# sourceMappingURL=craps.d.ts.map