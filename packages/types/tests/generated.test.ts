import type { Card } from '../src/generated/Card.js';
import type { GameType } from '../src/generated/GameType.js';
import type { SuperMultiplier } from '../src/generated/SuperMultiplier.js';
import type { CrapsBet } from '../src/generated/CrapsBet.js';

const card: Card = {
  suit: 'spades',
  rank: 'A',
  value: 14,
  isHidden: true,
  isHeld: false,
};

const gameType: GameType = 'BLACKJACK';

const multiplier: SuperMultiplier = {
  id: 1,
  multiplier: 2,
  superType: 'streak',
};

const bet: CrapsBet = {
  type: 'PASS',
  amount: 100,
  target: 6,
  oddsAmount: 200,
};

const invalidCard: Card = {
  suit: 'spades',
  rank: 'A',
  value: 14,
  // @ts-expect-error invalid flag type
  isHidden: 'yes',
};

void [card, gameType, multiplier, bet, invalidCard];
