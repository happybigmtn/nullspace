import { z } from 'zod';
import { GameType } from '@nullspace/types';
import { encodeCrapsMove } from '../encode.js';
import { positiveBetAmountSchema, sessionIdSchema } from '../schema/base.js';
export const crapsPlaceBetSchema = z.object({
    type: z.literal('game_move'),
    sessionId: sessionIdSchema,
    game: z.literal('craps'),
    move: z.literal('place_bet'),
    betType: z.number().int().min(0),
    target: z.number().int().min(0).max(12).optional(),
    amount: positiveBetAmountSchema, // Required for bets
    requestId: z.string().optional(),
});
export const crapsAddOddsSchema = z.object({
    type: z.literal('game_move'),
    sessionId: sessionIdSchema,
    game: z.literal('craps'),
    move: z.literal('add_odds'),
    amount: positiveBetAmountSchema, // Required for odds
    requestId: z.string().optional(),
});
export const crapsRollSchema = z.object({
    type: z.literal('game_move'),
    sessionId: sessionIdSchema,
    game: z.literal('craps'),
    move: z.literal('roll'),
    requestId: z.string().optional(),
});
export const crapsClearBetsSchema = z.object({
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
export const crapsCodec = {
    game: 'craps',
    gameType: GameType.Craps,
    moveSchema: crapsMoveSchema,
    moveSchemas: [crapsPlaceBetSchema, crapsAddOddsSchema, crapsRollSchema, crapsClearBetsSchema],
    encodeMove: (message) => {
        switch (message.move) {
            case 'place_bet':
                return encodeCrapsMove('place_bet', {
                    betType: message.betType,
                    target: message.target ?? 0,
                    amount: BigInt(message.amount),
                });
            case 'add_odds':
                return encodeCrapsMove('add_odds', BigInt(message.amount));
            case 'roll':
                return encodeCrapsMove('roll');
            case 'clear_bets':
                return encodeCrapsMove('clear_bets');
        }
    },
};
//# sourceMappingURL=craps.js.map