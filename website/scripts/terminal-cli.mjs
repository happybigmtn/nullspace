#!/usr/bin/env node
/**
 * terminal-cli.mjs
 * Non-interactive runner for the Text Casino (TerminalPage) UI.
 * Executes semicolon-separated commands via Playwright, hitting the real gateway.
 *
 * Examples:
 *   BASE=https://testnet.regenesis.dev node scripts/terminal-cli.mjs --script "/status;/bet 50;/deal;/hit;/stand"
 *   node scripts/terminal-cli.mjs --base https://testnet.regenesis.dev/terminal --script "/bet 25;/roulette RED;/deal"
 */
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const flag = `--${name}`;
  const idx = args.findIndex((a) => a === flag);
  if (idx !== -1 && idx < args.length - 1) return args[idx + 1];
  const match = args.find((a) => a.startsWith(`${flag}=`));
  if (match) return match.split('=').slice(1).join('=');
  return fallback;
};

const baseInput = getArg('base', process.env.BASE || 'https://testnet.regenesis.dev/terminal');
const normalizedBase = baseInput.endsWith('/terminal') ? baseInput : `${baseInput.replace(/\/+$/, '')}/terminal`;
const baseUrl = normalizedBase.includes('?') ? `${normalizedBase}&qa=1` : `${normalizedBase}?qa=1`;
const scriptInput = getArg('script', process.env.COMMANDS || '/status;/games;/bet 25;/deal');
const commands = scriptInput
  .split(/;|\n/)
  .map((c) => c.trim())
  .filter(Boolean);
const delayMs = Number(getArg('delay', '350'));
const headless = getArg('headed', process.env.HEADED) ? false : true;
const inputTimeout = Number(getArg('input-timeout', '15000'));
const commandTimeout = Number(getArg('command-timeout', '30000'));

const log = (...msg) => process.stdout.write(msg.join(' ') + '\n');

async function run() {
  log(`[terminal-cli] base=${baseUrl} commands=${commands.length}`);
  const browser = await chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ baseURL: baseUrl, bypassCSP: true });
  const page = await context.newPage({ viewport: { width: 1220, height: 900 } });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('qa_allow_legacy', 'true');
      localStorage.setItem('qa_bets_enabled', 'true');
      localStorage.setItem('nullspace_vault_enabled', 'false');
    } catch {
      // ignore
    }
  });

  page.on('console', (msg) => {
    const text = msg.text();
    // Keep noise low: only log terminal + chain lines
    if (text.includes('Conn ') || text.includes('Vault') || text.includes('CHAIN') || text.includes('Casino')) {
      log(`[console] ${text}`);
    }
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });

const focusInput = async () => {
  const input =
    (await page.waitForSelector('textarea[placeholder*="/help"]', { timeout: inputTimeout })) ||
    (await page.waitForSelector('textarea', { timeout: inputTimeout }));
  await input.focus();
  return input;
};

  let input = await focusInput();

  for (const cmd of commands) {
    try {
      await input.fill('');
      await input.type(cmd, { delay: 10 });
      await page.keyboard.press('Enter');
      log(`[cmd] ${cmd}`);
      const wait = commandTimeout > delayMs ? delayMs : commandTimeout;
      await page.waitForTimeout(wait);
    } catch (err) {
      // Try to refocus once if the input vanished
      try {
        input = await focusInput();
        await input.fill('');
        await input.type(cmd, { delay: 10 });
        await page.keyboard.press('Enter');
        log(`[cmd retry] ${cmd}`);
        await page.waitForTimeout(delayMs);
      } catch (err2) {
        throw err2;
      }
    }
  }

  // Grab the log panel text for verification
  const logLines = await page.$$eval('div.whitespace-pre-wrap', (nodes) =>
    nodes.map((n) => n.textContent || '').filter(Boolean),
  );
  log('[log-tail]');
  logLines.slice(-20).forEach((l) => log(`  ${l}`));

  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
