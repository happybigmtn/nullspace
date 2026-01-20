/**
 * Presence Manager Unit Tests (AC-3.6)
 *
 * Tests for the PresenceManager class functionality.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Mock WebSocket for unit testing
class MockWebSocket extends EventEmitter {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  sentMessages: string[] = [];

  get OPEN() { return MockWebSocket.OPEN; }
  get CLOSED() { return MockWebSocket.CLOSED; }

  send(data: string) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket not open');
    }
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  clearSent() {
    this.sentMessages = [];
  }
}

// Import after mock setup
import { PresenceManager } from '../../src/presence/index.js';

describe('PresenceManager', () => {
  let presenceManager: PresenceManager;

  beforeEach(() => {
    vi.useFakeTimers();
    presenceManager = new PresenceManager({
      clockSyncIntervalMs: 30000,
      presenceIntervalMs: 10000,
      enablePeriodicBroadcasts: false, // Disable for unit tests
    });
  });

  afterEach(() => {
    presenceManager.destroy();
    vi.useRealTimers();
  });

  describe('Session Management', () => {
    it('should add session and update count', () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      presenceManager.addSession(ws);

      expect(presenceManager.onlineCount).toBe(1);
    });

    it('should remove session and update count', () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      presenceManager.addSession(ws);
      expect(presenceManager.onlineCount).toBe(1);

      presenceManager.removeSession(ws);
      expect(presenceManager.onlineCount).toBe(0);
    });

    it('should track multiple sessions', () => {
      const ws1 = new MockWebSocket() as unknown as import('ws').WebSocket;
      const ws2 = new MockWebSocket() as unknown as import('ws').WebSocket;
      const ws3 = new MockWebSocket() as unknown as import('ws').WebSocket;

      presenceManager.addSession(ws1);
      presenceManager.addSession(ws2);
      presenceManager.addSession(ws3);

      expect(presenceManager.onlineCount).toBe(3);

      presenceManager.removeSession(ws2);
      expect(presenceManager.onlineCount).toBe(2);
    });

    it('should track active games', () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      presenceManager.addSession(ws);
      expect(presenceManager.activeGamesCount).toBe(0);

      presenceManager.setSessionActive(ws, true);
      expect(presenceManager.activeGamesCount).toBe(1);

      presenceManager.setSessionActive(ws, false);
      expect(presenceManager.activeGamesCount).toBe(0);
    });

    it('should handle removing non-existent session gracefully', () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      // Should not throw
      presenceManager.removeSession(ws);
      expect(presenceManager.onlineCount).toBe(0);
    });
  });

  describe('Clock Sync', () => {
    it('should generate clock sync message', () => {
      const clockSync = presenceManager.getClockSync();

      expect(clockSync.type).toBe('clock_sync');
      expect(typeof clockSync.serverTime).toBe('number');
      expect(clockSync.serverTime).toBeGreaterThan(0);
    });

    it('should increment sequence number', () => {
      const sync1 = presenceManager.getClockSync();
      const sync2 = presenceManager.getClockSync();
      const sync3 = presenceManager.getClockSync();

      expect(sync2.seq).toBeGreaterThan(sync1.seq!);
      expect(sync3.seq).toBeGreaterThan(sync2.seq!);
    });

    it('should send clock sync to session', () => {
      const mockWs = new MockWebSocket();
      const ws = mockWs as unknown as import('ws').WebSocket;

      presenceManager.sendClockSync(ws);

      expect(mockWs.sentMessages.length).toBe(1);
      const msg = JSON.parse(mockWs.sentMessages[0]);
      expect(msg.type).toBe('clock_sync');
      expect(typeof msg.serverTime).toBe('number');
    });

    it('should not send to closed WebSocket', () => {
      const mockWs = new MockWebSocket();
      mockWs.readyState = MockWebSocket.CLOSED;
      const ws = mockWs as unknown as import('ws').WebSocket;

      presenceManager.sendClockSync(ws);

      expect(mockWs.sentMessages.length).toBe(0);
    });
  });

  describe('Presence Info', () => {
    it('should generate presence message', () => {
      const presence = presenceManager.getPresenceInfo();

      expect(presence.type).toBe('presence');
      expect(typeof presence.onlineCount).toBe('number');
      expect(presence.onlineCount).toBe(0);
    });

    it('should reflect current session count', () => {
      const ws1 = new MockWebSocket() as unknown as import('ws').WebSocket;
      const ws2 = new MockWebSocket() as unknown as import('ws').WebSocket;

      presenceManager.addSession(ws1);
      presenceManager.addSession(ws2);

      const presence = presenceManager.getPresenceInfo();
      expect(presence.onlineCount).toBe(2);
    });

    it('should include active games count', () => {
      const ws1 = new MockWebSocket() as unknown as import('ws').WebSocket;
      const ws2 = new MockWebSocket() as unknown as import('ws').WebSocket;

      presenceManager.addSession(ws1);
      presenceManager.addSession(ws2);
      presenceManager.setSessionActive(ws1, true);

      const presence = presenceManager.getPresenceInfo();
      expect(presence.onlineCount).toBe(2);
      expect(presence.activeGames).toBe(1);
    });

    it('should send presence to session', () => {
      const mockWs = new MockWebSocket();
      const ws = mockWs as unknown as import('ws').WebSocket;

      presenceManager.sendPresence(ws);

      expect(mockWs.sentMessages.length).toBe(1);
      const msg = JSON.parse(mockWs.sentMessages[0]);
      expect(msg.type).toBe('presence');
      expect(msg.onlineCount).toBe(0);
    });
  });

  describe('Initial Messages on Add', () => {
    it('should send clock_sync on addSession', () => {
      const mockWs = new MockWebSocket();
      const ws = mockWs as unknown as import('ws').WebSocket;

      presenceManager.addSession(ws);

      const clockSyncMsgs = mockWs.sentMessages.filter((m) =>
        JSON.parse(m).type === 'clock_sync'
      );
      expect(clockSyncMsgs.length).toBe(1);
    });

    it('should send presence on addSession', () => {
      const mockWs = new MockWebSocket();
      const ws = mockWs as unknown as import('ws').WebSocket;

      presenceManager.addSession(ws);

      const presenceMsgs = mockWs.sentMessages.filter((m) =>
        JSON.parse(m).type === 'presence'
      );
      expect(presenceMsgs.length).toBeGreaterThanOrEqual(1);
    });

    it('should broadcast presence to all sessions on add', () => {
      const mockWs1 = new MockWebSocket();
      const mockWs2 = new MockWebSocket();
      const ws1 = mockWs1 as unknown as import('ws').WebSocket;
      const ws2 = mockWs2 as unknown as import('ws').WebSocket;

      presenceManager.addSession(ws1);
      mockWs1.clearSent();

      presenceManager.addSession(ws2);

      // ws1 should receive a presence update about the new connection
      const presenceMsgs = mockWs1.sentMessages.filter((m) =>
        JSON.parse(m).type === 'presence'
      );
      expect(presenceMsgs.length).toBeGreaterThanOrEqual(1);

      // The presence count should be 2 now
      const lastPresence = JSON.parse(presenceMsgs[presenceMsgs.length - 1]);
      expect(lastPresence.onlineCount).toBe(2);
    });
  });

  describe('Broadcast', () => {
    it('should broadcast clock_sync to all sessions', () => {
      const mockWs1 = new MockWebSocket();
      const mockWs2 = new MockWebSocket();
      const mockWs3 = new MockWebSocket();

      presenceManager.addSession(mockWs1 as unknown as import('ws').WebSocket);
      presenceManager.addSession(mockWs2 as unknown as import('ws').WebSocket);
      presenceManager.addSession(mockWs3 as unknown as import('ws').WebSocket);

      // Clear initial messages
      mockWs1.clearSent();
      mockWs2.clearSent();
      mockWs3.clearSent();

      presenceManager.broadcastClockSync();

      expect(mockWs1.sentMessages.length).toBe(1);
      expect(mockWs2.sentMessages.length).toBe(1);
      expect(mockWs3.sentMessages.length).toBe(1);

      expect(JSON.parse(mockWs1.sentMessages[0]).type).toBe('clock_sync');
    });

    it('should broadcast presence to all sessions', () => {
      const mockWs1 = new MockWebSocket();
      const mockWs2 = new MockWebSocket();

      presenceManager.addSession(mockWs1 as unknown as import('ws').WebSocket);
      presenceManager.addSession(mockWs2 as unknown as import('ws').WebSocket);

      // Clear initial messages
      mockWs1.clearSent();
      mockWs2.clearSent();

      presenceManager.broadcastPresence();

      expect(mockWs1.sentMessages.length).toBe(1);
      expect(mockWs2.sentMessages.length).toBe(1);

      const msg1 = JSON.parse(mockWs1.sentMessages[0]);
      expect(msg1.type).toBe('presence');
      expect(msg1.onlineCount).toBe(2);
    });

    it('should skip closed WebSockets in broadcast', () => {
      const mockWs1 = new MockWebSocket();
      const mockWs2 = new MockWebSocket();

      presenceManager.addSession(mockWs1 as unknown as import('ws').WebSocket);
      presenceManager.addSession(mockWs2 as unknown as import('ws').WebSocket);

      // Close ws2
      mockWs2.readyState = MockWebSocket.CLOSED;

      // Clear initial messages
      mockWs1.clearSent();
      mockWs2.clearSent();

      presenceManager.broadcastClockSync();

      expect(mockWs1.sentMessages.length).toBe(1);
      expect(mockWs2.sentMessages.length).toBe(0);
    });
  });

  describe('Periodic Broadcasts', () => {
    it('should start periodic timers', () => {
      const pm = new PresenceManager({
        clockSyncIntervalMs: 1000,
        presenceIntervalMs: 500,
        enablePeriodicBroadcasts: true,
      });

      pm.start();

      const mockWs = new MockWebSocket();
      pm.addSession(mockWs as unknown as import('ws').WebSocket);
      mockWs.clearSent();

      // Advance time for presence interval
      vi.advanceTimersByTime(500);

      const presenceMsgs = mockWs.sentMessages.filter((m) =>
        JSON.parse(m).type === 'presence'
      );
      expect(presenceMsgs.length).toBeGreaterThanOrEqual(1);

      pm.destroy();
    });

    it('should stop timers on stop()', () => {
      const pm = new PresenceManager({
        clockSyncIntervalMs: 1000,
        presenceIntervalMs: 500,
        enablePeriodicBroadcasts: true,
      });

      pm.start();
      pm.stop();

      const mockWs = new MockWebSocket();
      pm.addSession(mockWs as unknown as import('ws').WebSocket);
      mockWs.clearSent();

      // Advance time
      vi.advanceTimersByTime(5000);

      // No periodic broadcasts should have occurred
      expect(mockWs.sentMessages.length).toBe(0);

      pm.destroy();
    });
  });

  describe('Cleanup', () => {
    it('should clean up on destroy', () => {
      const ws1 = new MockWebSocket() as unknown as import('ws').WebSocket;
      const ws2 = new MockWebSocket() as unknown as import('ws').WebSocket;

      presenceManager.addSession(ws1);
      presenceManager.addSession(ws2);

      presenceManager.destroy();

      expect(presenceManager.onlineCount).toBe(0);
      expect(presenceManager.activeGamesCount).toBe(0);
    });

    it('should remove active game tracking on session remove', () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      presenceManager.addSession(ws);
      presenceManager.setSessionActive(ws, true);
      expect(presenceManager.activeGamesCount).toBe(1);

      presenceManager.removeSession(ws);
      expect(presenceManager.activeGamesCount).toBe(0);
    });
  });
});
