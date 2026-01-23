/**
 * Sic Bo Stress Test Suite
 *
 * Tests Sic Bo game functionality under load:
 * - All 13+ bet types
 * - Dice outcome tracking
 * - Triple verification
 *
 * Run with: RUN_STRESS=true pnpm -C gateway test:stress -- --testPathPattern=sic-bo
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  CasinoClient,
  createMetricsCollector,
  createAllSicBoBets,
  createRandomSicBoBet,
  type MetricsCollector,
  type SicBoBet,
} from '../helpers/index.js';

// Configuration
const GATEWAY_URL = process.env.STRESS_GATEWAY_URL || 'ws://localhost:9010';
const STRESS_ENABLED = process.env.RUN_STRESS === 'true';
const ROUNDS_PER_TEST = parseInt(process.env.SICBO_ROUNDS || '50', 10);
const BET_AMOUNT = parseInt(process.env.SICBO_BET_AMOUNT || '100', 10);
const TEST_TIMEOUT = parseInt(process.env.TEST_TIMEOUT_MS || '600000', 10);

describe.skipIf(!STRESS_ENABLED)('Sic Bo Stress Tests', () => {
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
      console.warn('Gateway not available, skipping sic bo stress tests');
    }
  }, 30000);

  afterAll(() => {
    if (client) {
      client.disconnect();
    }
    console.log('\n' + metrics.generateReport());
  });

  it('should complete a roll with all bet types', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🎲 Testing all Sic Bo bet types...');
    const allBets = createAllSicBoBets(BET_AMOUNT);

    for (const bet of allBets) {
      const result = await client.playSicBo([bet]);
      metrics.recordBetPlaced('sicbo', BigInt(bet.amount));

      if (result.success) {
        metrics.recordBetResolved('sicbo', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });
        console.log(
          `  ${bet.type.padEnd(18)} → ${result.won ? 'WIN' : 'LOSS'} (${result.latencyMs}ms)`
        );
      } else {
        metrics.recordError('sicbo', result.error ?? 'Unknown error');
        console.log(`  ${bet.type.padEnd(18)} → ERROR: ${result.error}`);
      }

      await sleep(100);
    }

    expect(metrics.getMetrics().totalBetsResolved).toBeGreaterThan(0);
  }, TEST_TIMEOUT);

  it('should complete 50-roll session with big/small bets', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log(`\n🎲 Running ${ROUNDS_PER_TEST}-roll Sic Bo session...`);

    let bigWins = 0;
    let smallWins = 0;
    let triples = 0;

    for (let roll = 0; roll < ROUNDS_PER_TEST; roll++) {
      // Alternate between big and small
      const betType = roll % 2 === 0 ? 'BIG' : 'SMALL';
      const bets: SicBoBet[] = [{ type: betType, amount: BET_AMOUNT }];

      metrics.recordBetPlaced('sicbo', BigInt(BET_AMOUNT));
      const result = await client.playSicBo(bets);

      if (result.success) {
        const rawResponse = result.rawResponse;
        const dice = rawResponse?.dice as number[] | undefined;
        const isTriple = dice && dice[0] === dice[1] && dice[1] === dice[2];

        if (isTriple) {
          triples++;
        } else if (result.won) {
          if (betType === 'BIG') bigWins++;
          else smallWins++;
        }

        metrics.recordBetResolved('sicbo', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });

        if ((roll + 1) % 10 === 0) {
          console.log(
            `  Roll ${roll + 1}/${ROUNDS_PER_TEST} - ` +
              `Big: ${bigWins}, Small: ${smallWins}, Triples: ${triples}`
          );
        }
      } else {
        metrics.recordError('sicbo', result.error ?? 'Unknown error');
      }

      await sleep(50);
    }

    console.log('\n  Session Summary:');
    console.log(`    Big Wins: ${bigWins}`);
    console.log(`    Small Wins: ${smallWins}`);
    console.log(`    Triples (house wins): ${triples}`);

    const latencyStats = metrics.getLatencyStats('sicbo');
    expect(latencyStats).not.toBeNull();
  }, TEST_TIMEOUT);

  it('should handle multi-bet scenarios', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🎲 Testing Sic Bo multi-bet scenarios...');

    const rounds = 20;

    for (let round = 0; round < rounds; round++) {
      const bets: SicBoBet[] = [
        { type: 'BIG', amount: BET_AMOUNT },
        { type: 'TOTAL', amount: Math.floor(BET_AMOUNT / 2), target: 10 },
        { type: 'SINGLE_DICE', amount: Math.floor(BET_AMOUNT / 4), target: 4 },
      ];

      const totalAmount = bets.reduce((sum, b) => sum + BigInt(b.amount), 0n);
      metrics.recordBetPlaced('sicbo', totalAmount);

      const result = await client.playSicBo(bets);

      if (result.success) {
        metrics.recordBetResolved('sicbo', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });
        console.log(`  Round ${round + 1}: ${result.won ? 'WIN' : 'LOSS'}`);
      } else {
        metrics.recordError('sicbo', result.error ?? 'Unknown error');
      }

      await sleep(100);
    }

    expect(metrics.getMetrics().successRate).toBeGreaterThan(0.9);
  }, TEST_TIMEOUT);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
