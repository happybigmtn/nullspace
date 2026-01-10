/**
 * WebSocket client for backend updates stream
 *
 * The backend exposes game events via WebSocket at /updates/{filter}
 * where filter is a hex-encoded UpdatesFilter (Account, Session, or All).
 *
 * Events received:
 * - CasinoGameStarted: initial game state
 * - CasinoGameMoved: new state after a move
 * - CasinoGameCompleted: final result with payout
 */
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import {
  extractCasinoEvents,
  extractGlobalTableEvents,
  type CasinoGameEvent,
  type GlobalTableEvent,
} from '../codec/events.js';
import { logDebug, logError, logInfo, logWarn } from '../logger.js';

// Re-export CasinoGameEvent for convenience
export type { CasinoGameEvent, GlobalTableEvent } from '../codec/events.js';

/**
 * UpdatesFilter types matching backend
 */
export enum UpdatesFilterType {
  All = 0,
  Account = 1,
  Session = 2,
}

/**
 * Encode an UpdatesFilter for the WebSocket URL
 */
export function encodeUpdatesFilter(
  filterType: UpdatesFilterType,
  data?: Uint8Array | bigint
): string {
  let buffer: Uint8Array;

  switch (filterType) {
    case UpdatesFilterType.All:
      buffer = new Uint8Array([0]);
      break;
    case UpdatesFilterType.Account:
      if (!data || !(data instanceof Uint8Array) || data.length !== 32) {
        throw new Error('Account filter requires 32-byte public key');
      }
      buffer = new Uint8Array(1 + 32);
      buffer[0] = 1;
      buffer.set(data, 1);
      break;
    case UpdatesFilterType.Session:
      if (typeof data !== 'bigint') {
        throw new Error('Session filter requires session ID (bigint)');
      }
      buffer = new Uint8Array(1 + 8);
      buffer[0] = 2;
      const view = new DataView(buffer.buffer);
      view.setBigUint64(1, data, false); // big-endian (commonware-codec)
      break;
    default:
      throw new Error(`Unknown filter type: ${filterType}`);
  }

  return Buffer.from(buffer).toString('hex');
}


/**
 * WebSocket client for receiving backend updates
 */
export class UpdatesClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private origin: string;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private shouldReconnect = true;
  private pendingEvents: Map<bigint, CasinoGameEvent[]> = new Map();

  constructor(baseUrl: string, origin?: string) {
    super();
    // Convert http(s) to ws(s)
    this.url = baseUrl.replace(/^http/, 'ws');
    // Default origin for server-to-server requests (must match ALLOWED_HTTP_ORIGINS)
    this.origin = origin || 'http://localhost:9010';
  }

  /**
   * Connect to the updates stream for a specific account
   */
  async connectForAccount(publicKey: Uint8Array): Promise<void> {
    const filter = encodeUpdatesFilter(UpdatesFilterType.Account, publicKey);
    return this.connect(filter);
  }

  /**
   * Connect to the updates stream for a specific game session
   */
  async connectForSession(sessionId: bigint): Promise<void> {
    const filter = encodeUpdatesFilter(UpdatesFilterType.Session, sessionId);
    return this.connect(filter);
  }

  /**
   * Connect to the updates stream for all events
   */
  async connectForAll(): Promise<void> {
    const filter = encodeUpdatesFilter(UpdatesFilterType.All);
    return this.connect(filter);
  }

  /**
   * Connect to the updates stream with a hex-encoded filter
   */
  private connect(filter: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.url}/updates/${filter}`;
      logInfo(`[UpdatesClient] Connecting to ${wsUrl}`);

      this.ws = new WebSocket(wsUrl, {
        headers: {
          'Origin': this.origin,
        },
      });

      this.ws.on('open', () => {
        logInfo('[UpdatesClient] Connected to updates stream');
        this.reconnectDelay = 1000; // Reset reconnect delay on successful connection
        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data);
      });

      this.ws.on('close', () => {
        logWarn('[UpdatesClient] Connection closed');
        this.emit('close');
        if (this.shouldReconnect) {
          this.scheduleReconnect(filter);
        }
      });

      this.ws.on('error', (err) => {
        logError('[UpdatesClient] WebSocket error:', err.message);
        this.emit('error', err);
        if (this.ws?.readyState === WebSocket.CONNECTING) {
          reject(err);
        }
      });
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: Buffer): void {
    try {
      // Debug: log first 10 bytes to identify message type
      const header = Array.from(data.slice(0, Math.min(10, data.length)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');
      logDebug(`[UpdatesClient] Received message: ${data.length} bytes, header: ${header}`);
      const events = extractCasinoEvents(new Uint8Array(data));
      logDebug(`[UpdatesClient] Extracted ${events.length} casino events`);
      for (const event of events) {
        logDebug(`[UpdatesClient] Received event: ${event.type} for session ${event.sessionId}`);
        if (event.type === 'started') {
          logInfo('[UpdatesClient] Game started', {
            sessionId: event.sessionId.toString(),
            gameType: event.gameType,
            bet: event.bet?.toString(),
            stateBytes: event.initialState ? event.initialState.length : 0,
          });
        } else if (event.type === 'completed') {
          logInfo('[UpdatesClient] Game completed', {
            sessionId: event.sessionId.toString(),
            gameType: event.gameType,
            payout: event.payout?.toString(),
            finalChips: event.finalChips?.toString(),
            wasShielded: event.wasShielded,
            wasDoubled: event.wasDoubled,
            balanceSnapshot: event.balanceSnapshot
              ? {
                  chips: event.balanceSnapshot.chips.toString(),
                  vusdt: event.balanceSnapshot.vusdt.toString(),
                  rng: event.balanceSnapshot.rng.toString(),
                }
              : undefined,
          });
        } else if (event.type === 'error') {
          logWarn('[UpdatesClient] Game error', {
            sessionId: event.sessionId.toString(),
            gameType: event.gameType,
            errorCode: event.errorCode,
            message: event.errorMessage,
          });
        }

        // Store for session-based waiting FIRST (before emit to avoid race)
        const pending = this.pendingEvents.get(event.sessionId) ?? [];
        pending.push(event);
        this.pendingEvents.set(event.sessionId, pending);

        // Then emit for listeners
        this.emit('gameEvent', event);
      }

      const globalEvents = extractGlobalTableEvents(new Uint8Array(data));
      if (globalEvents.length > 0) {
        logDebug(`[UpdatesClient] Extracted ${globalEvents.length} global table events`);
        for (const event of globalEvents) {
          this.emit('globalTableEvent', event);
        }
      }
    } catch (err) {
      logError('[UpdatesClient] Failed to parse events:', err);
    }
  }

  /**
   * Wait for a game event for a specific session
   */
  async waitForEvent(
    sessionId: bigint,
    eventType: CasinoGameEvent['type'],
    timeoutMs = 30000
  ): Promise<CasinoGameEvent> {
    // Check if we already have the event
    const pending = this.pendingEvents.get(sessionId) ?? [];
    const existing = pending.find((e) => e.type === eventType);
    if (existing) {
      // Remove from pending
      const idx = pending.indexOf(existing);
      pending.splice(idx, 1);
      return existing;
    }

    // Wait for the event
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.off('gameEvent', handler);
        reject(new Error(`Timeout waiting for ${eventType} event`));
      }, timeoutMs);

      const handler = (event: CasinoGameEvent) => {
        if (event.sessionId === sessionId && event.type === eventType) {
          clearTimeout(timeout);
          this.off('gameEvent', handler);
          resolve(event);
        }
      };

      this.on('gameEvent', handler);
    });
  }

  /**
   * Wait for a game event matching a predicate
   */
  private waitForEventMatching(
    predicate: (e: CasinoGameEvent) => boolean,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<CasinoGameEvent> {
    return new Promise((resolve, reject) => {
      const checkPendingAndResolve = (): boolean => {
        for (const [, events] of this.pendingEvents) {
          const existing = events.find(predicate);
          if (existing) {
            const idx = events.indexOf(existing);
            events.splice(idx, 1);
            resolve(existing);
            return true;
          }
        }
        return false;
      };

      const timeout = setTimeout(() => {
        this.off('gameEvent', handler);
        if (!checkPendingAndResolve()) {
          reject(new Error(timeoutMessage));
        }
      }, timeoutMs);

      const handler = (event: CasinoGameEvent) => {
        if (predicate(event)) {
          clearTimeout(timeout);
          this.off('gameEvent', handler);
          resolve(event);
        }
      };

      this.on('gameEvent', handler);

      if (checkPendingAndResolve()) {
        clearTimeout(timeout);
        this.off('gameEvent', handler);
      }
    });
  }

  /**
   * Wait for ANY game event of a specific type (ignores session ID)
   * Use this when filtering by Account since a player has one game at a time
   */
  async waitForAnyEvent(
    eventType: CasinoGameEvent['type'],
    timeoutMs = 30000
  ): Promise<CasinoGameEvent> {
    return this.waitForEventMatching(
      (e) => e.type === eventType,
      timeoutMs,
      `Timeout waiting for ${eventType} event`
    );
  }

  /**
   * Wait for 'started' OR 'error' event (game start or rejection)
   */
  async waitForStartedOrError(timeoutMs = 30000): Promise<CasinoGameEvent> {
    return this.waitForEventMatching(
      (e) => e.type === 'started' || e.type === 'error',
      timeoutMs,
      'Timeout waiting for started/error event'
    );
  }

  /**
   * Wait for ANY move, complete, or error event (for post-move waiting)
   * Error events are also matched since a move can be rejected
   */
  async waitForMoveOrComplete(timeoutMs = 30000): Promise<CasinoGameEvent> {
    return this.waitForEventMatching(
      (e) => e.type === 'moved' || e.type === 'completed' || e.type === 'error',
      timeoutMs,
      'Timeout waiting for move/complete event'
    );
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(filter: string): void {
    logWarn(`[UpdatesClient] Reconnecting in ${this.reconnectDelay}ms...`);
    setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect(filter).catch((err) => {
          logError('[UpdatesClient] Reconnection failed:', err.message);
        });
      }
    }, this.reconnectDelay);

    // Exponential backoff
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  /**
   * Disconnect from the updates stream
   */
  disconnect(): void {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
