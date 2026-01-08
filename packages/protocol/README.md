# @nullspace/protocol

Binary protocol encoding and decoding for casino game messages.

## Protocol Version

All encoded messages include a 1-byte version header as the first byte. This enables protocol evolution without breaking existing clients.

### Version Format

```
[version:u8] [opcode:u8] [payload...]
```

### Current Version

- **CURRENT_PROTOCOL_VERSION**: 1
- **Supported range**: 1-1

### Version Negotiation

1. Client encodes messages with `CURRENT_PROTOCOL_VERSION`
2. Server validates version is within supported range
3. Unsupported versions result in `UnsupportedProtocolVersionError`

### Example Usage

```typescript
import {
  encodeBlackjackMove,
  decodeVersionedPayload,
  tryDecodeVersion,
  UnsupportedProtocolVersionError,
} from '@nullspace/protocol';

// Encoding (version header added automatically)
const payload = encodeBlackjackMove('hit');
// Result: [0x01, 0x00] - version 1, hit opcode

// Decoding with validation
try {
  const { version, opcode, payload } = decodeVersionedPayload(data);
  console.log(`Protocol v${version}, opcode: ${opcode}`);
} catch (e) {
  if (e instanceof UnsupportedProtocolVersionError) {
    console.error(`Unsupported protocol version: ${e.version}`);
  }
}

// Non-throwing version check
const result = tryDecodeVersion(data);
if (result && !result.isSupported) {
  console.warn(`Client using unsupported protocol v${result.version}`);
}
```

## Encoding Functions

### Blackjack
- `encodeBlackjackMove(move)` - hit, stand, double, split, deal, surrender

### Roulette
- `encodeRouletteMove(move, options?)` - place_bet, spin, clear_bets
- `encodeRouletteAtomicBatch(bets)` - multiple bets in one transaction

### Craps
- `encodeCrapsMove(move, options?)` - place_bet, add_odds, roll, clear_bets
- `encodeCrapsAtomicBatch(bets)` - multiple bets in one transaction

### Baccarat
- `encodeBaccaratAtomicBatch(bets)` - PLAYER, BANKER, TIE, etc.

### Sic Bo
- `encodeSicBoAtomicBatch(bets)` - BIG, SMALL, SUM, etc.

### Other Games
- `encodeHiLoAction(action)` - higher, lower, same, cashout
- `encodeVideoPokerHold(holds)` - 5-card hold pattern
- `encodeCasinoWarAction(action)` - play, war, surrender
- `encodeThreeCardAction(action)` / `encodeThreeCardDeal(options)`
- `encodeUltimateHoldemAction(action)` / `encodeUltimateHoldemBet(multiplier)`

## Decoding Functions

### Chain Events
- `decodeGameResult(data)` - game result events from chain
- `decodeBlackjackState(data)` - blackjack state updates

### Version Utilities
- `decodeVersionedPayload(data)` - extract version, opcode, payload (throws on invalid)
- `tryDecodeVersion(data)` - non-throwing version check
- `stripVersionHeader(data)` - remove version byte
- `validateVersion(version)` - throws if unsupported

## Binary Format Reference

### Message Structure
```
[version:u8] [opcode:u8] [game-specific data...]
```

### Amount Encoding
All amounts are encoded as 8-byte big-endian unsigned integers (`u64 BE`).

### Atomic Batch Format
```
[version:u8] [opcode:u8] [count:u8] [bet1...] [bet2...] ...
```

Each bet within a batch follows game-specific encoding.
