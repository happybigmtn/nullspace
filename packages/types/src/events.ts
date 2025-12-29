/**
 * Chain event payload types for rendering
 * These types describe the shape of data received from chain events.
 * The chain computes all values - frontends just render them.
 */

import type { GameType } from './game.js';
import type { Card } from './cards.js';

/** Base event structure from chain */
export interface ChainEvent {
  eventType: string;
  timestamp: bigint;
}

/** Game started event - initial state for rendering */
export interface GameStartedEvent extends ChainEvent {
  eventType: 'GameStarted';
  sessionId: bigint;
  gameType: GameType;
  player: Uint8Array;
  bet: bigint;
}

/** Blackjack state from chain - render directly, no local calculation */
export interface BlackjackStateEvent extends ChainEvent {
  eventType: 'BlackjackState';
  sessionId: bigint;
  playerCards: Card[];
  dealerCards: Card[];
  playerTotal: number;   // Chain-computed, just display it
  dealerTotal: number;   // Chain-computed, just display it
  stage: 'betting' | 'playing' | 'dealer_turn' | 'complete';
  canHit: boolean;       // Chain tells us valid actions
  canStand: boolean;
  canDouble: boolean;
  canSplit: boolean;
}

/** Game result event - outcome determined by chain */
export interface GameResultEvent extends ChainEvent {
  eventType: 'GameResult';
  sessionId: bigint;
  gameType: GameType;
  won: boolean;
  payout: bigint;
  message: string;
}

/** Balance update after game completion */
export interface BalanceUpdateEvent extends ChainEvent {
  eventType: 'BalanceUpdate';
  player: Uint8Array;
  newBalance: bigint;
  delta: bigint;
}

export type AnyChainEvent =
  | GameStartedEvent
  | BlackjackStateEvent
  | GameResultEvent
  | BalanceUpdateEvent;
