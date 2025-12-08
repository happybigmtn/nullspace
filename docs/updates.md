# Code Updates Log

## 2025-12-07: On-Chain Integration for useTerminalGame Hook

### Summary
Modified `/home/r/Coding/supersociety-battleware/website/src/hooks/useTerminalGame.ts` to integrate with the on-chain casino system via `CasinoChainService`. The hook now supports both on-chain and local fallback modes.

### Changes Made

#### 1. Chain Service Integration
- Added `CasinoChainService` integration with automatic initialization
- Added `BattlewareClient` and `WasmWrapper` imports for blockchain communication
- Created session tracking using `currentSessionId` state and ref for immediate access
- Added `isOnChain` flag to enable/disable on-chain mode with graceful fallback

#### 2. Event Subscription System
- Implemented event listeners for:
  - `CasinoGameStarted`: Triggered when a game session begins
  - `CasinoGameMoved`: Triggered when a move is processed
  - `CasinoGameCompleted`: Triggered when a game ends with payout
- Events only process for the current session (using `currentSessionIdRef`)
- Automatic cleanup on unmount to prevent memory leaks

#### 3. Optimistic Updates with Rollback
All game actions now follow the pattern:
```typescript
async function gameAction() {
  // 1. Optimistic UI update
  setGameState(prev => ({ ...prev, stage: 'LOADING' }));

  // 2. Submit transaction to chain
  try {
    await chainService.sendMove(sessionId, payload);
  } catch (error) {
    // 3. Rollback on failure
    setGameState(prev => ({ ...prev, stage: 'BETTING', message: 'FAILED' }));
  }
}
```

#### 4. Updated Game Actions
Modified the following functions to use chain service:

**Core Actions:**
- `startGame()`: Creates on-chain session and tracks session ID
- `toggleShield()`: Submits shield toggle transaction
- `toggleDouble()`: Submits double toggle transaction
- `deal()`: Waits for chain events (auto-deals on StartGame for most games)

**Blackjack:**
- `bjHit()`: Sends payload `[0]` for hit action
- `bjStand()`: Sends payload `[1]` for stand action
- `bjDouble()`: Sends payload `[2]` for double action

**HiLo:**
- `hiloPlay()`: Sends `[0]` for Higher, `[1]` for Lower
- `hiloCashout()`: Sends `[2]` for cashout

All actions maintain local mode fallback for offline operation.

#### 5. State Parsing System
Implemented `parseGameState()` function to deserialize binary state blobs:

**Blackjack State:**
```
[pLen:u8] [pCards:u8×pLen] [dLen:u8] [dCards:u8×dLen] [stage:u8]
```

**HiLo State:**
```
[currentCard:u8] [accumulator:i64 BE]
```

**Baccarat State:**
```
[stage:u8] [pCard1-3:u8] [bCard1-3:u8] [betType:u8]
```

**Video Poker State:**
```
[stage:u8] [c1-5:u8] [holdMask:u8]
```

#### 6. Card Decoding Utility
Added `decodeCard()` helper to convert card values (0-51) to Card objects:
- Suits: ♠ ♥ ♦ ♣ (mapped from value / 13)
- Ranks: A-K (mapped from value % 13)
- Values: Ace=1, Face=10, Number=face value

#### 7. Game Type Mapping
Created `GAME_TYPE_MAP` to convert frontend `GameType` enum to chain `ChainGameType`:
```typescript
{
  [GameType.BLACKJACK]: ChainGameType.Blackjack,
  [GameType.HILO]: ChainGameType.HiLo,
  // ... etc
}
```

### Architecture

**Transaction Flow:**
```
User Action → Optimistic Update → Chain Transaction → Event → State Update
     ↓                                                    ↑
  Rollback on Error ←─────────────────────────────────────┘
```

**Event Flow:**
```
Chain → WebSocket → BattlewareClient → CasinoChainService → Event Handlers → UI Update
```

### Testing
- Build completes successfully with no TypeScript errors
- All warnings are pre-existing (dead code in execution crate)
- Ready for integration testing with local node

### Next Steps
1. Test with running local node
2. Implement state parsing for remaining game types (Craps, Roulette, Sic Bo, etc.)
3. Add retry logic for failed transactions
4. Consider adding transaction confirmation UI
5. Implement tournament registration via chain service

### Files Modified
- `/home/r/Coding/supersociety-battleware/website/src/hooks/useTerminalGame.ts`

### Dependencies
- `CasinoChainService` from `/home/r/Coding/supersociety-battleware/website/src/services/CasinoChainService.ts`
- `BattlewareClient` from `/home/r/Coding/supersociety-battleware/website/src/api/client.js`
- `WasmWrapper` from `/home/r/Coding/supersociety-battleware/website/src/api/wasm.js`
- Casino types from `/home/r/Coding/supersociety-battleware/website/src/types/casino.ts`
