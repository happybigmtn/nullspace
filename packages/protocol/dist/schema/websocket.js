/**
 * WebSocket message types for mobile <-> gateway communication.
 * The gateway relays these to/from the chain on behalf of mobile clients.
 */
import { z } from 'zod';
import { gameTypeSchema, sessionIdSchema } from './base.js';
// Gateway -> Client messages
export const GameStartedMessageSchema = z.object({
    type: z.literal('game_started'),
    sessionId: sessionIdSchema,
    gameType: gameTypeSchema,
    initialState: z.string(), // base64 encoded state
});
export const GameStateMessageSchema = z.object({
    type: z.literal('game_state'),
    sessionId: sessionIdSchema,
    state: z.string(), // base64 encoded state from chain
});
export const GameResultMessageSchema = z.object({
    type: z.literal('game_result'),
    sessionId: sessionIdSchema,
    won: z.boolean(),
    payout: z.string(),
    message: z.string(),
});
export const ErrorMessageSchema = z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
});
export const ServerMessageSchema = z.discriminatedUnion('type', [
    GameStartedMessageSchema,
    GameStateMessageSchema,
    GameResultMessageSchema,
    ErrorMessageSchema,
]);
//# sourceMappingURL=websocket.js.map