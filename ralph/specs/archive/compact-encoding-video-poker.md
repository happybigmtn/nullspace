# Compact Encoding: Video Poker

**Status**: draft  
**Date**: 2026-01-16  
**Scope**: Video poker move payloads and state blob compaction using bitwise encoding per `compact-encoding-framework.md`.

## 1. Goals

1. Encode hold mask in a single byte (header + 5 bits).
2. Encode rule updates with compact varint rule IDs.
3. Compact state blob with 6-bit card IDs and packed stage flags.

## 2. Non-Goals

- Changing video poker rules or payout logic.

## 3. Move Payload Encoding (v2)

### 3.1 Header
- `version` (3 bits)
- `opcode` (5 bits)

### 3.2 Opcode Map (v2)
- `0`: HoldMask
- `1`: SetRules

### 3.3 HoldMask Payload
- `hold_mask` (5 bits, LSB=card0)

### 3.4 SetRules Payload
- `rules_id` (ULEB128)

## 4. State Blob Encoding (v2)

### 4.1 Header Bits
- `version` (3 bits)
- `stage` (2 bits)
- `has_result` (1 bit)

### 4.2 Cards
- `hand_count` (3 bits, fixed 5 cards)
- `cards` (6 bits each)

### 4.3 Results
- `hand_rank` (6 bits) if present
- `multiplier` (4 bits)

## 5. Testing Requirements

- Golden vectors for hold masks (all 0, all 1, mixed).
- State round-trip tests with draw results.

## 6. Acceptance Criteria

### AC-1: Payload Size
- **AC-1.1**: Hold payload is 1 byte total.
- **AC-1.2**: SetRules payload <= 3 bytes for small IDs.

### AC-2: State Compaction
- **AC-2.1**: Typical state blob shrinks by >= 30%.

### AC-3: Compatibility
- **AC-3.1**: v1 and v2 supported during migration.
- **AC-3.2**: JS/TS and Rust decode v2 identically.

## 7. Implementation Map

- `execution/src/casino/video_poker.rs`
- `packages/protocol/src/games/actions.ts` (generated wrapper)
- `packages/protocol/test/fixtures/golden-vectors.json`
