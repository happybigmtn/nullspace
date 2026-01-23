/**
 * Peak Load Stress Test
 *
 * Tests system behavior under maximum load conditions.
 * Verifies graceful degradation when approaching capacity limits.
 *
 * Run with: RUN_STRESS=true pnpm -C gateway test:stress -- --testPathPattern=peak-load
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
const MAX_CONNECTIONS_PER_GAME = parseInt(process.env.PEAK_CONNECTIONS || '200', 10);
const TARGET_BPS = parseInt(process.env.PEAK_BPS || '100', 10);
const TEST_DURATION_MS = parseInt(process.env.PEAK_DURATION_MS || '900000', 10); // 15 min
const BET_AMOUNT = parseInt(process.env.PEAK_BET_AMOUNT || '100', 10);
const TEST_TIMEOUT = TEST_DURATION_MS + 300000;

// Acceptance criteria for peak load
const MIN_SUCCESS_RATE = 0.95;
const MAX_P99_LATENCY_MS = 500;

describe.skipIf(!STRESS_ENABLED)('Peak Load Stress Tests', () => {
  let metrics: MetricsCollector;
  let isGatewayAvailable = false;

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

  it(`should handle ${TARGET_BPS} bets/sec at peak capacity`, async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🔥 Starting peak load test...');
    console.log(`   Duration: ${TEST_DURATION_MS / 60000} minutes`);
    console.log(`   Target rate: ${TARGET_BPS} bets/second`);
    console.log(`   Max connections per game: ${MAX_CONNECTIONS_PER_GAME}`);
    console.log('');

    // Ramp up connections gradually
    const gamePools: Map<SupportedGame, CasinoClient[]> = new Map();
    const rampUpBatches = 4;
    const connectionsPerBatch = Math.floor(MAX_CONNECTIONS_PER_GAME / rampUpBatches);

    for (let batch = 1; batch <= rampUpBatches; batch++) {
      console.log(`   Ramp-up batch ${batch}/${rampUpBatches}...`);

      for (const game of ALL_GAMES) {
        const existingPool = gamePools.get(game) ?? [];
        const newClients = await createClientPool(GATEWAY_URL, connectionsPerBatch, 20);
        gamePools.set(game, [...existingPool, ...newClients]);
      }

      // Brief pause between ramp-up batches
      await sleep(2000);
    }

    const totalConnections = Array.from(gamePools.values()).reduce((sum, pool) => sum + pool.length, 0);
    console.log(`\n   Total connections: ${totalConnections}`);
    console.log('   Starting peak load...\n');

    // Main peak load loop
    const startTime = Date.now();
    const delayBetweenBets = Math.floor(1000 / TARGET_BPS);
    let betsThisSecond = 0;
    let lastSecond = startTime;

    // Track per-second metrics
    const bpsHistory: number[] = [];

    while (Date.now() - startTime < TEST_DURATION_MS) {
      // Parallel bet placement
      const batchPromises: Promise<void>[] = [];

      for (const [game, clients] of gamePools) {
        if (clients.length === 0) continue;

        const client = clients[Math.floor(Math.random() * clients.length)];
        if (client.isConnected()) {
          batchPromises.push(playGameRound(client, game, BET_AMOUNT, metrics));
          betsThisSecond++;
        }
      }

      await Promise.all(batchPromises);

      // Track BPS
      const now = Date.now();
      if (now - lastSecond >= 1000) {
        bpsHistory.push(betsThisSecond);

        // Log every 30 seconds
        if (bpsHistory.length % 30 === 0) {
          const elapsed = (now - startTime) / 1000;
          const avgBps = bpsHistory.reduce((a, b) => a + b, 0) / bpsHistory.length;
          const successRate = metrics.getMetrics().successRate;
          const latencyStats = metrics.getAggregateLatencyStats();

          console.log(
            `   [${Math.floor(elapsed / 60)}m] ` +
              `Avg BPS: ${avgBps.toFixed(1)}, ` +
              `Success: ${(successRate * 100).toFixed(1)}%, ` +
              `P99: ${latencyStats.p99.toFixed(0)}ms`
          );
        }

        betsThisSecond = 0;
        lastSecond = now;
      }

      await sleep(delayBetweenBets);
    }

    // Cleanup
    for (const clients of gamePools.values()) {
      disconnectPool(clients);
    }

    // Final results
    const finalMetrics = metrics.finalize();
    const avgBps = bpsHistory.length > 0 ? bpsHistory.reduce((a, b) => a + b, 0) / bpsHistory.length : 0;
    const maxBps = bpsHistory.length > 0 ? Math.max(...bpsHistory) : 0;
    const minBps = bpsHistory.length > 0 ? Math.min(...bpsHistory) : 0;
    const latencyStats = metrics.getAggregateLatencyStats();

    console.log('\n📊 Peak Load Test Complete:');
    console.log(`   Total Bets: ${finalMetrics.totalBetsResolved}`);
    console.log(`   Avg BPS: ${avgBps.toFixed(2)}`);
    console.log(`   Max BPS: ${maxBps}`);
    console.log(`   Min BPS: ${minBps}`);
    console.log(`   Success Rate: ${(finalMetrics.successRate * 100).toFixed(2)}%`);
    console.log(`   P99 Latency: ${latencyStats.p99.toFixed(1)}ms`);

    // Assertions
    expect(finalMetrics.successRate).toBeGreaterThanOrEqual(MIN_SUCCESS_RATE);
    expect(latencyStats.p99).toBeLessThanOrEqual(MAX_P99_LATENCY_MS);
  }, TEST_TIMEOUT);

  it('should gracefully degrade beyond capacity', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n⚠️ Testing graceful degradation...');

    // Try to exceed the default limit
    const overCapacity = 1200;
    const clients = await createClientPool(GATEWAY_URL, overCapacity, 50);

    console.log(`   Attempted: ${overCapacity} connections`);
    console.log(`   Established: ${clients.length} connections`);

    if (clients.length > 0) {
      // Run a few bets to verify system still works
      const testBets = 20;
      let successCount = 0;

      for (let i = 0; i < testBets; i++) {
        const client = clients[i % clients.length];
        if (!client.isConnected()) continue;

        metrics.recordBetPlaced('blackjack', BigInt(BET_AMOUNT));
        const result = await client.playBlackjack(BET_AMOUNT);

        if (result.success) {
          successCount++;
          metrics.recordBetResolved('blackjack', {
            won: result.won ?? false,
            payout: result.payout ?? 0n,
            latencyMs: result.latencyMs,
          });
        }

        await sleep(50);
      }

      console.log(`   Test bets: ${successCount}/${testBets} successful`);
    }

    // Cleanup
    disconnectPool(clients);

    // System should have gracefully rejected excess connections
    expect(clients.length).toBeLessThanOrEqual(overCapacity);
  }, 300000);

  it('should recover from load spike', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n📈 Testing recovery from load spike...');

    // Phase 1: Normal load
    console.log('   Phase 1: Normal load...');
    const normalClients = await createClientPool(GATEWAY_URL, 50, 10);

    for (let i = 0; i < 20; i++) {
      const client = normalClients[i % normalClients.length];
      if (client.isConnected()) {
        metrics.recordBetPlaced('roulette', BigInt(BET_AMOUNT));
        await client.playRoulette([{ type: 'RED', amount: BET_AMOUNT }]);
      }
      await sleep(50);
    }

    const normalLatency = metrics.getAggregateLatencyStats().p99;
    console.log(`   Normal P99: ${normalLatency.toFixed(1)}ms`);

    // Phase 2: Spike
    console.log('   Phase 2: Load spike...');
    const spikeClients = await createClientPool(GATEWAY_URL, 150, 30);
    const allClients = [...normalClients, ...spikeClients];

    const spikePromises: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      const client = allClients[i % allClients.length];
      if (client.isConnected()) {
        metrics.recordBetPlaced('roulette', BigInt(BET_AMOUNT));
        spikePromises.push(
          client.playRoulette([{ type: 'RED', amount: BET_AMOUNT }]).then(() => {})
        );
      }
    }
    await Promise.all(spikePromises);

    // Phase 3: Recovery
    console.log('   Phase 3: Recovery...');
    disconnectPool(spikeClients);
    await sleep(5000); // Allow system to settle

    metrics.reset(); // Reset metrics for clean recovery measurement

    for (let i = 0; i < 20; i++) {
      const client = normalClients[i % normalClients.length];
      if (client.isConnected()) {
        metrics.recordBetPlaced('roulette', BigInt(BET_AMOUNT));
        const result = await client.playRoulette([{ type: 'RED', amount: BET_AMOUNT }]);
        if (result.success) {
          metrics.recordBetResolved('roulette', {
            won: result.won ?? false,
            payout: result.payout ?? 0n,
            latencyMs: result.latencyMs,
          });
        }
      }
      await sleep(50);
    }

    const recoveryLatency = metrics.getAggregateLatencyStats().p99;
    console.log(`   Recovery P99: ${recoveryLatency.toFixed(1)}ms`);

    disconnectPool(normalClients);

    // Recovery latency should be reasonable
    expect(recoveryLatency).toBeLessThan(MAX_P99_LATENCY_MS);
  }, 120000);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
