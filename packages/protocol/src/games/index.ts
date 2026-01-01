import { blackjackCodec, blackjackMoveSchema, type BlackjackMoveMessage } from './blackjack.js';
import { rouletteCodec, rouletteMoveSchema, type RouletteMoveMessage } from './roulette.js';
import { crapsCodec, crapsMoveSchema, type CrapsMoveMessage } from './craps.js';
import type { GameCodec } from './types.js';

export const GAME_CODECS = [blackjackCodec, rouletteCodec, crapsCodec] as const;

export type GatewayGameMove = BlackjackMoveMessage | RouletteMoveMessage | CrapsMoveMessage;
export type GatewayGameMovePayload = Omit<GatewayGameMove, 'type' | 'sessionId' | 'requestId'>;

export const GAME_MOVE_SCHEMAS = GAME_CODECS.flatMap((codec) => codec.moveSchemas);

export const GAME_CODECS_BY_NAME = {
  blackjack: blackjackCodec,
  roulette: rouletteCodec,
  craps: crapsCodec,
} satisfies Record<GatewayGameMove['game'], GameCodec<any, any>>;

export function encodeGameMove(message: GatewayGameMove): Uint8Array {
  switch (message.game) {
    case 'blackjack':
      return blackjackCodec.encodeMove(message);
    case 'roulette':
      return rouletteCodec.encodeMove(message);
    case 'craps':
      return crapsCodec.encodeMove(message);
  }
}

export function encodeGameMovePayload(message: GatewayGameMovePayload): Uint8Array {
  return encodeGameMove({
    type: 'game_move',
    sessionId: '0',
    ...message,
  } as GatewayGameMove);
}

export { blackjackMoveSchema, rouletteMoveSchema, crapsMoveSchema };
export * from './blackjack.js';
export * from './roulette.js';
export * from './craps.js';
export * from './atomic.js';
export * from './types.js';
