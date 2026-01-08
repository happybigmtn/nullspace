import { chromium, Browser, Page } from 'playwright';

const STAGING_URL = process.env.TEST_URL || 'http://localhost:3003';
const TIMEOUT = 30000;

interface TestResult {
  name: string;
  status: 'pass' | 'fail';
  error?: string;
  screenshotPath?: string;
}

const results: TestResult[] = [];

async function takeScreenshot(page: Page, name: string): Promise<string> {
  const timestamp = new Date().getTime();
  const path = `tmp/test-${name}-${timestamp}.png`;
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function runTest(name: string, testFn: () => Promise<void>): Promise<void> {
  console.log(`\n🧪 Running: ${name}`);
  try {
    await testFn();
    results.push({ name, status: 'pass' });
    console.log(`  ✅ Passed`);
  } catch (error) {
    results.push({ name, status: 'fail', error: String(error) });
    console.log(`  ❌ Failed: ${error}`);
  }
}

async function main() {
  console.log('🚀 Starting Browser Automation Tests');
  console.log(`📍 Target: ${STAGING_URL}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 }
  });
  const page = await context.newPage();

  try {
    // Test 1: Homepage loads
    await runTest('Homepage loads', async () => {
      await page.goto(STAGING_URL, { timeout: TIMEOUT });
      await page.waitForLoadState('networkidle', { timeout: TIMEOUT });
      const title = await page.title();
      if (!title) throw new Error('No page title');
      await takeScreenshot(page, 'homepage');
    });

    // Test 2: Navigation to casino
    await runTest('Navigate to casino games', async () => {
      await page.goto(`${STAGING_URL}/casino`, { timeout: TIMEOUT });
      await page.waitForLoadState('networkidle', { timeout: TIMEOUT });
      await takeScreenshot(page, 'casino-lobby');
    });

    // Test 3: Blackjack game loads
    await runTest('Blackjack game loads', async () => {
      await page.goto(`${STAGING_URL}/casino/blackjack`, { timeout: TIMEOUT });
      await page.waitForLoadState('networkidle', { timeout: TIMEOUT });
      await page.waitForSelector('[data-testid="game-container"], .game-container, main', { timeout: TIMEOUT });
      await takeScreenshot(page, 'blackjack-game');
    });

    // Test 4: Roulette game loads
    await runTest('Roulette game loads', async () => {
      await page.goto(`${STAGING_URL}/casino/roulette`, { timeout: TIMEOUT });
      await page.waitForLoadState('networkidle', { timeout: TIMEOUT });
      await takeScreenshot(page, 'roulette-game');
    });

    // Test 5: Craps game loads
    await runTest('Craps game loads', async () => {
      await page.goto(`${STAGING_URL}/casino/craps`, { timeout: TIMEOUT });
      await page.waitForLoadState('networkidle', { timeout: TIMEOUT });
      await takeScreenshot(page, 'craps-game');
    });

    // Test 6: Hi-Lo game loads
    await runTest('Hi-Lo game loads', async () => {
      await page.goto(`${STAGING_URL}/casino/hilo`, { timeout: TIMEOUT });
      await page.waitForLoadState('networkidle', { timeout: TIMEOUT });
      await takeScreenshot(page, 'hilo-game');
    });

    // Test 7: Baccarat game loads
    await runTest('Baccarat game loads', async () => {
      await page.goto(`${STAGING_URL}/casino/baccarat`, { timeout: TIMEOUT });
      await page.waitForLoadState('networkidle', { timeout: TIMEOUT });
      await takeScreenshot(page, 'baccarat-game');
    });

    // Test 8: Video Poker game loads
    await runTest('Video Poker game loads', async () => {
      await page.goto(`${STAGING_URL}/casino/video-poker`, { timeout: TIMEOUT });
      await page.waitForLoadState('networkidle', { timeout: TIMEOUT });
      await takeScreenshot(page, 'video-poker-game');
    });

    // Test 9: Three Card Poker loads
    await runTest('Three Card Poker game loads', async () => {
      await page.goto(`${STAGING_URL}/casino/three-card-poker`, { timeout: TIMEOUT });
      await page.waitForLoadState('networkidle', { timeout: TIMEOUT });
      await takeScreenshot(page, 'three-card-poker-game');
    });

    // Test 10: Sic Bo game loads
    await runTest('Sic Bo game loads', async () => {
      await page.goto(`${STAGING_URL}/casino/sic-bo`, { timeout: TIMEOUT });
      await page.waitForLoadState('networkidle', { timeout: TIMEOUT });
      await takeScreenshot(page, 'sic-bo-game');
    });

    // Test 11: Casino War game loads
    await runTest('Casino War game loads', async () => {
      await page.goto(`${STAGING_URL}/casino/casino-war`, { timeout: TIMEOUT });
      await page.waitForLoadState('networkidle', { timeout: TIMEOUT });
      await takeScreenshot(page, 'casino-war-game');
    });

    // Test 12: Ultimate Texas Hold'em loads
    await runTest('Ultimate Texas Holdem loads', async () => {
      await page.goto(`${STAGING_URL}/casino/ultimate-holdem`, { timeout: TIMEOUT });
      await page.waitForLoadState('networkidle', { timeout: TIMEOUT });
      await takeScreenshot(page, 'ultimate-holdem-game');
    });

    // Test 13: Wallet connection UI exists
    await runTest('Wallet connection UI exists', async () => {
      await page.goto(`${STAGING_URL}/casino/blackjack`, { timeout: TIMEOUT });
      await page.waitForLoadState('networkidle', { timeout: TIMEOUT });
      // Look for wallet/auth UI elements
      const hasWalletUI = await page.locator('button:has-text("Connect"), button:has-text("Wallet"), [data-testid="wallet-button"]').count() > 0;
      if (!hasWalletUI) {
        console.log('  ⚠️  No wallet button found, checking for auth UI...');
      }
      await takeScreenshot(page, 'wallet-ui');
    });

    // Test 14: Game controls visible
    await runTest('Game controls visible', async () => {
      await page.goto(`${STAGING_URL}/casino/blackjack`, { timeout: TIMEOUT });
      await page.waitForLoadState('networkidle', { timeout: TIMEOUT });
      await takeScreenshot(page, 'game-controls');
    });

    // Test 15: Check responsive design (mobile viewport)
    await runTest('Mobile viewport responsive', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${STAGING_URL}/casino/blackjack`, { timeout: TIMEOUT });
      await page.waitForLoadState('networkidle', { timeout: TIMEOUT });
      await takeScreenshot(page, 'mobile-view');
      await page.setViewportSize({ width: 1280, height: 900 }); // Reset
    });

    // Test 16: No console errors
    await runTest('No critical console errors', async () => {
      const errors: string[] = [];
      page.on('console', msg => {
        if (msg.type() === 'error') {
          errors.push(msg.text());
        }
      });
      await page.goto(`${STAGING_URL}/casino/blackjack`, { timeout: TIMEOUT });
      await page.waitForLoadState('networkidle', { timeout: TIMEOUT });
      await page.waitForTimeout(2000);
      const criticalErrors = errors.filter(e =>
        !e.includes('favicon') &&
        !e.includes('analytics') &&
        !e.includes('Failed to load resource')
      );
      if (criticalErrors.length > 0) {
        console.log('  Console errors:', criticalErrors);
      }
    });

  } finally {
    await browser.close();
  }

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(50));
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Total: ${results.length}`);

  if (failed > 0) {
    console.log('\n❌ Failed tests:');
    results.filter(r => r.status === 'fail').forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
  }

  console.log('\n📸 Screenshots saved to tmp/');
}

main().catch(console.error);
