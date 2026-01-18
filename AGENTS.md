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
