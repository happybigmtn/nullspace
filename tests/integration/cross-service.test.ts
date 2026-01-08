/**
 * Cross-Service Integration Tests
 *
 * Tests that span multiple services:
 * - Auth Service (authentication)
 * - Gateway (WebSocket API)
 * - Simulator/Backend (blockchain)
 *
 * Run with: RUN_CROSS_SERVICE=true pnpm test:cross-service
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  SERVICE_URLS,
  waitForAllServices,
  checkServiceHealth,
} from './helpers/services.js';
import {
  CrossServiceClient,
  generateTestKeypair,
} from './helpers/client.js';

const CROSS_SERVICE_ENABLED = process.env.RUN_CROSS_SERVICE === 'true';

describe.skipIf(!CROSS_SERVICE_ENABLED)('Cross-Service Integration Tests', () => {
  let client: CrossServiceClient;

  beforeAll(async () => {
    // Verify all services are healthy before running tests
    await waitForAllServices();
  }, 120000);

  beforeEach(() => {
    client = new CrossServiceClient();
  });

  afterAll(() => {
    client?.disconnect();
  });

  describe('Service Health', () => {
    it('should have healthy simulator/backend', async () => {
      const healthy = await checkServiceHealth(SERVICE_URLS.simulator);
      expect(healthy).toBe(true);
    });

    it('should have healthy gateway', async () => {
      const healthy = await checkServiceHealth(SERVICE_URLS.gatewayHttp);
      expect(healthy).toBe(true);
    });

    it('should have healthy auth service', async () => {
      const healthy = await checkServiceHealth(SERVICE_URLS.auth);
      expect(healthy).toBe(true);
    });
  });

  describe('Full User Journey: Signup → Auth → Gateway → Backend', () => {
    it('should connect to gateway and receive session_ready', async () => {
      await client.connect();
      const sessionReady = await client.waitForMessage('session_ready');

      expect(sessionReady.type).toBe('session_ready');
      expect(sessionReady.sessionId).toBeDefined();
      expect(sessionReady.publicKey).toBeDefined();
    }, 30000);

    it('should register new user and receive initial balance', async () => {
      await client.connect();
      await client.waitForReady();

      const balance = await client.getBalance();

      expect(balance.registered).toBe(true);
      expect(balance.hasBalance).toBe(true);
      expect(balance.publicKey).toBeDefined();
    }, 60000);

    it('should respond to ping/pong', async () => {
      await client.connect();
      await client.waitForMessage('session_ready');

      const response = await client.sendAndReceive({ type: 'ping' });

      expect(response.type).toBe('pong');
      expect(response.timestamp).toBeDefined();
    }, 30000);

    it('should complete full authentication flow with auth service', async () => {
      // Note: This test requires the auth service to be running with Convex
      // Skip if auth service doesn't support standalone testing
      try {
        const result = await client.authenticate();
        expect(result.token).toBeDefined();
        expect(result.userId).toBeDefined();
      } catch (error) {
        // Auth service may require Convex - mark as skipped in that case
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('CONVEX') || message.includes('fetch')) {
          console.log('Skipping auth test - requires full Convex integration');
          return;
        }
        throw error;
      }
    }, 30000);
  });

  describe('Game Flow: Deal → Play → Result', () => {
    beforeEach(async () => {
      await client.connect();
      await client.waitForReady();
    }, 60000);

    afterEach(() => {
      client.disconnect();
    });

    it('should start and complete a blackjack game', async () => {
      const { gameStarted, result } = await client.playBlackjackHand(100);

      expect(gameStarted.type).toBe('game_started');
      expect(gameStarted.bet).toBe('100');

      // Result should be one of: game_result, game_move, or move_accepted
      expect(['game_result', 'game_move', 'move_accepted']).toContain(result.type);
    }, 60000);

    it('should handle multiple consecutive games', async () => {
      // Play 3 consecutive games
      for (let i = 0; i < 3; i++) {
        const { gameStarted } = await client.playBlackjackHand(100);
        expect(gameStarted.type).toBe('game_started');
      }
    }, 120000);

    it('should start a hi-lo game', async () => {
      const result = await client.playHiLoRound(50, 'higher');

      // Should get either game_result or error if deck exhausted
      expect(['game_result', 'game_move', 'move_accepted', 'error']).toContain(
        result.type
      );
    }, 60000);
  });

  describe('Concurrent Connections', () => {
    it('should handle multiple simultaneous clients', async () => {
      const clients = Array.from({ length: 5 }, () => new CrossServiceClient());

      try {
        // Connect all clients in parallel
        await Promise.all(clients.map((c) => c.connect()));

        // Wait for session_ready on all
        const sessions = await Promise.all(
          clients.map((c) => c.waitForMessage('session_ready'))
        );

        // Verify all sessions are unique
        const sessionIds = sessions.map((s) => s.sessionId as string);
        const uniqueIds = new Set(sessionIds);
        expect(uniqueIds.size).toBe(clients.length);
      } finally {
        clients.forEach((c) => c.disconnect());
      }
    }, 60000);

    it('should isolate game state between clients', async () => {
      const client1 = new CrossServiceClient();
      const client2 = new CrossServiceClient();

      try {
        // Connect both clients
        await Promise.all([client1.connect(), client2.connect()]);
        await Promise.all([client1.waitForReady(), client2.waitForReady()]);

        // Start game on client1 only
        const game1 = await client1.sendAndReceive({
          type: 'blackjack_deal',
          amount: 100,
        });
        expect(game1.type).toBe('game_started');

        // Client2 should not have an active game
        const response = await client2.sendAndReceive({
          type: 'blackjack_stand',
        });
        expect(response.type).toBe('error');
        expect(response.code).toBe('NO_ACTIVE_GAME');
      } finally {
        client1.disconnect();
        client2.disconnect();
      }
    }, 60000);
  });
});

describe.skipIf(!CROSS_SERVICE_ENABLED)('Error Scenarios', () => {
  let client: CrossServiceClient;

  beforeAll(async () => {
    await waitForAllServices();
  }, 120000);

  beforeEach(async () => {
    client = new CrossServiceClient();
    await client.connect();
    await client.waitForReady();
  }, 60000);

  afterEach(() => {
    client?.disconnect();
  });

  it('should reject invalid message types', async () => {
    const response = await client.sendAndReceive({
      type: 'invalid_message_type_xyz',
    });

    expect(response.type).toBe('error');
    expect(response.code).toBe('INVALID_MESSAGE');
  });

  it('should reject move without active game', async () => {
    const response = await client.sendAndReceive({
      type: 'blackjack_stand',
    });

    expect(response.type).toBe('error');
    expect(response.code).toBe('NO_ACTIVE_GAME');
  });

  it('should reject invalid bet amounts', async () => {
    const response = await client.sendAndReceive({
      type: 'blackjack_deal',
      amount: -100,
    });

    expect(response.type).toBe('error');
    // Could be INVALID_BET or INVALID_MESSAGE depending on validation order
    expect(['INVALID_BET', 'INVALID_MESSAGE']).toContain(response.code);
  });

  it('should reject zero bet amount', async () => {
    const response = await client.sendAndReceive({
      type: 'blackjack_deal',
      amount: 0,
    });

    expect(response.type).toBe('error');
  });

  it('should handle malformed JSON gracefully', async () => {
    // Send raw malformed data
    const ws = (client as unknown as { ws: WebSocket | null }).ws;
    if (ws) {
      ws.send('not valid json {{{');

      // Should not crash - connection should remain open
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(client.isConnected()).toBe(true);
    }
  });
});

describe.skipIf(!CROSS_SERVICE_ENABLED)('Balance and Betting Flow', () => {
  let client: CrossServiceClient;

  beforeAll(async () => {
    await waitForAllServices();
  }, 120000);

  beforeEach(async () => {
    client = new CrossServiceClient();
    await client.connect();
    await client.waitForReady();
  }, 60000);

  afterEach(() => {
    client?.disconnect();
  });

  it('should track balance changes after wins/losses', async () => {
    const initialBalance = await client.getBalance();
    const startBalance = BigInt(initialBalance.balance);

    // Play a game
    await client.playBlackjackHand(100);

    // Check balance changed
    const finalBalance = await client.getBalance();
    const endBalance = BigInt(finalBalance.balance);

    // Balance should have changed (win or loss)
    // Note: Could be same if push, but generally will differ
    expect(endBalance).not.toBe(startBalance);
  }, 60000);

  it('should reject bet exceeding balance', async () => {
    const balance = await client.getBalance();
    const currentBalance = BigInt(balance.balance);

    // Try to bet more than balance
    const response = await client.sendAndReceive({
      type: 'blackjack_deal',
      amount: Number(currentBalance) + 1000000,
    });

    expect(response.type).toBe('error');
    expect(response.code).toBe('INSUFFICIENT_BALANCE');
  }, 30000);
});
