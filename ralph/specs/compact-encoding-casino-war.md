# Compact Encoding: Casino War

**Status**: draft  
**Date**: 2026-01-16  
**Scope**: Casino War move payloads and state blob compaction using bitwise encoding per `compact-encoding-framework.md`.

## 1. Goals

1. Encode play/war/surrender actions in <= 1 byte total.
2. Encode tie bet updates with compact varint amounts.
3. Compact state blob with 6-bit card IDs and packed stage flags.

## 2. Non-Goals

- Changing casino war rules or payouts.

## 3. Move Payload Encoding (v2)

### 3.1 Header
- `version` (3 bits)
- `opcode` (5 bits)

### 3.2 Opcode Map (v2)
- `0`: Play
- `1`: War
- `2`: Surrender
- `3`: SetTieBet
- `4`: SetRules

### 3.3 SetTieBet Payload
- `amount` (ULEB128)

## 4. State Blob Encoding (v2)

### 4.1 Header Bits
- `version` (3 bits)
- `stage` (2 bits)
- `player_card` (6 bits)
- `dealer_card` (6 bits)
- `tie_bet` (ULEB128)

## 5. Testing Requirements

- Golden vectors for play/war/surrender and tie bet setting.
- State round-trip tests with tie bet and result states.

## 6. Acceptance Criteria

### AC-1: Payload Size
- **AC-1.1**: Play/war/surrender payloads are 1 byte total.
- **AC-1.2**: Tie bet payload <= 3 bytes for small amounts.

### AC-2: State Compaction
- **AC-2.1**: Typical state blob shrinks by >= 30%.

### AC-3: Compatibility
- **AC-3.1**: v1 and v2 supported during migration.
- **AC-3.2**: JS/TS and Rust decode v2 identically.

## 7. Implementation Map

- `execution/src/casino/casino_war.rs`
- `packages/protocol/src/games/actions.ts` (generated wrapper)
- `packages/protocol/test/fixtures/golden-vectors.json`
