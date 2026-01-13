import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const BASE_URL = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3000';
const DEFAULT_API_BASE = (() => {
  try {
    const parsed = new URL(BASE_URL);
    if (parsed.hostname.endsWith('testnet.regenesis.dev')) {
      return 'https://api.testnet.regenesis.dev';
    }
  } catch {
    // ignore
  }
  return 'http://127.0.0.1:8080';
})();
const API_BASE = process.env.QA_API_BASE ?? DEFAULT_API_BASE;
const CHROMIUM_PATH = process.env.PW_CHROMIUM_PATH || '/usr/bin/chromium';
const HEADLESS = process.env.HEADED ? false : !/^(0|false)$/i.test(process.env.QA_HEADLESS ?? '');
const ARTIFACT_DIR = process.env.QA_ARTIFACT_DIR ?? path.join(process.cwd(), 'qa-artifacts');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_PATH = path.join(ARTIFACT_DIR, `qa-bet-suite-${RUN_ID}.log`);
const RESULT_PATH = path.join(ARTIFACT_DIR, `qa-bet-suite-${RUN_ID}.json`);
const TRACE_PATH = path.join(ARTIFACT_DIR, `qa-bet-suite-${RUN_ID}.zip`);
const SCREENSHOT_PATH = path.join(ARTIFACT_DIR, `qa-bet-suite-${RUN_ID}.png`);

const QA_PRIVATE_KEY = (process.env.QA_PRIV_HEX || '').replace(/^0x/i, '') || '2dbc3152d0b482c2802930aba4e51fb9121a39dcd5432b1a76490be5c27f7ce8';
const QA_PUBLIC_KEY = (process.env.QA_PUB_HEX || '').replace(/^0x/i, '') || 'f4e4eb95ed3c2ec516faf73d61160e8f600389e1d983f18973a561f788177d24';
const ADMIN_PUBLIC_KEY = (process.env.QA_ADMIN_PUB_HEX || '').replace(/^0x/i, '') || '6aba3e7532fc030a7cd3be155b5a73d04efea737ad9a95f4226bc3781bae5b9f';

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

  // Resolve freshest on-chain nonces so we don't reuse stale local state after resets.
  const fetchNonce = async (pub) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const url = `${API_BASE.replace(/\/$/, '')}/account/${pub}`;
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return null;
      const data = await res.json();
      return typeof data?.nonce === 'number' ? data.nonce : null;
    } catch (err) {
      clearTimeout(timeout);
      log(`[nonce] Failed to fetch nonce for ${pub.slice(0,8)}...: ${err?.message ?? err}`);
      return null;
    }
  };

  const resolvedQaNonce =
    process.env.QA_NONCE !== undefined ? Number(process.env.QA_NONCE) : await fetchNonce(QA_PUBLIC_KEY);
  const resolvedAdminNonce =
    process.env.QA_ADMIN_NONCE !== undefined
      ? Number(process.env.QA_ADMIN_NONCE)
      : await fetchNonce(ADMIN_PUBLIC_KEY);

  log(`Starting QA bet suite against ${BASE_URL} (qaNonce=${resolvedQaNonce ?? 'unknown'}, adminNonce=${resolvedAdminNonce ?? 'unknown'})`);
  const browser = await chromium.launch({
    headless: HEADLESS,
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  let context = null;
  let page = null;
  try {
    const baseWithQa = BASE_URL.includes('?') ? `${BASE_URL}&qa=1` : `${BASE_URL}?qa=1`;
    context = await browser.newContext({ baseURL: baseWithQa, bypassCSP: true });
    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await context.newPage();
    // Wipe any persisted client state so nonce/local caches start clean each run
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        // ignore
      }
    });
    // Instrument fetch to capture submission timings and errors
    await page.addInitScript(() => {
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        const [url, options] = args;
        const started = performance.now();
        try {
          const res = await originalFetch(...args);
          const elapsed = Math.round(performance.now() - started);
          console.error('[qa-fetch]', url, options?.method || 'GET', 'status', res.status, 'elapsed', elapsed);
          return res;
        } catch (err) {
          const elapsed = Math.round(performance.now() - started);
          console.error('[qa-fetch-error]', url, options?.method || 'GET', err?.name || 'Error', err?.message, 'elapsed', elapsed);
          throw err;
        }
      };
    });
    await page.addInitScript(() => {
      try {
        localStorage.setItem('qa_bets_enabled', 'true');
        localStorage.setItem('qa_allow_legacy', 'true');
        localStorage.setItem('nullspace_vault_enabled', 'false');
      } catch {
        // ignore
      }
    });
    const qaNonce = resolvedQaNonce ?? 0;
    const adminNonce = resolvedAdminNonce ?? 0;
    await page.addInitScript(
      (priv, pub, nonce, adminPub, adminNonceVal) => {
        try {
          if (priv && priv.length === 64) {
            localStorage.setItem('casino_private_key', priv);
          }
          if (pub && pub.length === 64) {
            localStorage.setItem('casino_public_key_hex', pub);
          }
          if (nonce && `${nonce}`.length > 0) {
            localStorage.setItem('casino_nonce', `${nonce}`);
          }
          if (adminPub && adminPub.length === 64) {
            localStorage.setItem('casino_admin_public_key_hex', adminPub);
          }
          if (adminNonceVal !== null && adminNonceVal !== undefined) {
            localStorage.setItem('casino_admin_nonce', `${adminNonceVal}`);
          }
        } catch {
          // ignore
        }
      },
      QA_PRIVATE_KEY,
      QA_PUBLIC_KEY,
      qaNonce,
      ADMIN_PUBLIC_KEY,
      adminNonce
    );
    page.setDefaultTimeout(30_000);
    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() !== 'log' || /\[qa]/i.test(text)) {
        log(`[browser:${msg.type()}] ${text}`);
      }
    });
    page.on('pageerror', (error) => {
      log(`[browser:pageerror] ${error?.message ?? error}`);
    });
    page.on('requestfailed', (req) => {
      log(`[requestfailed] ${req.method()} ${req.url()} - ${req.failure()?.errorText ?? 'unknown error'}`);
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
    // Force-set keys after navigation to ensure localStorage is populated even if init scripts were skipped.
    await page.evaluate(({ priv, pub, nonce, adminPub, adminNonceVal }) => {
        try {
          localStorage.setItem('qa_bets_enabled', 'true');
          localStorage.setItem('qa_allow_legacy', 'true');
          localStorage.setItem('nullspace_vault_enabled', 'false');
          if (priv && priv.length === 64) localStorage.setItem('casino_private_key', priv);
          if (pub && pub.length === 64) localStorage.setItem('casino_public_key_hex', pub);
          if (nonce !== null && nonce !== undefined) localStorage.setItem('casino_nonce', `${nonce}`);
          if (adminPub && adminPub.length === 64)
            localStorage.setItem('casino_admin_public_key_hex', adminPub);
          if (adminNonceVal !== null && adminNonceVal !== undefined)
            localStorage.setItem('casino_admin_nonce', `${adminNonceVal}`);
        } catch (err) {
          console.error('[qa] failed to seed storage', err?.message ?? err);
        }
      },
      {
        priv: QA_PRIVATE_KEY,
        pub: QA_PUBLIC_KEY,
        // Don't default to 0 - if nonce fetch failed, let the app fetch its own nonce
        nonce: resolvedQaNonce,
        adminPub: ADMIN_PUBLIC_KEY,
        adminNonceVal: resolvedAdminNonce,
      }
    );
    // Debug nonce state early
    try {
      const nonceState = await page.evaluate(() => ({
        casino_nonce: localStorage.getItem('casino_nonce'),
        casino_admin_nonce: localStorage.getItem('casino_admin_nonce'),
        identity: localStorage.getItem('casino_identity'),
      }));
      log(`[debug] initial storage ${JSON.stringify(nonceState)}`);
    } catch (e) {
      log(`[debug] failed to read storage: ${e?.message ?? e}`);
    }
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
      if (page) {
        try {
          const qaLogs = await page.evaluate(() => ({
            logs: window.__qa?.getLogs?.() ?? [],
            status: window.__qa?.getStatus?.(),
            results: window.__qa?.getResults?.(),
          }));
          fs.writeFileSync(RESULT_PATH, JSON.stringify(qaLogs, null, 2));
        } catch (e) {
          log(`Failed to capture QA logs: ${e?.message ?? e}`);
        }
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
