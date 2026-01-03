import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.UX_BASE_URL ?? 'http://127.0.0.1:3001';
const OUT_DIR = process.env.UX_OUT_DIR ?? path.join(process.cwd(), 'qa-artifacts', 'ux-review');
const CHROMIUM_PATH = process.env.PW_CHROMIUM_PATH || '/usr/bin/chromium';

const ensureDir = (dir) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
};

const pickStyle = async (locator) => {
  if (!(await locator.count())) return null;
  return locator.first().evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      text: (el.textContent || '').trim().slice(0, 120),
      color: style.color,
      background: style.backgroundColor,
      opacity: style.opacity,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
    };
  });
};

async function run(theme) {
  ensureDir(OUT_DIR);
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: 1360, height: 820 },
    baseURL: BASE_URL,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  await page.addInitScript((t) => {
    try {
      localStorage.setItem('nullspace.theme', t);
    } catch {
      // ignore
    }
  }, theme);

  await page.goto('/');
  await page.waitForTimeout(600);

  await page.screenshot({ path: path.join(OUT_DIR, `mode-select-${theme}.png`), fullPage: true });

  const modeTitle = await pickStyle(page.getByRole('heading', { name: /select your mode/i }));
  const modeLabel = await pickStyle(page.getByText(/experience nullspace/i));

  await page.getByRole('button', { name: /cash game/i }).click();
  await page.waitForTimeout(800);

  await page.getByRole('button', { name: /games/i }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, `command-palette-${theme}.png`), fullPage: true });

  const searchPlaceholder = await pickStyle(page.getByPlaceholder(/search nullspace/i));
  const firstGame = await pickStyle(page.getByText(/^baccarat$/i));
  const launchHint = await pickStyle(page.getByText(/launch game/i));

  await page.getByText(/^baccarat$/i).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT_DIR, `baccarat-${theme}.png`), fullPage: true });

  console.log(`[ux-review] ${theme} mode:`);
  console.log({ modeTitle, modeLabel, searchPlaceholder, firstGame, launchHint });

  await browser.close();
}

const themes = ['light', 'dark'];
for (const theme of themes) {
  // eslint-disable-next-line no-await-in-loop
  await run(theme);
}
