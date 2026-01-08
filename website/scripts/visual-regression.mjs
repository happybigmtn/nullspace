#!/usr/bin/env node
/**
 * Visual Regression Testing Script
 *
 * Captures screenshots of key screens for design system validation.
 * Uses pixelmatch for accurate pixel-by-pixel comparison.
 *
 * Usage:
 *   npm run visual:capture    # Capture new screenshots (updates baselines)
 *   npm run visual:compare    # Compare against baselines and report differences
 *   npm run visual:update     # Update baselines from current captures
 *
 * Environment:
 *   VISUAL_UPDATE=1           # Force update baselines even on comparison run
 *   VISUAL_THRESHOLD=0.1      # Pixel diff threshold (0-1, default 0.1 = 10%)
 *   PW_CHROMIUM_PATH          # Path to Chromium executable
 *   CI=true                   # Running in CI mode (outputs JSON summary)
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const HOST = '127.0.0.1';
const PORT = 4174; // Different from smoke test to avoid conflicts
const BASE_URL = `http://${HOST}:${PORT}`;
const CHROMIUM_PATH = process.env.PW_CHROMIUM_PATH || '/usr/bin/chromium';

const WEBSITE_DIR = fileURLToPath(new URL('..', import.meta.url));
const SNAPSHOT_DIR = path.join(WEBSITE_DIR, 'tests', 'visual-snapshots');
const BASELINE_DIR = path.join(SNAPSHOT_DIR, 'baseline');
const CURRENT_DIR = path.join(SNAPSHOT_DIR, 'current');
const DIFF_DIR = path.join(SNAPSHOT_DIR, 'diff');

const UPDATE_BASELINES = /^(1|true)$/i.test(process.env.VISUAL_UPDATE || '');
const THRESHOLD = parseFloat(process.env.VISUAL_THRESHOLD || '0.1');
const IS_CI = /^(1|true)$/i.test(process.env.CI || '');
const MODE = process.argv[2] || 'capture'; // 'capture', 'compare', or 'update'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ensure directories exist
fs.mkdirSync(BASELINE_DIR, { recursive: true });
fs.mkdirSync(CURRENT_DIR, { recursive: true });
fs.mkdirSync(DIFF_DIR, { recursive: true });

/**
 * Screen configurations for visual regression testing
 * Covers: Landing, Lobby, Games, Dark Mode (as per PRD US-164)
 */
const SCREENS = [
  // Light mode screens
  {
    name: 'mode-select',
    path: '/',
    waitFor: 'heading:Select Your Mode',
    viewport: { width: 1280, height: 720 },
    description: 'Mode selection landing page',
    colorScheme: 'light',
  },
  {
    name: 'mode-select-mobile',
    path: '/',
    waitFor: 'heading:Select Your Mode',
    viewport: { width: 390, height: 844 },
    description: 'Mode selection on mobile viewport',
    colorScheme: 'light',
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
    colorScheme: 'light',
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
    colorScheme: 'light',
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
    colorScheme: 'light',
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
    colorScheme: 'light',
  },
  // Dark mode screens
  {
    name: 'mode-select-dark',
    path: '/',
    waitFor: 'heading:Select Your Mode',
    viewport: { width: 1280, height: 720 },
    description: 'Mode selection in dark mode',
    colorScheme: 'dark',
  },
  {
    name: 'lobby-desktop-dark',
    path: '/',
    waitFor: 'heading:Select Your Mode',
    setup: async (page) => {
      await page.getByRole('button', { name: /cash game/i }).click();
      await page.waitForTimeout(1000);
    },
    viewport: { width: 1280, height: 720 },
    description: 'Casino lobby in dark mode',
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
  const filepath = path.join(CURRENT_DIR, filename);

  console.log(`  Capturing ${screen.name}: ${screen.description}`);

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
      console.warn(`    Warning: Setup failed: ${error.message}`);
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
 * Compare two images using pixelmatch
 * Returns { match, diffPercent, diffPixels, diffPath }
 */
function compareImages(baselinePath, currentPath, screenName) {
  if (!fs.existsSync(baselinePath)) {
    return { match: false, reason: 'baseline-missing', diffPercent: 100 };
  }

  const baselineData = fs.readFileSync(baselinePath);
  const currentData = fs.readFileSync(currentPath);

  // Fast path: byte-identical images
  if (baselineData.equals(currentData)) {
    return { match: true, diffPercent: 0, diffPixels: 0 };
  }

  // Parse PNGs
  const baseline = PNG.sync.read(baselineData);
  const current = PNG.sync.read(currentData);

  // Check dimensions match
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return {
      match: false,
      reason: 'dimension-mismatch',
      diffPercent: 100,
      baselineDim: `${baseline.width}x${baseline.height}`,
      currentDim: `${current.width}x${current.height}`,
    };
  }

  const { width, height } = baseline;
  const diff = new PNG({ width, height });

  // Compare pixels (threshold 0.1 = 10% color difference tolerance for anti-aliasing)
  const diffPixels = pixelmatch(baseline.data, current.data, diff.data, width, height, {
    threshold: 0.1,
    includeAA: false, // Ignore anti-aliasing differences
  });

  const totalPixels = width * height;
  const diffPercent = (diffPixels / totalPixels) * 100;

  // Write diff image if there are differences
  if (diffPixels > 0) {
    const diffPath = path.join(DIFF_DIR, `${screenName}.diff.png`);
    fs.writeFileSync(diffPath, PNG.sync.write(diff));
  }

  // Match if diff is within threshold
  const thresholdPercent = THRESHOLD * 100;
  const match = diffPercent <= thresholdPercent;

  return {
    match,
    diffPercent: parseFloat(diffPercent.toFixed(2)),
    diffPixels,
    totalPixels,
    reason: match ? 'within-threshold' : 'pixel-diff',
    diffPath: diffPixels > 0 ? path.join(DIFF_DIR, `${screenName}.diff.png`) : undefined,
  };
}

/**
 * Update baselines from current captures
 */
function updateBaselines() {
  console.log('\n Updating baselines from current captures...\n');

  const currentFiles = fs.readdirSync(CURRENT_DIR).filter((f) => f.endsWith('.png'));
  let updated = 0;

  for (const file of currentFiles) {
    const currentPath = path.join(CURRENT_DIR, file);
    const baselinePath = path.join(BASELINE_DIR, file);

    fs.copyFileSync(currentPath, baselinePath);
    console.log(`  Updated: ${file}`);
    updated++;
  }

  console.log(`\n ${updated} baselines updated`);
  return updated;
}

async function run() {
  console.log('');
  console.log('='.repeat(60));
  console.log('VISUAL REGRESSION TESTING');
  console.log('='.repeat(60));
  console.log(`Mode: ${MODE === 'capture' ? 'Capture' : MODE === 'compare' ? 'Compare' : 'Update'}`);
  console.log(`Threshold: ${THRESHOLD * 100}%`);
  console.log(`Baselines: ${BASELINE_DIR}`);
  console.log('');

  // Update mode - just copy current to baseline
  if (MODE === 'update') {
    if (!fs.existsSync(CURRENT_DIR) || fs.readdirSync(CURRENT_DIR).filter((f) => f.endsWith('.png')).length === 0) {
      console.error('Error: No current captures found. Run npm run visual:capture first.');
      process.exit(1);
    }
    updateBaselines();
    process.exit(0);
  }

  // Start dev server
  console.log('Starting development server...');
  const server = startVite();

  const results = [];

  try {
    await waitForHttpOk(BASE_URL);
    console.log(`Server ready at ${BASE_URL}\n`);

    // Launch browser
    const browser = await chromium.launch({
      headless: true,
      executablePath: CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      // Group screens by color scheme to minimize context switches
      const lightScreens = SCREENS.filter((s) => s.colorScheme === 'light');
      const darkScreens = SCREENS.filter((s) => s.colorScheme === 'dark');

      // Process light mode screens
      console.log(`Processing ${lightScreens.length} light mode screens...\n`);
      const lightContext = await browser.newContext({
        baseURL: BASE_URL,
        colorScheme: 'light',
      });
      const lightPage = await lightContext.newPage();
      lightPage.setDefaultTimeout(20_000);
      lightPage.on('console', () => {});
      lightPage.on('pageerror', () => {});
      await lightPage.addInitScript(() => {
        try {
          localStorage.removeItem('nullspace_responsible_play_v1');
          localStorage.setItem('nullspace_vault_enabled', 'true');
        } catch {
          // ignore
        }
      });

      for (const screen of lightScreens) {
        try {
          const filepath = await captureScreen(lightPage, screen);

          if (MODE === 'compare') {
            const baselinePath = path.join(BASELINE_DIR, `${screen.name}.png`);
            const result = compareImages(baselinePath, filepath, screen.name);

            results.push({
              screen: screen.name,
              colorScheme: screen.colorScheme,
              path: filepath,
              status: result.match ? 'pass' : 'fail',
              ...result,
            });

            if (result.match) {
              console.log(`    PASS (${result.diffPercent}% diff)`);
            } else {
              console.log(`    FAIL: ${result.reason} (${result.diffPercent}% diff)`);
            }
          } else {
            results.push({ screen: screen.name, colorScheme: screen.colorScheme, path: filepath, status: 'captured' });
            console.log(`    Captured`);
          }
        } catch (error) {
          results.push({ screen: screen.name, colorScheme: screen.colorScheme, status: 'error', error: error.message });
          console.log(`    ERROR: ${error.message}`);
        }
      }
      await lightContext.close();

      // Process dark mode screens
      console.log(`\nProcessing ${darkScreens.length} dark mode screens...\n`);
      const darkContext = await browser.newContext({
        baseURL: BASE_URL,
        colorScheme: 'dark',
      });
      const darkPage = await darkContext.newPage();
      darkPage.setDefaultTimeout(20_000);
      darkPage.on('console', () => {});
      darkPage.on('pageerror', () => {});
      await darkPage.addInitScript(() => {
        try {
          localStorage.removeItem('nullspace_responsible_play_v1');
          localStorage.setItem('nullspace_vault_enabled', 'true');
        } catch {
          // ignore
        }
      });

      for (const screen of darkScreens) {
        try {
          const filepath = await captureScreen(darkPage, screen);

          if (MODE === 'compare') {
            const baselinePath = path.join(BASELINE_DIR, `${screen.name}.png`);
            const result = compareImages(baselinePath, filepath, screen.name);

            results.push({
              screen: screen.name,
              colorScheme: screen.colorScheme,
              path: filepath,
              status: result.match ? 'pass' : 'fail',
              ...result,
            });

            if (result.match) {
              console.log(`    PASS (${result.diffPercent}% diff)`);
            } else {
              console.log(`    FAIL: ${result.reason} (${result.diffPercent}% diff)`);
            }
          } else {
            results.push({ screen: screen.name, colorScheme: screen.colorScheme, path: filepath, status: 'captured' });
            console.log(`    Captured`);
          }
        } catch (error) {
          results.push({ screen: screen.name, colorScheme: screen.colorScheme, status: 'error', error: error.message });
          console.log(`    ERROR: ${error.message}`);
        }
      }
      await darkContext.close();
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
      console.log(`\n${captured} screenshots captured`);
      if (errors > 0) {
        console.log(`${errors} errors`);
      }
      console.log(`\nCurrent captures saved to: ${CURRENT_DIR}`);

      // Check if baselines exist
      const baselineCount = fs.existsSync(BASELINE_DIR)
        ? fs.readdirSync(BASELINE_DIR).filter((f) => f.endsWith('.png')).length
        : 0;

      if (baselineCount === 0) {
        console.log('\nNo baselines found. To set up baselines:');
        console.log('  npm run visual:update');
      } else {
        console.log(`\n${baselineCount} baseline images exist.`);
        console.log('To update baselines with current captures:');
        console.log('  npm run visual:update');
      }

      // Auto-update baselines if VISUAL_UPDATE is set or no baselines exist
      if (UPDATE_BASELINES || baselineCount === 0) {
        console.log('\nAuto-updating baselines...');
        updateBaselines();
      }
    } else {
      console.log(`\n${passed} passed, ${failed} failed, ${errors} errors`);

      if (failed > 0) {
        console.log('\nFailed screens:');
        for (const r of results.filter((r) => r.status === 'fail')) {
          console.log(`  - ${r.screen} (${r.colorScheme}): ${r.reason} (${r.diffPercent}% diff)`);
          if (r.diffPath) {
            console.log(`    Diff: ${r.diffPath}`);
          }
        }
      }

      // Output JSON summary for CI
      if (IS_CI) {
        const summary = {
          passed,
          failed,
          errors,
          threshold: THRESHOLD * 100,
          results: results.map((r) => ({
            screen: r.screen,
            colorScheme: r.colorScheme,
            status: r.status,
            diffPercent: r.diffPercent,
            reason: r.reason,
          })),
        };
        console.log('\n::set-output name=visual-summary::' + JSON.stringify(summary));

        // Write summary file for artifact upload
        fs.writeFileSync(path.join(SNAPSHOT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
      }

      if (failed > 0) {
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
