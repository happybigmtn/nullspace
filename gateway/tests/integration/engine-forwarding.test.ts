/**
 * Integration tests for Engine Forwarding (AC-3.5)
 *
 * Tests duplicate bet intent handling with idempotency keys.
 * These tests run against a mock backend to verify gateway behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { createConnection, sendAndReceive, waitForMessage, GATEWAY_URL } from '../helpers/ws.js';

vi.setConfig({ testTimeout: 15000 });

/**
 * Mock backend server that tracks submissions
 */
class MockBackend {
  private server: Server;
  private submissions: Map<string, { count: number; data: Buffer[] }>;
  private port: number;
  private rejectNext: boolean = false;
  private shouldTimeout: boolean = false;
  private responseDelay: number = 0;

  constructor(port: number) {
    this.port = port;
    this.submissions = new Map();
    this.server = createServer(this.handleRequest.bind(this));
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const path = req.url?.split('?')[0];

    if (path === '/healthz' && req.method === 'GET') {
      res.statusCode = 200;
      res.end('ok');
      return;
    }

    if (path?.startsWith('/account/') && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ nonce: 0, balance: '10000' }));
      return;
    }

    if (path === '/submit' && req.method === 'POST') {
      if (this.shouldTimeout) {
        // Don't respond - simulate timeout
        return;
      }

      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', async () => {
        if (this.responseDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, this.responseDelay));
        }

        const body = Buffer.concat(chunks);
        const requestId = req.headers['x-request-id'] as string | undefined;

        // Track the submission
        const key = requestId ?? 'no-request-id';
        const existing = this.submissions.get(key) ?? { count: 0, data: [] };
        existing.count++;
        existing.data.push(body);
        this.submissions.set(key, existing);

        if (this.rejectNext) {
          this.rejectNext = false;
          res.statusCode = 400;
          res.end('Simulated rejection');
          return;
        }

        res.statusCode = 200;
        res.end('ok');
      });
      return;
    }

    res.statusCode = 404;
    res.end();
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, '127.0.0.1', () => {
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  getSubmissionCount(requestId?: string): number {
    const key = requestId ?? 'no-request-id';
    return this.submissions.get(key)?.count ?? 0;
  }

  getTotalSubmissions(): number {
    let total = 0;
    for (const entry of this.submissions.values()) {
      total += entry.count;
    }
    return total;
  }

  clearSubmissions(): void {
    this.submissions.clear();
  }

  setRejectNext(): void {
    this.rejectNext = true;
  }

  setTimeoutNext(): void {
    this.shouldTimeout = true;
  }

  clearTimeout(): void {
    this.shouldTimeout = false;
  }

  setResponseDelay(ms: number): void {
    this.responseDelay = ms;
  }
}

// These tests require the gateway to be running against our mock backend
// Skip if gateway isn't available
const INTEGRATION_ENABLED = process.env.INTEGRATION_TEST !== '0';

describe.skipIf(!INTEGRATION_ENABLED)('Engine Forwarding Integration (AC-3.5)', () => {
  /**
   * Test idempotency key behavior at the gateway level
   *
   * Note: These tests verify the EngineForwarder unit behavior.
   * Full integration would require starting the gateway with custom backend URL.
   */
  describe('Idempotency Key Handling', () => {
    it('should generate unique idempotency keys for each request', async () => {
      // This test verifies the EngineForwarder generates unique keys
      const { EngineForwarder } = await import('../../src/backend/engine-forwarder.js');
      const { SubmitClient } = await import('../../src/backend/http.js');

      const mockClient = {
        submit: vi.fn().mockResolvedValue({ accepted: true }),
        healthCheck: vi.fn().mockResolvedValue(true),
        getAccount: vi.fn().mockResolvedValue({ nonce: 0n, balance: 1000n }),
      } as unknown as InstanceType<typeof SubmitClient>;

      const forwarder = new EngineForwarder(mockClient);

      const submission = new Uint8Array([1, 2, 3, 4]);
      const sessionId = 'test-session';

      const result1 = await forwarder.forward(submission, { sessionId });
      const result2 = await forwarder.forward(submission, { sessionId });

      // Each request should get a unique idempotency key
      expect(result1.idempotencyKey).not.toBe(result2.idempotencyKey);

      // Both should be submitted (different keys = different requests)
      expect(mockClient.submit).toHaveBeenCalledTimes(2);

      forwarder.shutdown();
    });

    it('should deduplicate requests with same client-provided idempotency key', async () => {
      const { EngineForwarder } = await import('../../src/backend/engine-forwarder.js');
      const { SubmitClient } = await import('../../src/backend/http.js');

      const mockClient = {
        submit: vi.fn().mockResolvedValue({ accepted: true }),
        healthCheck: vi.fn().mockResolvedValue(true),
        getAccount: vi.fn().mockResolvedValue({ nonce: 0n, balance: 1000n }),
      } as unknown as InstanceType<typeof SubmitClient>;

      const forwarder = new EngineForwarder(mockClient);

      const submission = new Uint8Array([1, 2, 3, 4]);
      const sessionId = 'test-session';
      const clientKey = 'client-provided-key-123';

      // First request
      const result1 = await forwarder.forward(submission, {
        sessionId,
        idempotencyKey: clientKey,
      });

      // Second request with same key and same payload
      const result2 = await forwarder.forward(submission, {
        sessionId,
        idempotencyKey: clientKey,
      });

      expect(result1.accepted).toBe(true);
      expect(result1.deduplicated).toBe(false);

      expect(result2.accepted).toBe(true);
      expect(result2.deduplicated).toBe(true);
      expect(result2.idempotencyKey).toBe(clientKey);

      // Should only submit once
      expect(mockClient.submit).toHaveBeenCalledTimes(1);

      forwarder.shutdown();
    });

    it('should reject idempotency key reuse with different payload', async () => {
      const { EngineForwarder } = await import('../../src/backend/engine-forwarder.js');
      const { SubmitClient } = await import('../../src/backend/http.js');

      const mockClient = {
        submit: vi.fn().mockResolvedValue({ accepted: true }),
        healthCheck: vi.fn().mockResolvedValue(true),
        getAccount: vi.fn().mockResolvedValue({ nonce: 0n, balance: 1000n }),
      } as unknown as InstanceType<typeof SubmitClient>;

      const forwarder = new EngineForwarder(mockClient);

      const submission1 = new Uint8Array([1, 2, 3, 4]);
      const submission2 = new Uint8Array([5, 6, 7, 8]);
      const sessionId = 'test-session';
      const clientKey = 'reused-key-456';

      // First request
      const result1 = await forwarder.forward(submission1, {
        sessionId,
        idempotencyKey: clientKey,
      });

      // Second request with same key but DIFFERENT payload
      const result2 = await forwarder.forward(submission2, {
        sessionId,
        idempotencyKey: clientKey,
      });

      expect(result1.accepted).toBe(true);

      expect(result2.accepted).toBe(false);
      expect(result2.error).toContain('Idempotency key already used');

      // Second submission should not reach the backend
      expect(mockClient.submit).toHaveBeenCalledTimes(1);

      forwarder.shutdown();
    });
  });

  describe('Retry Behavior', () => {
    it('should retry transient failures with exponential backoff', async () => {
      const { EngineForwarder } = await import('../../src/backend/engine-forwarder.js');
      const { SubmitClient } = await import('../../src/backend/http.js');

      let attempts = 0;
      const mockClient = {
        submit: vi.fn().mockImplementation(async () => {
          attempts++;
          if (attempts < 3) {
            return { accepted: false, error: 'ECONNRESET' };
          }
          return { accepted: true };
        }),
        healthCheck: vi.fn().mockResolvedValue(true),
        getAccount: vi.fn().mockResolvedValue({ nonce: 0n, balance: 1000n }),
      } as unknown as InstanceType<typeof SubmitClient>;

      const forwarder = new EngineForwarder(mockClient, {
        maxRetries: 3,
        initialBackoffMs: 10,
        maxBackoffMs: 50,
      });

      const result = await forwarder.forward(new Uint8Array([1, 2, 3]), {
        sessionId: 'test-session',
      });

      expect(result.accepted).toBe(true);
      expect(result.retryCount).toBe(2);
      expect(attempts).toBe(3);

      forwarder.shutdown();
    });

    it('should not retry client errors (4xx)', async () => {
      const { EngineForwarder } = await import('../../src/backend/engine-forwarder.js');
      const { SubmitClient } = await import('../../src/backend/http.js');

      let attempts = 0;
      const mockClient = {
        submit: vi.fn().mockImplementation(async () => {
          attempts++;
          return { accepted: false, error: 'Invalid bet amount' };
        }),
        healthCheck: vi.fn().mockResolvedValue(true),
        getAccount: vi.fn().mockResolvedValue({ nonce: 0n, balance: 1000n }),
      } as unknown as InstanceType<typeof SubmitClient>;

      const forwarder = new EngineForwarder(mockClient, {
        maxRetries: 3,
        initialBackoffMs: 10,
      });

      const result = await forwarder.forward(new Uint8Array([1, 2, 3]), {
        sessionId: 'test-session',
      });

      expect(result.accepted).toBe(false);
      expect(result.retryCount).toBe(0);
      expect(attempts).toBe(1); // No retries

      forwarder.shutdown();
    });
  });

  describe('Session Cleanup', () => {
    it('should clean up idempotency entries when session ends', async () => {
      const { EngineForwarder } = await import('../../src/backend/engine-forwarder.js');
      const { SubmitClient } = await import('../../src/backend/http.js');

      const mockClient = {
        submit: vi.fn().mockResolvedValue({ accepted: true }),
        healthCheck: vi.fn().mockResolvedValue(true),
        getAccount: vi.fn().mockResolvedValue({ nonce: 0n, balance: 1000n }),
      } as unknown as InstanceType<typeof SubmitClient>;

      const forwarder = new EngineForwarder(mockClient);

      const sessionId = 'session-to-cleanup';

      // Create some entries
      await forwarder.forward(new Uint8Array([1]), { sessionId, idempotencyKey: 'key-1' });
      await forwarder.forward(new Uint8Array([2]), { sessionId, idempotencyKey: 'key-2' });

      expect(forwarder.hasIdempotencyKey(sessionId, 'key-1')).toBe(true);
      expect(forwarder.hasIdempotencyKey(sessionId, 'key-2')).toBe(true);

      // Simulate session disconnect
      const cleared = forwarder.clearSession(sessionId);
      expect(cleared).toBe(2);

      expect(forwarder.hasIdempotencyKey(sessionId, 'key-1')).toBe(false);
      expect(forwarder.hasIdempotencyKey(sessionId, 'key-2')).toBe(false);

      forwarder.shutdown();
    });
  });

  describe('Concurrent Request Handling', () => {
    it('should handle concurrent requests with different idempotency keys', async () => {
      const { EngineForwarder } = await import('../../src/backend/engine-forwarder.js');
      const { SubmitClient } = await import('../../src/backend/http.js');

      let submitCount = 0;
      const mockClient = {
        submit: vi.fn().mockImplementation(async () => {
          submitCount++;
          // Simulate some processing time
          await new Promise(resolve => setTimeout(resolve, 10));
          return { accepted: true };
        }),
        healthCheck: vi.fn().mockResolvedValue(true),
        getAccount: vi.fn().mockResolvedValue({ nonce: 0n, balance: 1000n }),
      } as unknown as InstanceType<typeof SubmitClient>;

      const forwarder = new EngineForwarder(mockClient);

      const sessionId = 'concurrent-session';

      // Send multiple concurrent requests
      const promises = [
        forwarder.forward(new Uint8Array([1]), { sessionId, idempotencyKey: 'concurrent-1' }),
        forwarder.forward(new Uint8Array([2]), { sessionId, idempotencyKey: 'concurrent-2' }),
        forwarder.forward(new Uint8Array([3]), { sessionId, idempotencyKey: 'concurrent-3' }),
      ];

      const results = await Promise.all(promises);

      // All should succeed
      expect(results.every(r => r.accepted)).toBe(true);

      // All should be unique (not deduplicated)
      expect(results.every(r => !r.deduplicated)).toBe(true);

      // All should have different idempotency keys
      const keys = results.map(r => r.idempotencyKey);
      expect(new Set(keys).size).toBe(3);

      // All should have been submitted
      expect(submitCount).toBe(3);

      forwarder.shutdown();
    });
  });
});
