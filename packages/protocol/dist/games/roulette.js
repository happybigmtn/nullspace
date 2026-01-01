import { z } from 'zod';
import { GameType } from '@nullspace/types';
import { encodeRouletteMove } from '../encode.js';
import { positiveBetAmountSchema, sessionIdSchema } from '../schema/base.js';
export const roulettePlaceBetSchema = z.object({
    type: z.literal('game_move'),
    sessionId: sessionIdSchema,
    game: z.literal('roulette'),
    move: z.literal('place_bet'),
    betType: z.number().int().min(0), // Required
    number: z.number().int().min(0).max(36), // Required
    amount: positiveBetAmountSchema, // Required
    requestId: z.string().optional(),
});
export const rouletteActionSchema = z.object({
    type: z.literal('game_move'),
    sessionId: sessionIdSchema,
    game: z.literal('roulette'),
    move: z.enum(['spin', 'clear_bets']),
    requestId: z.string().optional(),
});
export const rouletteMoveSchema = z.union([roulettePlaceBetSchema, rouletteActionSchema]);
export const rouletteCodec = {
    game: 'roulette',
    gameType: GameType.Roulette,
    moveSchema: rouletteMoveSchema,
    moveSchemas: [roulettePlaceBetSchema, rouletteActionSchema],
    encodeMove: (message) => {
        switch (message.move) {
            case 'place_bet':
                return encodeRouletteMove('place_bet', {
                    betType: message.betType,
                    number: message.number,
                    amount: BigInt(message.amount),
                });
            case 'spin':
                return encodeRouletteMove('spin');
            case 'clear_bets':
                return encodeRouletteMove('clear_bets');
        }
    },
};
//# sourceMappingURL=roulette.js.map