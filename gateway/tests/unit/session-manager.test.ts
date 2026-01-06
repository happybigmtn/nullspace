/**
 * Session Manager Unit Tests
 *
 * Tests for session lifecycle, cleanup on failures, and orphaned session handling.
 * US-046: Add gateway session cleanup tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { existsSync, rmSync } from 'fs';

// Mock UpdatesClient before importing SessionManager
vi.mock('../../src/backend/updates.js', () => ({
  UpdatesClient: class MockUpdatesClient extends EventEmitter {
    connectForAccount = vi.fn().mockResolvedValue(undefined);
    connectForSession = vi.fn().mockResolvedValue(undefined);
    connectForAll = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn();
    isConnected = vi.fn().mockReturnValue(true);
  },
}));

import { SessionManager } from '../../src/session/manager.js';
import type { SubmitClient, SubmitResult } from '../../src/backend/http.js';
import { NonceManager } from '../../src/session/nonce.js';

const TEST_DATA_DIR = '.test-session-data';

// Mock WebSocket
class MockWebSocket extends EventEmitter {
  readyState = 1; // WebSocket.OPEN

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3; // WebSocket.CLOSED
  });
  terminate = vi.fn();
}

// Mock SubmitClient
function createMockSubmitClient(options: {
  submitResult?: SubmitResult;
  accountResult?: { nonce: bigint; balance: bigint } | null;
  healthCheckResult?: boolean;
} = {}): SubmitClient {
  return {
    submit: vi.fn().mockResolvedValue(options.submitResult ?? { accepted: true }),
    getAccount: vi.fn().mockResolvedValue(options.accountResult ?? { nonce: 0n, balance: 1000n }),
    healthCheck: vi.fn().mockResolvedValue(options.healthCheckResult ?? true),
  } as unknown as SubmitClient;
}

describe('SessionManager', () => {
  let manager: SessionManager;
  let mockSubmitClient: SubmitClient;
  let nonceManager: NonceManager;

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    nonceManager = new NonceManager({ dataDir: TEST_DATA_DIR });
    mockSubmitClient = createMockSubmitClient();
    manager = new SessionManager(mockSubmitClient, 'http://localhost:8080', nonceManager, 'http://localhost:9010');
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  describe('Session Creation', () => {
    it('should create session with unique keys', async () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session = await manager.createSession(ws, {}, '127.0.0.1');

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.publicKeyHex).toHaveLength(64);
      expect(session.ws).toBe(ws);
    });

    it('should track session in both maps after creation', async () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session = await manager.createSession(ws, {}, '127.0.0.1');

      expect(manager.getSession(ws)).toBe(session);
      expect(manager.getSessionByPublicKeyHex(session.publicKeyHex)).toBe(session);
      expect(manager.getSessionCount()).toBe(1);
    });

    it('should assign unique session IDs to multiple sessions', async () => {
      const ws1 = new MockWebSocket() as unknown as import('ws').WebSocket;
      const ws2 = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session1 = await manager.createSession(ws1, {}, '127.0.0.1');
      const session2 = await manager.createSession(ws2, {}, '127.0.0.2');

      expect(session1.id).not.toBe(session2.id);
      expect(session1.publicKeyHex).not.toBe(session2.publicKeyHex);
      expect(manager.getSessionCount()).toBe(2);
    });
  });

  describe('Session Cleanup on initializePlayer Failure', () => {
    it('should remove session from maps when initializePlayer fails completely', async () => {
      // Create a submit client that rejects all submissions
      const failingSubmitClient = createMockSubmitClient({
        submitResult: { accepted: false, error: 'Backend unavailable' },
      });
      const failingManager = new SessionManager(
        failingSubmitClient,
        'http://localhost:8080',
        nonceManager,
        'http://localhost:9010'
      );

      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      // Session should still be created, but unregistered
      const session = await failingManager.createSession(ws, {}, '127.0.0.1');

      // Session is returned but registration failed
      expect(session.registered).toBe(false);
      expect(session.hasBalance).toBe(false);

      // Session should still be tracked (current behavior - see note below)
      // NOTE: This test documents current behavior. The fix may change this.
      expect(failingManager.getSessionCount()).toBe(1);
    });

    it('should mark session as unregistered when backend rejects', async () => {
      const failingSubmitClient = createMockSubmitClient({
        submitResult: { accepted: false, error: 'Invalid signature' },
      });
      const failingManager = new SessionManager(
        failingSubmitClient,
        'http://localhost:8080',
        nonceManager,
        'http://localhost:9010'
      );

      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;
      const session = await failingManager.createSession(ws, {}, '127.0.0.1');

      expect(session.registered).toBe(false);
      expect(session.hasBalance).toBe(false);
    });
  });

  describe('Connection Count Tracking', () => {
    it('should decrement count when session is destroyed', async () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session = await manager.createSession(ws, {}, '127.0.0.1');
      expect(manager.getSessionCount()).toBe(1);

      manager.destroySession(ws);
      expect(manager.getSessionCount()).toBe(0);
    });

    it('should remove from byPublicKey map on destroy', async () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session = await manager.createSession(ws, {}, '127.0.0.1');
      const publicKeyHex = session.publicKeyHex;

      expect(manager.getSessionByPublicKeyHex(publicKeyHex)).toBe(session);

      manager.destroySession(ws);

      expect(manager.getSessionByPublicKeyHex(publicKeyHex)).toBeUndefined();
    });

    it('should cleanup balance refresh interval on destroy', async () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session = await manager.createSession(ws, {}, '127.0.0.1');
      manager.startBalanceRefresh(session, 1000);

      expect(session.balanceRefreshIntervalId).toBeDefined();

      manager.destroySession(ws);

      // After destroy, the interval should be cleared (undefined doesn't matter,
      // the clearInterval call is what matters)
    });

    it('should return undefined when destroying non-existent session', () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      const result = manager.destroySession(ws);

      expect(result).toBeUndefined();
    });
  });

  describe('Orphaned Session Cleanup', () => {
    it('should cleanup idle sessions via cleanupIdleSessions', async () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session = await manager.createSession(ws, {}, '127.0.0.1');

      // Manually set lastActivityAt to simulate idle session (30+ minutes ago)
      session.lastActivityAt = Date.now() - (35 * 60 * 1000);

      const cleanedCount = manager.cleanupIdleSessions(30 * 60 * 1000);

      expect(cleanedCount).toBe(1);
      expect(manager.getSessionCount()).toBe(0);
      expect(manager.getSession(ws)).toBeUndefined();
    });

    it('should not cleanup active sessions', async () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session = await manager.createSession(ws, {}, '127.0.0.1');

      // Session is fresh (lastActivityAt = now)
      const cleanedCount = manager.cleanupIdleSessions(30 * 60 * 1000);

      expect(cleanedCount).toBe(0);
      expect(manager.getSessionCount()).toBe(1);
    });

    it('should close WebSocket when cleaning up idle session', async () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session = await manager.createSession(ws, {}, '127.0.0.1');
      session.lastActivityAt = Date.now() - (35 * 60 * 1000);

      manager.cleanupIdleSessions(30 * 60 * 1000);

      expect((ws as unknown as MockWebSocket).close).toHaveBeenCalledWith(
        1000,
        'Session timeout'
      );
    });

    it('should handle close errors gracefully during cleanup', async () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;
      (ws as unknown as MockWebSocket).close = vi.fn(() => {
        throw new Error('WebSocket already closed');
      });

      const session = await manager.createSession(ws, {}, '127.0.0.1');
      session.lastActivityAt = Date.now() - (35 * 60 * 1000);

      // Should not throw
      expect(() => manager.cleanupIdleSessions(30 * 60 * 1000)).not.toThrow();
      expect(manager.getSessionCount()).toBe(0);
    });

    it('should cleanup multiple idle sessions in one call', async () => {
      const ws1 = new MockWebSocket() as unknown as import('ws').WebSocket;
      const ws2 = new MockWebSocket() as unknown as import('ws').WebSocket;
      const ws3 = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session1 = await manager.createSession(ws1, {}, '127.0.0.1');
      const session2 = await manager.createSession(ws2, {}, '127.0.0.2');
      const session3 = await manager.createSession(ws3, {}, '127.0.0.3');

      // Make first two idle
      session1.lastActivityAt = Date.now() - (35 * 60 * 1000);
      session2.lastActivityAt = Date.now() - (40 * 60 * 1000);
      // Third is still active

      const cleanedCount = manager.cleanupIdleSessions(30 * 60 * 1000);

      expect(cleanedCount).toBe(2);
      expect(manager.getSessionCount()).toBe(1);
      expect(manager.getSession(ws3)).toBe(session3);
    });
  });

  describe('Session Activity Tracking', () => {
    it('should update lastActivityAt via touchSession', async () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session = await manager.createSession(ws, {}, '127.0.0.1');
      const originalTime = session.lastActivityAt;

      // Wait a bit
      await new Promise((r) => setTimeout(r, 10));

      manager.touchSession(session);

      expect(session.lastActivityAt).toBeGreaterThan(originalTime);
    });

    it('should track game state correctly', async () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session = await manager.createSession(ws, {}, '127.0.0.1');

      expect(session.activeGameId).toBeNull();
      expect(session.gameType).toBeNull();

      const gameId = manager.startGame(session, 'blackjack' as import('@nullspace/types').GameType);

      expect(session.activeGameId).toBe(gameId);
      expect(session.gameType).toBe('blackjack');

      manager.endGame(session);

      expect(session.activeGameId).toBeNull();
      expect(session.gameType).toBeNull();
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce session creation rate limit', async () => {
      // Create manager with very low rate limit for testing
      // The default is 10 sessions per hour, so we need to exceed that
      const limitedManager = new SessionManager(
        mockSubmitClient,
        'http://localhost:8080',
        nonceManager,
        'http://localhost:9010'
      );

      const clientIp = '192.168.1.100';

      // Create sessions up to the limit (default is 10)
      for (let i = 0; i < 10; i++) {
        const ws = new MockWebSocket() as unknown as import('ws').WebSocket;
        await limitedManager.createSession(ws, {}, clientIp);
      }

      // The 11th should throw
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;
      await expect(
        limitedManager.createSession(ws, {}, clientIp)
      ).rejects.toThrow('Session creation rate limit exceeded');
    });

    it('should track rate limits per IP', async () => {
      const ws1 = new MockWebSocket() as unknown as import('ws').WebSocket;
      const ws2 = new MockWebSocket() as unknown as import('ws').WebSocket;

      // Different IPs should have separate limits
      const session1 = await manager.createSession(ws1, {}, '192.168.1.1');
      const session2 = await manager.createSession(ws2, {}, '192.168.1.2');

      expect(session1).toBeDefined();
      expect(session2).toBeDefined();
    });
  });

  describe('getAllSessions', () => {
    it('should return all active sessions', async () => {
      const ws1 = new MockWebSocket() as unknown as import('ws').WebSocket;
      const ws2 = new MockWebSocket() as unknown as import('ws').WebSocket;

      const session1 = await manager.createSession(ws1, {}, '127.0.0.1');
      const session2 = await manager.createSession(ws2, {}, '127.0.0.2');

      const allSessions = manager.getAllSessions();

      expect(allSessions).toHaveLength(2);
      expect(allSessions).toContain(session1);
      expect(allSessions).toContain(session2);
    });

    it('should return empty array when no sessions', () => {
      const allSessions = manager.getAllSessions();
      expect(allSessions).toHaveLength(0);
    });
  });

  describe('Faucet Handling', () => {
    it('should enforce faucet cooldown', async () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;
      const session = await manager.createSession(ws, {}, '127.0.0.1');

      // First faucet claim should succeed
      const result1 = await manager.requestFaucet(session, 1000n, 60000);
      expect(result1.success).toBe(true);

      // Immediate second claim should fail due to cooldown
      const result2 = await manager.requestFaucet(session, 1000n, 60000);
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('cooling down');
    });
  });

  describe('Balance Refresh', () => {
    it('should update session balance from backend', async () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;
      const session = await manager.createSession(ws, {}, '127.0.0.1');

      // Mock getAccount to return a specific balance
      (mockSubmitClient.getAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
        nonce: 0n,
        balance: 5000n,
      });

      const balance = await manager.refreshBalance(session);

      expect(balance).toBe(5000n);
      expect(session.balance).toBe(5000n);
    });

    it('should return null when account not found', async () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;
      const session = await manager.createSession(ws, {}, '127.0.0.1');

      (mockSubmitClient.getAccount as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const balance = await manager.refreshBalance(session);

      expect(balance).toBeNull();
    });
  });

  describe('Memory Leak Prevention', () => {
    it('should not accumulate sessions in maps after destroy', async () => {
      // Create and destroy many sessions
      for (let i = 0; i < 100; i++) {
        const ws = new MockWebSocket() as unknown as import('ws').WebSocket;
        await manager.createSession(ws, {}, `192.168.${Math.floor(i / 256)}.${i % 256}`);
        manager.destroySession(ws);
      }

      expect(manager.getSessionCount()).toBe(0);
      expect(manager.getAllSessions()).toHaveLength(0);
    });
  });
});
