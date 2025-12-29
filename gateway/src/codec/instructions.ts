/**
 * Binary instruction encoders matching Rust types/src/execution.rs
 * All multi-byte integers are Big Endian
 *
 * Note: This module encodes higher-level casino instructions (CasinoStartGame, CasinoGameMove).
 * Game-specific payloads should defer to @nullspace/protocol where possible.
 */
import { InstructionTag, GameType, PlayerAction } from './constants.js';
import { encodeBlackjackMove, type BlackjackMoveAction } from '@nullspace/protocol/encode';

/**
 * CasinoRegister - Register a new casino player
 * Binary: [10] [nameLen:u32 BE] [nameBytes...]
 */
export function encodeCasinoRegister(name: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const result = new Uint8Array(1 + 4 + nameBytes.length);
  const view = new DataView(result.buffer);

  result[0] = InstructionTag.CasinoRegister;
  view.setUint32(1, nameBytes.length, false);  // BE
  result.set(nameBytes, 5);

  return result;
}

/**
 * CasinoDeposit - Deposit chips (testing/faucet)
 * Binary: [11] [amount:u64 BE]
 */
export function encodeCasinoDeposit(amount: bigint): Uint8Array {
  const result = new Uint8Array(9);
  const view = new DataView(result.buffer);

  result[0] = InstructionTag.CasinoDeposit;
  view.setBigUint64(1, amount, false);  // BE

  return result;
}

/**
 * CasinoStartGame - Start a new casino game session
 * Binary: [12] [gameType:u8] [bet:u64 BE] [sessionId:u64 BE]
 */
export function encodeCasinoStartGame(
  gameType: GameType,
  bet: bigint,
  sessionId: bigint
): Uint8Array {
  const result = new Uint8Array(18);
  const view = new DataView(result.buffer);

  result[0] = InstructionTag.CasinoStartGame;
  result[1] = gameType;
  view.setBigUint64(2, bet, false);  // BE
  view.setBigUint64(10, sessionId, false);  // BE

  return result;
}

/**
 * CasinoGameMove - Make a move in an active game
 * Binary: [13] [sessionId:u64 BE] [payloadLen:u32 BE] [payload...]
 */
export function encodeCasinoGameMove(
  sessionId: bigint,
  payload: Uint8Array
): Uint8Array {
  const result = new Uint8Array(1 + 8 + 4 + payload.length);
  const view = new DataView(result.buffer);

  result[0] = InstructionTag.CasinoGameMove;
  view.setBigUint64(1, sessionId, false);  // BE
  view.setUint32(9, payload.length, false);  // BE
  result.set(payload, 13);

  return result;
}

/**
 * CasinoPlayerAction - Toggle modifiers (shield, double, super)
 * Binary: [14] [action:u8]
 */
export function encodeCasinoPlayerAction(action: PlayerAction): Uint8Array {
  const result = new Uint8Array(2);

  result[0] = InstructionTag.CasinoPlayerAction;
  result[1] = action;

  return result;
}

/**
 * CasinoJoinTournament - Join a tournament
 * Binary: [16] [tournamentId:u64 BE]
 */
export function encodeCasinoJoinTournament(tournamentId: bigint): Uint8Array {
  const result = new Uint8Array(9);
  const view = new DataView(result.buffer);

  result[0] = InstructionTag.CasinoJoinTournament;
  view.setBigUint64(1, tournamentId, false);  // BE

  return result;
}

// ============================================================
// Game-specific move payload builders
// ============================================================

/**
 * Blackjack move payload
 * Just a single byte for the action
 */
export function buildBlackjackPayload(move: BlackjackMoveAction): Uint8Array {
  return encodeBlackjackMove(move);
}

/**
 * Hi-Lo move payload (from execution/src/casino/hilo.rs)
 * Single byte: 0=higher, 1=lower, 2=cashout, 3=same
 */
export function buildHiLoPayload(guess: 'higher' | 'lower' | 'same'): Uint8Array {
  const guessMap = { higher: 0, lower: 1, same: 3 };
  return new Uint8Array([guessMap[guess]]);
}

/**
 * Baccarat start payload (initial bet type)
 * Single byte: 0=player, 1=banker, 2=tie
 */
export function buildBaccaratStartPayload(betType: 'player' | 'banker' | 'tie'): Uint8Array {
  const betMap = { player: 0, banker: 1, tie: 2 };
  return new Uint8Array([betMap[betType]]);
}

/**
 * Roulette bet payload
 * Format: [numBets:u8] [bet1Type:u8][bet1Value:u8][bet1Amount:u64]...
 */
export interface RouletteBet {
  type: number;   // Bet type (0=straight, 1=split, etc.)
  value: number;  // Number or position
  amount: bigint; // Bet amount
}

export function buildRoulettePayload(bets: RouletteBet[]): Uint8Array {
  const result = new Uint8Array(1 + bets.length * 10);
  const view = new DataView(result.buffer);

  result[0] = bets.length;
  let offset = 1;

  for (const bet of bets) {
    result[offset] = bet.type;
    result[offset + 1] = bet.value;
    view.setBigUint64(offset + 2, bet.amount, false);
    offset += 10;
  }

  return result;
}

/**
 * Video Poker hold payload
 * 5 bits for which cards to hold (bit 0 = card 0, etc.)
 */
export function buildVideoPokerPayload(holds: boolean[]): Uint8Array {
  let holdBits = 0;
  for (let i = 0; i < 5 && i < holds.length; i++) {
    if (holds[i]) holdBits |= (1 << i);
  }
  return new Uint8Array([holdBits]);
}

/**
 * Craps place bet payload
 * Action 0: [0][betType:u8][target:u8][amount:u64 BE]
 *
 * Bet types:
 * - 0 = Pass Line, 1 = Don't Pass, 2 = Come, 3 = Don't Come
 * - 4 = Place (target = point number), 5 = Field
 * - etc. (see craps.rs for full list)
 */
export function buildCrapsPayload(betType: number, amount: bigint, target: number = 0): Uint8Array {
  const result = new Uint8Array(11);  // 1 + 1 + 1 + 8
  const view = new DataView(result.buffer);

  result[0] = 0;  // Action 0 = Place bet
  result[1] = betType;
  result[2] = target;
  view.setBigUint64(3, amount, false);

  return result;
}

/**
 * Craps roll dice payload
 * Action 2: [2]
 */
export function buildCrapsRollPayload(): Uint8Array {
  return new Uint8Array([2]);
}

/**
 * Sic Bo bet payload
 * [numBets:u8] [bet1Type:u8][bet1Amount:u64]...
 */
export interface SicBoBet {
  type: number;
  amount: bigint;
}

export function buildSicBoPayload(bets: SicBoBet[]): Uint8Array {
  const result = new Uint8Array(1 + bets.length * 9);
  const view = new DataView(result.buffer);

  result[0] = bets.length;
  let offset = 1;

  for (const bet of bets) {
    result[offset] = bet.type;
    view.setBigUint64(offset + 1, bet.amount, false);
    offset += 9;
  }

  return result;
}

/**
 * Casino War surrender/go to war
 * 0 = surrender, 1 = go to war
 */
export function buildCasinoWarPayload(goToWar: boolean): Uint8Array {
  return new Uint8Array([goToWar ? 1 : 0]);
}

/**
 * Three Card Poker play/fold
 * 0 = fold, 1 = play
 */
export function buildThreeCardPayload(play: boolean): Uint8Array {
  return new Uint8Array([play ? 1 : 0]);
}

/**
 * Ultimate Texas Hold'em action
 * [action:u8][multiplier:u8]
 * action: 0=check, 1=bet
 * multiplier: 4x, 3x, 2x, 1x preflop/flop/river
 */
export function buildUltimateHoldemPayload(action: 'check' | 'bet', multiplier: number = 1): Uint8Array {
  return new Uint8Array([action === 'bet' ? 1 : 0, multiplier]);
}
