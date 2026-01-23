/**
 * Sustained Load Stress Test
 *
 * Tests system stability under continuous load for extended periods.
 * Default: 2-hour test at 50% capacity.
 *
 * Run with: RUN_STRESS=true pnpm -C gateway test:stress -- --testPathPattern=sustained-load
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  CasinoClient,
  createClientPool,
  disconnectPool,
  createMetricsCollector,
  ALL_GAMES,
  type MetricsCollector,
  type SupportedGame,
} from './helpers/index.js';

// Configuration
const GATEWAY_URL = process.env.STRESS_GATEWAY_URL || 'ws://localhost:9010';
const STRESS_ENABLED = process.env.RUN_STRESS === 'true';
const TEST_DURATION_MS = parseInt(process.env.SUSTAINED_DURATION_MS || '7200000', 10); // 2 hours
const CONNECTIONS_PER_GAME = parseInt(process.env.SUSTAINED_CONNECTIONS || '50', 10);
const TARGET_BPS = parseInt(process.env.SUSTAINED_BPS || '20', 10); // Bets per second
const BET_AMOUNT = parseInt(process.env.SUSTAINED_BET_AMOUNT || '100', 10);
const CHECKPOINT_INTERVAL_MS = 300000; // 5 minute checkpoints
const TEST_TIMEOUT = TEST_DURATION_MS + 300000; // Test duration + 5 min buffer

// Acceptance criteria
const MIN_SUCCESS_RATE = 0.99;
const MAX_P99_LATENCY_MS = 200;
const MAX_MEMORY_GROWTH_PERCENT = 20;

describe.skipIf(!STRESS_ENABLED)('Sustained Load Stress Tests', () => {
  let metrics: MetricsCollector;
  let isGatewayAvailable = false;
  let startMemory: number | null = null;

  beforeAll(async () => {
    metrics = createMetricsCollector();

    try {
      const testClient = new CasinoClient({ gatewayUrl: GATEWAY_URL });
      await testClient.connect();
      isGatewayAvailable = testClient.isConnected();
      testClient.disconnect();
    } catch {
      console.warn('Gateway not available');
    }
  }, 30000);

  afterAll(() => {
    console.log('\n' + metrics.generateReport({ includeLatencyHistogram: true }));
  });

  it(`should sustain ${TARGET_BPS} bets/sec for ${TEST_DURATION_MS / 60000} minutes`, async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n⏱️ Starting sustained load test...');
    console.log(`   Duration: ${TEST_DURATION_MS / 60000} minutes`);
    console.log(`   Target rate: ${TARGET_BPS} bets/second`);
    console.log(`   Connections per game: ${CONNECTIONS_PER_GAME}`);
    console.log('');

    // Create client pools for each game
    const gamePools: Map<SupportedGame, CasinoClient[]> = new Map();

    for (const game of ALL_GAMES) {
      const clients = await createClientPool(GATEWAY_URL, CONNECTIONS_PER_GAME, 10);
      gamePools.set(game, clients);
      console.log(`   ${game}: ${clients.length} connections established`);
    }

    const totalConnections = Array.from(gamePools.values()).reduce((sum, pool) => sum + pool.length, 0);
    console.log(`\n   Total connections: ${totalConnections}`);
    console.log('   Starting sustained load...\n');

    // Calculate delay between bets to hit target rate
    const delayBetweenBets = Math.floor(1000 / TARGET_BPS);
    const startTime = Date.now();
    let lastCheckpoint = startTime;
    let betsThisInterval = 0;

    // Main load loop
    while (Date.now() - startTime < TEST_DURATION_MS) {
      // Round-robin through games and clients
      for (const [game, clients] of gamePools) {
        if (clients.length === 0) continue;

        const clientIndex = Math.floor(Math.random() * clients.length);
        const client = clients[clientIndex];

        if (!client.isConnected()) {
          // Reconnect dropped clients
          try {
            await client.connect();
          } catch {
            continue;
          }
        }

        // Play a round
        await playGameRound(client, game, BET_AMOUNT, metrics);
        betsThisInterval++;

        // Rate limiting
        await sleep(delayBetweenBets);
      }

      // Checkpoint logging
      const now = Date.now();
      if (now - lastCheckpoint >= CHECKPOINT_INTERVAL_MS) {
        const elapsed = (now - startTime) / 1000;
        const totalBets = metrics.getMetrics().totalBetsResolved;
        const actualBps = totalBets / elapsed;
        const successRate = metrics.getMetrics().successRate;
        const latencyStats = metrics.getAggregateLatencyStats();

        console.log(
          `   [${formatDuration(now - startTime)}] ` +
            `Bets: ${totalBets}, Rate: ${actualBps.toFixed(1)}/s, ` +
            `Success: ${(successRate * 100).toFixed(1)}%, ` +
            `P99: ${latencyStats.p99.toFixed(0)}ms`
        );

        lastCheckpoint = now;
        betsThisInterval = 0;
      }
    }

    // Cleanup
    for (const clients of gamePools.values()) {
      disconnectPool(clients);
    }

    // Final metrics
    const finalMetrics = metrics.finalize();
    const duration = finalMetrics.duration ?? TEST_DURATION_MS;
    const totalBets = finalMetrics.totalBetsResolved;
    const actualBps = (totalBets / duration) * 1000;
    const successRate = finalMetrics.successRate;
    const latencyStats = metrics.getAggregateLatencyStats();

    console.log('\n📊 Sustained Load Test Complete:');
    console.log(`   Duration: ${formatDuration(duration)}`);
    console.log(`   Total Bets: ${totalBets}`);
    console.log(`   Actual Rate: ${actualBps.toFixed(2)} bets/sec`);
    console.log(`   Success Rate: ${(successRate * 100).toFixed(2)}%`);
    console.log(`   P99 Latency: ${latencyStats.p99.toFixed(1)}ms`);

    // Assertions
    expect(successRate).toBeGreaterThanOrEqual(MIN_SUCCESS_RATE);
    expect(latencyStats.p99).toBeLessThanOrEqual(MAX_P99_LATENCY_MS);
  }, TEST_TIMEOUT);

  it('should maintain connection stability over time', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🔗 Testing connection stability...');

    const connectionCount = 100;
    const testDurationMs = Math.min(600000, TEST_DURATION_MS); // 10 min or test duration

    const clients = await createClientPool(GATEWAY_URL, connectionCount, 20);
    console.log(`   Connected ${clients.length} clients`);

    if (clients.length === 0) {
      console.warn('   No clients connected, skipping');
      return;
    }

    let droppedConnections = 0;
    let reconnections = 0;
    const startTime = Date.now();

    while (Date.now() - startTime < testDurationMs) {
      for (const client of clients) {
        if (!client.isConnected()) {
          droppedConnections++;
          try {
            await client.connect();
            reconnections++;
          } catch {
            // Failed to reconnect
          }
        }
      }

      await sleep(5000); // Check every 5 seconds
    }

    disconnectPool(clients);

    const activeAtEnd = clients.filter((c) => c.isConnected()).length;
    console.log(`   Dropped connections: ${droppedConnections}`);
    console.log(`   Successful reconnections: ${reconnections}`);
    console.log(`   Active at end: ${activeAtEnd}`);

    // Should maintain most connections
    expect(activeAtEnd / clients.length).toBeGreaterThan(0.9);
  }, TEST_TIMEOUT);
});

async function playGameRound(
  client: CasinoClient,
  game: SupportedGame,
  amount: number,
  metrics: MetricsCollector
): Promise<void> {
  metrics.recordBetPlaced(game, BigInt(amount));

  try {
    let result;

    switch (game) {
      case 'blackjack':
        result = await client.playBlackjack(amount);
        break;
      case 'roulette':
        result = await client.playRoulette([{ type: 'RED', amount }]);
        break;
      case 'craps':
        result = await client.playCraps([{ type: 'PASS', amount }]);
        break;
      case 'baccarat':
        result = await client.playBaccarat([{ type: 'BANKER', amount }]);
        break;
      case 'sicbo':
        result = await client.playSicBo([{ type: 'BIG', amount }]);
        break;
      case 'videopoker':
        result = await client.playVideoPoker(amount);
        break;
      case 'casinowar':
        result = await client.playCasinoWar(amount);
        break;
      case 'hilo':
        result = await client.playHiLo(amount, 'higher');
        break;
      case 'threecard':
        result = await client.playThreeCard(amount);
        break;
      case 'ultimateholdem':
        result = await client.playUltimateHoldem(amount);
        break;
    }

    if (result.success) {
      metrics.recordBetResolved(game, {
        won: result.won ?? false,
        payout: result.payout ?? 0n,
        latencyMs: result.latencyMs,
      });
    } else {
      metrics.recordError(game, result.error ?? 'Unknown error');
    }
  } catch (err) {
    metrics.recordError(game, err instanceof Error ? err.message : String(err));
  }
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
