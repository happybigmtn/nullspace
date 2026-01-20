# Compact Encoding: Baccarat

**Status**: draft  
**Date**: 2026-01-16  
**Scope**: Baccarat move payloads and state blob compaction using bitwise encoding per `compact-encoding-framework.md`.

## 1. Goals

1. Reduce baccarat bet payloads by packing bet type + amount with bitwise header.
2. Standardize batch bet encoding with shared bet descriptor.
3. Compact state blob (cards and totals) using 6-bit card IDs and bit-packed totals.

## 2. Non-Goals

- Changing baccarat rules or payouts.
- Removing existing side bets.

## 3. Move Payload Encoding (v2)

### 3.1 Header
- `version` (3 bits)
- `opcode` (5 bits)

### 3.2 Opcode Map (v2)
- `0`: PlaceBet
- `1`: Deal
- `2`: ClearBets
- `3`: AtomicBatch
- `4`: SetRules

### 3.3 Bet Descriptor
- `bet_type` (4 bits, 0-9)
- `amount` (ULEB128)

### 3.4 AtomicBatch
- `bet_count` (4 bits, max 11)
- `bet_descriptor` repeated

### 3.5 SetRules
- `rules_id` (ULEB128) + optional flags bitmask

## 4. State Blob Encoding (v2)

### 4.1 Header Bits
- `version` (3 bits)
- `stage` (2 bits)
- `player_total` (4 bits, 0-9)
- `banker_total` (4 bits, 0-9)
- `has_result` (1 bit)

### 4.2 Cards
- `player_card_count` (2 bits)
- `banker_card_count` (2 bits)
- `player_cards` (6 bits each)
- `banker_cards` (6 bits each)

### 4.3 Bets
- `bet_count` (4 bits)
- `bet_descriptor` repeated

## 5. Testing Requirements

- Golden vectors for single bet, multiple bet batch, and deal.
- State round-trip tests with 2- and 3-card draws.
- Size regression test: v2 blob <= 60% of v1 for typical sessions.

## 6. Acceptance Criteria

### AC-1: Payload Size
- **AC-1.1**: Single bet payload <= 3 bytes for small amounts.
- **AC-1.2**: Batch payload size scales linearly with bet count (no padding).

### AC-2: State Compaction
- **AC-2.1**: Typical baccarat state blob shrinks by >= 35%.

### AC-3: Compatibility
- **AC-3.1**: v1 and v2 supported during migration.
- **AC-3.2**: JS/TS and Rust decode v2 identically.

## 7. Implementation Map

- `execution/src/casino/baccarat.rs`
- `packages/protocol/src/games/atomic.ts` (generated wrapper)
- `packages/protocol/test/fixtures/golden-vectors.json`
