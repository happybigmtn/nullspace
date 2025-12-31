/**
 * Comprehensive bet type testing for gateway integration.
 * Tests ALL bet types and bonus bets for each game.
 */
import WebSocket from 'ws';
import { describe, it, expect } from 'vitest';

const GATEWAY_PORT = process.env.TEST_GATEWAY_PORT || '9010';
const GATEWAY_URL = `ws://localhost:${GATEWAY_PORT}`;
const INTEGRATION_ENABLED = process.env.RUN_INTEGRATION === 'true';

interface TestResult {
  game: string;
  betType: string;
  status: 'success' | 'failed';
  response?: string;
  payout?: string;
  error?: string;
}

function createConnection(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATEWAY_URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Connection timeout')), 5000);
  });
}

function sendAndReceive(ws: WebSocket, msg: unknown, timeout = 35000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Response timeout')), timeout);

    const handler = (data: WebSocket.Data) => {
      clearTimeout(timer);
      ws.off('message', handler);
      try {
        resolve(JSON.parse(data.toString()));
      } catch (err) {
        reject(err);
      }
    };

    ws.on('message', handler);
    ws.send(JSON.stringify(msg));
  });
}

async function waitForReady(ws: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('session_ready timeout')), 10000);
    const handler = (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'session_ready') {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve();
      }
    };
    ws.on('message', handler);
  });

  for (let i = 0; i < 30; i++) {
    const balance = await sendAndReceive(ws, { type: 'get_balance' });
    if (balance.registered && balance.hasBalance) {
      return;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Registration timeout');
}

async function testBet(
  game: string,
  betType: string,
  startMsg: Record<string, unknown>,
  moveMsg?: Record<string, unknown>
): Promise<TestResult> {
  let ws: WebSocket | null = null;

  try {
    ws = await createConnection();
    await waitForReady(ws);

    const startResponse = await sendAndReceive(ws, startMsg);

    if (startResponse.type === 'error') {
      return {
        game,
        betType,
        status: 'failed',
        error: (startResponse as { message?: string }).message || 'Start error',
      };
    }

    // For instant games or auto-resolving games
    if (!moveMsg) {
      const payout = (startResponse as { payout?: number }).payout;
      return {
        game,
        betType,
        status: 'success',
        response: startResponse.type as string,
        payout: payout !== undefined ? String(payout) : undefined,
      };
    }

    // Make the move
    const moveResponse = await sendAndReceive(ws, moveMsg);

    if (moveResponse.type === 'error') {
      return {
        game,
        betType,
        status: 'failed',
        error: (moveResponse as { message?: string }).message || 'Move error',
      };
    }

    const payout = (moveResponse as { payout?: number }).payout;
    return {
      game,
      betType,
      status: 'success',
      response: `${startResponse.type} → ${moveResponse.type}`,
      payout: payout !== undefined ? String(payout) : undefined,
    };
  } catch (err) {
    return {
      game,
      betType,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (ws) ws.close();
  }
}

// ============================================================
// CRAPS BET TYPES
// ============================================================
const CRAPS_BETS = [
  // Core bets
  { name: 'Pass Line', betType: 0, target: 0 },
  { name: 'Don\'t Pass', betType: 1, target: 0 },
  { name: 'Come', betType: 2, target: 0 },
  { name: 'Don\'t Come', betType: 3, target: 0 },
  { name: 'Field', betType: 4, target: 0 },

  // Place bets (Yes) - require target 4,5,6,8,9,10
  { name: 'Yes (Place 4)', betType: 5, target: 4 },
  { name: 'Yes (Place 5)', betType: 5, target: 5 },
  { name: 'Yes (Place 6)', betType: 5, target: 6 },
  { name: 'Yes (Place 8)', betType: 5, target: 8 },
  { name: 'Yes (Place 9)', betType: 5, target: 9 },
  { name: 'Yes (Place 10)', betType: 5, target: 10 },

  // Lay bets (No) - require target
  { name: 'No (Lay 4)', betType: 6, target: 4 },
  { name: 'No (Lay 6)', betType: 6, target: 6 },

  // Hop bets (Next) - exact total on next roll
  { name: 'Next (Hop 7)', betType: 7, target: 7 },
  { name: 'Next (Hop 11)', betType: 7, target: 11 },

  // Hardway bets
  { name: 'Hardway 4', betType: 8, target: 0 },
  { name: 'Hardway 6', betType: 9, target: 0 },
  { name: 'Hardway 8', betType: 10, target: 0 },
  { name: 'Hardway 10', betType: 11, target: 0 },

  // Fire bet (side bet)
  { name: 'Fire Bet', betType: 12, target: 0 },

  // ATS bets
  { name: 'ATS Small', betType: 15, target: 0 },
  { name: 'ATS Tall', betType: 16, target: 0 },
  { name: 'ATS All', betType: 17, target: 0 },

  // Additional side bets
  { name: 'Muggsy', betType: 18, target: 0 },
  { name: 'Diff Doubles', betType: 19, target: 0 },
  { name: 'Ride Line', betType: 20, target: 0 },
  { name: 'Replay', betType: 21, target: 0 },
  { name: 'Hot Roller', betType: 22, target: 0 },
];

// ============================================================
// BACCARAT BET TYPES
// ============================================================
const BACCARAT_BETS = [
  { name: 'Player', type: 'PLAYER' },
  { name: 'Banker', type: 'BANKER' },
  { name: 'Tie', type: 'TIE' },
  { name: 'Player Pair', type: 'P_PAIR' },
  { name: 'Banker Pair', type: 'B_PAIR' },
  { name: 'Lucky 6', type: 'LUCKY6' },
  { name: 'Player Dragon', type: 'P_DRAGON' },
  { name: 'Banker Dragon', type: 'B_DRAGON' },
  { name: 'Panda 8', type: 'PANDA8' },
  { name: 'Player Perfect Pair', type: 'P_PERFECT_PAIR' },
  { name: 'Banker Perfect Pair', type: 'B_PERFECT_PAIR' },
];

// ============================================================
// ROULETTE BET TYPES
// ============================================================
const ROULETTE_BETS = [
  // Inside bets
  { name: 'Straight (17)', type: 0, value: 17 },  // Single number
  { name: 'Straight (0)', type: 0, value: 0 },    // Zero
  { name: 'Split H (1-2)', type: 9, value: 1 },   // Horizontal split
  { name: 'Split V (1-4)', type: 10, value: 1 },  // Vertical split
  { name: 'Street (1-3)', type: 11, value: 1 },   // Street bet
  { name: 'Corner (1-5)', type: 12, value: 1 },   // Corner bet
  { name: 'Six Line (1-6)', type: 13, value: 1 }, // Six line bet

  // Outside bets
  { name: 'Red', type: 1, value: 0 },
  { name: 'Black', type: 2, value: 0 },
  { name: 'Odd', type: 4, value: 0 },
  { name: 'Even', type: 3, value: 0 },
  { name: 'Low (1-18)', type: 5, value: 0 },
  { name: 'High (19-36)', type: 6, value: 0 },
  { name: 'Dozen 1', type: 7, value: 0 },
  { name: 'Dozen 2', type: 7, value: 1 },
  { name: 'Dozen 3', type: 7, value: 2 },
  { name: 'Column 1', type: 8, value: 0 },
  { name: 'Column 2', type: 8, value: 1 },
  { name: 'Column 3', type: 8, value: 2 },
];

// ============================================================
// SIC BO BET TYPES
// ============================================================
const SICBO_BETS = [
  { name: 'Small (4-10)', type: 0, number: 0 },
  { name: 'Big (11-17)', type: 1, number: 0 },
  { name: 'Odd', type: 2, number: 0 },
  { name: 'Even', type: 3, number: 0 },
  { name: 'Specific Triple (1)', type: 4, number: 1 },
  { name: 'Any Triple', type: 5, number: 0 },
  { name: 'Specific Double (3)', type: 6, number: 3 },
  { name: 'Total (10)', type: 7, number: 10 },
  { name: 'Single (4)', type: 8, number: 4 },
  { name: 'Domino (2-5)', type: 9, number: (2 << 4) | 5 },
  { name: 'Hop3 Easy (1-2-3)', type: 10, number: (1 << 0) | (1 << 1) | (1 << 2) },
  { name: 'Hop3 Hard (2-2-3)', type: 11, number: (2 << 4) | 3 },
  { name: 'Hop4 Easy (1-2-3-4)', type: 12, number: (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) },
];

// ============================================================
// THREE CARD POKER BONUS BETS
// ============================================================
const THREE_CARD_BETS = [
  { name: 'Ante Only', ante: 100, pairPlus: 0, sixCard: 0, progressive: 0 },
  { name: 'Ante + Pair Plus', ante: 100, pairPlus: 50, sixCard: 0, progressive: 0 },
  { name: 'Ante + Six Card', ante: 100, pairPlus: 0, sixCard: 25, progressive: 0 },
  { name: 'Ante + Progressive', ante: 100, pairPlus: 0, sixCard: 0, progressive: 1 },
  { name: 'All Side Bets', ante: 100, pairPlus: 25, sixCard: 25, progressive: 1 },
];

// ============================================================
// ULTIMATE HOLDEM BONUS BETS
// ============================================================
const ULTIMATE_HOLDEM_BETS = [
  { name: 'Ante/Blind Only', ante: 100, blind: 100, trips: 0, sixCard: 0, progressive: 0 },
  { name: 'With Trips', ante: 100, blind: 100, trips: 50, sixCard: 0, progressive: 0 },
  { name: 'With 6-Card Bonus', ante: 100, blind: 100, trips: 0, sixCard: 25, progressive: 0 },
  { name: 'With Progressive', ante: 100, blind: 100, trips: 0, sixCard: 0, progressive: 1 },
  { name: 'All Side Bets', ante: 100, blind: 100, trips: 25, sixCard: 25, progressive: 1 },
];

// ============================================================
// BLACKJACK BONUS BETS
// ============================================================
const BLACKJACK_BETS = [
  { name: 'Standard', amount: 100, sideBet21Plus3: 0 },
  { name: 'With 21+3', amount: 100, sideBet21Plus3: 25 },
];

// ============================================================
// REMAINING GAMES
// ============================================================
const OTHER_GAMES = [
  { name: 'HiLo Deal', game: 'HiLo', msg: { type: 'hilo_deal', amount: 100 } },
  { name: 'Video Poker Deal', game: 'Video Poker', msg: { type: 'videopoker_deal', amount: 100 } },
  { name: 'Casino War Basic', game: 'Casino War', msg: { type: 'casinowar_deal', amount: 100, tieBet: 0 } },
  { name: 'Casino War +Tie', game: 'Casino War', msg: { type: 'casinowar_deal', amount: 100, tieBet: 25 } },
];

async function runBaccaratTests(): Promise<TestResult[]> {
  console.log('\n=== BACCARAT BET TYPES ===\n');
  const results: TestResult[] = [];

  for (const bet of BACCARAT_BETS) {
    process.stdout.write(`  ${bet.name.padEnd(25)}... `);
    const result = await testBet(
      'Baccarat',
      bet.name,
      { type: 'baccarat_deal', bets: [{ type: bet.type, amount: 100 }] }
    );
    results.push(result);

    if (result.status === 'success') {
      console.log(`✅ ${result.response}${result.payout ? ` (payout: ${result.payout})` : ''}`);
    } else {
      console.log(`❌ ${result.error}`);
    }
  }

  return results;
}

async function runCrapsTests(): Promise<TestResult[]> {
  console.log('\n=== CRAPS BET TYPES ===\n');
  const results: TestResult[] = [];

  for (const bet of CRAPS_BETS) {
    process.stdout.write(`  ${bet.name.padEnd(25)}... `);
    const result = await testBet(
      'Craps',
      bet.name,
      { type: 'craps_bet', betType: bet.betType, target: bet.target, amount: 100 }
    );
    results.push(result);

    if (result.status === 'success') {
      console.log(`✅ ${result.response}${result.payout ? ` (payout: ${result.payout})` : ''}`);
    } else {
      console.log(`❌ ${result.error}`);
    }
  }

  return results;
}

async function runRouletteTests(): Promise<TestResult[]> {
  console.log('\n=== ROULETTE BET TYPES ===\n');
  const results: TestResult[] = [];

  for (const bet of ROULETTE_BETS) {
    process.stdout.write(`  ${bet.name.padEnd(25)}... `);
    const result = await testBet(
      'Roulette',
      bet.name,
      { type: 'roulette_spin', bets: [{ type: bet.type, value: bet.value, amount: 100 }] }
    );
    results.push(result);

    if (result.status === 'success') {
      console.log(`✅ ${result.response}${result.payout ? ` (payout: ${result.payout})` : ''}`);
    } else {
      console.log(`❌ ${result.error}`);
    }
  }

  return results;
}

async function runSicBoTests(): Promise<TestResult[]> {
  console.log('\n=== SIC BO BET TYPES ===\n');
  const results: TestResult[] = [];

  for (const bet of SICBO_BETS) {
    process.stdout.write(`  ${bet.name.padEnd(25)}... `);
    const result = await testBet(
      'Sic Bo',
      bet.name,
      { type: 'sicbo_roll', bets: [{ type: bet.type, number: bet.number, amount: 100 }] }
    );
    results.push(result);

    if (result.status === 'success') {
      console.log(`✅ ${result.response}${result.payout ? ` (payout: ${result.payout})` : ''}`);
    } else {
      console.log(`❌ ${result.error}`);
    }
  }

  return results;
}

async function runThreeCardPokerTests(): Promise<TestResult[]> {
  console.log('\n=== THREE CARD POKER BETS ===\n');
  const results: TestResult[] = [];

  for (const bet of THREE_CARD_BETS) {
    process.stdout.write(`  ${bet.name.padEnd(25)}... `);
    const result = await testBet(
      'Three Card Poker',
      bet.name,
      {
        type: 'threecardpoker_deal',
        ante: bet.ante,
        pairPlus: bet.pairPlus,
        sixCard: bet.sixCard,
        progressive: bet.progressive,
      },
      { type: 'threecardpoker_play' }
    );
    results.push(result);

    if (result.status === 'success') {
      console.log(`✅ ${result.response}${result.payout ? ` (payout: ${result.payout})` : ''}`);
    } else {
      console.log(`❌ ${result.error}`);
    }
  }

  return results;
}

async function runUltimateHoldemTests(): Promise<TestResult[]> {
  console.log('\n=== ULTIMATE HOLDEM BETS ===\n');
  const results: TestResult[] = [];

  for (const bet of ULTIMATE_HOLDEM_BETS) {
    process.stdout.write(`  ${bet.name.padEnd(25)}... `);
    const result = await testBet(
      'Ultimate Holdem',
      bet.name,
      {
        type: 'ultimateholdem_deal',
        ante: bet.ante,
        blind: bet.blind,
        trips: bet.trips,
        sixCard: bet.sixCard,
        progressive: bet.progressive,
      },
      { type: 'ultimateholdem_check' }  // Check through to river, then fold or bet
    );
    results.push(result);

    if (result.status === 'success') {
      console.log(`✅ ${result.response}${result.payout ? ` (payout: ${result.payout})` : ''}`);
    } else {
      console.log(`❌ ${result.error}`);
    }
  }

  return results;
}

async function runBlackjackTests(): Promise<TestResult[]> {
  console.log('\n=== BLACKJACK BETS ===\n');
  const results: TestResult[] = [];

  for (const bet of BLACKJACK_BETS) {
    process.stdout.write(`  ${bet.name.padEnd(25)}... `);
    const result = await testBet(
      'Blackjack',
      bet.name,
      { type: 'blackjack_deal', amount: bet.amount, sideBet21Plus3: bet.sideBet21Plus3 }
    );
    results.push(result);

    if (result.status === 'success') {
      console.log(`✅ ${result.response}${result.payout ? ` (payout: ${result.payout})` : ''}`);
    } else {
      console.log(`❌ ${result.error}`);
    }
  }

  return results;
}

async function runOtherGamesTests(): Promise<TestResult[]> {
  console.log('\n=== OTHER GAMES ===\n');
  const results: TestResult[] = [];

  for (const game of OTHER_GAMES) {
    process.stdout.write(`  ${game.name.padEnd(25)}... `);
    const result = await testBet(game.game, game.name, game.msg);
    results.push(result);

    if (result.status === 'success') {
      console.log(`✅ ${result.response}${result.payout ? ` (payout: ${result.payout})` : ''}`);
    } else {
      console.log(`❌ ${result.error}`);
    }
  }

  return results;
}

async function runAllTests(): Promise<TestResult[]> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       COMPREHENSIVE BET TYPE TESTING                       ║');
  console.log('╠════════════════════════════════════════════════════════════╣');

  const allResults: TestResult[] = [];

  // Run tests for each game category
  allResults.push(...await runBaccaratTests());
  allResults.push(...await runCrapsTests());
  allResults.push(...await runRouletteTests());
  allResults.push(...await runSicBoTests());
  allResults.push(...await runThreeCardPokerTests());
  allResults.push(...await runUltimateHoldemTests());
  allResults.push(...await runBlackjackTests());
  allResults.push(...await runOtherGamesTests());

  // Summary
  console.log('\n╠════════════════════════════════════════════════════════════╣');
  const passed = allResults.filter(r => r.status === 'success').length;
  const failed = allResults.filter(r => r.status === 'failed').length;
  console.log(`║  Total: ${passed} passed, ${failed} failed                                ║`);
  console.log('╚════════════════════════════════════════════════════════════╝');

  if (failed > 0) {
    console.log('\nFailed bets:');
    for (const result of allResults.filter(r => r.status === 'failed')) {
      console.log(`  - ${result.game} / ${result.betType}: ${result.error}`);
    }
  }

  return allResults;
}

describe.skipIf(!INTEGRATION_ENABLED)('Gateway bet type coverage', () => {
  it(
    'executes all bet types against a live gateway',
    async () => {
      const results = await runAllTests();
      const failed = results.filter((result) => result.status === 'failed');
      expect(failed).toEqual([]);
    },
    180_000
  );
});
