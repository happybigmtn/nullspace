# Compact Encoding: Craps

**Status**: draft  
**Date**: 2026-01-16  
**Scope**: Craps move payloads and state blob compaction using bitwise encoding per `compact-encoding-framework.md`.

## 1. Goals

1. Pack craps bet type + target into <= 2 bytes per bet descriptor.
2. Reduce atomic batch payload size by >= 40%.
3. Compact craps state blob (bets, point, dice, masks) with bit packing.

## 2. Non-Goals

- Changing craps rules or bet validation logic.
- Removing bonus bets (ATS, fire, etc).

## 3. Move Payload Encoding (v2)

### 3.1 Header
- `version` (3 bits)
- `opcode` (5 bits)

### 3.2 Opcode Map (v2)
- `0`: PlaceBet
- `1`: AddOdds
- `2`: Roll
- `3`: ClearBets
- `4`: AtomicBatch

### 3.3 Bet Descriptor
- `bet_type` (5 bits, 0-22)
- `target` (4 bits, 0-12) included only when required (YES/NO/NEXT/HARDWAY)
- `amount` (ULEB128)

### 3.4 AtomicBatch
- `bet_count` (5 bits, max 20)
- `bet_descriptor` repeated

### 3.5 AddOdds
- `amount` (ULEB128)

## 4. State Blob Encoding (v2)

### 4.1 Header Bits
- `version` (3 bits)
- `phase` (2 bits)
- `point` (4 bits, 0-12)
- `dice_1` (3 bits)
- `dice_2` (3 bits)
- `epoch_point_established` (1 bit)
- `made_points_mask` (12 bits)

### 4.2 Bets
- `bet_count` (5 bits)
- `bet_descriptor` repeated

### 4.3 Field Paytable
- encode as small enum (2-3 bits)

## 5. Testing Requirements

- Golden vectors for each bet type family (pass/dont, yes/no/next, hardway, ATS, fire).
- Atomic batch tests with mixed targets.
- State round-trip tests with point established and resolved rolls.

## 6. Acceptance Criteria

### AC-1: Payload Size
- **AC-1.1**: Single craps bet payload <= 4 bytes for small amounts.
- **AC-1.2**: Batch payload size reduction >= 40% vs v1.

### AC-2: State Compaction
- **AC-2.1**: Typical craps state blob shrinks by >= 30%.

### AC-3: Compatibility
- **AC-3.1**: v1 and v2 supported during migration.
- **AC-3.2**: JS/TS and Rust decode v2 identically.

## 7. Implementation Map

- `execution/src/casino/craps.rs`
- `packages/protocol/src/games/craps.ts` (generated wrapper)
- `packages/protocol/test/fixtures/golden-vectors.json`
