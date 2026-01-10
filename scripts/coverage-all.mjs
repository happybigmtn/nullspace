#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = new Set(process.argv.slice(2));
const skipJs = args.has('--skip-js');
const skipRust = args.has('--skip-rust');
const failUnder = (() => {
  const raw = [...args].find((a) => a.startsWith('--fail-under='));
  if (!raw) return null;
  const value = Number(raw.split('=')[1]);
  return Number.isFinite(value) ? value : null;
})();

const run = (label, cmd, cmdArgs) => {
  const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${label} failed (${cmd} ${cmdArgs.join(' ')})`);
  }
};

const readIstanbulSummary = (path) => {
  if (!existsSync(path)) return null;
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!data?.total) return null;
  const normalize = (entry) => ({
    total: entry?.total ?? 0,
    covered: entry?.covered ?? 0,
    skipped: entry?.skipped ?? 0,
  });
  return {
    lines: normalize(data.total.lines),
    statements: normalize(data.total.statements),
    functions: normalize(data.total.functions),
    branches: normalize(data.total.branches),
  };
};

const combineTotals = (totals) => totals.reduce(
  (acc, item) => {
    if (!item) return acc;
    acc.lines.total += item.lines.total;
    acc.lines.covered += item.lines.covered;
    acc.statements.total += item.statements.total;
    acc.statements.covered += item.statements.covered;
    acc.functions.total += item.functions.total;
    acc.functions.covered += item.functions.covered;
    acc.branches.total += item.branches.total;
    acc.branches.covered += item.branches.covered;
    return acc;
  },
  {
    lines: { total: 0, covered: 0 },
    statements: { total: 0, covered: 0 },
    functions: { total: 0, covered: 0 },
    branches: { total: 0, covered: 0 },
  },
);

const formatPct = (covered, total) => (total ? (covered / total) * 100 : 0).toFixed(2);

const summaries = [];

if (!skipJs) {
  run('Constants coverage', 'pnpm', ['-C', 'packages/constants', 'test:coverage']);
  run('Design tokens coverage', 'pnpm', ['-C', 'packages/design-tokens', 'test:coverage']);
  run('Game state coverage', 'pnpm', ['-C', 'packages/game-state', 'test:coverage']);
  run('Protocol coverage', 'pnpm', ['-C', 'packages/protocol', 'test:coverage']);
  run('Types coverage', 'pnpm', ['-C', 'packages/types', 'test:coverage']);
  run('Mobile coverage', 'pnpm', ['-C', 'mobile', 'test:coverage']);
  run('Gateway coverage', 'pnpm', ['-C', 'gateway', 'test:coverage']);
  run('Website coverage', 'pnpm', ['-C', 'website', 'test:coverage']);

  summaries.push({
    name: 'constants',
    summary: readIstanbulSummary(join('packages', 'constants', 'coverage', 'coverage-summary.json')),
  });
  summaries.push({
    name: 'design-tokens',
    summary: readIstanbulSummary(join('packages', 'design-tokens', 'coverage', 'coverage-summary.json')),
  });
  summaries.push({
    name: 'game-state',
    summary: readIstanbulSummary(join('packages', 'game-state', 'coverage', 'coverage-summary.json')),
  });
  summaries.push({
    name: 'protocol',
    summary: readIstanbulSummary(join('packages', 'protocol', 'coverage', 'coverage-summary.json')),
  });
  summaries.push({
    name: 'types',
    summary: readIstanbulSummary(join('packages', 'types', 'coverage', 'coverage-summary.json')),
  });
  summaries.push({
    name: 'mobile',
    summary: readIstanbulSummary(join('mobile', 'coverage', 'coverage-summary.json')),
  });
  summaries.push({
    name: 'gateway',
    summary: readIstanbulSummary(join('gateway', 'coverage', 'coverage-summary.json')),
  });
  summaries.push({
    name: 'website',
    summary: readIstanbulSummary(join('website', 'coverage', 'coverage-summary.json')),
  });
}

let rustSummary = null;
if (!skipRust) {
  const rustCheck = spawnSync('cargo', ['llvm-cov', '--version'], { stdio: 'ignore' });
  if (rustCheck.status !== 0) {
    console.warn('cargo-llvm-cov not found. Install with: cargo install cargo-llvm-cov');
  } else {
    mkdirSync('coverage', { recursive: true });
    const outputPath = join('coverage', 'llvm-cov.json');
    run('Rust coverage', 'cargo', ['llvm-cov', '--workspace', '--json', '--output-path', outputPath]);
    if (existsSync(outputPath)) {
      const data = JSON.parse(readFileSync(outputPath, 'utf8'));
      const totals = data?.data?.[0]?.totals ?? null;
      const lines = totals?.lines ?? totals?.line ?? null;
      if (lines) {
        const total = lines.count ?? lines.total ?? 0;
        const covered = lines.covered ?? 0;
        const percent = lines.percent ?? (total ? (covered / total) * 100 : 0);
        rustSummary = { total, covered, percent };
      }
    }
  }
}

const jsTotals = combineTotals(summaries.map((entry) => entry.summary));
const overallLinesTotal = jsTotals.lines.total + (rustSummary?.total ?? 0);
const overallLinesCovered = jsTotals.lines.covered + (rustSummary?.covered ?? 0);

const summaryPayload = {
  generatedAt: new Date().toISOString(),
  javascript: {
    lines: {
      total: jsTotals.lines.total,
      covered: jsTotals.lines.covered,
      pct: Number(formatPct(jsTotals.lines.covered, jsTotals.lines.total)),
    },
    statements: {
      total: jsTotals.statements.total,
      covered: jsTotals.statements.covered,
      pct: Number(formatPct(jsTotals.statements.covered, jsTotals.statements.total)),
    },
    functions: {
      total: jsTotals.functions.total,
      covered: jsTotals.functions.covered,
      pct: Number(formatPct(jsTotals.functions.covered, jsTotals.functions.total)),
    },
    branches: {
      total: jsTotals.branches.total,
      covered: jsTotals.branches.covered,
      pct: Number(formatPct(jsTotals.branches.covered, jsTotals.branches.total)),
    },
  },
  rust: rustSummary
    ? {
        lines: {
          total: rustSummary.total,
          covered: rustSummary.covered,
          pct: Number(rustSummary.percent.toFixed(2)),
        },
      }
    : null,
  overall: {
    lines: {
      total: overallLinesTotal,
      covered: overallLinesCovered,
      pct: Number(formatPct(overallLinesCovered, overallLinesTotal)),
    },
  },
};

mkdirSync('coverage', { recursive: true });
writeFileSync(join('coverage', 'summary.json'), JSON.stringify(summaryPayload, null, 2));

const printLine = (label, covered, total) => {
  const pct = formatPct(covered, total);
  console.log(`${label}: ${covered}/${total} (${pct}%)`);
};

console.log('\nCoverage summary');
printLine('JS lines', jsTotals.lines.covered, jsTotals.lines.total);
printLine('JS statements', jsTotals.statements.covered, jsTotals.statements.total);
printLine('JS functions', jsTotals.functions.covered, jsTotals.functions.total);
printLine('JS branches', jsTotals.branches.covered, jsTotals.branches.total);
if (rustSummary) {
  printLine('Rust lines', rustSummary.covered, rustSummary.total);
}
printLine('Overall lines', overallLinesCovered, overallLinesTotal);

if (failUnder !== null) {
  if (overallLinesTotal === 0) {
    throw new Error('No coverage data produced; cannot enforce threshold');
  }
  const pct = (overallLinesCovered / overallLinesTotal) * 100;
  if (pct < failUnder) {
    throw new Error(`Coverage ${pct.toFixed(2)}% is below threshold ${failUnder}%`);
  }
  console.log(`Threshold check passed (${pct.toFixed(2)}% >= ${failUnder}%)`);
}
