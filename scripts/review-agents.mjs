#!/usr/bin/env node
"use strict";

/**
 * Review Agents Runner
 *
 * Runs configurable grep-based audit agents over the repo and writes JSON reports
 * plus a summary markdown file. This is deterministic, offline, and idempotent.
 *
 * Usage:
 *   node scripts/review-agents.mjs
 *   node scripts/review-agents.mjs --agent core-nondeterminism
 *   node scripts/review-agents.mjs --config configs/review-agents.json --strict
 */

import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

const DEFAULT_CONFIG = "configs/review-agents.json";
const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/target/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/coverage/**",
  "**/pnpm-lock.yaml",
  "**/package-lock.json",
  "**/Cargo.lock",
  "**/*.min.js",
];

function parseArgs(argv) {
  const args = { config: DEFAULT_CONFIG, strict: false, agents: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") {
      args.config = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--agent") {
      const value = argv[i + 1];
      if (value) {
        args.agents.push(value);
      }
      i += 1;
      continue;
    }
    if (arg === "--strict") {
      args.strict = true;
      continue;
    }
  }
  return args;
}

function commandExists(cmd) {
  const result = spawnSync("bash", ["-lc", `command -v ${cmd}`], { encoding: "utf8" });
  return result.status === 0;
}

function classifyPath(path) {
  const lower = path.toLowerCase();
  if (
    lower.includes("/tests/") ||
    lower.includes("/__tests__/") ||
    lower.includes(".test.") ||
    lower.includes(".spec.") ||
    lower.endsWith("_tests.rs") ||
    lower.endsWith("tests.rs") ||
    lower.endsWith("_test.rs") ||
    lower.endsWith("test.rs") ||
    lower.includes("/fixtures/") ||
    lower.includes("/mocks/")
  ) {
    return "test";
  }
  return "prod";
}

function runRg(pattern, paths, globs, excludes) {
  const args = ["--json", "--no-heading"];
  for (const glob of globs) {
    args.push("-g", glob);
  }
  for (const exclude of excludes) {
    args.push("-g", `!${exclude}`);
  }
  args.push(pattern);
  args.push(...paths);

  const result = spawnSync("rg", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });

  if (result.status === 2) {
    const err = result.stderr || "rg failed";
    throw new Error(err);
  }
  if (result.status === 1) {
    return [];
  }

  const matches = [];
  const lines = result.stdout.split("\n").filter(Boolean);
  for (const line of lines) {
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      continue;
    }
    if (payload.type !== "match") {
      continue;
    }

    const data = payload.data;
    const matchPath = data.path.text;
    const normalizedMatchPath = matchPath.startsWith("/") ? matchPath : `/${matchPath}`;
    const absolutePath = normalizedMatchPath.startsWith(ROOT)
      ? normalizedMatchPath
      : join(ROOT, matchPath);
    const relativePath = relative(ROOT, absolutePath);
    const lineText = data.lines.text.replace(/\n$/, "");
    for (const submatch of data.submatches) {
      const matchText = lineText.slice(submatch.start, submatch.end);
      matches.push({
        path: relativePath,
        line: data.line_number,
        column: submatch.start + 1,
        line_text: lineText,
        match_text: matchText,
      });
    }
  }
  return matches;
}

function buildStats(matches) {
  const files = new Map();
  const bySeverity = new Map();
  const byPattern = new Map();

  for (const match of matches) {
    files.set(match.path, (files.get(match.path) || 0) + 1);
    bySeverity.set(match.severity, (bySeverity.get(match.severity) || 0) + 1);
    byPattern.set(match.pattern_id, (byPattern.get(match.pattern_id) || 0) + 1);
  }

  return {
    total: matches.length,
    files: files.size,
    by_severity: Object.fromEntries(bySeverity.entries()),
    by_pattern: Object.fromEntries(byPattern.entries()),
    top_files: Array.from(files.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path, count]) => ({ path, count })),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!commandExists("rg")) {
    console.error("rg is required to run review agents");
    process.exit(1);
  }

  const configPath = join(ROOT, args.config);
  if (!existsSync(configPath)) {
    console.error(`Config not found: ${args.config}`);
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const outputDir = join(ROOT, config.outputDir || "review/agents");
  mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString();
  const selectedAgents = args.agents.length
    ? config.agents.filter((agent) => args.agents.includes(agent.id))
    : config.agents;

  const reports = [];
  let totalMatches = 0;

  for (const agent of selectedAgents) {
    const agentPaths = (agent.paths || [])
      .map((p) => join(ROOT, p))
      .filter((p) => existsSync(p));
    if (agentPaths.length === 0) {
      continue;
    }

    const globs = agent.globs && agent.globs.length ? agent.globs : ["**/*"];
    const excludes = DEFAULT_EXCLUDES.slice();

    const matches = [];
    for (const pattern of agent.patterns || []) {
      const rgMatches = runRg(pattern.regex, agentPaths, globs, excludes);
      for (const match of rgMatches) {
        matches.push({
          ...match,
          agent_id: agent.id,
          pattern_id: pattern.id,
          severity: pattern.severity,
          note: pattern.note,
          kind: classifyPath(match.path),
        });
      }
    }

    const stats = buildStats(matches);
    totalMatches += stats.total;

    const report = {
      agent: {
        id: agent.id,
        title: agent.title,
        description: agent.description,
      },
      generated_at: timestamp,
      stats,
      matches,
    };

    const outputPath = join(outputDir, `${agent.id}.json`);
    writeFileSync(outputPath, JSON.stringify(report, null, 2));
    reports.push({ agent, stats, outputPath: relative(ROOT, outputPath) });
  }

  const summaryLines = [
    "# Review Summary",
    "",
    `Generated: ${timestamp}`,
    "",
  ];

  for (const report of reports) {
    summaryLines.push(`## ${report.agent.id}`);
    summaryLines.push(`${report.agent.title}`);
    summaryLines.push(`Matches: ${report.stats.total}`);
    summaryLines.push(`Files: ${report.stats.files}`);
    if (report.stats.top_files.length > 0) {
      const topFiles = report.stats.top_files
        .map((entry) => `${entry.path} (${entry.count})`)
        .join(", ");
      summaryLines.push(`Top files: ${topFiles}`);
    }
    summaryLines.push(`Output: ${report.outputPath}`);
    summaryLines.push("");
  }

  const summaryPath = join(ROOT, config.summaryPath || "review/summary.md");
  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(summaryPath, summaryLines.join("\n"));

  if (args.strict && totalMatches > 0) {
    process.exit(1);
  }
}

main();
