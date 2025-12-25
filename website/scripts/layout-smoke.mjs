import { chromium } from "playwright-core";
import process from "node:process";

const BASE_URL = process.env.LAYOUT_BASE_URL ?? "http://127.0.0.1:3000";
const CHROMIUM_PATH = process.env.PW_CHROMIUM_PATH || "/usr/bin/chromium";
const HEADLESS = !process.env.HEADED;

const viewports = [
  { name: "mobile", width: 360, height: 740, touch: true },
  { name: "large-mobile", width: 430, height: 932, touch: true },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];

const games = [
  { name: "baccarat", drawers: ["BETS"] },
  { name: "blackjack", drawers: ["BETS"] },
  { name: "craps", drawers: ["BETS", "BONUS"] },
  { name: "roulette", drawers: ["BETS"] },
  { name: "sic_bo", drawers: ["BETS"] },
  { name: "three_card", drawers: ["BETS"] },
  { name: "ultimate_holdem", drawers: ["BETS"] },
  { name: "video_poker", drawers: [] },
  { name: "war", drawers: [] },
  { name: "hilo", drawers: [] },
];

const ensure = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertNoHorizontalOverflow = async (page, label) => {
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const maxWidth = Math.max(doc.scrollWidth, body.scrollWidth);
    return { maxWidth, innerWidth: window.innerWidth };
  });
  if (metrics.maxWidth > metrics.innerWidth + 1) {
    throw new Error(`${label}: horizontal overflow (${metrics.maxWidth}px > ${metrics.innerWidth}px)`);
  }
};

const openGame = async (page, gameName) => {
  await page.getByRole("button", { name: /^games$/i }).click();
  await page.getByPlaceholder(/type command/i).fill(gameName);
  await page.keyboard.press("Enter");
  await page.locator("h1").first().waitFor();
  await page.waitForTimeout(300);
};

const findDrawerButton = async (page, label) => {
  const regex = new RegExp(`^${label}$`, "i");
  const controlBar = page.getByLabel("Game controls");
  if ((await controlBar.count()) > 0) {
    const button = controlBar.getByRole("button", { name: regex });
    if ((await button.count()) > 0) return button.first();
  }
  const fallback = page.getByRole("button", { name: regex });
  if ((await fallback.count()) > 0) return fallback.first();
  return null;
};

const validateDrawer = async (page, label, viewport) => {
  const button = await findDrawerButton(page, label);
  if (!button) {
    console.warn(`[layout] missing ${label} button`);
    return;
  }
  if (!(await button.isVisible())) {
    return;
  }
  await button.click();
  const panel = page.locator(
    `[data-testid="mobile-drawer-panel"][data-drawer-label="${label}"]`,
  );
  await panel.waitFor({ state: "visible", timeout: 5000 });
  const box = await panel.boundingBox();
  ensure(box, "Drawer panel not visible");
  ensure(box.x >= 0, "Drawer panel clipped left");
  ensure(box.y >= 0, "Drawer panel clipped top");
  ensure(box.x + box.width <= viewport.width + 1, "Drawer panel clipped right");
  ensure(box.y + box.height <= viewport.height + 1, "Drawer panel clipped bottom");
  const escButton = page.getByRole("button", { name: /^esc$/i });
  if (await escButton.isVisible().catch(() => false)) {
    await escButton.click();
  } else {
    await page.keyboard.press("Escape");
  }
  await panel.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
};

async function runViewport(viewport) {
  console.log(`[layout] viewport: ${viewport.name}`);
  const browser = await chromium.launch({
    headless: HEADLESS,
    executablePath: CHROMIUM_PATH,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: Boolean(viewport.touch),
      hasTouch: Boolean(viewport.touch),
      baseURL: BASE_URL,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.addInitScript(() => {
      localStorage.setItem("nullspace_touch_mode", "true");
    });

    await page.goto("/");
    await page.getByRole("button", { name: /cash game/i }).click();
    await page.waitForTimeout(500);

    for (const game of games) {
      await openGame(page, game.name);
      await assertNoHorizontalOverflow(page, `${viewport.name}/${game.name}`);
      if (viewport.width < 768 && game.drawers.length > 0) {
        for (const label of game.drawers) {
          await validateDrawer(page, label, viewport);
        }
      }
    }
  } finally {
    await browser.close();
  }
}

async function run() {
  for (const viewport of viewports) {
    await runViewport(viewport);
  }
  console.log("[layout] complete");
}

run().catch((error) => {
  console.error("[layout] failed:", error.message ?? error);
  process.exit(1);
});
