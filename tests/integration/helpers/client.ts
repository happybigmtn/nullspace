/**
 * Cross-Service Test Client
 *
 * Provides a unified client for testing the full flow:
 * Auth Service → Gateway → Simulator/Backend
 *
 * US-258: Includes CSRF token handling and cookie management
 * for testing authenticated endpoints.
 */

import WebSocket from 'ws';
import crypto from 'crypto';
import { SERVICE_URLS } from './services.js';

/**
 * Simple cookie jar for tracking cookies across requests
 */
class CookieJar {
  private cookies: Map<string, string> = new Map();

  /**
   * Parse Set-Cookie headers and store cookies
   */
  storeCookies(setCookieHeaders: string | string[] | undefined): void {
    if (!setCookieHeaders) return;
    const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    for (const header of headers) {
      // Parse cookie name=value from header (before first semicolon)
      const cookiePart = header.split(';')[0];
      if (!cookiePart) continue;
      const eqIndex = cookiePart.indexOf('=');
      if (eqIndex === -1) continue;
      const name = cookiePart.slice(0, eqIndex).trim();
      const value = cookiePart.slice(eqIndex + 1).trim();
      this.cookies.set(name, value);
    }
  }

  /**
   * Get Cookie header value for requests
   */
  getCookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  /**
   * Get a specific cookie value
   */
  getCookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  /**
   * Clear all cookies
   */
  clear(): void {
    this.cookies.clear();
  }
}

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
 *
 * US-258: Includes cookie jar for session management and CSRF token handling
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
  private cookieJar: CookieJar;
  private csrfToken: string | null = null;

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
    this.cookieJar = new CookieJar();
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
   * Includes Origin header in web mode, cookies for session management.
   */
  private buildAuthHeaders(contentType = 'application/json'): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': contentType,
    };
    if (this.mode === 'web' && this.origin) {
      headers['Origin'] = this.origin;
    }
    const cookieHeader = this.cookieJar.getCookieHeader();
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }
    return headers;
  }

  /**
   * Store cookies from a response
   */
  private storeCookiesFromResponse(response: Response): void {
    // Node fetch returns headers.getSetCookie() for multiple Set-Cookie headers
    const setCookie = response.headers.getSetCookie?.() ?? response.headers.get('set-cookie');
    this.cookieJar.storeCookies(setCookie);
  }

  /**
   * Fetch CSRF token from auth service.
   * Auth.js provides this at /auth/csrf endpoint.
   * US-258: This token is required for state-changing auth endpoints.
   */
  async getCsrfToken(): Promise<string> {
    const response = await fetch(`${this.authUrl}/auth/csrf`, {
      method: 'GET',
      headers: this.buildAuthHeaders(),
    });

    this.storeCookiesFromResponse(response);

    if (!response.ok) {
      throw new Error(`CSRF token fetch failed: ${response.status}`);
    }

    const data = (await response.json()) as { csrfToken?: string };
    if (!data?.csrfToken) {
      throw new Error('Missing CSRF token in response');
    }

    this.csrfToken = data.csrfToken;
    return data.csrfToken;
  }

  /**
   * Get the current session from auth service.
   * Requires valid session cookie from prior authentication.
   */
  async getSession(): Promise<{ user?: { id: string; authProvider?: string } } | null> {
    const response = await fetch(`${this.authUrl}/auth/session`, {
      method: 'GET',
      headers: this.buildAuthHeaders(),
    });

    this.storeCookiesFromResponse(response);

    if (!response.ok) {
      return null;
    }

    return response.json();
  }

  /**
   * Request authentication challenge from auth service.
   *
   * Note: Uses /auth/challenge endpoint (custom, not Auth.js)
   * Returns challengeId and challenge for signing.
   */
  async getAuthChallenge(): Promise<{ challengeId: string; challenge: string }> {
    const response = await fetch(`${this.authUrl}/auth/challenge`, {
      method: 'POST',
      headers: this.buildAuthHeaders(),
      body: JSON.stringify({ publicKey: this.user.publicKey }),
    });

    this.storeCookiesFromResponse(response);

    if (!response.ok) {
      throw new Error(`Auth challenge failed: ${response.status}`);
    }

    const data = (await response.json()) as { challengeId: string; challenge: string };
    return { challengeId: data.challengeId, challenge: data.challenge };
  }

  /**
   * Authenticate with signed challenge.
   *
   * US-258: Uses Auth.js /auth/callback/credentials endpoint with proper CSRF token.
   * The callback uses application/x-www-form-urlencoded format per Auth.js conventions.
   */
  async authenticate(): Promise<{ success: boolean; session?: { user?: { id: string } } }> {
    // First fetch CSRF token (this also sets the CSRF cookie)
    const csrfToken = await this.getCsrfToken();

    // Get auth challenge
    const { challengeId, challenge } = await this.getAuthChallenge();

    // Build auth message matching server format
    const message = `Sign this message to authenticate:\n${challenge}`;
    const signature = signMessage(message, this.user.privateKey);

    // Auth.js callback expects application/x-www-form-urlencoded
    const body = new URLSearchParams({
      csrfToken,
      publicKey: this.user.publicKey,
      signature,
      challengeId,
    });

    const response = await fetch(`${this.authUrl}/auth/callback/credentials`, {
      method: 'POST',
      headers: this.buildAuthHeaders('application/x-www-form-urlencoded'),
      body: body.toString(),
      redirect: 'manual', // Don't follow redirects automatically
    });

    this.storeCookiesFromResponse(response);

    // Auth.js typically returns a 302 redirect on success
    if (response.status === 302 || response.status === 200) {
      // Verify session was created
      const session = await this.getSession();
      return { success: true, session: session ?? undefined };
    }

    const error = await response.text().catch(() => 'Unknown error');
    throw new Error(`Auth verify failed: ${response.status} - ${error}`);
  }

  /**
   * Make a CSRF-protected request to auth service.
   * US-258: Automatically includes CSRF token in request body.
   */
  async authFetchWithCsrf(
    path: string,
    body?: Record<string, unknown>
  ): Promise<Response> {
    // Ensure we have a CSRF token
    if (!this.csrfToken) {
      await this.getCsrfToken();
    }

    const bodyWithCsrf = JSON.stringify({ ...body, csrfToken: this.csrfToken });

    const response = await fetch(`${this.authUrl}${path}`, {
      method: 'POST',
      headers: this.buildAuthHeaders(),
      body: bodyWithCsrf,
    });

    this.storeCookiesFromResponse(response);
    return response;
  }

  /**
   * Make an unauthenticated request (for testing CSRF rejection).
   * Does NOT include CSRF token.
   */
  async authFetchWithoutCsrf(
    path: string,
    body?: Record<string, unknown>
  ): Promise<Response> {
    const response = await fetch(`${this.authUrl}${path}`, {
      method: 'POST',
      headers: this.buildAuthHeaders(),
      body: JSON.stringify(body ?? {}),
    });

    this.storeCookiesFromResponse(response);
    return response;
  }

  /**
   * Clear all stored cookies and CSRF token
   */
  clearCookies(): void {
    this.cookieJar.clear();
    this.csrfToken = null;
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
