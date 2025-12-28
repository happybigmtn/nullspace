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
export declare class ConnectionLimiter {
    private connectionsByIp;
    private totalConnections;
    private config;
    constructor(config?: Partial<ConnectionLimiterConfig>);
    /**
     * Check if a new connection from the given IP is allowed
     */
    canConnect(ip: string): LimitCheckResult;
    /**
     * Register a new connection
     * @returns A connection ID to use when unregistering
     */
    registerConnection(ip: string, connectionId: string): void;
    /**
     * Unregister a connection when it closes
     */
    unregisterConnection(ip: string, connectionId: string): void;
    /**
     * Normalize IP address to handle IPv4-mapped IPv6 addresses
     * e.g., ::ffff:127.0.0.1 -> 127.0.0.1
     */
    private normalizeIp;
    /**
     * Get current statistics
     */
    getStats(): {
        totalConnections: number;
        uniqueIps: number;
        config: ConnectionLimiterConfig;
    };
    /**
     * Get connections count for a specific IP
     */
    getConnectionsForIp(ip: string): number;
    /**
     * Get total connection count
     */
    getTotalConnections(): number;
}
//# sourceMappingURL=limiter.d.ts.map