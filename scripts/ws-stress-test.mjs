#!/usr/bin/env node
/**
 * WebSocket Stress Test Script
 *
 * Standalone script for stress testing the gateway's WebSocket capacity.
 * Can be run independently of the test framework.
 *
 * Usage:
 *   node scripts/ws-stress-test.mjs [options]
 *
 * Environment variables:
 *   GATEWAY_URL=ws://localhost:9010   - Gateway WebSocket URL
 *   CONNECTIONS=1000                  - Number of concurrent connections
 *   BATCH_SIZE=50                     - Connections per batch
 *   MESSAGE_ROUNDS=5                  - Ping rounds per connection
 *   TARGET_CONNECTIONS=10000          - Target for 10k connection test
 *
 * Examples:
 *   # Basic 1k connection test
 *   node scripts/ws-stress-test.mjs
 *
 *   # 10k connection test
 *   CONNECTIONS=10000 node scripts/ws-stress-test.mjs
 *
 *   # Custom gateway
 *   GATEWAY_URL=ws://staging-api.example.com/ws node scripts/ws-stress-test.mjs
 */

import { WebSocket } from 'ws';

// Configuration
const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://localhost:9010';
const CONNECTIONS = parseInt(process.env.CONNECTIONS || '1000', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50', 10);
const MESSAGE_ROUNDS = parseInt(process.env.MESSAGE_ROUNDS || '5', 10);
const CONNECTION_TIMEOUT_MS = parseInt(process.env.CONNECTION_TIMEOUT_MS || '30000', 10);
const MESSAGE_TIMEOUT_MS = parseInt(process.env.MESSAGE_TIMEOUT_MS || '5000', 10);

// Results storage
const latencies = [];
let connectedCount = 0;
let failedCount = 0;
const errors = [];
const connections = [];

/**
 * Calculate percentile from sorted array
 */
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Connect a single WebSocket client
 */
function connectOne(id) {
  return new Promise((resolve) => {
    const start = Date.now();
    try {
      const ws = new WebSocket(GATEWAY_URL);

      const timeout = setTimeout(() => {
        ws.terminate();
        failedCount++;
        errors.push(`Connection ${id} timed out`);
        resolve(null);
      }, CONNECTION_TIMEOUT_MS);

      ws.on('open', () => {
        clearTimeout(timeout);
        connectedCount++;
        latencies.push(Date.now() - start);
        resolve(ws);
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        failedCount++;
        errors.push(`Connection ${id}: ${err.message}`);
        resolve(null);
      });

      ws.on('close', (code) => {
        // Track unexpected closes
        if (code !== 1000 && code !== 1001) {
          console.log(`Connection ${id} closed with code ${code}`);
        }
      });
    } catch (err) {
      failedCount++;
      errors.push(`Connection ${id}: ${err}`);
      resolve(null);
    }
  });
}

/**
 * Measure message round-trip latency
 */
function measureLatency(ws) {
  return new Promise((resolve) => {
    const start = Date.now();
    const timeout = setTimeout(() => {
      resolve(null);
    }, MESSAGE_TIMEOUT_MS);

    const handler = () => {
      clearTimeout(timeout);
      ws.removeListener('message', handler);
      resolve(Date.now() - start);
    };

    ws.on('message', handler);
    ws.send(JSON.stringify({ type: 'ping', ts: start }));
  });
}

/**
 * Print progress bar
 */
function printProgress(current, total, label) {
  const percentage = Math.floor((current / total) * 100);
  const barWidth = 40;
  const filled = Math.floor((current / total) * barWidth);
  const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
  process.stdout.write(`\r${label}: [${bar}] ${percentage}% (${current}/${total})`);
}

/**
 * Main stress test runner
 */
async function runStressTest() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              WebSocket Gateway Stress Test                      ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Gateway URL:   ${GATEWAY_URL}`);
  console.log(`Connections:   ${CONNECTIONS}`);
  console.log(`Batch Size:    ${BATCH_SIZE}`);
  console.log(`Msg Rounds:    ${MESSAGE_ROUNDS}`);
  console.log();

  // Check gateway availability
  console.log('🔍 Checking gateway availability...');
  try {
    const testWs = new WebSocket(GATEWAY_URL);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        testWs.terminate();
        reject(new Error('Gateway not available'));
      }, 5000);
      testWs.on('open', () => {
        clearTimeout(timeout);
        testWs.close();
        resolve();
      });
      testWs.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    console.log('✅ Gateway is available\n');
  } catch (err) {
    console.error(`❌ Gateway not available: ${err.message}`);
    process.exit(1);
  }

  const startTime = Date.now();

  // Phase 1: Connect all clients
  console.log('📡 Phase 1: Connecting clients...');
  const totalBatches = Math.ceil(CONNECTIONS / BATCH_SIZE);

  for (let batch = 0; batch < totalBatches; batch++) {
    const batchStart = batch * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, CONNECTIONS);
    const batchPromises = [];

    for (let i = batchStart; i < batchEnd; i++) {
      batchPromises.push(connectOne(i));
    }

    const results = await Promise.all(batchPromises);
    connections.push(...results.filter((ws) => ws !== null));

    printProgress(batchEnd, CONNECTIONS, 'Connecting');

    // Small delay between batches
    if (batch < totalBatches - 1) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  console.log();

  // Phase 2: Measure message latencies
  if (connections.length > 0 && MESSAGE_ROUNDS > 0) {
    console.log('\n⏱️ Phase 2: Measuring message latencies...');
    const sampleSize = Math.min(100, connections.length);
    const sampledConnections = connections.slice(0, sampleSize);

    for (let round = 0; round < MESSAGE_ROUNDS; round++) {
      const roundLatencies = await Promise.all(
        sampledConnections.map((ws) => measureLatency(ws))
      );

      for (const lat of roundLatencies) {
        if (lat !== null) {
          latencies.push(lat);
        }
      }

      printProgress(round + 1, MESSAGE_ROUNDS, 'Measuring');

      if (round < MESSAGE_ROUNDS - 1) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    console.log();
  }

  const totalDuration = Date.now() - startTime;

  // Phase 3: Close all connections
  console.log('\n🔒 Phase 3: Closing connections...');
  let closed = 0;
  for (const ws of connections) {
    try {
      ws.close(1000);
      closed++;
    } catch {
      // Ignore cleanup errors
    }
    if (closed % 100 === 0) {
      printProgress(closed, connections.length, 'Closing');
    }
  }
  printProgress(connections.length, connections.length, 'Closing');
  console.log();

  // Calculate statistics
  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  const p50 = percentile(sortedLatencies, 50);
  const p95 = percentile(sortedLatencies, 95);
  const p99 = percentile(sortedLatencies, 99);
  const avg =
    sortedLatencies.length > 0
      ? sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length
      : 0;
  const max = sortedLatencies.length > 0 ? sortedLatencies[sortedLatencies.length - 1] : 0;
  const min = sortedLatencies.length > 0 ? sortedLatencies[0] : 0;

  // Print results
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                         RESULTS                                ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║  Total Duration:          ${totalDuration.toString().padStart(10)}ms              ║`);
  console.log(`║  Connections Attempted:   ${CONNECTIONS.toString().padStart(10)}                 ║`);
  console.log(`║  Connections Successful:  ${connectedCount.toString().padStart(10)}                 ║`);
  console.log(`║  Connections Failed:      ${failedCount.toString().padStart(10)}                 ║`);
  console.log(`║  Success Rate:            ${((connectedCount / CONNECTIONS) * 100).toFixed(1).padStart(9)}%                 ║`);
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║  LATENCY (ms)                                                  ║');
  console.log(`║    P50:                   ${p50.toFixed(1).padStart(10)}ms              ║`);
  console.log(`║    P95:                   ${p95.toFixed(1).padStart(10)}ms              ║`);
  console.log(`║    P99:                   ${p99.toFixed(1).padStart(10)}ms              ║`);
  console.log(`║    Average:               ${avg.toFixed(1).padStart(10)}ms              ║`);
  console.log(`║    Min:                   ${min.toFixed(1).padStart(10)}ms              ║`);
  console.log(`║    Max:                   ${max.toFixed(1).padStart(10)}ms              ║`);
  console.log('╚════════════════════════════════════════════════════════════════╝');

  if (errors.length > 0) {
    console.log('\n⚠️ Errors (first 10):');
    for (const err of errors.slice(0, 10)) {
      console.log(`   ${err}`);
    }
  }

  // JSON output for CI parsing
  const jsonResult = {
    gatewayUrl: GATEWAY_URL,
    totalConnections: CONNECTIONS,
    successfulConnections: connectedCount,
    failedConnections: failedCount,
    successRate: connectedCount / CONNECTIONS,
    latencyMs: {
      p50,
      p95,
      p99,
      avg,
      min,
      max,
    },
    durationMs: totalDuration,
    errors: errors.slice(0, 10),
  };

  console.log('\n📊 JSON Output:');
  console.log(JSON.stringify(jsonResult, null, 2));

  // Exit with error if success rate is too low
  const successRate = connectedCount / CONNECTIONS;
  if (successRate < 0.95) {
    console.error(`\n❌ FAILED: Success rate ${(successRate * 100).toFixed(1)}% is below 95% threshold`);
    process.exit(1);
  }

  if (p99 > 100) {
    console.warn(`\n⚠️ WARNING: P99 latency ${p99.toFixed(1)}ms exceeds 100ms target`);
  }

  console.log('\n✅ PASSED');
  process.exit(0);
}

// Run the test
runStressTest().catch((err) => {
  console.error('Stress test failed:', err);
  process.exit(1);
});
