/**
 * Session lifecycle manager
 * Handles player registration, deposits, session tracking, and event subscriptions
 */
import { randomUUID } from 'crypto';
import type { WebSocket } from 'ws';
import { ed25519 } from '@noble/curves/ed25519';

import { NonceManager } from './nonce.js';
import { SubmitClient } from '../backend/http.js';
import { UpdatesClient, type CasinoGameEvent } from '../backend/updates.js';
import {
  encodeCasinoRegister,
  encodeCasinoDeposit,
  buildTransaction,
  wrapSubmission,
  generateSessionId,
} from '../codec/index.js';
import type { Session, SessionCreateOptions } from '../types/session.js';
import type { GameType } from '@nullspace/types';

const DEFAULT_INITIAL_BALANCE = 10000n;  // 10,000 test chips

export class SessionManager {
  private sessions: Map<WebSocket, Session> = new Map();
  private byPublicKey: Map<string, Session> = new Map();
  private nonceManager: NonceManager;
  private submitClient: SubmitClient;
  private backendUrl: string;

  constructor(submitClient: SubmitClient, backendUrl: string, nonceManager?: NonceManager) {
    this.submitClient = submitClient;
    this.backendUrl = backendUrl;
    this.nonceManager = nonceManager ?? new NonceManager();
  }

  /**
   * Create a new session and register player on-chain
   */
  async createSession(
    ws: WebSocket,
    options: SessionCreateOptions = {}
  ): Promise<Session> {
    const privateKey = ed25519.utils.randomPrivateKey();
    const publicKey = ed25519.getPublicKey(privateKey);
    const publicKeyHex = Buffer.from(publicKey).toString('hex');

    const playerName = options.playerName ?? `Player_${publicKeyHex.slice(0, 8)}`;
    const initialBalance = options.initialBalance ?? DEFAULT_INITIAL_BALANCE;

    const now = Date.now();
    const session: Session = {
      id: randomUUID(),
      ws,
      publicKey,
      privateKey,
      publicKeyHex,
      playerName,
      registered: false,
      hasBalance: false,
      balance: 0n,
      activeGameId: null,
      gameType: null,
      gameSessionCounter: 0n,
      connectedAt: now,
      lastActivityAt: now,
    };

    this.sessions.set(ws, session);
    this.byPublicKey.set(publicKeyHex, session);

    // Register and deposit before returning session (must complete before client can play)
    try {
      await this.initializePlayer(session, initialBalance);
    } catch (err) {
      console.error(`Failed to initialize player ${playerName}:`, err);
    }

    return session;
  }

  /**
   * Register player on-chain and connect to updates stream.
   * Note: Players receive INITIAL_CHIPS (1,000) on registration automatically.
   * The faucet (CasinoDeposit) is rate-limited for new accounts so we don't auto-deposit.
   *
   * IMPORTANT: Must connect WebSocket FIRST before sending transactions,
   * otherwise we miss the broadcast of results (race condition).
   */
  private async initializePlayer(session: Session, _initialBalance: bigint): Promise<void> {
    // Step 1: Connect to updates stream FIRST (before any transactions)
    // This ensures we're subscribed to receive event broadcasts
    try {
      const updatesClient = new UpdatesClient(this.backendUrl);
      await updatesClient.connectForAccount(session.publicKey);
      session.updatesClient = updatesClient;
      console.log(`Connected to updates stream for ${session.playerName}`);
    } catch (err) {
      console.warn(`Failed to connect to updates stream for ${session.playerName}:`, err);
      // Non-fatal - game can still work, just won't get real-time events
    }

    // Step 2: Register player (grants INITIAL_CHIPS automatically)
    // Now the WebSocket is ready to receive the registration result
    const registerResult = await this.registerPlayer(session);
    if (!registerResult) {
      console.warn(`Registration failed for ${session.playerName}`);
      return;
    }

    // Player gets 1,000 chips on registration - mark as having balance
    session.hasBalance = true;
    session.balance = 1000n;
  }

  /**
   * Register player on-chain (CasinoRegister)
   */
  private async registerPlayer(session: Session): Promise<boolean> {
    const instruction = encodeCasinoRegister(session.playerName);
    const nonce = this.nonceManager.getAndIncrement(session.publicKeyHex);
    const tx = buildTransaction(nonce, instruction, session.privateKey);
    const submission = wrapSubmission(tx);

    const result = await this.submitClient.submit(submission);

    if (result.accepted) {
      session.registered = true;
      this.nonceManager.confirmNonce(session.publicKeyHex, nonce);
      console.log(`Registered player: ${session.playerName}`);
      return true;
    }

    // Handle nonce mismatch
    if (result.error && this.nonceManager.handleRejection(session.publicKeyHex, result.error)) {
      await this.nonceManager.syncFromBackend(session.publicKeyHex, this.getBackendUrl());
      // Retry once
      return this.registerPlayer(session);
    }

    console.error(`Registration rejected for ${session.playerName}: ${result.error}`);
    return false;
  }

  /**
   * Deposit chips (CasinoDeposit)
   */
  private async depositChips(session: Session, amount: bigint): Promise<boolean> {
    const instruction = encodeCasinoDeposit(amount);
    const nonce = this.nonceManager.getAndIncrement(session.publicKeyHex);
    const tx = buildTransaction(nonce, instruction, session.privateKey);
    const submission = wrapSubmission(tx);

    const result = await this.submitClient.submit(submission);

    if (result.accepted) {
      session.hasBalance = true;
      this.nonceManager.confirmNonce(session.publicKeyHex, nonce);
      console.log(`Deposited ${amount} chips for ${session.playerName}`);
      return true;
    }

    // Handle nonce mismatch
    if (result.error && this.nonceManager.handleRejection(session.publicKeyHex, result.error)) {
      await this.nonceManager.syncFromBackend(session.publicKeyHex, this.getBackendUrl());
      // Retry once
      return this.depositChips(session, amount);
    }

    console.error(`Deposit rejected for ${session.playerName}: ${result.error}`);
    return false;
  }

  /**
   * Get session by WebSocket
   */
  getSession(ws: WebSocket): Session | undefined {
    return this.sessions.get(ws);
  }

  /**
   * Get session by public key
   */
  getSessionByPublicKey(publicKey: Uint8Array): Session | undefined {
    const hex = Buffer.from(publicKey).toString('hex');
    return this.byPublicKey.get(hex);
  }

  /**
   * Get session by public key hex
   */
  getSessionByPublicKeyHex(publicKeyHex: string): Session | undefined {
    return this.byPublicKey.get(publicKeyHex);
  }

  /**
   * Destroy session on disconnect
   */
  destroySession(ws: WebSocket): Session | undefined {
    const session = this.sessions.get(ws);
    if (session) {
      // Disconnect updates client
      if (session.updatesClient) {
        session.updatesClient.disconnect();
      }
      this.byPublicKey.delete(session.publicKeyHex);
      this.sessions.delete(ws);
      console.log(`Session destroyed: ${session.playerName}`);
    }
    return session;
  }

  /**
   * Update session activity timestamp
   */
  touchSession(session: Session): void {
    session.lastActivityAt = Date.now();
  }

  /**
   * Start a game for session
   */
  startGame(session: Session, gameType: GameType): bigint {
    const gameId = generateSessionId(session.publicKey, session.gameSessionCounter++);
    session.activeGameId = gameId;
    session.gameType = gameType;
    session.lastActivityAt = Date.now();
    return gameId;
  }

  /**
   * End current game for session
   */
  endGame(session: Session): void {
    session.activeGameId = null;
    session.gameType = null;
    session.lastActivityAt = Date.now();
  }

  /**
   * Get nonce manager for direct access
   */
  getNonceManager(): NonceManager {
    return this.nonceManager;
  }

  /**
   * Get submit client for direct access
   */
  getSubmitClient(): SubmitClient {
    return this.submitClient;
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get backend URL (for nonce sync)
   */
  getBackendUrl(): string {
    return this.backendUrl;
  }

  /**
   * Clean up idle sessions
   */
  cleanupIdleSessions(maxIdleMs: number = 30 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [ws, session] of this.sessions.entries()) {
      if (now - session.lastActivityAt > maxIdleMs) {
        this.destroySession(ws);
        try {
          ws.close(1000, 'Session timeout');
        } catch {
          // Ignore close errors
        }
        cleaned++;
      }
    }

    return cleaned;
  }
}
