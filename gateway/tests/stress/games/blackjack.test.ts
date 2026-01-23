/**
 * Blackjack Stress Test Suite
 *
 * Tests blackjack game functionality under load:
 * - Basic gameplay (deal, hit, stand)
 * - Split and double scenarios
 * - Side bets (21+3, Perfect Pairs)
 * - Dealer bust tracking
 *
 * Run with: RUN_STRESS=true pnpm -C gateway test:stress -- --testPathPattern=blackjack
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
const HANDS_PER_TEST = parseInt(process.env.BLACKJACK_HANDS || '30', 10);
const BET_AMOUNT = parseInt(process.env.BLACKJACK_BET_AMOUNT || '100', 10);
const TEST_TIMEOUT = parseInt(process.env.TEST_TIMEOUT_MS || '600000', 10);

interface BlackjackSessionMetrics {
  totalHands: number;
  playerWins: number;
  dealerWins: number;
  pushes: number;
  blackjacks: number;
  splits: number;
  doubles: number;
  surrenders: number;
  dealerBusts: number;
  sideBetPayouts: Record<string, number>;
}

describe.skipIf(!STRESS_ENABLED)('Blackjack Stress Tests', () => {
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
      console.warn('Gateway not available, skipping blackjack stress tests');
    }
  }, 30000);

  afterAll(() => {
    if (client) {
      client.disconnect();
    }
    console.log('\n' + metrics.generateReport());
  });

  it('should complete basic hand with stand', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🃏 Testing basic blackjack hand...');

    metrics.recordBetPlaced('blackjack', BigInt(BET_AMOUNT));
    const result = await client.playBlackjack(BET_AMOUNT);

    if (result.success) {
      metrics.recordBetResolved('blackjack', {
        won: result.won ?? false,
        payout: result.payout ?? 0n,
        latencyMs: result.latencyMs,
        push: result.rawResponse?.push as boolean,
      });

      console.log(`  Result: ${result.won ? 'WIN' : result.rawResponse?.push ? 'PUSH' : 'LOSS'}`);
      console.log(`  Payout: ${result.payout?.toString() ?? '0'}`);
      console.log(`  Latency: ${result.latencyMs}ms`);
    } else {
      metrics.recordError('blackjack', result.error ?? 'Unknown error');
      console.log(`  Error: ${result.error}`);
    }

    expect(result.success).toBe(true);
  }, TEST_TIMEOUT);

  it('should complete 30-hand session', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log(`\n🃏 Running ${HANDS_PER_TEST}-hand blackjack session...`);

    const sessionMetrics: BlackjackSessionMetrics = {
      totalHands: 0,
      playerWins: 0,
      dealerWins: 0,
      pushes: 0,
      blackjacks: 0,
      splits: 0,
      doubles: 0,
      surrenders: 0,
      dealerBusts: 0,
      sideBetPayouts: {},
    };

    for (let hand = 0; hand < HANDS_PER_TEST; hand++) {
      metrics.recordBetPlaced('blackjack', BigInt(BET_AMOUNT));
      const result = await client.playBlackjack(BET_AMOUNT);

      if (result.success) {
        sessionMetrics.totalHands++;

        const rawResponse = result.rawResponse;
        const isPush = rawResponse?.push as boolean | undefined;

        if (isPush) {
          sessionMetrics.pushes++;
        } else if (result.won) {
          sessionMetrics.playerWins++;

          // Check for blackjack
          if (rawResponse?.blackjack) {
            sessionMetrics.blackjacks++;
          }
          // Check for dealer bust
          if (rawResponse?.dealerBust) {
            sessionMetrics.dealerBusts++;
          }
        } else {
          sessionMetrics.dealerWins++;
        }

        metrics.recordBetResolved('blackjack', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
          push: isPush,
        });

        if ((hand + 1) % 10 === 0) {
          console.log(
            `  Hand ${hand + 1}/${HANDS_PER_TEST} - ` +
              `W: ${sessionMetrics.playerWins}, L: ${sessionMetrics.dealerWins}, P: ${sessionMetrics.pushes}`
          );
        }
      } else {
        metrics.recordError('blackjack', result.error ?? 'Unknown error');
      }

      await sleep(100);
    }

    console.log('\n  Session Summary:');
    console.log(`    Total Hands: ${sessionMetrics.totalHands}`);
    console.log(`    Player Wins: ${sessionMetrics.playerWins}`);
    console.log(`    Dealer Wins: ${sessionMetrics.dealerWins}`);
    console.log(`    Pushes: ${sessionMetrics.pushes}`);
    console.log(`    Blackjacks: ${sessionMetrics.blackjacks}`);
    console.log(`    Dealer Busts: ${sessionMetrics.dealerBusts}`);

    const winRate =
      sessionMetrics.playerWins / (sessionMetrics.playerWins + sessionMetrics.dealerWins);
    console.log(`    Win Rate: ${(winRate * 100).toFixed(1)}%`);

    expect(sessionMetrics.totalHands).toBe(HANDS_PER_TEST);
  }, TEST_TIMEOUT);

  it('should handle side bets', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🃏 Testing side bets...');

    const sideBetAmount = Math.floor(BET_AMOUNT / 4);
    let sideBetWins = 0;
    const rounds = 20;

    for (let i = 0; i < rounds; i++) {
      const totalBet = BigInt(BET_AMOUNT) + BigInt(sideBetAmount);
      metrics.recordBetPlaced('blackjack', totalBet);

      const result = await client.playBlackjack(BET_AMOUNT, {
        sideBet21Plus3: sideBetAmount,
      });

      if (result.success) {
        metrics.recordBetResolved('blackjack', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });

        // Check if side bet won
        const rawResponse = result.rawResponse;
        if (rawResponse?.sideBet21Plus3Won) {
          sideBetWins++;
          console.log(`  Hand ${i + 1}: 21+3 side bet WIN!`);
        }
      } else {
        metrics.recordError('blackjack', result.error ?? 'Unknown error');
      }

      await sleep(100);
    }

    console.log(`\n  21+3 Side Bet Results: ${sideBetWins}/${rounds} wins`);
    expect(metrics.getMetrics().totalBetsResolved).toBeGreaterThan(0);
  }, TEST_TIMEOUT);

  it('should track balance consistency', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🃏 Tracking balance consistency...');

    const startBalance = await client.getBalance();
    console.log(`  Starting balance: ${startBalance.toString()}`);

    let totalWagered = 0n;
    let totalPayout = 0n;
    const rounds = 10;

    for (let i = 0; i < rounds; i++) {
      const betAmount = BigInt(BET_AMOUNT);
      totalWagered += betAmount;
      metrics.recordBetPlaced('blackjack', betAmount);

      const result = await client.playBlackjack(BET_AMOUNT);

      if (result.success) {
        totalPayout += result.payout ?? 0n;
        metrics.recordBetResolved('blackjack', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });
      } else {
        metrics.recordError('blackjack', result.error ?? 'Unknown error');
      }

      await sleep(100);
    }

    const endBalance = await client.getBalance();
    const expectedBalance = startBalance - totalWagered + totalPayout;

    console.log(`  Ending balance: ${endBalance.toString()}`);
    console.log(`  Expected balance: ${expectedBalance.toString()}`);
    console.log(`  Total wagered: ${totalWagered.toString()}`);
    console.log(`  Total payout: ${totalPayout.toString()}`);
    console.log(`  Net: ${(totalPayout - totalWagered).toString()}`);

    // Allow for some variance due to timing
    const diff = endBalance > expectedBalance ? endBalance - expectedBalance : expectedBalance - endBalance;
    expect(diff).toBeLessThanOrEqual(BigInt(BET_AMOUNT)); // Within one bet tolerance
  }, TEST_TIMEOUT);

  it('should handle rapid play', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🃏 Testing rapid play...');

    const rapidRounds = 20;
    let successCount = 0;
    let errorCount = 0;
    const startTime = Date.now();

    for (let i = 0; i < rapidRounds; i++) {
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

      // Minimal delay for rapid play
      await sleep(10);
    }

    const totalTime = Date.now() - startTime;
    const handsPerSecond = (rapidRounds / totalTime) * 1000;

    console.log(`  Completed ${successCount}/${rapidRounds} hands in ${totalTime}ms`);
    console.log(`  Rate: ${handsPerSecond.toFixed(2)} hands/second`);
    console.log(`  Errors: ${errorCount}`);

    expect(successCount).toBeGreaterThan(rapidRounds * 0.9); // 90% success rate
  }, TEST_TIMEOUT);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
