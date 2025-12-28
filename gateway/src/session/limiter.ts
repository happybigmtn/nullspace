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
    // Check global session cap
    if (this.totalConnections >= this.config.maxTotalSessions) {
      return {
        allowed: false,
        reason: `Server at capacity (${this.config.maxTotalSessions} sessions)`,
        code: 'SESSION_CAP_REACHED',
      };
    }

    // Normalize IP address (handle IPv4-mapped IPv6 addresses)
    const normalizedIp = this.normalizeIp(ip);

    // Check per-IP limit
    const ipConnections = this.connectionsByIp.get(normalizedIp);
    const currentCount = ipConnections?.size ?? 0;

    if (currentCount >= this.config.maxConnectionsPerIp) {
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

    console.log(
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

        console.log(
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
