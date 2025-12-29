import { describe, it, expect } from 'vitest';
import {
  encodeBlackjackMove,
  encodeRouletteMove,
  encodeRouletteBet,
  encodeCrapsMove,
  encodeCrapsPlaceBet,
  encodeCrapsAddOdds,
} from '../src/encode.js';
import { readFileSync } from 'fs';

const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/golden-vectors.json', import.meta.url), 'utf8')
) as {
  blackjackMoves: Array<{ move: string; hex: string }>;
  rouletteMoves: Array<{ move: string; hex: string }>;
  rouletteBets: Array<{ betType: number; number: number; amount: string; hex: string }>;
  crapsMoves: Array<{ move: string; hex: string }>;
  crapsPlaceBets: Array<{ betType: number; target: number; amount: string; hex: string }>;
  crapsAddOdds: Array<{ amount: string; hex: string }>;
};

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

describe('protocol encode golden vectors', () => {
  it('encodes blackjack moves', () => {
    for (const { move, hex } of fixtures.blackjackMoves) {
      expect(toHex(encodeBlackjackMove(move as Parameters<typeof encodeBlackjackMove>[0]))).toBe(hex);
    }
  });

  it('encodes roulette moves', () => {
    for (const { move, hex } of fixtures.rouletteMoves) {
      expect(toHex(encodeRouletteMove(move as 'spin' | 'clear_bets'))).toBe(hex);
    }
  });

  it('encodes roulette place_bet payloads', () => {
    for (const { betType, number, amount, hex } of fixtures.rouletteBets) {
      const payload = encodeRouletteBet(betType, number, BigInt(amount));
      expect(toHex(payload)).toBe(hex);
    }
  });

  it('encodes craps moves', () => {
    for (const { move, hex } of fixtures.crapsMoves) {
      expect(toHex(encodeCrapsMove(move as 'roll' | 'clear_bets'))).toBe(hex);
    }
  });

  it('encodes craps place_bet payloads', () => {
    for (const { betType, target, amount, hex } of fixtures.crapsPlaceBets) {
      const payload = encodeCrapsPlaceBet({ betType, target, amount: BigInt(amount) });
      expect(toHex(payload)).toBe(hex);
    }
  });

  it('encodes craps add_odds payloads', () => {
    for (const { amount, hex } of fixtures.crapsAddOdds) {
      expect(toHex(encodeCrapsAddOdds(BigInt(amount)))).toBe(hex);
    }
  });
});
