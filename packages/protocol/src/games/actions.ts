import {
  CasinoWarMove,
  HiLoMove,
  ThreeCardMove,
  UltimateHoldemMove,
} from '@nullspace/constants';
import { CURRENT_PROTOCOL_VERSION, withVersionHeader } from '../version.js';

export type HiLoAction = 'higher' | 'lower' | 'same' | 'cashout';

const HILO_OPCODES: Record<HiLoAction, number> = {
  higher: HiLoMove.Higher,
  lower: HiLoMove.Lower,
  same: HiLoMove.Same,
  cashout: HiLoMove.Cashout,
};

export function encodeHiLoAction(action: HiLoAction): Uint8Array {
  return withVersionHeader(new Uint8Array([HILO_OPCODES[action]]));
}

export function encodeVideoPokerHold(holds: boolean[]): Uint8Array {
  let holdBits = 0;
  for (let i = 0; i < 5 && i < holds.length; i += 1) {
    if (holds[i]) holdBits |= (1 << i);
  }
  return withVersionHeader(new Uint8Array([holdBits]));
}

export type CasinoWarAction = 'play' | 'war' | 'surrender';

const CASINO_WAR_OPCODES: Record<CasinoWarAction, number> = {
  play: CasinoWarMove.Play,
  war: CasinoWarMove.War,
  surrender: CasinoWarMove.Surrender,
};

export function encodeCasinoWarAction(action: CasinoWarAction): Uint8Array {
  return withVersionHeader(new Uint8Array([CASINO_WAR_OPCODES[action]]));
}

export function encodeCasinoWarTieBet(amount: bigint): Uint8Array {
  const payload = new Uint8Array(10);
  payload[0] = CURRENT_PROTOCOL_VERSION;
  payload[1] = CasinoWarMove.SetTieBet;
  new DataView(payload.buffer).setBigUint64(2, amount, false);
  return payload;
}

export type ThreeCardAction = 'play' | 'fold' | 'reveal';

const THREE_CARD_OPCODES: Record<ThreeCardAction, number> = {
  play: ThreeCardMove.Play,
  fold: ThreeCardMove.Fold,
  reveal: ThreeCardMove.Reveal,
};

export function encodeThreeCardAction(action: ThreeCardAction): Uint8Array {
  return withVersionHeader(new Uint8Array([THREE_CARD_OPCODES[action]]));
}

export type ThreeCardDealOptions = {
  pairPlus?: number;
  sixCard?: number;
  progressive?: number;
};

export function encodeThreeCardDeal(options: ThreeCardDealOptions = {}): Uint8Array {
  const pairPlus = options.pairPlus ?? 0;
  const sixCard = options.sixCard ?? 0;
  const progressive = options.progressive ?? 0;
  const hasSideBets = pairPlus > 0 || sixCard > 0 || progressive > 0;

  if (!hasSideBets) {
    return withVersionHeader(new Uint8Array([ThreeCardMove.Deal]));
  }

  const payload = new Uint8Array(26);
  payload[0] = CURRENT_PROTOCOL_VERSION;
  payload[1] = ThreeCardMove.AtomicDeal;
  const view = new DataView(payload.buffer);
  view.setBigUint64(2, BigInt(pairPlus), false);
  view.setBigUint64(10, BigInt(sixCard), false);
  view.setBigUint64(18, BigInt(progressive), false);
  return payload;
}

export type UltimateHoldemAction = 'check' | 'fold' | 'reveal';

const ULTIMATE_HOLDEM_OPCODES: Record<UltimateHoldemAction, number> = {
  check: UltimateHoldemMove.Check,
  fold: UltimateHoldemMove.Fold,
  reveal: UltimateHoldemMove.Reveal,
};

export function encodeUltimateHoldemAction(action: UltimateHoldemAction): Uint8Array {
  return withVersionHeader(new Uint8Array([ULTIMATE_HOLDEM_OPCODES[action]]));
}

export type UltimateHoldemBetMultiplier = 1 | 2 | 3 | 4;

const ULTIMATE_HOLDEM_BET_OPCODES: Record<UltimateHoldemBetMultiplier, number> = {
  4: UltimateHoldemMove.Bet4x,
  3: UltimateHoldemMove.Bet3x,
  2: UltimateHoldemMove.Bet2x,
  1: UltimateHoldemMove.Bet1x,
};

export function encodeUltimateHoldemBet(multiplier: UltimateHoldemBetMultiplier): Uint8Array {
  return withVersionHeader(new Uint8Array([ULTIMATE_HOLDEM_BET_OPCODES[multiplier]]));
}

export type UltimateHoldemDealOptions = {
  trips?: number;
  sixCard?: number;
  progressive?: number;
};

export function encodeUltimateHoldemDeal(options: UltimateHoldemDealOptions = {}): Uint8Array {
  const trips = options.trips ?? 0;
  const sixCard = options.sixCard ?? 0;
  const progressive = options.progressive ?? 0;
  const hasSideBets = trips > 0 || sixCard > 0 || progressive > 0;

  if (!hasSideBets) {
    return withVersionHeader(new Uint8Array([UltimateHoldemMove.Deal]));
  }

  const payload = new Uint8Array(26);
  payload[0] = CURRENT_PROTOCOL_VERSION;
  payload[1] = UltimateHoldemMove.AtomicDeal;
  const view = new DataView(payload.buffer);
  view.setBigUint64(2, BigInt(trips), false);
  view.setBigUint64(10, BigInt(sixCard), false);
  view.setBigUint64(18, BigInt(progressive), false);
  return payload;
}

export type GameActionPayload =
  | { game: 'hilo'; action: HiLoAction }
  | { game: 'videopoker'; action: 'hold'; holds: boolean[] }
  | { game: 'casinowar'; action: CasinoWarAction }
  | { game: 'casinowar'; action: 'set_tie_bet'; amount: bigint }
  | { game: 'threecard'; action: 'deal'; pairPlus?: number; sixCard?: number; progressive?: number }
  | { game: 'threecard'; action: ThreeCardAction }
  | { game: 'ultimateholdem'; action: 'deal'; trips?: number; sixCard?: number; progressive?: number }
  | { game: 'ultimateholdem'; action: 'bet'; multiplier: UltimateHoldemBetMultiplier }
  | { game: 'ultimateholdem'; action: UltimateHoldemAction };

export function encodeGameActionPayload(payload: GameActionPayload): Uint8Array {
  switch (payload.game) {
    case 'hilo':
      return encodeHiLoAction(payload.action);
    case 'videopoker':
      return encodeVideoPokerHold(payload.holds);
    case 'casinowar':
      if (payload.action === 'set_tie_bet') {
        return encodeCasinoWarTieBet(payload.amount);
      }
      return encodeCasinoWarAction(payload.action);
    case 'threecard':
      if (payload.action === 'deal') {
        return encodeThreeCardDeal({
          pairPlus: payload.pairPlus,
          sixCard: payload.sixCard,
          progressive: payload.progressive,
        });
      }
      return encodeThreeCardAction(payload.action);
    case 'ultimateholdem':
      if (payload.action === 'deal') {
        return encodeUltimateHoldemDeal({
          trips: payload.trips,
          sixCard: payload.sixCard,
          progressive: payload.progressive,
        });
      }
      if (payload.action === 'bet') {
        return encodeUltimateHoldemBet(payload.multiplier);
      }
      return encodeUltimateHoldemAction(payload.action);
  }
}
