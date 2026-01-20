/**
 * Presence and Clock Sync Integration Tests (AC-3.6)
 *
 * Tests that presence and clock sync messages are delivered on connect and during session.
 *
 * Run with: RUN_INTEGRATION=true pnpm -C gateway test presence-sync.test.ts
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  INTEGRATION_ENABLED,
  createConnection,
  waitForMessage,
} from '../helpers/ws.js';

vi.setConfig({ testTimeout: 60000 });

/**
 * Collect multiple messages of a given type until timeout
 */
async function collectMessages(
  ws: WebSocket,
  type: string,
  count: number,
  timeout = 15000
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve) => {
    const collected: Record<string, unknown>[] = [];
    const timer = setTimeout(() => {
      ws.off('message', handler);
      resolve(collected);
    }, timeout);

    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === type) {
          collected.push(msg);
          if (collected.length >= count) {
            clearTimeout(timer);
            ws.off('message', handler);
            resolve(collected);
          }
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.on('message', handler);
  });
}

/**
 * Wait for any message of given types
 */
async function waitForAnyMessage(
  ws: WebSocket,
  types: string[],
  timeout = 15000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`Timeout waiting for message types: ${types.join(', ')}`));
    }, timeout);

    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (types.includes(msg.type)) {
          clearTimeout(timer);
          ws.off('message', handler);
          resolve(msg);
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.on('message', handler);
  });
}

/**
 * Collect all messages for a duration
 */
async function collectAllMessages(
  ws: WebSocket,
  durationMs: number
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve) => {
    const collected: Record<string, unknown>[] = [];
    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        collected.push(msg);
      } catch {
        // Ignore parse errors
      }
    };

    ws.on('message', handler);
    setTimeout(() => {
      ws.off('message', handler);
      resolve(collected);
    }, durationMs);
  });
}

describe.skipIf(!INTEGRATION_ENABLED)('Presence and Clock Sync Integration Tests (AC-3.6)', () => {
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

  describe('Clock Sync', () => {
    it('should receive clock_sync message on connect', async () => {
      const ws = await createConnection();
      connections.push(ws);

      // Wait for clock_sync message (should arrive shortly after session_ready)
      const clockSync = await waitForMessage(ws, 'clock_sync', 10000);

      expect(clockSync.type).toBe('clock_sync');
      expect(typeof clockSync.serverTime).toBe('number');
      expect(clockSync.serverTime).toBeGreaterThan(0);
      // Server time should be recent (within last 10 seconds)
      expect(Date.now() - (clockSync.serverTime as number)).toBeLessThan(10000);
    });

    it('should include sequence number in clock_sync', async () => {
      const ws = await createConnection();
      connections.push(ws);

      const clockSync = await waitForMessage(ws, 'clock_sync', 10000);

      expect(clockSync.type).toBe('clock_sync');
      // seq is optional but should be a positive integer if present
      if (clockSync.seq !== undefined) {
        expect(typeof clockSync.seq).toBe('number');
        expect(clockSync.seq).toBeGreaterThanOrEqual(1);
      }
    });

    it('should have server time within reasonable bounds', async () => {
      const ws = await createConnection();
      connections.push(ws);

      const beforeConnect = Date.now();
      const clockSync = await waitForMessage(ws, 'clock_sync', 10000);
      const afterConnect = Date.now();

      const serverTime = clockSync.serverTime as number;
      // Server time should be between our before/after timestamps (with some tolerance)
      expect(serverTime).toBeGreaterThanOrEqual(beforeConnect - 1000);
      expect(serverTime).toBeLessThanOrEqual(afterConnect + 1000);
    });
  });

  describe('Presence', () => {
    it('should receive presence message on connect', async () => {
      const ws = await createConnection();
      connections.push(ws);

      const presence = await waitForMessage(ws, 'presence', 10000);

      expect(presence.type).toBe('presence');
      expect(typeof presence.onlineCount).toBe('number');
      expect(presence.onlineCount).toBeGreaterThanOrEqual(1); // At least this connection
    });

    it('should report at least 1 online when connected', async () => {
      const ws = await createConnection();
      connections.push(ws);

      const presence = await waitForMessage(ws, 'presence', 10000);

      expect(presence.onlineCount).toBeGreaterThanOrEqual(1);
    });

    it('should include activeGames field (optional)', async () => {
      const ws = await createConnection();
      connections.push(ws);

      const presence = await waitForMessage(ws, 'presence', 10000);

      // activeGames is optional but should be a non-negative integer if present
      if (presence.activeGames !== undefined) {
        expect(typeof presence.activeGames).toBe('number');
        expect(presence.activeGames).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Initial Messages on Connect', () => {
    it('should receive session_ready, clock_sync, and presence on connect', async () => {
      const ws = await createConnection();
      connections.push(ws);

      // Collect first few messages
      const messages = await collectAllMessages(ws, 3000);
      const types = messages.map((m) => m.type);

      expect(types).toContain('session_ready');
      expect(types).toContain('clock_sync');
      expect(types).toContain('presence');
    });

    it('should send session_ready before sync messages', async () => {
      const ws = await createConnection();
      connections.push(ws);

      // Collect first few messages
      const messages = await collectAllMessages(ws, 3000);

      // Find indices
      const sessionReadyIdx = messages.findIndex((m) => m.type === 'session_ready');
      const clockSyncIdx = messages.findIndex((m) => m.type === 'clock_sync');
      const presenceIdx = messages.findIndex((m) => m.type === 'presence');

      // session_ready should come first (or very close to first)
      expect(sessionReadyIdx).toBe(0);
      // clock_sync and presence should follow
      expect(clockSyncIdx).toBeGreaterThan(sessionReadyIdx);
      expect(presenceIdx).toBeGreaterThan(sessionReadyIdx);
    });
  });

  describe('Multiple Connections', () => {
    it('should update presence count when new client connects', async () => {
      // Connect first client
      const ws1 = await createConnection();
      connections.push(ws1);

      // Wait for initial presence
      const presence1 = await waitForMessage(ws1, 'presence', 10000);
      const initialCount = presence1.onlineCount as number;

      // Connect second client
      const ws2 = await createConnection();
      connections.push(ws2);

      // Wait for presence update on first client (broadcast when second connects)
      // Give it a bit more time as broadcast happens after session creation
      const presence2 = await waitForMessage(ws1, 'presence', 15000);

      expect(presence2.onlineCount).toBeGreaterThanOrEqual(initialCount);
    });

    it('should each client receive their own clock_sync', async () => {
      const ws1 = await createConnection();
      const ws2 = await createConnection();
      connections.push(ws1, ws2);

      const [clockSync1, clockSync2] = await Promise.all([
        waitForMessage(ws1, 'clock_sync', 10000),
        waitForMessage(ws2, 'clock_sync', 10000),
      ]);

      expect(clockSync1.type).toBe('clock_sync');
      expect(clockSync2.type).toBe('clock_sync');
      // Both should have valid server times
      expect(typeof clockSync1.serverTime).toBe('number');
      expect(typeof clockSync2.serverTime).toBe('number');
    });
  });

  describe('Message Structure Validation', () => {
    it('clock_sync should have correct schema', async () => {
      const ws = await createConnection();
      connections.push(ws);

      const clockSync = await waitForMessage(ws, 'clock_sync', 10000);

      // Required fields
      expect(clockSync).toHaveProperty('type', 'clock_sync');
      expect(clockSync).toHaveProperty('serverTime');
      expect(typeof clockSync.serverTime).toBe('number');
      expect(Number.isInteger(clockSync.serverTime)).toBe(true);
      expect(clockSync.serverTime).toBeGreaterThan(0);

      // Optional fields validation
      if ('seq' in clockSync) {
        expect(typeof clockSync.seq).toBe('number');
        expect(Number.isInteger(clockSync.seq)).toBe(true);
      }
    });

    it('presence should have correct schema', async () => {
      const ws = await createConnection();
      connections.push(ws);

      const presence = await waitForMessage(ws, 'presence', 10000);

      // Required fields
      expect(presence).toHaveProperty('type', 'presence');
      expect(presence).toHaveProperty('onlineCount');
      expect(typeof presence.onlineCount).toBe('number');
      expect(Number.isInteger(presence.onlineCount)).toBe(true);
      expect(presence.onlineCount).toBeGreaterThanOrEqual(0);

      // Optional fields validation
      if ('activeGames' in presence) {
        expect(typeof presence.activeGames).toBe('number');
        expect(Number.isInteger(presence.activeGames)).toBe(true);
        expect(presence.activeGames).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
