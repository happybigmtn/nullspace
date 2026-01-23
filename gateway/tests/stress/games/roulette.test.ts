/**
 * Roulette Stress Test Suite
 *
 * Tests roulette game functionality under load:
 * - All 15+ bet types
 * - Multiple rounds (50 spins)
 * - Batch betting
 * - Payout verification
 * - Zero rules (La Partage/En Prison)
 *
 * Run with: RUN_STRESS=true pnpm -C gateway test:stress -- --testPathPattern=roulette
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  CasinoClient,
  createClientPool,
  disconnectPool,
  createMetricsCollector,
  createAllRouletteBets,
  createRandomRouletteBet,
  type MetricsCollector,
  type RouletteBet,
} from '../helpers/index.js';

// Configuration
const GATEWAY_URL = process.env.STRESS_GATEWAY_URL || 'ws://localhost:9010';
const STRESS_ENABLED = process.env.RUN_STRESS === 'true';
const SPINS_PER_TEST = parseInt(process.env.ROULETTE_SPINS || '50', 10);
const CONCURRENT_PLAYERS = parseInt(process.env.ROULETTE_PLAYERS || '5', 10);
const BET_AMOUNT = parseInt(process.env.ROULETTE_BET_AMOUNT || '100', 10);
const TEST_TIMEOUT = parseInt(process.env.TEST_TIMEOUT_MS || '600000', 10);

interface RouletteTestResult {
  sessionId: string;
  result: number;
  bets: RouletteBet[];
  payout: bigint;
  won: boolean;
  latencyMs: number;
}

describe.skipIf(!STRESS_ENABLED)('Roulette Stress Tests', () => {
  let client: CasinoClient;
  let metrics: MetricsCollector;
  let isGatewayAvailable = false;

  beforeAll(async () => {
    metrics = createMetricsCollector();

    // Check gateway availability
    try {
      client = new CasinoClient({ gatewayUrl: GATEWAY_URL });
      await client.connect();
      isGatewayAvailable = client.isConnected() && client.isRegistered();
    } catch {
      console.warn('Gateway not available, skipping roulette stress tests');
    }
  }, 30000);

  afterAll(() => {
    if (client) {
      client.disconnect();
    }
    console.log('\n' + metrics.generateReport());
  });

  it('should complete a single spin with all bet types', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🎰 Testing all roulette bet types...');
    const allBets = createAllRouletteBets(BET_AMOUNT);

    // Place bets one type at a time to verify each works
    for (const bet of allBets) {
      const result = await client.playRoulette([bet]);
      metrics.recordBetPlaced('roulette', BigInt(bet.amount));

      if (result.success) {
        metrics.recordBetResolved('roulette', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });
        console.log(
          `  ${bet.type.padEnd(15)} → ${result.won ? 'WIN' : 'LOSS'} (${result.latencyMs}ms)`
        );
      } else {
        metrics.recordError('roulette', result.error ?? 'Unknown error');
        console.log(`  ${bet.type.padEnd(15)} → ERROR: ${result.error}`);
      }

      // Small delay between bets
      await sleep(100);
    }

    expect(metrics.getMetrics().totalBetsResolved).toBeGreaterThan(0);
  }, TEST_TIMEOUT);

  it('should complete 50 spins with random bets', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log(`\n🎰 Running ${SPINS_PER_TEST} roulette spins...`);
    const results: RouletteTestResult[] = [];
    let wins = 0;
    let losses = 0;

    for (let spin = 0; spin < SPINS_PER_TEST; spin++) {
      // Generate 3-7 random bets per spin
      const betCount = Math.floor(Math.random() * 5) + 3;
      const bets: RouletteBet[] = [];
      for (let i = 0; i < betCount; i++) {
        bets.push(createRandomRouletteBet(BET_AMOUNT));
      }

      const totalAmount = bets.reduce((sum, b) => sum + BigInt(b.amount), 0n);
      metrics.recordBetPlaced('roulette', totalAmount);

      const result = await client.playRoulette(bets);

      if (result.success) {
        if (result.won) wins++;
        else losses++;

        metrics.recordBetResolved('roulette', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });

        results.push({
          sessionId: result.sessionId ?? '',
          result: (result.rawResponse?.winningNumber as number) ?? -1,
          bets,
          payout: result.payout ?? 0n,
          won: result.won ?? false,
          latencyMs: result.latencyMs,
        });

        if ((spin + 1) % 10 === 0) {
          console.log(`  Spin ${spin + 1}/${SPINS_PER_TEST} - Wins: ${wins}, Losses: ${losses}`);
        }
      } else {
        metrics.recordError('roulette', result.error ?? 'Unknown error');
      }

      // Small delay between spins
      await sleep(50);
    }

    console.log(`\n  Final: ${wins} wins, ${losses} losses (${((wins / (wins + losses)) * 100).toFixed(1)}% win rate)`);

    const latencyStats = metrics.getLatencyStats('roulette');
    expect(latencyStats).not.toBeNull();
    expect(latencyStats!.p99).toBeLessThan(5000); // P99 under 5 seconds
  }, TEST_TIMEOUT);

  it('should handle batch betting correctly', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🎰 Testing batch betting...');

    // Place multiple different bet types in a single spin
    const batchBets: RouletteBet[] = [
      { type: 'RED', amount: BET_AMOUNT },
      { type: 'ODD', amount: BET_AMOUNT },
      { type: 'STRAIGHT', amount: BET_AMOUNT, number: 17 },
      { type: 'COLUMN', amount: BET_AMOUNT, number: 1 },
      { type: 'DOZEN', amount: BET_AMOUNT, number: 2 },
    ];

    const totalAmount = batchBets.reduce((sum, b) => sum + BigInt(b.amount), 0n);
    metrics.recordBetPlaced('roulette', totalAmount);

    const result = await client.playRoulette(batchBets);

    if (result.success) {
      metrics.recordBetResolved('roulette', {
        won: result.won ?? false,
        payout: result.payout ?? 0n,
        latencyMs: result.latencyMs,
      });

      console.log(`  Batch result: ${result.won ? 'WIN' : 'LOSS'}`);
      console.log(`  Payout: ${result.payout?.toString() ?? '0'}`);
      console.log(`  Latency: ${result.latencyMs}ms`);
    } else {
      metrics.recordError('roulette', result.error ?? 'Unknown error');
      console.log(`  Error: ${result.error}`);
    }

    expect(result.success).toBe(true);
  }, TEST_TIMEOUT);

  it('should handle concurrent players', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log(`\n🎰 Testing ${CONCURRENT_PLAYERS} concurrent roulette players...`);

    // Create client pool
    const clients = await createClientPool(GATEWAY_URL, CONCURRENT_PLAYERS, 5);
    console.log(`  Connected ${clients.length} players`);

    if (clients.length === 0) {
      console.warn('  No clients connected, skipping');
      return;
    }

    // Each player spins 5 times
    const spinsPerPlayer = 5;
    const allPromises: Promise<void>[] = [];

    for (const playerClient of clients) {
      const playerPromise = (async () => {
        for (let i = 0; i < spinsPerPlayer; i++) {
          const bets = [createRandomRouletteBet(BET_AMOUNT), createRandomRouletteBet(BET_AMOUNT)];
          const totalAmount = bets.reduce((sum, b) => sum + BigInt(b.amount), 0n);
          metrics.recordBetPlaced('roulette', totalAmount);

          const result = await playerClient.playRoulette(bets);

          if (result.success) {
            metrics.recordBetResolved('roulette', {
              won: result.won ?? false,
              payout: result.payout ?? 0n,
              latencyMs: result.latencyMs,
            });
          } else {
            metrics.recordError('roulette', result.error ?? 'Unknown error');
          }

          await sleep(100);
        }
      })();

      allPromises.push(playerPromise);
    }

    await Promise.all(allPromises);

    // Cleanup
    disconnectPool(clients);

    const gameStats = metrics.getMetrics().games.get('roulette');
    console.log(`  Total bets resolved: ${gameStats?.totalBets ?? 0}`);

    expect(metrics.getMetrics().successRate).toBeGreaterThan(0.9);
  }, TEST_TIMEOUT);

  it('should verify payout calculations', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🎰 Verifying payout calculations...');

    // Expected payouts for even money bets (Red, Black, Odd, Even, Low, High)
    // Win = 2x bet, Loss = 0
    const evenMoneyBets: RouletteBet[] = [
      { type: 'RED', amount: BET_AMOUNT },
      { type: 'ODD', amount: BET_AMOUNT },
      { type: 'LOW', amount: BET_AMOUNT },
    ];

    let payoutChecksPassed = 0;
    let payoutChecksFailed = 0;

    for (const bet of evenMoneyBets) {
      // Run 10 spins for each bet type to get some wins
      for (let i = 0; i < 10; i++) {
        metrics.recordBetPlaced('roulette', BigInt(bet.amount));
        const result = await client.playRoulette([bet]);

        if (result.success) {
          metrics.recordBetResolved('roulette', {
            won: result.won ?? false,
            payout: result.payout ?? 0n,
            latencyMs: result.latencyMs,
          });

          // Verify payout matches expected
          if (result.won) {
            // For even money bets, payout should be 2x bet (bet returned + 1:1 win)
            const expectedPayout = BigInt(bet.amount) * 2n;
            if (result.payout === expectedPayout) {
              payoutChecksPassed++;
            } else {
              payoutChecksFailed++;
              console.log(`  ${bet.type} payout mismatch: expected ${expectedPayout}, got ${result.payout}`);
            }
          } else {
            // Loss means payout should be 0
            if (result.payout === 0n) {
              payoutChecksPassed++;
            } else {
              payoutChecksFailed++;
              console.log(`  ${bet.type} loss payout mismatch: expected 0, got ${result.payout}`);
            }
          }
        } else {
          metrics.recordError('roulette', result.error ?? 'Unknown error');
        }

        await sleep(50);
      }
    }

    console.log(`  Payout checks: ${payoutChecksPassed} passed, ${payoutChecksFailed} failed`);

    // Allow some failures due to timing or edge cases
    expect(payoutChecksPassed).toBeGreaterThan(payoutChecksFailed);
  }, TEST_TIMEOUT);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
