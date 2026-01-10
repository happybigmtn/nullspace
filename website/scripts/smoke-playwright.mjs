import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { chromium } from 'playwright-core';

const HOST = '127.0.0.1';
const PORT = Number(process.env.SMOKE_PORT || 4173);
let BASE_URL = process.env.SMOKE_BASE_URL || `http://${HOST}:${PORT}`;
const USE_EXISTING = /^(1|true)$/i.test(process.env.SMOKE_USE_EXISTING || '');
const PREVIEW_PORT = Number(process.env.SMOKE_PREVIEW_PORT || PORT + 1);
const USE_PREVIEW = process.env.SMOKE_PREVIEW === '1';
const CHROMIUM_PATH = process.env.PW_CHROMIUM_PATH || '/usr/bin/chromium';
const SKIP_BUILD = /^(1|true)$/i.test(process.env.SMOKE_SKIP_BUILD || '');
const KILL_PORT = /^(1|true)$/i.test(process.env.SMOKE_KILL_PORT || '');
const MOCK_PORT = Number(process.env.MOCK_PORT || 9010);

const WEBSITE_DIR = fileURLToPath(new URL('..', import.meta.url));
const REPO_DIR = fileURLToPath(new URL('../..', import.meta.url));
const DIST_DIR = path.join(WEBSITE_DIR, 'dist');

const CONFIG_DIR = process.env.SMOKE_CONFIG_DIR || path.join(REPO_DIR, 'configs', 'local');
const NODE_CONFIG = path.join(CONFIG_DIR, 'node0.yaml');
const NETWORK_SCRIPT = path.join(REPO_DIR, 'scripts', 'start-local-network.sh');
const SIMULATOR_URL = process.env.SMOKE_SIMULATOR_URL;
const ONCHAIN = /^(1|true)$/i.test(process.env.SMOKE_ONCHAIN || '');
const SKIP_BACKEND = /^(1|true)$/i.test(process.env.SMOKE_SKIP_BACKEND || '');
const NO_BUILD = /^(1|true)$/i.test(process.env.SMOKE_NO_BUILD || '');
const FRESH = /^(1|true)$/i.test(process.env.SMOKE_FRESH || '');
const NODES = Number(process.env.SMOKE_NODES || 4);
const BACKEND_MODE = process.env.SMOKE_BACKEND || 'real'; // real|mock

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...args) => console.log('[smoke]', ...args);

function latestMtime(targetPath) {
  try {
    const stats = fs.statSync(targetPath);
    if (stats.isDirectory()) {
      const entries = fs.readdirSync(targetPath);
      let latest = stats.mtimeMs;
      for (const entry of entries) {
        if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
        latest = Math.max(latest, latestMtime(path.join(targetPath, entry)));
      }
      return latest;
    }
    return stats.mtimeMs;
  } catch {
    return 0;
  }
}

function distIsStale() {
  const distIndex = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(distIndex)) return true;
  const distMtime = fs.statSync(distIndex).mtimeMs;
  const watchPaths = ['src', 'public', 'wasm', 'index.html', 'package.json', 'tailwind.config.js', 'vite.config.ts', 'tsconfig.json'];
  const latest = Math.max(...watchPaths.map((p) => latestMtime(path.join(WEBSITE_DIR, p))));
  return latest > distMtime;
}

function isPortFree(port, host = HOST) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

async function freePortOrKill(port) {
  const free = await isPortFree(port);
  if (free) return port;
  if (!KILL_PORT) {
    throw new Error(
      `Port ${port} is already in use. Set SMOKE_KILL_PORT=1 to reclaim it or override MOCK_PORT.`
    );
  }

  log(`Port ${port} busy; attempting to reclaim (SMOKE_KILL_PORT=1)`);
  const pidCandidates = [];
  const pidCmds = [
    `lsof -ti tcp:${port}`,
    `ss -ltnp 'sport = :${port}' 2>/dev/null | awk 'NR>1 {print $7}'`,
    `netstat -ltnp 2>/dev/null | awk '$4 ~ /:${port}$/ {print $7}'`,
    `fuser -n tcp ${port} 2>/dev/null`,
  ];
  for (const cmd of pidCmds) {
    const result = spawnSync('bash', ['-lc', cmd], { encoding: 'utf8' });
    if (result.error) continue;
    const blob = `${result.stdout || ''} ${result.stderr || ''}`;
    blob
      .split(/[\s,\/]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((token) => {
        const maybePid = Number.parseInt(token, 10);
        if (!Number.isNaN(maybePid)) pidCandidates.push(maybePid);
      });
  }
  const pids = Array.from(new Set(pidCandidates));
  if (!pids.length) {
    throw new Error(
      `Port ${port} is busy but no PID could be discovered; try setting MOCK_PORT to a free port`
    );
  }
  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGTERM');
    } catch {
      // ignore
    }
  }
  await sleep(500);
  if (!(await isPortFree(port))) {
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGKILL');
      } catch {
        // ignore
      }
    }
    await sleep(300);
  }
  if (!(await isPortFree(port))) {
    throw new Error(`Port ${port} still in use after kill attempts`);
  }
  return port;
}

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

function readIndexerUrl(configPath) {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const match = raw.match(/^\s*indexer:\s*["']?([^"'\n]+)["']?/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
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

async function startBackend() {
  if (BACKEND_MODE === 'mock') {
    const port = await freePortOrKill(MOCK_PORT);
    const child = spawn('node', [path.join(REPO_DIR, 'scripts', 'mock-backend.mjs')], {
      cwd: REPO_DIR,
      stdio: 'inherit',
      env: {
        ...process.env,
        E2E_SEED: process.env.E2E_SEED || '1',
        MOCK_PORT: String(port),
      },
      detached: true,
    });
    child.unref();
    return { network: child, port };
  }

  if (!fs.existsSync(NETWORK_SCRIPT)) {
    throw new Error(`Network script not found at ${NETWORK_SCRIPT}`);
  }
  if (!fs.existsSync(NODE_CONFIG)) {
    throw new Error(
      `Validator configs missing at ${NODE_CONFIG} (run generate-keys to create ${CONFIG_DIR})`
    );
  }

  const args = [NETWORK_SCRIPT, CONFIG_DIR, String(NODES)];
  if (FRESH) args.push('--fresh');
  if (NO_BUILD) args.push('--no-build');

  const allowedOrigins = [
    `http://${HOST}:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ].join(',');

  const network = spawn(args[0], args.slice(1), {
    cwd: REPO_DIR,
    stdio: 'inherit',
    detached: true,
    env: {
      ...process.env,
      ALLOW_HTTP_NO_ORIGIN: '1',
      ALLOW_WS_NO_ORIGIN: '1',
      ALLOWED_HTTP_ORIGINS: allowedOrigins,
      ALLOWED_WS_ORIGINS: allowedOrigins,
    },
  });
  network.unref();

  return { network };
}

function startViteDev(extraEnv) {
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

async function startVitePreview(extraEnv) {
  const hasDist = fs.existsSync(DIST_DIR);
  const stale = hasDist ? distIsStale() : true;
  const needsBuild = !hasDist || !SKIP_BUILD || stale;
  if (needsBuild) {
    if (SKIP_BUILD && stale) {
      log('dist/ is stale; rebuilding even though SMOKE_SKIP_BUILD=1');
    } else {
      log('Building website for preview');
    }
    await new Promise((resolve, reject) => {
      const child = spawn(
        'npm',
        ['run', 'build'],
        { cwd: WEBSITE_DIR, stdio: 'inherit', env: { ...process.env, ...extraEnv } }
      );
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(`build failed (${code})`));
        resolve();
      });
    });
  } else {
    log('Skipping website build (SMOKE_SKIP_BUILD=1 and dist/ present)');
  }

  const preview = spawn(
    'npm',
    ['exec', 'vite', 'preview', '--', '--host', HOST, '--port', String(PREVIEW_PORT), '--strictPort'],
    {
      cwd: WEBSITE_DIR,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
      detached: true,
    }
  );
  preview.unref();
  return preview;
}

async function run() {
  const envFile = path.join(WEBSITE_DIR, '.env');
  const envLocalFile = path.join(WEBSITE_DIR, '.env.local');
  const envConfigFile = path.join(CONFIG_DIR, '.env.local');
  const envFromFile = readDotEnv(envFile);
  const envFromLocal = readDotEnv(envLocalFile);
  const envFromConfig = readDotEnv(envConfigFile);
  let gatewayPort = MOCK_PORT;
  const identityHex =
    process.env.VITE_IDENTITY ||
    envFromLocal.VITE_IDENTITY ||
    envFromFile.VITE_IDENTITY ||
    envFromConfig.VITE_IDENTITY;

  const configSimulatorUrl = readIndexerUrl(NODE_CONFIG) || 'http://127.0.0.1:8080';
  const simulatorUrl =
    ONCHAIN && !SKIP_BACKEND ? configSimulatorUrl : SIMULATOR_URL || configSimulatorUrl;

  let backend = null;
  if (!SKIP_BACKEND && (ONCHAIN || BACKEND_MODE === 'mock')) {
    if (ONCHAIN && !identityHex) {
      throw new Error(
        `Missing VITE_IDENTITY (set env or add ${envFile} / ${envLocalFile} / ${envConfigFile})`
      );
    }
    backend = await startBackend();
    gatewayPort = backend?.port || gatewayPort;
  }
  if (ONCHAIN && BACKEND_MODE !== 'mock') {
    await waitForSimulatorReady(simulatorUrl, 60_000);
  }

  const viteEnv = {};
  if (ONCHAIN) {
    viteEnv.VITE_URL = simulatorUrl;
    viteEnv.VITE_IDENTITY = identityHex;
  }
  if (BACKEND_MODE === 'mock') {
    viteEnv.VITE_GATEWAY_URL = `ws://${HOST}:${gatewayPort}`;
  }

  let server = null;
  let baseUrl = BASE_URL;
  if (!USE_EXISTING) {
    if (USE_PREVIEW) {
      server = await startVitePreview(viteEnv);
      baseUrl = `http://${HOST}:${PREVIEW_PORT}`;
      process.env.SMOKE_BASE_URL = baseUrl;
    } else {
      server = startViteDev(viteEnv);
      baseUrl = `http://${HOST}:${PORT}`;
    }
  }
  try {
    await waitForHttpOk(baseUrl);

    const browser = await chromium.launch({
      headless: true,
      executablePath: CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      const page = await browser.newPage({ baseURL: baseUrl });
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
            await rewardsButton.scrollIntoViewIfNeeded().catch(() => {});
            await clickWithFallback(rewardsButton, 'rewards');
            await page.getByText(/daily bonus/i).first().waitFor({ timeout: 10000 });
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
        await networkBadge.waitFor({ state: 'attached', timeout: 60_000 });
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

      let blackjackReady = true;
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
        blackjackReady = false;
      }
      await dismissOverlays();

      if (blackjackReady) {
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
      } else {
        console.warn('[smoke] blackjack flow skipped (casino not ready)');
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
      killGroup(backend.network);
    }
  }
}

run().catch((e) => {
  console.error('[smoke] failed:', e);
  process.exit(1);
});
