/**
 * Session types for gateway
 */
import type { WebSocket } from 'ws';
import type { GameType } from '@nullspace/types';
import type { UpdatesClient } from '../backend/updates.js';

/**
 * Client session state
 */
export interface Session {
  /** Unique session ID (UUID) */
  id: string;

  /** WebSocket connection */
  ws: WebSocket;

  /** Ed25519 public key (32 bytes) */
  publicKey: Uint8Array;

  /** Ed25519 private key (32 bytes) */
  privateKey: Uint8Array;

  /** Public key as hex string (for lookups) */
  publicKeyHex: string;

  /** Player display name */
  playerName: string;

  /** Has CasinoRegister been accepted? */
  registered: boolean;

  /** Has CasinoDeposit been accepted? */
  hasBalance: boolean;

  /** Current balance (tracked locally) */
  balance: bigint;

  /**
   * Balance sequence number (monotonically increasing)
   * Used by mobile to ignore out-of-order balance updates.
   * Incremented every time balance is sent to client.
   */
  balanceSeq: bigint;

  /** Active game session ID (null if no game) */
  activeGameId: bigint | null;

  /** Active game type */
  gameType: GameType | null;

  /** Counter for unique session ID generation */
  gameSessionCounter: bigint;

  /** Connection timestamp */
  connectedAt: number;

  /** Last activity timestamp */
  lastActivityAt: number;

  /** Last faucet claim timestamp (ms) */
  lastFaucetAt?: number;

  /** Last bet amount (for analytics) */
  lastGameBet?: bigint;

  /** Balance before current game started (for analytics) */
  lastGameStartChips?: bigint;

  /** Timestamp when game started (ms) */
  lastGameStartedAt?: number;

  /** WebSocket client for backend updates (optional, created after registration) */
  updatesClient?: UpdatesClient;

  /** WebSocket client for session-scoped updates (optional, created per game) */
  sessionUpdatesClient?: UpdatesClient;

  /** Session ID currently bound to sessionUpdatesClient */
  sessionUpdatesSessionId?: bigint;

  /** Periodic balance refresh interval (optional) */
  balanceRefreshIntervalId?: ReturnType<typeof setInterval>;
}

/**
 * Session creation options
 */
export interface SessionCreateOptions {
  playerName?: string;
}
