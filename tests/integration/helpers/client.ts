/**
 * Cross-Service Test Client
 *
 * Provides a unified client for testing the full flow:
 * Auth Service → Gateway → Simulator/Backend
 */

import WebSocket from 'ws';
import crypto from 'crypto';
import { SERVICE_URLS } from './services.js';

export interface TestUser {
  publicKey: string;
  privateKey: string;
  sessionId?: string;
  balance?: bigint;
}

export interface GameMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * Generate a test Ed25519 keypair
 */
export function generateTestKeypair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  const publicKeyHex = publicKey
    .export({ type: 'spki', format: 'der' })
    .subarray(-32) // Ed25519 public key is last 32 bytes
    .toString('hex');

  const privateKeyHex = privateKey
    .export({ type: 'pkcs8', format: 'der' })
    .subarray(-32) // Ed25519 private key is last 32 bytes
    .toString('hex');

  return { publicKey: publicKeyHex, privateKey: privateKeyHex };
}

/**
 * Sign a message with Ed25519 private key
 */
export function signMessage(message: string, privateKeyHex: string): string {
  const privateKeyDer = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'), // PKCS8 prefix
    Buffer.from(privateKeyHex, 'hex'),
  ]);

  const privateKey = crypto.createPrivateKey({
    key: privateKeyDer,
    format: 'der',
    type: 'pkcs8',
  });

  const signature = crypto.sign(null, Buffer.from(message), privateKey);
  return signature.toString('hex');
}

/**
 * Client connection mode for Origin header handling.
 * - 'web': Sends Origin header (browser-like behavior)
 * - 'mobile': No Origin header (native app behavior)
 */
export type ClientMode = 'web' | 'mobile';

/**
 * CrossServiceClient - Handles the full authentication and game flow
 *
 * Supports testing both web and mobile connection scenarios:
 * - Web mode: Sends Origin header, validates CORS allowlist
 * - Mobile mode: No Origin header, relies on GATEWAY_ALLOW_NO_ORIGIN=1
 */
export class CrossServiceClient {
  private ws: WebSocket | null = null;
  private user: TestUser;
  private messageQueue: GameMessage[] = [];
  private messageHandlers: Map<string, (msg: GameMessage) => void> = new Map();
  private gatewayUrl: string;
  private authUrl: string;
  private mode: ClientMode;
  private origin: string | null;

  constructor(
    user?: TestUser,
    options?: {
      gatewayUrl?: string;
      authUrl?: string;
      /**
       * Connection mode:
       * - 'web': Include Origin header (default, for browser clients)
       * - 'mobile': No Origin header (for native/mobile clients)
       */
      mode?: ClientMode;
      /**
       * Custom origin to send (only used in 'web' mode).
       * Defaults to http://localhost:5173
       */
      origin?: string;
    }
  ) {
    this.user = user || {
      ...generateTestKeypair(),
    };
    this.gatewayUrl = options?.gatewayUrl || SERVICE_URLS.gatewayWs;
    this.authUrl = options?.authUrl || SERVICE_URLS.auth;
    this.mode = options?.mode ?? 'web';
    this.origin = options?.origin ?? 'http://localhost:5173';
  }

  /**
   * Get the client's connection mode
   */
  getMode(): ClientMode {
    return this.mode;
  }

  /**
   * Get the test user's public key
   */
  getPublicKey(): string {
    return this.user.publicKey;
  }

  /**
   * Connect to the gateway WebSocket
   *
   * In 'web' mode, sends Origin header to validate CORS allowlist.
   * In 'mobile' mode, no Origin header (native app behavior).
   */
  async connect(timeoutMs = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, timeoutMs);

      // Build WebSocket options based on connection mode
      const wsOptions: WebSocket.ClientOptions = {};
      if (this.mode === 'web' && this.origin) {
        // Web clients send Origin header
        wsOptions.headers = { Origin: this.origin };
      }
      // Mobile mode: no Origin header (relies on GATEWAY_ALLOW_NO_ORIGIN)

      this.ws = new WebSocket(this.gatewayUrl, wsOptions);

      this.ws.on('open', () => {
        clearTimeout(timer);
        resolve();
      });

      this.ws.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as GameMessage;
          this.messageQueue.push(message);

          const handler = this.messageHandlers.get(message.type);
          if (handler) {
            handler(message);
          }
        } catch {
          // Ignore parse errors
        }
      });

      this.ws.on('close', () => {
        this.ws = null;
      });
    });
  }

  /**
   * Disconnect from the gateway
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.messageQueue = [];
    this.messageHandlers.clear();
  }

  /**
   * Send a message to the gateway
   */
  send(message: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Wait for a specific message type
   */
  async waitForMessage(messageType: string, timeoutMs = 30000): Promise<GameMessage> {
    // Check queue first
    const index = this.messageQueue.findIndex((msg) => msg.type === messageType);
    if (index !== -1) {
      const message = this.messageQueue[index]!;
      this.messageQueue.splice(index, 1);
      return message;
    }

    // Wait for new message
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.messageHandlers.delete(messageType);
        reject(new Error(`Timeout waiting for message: ${messageType}`));
      }, timeoutMs);

      const handler = (message: GameMessage) => {
        clearTimeout(timer);
        this.messageHandlers.delete(messageType);
        resolve(message);
      };

      this.messageHandlers.set(messageType, handler);
    });
  }

  /**
   * Send and wait for response
   */
  async sendAndReceive(
    message: object,
    timeoutMs = 30000
  ): Promise<GameMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Response timeout'));
      }, timeoutMs);

      const handler = (data: WebSocket.Data) => {
        clearTimeout(timer);
        this.ws?.off('message', handler);
        try {
          resolve(JSON.parse(data.toString()));
        } catch (err) {
          reject(err);
        }
      };

      this.ws?.on('message', handler);
      this.send(message);
    });
  }

  /**
   * Wait for session_ready and registration
   */
  async waitForReady(timeoutMs = 60000): Promise<void> {
    // Wait for session_ready
    const sessionMsg = await this.waitForMessage('session_ready', timeoutMs);
    this.user.sessionId = sessionMsg.sessionId as string;

    // Poll for registration and balance
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const balance = await this.sendAndReceive({ type: 'get_balance' });
      if (balance.registered && balance.hasBalance) {
        this.user.balance = BigInt(String(balance.balance ?? 0));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    throw new Error('Registration timeout');
  }

  /**
   * Get current balance
   */
  async getBalance(): Promise<{
    registered: boolean;
    hasBalance: boolean;
    balance: string;
    publicKey: string;
  }> {
    const response = await this.sendAndReceive({ type: 'get_balance' });
    return {
      registered: Boolean(response.registered),
      hasBalance: Boolean(response.hasBalance),
      balance: String(response.balance ?? '0'),
      publicKey: String(response.publicKey ?? ''),
    };
  }

  /**
   * Build headers for auth service requests.
   * Includes Origin header in web mode for CORS validation.
   */
  private buildAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.mode === 'web' && this.origin) {
      headers['Origin'] = this.origin;
    }
    return headers;
  }

  /**
   * Request authentication challenge from auth service.
   *
   * Note: Uses /auth/challenge endpoint (not /api/auth/challenge)
   * per actual auth service routes.
   */
  async getAuthChallenge(): Promise<string> {
    const response = await fetch(`${this.authUrl}/auth/challenge`, {
      method: 'POST',
      headers: this.buildAuthHeaders(),
      body: JSON.stringify({ publicKey: this.user.publicKey }),
    });

    if (!response.ok) {
      throw new Error(`Auth challenge failed: ${response.status}`);
    }

    const data = await response.json();
    return data.challenge;
  }

  /**
   * Authenticate with signed challenge.
   *
   * Note: Uses /auth/callback/credentials endpoint (not /api/auth/verify)
   * per actual auth service routes.
   */
  async authenticate(): Promise<{ token: string; userId: string }> {
    const challenge = await this.getAuthChallenge();

    // Build auth message matching server format
    const message = `Sign this message to authenticate:\n${challenge}`;
    const signature = signMessage(message, this.user.privateKey);

    const response = await fetch(`${this.authUrl}/auth/callback/credentials`, {
      method: 'POST',
      headers: this.buildAuthHeaders(),
      body: JSON.stringify({
        publicKey: this.user.publicKey,
        challenge,
        signature,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Auth verify failed: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Play a blackjack hand
   */
  async playBlackjackHand(betAmount: number): Promise<{
    gameStarted: GameMessage;
    result: GameMessage;
  }> {
    // Start game
    const gameStarted = await this.sendAndReceive({
      type: 'blackjack_deal',
      amount: betAmount,
    });

    if (gameStarted.type === 'error') {
      throw new Error(`Game start failed: ${gameStarted.code}`);
    }

    // Simple strategy: always stand
    const result = await this.sendAndReceive({ type: 'blackjack_stand' });

    return { gameStarted, result };
  }

  /**
   * Play a hi-lo round
   */
  async playHiLoRound(
    betAmount: number,
    guess: 'higher' | 'lower'
  ): Promise<GameMessage> {
    // Start game
    const gameStarted = await this.sendAndReceive({
      type: 'hilo_deal',
      amount: betAmount,
    });

    if (gameStarted.type === 'error') {
      throw new Error(`Game start failed: ${gameStarted.code}`);
    }

    // Make guess
    const result = await this.sendAndReceive({
      type: 'hilo_guess',
      guess,
    });

    return result;
  }

  /**
   * Clear the message queue
   */
  clearQueue(): void {
    this.messageQueue = [];
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
