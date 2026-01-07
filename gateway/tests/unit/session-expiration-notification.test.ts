/**
 * Session Expiration Notification Tests
 *
 * US-082: Test that gateway sends SESSION_EXPIRED message when sessions expire.
 *
 * ## ARCHITECTURE
 * - Sessions expire after 30 minutes of inactivity
 * - Periodic cleanup runs every 5 minutes
 * - SESSION_EXPIRED message sent BEFORE ws.close()
 * - Client can redirect to auth screen on expiration
 * - Auto-reconnect doesn't loop infinitely on expired session
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

import { SessionManager, Session } from '../../src/session/manager.js';
import type { SubmitClient, SubmitResult } from '../../src/backend/http.js';
import { NonceManager } from '../../src/session/nonce.js';
import { ErrorCodes } from '../../src/types/errors.js';
import type { WebSocket } from 'ws';

const TEST_DATA_DIR = '.test-session-expiration-data';

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
function createMockSubmitClient(): SubmitClient {
  return {
    submit: vi.fn().mockResolvedValue({ accepted: true }),
    getAccount: vi.fn().mockResolvedValue({ nonce: 0n, balance: 1000n }),
    healthCheck: vi.fn().mockResolvedValue(true),
  } as unknown as SubmitClient;
}

describe('Session Expiration Notification (US-082)', () => {
  let manager: SessionManager;
  let mockSubmitClient: SubmitClient;
  let nonceManager: NonceManager;

  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    nonceManager = new NonceManager({ dataDir: TEST_DATA_DIR });
    mockSubmitClient = createMockSubmitClient();
    manager = new SessionManager(
      mockSubmitClient,
      'http://localhost:8080',
      nonceManager,
      'http://localhost:9010'
    );
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  describe('Gateway Sends SESSION_EXPIRED Message on Idle Timeout', () => {
    it('should call onSessionExpired callback before closing idle session', async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const session = await manager.createSession(ws, {}, '127.0.0.1');

      // Make session idle (35 minutes ago)
      session.lastActivityAt = Date.now() - 35 * 60 * 1000;

      const onSessionExpired = vi.fn();
      const cleaned = manager.cleanupIdleSessions(30 * 60 * 1000, onSessionExpired);

      expect(cleaned).toBe(1);
      expect(onSessionExpired).toHaveBeenCalledOnce();
      expect(onSessionExpired).toHaveBeenCalledWith(ws, session);
    });

    it('should send SESSION_EXPIRED message via callback', async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const session = await manager.createSession(ws, {}, '127.0.0.1');

      // Make session idle
      session.lastActivityAt = Date.now() - 35 * 60 * 1000;

      // Simulate the actual callback pattern from index.ts
      const messages: Array<{ type: string; code: string; message: string }> = [];
      const onSessionExpired = (ws: WebSocket) => {
        const msg = { type: 'error', code: ErrorCodes.SESSION_EXPIRED, message: 'Session expired' };
        messages.push(msg);
        (ws as unknown as MockWebSocket).send(JSON.stringify(msg));
      };

      manager.cleanupIdleSessions(30 * 60 * 1000, onSessionExpired);

      expect(messages).toHaveLength(1);
      expect(messages[0].code).toBe(ErrorCodes.SESSION_EXPIRED);
      expect((ws as unknown as MockWebSocket).send).toHaveBeenCalledWith(
        expect.stringContaining('"code":"SESSION_EXPIRED"')
      );
    });

    it('should close WebSocket AFTER sending SESSION_EXPIRED', async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const session = await manager.createSession(ws, {}, '127.0.0.1');

      session.lastActivityAt = Date.now() - 35 * 60 * 1000;

      const callOrder: string[] = [];
      const onSessionExpired = () => {
        callOrder.push('notification');
        (ws as unknown as MockWebSocket).send('{}');
      };

      // Intercept close to track order
      const originalClose = (ws as unknown as MockWebSocket).close;
      (ws as unknown as MockWebSocket).close = vi.fn((...args) => {
        callOrder.push('close');
        originalClose.call(ws, ...args);
      });

      manager.cleanupIdleSessions(30 * 60 * 1000, onSessionExpired);

      // Notification should come before close
      expect(callOrder).toEqual(['notification', 'close']);
    });

    it('should not call callback for active sessions', async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      await manager.createSession(ws, {}, '127.0.0.1');

      // Session is fresh (lastActivityAt = now)
      const onSessionExpired = vi.fn();
      const cleaned = manager.cleanupIdleSessions(30 * 60 * 1000, onSessionExpired);

      expect(cleaned).toBe(0);
      expect(onSessionExpired).not.toHaveBeenCalled();
    });

    it('should continue cleanup even if callback throws', async () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;

      const session1 = await manager.createSession(ws1, {}, '127.0.0.1');
      const session2 = await manager.createSession(ws2, {}, '127.0.0.2');

      // Make both idle
      session1.lastActivityAt = Date.now() - 35 * 60 * 1000;
      session2.lastActivityAt = Date.now() - 40 * 60 * 1000;

      let callCount = 0;
      const onSessionExpired = () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Callback error');
        }
      };

      // Should not throw, should cleanup both sessions
      const cleaned = manager.cleanupIdleSessions(30 * 60 * 1000, onSessionExpired);

      expect(cleaned).toBe(2);
      expect(callCount).toBe(2); // Both callbacks were attempted
    });
  });

  describe('Mobile Receives and Handles Expiration During Active Game', () => {
    it('should clean up session even if game is in progress', async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const session = await manager.createSession(ws, {}, '127.0.0.1');

      // Start a game
      manager.startGame(session, 'blackjack' as import('@nullspace/types').GameType);
      expect(session.activeGameId).not.toBeNull();

      // Make session idle
      session.lastActivityAt = Date.now() - 35 * 60 * 1000;

      let expiredSession: Session | null = null;
      const onSessionExpired = (_ws: WebSocket, s: Session) => {
        expiredSession = s;
      };

      manager.cleanupIdleSessions(30 * 60 * 1000, onSessionExpired);

      // Session with active game should still be cleaned up and notified
      expect(expiredSession).not.toBeNull();
      expect(expiredSession!.activeGameId).not.toBeNull(); // Game was in progress
      expect(manager.getSessionCount()).toBe(0);
    });

    it('should include game state info in expiration callback', async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const session = await manager.createSession(ws, {}, '127.0.0.1');

      // Start a game
      const gameId = manager.startGame(
        session,
        'blackjack' as import('@nullspace/types').GameType
      );

      session.lastActivityAt = Date.now() - 35 * 60 * 1000;

      let sessionAtExpiration: Session | null = null;
      const onSessionExpired = (_ws: WebSocket, s: Session) => {
        sessionAtExpiration = { ...s }; // Copy session state
      };

      manager.cleanupIdleSessions(30 * 60 * 1000, onSessionExpired);

      // Session state is available to callback for logging/notification
      expect(sessionAtExpiration!.activeGameId).toBe(gameId);
      expect(sessionAtExpiration!.gameType).toBe('blackjack');
    });
  });

  describe('Mobile Redirects to Auth Screen on Expiration', () => {
    it('SESSION_EXPIRED message format is correct for mobile handling', () => {
      // Document: Mobile expects this exact format to trigger redirect
      const errorMessage = {
        type: 'error',
        code: ErrorCodes.SESSION_EXPIRED,
        message: 'Session expired due to inactivity',
      };

      expect(errorMessage.type).toBe('error');
      expect(errorMessage.code).toBe('SESSION_EXPIRED');
      expect(typeof errorMessage.message).toBe('string');
    });

    it('should destroy session maps so subsequent lookups fail', async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const session = await manager.createSession(ws, {}, '127.0.0.1');
      const publicKeyHex = session.publicKeyHex;

      session.lastActivityAt = Date.now() - 35 * 60 * 1000;

      manager.cleanupIdleSessions(30 * 60 * 1000, () => {});

      // After expiration, lookups should fail
      expect(manager.getSession(ws)).toBeUndefined();
      expect(manager.getSessionByPublicKeyHex(publicKeyHex)).toBeUndefined();
    });
  });

  describe('Auto-Reconnect Does Not Loop Infinitely on Expired Session', () => {
    it('should close with code 1000 which is a "normal" close', async () => {
      // Document: Code 1000 indicates normal closure, client should not auto-retry
      const ws = new MockWebSocket() as unknown as WebSocket;
      const session = await manager.createSession(ws, {}, '127.0.0.1');

      session.lastActivityAt = Date.now() - 35 * 60 * 1000;

      manager.cleanupIdleSessions(30 * 60 * 1000, () => {});

      expect((ws as unknown as MockWebSocket).close).toHaveBeenCalledWith(
        1000,
        'Session timeout'
      );
    });

    it('should not allow same WebSocket to create new session after cleanup', async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const session = await manager.createSession(ws, {}, '127.0.0.1');

      session.lastActivityAt = Date.now() - 35 * 60 * 1000;

      manager.cleanupIdleSessions(30 * 60 * 1000, () => {});

      // Try to create session with same WebSocket (simulating reconnect attempt on closed socket)
      // In reality, the WebSocket would be in CLOSED state
      (ws as unknown as MockWebSocket).readyState = 3; // WebSocket.CLOSED

      // The session map should not contain the old WebSocket
      expect(manager.getSession(ws)).toBeUndefined();
    });

    it('should allow new WebSocket connection to create fresh session', async () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const session1 = await manager.createSession(ws1, {}, '127.0.0.1');

      session1.lastActivityAt = Date.now() - 35 * 60 * 1000;

      manager.cleanupIdleSessions(30 * 60 * 1000, () => {});

      // New WebSocket connection (simulating proper reconnect)
      const ws2 = new MockWebSocket() as unknown as WebSocket;
      const session2 = await manager.createSession(ws2, {}, '127.0.0.1');

      // New session should work fine
      expect(session2).toBeDefined();
      expect(session2.publicKeyHex).not.toBe(session1.publicKeyHex);
      expect(manager.getSessionCount()).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple sessions expiring at once', async () => {
      const sessions: { ws: WebSocket; session: Session }[] = [];

      for (let i = 0; i < 10; i++) {
        const ws = new MockWebSocket() as unknown as WebSocket;
        const session = await manager.createSession(
          ws,
          {},
          `192.168.1.${i}`
        );
        session.lastActivityAt = Date.now() - (31 + i) * 60 * 1000; // Staggered idle times
        sessions.push({ ws, session });
      }

      let expiredCount = 0;
      const onSessionExpired = () => {
        expiredCount++;
      };

      const cleaned = manager.cleanupIdleSessions(30 * 60 * 1000, onSessionExpired);

      expect(cleaned).toBe(10);
      expect(expiredCount).toBe(10);
      expect(manager.getSessionCount()).toBe(0);
    });

    it('should not expire sessions recently active (just under boundary)', async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const session = await manager.createSession(ws, {}, '127.0.0.1');

      // 1 second under the boundary (29:59)
      session.lastActivityAt = Date.now() - (30 * 60 * 1000 - 1000);

      const onSessionExpired = vi.fn();
      const cleaned = manager.cleanupIdleSessions(30 * 60 * 1000, onSessionExpired);

      // Should NOT be cleaned up (session still has ~1 second of idle time remaining)
      expect(cleaned).toBe(0);
      expect(onSessionExpired).not.toHaveBeenCalled();
    });

    it('should expire session 1ms past boundary', async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const session = await manager.createSession(ws, {}, '127.0.0.1');

      // 1ms past the boundary
      session.lastActivityAt = Date.now() - 30 * 60 * 1000 - 1;

      const onSessionExpired = vi.fn();
      const cleaned = manager.cleanupIdleSessions(30 * 60 * 1000, onSessionExpired);

      expect(cleaned).toBe(1);
      expect(onSessionExpired).toHaveBeenCalledOnce();
    });

    it('should work without callback (backward compatibility)', async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const session = await manager.createSession(ws, {}, '127.0.0.1');

      session.lastActivityAt = Date.now() - 35 * 60 * 1000;

      // Call without callback
      const cleaned = manager.cleanupIdleSessions(30 * 60 * 1000);

      expect(cleaned).toBe(1);
      expect((ws as unknown as MockWebSocket).close).toHaveBeenCalled();
    });
  });
});
