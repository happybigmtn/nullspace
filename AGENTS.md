# Agent Instructions

- Delete unused or obsolete files when your changes make them irrelevant (refactors, feature removals, etc.), and revert files only when the change is yours or explicitly requested.
- If a git operation leaves you unsure about other agents' in-flight work, stop and coordinate instead of deleting.
- Before attempting to delete a file to resolve a local type/lint failure, stop and ask the user. Other agents are often editing adjacent files; deleting their work to silence an error is never acceptable without explicit approval.
- NEVER edit .env or any environment variable files—only the user may change them.
- Coordinate with other agents before removing their in-progress edits—don't revert or delete work you didn't author unless everyone agrees.
- Moving/renaming and restoring files is allowed.
- ABSOLUTELY NEVER run destructive git operations (e.g., git reset --hard, rm, git checkout/git restore to an older commit) unless the user gives an explicit, written instruction in this conversation. Treat these commands as catastrophic; if you are even slightly unsure, stop and ask before touching them. (When working within Cursor or Codex Web, these git limitations do not apply; use the tooling's capabilities as needed.)
- Never use git restore (or similar commands) to revert files you didn't author—coordinate with other agents instead so their in-progress work stays intact.
- Always double-check git status before any commit.
- Quote any git paths containing brackets or parentheses (e.g., `src/app/[candidate]/**`) when staging or committing so the shell does not treat them as globs or subshells.
- When running git rebase, avoid opening editors—export `GIT_EDITOR=:` and `GIT_SEQUENCE_EDITOR=:` (or pass `--no-edit`) so the default messages are used automatically.
- Never amend commits unless you have explicit written approval in the task thread.

## Protocol Versioning (US-149)

When modifying binary protocol encoding/decoding:

1. **Version Header**: All encoded payloads now include a 1-byte version header as the first byte. The format is `[version] [opcode] [payload...]`.

2. **Cross-Package Updates**: Protocol changes require updates across multiple packages:
   - `packages/protocol/src/encode.ts` - all encoding functions
   - `packages/protocol/src/games/actions.ts` - game-specific action encoders
   - `packages/protocol/test/` - golden vectors and test expectations
   - `gateway/tests/unit/codec.test.ts` - gateway codec tests

3. **Golden Vector Updates**: When changing the wire format, update:
   - `packages/protocol/test/fixtures/golden-vectors.json` - expected hex values
   - Any hardcoded byte expectations in tests (e.g., `new Uint8Array([0x04])` → `new Uint8Array([0x01, 0x04])`)

4. **Round-Trip Tests**: The round-trip tests (`round-trip.test.ts`) communicate with a Rust binary. If Rust doesn't understand the new format yet, use a helper to strip the version header before sending to Rust.

5. **Craps HARDWAY Encoding**: The HARDWAY bet type is special - target values (4, 6, 8, 10) are encoded as separate betTypes via `CRAPS_HARDWAY_MAP`, with target becoming 0.
