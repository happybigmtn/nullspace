import { logDebug, logWarn } from '../logger.js';
import { trackRateLimitHit, trackRateLimitReset } from '../metrics/index.js';

/**
 * Connection Limiter
 *
 * Enforces per-IP connection limits and global session caps to prevent
 * resource exhaustion and abuse of the gateway.
 */

export interface ConnectionLimiterConfig {
  maxConnectionsPerIp: number;
  maxTotalSessions: number;
}

export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  code?: string;
}

export class ConnectionLimiter {
  private connectionsByIp: Map<string, Set<string>> = new Map();
  private totalConnections: number = 0;
  private config: ConnectionLimiterConfig;

  constructor(config: Partial<ConnectionLimiterConfig> = {}) {
    this.config = {
      maxConnectionsPerIp: config.maxConnectionsPerIp ?? 5,
      maxTotalSessions: config.maxTotalSessions ?? 1000,
    };
  }

  /**
   * Check if a new connection from the given IP is allowed
   */
  canConnect(ip: string): LimitCheckResult {
    // Normalize IP address (handle IPv4-mapped IPv6 addresses)
    const normalizedIp = this.normalizeIp(ip);

    // Check global session cap
    if (this.totalConnections >= this.config.maxTotalSessions) {
      trackRateLimitHit('session_cap', normalizedIp);
      return {
        allowed: false,
        reason: `Server at capacity (${this.config.maxTotalSessions} sessions)`,
        code: 'SESSION_CAP_REACHED',
      };
    }

    // Check per-IP limit
    const ipConnections = this.connectionsByIp.get(normalizedIp);
    const currentCount = ipConnections?.size ?? 0;

    if (currentCount >= this.config.maxConnectionsPerIp) {
      trackRateLimitHit('ip_limit', normalizedIp);
      return {
        allowed: false,
        reason: `Too many connections from this IP (max ${this.config.maxConnectionsPerIp})`,
        code: 'IP_LIMIT_EXCEEDED',
      };
    }

    return { allowed: true };
  }

  /**
   * Register a new connection
   * @returns A connection ID to use when unregistering
   */
  registerConnection(ip: string, connectionId: string): void {
    const normalizedIp = this.normalizeIp(ip);

    let ipConnections = this.connectionsByIp.get(normalizedIp);
    if (!ipConnections) {
      ipConnections = new Set();
      this.connectionsByIp.set(normalizedIp, ipConnections);
    }

    ipConnections.add(connectionId);
    this.totalConnections++;

    logDebug(
      `[Limiter] Connection registered: ${connectionId} from ${normalizedIp} ` +
      `(IP: ${ipConnections.size}/${this.config.maxConnectionsPerIp}, ` +
      `Total: ${this.totalConnections}/${this.config.maxTotalSessions})`
    );
  }

  /**
   * Unregister a connection when it closes
   */
  unregisterConnection(ip: string, connectionId: string): void {
    const normalizedIp = this.normalizeIp(ip);

    const ipConnections = this.connectionsByIp.get(normalizedIp);
    if (ipConnections) {
      if (ipConnections.delete(connectionId)) {
        this.totalConnections--;

        // Clean up empty IP entries
        if (ipConnections.size === 0) {
          this.connectionsByIp.delete(normalizedIp);
        }

        logDebug(
          `[Limiter] Connection unregistered: ${connectionId} from ${normalizedIp} ` +
          `(Total: ${this.totalConnections}/${this.config.maxTotalSessions})`
        );
      }
    }
  }

  /**
   * Normalize IP address to handle IPv4-mapped IPv6 addresses
   * e.g., ::ffff:127.0.0.1 -> 127.0.0.1
   */
  private normalizeIp(ip: string): string {
    if (!ip) return 'unknown';

    // Handle IPv4-mapped IPv6 addresses
    if (ip.startsWith('::ffff:')) {
      return ip.slice(7);
    }

    return ip;
  }

  /**
   * Get current statistics
   */
  getStats(): { totalConnections: number; uniqueIps: number; config: ConnectionLimiterConfig } {
    return {
      totalConnections: this.totalConnections,
      uniqueIps: this.connectionsByIp.size,
      config: { ...this.config },
    };
  }

  /**
   * Get connections count for a specific IP
   */
  getConnectionsForIp(ip: string): number {
    const normalizedIp = this.normalizeIp(ip);
    return this.connectionsByIp.get(normalizedIp)?.size ?? 0;
  }

  /**
   * Get total connection count
   */
  getTotalConnections(): number {
    return this.totalConnections;
  }
}

/**
 * Message Rate Limiter
 *
 * Enforces per-session message rate limits to prevent abuse and ensure fair
 * resource sharing. Uses a fixed-window rate limiting algorithm with explicit
 * error responses per AC-3.4.
 *
 * Configuration via environment variables:
 * - GATEWAY_SESSION_RATE_LIMIT_POINTS: Max messages per window (default: 100)
 * - GATEWAY_SESSION_RATE_LIMIT_WINDOW_MS: Window duration in ms (default: 60000 = 1 minute)
 * - GATEWAY_SESSION_RATE_LIMIT_BLOCK_MS: Block duration after exceeding limit (default: 60000 = 1 minute)
 */

export interface MessageRateLimiterConfig {
  /** Maximum messages per window */
  maxMessages: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Block duration in milliseconds after exceeding limit */
  blockMs: number;
}

export interface RateLimitState {
  /** Message count in current window */
  count: number;
  /** When the current window started */
  windowStart: number;
  /** When the block expires (0 if not blocked) */
  blockedUntil: number;
}

export interface MessageRateLimitResult {
  /** Whether the message is allowed */
  allowed: boolean;
  /** Seconds until rate limit resets (for error response) */
  retryAfterSeconds?: number;
  /** Human-readable reason for rejection */
  reason?: string;
  /** Error code for client */
  code?: string;
}

export class MessageRateLimiter {
  private states: Map<string, RateLimitState> = new Map();
  private config: MessageRateLimiterConfig;
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(config: Partial<MessageRateLimiterConfig> = {}) {
    this.config = {
      maxMessages: config.maxMessages ?? 100,
      windowMs: config.windowMs ?? 60_000,
      blockMs: config.blockMs ?? 60_000,
    };

    // Periodic cleanup of expired states (every 5 minutes)
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60_000);
    this.cleanupTimer.unref?.();
  }

  /**
   * Check if a message from the given session is allowed
   * @param sessionId - Unique session identifier (wallet/connection scoped)
   * @param clientIp - Client IP for logging/metrics (optional)
   */
  checkMessage(sessionId: string, clientIp?: string): MessageRateLimitResult {
    const now = Date.now();
    let state = this.states.get(sessionId);

    // Initialize state if not exists
    if (!state) {
      state = {
        count: 0,
        windowStart: now,
        blockedUntil: 0,
      };
      this.states.set(sessionId, state);
    }

    // Check if blocked
    if (state.blockedUntil > now) {
      const retryAfterSeconds = Math.ceil((state.blockedUntil - now) / 1000);
      trackRateLimitHit('session_rate_limit', clientIp);
      logDebug(`[RateLimiter] Session ${sessionId} blocked for ${retryAfterSeconds}s`);
      return {
        allowed: false,
        retryAfterSeconds,
        reason: `Rate limit exceeded. Retry after ${retryAfterSeconds} seconds.`,
        code: 'RATE_LIMITED',
      };
    }

    // Check if window has expired - reset if so
    if (now - state.windowStart >= this.config.windowMs) {
      trackRateLimitReset('session_rate_limit');
      state.count = 0;
      state.windowStart = now;
    }

    // Increment count
    state.count++;

    // Check if over limit
    if (state.count > this.config.maxMessages) {
      // Block the session
      state.blockedUntil = now + this.config.blockMs;
      const retryAfterSeconds = Math.ceil(this.config.blockMs / 1000);
      trackRateLimitHit('session_rate_limit', clientIp);
      logWarn(
        `[RateLimiter] Session ${sessionId} exceeded rate limit ` +
        `(${state.count}/${this.config.maxMessages} in ${this.config.windowMs}ms), ` +
        `blocked for ${retryAfterSeconds}s`
      );
      return {
        allowed: false,
        retryAfterSeconds,
        reason: `Rate limit exceeded. Retry after ${retryAfterSeconds} seconds.`,
        code: 'RATE_LIMITED',
      };
    }

    return { allowed: true };
  }

  /**
   * Remove rate limit state for a session (call on disconnect)
   */
  removeSession(sessionId: string): void {
    this.states.delete(sessionId);
  }

  /**
   * Get current rate limit state for a session (for debugging/monitoring)
   */
  getState(sessionId: string): RateLimitState | undefined {
    return this.states.get(sessionId);
  }

  /**
   * Get statistics about current rate limiting
   */
  getStats(): {
    trackedSessions: number;
    blockedSessions: number;
    config: MessageRateLimiterConfig;
  } {
    const now = Date.now();
    let blockedCount = 0;
    for (const state of this.states.values()) {
      if (state.blockedUntil > now) {
        blockedCount++;
      }
    }
    return {
      trackedSessions: this.states.size,
      blockedSessions: blockedCount,
      config: { ...this.config },
    };
  }

  /**
   * Clean up expired states (sessions that have been idle)
   */
  private cleanup(): void {
    const now = Date.now();
    const expirationMs = this.config.windowMs + this.config.blockMs + 60_000; // Extra minute buffer

    for (const [sessionId, state] of this.states.entries()) {
      // Remove if window is expired and not blocked
      if (
        now - state.windowStart > expirationMs &&
        state.blockedUntil < now
      ) {
        this.states.delete(sessionId);
      }
    }

    logDebug(`[RateLimiter] Cleanup: ${this.states.size} sessions tracked`);
  }

  /**
   * Shutdown the rate limiter (cleanup timer)
   */
  shutdown(): void {
    clearInterval(this.cleanupTimer);
  }
}
