# @nullspace/game-state

Shared game-state parsers used by web and mobile.

## Adding a new game parser

1. Add a parser in `packages/game-state/src/index.ts`.
   - Define a `ParsedState` type.
   - Use `SafeReader` and return `null` on invalid/truncated blobs.
2. Export the parser and types from `packages/game-state/src/index.ts`.
3. Add parser tests in `website/src/services/games/__tests__/game-state.test.ts`.
   - Include a minimal valid blob and a malformed blob.
4. Wire web and mobile to use the shared parser.
5. Build the package: `pnpm -C packages/game-state build`.
