/**
 * Quick Single Test - Run just Roulette for fast debugging
 */

import { RouletteTest } from './games/RouletteTest';

async function main() {
  const gatewayUrl = process.env.GATEWAY_URL || 'wss://api.testnet.regenesis.dev';
  console.log(`Testing against: ${gatewayUrl}`);

  const test = new RouletteTest({ gatewayUrl, timeout: 10000 });

  try {
    const result = await test.run();
    console.log('\n=== RESULT ===');
    console.log(`Passed: ${result.passed}`);
    console.log(`Errors: ${result.errors.length}`);
    result.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    process.exit(result.passed ? 0 : 1);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
