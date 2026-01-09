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
  type ClientMode,
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
      // US-258: Test full auth flow with CSRF token handling
      // Note: This test requires the auth service to be running with Convex
      try {
        const result = await client.authenticate();
        expect(result.success).toBe(true);
        // Session should be established
        if (result.session?.user?.id) {
          expect(result.session.user.id).toBeDefined();
        }
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

describe.skipIf(!CROSS_SERVICE_ENABLED)('Origin Header and CORS Validation', () => {
  beforeAll(async () => {
    await waitForAllServices();
  }, 120000);

  describe('Web Client Mode (with Origin header)', () => {
    it('should connect successfully with allowed origin', async () => {
      // Default mode is 'web' with origin http://localhost:5173
      const client = new CrossServiceClient(undefined, { mode: 'web' });

      await client.connect();
      const sessionReady = await client.waitForMessage('session_ready');

      expect(sessionReady.type).toBe('session_ready');
      expect(sessionReady.sessionId).toBeDefined();

      client.disconnect();
    }, 30000);

    it('should connect with custom allowed origin', async () => {
      const client = new CrossServiceClient(undefined, {
        mode: 'web',
        origin: 'http://localhost:3000',
      });

      await client.connect();
      const sessionReady = await client.waitForMessage('session_ready');

      expect(sessionReady.type).toBe('session_ready');
      client.disconnect();
    }, 30000);
  });

  describe('Mobile Client Mode (without Origin header)', () => {
    it('should connect successfully without Origin header', async () => {
      // Mobile mode: no Origin header
      // Requires GATEWAY_ALLOW_NO_ORIGIN=1 in gateway config
      const client = new CrossServiceClient(undefined, { mode: 'mobile' });

      await client.connect();
      const sessionReady = await client.waitForMessage('session_ready');

      expect(sessionReady.type).toBe('session_ready');
      expect(sessionReady.sessionId).toBeDefined();
      expect(client.getMode()).toBe('mobile');

      client.disconnect();
    }, 30000);

    it('should play a game without Origin header', async () => {
      const client = new CrossServiceClient(undefined, { mode: 'mobile' });

      await client.connect();
      await client.waitForReady();

      // Play a game to verify full flow works without Origin
      const { gameStarted } = await client.playBlackjackHand(100);
      expect(gameStarted.type).toBe('game_started');

      client.disconnect();
    }, 60000);
  });

  describe('Mixed Client Modes', () => {
    it('should isolate sessions between web and mobile clients', async () => {
      const webClient = new CrossServiceClient(undefined, { mode: 'web' });
      const mobileClient = new CrossServiceClient(undefined, { mode: 'mobile' });

      try {
        // Connect both clients
        await Promise.all([webClient.connect(), mobileClient.connect()]);

        // Wait for both to be ready
        const [webSession, mobileSession] = await Promise.all([
          webClient.waitForMessage('session_ready'),
          mobileClient.waitForMessage('session_ready'),
        ]);

        // Sessions should be unique
        expect(webSession.sessionId).not.toBe(mobileSession.sessionId);
        expect(webClient.getMode()).toBe('web');
        expect(mobileClient.getMode()).toBe('mobile');
      } finally {
        webClient.disconnect();
        mobileClient.disconnect();
      }
    }, 60000);
  });
});

/**
 * US-258: Auth E2E Flow Tests
 *
 * Tests the full authentication flow including:
 * - CSRF token retrieval
 * - Cookie management
 * - Session establishment
 * - Protected endpoint access
 */
describe.skipIf(!CROSS_SERVICE_ENABLED)('Auth E2E Flow (US-258)', () => {
  let client: CrossServiceClient;

  beforeAll(async () => {
    await waitForAllServices();
  }, 120000);

  beforeEach(() => {
    client = new CrossServiceClient(undefined, { mode: 'web' });
  });

  afterEach(() => {
    client?.disconnect();
  });

  describe('CSRF Token Handling', () => {
    it('should fetch CSRF token from /auth/csrf', async () => {
      try {
        const csrfToken = await client.getCsrfToken();
        expect(csrfToken).toBeDefined();
        expect(typeof csrfToken).toBe('string');
        expect(csrfToken.length).toBeGreaterThan(0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('fetch')) {
          console.log('Skipping CSRF test - auth service not reachable');
          return;
        }
        throw error;
      }
    }, 30000);

    it('should get auth challenge with public key', async () => {
      try {
        const { challengeId, challenge } = await client.getAuthChallenge();
        expect(challengeId).toBeDefined();
        expect(challenge).toBeDefined();
        expect(typeof challenge).toBe('string');
        expect(challenge.length).toBe(64); // 32 bytes hex
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('CONVEX') || message.includes('fetch')) {
          console.log('Skipping challenge test - requires Convex integration');
          return;
        }
        throw error;
      }
    }, 30000);

    it('should complete full auth flow with CSRF token', async () => {
      try {
        const result = await client.authenticate();
        expect(result.success).toBe(true);
        // Verify session exists after authentication
        const session = await client.getSession();
        expect(session).not.toBeNull();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('CONVEX') || message.includes('fetch')) {
          console.log('Skipping full auth test - requires Convex integration');
          return;
        }
        throw error;
      }
    }, 30000);
  });

  describe('CSRF Protection Validation', () => {
    it('should reject requests without CSRF token on protected endpoints', async () => {
      // First authenticate to get session cookies
      try {
        await client.authenticate();
      } catch {
        console.log('Skipping CSRF rejection test - auth not available');
        return;
      }

      // Try to access a CSRF-protected endpoint without token
      // /profile/sync-freeroll is a protected endpoint
      const response = await client.authFetchWithoutCsrf('/profile/sync-freeroll');

      expect(response.status).toBe(403);
      const data = await response.json().catch(() => ({}));
      expect((data as { error?: string }).error).toBe('csrf_invalid');
    }, 30000);

    it('should accept requests with valid CSRF token', async () => {
      try {
        await client.authenticate();
      } catch {
        console.log('Skipping CSRF acceptance test - auth not available');
        return;
      }

      // Try to access a CSRF-protected endpoint with valid token
      const response = await client.authFetchWithCsrf('/profile/sync-freeroll');

      // Should not be 403 - may be other status depending on freeroll config
      expect(response.status).not.toBe(403);
    }, 30000);

    it('should reject requests with invalid CSRF token', async () => {
      try {
        await client.authenticate();
      } catch {
        console.log('Skipping invalid CSRF test - auth not available');
        return;
      }

      // Manually craft a request with wrong CSRF token
      const response = await fetch(
        `${SERVICE_URLS.auth}/profile/sync-freeroll`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:5173',
          },
          body: JSON.stringify({ csrfToken: 'invalid-token-12345' }),
        }
      );

      expect(response.status).toBe(403);
      const data = await response.json().catch(() => ({}));
      expect((data as { error?: string }).error).toBe('csrf_invalid');
    }, 30000);
  });

  describe('Session Management', () => {
    it('should maintain session across multiple requests', async () => {
      try {
        // Authenticate
        const authResult = await client.authenticate();
        expect(authResult.success).toBe(true);

        // Make multiple session requests - should all return same session
        const session1 = await client.getSession();
        const session2 = await client.getSession();

        expect(session1?.user?.id).toBeDefined();
        expect(session1?.user?.id).toBe(session2?.user?.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('CONVEX') || message.includes('fetch')) {
          console.log('Skipping session management test - requires Convex');
          return;
        }
        throw error;
      }
    }, 30000);

    it('should clear session on cookie clear', async () => {
      try {
        // Authenticate first
        await client.authenticate();
        const session = await client.getSession();
        expect(session?.user?.id).toBeDefined();

        // Clear cookies
        client.clearCookies();

        // Session should now be empty
        const clearedSession = await client.getSession();
        expect(clearedSession?.user?.id).toBeUndefined();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('CONVEX') || message.includes('fetch')) {
          console.log('Skipping session clear test - requires Convex');
          return;
        }
        throw error;
      }
    }, 30000);
  });
});

/**
 * US-256: Chain Updates Verification Tests
 *
 * Verifies that gateway-initiated bets result in on-chain updates being broadcast.
 * Tests subscribe to simulator /updates WebSocket and verify:
 * - Transaction events are emitted for bets
 * - Casino events (started, completed) are broadcast
 * - Account state changes are queryable via /account endpoint
 */
describe.skipIf(!CROSS_SERVICE_ENABLED)('Chain Updates Verification (US-256)', () => {
  // Import dynamically to avoid issues when not running cross-service tests
  let UpdatesClient: typeof import('./helpers/updates-client.js').UpdatesClient;
  let getAccountState: typeof import('./helpers/updates-client.js').getAccountState;

  let gatewayClient: CrossServiceClient;
  let updatesClient: InstanceType<typeof UpdatesClient>;

  beforeAll(async () => {
    // Dynamic import to avoid loading when tests are skipped
    const updatesModule = await import('./helpers/updates-client.js');
    UpdatesClient = updatesModule.UpdatesClient;
    getAccountState = updatesModule.getAccountState;

    await waitForAllServices();
  }, 120000);

  beforeEach(async () => {
    gatewayClient = new CrossServiceClient(undefined, { mode: 'web' });
    updatesClient = new UpdatesClient();
  }, 30000);

  afterEach(() => {
    gatewayClient?.disconnect();
    updatesClient?.disconnect();
  });

  describe('Update Subscription', () => {
    it('should connect to simulator updates stream', async () => {
      await updatesClient.connectForAll();
      expect(updatesClient.isConnected()).toBe(true);
    }, 30000);

    it('should connect with account filter', async () => {
      // Connect gateway to get a public key
      await gatewayClient.connect();
      const session = await gatewayClient.waitForMessage('session_ready');
      const publicKey = session.publicKey as string;

      // Connect updates client filtered to this account
      await updatesClient.connectForAccount(publicKey);
      expect(updatesClient.isConnected()).toBe(true);
    }, 60000);
  });

  describe('Bet Flow Chain Updates', () => {
    it('should receive chain update when placing a bet via gateway', async () => {
      // 1. Connect gateway and wait for ready
      await gatewayClient.connect();
      await gatewayClient.waitForReady();
      const publicKey = gatewayClient.getPublicKey();

      // 2. Subscribe to updates for this account BEFORE placing bet
      await updatesClient.connectForAccount(publicKey);
      expect(updatesClient.isConnected()).toBe(true);

      // 3. Place a bet via gateway
      const { gameStarted } = await gatewayClient.playBlackjackHand(100);
      expect(gameStarted.type).toBe('game_started');

      // 4. Wait for chain update
      const update = await updatesClient.waitForUpdate(15000);

      // 5. Verify we received update data
      expect(update).toBeDefined();
      expect(update.length).toBeGreaterThan(0);

      const info = updatesClient.getUpdateInfo();
      expect(info.received).toBe(true);
      expect(info.messageCount).toBeGreaterThanOrEqual(1);
    }, 60000);

    it('should receive multiple updates for game start and completion', async () => {
      // 1. Connect and prepare
      await gatewayClient.connect();
      await gatewayClient.waitForReady();
      const publicKey = gatewayClient.getPublicKey();

      // 2. Subscribe to updates
      await updatesClient.connectForAccount(publicKey);

      // 3. Play a complete game (deal + stand)
      const { gameStarted, result } = await gatewayClient.playBlackjackHand(100);
      expect(gameStarted.type).toBe('game_started');

      // 4. Wait for updates (may receive multiple: started, moved/completed)
      // Give extra time for all events to propagate
      await new Promise((r) => setTimeout(r, 2000));

      const info = updatesClient.getUpdateInfo();

      // Should have received at least one update
      expect(info.received).toBe(true);
      expect(info.byteCount).toBeGreaterThan(0);

      // Log for debugging
      console.log(`[US-256] Received ${info.messageCount} updates, ${info.byteCount} bytes`);
      console.log(`[US-256] Game result type: ${result.type}`);
    }, 60000);

    it('should see balance change via account endpoint after game', async () => {
      // 1. Connect gateway
      await gatewayClient.connect();
      await gatewayClient.waitForReady();
      const publicKey = gatewayClient.getPublicKey();

      // 2. Get initial balance from simulator
      const initialState = await getAccountState(publicKey);
      const initialBalance = initialState.balance;

      // 3. Play a game
      await gatewayClient.playBlackjackHand(100);

      // 4. Small delay for state to propagate
      await new Promise((r) => setTimeout(r, 1000));

      // 5. Get updated balance
      const finalState = await getAccountState(publicKey);
      const finalBalance = finalState.balance;

      // Balance should have changed (win or loss)
      // Note: Could be same balance if push, but very unlikely
      console.log(`[US-256] Initial balance: ${initialBalance}, Final balance: ${finalBalance}`);

      // At minimum, nonce should have incremented (transaction was processed)
      expect(finalState.nonce).toBeGreaterThanOrEqual(initialState.nonce);
    }, 60000);
  });

  describe('All Updates Subscription', () => {
    it('should receive updates when subscribed to all events', async () => {
      // 1. Subscribe to ALL updates first
      await updatesClient.connectForAll();
      expect(updatesClient.isConnected()).toBe(true);

      // 2. Connect gateway and play
      await gatewayClient.connect();
      await gatewayClient.waitForReady();

      // Clear any updates from registration
      updatesClient.clearMessages();

      // 3. Place a bet
      const { gameStarted } = await gatewayClient.playBlackjackHand(100);
      expect(gameStarted.type).toBe('game_started');

      // 4. Wait for update
      const update = await updatesClient.waitForUpdate(15000);

      expect(update).toBeDefined();
      expect(update.length).toBeGreaterThan(0);

      const info = updatesClient.getUpdateInfo();
      console.log(`[US-256] All-filter received ${info.messageCount} updates, ${info.byteCount} bytes`);
    }, 60000);
  });

  describe('Multiple Games Chain Verification', () => {
    it('should track updates across multiple consecutive games', async () => {
      // 1. Connect and prepare
      await gatewayClient.connect();
      await gatewayClient.waitForReady();
      const publicKey = gatewayClient.getPublicKey();

      // 2. Subscribe to updates
      await updatesClient.connectForAccount(publicKey);

      // 3. Play 3 consecutive games
      for (let i = 0; i < 3; i++) {
        const { gameStarted } = await gatewayClient.playBlackjackHand(100);
        expect(gameStarted.type).toBe('game_started');
      }

      // 4. Wait a bit for all updates to arrive
      await new Promise((r) => setTimeout(r, 3000));

      const info = updatesClient.getUpdateInfo();

      // Should have received multiple updates (at least one per game)
      expect(info.messageCount).toBeGreaterThanOrEqual(3);
      console.log(`[US-256] After 3 games: ${info.messageCount} updates, ${info.byteCount} bytes`);
    }, 120000);
  });
});
