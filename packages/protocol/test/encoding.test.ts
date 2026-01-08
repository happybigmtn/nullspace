import { describe, it, expect } from 'vitest';
import {
  encodeBlackjackMove,
  encodeRouletteMove,
  encodeRouletteBet,
  encodeRouletteAtomicBatch,
  encodeCrapsMove,
  encodeCrapsPlaceBet,
  encodeCrapsAddOdds,
  encodeCrapsAtomicBatch,
  encodeBaccaratAtomicBatch,
  encodeSicBoAtomicBatch,
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

  it('encodes baccarat atomic batch payloads', () => {
    const payload = encodeBaccaratAtomicBatch([
      { type: 'PLAYER', amount: 5n },
      { type: 'BANKER', amount: 10n },
    ]);
    // Format: [version=01] [opcode=03] [count=02] [bet1: type=00, amount BE] [bet2: type=01, amount BE]
    expect(toHex(payload)).toBe('01030200000000000000000501000000000000000a');
  });

  it('encodes roulette atomic batch payloads', () => {
    const payload = encodeRouletteAtomicBatch([
      { type: 'STRAIGHT', amount: 100n, number: 7 },
      { type: 'RED', amount: 50n },
    ]);
    // Format: [version=01] [opcode=04] [count=02] [bet1: type=00, number=07, amount BE] [bet2: type=01, number=00, amount BE]
    expect(toHex(payload)).toBe('0104020007000000000000006401000000000000000032');
  });

  it('encodes craps atomic batch payloads', () => {
    const payload = encodeCrapsAtomicBatch([
      { type: 'PASS', amount: 10n },
      { type: 'HARDWAY', amount: 25n, target: 4 },
    ]);
    // Format: [version=01] [opcode=04] [count=02] [bet1: type=00, target=00, amount BE] [bet2: type=08, target=00, amount BE]
    // Note: HARDWAY with target 4 maps to betType 8 with target 0 (hardway targets are encoded in the betType)
    expect(toHex(payload)).toBe('0104020000000000000000000a08000000000000000019');
  });

  it('encodes sic bo atomic batch payloads', () => {
    const payload = encodeSicBoAtomicBatch([
      { type: 'BIG', amount: 100n },
      { type: 'SUM', amount: 50n, target: 10 },
    ]);
    // Format: [version=01] [opcode=03] [count=02] [bet1: type=01, target=00, amount BE] [bet2: type=07, target=0a, amount BE]
    expect(toHex(payload)).toBe('01030201000000000000000064070a0000000000000032');
  });

  it('rejects invalid atomic bet types', () => {
    expect(() => encodeBaccaratAtomicBatch([{ type: 'INVALID', amount: 1n }])).toThrow(
      'Invalid bet type: INVALID'
    );
    expect(() => encodeRouletteAtomicBatch([{ type: 'INVALID', amount: 1n }])).toThrow(
      'Invalid bet type: INVALID'
    );
    expect(() => encodeCrapsAtomicBatch([{ type: 'INVALID', amount: 1n }])).toThrow(
      'Invalid bet type: INVALID'
    );
    expect(() => encodeSicBoAtomicBatch([{ type: 'INVALID', amount: 1n }])).toThrow(
      'Invalid bet type: INVALID'
    );
  });
});
