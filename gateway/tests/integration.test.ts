/**
 * Integration tests for gateway with real backend
 *
 * These tests require a running simulator backend.
 * Skip with: npm test -- --skip-integration
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { WebSocket } from 'ws';

const GATEWAY_PORT = process.env.TEST_GATEWAY_PORT || '9010';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080';

// Skip integration tests unless explicitly enabled
const INTEGRATION_ENABLED = process.env.RUN_INTEGRATION === 'true';

vi.setConfig({ testTimeout: 35000 });

/**
 * Helper to send JSON message and wait for response
 */
async function sendAndReceive(
  ws: WebSocket,
  msg: Record<string, unknown>,
  timeout = 35000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for response to ${msg.type}`));
    }, timeout);

    ws.once('message', (data) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(data.toString()));
      } catch (err) {
        reject(err);
      }
    });

    ws.send(JSON.stringify(msg));
  });
}

/**
 * Helper to wait for specific message type
 */
async function waitForMessage(
  ws: WebSocket,
  type: string,
  timeout = 15000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for message type: ${type}`));
    }, timeout);

    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === type) {
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
 * Helper to connect to gateway
 */
async function connectToGateway(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${GATEWAY_PORT}`);

    ws.on('open', () => {
      resolve(ws);
    });

    ws.on('error', (err) => {
      reject(err);
    });

    setTimeout(() => {
      reject(new Error('Connection timeout'));
    }, 10000);
  });
}

describe.skipIf(!INTEGRATION_ENABLED)('Gateway Integration Tests', () => {
  let ws: WebSocket;

  beforeAll(async () => {
    // Check if backend is reachable
    try {
      const response = await fetch(`${BACKEND_URL}/healthz`);
      if (!response.ok) {
        throw new Error('Backend health check failed');
      }
    } catch (err) {
      throw new Error(
        `Backend not reachable at ${BACKEND_URL}. Start with: ./start-local-network.sh`
      );
    }
  });

  afterAll(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  it('should connect and receive session_ready', async () => {
    ws = await connectToGateway();

    const msg = await waitForMessage(ws, 'session_ready');

    expect(msg.type).toBe('session_ready');
    expect(msg.sessionId).toBeDefined();
    expect(msg.publicKey).toBeDefined();
    expect(typeof msg.publicKey).toBe('string');
    expect((msg.publicKey as string).length).toBe(64); // 32 bytes hex
  });

  it('should respond to ping', async () => {
    const response = await sendAndReceive(ws, { type: 'ping' });

    expect(response.type).toBe('pong');
    expect(response.timestamp).toBeDefined();
    expect(typeof response.timestamp).toBe('number');
  });

  it('should return balance info', async () => {
    // Wait for background registration/deposit to complete
    // Registration happens async after session_ready is sent
    let response: Record<string, unknown>;
    let attempts = 0;
    const maxAttempts = 20;

    do {
      await new Promise((r) => setTimeout(r, 100)); // Wait 100ms between attempts
      response = await sendAndReceive(ws, { type: 'get_balance' });
      attempts++;
    } while (
      (!response.registered || !response.hasBalance) &&
      attempts < maxAttempts
    );

    expect(response.type).toBe('balance');
    expect(response.registered).toBe(true);
    expect(response.hasBalance).toBe(true);
    expect(response.publicKey).toBeDefined();
  });

  it('should start a blackjack game', async () => {
    const response = await sendAndReceive(ws, {
      type: 'blackjack_deal',
      amount: 100,
    });

    expect(response.type).toBe('game_started');
    expect(response.sessionId).toBeDefined();
    expect(response.bet).toBe('100');
  });

  it('should make a blackjack move', async () => {
    // Note: This requires an active game from previous test
    const response = await sendAndReceive(ws, {
      type: 'blackjack_stand',
    });

    expect(['game_move', 'game_result']).toContain(response.type);
    expect(response.sessionId).toBeDefined();
  });

  it('should reject invalid message type', async () => {
    const response = await sendAndReceive(ws, {
      type: 'invalid_message_type',
    });

    expect(response.type).toBe('error');
    expect(response.code).toBe('INVALID_MESSAGE');
  });

  it('should reject invalid bet amount', async () => {
    const response = await sendAndReceive(ws, {
      type: 'ultimate_tx_deal',
      ante: 100,
      blind: 100,
      progressive: 2,
    });

    expect(response.type).toBe('error');
    expect(response.code).toBe('INVALID_BET');
  });
});

describe('Gateway Unit Tests (No Backend)', () => {
  it('should export all game handlers', async () => {
    const { createHandlerRegistry } = await import('../src/handlers/index.js');
    const registry = createHandlerRegistry();

    // Verify all 10 games are registered
    expect(registry.size).toBe(10);

    // Check specific game types
    const { GameType } = await import('../src/codec/constants.js');
    expect(registry.has(GameType.Blackjack)).toBe(true);
    expect(registry.has(GameType.HiLo)).toBe(true);
    expect(registry.has(GameType.Roulette)).toBe(true);
    expect(registry.has(GameType.Baccarat)).toBe(true);
    expect(registry.has(GameType.VideoPoker)).toBe(true);
    expect(registry.has(GameType.Craps)).toBe(true);
    expect(registry.has(GameType.SicBo)).toBe(true);
    expect(registry.has(GameType.CasinoWar)).toBe(true);
    expect(registry.has(GameType.ThreeCard)).toBe(true);
    expect(registry.has(GameType.UltimateHoldem)).toBe(true);
  });

  it('should export error codes', async () => {
    const { ErrorCodes, createError } = await import('../src/types/errors.js');

    expect(ErrorCodes.INVALID_MESSAGE).toBe('INVALID_MESSAGE');
    expect(ErrorCodes.INVALID_BET).toBe('INVALID_BET');
    expect(ErrorCodes.NO_ACTIVE_GAME).toBe('NO_ACTIVE_GAME');

    const error = createError(ErrorCodes.INVALID_BET, 'Test message');
    expect(error.code).toBe('INVALID_BET');
    expect(error.message).toBe('Test message');
  });

  it('should export session types', async () => {
    const { NonceManager } = await import('../src/session/nonce.js');

    const nonce = new NonceManager();
    const pubKeyHex = '0'.repeat(64);

    expect(nonce.getAndIncrement(pubKeyHex)).toBe(0n);
    expect(nonce.getAndIncrement(pubKeyHex)).toBe(1n);
    expect(nonce.getAndIncrement(pubKeyHex)).toBe(2n);
  });
});
