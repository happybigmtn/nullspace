/**
 * Casino types matching on-chain state/events.
 */

import { GameType } from './game.js';

export { GameType };

/**
 * Player state on-chain
 */
export interface Player {
  nonce: bigint;
  name: string;
  chips: bigint;
  shields: number;
  doubles: number;
  rank: number;
  activeShield: boolean;
  activeDouble: boolean;
  activeSuper?: boolean;
  activeSession: bigint | null;
  lastDepositBlock: bigint;
  auraMeter?: number;
  tournamentsPlayedToday?: number;
  lastTournamentTs?: bigint;
  tournamentDailyLimit?: number;
}

export interface PlayerBalanceSnapshot {
  chips: bigint;
  vusdtBalance: bigint;
  shields: number;
  doubles: number;
  tournamentChips: bigint;
  tournamentShields: number;
  tournamentDoubles: number;
  activeTournament: bigint | null;
}

/**
 * Game session state
 */
export interface GameSession {
  id: bigint;
  player: Uint8Array;
  gameType: GameType;
  bet: bigint;
  stateBlob: Uint8Array;
  moveCount: number;
  createdAt: bigint;
  isComplete: boolean;
  superMode?: {
    isActive: boolean;
    streakLevel: number;
    multipliers: Array<{ id: number; multiplier: number; superType: string }>;
  } | null;
  isTournament: boolean;
  tournamentId: bigint | null;
}

/**
 * Leaderboard entry
 */
export interface LeaderboardEntry {
  player: Uint8Array;
  name: string;
  chips: bigint;
  rank: number;
}

/**
 * Casino leaderboard
 */
export interface CasinoLeaderboard {
  entries: LeaderboardEntry[];
}

/**
 * Event: CasinoGameStarted (tag 21)
 * Emitted when a new game session is started
 */
export interface CasinoGameStartedEvent {
  type: 'CasinoGameStarted';
  sessionId: bigint;
  player: Uint8Array;
  gameType: GameType;
  bet: bigint;
  initialState: Uint8Array;
}

/**
 * Event: CasinoGameMoved (tag 22)
 * Emitted when a move is made in a game session
 */
export interface CasinoGameMovedEvent {
  type: 'CasinoGameMoved';
  sessionId: bigint;
  moveNumber: number;
  newState: Uint8Array;
  logs?: string[];
  playerBalances: PlayerBalanceSnapshot;
}

/**
 * Event: CasinoGameCompleted (tag 23)
 * Emitted when a game session is completed
 */
export interface CasinoGameCompletedEvent {
  type: 'CasinoGameCompleted';
  sessionId: bigint;
  player: Uint8Array;
  gameType: GameType;
  payout: bigint;
  finalChips: bigint;
  wasShielded: boolean;
  wasDoubled: boolean;
  logs?: string[];
  playerBalances: PlayerBalanceSnapshot;
}
