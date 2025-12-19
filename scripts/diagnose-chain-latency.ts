/**
 * Playwright diagnostic script to identify chain update latency bottlenecks
 *
 * Usage: npx playwright test scripts/diagnose-chain-latency.ts --headed
 */

import { test, expect, Page } from '@playwright/test';

interface TimingMetric {
  label: string;
  timestamp: number;
  delta?: number;
}

const metrics: TimingMetric[] = [];
let startTime = 0;

function recordMetric(label: string) {
  const now = Date.now();
  const delta = startTime ? now - startTime : 0;
  metrics.push({ label, timestamp: now, delta });
  console.log(`[${delta}ms] ${label}`);
}

test.describe('Chain Latency Diagnostics', () => {

  test('Monitor transaction submission and WebSocket event timing', async ({ page }) => {
    // Collect all network requests
    const networkRequests: { url: string; method: string; startTime: number; duration?: number }[] = [];
    const wsMessages: { direction: string; data: string; timestamp: number }[] = [];
    const consoleMessages: { type: string; text: string; timestamp: number }[] = [];

    // Monitor network requests
    page.on('request', request => {
      networkRequests.push({
        url: request.url(),
        method: request.method(),
        startTime: Date.now()
      });
    });

    page.on('response', response => {
      const req = networkRequests.find(r => r.url === response.url() && !r.duration);
      if (req) {
        req.duration = Date.now() - req.startTime;
      }
    });

    // Monitor WebSocket frames
    page.on('websocket', ws => {
      console.log(`\n[WS] WebSocket opened: ${ws.url()}`);

      ws.on('framesent', frame => {
        const data = typeof frame.payload === 'string' ? frame.payload : `[binary ${frame.payload.length} bytes]`;
        wsMessages.push({ direction: 'sent', data, timestamp: Date.now() });
        console.log(`[WS SENT] ${data.substring(0, 100)}`);
      });

      ws.on('framereceived', frame => {
        const data = typeof frame.payload === 'string' ? frame.payload : `[binary ${frame.payload.length} bytes]`;
        wsMessages.push({ direction: 'received', data, timestamp: Date.now() });
        recordMetric(`WebSocket frame received: ${data.substring(0, 50)}`);
      });

      ws.on('close', () => {
        console.log(`[WS] WebSocket closed`);
      });
    });

    // Monitor console for chain-related logs
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('chain') || text.includes('Chain') ||
          text.includes('WebSocket') || text.includes('submit') ||
          text.includes('pending') || text.includes('event') ||
          text.includes('Casino') || text.includes('session')) {
        consoleMessages.push({ type: msg.type(), text, timestamp: Date.now() });
        console.log(`[CONSOLE ${msg.type()}] ${text}`);
      }
    });

    // Navigate to casino
    console.log('\n=== NAVIGATION ===');
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    recordMetric('Page loaded');

    // Wait for WebSocket connection
    await page.waitForTimeout(2000);

    // Check if we're connected
    console.log('\n=== CONNECTION STATUS ===');
    const connectionStatus = await page.evaluate(() => {
      // @ts-ignore
      return window.__DEBUG_CONNECTION_STATUS || 'unknown';
    });
    console.log(`Connection status: ${connectionStatus}`);

    // Navigate to a game (e.g., blackjack)
    console.log('\n=== NAVIGATING TO GAME ===');

    // Look for game entry point
    const blackjackLink = page.locator('text=Blackjack, text=BLACKJACK, [href*="blackjack"]').first();
    if (await blackjackLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await blackjackLink.click();
      recordMetric('Clicked blackjack');
    } else {
      // Try keyboard navigation or direct URL
      await page.goto('http://localhost:5173/casino/blackjack');
      recordMetric('Navigated to blackjack directly');
    }

    await page.waitForTimeout(2000);

    // Take screenshot of current state
    await page.screenshot({ path: '/tmp/chain-diag-1-game-loaded.png', fullPage: true });
    console.log('\nScreenshot saved: /tmp/chain-diag-1-game-loaded.png');

    console.log('\n=== STARTING GAME ACTION ===');
    startTime = Date.now();
    recordMetric('Starting action measurement');

    // Try to start a game or make a move
    // First, try pressing space (common for betting/dealing)
    await page.keyboard.press('Space');
    recordMetric('Pressed Space key');

    // Monitor for state changes
    console.log('\n=== WAITING FOR CHAIN RESPONSE ===');

    // Wait up to 60 seconds, logging every second
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(1000);

      // Check for UI state changes
      const pageContent = await page.textContent('body');

      if (pageContent?.includes('WAITING') || pageContent?.includes('waiting')) {
        recordMetric(`Still waiting... (${i + 1}s)`);
      }

      if (pageContent?.includes('DEALING') || pageContent?.includes('HIT') ||
          pageContent?.includes('STAND') || pageContent?.includes('PLAYING')) {
        recordMetric('Game state changed to playing!');
        break;
      }

      // Check for errors
      if (pageContent?.includes('ERROR') || pageContent?.includes('FAILED') ||
          pageContent?.includes('NO CHAIN RESPONSE')) {
        recordMetric('Error detected in UI');
        break;
      }

      // Every 5 seconds, take a diagnostic screenshot
      if ((i + 1) % 5 === 0) {
        await page.screenshot({ path: `/tmp/chain-diag-wait-${i + 1}s.png`, fullPage: true });
        console.log(`Screenshot saved: /tmp/chain-diag-wait-${i + 1}s.png`);
      }
    }

    // Final screenshot
    await page.screenshot({ path: '/tmp/chain-diag-2-final-state.png', fullPage: true });
    console.log('\nScreenshot saved: /tmp/chain-diag-2-final-state.png');

    // Print summary
    console.log('\n\n========== DIAGNOSTIC SUMMARY ==========\n');

    console.log('--- Timing Metrics ---');
    metrics.forEach(m => {
      console.log(`  [${m.delta}ms] ${m.label}`);
    });

    console.log('\n--- Network Requests (to chain/api) ---');
    networkRequests
      .filter(r => r.url.includes('/api/') || r.url.includes(':8080'))
      .forEach(r => {
        console.log(`  ${r.method} ${r.url} - ${r.duration ?? 'pending'}ms`);
      });

    console.log('\n--- WebSocket Messages ---');
    wsMessages.forEach(m => {
      console.log(`  [${m.direction}] ${m.data.substring(0, 100)}`);
    });

    console.log('\n--- Console Logs (chain-related) ---');
    consoleMessages.slice(-20).forEach(m => {
      console.log(`  [${m.type}] ${m.text.substring(0, 150)}`);
    });

    console.log('\n========================================\n');
  });

  test('WebSocket connection health check', async ({ page }) => {
    console.log('\n=== WebSocket Health Check ===\n');

    let wsConnected = false;
    let wsUrl = '';
    let messageCount = 0;

    page.on('websocket', ws => {
      wsUrl = ws.url();
      wsConnected = true;
      console.log(`WebSocket connected: ${wsUrl}`);

      ws.on('framereceived', () => {
        messageCount++;
      });

      ws.on('close', () => {
        console.log('WebSocket disconnected!');
        wsConnected = false;
      });
    });

    await page.goto('http://localhost:5173');
    await page.waitForTimeout(5000);

    console.log(`\nWebSocket Status:`);
    console.log(`  Connected: ${wsConnected}`);
    console.log(`  URL: ${wsUrl}`);
    console.log(`  Messages received in 5s: ${messageCount}`);

    // Check simulator health
    console.log('\n--- Simulator Health Check ---');
    try {
      const response = await page.request.get('http://localhost:8080/health');
      console.log(`  /health: ${response.status()}`);
    } catch (e) {
      console.log(`  /health: FAILED - ${e}`);
    }

    // Check recent blocks
    try {
      const response = await page.request.get('http://localhost:8080/blocks?limit=5');
      const blocks = await response.json();
      console.log(`  Recent blocks: ${JSON.stringify(blocks).substring(0, 200)}`);
    } catch (e) {
      console.log(`  /blocks: FAILED - ${e}`);
    }
  });

  test('Measure exact action-to-update latency', async ({ page }) => {
    console.log('\n=== Precise Latency Measurement ===\n');

    // Inject timing instrumentation
    await page.addInitScript(() => {
      // @ts-ignore
      window.__CHAIN_TIMING = {
        actionStart: 0,
        submitSent: 0,
        submitResponse: 0,
        wsEventReceived: 0,
        uiUpdated: 0
      };

      // Intercept fetch to track /api/submit
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        const url = args[0]?.toString() || '';
        if (url.includes('/submit') || url.includes('/api/')) {
          // @ts-ignore
          window.__CHAIN_TIMING.submitSent = Date.now();
          console.log(`[TIMING] Submit sent at ${Date.now()}`);
        }
        const response = await originalFetch.apply(window, args);
        if (url.includes('/submit') || url.includes('/api/')) {
          // @ts-ignore
          window.__CHAIN_TIMING.submitResponse = Date.now();
          console.log(`[TIMING] Submit response at ${Date.now()}`);
        }
        return response;
      };
    });

    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Navigate to game
    await page.goto('http://localhost:5173/casino/blackjack');
    await page.waitForTimeout(3000);

    // Record action start and trigger
    await page.evaluate(() => {
      // @ts-ignore
      window.__CHAIN_TIMING.actionStart = Date.now();
    });

    console.log('Triggering action...');
    const actionStart = Date.now();
    await page.keyboard.press('Space');

    // Poll for UI change
    let uiChangeTime = 0;
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(500);

      const content = await page.textContent('body');
      if (content?.includes('DEALING') || content?.includes('HIT') ||
          content?.includes('BUST') || content?.includes('WIN')) {
        uiChangeTime = Date.now();
        console.log(`UI changed at ${uiChangeTime - actionStart}ms`);
        break;
      }
    }

    // Get timing data
    const timing = await page.evaluate(() => {
      // @ts-ignore
      return window.__CHAIN_TIMING;
    });

    console.log('\n--- Latency Breakdown ---');
    console.log(`  Action to Submit Sent: ${timing.submitSent - timing.actionStart}ms`);
    console.log(`  Submit Round-trip: ${timing.submitResponse - timing.submitSent}ms`);
    console.log(`  Submit to UI Update: ${uiChangeTime - timing.submitResponse}ms`);
    console.log(`  TOTAL: ${uiChangeTime - actionStart}ms`);
  });
});
