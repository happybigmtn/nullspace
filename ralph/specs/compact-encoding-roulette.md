# Compact Encoding: Roulette

**Status**: draft  
**Date**: 2026-01-16  
**Scope**: Roulette move payloads and state blob compaction using bitwise encoding per `compact-encoding-framework.md`.

## 1. Goals

1. Pack roulette bet type + value into <= 2 bytes per bet descriptor.
2. Reduce atomic batch payload size by >= 40%.
3. Compact roulette state blob (bets, result, history) with bit packing.

## 2. Non-Goals

- Changing roulette rules or payouts.
- Removing zero-rule variants.

## 3. Move Payload Encoding (v2)

### 3.1 Header
- `version` (3 bits)
- `opcode` (5 bits)

### 3.2 Opcode Map (v2)
- `0`: PlaceBet
- `1`: Spin
- `2`: ClearBets
- `3`: SetRules
- `4`: AtomicBatch

### 3.3 Bet Descriptor
- `bet_type` (4 bits, 0-13)
- `value` (6 bits, 0-63)
- `amount` (ULEB128)

The `value` encodes:
- Straight number (0-36, 37=00)
- Dozen/Column index (0-2)
- Split/Street/Corner/Six-line index

### 3.4 AtomicBatch
- `bet_count` (5 bits, max 20)
- `bet_descriptor` repeated

## 4. State Blob Encoding (v2)

### 4.1 Header Bits
- `version` (3 bits)
- `phase` (2 bits)
- `zero_rule` (3 bits)
- `has_result` (1 bit)
- `result` (6 bits if present)

### 4.2 Bets
- `bet_count` (5 bits)
- `bet_descriptor` repeated

### 4.3 Totals
- `total_wagered` (ULEB128)
- `pending_return` (ULEB128)

### 4.4 Optional History
- `history_count` (5 bits)
- each result as 6 bits

## 5. Testing Requirements

- Golden vectors for each bet category (straight, split, dozen, column, etc).
- Atomic batch round-trip tests with mixed bets.
- State round-trip tests including zero-rule variants.

## 6. Acceptance Criteria

### AC-1: Payload Size
- **AC-1.1**: Single roulette bet payload <= 4 bytes for small amounts.
- **AC-1.2**: Batch payload size reduction >= 40% vs v1.

### AC-2: State Compaction
- **AC-2.1**: Typical roulette state blob shrinks by >= 30%.

### AC-3: Compatibility
- **AC-3.1**: v1 and v2 supported during migration.
- **AC-3.2**: JS/TS and Rust decode v2 identically.

## 7. Implementation Map

- `execution/src/casino/roulette.rs`
- `packages/protocol/src/games/roulette.ts` (generated wrapper)
- `packages/protocol/test/fixtures/golden-vectors.json`
