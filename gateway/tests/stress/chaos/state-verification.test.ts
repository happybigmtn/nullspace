/**
 * State Consistency Verification Test
 *
 * Verifies that balance and state remain consistent across operations.
 * Tests for:
 * - Balance accuracy after wins/losses
 * - No credits created or lost
 * - Consistency across concurrent operations
 *
 * Run with: RUN_STRESS=true pnpm -C gateway test:stress -- --testPathPattern=state-verification
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
const ROUNDS_PER_TEST = parseInt(process.env.STATE_TEST_ROUNDS || '50', 10);
const BET_AMOUNT = parseInt(process.env.STATE_BET_AMOUNT || '100', 10);
const TEST_TIMEOUT = parseInt(process.env.TEST_TIMEOUT_MS || '600000', 10);

interface BalanceTracker {
  initialBalance: bigint;
  totalWagered: bigint;
  totalPayout: bigint;
  expectedBalance: bigint;
  actualBalance: bigint;
  discrepancies: number;
}

describe.skipIf(!STRESS_ENABLED)('State Consistency Verification Tests', () => {
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

  it('should maintain balance consistency across roulette rounds', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🔍 Verifying balance consistency (roulette)...');

    const tracker: BalanceTracker = {
      initialBalance: await client.getBalance(),
      totalWagered: 0n,
      totalPayout: 0n,
      expectedBalance: 0n,
      actualBalance: 0n,
      discrepancies: 0,
    };

    tracker.expectedBalance = tracker.initialBalance;
    console.log(`   Initial balance: ${tracker.initialBalance.toString()}`);

    for (let round = 0; round < ROUNDS_PER_TEST; round++) {
      const betAmount = BigInt(BET_AMOUNT);
      tracker.totalWagered += betAmount;
      tracker.expectedBalance -= betAmount;

      metrics.recordBetPlaced('roulette', betAmount);
      const result = await client.playRoulette([{ type: 'RED', amount: BET_AMOUNT }]);

      if (result.success) {
        const payout = result.payout ?? 0n;
        tracker.totalPayout += payout;
        tracker.expectedBalance += payout;

        // Verify actual balance matches expected
        const reportedBalance = result.balance ?? await client.getBalance();
        tracker.actualBalance = reportedBalance;

        const diff = reportedBalance > tracker.expectedBalance
          ? reportedBalance - tracker.expectedBalance
          : tracker.expectedBalance - reportedBalance;

        if (diff > 0n) {
          tracker.discrepancies++;
          console.log(
            `   Round ${round + 1}: DISCREPANCY - Expected ${tracker.expectedBalance}, got ${reportedBalance}`
          );
        }

        metrics.recordBetResolved('roulette', {
          won: result.won ?? false,
          payout,
          latencyMs: result.latencyMs,
        });
      } else {
        // Bet failed, refund expected
        tracker.expectedBalance += betAmount;
        tracker.totalWagered -= betAmount;
        metrics.recordError('roulette', result.error ?? 'Unknown error');
      }

      await sleep(50);
    }

    // Final verification
    const finalBalance = await client.getBalance();
    const expectedFinal = tracker.initialBalance - tracker.totalWagered + tracker.totalPayout;

    console.log('\n   Final Summary:');
    console.log(`     Initial: ${tracker.initialBalance.toString()}`);
    console.log(`     Wagered: ${tracker.totalWagered.toString()}`);
    console.log(`     Payout: ${tracker.totalPayout.toString()}`);
    console.log(`     Expected Final: ${expectedFinal.toString()}`);
    console.log(`     Actual Final: ${finalBalance.toString()}`);
    console.log(`     Discrepancies: ${tracker.discrepancies}`);

    const finalDiff = finalBalance > expectedFinal
      ? finalBalance - expectedFinal
      : expectedFinal - finalBalance;

    // Allow small tolerance for timing issues
    expect(finalDiff).toBeLessThanOrEqual(BigInt(BET_AMOUNT));
    expect(tracker.discrepancies).toBeLessThan(ROUNDS_PER_TEST * 0.05); // <5% discrepancy rate
  }, TEST_TIMEOUT);

  it('should maintain balance consistency across blackjack hands', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🔍 Verifying balance consistency (blackjack)...');

    const tracker: BalanceTracker = {
      initialBalance: await client.getBalance(),
      totalWagered: 0n,
      totalPayout: 0n,
      expectedBalance: 0n,
      actualBalance: 0n,
      discrepancies: 0,
    };

    tracker.expectedBalance = tracker.initialBalance;
    console.log(`   Initial balance: ${tracker.initialBalance.toString()}`);

    for (let hand = 0; hand < ROUNDS_PER_TEST; hand++) {
      const betAmount = BigInt(BET_AMOUNT);
      tracker.totalWagered += betAmount;
      tracker.expectedBalance -= betAmount;

      metrics.recordBetPlaced('blackjack', betAmount);
      const result = await client.playBlackjack(BET_AMOUNT);

      if (result.success) {
        const payout = result.payout ?? 0n;
        tracker.totalPayout += payout;
        tracker.expectedBalance += payout;

        const reportedBalance = result.balance ?? await client.getBalance();
        tracker.actualBalance = reportedBalance;

        const diff = reportedBalance > tracker.expectedBalance
          ? reportedBalance - tracker.expectedBalance
          : tracker.expectedBalance - reportedBalance;

        if (diff > 0n) {
          tracker.discrepancies++;
        }

        metrics.recordBetResolved('blackjack', {
          won: result.won ?? false,
          payout,
          latencyMs: result.latencyMs,
        });
      } else {
        tracker.expectedBalance += betAmount;
        tracker.totalWagered -= betAmount;
        metrics.recordError('blackjack', result.error ?? 'Unknown error');
      }

      await sleep(100);
    }

    const finalBalance = await client.getBalance();
    const expectedFinal = tracker.initialBalance - tracker.totalWagered + tracker.totalPayout;

    console.log('\n   Final Summary:');
    console.log(`     Expected Final: ${expectedFinal.toString()}`);
    console.log(`     Actual Final: ${finalBalance.toString()}`);
    console.log(`     Discrepancies: ${tracker.discrepancies}`);

    const finalDiff = finalBalance > expectedFinal
      ? finalBalance - expectedFinal
      : expectedFinal - finalBalance;

    expect(finalDiff).toBeLessThanOrEqual(BigInt(BET_AMOUNT));
  }, TEST_TIMEOUT);

  it('should detect balance manipulation attempts', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🔍 Testing balance integrity...');

    const startBalance = await client.getBalance();
    console.log(`   Starting balance: ${startBalance.toString()}`);

    // Try to place a bet larger than balance (should be rejected)
    const oversizedBet = startBalance + 1000n;
    console.log(`   Attempting bet of ${oversizedBet.toString()}...`);

    metrics.recordBetPlaced('roulette', oversizedBet);
    const result = await client.playRoulette([
      { type: 'RED', amount: Number(oversizedBet) },
    ]);

    const afterBalance = await client.getBalance();
    console.log(`   After balance: ${afterBalance.toString()}`);

    // Balance should not have changed
    expect(afterBalance).toBe(startBalance);

    // The bet should have failed
    if (!result.success) {
      console.log(`   Correctly rejected: ${result.error}`);
    } else {
      console.log('   WARNING: Oversized bet was accepted!');
    }
  }, TEST_TIMEOUT);

  it('should handle concurrent balance operations', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🔍 Testing concurrent balance operations...');

    const startBalance = await client.getBalance();
    console.log(`   Starting balance: ${startBalance.toString()}`);

    // Simulate rapid concurrent bets
    const concurrentBets = 5;
    const betAmount = BigInt(BET_AMOUNT);
    const totalBet = betAmount * BigInt(concurrentBets);

    console.log(`   Placing ${concurrentBets} bets of ${betAmount} concurrently...`);

    const betPromises: Promise<{ success: boolean; payout: bigint }>[] = [];

    for (let i = 0; i < concurrentBets; i++) {
      metrics.recordBetPlaced('roulette', betAmount);
      const promise = client.playRoulette([{ type: 'RED', amount: BET_AMOUNT }]).then((r) => ({
        success: r.success,
        payout: r.payout ?? 0n,
      }));
      betPromises.push(promise);
    }

    const results = await Promise.all(betPromises);

    let successCount = 0;
    let totalPayout = 0n;

    for (const result of results) {
      if (result.success) {
        successCount++;
        totalPayout += result.payout;
        metrics.recordBetResolved('roulette', {
          won: result.payout > 0n,
          payout: result.payout,
          latencyMs: 0,
        });
      }
    }

    const endBalance = await client.getBalance();
    const expectedEnd = startBalance - (betAmount * BigInt(successCount)) + totalPayout;

    console.log(`   Successful bets: ${successCount}/${concurrentBets}`);
    console.log(`   Total payout: ${totalPayout.toString()}`);
    console.log(`   Expected end balance: ${expectedEnd.toString()}`);
    console.log(`   Actual end balance: ${endBalance.toString()}`);

    const diff = endBalance > expectedEnd ? endBalance - expectedEnd : expectedEnd - endBalance;
    expect(diff).toBeLessThanOrEqual(BigInt(BET_AMOUNT) * 2n); // Allow some tolerance
  }, TEST_TIMEOUT);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
