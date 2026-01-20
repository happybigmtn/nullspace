/**
 * Rate Limiting Integration Tests
 *
 * AC-3.4: Rate limits apply per client or wallet, with explicit errors when exceeded.
 *
 * These tests validate the full WebSocket flow with rate limiting enforcement.
 * Note: These tests require a running gateway with specific rate limit configuration.
 *
 * Run with: RUN_INTEGRATION=true GATEWAY_SESSION_RATE_LIMIT_POINTS=10 npm test -- rate-limiting.test.ts
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  INTEGRATION_ENABLED,
  createConnection,
  sendAndReceive,
  waitForMessage,
} from '../helpers/ws.js';

vi.setConfig({ testTimeout: 60000 });

describe.skipIf(!INTEGRATION_ENABLED)('Rate Limiting Integration Tests (AC-3.4)', () => {
  const connections: WebSocket[] = [];

  afterAll(() => {
    connections.forEach((ws) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
  });

  afterEach(() => {
    // Clean up any connections created during tests
    while (connections.length > 0) {
      const ws = connections.pop();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
  });

  describe('Message Rate Limiting', () => {
    it('should allow messages within rate limit', async () => {
      const ws = await createConnection();
      connections.push(ws);

      // Wait for session to be ready
      const sessionReady = await waitForMessage(ws, 'session_ready');
      expect(sessionReady.type).toBe('session_ready');

      // Send a few get_balance requests (should all succeed)
      for (let i = 0; i < 5; i++) {
        const response = await sendAndReceive(ws, { type: 'get_balance' });
        expect(response.type).toBe('balance');
      }
    });

    it('should reject messages with RATE_LIMITED error when limit exceeded', async () => {
      const ws = await createConnection();
      connections.push(ws);

      // Wait for session to be ready
      await waitForMessage(ws, 'session_ready');

      // Use the test rate limit configured in CI/test environment
      // Default is 100/min, but can be overridden via GATEWAY_SESSION_RATE_LIMIT_POINTS
      const rateLimitPoints = parseInt(process.env.GATEWAY_SESSION_RATE_LIMIT_POINTS ?? '100', 10);

      // Send messages up to the limit
      const responses: Record<string, unknown>[] = [];
      for (let i = 0; i < rateLimitPoints + 5; i++) {
        const response = await sendAndReceive(ws, { type: 'get_balance' });
        responses.push(response);

        // If we get a rate limit error, we're done
        if (response.type === 'error' && response.code === 'RATE_LIMITED') {
          break;
        }
      }

      // Check that at least one message was rate limited
      const rateLimitedResponse = responses.find(
        (r) => r.type === 'error' && r.code === 'RATE_LIMITED'
      );

      expect(rateLimitedResponse).toBeDefined();
      expect(rateLimitedResponse?.code).toBe('RATE_LIMITED');
      expect(rateLimitedResponse?.message).toContain('Rate limit exceeded');
      expect(rateLimitedResponse?.retryAfter).toBeDefined();
      expect(typeof rateLimitedResponse?.retryAfter).toBe('number');
    });

    it('should allow pings even when rate limited', async () => {
      const ws = await createConnection();
      connections.push(ws);

      // Wait for session to be ready
      await waitForMessage(ws, 'session_ready');

      // Get the rate limit
      const rateLimitPoints = parseInt(process.env.GATEWAY_SESSION_RATE_LIMIT_POINTS ?? '100', 10);

      // Exhaust rate limit with get_balance
      for (let i = 0; i < rateLimitPoints + 1; i++) {
        await sendAndReceive(ws, { type: 'get_balance' });
      }

      // Verify we're rate limited for get_balance
      const blockedResponse = await sendAndReceive(ws, { type: 'get_balance' });
      expect(blockedResponse.code).toBe('RATE_LIMITED');

      // But ping should still work (not subject to rate limiting)
      const pingResponse = await sendAndReceive(ws, { type: 'ping' });
      expect(pingResponse.type).toBe('pong');
      expect(pingResponse.timestamp).toBeDefined();
    });

    it('should track rate limits independently per session', async () => {
      const ws1 = await createConnection();
      const ws2 = await createConnection();
      connections.push(ws1, ws2);

      // Wait for both sessions to be ready
      await Promise.all([
        waitForMessage(ws1, 'session_ready'),
        waitForMessage(ws2, 'session_ready'),
      ]);

      const rateLimitPoints = parseInt(process.env.GATEWAY_SESSION_RATE_LIMIT_POINTS ?? '100', 10);

      // Exhaust rate limit on session 1
      for (let i = 0; i < rateLimitPoints + 1; i++) {
        await sendAndReceive(ws1, { type: 'get_balance' });
      }

      // Session 1 should be rate limited
      const response1 = await sendAndReceive(ws1, { type: 'get_balance' });
      expect(response1.code).toBe('RATE_LIMITED');

      // Session 2 should still be allowed
      const response2 = await sendAndReceive(ws2, { type: 'get_balance' });
      expect(response2.type).toBe('balance');
    });
  });

  describe('Error Response Format', () => {
    it('should return RFC 7807-style error with all required fields', async () => {
      const ws = await createConnection();
      connections.push(ws);

      await waitForMessage(ws, 'session_ready');

      const rateLimitPoints = parseInt(process.env.GATEWAY_SESSION_RATE_LIMIT_POINTS ?? '100', 10);

      // Exhaust rate limit
      for (let i = 0; i < rateLimitPoints + 1; i++) {
        await sendAndReceive(ws, { type: 'get_balance' });
      }

      const errorResponse = await sendAndReceive(ws, { type: 'get_balance' });

      // Verify error response structure
      expect(errorResponse).toMatchObject({
        type: 'error',
        code: 'RATE_LIMITED',
        message: expect.stringContaining('Rate limit exceeded'),
        retryAfter: expect.any(Number),
      });

      // Verify retryAfter is reasonable (should be block duration in seconds)
      expect(errorResponse.retryAfter).toBeGreaterThan(0);
      expect(errorResponse.retryAfter).toBeLessThanOrEqual(3600); // Max 1 hour
    });
  });
});
