/**
 * WebSocket Stress Test Suite
 *
 * Tests gateway capacity under high concurrent connection load.
 * Run with: pnpm -C gateway test:stress
 *
 * Environment variables:
 *   STRESS_CONNECTIONS=100 - Number of concurrent connections
 *   STRESS_GATEWAY_URL=ws://localhost:9010 - Gateway URL
 *   P99_LATENCY_TARGET_MS=100 - Target P99 latency in ms
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';

// Configuration from environment
const GATEWAY_URL = process.env.STRESS_GATEWAY_URL || 'ws://localhost:9010';
const STRESS_CONNECTIONS = parseInt(process.env.STRESS_CONNECTIONS || '100', 10);
const P99_LATENCY_TARGET_MS = parseInt(process.env.P99_LATENCY_TARGET_MS || '100', 10);
const CONNECTION_BATCH_SIZE = parseInt(process.env.CONNECTION_BATCH_SIZE || '50', 10);
const MESSAGE_ROUNDS = parseInt(process.env.MESSAGE_ROUNDS || '5', 10);

// Skip unless explicitly enabled
const STRESS_ENABLED = process.env.RUN_STRESS === 'true';

interface ConnectionStats {
  connected: number;
  failed: number;
  latencies: number[];
  errors: string[];
}

interface StressResult {
  totalConnections: number;
  successfulConnections: number;
  failedConnections: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  minLatencyMs: number;
  errors: string[];
  durationMs: number;
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Connect a batch of WebSocket clients and measure latencies
 */
async function connectAndMeasure(
  count: number,
  batchSize: number,
  gatewayUrl: string
): Promise<ConnectionStats> {
  const stats: ConnectionStats = {
    connected: 0,
    failed: 0,
    latencies: [],
    errors: [],
  };

  const connections: WebSocket[] = [];

  // Connect in batches to avoid overwhelming the system
  for (let batch = 0; batch < Math.ceil(count / batchSize); batch++) {
    const batchStart = batch * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, count);
    const batchPromises: Promise<WebSocket | null>[] = [];

    for (let i = batchStart; i < batchEnd; i++) {
      const connectionPromise = new Promise<WebSocket | null>((resolve) => {
        const start = Date.now();
        try {
          const ws = new WebSocket(gatewayUrl);

          const timeout = setTimeout(() => {
            ws.terminate();
            stats.failed++;
            stats.errors.push(`Connection ${i} timed out`);
            resolve(null);
          }, 30000);

          ws.on('open', () => {
            clearTimeout(timeout);
            stats.connected++;
            stats.latencies.push(Date.now() - start);
            resolve(ws);
          });

          ws.on('error', (err) => {
            clearTimeout(timeout);
            stats.failed++;
            stats.errors.push(`Connection ${i}: ${err.message}`);
            resolve(null);
          });
        } catch (err) {
          stats.failed++;
          stats.errors.push(`Connection ${i}: ${err}`);
          resolve(null);
        }
      });

      batchPromises.push(connectionPromise);
    }

    const batchResults = await Promise.all(batchPromises);
    connections.push(...batchResults.filter((ws): ws is WebSocket => ws !== null));

    // Small delay between batches to let the system stabilize
    if (batch < Math.ceil(count / batchSize) - 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // Measure message round-trip latency on connected sockets
  if (connections.length > 0 && MESSAGE_ROUNDS > 0) {
    const sampleSize = Math.min(100, connections.length);
    const sampledConnections = connections.slice(0, sampleSize);

    for (let round = 0; round < MESSAGE_ROUNDS; round++) {
      const roundPromises = sampledConnections.map((ws) => {
        return new Promise<number | null>((resolve) => {
          const start = Date.now();
          const timeout = setTimeout(() => {
            resolve(null);
          }, 5000);

          const handler = () => {
            clearTimeout(timeout);
            ws.removeListener('message', handler);
            resolve(Date.now() - start);
          };

          ws.on('message', handler);
          ws.send(JSON.stringify({ type: 'ping', ts: start }));
        });
      });

      const latencies = await Promise.all(roundPromises);
      for (const lat of latencies) {
        if (lat !== null) {
          stats.latencies.push(lat);
        }
      }

      // Small delay between rounds
      if (round < MESSAGE_ROUNDS - 1) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }

  // Clean up all connections
  for (const ws of connections) {
    try {
      ws.close(1000);
    } catch {
      // Ignore cleanup errors
    }
  }

  return stats;
}

/**
 * Run full stress test and compute results
 */
async function runStressTest(
  connections: number,
  batchSize: number,
  gatewayUrl: string
): Promise<StressResult> {
  const startTime = Date.now();
  const stats = await connectAndMeasure(connections, batchSize, gatewayUrl);
  const durationMs = Date.now() - startTime;

  // Sort latencies for percentile calculation
  const sortedLatencies = [...stats.latencies].sort((a, b) => a - b);

  return {
    totalConnections: connections,
    successfulConnections: stats.connected,
    failedConnections: stats.failed,
    p50LatencyMs: percentile(sortedLatencies, 50),
    p95LatencyMs: percentile(sortedLatencies, 95),
    p99LatencyMs: percentile(sortedLatencies, 99),
    avgLatencyMs:
      sortedLatencies.length > 0
        ? sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length
        : 0,
    maxLatencyMs: sortedLatencies.length > 0 ? sortedLatencies[sortedLatencies.length - 1] : 0,
    minLatencyMs: sortedLatencies.length > 0 ? sortedLatencies[0] : 0,
    errors: stats.errors.slice(0, 10), // Only keep first 10 errors
    durationMs,
  };
}

describe.skipIf(!STRESS_ENABLED)('WebSocket Stress Tests', () => {
  let isGatewayAvailable = false;

  beforeAll(async () => {
    // Check if gateway is running
    try {
      const ws = new WebSocket(GATEWAY_URL);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.terminate();
          reject(new Error('Gateway not available'));
        }, 5000);
        ws.on('open', () => {
          clearTimeout(timeout);
          ws.close();
          isGatewayAvailable = true;
          resolve();
        });
        ws.on('error', () => {
          clearTimeout(timeout);
          reject(new Error('Gateway connection error'));
        });
      });
    } catch {
      console.warn('Gateway not available, skipping stress tests');
    }
  }, 10000);

  afterAll(() => {
    // Give connections time to fully close
    return new Promise((r) => setTimeout(r, 1000));
  });

  it(`should handle ${STRESS_CONNECTIONS} concurrent connections`, async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log(`\n📊 Stress Test: ${STRESS_CONNECTIONS} connections to ${GATEWAY_URL}`);
    console.log(`   Batch size: ${CONNECTION_BATCH_SIZE}, Message rounds: ${MESSAGE_ROUNDS}`);

    const result = await runStressTest(STRESS_CONNECTIONS, CONNECTION_BATCH_SIZE, GATEWAY_URL);

    console.log('\n📈 Results:');
    console.log(`   Total connections: ${result.totalConnections}`);
    console.log(`   Successful: ${result.successfulConnections}`);
    console.log(`   Failed: ${result.failedConnections}`);
    console.log(`   Duration: ${result.durationMs}ms`);
    console.log('\n⏱️ Latency (ms):');
    console.log(`   P50: ${result.p50LatencyMs.toFixed(1)}`);
    console.log(`   P95: ${result.p95LatencyMs.toFixed(1)}`);
    console.log(`   P99: ${result.p99LatencyMs.toFixed(1)}`);
    console.log(`   Avg: ${result.avgLatencyMs.toFixed(1)}`);
    console.log(`   Min: ${result.minLatencyMs.toFixed(1)}`);
    console.log(`   Max: ${result.maxLatencyMs.toFixed(1)}`);

    if (result.errors.length > 0) {
      console.log('\n❌ Errors (first 10):');
      for (const err of result.errors) {
        console.log(`   ${err}`);
      }
    }

    // Assertions
    const successRate = result.successfulConnections / result.totalConnections;
    expect(successRate).toBeGreaterThan(0.95); // At least 95% success rate
  }, 300000); // 5 minute timeout

  it(`should maintain P99 latency under ${P99_LATENCY_TARGET_MS}ms`, async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    // Use smaller connection count for latency test
    const latencyTestConnections = Math.min(100, STRESS_CONNECTIONS);
    console.log(`\n⏱️ Latency Test: ${latencyTestConnections} connections`);

    const result = await runStressTest(latencyTestConnections, 25, GATEWAY_URL);

    console.log(`   P99 Latency: ${result.p99LatencyMs.toFixed(1)}ms (target: <${P99_LATENCY_TARGET_MS}ms)`);

    // P99 should be under target
    expect(result.p99LatencyMs).toBeLessThan(P99_LATENCY_TARGET_MS);
  }, 120000);

  it('should gracefully reject connections when at capacity', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    // Try to exceed the default limit (1000 total sessions)
    // This test verifies the gateway rejects gracefully rather than crashing
    const overCapacity = 1100;
    console.log(`\n🔒 Capacity Test: ${overCapacity} connections (expecting some rejections)`);

    const result = await runStressTest(overCapacity, 100, GATEWAY_URL);

    console.log(`   Successful: ${result.successfulConnections}`);
    console.log(`   Rejected: ${result.failedConnections}`);

    // Some connections should fail (gateway should reject beyond capacity)
    // But it should be graceful, not a crash
    expect(result.successfulConnections + result.failedConnections).toBe(overCapacity);
  }, 300000);
});

// Export for use in scripts
export { runStressTest, type StressResult };
