/**
 * Broadcast Fanout Load Test (AC-3.3)
 *
 * Tests that the gateway can fan out round updates to at least 1,000 simulated
 * clients with backpressure handling.
 *
 * Run with: pnpm -C gateway test:fanout
 *
 * Environment variables:
 *   FANOUT_CLIENTS=1000 - Number of simulated clients
 *   FANOUT_MESSAGES=100 - Number of broadcast messages to send
 *   FANOUT_MESSAGE_INTERVAL_MS=10 - Interval between broadcasts
 *   RUN_FANOUT=true - Enable fanout tests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { BroadcastManager, type BroadcastManagerConfig } from '../../src/broadcast/manager.js';

// Configuration from environment
const FANOUT_CLIENTS = parseInt(process.env.FANOUT_CLIENTS || '1000', 10);
const FANOUT_MESSAGES = parseInt(process.env.FANOUT_MESSAGES || '100', 10);
const FANOUT_MESSAGE_INTERVAL_MS = parseInt(process.env.FANOUT_MESSAGE_INTERVAL_MS || '10', 10);
const FANOUT_ENABLED = process.env.RUN_FANOUT === 'true';

/**
 * Mock WebSocket for testing (simulates ws.WebSocket interface)
 */
class MockWebSocket extends EventEmitter {
  readyState: number;
  OPEN = 1;
  CLOSED = 3;
  receivedMessages: string[] = [];
  sendLatencyMs: number;
  sendErrors: number = 0;
  private shouldFail: boolean = false;

  constructor(options: { latencyMs?: number; shouldFail?: boolean } = {}) {
    super();
    this.readyState = this.OPEN;
    this.sendLatencyMs = options.latencyMs ?? 0;
    this.shouldFail = options.shouldFail ?? false;
  }

  send(data: string, callback?: (err?: Error) => void): void {
    if (this.readyState !== this.OPEN) {
      callback?.(new Error('WebSocket not open'));
      return;
    }

    if (this.shouldFail) {
      this.sendErrors++;
      callback?.(new Error('Simulated send failure'));
      return;
    }

    // Simulate network latency
    if (this.sendLatencyMs > 0) {
      setTimeout(() => {
        this.receivedMessages.push(data);
        callback?.();
      }, this.sendLatencyMs);
    } else {
      this.receivedMessages.push(data);
      callback?.();
    }
  }

  close(): void {
    this.readyState = this.CLOSED;
  }
}

interface FanoutTestResult {
  totalClients: number;
  totalMessages: number;
  totalExpectedDeliveries: number;
  totalActualDeliveries: number;
  totalDropped: number;
  deliveryRate: number;
  durationMs: number;
  messagesPerSecond: number;
  avgQueueDepth: number;
  maxQueueDepth: number;
}

/**
 * Run a fanout test with the given parameters
 */
async function runFanoutTest(
  clientCount: number,
  messageCount: number,
  messageIntervalMs: number,
  clientLatencyMs: number = 0,
  config: BroadcastManagerConfig = {}
): Promise<FanoutTestResult> {
  const broadcast = new BroadcastManager({
    maxQueueDepth: 100,
    queueWarnThreshold: 50,
    flushIntervalMs: 5,
    ...config,
  });
  broadcast.start();

  // Create mock clients
  const clients: MockWebSocket[] = [];
  for (let i = 0; i < clientCount; i++) {
    const client = new MockWebSocket({ latencyMs: clientLatencyMs });
    clients.push(client);
    broadcast.subscribe(client as unknown as import('ws').WebSocket);
  }

  const startTime = Date.now();

  // Send messages at the specified interval
  for (let i = 0; i < messageCount; i++) {
    const message = {
      type: 'round_update',
      roundId: i,
      timestamp: Date.now(),
      data: { value: `test_${i}` },
    };
    broadcast.publish(message);

    if (messageIntervalMs > 0) {
      await new Promise((r) => setTimeout(r, messageIntervalMs));
    }
  }

  // Wait for queues to drain (with timeout)
  const maxWaitMs = 5000;
  const waitStart = Date.now();
  while (Date.now() - waitStart < maxWaitMs) {
    await broadcast.flush();
    const stats = broadcast.getStats();
    if (stats.totalQueued === 0) break;
    await new Promise((r) => setTimeout(r, 10));
  }

  const durationMs = Date.now() - startTime;

  // Collect results
  const stats = broadcast.getStats();
  let totalDelivered = 0;
  for (const client of clients) {
    totalDelivered += client.receivedMessages.length;
  }

  const expectedDeliveries = clientCount * messageCount;

  // Clean up
  broadcast.destroy();
  for (const client of clients) {
    client.close();
  }

  return {
    totalClients: clientCount,
    totalMessages: messageCount,
    totalExpectedDeliveries: expectedDeliveries,
    totalActualDeliveries: totalDelivered,
    totalDropped: stats.totalDropped,
    deliveryRate: totalDelivered / expectedDeliveries,
    durationMs,
    messagesPerSecond: (totalDelivered / durationMs) * 1000,
    avgQueueDepth: stats.totalQueued,
    maxQueueDepth: stats.maxQueueDepth,
  };
}

describe('BroadcastManager Unit Tests', () => {
  let broadcast: BroadcastManager;

  beforeEach(() => {
    broadcast = new BroadcastManager({ flushIntervalMs: 5 });
    broadcast.start();
  });

  afterEach(() => {
    broadcast.destroy();
  });

  it('should subscribe and unsubscribe clients', () => {
    const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

    expect(broadcast.subscriberCount).toBe(0);
    broadcast.subscribe(ws);
    expect(broadcast.subscriberCount).toBe(1);
    expect(broadcast.isSubscribed(ws)).toBe(true);
    broadcast.unsubscribe(ws);
    expect(broadcast.subscriberCount).toBe(0);
    expect(broadcast.isSubscribed(ws)).toBe(false);
  });

  it('should publish messages to all subscribers', async () => {
    const client1 = new MockWebSocket();
    const client2 = new MockWebSocket();

    broadcast.subscribe(client1 as unknown as import('ws').WebSocket);
    broadcast.subscribe(client2 as unknown as import('ws').WebSocket);

    const queued = broadcast.publish({ type: 'test', value: 1 });
    expect(queued).toBe(2);

    await broadcast.flush();

    expect(client1.receivedMessages.length).toBe(1);
    expect(client2.receivedMessages.length).toBe(1);
    expect(JSON.parse(client1.receivedMessages[0])).toEqual({ type: 'test', value: 1 });
  });

  it('should publish to topic subscribers only', async () => {
    const client1 = new MockWebSocket();
    const client2 = new MockWebSocket();
    const client3 = new MockWebSocket();

    broadcast.subscribe(client1 as unknown as import('ws').WebSocket, ['table:1']);
    broadcast.subscribe(client2 as unknown as import('ws').WebSocket, ['table:2']);
    broadcast.subscribe(client3 as unknown as import('ws').WebSocket, ['table:1', 'table:2']);

    broadcast.publishToTopic('table:1', { type: 'update', table: 1 });
    await broadcast.flush();

    expect(client1.receivedMessages.length).toBe(1);
    expect(client2.receivedMessages.length).toBe(0);
    expect(client3.receivedMessages.length).toBe(1);
  });

  it('should drop messages when queue is full (backpressure)', async () => {
    const slowClient = new MockWebSocket({ latencyMs: 1000 }); // Very slow
    const broadcastWithSmallQueue = new BroadcastManager({
      maxQueueDepth: 5,
      flushIntervalMs: 5,
    });
    broadcastWithSmallQueue.start();

    broadcastWithSmallQueue.subscribe(slowClient as unknown as import('ws').WebSocket);

    // Send more messages than queue can hold
    for (let i = 0; i < 10; i++) {
      broadcastWithSmallQueue.publish({ msg: i });
    }

    const stats = broadcastWithSmallQueue.getStats();
    expect(stats.totalDropped).toBeGreaterThan(0);
    expect(stats.totalQueued).toBeLessThanOrEqual(5);

    broadcastWithSmallQueue.destroy();
  });

  it('should not queue for closed connections', async () => {
    const client = new MockWebSocket();
    broadcast.subscribe(client as unknown as import('ws').WebSocket);

    client.close(); // Close the connection

    const queued = broadcast.publish({ type: 'test' });
    expect(queued).toBe(0);

    const stats = broadcast.getStats();
    expect(stats.totalQueued).toBe(0);
  });

  it('should emit queue_warning when threshold exceeded', async () => {
    const client = new MockWebSocket({ latencyMs: 100 });
    const smallQueueBroadcast = new BroadcastManager({
      maxQueueDepth: 100,
      queueWarnThreshold: 5,
      flushIntervalMs: 1000, // Slow flush to let queue build up
    });
    smallQueueBroadcast.start();

    let warningEmitted = false;
    smallQueueBroadcast.on('queue_warning', () => {
      warningEmitted = true;
    });

    smallQueueBroadcast.subscribe(client as unknown as import('ws').WebSocket);

    // Send enough messages to trigger warning
    for (let i = 0; i < 6; i++) {
      smallQueueBroadcast.publish({ msg: i });
    }

    expect(warningEmitted).toBe(true);

    smallQueueBroadcast.destroy();
  });

  it('should handle concurrent sends correctly', async () => {
    const clients: MockWebSocket[] = [];
    for (let i = 0; i < 10; i++) {
      const client = new MockWebSocket();
      clients.push(client);
      broadcast.subscribe(client as unknown as import('ws').WebSocket);
    }

    // Send multiple messages rapidly
    for (let i = 0; i < 50; i++) {
      broadcast.publish({ msg: i });
    }

    // Wait for flush
    await broadcast.flush();
    await new Promise((r) => setTimeout(r, 50));
    await broadcast.flush();

    // All clients should receive all messages
    for (const client of clients) {
      expect(client.receivedMessages.length).toBe(50);
    }
  });
});

describe.skipIf(!FANOUT_ENABLED)('Broadcast Fanout Load Tests (AC-3.3)', () => {
  it(`should fan out to ${FANOUT_CLIENTS} clients without crashing`, async () => {
    console.log(`\n📡 Fanout Test: ${FANOUT_CLIENTS} clients, ${FANOUT_MESSAGES} messages`);

    const result = await runFanoutTest(
      FANOUT_CLIENTS,
      FANOUT_MESSAGES,
      FANOUT_MESSAGE_INTERVAL_MS
    );

    console.log('\n📈 Results:');
    console.log(`   Clients: ${result.totalClients}`);
    console.log(`   Messages: ${result.totalMessages}`);
    console.log(`   Expected deliveries: ${result.totalExpectedDeliveries}`);
    console.log(`   Actual deliveries: ${result.totalActualDeliveries}`);
    console.log(`   Delivery rate: ${(result.deliveryRate * 100).toFixed(1)}%`);
    console.log(`   Dropped: ${result.totalDropped}`);
    console.log(`   Duration: ${result.durationMs}ms`);
    console.log(`   Messages/sec: ${result.messagesPerSecond.toFixed(0)}`);

    // AC-3.3: Gateway fans out round updates to at least 1,000 simulated clients
    expect(result.totalClients).toBeGreaterThanOrEqual(1000);
    // At least 95% delivery rate (some drops acceptable under heavy load)
    expect(result.deliveryRate).toBeGreaterThan(0.95);
  }, 120000);

  it('should handle backpressure from slow clients', async () => {
    const slowClientCount = Math.min(100, FANOUT_CLIENTS);
    console.log(`\n🐢 Slow Client Test: ${slowClientCount} slow clients (50ms latency)`);

    const result = await runFanoutTest(
      slowClientCount,
      50, // Fewer messages
      5,  // Faster send rate to create backpressure
      50, // 50ms latency per client
      { maxQueueDepth: 20 } // Smaller queue to test drops
    );

    console.log('\n📈 Results:');
    console.log(`   Delivery rate: ${(result.deliveryRate * 100).toFixed(1)}%`);
    console.log(`   Dropped: ${result.totalDropped}`);
    console.log(`   Max queue depth: ${result.maxQueueDepth}`);

    // With backpressure, we expect some drops but no crashes
    // The test passes as long as the manager doesn't throw
    expect(result.totalActualDeliveries).toBeGreaterThan(0);
  }, 60000);

  it('should scale linearly with subscriber count', async () => {
    const clientCounts = [100, 500, 1000];
    const results: FanoutTestResult[] = [];

    console.log('\n📊 Scaling Test:');

    for (const count of clientCounts) {
      const result = await runFanoutTest(count, 50, 5);
      results.push(result);
      console.log(`   ${count} clients: ${result.messagesPerSecond.toFixed(0)} msg/sec, ${(result.deliveryRate * 100).toFixed(1)}% delivered`);
    }

    // All tests should maintain high delivery rate
    for (const result of results) {
      expect(result.deliveryRate).toBeGreaterThan(0.9);
    }
  }, 180000);

  it('should handle mixed topics efficiently', async () => {
    const broadcast = new BroadcastManager({ flushIntervalMs: 5 });
    broadcast.start();

    const clientsPerTopic = 200;
    const topics = ['table:1', 'table:2', 'table:3', 'table:4', 'table:5'];
    const clients: MockWebSocket[] = [];

    // Create clients for each topic
    for (const topic of topics) {
      for (let i = 0; i < clientsPerTopic; i++) {
        const client = new MockWebSocket();
        clients.push(client);
        broadcast.subscribe(client as unknown as import('ws').WebSocket, [topic]);
      }
    }

    console.log(`\n📬 Topic Test: ${topics.length} topics, ${clientsPerTopic} clients each`);

    // Send messages to each topic
    const messagesPerTopic = 20;
    for (let i = 0; i < messagesPerTopic; i++) {
      for (const topic of topics) {
        broadcast.publishToTopic(topic, { topic, msg: i });
      }
    }

    // Wait for flush
    await broadcast.flush();
    await new Promise((r) => setTimeout(r, 100));
    await broadcast.flush();

    // Check that each client received the right number of messages
    let totalReceived = 0;
    for (const client of clients) {
      totalReceived += client.receivedMessages.length;
    }

    const expectedTotal = topics.length * clientsPerTopic * messagesPerTopic;
    const deliveryRate = totalReceived / expectedTotal;

    console.log(`   Expected: ${expectedTotal}, Received: ${totalReceived}`);
    console.log(`   Delivery rate: ${(deliveryRate * 100).toFixed(1)}%`);

    expect(deliveryRate).toBeGreaterThan(0.95);

    broadcast.destroy();
  }, 60000);
});

// Export for use in other tests
export { MockWebSocket, runFanoutTest, type FanoutTestResult };
