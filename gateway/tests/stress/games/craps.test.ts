/**
 * Craps Stress Test Suite
 *
 * Tests craps game functionality under load:
 * - All 19 bet types
 * - 100-roll sessions
 * - Point phase tracking
 * - Fire bet progression
 * - Odds betting
 *
 * Run with: RUN_STRESS=true pnpm -C gateway test:stress -- --testPathPattern=craps
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  CasinoClient,
  createMetricsCollector,
  createAllCrapsBets,
  createRandomCrapsBet,
  type MetricsCollector,
  type CrapsBet,
} from '../helpers/index.js';

// Configuration
const GATEWAY_URL = process.env.STRESS_GATEWAY_URL || 'ws://localhost:9010';
const STRESS_ENABLED = process.env.RUN_STRESS === 'true';
const ROLLS_PER_TEST = parseInt(process.env.CRAPS_ROLLS || '100', 10);
const BET_AMOUNT = parseInt(process.env.CRAPS_BET_AMOUNT || '100', 10);
const TEST_TIMEOUT = parseInt(process.env.TEST_TIMEOUT_MS || '600000', 10);

interface CrapsSessionMetrics {
  totalRolls: number;
  pointsEstablished: number;
  pointsMade: number;
  sevenOuts: number;
  passWins: number;
  passLosses: number;
  comeOutWins: number;
  comeOutLosses: number;
}

describe.skipIf(!STRESS_ENABLED)('Craps Stress Tests', () => {
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
      console.warn('Gateway not available, skipping craps stress tests');
    }
  }, 30000);

  afterAll(() => {
    if (client) {
      client.disconnect();
    }
    console.log('\n' + metrics.generateReport());
  });

  it('should complete a single roll with all bet types', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🎲 Testing all craps bet types...');
    const allBets = createAllCrapsBets(BET_AMOUNT);

    // Place bets one type at a time
    for (const bet of allBets) {
      const result = await client.playCraps([bet]);
      metrics.recordBetPlaced('craps', BigInt(bet.amount));

      if (result.success) {
        metrics.recordBetResolved('craps', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });
        console.log(
          `  ${bet.type.padEnd(15)} → ${result.won ? 'WIN' : 'LOSS'} (${result.latencyMs}ms)`
        );
      } else {
        metrics.recordError('craps', result.error ?? 'Unknown error');
        console.log(`  ${bet.type.padEnd(15)} → ERROR: ${result.error}`);
      }

      await sleep(100);
    }

    expect(metrics.getMetrics().totalBetsResolved).toBeGreaterThan(0);
  }, TEST_TIMEOUT);

  it('should complete 100-roll session with pass line bets', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log(`\n🎲 Running ${ROLLS_PER_TEST}-roll craps session...`);

    const sessionMetrics: CrapsSessionMetrics = {
      totalRolls: 0,
      pointsEstablished: 0,
      pointsMade: 0,
      sevenOuts: 0,
      passWins: 0,
      passLosses: 0,
      comeOutWins: 0,
      comeOutLosses: 0,
    };

    for (let roll = 0; roll < ROLLS_PER_TEST; roll++) {
      // Standard pass line bet
      const bets: CrapsBet[] = [{ type: 'PASS', amount: BET_AMOUNT }];

      // Occasionally add field bet
      if (Math.random() > 0.7) {
        bets.push({ type: 'FIELD', amount: BET_AMOUNT });
      }

      const totalAmount = bets.reduce((sum, b) => sum + BigInt(b.amount), 0n);
      metrics.recordBetPlaced('craps', totalAmount);

      const result = await client.playCraps(bets);

      if (result.success) {
        sessionMetrics.totalRolls++;

        if (result.won) {
          sessionMetrics.passWins++;
        } else {
          sessionMetrics.passLosses++;
        }

        metrics.recordBetResolved('craps', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });

        // Track session progress
        const rawResponse = result.rawResponse;
        if (rawResponse) {
          const dice = rawResponse.dice as number[] | undefined;
          const point = rawResponse.point as number | undefined;
          const phase = rawResponse.phase as string | undefined;

          if (phase === 'point' && point) {
            sessionMetrics.pointsEstablished++;
          }

          // Log every 10 rolls
          if ((roll + 1) % 10 === 0) {
            console.log(
              `  Roll ${roll + 1}/${ROLLS_PER_TEST} - ` +
                `Dice: ${dice ? dice.join('-') : '?'}, ` +
                `Point: ${point ?? 'OFF'}, ` +
                `W/L: ${sessionMetrics.passWins}/${sessionMetrics.passLosses}`
            );
          }
        }
      } else {
        metrics.recordError('craps', result.error ?? 'Unknown error');
      }

      await sleep(50);
    }

    console.log('\n  Session Summary:');
    console.log(`    Total Rolls: ${sessionMetrics.totalRolls}`);
    console.log(`    Pass Wins: ${sessionMetrics.passWins}`);
    console.log(`    Pass Losses: ${sessionMetrics.passLosses}`);
    console.log(
      `    Win Rate: ${((sessionMetrics.passWins / (sessionMetrics.passWins + sessionMetrics.passLosses)) * 100).toFixed(1)}%`
    );

    const latencyStats = metrics.getLatencyStats('craps');
    expect(latencyStats).not.toBeNull();
    expect(sessionMetrics.totalRolls).toBe(ROLLS_PER_TEST);
  }, TEST_TIMEOUT);

  it('should handle multi-bet scenarios', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🎲 Testing multi-bet scenarios...');

    // Complex multi-bet scenario
    const multiBetRounds = 20;

    for (let round = 0; round < multiBetRounds; round++) {
      const bets: CrapsBet[] = [
        { type: 'PASS', amount: BET_AMOUNT },
        { type: 'FIELD', amount: Math.floor(BET_AMOUNT / 2) },
        { type: 'PLACE', amount: BET_AMOUNT, target: 6 },
        { type: 'PLACE', amount: BET_AMOUNT, target: 8 },
      ];

      // Occasionally add hardways
      if (Math.random() > 0.5) {
        bets.push({ type: 'HARD', amount: Math.floor(BET_AMOUNT / 4), target: 6 });
        bets.push({ type: 'HARD', amount: Math.floor(BET_AMOUNT / 4), target: 8 });
      }

      const totalAmount = bets.reduce((sum, b) => sum + BigInt(b.amount), 0n);
      metrics.recordBetPlaced('craps', totalAmount);

      const result = await client.playCraps(bets);

      if (result.success) {
        metrics.recordBetResolved('craps', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });
        console.log(`  Round ${round + 1}: ${bets.length} bets → ${result.won ? 'WIN' : 'LOSS'}`);
      } else {
        metrics.recordError('craps', result.error ?? 'Unknown error');
        console.log(`  Round ${round + 1}: ERROR - ${result.error}`);
      }

      await sleep(100);
    }

    expect(metrics.getMetrics().successRate).toBeGreaterThan(0.8);
  }, TEST_TIMEOUT);

  it('should track Fire bet progression', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🎲 Testing Fire bet progression...');

    // Fire bet test - track made points
    let madePointsMask = 0;
    const maxRolls = 50;

    for (let roll = 0; roll < maxRolls; roll++) {
      const bets: CrapsBet[] = [
        { type: 'PASS', amount: BET_AMOUNT },
        { type: 'FIRE', amount: Math.floor(BET_AMOUNT / 10) },
      ];

      const totalAmount = bets.reduce((sum, b) => sum + BigInt(b.amount), 0n);
      metrics.recordBetPlaced('craps', totalAmount);

      const result = await client.playCraps(bets);

      if (result.success) {
        metrics.recordBetResolved('craps', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });

        // Check for made points in response
        const rawResponse = result.rawResponse;
        if (rawResponse?.madePointsMask !== undefined) {
          const newMask = rawResponse.madePointsMask as number;
          if (newMask !== madePointsMask) {
            madePointsMask = newMask;
            const madePoints = countBits(madePointsMask);
            console.log(`  Roll ${roll + 1}: Fire bet progress - ${madePoints}/6 points made`);
          }
        }
      } else {
        metrics.recordError('craps', result.error ?? 'Unknown error');
      }

      await sleep(50);
    }

    console.log(`  Final Fire bet progress: ${countBits(madePointsMask)}/6 points`);
    expect(metrics.getMetrics().totalBetsResolved).toBeGreaterThan(0);
  }, TEST_TIMEOUT);

  it('should handle proposition bets', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🎲 Testing proposition bets...');

    // One-roll proposition bets
    const propBets: CrapsBet[] = [
      { type: 'ANY_SEVEN', amount: BET_AMOUNT },
      { type: 'ANY_CRAPS', amount: BET_AMOUNT },
      { type: 'ELEVEN', amount: BET_AMOUNT },
      { type: 'TWELVE', amount: BET_AMOUNT },
      { type: 'TWO', amount: BET_AMOUNT },
      { type: 'THREE', amount: BET_AMOUNT },
    ];

    for (const bet of propBets) {
      let wins = 0;
      const rounds = 20;

      for (let i = 0; i < rounds; i++) {
        metrics.recordBetPlaced('craps', BigInt(bet.amount));
        const result = await client.playCraps([bet]);

        if (result.success) {
          if (result.won) wins++;
          metrics.recordBetResolved('craps', {
            won: result.won ?? false,
            payout: result.payout ?? 0n,
            latencyMs: result.latencyMs,
          });
        } else {
          metrics.recordError('craps', result.error ?? 'Unknown error');
        }

        await sleep(30);
      }

      console.log(`  ${bet.type.padEnd(12)}: ${wins}/${rounds} wins`);
    }

    expect(metrics.getMetrics().successRate).toBeGreaterThan(0.9);
  }, TEST_TIMEOUT);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countBits(n: number): number {
  let count = 0;
  while (n) {
    count += n & 1;
    n >>= 1;
  }
  return count;
}
