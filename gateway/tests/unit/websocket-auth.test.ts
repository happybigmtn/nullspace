/**
 * WebSocket Auth Handshake and Origin Validation Tests
 *
 * AC-3.1: WebSocket handshake enforces auth tokens and origin validation;
 * invalid clients are rejected with clear errors.
 *
 * These tests validate:
 * 1. Origin validation - connections from allowed origins succeed
 * 2. Origin validation - connections from disallowed origins are rejected
 * 3. Missing origin handling based on configuration
 * 4. Session key generation (crypto-native auth)
 * 5. Clear error codes for rejected connections
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initializeCors,
  validateCors,
  getCorsConfig,
} from '../../src/middleware/security.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Mock IncomingMessage and ServerResponse for testing
function createMockRequest(headers: Record<string, string | undefined> = {}): IncomingMessage {
  return {
    headers,
    url: '/',
    method: 'GET',
  } as unknown as IncomingMessage;
}

function createMockResponse(): ServerResponse & {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
} {
  const headers: Record<string, string> = {};
  let body = '';
  return {
    statusCode: 200,
    headers,
    body,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    end(data?: string) {
      body = data ?? '';
      this.body = body;
    },
  } as unknown as ServerResponse & { statusCode: number; headers: Record<string, string>; body: string };
}

describe('WebSocket Auth Handshake and Origin Validation (AC-3.1)', () => {
  describe('validateCors', () => {
    describe('when CORS is not configured (development mode)', () => {
      it('should allow all requests when no origins are configured', () => {
        const req = createMockRequest({ origin: 'https://evil.com' });
        const res = createMockResponse();

        // Test with explicit empty config
        const result = validateCors(req, res, { allowedOrigins: [], allowNoOrigin: false });

        expect(result).toBe(true);
        expect(res.statusCode).toBe(200);
      });

      it('should allow requests without origin header', () => {
        const req = createMockRequest({});
        const res = createMockResponse();

        const result = validateCors(req, res, { allowedOrigins: [], allowNoOrigin: false });

        expect(result).toBe(true);
      });
    });

    describe('when allowed origins are configured', () => {
      const allowedOrigins = ['https://app.nullspace.io', 'https://staging.nullspace.io'];

      it('should allow requests from allowed origins', () => {
        const req = createMockRequest({ origin: 'https://app.nullspace.io' });
        const res = createMockResponse();

        const result = validateCors(req, res, { allowedOrigins, allowNoOrigin: false });

        expect(result).toBe(true);
        expect(res.headers['access-control-allow-origin']).toBe('https://app.nullspace.io');
      });

      it('should allow requests from any allowed origin (multiple configured)', () => {
        const req = createMockRequest({ origin: 'https://staging.nullspace.io' });
        const res = createMockResponse();

        const result = validateCors(req, res, { allowedOrigins, allowNoOrigin: false });

        expect(result).toBe(true);
        expect(res.headers['access-control-allow-origin']).toBe('https://staging.nullspace.io');
      });

      it('should reject requests from disallowed origins with clear error', () => {
        const req = createMockRequest({ origin: 'https://evil.com' });
        const res = createMockResponse();

        const result = validateCors(req, res, { allowedOrigins, allowNoOrigin: false });

        expect(result).toBe(false);
        expect(res.statusCode).toBe(403);
        expect(res.body).toContain('Origin not allowed');
      });

      it('should reject requests with missing origin when allowNoOrigin is false', () => {
        const req = createMockRequest({});
        const res = createMockResponse();

        const result = validateCors(req, res, { allowedOrigins, allowNoOrigin: false });

        expect(result).toBe(false);
        expect(res.statusCode).toBe(403);
        expect(res.body).toContain('Origin header required');
      });

      it('should allow requests with missing origin when allowNoOrigin is true', () => {
        const req = createMockRequest({});
        const res = createMockResponse();

        const result = validateCors(req, res, { allowedOrigins, allowNoOrigin: true });

        expect(result).toBe(true);
      });

      it('should handle "null" origin (special case for sandboxed iframes)', () => {
        const req = createMockRequest({ origin: 'null' });
        const res = createMockResponse();

        // "null" origin is treated as no origin
        const result = validateCors(req, res, { allowedOrigins, allowNoOrigin: false });

        expect(result).toBe(false);
        expect(res.statusCode).toBe(403);
      });

      it('should handle "null" origin when allowNoOrigin is true', () => {
        const req = createMockRequest({ origin: 'null' });
        const res = createMockResponse();

        const result = validateCors(req, res, { allowedOrigins, allowNoOrigin: true });

        expect(result).toBe(true);
      });
    });

    describe('error response format', () => {
      it('should return RFC 7807 Problem Details format for origin errors', () => {
        const req = createMockRequest({ origin: 'https://evil.com' });
        const res = createMockResponse();

        validateCors(req, res, {
          allowedOrigins: ['https://app.nullspace.io'],
          allowNoOrigin: false
        });

        const body = JSON.parse(res.body);
        expect(body).toHaveProperty('type');
        expect(body).toHaveProperty('title');
        expect(body).toHaveProperty('status', 403);
        expect(body).toHaveProperty('detail');
        expect(body.code).toBe('CORS_ORIGIN_NOT_ALLOWED');
      });

      it('should return RFC 7807 format for missing origin errors', () => {
        const req = createMockRequest({});
        const res = createMockResponse();

        validateCors(req, res, {
          allowedOrigins: ['https://app.nullspace.io'],
          allowNoOrigin: false
        });

        const body = JSON.parse(res.body);
        expect(body.code).toBe('CORS_ORIGIN_REQUIRED');
        expect(body.status).toBe(403);
      });
    });

    describe('CORS headers on success', () => {
      it('should set appropriate CORS headers for allowed origins', () => {
        const req = createMockRequest({ origin: 'https://app.nullspace.io' });
        const res = createMockResponse();

        validateCors(req, res, {
          allowedOrigins: ['https://app.nullspace.io'],
          allowNoOrigin: false
        });

        expect(res.headers['access-control-allow-origin']).toBe('https://app.nullspace.io');
        expect(res.headers['access-control-allow-methods']).toContain('GET');
        expect(res.headers['access-control-allow-methods']).toContain('POST');
        expect(res.headers['access-control-allow-headers']).toContain('Content-Type');
        expect(res.headers['access-control-max-age']).toBeDefined();
      });
    });
  });

  describe('initializeCors', () => {
    // Note: IS_PRODUCTION is computed at module load time in security.ts
    // These tests verify the behavior with the current environment (development/test)

    it('should not throw in development/test when no origins are configured', () => {
      // In development/test mode, empty origins are allowed
      expect(() => initializeCors({ allowedOrigins: [] })).not.toThrow();
    });

    it('should accept valid origins configuration', () => {
      expect(() => initializeCors({
        allowedOrigins: ['https://app.nullspace.io']
      })).not.toThrow();
    });

    it('should store configuration via getCorsConfig', () => {
      initializeCors({
        allowedOrigins: ['https://example.com'],
        allowNoOrigin: true
      });

      const config = getCorsConfig();
      expect(config?.allowedOrigins).toContain('https://example.com');
      expect(config?.allowNoOrigin).toBe(true);
    });
  });

  describe('Production origin enforcement (documented behavior)', () => {
    // Note: The production enforcement is tested via config-validation.test.ts
    // which validates GATEWAY_ALLOWED_ORIGINS at startup
    // This test documents the expected behavior without requiring module reload

    it('production mode should require GATEWAY_ALLOWED_ORIGINS to be set', async () => {
      // This is validated by validateProductionConfig in config/validation.ts
      const { validateProductionConfig } = await import('../../src/config/validation.js');

      // Temporarily set env for config validation
      const originalEnv = process.env.NODE_ENV;
      const originalOrigins = process.env.GATEWAY_ALLOWED_ORIGINS;

      try {
        process.env.NODE_ENV = 'production';
        process.env.GATEWAY_ALLOWED_ORIGINS = '';

        const errors = validateProductionConfig();
        const originsError = errors.find(e => e.key === 'GATEWAY_ALLOWED_ORIGINS');

        expect(originsError).toBeDefined();
        expect(originsError?.reason).toContain('Must be set in production');
      } finally {
        process.env.NODE_ENV = originalEnv;
        process.env.GATEWAY_ALLOWED_ORIGINS = originalOrigins;
      }
    });
  });

  describe('Session Key Generation (Crypto-Native Auth)', () => {
    it('should generate cryptographically secure session IDs', async () => {
      const { generateSecureId } = await import('../../src/utils/crypto.js');

      const id1 = generateSecureId('session');
      const id2 = generateSecureId('session');

      // IDs should be unique
      expect(id1).not.toBe(id2);

      // ID should have expected format: prefix_timestamp_randomHex
      expect(id1).toMatch(/^session_\d+_[0-9a-f]+$/);
    });

    it('should generate timing-safe comparisons for auth tokens', async () => {
      const { timingSafeStringEqual } = await import('../../src/utils/crypto.js');

      // Equal strings should return true
      expect(timingSafeStringEqual('secret-token', 'secret-token')).toBe(true);

      // Unequal strings should return false
      expect(timingSafeStringEqual('secret-token', 'wrong-token')).toBe(false);

      // Null/undefined handling
      expect(timingSafeStringEqual(null, 'token')).toBe(false);
      expect(timingSafeStringEqual('token', null)).toBe(false);
      expect(timingSafeStringEqual(undefined, undefined)).toBe(false);
    });

    it('should handle different length strings securely', async () => {
      const { timingSafeStringEqual } = await import('../../src/utils/crypto.js');

      // Different length strings should return false
      expect(timingSafeStringEqual('short', 'much-longer-string')).toBe(false);
      expect(timingSafeStringEqual('much-longer-string', 'short')).toBe(false);
    });
  });

  describe('WebSocket Connection Error Codes', () => {
    it('should have clear error codes for authentication failures', async () => {
      const { ErrorCodes } = await import('../../src/types/errors.js');

      // Verify error codes exist for auth-related failures
      expect(ErrorCodes.SESSION_EXPIRED).toBe('SESSION_EXPIRED');
      expect(ErrorCodes.INVALID_MESSAGE).toBe('INVALID_MESSAGE');
    });

    it('should have descriptive error messages for origin validation failures', () => {
      const req = createMockRequest({ origin: 'https://attacker.com' });
      const res = createMockResponse();

      validateCors(req, res, {
        allowedOrigins: ['https://app.nullspace.io'],
        allowNoOrigin: false
      });

      const body = JSON.parse(res.body);
      expect(body.detail).toBe('Origin not allowed');
      expect(body.title).toBe('Forbidden');
    });
  });
});

describe('WebSocket Origin Validation Edge Cases', () => {
  it('should be case-sensitive for origin matching', () => {
    const req = createMockRequest({ origin: 'HTTPS://APP.NULLSPACE.IO' });
    const res = createMockResponse();

    // Origins are case-sensitive per spec
    const result = validateCors(req, res, {
      allowedOrigins: ['https://app.nullspace.io'],
      allowNoOrigin: false
    });

    // Should reject because case doesn't match
    expect(result).toBe(false);
  });

  it('should handle origins with ports', () => {
    const req = createMockRequest({ origin: 'http://localhost:3000' });
    const res = createMockResponse();

    const result = validateCors(req, res, {
      allowedOrigins: ['http://localhost:3000'],
      allowNoOrigin: false
    });

    expect(result).toBe(true);
  });

  it('should reject origins with different ports', () => {
    const req = createMockRequest({ origin: 'http://localhost:3001' });
    const res = createMockResponse();

    const result = validateCors(req, res, {
      allowedOrigins: ['http://localhost:3000'],
      allowNoOrigin: false
    });

    expect(result).toBe(false);
  });

  it('should handle origins without ports', () => {
    const req = createMockRequest({ origin: 'https://app.nullspace.io' });
    const res = createMockResponse();

    const result = validateCors(req, res, {
      allowedOrigins: ['https://app.nullspace.io'],
      allowNoOrigin: false
    });

    expect(result).toBe(true);
  });

  it('should reject origins with trailing slashes vs allowed without', () => {
    // Note: Per URL spec, origins should not have trailing slashes
    const req = createMockRequest({ origin: 'https://app.nullspace.io/' });
    const res = createMockResponse();

    const result = validateCors(req, res, {
      allowedOrigins: ['https://app.nullspace.io'],
      allowNoOrigin: false
    });

    // Should reject because strings don't match exactly
    expect(result).toBe(false);
  });
});
