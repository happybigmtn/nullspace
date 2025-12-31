import { describe, it, expect } from 'vitest';
import {
  calculateCrapsExposure,
  calculateRouletteExposure,
  calculateSicBoCombinationExposure,
  calculateSicBoTotalExposure,
} from '../gameUtils';
import type { CrapsBet, RouletteBet, SicBoBet } from '../../types';

describe('gameUtils local parity fixtures', () => {
  it('calculates roulette exposure from fixtures', () => {
    const bets: RouletteBet[] = [
      { type: 'RED', amount: 10 },
      { type: 'BLACK', amount: 5 },
      { type: 'STRAIGHT', target: 7, amount: 2 },
    ];

    expect(calculateRouletteExposure(7, bets)).toBe(10 - 5 + 2 * 35);
  });

  it('calculates roulette exposure for dozens and colors', () => {
    const bets: RouletteBet[] = [
      { type: 'DOZEN_3', amount: 10 },
      { type: 'RED', amount: 5 },
    ];

    expect(calculateRouletteExposure(25, bets)).toBe(10 * 2 + 5);
  });

  it('calculates craps exposure from fixtures', () => {
    const passBet: CrapsBet[] = [{ type: 'PASS', amount: 10 }];
    expect(calculateCrapsExposure(7, null, passBet)).toBe(10);

    const dontPassBet: CrapsBet[] = [{ type: 'DONT_PASS', amount: 10 }];
    expect(calculateCrapsExposure(2, null, dontPassBet)).toBe(10);

    const fieldBet: CrapsBet[] = [{ type: 'FIELD', amount: 10 }];
    expect(calculateCrapsExposure(2, null, fieldBet)).toBe(20);
  });

  it('calculates craps exposure with odds and yes bets', () => {
    const passOdds: CrapsBet[] = [
      { type: 'PASS', amount: 10, oddsAmount: 20 },
    ];
    expect(calculateCrapsExposure(4, 4, passOdds)).toBe(10 + 20 * 2);

    const yesBet: CrapsBet[] = [{ type: 'YES', amount: 10, target: 6 }];
    expect(calculateCrapsExposure(6, 4, yesBet)).toBe(12);
  });

  it('calculates sic bo total exposure', () => {
    const bets: SicBoBet[] = [
      { type: 'SMALL', amount: 10 },
      { type: 'SUM', amount: 5, target: 4 },
    ];
    expect(calculateSicBoTotalExposure(4, false, bets)).toBe(10 + 5 * 50);
  });

  it('calculates sic bo triple combination exposure', () => {
    const bets: SicBoBet[] = [
      { type: 'TRIPLE_SPECIFIC', amount: 1, target: 2 },
      { type: 'TRIPLE_ANY', amount: 1 },
    ];
    expect(calculateSicBoCombinationExposure('TRIPLE', 2, bets)).toBe(150 + 24);
  });
});
