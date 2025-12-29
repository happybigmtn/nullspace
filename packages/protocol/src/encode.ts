/**
 * Encodes frontend actions into Uint8Array payloads for the on-chain program.
 *
 * This is ENCODING ONLY - no game logic here.
 * The on-chain Rust program validates and processes these moves.
 */

import { BlackjackMove, RouletteMove, CrapsMove, CrapsBetType } from '@nullspace/constants';
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

/** Encode a blackjack move action into binary payload */
export function encodeBlackjackMove(move: BlackjackMoveAction): Uint8Array {
  return new Uint8Array([BLACKJACK_OPCODES[move]]);
}

/** Encode a roulette bet placement */
export function encodeRouletteBet(
  betType: number,
  number: number,
  amount: bigint
): Uint8Array {
  // Binary format: [opcode, betType, number, amount (8 bytes BE)]
  const buffer = new ArrayBuffer(11);
  const view = new DataView(buffer);
  view.setUint8(0, RouletteMove.PlaceBet);
  view.setUint8(1, betType);
  view.setUint8(2, number);
  view.setBigUint64(3, amount, false); // big-endian per Rust spec
  return new Uint8Array(buffer);
}

/** Encode a roulette spin command */
export function encodeRouletteSpin(): Uint8Array {
  return new Uint8Array([RouletteMove.Spin]);
}

/** Encode roulette clear bets command */
export function encodeRouletteClearBets(): Uint8Array {
  return new Uint8Array([RouletteMove.ClearBets]);
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
 * Encode a craps bet placement
 * Format: [0, bet_type, target, amount (8 bytes BE)]
 */
export function encodeCrapsPlaceBet(options: CrapsPlaceBetOptions): Uint8Array {
  const buffer = new ArrayBuffer(11); // 1 + 1 + 1 + 8
  const view = new DataView(buffer);
  view.setUint8(0, CrapsMove.PlaceBet);
  view.setUint8(1, options.betType);
  view.setUint8(2, options.target);
  view.setBigUint64(3, options.amount, false); // big-endian per Rust spec
  return new Uint8Array(buffer);
}

/**
 * Encode a craps add odds command
 * Format: [1, amount (8 bytes BE)]
 */
export function encodeCrapsAddOdds(amount: bigint): Uint8Array {
  const buffer = new ArrayBuffer(9);
  const view = new DataView(buffer);
  view.setUint8(0, CrapsMove.AddOdds);
  view.setBigUint64(1, amount, false); // big-endian per Rust spec
  return new Uint8Array(buffer);
}

/** Encode a craps roll command */
export function encodeCrapsRoll(): Uint8Array {
  return new Uint8Array([CrapsMove.Roll]);
}

/** Encode a craps clear bets command */
export function encodeCrapsClearBets(): Uint8Array {
  return new Uint8Array([CrapsMove.ClearBets]);
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

/** Side bet structure */
export interface SideBet {
  type: number;
  amount: bigint;
}

/** Encode a generic game start with bet amount */
export function encodeGameStart(
  gameType: GameType,
  betAmount: bigint,
  sideBets?: SideBet[]
): Uint8Array {
  // Format depends on game - this is a placeholder for actual binary protocol
  const sideBetData = sideBets ?? [];
  const buffer = new ArrayBuffer(1 + 8 + 1 + sideBetData.length * 9);
  const view = new DataView(buffer);
  view.setUint8(0, gameType);
  view.setBigUint64(1, betAmount, true);
  view.setUint8(9, sideBetData.length);
  sideBetData.forEach((sb, i) => {
    view.setUint8(10 + i * 9, sb.type);
    view.setBigUint64(11 + i * 9, sb.amount, true);
  });
  return new Uint8Array(buffer);
}

// Re-export opcode maps for consumers that need direct access
export { BLACKJACK_OPCODES, ROULETTE_OPCODES, CRAPS_OPCODES };

// Re-export CrapsBetType for convenience
export { CrapsBetType };
