/**
 * Security Middleware
 *
 * HTTP security headers, HTTPS enforcement, and CORS validation
 * for production deployments.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  PROBLEM_JSON_CONTENT_TYPE,
  ProblemTypes,
  createProblemDetails,
  rateLimited,
} from '@nullspace/types';
import { trackRateLimitHit, trackRateLimitReset } from '../metrics/index.js';
import { getClientIp } from '../utils/client-ip.js';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * CORS Configuration
 *
 * Reads allowed origins from environment and enforces validation at middleware level.
 * This provides defense-in-depth even if higher-level checks fail.
 */
export interface CorsConfig {
  allowedOrigins: string[];
  allowNoOrigin: boolean;
}

let corsConfig: CorsConfig | null = null;

/**
 * Initialize CORS configuration
 *
 * Call this at startup to configure allowed origins.
 * In production, throws if no origins are configured.
 */
function parseOrigins(raw: string): string[] {
  return raw.split(',').map(v => v.trim()).filter(Boolean);
}

function parseBooleanEnv(value: string | undefined): boolean {
  return ['1', 'true', 'yes'].includes(String(value ?? '').toLowerCase());
}

export function initializeCors(config?: Partial<CorsConfig>): void {
  const origins = config?.allowedOrigins ?? parseOrigins(process.env.GATEWAY_ALLOWED_ORIGINS ?? '');
  const allowNoOrigin = config?.allowNoOrigin ?? parseBooleanEnv(process.env.GATEWAY_ALLOW_NO_ORIGIN);

  // Defense-in-depth: enforce origins are configured in production
  if (IS_PRODUCTION && origins.length === 0) {
    throw new Error(
      'GATEWAY_ALLOWED_ORIGINS must be configured in production. ' +
      'Cannot start with empty or wildcard CORS origins.'
    );
  }

  corsConfig = {
    allowedOrigins: origins,
    allowNoOrigin,
  };
}

/**
 * Get current CORS configuration
 */
export function getCorsConfig(): CorsConfig | null {
  return corsConfig;
}

/**
 * CORS Validation Middleware
 *
 * Validates the Origin header against allowed origins.
 * Returns true if the request should proceed, false if blocked.
 *
 * @param req - The incoming HTTP request
 * @param res - The HTTP response
 * @param options - Override options (useful for testing)
 * @returns true if allowed, false if blocked
 */
export function validateCors(
  req: IncomingMessage,
  res: ServerResponse,
  options?: Partial<CorsConfig>
): boolean {
  const config = options ?? corsConfig;

  // If CORS not configured, allow all (development mode)
  if (!config || !config.allowedOrigins || config.allowedOrigins.length === 0) {
    return true;
  }

  const originHeader = req.headers.origin;
  const origin = typeof originHeader === 'string'
    ? (originHeader === 'null' ? null : originHeader)
    : null;

  // Check missing origin
  if (!origin) {
    if (!config.allowNoOrigin) {
      res.statusCode = 403;
      res.setHeader('Content-Type', PROBLEM_JSON_CONTENT_TYPE);
      res.end(JSON.stringify(createProblemDetails(403, 'Forbidden', {
        type: ProblemTypes.ORIGIN_NOT_ALLOWED,
        detail: 'Origin header required',
        code: 'CORS_ORIGIN_REQUIRED',
      })));
      return false;
    }
    // No origin but allowed
    return true;
  }

  // Check origin against allowlist
  if (!config.allowedOrigins.includes(origin)) {
    res.statusCode = 403;
    res.setHeader('Content-Type', PROBLEM_JSON_CONTENT_TYPE);
    res.end(JSON.stringify(createProblemDetails(403, 'Forbidden', {
      type: ProblemTypes.ORIGIN_NOT_ALLOWED,
      detail: 'Origin not allowed',
      code: 'CORS_ORIGIN_NOT_ALLOWED',
    })));
    return false;
  }

  // Origin is allowed - set CORS headers
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours

  return true;
}

/**
 * Handle CORS preflight (OPTIONS) requests
 *
 * @returns true if this was a preflight request that was handled
 */
export function handleCorsPreflight(
  req: IncomingMessage,
  res: ServerResponse
): boolean {
  if (req.method !== 'OPTIONS') {
    return false;
  }

  // Validate CORS first
  if (!validateCors(req, res)) {
    return true; // Request was blocked, but was handled
  }

  // Respond to preflight
  res.statusCode = 204; // No Content
  res.end();
  return true;
}

/**
 * HTTPS Redirect Middleware
 *
 * Redirects HTTP requests to HTTPS in production.
 * Checks X-Forwarded-Proto header for reverse proxy deployments.
 *
 * @returns true if request should proceed, false if redirected
 */
export function enforceHttps(req: IncomingMessage, res: ServerResponse): boolean {
  // Skip in development
  if (!IS_PRODUCTION) {
    return true;
  }

  // Always allow local health checks over HTTP
  if (req.url && req.url.startsWith('/healthz')) {
    return true;
  }

  // Allow local/health checks over HTTP (e.g., container healthcheck hitting 127.0.0.1)
  const host = (req.headers.host || '').toLowerCase();
  const isLocalHost = host.startsWith('127.0.0.1') || host.startsWith('localhost');
  if (isLocalHost) {
    return true;
  }

  // Check protocol from request or X-Forwarded-Proto header (for reverse proxies)
  const proto = (req.headers['x-forwarded-proto'] as string) ||
                ((req.socket as any).encrypted ? 'https' : 'http');

  if (proto !== 'https') {
    const redirectHost = req.headers.host || 'localhost';
    const redirectUrl = `https://${redirectHost}${req.url}`;

    res.statusCode = 301; // Permanent redirect
    res.setHeader('Location', redirectUrl);
    res.setHeader('Content-Type', 'text/plain');
    res.end(`Redirecting to ${redirectUrl}`);
    return false;
  }

  return true;
}

/**
 * Security Headers Middleware
 *
 * Sets security-related HTTP response headers.
 * Should be called for all HTTP responses.
 */
export function setSecurityHeaders(res: ServerResponse): void {
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Enable XSS protection (defense in depth)
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Content Security Policy (strict for API endpoints)
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");

  // HSTS (HTTP Strict Transport Security) in production
  if (IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
}

/**
 * Rate Limiting State
 *
 * Simple in-memory rate limiter for metrics endpoint.
 * In production, consider using Redis-backed rate limiting.
 */
class RateLimiter {
  private requests = new Map<string, { count: number; resetAt: number }>();
  private windowMs: number;
  private maxRequests: number;
  private name: string;

  constructor(windowMs = 60_000, maxRequests = 100, name = 'metrics') {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.name = name;

    // Clean up old entries every minute
    setInterval(() => this.cleanup(), 60_000).unref();
  }

  isAllowed(identifier: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const entry = this.requests.get(identifier);

    if (!entry || now > entry.resetAt) {
      // Start new window (track reset if previous window existed)
      if (entry) {
        trackRateLimitReset(`${this.name}_rate_limit`);
      }
      this.requests.set(identifier, {
        count: 1,
        resetAt: now + this.windowMs,
      });
      return { allowed: true };
    }

    if (entry.count >= this.maxRequests) {
      // Rate limit exceeded - track the hit
      trackRateLimitHit(`${this.name}_rate_limit`, identifier);
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return { allowed: false, retryAfter };
    }

    // Increment count
    entry.count++;
    return { allowed: true };
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.requests.entries()) {
      if (now > entry.resetAt) {
        this.requests.delete(key);
      }
    }
  }
}

// Rate limiter for metrics endpoint (100 requests per minute per IP)
export const metricsRateLimiter = new RateLimiter(60_000, 100);

/**
 * Apply rate limiting to a request
 *
 * @returns true if allowed, false if rate limited
 */
export function applyRateLimit(
  req: IncomingMessage,
  res: ServerResponse,
  limiter: RateLimiter = metricsRateLimiter,
): boolean {
  // US-248: Use real client IP when behind reverse proxy
  const clientIp = getClientIp(req);
  const result = limiter.isAllowed(clientIp);

  if (!result.allowed) {
    res.statusCode = 429;
    res.setHeader('Content-Type', PROBLEM_JSON_CONTENT_TYPE);
    if (result.retryAfter) {
      res.setHeader('Retry-After', result.retryAfter.toString());
    }
    res.end(JSON.stringify(rateLimited(result.retryAfter)));
    return false;
  }

  return true;
}
