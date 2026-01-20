/**
 * Unit tests for Engine Forwarder (AC-3.5)
 *
 * Tests idempotency key handling, retries, and duplicate detection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EngineForwarder, type ForwardOptions } from '../../src/backend/engine-forwarder.js';
import type { SubmitClient, SubmitResult } from '../../src/backend/http.js';

// Mock SubmitClient
function createMockSubmitClient(submitFn?: (submission: Uint8Array) => Promise<SubmitResult>): SubmitClient {
  return {
    submit: submitFn ?? vi.fn().mockResolvedValue({ accepted: true }),
    healthCheck: vi.fn().mockResolvedValue(true),
    getAccount: vi.fn().mockResolvedValue({ nonce: 0n, balance: 1000n }),
  } as unknown as SubmitClient;
}

describe('EngineForwarder', () => {
  let forwarder: EngineForwarder;
  let mockClient: SubmitClient;

  beforeEach(() => {
    mockClient = createMockSubmitClient();
    forwarder = new EngineForwarder(mockClient, {
      maxRetries: 2,
      initialBackoffMs: 10,
      maxBackoffMs: 50,
      idempotencyTtlMs: 1000,
      cleanupIntervalMs: 500,
    });
  });

  afterEach(() => {
    forwarder.shutdown();
  });

  describe('basic forwarding', () => {
    it('should forward a submission successfully', async () => {
      const submission = new Uint8Array([1, 2, 3, 4]);
      const options: ForwardOptions = { sessionId: 'test-session-1' };

      const result = await forwarder.forward(submission, options);

      expect(result.accepted).toBe(true);
      expect(result.idempotencyKey).toBeDefined();
      expect(result.deduplicated).toBe(false);
      expect(result.retryCount).toBe(0);
      expect(mockClient.submit).toHaveBeenCalledTimes(1);
    });

    it('should use provided idempotency key', async () => {
      const submission = new Uint8Array([1, 2, 3, 4]);
      const options: ForwardOptions = {
        sessionId: 'test-session-1',
        idempotencyKey: 'custom-key-123',
      };

      const result = await forwarder.forward(submission, options);

      expect(result.idempotencyKey).toBe('custom-key-123');
    });

    it('should include requestId in submit call', async () => {
      const submission = new Uint8Array([1, 2, 3, 4]);
      const options: ForwardOptions = {
        sessionId: 'test-session-1',
        requestId: 'trace-123',
      };

      await forwarder.forward(submission, options);

      expect(mockClient.submit).toHaveBeenCalledWith(submission, { requestId: 'trace-123' });
    });
  });

  describe('idempotency', () => {
    it('should return cached result for duplicate request with same idempotency key', async () => {
      const submission = new Uint8Array([1, 2, 3, 4]);
      const options: ForwardOptions = {
        sessionId: 'test-session-1',
        idempotencyKey: 'idem-key-1',
      };

      // First request
      const result1 = await forwarder.forward(submission, options);
      expect(result1.accepted).toBe(true);
      expect(result1.deduplicated).toBe(false);

      // Second request with same key and same submission
      const result2 = await forwarder.forward(submission, options);
      expect(result2.accepted).toBe(true);
      expect(result2.deduplicated).toBe(true);
      expect(result2.idempotencyKey).toBe('idem-key-1');

      // SubmitClient should only be called once
      expect(mockClient.submit).toHaveBeenCalledTimes(1);
    });

    it('should reject request with same idempotency key but different submission', async () => {
      const submission1 = new Uint8Array([1, 2, 3, 4]);
      const submission2 = new Uint8Array([5, 6, 7, 8]);
      const options: ForwardOptions = {
        sessionId: 'test-session-1',
        idempotencyKey: 'idem-key-2',
      };

      // First request
      const result1 = await forwarder.forward(submission1, options);
      expect(result1.accepted).toBe(true);

      // Second request with same key but different submission
      const result2 = await forwarder.forward(submission2, options);
      expect(result2.accepted).toBe(false);
      expect(result2.error).toContain('Idempotency key already used');
      expect(result2.deduplicated).toBe(false);

      // SubmitClient should only be called once (for first request)
      expect(mockClient.submit).toHaveBeenCalledTimes(1);
    });

    it('should scope idempotency keys by session', async () => {
      const submission = new Uint8Array([1, 2, 3, 4]);

      // Same idempotency key, different sessions
      const result1 = await forwarder.forward(submission, {
        sessionId: 'session-A',
        idempotencyKey: 'shared-key',
      });

      const result2 = await forwarder.forward(submission, {
        sessionId: 'session-B',
        idempotencyKey: 'shared-key',
      });

      expect(result1.accepted).toBe(true);
      expect(result2.accepted).toBe(true);
      expect(result1.deduplicated).toBe(false);
      expect(result2.deduplicated).toBe(false);

      // Both should have been submitted (different sessions)
      expect(mockClient.submit).toHaveBeenCalledTimes(2);
    });

    it('should track idempotency entry status', async () => {
      const submission = new Uint8Array([1, 2, 3, 4]);
      const sessionId = 'test-session-1';
      const idempotencyKey = 'status-key';

      await forwarder.forward(submission, { sessionId, idempotencyKey });

      expect(forwarder.hasIdempotencyKey(sessionId, idempotencyKey)).toBe(true);

      const status = forwarder.getIdempotencyStatus(sessionId, idempotencyKey);
      expect(status).toBeDefined();
      expect(status?.status).toBe('completed');
      expect(status?.result?.accepted).toBe(true);
    });
  });

  describe('retries', () => {
    it('should retry on retryable error', async () => {
      let attempts = 0;
      mockClient = createMockSubmitClient(async () => {
        attempts++;
        if (attempts < 3) {
          return { accepted: false, error: 'ETIMEDOUT' };
        }
        return { accepted: true };
      });
      forwarder = new EngineForwarder(mockClient, {
        maxRetries: 3,
        initialBackoffMs: 1,
        maxBackoffMs: 5,
      });

      const result = await forwarder.forward(new Uint8Array([1, 2, 3]), {
        sessionId: 'test-session',
      });

      expect(result.accepted).toBe(true);
      expect(result.retryCount).toBe(2);
      expect(attempts).toBe(3);

      forwarder.shutdown();
    });

    it('should not retry on non-retryable error', async () => {
      let attempts = 0;
      mockClient = createMockSubmitClient(async () => {
        attempts++;
        return { accepted: false, error: 'Invalid transaction format' };
      });
      forwarder = new EngineForwarder(mockClient, {
        maxRetries: 3,
        initialBackoffMs: 1,
      });

      const result = await forwarder.forward(new Uint8Array([1, 2, 3]), {
        sessionId: 'test-session',
      });

      expect(result.accepted).toBe(false);
      expect(result.retryCount).toBe(0);
      expect(attempts).toBe(1);

      forwarder.shutdown();
    });

    it('should respect skipRetries option', async () => {
      let attempts = 0;
      mockClient = createMockSubmitClient(async () => {
        attempts++;
        return { accepted: false, error: 'ETIMEDOUT' };
      });
      forwarder = new EngineForwarder(mockClient, {
        maxRetries: 3,
        initialBackoffMs: 1,
      });

      const result = await forwarder.forward(new Uint8Array([1, 2, 3]), {
        sessionId: 'test-session',
        skipRetries: true,
      });

      expect(result.accepted).toBe(false);
      expect(result.retryCount).toBe(0);
      expect(attempts).toBe(1);

      forwarder.shutdown();
    });

    it('should fail after max retries', async () => {
      let attempts = 0;
      mockClient = createMockSubmitClient(async () => {
        attempts++;
        return { accepted: false, error: 'ECONNRESET' };
      });
      forwarder = new EngineForwarder(mockClient, {
        maxRetries: 2,
        initialBackoffMs: 1,
        maxBackoffMs: 5,
      });

      const result = await forwarder.forward(new Uint8Array([1, 2, 3]), {
        sessionId: 'test-session',
      });

      expect(result.accepted).toBe(false);
      expect(result.retryCount).toBe(2);
      expect(attempts).toBe(3); // 1 initial + 2 retries

      forwarder.shutdown();
    });

    it('should use exponential backoff with jitter', async () => {
      const startTime = Date.now();
      let attempts = 0;

      mockClient = createMockSubmitClient(async () => {
        attempts++;
        if (attempts < 3) {
          return { accepted: false, error: 'ETIMEDOUT' };
        }
        return { accepted: true };
      });

      forwarder = new EngineForwarder(mockClient, {
        maxRetries: 2,
        initialBackoffMs: 20,
        maxBackoffMs: 100,
        backoffMultiplier: 2,
      });

      await forwarder.forward(new Uint8Array([1, 2, 3]), {
        sessionId: 'test-session',
      });

      const elapsed = Date.now() - startTime;
      // Should have waited at least some time for retries
      // Initial: 20ms (±10%), Second: 40ms (±10%)
      // Total minimum: ~50ms, but we allow some slack for test timing
      expect(elapsed).toBeGreaterThan(30);

      forwarder.shutdown();
    });
  });

  describe('failed request handling', () => {
    it('should allow retry of failed request with same idempotency key', async () => {
      let attempts = 0;
      mockClient = createMockSubmitClient(async () => {
        attempts++;
        if (attempts === 1) {
          return { accepted: false, error: 'Invalid bet amount' };
        }
        return { accepted: true };
      });
      forwarder = new EngineForwarder(mockClient, {
        maxRetries: 0, // No automatic retries
        initialBackoffMs: 1,
      });

      const submission = new Uint8Array([1, 2, 3, 4]);
      const options: ForwardOptions = {
        sessionId: 'test-session-1',
        idempotencyKey: 'retry-key',
      };

      // First request fails
      const result1 = await forwarder.forward(submission, options);
      expect(result1.accepted).toBe(false);

      // Same request with same key - should be retried (entry was marked as failed)
      const result2 = await forwarder.forward(submission, options);
      expect(result2.accepted).toBe(true);
      expect(result2.deduplicated).toBe(false);

      forwarder.shutdown();
    });
  });

  describe('session cleanup', () => {
    it('should clear idempotency entries for a session', async () => {
      const sessionId = 'session-to-clear';
      const submission = new Uint8Array([1, 2, 3]);

      // Create multiple entries for the session
      await forwarder.forward(submission, { sessionId, idempotencyKey: 'key-1' });
      await forwarder.forward(submission, { sessionId, idempotencyKey: 'key-2' });
      await forwarder.forward(submission, { sessionId, idempotencyKey: 'key-3' });

      expect(forwarder.hasIdempotencyKey(sessionId, 'key-1')).toBe(true);
      expect(forwarder.hasIdempotencyKey(sessionId, 'key-2')).toBe(true);
      expect(forwarder.hasIdempotencyKey(sessionId, 'key-3')).toBe(true);

      const cleared = forwarder.clearSession(sessionId);
      expect(cleared).toBe(3);

      expect(forwarder.hasIdempotencyKey(sessionId, 'key-1')).toBe(false);
      expect(forwarder.hasIdempotencyKey(sessionId, 'key-2')).toBe(false);
      expect(forwarder.hasIdempotencyKey(sessionId, 'key-3')).toBe(false);
    });

    it('should not affect other sessions when clearing', async () => {
      const session1 = 'session-1';
      const session2 = 'session-2';
      const submission = new Uint8Array([1, 2, 3]);

      await forwarder.forward(submission, { sessionId: session1, idempotencyKey: 'key-a' });
      await forwarder.forward(submission, { sessionId: session2, idempotencyKey: 'key-b' });

      forwarder.clearSession(session1);

      expect(forwarder.hasIdempotencyKey(session1, 'key-a')).toBe(false);
      expect(forwarder.hasIdempotencyKey(session2, 'key-b')).toBe(true);
    });
  });

  describe('metrics', () => {
    it('should report metrics', async () => {
      // Start with empty store
      let metrics = forwarder.getMetrics();
      expect(metrics.totalEntries).toBe(0);

      // Add some entries
      await forwarder.forward(new Uint8Array([1]), { sessionId: 's1', idempotencyKey: 'k1' });
      await forwarder.forward(new Uint8Array([2]), { sessionId: 's1', idempotencyKey: 'k2' });

      metrics = forwarder.getMetrics();
      expect(metrics.totalEntries).toBe(2);
      expect(metrics.completedEntries).toBe(2);
      expect(metrics.pendingEntries).toBe(0);
      expect(metrics.failedEntries).toBe(0);
    });

    it('should count failed entries', async () => {
      mockClient = createMockSubmitClient(async () => {
        return { accepted: false, error: 'Invalid format' };
      });
      forwarder = new EngineForwarder(mockClient, {
        maxRetries: 0,
        initialBackoffMs: 1,
      });

      await forwarder.forward(new Uint8Array([1]), { sessionId: 's1', idempotencyKey: 'k1' });

      const metrics = forwarder.getMetrics();
      expect(metrics.totalEntries).toBe(1);
      expect(metrics.failedEntries).toBe(1);
      expect(metrics.completedEntries).toBe(0);

      forwarder.shutdown();
    });
  });

  describe('TTL cleanup', () => {
    it('should clean up expired entries', async () => {
      // Use very short TTL for testing
      forwarder = new EngineForwarder(mockClient, {
        idempotencyTtlMs: 50, // 50ms TTL
        cleanupIntervalMs: 25, // Cleanup every 25ms
      });

      await forwarder.forward(new Uint8Array([1]), { sessionId: 's1', idempotencyKey: 'expire-key' });
      expect(forwarder.hasIdempotencyKey('s1', 'expire-key')).toBe(true);

      // Wait for TTL and cleanup
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(forwarder.hasIdempotencyKey('s1', 'expire-key')).toBe(false);

      forwarder.shutdown();
    });
  });

  describe('error handling', () => {
    it('should handle submit throwing an error', async () => {
      mockClient = createMockSubmitClient(async () => {
        throw new Error('Network failure');
      });
      forwarder = new EngineForwarder(mockClient, {
        maxRetries: 0,
        initialBackoffMs: 1,
      });

      const result = await forwarder.forward(new Uint8Array([1, 2, 3]), {
        sessionId: 'test-session',
      });

      expect(result.accepted).toBe(false);
      expect(result.error).toBe('Network failure');

      forwarder.shutdown();
    });

    it('should handle non-Error throws', async () => {
      mockClient = createMockSubmitClient(async () => {
        throw 'String error';
      });
      forwarder = new EngineForwarder(mockClient, {
        maxRetries: 0,
        initialBackoffMs: 1,
      });

      const result = await forwarder.forward(new Uint8Array([1, 2, 3]), {
        sessionId: 'test-session',
      });

      expect(result.accepted).toBe(false);
      expect(result.error).toBe('Unknown error');

      forwarder.shutdown();
    });
  });

  describe('retryable error detection', () => {
    const retryableErrors = [
      'Request timeout',
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'Network error',
      'socket hang up',
      'HTTP 502 Bad Gateway',
      'HTTP 503 Service Unavailable',
      'HTTP 504 Gateway Timeout',
    ];

    const nonRetryableErrors = [
      'Invalid transaction format',
      'Insufficient balance',
      'Nonce mismatch',
      'HTTP 400 Bad Request',
      'HTTP 401 Unauthorized',
      'HTTP 403 Forbidden',
      'HTTP 404 Not Found',
      'Player not registered',
    ];

    it.each(retryableErrors)('should identify "%s" as retryable', async (errorMsg) => {
      let attempts = 0;
      mockClient = createMockSubmitClient(async () => {
        attempts++;
        if (attempts === 1) {
          return { accepted: false, error: errorMsg };
        }
        return { accepted: true };
      });
      forwarder = new EngineForwarder(mockClient, {
        maxRetries: 1,
        initialBackoffMs: 1,
      });

      const result = await forwarder.forward(new Uint8Array([1]), { sessionId: 's' });
      expect(attempts).toBe(2); // Initial + 1 retry
      expect(result.accepted).toBe(true);

      forwarder.shutdown();
    });

    it.each(nonRetryableErrors)('should not retry on "%s"', async (errorMsg) => {
      let attempts = 0;
      mockClient = createMockSubmitClient(async () => {
        attempts++;
        return { accepted: false, error: errorMsg };
      });
      forwarder = new EngineForwarder(mockClient, {
        maxRetries: 3,
        initialBackoffMs: 1,
      });

      const result = await forwarder.forward(new Uint8Array([1]), { sessionId: 's' });
      expect(attempts).toBe(1); // No retries
      expect(result.accepted).toBe(false);

      forwarder.shutdown();
    });
  });
});
