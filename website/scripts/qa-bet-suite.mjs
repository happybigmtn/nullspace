import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const BASE_URL = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3000';
const CHROMIUM_PATH = process.env.PW_CHROMIUM_PATH || '/usr/bin/chromium';
const HEADLESS = process.env.HEADED ? false : !/^(0|false)$/i.test(process.env.QA_HEADLESS ?? '');
const ARTIFACT_DIR = process.env.QA_ARTIFACT_DIR ?? path.join(process.cwd(), 'qa-artifacts');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_PATH = path.join(ARTIFACT_DIR, `qa-bet-suite-${RUN_ID}.log`);
const RESULT_PATH = path.join(ARTIFACT_DIR, `qa-bet-suite-${RUN_ID}.json`);
const TRACE_PATH = path.join(ARTIFACT_DIR, `qa-bet-suite-${RUN_ID}.zip`);
const SCREENSHOT_PATH = path.join(ARTIFACT_DIR, `qa-bet-suite-${RUN_ID}.png`);

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const writeLog = (lines) => {
  fs.writeFileSync(LOG_PATH, lines.join('\n') + '\n', 'utf8');
};

async function run() {
  ensureDir(ARTIFACT_DIR);
  const lines = [];
  const log = (message) => {
    const line = `[${new Date().toISOString()}] ${message}`;
    lines.push(line);
    console.log(line);
  };

  log(`Starting QA bet suite against ${BASE_URL}`);
  const browser = await chromium.launch({
    headless: HEADLESS,
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  let context = null;
  let page = null;
  try {
    context = await browser.newContext({ baseURL: BASE_URL });
    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        log(`[browser:${msg.type()}] ${msg.text()}`);
      }
    });
    page.on('pageerror', (error) => {
      log(`[browser:pageerror] ${error?.message ?? error}`);
    });

    await page.addInitScript(() => {
      try {
        localStorage.removeItem('nullspace_responsible_play_v1');
        localStorage.setItem('nullspace_vault_enabled', 'false');
      } catch {
        // ignore
      }
    });

    await page.goto('/');
    await page.getByRole('button', { name: /cash game/i }).click();

    await page.waitForFunction(() => {
      return Boolean(window.__qa && window.__qa.runAllBets);
    });

    log('QA harness detected. Waiting for on-chain connection...');
    await page.waitForFunction(() => window.__qa?.getStatus?.().isOnChain === true, null, { timeout: 60_000 });

    log('Running bet suite...');
    const results = await page.evaluate(async () => {
      return window.__qa.runAllBets();
    });

    const logs = await page.evaluate(() => window.__qa?.getLogs?.() ?? []);
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    await context.tracing.stop({ path: TRACE_PATH });

    const failureCount = Array.isArray(results)
      ? results.filter((r) => !r.ok).length
      : 0;

    log(`Completed QA bet suite. Total: ${results?.length ?? 0}, Failures: ${failureCount}`);
    fs.writeFileSync(RESULT_PATH, JSON.stringify({ results, logs }, null, 2));
    writeLog(lines);

    if (failureCount > 0) {
      process.exit(1);
    }
  } catch (error) {
    log(`QA bet suite failed: ${error?.message ?? error}`);
    try {
      if (page) {
        await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true }).catch(() => {});
      }
      if (context) {
        await context.tracing.stop({ path: TRACE_PATH }).catch(() => {});
      }
    } catch {
      // ignore
    }
    writeLog(lines);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
