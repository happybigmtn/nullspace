# Sprint 02 - Core Table Engine and RNG (Single Game)

## Goal
Deliver the authoritative round scheduler, provably fair RNG pipeline, and settlement for one flagship game end-to-end.

## Demo
- Run a local network and use a CLI or simulator scenario to place bets and observe deterministic settlement for one game.

## Acceptance Criteria
- AC-2.1: Table engine advances through betting, lock, resolve, payout, and cooldown phases with configurable durations.
- AC-2.2: RNG uses commit-reveal hash chain; commit occurs before lock and reveal produces deterministic outcomes.
- AC-2.3: One game (select a flagship game) supports bet validation, settlement, and payout calculations on-chain.
- AC-2.4: Append-only event log plus periodic snapshots allow replay to identical state at any round boundary.
- AC-2.5: Query APIs expose round status, totals, and player bet history for the active game.
- AC-2.6: An integration test places bets, advances a round, and asserts expected balances/outcomes.

## Tasks/Tickets
- T1: Implement round scheduler state machine with deterministic clock and phase transitions.
  - Validation: `cargo test -p execution` covers phase transition timing.
- T2: Implement RNG commit, lock, reveal pipeline with hash chain verification.
  - Validation: unit tests for RNG outputs and hash chain replay.
- T3: Implement bet validation and settlement logic for the chosen flagship game.
  - Validation: golden tests with known inputs/outputs; `cargo test -p execution`.
- T4: Add append-only event log writer and snapshot loader.
  - Validation: replay tests assert identical state after N rounds.
- T5: Expose round/totals/player history query interfaces in the engine API.
  - Validation: integration test uses query API after settlement.
- T6: Add end-to-end simulator scenario for placing bets and asserting payouts.
  - Validation: `cargo test -p nullspace-simulator` or `scripts/health-check.sh`.
