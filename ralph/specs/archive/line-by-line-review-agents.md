# Line-by-Line Review Agents and Audit Pipeline

**Status**: draft  
**Date**: 2026-01-16  
**Scope**: Deterministic, offline code review agents that scan every line of code for risk patterns and emit structured audit artifacts.

This spec defines a configurable review-agent system that produces line-level audit artifacts across Rust and JS/TS code. The goal is to surface high-risk patterns (nondeterminism, panics, unsafe blocks, unbounded queues, durability settings) with deterministic output that can be consumed by follow-on remediation work.

## 1. Goals

1. **Line-level coverage**: Scan all tracked Rust and JS/TS source files for defined risk patterns.
2. **Deterministic output**: Emit stable JSON reports and summary markdown without external services.
3. **Config-driven agents**: Add/remove agents by editing a config file, not code.
4. **Actionable findings**: Each match includes severity, pattern id, file/line, and remediation notes.
5. **Agent-native workflow**: Idempotent execution with machine-readable artifacts in `review/`.

## 2. Non-Goals

- LLM-based semantic review or natural-language explanations.
- Automated code modifications or fixes.
- Security scanning for dependency CVEs.

## 3. Architecture

### 3.1 Agent Configuration

A JSON config defines agents with:
- `id`, `title`, `description`
- `paths` (repo-relative search roots)
- `globs` (file types)
- `patterns` (regex + severity + note)

### 3.2 Execution

A single script runs each agent:
- Uses `rg --json` for line/column-accurate matches.
- Aggregates stats per agent (total matches, files, top files, counts by severity).
- Writes `review/agents/<agent-id>.json` and a summary markdown.

### 3.3 Output Schema

Each agent report contains:
- `agent` metadata
- `generated_at` timestamp
- `stats` summary
- `matches` array with:
  - `path`, `line`, `column`, `line_text`, `match_text`
  - `pattern_id`, `severity`, `note`, `kind` (prod/test)

## 4. Operational Workflow

- Run: `node scripts/review-agents.mjs`
- Optional: `--agent <id>` to run a single agent
- Optional: `--strict` to exit non-zero if any matches exist

## 5. Failure Modes

- **Missing `rg`**: Script exits with clear error.
- **No matches**: Reports still written with zero counts.
- **Large outputs**: Reports are JSON, not stdout, to avoid log noise.

## 6. Testing Requirements

### 6.1 Unit Tests
- Config parser handles missing/unknown agent ids.
- Output schema includes required fields.

### 6.2 Integration Tests
- Script produces a summary markdown and per-agent JSON.
- `--strict` exits with code 1 when matches exist.

## 7. Acceptance Criteria

### AC-1: Deterministic Audit Output
- **AC-1.1**: Running `node scripts/review-agents.mjs` twice with no code changes produces identical JSON and summary output.
- **AC-1.2**: Each report includes line-level matches with file path, line number, and match text.

### AC-2: Config-Driven Agents
- **AC-2.1**: Adding a new agent in `configs/review-agents.json` yields a new report without code changes.
- **AC-2.2**: `--agent <id>` only emits that agent's report.

### AC-3: Strict Mode
- **AC-3.1**: `--strict` exits non-zero when any agent finds a match.
- **AC-3.2**: `--strict` exits zero when all agents report zero matches.

### AC-4: Repository Coverage
- **AC-4.1**: Rust and JS/TS source files across `node/`, `execution/`, `simulator/`, `gateway/`, `website/`, `mobile/`, and `packages/` are scanned.

## 8. Operational Recommendations

- Run the audit before every stabilization sprint and attach outputs to the spec review.
- Treat `high` severity matches as blockers for consensus-critical code.
- Keep agent patterns conservative; add follow-up agents for deeper checks as needed.
