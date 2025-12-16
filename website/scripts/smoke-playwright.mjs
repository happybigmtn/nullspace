import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HOST = '127.0.0.1';
const PORT = 4173;
const BASE_URL = `http://${HOST}:${PORT}`;
const CHROMIUM_PATH = process.env.PW_CHROMIUM_PATH || '/usr/bin/chromium';

const WEBSITE_DIR = fileURLToPath(new URL('..', import.meta.url));
const REPO_DIR = fileURLToPath(new URL('../..', import.meta.url));

const SIMULATOR_PORT = Number(process.env.SMOKE_SIMULATOR_PORT || 8089);
const SIMULATOR_URL = process.env.SMOKE_SIMULATOR_URL || `http://127.0.0.1:${SIMULATOR_PORT}`;
const SIMULATOR_BIN =
  process.env.SMOKE_SIMULATOR_BIN || path.join(REPO_DIR, 'target', 'release', 'nullspace-simulator');
const EXECUTOR_BIN =
  process.env.SMOKE_EXECUTOR_BIN || path.join(REPO_DIR, 'target', 'release', 'dev-executor');
const ONCHAIN = /^(1|true)$/i.test(process.env.SMOKE_ONCHAIN || '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHttpOk(url, timeoutMs = 60_000) {
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

function readDotEnv(envPath) {
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    const out = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (key) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

async function waitForSimulatorReady(url, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/seed/00`, { redirect: 'manual' });
      if (res.ok || res.status === 404) return;
    } catch {
      // ignore
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for simulator at ${url}`);
}

function killGroup(child, signal = 'SIGTERM') {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // ignore
  }
}

function startBackend(identityHex) {
  if (!fs.existsSync(SIMULATOR_BIN)) {
    throw new Error(`Simulator binary not found at ${SIMULATOR_BIN} (build with cargo)`);
  }
  if (!fs.existsSync(EXECUTOR_BIN)) {
    throw new Error(`dev-executor binary not found at ${EXECUTOR_BIN} (build with cargo)`);
  }

  const simulator = spawn(
    SIMULATOR_BIN,
    ['--host', '127.0.0.1', '--port', String(SIMULATOR_PORT), '--identity', identityHex],
    { cwd: REPO_DIR, stdio: 'inherit', detached: true }
  );
  simulator.unref();

  const executor = spawn(
    EXECUTOR_BIN,
    ['--url', SIMULATOR_URL, '--identity', identityHex, '--block-interval-ms', '100'],
    { cwd: REPO_DIR, stdio: 'inherit', detached: true }
  );
  executor.unref();

  return { simulator, executor };
}

function startVite(extraEnv) {
  const child = spawn(
    'npm',
    ['run', 'dev', '--', '--host', HOST, '--port', String(PORT), '--strictPort'],
    {
      cwd: WEBSITE_DIR,
      stdio: 'inherit',
      env: { ...process.env, PORT: String(PORT), ...extraEnv },
      detached: true,
    }
  );
  child.unref();
  return child;
}

async function run() {
  const envFile = path.join(WEBSITE_DIR, '.env');
  const envFromFile = readDotEnv(envFile);
  const identityHex = process.env.VITE_IDENTITY || envFromFile.VITE_IDENTITY;

  let backend = null;
  if (ONCHAIN) {
    if (!identityHex) {
      throw new Error(`Missing VITE_IDENTITY (set env or add ${envFile})`);
    }
    backend = startBackend(identityHex);
    await waitForSimulatorReady(SIMULATOR_URL);
  }

  const server = startVite(ONCHAIN ? { VITE_URL: SIMULATOR_URL, VITE_IDENTITY: identityHex } : {});
  try {
    await waitForHttpOk(BASE_URL);

    const browser = await chromium.launch({
      headless: true,
      executablePath: CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      const page = await browser.newPage({ baseURL: BASE_URL });
      page.setDefaultTimeout(25_000);

      await page.addInitScript(
        ({ vaultEnabled }) => {
          try {
            localStorage.removeItem('nullspace_responsible_play_v1');
            localStorage.setItem('nullspace_vault_enabled', vaultEnabled);
          } catch {
            // ignore
          }
        },
        { vaultEnabled: ONCHAIN ? 'false' : 'true' }
      );

        const openSafety = async () => {
          for (let attempt = 0; attempt < 3; attempt++) {
            if (await page.getByText(/session summary/i).isVisible().catch(() => false)) return;
            try {
              await page.getByRole('button', { name: /^safety$/i }).click({ timeout: 2000 });
              await page.getByText(/session summary/i).waitFor();
              return;
            } catch {
              await page.keyboard.press('Escape');
              await page.waitForTimeout(150);
            }
          }
          if (!(await page.getByText(/session summary/i).isVisible().catch(() => false))) {
            throw new Error('Unable to open Safety overlay');
          }
        };

      await page.goto('/');
      await page.getByRole('button', { name: /cash game/i }).click();

      if (ONCHAIN) {
        // Claim faucet (register + deposit). This updates async state but does not render a toast when no game is active.
        const startFaucet = async () => {
          for (let attempt = 0; attempt < 5; attempt++) {
            await page.getByRole('button', { name: /daily faucet/i }).click();
            try {
              await page.getByRole('button', { name: /claiming/i }).waitFor({ timeout: 3000 });
              return;
            } catch {
              await page.waitForTimeout(500);
            }
          }
          throw new Error('Faucet did not start (client not ready?)');
        };

        await startFaucet();
        await page.getByRole('button', { name: /daily faucet/i }).waitFor({ timeout: 60_000 });
      }

      await page.getByRole('button', { name: /^games$/i }).click();
      await page.getByPlaceholder(/type command or game name/i).fill('blackjack');
      await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: /^blackjack$/i }).waitFor();
      await page.getByText(/place bets/i).waitFor({ timeout: 60_000 });

        await openSafety();
        await page.getByRole('button', { name: /^5m$/i }).click();

        await page.getByRole('button', { name: /deal/i }).click();
        await page.getByText(/cooldown active/i).waitFor();

        await openSafety();
        await page.getByRole('button', { name: /^clear$/i }).click();
        await page.getByRole('button', { name: /deal/i }).click();
        await page.getByText(/dealer \(\d+\)/i).waitFor({ timeout: 60_000 });

        await page.getByRole('link', { name: /^swap$/i }).click();
        await page.getByText(/economy — swap/i).waitFor();

        await page.getByRole('link', { name: /^stake$/i }).click();
        await page.getByText(/^staking$/i).waitFor();

      console.log('[smoke] ok');
    } finally {
      await browser.close();
    }
  } finally {
    killGroup(server);
    if (backend) {
      killGroup(backend.executor);
      killGroup(backend.simulator);
    }
  }
}

run().catch((e) => {
  console.error('[smoke] failed:', e);
  process.exit(1);
});
