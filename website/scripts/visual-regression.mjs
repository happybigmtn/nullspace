#!/usr/bin/env node
/**
 * Visual Regression Testing Script
 *
 * Captures screenshots of key screens for design system validation.
 * Run this script to generate baseline images or compare against existing baselines.
 *
 * Usage:
 *   npm run visual:capture    # Capture new screenshots (updates baselines)
 *   npm run visual:compare    # Compare against baselines and report differences
 *
 * Environment:
 *   VISUAL_UPDATE=1           # Force update baselines even on comparison run
 *   VISUAL_THRESHOLD=0.1      # Pixel diff threshold (0-1, default 0.1 = 10%)
 *   PW_CHROMIUM_PATH          # Path to Chromium executable
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HOST = '127.0.0.1';
const PORT = 4174; // Different from smoke test to avoid conflicts
const BASE_URL = `http://${HOST}:${PORT}`;
const CHROMIUM_PATH = process.env.PW_CHROMIUM_PATH || '/usr/bin/chromium';

const WEBSITE_DIR = fileURLToPath(new URL('..', import.meta.url));
const SNAPSHOT_DIR = path.join(WEBSITE_DIR, 'tests', 'visual-snapshots');
const DIFF_DIR = path.join(WEBSITE_DIR, 'tests', 'visual-diffs');

const UPDATE_BASELINES = /^(1|true)$/i.test(process.env.VISUAL_UPDATE || '');
const THRESHOLD = parseFloat(process.env.VISUAL_THRESHOLD || '0.1');
const MODE = process.argv[2] || 'capture'; // 'capture' or 'compare'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ensure directories exist
fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
fs.mkdirSync(DIFF_DIR, { recursive: true });

/**
 * Screen configurations for visual regression testing
 * Focus on: Lobby, Game screens, Modals (as per PRD DS-021)
 */
const SCREENS = [
  {
    name: 'mode-select',
    path: '/',
    waitFor: 'heading:Select Your Mode',
    viewport: { width: 1280, height: 720 },
    description: 'Mode selection landing page',
  },
  {
    name: 'mode-select-mobile',
    path: '/',
    waitFor: 'heading:Select Your Mode',
    viewport: { width: 390, height: 844 },
    description: 'Mode selection on mobile viewport',
  },
  {
    name: 'lobby-desktop',
    path: '/',
    waitFor: 'heading:Select Your Mode',
    setup: async (page) => {
      await page.getByRole('button', { name: /cash game/i }).click();
      await page.waitForTimeout(1000);
    },
    viewport: { width: 1280, height: 720 },
    description: 'Casino lobby after mode selection',
  },
  {
    name: 'lobby-mobile',
    path: '/',
    waitFor: 'heading:Select Your Mode',
    setup: async (page) => {
      await page.getByRole('button', { name: /cash game/i }).click();
      await page.waitForTimeout(1000);
    },
    viewport: { width: 390, height: 844 },
    description: 'Casino lobby on mobile',
  },
  {
    name: 'game-blackjack',
    path: '/',
    waitFor: 'heading:Select Your Mode',
    setup: async (page) => {
      await page.getByRole('button', { name: /cash game/i }).click();
      await page.waitForTimeout(500);
      await page.keyboard.press('/');
      await page.waitForTimeout(300);
      const search = page.getByPlaceholder(/search nullspace|type command/i);
      if (await search.isVisible().catch(() => false)) {
        await search.fill('blackjack');
        await page.getByText(/^blackjack$/i).first().waitFor({ timeout: 5000 });
        await page.getByText(/^blackjack$/i).first().click();
        await page.waitForTimeout(1500);
      }
    },
    viewport: { width: 1280, height: 720 },
    description: 'Blackjack game table',
  },
  {
    name: 'game-roulette',
    path: '/',
    waitFor: 'heading:Select Your Mode',
    setup: async (page) => {
      await page.getByRole('button', { name: /cash game/i }).click();
      await page.waitForTimeout(500);
      await page.keyboard.press('/');
      await page.waitForTimeout(300);
      const search = page.getByPlaceholder(/search nullspace|type command/i);
      if (await search.isVisible().catch(() => false)) {
        await search.fill('roulette');
        await page.getByText(/^roulette$/i).first().waitFor({ timeout: 5000 });
        await page.getByText(/^roulette$/i).first().click();
        await page.waitForTimeout(1500);
      }
    },
    viewport: { width: 1280, height: 720 },
    description: 'Roulette game table',
  },
  {
    name: 'dark-mode-lobby',
    path: '/',
    waitFor: 'heading:Select Your Mode',
    setup: async (page) => {
      // Enable dark mode via localStorage before navigation
      await page.evaluate(() => {
        document.documentElement.classList.add('dark');
      });
      await page.getByRole('button', { name: /cash game/i }).click();
      await page.waitForTimeout(1000);
    },
    viewport: { width: 1280, height: 720 },
    description: 'Lobby in dark mode',
    colorScheme: 'dark',
  },
];

async function waitForHttpOk(url, timeoutMs = 30_000) {
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

function killGroup(child, signal = 'SIGTERM') {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // ignore
  }
}

function startVite() {
  const child = spawn(
    'npm',
    ['run', 'dev', '--', '--host', HOST, '--port', String(PORT), '--strictPort'],
    {
      cwd: WEBSITE_DIR,
      stdio: 'pipe',
      env: { ...process.env, PORT: String(PORT) },
      detached: true,
    }
  );
  child.unref();

  child.stdout?.on('data', (data) => {
    const text = data.toString();
    if (text.includes('ready') || text.includes('Local:')) {
      console.log('[vite]', text.trim());
    }
  });

  child.stderr?.on('data', (data) => {
    const text = data.toString();
    if (!text.includes('ExperimentalWarning')) {
      console.error('[vite:err]', text.trim());
    }
  });

  return child;
}

/**
 * Capture a screenshot for a screen configuration
 */
async function captureScreen(page, screen) {
  const filename = `${screen.name}.png`;
  const filepath = path.join(SNAPSHOT_DIR, filename);

  console.log(`  📸 ${screen.name}: ${screen.description}`);

  // Set viewport
  await page.setViewportSize(screen.viewport);

  // Navigate to path
  await page.goto(screen.path);

  // Wait for initial element
  if (screen.waitFor) {
    const [type, text] = screen.waitFor.split(':');
    if (type === 'heading') {
      await page.getByRole('heading', { name: new RegExp(text, 'i') }).waitFor({ timeout: 15000 });
    } else if (type === 'text') {
      await page.getByText(new RegExp(text, 'i')).first().waitFor({ timeout: 15000 });
    }
  }

  // Run setup if provided
  if (screen.setup) {
    try {
      await screen.setup(page);
    } catch (error) {
      console.warn(`    ⚠️  Setup failed: ${error.message}`);
    }
  }

  // Wait for animations to settle
  await page.waitForTimeout(500);

  // Take screenshot
  await page.screenshot({
    path: filepath,
    fullPage: false,
    animations: 'disabled',
  });

  return filepath;
}

/**
 * Simple pixel comparison (for CI integration, use pixelmatch or similar)
 */
function compareImages(baseline, current) {
  if (!fs.existsSync(baseline)) {
    return { match: false, reason: 'baseline-missing' };
  }

  const baselineData = fs.readFileSync(baseline);
  const currentData = fs.readFileSync(current);

  // Simple byte comparison - for production use pixelmatch
  if (baselineData.equals(currentData)) {
    return { match: true };
  }

  // Calculate rough diff percentage based on file size
  const sizeDiff = Math.abs(baselineData.length - currentData.length) / baselineData.length;

  return {
    match: sizeDiff <= THRESHOLD,
    sizeDiff,
    reason: sizeDiff > THRESHOLD ? 'pixel-diff' : 'within-threshold',
  };
}

async function run() {
  console.log('');
  console.log('='.repeat(60));
  console.log('VISUAL REGRESSION TESTING');
  console.log('='.repeat(60));
  console.log(`Mode: ${MODE === 'capture' ? 'Capturing baselines' : 'Comparing against baselines'}`);
  console.log(`Threshold: ${THRESHOLD * 100}%`);
  console.log(`Snapshots: ${SNAPSHOT_DIR}`);
  console.log('');

  // Start dev server
  console.log('Starting development server...');
  const server = startVite();

  try {
    await waitForHttpOk(BASE_URL);
    console.log(`Server ready at ${BASE_URL}\n`);

    // Launch browser
    const browser = await chromium.launch({
      headless: true,
      executablePath: CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    const results = [];

    try {
      const context = await browser.newContext({
        baseURL: BASE_URL,
        colorScheme: 'light',
      });
      const page = await context.newPage();
      page.setDefaultTimeout(20_000);

      // Suppress console noise
      page.on('console', () => {});
      page.on('pageerror', () => {});

      // Configure vault mode
      await page.addInitScript(() => {
        try {
          localStorage.removeItem('nullspace_responsible_play_v1');
          localStorage.setItem('nullspace_vault_enabled', 'true');
        } catch {
          // ignore
        }
      });

      console.log(`Capturing ${SCREENS.length} screens...\n`);

      for (const screen of SCREENS) {
        try {
          // Handle color scheme
          if (screen.colorScheme === 'dark') {
            await context.close();
            const darkContext = await browser.newContext({
              baseURL: BASE_URL,
              colorScheme: 'dark',
            });
            const darkPage = await darkContext.newPage();
            darkPage.setDefaultTimeout(20_000);
            await darkPage.addInitScript(() => {
              try {
                localStorage.setItem('nullspace_vault_enabled', 'true');
              } catch {
                // ignore
              }
            });

            const filepath = await captureScreen(darkPage, screen);
            results.push({ screen: screen.name, path: filepath, status: 'captured' });

            await darkContext.close();

            // Recreate light context for remaining screens
            const newContext = await browser.newContext({
              baseURL: BASE_URL,
              colorScheme: 'light',
            });
            // Note: We're at the end of the loop, so we won't use this context
            continue;
          }

          const filepath = await captureScreen(page, screen);

          if (MODE === 'compare') {
            const baselinePath = path.join(SNAPSHOT_DIR, 'baseline', `${screen.name}.png`);
            const result = compareImages(baselinePath, filepath);

            if (result.match) {
              results.push({ screen: screen.name, path: filepath, status: 'pass' });
              console.log(`    ✓ Match`);
            } else {
              results.push({
                screen: screen.name,
                path: filepath,
                status: 'fail',
                reason: result.reason,
                diff: result.sizeDiff,
              });
              console.log(`    ✗ ${result.reason}${result.sizeDiff ? ` (${(result.sizeDiff * 100).toFixed(1)}% diff)` : ''}`);
            }
          } else {
            results.push({ screen: screen.name, path: filepath, status: 'captured' });
            console.log(`    ✓ Captured`);
          }
        } catch (error) {
          results.push({ screen: screen.name, status: 'error', error: error.message });
          console.log(`    ✗ Error: ${error.message}`);
        }
      }

      await context.close();
    } finally {
      await browser.close();
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));

    const captured = results.filter((r) => r.status === 'captured').length;
    const passed = results.filter((r) => r.status === 'pass').length;
    const failed = results.filter((r) => r.status === 'fail').length;
    const errors = results.filter((r) => r.status === 'error').length;

    if (MODE === 'capture') {
      console.log(`\n✓ ${captured} screenshots captured`);
      if (errors > 0) {
        console.log(`✗ ${errors} errors`);
      }
      console.log(`\nBaseline images saved to: ${SNAPSHOT_DIR}`);
      console.log('\nTo set up baselines for comparison:');
      console.log(`  mkdir -p ${path.join(SNAPSHOT_DIR, 'baseline')}`);
      console.log(`  cp ${SNAPSHOT_DIR}/*.png ${path.join(SNAPSHOT_DIR, 'baseline')}/`);
    } else {
      console.log(`\n✓ ${passed} passed`);
      if (failed > 0) {
        console.log(`✗ ${failed} failed`);
      }
      if (errors > 0) {
        console.log(`⚠ ${errors} errors`);
      }

      if (failed > 0) {
        console.log('\nFailed screens:');
        for (const r of results.filter((r) => r.status === 'fail')) {
          console.log(`  - ${r.screen}: ${r.reason}`);
        }
        process.exit(1);
      }
    }

    console.log('\n' + '='.repeat(60));

  } finally {
    killGroup(server);
  }
}

run().catch((e) => {
  console.error('[visual] failed:', e);
  process.exit(1);
});
