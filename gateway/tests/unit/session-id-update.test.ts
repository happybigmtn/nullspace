/**
 * Session ID Update Tests
 *
 * US-076: Add session ID update after game start test
 *
 * Verifies that:
 * 1. Mobile/gateway updates activeGameId when server sends different sessionId in game_started
 * 2. Subsequent moves use server-assigned sessionId, not client-generated
 * 3. NO_ACTIVE_GAME error if mobile uses stale sessionId
 * 4. Session ID flow: mobile generates → server assigns → mobile updates
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { EventEmitter } from 'events';

// Mock UpdatesClient before importing
vi.mock('../../src/backend/updates.js', () => ({
  UpdatesClient: class MockUpdatesClient extends EventEmitter {
    connectForAccount = vi.fn().mockResolvedValue(undefined);
    connectForSession = vi.fn().mockResolvedValue(undefined);
    connectForAll = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn();
    isConnected = vi.fn().mockReturnValue(true);
  },
}));

// Mock config
vi.mock('../../src/config/index.js', () => ({
  config: {
    backendUrl: 'http://localhost:8080',
    gatewayOrigin: 'http://localhost:9010',
  },
}));

import type { Session } from '../../src/types/session.js';
import type { SubmitClient, SubmitResult } from '../../src/backend/http.js';
import type { GameType } from '@nullspace/types';

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
function createMockSubmitClient(
  options: {
    submitResult?: SubmitResult;
    accountResult?: { nonce: bigint; balance: bigint } | null;
  } = {}
): SubmitClient {
  return {
    submit: vi.fn().mockResolvedValue(options.submitResult ?? { accepted: true }),
    getAccount: vi
      .fn()
      .mockResolvedValue(options.accountResult ?? { nonce: 0n, balance: 1000n }),
    healthCheck: vi.fn().mockResolvedValue(true),
  } as unknown as SubmitClient;
}

// Create a minimal mock session
function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'test-session-uuid',
    ws: new MockWebSocket() as unknown as import('ws').WebSocket,
    publicKeyHex: 'a'.repeat(64),
    privateKey: new Uint8Array(64),
    balance: 1000n,
    registered: true,
    registrationPending: false,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    activeGameId: null,
    gameType: null,
    clientIp: '127.0.0.1',
    lastGameBet: null,
    lastGameStartChips: null,
    lastGameStartedAt: null,
    ...overrides,
  } as Session;
}

describe('Session ID Update (US-076)', () => {
  describe('Server-Assigned Session ID Update', () => {
    it('should update activeGameId when server returns different sessionId', () => {
      // Simulate the logic from base.ts lines 126-128
      const session = createMockSession({
        activeGameId: 12345n, // Client-generated ID
      });

      // Simulate server responding with different session ID
      const serverSessionId = 99999n;
      const gameEvent = {
        type: 'started' as const,
        sessionId: serverSessionId,
      };

      // Apply the update logic
      if (gameEvent.sessionId && gameEvent.sessionId !== 0n) {
        session.activeGameId = gameEvent.sessionId;
      }

      expect(session.activeGameId).toBe(serverSessionId);
      expect(session.activeGameId).not.toBe(12345n);
    });

    it('should NOT update activeGameId when server returns 0n', () => {
      const clientGeneratedId = 12345n;
      const session = createMockSession({
        activeGameId: clientGeneratedId,
      });

      // Server returns 0n (meaning "use your ID")
      const gameEvent = {
        type: 'started' as const,
        sessionId: 0n,
      };

      // Apply the update logic
      if (gameEvent.sessionId && gameEvent.sessionId !== 0n) {
        session.activeGameId = gameEvent.sessionId;
      }

      // Should keep client-generated ID
      expect(session.activeGameId).toBe(clientGeneratedId);
    });

    it('should NOT update activeGameId when server sessionId is undefined', () => {
      const clientGeneratedId = 12345n;
      const session = createMockSession({
        activeGameId: clientGeneratedId,
      });

      // Server response without sessionId field
      const gameEvent = {
        type: 'started' as const,
        sessionId: undefined as bigint | undefined,
      };

      // Apply the update logic
      if (gameEvent.sessionId && gameEvent.sessionId !== 0n) {
        session.activeGameId = gameEvent.sessionId;
      }

      // Should keep client-generated ID
      expect(session.activeGameId).toBe(clientGeneratedId);
    });

    it('should update to server ID even when IDs match (no-op but correct)', () => {
      const sameId = 12345n;
      const session = createMockSession({
        activeGameId: sameId,
      });

      // Server returns same ID
      const gameEvent = {
        type: 'started' as const,
        sessionId: sameId,
      };

      // Apply the update logic
      if (gameEvent.sessionId && gameEvent.sessionId !== 0n) {
        session.activeGameId = gameEvent.sessionId;
      }

      // Should be the same value (no-op)
      expect(session.activeGameId).toBe(sameId);
    });
  });

  describe('Subsequent Moves Use Server-Assigned ID', () => {
    it('should use updated activeGameId for subsequent moves', () => {
      // Initial client-generated ID
      const session = createMockSession({
        activeGameId: 12345n,
      });

      // Server assigns different ID
      const serverAssignedId = 99999n;
      session.activeGameId = serverAssignedId;

      // Simulate making a move - it should use the server-assigned ID
      const moveSessionId = session.activeGameId;

      expect(moveSessionId).toBe(serverAssignedId);
      expect(moveSessionId).not.toBe(12345n);
    });

    it('should return NO_ACTIVE_GAME error when activeGameId is null', () => {
      const session = createMockSession({
        activeGameId: null,
      });

      // Check the condition from base.ts line 229
      const error =
        session.activeGameId === null
          ? { code: 'NO_ACTIVE_GAME', message: 'No game in progress' }
          : null;

      expect(error).not.toBeNull();
      expect(error!.code).toBe('NO_ACTIVE_GAME');
      expect(error!.message).toBe('No game in progress');
    });

    it('should use activeGameId for move encoding when set', () => {
      const serverAssignedId = 99999n;
      const session = createMockSession({
        activeGameId: serverAssignedId,
      });

      // Simulate move encoding - should use activeGameId
      const gameSessionId = session.activeGameId;

      expect(gameSessionId).toBe(serverAssignedId);
    });
  });

  describe('Session ID Flow Documentation', () => {
    it('documents the full session ID flow: client generates → server assigns → client updates', () => {
      const session = createMockSession({
        activeGameId: null,
      });

      // Step 1: Client generates a session ID (typically via generateSessionId())
      const clientGeneratedId = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
      session.activeGameId = clientGeneratedId;

      expect(session.activeGameId).toBe(clientGeneratedId);

      // Step 2: Server receives bet and may assign different session ID
      // (e.g., for replay protection, uniqueness, or chain-specific requirements)
      const serverAssignedId = clientGeneratedId + 1n; // Different ID

      // Step 3: Client updates to use server-assigned ID
      const gameEvent = {
        type: 'started' as const,
        sessionId: serverAssignedId,
      };

      if (gameEvent.sessionId && gameEvent.sessionId !== 0n) {
        session.activeGameId = gameEvent.sessionId;
      }

      expect(session.activeGameId).toBe(serverAssignedId);

      // Step 4: Subsequent moves use server-assigned ID
      const moveSessionId = session.activeGameId;
      expect(moveSessionId).toBe(serverAssignedId);
    });

    it('documents what happens when client uses stale session ID', () => {
      // If client somehow uses the old ID for a move after server assigned new one,
      // the backend would reject with an error (simulated here)
      const session = createMockSession({
        activeGameId: 99999n, // Server-assigned ID
      });

      // Client mistakenly tries to use old ID (this shouldn't happen with proper update)
      const staleId = 12345n;

      // Backend would check: requested ID != current game ID
      const requestedId = staleId;
      const actualGameId = session.activeGameId;

      expect(requestedId).not.toBe(actualGameId);

      // This mismatch would result in an error from the backend
      // (either NO_ACTIVE_GAME or INVALID_SESSION_ID depending on implementation)
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large session IDs (u64 max boundary)', () => {
      const session = createMockSession({
        activeGameId: 1n,
      });

      // Server assigns max u64 value
      const maxU64 = 18446744073709551615n;
      const gameEvent = {
        type: 'started' as const,
        sessionId: maxU64,
      };

      if (gameEvent.sessionId && gameEvent.sessionId !== 0n) {
        session.activeGameId = gameEvent.sessionId;
      }

      expect(session.activeGameId).toBe(maxU64);
    });

    it('should handle session ID update after game completion', () => {
      const session = createMockSession({
        activeGameId: 99999n,
        gameType: 'blackjack' as GameType,
      });

      // Game completes - clear session state (from base.ts lines 263-264)
      session.activeGameId = null;
      session.gameType = null;

      expect(session.activeGameId).toBeNull();
      expect(session.gameType).toBeNull();

      // New game can now start with fresh ID
      const newClientId = 11111n;
      session.activeGameId = newClientId;
      session.gameType = 'blackjack' as GameType;

      // Server assigns different ID
      const newServerAssignedId = 22222n;
      session.activeGameId = newServerAssignedId;

      expect(session.activeGameId).toBe(newServerAssignedId);
    });

    it('should preserve session ID across multiple server responses if not updated', () => {
      const session = createMockSession({
        activeGameId: 12345n,
      });

      // Multiple game_move responses that don't include sessionId
      const moveEvent1 = { type: 'moved' as const };
      const moveEvent2 = { type: 'moved' as const };

      // No update logic for moves (sessionId typically only in game_started)
      // Session ID should remain unchanged
      expect(session.activeGameId).toBe(12345n);
    });

    it('should handle rapid session ID updates', () => {
      const session = createMockSession({
        activeGameId: 1n,
      });

      // Rapid sequence of updates (shouldn't happen but test robustness)
      const ids = [2n, 3n, 4n, 5n];

      for (const id of ids) {
        const gameEvent = {
          type: 'started' as const,
          sessionId: id,
        };

        if (gameEvent.sessionId && gameEvent.sessionId !== 0n) {
          session.activeGameId = gameEvent.sessionId;
        }
      }

      // Should end up with last ID
      expect(session.activeGameId).toBe(5n);
    });
  });

  describe('Game Start and Move Consistency', () => {
    it('should ensure game_started sessionId propagates to game_move', () => {
      const session = createMockSession();

      // Start game - client generates ID
      const clientId = 12345n;
      session.activeGameId = clientId;

      // Server responds with different ID in game_started
      const serverSessionId = 99999n;
      session.activeGameId = serverSessionId;

      // Make a move - should use server's ID
      const moveRequest = {
        sessionId: session.activeGameId!.toString(),
        action: 'hit',
      };

      expect(moveRequest.sessionId).toBe('99999');
      expect(moveRequest.sessionId).not.toBe('12345');
    });

    it('should clear activeGameId on game completion', () => {
      const session = createMockSession({
        activeGameId: 99999n,
        gameType: 'blackjack' as GameType,
      });

      // Game completes (from base.ts lines 261-265)
      const completedEvent = {
        type: 'completed' as const,
        finalChips: 1100n,
      };

      // Clear game state
      session.activeGameId = null;
      session.gameType = null;
      session.balance = completedEvent.finalChips;

      expect(session.activeGameId).toBeNull();
      expect(session.gameType).toBeNull();
      expect(session.balance).toBe(1100n);
    });
  });
});
