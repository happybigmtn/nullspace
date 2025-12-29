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

  /** WebSocket client for backend updates (optional, created after registration) */
  updatesClient?: UpdatesClient;
}

/**
 * Session creation options
 */
export interface SessionCreateOptions {
  playerName?: string;
  initialBalance?: bigint;
}
