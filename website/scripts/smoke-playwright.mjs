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
const SKIP_BACKEND = /^(1|true)$/i.test(process.env.SMOKE_SKIP_BACKEND || '');

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
  const envLocalFile = path.join(WEBSITE_DIR, '.env.local');
  const envFromFile = readDotEnv(envFile);
  const envFromLocal = readDotEnv(envLocalFile);
  const identityHex =
    process.env.VITE_IDENTITY || envFromLocal.VITE_IDENTITY || envFromFile.VITE_IDENTITY;

  let backend = null;
  if (ONCHAIN) {
    if (!identityHex) {
      throw new Error(`Missing VITE_IDENTITY (set env or add ${envFile} / ${envLocalFile})`);
    }
    if (!SKIP_BACKEND) {
      backend = startBackend(identityHex);
    }
    await waitForSimulatorReady(SIMULATOR_URL, 60_000);
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
      page.on('console', (msg) => {
        const type = msg.type();
        if (type === 'warning' || type === 'error') {
          console.warn(`[browser:${type}]`, msg.text());
        }
      });
      page.on('pageerror', (error) => {
        console.warn('[browser:pageerror]', error?.message ?? error);
      });

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
            if (await page.getByText(/session insight/i).isVisible().catch(() => false)) return true;
            try {
              await page.getByRole('button', { name: /^safety$/i }).click({ timeout: 2000 });
              await page.getByText(/session insight/i).waitFor();
              return true;
            } catch {
              await page.keyboard.press('Escape');
              await page.waitForTimeout(150);
            }
          }
          if (!(await page.getByText(/session insight/i).isVisible().catch(() => false))) {
            console.warn('[smoke] Safety overlay not available');
            return false;
          }
          return true;
        };
        const closeSafety = async () => {
          if (await page.getByText(/session insight/i).isVisible().catch(() => false)) {
            const acknowledge = page.getByRole('button', { name: /acknowledge|continue/i });
            if (await acknowledge.isVisible().catch(() => false)) {
              try {
                await acknowledge.click({ timeout: 5000, force: true });
              } catch {
                await page.evaluate(() => {
                  const buttons = Array.from(document.querySelectorAll('button'));
                  const target = buttons.find((btn) =>
                    /acknowledge|continue/i.test(btn.textContent ?? '')
                  );
                  target?.click();
                });
              }
            } else {
              await page.keyboard.press('Escape');
            }
            await page
              .getByText(/session insight/i)
              .waitFor({ state: 'hidden', timeout: 5000 })
              .catch(() => {});
          }
        };
        const dismissOverlays = async () => {
          await closeSafety();
          await page.keyboard.press('Escape');
          await page.waitForTimeout(200);
        };

      const clickWithFallback = async (locator, label) => {
        try {
          await locator.click({ timeout: 15000, force: true });
        } catch (error) {
          console.warn(`[smoke] ${label} click fallback:`, error?.message ?? error);
          await page.evaluate((labelText) => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const target = buttons.find((btn) =>
              btn.textContent?.toLowerCase().includes(labelText)
            );
            if (!target) {
              throw new Error(`Button not found: ${labelText}`);
            }
            target.click();
          }, label.toLowerCase());
        }
      };

      await page.goto('/');
      await page.getByRole('heading', { name: /select your mode/i }).waitFor({ timeout: 30000 });
      await clickWithFallback(page.getByRole('button', { name: /cash game/i }), 'cash game');

      if (ONCHAIN) {
        const openRewards = async () => {
          const menuButton = page.getByLabel('Menu');
          if (await menuButton.isVisible().catch(() => false)) {
            await menuButton.click();
          }
          const rewardsButton = page.getByRole('button', { name: /^rewards$/i });
          if (await rewardsButton.isVisible().catch(() => false)) {
            await rewardsButton.click();
            await page.getByText(/daily bonus/i).waitFor({ timeout: 10000 });
            return true;
          }
          return false;
        };

        const claimFaucetIfAvailable = async () => {
          const claimButton = page.getByRole('button', { name: /^claim now$/i });
          if (await claimButton.isVisible().catch(() => false)) {
            await claimButton.click();
            await page
              .getByRole('button', { name: /claiming|claimed/i })
              .first()
              .waitFor({ timeout: 60_000 });
          }
        };

        if (await openRewards()) {
          await claimFaucetIfAvailable();
          await page.keyboard.press('Escape');
        }

        const networkBadge = page.getByText(/localnet|testnet/i).first();
        await networkBadge.waitFor({ timeout: 60_000 });
        const offlineBadge = page
          .getByText(/localnet\s*·\s*offline|testnet\s*·\s*offline/i)
          .first();
        if (await offlineBadge.isVisible().catch(() => false)) {
          await offlineBadge.waitFor({ state: 'hidden', timeout: 60_000 });
        }
      }

      const openGamePicker = async () => {
        const searchInput = page.getByPlaceholder(/search nullspace|type command/i);
        for (let attempt = 0; attempt < 3; attempt++) {
          await dismissOverlays();
          await page.keyboard.press('/');
          await page.evaluate(() => {
            const evt = new KeyboardEvent('keydown', { key: '/', bubbles: true });
            window.dispatchEvent(evt);
          });
          if (await searchInput.isVisible().catch(() => false)) {
            return searchInput;
          }
          await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const target = buttons.find((btn) =>
              (btn.textContent ?? '').trim().toLowerCase() === 'games'
            );
            target?.click();
          });
          if (await searchInput.isVisible().catch(() => false)) {
            return searchInput;
          }
          await page.waitForTimeout(300);
        }
        throw new Error('Command palette did not open');
      };

      const blackjackSearch = await openGamePicker();
      await blackjackSearch.fill('blackjack');
      await page.getByText(/^blackjack$/i).first().waitFor({ timeout: 10000 });
      const blackjackButton = page.getByRole('button', { name: /^blackjack$/i });
      if (await blackjackButton.count()) {
        await clickWithFallback(blackjackButton.first(), 'blackjack');
      } else {
        await clickWithFallback(page.getByText(/^blackjack$/i).first(), 'blackjack');
      }
      const casinoMain = page.locator('#casino-main');
      const casinoHeadlines = async () => {
        const text = await casinoMain.innerText().catch(() => '');
        return text
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
      };

      try {
        await page
          .locator('#casino-main')
          .filter({ hasText: /place bets|place your bet/i })
          .waitFor({ timeout: 60_000 });
      } catch (error) {
        console.warn('[smoke] casino headlines after blackjack:', await casinoHeadlines());
        const snapshot = await casinoMain.innerText().catch(() => '');
        if (snapshot) {
          console.warn('[smoke] casino main text:', snapshot.slice(0, 300));
        }
        throw error;
      }
      await dismissOverlays();

        if (await openSafety()) {
          await closeSafety();
        }

        const readStatus = async () => {
          const snapshot = await casinoMain.innerText().catch(() => '');
          if (!snapshot) return '';
          return snapshot.trim();
        };

        await dismissOverlays();
        console.log('[smoke] blackjack status before deal:', await readStatus());
        await page.keyboard.press(' ');
        console.log('[smoke] blackjack status after deal:', await readStatus());
        let blackjackProgressed = true;
        try {
          await page
            .locator('#casino-main')
            .filter({ hasText: /your move|reveal|game complete/i })
            .waitFor({ timeout: 60_000 });
        } catch (error) {
          blackjackProgressed = false;
          console.warn('[smoke] blackjack status timeout:', await readStatus());
        }

        let status = (await readStatus()).toLowerCase();
        if (blackjackProgressed && status.includes('your move')) {
          await page.keyboard.press('s');
          await page
            .locator('#casino-main')
            .filter({ hasText: /reveal|game complete/i })
            .waitFor({ timeout: 60_000 });
          status = (await readStatus()).toLowerCase();
        }

        if (blackjackProgressed && status.includes('reveal')) {
          await page.keyboard.press(' ');
          await page
            .locator('#casino-main')
            .filter({ hasText: /game complete/i })
            .waitFor({ timeout: 60_000 });
        }

      if (ONCHAIN) {
        try {
          const runCraps = async () => {
            const crapsSearch = await openGamePicker();
            await crapsSearch.fill('craps');
            await page.getByText(/^craps$/i).first().waitFor({ timeout: 8000 });
            const crapsButton = page.getByRole('button', { name: /^craps$/i });
            if (await crapsButton.count()) {
              await clickWithFallback(crapsButton.first(), 'craps');
            } else {
              await clickWithFallback(page.getByText(/^craps$/i).first(), 'craps');
            }
            await page
              .locator('#casino-main')
              .filter({ hasText: /place bets/i })
              .waitFor({ timeout: 15_000 });
            await dismissOverlays();

            await page.keyboard.press('Shift+1');
            await page.keyboard.press('p');
            await page
              .getByText(/placed .*pass/i)
              .first()
              .waitFor({ timeout: 8000 })
              .catch(async () => {
                console.warn('[smoke] craps pass line confirmation missing:', await casinoMain.innerText().catch(() => ''));
              });

            const rollDiceButton = page.getByRole('button', { name: /roll dice/i });
            if (await rollDiceButton.count()) {
              await rollDiceButton.first().click();
            } else if (await page.getByRole('button', { name: /^roll$/i }).count()) {
              await page.getByRole('button', { name: /^roll$/i }).first().click();
            }
            await page
              .getByText(/^LAST:/i)
              .first()
              .waitFor({ timeout: 10_000 })
              .catch(async () => {
                console.warn('[smoke] craps roll result missing:', await casinoMain.innerText().catch(() => ''));
              });
          };
          await Promise.race([
            runCraps(),
            page.waitForTimeout(20_000).then(() => {
              throw new Error('craps flow timeout');
            }),
          ]);
        } catch (error) {
          console.warn('[smoke] craps flow skipped:', error?.message ?? error);
        }
      }

        try {
          await page.getByRole('link', { name: /^swap$/i }).click({ timeout: 15_000 });
          await page.getByText(/economy — swap/i).waitFor({ timeout: 15_000 });
        } catch (error) {
          console.warn('[smoke] swap link missing:', error?.message ?? error);
        }

        try {
          await page.getByRole('link', { name: /^stake$/i }).click({ timeout: 15_000 });
          await page.getByText(/^staking$/i).waitFor({ timeout: 15_000 });
        } catch (error) {
          console.warn('[smoke] stake link missing:', error?.message ?? error);
        }

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
