/**
 * Encodes frontend actions into Uint8Array payloads for the on-chain program.
 *
 * This is ENCODING ONLY - no game logic here.
 * The on-chain Rust program validates and processes these moves.
 *
 * All encoded messages include a 1-byte protocol version header as the first byte.
 * See version.ts for version constants and validation utilities.
 */

import {
  BaccaratMove,
  BlackjackMove,
  CrapsMove,
  CrapsBetType,
  RouletteMove,
  SicBoMove,
} from '@nullspace/constants';
import { CURRENT_PROTOCOL_VERSION, withVersionHeader } from './version.js';
import {
  BACCARAT_BET_TYPES,
  CRAPS_BET_TYPES,
  ROULETTE_BET_NAMES,
  SICBO_BET_TYPES,
  encodeBaccaratBet as encodeBaccaratBetType,
  encodeCrapsBet as encodeCrapsBetType,
  encodeRouletteBet as encodeRouletteBetType,
  encodeSicBoBet as encodeSicBoBetType,
  type BaccaratBetName,
  type CrapsBetName,
  type RouletteBetName,
  type SicBoBetName,
} from '@nullspace/constants';
import type { GameType } from '@nullspace/types';

/** Valid blackjack move actions - exported for type-safe fixture typing */
export type BlackjackMoveAction = 'hit' | 'stand' | 'double' | 'split' | 'deal' | 'surrender';

/**
 * Opcode map with type safety via `satisfies`
 * If the type and map diverge, TypeScript will error at compile time
 */
const BLACKJACK_OPCODES = {
  hit: BlackjackMove.Hit,
  stand: BlackjackMove.Stand,
  double: BlackjackMove.Double,
  split: BlackjackMove.Split,
  deal: BlackjackMove.Deal,
  surrender: BlackjackMove.Surrender,
} as const satisfies Record<BlackjackMoveAction, number>;

/** Valid roulette move actions */
export type RouletteMoveAction = 'place_bet' | 'spin' | 'clear_bets';

const ROULETTE_OPCODES = {
  place_bet: RouletteMove.PlaceBet,
  spin: RouletteMove.Spin,
  clear_bets: RouletteMove.ClearBets,
} as const satisfies Record<RouletteMoveAction, number>;

/** Valid craps move actions */
export type CrapsMoveAction = 'place_bet' | 'add_odds' | 'roll' | 'clear_bets';

const CRAPS_OPCODES = {
  place_bet: CrapsMove.PlaceBet,
  add_odds: CrapsMove.AddOdds,
  roll: CrapsMove.Roll,
  clear_bets: CrapsMove.ClearBets,
} as const satisfies Record<CrapsMoveAction, number>;

/** Encode a blackjack move action into binary payload (with version header) */
export function encodeBlackjackMove(move: BlackjackMoveAction): Uint8Array {
  return withVersionHeader(new Uint8Array([BLACKJACK_OPCODES[move]]));
}

/** Encode a roulette bet placement (with version header) */
export function encodeRouletteBet(
  betType: number,
  number: number,
  amount: bigint
): Uint8Array {
  // Binary format: [version, opcode, betType, number, amount (8 bytes BE)]
  const buffer = new ArrayBuffer(12);
  const view = new DataView(buffer);
  view.setUint8(0, CURRENT_PROTOCOL_VERSION);
  view.setUint8(1, RouletteMove.PlaceBet);
  view.setUint8(2, betType);
  view.setUint8(3, number);
  view.setBigUint64(4, amount, false); // big-endian per Rust spec
  return new Uint8Array(buffer);
}

/** Encode a roulette spin command (with version header) */
export function encodeRouletteSpin(): Uint8Array {
  return withVersionHeader(new Uint8Array([RouletteMove.Spin]));
}

/** Encode roulette clear bets command (with version header) */
export function encodeRouletteClearBets(): Uint8Array {
  return withVersionHeader(new Uint8Array([RouletteMove.ClearBets]));
}

/** Roulette place_bet options */
export interface RoulettePlaceBetOptions {
  betType: number;
  number: number;
  amount: bigint;
}

/** Encode a roulette move (dispatcher) */
export function encodeRouletteMove(
  move: 'spin'
): Uint8Array;
export function encodeRouletteMove(
  move: 'clear_bets'
): Uint8Array;
export function encodeRouletteMove(
  move: 'place_bet',
  options: RoulettePlaceBetOptions
): Uint8Array;
export function encodeRouletteMove(
  move: RouletteMoveAction,
  options?: RoulettePlaceBetOptions
): Uint8Array {
  switch (move) {
    case 'spin':
      return encodeRouletteSpin();
    case 'clear_bets':
      return encodeRouletteClearBets();
    case 'place_bet':
      // Use explicit undefined check - betType=0 is valid (straight up bet)
      if (options?.betType === undefined || options?.number === undefined || options?.amount === undefined) {
        throw new Error('place_bet requires betType, number, and amount');
      }
      return encodeRouletteBet(options.betType, options.number, options.amount);
  }
}

/** Craps place bet options */
export interface CrapsPlaceBetOptions {
  betType: number; // Use CrapsBetType.Pass, CrapsBetType.Field, etc.
  target: number;  // 0 for most bets, point number for Yes/No/Next
  amount: bigint;
}

/**
 * Encode a craps bet placement (with version header)
 * Format: [version, opcode, bet_type, target, amount (8 bytes BE)]
 */
export function encodeCrapsPlaceBet(options: CrapsPlaceBetOptions): Uint8Array {
  const buffer = new ArrayBuffer(12); // 1 version + 1 opcode + 1 bet_type + 1 target + 8 amount
  const view = new DataView(buffer);
  view.setUint8(0, CURRENT_PROTOCOL_VERSION);
  view.setUint8(1, CrapsMove.PlaceBet);
  view.setUint8(2, options.betType);
  view.setUint8(3, options.target);
  view.setBigUint64(4, options.amount, false); // big-endian per Rust spec
  return new Uint8Array(buffer);
}

/**
 * Encode a craps add odds command (with version header)
 * Format: [version, opcode, amount (8 bytes BE)]
 */
export function encodeCrapsAddOdds(amount: bigint): Uint8Array {
  const buffer = new ArrayBuffer(10); // 1 version + 1 opcode + 8 amount
  const view = new DataView(buffer);
  view.setUint8(0, CURRENT_PROTOCOL_VERSION);
  view.setUint8(1, CrapsMove.AddOdds);
  view.setBigUint64(2, amount, false); // big-endian per Rust spec
  return new Uint8Array(buffer);
}

/** Encode a craps roll command (with version header) */
export function encodeCrapsRoll(): Uint8Array {
  return withVersionHeader(new Uint8Array([CrapsMove.Roll]));
}

/** Encode a craps clear bets command (with version header) */
export function encodeCrapsClearBets(): Uint8Array {
  return withVersionHeader(new Uint8Array([CrapsMove.ClearBets]));
}

/** Encode a craps move (dispatcher) */
export function encodeCrapsMove(
  move: 'roll'
): Uint8Array;
export function encodeCrapsMove(
  move: 'clear_bets'
): Uint8Array;
export function encodeCrapsMove(
  move: 'add_odds',
  amount: bigint
): Uint8Array;
export function encodeCrapsMove(
  move: 'place_bet',
  options: CrapsPlaceBetOptions
): Uint8Array;
export function encodeCrapsMove(
  move: CrapsMoveAction,
  optionsOrAmount?: CrapsPlaceBetOptions | bigint
): Uint8Array {
  switch (move) {
    case 'roll':
      return encodeCrapsRoll();
    case 'clear_bets':
      return encodeCrapsClearBets();
    case 'add_odds':
      if (typeof optionsOrAmount !== 'bigint') {
        throw new Error('add_odds requires an amount');
      }
      return encodeCrapsAddOdds(optionsOrAmount);
    case 'place_bet':
      if (!optionsOrAmount || typeof optionsOrAmount === 'bigint') {
        throw new Error('place_bet requires betType, target, and amount');
      }
      return encodeCrapsPlaceBet(optionsOrAmount);
  }
}

export interface BaccaratAtomicBetInput {
  type: BaccaratBetName | number;
  amount: bigint;
}

export function encodeBaccaratAtomicBatch(bets: BaccaratAtomicBetInput[]): Uint8Array {
  if (!bets.length) {
    throw new Error('No bets provided');
  }
  // Format: [version, opcode, count, ...bets]
  const payload = new Uint8Array(3 + bets.length * 9);
  const view = new DataView(payload.buffer);
  payload[0] = CURRENT_PROTOCOL_VERSION;
  payload[1] = BaccaratMove.AtomicBatch;
  payload[2] = bets.length;

  let offset = 3;
  for (const bet of bets) {
    if (bet.amount <= 0n) {
      throw new Error('Bet amount must be positive');
    }
    const betType = typeof bet.type === 'string'
      ? (() => {
          const key = bet.type.toUpperCase() as BaccaratBetName;
          if (!(key in BACCARAT_BET_TYPES)) {
            throw new Error(`Invalid bet type: ${bet.type}`);
          }
          return encodeBaccaratBetType(key);
        })()
      : bet.type;

    payload[offset] = betType;
    view.setBigUint64(offset + 1, bet.amount, false);
    offset += 9;
  }

  return payload;
}

export interface RouletteAtomicBetInput {
  type: RouletteBetName | number;
  amount: bigint;
  target?: number;
  number?: number;
  value?: number;
}

export function encodeRouletteAtomicBatch(bets: RouletteAtomicBetInput[]): Uint8Array {
  if (!bets.length) {
    throw new Error('No bets provided');
  }
  // Format: [version, opcode, count, ...bets]
  const payload = new Uint8Array(3 + bets.length * 10);
  const view = new DataView(payload.buffer);
  payload[0] = CURRENT_PROTOCOL_VERSION;
  payload[1] = RouletteMove.AtomicBatch;
  payload[2] = bets.length;

  let offset = 3;
  for (const bet of bets) {
    if (bet.amount <= 0n) {
      throw new Error('Bet amount must be positive');
    }
    const rawValue = bet.value ?? bet.number ?? bet.target ?? 0;
    const encoded = typeof bet.type === 'string'
      ? (() => {
          const key = bet.type.toUpperCase() as RouletteBetName;
          if (!ROULETTE_BET_NAMES.includes(key)) {
            throw new Error(`Invalid bet type: ${bet.type}`);
          }
          return encodeRouletteBetType(key, rawValue);
        })()
      : { type: bet.type, value: rawValue };

    payload[offset] = encoded.type;
    payload[offset + 1] = encoded.value;
    view.setBigUint64(offset + 2, bet.amount, false);
    offset += 10;
  }

  return payload;
}

export interface CrapsAtomicBetInput {
  type: CrapsBetName | number;
  amount: bigint;
  target?: number;
}

export function encodeCrapsAtomicBatch(bets: CrapsAtomicBetInput[]): Uint8Array {
  if (!bets.length) {
    throw new Error('No bets provided');
  }
  // Format: [version, opcode, count, ...bets]
  const payload = new Uint8Array(3 + bets.length * 10);
  const view = new DataView(payload.buffer);
  payload[0] = CURRENT_PROTOCOL_VERSION;
  payload[1] = CrapsMove.AtomicBatch;
  payload[2] = bets.length;

  let offset = 3;
  for (const bet of bets) {
    if (bet.amount <= 0n) {
      throw new Error('Bet amount must be positive');
    }
    const encoded = typeof bet.type === 'string'
      ? (() => {
          const key = bet.type.toUpperCase() as CrapsBetName;
          if (!(key in CRAPS_BET_TYPES)) {
            throw new Error(`Invalid bet type: ${bet.type}`);
          }
          return encodeCrapsBetType(key, bet.target);
        })()
      : { betType: bet.type, target: bet.target ?? 0 };

    payload[offset] = encoded.betType;
    payload[offset + 1] = encoded.target;
    view.setBigUint64(offset + 2, bet.amount, false);
    offset += 10;
  }

  return payload;
}

export interface SicBoAtomicBetInput {
  type: SicBoBetName | number;
  amount: bigint;
  target?: number;
  number?: number;
  value?: number;
}

export function encodeSicBoAtomicBatch(bets: SicBoAtomicBetInput[]): Uint8Array {
  if (!bets.length) {
    throw new Error('No bets provided');
  }
  // Format: [version, opcode, count, ...bets]
  const payload = new Uint8Array(3 + bets.length * 10);
  const view = new DataView(payload.buffer);
  payload[0] = CURRENT_PROTOCOL_VERSION;
  payload[1] = SicBoMove.AtomicBatch;
  payload[2] = bets.length;

  let offset = 3;
  for (const bet of bets) {
    if (bet.amount <= 0n) {
      throw new Error('Bet amount must be positive');
    }
    const rawValue = bet.value ?? bet.number ?? bet.target ?? 0;
    const encoded = typeof bet.type === 'string'
      ? (() => {
          const key = bet.type.toUpperCase() as SicBoBetName;
          if (!(key in SICBO_BET_TYPES)) {
            throw new Error(`Invalid bet type: ${bet.type}`);
          }
          return encodeSicBoBetType(key, rawValue);
        })()
      : { betType: bet.type, target: rawValue };

    payload[offset] = encoded.betType;
    payload[offset + 1] = encoded.target;
    view.setBigUint64(offset + 2, bet.amount, false);
    offset += 10;
  }

  return payload;
}

// Re-export opcode maps for consumers that need direct access
export { BLACKJACK_OPCODES, ROULETTE_OPCODES, CRAPS_OPCODES };

// Re-export CrapsBetType for convenience
export { CrapsBetType };
