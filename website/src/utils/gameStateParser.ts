/**
 * Game State Parsers
 * Parse binary state blobs from on-chain casino games into TypeScript objects
 *
 * All binary data uses Big Endian byte order (consistent with CasinoChainService)
 * State formats match the Rust implementations in execution/src/casino/*.rs
 */

import { GameType } from '../types/casino';

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

/**
 * Convert card byte (0-51) to Card object
 * Card encoding: suit = card / 13, rank = (card % 13)
 * Suits: 0=♠, 1=♥, 2=♦, 3=♣
 * Ranks: 0=A, 1=2, ..., 12=K
 */
function parseCard(cardByte: number): Card {
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
  let offset = 0;

  // Read player hand
  const playerLen = state[offset++];
  const playerHand: Card[] = [];
  for (let i = 0; i < playerLen; i++) {
    playerHand.push(parseCard(state[offset++]));
  }

  // Read dealer hand
  const dealerLen = state[offset++];
  const dealerHand: Card[] = [];
  for (let i = 0; i < dealerLen; i++) {
    dealerHand.push(parseCard(state[offset++]));
  }

  // Read stage
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
  if (state.length === 0) {
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
  let offset = 0;

  // Read player hand
  const playerLen = state[offset++];
  const playerHand: Card[] = [];
  for (let i = 0; i < playerLen; i++) {
    playerHand.push(parseCard(state[offset++]));
  }

  // Read banker hand
  const bankerLen = state[offset++];
  const bankerHand: Card[] = [];
  for (let i = 0; i < bankerLen; i++) {
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
  if (state.length === 0) {
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
 * Three Card Poker State Format:
 * [playerCard1:u8] [playerCard2:u8] [playerCard3:u8]
 * [dealerCard1:u8] [dealerCard2:u8] [dealerCard3:u8]
 * [stage:u8]
 */
export function parseThreeCardState(state: Uint8Array): ThreeCardState {
  const playerCards: [Card, Card, Card] = [
    parseCard(state[0]),
    parseCard(state[1]),
    parseCard(state[2])
  ];

  const dealerCards: [Card, Card, Card] = [
    parseCard(state[3]),
    parseCard(state[4]),
    parseCard(state[5])
  ];

  const stageValue = state[6];
  const stage = stageValue === 0 ? 'ANTE' : 'COMPLETE';

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
 * Ultimate Hold'em State Format:
 * [stage:u8]
 * [playerCard1:u8] [playerCard2:u8]
 * [community1:u8] [community2:u8] [community3:u8] [community4:u8] [community5:u8]
 * [dealerCard1:u8] [dealerCard2:u8]
 * [playBetMultiplier:u8]
 */
export function parseUltimateHoldemState(state: Uint8Array): UltimateHoldemState {
  const stageValue = state[0];
  const stage = stageValue === 0 ? 'PREFLOP' :
                stageValue === 1 ? 'FLOP' :
                stageValue === 2 ? 'RIVER' : 'SHOWDOWN';

  const playerCards: [Card, Card] = [
    parseCard(state[1]),
    parseCard(state[2])
  ];

  const communityCards: [Card, Card, Card, Card, Card] = [
    parseCard(state[3]),
    parseCard(state[4]),
    parseCard(state[5]),
    parseCard(state[6]),
    parseCard(state[7])
  ];

  const dealerCards: [Card, Card] = [
    parseCard(state[8]),
    parseCard(state[9])
  ];

  const playBetMultiplier = state[10];

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
  const currentCard = parseCard(state[0]);

  // Read accumulator as i64 Big Endian
  const view = new DataView(state.buffer, state.byteOffset + 1, 8);
  const accumulator = Number(view.getBigInt64(0, false)); // false = Big Endian

  return { currentCard, accumulator };
}

// ============================================================================
// Craps State Parser (placeholder - Craps is not in the 10 games list)
// ============================================================================

export interface CrapsState {
  // Craps state would be complex with multiple bets
  // Not implemented as it's not in the current game list
  raw: Uint8Array;
}

/**
 * Craps is listed in reference types but not in execution layer
 * This is a placeholder for future implementation
 */
export function parseCrapsState(state: Uint8Array): CrapsState {
  return { raw: state };
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

/**
 * Get the numeric value of a card for Blackjack
 */
export function getBlackjackValue(cards: Card[]): number {
  let value = 0;
  let aces = 0;

  for (const card of cards) {
    if (card.rank === 'A') {
      aces++;
      value += 11;
    } else if (['J', 'Q', 'K'].includes(card.rank)) {
      value += 10;
    } else {
      value += parseInt(card.rank);
    }
  }

  // Adjust for aces
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }

  return value;
}

/**
 * Get the Baccarat value of cards (mod 10)
 */
export function getBaccaratValue(cards: Card[]): number {
  let value = 0;

  for (const card of cards) {
    if (card.rank === 'A') {
      value += 1;
    } else if (['10', 'J', 'Q', 'K'].includes(card.rank)) {
      value += 0;
    } else {
      value += parseInt(card.rank);
    }
  }

  return value % 10;
}

/**
 * Get HiLo card rank (1-13, Ace=1, King=13)
 */
export function getHiLoRank(card: Card): number {
  if (card.rank === 'A') return 1;
  if (card.rank === 'K') return 13;
  if (card.rank === 'Q') return 12;
  if (card.rank === 'J') return 11;
  return parseInt(card.rank);
}

/**
 * Convert HiLo accumulator from basis points to multiplier
 * @param accumulator Value in basis points (10000 = 1.0x)
 * @returns Multiplier as decimal (e.g., 1.5 for 1.5x)
 */
export function hiloAccumulatorToMultiplier(accumulator: number): number {
  return accumulator / 10000;
}
