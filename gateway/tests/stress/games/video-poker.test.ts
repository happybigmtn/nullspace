/**
 * Video Poker Stress Test Suite
 *
 * Tests Video Poker game functionality under load:
 * - Deal and draw mechanics
 * - Hold card selection
 * - Hand ranking verification
 *
 * Run with: RUN_STRESS=true pnpm -C gateway test:stress -- --testPathPattern=video-poker
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
const HANDS_PER_TEST = parseInt(process.env.VIDEOPOKER_HANDS || '30', 10);
const BET_AMOUNT = parseInt(process.env.VIDEOPOKER_BET_AMOUNT || '100', 10);
const TEST_TIMEOUT = parseInt(process.env.TEST_TIMEOUT_MS || '600000', 10);

interface VideoPokerSessionMetrics {
  totalHands: number;
  winningHands: Map<string, number>;
  totalPayout: bigint;
}

describe.skipIf(!STRESS_ENABLED)('Video Poker Stress Tests', () => {
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
      console.warn('Gateway not available, skipping video poker stress tests');
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

    console.log('\n🎰 Testing basic Video Poker hand...');

    metrics.recordBetPlaced('videopoker', BigInt(BET_AMOUNT));
    const result = await client.playVideoPoker(BET_AMOUNT);

    if (result.success) {
      metrics.recordBetResolved('videopoker', {
        won: result.won ?? false,
        payout: result.payout ?? 0n,
        latencyMs: result.latencyMs,
      });

      const rawResponse = result.rawResponse;
      const handRank = rawResponse?.handRank as string | undefined;

      console.log(`  Result: ${result.won ? 'WIN' : 'LOSS'}`);
      console.log(`  Hand: ${handRank ?? 'Unknown'}`);
      console.log(`  Payout: ${result.payout?.toString() ?? '0'}`);
      console.log(`  Latency: ${result.latencyMs}ms`);
    } else {
      metrics.recordError('videopoker', result.error ?? 'Unknown error');
      console.log(`  Error: ${result.error}`);
    }

    expect(result.success).toBe(true);
  }, TEST_TIMEOUT);

  it('should complete 30-hand session', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log(`\n🎰 Running ${HANDS_PER_TEST}-hand Video Poker session...`);

    const sessionMetrics: VideoPokerSessionMetrics = {
      totalHands: 0,
      winningHands: new Map(),
      totalPayout: 0n,
    };

    for (let hand = 0; hand < HANDS_PER_TEST; hand++) {
      metrics.recordBetPlaced('videopoker', BigInt(BET_AMOUNT));
      const result = await client.playVideoPoker(BET_AMOUNT);

      if (result.success) {
        sessionMetrics.totalHands++;

        const rawResponse = result.rawResponse;
        const handRank = rawResponse?.handRank as string | undefined;

        if (result.won && handRank) {
          const count = sessionMetrics.winningHands.get(handRank) ?? 0;
          sessionMetrics.winningHands.set(handRank, count + 1);
        }

        sessionMetrics.totalPayout += result.payout ?? 0n;

        metrics.recordBetResolved('videopoker', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });

        if ((hand + 1) % 10 === 0) {
          const wins = Array.from(sessionMetrics.winningHands.values()).reduce((a, b) => a + b, 0);
          console.log(
            `  Hand ${hand + 1}/${HANDS_PER_TEST} - ` +
              `Wins: ${wins}, Payout: ${sessionMetrics.totalPayout.toString()}`
          );
        }
      } else {
        metrics.recordError('videopoker', result.error ?? 'Unknown error');
      }

      await sleep(100);
    }

    console.log('\n  Session Summary:');
    console.log(`    Total Hands: ${sessionMetrics.totalHands}`);
    console.log(`    Total Payout: ${sessionMetrics.totalPayout.toString()}`);
    console.log('    Winning Hands:');
    for (const [rank, count] of sessionMetrics.winningHands) {
      console.log(`      ${rank}: ${count}`);
    }

    expect(sessionMetrics.totalHands).toBe(HANDS_PER_TEST);
  }, TEST_TIMEOUT);

  it('should track hand rankings', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🎰 Tracking Video Poker hand rankings...');

    const handRankings = new Map<string, { count: number; totalPayout: bigint }>();
    const rounds = 50;

    for (let i = 0; i < rounds; i++) {
      metrics.recordBetPlaced('videopoker', BigInt(BET_AMOUNT));
      const result = await client.playVideoPoker(BET_AMOUNT);

      if (result.success) {
        const rawResponse = result.rawResponse;
        const handRank = (rawResponse?.handRank as string) ?? 'None';

        const existing = handRankings.get(handRank) ?? { count: 0, totalPayout: 0n };
        handRankings.set(handRank, {
          count: existing.count + 1,
          totalPayout: existing.totalPayout + (result.payout ?? 0n),
        });

        metrics.recordBetResolved('videopoker', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });
      } else {
        metrics.recordError('videopoker', result.error ?? 'Unknown error');
      }

      await sleep(50);
    }

    console.log('\n  Hand Ranking Distribution:');
    for (const [rank, stats] of handRankings) {
      const pct = ((stats.count / rounds) * 100).toFixed(1);
      console.log(
        `    ${rank.padEnd(20)}: ${stats.count} (${pct}%) - Payout: ${stats.totalPayout.toString()}`
      );
    }

    expect(metrics.getMetrics().totalBetsResolved).toBe(rounds);
  }, TEST_TIMEOUT);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
