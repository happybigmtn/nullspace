/**
 * In-Flight Game State Test Runner
 * US-088: Add reconnection with in-flight game state test
 *
 * This test suite documents the architectural behavior where in-flight game
 * state is NOT preserved across reconnections. This is documentation, not a bug fix.
 *
 * Usage: npx tsx tests/integration/runInFlightGameStateTests.ts [gateway-url]
 * Example: npx tsx tests/integration/runInFlightGameStateTests.ts wss://api.testnet.regenesis.dev
 */

import * as fs from 'fs';
import * as path from 'path';
import { InFlightGameStateTest, InFlightGameStateTestResult } from './framework/InFlightGameStateTest';

const DEFAULT_GATEWAY_URL = process.env.GATEWAY_URL || 'wss://api.testnet.regenesis.dev';
const RESULTS_DIR = path.join(__dirname, 'results');

async function runInFlightGameStateTests(gatewayUrl: string): Promise<InFlightGameStateTestResult> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       In-Flight Game State Reconnection Tests                ║');
  console.log('║                      (US-088)                                ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  ARCHITECTURE DOCUMENTATION                                  ║');
  console.log('║  Documents that in-flight game state is NOT preserved        ║');
  console.log('║  on reconnection. This is current intentional behavior.      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nGateway URL: ${gatewayUrl}`);
  console.log(`Start Time: ${new Date().toISOString()}\n`);

  const test = new InFlightGameStateTest({
    gatewayUrl,
    timeout: 60000,
  });

  return await test.run();
}

function saveResults(result: InFlightGameStateTestResult): void {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `inflight-gamestate-test-${timestamp}.json`;
  const filepath = path.join(RESULTS_DIR, filename);

  fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
  console.log(`\n📝 Results saved to: ${filepath}`);
}

function printSummary(result: InFlightGameStateTestResult): void {
  const passed = result.tests.filter(t => t.passed).length;
  const failed = result.tests.length - passed;

  console.log('\n' + '='.repeat(80));
  console.log('IN-FLIGHT GAME STATE TEST SUMMARY');
  console.log('='.repeat(80));
  console.log(`\nTotal Tests: ${result.tests.length}`);
  console.log(`✓ Passed: ${passed}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`Duration: ${(result.duration / 1000).toFixed(2)}s`);

  console.log('\nTest Results:');
  for (const test of result.tests) {
    console.log(`  ${test.passed ? '✓ PASS' : '✗ FAIL'} | ${test.name}`);
    if (test.finding) console.log(`         Finding: ${test.finding}`);
    if (test.error) console.log(`         Error: ${test.error}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('ARCHITECTURAL FINDINGS:');
  console.log('─'.repeat(80));
  console.log('1. Gateway creates NEW session UUID on every WebSocket connection');
  console.log('2. activeGameId is reset to null on new sessions');
  console.log('3. Previous game state is LOST on reconnection (by design)');
  console.log('4. Balance persists because it is stored on-chain');
  console.log('5. Nonce sequence is maintained server-side');
  console.log('6. New games can be started after reconnection');
  console.log('─'.repeat(80));

  console.log('\n' + '='.repeat(80));
  if (result.passed) {
    console.log('✓ ALL IN-FLIGHT GAME STATE TESTS PASSED');
    console.log('  (Architecture behavior documented as expected)');
  } else {
    console.log(`✗ ${failed} IN-FLIGHT GAME STATE TEST(S) FAILED`);
  }
  console.log('='.repeat(80) + '\n');
}

async function main() {
  const args = process.argv.slice(2);
  const gatewayUrl = args[0] || DEFAULT_GATEWAY_URL;

  try {
    const result = await runInFlightGameStateTests(gatewayUrl);
    saveResults(result);
    printSummary(result);

    process.exit(result.passed ? 0 : 1);
  } catch (error) {
    console.error('\n✗ In-flight game state test suite failed with fatal error:');
    console.error(error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { runInFlightGameStateTests };
