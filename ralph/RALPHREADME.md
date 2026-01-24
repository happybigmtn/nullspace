# Ralph

One context window. One task. Fresh each iteration.

> "Deliberate allocation in an undeterministic world."

## Philosophy

- Context is everything — stay in the "smart zone" (40-60% utilization)
- One goal per iteration, then reset
- Subagents extend memory without polluting main context
- Tests provide backpressure, not optional extras
- Human ON the loop, not IN it
- Let Ralph Ralph — self-identify, self-correct, self-improve

## Three Phases

### 1. Specs: Define WHAT (not HOW)
- `specs/*.md` — Acceptance criteria, behavioral outcomes
- One spec per topic of concern
- Prompt: `PROMPT_plan.md` or `PROMPT_plan_work.md`

### 2. Plan: Derive tasks from specs
- `IMPLEMENTATION_PLAN.md` — Prioritized bullet-point task list
- Gap analysis: compare specs vs code
- Ultrathink with Opus subagent for complex reasoning

### 3. Build: Implement with backpressure
- Pick ONE unchecked task from plan
- Search first (don't assume not implemented)
- Use parallel subagents for search/read
- Use only 1 subagent for build/tests (backpressure control)
- Prompt: `PROMPT_build.md`

## Key Principles

- **Steering upstream**: Existing code patterns shape what Ralph generates
- **Steering downstream**: Tests, typechecks, lints create backpressure
- **Plan is disposable**: Wrong plan? Regenerate it
- **Subagents as memory**: Each gets ~156kb, garbage collected after

## Files

```
AGENTS.md               # Operational guide (build/run/validate)
IMPLEMENTATION_PLAN.md  # Current prioritized tasks
PROMPT_plan.md          # Full planning prompt
PROMPT_plan_work.md     # Scoped planning prompt
PROMPT_build.md         # Building prompt
specs/*.md              # Acceptance criteria
```

## Loop Commands

```bash
# Claude (default)
./loopclaude.sh              # Build until no tasks remain
./loopclaude.sh 20           # Build, max 20 iterations
./loopclaude.sh plan         # Full planning
./loopclaude.sh plan-work "scope"  # Scoped planning for work branch

# Alternative models
./loopgemini.sh              # Gemini 2.5 Pro
./loopcodex.sh               # GPT-5.2 via Codex
./loopopencode.sh            # Claude Opus 4.5 via GitHub Copilot
```

The loop counts `- [ ]` checkboxes in `IMPLEMENTATION_PLAN.md` and stops when zero remain. Each iteration logs to `logs/`.

## Environment

- `RALPH_AUTOCOMMIT=1` — Auto-commit after each iteration
