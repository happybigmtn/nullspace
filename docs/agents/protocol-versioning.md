# Protocol Versioning (US-149)

When modifying binary protocol encoding/decoding:

1. Version header: wire format is `[version][opcode][payload...]` (1-byte version header first).
2. Cross-package updates: update `packages/protocol/src/encode.ts`, `packages/protocol/src/games/actions.ts`, `packages/protocol/test/`, and `gateway/tests/unit/codec.test.ts`.
3. Golden vectors: update `packages/protocol/test/fixtures/golden-vectors.json` and any hardcoded byte expectations.
4. Round-trip tests: if Rust doesn't support the version yet, strip the header before sending to Rust.
5. Craps HARDWAY: encode via `CRAPS_HARDWAY_MAP`; target becomes 0.
