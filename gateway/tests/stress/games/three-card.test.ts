/**
 * Three Card Poker Stress Test Suite
 *
 * Tests Three Card Poker game functionality under load:
 * - Ante/Play mechanics
 * - Pair Plus side bet
 * - Hand rankings
 *
 * Run with: RUN_STRESS=true pnpm -C gateway test:stress -- --testPathPattern=three-card
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
const HANDS_PER_TEST = parseInt(process.env.THREECARD_HANDS || '30', 10);
const BET_AMOUNT = parseInt(process.env.THREECARD_BET_AMOUNT || '100', 10);
const TEST_TIMEOUT = parseInt(process.env.TEST_TIMEOUT_MS || '600000', 10);

interface ThreeCardSessionMetrics {
  totalHands: number;
  anteWins: number;
  anteLosses: number;
  pairPlusWins: number;
  handsPlayed: number;
  handsFolded: number;
  handRankings: Map<string, number>;
}

describe.skipIf(!STRESS_ENABLED)('Three Card Poker Stress Tests', () => {
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
      console.warn('Gateway not available, skipping three card poker stress tests');
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

    console.log('\n🃏 Testing basic Three Card Poker hand...');

    metrics.recordBetPlaced('threecard', BigInt(BET_AMOUNT));
    const result = await client.playThreeCard(BET_AMOUNT);

    if (result.success) {
      metrics.recordBetResolved('threecard', {
        won: result.won ?? false,
        payout: result.payout ?? 0n,
        latencyMs: result.latencyMs,
      });

      const rawResponse = result.rawResponse;
      const handRank = rawResponse?.handRank as string | undefined;

      console.log(`  Hand: ${handRank ?? 'Unknown'}`);
      console.log(`  Result: ${result.won ? 'WIN' : 'LOSS'}`);
      console.log(`  Payout: ${result.payout?.toString() ?? '0'}`);
      console.log(`  Latency: ${result.latencyMs}ms`);
    } else {
      metrics.recordError('threecard', result.error ?? 'Unknown error');
      console.log(`  Error: ${result.error}`);
    }

    expect(result.success).toBe(true);
  }, TEST_TIMEOUT);

  it('should complete 30-hand session', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log(`\n🃏 Running ${HANDS_PER_TEST}-hand Three Card Poker session...`);

    const sessionMetrics: ThreeCardSessionMetrics = {
      totalHands: 0,
      anteWins: 0,
      anteLosses: 0,
      pairPlusWins: 0,
      handsPlayed: 0,
      handsFolded: 0,
      handRankings: new Map(),
    };

    for (let hand = 0; hand < HANDS_PER_TEST; hand++) {
      metrics.recordBetPlaced('threecard', BigInt(BET_AMOUNT));
      const result = await client.playThreeCard(BET_AMOUNT);

      if (result.success) {
        sessionMetrics.totalHands++;
        sessionMetrics.handsPlayed++; // We always play in stress test

        const rawResponse = result.rawResponse;
        const handRank = rawResponse?.handRank as string | undefined;

        if (handRank) {
          const count = sessionMetrics.handRankings.get(handRank) ?? 0;
          sessionMetrics.handRankings.set(handRank, count + 1);
        }

        if (result.won) {
          sessionMetrics.anteWins++;
        } else {
          sessionMetrics.anteLosses++;
        }

        metrics.recordBetResolved('threecard', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });

        if ((hand + 1) % 10 === 0) {
          console.log(
            `  Hand ${hand + 1}/${HANDS_PER_TEST} - ` +
              `W: ${sessionMetrics.anteWins}, L: ${sessionMetrics.anteLosses}`
          );
        }
      } else {
        metrics.recordError('threecard', result.error ?? 'Unknown error');
      }

      await sleep(100);
    }

    console.log('\n  Session Summary:');
    console.log(`    Total Hands: ${sessionMetrics.totalHands}`);
    console.log(`    Ante Wins: ${sessionMetrics.anteWins}`);
    console.log(`    Ante Losses: ${sessionMetrics.anteLosses}`);
    console.log('    Hand Rankings:');
    for (const [rank, count] of sessionMetrics.handRankings) {
      console.log(`      ${rank}: ${count}`);
    }

    expect(sessionMetrics.totalHands).toBe(HANDS_PER_TEST);
  }, TEST_TIMEOUT);

  it('should handle Pair Plus side bet', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🃏 Testing Pair Plus side bet...');

    let pairPlusWins = 0;
    const rounds = 20;
    const sideBetAmount = Math.floor(BET_AMOUNT / 2);

    for (let i = 0; i < rounds; i++) {
      const totalBet = BigInt(BET_AMOUNT) + BigInt(sideBetAmount);
      metrics.recordBetPlaced('threecard', totalBet);

      const result = await client.playThreeCard(BET_AMOUNT, { pairPlus: sideBetAmount });

      if (result.success) {
        const rawResponse = result.rawResponse;
        const pairPlusWon = rawResponse?.pairPlusWon as boolean | undefined;
        if (pairPlusWon) {
          pairPlusWins++;
          console.log(`  Hand ${i + 1}: Pair Plus WIN!`);
        }

        metrics.recordBetResolved('threecard', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });
      } else {
        metrics.recordError('threecard', result.error ?? 'Unknown error');
      }

      await sleep(100);
    }

    console.log(`\n  Pair Plus Results: ${pairPlusWins}/${rounds} wins`);
    expect(metrics.getMetrics().totalBetsResolved).toBeGreaterThan(0);
  }, TEST_TIMEOUT);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
