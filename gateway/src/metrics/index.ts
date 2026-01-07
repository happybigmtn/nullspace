/**
 * Metrics Collection and Authenticated Endpoint
 *
 * Provides operational metrics for monitoring with Bearer token authentication.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * In-memory metrics store
 * In production, consider using a proper metrics library like prom-client
 */
class MetricsStore {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private lastUpdate = Date.now();

  increment(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  set(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  get(name: string): number | undefined {
    return this.counters.get(name) ?? this.gauges.get(name);
  }

  getAll(): Record<string, number> {
    return {
      ...Object.fromEntries(this.counters),
      ...Object.fromEntries(this.gauges),
      uptime_seconds: Math.floor((Date.now() - this.lastUpdate) / 1000),
    };
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.lastUpdate = Date.now();
  }
}

export const metrics = new MetricsStore();

/**
 * Metrics authentication middleware
 *
 * Validates Bearer token from Authorization header against METRICS_AUTH_TOKEN env var.
 * Returns 401 if auth header is missing/invalid, 403 if token doesn't match.
 */
export function requireMetricsAuth(req: IncomingMessage, res: ServerResponse): boolean {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.METRICS_AUTH_TOKEN;

  // If no token is configured, reject all requests in production
  if (!expectedToken || expectedToken.trim() === '') {
    if (process.env.NODE_ENV === 'production') {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Metrics endpoint not configured' }));
      return false;
    }
    // Allow in development without auth
    return true;
  }

  // Check for placeholder values
  if (expectedToken.toLowerCase().includes('your_') || expectedToken.toLowerCase().includes('placeholder')) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Metrics endpoint not properly configured' }));
    return false;
  }

  // Validate Authorization header format
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('WWW-Authenticate', 'Bearer realm="metrics"');
    res.end(JSON.stringify({ error: 'Missing or invalid authorization header. Use Bearer token.' }));
    return false;
  }

  // Extract and validate token
  const token = authHeader.slice(7); // Remove 'Bearer ' prefix
  if (token !== expectedToken) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Invalid metrics token' }));
    return false;
  }

  return true;
}

/**
 * Handle metrics endpoint request
 *
 * Returns JSON with current metrics if authenticated
 */
export function handleMetrics(req: IncomingMessage, res: ServerResponse): void {
  // Check authentication
  if (!requireMetricsAuth(req, res)) {
    return;
  }

  // Return metrics
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    timestamp: Date.now(),
    metrics: metrics.getAll(),
  }));
}

/**
 * Track connection events
 */
export function trackConnection(event: 'connect' | 'disconnect', clientIp: string): void {
  metrics.increment(`gateway.connections.${event}`);
  metrics.increment(`gateway.connections.${event}.ip.${clientIp.replace(/[.:]/g, '_')}`);
}

/**
 * Track message handling
 */
export function trackMessage(type: string, success: boolean): void {
  metrics.increment(`gateway.messages.${type}`);
  metrics.increment(`gateway.messages.${success ? 'success' : 'error'}`);
}

/**
 * Track session lifecycle
 */
export function trackSession(event: 'created' | 'destroyed'): void {
  metrics.increment(`gateway.sessions.${event}`);
}

/**
 * Update current session count gauge
 */
export function updateSessionCount(count: number): void {
  metrics.set('gateway.sessions.active', count);
}

/**
 * Track rate limit hits
 * @param limitType - The type of rate limit hit (ip_limit, session_cap, session_rate_limit, metrics_rate_limit)
 * @param clientIp - The client IP that triggered the limit (optional)
 */
export function trackRateLimitHit(limitType: string, clientIp?: string): void {
  metrics.increment('gateway.rate_limits.total');
  metrics.increment(`gateway.rate_limits.${limitType}`);
  if (clientIp) {
    metrics.increment(`gateway.rate_limits.by_ip.${clientIp.replace(/[.:]/g, '_')}`);
  }
}

/**
 * Track rate limit window resets
 * @param limitType - The type of rate limit that reset
 */
export function trackRateLimitReset(limitType: string): void {
  metrics.increment(`gateway.rate_limits.resets.${limitType}`);
}
