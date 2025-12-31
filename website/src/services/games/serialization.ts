import type { BaccaratBet, CrapsBet, RouletteBet, SicBoBet } from '../../types';
import { validateBetAmount } from './validation';

export const serializeBaccaratBet = (betType: number, amount: number): Uint8Array => {
  validateBetAmount(amount, 'BaccaratBet');
  const payload = new Uint8Array(10);
  payload[0] = 0;
  payload[1] = betType;
  const view = new DataView(payload.buffer);
  view.setBigUint64(2, BigInt(amount), false);
  return payload;
};

export const getBaccaratBetsToPlace = (
  selection: 'PLAYER' | 'BANKER',
  sideBets: BaccaratBet[],
  mainBetAmount: number,
): Array<{ betType: number; amount: number }> => {
  const bets: Array<{ betType: number; amount: number }> = [];
  const mainBetType = selection === 'PLAYER' ? 0 : 1;
  bets.push({ betType: mainBetType, amount: mainBetAmount });

  for (const sideBet of sideBets) {
    let betType: number;
    switch (sideBet.type) {
      case 'TIE': betType = 2; break;
      case 'P_PAIR': betType = 3; break;
      case 'B_PAIR': betType = 4; break;
      case 'LUCKY6': betType = 5; break;
      case 'P_DRAGON': betType = 6; break;
      case 'B_DRAGON': betType = 7; break;
      case 'PANDA8': betType = 8; break;
      case 'P_PERFECT_PAIR': betType = 9; break;
      case 'B_PERFECT_PAIR': betType = 10; break;
      default: continue;
    }
    bets.push({ betType, amount: sideBet.amount });
  }

  return bets;
};

export const serializeBaccaratAtomicBatch = (
  bets: Array<{ betType: number; amount: number }>,
): Uint8Array => {
  const payload = new Uint8Array(2 + bets.length * 9);
  payload[0] = 3;
  payload[1] = bets.length;

  const view = new DataView(payload.buffer);
  let offset = 2;
  for (const bet of bets) {
    validateBetAmount(bet.amount, 'BaccaratAtomicBatch');
    payload[offset] = bet.betType;
    view.setBigUint64(offset + 1, BigInt(bet.amount), false);
    offset += 9;
  }

  return payload;
};

const rouletteBetToNumeric = (bet: RouletteBet): { betType: number; number: number; amount: number } => {
  let betType: number;
  let number = 0;

  validateBetAmount(bet.amount, 'RouletteBet');

  switch (bet.type) {
    case 'STRAIGHT': betType = 0; number = bet.target ?? 0; break;
    case 'RED': betType = 1; break;
    case 'BLACK': betType = 2; break;
    case 'EVEN': betType = 3; break;
    case 'ODD': betType = 4; break;
    case 'LOW': betType = 5; break;
    case 'HIGH': betType = 6; break;
    case 'DOZEN_1': betType = 7; number = 0; break;
    case 'DOZEN_2': betType = 7; number = 1; break;
    case 'DOZEN_3': betType = 7; number = 2; break;
    case 'COL_1': betType = 8; number = 0; break;
    case 'COL_2': betType = 8; number = 1; break;
    case 'COL_3': betType = 8; number = 2; break;
    case 'ZERO': betType = 0; number = 0; break;
    case 'SPLIT_H': betType = 9; number = bet.target ?? 0; break;
    case 'SPLIT_V': betType = 10; number = bet.target ?? 0; break;
    case 'STREET': betType = 11; number = bet.target ?? 0; break;
    case 'CORNER': betType = 12; number = bet.target ?? 0; break;
    case 'SIX_LINE': betType = 13; number = bet.target ?? 0; break;
    default: throw new Error(`Unknown bet type: ${bet.type}`);
  }

  return { betType, number, amount: bet.amount };
};

export const serializeRouletteAtomicBatch = (bets: RouletteBet[]): Uint8Array => {
  const numericBets = bets.map(rouletteBetToNumeric);
  const payload = new Uint8Array(2 + numericBets.length * 10);
  payload[0] = 4;
  payload[1] = numericBets.length;

  const view = new DataView(payload.buffer);
  let offset = 2;
  for (const bet of numericBets) {
    payload[offset] = bet.betType;
    payload[offset + 1] = bet.number;
    view.setBigUint64(offset + 2, BigInt(bet.amount), false);
    offset += 10;
  }

  return payload;
};

export const serializeRouletteBet = (bet: RouletteBet): Uint8Array => {
  const numeric = rouletteBetToNumeric(bet);
  const payload = new Uint8Array(11);
  payload[0] = 0;

  payload[1] = numeric.betType;
  payload[2] = numeric.number;

  const view = new DataView(payload.buffer);
  view.setBigUint64(3, BigInt(numeric.amount), false);
  return payload;
};

const sicBoBetToNumeric = (bet: SicBoBet): { betType: number; number: number; amount: number } => {
  const betTypeMap: Record<SicBoBet['type'], number> = {
    'SMALL': 0,
    'BIG': 1,
    'ODD': 2,
    'EVEN': 3,
    'TRIPLE_SPECIFIC': 4,
    'TRIPLE_ANY': 5,
    'DOUBLE_SPECIFIC': 6,
    'SUM': 7,
    'SINGLE_DIE': 8,
    'DOMINO': 9,
    'HOP3_EASY': 10,
    'HOP3_HARD': 11,
    'HOP4_EASY': 12,
  };

  validateBetAmount(bet.amount, 'SicBoBet');

  return {
    betType: betTypeMap[bet.type],
    number: bet.target ?? 0,
    amount: bet.amount,
  };
};

export const serializeSicBoAtomicBatch = (bets: SicBoBet[]): Uint8Array => {
  const numericBets = bets.map(sicBoBetToNumeric);
  const payload = new Uint8Array(2 + numericBets.length * 10);
  payload[0] = 3;
  payload[1] = numericBets.length;

  const view = new DataView(payload.buffer);
  let offset = 2;
  for (const bet of numericBets) {
    payload[offset] = bet.betType;
    payload[offset + 1] = bet.number;
    view.setBigUint64(offset + 2, BigInt(bet.amount), false);
    offset += 10;
  }

  return payload;
};

export const serializeSicBoBet = (bet: SicBoBet): Uint8Array => {
  const numeric = sicBoBetToNumeric(bet);

  const payload = new Uint8Array(11);
  payload[0] = 0;
  payload[1] = numeric.betType;
  payload[2] = numeric.number;
  const view = new DataView(payload.buffer);
  view.setBigUint64(3, BigInt(numeric.amount), false);
  return payload;
};

const crapsBetToNumeric = (bet: CrapsBet): { betType: number; target: number; amount: number } => {
  const betTypeMap: Record<CrapsBet['type'], number> = {
    'PASS': 0,
    'DONT_PASS': 1,
    'COME': 2,
    'DONT_COME': 3,
    'FIELD': 4,
    'YES': 5,
    'NO': 6,
    'NEXT': 7,
    'HARDWAY': 8,
    'FIRE': 12,
    'ATS_SMALL': 15,
    'ATS_TALL': 16,
    'ATS_ALL': 17,
    'MUGGSY': 18,
    'DIFF_DOUBLES': 19,
    'RIDE_LINE': 20,
    'REPLAY': 21,
    'HOT_ROLLER': 22,
  };

  validateBetAmount(bet.amount, 'CrapsBet');

  let betTypeValue: number;
  if (bet.type === 'HARDWAY' && bet.target !== undefined) {
    const hardwayMap: Record<number, number> = { 4: 8, 6: 9, 8: 10, 10: 11 };
    betTypeValue = hardwayMap[bet.target] ?? 8;
  } else {
    betTypeValue = betTypeMap[bet.type];
  }

  let target = bet.target ?? 0;
  if (bet.type === 'ATS_SMALL' || bet.type === 'ATS_TALL' || bet.type === 'ATS_ALL') {
    target = 0;
  } else if (bet.type === 'HARDWAY') {
    target = 0;
  } else if (bet.type === 'MUGGSY'
    || bet.type === 'DIFF_DOUBLES'
    || bet.type === 'RIDE_LINE'
    || bet.type === 'REPLAY'
    || bet.type === 'HOT_ROLLER') {
    target = 0;
  }

  return { betType: betTypeValue, target, amount: bet.amount };
};

export const serializeCrapsAtomicBatch = (bets: CrapsBet[]): Uint8Array => {
  const numericBets = bets.map(crapsBetToNumeric);
  const payload = new Uint8Array(2 + numericBets.length * 10);
  payload[0] = 4;
  payload[1] = numericBets.length;

  const view = new DataView(payload.buffer);
  let offset = 2;
  for (const bet of numericBets) {
    payload[offset] = bet.betType;
    payload[offset + 1] = bet.target;
    view.setBigUint64(offset + 2, BigInt(bet.amount), false);
    offset += 10;
  }

  return payload;
};

export const serializeCrapsBet = (bet: CrapsBet): Uint8Array => {
  const numeric = crapsBetToNumeric(bet);
  const payload = new Uint8Array(11);
  payload[0] = 0;
  payload[1] = numeric.betType;
  payload[2] = numeric.target;
  const view = new DataView(payload.buffer);
  view.setBigUint64(3, BigInt(numeric.amount), false);
  return payload;
};
