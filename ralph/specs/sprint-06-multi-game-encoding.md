# Sprint 06 - Multi-Game Expansion and Compact Encoding v2

## Goal
Expand the platform to multiple games with compact v2 encoding, while preserving compatibility and performance.

## Demo
- Switch between at least three games in the client and place bets, observing correct rules and outcomes.

## Acceptance Criteria
- AC-6.1: Compact v2 encoding is implemented for at least two additional games beyond the flagship game.
- AC-6.2: Game registry supports multiple active game variants with per-game configs.
- AC-6.3: Gateway routes subscriptions and bet intents to the correct game engine.
- AC-6.4: Indexer stores and serves game-specific schemas with correct game identifiers.
- AC-6.5: Web client renders game-specific bet layouts and rules for each supported game.
- AC-6.6: Regression tests verify the flagship game remains unchanged.

## Tasks/Tickets
- T1: Implement compact v2 encoding for two additional games.
  - Validation: golden encoding tests for new games.
- T2: Add game registry and per-game configuration loading.
  - Validation: unit tests for registry and config parsing.
- T3: Update gateway routing to include game id in subscriptions and bet intents.
  - Validation: `pnpm -C gateway test` covers routing.
- T4: Update indexer schema and APIs to include game identifiers.
  - Validation: API tests for per-game queries.
- T5: Update web client for multi-game UI and routing.
  - Validation: `pnpm -C website test` includes game switch tests.
- T6: Add regression tests for flagship game outcomes and encoding.
  - Validation: `cargo test -p execution` regression suite.
