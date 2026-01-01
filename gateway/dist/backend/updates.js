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
import { extractCasinoEvents } from '../codec/events.js';
/**
 * UpdatesFilter types matching backend
 */
export var UpdatesFilterType;
(function (UpdatesFilterType) {
    UpdatesFilterType[UpdatesFilterType["All"] = 0] = "All";
    UpdatesFilterType[UpdatesFilterType["Account"] = 1] = "Account";
    UpdatesFilterType[UpdatesFilterType["Session"] = 2] = "Session";
})(UpdatesFilterType || (UpdatesFilterType = {}));
/**
 * Encode an UpdatesFilter for the WebSocket URL
 */
export function encodeUpdatesFilter(filterType, data) {
    let buffer;
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
    ws = null;
    url;
    origin;
    reconnectDelay = 1000;
    maxReconnectDelay = 30000;
    shouldReconnect = true;
    pendingEvents = new Map();
    constructor(baseUrl, origin) {
        super();
        // Convert http(s) to ws(s)
        this.url = baseUrl.replace(/^http/, 'ws');
        // Default origin for server-to-server requests (must match ALLOWED_HTTP_ORIGINS)
        this.origin = origin || 'http://localhost:9010';
    }
    /**
     * Connect to the updates stream for a specific account
     */
    async connectForAccount(publicKey) {
        const filter = encodeUpdatesFilter(UpdatesFilterType.Account, publicKey);
        return this.connect(filter);
    }
    /**
     * Connect to the updates stream for a specific game session
     */
    async connectForSession(sessionId) {
        const filter = encodeUpdatesFilter(UpdatesFilterType.Session, sessionId);
        return this.connect(filter);
    }
    /**
     * Connect to the updates stream with a hex-encoded filter
     */
    connect(filter) {
        return new Promise((resolve, reject) => {
            const wsUrl = `${this.url}/updates/${filter}`;
            console.log(`[UpdatesClient] Connecting to ${wsUrl}`);
            this.ws = new WebSocket(wsUrl, {
                headers: {
                    'Origin': this.origin,
                },
            });
            this.ws.on('open', () => {
                console.log('[UpdatesClient] Connected to updates stream');
                this.reconnectDelay = 1000; // Reset reconnect delay on successful connection
                resolve();
            });
            this.ws.on('message', (data) => {
                this.handleMessage(data);
            });
            this.ws.on('close', () => {
                console.log('[UpdatesClient] Connection closed');
                this.emit('close');
                if (this.shouldReconnect) {
                    this.scheduleReconnect(filter);
                }
            });
            this.ws.on('error', (err) => {
                console.error('[UpdatesClient] WebSocket error:', err.message);
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
    handleMessage(data) {
        try {
            // Debug: log first 10 bytes to identify message type
            const header = Array.from(data.slice(0, Math.min(10, data.length)))
                .map((b) => b.toString(16).padStart(2, '0'))
                .join(' ');
            console.log(`[UpdatesClient] Received message: ${data.length} bytes, header: ${header}`);
            const events = extractCasinoEvents(new Uint8Array(data));
            console.log(`[UpdatesClient] Extracted ${events.length} casino events`);
            for (const event of events) {
                console.log(`[UpdatesClient] Received event: ${event.type} for session ${event.sessionId}`);
                // Store for session-based waiting FIRST (before emit to avoid race)
                const pending = this.pendingEvents.get(event.sessionId) ?? [];
                pending.push(event);
                this.pendingEvents.set(event.sessionId, pending);
                // Then emit for listeners
                this.emit('gameEvent', event);
            }
        }
        catch (err) {
            console.error('[UpdatesClient] Failed to parse events:', err);
        }
    }
    /**
     * Wait for a game event for a specific session
     */
    async waitForEvent(sessionId, eventType, timeoutMs = 30000) {
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
            const handler = (event) => {
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
     * Wait for ANY game event of a specific type (ignores session ID)
     * Use this when filtering by Account since a player has one game at a time
     */
    async waitForAnyEvent(eventType, timeoutMs = 30000) {
        // Wait for the event
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.off('gameEvent', handler);
                // Check pending one more time before rejecting (race condition safety)
                for (const [, events] of this.pendingEvents) {
                    const existing = events.find((e) => e.type === eventType);
                    if (existing) {
                        const idx = events.indexOf(existing);
                        events.splice(idx, 1);
                        resolve(existing);
                        return;
                    }
                }
                reject(new Error(`Timeout waiting for ${eventType} event`));
            }, timeoutMs);
            const handler = (event) => {
                if (event.type === eventType) {
                    clearTimeout(timeout);
                    this.off('gameEvent', handler);
                    resolve(event);
                }
            };
            // Set up listener FIRST
            this.on('gameEvent', handler);
            // THEN check if we already have an event (might have arrived while setting up)
            for (const [, events] of this.pendingEvents) {
                const existing = events.find((e) => e.type === eventType);
                if (existing) {
                    clearTimeout(timeout);
                    this.off('gameEvent', handler);
                    const idx = events.indexOf(existing);
                    events.splice(idx, 1);
                    resolve(existing);
                    return;
                }
            }
        });
    }
    /**
     * Wait for 'started' OR 'error' event (game start or rejection)
     */
    async waitForStartedOrError(timeoutMs = 30000) {
        const isMatch = (e) => e.type === 'started' || e.type === 'error';
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.off('gameEvent', handler);
                // Check pending one more time before rejecting
                for (const [, events] of this.pendingEvents) {
                    const existing = events.find(isMatch);
                    if (existing) {
                        const idx = events.indexOf(existing);
                        events.splice(idx, 1);
                        resolve(existing);
                        return;
                    }
                }
                reject(new Error('Timeout waiting for started/error event'));
            }, timeoutMs);
            const handler = (event) => {
                if (isMatch(event)) {
                    clearTimeout(timeout);
                    this.off('gameEvent', handler);
                    resolve(event);
                }
            };
            // Set up listener FIRST
            this.on('gameEvent', handler);
            // THEN check if we already have an event
            for (const [, events] of this.pendingEvents) {
                const existing = events.find(isMatch);
                if (existing) {
                    clearTimeout(timeout);
                    this.off('gameEvent', handler);
                    const idx = events.indexOf(existing);
                    events.splice(idx, 1);
                    resolve(existing);
                    return;
                }
            }
        });
    }
    /**
     * Wait for ANY move, complete, or error event (for post-move waiting)
     * Error events are also matched since a move can be rejected
     */
    async waitForMoveOrComplete(timeoutMs = 30000) {
        const isMatch = (e) => e.type === 'moved' || e.type === 'completed' || e.type === 'error';
        // Wait for the event
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.off('gameEvent', handler);
                // Check pending one more time before rejecting
                for (const [, events] of this.pendingEvents) {
                    const existing = events.find(isMatch);
                    if (existing) {
                        const idx = events.indexOf(existing);
                        events.splice(idx, 1);
                        resolve(existing);
                        return;
                    }
                }
                reject(new Error('Timeout waiting for move/complete event'));
            }, timeoutMs);
            const handler = (event) => {
                if (isMatch(event)) {
                    clearTimeout(timeout);
                    this.off('gameEvent', handler);
                    resolve(event);
                }
            };
            // Set up listener FIRST
            this.on('gameEvent', handler);
            // THEN check if we already have an event
            for (const [, events] of this.pendingEvents) {
                const existing = events.find(isMatch);
                if (existing) {
                    clearTimeout(timeout);
                    this.off('gameEvent', handler);
                    const idx = events.indexOf(existing);
                    events.splice(idx, 1);
                    resolve(existing);
                    return;
                }
            }
        });
    }
    /**
     * Schedule a reconnection attempt
     */
    scheduleReconnect(filter) {
        console.log(`[UpdatesClient] Reconnecting in ${this.reconnectDelay}ms...`);
        setTimeout(() => {
            if (this.shouldReconnect) {
                this.connect(filter).catch((err) => {
                    console.error('[UpdatesClient] Reconnection failed:', err.message);
                });
            }
        }, this.reconnectDelay);
        // Exponential backoff
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }
    /**
     * Disconnect from the updates stream
     */
    disconnect() {
        this.shouldReconnect = false;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
    /**
     * Check if connected
     */
    isConnected() {
        return this.ws?.readyState === WebSocket.OPEN;
    }
}
//# sourceMappingURL=updates.js.map