#!/usr/bin/env node
/**
 * Lightweight perf budget check using Playwright navigation timings.
 * Requires chromium installed (e.g. `npx playwright install chromium --with-deps`).
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const PORT = process.env.PREVIEW_PORT || 4173;
const HOST = process.env.PREVIEW_HOST || '127.0.0.1';
const BASE_URL = process.env.BASE_URL || `http://${HOST}:${PORT}`;
const CHROMIUM_PATH = process.env.PW_CHROMIUM_PATH;
const DIST_DIR = path.join(process.cwd(), 'dist');
const DIST_INDEX = path.join(DIST_DIR, 'index.html');
const PERF_FORCE_BUILD = /^(1|true)$/i.test(process.env.PERF_FORCE_BUILD || '');

const BUDGETS = {
  domContentLoaded: Number(process.env.BUDGET_DCL_MS || 4000), // ms
  transferSize: Number(process.env.BUDGET_TRANSFER_BYTES || 3_800_000), // bytes (~3.6MB)
};

async function waitForHttpOk(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.ok || res.status === 304) return;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function latestMtime(targetPath) {
  try {
    const stats = fs.statSync(targetPath);
    if (stats.isDirectory()) {
      return fs
        .readdirSync(targetPath)
        .filter((p) => p !== 'node_modules' && p !== 'dist' && !p.startsWith('.'))
        .reduce((latest, entry) => Math.max(latest, latestMtime(path.join(targetPath, entry))), stats.mtimeMs);
    }
    return stats.mtimeMs;
  } catch {
    return 0;
  }
}

function distIsStale() {
  if (!fs.existsSync(DIST_INDEX)) return true;
  const distMtime = fs.statSync(DIST_INDEX).mtimeMs;
  const watchPaths = ['src', 'public', 'wasm', 'index.html', 'package.json', 'tailwind.config.js', 'vite.config.ts', 'tsconfig.json'];
  const latest = Math.max(...watchPaths.map((p) => latestMtime(path.join(process.cwd(), p))));
  return latest > distMtime;
}

function ensureBuild() {
  const needsBuild = PERF_FORCE_BUILD || !fs.existsSync(DIST_INDEX) || distIsStale();
  if (!needsBuild) {
    console.log('[perf] using existing dist/ (set PERF_FORCE_BUILD=1 to rebuild)');
    return Promise.resolve();
  }
  console.log('[perf] building preview assets');
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'build'], { stdio: 'inherit', env: { ...process.env } });
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`build failed (${code})`));
      resolve();
    });
  });
}

async function startPreview() {
  await ensureBuild();
  const child = spawn(
    'npm',
    ['exec', 'vite', 'preview', '--', '--host', HOST, '--port', String(PORT), '--strictPort'],
    { stdio: 'inherit', env: { ...process.env, HOST, PORT }, detached: true }
  );
  child.unref();
  return child;
}

function kill(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  const server = await startPreview();
  try {
    await waitForHttpOk(BASE_URL);
    const browser = await chromium.launch({
      headless: true,
      executablePath: CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    const response = await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60_000 });
    if (!response?.ok()) {
      throw new Error(`Navigation failed: ${response?.status()} ${response?.statusText()}`);
    }
    const metrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      return {
        domContentLoaded: nav?.domContentLoadedEventEnd ?? 0,
        load: nav?.loadEventEnd ?? 0,
        transferSize: nav?.transferSize ?? 0,
      };
    });
    await browser.close();

    const failures = [];
    if (metrics.domContentLoaded > BUDGETS.domContentLoaded) {
      failures.push(
        `domContentLoaded ${metrics.domContentLoaded.toFixed(
          0
        )}ms exceeds budget ${BUDGETS.domContentLoaded}ms`
      );
    }
    if (metrics.transferSize > BUDGETS.transferSize) {
      failures.push(
        `transferSize ${metrics.transferSize}B exceeds budget ${BUDGETS.transferSize}B`
      );
    }

    console.log('[perf] metrics', metrics);
    if (failures.length) {
      throw new Error(failures.join('; '));
    }
    console.log('[perf] budgets ok');
  } finally {
    kill(server);
  }
}

main().catch((err) => {
  console.error('[perf] failed', err);
  process.exit(1);
});
