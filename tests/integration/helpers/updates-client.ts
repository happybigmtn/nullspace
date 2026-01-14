/**
 * Updates WebSocket Client for Integration Tests
 *
 * Connects to the simulator's /updates/:filter WebSocket endpoint to receive
 * real-time chain updates (Casino events, Transaction events, etc.)
 *
 * US-256: Verifies that gateway-initiated bets result in on-chain updates.
 */
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { SERVICE_URLS } from './services.js';

const parseTimeout = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const IS_TESTNET = SERVICE_URLS.simulator.includes('testnet.regenesis.dev');
const DEFAULT_UPDATE_TIMEOUT_MS = parseTimeout(
  process.env.TEST_UPDATES_TIMEOUT_MS,
  IS_TESTNET ? 120000 : 30000
);

/**
 * UpdatesFilter types matching backend (commonware-codec encoding)
 */
export enum UpdatesFilterType {
  All = 0,
  Account = 1,
  Session = 2,
}

/**
 * Encode an UpdatesFilter for the WebSocket URL path
 * Format: single-byte tag followed by payload (if any)
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
 * Raw update message from the simulator
 * The actual structure depends on the Update type from nullspace_types::api
 */
export interface RawUpdate {
  type: 'seed' | 'events' | 'filtered_events';
  data: Uint8Array;
}

/**
 * Simplified chain event structure for testing
 * Actual events are binary (commonware-codec), but we track basic info
 */
export interface ChainUpdateInfo {
  /** Total bytes received */
  byteCount: number;
  /** Whether we received any update message */
  received: boolean;
  /** Timestamp when first update was received */
  receivedAt?: number;
  /** Number of update messages received */
  messageCount: number;
}

/**
 * WebSocket client for receiving blockchain updates from the simulator.
 *
 * Used in integration tests to verify that gateway-initiated bets
 * result in on-chain state changes being broadcast.
 */
export class UpdatesClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private origin: string;
  private updateInfo: ChainUpdateInfo = {
    byteCount: 0,
    received: false,
    messageCount: 0,
  };
  private rawMessages: Uint8Array[] = [];

  constructor(baseUrl?: string, origin?: string) {
    super();
    const base = baseUrl || SERVICE_URLS.simulator;
    // Convert http(s) to ws(s)
    this.url = base.replace(/^http/, 'ws');
    // Origin for server-to-server requests (must match ALLOWED_WS_ORIGINS)
    this.origin = origin || process.env.TEST_ORIGIN || SERVICE_URLS.website;
  }

  /**
   * Connect to the updates stream for all events
   */
  async connectForAll(): Promise<void> {
    const filter = encodeUpdatesFilter(UpdatesFilterType.All);
    return this.connect(filter);
  }

  /**
   * Connect to the updates stream for a specific account
   */
  async connectForAccount(publicKeyHex: string): Promise<void> {
    const publicKey = Buffer.from(publicKeyHex, 'hex');
    if (publicKey.length !== 32) {
      throw new Error('Public key must be 32 bytes');
    }
    const filter = encodeUpdatesFilter(UpdatesFilterType.Account, new Uint8Array(publicKey));
    return this.connect(filter);
  }

  /**
   * Connect to the updates stream for a specific session
   */
  async connectForSession(sessionId: bigint): Promise<void> {
    const filter = encodeUpdatesFilter(UpdatesFilterType.Session, sessionId);
    return this.connect(filter);
  }

  /**
   * Internal connect with hex-encoded filter
   */
  private connect(filter: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.url}/updates/${filter}`;

      this.ws = new WebSocket(wsUrl, {
        headers: {
          Origin: this.origin,
        },
      });

      this.ws.on('open', () => {
        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data);
      });

      this.ws.on('close', () => {
        this.emit('close');
      });

      this.ws.on('error', (err) => {
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
    const bytes = new Uint8Array(data);
    this.rawMessages.push(bytes);
    this.updateInfo.byteCount += bytes.length;
    this.updateInfo.messageCount += 1;
    if (!this.updateInfo.received) {
      this.updateInfo.received = true;
      this.updateInfo.receivedAt = Date.now();
    }
    this.emit('update', bytes);
  }

  /**
   * Wait for at least one update message
   */
  async waitForUpdate(timeoutMs = DEFAULT_UPDATE_TIMEOUT_MS): Promise<Uint8Array> {
    // Check if we already have an update
    if (this.rawMessages.length > 0) {
      return this.rawMessages[0]!;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.off('update', handler);
        reject(new Error('Timeout waiting for chain update'));
      }, timeoutMs);

      const handler = (data: Uint8Array) => {
        clearTimeout(timeout);
        this.off('update', handler);
        resolve(data);
      };

      this.on('update', handler);
    });
  }

  /**
   * Wait for multiple update messages
   */
  async waitForUpdates(
    count: number,
    timeoutMs = DEFAULT_UPDATE_TIMEOUT_MS
  ): Promise<Uint8Array[]> {
    // Check if we already have enough
    if (this.rawMessages.length >= count) {
      return this.rawMessages.slice(0, count);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.off('update', handler);
        // Return what we have even on timeout
        if (this.rawMessages.length > 0) {
          resolve(this.rawMessages.slice(0, count));
        } else {
          reject(new Error(`Timeout waiting for ${count} chain updates, got ${this.rawMessages.length}`));
        }
      }, timeoutMs);

      const handler = () => {
        if (this.rawMessages.length >= count) {
          clearTimeout(timeout);
          this.off('update', handler);
          resolve(this.rawMessages.slice(0, count));
        }
      };

      this.on('update', handler);
    });
  }

  /**
   * Get update statistics
   */
  getUpdateInfo(): ChainUpdateInfo {
    return { ...this.updateInfo };
  }

  /**
   * Get all raw messages received
   */
  getRawMessages(): Uint8Array[] {
    return [...this.rawMessages];
  }

  /**
   * Clear received messages (for multiple tests)
   */
  clearMessages(): void {
    this.rawMessages = [];
    this.updateInfo = {
      byteCount: 0,
      received: false,
      messageCount: 0,
    };
  }

  /**
   * Disconnect from the updates stream
   */
  disconnect(): void {
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

/**
 * Fetch account state from simulator's /account/:pubkey endpoint
 */
export async function getAccountState(
  publicKeyHex: string,
  baseUrl?: string
): Promise<{ nonce: number; balance: number }> {
  const url = baseUrl || SERVICE_URLS.simulator;
  const response = await fetch(`${url}/account/${publicKeyHex}`, {
    method: 'GET',
    headers: {
      Origin: process.env.TEST_ORIGIN ?? SERVICE_URLS.website,
    },
  });

  if (!response.ok) {
    if (response.status === 400) {
      // Account doesn't exist yet
      return { nonce: 0, balance: 0 };
    }
    throw new Error(`Failed to fetch account: ${response.status}`);
  }

  return response.json();
}
