import { blackjackCodec, blackjackMoveSchema } from './blackjack.js';
import { rouletteCodec, rouletteMoveSchema } from './roulette.js';
import { crapsCodec, crapsMoveSchema } from './craps.js';
export const GAME_CODECS = [blackjackCodec, rouletteCodec, crapsCodec];
export const GAME_MOVE_SCHEMAS = GAME_CODECS.flatMap((codec) => codec.moveSchemas);
export const GAME_CODECS_BY_NAME = {
    blackjack: blackjackCodec,
    roulette: rouletteCodec,
    craps: crapsCodec,
};
export function encodeGameMove(message) {
    switch (message.game) {
        case 'blackjack':
            return blackjackCodec.encodeMove(message);
        case 'roulette':
            return rouletteCodec.encodeMove(message);
        case 'craps':
            return crapsCodec.encodeMove(message);
    }
}
export function encodeGameMovePayload(message) {
    return encodeGameMove({
        type: 'game_move',
        sessionId: '0',
        ...message,
    });
}
export { blackjackMoveSchema, rouletteMoveSchema, crapsMoveSchema };
export * from './blackjack.js';
export * from './roulette.js';
export * from './craps.js';
export * from './atomic.js';
export * from './types.js';
//# sourceMappingURL=index.js.map