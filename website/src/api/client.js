import { WasmWrapper } from './wasm.js';
import { NonceManager } from './nonceManager.js';
import { snakeToCamel } from '../utils/caseNormalizer.js';
import { getUnlockedVault } from '../security/vaultRuntime';
import { logDebug } from '../utils/logger.js';

// Delay between fetch retries
const FETCH_RETRY_DELAY_MS = 1000;
// Timeout for individual fetch requests
const FETCH_TIMEOUT_MS = 10000;

const normalizeBaseUrl = (baseUrl) => {
  if (!baseUrl) return baseUrl;
  if (baseUrl.startsWith('/')) return baseUrl;
  try {
    const url = new URL(baseUrl);
    if (url.protocol === 'ws:') url.protocol = 'http:';
    if (url.protocol === 'wss:') url.protocol = 'https:';
    const normalized = url.toString();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  } catch {
    return baseUrl;
  }
};
/**
 * Generate a cryptographically secure request ID
 * US-140: Use crypto.getRandomValues() for unpredictable IDs
 */
const makeRequestId = () => {
  // Prefer crypto.randomUUID (most modern browsers)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback to crypto.getRandomValues (wider support than randomUUID)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Last resort fallback (shouldn't happen in any modern browser)
  console.warn('[Security] crypto API unavailable, using timestamp-based ID');
  return `${Date.now().toString(36)}-fallback`;
};

/**
 * Client for communicating with the Casino chain.
 * Handles WebSocket connections, transaction submission, and state queries.
 */
export class CasinoClient {
  constructor(baseUrl = '/api', wasm) {
    if (!wasm) {
      throw new Error('WasmWrapper is required for CasinoClient');
    }
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.wasm = wasm;
    this.updatesWs = null;
    this.sessionWs = null;
    this.eventHandlers = new Map();
    this.nonceManager = new NonceManager(this, wasm);
    this.masterPublic = wasm.identityBytes;
    this.latestSeed = null;
    this.currentSessionFilter = null;
    this.updatesStatus = {
      connected: false,
      lastMessageAt: 0,
      lastEventAt: 0,
      lastSeedAt: 0,
      lastOpenAt: 0,
      lastCloseAt: 0
    };
    this.sessionStatus = {
      connected: false,
      lastMessageAt: 0,
      lastEventAt: 0,
      lastOpenAt: 0,
      lastCloseAt: 0
    };

    // Reconnection configuration
    this.reconnectConfig = {
      attempts: 0,
      baseDelay: 1000,
      maxDelay: 30000, // Cap at 30 seconds
      reconnecting: false,
      timer: null
    };
    this.sessionReconnectConfig = {
      attempts: 0,
      baseDelay: 1000,
      maxDelay: 30000,
      reconnecting: false,
      timer: null
    };
  }

  async init() {
    await this.wasm.init();
    // Set master public key after wasm is initialized
    this.masterPublic = this.wasm.identityBytes;
    return this;
  }

  /**
   * Initialize the nonce manager with a keypair.
   * @param {string} publicKeyHex - Hex-encoded public key
   * @param {Uint8Array} publicKeyBytes - Raw public key bytes
   * @param {Object|null} account - Account data (null if account doesn't exist)
   */
  async initNonceManager(publicKeyHex, publicKeyBytes, account) {
    await this.nonceManager.init(publicKeyHex, publicKeyBytes, account);
  }

  /**
   * Clean up the nonce manager and WebSocket connections.
   */
  destroy() {
    this.nonceManager.destroy();

    // Stop any pending reconnection attempts
    this.reconnectConfig.reconnecting = false;
    this.reconnectConfig.attempts = 0;
    this.sessionReconnectConfig.reconnecting = false;
    this.sessionReconnectConfig.attempts = 0;

    // Clear any pending reconnection timers
    if (this.reconnectConfig.timer) {
      clearTimeout(this.reconnectConfig.timer);
      this.reconnectConfig.timer = null;
    }
    if (this.sessionReconnectConfig.timer) {
      clearTimeout(this.sessionReconnectConfig.timer);
      this.sessionReconnectConfig.timer = null;
    }

    const now = Date.now();
    this.updatesStatus.connected = false;
    this.updatesStatus.lastCloseAt = now;
    this.updatesStatus.lastMessageAt = 0;
    this.updatesStatus.lastEventAt = 0;
    this.updatesStatus.lastSeedAt = 0;
    this.updatesStatus.lastOpenAt = 0;
    this.sessionStatus.connected = false;
    this.sessionStatus.lastCloseAt = now;
    this.sessionStatus.lastMessageAt = 0;
    this.sessionStatus.lastEventAt = 0;
    this.sessionStatus.lastOpenAt = 0;

    // Close WebSocket connections without triggering reconnect
    if (this.updatesWs) {
      // Remove the close handler to prevent reconnection
      this.updatesWs.onclose = null;
      this.updatesWs.close();
      this.updatesWs = null;
    }
    if (this.sessionWs) {
      this.sessionWs.onclose = null;
      this.sessionWs.close();
      this.sessionWs = null;
    }

    // Clear event handlers to prevent memory leaks
    this.eventHandlers.clear();

    try {
      this.wasm?.clearKeypair?.();
    } catch {
      // ignore
    }
  }

  /**
   * Connect to a different updates stream.
   * @param {Uint8Array|null} publicKey - Public key bytes for account filter, or null for all events
   * @returns {Promise<void>}
   */
  async switchUpdates(publicKey = null) {
    // Stop any pending reconnection attempts
    this.reconnectConfig.reconnecting = false;
    this.reconnectConfig.attempts = 0;
    if (this.reconnectConfig.timer) {
      clearTimeout(this.reconnectConfig.timer);
      this.reconnectConfig.timer = null;
    }

    // Close existing connection if any
    if (this.updatesWs) {
      // Remove the close handler to prevent reconnection
      this.updatesWs.onclose = null;
      this.updatesWs.close();
      this.updatesWs = null;
      this.updatesStatus.connected = false;
      this.updatesStatus.lastCloseAt = Date.now();
      this.updatesStatus.lastMessageAt = 0;
      this.updatesStatus.lastEventAt = 0;
      this.updatesStatus.lastSeedAt = 0;
      this.updatesStatus.lastOpenAt = 0;
    }

    // Connect with new filter
    await this.connectUpdates(publicKey);
  }

  buildUpdatesCandidates(filterHex) {
    const candidates = [];

    // Optional explicit WebSocket endpoint override
    const explicitWs = import.meta.env.VITE_WS_URL;
    if (explicitWs) {
      try {
        const url = new URL(explicitWs);
        const secure = url.protocol === 'https:' || url.protocol === 'wss:';
        const wsProtocol = secure ? 'wss:' : 'ws:';
        candidates.push(`${wsProtocol}//${url.host}/updates/${filterHex}`);
      } catch (e) {
        console.warn('Invalid VITE_WS_URL for WebSocket:', explicitWs, e);
      }
    }

    // FIRST: Try direct connection to VITE_URL (most reliable for WebSockets)
    const directUrl = import.meta.env.VITE_URL;
    const toWsUrl = (rawUrl) => {
      if (!rawUrl || rawUrl.startsWith('/')) return null; // ignore relative URLs
      try {
        const url = new URL(rawUrl);
        const secure = url.protocol === 'https:' || url.protocol === 'wss:';
        const wsProtocol = secure ? 'wss:' : 'ws:';
        return `${wsProtocol}//${url.host}/updates/${filterHex}`;
      } catch (e) {
        console.warn('Invalid VITE_URL for WebSocket:', rawUrl, e);
        return null;
      }
    };
    if (directUrl) {
      const wsUrl = toWsUrl(directUrl);
      if (wsUrl) candidates.push(wsUrl);
    } else if (
      this.baseUrl.startsWith('http://') ||
      this.baseUrl.startsWith('https://') ||
      this.baseUrl.startsWith('ws://') ||
      this.baseUrl.startsWith('wss://')
    ) {
      // Full URL provided, convert to WebSocket URL
      const wsUrl = toWsUrl(this.baseUrl);
      if (wsUrl) candidates.push(wsUrl);
    }

    // SECOND: Try same-origin proxy (for production where direct connection may be blocked)
    if (typeof window !== 'undefined' && this.baseUrl && !this.baseUrl.startsWith('http://') && !this.baseUrl.startsWith('https://')) {
      const proxyWsUrl = window.location.protocol === 'https:'
        ? `wss://${window.location.host}${this.baseUrl}/updates/${filterHex}`
        : `ws://${window.location.host}${this.baseUrl}/updates/${filterHex}`;
      if (!candidates.includes(proxyWsUrl)) candidates.push(proxyWsUrl);
    }

    // THIRD: Fallback to standard simulator port 8080 on the same hostname (for LAN access)
    if (typeof window !== 'undefined') {
      const fallbackWsUrl = window.location.protocol === 'https:'
        ? `wss://${window.location.hostname}:8080/updates/${filterHex}`
        : `ws://${window.location.hostname}:8080/updates/${filterHex}`;
      if (!candidates.includes(fallbackWsUrl)) candidates.push(fallbackWsUrl);
    }

    return candidates;
  }


  /**
   * Submit a transaction to the simulator.
   * @param {Uint8Array} transaction - Raw transaction bytes
   * @returns {Promise<{status: string}>} Transaction result
   * @throws {Error} If submission fails
   */
  async submitTransaction(transaction) {
    // Wrap transaction in Submission enum
    const submission = this.wasm.wrapTransactionSubmission(transaction);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(`${this.baseUrl}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-request-id': makeRequestId()
        },
        body: submission,
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Transaction submission timed out. Please try again.');
      }
      throw error;
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Server error response:', errorText);
      throw new Error(`Server error: ${response.status} ${response.statusText}`);
    }

    // The simulator returns 200 OK with no body for successful submissions
    // Transaction results come through the events WebSocket
    return { status: 'accepted' };
  }

  /**
   * Get the current view number from the latest seed we've seen.
   * @returns {number|null} Current view number or null if no seed seen yet
   */
  getCurrentView() {
    return this.latestSeed ? this.latestSeed.view : null;
  }

  /**
   * Wait for the first seed to arrive.
   * First tries to fetch existing seed via REST API, then falls back to WebSocket.
   * @returns {Promise<void>} Resolves when first seed is received
   */
  async waitForFirstSeed() {
    if (this.latestSeed) {
      return;
    }

    // First, try to fetch an existing seed via REST API
    logDebug('Checking for existing seed via REST API...');
    const result = await this.queryLatestSeed();
    if (result.found) {
      logDebug('Found existing seed via REST API, view:', result.seed.view);
      this.latestSeed = result.seed;
      return;
    }

    logDebug('No existing seed found, waiting for WebSocket event...');
    // Fall back to waiting for WebSocket event
    return new Promise((resolve) => {
      // Set up a one-time handler for the first seed
      const unsubscribe = this.onEvent('Seed', () => {
        unsubscribe();
        resolve();
      });
    });
  }


  /**
   * Query state by key.
   * @param {Uint8Array} keyBytes - State key bytes
   * @returns {Promise<{found: boolean, value: any}>} Query result
   */
  async queryState(keyBytes) {
    // Hash the key before querying (matching upstream changes)
    const hashedKey = this.wasm.hashKey(keyBytes);
    const hexKey = this.wasm.bytesToHex(hashedKey);

    let response;
    while (true) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        response = await fetch(`${this.baseUrl}/state/${hexKey}`, {
          headers: {
            'x-request-id': makeRequestId()
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);
      } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          throw new Error('State query timed out. Please try again.');
        }
        throw error;
      }

      if (response.status === 404) {
        return { found: false, value: null };
      }

      if (response.status === 200) {
        break;
      }

      // Retry on any other status
      logDebug(`State query returned ${response.status}, retrying...`);
      await new Promise(resolve => setTimeout(resolve, FETCH_RETRY_DELAY_MS));
    }

    // Get binary response
    const buffer = await response.arrayBuffer();
    const valueBytes = new Uint8Array(buffer);

    if (valueBytes.length === 0) {
      return { found: false, value: null };
    }

    try {
      // Decode value using WASM - returns plain JSON object
      const value = this.wasm.decodeLookup(valueBytes);
      // Normalize snake_case to camelCase
      const normalized = snakeToCamel(value);
      return { found: true, value: normalized };
    } catch (error) {
      console.error('Failed to decode value:', error);
      return { found: false, value: null };
    }
  }

  /**
   * Query seed by view number.
   * @param {number} view - View number to query
   * @returns {Promise<{found: boolean, seed?: any, seedBytes?: Uint8Array}>} Query result
   */
  async querySeed(view) {
    // Encode the query for specific view index
    const queryBytes = this.wasm.encodeQuery('index', view);
    const hexQuery = this.wasm.bytesToHex(queryBytes);

    let response;
    while (true) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        response = await fetch(`${this.baseUrl}/seed/${hexQuery}`, {
          headers: {
            'x-request-id': makeRequestId()
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);
      } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          throw new Error('Seed query timed out. Please try again.');
        }
        throw error;
      }

      if (response.status === 404) {
        return { found: false };
      }

      if (response.status === 200) {
        break;
      }

      // Retry on any other status
      logDebug(`Seed query returned ${response.status}, retrying...`);
      await new Promise(resolve => setTimeout(resolve, FETCH_RETRY_DELAY_MS));
    }

    const seedBytes = await response.arrayBuffer();
    const seedBytesArray = new Uint8Array(seedBytes);
    const seed = this.wasm.decodeSeed(seedBytesArray);
    return { found: true, seed, seedBytes: seedBytesArray };
  }

  /**
   * Query the latest seed via REST API.
   * @returns {Promise<{found: boolean, seed?: any, seedBytes?: Uint8Array}>} Query result
   */
  async queryLatestSeed() {
    // Encode the query for latest seed
    const queryBytes = this.wasm.encodeQuery('latest');
    const hexQuery = this.wasm.bytesToHex(queryBytes);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(`${this.baseUrl}/seed/${hexQuery}`, {
        headers: {
          'x-request-id': makeRequestId()
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        logDebug('Latest seed query timed out');
        return { found: false };
      }
      throw error;
    }

    if (response.status === 404) {
      return { found: false };
    }

    if (response.status !== 200) {
      logDebug(`Latest seed query returned ${response.status}`);
      return { found: false };
    }

    const seedBytes = await response.arrayBuffer();
    const seedBytesArray = new Uint8Array(seedBytes);
    try {
      const seed = this.wasm.decodeSeed(seedBytesArray);
      return { found: true, seed, seedBytes: seedBytesArray };
    } catch (error) {
      console.error('Failed to decode latest seed:', error);
      return { found: false };
    }
  }

  /**
   * Connect to the updates WebSocket stream with exponential backoff.
   * @param {Uint8Array|null} publicKey - Public key bytes for account filter, or null for all events
   * @returns {Promise<void>}
   */
  connectUpdates(publicKey = null) {
    return new Promise((resolve, reject) => {
      // Store the publicKey for reconnection
      this.currentUpdateFilter = publicKey;

      // Encode the filter based on whether we have a public key
      let filterBytes;
      if (publicKey === null) {
        // Connect to all events (firehose)
        filterBytes = this.wasm.encodeUpdatesFilterAll();
      } else {
        // Connect to account-specific events
        filterBytes = this.wasm.encodeUpdatesFilterAccount(publicKey);
      }
      const filterHex = this.wasm.bytesToHex(filterBytes);

      const candidates = this.buildUpdatesCandidates(filterHex);

      if (candidates.length === 0) {
        reject(new Error('No WebSocket URL candidates available'));
        return;
      }

      const connectAt = (index) => {
        const wsUrl = candidates[index];
        logDebug('Connecting to Updates WebSocket at:', wsUrl, 'with filter:', publicKey ? 'account' : 'all');
        const ws = new WebSocket(wsUrl);
        this.updatesWs = ws;

        ws.onopen = () => {
          logDebug('Updates WebSocket connected successfully');
          this.updatesStatus.connected = true;
          this.updatesStatus.lastOpenAt = Date.now();
          resolve();
        };

        ws.onerror = (error) => {
          console.error('Updates WebSocket error:', error);
          console.error('WebSocket URL was:', wsUrl);
          console.error('WebSocket readyState:', ws.readyState);

          try {
            ws.onclose = null;
            ws.close();
          } catch {
            // ignore
          }

          // Fall back to next candidate if available.
          if (index + 1 < candidates.length) {
            console.warn('Falling back to next WebSocket candidate...');
            connectAt(index + 1);
            return;
          }

          reject(new Error(`WebSocket connection failed to ${wsUrl}`));
        };

        this.updatesWs.onmessage = async (event) => {
          logDebug('[WebSocket] Received message, data type:', typeof event.data, event.data instanceof Blob ? 'Blob' : 'not Blob');
          try {
            const now = Date.now();
            this.updatesStatus.lastMessageAt = now;
            let bytes;
            if (event.data instanceof Blob) {
              // Browser environment - convert blob to array buffer
              const arrayBuffer = await event.data.arrayBuffer();
              bytes = new Uint8Array(arrayBuffer);
            } else if (event.data instanceof ArrayBuffer) {
              // ArrayBuffer - convert directly
              bytes = new Uint8Array(event.data);
            } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(event.data)) {
              // Node.js environment - Buffer is already a Uint8Array
              bytes = new Uint8Array(event.data);
            } else if (typeof event.data === 'string') {
              // Some proxies may send string control frames; ignore them
              logDebug('[WebSocket] Skipping string message:', event.data.slice(0, 80));
              return;
            } else {
              console.warn('Unknown WebSocket message type:', typeof event.data);
              return;
            }

            // Now we have binary data in bytes, decode it
            try {
              const decodedUpdate = this.wasm.decodeUpdate(bytes);
              logDebug('[WebSocket] Decoded update type:', decodedUpdate.type, decodedUpdate.type === 'Events' ? `(${decodedUpdate.events?.length} events)` : '');

              // Check if it's a Seed or Events/FilteredEvents update
              if (decodedUpdate.type === 'Seed') {
                this.latestSeed = decodedUpdate;
                this.updatesStatus.lastSeedAt = now;
                this.handleEvent(decodedUpdate);
              } else if (decodedUpdate.type === 'Events') {
                this.updatesStatus.lastEventAt = now;
                // Process each event from the array - treat FilteredEvents the same as Events
                for (const eventData of decodedUpdate.events) {
                  logDebug('[WebSocket] Event type:', eventData.type, 'data:', eventData);
                  // Normalize snake_case to camelCase
                  const normalizedEvent = snakeToCamel(eventData);
                  // Check if this is a transaction from our account
                  if (normalizedEvent.type === 'Transaction') {
                    if (this.nonceManager.publicKeyHex &&
                      normalizedEvent.public.toLowerCase() === this.nonceManager.publicKeyHex.toLowerCase()) {
                      this.nonceManager.updateNonceFromTransaction(normalizedEvent.nonce);
                    }
                  }
                  this.handleEvent(normalizedEvent);
                }
              }
            } catch (decodeError) {
              console.error('Failed to decode update:', decodeError);
              logDebug('Full raw bytes:', this.wasm.bytesToHex(bytes).match(/.{2}/g).join(' '));
            }
          } catch (e) {
            console.error('Failed to process WebSocket message:', e);
          }
        };

        this.updatesWs.onclose = (event) => {
          logDebug('Updates WebSocket disconnected, code:', event.code, 'reason:', event.reason);
          this.updatesStatus.connected = false;
          this.updatesStatus.lastCloseAt = Date.now();
          this.handleReconnect('updatesWs', () => this.connectUpdates(this.currentUpdateFilter));
        };
      };

      connectAt(0);
    });
  }

  async switchSessionUpdates(sessionId = null) {
    this.sessionReconnectConfig.reconnecting = false;
    this.sessionReconnectConfig.attempts = 0;
    if (this.sessionReconnectConfig.timer) {
      clearTimeout(this.sessionReconnectConfig.timer);
      this.sessionReconnectConfig.timer = null;
    }

    this.currentSessionFilter = sessionId;

    if (this.sessionWs) {
      this.sessionWs.onclose = null;
      this.sessionWs.close();
      this.sessionWs = null;
      this.sessionStatus.connected = false;
      this.sessionStatus.lastCloseAt = Date.now();
      this.sessionStatus.lastMessageAt = 0;
      this.sessionStatus.lastEventAt = 0;
      this.sessionStatus.lastOpenAt = 0;
    }

    if (sessionId === null || sessionId === undefined) {
      return;
    }

    await this.connectSessionUpdates(sessionId);
  }

  disconnectSessionUpdates() {
    return this.switchSessionUpdates(null);
  }

  connectSessionUpdates(sessionId) {
    return new Promise((resolve, reject) => {
      if (sessionId === null || sessionId === undefined) {
        resolve();
        return;
      }

      let sessionValue;
      try {
        sessionValue = typeof sessionId === 'bigint' ? sessionId : BigInt(sessionId);
      } catch (e) {
        reject(new Error(`Invalid session id: ${sessionId}`));
        return;
      }

      const filterBytes = this.wasm.encodeUpdatesFilterSession(sessionValue);
      const filterHex = this.wasm.bytesToHex(filterBytes);
      const candidates = this.buildUpdatesCandidates(filterHex);

      if (candidates.length === 0) {
        reject(new Error('No WebSocket URL candidates available'));
        return;
      }

      const connectAt = (index) => {
        const wsUrl = candidates[index];
        logDebug('Connecting to Session Updates WebSocket at:', wsUrl, 'session:', sessionValue.toString());
        const ws = new WebSocket(wsUrl);
        this.sessionWs = ws;

        ws.onopen = () => {
          logDebug('Session Updates WebSocket connected successfully');
          this.sessionStatus.connected = true;
          this.sessionStatus.lastOpenAt = Date.now();
          resolve();
        };

        ws.onerror = (error) => {
          console.error('Session Updates WebSocket error:', error);
          console.error('WebSocket URL was:', wsUrl);
          console.error('WebSocket readyState:', ws.readyState);

          try {
            ws.onclose = null;
            ws.close();
          } catch {
            // ignore
          }

          if (index + 1 < candidates.length) {
            console.warn('Falling back to next Session WebSocket candidate...');
            connectAt(index + 1);
            return;
          }

          reject(new Error(`Session WebSocket connection failed to ${wsUrl}`));
        };

        this.sessionWs.onmessage = async (event) => {
          try {
            const now = Date.now();
            this.sessionStatus.lastMessageAt = now;
            let bytes;
            if (event.data instanceof Blob) {
              const arrayBuffer = await event.data.arrayBuffer();
              bytes = new Uint8Array(arrayBuffer);
            } else if (event.data instanceof ArrayBuffer) {
              bytes = new Uint8Array(event.data);
            } else if (Buffer.isBuffer(event.data)) {
              bytes = new Uint8Array(event.data);
            } else {
              console.warn('Unknown WebSocket message type:', typeof event.data);
              return;
            }

            try {
              const decodedUpdate = this.wasm.decodeUpdate(bytes);
              if (decodedUpdate.type !== 'Events') return;
              this.sessionStatus.lastEventAt = now;
              for (const eventData of decodedUpdate.events) {
                const normalizedEvent = snakeToCamel(eventData);
                this.handleEvent(normalizedEvent);
              }
            } catch (decodeError) {
              console.error('Failed to decode session update:', decodeError);
            }
          } catch (e) {
            console.error('Failed to process session WebSocket message:', e);
          }
        };

        this.sessionWs.onclose = (event) => {
          logDebug('Session Updates WebSocket disconnected, code:', event.code, 'reason:', event.reason);
          this.sessionStatus.connected = false;
          this.sessionStatus.lastCloseAt = Date.now();
          if (this.currentSessionFilter === null || this.currentSessionFilter === undefined) {
            return;
          }
          this.handleReconnect(
            'sessionWs',
            () => this.connectSessionUpdates(this.currentSessionFilter),
            this.sessionReconnectConfig
          );
        };
      };

      connectAt(0);
    });
  }


  /**
   * Subscribe to events of a specific type.
   * @param {string} eventType - Event type to subscribe to ('*' for all events)
   * @param {Function} handler - Event handler function
   * @returns {Function} Unsubscribe function
   */
  onEvent(eventType, handler) {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType).push(handler);

    // Return unsubscribe function to prevent memory leaks
    return () => {
      const handlers = this.eventHandlers.get(eventType);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index !== -1) {
          handlers.splice(index, 1);
        }
        // Clean up empty handler arrays
        if (handlers.length === 0) {
          this.eventHandlers.delete(eventType);
        }
      }
    };
  }

  getUpdatesStatus() {
    return {
      ...this.updatesStatus,
      readyState: this.updatesWs?.readyState ?? null,
    };
  }

  getSessionStatus() {
    return {
      ...this.sessionStatus,
      readyState: this.sessionWs?.readyState ?? null,
    };
  }

  /**
   * Handle incoming events from WebSocket.
   * @param {Object} event - Event data object
   * @private
   */
  handleEvent(event) {
    const handlers = this.eventHandlers.get(event.type) || [];
    handlers.forEach(handler => handler(event));

    // Also call generic handlers
    const allHandlers = this.eventHandlers.get('*') || [];
    allHandlers.forEach(handler => handler(event));
  }

  /**
   * Handle WebSocket reconnection with exponential backoff.
   * @param {string} wsType - Type of WebSocket ('updatesWs')
   * @param {Function} connectFn - Function to call for reconnection
   * @private
   */
  handleReconnect(wsType, connectFn, config = this.reconnectConfig) {

    if (config.reconnecting) {
      return;
    }

    config.reconnecting = true;
    config.attempts++;

    // Calculate delay with exponential backoff and jitter
    const baseDelay = Math.min(config.baseDelay * Math.pow(2, config.attempts - 1), config.maxDelay);
    const jitter = Math.random() * 0.3 * baseDelay; // 30% jitter
    const delay = baseDelay + jitter;

    logDebug(`Reconnecting ${wsType} in ${Math.round(delay)}ms (attempt ${config.attempts})`);

    config.timer = setTimeout(async () => {
      // Check if we've been destroyed while waiting
      if (config.attempts === 0) {
        // attempts is reset to 0 in destroy()
        return;
      }

      try {
        await connectFn();
        // Reset on successful connection
        config.attempts = 0;
        logDebug(`Successfully reconnected ${wsType}`);
      } catch (error) {
        console.error(`Failed to reconnect ${wsType}:`, error.message);
        config.reconnecting = false;
        // Try again unless destroyed
        if (config.attempts > 0) {
          this.handleReconnect(wsType, connectFn);
        }
      } finally {
        config.reconnecting = false;
        config.timer = null;
      }
    }, delay);
  }

  /**
   * Get account information by public key.
   * @param {Uint8Array} publicKeyBytes - Account public key
   * @returns {Promise<Object|null>} Account data or null if not found
   */
  async getAccount(publicKeyBytes) {
    const keyBytes = this.wasm.encodeAccountKey(publicKeyBytes);
    const result = await this.queryState(keyBytes);

    if (result.found && result.value) {
      // Value is already a plain object from WASM
      if (result.value.type === 'Account') {
        return result.value;
      } else {
        logDebug('Value is not an Account type:', result.value.type);
        return null;
      }
    }

    return null;
  }

  /**
   * Get casino player information by public key.
   * @param {Uint8Array} publicKeyBytes - Player public key
   * @returns {Promise<Object|null>} CasinoPlayer data or null if not found
   */
  async getCasinoPlayer(publicKeyBytes) {
    logDebug('[Client] getCasinoPlayer called with publicKeyBytes:', publicKeyBytes?.length, 'bytes');
    const keyBytes = this.wasm.encodeCasinoPlayerKey(publicKeyBytes);
    logDebug('[Client] Encoded player key:', keyBytes?.length, 'bytes');
    const result = await this.queryState(keyBytes);
    logDebug('[Client] queryState result:', result);

    if (result.found && result.value) {
      // Value is already a plain object from WASM
      if (result.value.type === 'CasinoPlayer') {
        // Normalize snake_case to camelCase for frontend consistency
        const normalized = snakeToCamel(result.value);
        logDebug('[Client] Found CasinoPlayer:', normalized);
        return normalized;
      } else {
        logDebug('[Client] Value is not a CasinoPlayer type:', result.value.type);
        return null;
      }
    }

    logDebug('[Client] Player not found on-chain');
    return null;
  }

  /**
   * Get casino session information by session ID.
   * @param {bigint|number} sessionId - Session ID
   * @returns {Promise<Object|null>} CasinoSession data or null if not found
   */
  async getCasinoSession(sessionId) {
    const keyBytes = this.wasm.encodeCasinoSessionKey(sessionId);
    const result = await this.queryState(keyBytes);

    if (result.found && result.value) {
      if (result.value.type === 'CasinoSession') {
        return result.value;
      } else {
        logDebug('Value is not a CasinoSession type:', result.value.type);
        return null;
      }
    }

    return null;
  }

  /**
   * Get casino leaderboard.
   * @returns {Promise<Object|null>} CasinoLeaderboard data or null if not found
   */
  async getCasinoLeaderboard() {
    const keyBytes = this.wasm.encodeCasinoLeaderboardKey();
    const result = await this.queryState(keyBytes);

    if (result.found && result.value) {
      if (result.value.type === 'CasinoLeaderboard') {
        return result.value;
      } else {
        logDebug('Value is not a CasinoLeaderboard type:', result.value.type);
        return null;
      }
    }

    return null;
  }

  /**
   * Get casino tournament information by tournament ID.
   * @param {bigint|number} tournamentId - Tournament ID
   * @returns {Promise<Object|null>} Tournament data or null if not found
   */
  async getCasinoTournament(tournamentId) {
    const keyBytes = this.wasm.encodeCasinoTournamentKey(tournamentId);
    const result = await this.queryState(keyBytes);

    if (result.found && result.value) {
      if (result.value.type === 'Tournament') {
        // Normalize snake_case to camelCase for frontend consistency
        return snakeToCamel(result.value);
      } else {
        logDebug('Value is not a Tournament type:', result.value.type);
        return null;
      }
    }

    return null;
  }

  /**
   * Get vault state for an account.
   * @param {Uint8Array} publicKeyBytes - Account public key
   * @returns {Promise<Object|null>} Vault data or null if not found
   */
  async getVault(publicKeyBytes) {
    const keyBytes = this.wasm.encodeVaultKey(publicKeyBytes);
    const result = await this.queryState(keyBytes);

    if (result.found && result.value) {
      if (result.value.type === 'Vault') {
        return snakeToCamel(result.value);
      }
      return null;
    }

    return null;
  }

  /**
   * Get AMM pool state.
   * @returns {Promise<Object|null>} AmmPool data or null if not found
   */
  async getAmmPool() {
    const keyBytes = this.wasm.encodeAmmPoolKey();
    const result = await this.queryState(keyBytes);

    if (result.found && result.value) {
      if (result.value.type === 'AmmPool') {
        return snakeToCamel(result.value);
      }
      return null;
    }

    return null;
  }

  /**
   * Get LP balance for an account.
   * @param {Uint8Array} publicKeyBytes - Account public key
   * @returns {Promise<Object|null>} LpBalance data or null if not found
   */
  async getLpBalance(publicKeyBytes) {
    const keyBytes = this.wasm.encodeLpBalanceKey(publicKeyBytes);
    const result = await this.queryState(keyBytes);

    if (result.found && result.value) {
      if (result.value.type === 'LpBalance') {
        return snakeToCamel(result.value);
      }
      return null;
    }

    return null;
  }

  /**
   * Get house state.
   * @returns {Promise<Object|null>} House data or null if not found
   */
  async getHouse() {
    const keyBytes = this.wasm.encodeHouseKey();
    const result = await this.queryState(keyBytes);

    if (result.found && result.value) {
      if (result.value.type === 'House') {
        return snakeToCamel(result.value);
      }
      return null;
    }

    return null;
  }

  /**
   * Get policy state.
   * @returns {Promise<Object|null>} Policy data or null if not found
   */
  async getPolicy() {
    const keyBytes = this.wasm.encodePolicyKey();
    const result = await this.queryState(keyBytes);

    if (result.found && result.value) {
      if (result.value.type === 'Policy') {
        return snakeToCamel(result.value);
      }
      return null;
    }

    return null;
  }

  /**
   * Get oracle state.
   * @returns {Promise<Object|null>} Oracle data or null if not found
   */
  async getOracleState() {
    const keyBytes = this.wasm.encodeOracleStateKey();
    const result = await this.queryState(keyBytes);

    if (result.found && result.value) {
      if (result.value.type === 'OracleState') {
        return snakeToCamel(result.value);
      }
      return null;
    }

    return null;
  }

  /**
   * Get treasury state.
   * @returns {Promise<Object|null>} Treasury data or null if not found
   */
  async getTreasury() {
    const keyBytes = this.wasm.encodeTreasuryKey();
    const result = await this.queryState(keyBytes);

    if (result.found && result.value) {
      if (result.value.type === 'Treasury') {
        return snakeToCamel(result.value);
      }
      return null;
    }

    return null;
  }

  /**
   * Get treasury vesting state.
   * @returns {Promise<Object|null>} TreasuryVesting data or null if not found
   */
  async getTreasuryVesting() {
    const keyBytes = this.wasm.encodeTreasuryVestingKey();
    const result = await this.queryState(keyBytes);

    if (result.found && result.value) {
      if (result.value.type === 'TreasuryVesting') {
        return snakeToCamel(result.value);
      }
      return null;
    }

    return null;
  }

  /**
   * Get vault registry state.
   * @returns {Promise<Object|null>} VaultRegistry data or null if not found
   */
  async getVaultRegistry() {
    const keyBytes = this.wasm.encodeVaultRegistryKey();
    const result = await this.queryState(keyBytes);

    if (result.found && result.value) {
      if (result.value.type === 'VaultRegistry') {
        return snakeToCamel(result.value);
      }
      return null;
    }

    return null;
  }

  /**
   * Get player registry state.
   * @returns {Promise<Object|null>} PlayerRegistry data or null if not found
   */
  async getPlayerRegistry() {
    const keyBytes = this.wasm.encodePlayerRegistryKey();
    const result = await this.queryState(keyBytes);

    if (result.found && result.value) {
      if (result.value.type === 'PlayerRegistry') {
        return snakeToCamel(result.value);
      }
      return null;
    }

    return null;
  }

  /**
   * Get savings pool state.
   * @returns {Promise<Object|null>} SavingsPool data or null if not found
   */
  async getSavingsPool() {
    const keyBytes = this.wasm.encodeSavingsPoolKey();
    const result = await this.queryState(keyBytes);

    if (result.found && result.value) {
      if (result.value.type === 'SavingsPool') {
        return snakeToCamel(result.value);
      }
      return null;
    }

    return null;
  }

  /**
   * Get savings balance state for an account.
   * @param {Uint8Array} publicKeyBytes - Account public key
   * @returns {Promise<Object|null>} SavingsBalance data or null if not found
   */
  async getSavingsBalance(publicKeyBytes) {
    const keyBytes = this.wasm.encodeSavingsBalanceKey(publicKeyBytes);
    const result = await this.queryState(keyBytes);

    if (result.found && result.value) {
      if (result.value.type === 'SavingsBalance') {
        return snakeToCamel(result.value);
      }
      return null;
    }

    return null;
  }

  /**
   * Get bridge state.
   * @returns {Promise<Object|null>} BridgeState data or null if not found
   */
  async getBridgeState() {
    const keyBytes = this.wasm.encodeBridgeStateKey();
    const result = await this.queryState(keyBytes);

    if (result.found && result.value) {
      if (result.value.type === 'BridgeState') {
        return snakeToCamel(result.value);
      }
      return null;
    }

    return null;
  }

  /**
   * Get a bridge withdrawal record.
   * @param {bigint|number} withdrawalId - Withdrawal ID
   * @returns {Promise<Object|null>} BridgeWithdrawal data or null if not found
   */
  async getBridgeWithdrawal(withdrawalId) {
    const keyBytes = this.wasm.encodeBridgeWithdrawalKey(withdrawalId);
    const result = await this.queryState(keyBytes);

    if (result.found && result.value) {
      if (result.value.type === 'BridgeWithdrawal') {
        return snakeToCamel(result.value);
      }
      return null;
    }

    return null;
  }

  /**
   * Get staker state for an account.
   * @param {Uint8Array} publicKeyBytes - Account public key
   * @returns {Promise<Object|null>} Staker data or null if not found
   */
  async getStaker(publicKeyBytes) {
    const keyBytes = this.wasm.encodeStakerKey(publicKeyBytes);
    const result = await this.queryState(keyBytes);

    if (result.found && result.value) {
      if (result.value.type === 'Staker') {
        return snakeToCamel(result.value);
      }
      return null;
    }

    return null;
  }

  /**
   * Get existing keypair from localStorage or create a new one.
   * @returns {{publicKey: Uint8Array, publicKeyHex: string}} Keypair information
   * @warning Private keys are stored in localStorage which is not secure.
   *          In production, consider using more secure storage methods.
   */
  getOrCreateKeypair() {
    const parseStoredPrivateKeyHex = (value) => {
      if (!value || typeof value !== 'string') return null;
      let trimmed = value.trim();
      if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return null;
      if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) trimmed = trimmed.slice(2);

      if (!/^[0-9a-fA-F]+$/.test(trimmed) || trimmed.length !== 64) return null;

      const bytes = new Uint8Array(trimmed.match(/.{1,2}/g).map((byte) => Number.parseInt(byte, 16)));
      if (bytes.length !== 32) return null;
      return bytes;
    };

    const removeStoredPrivateKey = () => {
      try {
        localStorage.removeItem('casino_private_key');
      } catch {
        // ignore
      }
    };

    const allowLegacyKeys =
      typeof import.meta !== 'undefined' &&
      import.meta.env?.PROD !== true &&
      (import.meta.env?.DEV || import.meta.env?.VITE_ALLOW_LEGACY_KEYS === 'true');
    const isProd = typeof import.meta !== 'undefined' && import.meta.env?.PROD === true;
    const vaultEnabled =
      typeof window !== 'undefined' && localStorage.getItem('nullspace_vault_enabled') === 'true';
    const unlockedVault = (() => {
      try {
        return getUnlockedVault();
      } catch {
        return null;
      }
    })();

    // If the user has enabled a vault, require it to be unlocked for signing.
    if (vaultEnabled && !unlockedVault) {
      console.warn('[CasinoClient] Vault enabled but locked. Unlock via /security.');
      return null;
    }

    if (unlockedVault?.nullspaceEd25519PrivateKey) {
      const keyBytes = new Uint8Array(unlockedVault.nullspaceEd25519PrivateKey);
      this.wasm.createKeypair(keyBytes);
      keyBytes.fill(0);
      logDebug('Loaded keypair from vault');
    } else {
      if (!allowLegacyKeys) {
        removeStoredPrivateKey();
        try {
          this.wasm.clearKeypair?.();
        } catch {
          // ignore
        }
        console.warn('[CasinoClient] Legacy browser keys disabled. Unlock vault to continue.');
        return null;
      }
      // Security warning for development (legacy mode)
      if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
        console.warn('WARNING: Private keys are stored in localStorage. This is not secure for production use.');
      }

      const storedPrivateKeyHex = localStorage.getItem('casino_private_key');
      const storedPrivateKeyBytes = parseStoredPrivateKeyHex(storedPrivateKeyHex);

      if (storedPrivateKeyBytes) {
        try {
          this.wasm.createKeypair(storedPrivateKeyBytes);
          logDebug('Loaded keypair from storage');
        } catch (e) {
          console.warn('[CasinoClient] Failed to load stored keypair, regenerating:', e);
          removeStoredPrivateKey();
        }
      } else if (storedPrivateKeyHex) {
        // Clear invalid values like "undefined" from previous builds.
        removeStoredPrivateKey();
      }

      if (!this.wasm.keypair) {
        const bytes = (() => {
          try {
          if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
            const raw = new Uint8Array(32);
            globalThis.crypto.getRandomValues(raw);
            return raw;
          }
          } catch {
            // ignore
          }
          return null;
        })();

        if (bytes) {
          try {
            this.wasm.createKeypair(bytes);
            localStorage.setItem('casino_private_key', this.wasm.bytesToHex(bytes));
            logDebug('Generated new keypair and saved to localStorage');
          } catch (e) {
            console.warn('[CasinoClient] Failed to initialize keypair from bytes, falling back:', e);
            try {
              this.wasm.createKeypair();
            } catch {
              // ignore
            }
          }
        } else {
          // Fallback: let WASM generate a keypair (non-persistent).
          this.wasm.createKeypair();
          logDebug('Generated new keypair (non-persistent)');
        }
      }
    }

    const keypair = {
      publicKey: this.wasm.getPublicKeyBytes(),
      publicKeyHex: this.wasm.getPublicKeyHex()
    };

    if (isProd) {
      try {
        this.wasm.clearKeypair?.();
      } catch {
        // ignore
      }
    }

    // Store non-secret identifier for the current keypair.
    try {
      localStorage.setItem('casino_public_key_hex', keypair.publicKeyHex);
    } catch {
      // ignore
    }

    logDebug('Using keypair with public key:', keypair.publicKeyHex);

    return keypair;
  }

}
