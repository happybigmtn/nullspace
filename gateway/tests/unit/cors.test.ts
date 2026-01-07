/**
 * CORS Middleware Unit Tests
 *
 * Tests for CORS validation middleware that provides
 * defense-in-depth protection for HTTP endpoints.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  initializeCors,
  getCorsConfig,
  validateCors,
  handleCorsPreflight,
  type CorsConfig,
} from '../../src/middleware/security.js';

// Mock response object
function createMockResponse(): ServerResponse & {
  statusCode: number;
  headers: Map<string, string>;
  body: string;
  ended: boolean;
} {
  const headers = new Map<string, string>();
  return {
    statusCode: 200,
    headers,
    body: '',
    ended: false,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
    end(data?: string) {
      this.body = data ?? '';
      this.ended = true;
    },
  } as unknown as ServerResponse & {
    statusCode: number;
    headers: Map<string, string>;
    body: string;
    ended: boolean;
  };
}

// Mock request object
function createMockRequest(options: {
  origin?: string | null;
  method?: string;
}): IncomingMessage {
  return {
    headers: {
      ...(options.origin !== undefined ? { origin: options.origin } : {}),
    },
    method: options.method ?? 'GET',
  } as unknown as IncomingMessage;
}

describe('CORS Middleware', () => {
  describe('initializeCors', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should initialize with provided origins', () => {
      initializeCors({
        allowedOrigins: ['https://example.com', 'https://app.example.com'],
        allowNoOrigin: false,
      });

      const config = getCorsConfig();
      expect(config).not.toBeNull();
      expect(config?.allowedOrigins).toContain('https://example.com');
      expect(config?.allowedOrigins).toContain('https://app.example.com');
      expect(config?.allowNoOrigin).toBe(false);
    });

    it('should read from environment variables', () => {
      process.env.GATEWAY_ALLOWED_ORIGINS = 'https://a.com,https://b.com';
      process.env.GATEWAY_ALLOW_NO_ORIGIN = 'true';

      initializeCors();

      const config = getCorsConfig();
      expect(config?.allowedOrigins).toContain('https://a.com');
      expect(config?.allowedOrigins).toContain('https://b.com');
      expect(config?.allowNoOrigin).toBe(true);
    });

    it('should filter empty origins', () => {
      process.env.GATEWAY_ALLOWED_ORIGINS = 'https://a.com,,https://b.com, ';

      initializeCors();

      const config = getCorsConfig();
      expect(config?.allowedOrigins.length).toBe(2);
    });

    it('should trim whitespace from origins', () => {
      process.env.GATEWAY_ALLOWED_ORIGINS = '  https://a.com  ,  https://b.com  ';

      initializeCors();

      const config = getCorsConfig();
      expect(config?.allowedOrigins).toContain('https://a.com');
      expect(config?.allowedOrigins).toContain('https://b.com');
    });
  });

  describe('validateCors', () => {
    const testConfig: CorsConfig = {
      allowedOrigins: ['https://allowed.com', 'https://also-allowed.com'],
      allowNoOrigin: false,
    };

    it('should allow requests from allowed origins', () => {
      const req = createMockRequest({ origin: 'https://allowed.com' });
      const res = createMockResponse();

      const result = validateCors(req, res, testConfig);

      expect(result).toBe(true);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://allowed.com');
    });

    it('should block requests from non-allowed origins', () => {
      const req = createMockRequest({ origin: 'https://evil.com' });
      const res = createMockResponse();

      const result = validateCors(req, res, testConfig);

      expect(result).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.body).toContain('CORS_ORIGIN_NOT_ALLOWED');
    });

    it('should block requests without origin when not allowed', () => {
      const req = createMockRequest({ origin: null });
      const res = createMockResponse();

      const result = validateCors(req, res, testConfig);

      expect(result).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.body).toContain('CORS_ORIGIN_REQUIRED');
    });

    it('should allow requests without origin when configured', () => {
      const req = createMockRequest({ origin: null });
      const res = createMockResponse();

      const result = validateCors(req, res, {
        ...testConfig,
        allowNoOrigin: true,
      });

      expect(result).toBe(true);
    });

    it('should handle "null" origin string as missing', () => {
      const req = createMockRequest({ origin: 'null' });
      const res = createMockResponse();

      const result = validateCors(req, res, testConfig);

      expect(result).toBe(false);
      expect(res.body).toContain('CORS_ORIGIN_REQUIRED');
    });

    it('should allow all when no config provided', () => {
      const req = createMockRequest({ origin: 'https://any.com' });
      const res = createMockResponse();

      const result = validateCors(req, res, { allowedOrigins: [], allowNoOrigin: true });

      expect(result).toBe(true);
    });

    it('should set appropriate CORS headers on success', () => {
      const req = createMockRequest({ origin: 'https://allowed.com' });
      const res = createMockResponse();

      validateCors(req, res, testConfig);

      expect(res.headers.get('access-control-allow-origin')).toBe('https://allowed.com');
      expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
      expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type, Authorization');
      expect(res.headers.get('access-control-max-age')).toBe('86400');
    });

    it('should not set wildcard origin', () => {
      const req = createMockRequest({ origin: 'https://allowed.com' });
      const res = createMockResponse();

      validateCors(req, res, testConfig);

      expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
    });
  });

  describe('handleCorsPreflight', () => {
    const testConfig: CorsConfig = {
      allowedOrigins: ['https://allowed.com'],
      allowNoOrigin: false,
    };

    beforeEach(() => {
      initializeCors(testConfig);
    });

    it('should handle OPTIONS requests', () => {
      const req = createMockRequest({
        origin: 'https://allowed.com',
        method: 'OPTIONS',
      });
      const res = createMockResponse();

      const handled = handleCorsPreflight(req, res);

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(204);
      expect(res.ended).toBe(true);
    });

    it('should not handle non-OPTIONS requests', () => {
      const req = createMockRequest({
        origin: 'https://allowed.com',
        method: 'GET',
      });
      const res = createMockResponse();

      const handled = handleCorsPreflight(req, res);

      expect(handled).toBe(false);
      expect(res.ended).toBe(false);
    });

    it('should block preflight from non-allowed origins', () => {
      const req = createMockRequest({
        origin: 'https://evil.com',
        method: 'OPTIONS',
      });
      const res = createMockResponse();

      const handled = handleCorsPreflight(req, res);

      expect(handled).toBe(true); // Was handled (blocked)
      expect(res.statusCode).toBe(403);
    });
  });

  describe('Security Edge Cases', () => {
    const strictConfig: CorsConfig = {
      allowedOrigins: ['https://allowed.com'],
      allowNoOrigin: false,
    };

    it('should not accept origin with trailing slash', () => {
      const req = createMockRequest({ origin: 'https://allowed.com/' });
      const res = createMockResponse();

      const result = validateCors(req, res, strictConfig);

      // Trailing slash makes it different - should be blocked
      expect(result).toBe(false);
    });

    it('should be case-sensitive for origins', () => {
      const req = createMockRequest({ origin: 'HTTPS://ALLOWED.COM' });
      const res = createMockResponse();

      const result = validateCors(req, res, strictConfig);

      // Origin matching is case-sensitive
      expect(result).toBe(false);
    });

    it('should not accept subdomain of allowed origin', () => {
      const req = createMockRequest({ origin: 'https://sub.allowed.com' });
      const res = createMockResponse();

      const result = validateCors(req, res, strictConfig);

      expect(result).toBe(false);
    });

    it('should not accept origin with different port', () => {
      const config: CorsConfig = {
        allowedOrigins: ['https://allowed.com:443'],
        allowNoOrigin: false,
      };
      const req = createMockRequest({ origin: 'https://allowed.com:8443' });
      const res = createMockResponse();

      const result = validateCors(req, res, config);

      expect(result).toBe(false);
    });

    it('should not accept origin with different protocol', () => {
      const req = createMockRequest({ origin: 'http://allowed.com' });
      const res = createMockResponse();

      const result = validateCors(req, res, strictConfig);

      expect(result).toBe(false);
    });
  });
});
