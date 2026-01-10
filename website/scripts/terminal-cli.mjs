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
const baseUrl = baseInput.endsWith('/terminal') ? baseInput : `${baseInput.replace(/\/+$/, '')}/terminal`;
const scriptInput = getArg('script', process.env.COMMANDS || '/status;/games;/bet 25;/deal');
const commands = scriptInput
  .split(/;|\n/)
  .map((c) => c.trim())
  .filter(Boolean);
const delayMs = Number(getArg('delay', '350'));
const headless = getArg('headed', process.env.HEADED) ? false : true;

const log = (...msg) => process.stdout.write(msg.join(' ') + '\n');

async function run() {
  log(`[terminal-cli] base=${baseUrl} commands=${commands.length}`);
  const browser = await chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1220, height: 900 } });

  page.on('console', (msg) => {
    const text = msg.text();
    // Keep noise low: only log terminal + chain lines
    if (text.includes('Conn ') || text.includes('Vault') || text.includes('CHAIN') || text.includes('Casino')) {
      log(`[console] ${text}`);
    }
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[placeholder="/help"]', { timeout: 15000 });

  for (const cmd of commands) {
    await page.fill('input[placeholder="/help"]', cmd);
    await page.keyboard.press('Enter');
    log(`[cmd] ${cmd}`);
    await page.waitForTimeout(delayMs);
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
