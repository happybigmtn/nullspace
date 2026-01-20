/**
 * Presence and Clock Sync Module (AC-3.6)
 *
 * Implements:
 * - Presence tracking: online user count, active games
 * - Clock sync: server timestamp broadcasting for client clock drift correction
 *
 * Design notes:
 * - Presence is tracked via SessionManager integration
 * - Clock sync is sent on connect and periodically during session
 * - Uses efficient broadcast via BroadcastManager when available
 */
import type { WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { logDebug, logInfo } from '../logger.js';
import { metrics } from '../metrics/index.js';

/**
 * Clock sync message structure (AC-3.6)
 */
export interface ClockSyncMessage {
  type: 'clock_sync';
  serverTime: number;
  seq?: number;
}

/**
 * Presence message structure (AC-3.6)
 */
export interface PresenceMessage {
  type: 'presence';
  onlineCount: number;
  activeGames?: number;
}

/**
 * Configuration for presence manager
 */
export interface PresenceManagerConfig {
  /** Interval for broadcasting clock sync (default: 30000ms = 30 seconds) */
  clockSyncIntervalMs?: number;
  /** Interval for broadcasting presence updates (default: 10000ms = 10 seconds) */
  presenceIntervalMs?: number;
  /** Whether to enable periodic broadcasts (default: true) */
  enablePeriodicBroadcasts?: boolean;
}

const DEFAULT_CONFIG: Required<PresenceManagerConfig> = {
  clockSyncIntervalMs: 30_000,
  presenceIntervalMs: 10_000,
  enablePeriodicBroadcasts: true,
};

/**
 * Manages presence tracking and clock sync broadcasting.
 *
 * Usage:
 *   const presence = new PresenceManager();
 *   presence.start();
 *   presence.addSession(ws);
 *   presence.removeSession(ws);
 *   presence.stop();
 */
export class PresenceManager extends EventEmitter {
  private config: Required<PresenceManagerConfig>;
  private sessions: Set<WebSocket> = new Set();
  private activeSessions: Set<WebSocket> = new Set(); // Sessions with active games
  private clockSyncSeq = 0;
  private clockSyncTimer: ReturnType<typeof setInterval> | null = null;
  private presenceTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: PresenceManagerConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start periodic broadcasting of clock sync and presence updates
   */
  start(): void {
    if (!this.config.enablePeriodicBroadcasts) {
      logDebug('[PresenceManager] Periodic broadcasts disabled');
      return;
    }

    // Clock sync broadcast
    if (this.config.clockSyncIntervalMs > 0 && !this.clockSyncTimer) {
      this.clockSyncTimer = setInterval(() => {
        this.broadcastClockSync();
      }, this.config.clockSyncIntervalMs);
      this.clockSyncTimer.unref?.();
      logDebug('[PresenceManager] Clock sync timer started:', this.config.clockSyncIntervalMs, 'ms');
    }

    // Presence broadcast
    if (this.config.presenceIntervalMs > 0 && !this.presenceTimer) {
      this.presenceTimer = setInterval(() => {
        this.broadcastPresence();
      }, this.config.presenceIntervalMs);
      this.presenceTimer.unref?.();
      logDebug('[PresenceManager] Presence timer started:', this.config.presenceIntervalMs, 'ms');
    }

    logInfo('[PresenceManager] Started with clock sync interval', this.config.clockSyncIntervalMs, 'ms');
  }

  /**
   * Stop periodic broadcasting
   */
  stop(): void {
    if (this.clockSyncTimer) {
      clearInterval(this.clockSyncTimer);
      this.clockSyncTimer = null;
    }
    if (this.presenceTimer) {
      clearInterval(this.presenceTimer);
      this.presenceTimer = null;
    }
    logDebug('[PresenceManager] Stopped');
  }

  /**
   * Add a session to presence tracking.
   * Sends initial clock_sync and presence messages to the new session.
   */
  addSession(ws: WebSocket): void {
    this.sessions.add(ws);
    metrics.set('gateway.presence.online_count', this.sessions.size);

    // Send initial clock sync to the new session
    this.sendClockSync(ws);

    // Send initial presence to the new session
    this.sendPresence(ws);

    // Broadcast updated presence to all other sessions
    this.broadcastPresence();

    logDebug('[PresenceManager] Session added, total:', this.sessions.size);
  }

  /**
   * Remove a session from presence tracking
   */
  removeSession(ws: WebSocket): void {
    this.sessions.delete(ws);
    this.activeSessions.delete(ws);
    metrics.set('gateway.presence.online_count', this.sessions.size);
    metrics.set('gateway.presence.active_games', this.activeSessions.size);

    // Broadcast updated presence to remaining sessions
    this.broadcastPresence();

    logDebug('[PresenceManager] Session removed, total:', this.sessions.size);
  }

  /**
   * Mark a session as having an active game
   */
  setSessionActive(ws: WebSocket, active: boolean): void {
    if (active) {
      this.activeSessions.add(ws);
    } else {
      this.activeSessions.delete(ws);
    }
    metrics.set('gateway.presence.active_games', this.activeSessions.size);
  }

  /**
   * Get current presence info
   */
  getPresenceInfo(): PresenceMessage {
    return {
      type: 'presence',
      onlineCount: this.sessions.size,
      activeGames: this.activeSessions.size,
    };
  }

  /**
   * Get current clock sync message
   */
  getClockSync(): ClockSyncMessage {
    this.clockSyncSeq++;
    return {
      type: 'clock_sync',
      serverTime: Date.now(),
      seq: this.clockSyncSeq,
    };
  }

  /**
   * Get the number of online sessions
   */
  get onlineCount(): number {
    return this.sessions.size;
  }

  /**
   * Get the number of sessions with active games
   */
  get activeGamesCount(): number {
    return this.activeSessions.size;
  }

  /**
   * Send clock sync to a specific session
   */
  sendClockSync(ws: WebSocket): void {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.send(JSON.stringify(this.getClockSync()));
      metrics.increment('gateway.presence.clock_sync_sent');
    } catch {
      // Ignore send errors
    }
  }

  /**
   * Send presence to a specific session
   */
  sendPresence(ws: WebSocket): void {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.send(JSON.stringify(this.getPresenceInfo()));
      metrics.increment('gateway.presence.presence_sent');
    } catch {
      // Ignore send errors
    }
  }

  /**
   * Broadcast clock sync to all sessions
   */
  broadcastClockSync(): void {
    const msg = JSON.stringify(this.getClockSync());
    let sent = 0;
    for (const ws of this.sessions) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(msg);
          sent++;
        } catch {
          // Ignore send errors
        }
      }
    }
    metrics.increment('gateway.presence.clock_sync_broadcast');
    logDebug('[PresenceManager] Broadcast clock sync to', sent, 'sessions');
  }

  /**
   * Broadcast presence to all sessions
   */
  broadcastPresence(): void {
    const msg = JSON.stringify(this.getPresenceInfo());
    let sent = 0;
    for (const ws of this.sessions) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(msg);
          sent++;
        } catch {
          // Ignore send errors
        }
      }
    }
    metrics.increment('gateway.presence.presence_broadcast');
    logDebug('[PresenceManager] Broadcast presence to', sent, 'sessions');
  }

  /**
   * Clean up and release resources
   */
  destroy(): void {
    this.stop();
    this.sessions.clear();
    this.activeSessions.clear();
    this.removeAllListeners();
  }
}
