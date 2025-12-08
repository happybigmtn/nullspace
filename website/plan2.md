# Frontend Chain Integration Plan

## Executive Summary

Audit of the frontend revealed that **only 6 of 10 games have full chain integration**. The remaining 4 table games (Roulette, Sic Bo, Craps, and parts of Three Card/Ultimate Holdem) use **100% local RNG and local balance updates**. This plan outlines the work needed to achieve full on-chain state for all games.

---

## Audit Findings

### 1. Game Action Chain Integration Status

| Game | Status | Chain Methods Used | Issues |
|------|--------|-------------------|--------|
| Blackjack | ✅ FULL | startGame, sendMove (Hit/Stand/Double) | Split uses local RNG |
| Video Poker | ✅ FULL | startGame, sendMove (Hold/Draw) | None |
| Baccarat | ✅ FULL | startGame, sendMove (Deal) | None |
| HiLo | ✅ FULL | startGame, sendMove (Higher/Lower/Cashout) | None |
| Casino War | ✅ FULL | startGame, sendMove | None |
| Roulette | ❌ LOCAL | None | Uses Math.random() for spin |
| Sic Bo | ❌ LOCAL | None | Uses rollDie() locally |
| Craps | ❌ LOCAL | None | Uses rollDie() locally |
| Three Card | ⚠️ PARTIAL | startGame only | Play/Fold use local logic |
| Ultimate Holdem | ⚠️ PARTIAL | startGame only | Check/Bet/Fold use local logic |

### 2. Local RNG Violations (30+ instances)

**File: `useTerminalGame.ts`**
- Line 160-164: Fake leaderboard generation with `Math.random()`
- Line 895: `createDeck()` for local card shuffling
- Line 1058: `Math.random()` in `spinRoulette()`
- Line 1090: `rollDie()` in `rollSicBo()`
- Line 1121: `rollDie()` in `rollCraps()`

**File: `gameUtils.ts`**
- Line 79: `Math.random()` usage
- Line 88: `createDeck()` function
- Line 91: `rollDie()` function
- Line 92: `randomInt()` function
- Line 93: `randomItem()` function

### 3. Local Balance Update Violations

**File: `useTerminalGame.ts`**
- Lines 653-676: `resolveGame()` function updates chips locally instead of waiting for `CasinoGameCompleted` event
- Lines 1060-1065: Roulette payout calculated locally
- Lines 1092-1093: Sic Bo payout calculated locally
- Lines 1125-1130: Craps payout calculated locally

### 4. Chain Event Handling Gaps

**Current subscriptions:**
- ✅ `CasinoGameStarted` - Handled
- ✅ `CasinoGameMoved` - Handled
- ✅ `CasinoGameCompleted` - Handled, sets `finalChips`

**Missing subscriptions:**
- ❌ `PlayerRegistered` - Not subscribed
- ❌ `LeaderboardUpdated` - Not subscribed (using fake data)

**Unused event data:**
- `wasShielded` and `wasDoubled` from `CasinoGameCompleted` are ignored

### 5. Rust Backend Capabilities (All 10 Games Supported)

All games have complete chain implementations in `execution/src/casino/`:

| Game | Moves Supported |
|------|-----------------|
| Blackjack | Hit(0), Stand(1), Double(2), Split(3) |
| Video Poker | Hold mask + Draw |
| Baccarat | Bet type (Player/Banker/Tie) |
| HiLo | Higher(0), Lower(1), Cashout(2) |
| Casino War | War(0), Surrender(1) |
| Roulette | Bet type + number/color + Spin |
| Sic Bo | Bet type + number + Roll |
| Craps | Bet type + amount + Roll |
| Three Card | Play(0), Fold(1) |
| Ultimate Holdem | Check(0), Bet(1), Fold(2) |

---

## Implementation Plan

### Phase 1: Remove Local RNG Infrastructure

**File: `gameUtils.ts`**
1. Remove or deprecate these functions (mark as `@deprecated`):
   - `createDeck()` - line 88
   - `rollDie()` - line 91
   - `randomInt()` - line 92
   - `randomItem()` - line 93

2. Keep pure calculation functions (no RNG):
   - `calculateCrapsExposure()` - OK
   - `calculateRoulettePayout()` - OK
   - `calculateSicBoPayout()` - OK
   - `resolveCrapsBets()` - OK

### Phase 2: Implement Chain Integration for Table Games

#### 2A. Roulette (`spinRoulette`)

**Current (LOCAL):**
```typescript
const spinRoulette = () => {
    const result = Math.floor(Math.random() * 37); // 0-36
    // ... local payout calculation
    setStats(prev => ({ ...prev, chips: prev.chips + payout }));
};
```

**Target (ON-CHAIN):**
```typescript
const spinRoulette = async () => {
    if (!isOnChain || !chainService || !currentSessionId) return;

    // Serialize current bets and send spin command
    const payload = serializeRouletteSpin(gameState.rouletteBets);
    await chainService.sendMove(currentSessionId, payload);

    // Result comes via CasinoGameMoved/CasinoGameCompleted events
};
```

#### 2B. Sic Bo (`rollSicBo`)

**Current (LOCAL):**
```typescript
const rollSicBo = () => {
    const dice = [rollDie(), rollDie(), rollDie()];
    // ... local payout calculation
    setStats(prev => ({ ...prev, chips: prev.chips + payout }));
};
```

**Target (ON-CHAIN):**
```typescript
const rollSicBo = async () => {
    if (!isOnChain || !chainService || !currentSessionId) return;

    const payload = serializeSicBoRoll(gameState.sicBoBets);
    await chainService.sendMove(currentSessionId, payload);
};
```

#### 2C. Craps (`rollCraps`)

**Current (LOCAL):**
```typescript
const rollCraps = () => {
    const dice = [rollDie(), rollDie()];
    const total = dice[0] + dice[1];
    // ... local payout calculation
    setStats(prev => ({ ...prev, chips: prev.chips + payout }));
};
```

**Target (ON-CHAIN):**
```typescript
const rollCraps = async () => {
    if (!isOnChain || !chainService || !currentSessionId) return;

    const payload = serializeCrapsRoll(gameState.crapsBets);
    await chainService.sendMove(currentSessionId, payload);
};
```

#### 2D. Three Card Poker (`threeCardPlay`, `threeCardFold`)

**Current (LOCAL):** Uses local card dealing and payout calculation

**Target (ON-CHAIN):**
```typescript
const threeCardPlay = async () => {
    if (!isOnChain || !chainService || !currentSessionId) return;
    const payload = new Uint8Array([0]); // Play = 0
    await chainService.sendMove(currentSessionId, payload);
};

const threeCardFold = async () => {
    if (!isOnChain || !chainService || !currentSessionId) return;
    const payload = new Uint8Array([1]); // Fold = 1
    await chainService.sendMove(currentSessionId, payload);
};
```

#### 2E. Ultimate Holdem (`uhCheck`, `uhBet`, `uhFold`)

**Current (LOCAL):** Uses local card dealing and payout calculation

**Target (ON-CHAIN):**
```typescript
const uhCheck = async () => {
    const payload = new Uint8Array([0]); // Check = 0
    await chainService.sendMove(currentSessionId, payload);
};

const uhBet = async () => {
    const payload = new Uint8Array([1]); // Bet = 1
    await chainService.sendMove(currentSessionId, payload);
};

const uhFold = async () => {
    const payload = new Uint8Array([2]); // Fold = 2
    await chainService.sendMove(currentSessionId, payload);
};
```

### Phase 3: Remove Local Balance Updates

**File: `useTerminalGame.ts`**

1. **Delete `resolveGame()` function** (lines 653-676) - Balance updates should ONLY come from `CasinoGameCompleted` events

2. **Remove all inline chip updates:**
   - Line 1060-1065: Remove roulette local payout
   - Line 1092-1093: Remove sic bo local payout
   - Line 1125-1130: Remove craps local payout

3. **Update Blackjack split** to use chain:
   ```typescript
   const bjSplit = async () => {
       const payload = new Uint8Array([3]); // Split = 3
       await chainService.sendMove(currentSessionId, payload);
   };
   ```

### Phase 4: Subscribe to Missing Events

**File: `useTerminalGame.ts`**

1. **Add LeaderboardUpdated subscription:**
```typescript
chainService.onEvent('LeaderboardUpdated', (event) => {
    setLeaderboard(event.entries.map(e => ({
        name: e.name,
        chips: Number(e.chips),
        rank: e.rank
    })));
});
```

2. **Add PlayerRegistered subscription:**
```typescript
chainService.onEvent('PlayerRegistered', (event) => {
    if (event.player === myPublicKey) {
        setIsRegistered(true);
        setStats(prev => ({ ...prev, chips: Number(event.initialChips) }));
    }
});
```

3. **Remove fake leaderboard generation** (lines 160-172)

### Phase 5: Use Shield/Double Data

**File: `useTerminalGame.ts`**

Update `CasinoGameCompleted` handler to use `wasShielded` and `wasDoubled`:

```typescript
chainService.onGameCompleted((event) => {
    const payout = Number(event.payout);
    const finalChips = Number(event.finalChips);

    // Add to history with modifier info
    setStats(prev => ({
        ...prev,
        chips: finalChips,
        history: [...prev.history, {
            game: event.gameType,
            result: payout >= 0 ? 'WIN' : 'LOSS',
            amount: Math.abs(payout),
            wasShielded: event.wasShielded,
            wasDoubled: event.wasDoubled
        }]
    }));
});
```

### Phase 6: Add Player State Query on Load

**File: `useTerminalGame.ts`**

Add initial state fetch when app loads:

```typescript
useEffect(() => {
    const fetchInitialState = async () => {
        if (!client || !publicKey) return;

        const account = await client.getAccount(publicKey);
        if (account) {
            setStats(prev => ({
                ...prev,
                chips: Number(account.chips),
                shieldActive: account.shieldActive,
                doubleActive: account.doubleActive
            }));
            setIsRegistered(true);
        }
    };

    fetchInitialState();
}, [client, publicKey]);
```

---

## Implementation Order

1. **Phase 2** - Chain integration for table games (most critical)
2. **Phase 3** - Remove local balance updates
3. **Phase 1** - Remove local RNG infrastructure
4. **Phase 4** - Subscribe to missing events
5. **Phase 5** - Use shield/double data
6. **Phase 6** - Add player state query

---

## Files to Modify

| File | Changes |
|------|---------|
| `useTerminalGame.ts` | Major refactor - all game actions, event handlers |
| `gameUtils.ts` | Deprecate RNG functions, keep pure calculations |
| `CasinoChainService.ts` | Add missing event subscriptions |
| `gameStateParser.ts` | Ensure all 10 game parsers are complete |

---

## Testing Requirements

1. **Unit tests** for move serialization functions
2. **Integration tests** verifying:
   - Each game sends correct move payloads
   - Balance updates ONLY from chain events
   - Leaderboard updates from chain
3. **E2E tests** for complete game flows

---

## Risk Mitigation

1. Keep `isOnChain` flag for gradual rollout
2. Add error handling for chain submission failures
3. Add loading states while waiting for chain confirmation
4. Implement retry logic for failed transactions
