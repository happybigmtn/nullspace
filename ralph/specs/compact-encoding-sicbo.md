# Compact Encoding: Sic Bo

**Status**: draft  
**Date**: 2026-01-16  
**Scope**: Sic Bo move payloads and state blob compaction using bitwise encoding per `compact-encoding-framework.md`.

## 1. Goals

1. Pack sic bo bet type + target into <= 2 bytes per bet descriptor.
2. Reduce atomic batch payload size by >= 40%.
3. Compact state blob (bets and dice history) with bit packing.

## 2. Non-Goals

- Changing sic bo rules or payout logic.

## 3. Move Payload Encoding (v2)

### 3.1 Header
- `version` (3 bits)
- `opcode` (5 bits)

### 3.2 Opcode Map (v2)
- `0`: PlaceBet
- `1`: Roll
- `2`: ClearBets
- `3`: AtomicBatch
- `4`: SetRules

### 3.3 Bet Descriptor
- `bet_type` (4 bits, 0-12)
- `target` (6 bits, 0-63) for bet types that require it
- `amount` (ULEB128)

### 3.4 AtomicBatch
- `bet_count` (5 bits, max 20)
- `bet_descriptor` repeated

## 4. State Blob Encoding (v2)

### 4.1 Header Bits
- `version` (3 bits)
- `phase` (2 bits)
- `dice_1` (3 bits)
- `dice_2` (3 bits)
- `dice_3` (3 bits)

### 4.2 Bets
- `bet_count` (5 bits)
- `bet_descriptor` repeated

### 4.3 History
- `history_count` (5 bits)
- each roll encoded as 9 bits (3 dice x 3 bits)

## 5. Testing Requirements

- Golden vectors for each bet type (small/big, triple, doubles, sum, domino, hop).
- Atomic batch round-trip with mixed targets.
- State round-trip tests with history > 0.

## 6. Acceptance Criteria

### AC-1: Payload Size
- **AC-1.1**: Single bet payload <= 4 bytes for small amounts.
- **AC-1.2**: Batch payload size reduction >= 40% vs v1.

### AC-2: State Compaction
- **AC-2.1**: Typical sic bo state blob shrinks by >= 30%.

### AC-3: Compatibility
- **AC-3.1**: v1 and v2 supported during migration.
- **AC-3.2**: JS/TS and Rust decode v2 identically.

## 7. Implementation Map

- `execution/src/casino/sic_bo.rs`
- `packages/protocol/src/games/atomic.ts` (generated wrapper)
- `packages/protocol/test/fixtures/golden-vectors.json`
