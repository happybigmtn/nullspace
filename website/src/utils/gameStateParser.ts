/**
 * Game State Parsers
 * Parse binary state blobs from on-chain casino games into TypeScript objects
 *
 * All binary data uses Big Endian byte order (consistent with CasinoChainService)
 * State formats match the Rust implementations in execution/src/casino/*.rs
 */

import { GameType } from '@nullspace/types/casino';
import {
  getHandValue as getBlackjackValue,
  getBaccaratValue,
  getHiLoRank,
} from './gameUtils';

// ============================================================================
// Card Representation
// ============================================================================

export interface Card {
  suit: '♠' | '♥' | '♦' | '♣';
  rank: 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
  value: number;
}

const SUITS: Array<'♠' | '♥' | '♦' | '♣'> = ['♠', '♥', '♦', '♣'];
const RANKS: Array<'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K'> =
  ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// Default card for malformed input
const DEFAULT_CARD: Card = { suit: '♠', rank: 'A', value: 11 };

/**
 * Convert card byte (0-51) to Card object
 * Card encoding: suit = card / 13, rank = (card % 13)
 * Suits: 0=♠, 1=♥, 2=♦, 3=♣
 * Ranks: 0=A, 1=2, ..., 12=K
 */
function parseCard(cardByte: number): Card {
  // Bounds check for invalid card bytes
  if (cardByte < 0 || cardByte >= 52) {
    return DEFAULT_CARD;
  }

  const suitIndex = Math.floor(cardByte / 13);
  const rankIndex = cardByte % 13;

  const suit = SUITS[suitIndex];
  const rank = RANKS[rankIndex];

  // Calculate value for display
  let value: number;
  if (rank === 'A') {
    value = 11; // Ace defaults to 11
  } else if (['J', 'Q', 'K'].includes(rank)) {
    value = 10;
  } else {
    value = parseInt(rank);
  }

  return { suit, rank, value };
}

// ============================================================================
// Blackjack State Parser
// ============================================================================

export interface BlackjackState {
  playerHand: Card[];
  dealerHand: Card[];
  stage: 'PLAYER_TURN' | 'DEALER_TURN' | 'COMPLETE';
}

/**
 * Blackjack State Format:
 * [pLen:u8] [pCards:u8×pLen] [dLen:u8] [dCards:u8×dLen] [stage:u8]
 */
export function parseBlackjackState(state: Uint8Array): BlackjackState {
  // Default safe state for malformed input
  if (!state || state.length < 3) {
    return { playerHand: [], dealerHand: [], stage: 'PLAYER_TURN' };
  }

  let offset = 0;

  // Read player hand length
  const playerLen = state[offset++];
  if (offset + playerLen >= state.length) {
    return { playerHand: [], dealerHand: [], stage: 'PLAYER_TURN' };
  }

  const playerHand: Card[] = [];
  for (let i = 0; i < playerLen && offset < state.length; i++) {
    playerHand.push(parseCard(state[offset++]));
  }

  // Read dealer hand length
  if (offset >= state.length) {
    return { playerHand, dealerHand: [], stage: 'PLAYER_TURN' };
  }
  const dealerLen = state[offset++];
  if (offset + dealerLen > state.length) {
    return { playerHand, dealerHand: [], stage: 'PLAYER_TURN' };
  }

  const dealerHand: Card[] = [];
  for (let i = 0; i < dealerLen && offset < state.length; i++) {
    dealerHand.push(parseCard(state[offset++]));
  }

  // Read stage
  if (offset >= state.length) {
    return { playerHand, dealerHand, stage: 'PLAYER_TURN' };
  }
  const stageValue = state[offset];
  const stage = stageValue === 0 ? 'PLAYER_TURN' :
                stageValue === 1 ? 'DEALER_TURN' : 'COMPLETE';

  return { playerHand, dealerHand, stage };
}

// ============================================================================
// Roulette State Parser
// ============================================================================

export interface RouletteState {
  result: number | null;
}

/**
 * Roulette State Format:
 * Empty before spin, [result:u8] after spin
 */
export function parseRouletteState(state: Uint8Array): RouletteState {
  if (!state || state.length === 0) {
    return { result: null };
  }

  return { result: state[0] };
}

// ============================================================================
// Baccarat State Parser
// ============================================================================

export interface BaccaratState {
  playerHand: Card[];
  bankerHand: Card[];
}

/**
 * Baccarat State Format:
 * [playerHandLen:u8] [playerCards:u8×n] [bankerHandLen:u8] [bankerCards:u8×n]
 */
export function parseBaccaratState(state: Uint8Array): BaccaratState {
  // Default safe state for malformed input
  if (!state || state.length < 2) {
    return { playerHand: [], bankerHand: [] };
  }

  let offset = 0;

  // Read player hand
  const playerLen = state[offset++];
  if (offset + playerLen >= state.length) {
    return { playerHand: [], bankerHand: [] };
  }

  const playerHand: Card[] = [];
  for (let i = 0; i < playerLen && offset < state.length; i++) {
    playerHand.push(parseCard(state[offset++]));
  }

  // Read banker hand
  if (offset >= state.length) {
    return { playerHand, bankerHand: [] };
  }
  const bankerLen = state[offset++];

  const bankerHand: Card[] = [];
  for (let i = 0; i < bankerLen && offset < state.length; i++) {
    bankerHand.push(parseCard(state[offset++]));
  }

  return { playerHand, bankerHand };
}

// ============================================================================
// Sic Bo State Parser
// ============================================================================

export interface SicBoState {
  dice: [number, number, number];
}

/**
 * Sic Bo State Format:
 * [die1:u8] [die2:u8] [die3:u8]
 */
export function parseSicBoState(state: Uint8Array): SicBoState {
  if (!state || state.length < 3) {
    return { dice: [0, 0, 0] };
  }

  return {
    dice: [state[0], state[1], state[2]]
  };
}

// ============================================================================
// Video Poker State Parser
// ============================================================================

export interface VideoPokerState {
  cards: [Card, Card, Card, Card, Card];
  stage: 'DEAL' | 'DRAW';
}

/**
 * Video Poker State Format:
 * [stage:u8] [card1:u8] [card2:u8] [card3:u8] [card4:u8] [card5:u8]
 */
export function parseVideoPokerState(state: Uint8Array): VideoPokerState {
  // Default safe state for malformed input
  if (!state || state.length < 6) {
    return {
      cards: [DEFAULT_CARD, DEFAULT_CARD, DEFAULT_CARD, DEFAULT_CARD, DEFAULT_CARD],
      stage: 'DEAL'
    };
  }

  const stageValue = state[0];
  const stage = stageValue === 0 ? 'DEAL' : 'DRAW';

  const cards: [Card, Card, Card, Card, Card] = [
    parseCard(state[1]),
    parseCard(state[2]),
    parseCard(state[3]),
    parseCard(state[4]),
    parseCard(state[5])
  ];

  return { cards, stage };
}

// ============================================================================
// Three Card Poker State Parser
// ============================================================================

export interface ThreeCardState {
  playerCards: [Card, Card, Card];
  dealerCards: [Card, Card, Card];
  stage: 'ANTE' | 'COMPLETE';
}

/**
 * Three Card Poker State Format (matches Rust backend):
 * [version:u8]           - byte 0: STATE_VERSION (1)
 * [stage:u8]             - byte 1: 0=Betting, 1=Decision, 2=AwaitingReveal, 3=Complete
 * [playerCard1..3:u8]    - bytes 2-4: player cards
 * [dealerCard1..3:u8]    - bytes 5-7: dealer cards
 * [pairplusBet:u64 BE]   - bytes 8-15
 * [sixCardBet:u64 BE]    - bytes 16-23
 * [progressiveBet:u64 BE] - bytes 24-31
 */
export function parseThreeCardState(state: Uint8Array): ThreeCardState {
  // Default safe state for malformed input
  // Minimum 8 bytes: version(1) + stage(1) + player(3) + dealer(3)
  if (!state || state.length < 8) {
    return {
      playerCards: [DEFAULT_CARD, DEFAULT_CARD, DEFAULT_CARD],
      dealerCards: [DEFAULT_CARD, DEFAULT_CARD, DEFAULT_CARD],
      stage: 'ANTE'
    };
  }

  // byte 0 = version (skip)
  // byte 1 = stage
  const stageValue = state[1];
  // 0=Betting, 1=Decision, 2=AwaitingReveal, 3=Complete
  const stage = stageValue === 3 ? 'COMPLETE' : 'ANTE';

  // bytes 2-4 = player cards
  const playerCards: [Card, Card, Card] = [
    parseCard(state[2]),
    parseCard(state[3]),
    parseCard(state[4])
  ];

  // bytes 5-7 = dealer cards
  const dealerCards: [Card, Card, Card] = [
    parseCard(state[5]),
    parseCard(state[6]),
    parseCard(state[7])
  ];

  return { playerCards, dealerCards, stage };
}

// ============================================================================
// Ultimate Hold'em State Parser
// ============================================================================

export interface UltimateHoldemState {
  stage: 'PREFLOP' | 'FLOP' | 'RIVER' | 'SHOWDOWN';
  playerCards: [Card, Card];
  communityCards: [Card, Card, Card, Card, Card];
  dealerCards: [Card, Card];
  playBetMultiplier: number;
}

/**
 * Ultimate Hold'em State Format (matches Rust backend):
 * [version:u8]           - byte 0: STATE_VERSION (1)
 * [stage:u8]             - byte 1: 0=Betting, 1=Preflop, 2=Flop, 3=River, 4=AwaitingReveal, 5=Showdown
 * [playerCard1..2:u8]    - bytes 2-3: player cards
 * [community1..5:u8]     - bytes 4-8: community cards
 * [dealerCard1..2:u8]    - bytes 9-10: dealer cards
 * [playBetMultiplier:u8] - byte 11: play bet multiplier (0, 1, 2, 3, or 4)
 * [bonus1..4:u8]         - bytes 12-15: bonus cards (for 6-card bonus)
 * [tripsBet:u64 BE]      - bytes 16-23
 * [sixCardBet:u64 BE]    - bytes 24-31
 * [progressiveBet:u64 BE] - bytes 32-39
 */
export function parseUltimateHoldemState(state: Uint8Array): UltimateHoldemState {
  // Default safe state for malformed input
  // Minimum 12 bytes: version(1) + stage(1) + player(2) + community(5) + dealer(2) + mult(1)
  if (!state || state.length < 12) {
    return {
      stage: 'PREFLOP',
      playerCards: [DEFAULT_CARD, DEFAULT_CARD],
      communityCards: [DEFAULT_CARD, DEFAULT_CARD, DEFAULT_CARD, DEFAULT_CARD, DEFAULT_CARD],
      dealerCards: [DEFAULT_CARD, DEFAULT_CARD],
      playBetMultiplier: 0
    };
  }

  // byte 0 = version (skip)
  // byte 1 = stage
  const stageValue = state[1];
  // 0=Betting, 1=Preflop, 2=Flop, 3=River, 4=AwaitingReveal, 5=Showdown
  const stage = stageValue === 0 || stageValue === 1 ? 'PREFLOP' :
                stageValue === 2 ? 'FLOP' :
                stageValue === 3 ? 'RIVER' : 'SHOWDOWN';

  // bytes 2-3 = player cards
  const playerCards: [Card, Card] = [
    parseCard(state[2]),
    parseCard(state[3])
  ];

  // bytes 4-8 = community cards
  const communityCards: [Card, Card, Card, Card, Card] = [
    parseCard(state[4]),
    parseCard(state[5]),
    parseCard(state[6]),
    parseCard(state[7]),
    parseCard(state[8])
  ];

  // bytes 9-10 = dealer cards
  const dealerCards: [Card, Card] = [
    parseCard(state[9]),
    parseCard(state[10])
  ];

  // byte 11 = play bet multiplier
  const playBetMultiplier = state[11];

  return {
    stage,
    playerCards,
    communityCards,
    dealerCards,
    playBetMultiplier
  };
}

// ============================================================================
// Casino War State Parser
// ============================================================================

export interface CasinoWarState {
  playerCard: Card;
  dealerCard: Card;
  stage: 'INITIAL' | 'WAR';
}

/**
 * Casino War State Format:
 * [playerCard:u8] [dealerCard:u8] [stage:u8]
 */
export function parseCasinoWarState(state: Uint8Array): CasinoWarState {
  // Default safe state for malformed input
  if (!state || state.length < 3) {
    return {
      playerCard: DEFAULT_CARD,
      dealerCard: DEFAULT_CARD,
      stage: 'INITIAL'
    };
  }

  const playerCard = parseCard(state[0]);
  const dealerCard = parseCard(state[1]);

  const stageValue = state[2];
  const stage = stageValue === 0 ? 'INITIAL' : 'WAR';

  return { playerCard, dealerCard, stage };
}

// ============================================================================
// HiLo State Parser
// ============================================================================

export interface HiLoState {
  currentCard: Card;
  accumulator: number; // Multiplier in basis points (10000 = 1.0x)
}

/**
 * HiLo State Format:
 * [currentCard:u8] [accumulator:i64 BE]
 */
export function parseHiLoState(state: Uint8Array): HiLoState {
  // Default safe state for malformed input
  if (!state || state.length < 9) {
    return {
      currentCard: DEFAULT_CARD,
      accumulator: 10000 // 1.0x multiplier
    };
  }

  const currentCard = parseCard(state[0]);

  // Read accumulator as i64 Big Endian
  const view = new DataView(state.buffer, state.byteOffset + 1, 8);
  const accumulator = Number(view.getBigInt64(0, false)); // false = Big Endian

  return { currentCard, accumulator };
}

// ============================================================================
// Craps State Parser
// ============================================================================

export type CrapsPhase = 'COME_OUT' | 'POINT';

export type CrapsBetType =
  | 'PASS' | 'DONT_PASS' | 'COME' | 'DONT_COME' | 'FIELD'
  | 'YES' | 'NO' | 'NEXT'
  | 'HARDWAY_4' | 'HARDWAY_6' | 'HARDWAY_8' | 'HARDWAY_10'
  | 'FIRE'
  | 'ATS_SMALL' | 'ATS_TALL' | 'ATS_ALL';

export type CrapsBetStatus = 'ON' | 'PENDING';

export interface CrapsBet {
  betType: CrapsBetType;
  target: number;
  status: CrapsBetStatus;
  amount: number;
  oddsAmount: number;
}

export interface CrapsState {
  phase: CrapsPhase;
  mainPoint: number;
  dice: [number, number];
  bets: CrapsBet[];
}

// Map backend BetType enum values to frontend bet types
// Uses Record instead of array to handle gaps in enum values (13, 14 are unused)
const CRAPS_BET_TYPE_MAP: Record<number, CrapsBetType> = {
  0: 'PASS',
  1: 'DONT_PASS',
  2: 'COME',
  3: 'DONT_COME',
  4: 'FIELD',
  5: 'YES',
  6: 'NO',
  7: 'NEXT',
  8: 'HARDWAY_4',
  9: 'HARDWAY_6',
  10: 'HARDWAY_8',
  11: 'HARDWAY_10',
  12: 'FIRE',
  // 13, 14 are unused
  15: 'ATS_SMALL',
  16: 'ATS_TALL',
  17: 'ATS_ALL',
};

/**
 * Read a Big Endian u64 from bytes
 */
function readBigEndianU64(bytes: Uint8Array, offset: number): number {
  if (offset + 8 > bytes.length) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
  return Number(view.getBigUint64(0, false)); // false = Big Endian
}

/**
 * Craps State Format:
 * [phase:u8] [main_point:u8] [d1:u8] [d2:u8] [bet_count:u8] [bets:CrapsBetEntry×count]
 *
 * Each CrapsBetEntry (19 bytes):
 * [bet_type:u8] [target:u8] [status:u8] [amount:u64 BE] [odds_amount:u64 BE]
 */
export function parseCrapsState(state: Uint8Array): CrapsState {
  // Default safe state for malformed input
  if (!state || state.length < 5) {
    return {
      phase: 'COME_OUT',
      mainPoint: 0,
      dice: [0, 0],
      bets: []
    };
  }

  const phase: CrapsPhase = state[0] === 0 ? 'COME_OUT' : 'POINT';
  const mainPoint = state[1];
  const dice: [number, number] = [state[2], state[3]];
  const betCount = state[4];

  // Validate we have enough bytes for all bets (19 bytes each)
  const expectedLength = 5 + (betCount * 19);
  if (state.length < expectedLength) {
    return { phase, mainPoint, dice, bets: [] };
  }

  const bets: CrapsBet[] = [];
  let offset = 5;

  for (let i = 0; i < betCount && offset + 19 <= state.length; i++) {
    const betTypeIndex = state[offset];
    const target = state[offset + 1];
    const statusByte = state[offset + 2];
    const amount = readBigEndianU64(state, offset + 3);
    const oddsAmount = readBigEndianU64(state, offset + 11);

    // Validate bet type - use map lookup with fallback
    const betType: CrapsBetType = CRAPS_BET_TYPE_MAP[betTypeIndex] ?? 'PASS';

    const status: CrapsBetStatus = statusByte === 0 ? 'ON' : 'PENDING';

    bets.push({ betType, target, status, amount, oddsAmount });
    offset += 19;
  }

  return { phase, mainPoint, dice, bets };
}

// ============================================================================
// Main Dispatcher Function
// ============================================================================

export type ParsedGameState =
  | { type: GameType.Blackjack; state: BlackjackState }
  | { type: GameType.Roulette; state: RouletteState }
  | { type: GameType.Baccarat; state: BaccaratState }
  | { type: GameType.SicBo; state: SicBoState }
  | { type: GameType.VideoPoker; state: VideoPokerState }
  | { type: GameType.ThreeCard; state: ThreeCardState }
  | { type: GameType.UltimateHoldem; state: UltimateHoldemState }
  | { type: GameType.CasinoWar; state: CasinoWarState }
  | { type: GameType.HiLo; state: HiLoState }
  | { type: GameType.Craps; state: CrapsState };

/**
 * Parse game state based on game type
 * @param gameType The type of casino game
 * @param state Binary state blob from chain
 * @returns Parsed state object specific to the game type
 */
export function parseGameState(gameType: GameType, state: Uint8Array): ParsedGameState {
  switch (gameType) {
    case GameType.Blackjack:
      return { type: gameType, state: parseBlackjackState(state) };

    case GameType.Roulette:
      return { type: gameType, state: parseRouletteState(state) };

    case GameType.Baccarat:
      return { type: gameType, state: parseBaccaratState(state) };

    case GameType.SicBo:
      return { type: gameType, state: parseSicBoState(state) };

    case GameType.VideoPoker:
      return { type: gameType, state: parseVideoPokerState(state) };

    case GameType.ThreeCard:
      return { type: gameType, state: parseThreeCardState(state) };

    case GameType.UltimateHoldem:
      return { type: gameType, state: parseUltimateHoldemState(state) };

    case GameType.CasinoWar:
      return { type: gameType, state: parseCasinoWarState(state) };

    case GameType.HiLo:
      return { type: gameType, state: parseHiLoState(state) };

    case GameType.Craps:
      return { type: gameType, state: parseCrapsState(state) };

    default:
      throw new Error(`Unknown game type: ${gameType}`);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

// Re-export getBlackjackValue for backwards compatibility
// Canonical implementation is in gameUtils.ts
export { getBlackjackValue };

// Re-export getBaccaratValue for backwards compatibility
// Canonical implementation is in gameUtils.ts
export { getBaccaratValue };

// Re-export getHiLoRank for backwards compatibility
// Canonical implementation is in gameUtils.ts
export { getHiLoRank };

/**
 * Convert HiLo accumulator from basis points to multiplier
 * @param accumulator Value in basis points (10000 = 1.0x)
 * @returns Multiplier as decimal (e.g., 1.5 for 1.5x)
 */
export function hiloAccumulatorToMultiplier(accumulator: number): number {
  return accumulator / 10000;
}

/**
 * Convert a card ID (0-51) to a human-readable string (e.g., "5♥")
 * Card encoding: suit = card / 13, rank = (card % 13)
 * Suits: 0=♠, 1=♥, 2=♦, 3=♣
 * Ranks: 0=A, 1=2, ..., 12=K
 */
export function cardIdToString(cardId: number): string {
  if (cardId < 0 || cardId >= 52) {
    return '?';
  }
  const suitIndex = Math.floor(cardId / 13);
  const rankIndex = cardId % 13;
  const suit = SUITS[suitIndex];
  const rank = RANKS[rankIndex];
  return `${rank}${suit}`;
}
