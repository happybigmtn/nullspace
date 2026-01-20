# Compact Encoding: Blackjack

**Status**: draft  
**Date**: 2026-01-16  
**Scope**: Blackjack move payloads and state blob compaction using bitwise encoding per `compact-encoding-framework.md`.

## 1. Goals

1. Reduce blackjack move payloads to 1-4 bytes for common actions.
2. Pack side bets into a single compact `Deal` payload (mask + varint amounts).
3. Shrink state blob by packing cards into 6-bit IDs and removing redundant fields.

## 2. Non-Goals

- Changing blackjack rules or payout logic.
- Removing side bets or tournament modifiers.

## 3. Move Payload Encoding (v2)

### 3.1 Header
- `version` (3 bits)
- `opcode` (5 bits)

### 3.2 Opcode Map (v2)
- `0`: Hit
- `1`: Stand
- `2`: Double
- `3`: Split
- `4`: Deal
- `5`: Surrender
- `6`: Reveal
- `7`: SetRules

### 3.3 Deal Payload (compact side bets)

Bit layout after header:
- `side_bet_mask` (5 bits) in fixed order:
  1. 21plus3
  2. lucky_ladies
  3. perfect_pairs
  4. bust_it
  5. royal_match
- For each mask bit set: append `amount` as ULEB128 varint.

Notes:
- Base wager is already encoded in `CasinoStartGame` (session bet). No base bet in `Deal`.
- Legacy `Set21Plus3` moves are deprecated in v2.

### 3.4 SetRules Payload
- `rules_id` (ULEB128) and optional `flags` (bitmask) for table variants.

## 4. State Blob Encoding (v2)

### 4.1 Header Bits
- `version` (3 bits)
- `stage` (2 bits) [Betting, PlayerTurn, AwaitingReveal, Complete]
- `hand_count` (2 bits, max 4)
- `active_hand_index` (2 bits)
- `dealer_card_count` (3 bits)

### 4.2 Hand Encoding (per hand)
- `card_count` (3 bits, max 8)
- `bet_mult` (2 bits)
- `status` (3 bits)
- `was_split` (1 bit)
- `cards` (6 bits each)

### 4.3 Dealer Cards
- `dealer_cards` (6 bits each)

### 4.4 Side Bets
- `side_bet_mask` (5 bits)
- amounts (ULEB128 varints) per mask bit

### 4.5 Derived Fields
- `blackjackActions` is derived from state and not stored.

## 5. Testing Requirements

- Golden vectors for each action with and without side bets.
- State round-trip test using random hands, split hands, and side bet variants.
- Size regression test: v2 blob <= 60% of v1 for typical sessions.

## 6. Acceptance Criteria

### AC-1: Payload Size
- **AC-1.1**: `hit/stand/double/split/surrender/reveal` payloads are 1 byte total (header only).
- **AC-1.2**: `deal` with no side bets is 2 bytes total.

### AC-2: State Compaction
- **AC-2.1**: Typical blackjack state blob shrinks by >= 35%.
- **AC-2.2**: All v1 fields are still representable in v2.

### AC-3: Compatibility
- **AC-3.1**: v1 and v2 are both accepted during migration.
- **AC-3.2**: JS/TS and Rust decode the same v2 payloads.

## 7. Implementation Map

- `execution/src/casino/blackjack.rs`
- `packages/protocol/src/games/blackjack.ts` (generated wrapper)
- `packages/protocol/test/fixtures/golden-vectors.json`
