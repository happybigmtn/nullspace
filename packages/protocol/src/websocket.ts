/**
 * WebSocket message types for mobile <-> gateway communication.
 * The gateway relays these to/from the chain on behalf of mobile clients.
 */

import type { GameType } from '@nullspace/types';

// Client -> Gateway messages
export interface ClientMessage {
  type: string;
  requestId?: string;
}

export interface StartGameMessage extends ClientMessage {
  type: 'start_game';
  gameType: GameType;
  bet: string; // bigint as string for JSON
  sideBets?: { type: number; amount: string }[];
}

/**
 * Game-specific move messages
 * These match the Zod validation schemas exactly
 */
export interface BlackjackMoveMessage extends ClientMessage {
  type: 'game_move';
  game: 'blackjack';
  sessionId: string;
  move: 'hit' | 'stand' | 'double' | 'split' | 'deal' | 'surrender';
}

/**
 * Roulette moves - split by required fields to ensure type safety
 * TS will error if you try to send place_bet without betType/number/amount
 */
export interface RoulettePlaceBetMessage extends ClientMessage {
  type: 'game_move';
  game: 'roulette';
  sessionId: string;
  move: 'place_bet';
  betType: number;     // Required
  number: number;      // Required
  amount: string;      // Required (bigint as string)
}

export interface RouletteActionMessage extends ClientMessage {
  type: 'game_move';
  game: 'roulette';
  sessionId: string;
  move: 'spin' | 'clear_bets';
}

export type RouletteMoveMessage = RoulettePlaceBetMessage | RouletteActionMessage;

/**
 * Craps moves - split by required fields to ensure type safety
 * TS will error if you try to send a bet move without amount/betType
 */
export interface CrapsPlaceBetMessage extends ClientMessage {
  type: 'game_move';
  game: 'craps';
  sessionId: string;
  move: 'place_bet';
  betType: number;     // Required (CrapsBetType.*)
  target?: number;     // Optional (point number for Yes/No/Next/Hardway)
  amount: string;      // Required (bigint as string)
}

export type CrapsBetMessage = CrapsPlaceBetMessage;

export interface CrapsAddOddsMessage extends ClientMessage {
  type: 'game_move';
  game: 'craps';
  sessionId: string;
  move: 'add_odds';
  amount: string;      // Required (bigint as string)
}

export interface CrapsRollMessage extends ClientMessage {
  type: 'game_move';
  game: 'craps';
  sessionId: string;
  move: 'roll';
}

export interface CrapsClearBetsMessage extends ClientMessage {
  type: 'game_move';
  game: 'craps';
  sessionId: string;
  move: 'clear_bets';
}

export type CrapsMoveMessage =
  | CrapsPlaceBetMessage
  | CrapsAddOddsMessage
  | CrapsRollMessage
  | CrapsClearBetsMessage;

export type GameMoveMessage = BlackjackMoveMessage | RouletteMoveMessage | CrapsMoveMessage;

// Gateway -> Client messages
export interface ServerMessage {
  type: string;
  requestId?: string;
}

export interface GameStartedMessage extends ServerMessage {
  type: 'game_started';
  sessionId: string;
  gameType: GameType;
  initialState: string; // base64 encoded state
}

export interface GameStateMessage extends ServerMessage {
  type: 'game_state';
  sessionId: string;
  state: string; // base64 encoded state from chain
}

export interface GameResultMessage extends ServerMessage {
  type: 'game_result';
  sessionId: string;
  won: boolean;
  payout: string;
  message: string;
}

export interface ErrorMessage extends ServerMessage {
  type: 'error';
  code: string;
  message: string;
}

export type AnyClientMessage = StartGameMessage | GameMoveMessage;
export type AnyServerMessage = GameStartedMessage | GameStateMessage | GameResultMessage | ErrorMessage;
