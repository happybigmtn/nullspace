# Compact Encoding: HiLo

**Status**: draft  
**Date**: 2026-01-16  
**Scope**: HiLo move payloads and state blob compaction using bitwise encoding per `compact-encoding-framework.md`.

## 1. Goals

1. Encode HiLo actions in a single byte (header + 2 bits).
2. Compact state blob with bit-packed accumulator and rules fields.

## 2. Non-Goals

- Changing HiLo rules or payout logic.

## 3. Move Payload Encoding (v2)

### 3.1 Header
- `version` (3 bits)
- `opcode` (5 bits)

### 3.2 Opcode Map (v2)
- `0`: Higher
- `1`: Lower
- `2`: Same
- `3`: Cashout

## 4. State Blob Encoding (v2)

### 4.1 Header Bits
- `version` (3 bits)
- `stage` (2 bits)
- `accumulator` (ULEB128)
- `last_result` (6 bits)

### 4.2 Rules
- `rules_id` (ULEB128) or packed rules bits

## 5. Testing Requirements

- Golden vectors for each action.
- State round-trip tests with varying accumulators.

## 6. Acceptance Criteria

### AC-1: Payload Size
- **AC-1.1**: Each action payload is 1 byte total.

### AC-2: State Compaction
- **AC-2.1**: Typical state blob shrinks by >= 30%.

### AC-3: Compatibility
- **AC-3.1**: v1 and v2 supported during migration.
- **AC-3.2**: JS/TS and Rust decode v2 identically.

## 7. Implementation Map

- `execution/src/casino/hilo.rs`
- `packages/protocol/src/games/actions.ts` (generated wrapper)
- `packages/protocol/test/fixtures/golden-vectors.json`
