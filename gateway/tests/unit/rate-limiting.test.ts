/**
 * Per-Session Message Rate Limiting Tests
 *
 * AC-3.4: Rate limits apply per client or wallet, with explicit errors when exceeded.
 *
 * These tests validate:
 * 1. Messages within rate limit are allowed
 * 2. Messages exceeding rate limit are rejected with explicit error
 * 3. Error response includes retryAfter seconds
 * 4. Rate limit resets after window expires
 * 5. Block duration is enforced after exceeding limit
 * 6. Session cleanup removes rate limit state
 * 7. Multiple sessions are tracked independently
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageRateLimiter } from '../../src/session/limiter.js';

describe('Message Rate Limiting (AC-3.4)', () => {
  describe('MessageRateLimiter', () => {
    let limiter: MessageRateLimiter;

    afterEach(() => {
      if (limiter) {
        limiter.shutdown();
      }
      vi.useRealTimers();
    });

    describe('basic rate limiting', () => {
      beforeEach(() => {
        // Create limiter with small limits for testing
        limiter = new MessageRateLimiter({
          maxMessages: 5,
          windowMs: 1000, // 1 second window
          blockMs: 2000,  // 2 second block
        });
      });

      it('should allow messages within the rate limit', () => {
        const sessionId = 'test-session-1';

        // First 5 messages should be allowed
        for (let i = 0; i < 5; i++) {
          const result = limiter.checkMessage(sessionId);
          expect(result.allowed).toBe(true);
          expect(result.retryAfterSeconds).toBeUndefined();
        }
      });

      it('should reject messages exceeding the rate limit', () => {
        const sessionId = 'test-session-2';

        // Use up the limit
        for (let i = 0; i < 5; i++) {
          const result = limiter.checkMessage(sessionId);
          expect(result.allowed).toBe(true);
        }

        // 6th message should be rejected
        const result = limiter.checkMessage(sessionId);
        expect(result.allowed).toBe(false);
        expect(result.code).toBe('RATE_LIMITED');
      });

      it('should include retryAfter in rejection response', () => {
        const sessionId = 'test-session-3';

        // Exceed the limit
        for (let i = 0; i < 6; i++) {
          limiter.checkMessage(sessionId);
        }

        const result = limiter.checkMessage(sessionId);
        expect(result.allowed).toBe(false);
        expect(result.retryAfterSeconds).toBeDefined();
        expect(result.retryAfterSeconds).toBeGreaterThan(0);
        expect(result.retryAfterSeconds).toBeLessThanOrEqual(2); // blockMs / 1000
      });

      it('should include human-readable reason in rejection', () => {
        const sessionId = 'test-session-4';

        // Exceed the limit
        for (let i = 0; i < 6; i++) {
          limiter.checkMessage(sessionId);
        }

        const result = limiter.checkMessage(sessionId);
        expect(result.reason).toBeDefined();
        expect(result.reason).toContain('Rate limit exceeded');
        expect(result.reason).toContain('Retry after');
      });
    });

    describe('window reset behavior', () => {
      it('should reset rate limit after window expires', async () => {
        vi.useFakeTimers();

        limiter = new MessageRateLimiter({
          maxMessages: 3,
          windowMs: 1000,
          blockMs: 500,
        });

        const sessionId = 'test-session-5';

        // Use up the limit
        for (let i = 0; i < 3; i++) {
          const result = limiter.checkMessage(sessionId);
          expect(result.allowed).toBe(true);
        }

        // Exceed limit - gets blocked
        const blocked = limiter.checkMessage(sessionId);
        expect(blocked.allowed).toBe(false);

        // Wait for window + block to expire
        vi.advanceTimersByTime(1600);

        // Should be allowed again
        const result = limiter.checkMessage(sessionId);
        expect(result.allowed).toBe(true);
      });
    });

    describe('block duration enforcement', () => {
      it('should block session for configured duration after exceeding limit', () => {
        vi.useFakeTimers();

        limiter = new MessageRateLimiter({
          maxMessages: 2,
          windowMs: 1000,
          blockMs: 5000, // 5 second block
        });

        const sessionId = 'test-session-6';

        // Exceed limit
        limiter.checkMessage(sessionId);
        limiter.checkMessage(sessionId);
        const blocked = limiter.checkMessage(sessionId);
        expect(blocked.allowed).toBe(false);

        // Try again immediately - should still be blocked
        const stillBlocked = limiter.checkMessage(sessionId);
        expect(stillBlocked.allowed).toBe(false);

        // Advance time but not past block duration
        vi.advanceTimersByTime(3000);
        const partiallyWaited = limiter.checkMessage(sessionId);
        expect(partiallyWaited.allowed).toBe(false);

        // Advance past block duration
        vi.advanceTimersByTime(3000);
        const afterBlock = limiter.checkMessage(sessionId);
        expect(afterBlock.allowed).toBe(true);
      });
    });

    describe('session isolation', () => {
      it('should track multiple sessions independently', () => {
        limiter = new MessageRateLimiter({
          maxMessages: 3,
          windowMs: 60000,
          blockMs: 60000,
        });

        const session1 = 'session-alpha';
        const session2 = 'session-beta';

        // Use up session1's limit
        for (let i = 0; i < 4; i++) {
          limiter.checkMessage(session1);
        }

        // Session1 should be blocked
        const result1 = limiter.checkMessage(session1);
        expect(result1.allowed).toBe(false);

        // Session2 should still be allowed
        const result2 = limiter.checkMessage(session2);
        expect(result2.allowed).toBe(true);
      });
    });

    describe('session cleanup', () => {
      it('should remove rate limit state when session is cleaned up', () => {
        limiter = new MessageRateLimiter({
          maxMessages: 2,
          windowMs: 60000,
          blockMs: 60000,
        });

        const sessionId = 'test-session-cleanup';

        // Use up limit and get blocked
        limiter.checkMessage(sessionId);
        limiter.checkMessage(sessionId);
        limiter.checkMessage(sessionId);

        // Verify blocked
        expect(limiter.checkMessage(sessionId).allowed).toBe(false);

        // Clean up session
        limiter.removeSession(sessionId);

        // State should be cleared - verify via getState
        expect(limiter.getState(sessionId)).toBeUndefined();
      });

      it('should allow messages after session reconnects (new session ID)', () => {
        limiter = new MessageRateLimiter({
          maxMessages: 2,
          windowMs: 60000,
          blockMs: 60000,
        });

        const sessionId1 = 'test-session-original';
        const sessionId2 = 'test-session-reconnected';

        // Block first session
        limiter.checkMessage(sessionId1);
        limiter.checkMessage(sessionId1);
        limiter.checkMessage(sessionId1);
        expect(limiter.checkMessage(sessionId1).allowed).toBe(false);

        // Clean up
        limiter.removeSession(sessionId1);

        // New session should be allowed
        const result = limiter.checkMessage(sessionId2);
        expect(result.allowed).toBe(true);
      });
    });

    describe('statistics and monitoring', () => {
      it('should report accurate stats', () => {
        limiter = new MessageRateLimiter({
          maxMessages: 5,
          windowMs: 60000,
          blockMs: 60000,
        });

        // Track some sessions
        limiter.checkMessage('session-a');
        limiter.checkMessage('session-b');
        limiter.checkMessage('session-c');

        // Block one session
        for (let i = 0; i < 6; i++) {
          limiter.checkMessage('session-blocked');
        }

        const stats = limiter.getStats();
        expect(stats.trackedSessions).toBe(4);
        expect(stats.blockedSessions).toBe(1);
        expect(stats.config.maxMessages).toBe(5);
      });

      it('should return individual session state', () => {
        limiter = new MessageRateLimiter({
          maxMessages: 10,
          windowMs: 60000,
          blockMs: 60000,
        });

        const sessionId = 'test-session-state';

        // Send some messages
        limiter.checkMessage(sessionId);
        limiter.checkMessage(sessionId);
        limiter.checkMessage(sessionId);

        const state = limiter.getState(sessionId);
        expect(state).toBeDefined();
        expect(state!.count).toBe(3);
        expect(state!.blockedUntil).toBe(0);
      });
    });

    describe('edge cases', () => {
      it('should handle exactly max messages (boundary)', () => {
        limiter = new MessageRateLimiter({
          maxMessages: 3,
          windowMs: 60000,
          blockMs: 60000,
        });

        const sessionId = 'boundary-test';

        // Exactly maxMessages should be allowed
        expect(limiter.checkMessage(sessionId).allowed).toBe(true); // 1
        expect(limiter.checkMessage(sessionId).allowed).toBe(true); // 2
        expect(limiter.checkMessage(sessionId).allowed).toBe(true); // 3

        // maxMessages + 1 should be rejected
        expect(limiter.checkMessage(sessionId).allowed).toBe(false); // 4
      });

      it('should handle rapid messages within same millisecond', () => {
        vi.useFakeTimers();

        limiter = new MessageRateLimiter({
          maxMessages: 100,
          windowMs: 1000,
          blockMs: 1000,
        });

        const sessionId = 'rapid-test';

        // Send 100 messages instantly (all in same ms)
        for (let i = 0; i < 100; i++) {
          const result = limiter.checkMessage(sessionId);
          expect(result.allowed).toBe(true);
        }

        // 101st should be rejected
        expect(limiter.checkMessage(sessionId).allowed).toBe(false);
      });

      it('should handle undefined clientIp parameter', () => {
        limiter = new MessageRateLimiter({
          maxMessages: 2,
          windowMs: 60000,
          blockMs: 60000,
        });

        const sessionId = 'no-ip-test';

        // Should work without clientIp
        expect(limiter.checkMessage(sessionId).allowed).toBe(true);
        expect(limiter.checkMessage(sessionId).allowed).toBe(true);
        expect(limiter.checkMessage(sessionId).allowed).toBe(false);
      });
    });
  });

  describe('Error Response Format', () => {
    let limiter: MessageRateLimiter;

    beforeEach(() => {
      limiter = new MessageRateLimiter({
        maxMessages: 1,
        windowMs: 60000,
        blockMs: 30000,
      });
    });

    afterEach(() => {
      limiter.shutdown();
    });

    it('should return all required fields for rate limit error', () => {
      const sessionId = 'error-format-test';

      // Trigger rate limit
      limiter.checkMessage(sessionId);
      const result = limiter.checkMessage(sessionId);

      // Verify all required fields per AC-3.4
      expect(result).toEqual(
        expect.objectContaining({
          allowed: false,
          retryAfterSeconds: expect.any(Number),
          reason: expect.stringContaining('Rate limit exceeded'),
          code: 'RATE_LIMITED',
        })
      );
    });

    it('should provide accurate retryAfter value', () => {
      vi.useFakeTimers();

      const sessionId = 'retry-after-test';

      // Trigger rate limit
      limiter.checkMessage(sessionId);
      const result = limiter.checkMessage(sessionId);

      // Should be close to blockMs / 1000 = 30 seconds
      expect(result.retryAfterSeconds).toBe(30);
    });
  });
});
