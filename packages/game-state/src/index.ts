import type { GameState as GeneratedGameState, GameType as GeneratedGameType } from '@nullspace/types/casino-state';

export type UIGameType = GeneratedGameType;
export type UIGameState = GeneratedGameState;

export const toUIGameState = (state: GeneratedGameState): UIGameState => state;
export const toGeneratedGameState = (state: UIGameState): GeneratedGameState => state;

export class SafeReader {
  private offset = 0;

  constructor(private readonly data: Uint8Array) {}

  remaining(): number {
    return this.data.length - this.offset;
  }

  readU8(field: string): number {
    if (this.offset + 1 > this.data.length) {
      throw new Error(`SafeReader: insufficient data for ${field} at ${this.offset}`);
    }
    const value = this.data[this.offset];
    this.offset += 1;
    return value;
  }

  readU8At(offset: number, field: string): number {
    if (offset < 0 || offset >= this.data.length) {
      throw new Error(`SafeReader: insufficient data for ${field} at ${offset}`);
    }
    return this.data[offset];
  }

  readBytes(length: number, field: string): Uint8Array {
    if (length < 0 || this.offset + length > this.data.length) {
      throw new Error(`SafeReader: insufficient data for ${field} at ${this.offset}`);
    }
    const slice = this.data.slice(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  skip(length: number, field: string): void {
    if (length < 0 || this.offset + length > this.data.length) {
      throw new Error(`SafeReader: insufficient data for ${field} at ${this.offset}`);
    }
    this.offset += length;
  }

  readU64BE(field: string): bigint {
    if (this.offset + 8 > this.data.length) {
      throw new Error(`SafeReader: insufficient data for ${field} at ${this.offset}`);
    }
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 8);
    const value = view.getBigUint64(0, false);
    this.offset += 8;
    return value;
  }

  readI64BE(field: string): bigint {
    if (this.offset + 8 > this.data.length) {
      throw new Error(`SafeReader: insufficient data for ${field} at ${this.offset}`);
    }
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 8);
    const value = view.getBigInt64(0, false);
    this.offset += 8;
    return value;
  }
}

const readU64BEAt = (data: Uint8Array, offset: number, field: string): bigint => {
  if (offset < 0 || offset + 8 > data.length) {
    throw new Error(`SafeReader: insufficient data for ${field} at ${offset}`);
  }
  const view = new DataView(data.buffer, data.byteOffset + offset, 8);
  return view.getBigUint64(0, false);
};

const readI64BEAt = (data: Uint8Array, offset: number, field: string): bigint => {
  if (offset < 0 || offset + 8 > data.length) {
    throw new Error(`SafeReader: insufficient data for ${field} at ${offset}`);
  }
  const view = new DataView(data.buffer, data.byteOffset + offset, 8);
  return view.getBigInt64(0, false);
};

const readU32BEAt = (data: Uint8Array, offset: number, field: string): number => {
  if (offset < 0 || offset + 4 > data.length) {
    throw new Error(`SafeReader: insufficient data for ${field} at ${offset}`);
  }
  const view = new DataView(data.buffer, data.byteOffset + offset, 4);
  return view.getUint32(0, false);
};

export type BlackjackHand = {
  betMult: number;
  status: number;
  wasSplit: number;
  cards: number[];
};

export type BlackjackParsedState = {
  version: number;
  stage: number;
  sideBet21Plus3: number;
  initPlayerCards: [number, number];
  activeHandIndex: number;
  hands: BlackjackHand[];
  dealerCards: number[];
  playerValue: number | null;
  dealerValue: number | null;
  actionMask: number | null;
};

export const parseBlackjackState = (stateBlob: Uint8Array): BlackjackParsedState | null => {
  if (stateBlob.length < 14) {
    return null;
  }
  const reader = new SafeReader(stateBlob);
  try {
    const version = reader.readU8('version');
    if (version !== 2) {
      return null;
    }
    const stage = reader.readU8('stage');
    const sideBet21Plus3 = Number(reader.readU64BE('side bet 21+3'));
    const initP1 = reader.readU8('init player card 1');
    const initP2 = reader.readU8('init player card 2');
    const activeHandIndex = reader.readU8('active hand index');
    const handCount = reader.readU8('hand count');
    if (handCount > 10) {
      return null;
    }
    const hands: BlackjackHand[] = [];
    for (let h = 0; h < handCount; h += 1) {
      const betMult = reader.readU8(`hand ${h} bet multiplier`);
      const status = reader.readU8(`hand ${h} status`);
      const wasSplit = reader.readU8(`hand ${h} split flag`);
      const cardCount = reader.readU8(`hand ${h} card count`);
      const cards = Array.from(reader.readBytes(cardCount, `hand ${h} cards`));
      hands.push({ betMult, status, wasSplit, cards });
    }
    const dealerCount = reader.readU8('dealer card count');
    const dealerCards = Array.from(reader.readBytes(dealerCount, 'dealer cards'));

    if (reader.remaining() >= 2) {
      reader.skip(2, 'rules');
    }

    const playerValue = reader.remaining() >= 1 ? reader.readU8('player total') : null;
    const dealerValue = reader.remaining() >= 1 ? reader.readU8('dealer total') : null;
    const actionMask = reader.remaining() >= 1 ? reader.readU8('action mask') : null;

    return {
      version,
      stage,
      sideBet21Plus3,
      initPlayerCards: [initP1, initP2],
      activeHandIndex,
      hands,
      dealerCards,
      playerValue,
      dealerValue,
      actionMask,
    };
  } catch {
    return null;
  }
};

export type BaccaratParsedState = {
  betCount: number;
  playerCards: number[];
  bankerCards: number[];
};

export const parseBaccaratState = (stateBlob: Uint8Array): BaccaratParsedState | null => {
  if (stateBlob.length < 1) {
    return null;
  }
  const reader = new SafeReader(stateBlob);
  try {
    const betCount = reader.readU8('bet count');
    reader.skip(betCount * 9, 'bets');
    const playerCount = reader.readU8('player card count');
    const playerCards = Array.from(reader.readBytes(playerCount, 'player cards'));
    const bankerCount = reader.readU8('banker card count');
    const bankerCards = Array.from(reader.readBytes(bankerCount, 'banker cards'));
    return { betCount, playerCards, bankerCards };
  } catch {
    return null;
  }
};

export type RouletteParsedState = {
  betCount: number;
  zeroRule: number;
  phase: number;
  result: number | null;
};

export const parseRouletteState = (stateBlob: Uint8Array): RouletteParsedState | null => {
  if (stateBlob.length < 1) {
    return null;
  }
  const reader = new SafeReader(stateBlob);
  try {
    const betCount = reader.readU8('bet count');
    const betsSize = betCount * 10;
    const legacyResultOffset = 1 + betsSize;
    const v2HeaderLen = 19;
    const v2ResultOffset = v2HeaderLen + betsSize;
    const looksLikeV2 =
      stateBlob.length === v2HeaderLen + betsSize || stateBlob.length === v2HeaderLen + betsSize + 1;
    const zeroRule = looksLikeV2 ? reader.readU8At(1, 'zero rule') : 0;
    const phase = looksLikeV2 ? reader.readU8At(2, 'phase') : 0;
    const resultOffset = looksLikeV2 ? v2ResultOffset : legacyResultOffset;
    const result = stateBlob.length > resultOffset ? reader.readU8At(resultOffset, 'result') : null;
    return { betCount, zeroRule, phase, result };
  } catch {
    return null;
  }
};

export type SicBoParsedState = {
  betCount: number;
  dice: [number, number, number] | null;
};

export const parseSicBoState = (stateBlob: Uint8Array): SicBoParsedState | null => {
  if (stateBlob.length < 1) {
    return null;
  }
  const reader = new SafeReader(stateBlob);
  try {
    const betCount = reader.readU8('bet count');
    const betsSize = betCount * 10;
    const diceOffset = 1 + betsSize;
    if (stateBlob.length < diceOffset + 3) {
      return { betCount, dice: null };
    }
    const d1 = reader.readU8At(diceOffset, 'die 1');
    const d2 = reader.readU8At(diceOffset + 1, 'die 2');
    const d3 = reader.readU8At(diceOffset + 2, 'die 3');
    return {
      betCount,
      dice: d1 > 0 && d2 > 0 && d3 > 0 ? [d1, d2, d3] : null,
    };
  } catch {
    return null;
  }
};

export type CrapsRawBet = {
  betType: number;
  target: number;
  status: number;
  amount: number;
  oddsAmount: number;
};

export type CrapsParsedState = {
  version: number;
  phase: number;
  mainPoint: number;
  dice: [number, number];
  madePointsMask: number;
  epochPointEstablished: boolean;
  betCount: number;
  betsOffset: number;
  bets: CrapsRawBet[];
};

export const parseCrapsState = (stateBlob: Uint8Array): CrapsParsedState | null => {
  if (stateBlob.length < 5) {
    return null;
  }
  try {
    const looksLikeV2 =
      stateBlob[0] === 2 && stateBlob.length >= 8 && (stateBlob[1] === 0 || stateBlob[1] === 1);
    const looksLikeV1 =
      stateBlob[0] === 1 && stateBlob.length >= 7 && (stateBlob[1] === 0 || stateBlob[1] === 1);

    let version = 0;
    let phase = 0;
    let mainPoint = 0;
    let d1 = 0;
    let d2 = 0;
    let madePointsMask = 0;
    let epochPointEstablished = false;
    let betCount = 0;
    let betsOffset = 0;

    if (looksLikeV2) {
      version = 2;
      phase = stateBlob[1];
      mainPoint = stateBlob[2];
      d1 = stateBlob[3];
      d2 = stateBlob[4];
      madePointsMask = stateBlob[5] ?? 0;
      epochPointEstablished = stateBlob[6] === 1;
      betCount = stateBlob[7];
      betsOffset = 8;
    } else if (looksLikeV1) {
      version = 1;
      phase = stateBlob[1];
      mainPoint = stateBlob[2];
      d1 = stateBlob[3];
      d2 = stateBlob[4];
      madePointsMask = stateBlob[5] ?? 0;
      epochPointEstablished = stateBlob[1] === 1 || mainPoint > 0 || madePointsMask !== 0;
      betCount = stateBlob[6];
      betsOffset = 7;
    } else {
      version = stateBlob[0];
      phase = 0;
      mainPoint = stateBlob[1];
      d1 = stateBlob[2];
      d2 = stateBlob[3];
      madePointsMask = 0;
      epochPointEstablished = stateBlob[0] === 1 || mainPoint > 0;
      betCount = stateBlob[4];
      betsOffset = 5;
    }

    const bets: CrapsRawBet[] = [];
    for (let i = 0; i < betCount; i += 1) {
      const offset = betsOffset + i * 19;
      if (offset + 19 > stateBlob.length) {
        break;
      }
      const betType = stateBlob[offset];
      const target = stateBlob[offset + 1];
      const status = stateBlob[offset + 2];
      const amount = Number(readU64BEAt(stateBlob, offset + 3, 'bet amount'));
      const oddsAmount = Number(readU64BEAt(stateBlob, offset + 11, 'odds amount'));
      bets.push({ betType, target, status, amount, oddsAmount });
    }

    return {
      version,
      phase,
      mainPoint,
      dice: [d1, d2],
      madePointsMask,
      epochPointEstablished,
      betCount,
      betsOffset,
      bets,
    };
  } catch {
    return null;
  }
};

export type HiLoParsedState = {
  cardId: number;
  accumulatorBasisPoints: bigint;
  rulesByte: number;
  nextMultipliers: { higher: number; lower: number; same: number } | null;
};

export const parseHiLoState = (stateBlob: Uint8Array): HiLoParsedState | null => {
  if (stateBlob.length < 9) {
    return null;
  }
  try {
    const cardId = stateBlob[0];
    const accumulatorBasisPoints = readI64BEAt(stateBlob, 1, 'accumulator');
    const rulesByte = stateBlob.length >= 10 ? stateBlob[9] : 0;
    const nextMultipliers = stateBlob.length >= 22
      ? {
        higher: readU32BEAt(stateBlob, 10, 'higher multiplier'),
        lower: readU32BEAt(stateBlob, 14, 'lower multiplier'),
        same: readU32BEAt(stateBlob, 18, 'same multiplier'),
      }
      : null;

    return {
      cardId,
      accumulatorBasisPoints,
      rulesByte,
      nextMultipliers,
    };
  } catch {
    return null;
  }
};

export type VideoPokerParsedState = {
  stage: number;
  cards: number[];
};

export const parseVideoPokerState = (stateBlob: Uint8Array): VideoPokerParsedState | null => {
  if (stateBlob.length < 6) {
    return null;
  }
  try {
    const stage = stateBlob[0];
    const cards: number[] = [];
    for (let i = 1; i <= 5 && i < stateBlob.length; i += 1) {
      cards.push(stateBlob[i]);
    }
    return { stage, cards };
  } catch {
    return null;
  }
};

export type CasinoWarParsedState = {
  version: number;
  stage: number;
  playerCard: number;
  dealerCard: number;
  tieBet: bigint;
};

export const parseCasinoWarState = (stateBlob: Uint8Array): CasinoWarParsedState | null => {
  try {
    const looksLikeV1 = stateBlob.length >= 12 && stateBlob[0] === 1;
    if (looksLikeV1) {
      const stage = stateBlob[1];
      const playerCard = stateBlob[2];
      const dealerCard = stateBlob[3];
      const tieBet = readU64BEAt(stateBlob, 4, 'tie bet');
      return {
        version: 1,
        stage,
        playerCard,
        dealerCard,
        tieBet,
      };
    }
    if (stateBlob.length < 3) {
      return null;
    }
    return {
      version: 0,
      stage: stateBlob[2],
      playerCard: stateBlob[0],
      dealerCard: stateBlob[1],
      tieBet: 0n,
    };
  } catch {
    return null;
  }
};

export type ThreeCardParsedState = {
  version: number;
  stage: number;
  playerCards: number[];
  dealerCards: number[];
  pairPlusBet: number;
  sixCardBonusBet: number;
  progressiveBet: number;
};

export const parseThreeCardState = (stateBlob: Uint8Array): ThreeCardParsedState | null => {
  if (stateBlob.length < 16) {
    return null;
  }
  try {
    const version = stateBlob[0];
    if (version !== 1 && version !== 2 && version !== 3) {
      return null;
    }
    const requiredLen = version === 3 ? 32 : version === 2 ? 24 : 16;
    if (stateBlob.length < requiredLen) {
      return null;
    }
    const stage = stateBlob[1];
    const playerCards = [stateBlob[2], stateBlob[3], stateBlob[4]];
    const dealerCards = [stateBlob[5], stateBlob[6], stateBlob[7]];
    const pairPlusBet = Number(readU64BEAt(stateBlob, 8, 'pair plus bet'));
    const sixCardBonusBet = version >= 2 ? Number(readU64BEAt(stateBlob, 16, 'six card bet')) : 0;
    const progressiveBet = version === 3 ? Number(readU64BEAt(stateBlob, 24, 'progressive bet')) : 0;
    return {
      version,
      stage,
      playerCards,
      dealerCards,
      pairPlusBet,
      sixCardBonusBet,
      progressiveBet,
    };
  } catch {
    return null;
  }
};

export type UltimateHoldemParsedState = {
  version: number;
  stage: number;
  playerCards: number[];
  communityCards: number[];
  dealerCards: number[];
  playMultiplier: number;
  bonusCards: number[];
  tripsBet: number;
  sixCardBonusBet: number;
  progressiveBet: number;
};

export const parseUltimateHoldemState = (
  stateBlob: Uint8Array
): UltimateHoldemParsedState | null => {
  if (stateBlob.length < 20) {
    return null;
  }
  try {
    const version = stateBlob[0];
    if (version !== 1 && version !== 2 && version !== 3) {
      return null;
    }
    const requiredLen = version === 3 ? 40 : version === 2 ? 32 : 20;
    if (stateBlob.length < requiredLen) {
      return null;
    }
    const stage = stateBlob[1];
    const playerCards = [stateBlob[2], stateBlob[3]];
    const communityCards = [stateBlob[4], stateBlob[5], stateBlob[6], stateBlob[7], stateBlob[8]];
    const dealerCards = [stateBlob[9], stateBlob[10]];
    const playMultiplier = stateBlob[11];
    const bonusCards = version >= 2
      ? [stateBlob[12], stateBlob[13], stateBlob[14], stateBlob[15]]
      : [];
    const tripsBet = Number(readU64BEAt(stateBlob, version === 1 ? 12 : 16, 'trips bet'));
    const sixCardBonusBet = version >= 2 ? Number(readU64BEAt(stateBlob, 24, 'six card bet')) : 0;
    const progressiveBet = version === 3 ? Number(readU64BEAt(stateBlob, 32, 'progressive bet')) : 0;

    return {
      version,
      stage,
      playerCards,
      communityCards,
      dealerCards,
      playMultiplier,
      bonusCards,
      tripsBet,
      sixCardBonusBet,
      progressiveBet,
    };
  } catch {
    return null;
  }
};
