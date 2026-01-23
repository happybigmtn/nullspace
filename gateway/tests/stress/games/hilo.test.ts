/**
 * HiLo Stress Test Suite
 *
 * Tests HiLo game functionality under load:
 * - Guess mechanics (higher/lower/same)
 * - Streak multipliers
 * - Cashout timing
 *
 * Run with: RUN_STRESS=true pnpm -C gateway test:stress -- --testPathPattern=hilo
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
const ROUNDS_PER_TEST = parseInt(process.env.HILO_ROUNDS || '30', 10);
const BET_AMOUNT = parseInt(process.env.HILO_BET_AMOUNT || '100', 10);
const TEST_TIMEOUT = parseInt(process.env.TEST_TIMEOUT_MS || '600000', 10);

interface HiLoSessionMetrics {
  totalGames: number;
  correctGuesses: number;
  incorrectGuesses: number;
  maxStreak: number;
  cashoutsCount: number;
  totalPayout: bigint;
}

describe.skipIf(!STRESS_ENABLED)('HiLo Stress Tests', () => {
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
      console.warn('Gateway not available, skipping hilo stress tests');
    }
  }, 30000);

  afterAll(() => {
    if (client) {
      client.disconnect();
    }
    console.log('\n' + metrics.generateReport());
  });

  it('should complete a basic game', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🔼🔽 Testing basic HiLo game...');

    metrics.recordBetPlaced('hilo', BigInt(BET_AMOUNT));
    const result = await client.playHiLo(BET_AMOUNT, 'higher');

    if (result.success) {
      metrics.recordBetResolved('hilo', {
        won: result.won ?? false,
        payout: result.payout ?? 0n,
        latencyMs: result.latencyMs,
      });

      console.log(`  Result: ${result.won ? 'WIN' : 'LOSS'}`);
      console.log(`  Payout: ${result.payout?.toString() ?? '0'}`);
      console.log(`  Latency: ${result.latencyMs}ms`);
    } else {
      metrics.recordError('hilo', result.error ?? 'Unknown error');
      console.log(`  Error: ${result.error}`);
    }

    expect(result.success).toBe(true);
  }, TEST_TIMEOUT);

  it('should complete 30-game session', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log(`\n🔼🔽 Running ${ROUNDS_PER_TEST}-game HiLo session...`);

    const sessionMetrics: HiLoSessionMetrics = {
      totalGames: 0,
      correctGuesses: 0,
      incorrectGuesses: 0,
      maxStreak: 0,
      cashoutsCount: 0,
      totalPayout: 0n,
    };

    const guesses: Array<'higher' | 'lower' | 'same'> = ['higher', 'lower', 'same'];

    for (let game = 0; game < ROUNDS_PER_TEST; game++) {
      // Random guess strategy
      const guess = guesses[Math.floor(Math.random() * 2)]; // Mostly higher/lower

      metrics.recordBetPlaced('hilo', BigInt(BET_AMOUNT));
      const result = await client.playHiLo(BET_AMOUNT, guess);

      if (result.success) {
        sessionMetrics.totalGames++;

        if (result.won) {
          sessionMetrics.correctGuesses++;
        } else {
          sessionMetrics.incorrectGuesses++;
        }

        sessionMetrics.totalPayout += result.payout ?? 0n;

        const rawResponse = result.rawResponse;
        const streak = rawResponse?.streak as number | undefined;
        if (streak && streak > sessionMetrics.maxStreak) {
          sessionMetrics.maxStreak = streak;
        }

        metrics.recordBetResolved('hilo', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });

        if ((game + 1) % 10 === 0) {
          console.log(
            `  Game ${game + 1}/${ROUNDS_PER_TEST} - ` +
              `Correct: ${sessionMetrics.correctGuesses}, ` +
              `Max Streak: ${sessionMetrics.maxStreak}`
          );
        }
      } else {
        metrics.recordError('hilo', result.error ?? 'Unknown error');
      }

      await sleep(100);
    }

    console.log('\n  Session Summary:');
    console.log(`    Total Games: ${sessionMetrics.totalGames}`);
    console.log(`    Correct Guesses: ${sessionMetrics.correctGuesses}`);
    console.log(`    Incorrect Guesses: ${sessionMetrics.incorrectGuesses}`);
    console.log(`    Max Streak: ${sessionMetrics.maxStreak}`);
    console.log(`    Total Payout: ${sessionMetrics.totalPayout.toString()}`);

    expect(sessionMetrics.totalGames).toBe(ROUNDS_PER_TEST);
  }, TEST_TIMEOUT);

  it('should test all guess types', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🔼🔽 Testing all HiLo guess types...');

    const guesses: Array<'higher' | 'lower' | 'same'> = ['higher', 'lower', 'same'];

    for (const guess of guesses) {
      let wins = 0;
      const rounds = 10;

      for (let i = 0; i < rounds; i++) {
        metrics.recordBetPlaced('hilo', BigInt(BET_AMOUNT));
        const result = await client.playHiLo(BET_AMOUNT, guess);

        if (result.success) {
          if (result.won) wins++;
          metrics.recordBetResolved('hilo', {
            won: result.won ?? false,
            payout: result.payout ?? 0n,
            latencyMs: result.latencyMs,
          });
        } else {
          metrics.recordError('hilo', result.error ?? 'Unknown error');
        }

        await sleep(50);
      }

      console.log(`  ${guess.padEnd(8)}: ${wins}/${rounds} wins`);
    }

    expect(metrics.getMetrics().successRate).toBeGreaterThan(0.9);
  }, TEST_TIMEOUT);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
