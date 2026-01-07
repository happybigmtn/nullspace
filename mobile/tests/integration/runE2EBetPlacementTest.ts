/**
 * E2E Bet Placement Test Runner
 *
 * Run: npx tsx tests/integration/runE2EBetPlacementTest.ts
 * Or:  ts-node tests/integration/runE2EBetPlacementTest.ts
 *
 * Environment:
 *   GATEWAY_URL - WebSocket URL for gateway (default: ws://localhost:9010)
 */

import { BetPlacementE2ETest } from './e2e/BetPlacementE2ETest';

async function main(): Promise<void> {
  const gatewayUrl = process.env.GATEWAY_URL || 'ws://localhost:9010';

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       E2E Bet Placement Flow Integration Test (US-061)       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nGateway URL: ${gatewayUrl}`);
  console.log(`Start Time: ${new Date().toISOString()}\n`);

  const test = new BetPlacementE2ETest({
    gatewayUrl,
    timeout: 60000,
  });

  try {
    const passed = await test.run();

    if (passed) {
      console.log('\n✓ E2E Bet Placement Test PASSED');
      process.exit(0);
    } else {
      console.log('\n✗ E2E Bet Placement Test FAILED');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n✗ Fatal Error:', error);
    process.exit(1);
  }
}

main();
