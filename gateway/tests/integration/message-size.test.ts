/**
 * Message Size Limit Integration Tests
 *
 * Tests for the MAX_MESSAGE_SIZE check that prevents DoS attacks
 * via oversized WebSocket messages.
 *
 * Run with: RUN_INTEGRATION=true npm test -- message-size.test.ts
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import WebSocket from 'ws';
import {
  INTEGRATION_ENABLED,
  createConnection,
  waitForMessage,
} from '../helpers/ws.js';

vi.setConfig({ testTimeout: 60000 });

// Default MAX_MESSAGE_SIZE is 64KB (65536 bytes)
const MAX_MESSAGE_SIZE = 64 * 1024;

describe.skipIf(!INTEGRATION_ENABLED)('Message Size Limit Tests', () => {
  const connections: WebSocket[] = [];

  afterEach(() => {
    while (connections.length > 0) {
      const ws = connections.pop();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
  });

  it('should accept message at boundary (MAX_MESSAGE_SIZE bytes)', async () => {
    const ws = await createConnection();
    connections.push(ws);

    // Wait for session to be ready
    await waitForMessage(ws, 'session_ready');

    // Create a message just under the limit
    // JSON overhead: {"type":"ping"} = 15 bytes, so we need padding
    const baseMessage = { type: 'ping' };
    const baseJson = JSON.stringify(baseMessage);
    const paddingNeeded = MAX_MESSAGE_SIZE - baseJson.length - 15; // Leave room for padding field
    const paddedMessage = { type: 'ping', padding: 'x'.repeat(paddingNeeded) };

    // Verify our message is at the boundary
    const messageSize = Buffer.from(JSON.stringify(paddedMessage)).length;
    expect(messageSize).toBeLessThanOrEqual(MAX_MESSAGE_SIZE);

    // Send the message - should get pong response
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Response timeout')), 5000);

      ws.once('message', (data: WebSocket.Data) => {
        clearTimeout(timer);
        try {
          const response = JSON.parse(data.toString());
          expect(response.type).toBe('pong');
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      ws.send(JSON.stringify(paddedMessage));
    });
  });

  it('should reject message exceeding MAX_MESSAGE_SIZE', async () => {
    const ws = await createConnection();
    connections.push(ws);

    // Wait for session to be ready
    await waitForMessage(ws, 'session_ready');

    // Create a message that exceeds the limit
    const oversizedMessage = {
      type: 'ping',
      padding: 'x'.repeat(MAX_MESSAGE_SIZE + 1000),
    };

    const messageSize = Buffer.from(JSON.stringify(oversizedMessage)).length;
    expect(messageSize).toBeGreaterThan(MAX_MESSAGE_SIZE);

    // Send the oversized message - should get error response
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Response timeout')), 5000);

      ws.once('message', (data: WebSocket.Data) => {
        clearTimeout(timer);
        try {
          const response = JSON.parse(data.toString());
          expect(response.type).toBe('error');
          expect(response.code).toBe('INVALID_MESSAGE');
          expect(response.message).toMatch(/Message too large/);
          expect(response.message).toContain(String(MAX_MESSAGE_SIZE));
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      ws.send(JSON.stringify(oversizedMessage));
    });
  });

  it('should reject very large payload without parsing', async () => {
    const ws = await createConnection();
    connections.push(ws);

    // Wait for session to be ready
    await waitForMessage(ws, 'session_ready');

    // Create a 1MB payload to verify it's rejected before JSON parsing
    const hugePayload = 'x'.repeat(1024 * 1024); // 1MB
    const messageSize = Buffer.from(hugePayload).length;
    expect(messageSize).toBeGreaterThan(MAX_MESSAGE_SIZE);

    // Send the huge payload - should get error response
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Response timeout')), 5000);

      ws.once('message', (data: WebSocket.Data) => {
        clearTimeout(timer);
        try {
          const response = JSON.parse(data.toString());
          expect(response.type).toBe('error');
          expect(response.code).toBe('INVALID_MESSAGE');
          expect(response.message).toMatch(/Message too large/);
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      ws.send(hugePayload);
    });
  });

  it('should accept multiple normal-sized messages after rejection', async () => {
    const ws = await createConnection();
    connections.push(ws);

    // Wait for session to be ready
    await waitForMessage(ws, 'session_ready');

    // First, send an oversized message
    const oversizedMessage = {
      type: 'ping',
      padding: 'x'.repeat(MAX_MESSAGE_SIZE + 1000),
    };

    const errorPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Error response timeout')), 5000);
      ws.once('message', (data: WebSocket.Data) => {
        clearTimeout(timer);
        const response = JSON.parse(data.toString());
        expect(response.type).toBe('error');
        resolve();
      });
    });

    ws.send(JSON.stringify(oversizedMessage));
    await errorPromise;

    // Now send a normal ping - connection should still work
    const pongPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Pong timeout')), 5000);
      ws.once('message', (data: WebSocket.Data) => {
        clearTimeout(timer);
        const response = JSON.parse(data.toString());
        expect(response.type).toBe('pong');
        resolve();
      });
    });

    ws.send(JSON.stringify({ type: 'ping' }));
    await pongPromise;
  });
});
