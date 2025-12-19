# Frontend Architecture Refactor Plan

## Problem Statement

The frontend currently re-implements casino game logic to determine display results. This violates the "single source of truth" principle and creates risk of frontend/backend desync.

**Example from `useBlackjack.ts` (lines 36-74):**
```typescript
const resolveBlackjackRound = useCallback((hands: CompletedHand[], dealerHand: Card[]) => {
    const dVal = getHandValue(dealerHand);
    hands.forEach((hand) => {
        const pVal = getHandValue(hand.cards);
        if (pVal > 21) win = -hand.bet;
        else if (dVal > 21) win = hand.bet;
        else if (pVal === 21 && hand.cards.length === 2) win = Math.floor(hand.bet * 1.5);
        // ... duplicates backend logic
    });
}, [...]);
```

**Root Cause:**
- `CasinoGameCompleted` event only contains `payout: i64` (a number with no context)
- The `logs: Vec<String>` field exists but is always empty
- Frontend must parse state blobs and re-implement game rules to show WHY player won/lost

---

## Recommended Solution

Populate the existing `logs` field in `CasinoGameCompleted` events with structured JSON containing display-ready outcome data. This is:

- **Non-breaking**: Uses existing event field
- **Minimal code change**: Add log generation at game completion
- **Immediately deployable**: No schema migrations required

### Event Structure (Current)
```rust
CasinoGameCompleted {
    session_id: u64,
    player: PublicKey,
    game_type: GameType,
    payout: i64,              // Net change (can be negative)
    final_chips: u64,
    was_shielded: bool,
    was_doubled: bool,
    logs: Vec<String>,        // <-- POPULATE THIS
}
```

---

## Game-by-Game Analysis

### 1. Blackjack

**State Blob (v2):** 32+ bytes variable
```
[version:u8=2][stage:u8][21plus3Bet:u64][initialCards:u8×2][activeHandIdx:u8]
[handCount:u8][hands:HandData×n][dealerCount:u8][dealerCards:u8×n]
```

**Display Data Needed:**
- Per-hand: value, soft status, outcome (WIN/LOSS/PUSH/BLACKJACK), payout
- Dealer: value, blackjack status, busted status
- 21+3: hand type (STRAIGHT_FLUSH/TRIPS/STRAIGHT/FLUSH/NONE), multiplier, payout

**Recommended Log Format:**
```
Hand 1:value=20,soft=false,status=Standing,bet=100,payout=200,outcome=WIN
Hand 2:value=22,soft=false,status=Busted,bet=100,payout=0,outcome=LOSS
Dealer:value=19,blackjack=false
21+3:type=FLUSH,mult=5,bet=10,payout=60
```

**Edge Cases:**
- Split hands: Each resolved independently, max 4 hands
- Split A+10 is NOT natural blackjack (pays 1:1, not 3:2)
- Dealer doesn't play if all player hands bust
- 21+3 uses initial 2 player cards + dealer up card

---

### 2. Baccarat

**State Blob:** Variable
```
[betCount:u8][bets:BaccaratBet×n][playerHandLen:u8][playerCards:u8×n]
[bankerHandLen:u8][bankerCards:u8×n]
```

**Display Data Needed:**
- Player/Banker: cards, total (mod 10), card count
- Winner: player/banker/tie
- Natural status (8 or 9 on first two)
- Per-bet outcome: win/loss/push, payout
- Pair/Perfect Pair status for side bets

**Recommended Log Format:**
```json
{
  "playerCards": [12, 7],
  "bankerCards": [5, 3, 9],
  "playerTotal": 9,
  "bankerTotal": 7,
  "winner": "player",
  "isNatural": true,
  "betResults": [
    {"betType": 0, "amount": 100, "outcome": "win", "payout": 200},
    {"betType": 3, "amount": 10, "outcome": "loss", "payout": 0}
  ]
}
```

**Edge Cases:**
- Banker commission (5% on banker wins)
- Lucky 6: Different payouts for 2-card vs 3-card banker 6
- Dragon Bonus: Margin-based payouts (4-9 point spreads)
- Natural tie is push for Dragon Bonus

---

### 3. Craps

**State Blob (v2):** Variable (19 bytes per bet)
```
[version:u8=2][phase:u8][mainPoint:u8][d1:u8][d2:u8][madePointsMask:u8]
[epochPointEstablished:u8][betCount:u8][bets:CrapsBetEntry×n]
[fieldPaytable:u8?][buyCommissionTiming:u8?]
```

**Display Data Needed:**
- Dice: values, total, isHard (d1 === d2)
- Phase: COME_OUT or POINT
- Main point: 0 or 4-10
- Per-bet: type, target, status (ON/PENDING), amount, odds, outcome, payout
- Fire bet progress: points made mask (6 bits)
- ATS progress: small/tall completion masks

**Recommended Log Format:**
```json
{
  "dice": [3, 4],
  "total": 7,
  "isHard": false,
  "phase": "COME_OUT",
  "mainPoint": null,
  "resolvedBets": [
    {"betType": "PASS", "amount": 100, "odds": 200, "outcome": "WIN", "payout": 700}
  ],
  "fireProgress": {"pointsMade": 3, "mask": 11},
  "phaseEvent": {"type": "SEVEN_OUT"}
}
```

**Edge Cases:**
- Come/Don't Come "travel" from pending to point
- Fire bet only pays on seven-out
- ATS can only be placed before first point in epoch
- Buy bet commission timing variants
- Field paytable variants (2×/3× on 12)

---

### 4. Roulette

**State Blob:** 12+ bytes
```
[betCount:u8][zeroRule:u8][phase:u8][totalWagered:u64][pendingReturn:u64]
[bets:RouletteBet×n][result:u8?]
```

**Display Data Needed:**
- Winning number: 0-36
- Color: RED/BLACK/GREEN
- Per-bet: type, number, amount, outcome, payout, multiplier
- Zero rule: STANDARD/LA_PARTAGE/EN_PRISON
- Phase: BETTING or PRISON

**Recommended Log Format:**
```json
{
  "result": 17,
  "color": "BLACK",
  "betResults": [
    {"betType": "RED", "amount": 100, "outcome": "LOSS", "payout": 0},
    {"betType": "STRAIGHT", "number": 17, "amount": 10, "outcome": "WIN", "payout": 360}
  ],
  "zeroRule": "STANDARD"
}
```

**Edge Cases:**
- La Partage: Even-money bets get half back on zero
- En Prison: Even-money bets imprisoned, game continues
- Multiple simultaneous zero results with En Prison

---

### 5. Sic Bo

**State Blob:** Variable
```
[betCount:u8][bets:SicBoBet×n][die1:u8?][die2:u8?][die3:u8?]
```

**Display Data Needed:**
- Dice: [d1, d2, d3], total
- Is triple: all same
- Per-bet: type, target, amount, outcome, payout, multiplier

**Recommended Log Format:**
```json
{
  "dice": [3, 5, 5],
  "total": 13,
  "isTriple": false,
  "betResults": [
    {"betType": "BIG", "amount": 100, "won": true, "payout": 200, "multiplier": 1},
    {"betType": "SPECIFIC_DOUBLE", "target": 5, "amount": 50, "won": true, "payout": 450}
  ]
}
```

**Edge Cases:**
- Triples void Small/Big/Odd/Even bets
- Hop bets use bitmask encoding for targets
- Single number can match 1-3 times (different payouts)

---

### 6. Three Card Poker

**State Blob (v3):** 32 bytes
```
[version:u8=3][stage:u8][playerCards:u8×3][dealerCards:u8×3]
[pairPlusBet:u64][sixCardBonusBet:u64][progressiveBet:u64]
```

**Display Data Needed:**
- Player/Dealer: cards, hand rank (0-5), high cards
- Dealer qualification status (Q-6-4 or better)
- Comparison result: player wins/loses/ties
- Per-bet: ante, play, pair plus, 6-card bonus, progressive outcomes

**Recommended Log Format:**
```json
{
  "playerHandRank": "FLUSH",
  "dealerHandRank": "PAIR",
  "dealerQualifies": true,
  "playerWins": true,
  "payouts": {
    "ante": {"status": "WIN", "amount": 200},
    "play": {"status": "WIN", "amount": 200},
    "anteBonus": {"multiplier": 0, "amount": 0},
    "pairPlus": {"multiplier": 3, "amount": 400},
    "sixCardBonus": {"rank": "FLUSH", "multiplier": 15, "amount": 160}
  }
}
```

**Edge Cases:**
- Dealer doesn't qualify: Ante wins, Play pushes
- Ante bonus paid even if player loses main bet
- 6-Card Bonus uses all 6 cards (player 3 + dealer 3)
- Progressive uses Mini-Royal (AKQ) detection

---

### 7. Video Poker

**State Blob:** 6 bytes
```
[stage:u8][card1-5:u8×5]
```

**Display Data Needed:**
- Cards: 5 final cards
- Hand rank: 0-9 (HighCard to RoyalFlush)
- Multiplier and payout

**Recommended Log Format:**
```
RESULT:1:1
```
Format: `RESULT:{hand_rank}:{multiplier}`

Or JSON:
```json
{
  "handRank": "JACKS_OR_BETTER",
  "multiplier": 1,
  "cards": [10, 23, 1, 2, 3]
}
```

**Edge Cases:**
- Jacks or Better threshold (J/Q/K/A pairs win, 2-10 lose)
- Ace can be high or low in straights
- Hold mask not persisted (consumed during draw)

---

### 8. HiLo

**State Blob:** 9 bytes
```
[currentCard:u8][accumulator:i64 BE]
```

**Display Data Needed:**
- Previous card (for this move)
- New card drawn
- Guess made: HIGHER/LOWER/CASHOUT
- Result: correct/wrong
- Current multiplier (basis points / 10000)
- Streak count
- Payout preview

**Recommended Log Format:**
```json
{
  "previousCard": 23,
  "newCard": 45,
  "guess": "HIGHER",
  "correct": true,
  "multiplier": 16250,
  "streak": 3,
  "payoutPreview": 1625
}
```

**Edge Cases:**
- Can't guess lower from Ace or higher from King
- Multiplier calculated as 13/wins ratio
- Super mode streak multipliers (1.3x to 120x)
- Ace bonus (2x) if final card is Ace with super mode

---

### 9. Casino War

**State Blob (v1):** 12 bytes
```
[version:u8=1][stage:u8][playerCard:u8][dealerCard:u8][tieBet:u64]
```

**Display Data Needed:**
- Player/Dealer cards
- Stage: BETTING/WAR/COMPLETE
- Result type: WIN/LOSS/TIE/SURRENDER/WAR_WIN/WAR_LOSS/WAR_TIE
- Tie bet: amount, won, payout
- Is war resolution vs initial deal
- Original tie cards (if war occurred)

**Recommended Log Format:**
```json
{
  "playerCard": 23,
  "dealerCard": 10,
  "stage": "COMPLETE",
  "resultType": "WIN",
  "isWarResolution": false,
  "tieBet": {"amount": 10, "won": false, "payout": 0}
}
```

**Edge Cases:**
- Tie bet pays 10:1 on initial tie (even if war continues)
- Surrender returns 50% of ante
- War after tie: original cards overwritten in state
- Tie-after-tie bonus (extra ante payout)

---

### 10. Ultimate Texas Hold'em

**State Blob (v3):** 40 bytes
```
[version:u8=3][stage:u8][playerCards:u8×2][communityCards:u8×5]
[dealerCards:u8×2][playBetMult:u8][bonusCards:u8×4]
[tripsBet:u64][sixCardBonusBet:u64][progressiveBet:u64]
```

**Display Data Needed:**
- Player/Dealer hole cards
- Community cards (5)
- Best 5-card hand for each (rank, cards used)
- Dealer qualification (pair or better)
- Play bet multiplier (0=fold, 1-4)
- Individual bet outcomes: ante, blind, play, trips, 6-card, progressive

**Recommended Log Format:**
```json
{
  "playerHandRank": 5,
  "dealerHandRank": 1,
  "dealerQualifies": true,
  "playerWins": true,
  "playMultiplier": 4,
  "payouts": {
    "ante": {"status": "WIN", "amount": 200},
    "blind": {"status": "WIN", "bonus": 0, "amount": 100},
    "play": {"status": "WIN", "amount": 800},
    "trips": {"multiplier": 7, "amount": 80},
    "sixCardBonus": {"rank": 5, "multiplier": 15, "amount": 160},
    "progressive": {"rank": 3, "amount": 270}
  }
}
```

**Edge Cases:**
- Dealer doesn't qualify: Ante pushes (no win)
- Blind push: Wins less than Straight just push
- Progressive based on hole+flop ONLY (5 cards)
- 6-Card Bonus uses separate 4 bonus cards
- Side bets resolve regardless of fold/outcome

---

## Implementation Plan

### Phase 1: Backend - Populate Logs (Priority)

**Files to modify:**
- `execution/src/casino/blackjack.rs`
- `execution/src/casino/baccarat.rs`
- `execution/src/casino/craps.rs`
- `execution/src/casino/roulette.rs`
- `execution/src/casino/sic_bo.rs`
- `execution/src/casino/three_card.rs`
- `execution/src/casino/video_poker.rs`
- `execution/src/casino/hilo.rs`
- `execution/src/casino/casino_war.rs`
- `execution/src/casino/ultimate_holdem.rs`

**Pattern for each game:**
```rust
// At game completion, before returning GameResult::Win/Loss:
fn generate_completion_logs(state: &GameState, session: &GameSession) -> Vec<String> {
    let mut logs = Vec::new();

    // Add structured outcome data
    logs.push(format!("OUTCOME:{}", outcome_json));

    logs
}

// In process_move(), when game completes:
let logs = generate_completion_logs(&state, session);
// Return logs with the GameResult
```

**Location for log generation:**
- `execution/src/layer/handlers/casino.rs` - Central handler that emits events
- Or inline in each game's `process_move()` function

### Phase 2: Frontend - Consume Structured Logs

**Files to modify:**
- `website/src/hooks/useTerminalGame.ts` - Event handling
- `website/src/hooks/games/*.ts` - Remove duplicate logic
- `website/src/utils/gameStateParser.ts` - Fix broken parsers

**Pattern:**
```typescript
// In event handler:
if (event.type === 'CasinoGameCompleted' && event.logs?.length) {
    const outcomeData = JSON.parse(event.logs.find(l => l.startsWith('{')));
    // Use outcomeData for display instead of re-implementing logic
}
```

### Phase 3: Remove Duplicate Logic

**Delete or deprecate:**
- `resolveBlackjackRound()` in `useBlackjack.ts`
- `resolveRouletteBets()` in `gameUtils.ts`
- `evaluateVideoPokerHand()` in `gameUtils.ts`
- `calculateCrapsExposure()` resolution logic
- Hand evaluation duplicates in view components

---

## Common Patterns

### State Blob Conventions
All games use consistent card encoding:
- Card value: 0-51
- Suit: `card / 13` (0=Spades, 1=Hearts, 2=Diamonds, 3=Clubs)
- Rank: `card % 13` (0=Ace, 1=2, ..., 12=King)
- Unknown/Hidden: `0xFF` (255)

### Log Format Options

**Option A: Simple Key-Value (Video Poker, HiLo)**
```
RESULT:1:1
HAND:FLUSH
```
Pro: Compact, easy to parse
Con: Limited structure

**Option B: JSON (Most games)**
```json
{"outcome": "WIN", "payout": 200, "handRank": "FLUSH"}
```
Pro: Flexible, self-documenting
Con: Larger payload

**Recommendation:** Use JSON for complex games (Craps, UTH, Three Card), simple format for straightforward games.

---

## Migration Path

1. **Add logs to backend** - No frontend changes required
2. **Update frontend parsers** - Fix broken state blob parsers
3. **Consume logs in frontend** - Replace duplicate logic
4. **Remove duplicate code** - Clean up gameUtils.ts, hooks
5. **Add tests** - Verify frontend displays match backend outcomes

---

## Summary

| Game | Complexity | Log Format | Key Display Data |
|------|------------|------------|------------------|
| Blackjack | High | Multi-line | Per-hand outcomes, 21+3 |
| Baccarat | Medium | JSON | Winner, bet results |
| Craps | High | JSON | Dice, phase, multi-bet |
| Roulette | Medium | JSON | Result, bet outcomes |
| Sic Bo | Medium | JSON | Dice, bet outcomes |
| Three Card | Medium | JSON | Hand ranks, qualifications |
| Video Poker | Low | Simple | Hand rank, multiplier |
| HiLo | Low | JSON | Card, guess, streak |
| Casino War | Medium | JSON | Cards, war status |
| Ultimate Holdem | High | JSON | Hand ranks, 6 bet types |

**Total effort:** ~2-3 days backend, ~2-3 days frontend, ~1 day testing
