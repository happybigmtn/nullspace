import { describe, it, expect } from 'vitest';
import { evaluateVideoPokerHand, calculateRouletteExposure, calculateCrapsExposure, SUITS } from '../gameUtils';
import type { Card, CrapsBet, RouletteBet } from '../../types';

const [spade, heart, diamond, club] = SUITS;

const makeCard = (rank: Card['rank'], suit: Card['suit']): Card => ({
  rank,
  suit,
  value: 0,
});

describe('gameUtils local parity fixtures', () => {
  it('evaluates video poker hands deterministically', () => {
    const royalFlush = [
      makeCard('10', spade),
      makeCard('J', spade),
      makeCard('Q', spade),
      makeCard('K', spade),
      makeCard('A', spade),
    ];

    const jacksOrBetter = [
      makeCard('J', heart),
      makeCard('J', diamond),
      makeCard('5', club),
      makeCard('7', spade),
      makeCard('9', heart),
    ];

    const highCard = [
      makeCard('2', spade),
      makeCard('6', heart),
      makeCard('9', diamond),
      makeCard('J', club),
      makeCard('K', heart),
    ];

    expect(evaluateVideoPokerHand(royalFlush)).toMatchObject({
      rank: 'ROYAL FLUSH',
      multiplier: 800,
      score: 9,
    });
    expect(evaluateVideoPokerHand(jacksOrBetter)).toMatchObject({
      rank: 'JACKS OR BETTER',
      multiplier: 1,
      score: 1,
    });
    expect(evaluateVideoPokerHand(highCard)).toMatchObject({
      rank: 'HIGH CARD',
      multiplier: 0,
      score: 0,
    });
  });

  it('calculates roulette exposure from fixtures', () => {
    const bets: RouletteBet[] = [
      { type: 'RED', amount: 10 },
      { type: 'BLACK', amount: 5 },
      { type: 'STRAIGHT', target: 7, amount: 2 },
    ];

    expect(calculateRouletteExposure(7, bets)).toBe(10 - 5 + 2 * 35);
  });

  it('calculates craps exposure from fixtures', () => {
    const passBet: CrapsBet[] = [{ type: 'PASS', amount: 10 }];
    expect(calculateCrapsExposure(7, null, passBet)).toBe(10);

    const dontPassBet: CrapsBet[] = [{ type: 'DONT_PASS', amount: 10 }];
    expect(calculateCrapsExposure(2, null, dontPassBet)).toBe(10);

    const fieldBet: CrapsBet[] = [{ type: 'FIELD', amount: 10 }];
    expect(calculateCrapsExposure(2, null, fieldBet)).toBe(20);
  });
});
