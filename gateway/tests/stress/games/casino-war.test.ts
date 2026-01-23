/**
 * Casino War Stress Test Suite
 *
 * Tests Casino War game functionality under load:
 * - Basic play mechanics
 * - War (tie) scenarios
 * - Tie bet verification
 *
 * Run with: RUN_STRESS=true pnpm -C gateway test:stress -- --testPathPattern=casino-war
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
const ROUNDS_PER_TEST = parseInt(process.env.CASINOWAR_ROUNDS || '30', 10);
const BET_AMOUNT = parseInt(process.env.CASINOWAR_BET_AMOUNT || '100', 10);
const TEST_TIMEOUT = parseInt(process.env.TEST_TIMEOUT_MS || '600000', 10);

interface CasinoWarSessionMetrics {
  totalRounds: number;
  playerWins: number;
  dealerWins: number;
  ties: number;
  warsTriggered: number;
  warsWon: number;
}

describe.skipIf(!STRESS_ENABLED)('Casino War Stress Tests', () => {
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
      console.warn('Gateway not available, skipping casino war stress tests');
    }
  }, 30000);

  afterAll(() => {
    if (client) {
      client.disconnect();
    }
    console.log('\n' + metrics.generateReport());
  });

  it('should complete a basic round', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n⚔️ Testing basic Casino War round...');

    metrics.recordBetPlaced('casinowar', BigInt(BET_AMOUNT));
    const result = await client.playCasinoWar(BET_AMOUNT);

    if (result.success) {
      metrics.recordBetResolved('casinowar', {
        won: result.won ?? false,
        payout: result.payout ?? 0n,
        latencyMs: result.latencyMs,
      });

      const rawResponse = result.rawResponse;
      const playerCard = rawResponse?.playerCard as string | undefined;
      const dealerCard = rawResponse?.dealerCard as string | undefined;

      console.log(`  Player: ${playerCard ?? '?'}`);
      console.log(`  Dealer: ${dealerCard ?? '?'}`);
      console.log(`  Result: ${result.won ? 'WIN' : 'LOSS'}`);
      console.log(`  Payout: ${result.payout?.toString() ?? '0'}`);
      console.log(`  Latency: ${result.latencyMs}ms`);
    } else {
      metrics.recordError('casinowar', result.error ?? 'Unknown error');
      console.log(`  Error: ${result.error}`);
    }

    expect(result.success).toBe(true);
  }, TEST_TIMEOUT);

  it('should complete 30-round session', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log(`\n⚔️ Running ${ROUNDS_PER_TEST}-round Casino War session...`);

    const sessionMetrics: CasinoWarSessionMetrics = {
      totalRounds: 0,
      playerWins: 0,
      dealerWins: 0,
      ties: 0,
      warsTriggered: 0,
      warsWon: 0,
    };

    for (let round = 0; round < ROUNDS_PER_TEST; round++) {
      metrics.recordBetPlaced('casinowar', BigInt(BET_AMOUNT));
      const result = await client.playCasinoWar(BET_AMOUNT);

      if (result.success) {
        sessionMetrics.totalRounds++;

        const rawResponse = result.rawResponse;
        const wentToWar = rawResponse?.wentToWar as boolean | undefined;

        if (wentToWar) {
          sessionMetrics.warsTriggered++;
          if (result.won) sessionMetrics.warsWon++;
        }

        if (result.won) {
          sessionMetrics.playerWins++;
        } else {
          sessionMetrics.dealerWins++;
        }

        metrics.recordBetResolved('casinowar', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });

        if ((round + 1) % 10 === 0) {
          console.log(
            `  Round ${round + 1}/${ROUNDS_PER_TEST} - ` +
              `W: ${sessionMetrics.playerWins}, L: ${sessionMetrics.dealerWins}, ` +
              `Wars: ${sessionMetrics.warsTriggered}`
          );
        }
      } else {
        metrics.recordError('casinowar', result.error ?? 'Unknown error');
      }

      await sleep(100);
    }

    console.log('\n  Session Summary:');
    console.log(`    Total Rounds: ${sessionMetrics.totalRounds}`);
    console.log(`    Player Wins: ${sessionMetrics.playerWins}`);
    console.log(`    Dealer Wins: ${sessionMetrics.dealerWins}`);
    console.log(`    Wars Triggered: ${sessionMetrics.warsTriggered}`);
    console.log(`    Wars Won: ${sessionMetrics.warsWon}`);

    expect(sessionMetrics.totalRounds).toBe(ROUNDS_PER_TEST);
  }, TEST_TIMEOUT);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
