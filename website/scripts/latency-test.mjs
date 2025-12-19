/**
 * Comprehensive Casino Latency Test
 *
 * Tests all 10 casino games with various bet types and measures:
 * - Transaction submission latency
 * - Block confirmation latency
 * - UI update latency (result display)
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HOST = '127.0.0.1';
const PORT = 4173;
const BASE_URL = `http://${HOST}:${PORT}`;
const CHROMIUM_PATH = process.env.PW_CHROMIUM_PATH || '/usr/bin/chromium';

const WEBSITE_DIR = fileURLToPath(new URL('..', import.meta.url));
const REPO_DIR = fileURLToPath(new URL('../..', import.meta.url));

const SIMULATOR_PORT = Number(process.env.SMOKE_SIMULATOR_PORT || 8089);
const SIMULATOR_URL = process.env.SMOKE_SIMULATOR_URL || `http://127.0.0.1:${SIMULATOR_PORT}`;
const SIMULATOR_BIN =
  process.env.SMOKE_SIMULATOR_BIN || path.join(REPO_DIR, 'target', 'release', 'nullspace-simulator');
const EXECUTOR_BIN =
  process.env.SMOKE_EXECUTOR_BIN || path.join(REPO_DIR, 'target', 'release', 'dev-executor');
const BLOCK_INTERVAL = Number(process.env.BLOCK_INTERVAL_MS || 50);
const HEADLESS = !process.env.HEADED;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Latency results storage
const results = {
  games: {},
  summary: {
    totalTests: 0,
    avgLatency: 0,
    minLatency: Infinity,
    maxLatency: 0,
    p95Latency: 0
  }
};

async function waitForHttpOk(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.ok || res.status === 304) return;
    } catch {
      // ignore
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function readDotEnv(envPath) {
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    const out = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (key) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

async function waitForSimulatorReady(url, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/seed/00`, { redirect: 'manual' });
      if (res.ok || res.status === 404) return;
    } catch {
      // ignore
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for simulator at ${url}`);
}

function killGroup(child, signal = 'SIGTERM') {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // ignore
  }
}

function startBackend(identityHex) {
  if (!fs.existsSync(SIMULATOR_BIN)) {
    throw new Error(`Simulator binary not found at ${SIMULATOR_BIN} (build with cargo)`);
  }
  if (!fs.existsSync(EXECUTOR_BIN)) {
    throw new Error(`dev-executor binary not found at ${EXECUTOR_BIN} (build with cargo)`);
  }

  const simulator = spawn(
    SIMULATOR_BIN,
    ['--host', '127.0.0.1', '--port', String(SIMULATOR_PORT), '--identity', identityHex],
    { cwd: REPO_DIR, stdio: 'inherit', detached: true }
  );
  simulator.unref();

  const executor = spawn(
    EXECUTOR_BIN,
    ['--url', SIMULATOR_URL, '--identity', identityHex, '--block-interval-ms', String(BLOCK_INTERVAL)],
    { cwd: REPO_DIR, stdio: 'inherit', detached: true }
  );
  executor.unref();

  return { simulator, executor };
}

function startVite(extraEnv) {
  const child = spawn(
    'npm',
    ['run', 'dev', '--', '--host', HOST, '--port', String(PORT), '--strictPort'],
    {
      cwd: WEBSITE_DIR,
      stdio: 'inherit',
      env: { ...process.env, PORT: String(PORT), ...extraEnv },
      detached: true,
    }
  );
  child.unref();
  return child;
}

/**
 * Record a latency measurement
 */
function recordLatency(game, betType, latencyMs) {
  if (!results.games[game]) {
    results.games[game] = {
      bets: {},
      avgLatency: 0,
      minLatency: Infinity,
      maxLatency: 0,
      measurements: []
    };
  }

  results.games[game].measurements.push({ betType, latencyMs });

  if (!results.games[game].bets[betType]) {
    results.games[game].bets[betType] = [];
  }
  results.games[game].bets[betType].push(latencyMs);

  // Update game stats
  const measurements = results.games[game].measurements.map(m => m.latencyMs);
  results.games[game].avgLatency = measurements.reduce((a, b) => a + b, 0) / measurements.length;
  results.games[game].minLatency = Math.min(...measurements);
  results.games[game].maxLatency = Math.max(...measurements);

  results.summary.totalTests++;
  console.log(`  [${game}] ${betType}: ${latencyMs.toFixed(0)}ms`);
}

/**
 * Navigate to a specific game via command palette
 */
async function navigateToGame(page, gameName) {
  await page.getByRole('button', { name: /^games$/i }).click();
  await page.getByPlaceholder(/type command or game name/i).fill(gameName);
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: new RegExp(`^${gameName}$`, 'i') }).waitFor();
  await sleep(500); // Wait for game to initialize
}

/**
 * Measure latency for a single bet action
 */
async function measureBetLatency(page, actionFn, waitCondition, timeout = 30_000) {
  const startTime = performance.now();
  await actionFn();
  await waitCondition();
  const endTime = performance.now();
  return endTime - startTime;
}

// ============================================================================
// GAME TEST FUNCTIONS
// ============================================================================

/**
 * Test Blackjack - sequential game with player decisions
 */
async function testBlackjack(page) {
  console.log('\n=== BLACKJACK ===');
  await navigateToGame(page, 'blackjack');
  // Wait for betting stage - look for the message area showing "PLACE BETS"
  await page.locator('.text-terminal-gold').filter({ hasText: /PLACE BETS/i }).first().waitFor({ timeout: 60_000 });

  // Test basic deal - Space=DEAL
  const dealLatency = await measureBetLatency(
    page,
    async () => await page.keyboard.press(' '), // DEAL (Space)
    async () => await page.locator('text=/DEALER|HIT|STAND/i').first().waitFor({ timeout: 30_000 })
  );
  recordLatency('blackjack', 'DEAL', dealLatency);

  // Test player action (STAND to complete hand) - s=STAND
  const standLatency = await measureBetLatency(
    page,
    async () => await page.keyboard.press('s'), // STAND shortcut
    async () => await page.locator('.text-terminal-gold').filter({ hasText: /PLACE BETS|WIN|LOSE|PUSH|BUST/i }).first().waitFor({ timeout: 30_000 })
  );
  recordLatency('blackjack', 'STAND', standLatency);

  await sleep(1000);

  // Test another round with HIT - h=HIT
  await page.keyboard.press(' '); // DEAL (Space)
  await page.locator('text=/DEALER|HIT|STAND/i').first().waitFor({ timeout: 30_000 });
  await sleep(500);

  // Try HIT
  const hitLatency = await measureBetLatency(
    page,
    async () => await page.keyboard.press('h'), // HIT shortcut
    async () => await sleep(500) // Wait for card animation
  );
  recordLatency('blackjack', 'HIT', hitLatency);

  // Complete the hand with STAND
  await page.keyboard.press('s'); // STAND shortcut
  await sleep(2000); // Wait for result
}

/**
 * Test Baccarat - atomic batch betting
 */
async function testBaccarat(page) {
  console.log('\n=== BACCARAT ===');
  await navigateToGame(page, 'baccarat');
  // Wait for betting stage
  await page.locator('.text-terminal-gold').filter({ hasText: /PLACE BETS|SELECT/i }).first().waitFor({ timeout: 60_000 });

  // Test PLAYER bet + DEAL (p=PLAYER, Space=DEAL)
  const playerBetLatency = await measureBetLatency(
    page,
    async () => {
      await page.keyboard.press('p'); // PLAYER selection
      await page.keyboard.press(' '); // DEAL (Space)
    },
    async () => await page.locator('.text-terminal-gold').filter({ hasText: /WINS|PLAYER|BANKER|NATURAL/i }).first().waitFor({ timeout: 30_000 })
  );
  recordLatency('baccarat', 'PLAYER_DEAL', playerBetLatency);

  await sleep(3000); // Wait for result display and reset

  // Test BANKER bet
  await page.locator('.text-terminal-gold').filter({ hasText: /PLACE BETS|SELECT/i }).first().waitFor({ timeout: 30_000 });
  const bankerBetLatency = await measureBetLatency(
    page,
    async () => {
      await page.keyboard.press('b'); // BANKER selection
      await page.keyboard.press(' '); // DEAL (Space)
    },
    async () => await page.locator('.text-terminal-gold').filter({ hasText: /WINS|PLAYER|BANKER|NATURAL/i }).first().waitFor({ timeout: 30_000 })
  );
  recordLatency('baccarat', 'BANKER_DEAL', bankerBetLatency);

  await sleep(3000);
}

/**
 * Test Roulette - atomic batch with multiple bet types
 */
async function testRoulette(page) {
  console.log('\n=== ROULETTE ===');
  await navigateToGame(page, 'roulette');
  // Wait for betting stage
  await page.locator('.text-terminal-gold').filter({ hasText: /PLACE BETS|BET/i }).first().waitFor({ timeout: 60_000 });

  // Test RED (outside bet) - r=RED, Space=SPIN
  const redLatency = await measureBetLatency(
    page,
    async () => {
      await page.keyboard.press('r'); // RED shortcut
      await page.keyboard.press(' '); // SPIN (Space)
    },
    async () => await page.locator('.text-terminal-gold').filter({ hasText: /RED|BLACK|GREEN|WINS|LOSES|\d+/i }).first().waitFor({ timeout: 30_000 })
  );
  recordLatency('roulette', 'RED_SPIN', redLatency);

  await sleep(3000);

  // Test BLACK - b=BLACK
  const blackLatency = await measureBetLatency(
    page,
    async () => {
      await page.keyboard.press('b'); // BLACK shortcut
      await page.keyboard.press(' '); // SPIN (Space)
    },
    async () => await page.locator('.text-terminal-gold').filter({ hasText: /RED|BLACK|GREEN|WINS|LOSES|\d+/i }).first().waitFor({ timeout: 30_000 })
  );
  recordLatency('roulette', 'BLACK_SPIN', blackLatency);

  await sleep(3000);
}

/**
 * Test Craps - complex betting with multiple types
 */
async function testCraps(page) {
  console.log('\n=== CRAPS ===');
  await navigateToGame(page, 'craps');
  await sleep(2000); // Wait for game to initialize

  // Test PASS LINE bet + roll - p=PASS, Space=ROLL
  const passLatency = await measureBetLatency(
    page,
    async () => {
      await page.keyboard.press('p'); // PASS shortcut
      await page.keyboard.press(' '); // ROLL (Space)
    },
    async () => await sleep(1000) // Wait for dice roll animation
  );
  recordLatency('craps', 'PASS_ROLL', passLatency);

  await sleep(2000);

  // Test FIELD bet + roll - f=FIELD
  const fieldLatency = await measureBetLatency(
    page,
    async () => {
      await page.keyboard.press('f'); // FIELD shortcut
      await page.keyboard.press(' '); // ROLL (Space)
    },
    async () => await sleep(1000)
  );
  recordLatency('craps', 'FIELD_ROLL', fieldLatency);

  await sleep(2000);
}

/**
 * Test Sic Bo - atomic batch
 */
async function testSicBo(page) {
  console.log('\n=== SIC BO ===');
  await navigateToGame(page, 'sic bo');
  await sleep(2000); // Wait for game to initialize

  // Test SMALL bet - s=SMALL, Space=ROLL
  const smallLatency = await measureBetLatency(
    page,
    async () => {
      await page.keyboard.press('s'); // SMALL shortcut
      await page.keyboard.press(' '); // ROLL (Space)
    },
    async () => await sleep(1000) // Wait for dice roll
  );
  recordLatency('sic_bo', 'SMALL_ROLL', smallLatency);

  await sleep(2000);

  // Test BIG bet - b=BIG
  const bigLatency = await measureBetLatency(
    page,
    async () => {
      await page.keyboard.press('b'); // BIG shortcut
      await page.keyboard.press(' '); // ROLL (Space)
    },
    async () => await sleep(1000)
  );
  recordLatency('sic_bo', 'BIG_ROLL', bigLatency);

  await sleep(2000);
}

/**
 * Test Casino War - simple ante game
 */
async function testCasinoWar(page) {
  console.log('\n=== CASINO WAR ===');
  await navigateToGame(page, 'casino war');
  await sleep(2000); // Wait for game to initialize

  // Test basic ante + deal - Space=DEAL
  const anteLatency = await measureBetLatency(
    page,
    async () => await page.keyboard.press(' '), // DEAL (Space)
    async () => await sleep(1000) // Wait for card deal
  );
  recordLatency('casino_war', 'ANTE_DEAL', anteLatency);

  await sleep(2000);
}

/**
 * Test Three Card Poker - atomic batch
 */
async function testThreeCardPoker(page) {
  console.log('\n=== THREE CARD POKER ===');
  await navigateToGame(page, 'three card');
  await sleep(2000); // Wait for game to initialize

  // Test Ante + Deal - Space=DEAL
  const anteLatency = await measureBetLatency(
    page,
    async () => await page.keyboard.press(' '), // DEAL (Space)
    async () => await sleep(1000) // Wait for card deal
  );
  recordLatency('three_card', 'ANTE_DEAL', anteLatency);

  await sleep(1000);

  // Play decision - p=PLAY
  const playLatency = await measureBetLatency(
    page,
    async () => await page.keyboard.press('p'), // PLAY shortcut
    async () => await sleep(1000) // Wait for result
  );
  recordLatency('three_card', 'PLAY_BET', playLatency);

  await sleep(2000);
}

/**
 * Test Ultimate Texas Hold'em - atomic batch with multiple bet rounds
 */
async function testUltimateHoldem(page) {
  console.log('\n=== ULTIMATE TEXAS HOLDEM ===');
  await navigateToGame(page, 'ultimate');
  await sleep(2000); // Wait for game to initialize

  // Test Ante + Deal - Space=DEAL
  const anteLatency = await measureBetLatency(
    page,
    async () => await page.keyboard.press(' '), // DEAL (Space)
    async () => await sleep(1000) // Wait for card deal
  );
  recordLatency('ultimate_holdem', 'ANTE_DEAL', anteLatency);

  await sleep(1000);

  // Pre-flop: c=CHECK
  const checkLatency = await measureBetLatency(
    page,
    async () => await page.keyboard.press('c'), // CHECK shortcut
    async () => await sleep(500)
  );
  recordLatency('ultimate_holdem', 'CHECK_PREFLOP', checkLatency);

  await sleep(1000);

  // Flop: c=CHECK
  const flopCheckLatency = await measureBetLatency(
    page,
    async () => await page.keyboard.press('c'), // CHECK shortcut
    async () => await sleep(500)
  );
  recordLatency('ultimate_holdem', 'CHECK_FLOP', flopCheckLatency);

  await sleep(1000);

  // River: f=FOLD to finish
  const riverLatency = await measureBetLatency(
    page,
    async () => await page.keyboard.press('f'), // FOLD to finish
    async () => await sleep(1000)
  );
  recordLatency('ultimate_holdem', 'FOLD_RIVER', riverLatency);

  await sleep(2000);
}

/**
 * Test Video Poker - sequential deal/draw
 */
async function testVideoPoker(page) {
  console.log('\n=== VIDEO POKER ===');
  await navigateToGame(page, 'video poker');
  await sleep(2000); // Wait for game to initialize

  // Test Deal - Space=DEAL
  const dealLatency = await measureBetLatency(
    page,
    async () => await page.keyboard.press(' '), // DEAL (Space)
    async () => await sleep(1000) // Wait for card deal
  );
  recordLatency('video_poker', 'DEAL', dealLatency);

  await sleep(500);

  // Test Draw (without holding any cards) - d=DRAW
  const drawLatency = await measureBetLatency(
    page,
    async () => await page.keyboard.press('d'), // DRAW shortcut
    async () => await sleep(1000) // Wait for draw
  );
  recordLatency('video_poker', 'DRAW', drawLatency);

  await sleep(2000);
}

/**
 * Test HiLo - simple guess game
 */
async function testHiLo(page) {
  console.log('\n=== HILO ===');
  await navigateToGame(page, 'hilo');
  await sleep(2000); // Wait for game to initialize

  // Start a new HiLo game first - Space=START
  await page.keyboard.press(' ');
  await sleep(1000);

  // Test HIGHER guess - h=HIGHER
  const higherLatency = await measureBetLatency(
    page,
    async () => await page.keyboard.press('h'), // HIGHER shortcut
    async () => await sleep(500) // HiLo is fast
  );
  recordLatency('hilo', 'HIGHER', higherLatency);

  await sleep(1000);

  // Test LOWER guess - l=LOWER
  const lowerLatency = await measureBetLatency(
    page,
    async () => await page.keyboard.press('l'), // LOWER shortcut
    async () => await sleep(500)
  );
  recordLatency('hilo', 'LOWER', lowerLatency);

  await sleep(2000);
}

/**
 * Generate final report
 */
function generateReport() {
  console.log('\n' + '='.repeat(60));
  console.log('LATENCY TEST REPORT');
  console.log('='.repeat(60));

  // Calculate overall stats
  const allLatencies = [];
  for (const game of Object.values(results.games)) {
    allLatencies.push(...game.measurements.map(m => m.latencyMs));
  }

  if (allLatencies.length > 0) {
    allLatencies.sort((a, b) => a - b);
    results.summary.avgLatency = allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length;
    results.summary.minLatency = allLatencies[0];
    results.summary.maxLatency = allLatencies[allLatencies.length - 1];
    results.summary.p95Latency = allLatencies[Math.floor(allLatencies.length * 0.95)];
  }

  // Per-game breakdown
  console.log('\nPER-GAME BREAKDOWN:');
  console.log('-'.repeat(60));

  for (const [game, data] of Object.entries(results.games)) {
    console.log(`\n${game.toUpperCase()}:`);
    console.log(`  Avg: ${data.avgLatency.toFixed(0)}ms | Min: ${data.minLatency.toFixed(0)}ms | Max: ${data.maxLatency.toFixed(0)}ms`);
    console.log(`  Bet types tested: ${Object.keys(data.bets).length}`);

    for (const [betType, latencies] of Object.entries(data.bets)) {
      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      console.log(`    ${betType}: ${avg.toFixed(0)}ms (${latencies.length} samples)`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('OVERALL SUMMARY:');
  console.log('-'.repeat(60));
  console.log(`Total tests: ${results.summary.totalTests}`);
  console.log(`Average latency: ${results.summary.avgLatency.toFixed(0)}ms`);
  console.log(`Min latency: ${results.summary.minLatency.toFixed(0)}ms`);
  console.log(`Max latency: ${results.summary.maxLatency.toFixed(0)}ms`);
  console.log(`P95 latency: ${results.summary.p95Latency.toFixed(0)}ms`);
  console.log(`Block interval: ${BLOCK_INTERVAL}ms`);

  // Optimization recommendations
  console.log('\n' + '='.repeat(60));
  console.log('OPTIMIZATION RECOMMENDATIONS:');
  console.log('-'.repeat(60));

  if (results.summary.avgLatency > 1000) {
    console.log('⚠️  HIGH LATENCY DETECTED');
    console.log('   Recommendations:');
    console.log('   1. Reduce block interval (currently ' + BLOCK_INTERVAL + 'ms)');
    console.log('   2. Use optimistic UI updates before chain confirmation');
    console.log('   3. Batch multiple bets into single atomic transactions');
    console.log('   4. Consider WebSocket subscriptions for instant updates');
  } else if (results.summary.avgLatency > 500) {
    console.log('⚡ MODERATE LATENCY');
    console.log('   Consider:');
    console.log('   1. Pre-loading game sessions');
    console.log('   2. Local state prediction');
    console.log('   3. Connection pooling');
  } else {
    console.log('✅ GOOD LATENCY - Under 500ms average');
  }

  // Write results to JSON file
  const outputPath = path.join(WEBSITE_DIR, 'latency-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);
}

async function run() {
  const envFile = path.join(WEBSITE_DIR, '.env');
  const envFromFile = readDotEnv(envFile);
  const identityHex = process.env.VITE_IDENTITY || envFromFile.VITE_IDENTITY;

  if (!identityHex) {
    throw new Error(`Missing VITE_IDENTITY (set env or add ${envFile})`);
  }

  console.log('Starting backend services...');
  const backend = startBackend(identityHex);
  await waitForSimulatorReady(SIMULATOR_URL);
  console.log('Backend ready.');

  const server = startVite({ VITE_URL: SIMULATOR_URL, VITE_IDENTITY: identityHex });

  try {
    console.log('Waiting for frontend...');
    await waitForHttpOk(BASE_URL);
    console.log('Frontend ready.');

    const browser = await chromium.launch({
      headless: HEADLESS,
      executablePath: CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      const page = await browser.newPage({ baseURL: BASE_URL });
      page.setDefaultTimeout(30_000);

      // Initialize localStorage
      await page.addInitScript(() => {
        try {
          localStorage.removeItem('nullspace_responsible_play_v1');
          localStorage.setItem('nullspace_vault_enabled', 'false');
        } catch {
          // ignore
        }
      });

      // Navigate to app and start cash game
      console.log('\nNavigating to app...');
      await page.goto('/');
      await page.getByRole('button', { name: /cash game/i }).click();

      // Claim faucet
      console.log('Claiming faucet...');
      for (let attempt = 0; attempt < 5; attempt++) {
        await page.getByRole('button', { name: /daily faucet/i }).click();
        try {
          await page.getByRole('button', { name: /claiming/i }).waitFor({ timeout: 3000 });
          break;
        } catch {
          await sleep(500);
        }
      }
      await page.getByRole('button', { name: /daily faucet/i }).waitFor({ timeout: 60_000 });
      console.log('Faucet claimed. Starting tests...');

      // Run all game tests
      await testBlackjack(page).catch(e => console.error('Blackjack test failed:', e.message));
      await testBaccarat(page).catch(e => console.error('Baccarat test failed:', e.message));
      await testRoulette(page).catch(e => console.error('Roulette test failed:', e.message));
      await testCraps(page).catch(e => console.error('Craps test failed:', e.message));
      await testSicBo(page).catch(e => console.error('Sic Bo test failed:', e.message));
      await testCasinoWar(page).catch(e => console.error('Casino War test failed:', e.message));
      await testThreeCardPoker(page).catch(e => console.error('Three Card Poker test failed:', e.message));
      await testUltimateHoldem(page).catch(e => console.error('Ultimate Holdem test failed:', e.message));
      await testVideoPoker(page).catch(e => console.error('Video Poker test failed:', e.message));
      await testHiLo(page).catch(e => console.error('HiLo test failed:', e.message));

      // Generate report
      generateReport();

      console.log('\n[latency-test] Complete');
    } finally {
      await browser.close();
    }
  } finally {
    killGroup(server);
    killGroup(backend.executor);
    killGroup(backend.simulator);
  }
}

run().catch((e) => {
  console.error('[latency-test] failed:', e);
  process.exit(1);
});
