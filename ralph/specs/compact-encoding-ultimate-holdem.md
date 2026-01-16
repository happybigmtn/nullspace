# Compact Encoding: Ultimate Hold'em

**Status**: draft  
**Date**: 2026-01-16  
**Scope**: Ultimate Hold'em move payloads and state blob compaction using bitwise encoding per `compact-encoding-framework.md`.

## 1. Goals

1. Encode bet multipliers and side bets compactly using bit masks.
2. Reduce deal payload size via mask + varint side bet amounts.
3. Compact state blob with 6-bit card IDs and packed stage flags.

## 2. Non-Goals

- Changing Ultimate Hold'em rules or payouts.

## 3. Move Payload Encoding (v2)

### 3.1 Header
- `version` (3 bits)
- `opcode` (5 bits)

### 3.2 Opcode Map (v2)
- `0`: Check
- `1`: Bet
- `2`: Fold
- `3`: Deal
- `4`: Reveal
- `5`: SetRules

### 3.3 Bet Payload
- `multiplier` (2 bits) for 1x,2x,3x,4x

### 3.4 Deal Payload (side bets)
- `side_bet_mask` (3 bits):
  1. trips
  2. six_card
  3. progressive
- For each mask bit set: `amount` (ULEB128)

## 4. State Blob Encoding (v2)

### 4.1 Header Bits
- `version` (3 bits)
- `stage` (2 bits)
- `has_result` (1 bit)

### 4.2 Cards
- `hole_count` (2 bits)
- `community_count` (3 bits)
- `dealer_count` (2 bits)
- `hole_cards` (6 bits each)
- `community_cards` (6 bits each)
- `dealer_cards` (6 bits each)

### 4.3 Bets
- `side_bet_mask` (3 bits)
- amounts (ULEB128) per mask bit

### 4.4 Results
- `bonus_rank` (6 bits) if present

## 5. Testing Requirements

- Golden vectors for bet multipliers and deal side bets.
- Round-trip tests for bet/fold/reveal.
- State round-trip tests with community cards.

## 6. Acceptance Criteria

### AC-1: Payload Size
- **AC-1.1**: Bet payload is 2 bytes total (header + multiplier).
- **AC-1.2**: Deal payload <= 3 bytes when only one side bet present.

### AC-2: State Compaction
- **AC-2.1**: Typical state blob shrinks by >= 35%.

### AC-3: Compatibility
- **AC-3.1**: v1 and v2 supported during migration.
- **AC-3.2**: JS/TS and Rust decode v2 identically.

## 7. Implementation Map

- `execution/src/casino/ultimate_holdem.rs`
- `packages/protocol/src/games/actions.ts` (generated wrapper)
- `packages/protocol/test/fixtures/golden-vectors.json`
