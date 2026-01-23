/**
 * Multi-Game Concurrent Stress Test
 *
 * Tests all 10 games running simultaneously with multiple players.
 * Verifies system stability under realistic concurrent load.
 *
 * Run with: RUN_STRESS=true pnpm -C gateway test:stress -- --testPathPattern=multi-game-concurrent
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  CasinoClient,
  createClientPool,
  disconnectPool,
  createMetricsCollector,
  ALL_GAMES,
  type MetricsCollector,
  type SupportedGame,
} from './helpers/index.js';

// Configuration
const GATEWAY_URL = process.env.STRESS_GATEWAY_URL || 'ws://localhost:9010';
const STRESS_ENABLED = process.env.RUN_STRESS === 'true';
const PLAYERS_PER_GAME = parseInt(process.env.CONCURRENT_PLAYERS_PER_GAME || '10', 10);
const ROUNDS_PER_PLAYER = parseInt(process.env.ROUNDS_PER_PLAYER || '5', 10);
const BET_AMOUNT = parseInt(process.env.CONCURRENT_BET_AMOUNT || '100', 10);
const TEST_TIMEOUT = parseInt(process.env.TEST_TIMEOUT_MS || '1800000', 10); // 30 min default

describe.skipIf(!STRESS_ENABLED)('Multi-Game Concurrent Stress Tests', () => {
  let metrics: MetricsCollector;
  let isGatewayAvailable = false;

  beforeAll(async () => {
    metrics = createMetricsCollector();

    // Quick gateway check
    try {
      const testClient = new CasinoClient({ gatewayUrl: GATEWAY_URL });
      await testClient.connect();
      isGatewayAvailable = testClient.isConnected();
      testClient.disconnect();
    } catch {
      console.warn('Gateway not available');
    }
  }, 30000);

  afterAll(() => {
    console.log('\n' + metrics.generateReport({ includeLatencyHistogram: true }));
  });

  it('should run all 10 games concurrently', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n🎰 Starting multi-game concurrent test...');
    console.log(`   Players per game: ${PLAYERS_PER_GAME}`);
    console.log(`   Rounds per player: ${ROUNDS_PER_PLAYER}`);
    console.log(`   Total expected bets: ${ALL_GAMES.length * PLAYERS_PER_GAME * ROUNDS_PER_PLAYER}`);
    console.log('');

    const gamePromises: Promise<void>[] = [];

    for (const game of ALL_GAMES) {
      const gamePromise = runGameWorker(game, PLAYERS_PER_GAME, ROUNDS_PER_PLAYER, metrics);
      gamePromises.push(gamePromise);
    }

    await Promise.all(gamePromises);

    // Verify results
    const totalBets = metrics.getMetrics().totalBetsPlaced;
    const resolvedBets = metrics.getMetrics().totalBetsResolved;
    const successRate = metrics.getMetrics().successRate;
    const latencyStats = metrics.getAggregateLatencyStats();

    console.log('\n📊 Final Results:');
    console.log(`   Total Bets Placed: ${totalBets}`);
    console.log(`   Total Bets Resolved: ${resolvedBets}`);
    console.log(`   Success Rate: ${(successRate * 100).toFixed(2)}%`);
    console.log(`   P99 Latency: ${latencyStats.p99.toFixed(1)}ms`);

    // Assertions
    expect(successRate).toBeGreaterThan(0.95); // 95% success rate
    expect(latencyStats.p99).toBeLessThan(5000); // P99 under 5s
  }, TEST_TIMEOUT);

  it('should handle burst traffic across all games', async () => {
    if (!isGatewayAvailable) {
      console.warn('Skipping: Gateway not available');
      return;
    }

    console.log('\n⚡ Testing burst traffic across all games...');

    // Create a burst of clients all at once
    const burstSize = 50;
    const allClients: CasinoClient[] = await createClientPool(GATEWAY_URL, burstSize, 10);

    console.log(`   Connected ${allClients.length} clients for burst test`);

    if (allClients.length === 0) {
      console.warn('   No clients connected, skipping');
      return;
    }

    // Each client plays a random game 3 times rapidly
    const burstPromises: Promise<void>[] = [];

    for (const client of allClients) {
      const clientPromise = (async () => {
        const game = ALL_GAMES[Math.floor(Math.random() * ALL_GAMES.length)];

        for (let i = 0; i < 3; i++) {
          await playGameRound(client, game, BET_AMOUNT, metrics);
          await sleep(10); // Minimal delay for burst
        }
      })();

      burstPromises.push(clientPromise);
    }

    await Promise.all(burstPromises);

    // Cleanup
    disconnectPool(allClients);

    const successRate = metrics.getMetrics().successRate;
    console.log(`   Burst test success rate: ${(successRate * 100).toFixed(2)}%`);

    expect(successRate).toBeGreaterThan(0.9);
  }, TEST_TIMEOUT);
});

/**
 * Run a game worker with multiple players
 */
async function runGameWorker(
  game: SupportedGame,
  playerCount: number,
  roundsPerPlayer: number,
  metrics: MetricsCollector
): Promise<void> {
  console.log(`   Starting ${game} with ${playerCount} players...`);

  const clients = await createClientPool(GATEWAY_URL, playerCount, 5);
  console.log(`   ${game}: ${clients.length} players connected`);

  if (clients.length === 0) {
    console.log(`   ${game}: No players connected, skipping`);
    return;
  }

  const playerPromises: Promise<void>[] = [];

  for (const client of clients) {
    const playerPromise = (async () => {
      for (let round = 0; round < roundsPerPlayer; round++) {
        await playGameRound(client, game, BET_AMOUNT, metrics);
        await sleep(100 + Math.random() * 100); // 100-200ms between rounds
      }
    })();

    playerPromises.push(playerPromise);
  }

  await Promise.all(playerPromises);

  // Cleanup
  disconnectPool(clients);

  const gameStats = metrics.getMetrics().games.get(game);
  console.log(`   ${game}: Completed ${gameStats?.totalBets ?? 0} bets`);
}

/**
 * Play a single round of a game
 */
async function playGameRound(
  client: CasinoClient,
  game: SupportedGame,
  amount: number,
  metrics: MetricsCollector
): Promise<void> {
  metrics.recordBetPlaced(game, BigInt(amount));

  try {
    let result;

    switch (game) {
      case 'blackjack':
        result = await client.playBlackjack(amount);
        break;
      case 'roulette':
        result = await client.playRoulette([{ type: 'RED', amount }]);
        break;
      case 'craps':
        result = await client.playCraps([{ type: 'PASS', amount }]);
        break;
      case 'baccarat':
        result = await client.playBaccarat([{ type: 'BANKER', amount }]);
        break;
      case 'sicbo':
        result = await client.playSicBo([{ type: 'BIG', amount }]);
        break;
      case 'videopoker':
        result = await client.playVideoPoker(amount);
        break;
      case 'casinowar':
        result = await client.playCasinoWar(amount);
        break;
      case 'hilo':
        result = await client.playHiLo(amount, 'higher');
        break;
      case 'threecard':
        result = await client.playThreeCard(amount);
        break;
      case 'ultimateholdem':
        result = await client.playUltimateHoldem(amount);
        break;
      default:
        throw new Error(`Unknown game: ${game}`);
    }

    if (result.success) {
      metrics.recordBetResolved(game, {
        won: result.won ?? false,
        payout: result.payout ?? 0n,
        latencyMs: result.latencyMs,
      });
    } else {
      metrics.recordError(game, result.error ?? 'Unknown error');
    }
  } catch (err) {
    metrics.recordError(game, err instanceof Error ? err.message : String(err));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const GATEWAY_URL_EXPORT = GATEWAY_URL;
export { GATEWAY_URL_EXPORT as GATEWAY_URL };
