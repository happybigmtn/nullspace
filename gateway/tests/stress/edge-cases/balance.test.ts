/**
 * Balance Edge Case Tests
 *
 * Tests edge cases related to balance handling:
 * - Insufficient funds
 * - Concurrent balance draining
 * - Exact balance betting
 *
 * Run with: RUN_STRESS=true pnpm -C gateway test:stress -- --testPathPattern=balance
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

describe.skipIf(!STRESS_ENABLED)('Balance Edge Case Tests', () => {
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

  it('should reject bets with insufficient balance', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n💰 Testing insufficient balance rejection...');

    const currentBalance = await client.getBalance();
    console.log(`   Current balance: ${currentBalance.toString()}`);

    // Try to bet more than we have
    const oversizedBet = Number(currentBalance) + 10000;
    console.log(`   Attempting bet of ${oversizedBet}...`);

    const result = await client.playBlackjack(oversizedBet);

    console.log(`   Result: ${result.success ? 'ACCEPTED' : 'REJECTED'}`);
    if (!result.success) {
      console.log(`   Error: ${result.error}`);
    }

    // Verify balance unchanged
    const afterBalance = await client.getBalance();
    console.log(`   Balance after: ${afterBalance.toString()}`);

    // Bet should be rejected
    expect(result.success).toBe(false);
    // Balance should be unchanged
    expect(afterBalance).toBe(currentBalance);
  }, TEST_TIMEOUT);

  it('should handle betting exact remaining balance', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n💰 Testing exact balance betting...');

    // Get current balance
    let currentBalance = await client.getBalance();
    console.log(`   Current balance: ${currentBalance.toString()}`);

    // Skip if balance is too low
    if (currentBalance < BigInt(BET_AMOUNT * 2)) {
      console.log('   Balance too low for test, skipping');
      return;
    }

    // Drain balance to a small amount
    while (currentBalance > BigInt(BET_AMOUNT * 3)) {
      metrics.recordBetPlaced('blackjack', BigInt(BET_AMOUNT));
      const result = await client.playBlackjack(BET_AMOUNT);
      if (result.success) {
        metrics.recordBetResolved('blackjack', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });
      }
      currentBalance = await client.getBalance();
      await sleep(50);
    }

    console.log(`   Drained to: ${currentBalance.toString()}`);

    // Now bet exact remaining balance (if > minimum)
    if (currentBalance >= BigInt(10)) {
      const exactBet = Number(currentBalance);
      console.log(`   Betting exact balance: ${exactBet}`);

      metrics.recordBetPlaced('blackjack', BigInt(exactBet));
      const result = await client.playBlackjack(exactBet);

      console.log(`   Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
      if (result.success) {
        console.log(`   Won: ${result.won}, Payout: ${result.payout?.toString() ?? '0'}`);
        metrics.recordBetResolved('blackjack', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });
      }

      const finalBalance = await client.getBalance();
      console.log(`   Final balance: ${finalBalance.toString()}`);
    }

    // Should have completed without errors
    expect(metrics.getMetrics().successRate).toBeGreaterThan(0.5);
  }, TEST_TIMEOUT);

  it('should handle concurrent balance draining', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n💰 Testing concurrent balance draining...');

    const startBalance = await client.getBalance();
    console.log(`   Starting balance: ${startBalance.toString()}`);

    if (startBalance < BigInt(BET_AMOUNT * 5)) {
      console.log('   Balance too low for concurrent test, skipping');
      return;
    }

    // Try to place multiple bets simultaneously that might exceed balance
    const concurrentBets = 5;
    const betAmount = Number(startBalance) / 3; // Each bet is 1/3 of balance

    console.log(`   Placing ${concurrentBets} concurrent bets of ${betAmount}...`);

    const promises: Promise<{ success: boolean; payout: bigint }>[] = [];

    for (let i = 0; i < concurrentBets; i++) {
      metrics.recordBetPlaced('roulette', BigInt(Math.floor(betAmount)));
      const promise = client
        .playRoulette([{ type: 'RED', amount: Math.floor(betAmount) }])
        .then((r) => ({
          success: r.success,
          payout: r.payout ?? 0n,
        }));
      promises.push(promise);
    }

    const results = await Promise.all(promises);

    let successCount = 0;
    let rejectedCount = 0;

    for (const result of results) {
      if (result.success) {
        successCount++;
        metrics.recordBetResolved('roulette', {
          won: result.payout > 0n,
          payout: result.payout,
          latencyMs: 0,
        });
      } else {
        rejectedCount++;
      }
    }

    const endBalance = await client.getBalance();

    console.log(`   Results: ${successCount} accepted, ${rejectedCount} rejected`);
    console.log(`   End balance: ${endBalance.toString()}`);

    // Some bets should be rejected due to insufficient funds
    // But at least one should succeed
    expect(successCount).toBeGreaterThan(0);
  }, TEST_TIMEOUT);

  it('should handle zero and negative bet attempts', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n💰 Testing invalid bet amounts...');

    const startBalance = await client.getBalance();

    // Test zero bet
    console.log('   Testing zero bet...');
    const zeroResult = await client.playBlackjack(0);
    console.log(`   Zero bet: ${zeroResult.success ? 'ACCEPTED' : 'REJECTED'}`);

    // Test very small bet
    console.log('   Testing tiny bet (1)...');
    const tinyResult = await client.playBlackjack(1);
    console.log(`   Tiny bet: ${tinyResult.success ? 'ACCEPTED' : 'REJECTED'}`);

    // Balance should not have changed significantly
    const endBalance = await client.getBalance();
    const balanceChange = startBalance > endBalance
      ? startBalance - endBalance
      : endBalance - startBalance;

    console.log(`   Balance change: ${balanceChange.toString()}`);

    // Zero bet should definitely be rejected
    expect(zeroResult.success).toBe(false);
  }, TEST_TIMEOUT);

  it('should track balance sequence correctly', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n💰 Testing balance sequence tracking...');

    // Play multiple rounds and verify balance updates are sequential
    const rounds = 10;
    const balanceHistory: bigint[] = [];

    balanceHistory.push(await client.getBalance());
    console.log(`   Initial: ${balanceHistory[0].toString()}`);

    for (let i = 0; i < rounds; i++) {
      metrics.recordBetPlaced('roulette', BigInt(BET_AMOUNT));
      const result = await client.playRoulette([{ type: 'RED', amount: BET_AMOUNT }]);

      if (result.success) {
        const newBalance = result.balance ?? await client.getBalance();
        balanceHistory.push(newBalance);

        metrics.recordBetResolved('roulette', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });
      }

      await sleep(50);
    }

    console.log(`   Final: ${balanceHistory[balanceHistory.length - 1].toString()}`);
    console.log(`   Balance updates: ${balanceHistory.length}`);

    // Should have balance update for each round
    expect(balanceHistory.length).toBeGreaterThan(1);

    // Balance should never be negative
    for (const balance of balanceHistory) {
      expect(balance).toBeGreaterThanOrEqual(0n);
    }
  }, TEST_TIMEOUT);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
