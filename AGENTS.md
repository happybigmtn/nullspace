# Agent Instructions

Nullspace is a blockchain-backed casino platform with on-chain game logic, gateway, simulator/indexer, and web clients.

Package manager: pnpm (workspace).

Always:

- Never edit `.env` or any environment-variable files.
- Don't delete or revert work you didn't author; coordinate if unsure (especially after git operations).
- Never run destructive git commands (`git reset --hard`, `git restore`, `git checkout` to older commits, `rm`) unless the user explicitly instructs it in this thread.
- Ask before deleting files to resolve type/lint failures.
- Always check `git status` before committing; never amend without explicit approval.

Testing / typecheck (when needed):

- `cargo test`
- `pnpm test`
- `pnpm -C website test`
- `pnpm -C gateway test`
- `scripts/health-check.sh`
- `scripts/agent-review.sh`

More detailed guides:

- Browser automation: `docs/agents/browser-automation.md`
- Staging infrastructure: `docs/agents/infrastructure-staging.md`
- Debugging context: `docs/agents/debugging.md`
- Operations (CI/CD, testing, recovery): `docs/agents/operations.md`
- Protocol versioning (US-149): `docs/agents/protocol-versioning.md`
- Agent-native development: `docs/agents/agent-native.md`

When asked to BreakdownSprints:
If you were to break this project down into sprints and tasks, how would you do it (timeline info does not need to be included and doesn't matter) - every task/ticket should be an atomic, committable piece of work with tests (and if tests don't make sense, another form of validation that it was completed successfully). Every sprint should result in a demoable piece of software that can be run, tested, and build on top of previous work/sprints. Be exhaustive, be clear, be technical, always focus on small atomic tasks that compose up into a clear goal for the sprint. Once you're done, provide this prompt to a subagent to review your work and suggest improvements. When you're done reviewing the suggested improvements, write your tasks/tickets, sprint plans, etc., to the ralph/specs directory as markdown files, then implement those specs into Implementation Plan, following the guidance in ralphreadme.md
