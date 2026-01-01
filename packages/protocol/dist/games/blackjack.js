import { z } from 'zod';
import { GameType } from '@nullspace/types';
import { encodeBlackjackMove } from '../encode.js';
import { sessionIdSchema } from '../schema/base.js';
export const blackjackMoveSchema = z.object({
    type: z.literal('game_move'),
    sessionId: sessionIdSchema,
    game: z.literal('blackjack'),
    move: z.enum(['hit', 'stand', 'double', 'split', 'deal', 'surrender']),
    requestId: z.string().optional(),
});
export const blackjackCodec = {
    game: 'blackjack',
    gameType: GameType.Blackjack,
    moveSchema: blackjackMoveSchema,
    moveSchemas: [blackjackMoveSchema],
    encodeMove: (message) => encodeBlackjackMove(message.move),
};
//# sourceMappingURL=blackjack.js.map