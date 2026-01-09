/**
 * Metrics Collection and Authenticated Endpoint
 *
 * Provides operational metrics for monitoring with Bearer token authentication.
 *
 * US-139: Uses timing-safe comparison for bearer token validation
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  PROBLEM_JSON_CONTENT_TYPE,
  ProblemTypes,
  createProblemDetails,
} from '@nullspace/types';
import { timingSafeStringEqual } from '../utils/crypto.js';

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
 * Validates token from Authorization header (Bearer) or x-metrics-token header
 * against METRICS_AUTH_TOKEN env var. This provides parity with simulator/auth services.
 * Returns 401 if no valid auth provided, 403 if token doesn't match.
 *
 * US-252: Accept x-metrics-token header for parity with simulator/auth
 */
export function requireMetricsAuth(req: IncomingMessage, res: ServerResponse): boolean {
  const authHeader = req.headers.authorization;
  const xMetricsToken = req.headers['x-metrics-token'];
  const expectedToken = process.env.METRICS_AUTH_TOKEN;

  // If no token is configured, reject all requests in production
  if (!expectedToken || expectedToken.trim() === '') {
    if (process.env.NODE_ENV === 'production') {
      res.statusCode = 503;
      res.setHeader('Content-Type', PROBLEM_JSON_CONTENT_TYPE);
      res.end(JSON.stringify(createProblemDetails(503, 'Service Unavailable', {
        type: ProblemTypes.SERVICE_UNAVAILABLE,
        detail: 'Metrics endpoint not configured',
      })));
      return false;
    }
    // Allow in development without auth
    return true;
  }

  // Check for placeholder values
  if (expectedToken.toLowerCase().includes('your_') || expectedToken.toLowerCase().includes('placeholder')) {
    res.statusCode = 503;
    res.setHeader('Content-Type', PROBLEM_JSON_CONTENT_TYPE);
    res.end(JSON.stringify(createProblemDetails(503, 'Service Unavailable', {
      type: ProblemTypes.SERVICE_UNAVAILABLE,
      detail: 'Metrics endpoint not properly configured',
    })));
    return false;
  }

  // Extract Bearer token if present
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  // Extract x-metrics-token if present (string only, not array)
  const headerToken = typeof xMetricsToken === 'string' ? xMetricsToken : null;

  // Check if either token matches using timing-safe comparison (US-139)
  if (timingSafeStringEqual(bearerToken, expectedToken) || timingSafeStringEqual(headerToken, expectedToken)) {
    return true;
  }

  // No valid authentication provided
  res.statusCode = 401;
  res.setHeader('Content-Type', PROBLEM_JSON_CONTENT_TYPE);
  res.setHeader('WWW-Authenticate', 'Bearer realm="metrics"');
  res.end(JSON.stringify(createProblemDetails(401, 'Unauthorized', {
    type: ProblemTypes.UNAUTHORIZED,
    detail: 'Missing or invalid authorization. Use Bearer token or x-metrics-token header.',
  })));
  return false;
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
