/**
 * Ultimate Texas Hold'em Stress Test Suite
 *
 * Tests Ultimate Texas Hold'em game functionality under load:
 * - Check/Bet mechanics
 * - Trips side bet
 * - Multi-street gameplay
 *
 * Run with: RUN_STRESS=true pnpm -C gateway test:stress -- --testPathPattern=ultimate-texas
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
const HANDS_PER_TEST = parseInt(process.env.ULTIMATE_HANDS || '30', 10);
const BET_AMOUNT = parseInt(process.env.ULTIMATE_BET_AMOUNT || '100', 10);
const TEST_TIMEOUT = parseInt(process.env.TEST_TIMEOUT_MS || '600000', 10);

interface UltimateSessionMetrics {
  totalHands: number;
  playerWins: number;
  dealerWins: number;
  pushes: number;
  tripsWins: number;
  handRankings: Map<string, number>;
}

describe.skipIf(!STRESS_ENABLED)('Ultimate Texas Stress Tests', () => {
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
      console.warn('Gateway not available, skipping ultimate texas stress tests');
    }
  }, 30000);

  afterAll(() => {
    if (client) {
      client.disconnect();
    }
    console.log('\n' + metrics.generateReport());
  });

  it('should complete a basic hand', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🃏 Testing basic Ultimate Texas Hold\'em hand...');

    metrics.recordBetPlaced('ultimateholdem', BigInt(BET_AMOUNT));
    const result = await client.playUltimateHoldem(BET_AMOUNT);

    if (result.success) {
      metrics.recordBetResolved('ultimateholdem', {
        won: result.won ?? false,
        payout: result.payout ?? 0n,
        latencyMs: result.latencyMs,
        push: result.rawResponse?.push as boolean,
      });

      const rawResponse = result.rawResponse;
      const handRank = rawResponse?.handRank as string | undefined;

      console.log(`  Hand: ${handRank ?? 'Unknown'}`);
      console.log(`  Result: ${result.won ? 'WIN' : result.rawResponse?.push ? 'PUSH' : 'LOSS'}`);
      console.log(`  Payout: ${result.payout?.toString() ?? '0'}`);
      console.log(`  Latency: ${result.latencyMs}ms`);
    } else {
      metrics.recordError('ultimateholdem', result.error ?? 'Unknown error');
      console.log(`  Error: ${result.error}`);
    }

    expect(result.success).toBe(true);
  }, TEST_TIMEOUT);

  it('should complete 30-hand session', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log(`\n🃏 Running ${HANDS_PER_TEST}-hand Ultimate Texas session...`);

    const sessionMetrics: UltimateSessionMetrics = {
      totalHands: 0,
      playerWins: 0,
      dealerWins: 0,
      pushes: 0,
      tripsWins: 0,
      handRankings: new Map(),
    };

    for (let hand = 0; hand < HANDS_PER_TEST; hand++) {
      metrics.recordBetPlaced('ultimateholdem', BigInt(BET_AMOUNT));
      const result = await client.playUltimateHoldem(BET_AMOUNT);

      if (result.success) {
        sessionMetrics.totalHands++;

        const rawResponse = result.rawResponse;
        const handRank = rawResponse?.handRank as string | undefined;
        const isPush = rawResponse?.push as boolean | undefined;

        if (handRank) {
          const count = sessionMetrics.handRankings.get(handRank) ?? 0;
          sessionMetrics.handRankings.set(handRank, count + 1);
        }

        if (isPush) {
          sessionMetrics.pushes++;
        } else if (result.won) {
          sessionMetrics.playerWins++;
        } else {
          sessionMetrics.dealerWins++;
        }

        metrics.recordBetResolved('ultimateholdem', {
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
        metrics.recordError('ultimateholdem', result.error ?? 'Unknown error');
      }

      await sleep(150); // Slightly longer delay for multi-street game
    }

    console.log('\n  Session Summary:');
    console.log(`    Total Hands: ${sessionMetrics.totalHands}`);
    console.log(`    Player Wins: ${sessionMetrics.playerWins}`);
    console.log(`    Dealer Wins: ${sessionMetrics.dealerWins}`);
    console.log(`    Pushes: ${sessionMetrics.pushes}`);
    console.log('    Hand Rankings:');
    for (const [rank, count] of sessionMetrics.handRankings) {
      console.log(`      ${rank}: ${count}`);
    }

    expect(sessionMetrics.totalHands).toBe(HANDS_PER_TEST);
  }, TEST_TIMEOUT);

  it('should handle Trips side bet', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🃏 Testing Trips side bet...');

    let tripsWins = 0;
    const rounds = 20;
    const tripsBet = Math.floor(BET_AMOUNT / 4);

    for (let i = 0; i < rounds; i++) {
      const totalBet = BigInt(BET_AMOUNT) + BigInt(tripsBet);
      metrics.recordBetPlaced('ultimateholdem', totalBet);

      const result = await client.playUltimateHoldem(BET_AMOUNT, { trips: tripsBet });

      if (result.success) {
        const rawResponse = result.rawResponse;
        const tripsWon = rawResponse?.tripsWon as boolean | undefined;
        if (tripsWon) {
          tripsWins++;
          console.log(`  Hand ${i + 1}: Trips WIN!`);
        }

        metrics.recordBetResolved('ultimateholdem', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });
      } else {
        metrics.recordError('ultimateholdem', result.error ?? 'Unknown error');
      }

      await sleep(150);
    }

    console.log(`\n  Trips Results: ${tripsWins}/${rounds} wins`);
    expect(metrics.getMetrics().totalBetsResolved).toBeGreaterThan(0);
  }, TEST_TIMEOUT);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
