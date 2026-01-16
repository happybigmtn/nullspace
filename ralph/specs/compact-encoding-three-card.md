# Compact Encoding: Three Card Poker

**Status**: draft  
**Date**: 2026-01-16  
**Scope**: Three Card move payloads and state blob compaction using bitwise encoding per `compact-encoding-framework.md`.

## 1. Goals

1. Replace multiple side-bet setters with a single compact `Deal` payload.
2. Reduce deal payload size by using a side-bet mask + varint amounts.
3. Compact state blob with 6-bit card IDs and packed stage flags.

## 2. Non-Goals

- Changing three card rules or payout logic.

## 3. Move Payload Encoding (v2)

### 3.1 Header
- `version` (3 bits)
- `opcode` (5 bits)

### 3.2 Opcode Map (v2)
- `0`: Play
- `1`: Fold
- `2`: Deal
- `3`: Reveal
- `4`: SetRules

### 3.3 Deal Payload (side bets)
- `side_bet_mask` (3 bits):
  1. pair_plus
  2. six_card
  3. progressive
- For each mask bit set: `amount` (ULEB128)

## 4. State Blob Encoding (v2)

### 4.1 Header Bits
- `version` (3 bits)
- `stage` (2 bits)
- `has_result` (1 bit)

### 4.2 Cards
- `player_card_count` (2 bits)
- `dealer_card_count` (2 bits)
- `player_cards` (6 bits each)
- `dealer_cards` (6 bits each)

### 4.3 Bets
- `side_bet_mask` (3 bits)
- amounts (ULEB128) per mask bit

### 4.4 Results
- `player_rank` (6 bits) and `dealer_rank` (6 bits) if present
- `dealer_qualifies` (1 bit)

## 5. Testing Requirements

- Golden vectors for deal with each side bet combination.
- Round-trip tests for play/fold/reveal.
- State round-trip tests with and without dealer qualification.

## 6. Acceptance Criteria

### AC-1: Payload Size
- **AC-1.1**: `play/fold/reveal` payloads are 1 byte total.
- **AC-1.2**: `deal` payload <= 3 bytes when only one side bet present.

### AC-2: State Compaction
- **AC-2.1**: Typical three card state blob shrinks by >= 35%.

### AC-3: Compatibility
- **AC-3.1**: v1 and v2 supported during migration.
- **AC-3.2**: JS/TS and Rust decode v2 identically.

## 7. Implementation Map

- `execution/src/casino/three_card.rs`
- `packages/protocol/src/games/actions.ts` (generated wrapper)
- `packages/protocol/test/fixtures/golden-vectors.json`
