import { describe, it, expect } from 'vitest';
import {
  getBaccaratBetsToPlace,
  serializeBaccaratAtomicBatch,
  serializeRouletteBet,
  serializeRouletteAtomicBatch,
  serializeSicBoAtomicBatch,
} from '../serialization';
import type { BaccaratBet, RouletteBet, SicBoBet } from '../../../types';

describe('services/games serialization', () => {
  it('builds baccarat bet batches', () => {
    const sideBets: BaccaratBet[] = [
      { type: 'TIE', amount: 5 },
      { type: 'P_PAIR', amount: 3 },
    ];
    const bets = getBaccaratBetsToPlace('PLAYER', sideBets, 10);
    expect(bets).toEqual([
      { betType: 0, amount: 10 },
      { betType: 2, amount: 5 },
      { betType: 3, amount: 3 },
    ]);

    const payload = serializeBaccaratAtomicBatch(bets);
    expect(payload[0]).toBe(3);
    expect(payload[1]).toBe(3);
    const view = new DataView(payload.buffer);
    expect(payload[2]).toBe(0);
    expect(Number(view.getBigUint64(3, false))).toBe(10);
  });

  it('serializes roulette atomic batches', () => {
    const bets: RouletteBet[] = [
      { type: 'RED', amount: 10 },
      { type: 'STRAIGHT', target: 7, amount: 5 },
    ];
    const payload = serializeRouletteAtomicBatch(bets);
    expect(payload[0]).toBe(4);
    expect(payload[1]).toBe(2);
    expect(payload[2]).toBe(1);
    expect(payload[3]).toBe(0);
    const view = new DataView(payload.buffer);
    expect(Number(view.getBigUint64(4, false))).toBe(10);
    expect(payload[12]).toBe(0);
    expect(payload[13]).toBe(7);
    expect(Number(view.getBigUint64(14, false))).toBe(5);
  });

  it('rejects invalid bet amounts', () => {
    expect(() => serializeRouletteAtomicBatch([{ type: 'RED', amount: 0 }])).toThrow(
      'bet amount must be > 0',
    );
    expect(() => serializeRouletteAtomicBatch([{ type: 'BLACK', amount: -5 }])).toThrow(
      'bet amount must be > 0',
    );
    expect(() => serializeRouletteBet({ type: 'ODD', amount: Number.NaN })).toThrow(
      'bet amount must be finite',
    );
  });

  it('serializes sic bo atomic batches', () => {
    const bets: SicBoBet[] = [
      { type: 'BIG', amount: 20 },
      { type: 'TRIPLE_SPECIFIC', target: 4, amount: 2 },
    ];
    const payload = serializeSicBoAtomicBatch(bets);
    expect(payload[0]).toBe(3);
    expect(payload[1]).toBe(2);
    const view = new DataView(payload.buffer);
    expect(payload[2]).toBe(1);
    expect(payload[3]).toBe(0);
    expect(Number(view.getBigUint64(4, false))).toBe(20);
    expect(payload[12]).toBe(4);
    expect(payload[13]).toBe(4);
    expect(Number(view.getBigUint64(14, false))).toBe(2);
  });
});
