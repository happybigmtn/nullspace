/**
 * WebSocket Reconnection Test Runner
 * US-026: Add WebSocket reconnection integration tests
 *
 * Usage: ts-node tests/integration/runReconnectionTests.ts [gateway-url]
 * Example: ts-node tests/integration/runReconnectionTests.ts ws://localhost:9010
 */

import * as fs from 'fs';
import * as path from 'path';
import { WebSocketReconnectionTest, ReconnectionTestResult } from './framework/WebSocketReconnectionTest';

const DEFAULT_GATEWAY_URL = process.env.GATEWAY_URL || 'ws://localhost:9010';
const RESULTS_DIR = path.join(__dirname, 'results');

async function runReconnectionTests(gatewayUrl: string): Promise<ReconnectionTestResult> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║      WebSocket Reconnection Integration Tests                ║');
  console.log('║                     (US-026)                                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nGateway URL: ${gatewayUrl}`);
  console.log(`Start Time: ${new Date().toISOString()}\n`);

  const test = new WebSocketReconnectionTest({
    gatewayUrl,
    timeout: 60000,
  });

  return await test.run();
}

function saveResults(result: ReconnectionTestResult): void {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `reconnection-test-${timestamp}.json`;
  const filepath = path.join(RESULTS_DIR, filename);

  fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
  console.log(`\n📝 Results saved to: ${filepath}`);
}

function printSummary(result: ReconnectionTestResult): void {
  console.log('\n' + '='.repeat(80));
  console.log('RECONNECTION TEST SUMMARY');
  console.log('='.repeat(80));

  const passed = result.tests.filter(t => t.passed).length;
  const failed = result.tests.filter(t => !t.passed).length;

  console.log(`\nTotal Tests: ${result.tests.length}`);
  console.log(`✓ Passed: ${passed}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`Duration: ${(result.duration / 1000).toFixed(2)}s`);

  console.log('\nTest Results:');
  for (const test of result.tests) {
    const status = test.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`  ${status} | ${test.name}`);
    if (test.error) {
      console.log(`         Error: ${test.error}`);
    }
  }

  console.log('\n' + '='.repeat(80));

  if (result.passed) {
    console.log('✓ ALL RECONNECTION TESTS PASSED');
  } else {
    console.log(`✗ ${failed} RECONNECTION TEST(S) FAILED`);
  }

  console.log('='.repeat(80) + '\n');
}

async function main() {
  const args = process.argv.slice(2);
  const gatewayUrl = args[0] || DEFAULT_GATEWAY_URL;

  try {
    const result = await runReconnectionTests(gatewayUrl);
    saveResults(result);
    printSummary(result);

    process.exit(result.passed ? 0 : 1);
  } catch (error) {
    console.error('\n✗ Reconnection test suite failed with fatal error:');
    console.error(error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { runReconnectionTests };
