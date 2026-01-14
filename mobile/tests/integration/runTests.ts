/**
 * Test Runner - Execute all game integration tests
 * Usage: ts-node tests/integration/runTests.ts [options]
 */

import * as fs from 'fs';
import * as path from 'path';
import { BlackjackTest } from './games/BlackjackTest';
import { HiLoTest } from './games/HiLoTest';
import { RouletteTest } from './games/RouletteTest';
import { CrapsTest } from './games/CrapsTest';
import { BaccaratTest } from './games/BaccaratTest';
import { SicBoTest } from './games/SicBoTest';
import { VideoPokerTest } from './games/VideoPokerTest';
import { CasinoWarTest } from './games/CasinoWarTest';
import { ThreeCardTest } from './games/ThreeCardTest';
import { UltimateHoldemTest } from './games/UltimateHoldemTest';
import { TestResult } from './framework/BaseGameTest';

// Configuration
const DEFAULT_GATEWAY_URL = process.env.GATEWAY_URL || 'wss://api.testnet.regenesis.dev';
const RESULTS_DIR = path.join(__dirname, 'results');

interface TestSuiteResult {
  timestamp: string;
  gatewayUrl: string;
  tests: {
    [testName: string]: TestResult & {
      duration: number;
    };
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    totalErrors: number;
    totalWarnings: number;
  };
}

async function runAllTests(gatewayUrl: string): Promise<TestSuiteResult> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         Nullspace Mobile Integration Test Suite             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nGateway URL: ${gatewayUrl}`);
  console.log(`Start Time: ${new Date().toISOString()}\n`);

  const results: TestSuiteResult = {
    timestamp: new Date().toISOString(),
    gatewayUrl,
    tests: {},
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      totalErrors: 0,
      totalWarnings: 0,
    },
  };

  // Define all tests to run
  const tests = [
    { name: 'Blackjack', TestClass: BlackjackTest },
    { name: 'Hi-Lo', TestClass: HiLoTest },
    { name: 'Roulette', TestClass: RouletteTest },
    { name: 'Craps', TestClass: CrapsTest },
    { name: 'Baccarat', TestClass: BaccaratTest },
    { name: 'Sic Bo', TestClass: SicBoTest },
    { name: 'Video Poker', TestClass: VideoPokerTest },
    { name: 'Casino War', TestClass: CasinoWarTest },
    { name: 'Three Card Poker', TestClass: ThreeCardTest },
    { name: 'Ultimate Hold\'em', TestClass: UltimateHoldemTest },
  ];

  // Run each test
  for (const { name, TestClass } of tests) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Running: ${name}`);
    console.log('='.repeat(80));

    const startTime = Date.now();

    try {
      const test = new TestClass({ gatewayUrl, timeout: 60000 }); // Match gateway test timeout
      const result = await test.run();

      const duration = Date.now() - startTime;

      results.tests[name] = {
        ...result,
        duration,
      };

      results.summary.total++;
      if (result.passed) {
        results.summary.passed++;
        console.log(`\n✓ ${name} PASSED (${(duration / 1000).toFixed(2)}s)`);
      } else {
        results.summary.failed++;
        console.log(`\n✗ ${name} FAILED (${(duration / 1000).toFixed(2)}s)`);
        console.log(`Errors: ${result.errors.length}`);
        result.errors.forEach((error, i) => {
          console.log(`  ${i + 1}. ${error}`);
        });
      }

      results.summary.totalErrors += result.errors.length;
      results.summary.totalWarnings += result.warnings.length;
    } catch (error) {
      const duration = Date.now() - startTime;

      results.tests[name] = {
        passed: false,
        duration,
        errors: [`Fatal error: ${error}`],
        warnings: [],
        gameResults: [],
      };

      results.summary.total++;
      results.summary.failed++;
      results.summary.totalErrors++;

      console.log(`\n✗ ${name} FAILED (Fatal Error)`);
      console.log(`Error: ${error}`);
    }

    // Brief pause between tests (avoid rate limiting)
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  return results;
}

async function saveResults(results: TestSuiteResult): Promise<void> {
  // Create results directory if it doesn't exist
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `test-results-${timestamp}.json`;
  const filepath = path.join(RESULTS_DIR, filename);

  fs.writeFileSync(filepath, JSON.stringify(results, null, 2));

  console.log(`\n📝 Results saved to: ${filepath}`);
}

function printFinalSummary(results: TestSuiteResult): void {
  console.log('\n' + '='.repeat(80));
  console.log('FINAL TEST SUMMARY');
  console.log('='.repeat(80));

  console.log(`\nTotal Tests: ${results.summary.total}`);
  console.log(`✓ Passed: ${results.summary.passed}`);
  console.log(`✗ Failed: ${results.summary.failed}`);
  console.log(`⚠ Total Warnings: ${results.summary.totalWarnings}`);
  console.log(`✗ Total Errors: ${results.summary.totalErrors}`);

  console.log('\nTest Results:');
  for (const [name, result] of Object.entries(results.tests)) {
    const status = result.passed ? '✓ PASS' : '✗ FAIL';
    const duration = (result.duration / 1000).toFixed(2);
    const games = result.gameResults.length;
    const errors = result.errors.length;

    console.log(
      `  ${status} | ${name.padEnd(20)} | ${duration}s | ${games} games | ${errors} errors`
    );
  }

  console.log('\nGame Statistics:');
  const allGames = Object.values(results.tests).flatMap(r => r.gameResults);
  const totalGames = allGames.length;
  const totalWins = allGames.filter(g => g.result.includes('won') || g.result.includes('blackjack')).length;
  const totalBet = allGames.reduce((sum, g) => sum + g.bet, 0);
  const totalPayout = allGames.reduce((sum, g) => sum + g.payout, 0);

  console.log(`  Total Games Played: ${totalGames}`);
  console.log(`  Wins: ${totalWins} (${totalGames > 0 ? ((totalWins / totalGames) * 100).toFixed(1) : 0}%)`);
  console.log(`  Total Bet: ${totalBet.toFixed(2)}`);
  console.log(`  Total Payout: ${totalPayout.toFixed(2)}`);
  console.log(`  Net P/L: ${(totalPayout - totalBet).toFixed(2)}`);
  console.log(`  RTP: ${totalBet > 0 ? ((totalPayout / totalBet) * 100).toFixed(2) : 0}%`);

  console.log('\n' + '='.repeat(80));

  if (results.summary.failed === 0) {
    console.log('✓ ALL TESTS PASSED');
  } else {
    console.log(`✗ ${results.summary.failed} TEST(S) FAILED`);
  }

  console.log('='.repeat(80) + '\n');
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const gatewayUrl = args[0] || DEFAULT_GATEWAY_URL;

  try {
    const results = await runAllTests(gatewayUrl);
    await saveResults(results);
    printFinalSummary(results);

    // Exit with error code if any tests failed
    process.exit(results.summary.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('\n✗ Test suite failed with fatal error:');
    console.error(error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { runAllTests };
export type { TestSuiteResult };
