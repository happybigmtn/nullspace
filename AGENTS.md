# Agent Instructions

- Never edit `.env` or any environment-variable files.
- Don’t delete or revert work you didn’t author; coordinate if unsure (especially after git operations).
- Never run destructive git commands (`git reset --hard`, `git restore`, `git checkout` to older commits, `rm`) unless the user explicitly instructs it in this thread.
- Ask before deleting files to resolve type/lint failures.
- Always check `git status` before committing; never amend without explicit approval.

## Protocol Versioning (US-149)

When modifying binary protocol encoding/decoding:

1. **Version Header**: Wire format is `[version][opcode][payload...]` (1-byte version header first).
2. **Cross-Package Updates**: Update `packages/protocol/src/encode.ts`, `packages/protocol/src/games/actions.ts`, `packages/protocol/test/`, and `gateway/tests/unit/codec.test.ts`.
3. **Golden Vectors**: Update `packages/protocol/test/fixtures/golden-vectors.json` and any hardcoded byte expectations.
4. **Round-Trip Tests**: If Rust doesn’t support the version yet, strip the header before sending to Rust.
5. **Craps HARDWAY**: Encode via `CRAPS_HARDWAY_MAP`; target becomes 0.
