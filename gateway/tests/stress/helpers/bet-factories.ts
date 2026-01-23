/**
 * Bet Factories for Casino Stress Testing
 *
 * Generates valid bet configurations for each game type.
 * Covers all bet types as specified in COMPREHENSIVE_CASINO_TEST_SPEC.md
 */

// Roulette bet types - must match ROULETTE_BET_NAMES from @nullspace/constants
export const ROULETTE_BET_TYPES = {
  STRAIGHT: { type: 'STRAIGHT', needsNumber: true },
  SPLIT_H: { type: 'SPLIT_H', needsNumber: true },
  SPLIT_V: { type: 'SPLIT_V', needsNumber: true },
  STREET: { type: 'STREET', needsNumber: true },
  CORNER: { type: 'CORNER', needsNumber: true },
  SIX_LINE: { type: 'SIX_LINE', needsNumber: true },
  COL_1: { type: 'COL_1' },
  COL_2: { type: 'COL_2' },
  COL_3: { type: 'COL_3' },
  DOZEN_1: { type: 'DOZEN_1' },
  DOZEN_2: { type: 'DOZEN_2' },
  DOZEN_3: { type: 'DOZEN_3' },
  RED: { type: 'RED' },
  BLACK: { type: 'BLACK' },
  ODD: { type: 'ODD' },
  EVEN: { type: 'EVEN' },
  LOW: { type: 'LOW' },
  HIGH: { type: 'HIGH' },
  ZERO: { type: 'ZERO' },
} as const;

export interface RouletteBet {
  type: string;
  amount: number;
  target?: number;
  number?: number;
  value?: number;
}

/**
 * Generate a random roulette bet
 */
export function createRandomRouletteBet(amount = 100): RouletteBet {
  const betTypes = Object.keys(ROULETTE_BET_TYPES);
  const randomType = betTypes[Math.floor(Math.random() * betTypes.length)];
  return createRouletteBet(randomType, amount);
}

/**
 * Create a specific roulette bet
 */
export function createRouletteBet(betType: string, amount = 100): RouletteBet {
  const bet: RouletteBet = { type: betType.toUpperCase(), amount };

  switch (betType.toUpperCase()) {
    case 'STRAIGHT':
      bet.number = Math.floor(Math.random() * 37); // 0-36
      break;
    case 'SPLIT_H':
    case 'SPLIT_V':
      // Adjacent numbers for splits
      bet.number = Math.floor(Math.random() * 33) + 1;
      break;
    case 'STREET':
      // Row number (0-11)
      bet.number = Math.floor(Math.random() * 12);
      break;
    case 'CORNER':
      // Valid corner starts (1-32 minus right column)
      const cornerStarts = [1, 2, 4, 5, 7, 8, 10, 11, 13, 14, 16, 17, 19, 20, 22, 23, 25, 26, 28, 29, 31, 32];
      bet.number = cornerStarts[Math.floor(Math.random() * cornerStarts.length)];
      break;
    case 'SIX_LINE':
      // Six line start (0-10)
      bet.number = Math.floor(Math.random() * 11);
      break;
    // COL_1, COL_2, COL_3, DOZEN_1, DOZEN_2, DOZEN_3 don't need a number
  }

  return bet;
}

/**
 * Generate all roulette bet types for coverage testing
 * Matches ROULETTE_BET_NAMES from @nullspace/constants
 */
export function createAllRouletteBets(amount = 100): RouletteBet[] {
  return [
    { type: 'STRAIGHT', amount, number: 17 },
    { type: 'RED', amount },
    { type: 'BLACK', amount },
    { type: 'EVEN', amount },
    { type: 'ODD', amount },
    { type: 'LOW', amount },
    { type: 'HIGH', amount },
    { type: 'DOZEN_1', amount },
    { type: 'DOZEN_2', amount },
    { type: 'DOZEN_3', amount },
    { type: 'COL_1', amount },
    { type: 'COL_2', amount },
    { type: 'COL_3', amount },
    { type: 'ZERO', amount },
    { type: 'SPLIT_H', amount, number: 17 },
    { type: 'SPLIT_V', amount, number: 17 },
    { type: 'STREET', amount, number: 5 },
    { type: 'CORNER', amount, number: 17 },
    { type: 'SIX_LINE', amount, number: 5 },
  ];
}

// Craps bet types - must match CRAPS_BET_TYPES from @nullspace/constants
export const CRAPS_BET_TYPES = {
  PASS: { type: 'PASS' },
  DONT_PASS: { type: 'DONT_PASS' },
  COME: { type: 'COME' },
  DONT_COME: { type: 'DONT_COME' },
  FIELD: { type: 'FIELD' },
  YES: { type: 'YES', needsTarget: true },      // Place bet (4,5,6,8,9,10)
  NO: { type: 'NO', needsTarget: true },        // Don't place bet
  NEXT: { type: 'NEXT', needsTarget: true },    // Next roll proposition
  HARDWAY: { type: 'HARDWAY', needsTarget: true }, // Hard 4,6,8,10
  FIRE: { type: 'FIRE' },
  ATS_SMALL: { type: 'ATS_SMALL' },
  ATS_TALL: { type: 'ATS_TALL' },
  ATS_ALL: { type: 'ATS_ALL' },
  MUGGSY: { type: 'MUGGSY' },
  DIFF_DOUBLES: { type: 'DIFF_DOUBLES' },
  RIDE_LINE: { type: 'RIDE_LINE' },
  REPLAY: { type: 'REPLAY' },
  HOT_ROLLER: { type: 'HOT_ROLLER' },
} as const;

export interface CrapsBet {
  type: string;
  amount: number;
  target?: number;
}

/**
 * Create a random craps bet
 */
export function createRandomCrapsBet(amount = 100): CrapsBet {
  const betTypes = Object.keys(CRAPS_BET_TYPES);
  const randomType = betTypes[Math.floor(Math.random() * betTypes.length)];
  return createCrapsBet(randomType, amount);
}

/**
 * Create a specific craps bet
 */
export function createCrapsBet(betType: string, amount = 100, target?: number): CrapsBet {
  const bet: CrapsBet = { type: betType.toUpperCase(), amount };

  switch (betType.toUpperCase()) {
    case 'YES':
    case 'NO':
      // Place/Don't place bets - targets are 4,5,6,8,9,10
      bet.target = target ?? [4, 5, 6, 8, 9, 10][Math.floor(Math.random() * 6)];
      break;
    case 'NEXT':
      // Next roll proposition - targets are 2-12
      bet.target = target ?? Math.floor(Math.random() * 11) + 2;
      break;
    case 'HARDWAY':
      // Hard way bets - targets are 4,6,8,10
      bet.target = target ?? [4, 6, 8, 10][Math.floor(Math.random() * 4)];
      break;
  }

  return bet;
}

/**
 * Generate all craps bet types for coverage testing
 * Matches CRAPS_BET_TYPES from @nullspace/constants
 */
export function createAllCrapsBets(amount = 100): CrapsBet[] {
  return [
    { type: 'PASS', amount },
    { type: 'DONT_PASS', amount },
    { type: 'COME', amount },
    { type: 'DONT_COME', amount },
    { type: 'FIELD', amount },
    { type: 'YES', amount, target: 6 },      // Place 6
    { type: 'YES', amount, target: 8 },      // Place 8
    { type: 'NO', amount, target: 6 },       // Don't place 6
    { type: 'NEXT', amount, target: 7 },     // Next roll is 7
    { type: 'HARDWAY', amount, target: 4 },  // Hard 4
    { type: 'HARDWAY', amount, target: 6 },  // Hard 6
    { type: 'HARDWAY', amount, target: 8 },  // Hard 8
    { type: 'HARDWAY', amount, target: 10 }, // Hard 10
    { type: 'FIRE', amount },
    { type: 'ATS_SMALL', amount },
    { type: 'ATS_TALL', amount },
    { type: 'ATS_ALL', amount },
  ];
}

// Baccarat bet types - must match BACCARAT_BET_TYPES from @nullspace/constants
export const BACCARAT_BET_TYPES = {
  PLAYER: { type: 'PLAYER' },
  BANKER: { type: 'BANKER' },
  TIE: { type: 'TIE' },
  P_PAIR: { type: 'P_PAIR' },       // Player pair
  B_PAIR: { type: 'B_PAIR' },       // Banker pair
  LUCKY6: { type: 'LUCKY6' },
  P_DRAGON: { type: 'P_DRAGON' },   // Player dragon bonus
  B_DRAGON: { type: 'B_DRAGON' },   // Banker dragon bonus
  PANDA8: { type: 'PANDA8' },
  PERFECT_PAIR: { type: 'PERFECT_PAIR' },
} as const;

export interface BaccaratBet {
  type: string;
  amount: number;
}

/**
 * Create a random baccarat bet
 */
export function createRandomBaccaratBet(amount = 100): BaccaratBet {
  const betTypes = Object.keys(BACCARAT_BET_TYPES);
  const randomType = betTypes[Math.floor(Math.random() * betTypes.length)];
  return { type: randomType, amount };
}

/**
 * Generate all baccarat bet types for coverage testing
 */
export function createAllBaccaratBets(amount = 100): BaccaratBet[] {
  return Object.keys(BACCARAT_BET_TYPES).map((type) => ({ type, amount }));
}

// Sic Bo bet types - must match SICBO_BET_TYPES from @nullspace/constants
export const SICBO_BET_TYPES = {
  SMALL: { type: 'SMALL' },
  BIG: { type: 'BIG' },
  ODD: { type: 'ODD' },
  EVEN: { type: 'EVEN' },
  TRIPLE_SPECIFIC: { type: 'TRIPLE_SPECIFIC', needsTarget: true },
  TRIPLE_ANY: { type: 'TRIPLE_ANY' },
  DOUBLE_SPECIFIC: { type: 'DOUBLE_SPECIFIC', needsTarget: true },
  SUM: { type: 'SUM', needsTarget: true },
  SINGLE_DIE: { type: 'SINGLE_DIE', needsTarget: true },
  DOMINO: { type: 'DOMINO', needsTarget: true },
  HOP3_EASY: { type: 'HOP3_EASY', needsTarget: true },
  HOP3_HARD: { type: 'HOP3_HARD', needsTarget: true },
  HOP4_EASY: { type: 'HOP4_EASY', needsTarget: true },
} as const;

export interface SicBoBet {
  type: string;
  amount: number;
  target?: number;
}

/**
 * Create a random sic bo bet
 */
export function createRandomSicBoBet(amount = 100): SicBoBet {
  const betTypes = Object.keys(SICBO_BET_TYPES);
  const randomType = betTypes[Math.floor(Math.random() * betTypes.length)];
  return createSicBoBet(randomType, amount);
}

/**
 * Create a specific sic bo bet
 */
export function createSicBoBet(betType: string, amount = 100, target?: number): SicBoBet {
  const bet: SicBoBet = { type: betType.toUpperCase(), amount };

  switch (betType.toUpperCase()) {
    case 'DOUBLE_SPECIFIC':
    case 'TRIPLE_SPECIFIC':
    case 'SINGLE_DIE':
      bet.target = target ?? Math.floor(Math.random() * 6) + 1; // 1-6
      break;
    case 'SUM':
      bet.target = target ?? Math.floor(Math.random() * 14) + 4; // 4-17
      break;
    case 'DOMINO':
      // Two-dice combination encoded
      const d1 = Math.floor(Math.random() * 6) + 1;
      const d2 = Math.floor(Math.random() * 6) + 1;
      bet.target = target ?? (d1 * 8 + d2);
      break;
    case 'HOP3_EASY':
    case 'HOP3_HARD':
    case 'HOP4_EASY':
      bet.target = target ?? Math.floor(Math.random() * 6) + 1;
      break;
  }

  return bet;
}

/**
 * Generate all sic bo bet types for coverage testing
 * Matches SICBO_BET_TYPES from @nullspace/constants
 */
export function createAllSicBoBets(amount = 100): SicBoBet[] {
  return [
    { type: 'SMALL', amount },
    { type: 'BIG', amount },
    { type: 'ODD', amount },
    { type: 'EVEN', amount },
    { type: 'TRIPLE_SPECIFIC', amount, target: 1 },
    { type: 'TRIPLE_ANY', amount },
    { type: 'DOUBLE_SPECIFIC', amount, target: 1 },
    { type: 'DOUBLE_SPECIFIC', amount, target: 6 },
    { type: 'SUM', amount, target: 10 },
    { type: 'SUM', amount, target: 11 },
    { type: 'SINGLE_DIE', amount, target: 1 },
    { type: 'SINGLE_DIE', amount, target: 6 },
    { type: 'DOMINO', amount, target: 10 },
    { type: 'HOP3_EASY', amount, target: 1 },
    { type: 'HOP3_HARD', amount, target: 2 },
    { type: 'HOP4_EASY', amount, target: 3 },
  ];
}

// Blackjack options
export interface BlackjackOptions {
  amount: number;
  sideBet21Plus3?: number;
  sideBetPerfectPairs?: number;
  sideBetLuckyLadies?: number;
}

/**
 * Create blackjack deal options
 */
export function createBlackjackDeal(amount = 100, options?: Partial<BlackjackOptions>): BlackjackOptions {
  return {
    amount,
    sideBet21Plus3: options?.sideBet21Plus3,
    sideBetPerfectPairs: options?.sideBetPerfectPairs,
    sideBetLuckyLadies: options?.sideBetLuckyLadies,
  };
}

/**
 * Create blackjack with random side bets for testing
 */
export function createBlackjackWithRandomSideBets(amount = 100, sideBetAmount = 25): BlackjackOptions {
  const sideBets: Partial<BlackjackOptions> = {};

  if (Math.random() > 0.5) sideBets.sideBet21Plus3 = sideBetAmount;
  if (Math.random() > 0.7) sideBets.sideBetPerfectPairs = sideBetAmount;
  if (Math.random() > 0.8) sideBets.sideBetLuckyLadies = sideBetAmount;

  return createBlackjackDeal(amount, sideBets);
}

// Three Card Poker options
export interface ThreeCardOptions {
  amount: number;
  pairPlus?: number;
  sixCard?: number;
  progressive?: number;
}

/**
 * Create three card poker options
 */
export function createThreeCardDeal(amount = 100, options?: Partial<ThreeCardOptions>): ThreeCardOptions {
  return {
    amount,
    pairPlus: options?.pairPlus,
    sixCard: options?.sixCard,
    progressive: options?.progressive,
  };
}

// Ultimate Texas Hold'em options
export interface UltimateHoldemOptions {
  amount: number;
  trips?: number;
  sixCard?: number;
  progressive?: number;
}

/**
 * Create ultimate hold'em options
 */
export function createUltimateHoldemDeal(
  amount = 100,
  options?: Partial<UltimateHoldemOptions>
): UltimateHoldemOptions {
  return {
    amount,
    trips: options?.trips,
    sixCard: options?.sixCard,
    progressive: options?.progressive,
  };
}

// Generic bet generation for any game
export type GameBetFactory = () => {
  game: string;
  bets: unknown;
  amount: number;
};

/**
 * Create a random bet for any game type
 */
export function createRandomGameBet(
  game: string,
  amount = 100
): { game: string; amount: number; bets?: unknown[] } {
  switch (game.toLowerCase()) {
    case 'roulette':
      return {
        game: 'roulette',
        amount,
        bets: [createRandomRouletteBet(amount)],
      };
    case 'craps':
      return {
        game: 'craps',
        amount,
        bets: [createRandomCrapsBet(amount)],
      };
    case 'baccarat':
      return {
        game: 'baccarat',
        amount,
        bets: [createRandomBaccaratBet(amount)],
      };
    case 'sicbo':
      return {
        game: 'sicbo',
        amount,
        bets: [createRandomSicBoBet(amount)],
      };
    case 'blackjack':
      return { game: 'blackjack', amount };
    case 'videopoker':
      return { game: 'videopoker', amount };
    case 'casinowar':
      return { game: 'casinowar', amount };
    case 'hilo':
      return { game: 'hilo', amount };
    case 'threecard':
      return { game: 'threecard', amount };
    case 'ultimateholdem':
      return { game: 'ultimateholdem', amount };
    default:
      throw new Error(`Unknown game: ${game}`);
  }
}

/**
 * Generate a batch of bets for multiple rounds
 */
export function generateBetBatch(
  game: string,
  count: number,
  baseAmount = 100,
  variance = 0.5
): Array<{ game: string; amount: number; bets?: unknown[] }> {
  const batch = [];
  for (let i = 0; i < count; i++) {
    // Add some variance to bet amounts
    const multiplier = 1 + (Math.random() - 0.5) * variance;
    const amount = Math.floor(baseAmount * multiplier);
    batch.push(createRandomGameBet(game, amount));
  }
  return batch;
}

/**
 * All supported games
 */
export const ALL_GAMES = [
  'blackjack',
  'roulette',
  'craps',
  'baccarat',
  'sicbo',
  'videopoker',
  'casinowar',
  'hilo',
  'threecard',
  'ultimateholdem',
] as const;

export type SupportedGame = (typeof ALL_GAMES)[number];
