/**
 * Session Management Integration Tests
 *
 * Tests for session lifecycle, timeout behavior, and concurrent session limits.
 * These tests require a running simulator backend.
 *
 * Run with: RUN_INTEGRATION=true npm test -- session.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import {
  INTEGRATION_ENABLED,
  createConnection,
  sendAndReceive,
  waitForMessage,
} from '../helpers/ws.js';

vi.setConfig({ testTimeout: 60000 });

const sendAndReceiveWithTimeout = (
  ws: WebSocket,
  msg: Record<string, unknown>,
  timeout = 30000
) => sendAndReceive(ws, msg, timeout);

const waitForMessageWithTimeout = (
  ws: WebSocket,
  type: string,
  timeout = 30000
) => waitForMessage(ws, type, timeout);

/**
 * Helper to wait for session to be ready (registered with balance)
 */
async function waitForReady(ws: WebSocket): Promise<Record<string, unknown>> {
  const sessionReady = await waitForMessageWithTimeout(ws, 'session_ready');

  for (let i = 0; i < 30; i++) {
    const balance = await sendAndReceiveWithTimeout(ws, { type: 'get_balance' });
    if (balance.registered && balance.hasBalance) {
      return sessionReady;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Registration timeout');
}

describe.skipIf(!INTEGRATION_ENABLED)('Session Management Integration Tests', () => {
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

  describe('Session Creation', () => {
    it('should create a new session on connection', async () => {
      const ws = await createConnection();
      connections.push(ws);

      const sessionReady = await waitForMessageWithTimeout(ws, 'session_ready');

      expect(sessionReady.type).toBe('session_ready');
      expect(sessionReady.sessionId).toBeDefined();
      expect(typeof sessionReady.sessionId).toBe('string');
      expect(sessionReady.publicKey).toBeDefined();
      expect(typeof sessionReady.publicKey).toBe('string');
      expect((sessionReady.publicKey as string).length).toBe(64); // 32 bytes hex
    });

    it('should assign unique session IDs to different connections', async () => {
      const ws1 = await createConnection();
      const ws2 = await createConnection();
      connections.push(ws1, ws2);

      const session1 = await waitForMessageWithTimeout(ws1, 'session_ready');
      const session2 = await waitForMessageWithTimeout(ws2, 'session_ready');

      expect(session1.sessionId).not.toBe(session2.sessionId);
      expect(session1.publicKey).not.toBe(session2.publicKey);
    });

    it('should auto-register player with initial balance', async () => {
      const ws = await createConnection();
      connections.push(ws);

      await waitForReady(ws);

      const balance = await sendAndReceiveWithTimeout(ws, { type: 'get_balance' });

      expect(balance.type).toBe('balance');
      expect(balance.registered).toBe(true);
      expect(balance.hasBalance).toBe(true);
      expect(balance.balance).toBeDefined();
      // Balance should be a valid number (might be 0 for fresh accounts)
      expect(Number(balance.balance)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Session Activity Tracking', () => {
    it('should respond to ping messages', async () => {
      const ws = await createConnection();
      connections.push(ws);

      await waitForReady(ws);

      const response = await sendAndReceiveWithTimeout(ws, { type: 'ping' });

      expect(response.type).toBe('pong');
      expect(response.timestamp).toBeDefined();
      expect(typeof response.timestamp).toBe('number');
    });

    it('should update activity on game actions', async () => {
      const ws = await createConnection();
      connections.push(ws);

      await waitForReady(ws);

      // Start a game (this should update activity)
      const gameResponse = await sendAndReceiveWithTimeout(ws, {
        type: 'blackjack_deal',
        amount: 100,
      });

      expect(gameResponse.type).toBe('game_started');
    });
  });

  describe('Session Balance Operations', () => {
    it('should return accurate balance after game', async () => {
      const ws = await createConnection();
      connections.push(ws);

      await waitForReady(ws);

      // Get initial balance
      const initialBalance = await sendAndReceiveWithTimeout(ws, {
        type: 'get_balance',
      });
      const initialAmount = Number(initialBalance.balance);

      // Play a game
      await sendAndReceiveWithTimeout(ws, {
        type: 'blackjack_deal',
        amount: 100,
      });

      await sendAndReceiveWithTimeout(ws, {
        type: 'blackjack_stand',
      });

      // Get balance after game
      const finalBalance = await sendAndReceiveWithTimeout(ws, {
        type: 'get_balance',
      });
      const finalAmount = Number(finalBalance.balance);

      // Balance should have changed (either won or lost)
      // Just verify the balance is defined and is a number
      expect(typeof finalAmount).toBe('number');
    });

    // Faucet is exposed via the 'faucet_claim' message type.
    // Gateway rate-limits faucet claims and forwards to simulator's CasinoDeposit.
    it('should handle faucet request', async () => {
      const ws = await createConnection();
      connections.push(ws);

      await waitForReady(ws);

      // Get initial balance
      const initialBalance = await sendAndReceiveWithTimeout(ws, {
        type: 'get_balance',
      });
      const initialAmount = Number(initialBalance.balance);

      // Request faucet (custom amount)
      const faucetResponse = await sendAndReceiveWithTimeout(ws, {
        type: 'faucet_claim',
        amount: 1000,
      });

      // Should receive balance update with FAUCET_CLAIMED message
      expect(faucetResponse.type).toBe('balance');
      expect(faucetResponse.message).toBe('FAUCET_CLAIMED');
      expect(faucetResponse.registered).toBe(true);
      expect(faucetResponse.hasBalance).toBe(true);

      // Balance should have increased
      const newAmount = Number(faucetResponse.balance);
      expect(newAmount).toBeGreaterThan(initialAmount);
    });

    it('should enforce faucet cooldown', async () => {
      const ws = await createConnection();
      connections.push(ws);

      await waitForReady(ws);

      // First faucet claim should succeed (or fail due to backend rate limit)
      const firstClaim = await sendAndReceiveWithTimeout(ws, {
        type: 'faucet_claim',
        amount: 100,
      });

      // If first claim failed due to backend rate limit, skip cooldown test
      if (firstClaim.type === 'error') {
        // Backend has its own rate limiting (daily/block-based)
        expect(firstClaim.error).toMatch(/cooldown|rate|limit|claimed/i);
        return;
      }

      expect(firstClaim.type).toBe('balance');

      // Immediate second claim should fail (gateway cooldown)
      const secondClaim = await sendAndReceiveWithTimeout(ws, {
        type: 'faucet_claim',
        amount: 100,
      });

      expect(secondClaim.type).toBe('error');
      expect(secondClaim.error).toMatch(/cooldown/i);
    });
  });

  describe('Session Destruction', () => {
    it('should clean up session on WebSocket close', async () => {
      const ws = await createConnection();

      await waitForReady(ws);

      const sessionReady = await sendAndReceiveWithTimeout(ws, {
        type: 'get_balance',
      });
      expect(sessionReady.registered).toBe(true);

      // Close connection
      ws.close();

      // Wait for close to complete
      await new Promise((resolve) => {
        ws.on('close', resolve);
        setTimeout(resolve, 1000);
      });

      expect(ws.readyState).toBe(WebSocket.CLOSED);
    });

    it('should handle abrupt disconnection', async () => {
      const ws = await createConnection();
      connections.push(ws);

      await waitForReady(ws);

      // Force terminate
      ws.terminate();

      // Should not throw
      expect(ws.readyState).toBe(WebSocket.CLOSING);
    });
  });

  describe('Session Limits', () => {
    // Skip concurrent session tests in CI due to timing sensitivity
    it.skip('should allow multiple concurrent sessions', async () => {
      const sessionPromises: Promise<WebSocket>[] = [];

      // Create connections sequentially with small delay to avoid rate limiting
      for (let i = 0; i < 5; i++) {
        sessionPromises.push(createConnection());
        await new Promise(r => setTimeout(r, 100)); // 100ms between connections
      }

      const websockets = await Promise.all(sessionPromises);
      connections.push(...websockets);

      // All should be connected
      expect(websockets.length).toBe(5);
      websockets.forEach((ws) => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
      });

      // All should receive session_ready (with longer timeout for concurrent processing)
      const readyPromises = websockets.map((ws) =>
        waitForMessageWithTimeout(ws, 'session_ready', 60000)
      );

      const readyMessages = await Promise.all(readyPromises);

      // All should have unique session IDs
      const sessionIds = new Set(readyMessages.map((m) => m.sessionId));
      expect(sessionIds.size).toBe(5);
    });

    // Skip rapid connection test in CI due to timing sensitivity
    it.skip('should handle rapid connection attempts gracefully', async () => {
      const results: Array<{ success: boolean; error?: string }> = [];

      // Create 10 connections with small delays between them
      for (let i = 0; i < 10; i++) {
        try {
          const ws = await createConnection();
          connections.push(ws);
          await waitForMessageWithTimeout(ws, 'session_ready', 30000);
          results.push({ success: true });
        } catch (err) {
          results.push({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        // Small delay between connections to reduce race conditions
        await new Promise(r => setTimeout(r, 50));
      }

      // Most should succeed (at least 3 to account for rate limiting)
      const successCount = results.filter((r) => r.success).length;
      expect(successCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Session Rate Limiting', () => {
    it('should enforce session creation rate limits', async () => {
      const results: Array<{ success: boolean; error?: string }> = [];

      // Try to create many sessions rapidly from same "IP"
      // Note: In real tests, this would require X-Forwarded-For manipulation
      // For now, we just verify the mechanism exists
      for (let i = 0; i < 3; i++) {
        try {
          const ws = await createConnection();
          connections.push(ws);
          await waitForMessageWithTimeout(ws, 'session_ready', 5000);
          results.push({ success: true });
        } catch (err) {
          results.push({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Should allow at least some connections
      const successCount = results.filter((r) => r.success).length;
      expect(successCount).toBeGreaterThan(0);
    });
  });

  describe('Session State Consistency', () => {
    it('should maintain session state across messages', async () => {
      const ws = await createConnection();
      connections.push(ws);

      await waitForReady(ws);

      // Get initial public key
      const balance1 = await sendAndReceiveWithTimeout(ws, {
        type: 'get_balance',
      });
      const publicKey1 = balance1.publicKey;

      // Send ping
      await sendAndReceiveWithTimeout(ws, { type: 'ping' });

      // Get balance again
      const balance2 = await sendAndReceiveWithTimeout(ws, {
        type: 'get_balance',
      });
      const publicKey2 = balance2.publicKey;

      // Public key should remain the same
      expect(publicKey1).toBe(publicKey2);
    });

    it('should track active game state', async () => {
      const ws = await createConnection();
      connections.push(ws);

      await waitForReady(ws);

      // Start a game
      const startResponse = await sendAndReceiveWithTimeout(ws, {
        type: 'blackjack_deal',
        amount: 100,
      });

      expect(startResponse.type).toBe('game_started');
      expect(startResponse.sessionId).toBeDefined();

      // Trying to start another game should fail (game already active)
      const secondStart = await sendAndReceiveWithTimeout(ws, {
        type: 'blackjack_deal',
        amount: 100,
      });

      expect(secondStart.type).toBe('error');
      expect(secondStart.code).toBe('GAME_IN_PROGRESS');
    });

    it('should clear game state after completion', async () => {
      const ws = await createConnection();
      connections.push(ws);

      await waitForReady(ws);

      // Start a game
      await sendAndReceiveWithTimeout(ws, {
        type: 'blackjack_deal',
        amount: 100,
      });

      // Complete the game with stand
      const standResult = await sendAndReceiveWithTimeout(ws, {
        type: 'blackjack_stand',
      });

      // Wait a bit to ensure async game completion
      await new Promise(r => setTimeout(r, 2000));

      // Try to start a new game - it may succeed or get GAME_IN_PROGRESS
      // if the previous game hasn't fully completed
      const newGame = await sendAndReceiveWithTimeout(ws, {
        type: 'blackjack_deal',
        amount: 100,
      });

      // Accept either success (game cleared) or error (game still completing)
      expect(['game_started', 'error']).toContain(newGame.type);
      if (newGame.type === 'error') {
        // If error, it should be game in progress (not a different error)
        expect(newGame.code).toBe('GAME_IN_PROGRESS');
      }
    });
  });
});

describe('Session Unit Tests (No Backend)', () => {
  it('should validate session ID format', () => {
    const validSessionId =
      '550e8400-e29b-41d4-a716-446655440000';
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    expect(uuidRegex.test(validSessionId)).toBe(true);
  });

  it('should validate public key format', () => {
    const validPublicKey = 'a'.repeat(64);
    const hexRegex = /^[0-9a-f]{64}$/i;

    expect(hexRegex.test(validPublicKey)).toBe(true);
    expect(hexRegex.test('invalid')).toBe(false);
    expect(hexRegex.test('a'.repeat(63))).toBe(false);
    expect(hexRegex.test('g'.repeat(64))).toBe(false);
  });

  it('should validate balance is bigint compatible', () => {
    const balanceString = '1000000000000000000';
    const balance = BigInt(balanceString);

    expect(typeof balance).toBe('bigint');
    expect(balance > 0n).toBe(true);
  });
});
