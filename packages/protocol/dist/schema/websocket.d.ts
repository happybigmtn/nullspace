/**
 * WebSocket message types for mobile <-> gateway communication.
 * The gateway relays these to/from the chain on behalf of mobile clients.
 */
import { z } from 'zod';
import type { clientMessageSchema, startGameSchema, gameMoveSchema } from './gateway.js';
import type { blackjackMoveSchema, rouletteMoveSchema, crapsMoveSchema, roulettePlaceBetSchema, rouletteActionSchema, crapsPlaceBetSchema, crapsAddOddsSchema, crapsRollSchema, crapsClearBetsSchema } from '../games/index.js';
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type StartGameMessage = z.infer<typeof startGameSchema>;
export type BlackjackMoveMessage = z.infer<typeof blackjackMoveSchema>;
export type RoulettePlaceBetMessage = z.infer<typeof roulettePlaceBetSchema>;
export type RouletteActionMessage = z.infer<typeof rouletteActionSchema>;
export type RouletteMoveMessage = z.infer<typeof rouletteMoveSchema>;
export type CrapsPlaceBetMessage = z.infer<typeof crapsPlaceBetSchema>;
export type CrapsAddOddsMessage = z.infer<typeof crapsAddOddsSchema>;
export type CrapsRollMessage = z.infer<typeof crapsRollSchema>;
export type CrapsClearBetsMessage = z.infer<typeof crapsClearBetsSchema>;
export type CrapsMoveMessage = z.infer<typeof crapsMoveSchema>;
export type GameMoveMessage = z.infer<typeof gameMoveSchema>;
export declare const GameStartedMessageSchema: z.ZodObject<{
    type: z.ZodLiteral<"game_started">;
    sessionId: z.ZodString;
    gameType: z.ZodEffects<z.ZodNumber, import("@nullspace/types").GameType, number>;
    initialState: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "game_started";
    sessionId: string;
    gameType: import("@nullspace/types").GameType;
    initialState: string;
}, {
    type: "game_started";
    sessionId: string;
    gameType: number;
    initialState: string;
}>;
export declare const GameStateMessageSchema: z.ZodObject<{
    type: z.ZodLiteral<"game_state">;
    sessionId: z.ZodString;
    state: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "game_state";
    sessionId: string;
    state: string;
}, {
    type: "game_state";
    sessionId: string;
    state: string;
}>;
export declare const GameResultMessageSchema: z.ZodObject<{
    type: z.ZodLiteral<"game_result">;
    sessionId: z.ZodString;
    won: z.ZodBoolean;
    payout: z.ZodString;
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "game_result";
    message: string;
    sessionId: string;
    won: boolean;
    payout: string;
}, {
    type: "game_result";
    message: string;
    sessionId: string;
    won: boolean;
    payout: string;
}>;
export declare const ErrorMessageSchema: z.ZodObject<{
    type: z.ZodLiteral<"error">;
    code: z.ZodString;
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "error";
    code: string;
    message: string;
}, {
    type: "error";
    code: string;
    message: string;
}>;
export declare const ServerMessageSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"game_started">;
    sessionId: z.ZodString;
    gameType: z.ZodEffects<z.ZodNumber, import("@nullspace/types").GameType, number>;
    initialState: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "game_started";
    sessionId: string;
    gameType: import("@nullspace/types").GameType;
    initialState: string;
}, {
    type: "game_started";
    sessionId: string;
    gameType: number;
    initialState: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"game_state">;
    sessionId: z.ZodString;
    state: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "game_state";
    sessionId: string;
    state: string;
}, {
    type: "game_state";
    sessionId: string;
    state: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"game_result">;
    sessionId: z.ZodString;
    won: z.ZodBoolean;
    payout: z.ZodString;
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "game_result";
    message: string;
    sessionId: string;
    won: boolean;
    payout: string;
}, {
    type: "game_result";
    message: string;
    sessionId: string;
    won: boolean;
    payout: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"error">;
    code: z.ZodString;
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "error";
    code: string;
    message: string;
}, {
    type: "error";
    code: string;
    message: string;
}>]>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type GameStartedMessage = z.infer<typeof GameStartedMessageSchema>;
export type GameStateMessage = z.infer<typeof GameStateMessageSchema>;
export type GameResultMessage = z.infer<typeof GameResultMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type AnyClientMessage = StartGameMessage | GameMoveMessage;
export type AnyServerMessage = ServerMessage;
//# sourceMappingURL=websocket.d.ts.map