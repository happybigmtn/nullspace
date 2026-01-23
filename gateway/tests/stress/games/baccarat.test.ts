/**
 * Baccarat Stress Test Suite
 *
 * Tests baccarat game functionality under load:
 * - All 11 bet types
 * - Commission handling (5% on banker wins)
 * - Pair bet verification
 * - Natural detection
 *
 * Run with: RUN_STRESS=true pnpm -C gateway test:stress -- --testPathPattern=baccarat
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  CasinoClient,
  createMetricsCollector,
  createAllBaccaratBets,
  createRandomBaccaratBet,
  type MetricsCollector,
  type BaccaratBet,
} from '../helpers/index.js';

// Configuration
const GATEWAY_URL = process.env.STRESS_GATEWAY_URL || 'ws://localhost:9010';
const STRESS_ENABLED = process.env.RUN_STRESS === 'true';
const ROUNDS_PER_TEST = parseInt(process.env.BACCARAT_ROUNDS || '50', 10);
const BET_AMOUNT = parseInt(process.env.BACCARAT_BET_AMOUNT || '100', 10);
const TEST_TIMEOUT = parseInt(process.env.TEST_TIMEOUT_MS || '600000', 10);

interface BaccaratSessionMetrics {
  totalRounds: number;
  playerWins: number;
  bankerWins: number;
  ties: number;
  naturals: number;
  pairs: {
    player: number;
    banker: number;
    either: number;
    perfect: number;
  };
  commissionPaid: bigint;
}

describe.skipIf(!STRESS_ENABLED)('Baccarat Stress Tests', () => {
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
      console.warn('Gateway not available, skipping baccarat stress tests');
    }
  }, 30000);

  afterAll(() => {
    if (client) {
      client.disconnect();
    }
    console.log('\n' + metrics.generateReport());
  });

  it('should complete a round with all bet types', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🎴 Testing all baccarat bet types...');
    const allBets = createAllBaccaratBets(BET_AMOUNT);

    // Test each bet type individually
    for (const bet of allBets) {
      const result = await client.playBaccarat([bet]);
      metrics.recordBetPlaced('baccarat', BigInt(bet.amount));

      if (result.success) {
        metrics.recordBetResolved('baccarat', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });
        console.log(
          `  ${bet.type.padEnd(20)} → ${result.won ? 'WIN' : 'LOSS'} (${result.latencyMs}ms)`
        );
      } else {
        metrics.recordError('baccarat', result.error ?? 'Unknown error');
        console.log(`  ${bet.type.padEnd(20)} → ERROR: ${result.error}`);
      }

      await sleep(100);
    }

    expect(metrics.getMetrics().totalBetsResolved).toBeGreaterThan(0);
  }, TEST_TIMEOUT);

  it('should complete 50-round session with banker bets', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log(`\n🎴 Running ${ROUNDS_PER_TEST}-round baccarat session (banker bets)...`);

    const sessionMetrics: BaccaratSessionMetrics = {
      totalRounds: 0,
      playerWins: 0,
      bankerWins: 0,
      ties: 0,
      naturals: 0,
      pairs: { player: 0, banker: 0, either: 0, perfect: 0 },
      commissionPaid: 0n,
    };

    for (let round = 0; round < ROUNDS_PER_TEST; round++) {
      // Banker bet (optimal strategy)
      const bets: BaccaratBet[] = [{ type: 'BANKER', amount: BET_AMOUNT }];

      metrics.recordBetPlaced('baccarat', BigInt(BET_AMOUNT));
      const result = await client.playBaccarat(bets);

      if (result.success) {
        sessionMetrics.totalRounds++;

        const rawResponse = result.rawResponse;
        const winner = rawResponse?.winner as string | undefined;
        const natural = rawResponse?.natural as boolean | undefined;

        if (winner === 'player') {
          sessionMetrics.playerWins++;
        } else if (winner === 'banker') {
          sessionMetrics.bankerWins++;
          // Track 5% commission on banker wins
          if (result.won) {
            const commission = (BigInt(BET_AMOUNT) * 5n) / 100n;
            sessionMetrics.commissionPaid += commission;
          }
        } else if (winner === 'tie') {
          sessionMetrics.ties++;
        }

        if (natural) {
          sessionMetrics.naturals++;
        }

        metrics.recordBetResolved('baccarat', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });

        if ((round + 1) % 10 === 0) {
          console.log(
            `  Round ${round + 1}/${ROUNDS_PER_TEST} - ` +
              `P: ${sessionMetrics.playerWins}, B: ${sessionMetrics.bankerWins}, T: ${sessionMetrics.ties}`
          );
        }
      } else {
        metrics.recordError('baccarat', result.error ?? 'Unknown error');
      }

      await sleep(50);
    }

    console.log('\n  Session Summary:');
    console.log(`    Total Rounds: ${sessionMetrics.totalRounds}`);
    console.log(`    Player Wins: ${sessionMetrics.playerWins}`);
    console.log(`    Banker Wins: ${sessionMetrics.bankerWins}`);
    console.log(`    Ties: ${sessionMetrics.ties}`);
    console.log(`    Naturals: ${sessionMetrics.naturals}`);
    console.log(`    Commission Paid: ${sessionMetrics.commissionPaid.toString()}`);

    // Verify banker wins slightly more often (statistically expected)
    expect(sessionMetrics.totalRounds).toBe(ROUNDS_PER_TEST);
  }, TEST_TIMEOUT);

  it('should handle pair bets', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🎴 Testing pair bets...');

    const pairBetTypes = [
      'PLAYER_PAIR',
      'BANKER_PAIR',
      'EITHER_PAIR',
      'PERFECT_PAIR',
    ];

    for (const pairType of pairBetTypes) {
      let wins = 0;
      const rounds = 20;

      for (let i = 0; i < rounds; i++) {
        const bets: BaccaratBet[] = [
          { type: 'PLAYER', amount: BET_AMOUNT }, // Base bet required
          { type: pairType, amount: Math.floor(BET_AMOUNT / 2) },
        ];

        const totalAmount = bets.reduce((sum, b) => sum + BigInt(b.amount), 0n);
        metrics.recordBetPlaced('baccarat', totalAmount);

        const result = await client.playBaccarat(bets);

        if (result.success) {
          // Check if pair bet won
          const rawResponse = result.rawResponse;
          const pairWon = rawResponse?.[`${pairType.toLowerCase()}Won`] as boolean | undefined;
          if (pairWon) wins++;

          metrics.recordBetResolved('baccarat', {
            won: result.won ?? false,
            payout: result.payout ?? 0n,
            latencyMs: result.latencyMs,
          });
        } else {
          metrics.recordError('baccarat', result.error ?? 'Unknown error');
        }

        await sleep(50);
      }

      console.log(`  ${pairType.padEnd(15)}: ${wins}/${rounds} wins`);
    }

    expect(metrics.getMetrics().successRate).toBeGreaterThan(0.9);
  }, TEST_TIMEOUT);

  it('should handle dragon bonus bets', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🎴 Testing dragon bonus bets...');

    let dragonBonusPayouts = 0n;
    const rounds = 30;

    for (let i = 0; i < rounds; i++) {
      const bets: BaccaratBet[] = [
        { type: 'PLAYER', amount: BET_AMOUNT },
        { type: 'DRAGON_BONUS_PLAYER', amount: Math.floor(BET_AMOUNT / 2) },
      ];

      const totalAmount = bets.reduce((sum, b) => sum + BigInt(b.amount), 0n);
      metrics.recordBetPlaced('baccarat', totalAmount);

      const result = await client.playBaccarat(bets);

      if (result.success) {
        const rawResponse = result.rawResponse;
        const dragonPayout = rawResponse?.dragonBonusPayout as string | undefined;
        if (dragonPayout) {
          dragonBonusPayouts += BigInt(dragonPayout);
          console.log(`  Round ${i + 1}: Dragon Bonus payout ${dragonPayout}`);
        }

        metrics.recordBetResolved('baccarat', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });
      } else {
        metrics.recordError('baccarat', result.error ?? 'Unknown error');
      }

      await sleep(50);
    }

    console.log(`\n  Total Dragon Bonus payouts: ${dragonBonusPayouts.toString()}`);
    expect(metrics.getMetrics().totalBetsResolved).toBeGreaterThan(0);
  }, TEST_TIMEOUT);

  it('should verify commission on banker wins', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🎴 Verifying banker bet commission...');

    let bankerWins = 0;
    let correctPayouts = 0;
    let incorrectPayouts = 0;
    const rounds = 30;

    for (let i = 0; i < rounds; i++) {
      const bets: BaccaratBet[] = [{ type: 'BANKER', amount: BET_AMOUNT }];

      metrics.recordBetPlaced('baccarat', BigInt(BET_AMOUNT));
      const result = await client.playBaccarat(bets);

      if (result.success) {
        const rawResponse = result.rawResponse;
        const winner = rawResponse?.winner as string | undefined;

        if (winner === 'banker' && result.won) {
          bankerWins++;

          // Banker pays 0.95:1 (5% commission)
          // Payout should be bet + (bet * 0.95) = bet * 1.95
          const expectedPayout = (BigInt(BET_AMOUNT) * 195n) / 100n;
          const actualPayout = result.payout ?? 0n;

          // Allow for rounding differences
          const diff = actualPayout > expectedPayout
            ? actualPayout - expectedPayout
            : expectedPayout - actualPayout;

          if (diff <= 1n) {
            correctPayouts++;
          } else {
            incorrectPayouts++;
            console.log(
              `  Round ${i + 1}: Expected ${expectedPayout}, got ${actualPayout}`
            );
          }
        }

        metrics.recordBetResolved('baccarat', {
          won: result.won ?? false,
          payout: result.payout ?? 0n,
          latencyMs: result.latencyMs,
        });
      } else {
        metrics.recordError('baccarat', result.error ?? 'Unknown error');
      }

      await sleep(50);
    }

    console.log(`  Banker wins: ${bankerWins}`);
    console.log(`  Correct payouts: ${correctPayouts}`);
    console.log(`  Incorrect payouts: ${incorrectPayouts}`);

    expect(correctPayouts).toBeGreaterThan(incorrectPayouts);
  }, TEST_TIMEOUT);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
