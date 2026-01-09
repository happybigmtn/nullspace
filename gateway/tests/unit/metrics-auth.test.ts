/**
 * Metrics Authentication Tests (US-252)
 *
 * Tests for metrics endpoint authentication:
 * - Bearer token authentication
 * - x-metrics-token header authentication (parity with simulator/auth)
 * - Rejection of invalid tokens
 * - Development mode bypass
 * - Production mode enforcement
 *
 * US-227: Error responses use RFC 7807 Problem Details format
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProblemTypes } from '@nullspace/types';
import { requireMetricsAuth, handleMetrics, metrics } from '../../src/metrics/index.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

function createMockResponse() {
  let responseBody = '';
  let statusCode = 0;
  const headers: Record<string, string> = {};

  return {
    mock: {
      statusCode: 0,
      setHeader: vi.fn((name: string, value: string) => {
        headers[name] = value;
      }),
      end: vi.fn((body?: string) => {
        if (body) responseBody = body;
      }),
      get statusCode() {
        return statusCode;
      },
      set statusCode(code: number) {
        statusCode = code;
      },
    } as unknown as ServerResponse,
    getStatusCode: () => statusCode,
    getResponseBody: () => responseBody,
    getHeaders: () => headers,
  };
}

function createMockRequest(headers: Record<string, string | string[]> = {}) {
  return {
    headers,
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
}

describe('Metrics Authentication (US-252)', () => {
  let originalToken: string | undefined;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalToken = process.env.METRICS_AUTH_TOKEN;
    originalEnv = process.env.NODE_ENV;
    metrics.reset();
  });

  afterEach(() => {
    if (originalToken !== undefined) {
      process.env.METRICS_AUTH_TOKEN = originalToken;
    } else {
      delete process.env.METRICS_AUTH_TOKEN;
    }
    if (originalEnv !== undefined) {
      process.env.NODE_ENV = originalEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  describe('Bearer token authentication', () => {
    it('should accept valid Bearer token', () => {
      process.env.METRICS_AUTH_TOKEN = 'secret-token-123';

      const req = createMockRequest({ authorization: 'Bearer secret-token-123' });
      const { mock, getStatusCode } = createMockResponse();

      const result = requireMetricsAuth(req, mock);

      expect(result).toBe(true);
      // Status code should not be set on success
      expect(getStatusCode()).toBe(0);
    });

    it('should reject invalid Bearer token', () => {
      process.env.METRICS_AUTH_TOKEN = 'secret-token-123';

      const req = createMockRequest({ authorization: 'Bearer wrong-token' });
      const { mock, getStatusCode, getResponseBody } = createMockResponse();

      const result = requireMetricsAuth(req, mock);

      expect(result).toBe(false);
      expect(getStatusCode()).toBe(401);
      // US-227: RFC 7807 Problem Details format
      expect(JSON.parse(getResponseBody())).toEqual({
        type: ProblemTypes.UNAUTHORIZED,
        title: 'Unauthorized',
        status: 401,
        detail: 'Missing or invalid authorization. Use Bearer token or x-metrics-token header.',
      });
    });

    it('should reject malformed Bearer header', () => {
      process.env.METRICS_AUTH_TOKEN = 'secret-token-123';

      const req = createMockRequest({ authorization: 'Basic secret-token-123' });
      const { mock, getStatusCode } = createMockResponse();

      const result = requireMetricsAuth(req, mock);

      expect(result).toBe(false);
      expect(getStatusCode()).toBe(401);
    });
  });

  describe('x-metrics-token header authentication', () => {
    it('should accept valid x-metrics-token header', () => {
      process.env.METRICS_AUTH_TOKEN = 'secret-token-456';

      const req = createMockRequest({ 'x-metrics-token': 'secret-token-456' });
      const { mock, getStatusCode } = createMockResponse();

      const result = requireMetricsAuth(req, mock);

      expect(result).toBe(true);
      expect(getStatusCode()).toBe(0);
    });

    it('should reject invalid x-metrics-token header', () => {
      process.env.METRICS_AUTH_TOKEN = 'secret-token-456';

      const req = createMockRequest({ 'x-metrics-token': 'wrong-token' });
      const { mock, getStatusCode, getResponseBody } = createMockResponse();

      const result = requireMetricsAuth(req, mock);

      expect(result).toBe(false);
      expect(getStatusCode()).toBe(401);
      // US-227: RFC 7807 Problem Details format
      expect(JSON.parse(getResponseBody()).detail).toContain('x-metrics-token');
    });

    it('should ignore array x-metrics-token (use string only)', () => {
      process.env.METRICS_AUTH_TOKEN = 'secret-token-456';

      // Arrays can happen with duplicate headers
      const req = createMockRequest({ 'x-metrics-token': ['secret-token-456', 'other'] });
      const { mock, getStatusCode } = createMockResponse();

      const result = requireMetricsAuth(req, mock);

      expect(result).toBe(false);
      expect(getStatusCode()).toBe(401);
    });
  });

  describe('parity with simulator/auth services', () => {
    it('should accept either Bearer or x-metrics-token (Bearer first)', () => {
      process.env.METRICS_AUTH_TOKEN = 'shared-token';

      const req = createMockRequest({
        authorization: 'Bearer shared-token',
        'x-metrics-token': 'wrong-token',
      });
      const { mock, getStatusCode } = createMockResponse();

      const result = requireMetricsAuth(req, mock);

      expect(result).toBe(true);
      expect(getStatusCode()).toBe(0);
    });

    it('should accept either Bearer or x-metrics-token (x-metrics-token first)', () => {
      process.env.METRICS_AUTH_TOKEN = 'shared-token';

      const req = createMockRequest({
        authorization: 'Bearer wrong-token',
        'x-metrics-token': 'shared-token',
      });
      const { mock, getStatusCode } = createMockResponse();

      const result = requireMetricsAuth(req, mock);

      expect(result).toBe(true);
      expect(getStatusCode()).toBe(0);
    });

    it('should reject when both headers are invalid', () => {
      process.env.METRICS_AUTH_TOKEN = 'shared-token';

      const req = createMockRequest({
        authorization: 'Bearer wrong-token',
        'x-metrics-token': 'also-wrong',
      });
      const { mock, getStatusCode } = createMockResponse();

      const result = requireMetricsAuth(req, mock);

      expect(result).toBe(false);
      expect(getStatusCode()).toBe(401);
    });
  });

  describe('development mode', () => {
    it('should allow unauthenticated requests in development', () => {
      delete process.env.METRICS_AUTH_TOKEN;
      process.env.NODE_ENV = 'development';

      const req = createMockRequest({});
      const { mock, getStatusCode } = createMockResponse();

      const result = requireMetricsAuth(req, mock);

      expect(result).toBe(true);
      expect(getStatusCode()).toBe(0);
    });

    it('should allow unauthenticated requests in test', () => {
      delete process.env.METRICS_AUTH_TOKEN;
      process.env.NODE_ENV = 'test';

      const req = createMockRequest({});
      const { mock, getStatusCode } = createMockResponse();

      const result = requireMetricsAuth(req, mock);

      expect(result).toBe(true);
      expect(getStatusCode()).toBe(0);
    });
  });

  describe('production mode', () => {
    it('should reject when no token configured in production', () => {
      delete process.env.METRICS_AUTH_TOKEN;
      process.env.NODE_ENV = 'production';

      const req = createMockRequest({ authorization: 'Bearer any-token' });
      const { mock, getStatusCode, getResponseBody } = createMockResponse();

      const result = requireMetricsAuth(req, mock);

      expect(result).toBe(false);
      expect(getStatusCode()).toBe(503);
      // US-227: RFC 7807 Problem Details format
      expect(JSON.parse(getResponseBody())).toEqual({
        type: ProblemTypes.SERVICE_UNAVAILABLE,
        title: 'Service Unavailable',
        status: 503,
        detail: 'Metrics endpoint not configured',
      });
    });

    it('should reject placeholder token values', () => {
      process.env.METRICS_AUTH_TOKEN = 'your_metrics_token_here';
      process.env.NODE_ENV = 'production';

      const req = createMockRequest({ authorization: 'Bearer your_metrics_token_here' });
      const { mock, getStatusCode, getResponseBody } = createMockResponse();

      const result = requireMetricsAuth(req, mock);

      expect(result).toBe(false);
      expect(getStatusCode()).toBe(503);
      // US-227: RFC 7807 Problem Details format
      expect(JSON.parse(getResponseBody())).toEqual({
        type: ProblemTypes.SERVICE_UNAVAILABLE,
        title: 'Service Unavailable',
        status: 503,
        detail: 'Metrics endpoint not properly configured',
      });
    });

    it('should reject PLACEHOLDER token values', () => {
      process.env.METRICS_AUTH_TOKEN = 'PLACEHOLDER_CHANGE_ME';
      process.env.NODE_ENV = 'production';

      const req = createMockRequest({ 'x-metrics-token': 'PLACEHOLDER_CHANGE_ME' });
      const { mock, getStatusCode } = createMockResponse();

      const result = requireMetricsAuth(req, mock);

      expect(result).toBe(false);
      expect(getStatusCode()).toBe(503);
    });
  });

  describe('handleMetrics with authentication', () => {
    it('should return metrics with valid x-metrics-token', () => {
      process.env.METRICS_AUTH_TOKEN = 'test-token';

      const req = createMockRequest({ 'x-metrics-token': 'test-token' });
      const { mock, getStatusCode, getResponseBody } = createMockResponse();

      handleMetrics(req, mock);

      expect(getStatusCode()).toBe(200);
      const parsed = JSON.parse(getResponseBody());
      expect(parsed).toHaveProperty('timestamp');
      expect(parsed).toHaveProperty('metrics');
    });

    it('should return 401 without authentication', () => {
      process.env.METRICS_AUTH_TOKEN = 'test-token';

      const req = createMockRequest({});
      const { mock, getStatusCode } = createMockResponse();

      handleMetrics(req, mock);

      expect(getStatusCode()).toBe(401);
    });
  });

  describe('WWW-Authenticate header', () => {
    it('should include WWW-Authenticate header on 401', () => {
      process.env.METRICS_AUTH_TOKEN = 'secret-token';

      const req = createMockRequest({});
      const { mock, getHeaders } = createMockResponse();

      requireMetricsAuth(req, mock);

      expect(getHeaders()['WWW-Authenticate']).toBe('Bearer realm="metrics"');
    });
  });

  describe('timing-safe comparison', () => {
    it('should use timing-safe comparison for token validation', () => {
      process.env.METRICS_AUTH_TOKEN = 'correct-token';

      // This test verifies the function works correctly
      // Actual timing-safe behavior is tested in timing-safe-comparison.test.ts
      const validReq = createMockRequest({ 'x-metrics-token': 'correct-token' });
      const invalidReq = createMockRequest({ 'x-metrics-token': 'incorrect-token' });
      const { mock: validRes } = createMockResponse();
      const { mock: invalidRes } = createMockResponse();

      expect(requireMetricsAuth(validReq, validRes)).toBe(true);
      expect(requireMetricsAuth(invalidReq, invalidRes)).toBe(false);
    });
  });
});
