// Barrel export for @nullspace/protocol
export * from './errors.js';
export * from './encode.js';
export * from './decode.js';
export * from './websocket.js';
export * from './validation.js';
export {
  GAME_CODECS,
  GAME_MOVE_SCHEMAS,
  GAME_CODECS_BY_NAME,
  encodeGameMove,
  encodeGameMovePayload,
  encodeAtomicBatchPayload,
} from './games/index.js';
export type {
  GameCodec,
  GatewayGameMove,
  GatewayGameMovePayload,
  AtomicBatchGame,
  BaccaratAtomicBetInput,
  RouletteAtomicBetInput,
  CrapsAtomicBetInput,
  SicBoAtomicBetInput,
} from './games/index.js';
