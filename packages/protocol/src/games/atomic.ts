import {
  encodeBaccaratAtomicBatch,
  encodeRouletteAtomicBatch,
  encodeCrapsAtomicBatch,
  encodeSicBoAtomicBatch,
  type BaccaratAtomicBetInput,
  type RouletteAtomicBetInput,
  type CrapsAtomicBetInput,
  type SicBoAtomicBetInput,
} from '../encode.js';

export type { BaccaratAtomicBetInput, RouletteAtomicBetInput, CrapsAtomicBetInput, SicBoAtomicBetInput };

export type AtomicBatchGame = 'baccarat' | 'roulette' | 'craps' | 'sicbo';

export function encodeAtomicBatchPayload(
  game: 'baccarat',
  bets: BaccaratAtomicBetInput[]
): Uint8Array;
export function encodeAtomicBatchPayload(
  game: 'roulette',
  bets: RouletteAtomicBetInput[]
): Uint8Array;
export function encodeAtomicBatchPayload(
  game: 'craps',
  bets: CrapsAtomicBetInput[]
): Uint8Array;
export function encodeAtomicBatchPayload(
  game: 'sicbo',
  bets: SicBoAtomicBetInput[]
): Uint8Array;
export function encodeAtomicBatchPayload(
  game: AtomicBatchGame,
  bets: BaccaratAtomicBetInput[] | RouletteAtomicBetInput[] | CrapsAtomicBetInput[] | SicBoAtomicBetInput[]
): Uint8Array {
  switch (game) {
    case 'baccarat':
      return encodeBaccaratAtomicBatch(bets as BaccaratAtomicBetInput[]);
    case 'roulette':
      return encodeRouletteAtomicBatch(bets as RouletteAtomicBetInput[]);
    case 'craps':
      return encodeCrapsAtomicBatch(bets as CrapsAtomicBetInput[]);
    case 'sicbo':
      return encodeSicBoAtomicBatch(bets as SicBoAtomicBetInput[]);
  }
}
