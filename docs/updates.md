# nullspace Platform Updates

## Mock to Real Consensus Migration Research (2025-12-18)

Completed comprehensive research on best practices for migrating from mock/simulator blockchain environments to real consensus nodes. Research covers:
- Local development with multi-node BFT consensus (Tendermint, Cosmos, Hyperledger patterns)
- API compatibility and feature flag strategies for gradual migration
- Block explorer architecture with WebSocket real-time updates and indexer patterns
- Testing strategies including deterministic testing, integration testing, and performance benchmarking

Full report: [blockchain_consensus_migration_research.md](./blockchain_consensus_migration_research.md)

---

## Pattern Recognition Report (2025-12-17)

Comprehensive pattern analysis of the on-chain casino platform completed.

Full report: [pattern_analysis_2025-12-17.md](./pattern_analysis_2025-12-17.md)

---

# Atomic-Only Betting Consolidation Plan

## Overview
Consolidate all table games to use atomic batch betting exclusively. Sic Bo and Craps already use atomic batch. This update migrates Baccarat and Roulette from legacy single-bet flow to atomic batch.

## Current State (Frontend Flow)

| Game | Current Flow | Target Flow |
|------|--------------|-------------|
| Baccarat | Multiple PlaceBet(0) → Deal(1) | **AtomicBatch(3)** |
| Roulette | SetZeroRule(3) → Multiple PlaceBet(0) → Spin(1) | SetZeroRule(3) → **AtomicBatch(4)** |
| Sic Bo | AtomicBatch(3) ✓ | Already atomic |
| Craps | AtomicBatch(4) ✓ | Already atomic |

### Action Codes by Game

| Game | 0 | 1 | 2 | 3 | 4 |
|------|---|---|---|---|---|
| Baccarat | PlaceBet | Deal | Clear | AtomicBatch | - |
| Roulette | PlaceBet | Spin | Clear | SetZeroRule | AtomicBatch |
| Sic Bo | PlaceBet | Roll | Clear | AtomicBatch | - |
| Craps | PlaceBet | AddOdds | Roll | Clear | AtomicBatch |

### Non-Affected Games (use upfront bet in StartGame)
- Blackjack (Hit/Stand/Double/Split)
- Video Poker (Hold/Draw)
- Three Card Poker (Fold/Play + side bet setters)
- Ultimate Holdem (Check/Bet/Fold + side bet setters)
- Casino War (War/Surrender)
- HiLo (Higher/Lower/Same/CashOut)

## Target State

### New Action Codes

| Game | 0 | 1 | 2 | 3 | 4 |
|------|---|---|---|---|---|
| Baccarat | **AtomicBatch** | ~~Deal~~ | ~~Clear~~ | - | - |
| Roulette | **AtomicBatch** | SetZeroRule | - | - | - |
| Sic Bo | **AtomicBatch** | ~~Roll~~ | ~~Clear~~ | - | - |
| Craps | **AtomicBatch** | AddOdds | ~~Roll~~ | ~~Clear~~ | - |

Key insight: Atomic batch already places bets AND executes (deal/spin/roll) in one transaction. We shift it to action 0 as the primary method.

## Backend Changes

### 1. Baccarat (`execution/src/casino/baccarat.rs`)
- **Remove**: Action 0 (PlaceBet single)
- **Remove**: Action 2 (ClearBets)
- **Modify**: Action 3 → Action 0 (AtomicBatch becomes primary)
- **Remove**: Action 1 (standalone Deal) - atomic batch handles this
- Keep: Internal deal/resolve logic (called by atomic batch)

### 2. Roulette (`execution/src/casino/roulette.rs`)
- **Remove**: Action 0 (PlaceBet single)
- **Remove**: Action 2 (ClearBets)
- **Modify**: Action 4 → Action 0 (AtomicBatch becomes primary)
- **Keep**: SetZeroRule (moves to action 1 for en prison support)
- **Remove**: Action 1 (standalone Spin) - atomic batch handles this

### 3. Sic Bo (`execution/src/casino/sic_bo.rs`)
- **Remove**: Action 0 (PlaceBet single)
- **Remove**: Action 2 (ClearBets)
- **Modify**: Action 3 → Action 0 (AtomicBatch becomes primary)
- **Remove**: Action 1 (standalone Roll) - atomic batch handles this

### 4. Craps (`execution/src/casino/craps.rs`)
- **Remove**: Action 0 (PlaceBet single)
- **Remove**: Action 3 (ClearBets)
- **Modify**: Action 4 → Action 0 (AtomicBatch becomes primary for come-out)
- **Keep**: Action 1 (AddOdds) - still needed mid-game
- **Keep**: Action 2 (Roll) - still needed for point phase rolls
- Special case: Craps has multi-phase gameplay

## Frontend Changes

### 1. `website/src/hooks/useTerminalGame.ts`
- **Remove**: `serializeBaccaratBet()` (single bet serializer)
- **Modify**: `serializeBaccaratAtomicBatch()` - change action from 3 to 0
- **Modify**: `serializeRouletteAtomicBatch()` - change action from 4 to 0
- **Modify**: `serializeSicBoAtomicBatch()` - change action from 3 to 0
- **Modify**: `serializeCrapsAtomicBatch()` - change action from 4 to 0
- **Remove**: All "clear bets" payload code
- **Remove**: All standalone deal/spin/roll payload code (absorbed into atomic)

### 2. `website/src/hooks/games/useBaccarat.ts`
- **Remove**: Single bet placement logic
- **Update**: Deal function to only use atomic batch

### 3. `website/src/hooks/games/useCraps.ts`
- **Remove**: Single bet placement logic
- **Keep**: Add odds functionality (action 1)
- **Keep**: Roll functionality for point phase (action 2)

### 4. UI Components
- **Remove**: "Clear Bets" buttons/functionality
- **Remove**: Keyboard shortcuts for clearing bets (if any)

## WASM Changes

### `website/wasm/src/lib.rs`
- Update payload parsing to handle new action codes
- Remove parsing for legacy single-bet actions

## Test Updates

### Backend Tests
- Update all baccarat/roulette/sic_bo/craps tests to use atomic batch
- Remove tests for legacy PlaceBet/ClearBets actions

### Frontend Tests (if any)
- Update test payloads to use new action codes

## Migration Strategy

1. **Phase 1**: Backend changes - shift atomic batch to action 0
2. **Phase 2**: Frontend changes - update serializers
3. **Phase 3**: WASM changes - update payload parsing
4. **Phase 4**: Remove dead code - old actions and tests

## Risk Mitigation

- All changes are backward-compatible at the game logic level
- Atomic batch already tested and working
- No database migration needed (state blob format unchanged)
- Frontend and backend deployed together

## Parallel Execution Plan

Split into 4 parallel agent tasks:
1. **Agent 1**: Backend Baccarat + Sic Bo (similar structure)
2. **Agent 2**: Backend Roulette + Craps (more complex)
3. **Agent 3**: Frontend serializers + hooks
4. **Agent 4**: WASM + test updates

## Success Criteria

- [ ] All table games use action 0 for atomic batch
- [ ] PlaceBet (old action 0) removed from all games
- [ ] ClearBets removed from all games
- [ ] Frontend only sends atomic batch payloads
- [ ] All tests pass
- [ ] `cargo check` and `cargo clippy` pass
- [ ] Build succeeds
