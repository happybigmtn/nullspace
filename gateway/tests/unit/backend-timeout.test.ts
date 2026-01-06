/**
 * Backend Timeout Tests (US-053)
 *
 * Tests for proper timeout handling when backend is slow or unresponsive.
 * Ensures nonce locks are released and players can recover.
 */
import { describe, it, expect, beforeEach, vi, afterEach, Mock } from 'vitest';
import { NonceManager } from '../../src/session/nonce.js';
import { EventEmitter } from 'events';

// Mock UpdatesClient that can simulate timeouts
class MockUpdatesClient extends EventEmitter {
  private pendingEvents: Map<string, any[]> = new Map();
  private shouldTimeout = false;
  private delayMs = 0;

  setTimeoutBehavior(timeout: boolean, delayMs = 0) {
    this.shouldTimeout = timeout;
    this.delayMs = delayMs;
  }

  async waitForStartedOrError(timeoutMs = 30000): Promise<any> {
    if (this.shouldTimeout) {
      return new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Timeout waiting for started/error event'));
        }, Math.min(timeoutMs, 100)); // Use short timeout for tests
      });
    }

    // Return immediately with success
    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }
    return { type: 'started', sessionId: 123n };
  }

  async waitForAnyEvent(eventType: string, timeoutMs = 30000): Promise<any> {
    if (this.shouldTimeout) {
      return new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Timeout waiting for ${eventType} event`));
        }, Math.min(timeoutMs, 100));
      });
    }

    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }
    return { type: eventType };
  }
}

describe('Backend Timeout Tests (US-053)', () => {
  let nonceManager: NonceManager;
  let mockUpdatesClient: MockUpdatesClient;

  beforeEach(() => {
    vi.useFakeTimers();
    nonceManager = new NonceManager({ dataDir: '.test-timeout-data' });
    mockUpdatesClient = new MockUpdatesClient();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('submission timeout behavior', () => {
    it('should not hang indefinitely on backend timeout', async () => {
      mockUpdatesClient.setTimeoutBehavior(true);

      const startTime = Date.now();

      // Simulate the waitForEvent pattern from base.ts
      const waitForEvent = async (): Promise<any> => {
        try {
          return await mockUpdatesClient.waitForStartedOrError(100); // Short timeout
        } catch (err) {
          return null; // Timeout returns null, not hang
        }
      };

      // Run with real timers for this test
      vi.useRealTimers();
      const result = await waitForEvent();
      const elapsed = Date.now() - startTime;

      expect(result).toBeNull();
      expect(elapsed).toBeLessThan(200); // Should complete within reasonable time
    });

    it('should release nonce lock on backend timeout', async () => {
      const publicKey = 'test-key-timeout';
      const lockAcquiredOrder: string[] = [];

      // First operation: will timeout
      mockUpdatesClient.setTimeoutBehavior(true);

      vi.useRealTimers();

      const operation1 = nonceManager.withLock(publicKey, async (nonce) => {
        lockAcquiredOrder.push('op1-acquired');
        try {
          // Simulate waitForEvent timeout
          await mockUpdatesClient.waitForStartedOrError(50);
        } catch {
          // Timeout expected
        }
        lockAcquiredOrder.push('op1-completed');
        return 'op1';
      });

      // Short delay to ensure op1 acquires lock first
      await new Promise((r) => setTimeout(r, 10));

      // Second operation: should acquire lock after op1 releases
      mockUpdatesClient.setTimeoutBehavior(false);

      const operation2 = nonceManager.withLock(publicKey, async (nonce) => {
        lockAcquiredOrder.push('op2-acquired');
        return 'op2';
      });

      await Promise.all([operation1, operation2]);

      expect(lockAcquiredOrder).toEqual([
        'op1-acquired',
        'op1-completed',
        'op2-acquired',
      ]);
    });

    it('should return appropriate error on timeout', async () => {
      mockUpdatesClient.setTimeoutBehavior(true);

      vi.useRealTimers();

      // Simulate the error handling pattern from base.ts
      const handleGameStart = async (): Promise<{
        success: boolean;
        error?: string;
      }> => {
        let gameEvent: any = null;
        try {
          gameEvent = await mockUpdatesClient.waitForStartedOrError(50);
        } catch {
          gameEvent = null;
        }

        if (!gameEvent) {
          // Fallback behavior - return partial success or error
          return {
            success: false,
            error: 'Backend timeout - game may or may not have started',
          };
        }

        return { success: true };
      };

      const result = await handleGameStart();

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });

    it('should allow subsequent transactions after timeout', async () => {
      const publicKey = 'test-key-subsequent';

      vi.useRealTimers();

      // First: timeout
      mockUpdatesClient.setTimeoutBehavior(true);
      await nonceManager.withLock(publicKey, async () => {
        try {
          await mockUpdatesClient.waitForStartedOrError(50);
        } catch {
          // Expected timeout
        }
        return null;
      });

      // Second: should work immediately
      mockUpdatesClient.setTimeoutBehavior(false);
      const result = await nonceManager.withLock(publicKey, async () => {
        const event = await mockUpdatesClient.waitForStartedOrError(50);
        return event;
      });

      expect(result).toEqual({ type: 'started', sessionId: 123n });
    });
  });

  describe('nonce lock timeout guarantees', () => {
    it('should release lock even if operation throws', async () => {
      const publicKey = 'test-key-throw';
      const lockReleased = vi.fn();

      vi.useRealTimers();

      try {
        await nonceManager.withLock(publicKey, async () => {
          throw new Error('Intentional failure');
        });
      } catch {
        // Expected
      }

      // Verify lock was released by successfully acquiring it again
      await nonceManager.withLock(publicKey, async () => {
        lockReleased();
        return null;
      });

      expect(lockReleased).toHaveBeenCalled();
    });

    it('should not block other players during timeout', async () => {
      const player1 = 'player-1';
      const player2 = 'player-2';
      const completionOrder: string[] = [];

      vi.useRealTimers();

      // Player 1: slow timeout
      const p1Promise = nonceManager.withLock(player1, async () => {
        await new Promise((r) => setTimeout(r, 100));
        completionOrder.push('player-1');
        return 'p1';
      });

      // Player 2: immediate (different key, should not be blocked)
      await new Promise((r) => setTimeout(r, 10)); // Slight delay
      const p2Promise = nonceManager.withLock(player2, async () => {
        completionOrder.push('player-2');
        return 'p2';
      });

      await Promise.all([p1Promise, p2Promise]);

      // Player 2 should complete before player 1 (different keys = no blocking)
      expect(completionOrder).toEqual(['player-2', 'player-1']);
    });

    it('should handle concurrent timeouts on same player', async () => {
      const publicKey = 'test-concurrent-timeout';
      const results: string[] = [];

      vi.useRealTimers();

      mockUpdatesClient.setTimeoutBehavior(true);

      // Start multiple concurrent operations that will all timeout
      const promises = [1, 2, 3].map((n) =>
        nonceManager.withLock(publicKey, async () => {
          try {
            await mockUpdatesClient.waitForStartedOrError(30);
          } catch {
            // Expected timeout
          }
          results.push(`op${n}`);
          return `result${n}`;
        })
      );

      await Promise.all(promises);

      // All operations should complete (lock released between each)
      expect(results.length).toBe(3);
    });
  });

  describe('partial completion scenarios', () => {
    it('should handle submit success but event timeout', async () => {
      // Simulate: backend accepted submission but didn't emit event
      const submitResult = { accepted: true, txHash: '0x123' };
      mockUpdatesClient.setTimeoutBehavior(true);

      vi.useRealTimers();

      let nonce = 0n;
      const result = await nonceManager.withLock('partial-test', async (n) => {
        nonce = n;
        // Simulate: submission succeeds
        // But waitForEvent times out
        try {
          await mockUpdatesClient.waitForStartedOrError(50);
          return { success: true };
        } catch {
          // Transaction was submitted but event timed out
          // Nonce was already incremented
          return {
            success: false,
            error: 'Transaction submitted but confirmation timed out',
            txHash: submitResult.txHash,
          };
        }
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
      expect(result.txHash).toBe('0x123');
    });

    it('should track nonce correctly across timeout and success', async () => {
      const publicKey = 'nonce-tracking-test';

      vi.useRealTimers();

      // Initial nonce should be 0
      expect(nonceManager.getCurrentNonce(publicKey)).toBe(0n);

      // First operation: success, increments nonce
      mockUpdatesClient.setTimeoutBehavior(false);
      await nonceManager.withLock(publicKey, async (nonce) => {
        expect(nonce).toBe(0n);
        // Simulate successful submission
        nonceManager.setCurrentNonce(publicKey, nonce + 1n);
        return null;
      });

      expect(nonceManager.getCurrentNonce(publicKey)).toBe(1n);

      // Second operation: timeout (but nonce was already consumed)
      mockUpdatesClient.setTimeoutBehavior(true);
      await nonceManager.withLock(publicKey, async (nonce) => {
        expect(nonce).toBe(1n);
        // Simulate: submission sent (nonce consumed) but event times out
        nonceManager.setCurrentNonce(publicKey, nonce + 1n);
        try {
          await mockUpdatesClient.waitForStartedOrError(50);
        } catch {
          // Timeout - nonce still consumed
        }
        return null;
      });

      // Nonce should still be incremented even though we timed out
      expect(nonceManager.getCurrentNonce(publicKey)).toBe(2n);

      // Third operation: success
      mockUpdatesClient.setTimeoutBehavior(false);
      await nonceManager.withLock(publicKey, async (nonce) => {
        expect(nonce).toBe(2n);
        nonceManager.setCurrentNonce(publicKey, nonce + 1n);
        return null;
      });

      expect(nonceManager.getCurrentNonce(publicKey)).toBe(3n);
    });
  });

  describe('event timeout configuration', () => {
    it('should respect GAME_EVENT_TIMEOUT from environment', async () => {
      // This tests the pattern used in base.ts for timeout configuration
      const getTimeout = () => {
        const raw = process.env.GATEWAY_EVENT_TIMEOUT_MS;
        const parsed = raw ? Number(raw) : NaN;
        if (Number.isFinite(parsed) && parsed >= 0) {
          return parsed;
        }
        return process.env.NODE_ENV === 'production' ? 30000 : 60000;
      };

      // Default non-production
      expect(getTimeout()).toBe(60000);

      // Custom value
      process.env.GATEWAY_EVENT_TIMEOUT_MS = '5000';
      expect(getTimeout()).toBe(5000);
      delete process.env.GATEWAY_EVENT_TIMEOUT_MS;
    });
  });
});
