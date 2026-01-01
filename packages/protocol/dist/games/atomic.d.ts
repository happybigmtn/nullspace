import { type BaccaratAtomicBetInput, type RouletteAtomicBetInput, type CrapsAtomicBetInput, type SicBoAtomicBetInput } from '../encode.js';
export type { BaccaratAtomicBetInput, RouletteAtomicBetInput, CrapsAtomicBetInput, SicBoAtomicBetInput };
export type AtomicBatchGame = 'baccarat' | 'roulette' | 'craps' | 'sicbo';
export declare function encodeAtomicBatchPayload(game: 'baccarat', bets: BaccaratAtomicBetInput[]): Uint8Array;
export declare function encodeAtomicBatchPayload(game: 'roulette', bets: RouletteAtomicBetInput[]): Uint8Array;
export declare function encodeAtomicBatchPayload(game: 'craps', bets: CrapsAtomicBetInput[]): Uint8Array;
export declare function encodeAtomicBatchPayload(game: 'sicbo', bets: SicBoAtomicBetInput[]): Uint8Array;
//# sourceMappingURL=atomic.d.ts.map