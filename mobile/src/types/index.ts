/**
 * Shared type definitions for the mobile app.
 */

import type { Card, Suit, Rank, GameId } from '@nullspace/types';
import { GAME_DISPLAY_NAMES } from '@nullspace/constants/games';
import type { ChipValue } from '@nullspace/constants/chips';
import type { BaccaratBetName, CrapsBetName, RouletteBetName, SicBoBetName } from '@nullspace/constants/bet-types';

export type { Card, Suit, Rank, GameId };

export const GAME_NAMES = GAME_DISPLAY_NAMES;

export function getGameName(gameId: GameId): string {
  return GAME_DISPLAY_NAMES[gameId] ?? gameId;
}

// Game phases
export type GamePhase = 'betting' | 'playing' | 'waiting' | 'result';

// Bet types
export interface Bet {
  type: string;
  amount: number;
  position?: string | number;
}

// Game result
export interface GameResult {
  won: boolean;
  payout: number;
  message?: string;
}

// Player balance
export interface Balance {
  available: number;
  locked: number;
}

// WebSocket message types - re-exported from shared protocol for convenience
export type {
  GameMessage,
  BlackjackMessage,
  RouletteMessage,
  HiLoMessage,
  BaccaratMessage,
  CrapsMessage,
  CasinoWarMessage,
  VideoPokerMessage,
  SicBoMessage,
  ThreeCardPokerMessage,
  UltimateTXMessage,
} from '@nullspace/protocol/mobile';

// Tutorial step
export interface TutorialStep {
  title: string;
  description: string;
  highlight?: string;
}

export type { ChipValue };

// Roulette bet types
export type RouletteBetType = RouletteBetName;

// Craps bet types
export type CrapsBetType = CrapsBetName;

// Video poker hand rankings
export type PokerHand =
  | 'ROYAL_FLUSH'
  | 'STRAIGHT_FLUSH'
  | 'FOUR_OF_A_KIND'
  | 'FULL_HOUSE'
  | 'FLUSH'
  | 'STRAIGHT'
  | 'THREE_OF_A_KIND'
  | 'TWO_PAIR'
  | 'JACKS_OR_BETTER'
  | 'NOTHING';

// Baccarat bet types
export type BaccaratBetType = BaccaratBetName;

// Sic Bo bet types
export type SicBoBetType = SicBoBetName;

// Three Card Poker hand rankings
export type ThreeCardPokerHand =
  | 'STRAIGHT_FLUSH'
  | 'THREE_OF_A_KIND'
  | 'STRAIGHT'
  | 'FLUSH'
  | 'PAIR'
  | 'HIGH_CARD';

// Re-export all schemas and utilities from shared protocol for full access
export * from '@nullspace/protocol/mobile';
