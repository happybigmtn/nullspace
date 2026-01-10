#!/usr/bin/env node
/**
 * terminal-suite.mjs
 * Runs canned, non-interactive command scripts per game through the text terminal UI.
 * Each suite places every bet type for that game (where sensible) and executes the appropriate roll/spin/deal.
 *
 * Usage:
 *   BASE=https://testnet.regenesis.dev node scripts/terminal-suite.mjs
 * Flags:
 *   --base <url>     Base URL (defaults to https://testnet.regenesis.dev/terminal)
 *   --delay <ms>     Delay between commands (defaults 350)
 *   --headed         Show the browser
 *   --filter <name>  Only run suites whose name includes this substring (e.g., --filter roulette)
 */
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const flag = `--${name}`;
  const idx = args.findIndex((a) => a === flag);
  if (idx !== -1 && idx < args.length - 1) return args[idx + 1];
  const match = args.find((a) => a.startsWith(`${flag}=`));
  if (match) return match.split('=').slice(1).join('=');
  return fallback;
};
const hasFlag = (name) => args.includes(`--${name}`);

const baseInput = getArg('base', process.env.BASE || 'https://testnet.regenesis.dev/terminal');
const baseUrl = baseInput.endsWith('/terminal') ? baseInput : `${baseInput.replace(/\/+$/, '')}/terminal`;
const delay = getArg('delay', '350');
const headed = hasFlag('headed');
const filter = getArg('filter', '').toLowerCase();

// Helper encoders (mirrors UI helpers)
const encodeDomino = (a, b) => ((Math.min(a, b) & 0x0f) << 4) | (Math.max(a, b) & 0x0f);
const encodeHopMask = (arr) => arr.reduce((m, n) => m | (1 << (n - 1)), 0);

const suites = [
  {
    name: 'blackjack-all-sides',
    commands: [
      '/unlock create terminal-test-1', // ensure vault exists/unlocks
      '/status',
      '/game blackjack',
      '/bet 25',
      '/deal',
      '/hit',
      '/double',
      '/stand',
      '/side 21p3',
      '/deal',
      '/stand',
      '/side ll',
      '/side pp',
      '/side bi',
      '/side rm',
      '/deal',
      '/stand',
    ],
  },
  {
    name: 'roulette-full-matrix',
    commands: [
      '/game roulette',
      '/bet 5',
      '/roulette RED',
      '/roulette BLACK',
      '/roulette ZERO',
      '/roulette DOZEN1',
      '/roulette DOZEN2',
      '/roulette DOZEN3',
      '/roulette COL1',
      '/roulette COL2',
      '/roulette COL3',
      '/roulette LOW',
      '/roulette HIGH',
      '/roulette ODD',
      '/roulette EVEN',
      '/roulette STRAIGHT 17',
      '/roulette SPLIT 17',
      '/roulette SPLITV 14',
      '/roulette STREET 7',
      '/roulette CORNER 4',
      '/roulette SIX 31',
      '/spin',
    ],
  },
  {
    name: 'craps-all-bets',
    commands: [
      '/game craps',
      '/bet 10',
      '/craps PASS',
      '/craps DONT_PASS',
      '/craps COME',
      '/craps DONT_COME',
      '/craps FIELD',
      '/craps FIRE',
      '/craps ATS_SMALL',
      '/craps ATS_TALL',
      '/craps ATS_ALL',
      '/craps MUGGSY',
      '/craps DIFF_DOUBLES',
      '/craps RIDE_LINE',
      '/craps REPLAY',
      '/craps HOT_ROLLER',
      '/craps HARDWAY 6',
      '/craps YES 6',
      '/craps NO 8',
      '/craps NEXT 5',
      '/roll',
      '/odds',
    ],
  },
  {
    name: 'sicbo-all-bets',
    commands: [
      '/game sicbo',
      '/bet 10',
      '/sicbo SMALL',
      '/sicbo BIG',
      '/sicbo ODD',
      '/sicbo EVEN',
      '/sicbo TRIPLE_ANY',
      '/sicbo TRIPLE_SPECIFIC 2',
      '/sicbo DOUBLE_SPECIFIC 3',
      '/sicbo SUM 10',
      '/sicbo SINGLE 6',
      `/sicbo DOMINO ${encodeDomino(1, 2)}`,
      `/sicbo HOP3_EASY ${encodeHopMask([1, 2, 3])}`,
      `/sicbo HOP3_HARD ${(2 << 4) | 4}`,
      `/sicbo HOP4_EASY ${encodeHopMask([1, 2, 3, 4])}`,
      '/deal',
    ],
  },
  {
    name: 'baccarat-main-and-sides',
    commands: [
      '/game baccarat',
      '/bet 25',
      '/deal',
      '/game baccarat',
      '/bet 25',
      '/deal', // main PLAYER/BANKER decided in backend via selection defaults
    ],
  },
];

const runSuite = (suite) =>
  new Promise((resolve, reject) => {
    const script = suite.commands.join(';');
    const args = ['--base', baseUrl, '--script', script, '--delay', String(delay)];
    if (headed) args.push('--headed');
    const cliPath = new URL('./terminal-cli.mjs', import.meta.url).pathname;
    const p = spawn('node', [cliPath, ...args], { stdio: 'inherit' });
    p.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Suite ${suite.name} failed with code ${code}`));
    });
  });

(async () => {
  const filtered = filter ? suites.filter((s) => s.name.toLowerCase().includes(filter)) : suites;
  if (filtered.length === 0) {
    console.error('[terminal-suite] No suites matched filter.');
    process.exit(1);
  }

  for (const suite of filtered) {
    console.log(`\n=== Running suite: ${suite.name} ===`);
    await runSuite(suite);
  }

  console.log('\nAll suites complete.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
