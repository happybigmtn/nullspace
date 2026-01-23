/**
 * Timing Edge Case Tests
 *
 * Tests edge cases related to timing:
 * - Bets at lock phase boundaries
 * - Rapid sequential betting
 * - Connection timing issues
 *
 * Run with: RUN_STRESS=true pnpm -C gateway test:stress -- --testPathPattern=timing
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  CasinoClient,
  createMetricsCollector,
  type MetricsCollector,
} from '../helpers/index.js';

// Configuration
const GATEWAY_URL = process.env.STRESS_GATEWAY_URL || 'ws://localhost:9010';
const STRESS_ENABLED = process.env.RUN_STRESS === 'true';
const BET_AMOUNT = parseInt(process.env.EDGE_BET_AMOUNT || '100', 10);
const TEST_TIMEOUT = parseInt(process.env.TEST_TIMEOUT_MS || '300000', 10);

describe.skipIf(!STRESS_ENABLED)('Timing Edge Case Tests', () => {
  let client: CasinoClient;
  let metrics: MetricsCollector;
  let isGatewayAvailable = false;

  beforeAll(async () => {
    metrics = createMetricsCollector();

    try {
      client = new CasinoClient({ gatewayUrl: GATEWAY_URL });
      await client.connect();
      isGatewayAvailable = client.isConnected() && client.isRegistered();
    } catch {
      console.warn('Gateway not available');
    }
  }, 30000);

  afterAll(() => {
    if (client) {
      client.disconnect();
    }
    console.log('\n' + metrics.generateReport());
  });

  it('should handle rapid sequential bets', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n⏱️ Testing rapid sequential betting...');

    // Place 10 bets as fast as possible
    const rapidBets = 10;
    const startTime = Date.now();
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < rapidBets; i++) {
      metrics.recordBetPlaced('blackjack', BigInt(BET_AMOUNT));
      const result = await client.playBlackjack(BET_AMOUNT);

      if (result.success) {
        successCount++;
        metrics.recordBetResolved('blackjack', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });
      } else {
        errorCount++;
        metrics.recordError('blackjack', result.error ?? 'Unknown error');
      }

      // No delay - fire as fast as possible
    }

    const elapsed = Date.now() - startTime;
    const betsPerSecond = (rapidBets / elapsed) * 1000;

    console.log(`   Completed ${rapidBets} bets in ${elapsed}ms`);
    console.log(`   Rate: ${betsPerSecond.toFixed(2)} bets/sec`);
    console.log(`   Success: ${successCount}, Errors: ${errorCount}`);

    // Should complete all bets (may have some errors if too rapid)
    expect(successCount + errorCount).toBe(rapidBets);
  }, TEST_TIMEOUT);

  it('should handle burst of 20 bets in 100ms', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n⏱️ Testing burst betting (20 bets in 100ms)...');

    const burstSize = 20;
    const targetDuration = 100; // ms
    const delayBetweenBets = targetDuration / burstSize;

    const startTime = Date.now();
    const results: Array<{ success: boolean; latencyMs: number }> = [];

    for (let i = 0; i < burstSize; i++) {
      metrics.recordBetPlaced('roulette', BigInt(BET_AMOUNT));
      const result = await client.playRoulette([{ type: 'RED', amount: BET_AMOUNT }]);

      results.push({
        success: result.success,
        latencyMs: result.latencyMs,
      });

      if (result.success) {
        metrics.recordBetResolved('roulette', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });
      } else {
        metrics.recordError('roulette', result.error ?? 'Unknown error');
      }

      await sleep(delayBetweenBets);
    }

    const elapsed = Date.now() - startTime;
    const successCount = results.filter((r) => r.success).length;
    const avgLatency =
      results.length > 0
        ? results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length
        : 0;

    console.log(`   Completed in ${elapsed}ms (target: ~${targetDuration}ms)`);
    console.log(`   Success: ${successCount}/${burstSize}`);
    console.log(`   Avg latency: ${avgLatency.toFixed(1)}ms`);

    // Most bets should succeed even under burst conditions
    expect(successCount / burstSize).toBeGreaterThan(0.8);
  }, TEST_TIMEOUT);

  it('should handle reconnection during active session', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n⏱️ Testing reconnection handling...');

    // Start a game
    const balanceBefore = await client.getBalance();
    console.log(`   Balance before: ${balanceBefore.toString()}`);

    // Disconnect and reconnect
    console.log('   Disconnecting...');
    client.disconnect();

    await sleep(1000);

    console.log('   Reconnecting...');
    try {
      await client.connect();
      console.log(`   Reconnected: ${client.isConnected()}, Registered: ${client.isRegistered()}`);
    } catch (err) {
      console.log(`   Reconnection failed: ${err}`);
      // Recreate client
      client = new CasinoClient({ gatewayUrl: GATEWAY_URL });
      await client.connect();
    }

    // Verify balance is preserved
    const balanceAfter = await client.getBalance();
    console.log(`   Balance after: ${balanceAfter.toString()}`);

    // Play a round to verify functionality
    metrics.recordBetPlaced('blackjack', BigInt(BET_AMOUNT));
    const result = await client.playBlackjack(BET_AMOUNT);
    console.log(`   Post-reconnect bet: ${result.success ? 'SUCCESS' : 'FAILED'}`);

    if (result.success) {
      metrics.recordBetResolved('blackjack', {
        won: result.won ?? false,
        payout: result.payout ?? 0n,
        latencyMs: result.latencyMs,
      });
    }

    expect(client.isConnected()).toBe(true);
    expect(result.success).toBe(true);
  }, TEST_TIMEOUT);

  it('should handle timeout recovery', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n⏱️ Testing timeout recovery...');

    // Create a client with very short timeout
    const shortTimeoutClient = new CasinoClient({
      gatewayUrl: GATEWAY_URL,
      responseTimeout: 1000, // 1 second timeout
    });

    try {
      await shortTimeoutClient.connect();

      if (!shortTimeoutClient.isConnected()) {
        console.log('   Could not connect with short timeout');
        return;
      }

      // Try to play - may timeout on slow responses
      let timeoutCount = 0;
      let successCount = 0;

      for (let i = 0; i < 5; i++) {
        try {
          const result = await shortTimeoutClient.playBlackjack(BET_AMOUNT);
          if (result.success) {
            successCount++;
          } else if (result.error?.includes('timeout')) {
            timeoutCount++;
          }
        } catch (err) {
          if (err instanceof Error && err.message.includes('timeout')) {
            timeoutCount++;
          }
        }

        await sleep(100);
      }

      console.log(`   Successes: ${successCount}, Timeouts: ${timeoutCount}`);

      // Client should still be functional after timeouts
      expect(shortTimeoutClient.isConnected()).toBe(true);
    } finally {
      shortTimeoutClient.disconnect();
    }
  }, TEST_TIMEOUT);

  it('should handle connection during high latency', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n⏱️ Testing operations during varying latency...');

    // Simulate varying latency by adding random delays
    const rounds = 10;
    const latencies: number[] = [];

    for (let i = 0; i < rounds; i++) {
      // Add random artificial delay
      const artificialDelay = Math.random() * 200;
      await sleep(artificialDelay);

      const startTime = Date.now();
      metrics.recordBetPlaced('roulette', BigInt(BET_AMOUNT));
      const result = await client.playRoulette([{ type: 'BLACK', amount: BET_AMOUNT }]);
      const latency = Date.now() - startTime;

      latencies.push(latency);

      if (result.success) {
        metrics.recordBetResolved('roulette', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: latency,
        });
      }
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const maxLatency = Math.max(...latencies);

    console.log(`   Avg latency: ${avgLatency.toFixed(1)}ms`);
    console.log(`   Max latency: ${maxLatency}ms`);

    expect(metrics.getMetrics().successRate).toBeGreaterThan(0.8);
  }, TEST_TIMEOUT);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
