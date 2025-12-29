# End-to-End Integration Test Plan: On-Chain Parity

**Objective**: Verify 1:1 parity between the Rust on-chain program (source of truth) and both web/mobile frontends for all bet types, moves, and game flows.

**Scope**: All 10 casino games with every bet type and move opcode defined in `execution/src/casino/`.

---

## Test Environment Setup

### 1. Start Local Validator Network

```bash
# Generate configs if needed
cargo run --bin generate-keys -- --nodes 4 --output configs/local

# Set required environment variables
export ALLOW_HTTP_NO_ORIGIN=true
export ALLOWED_HTTP_ORIGINS="http://localhost:9010"
export ALLOW_WS_NO_ORIGIN=true
export ALLOWED_WS_ORIGINS="http://localhost:9010"

# Start full network (simulator + consensus nodes)
./scripts/start-local-network.sh --fresh

# Verify simulator health
curl -s http://localhost:8080/healthz
```

**Critical**: The network script must start BOTH simulator AND consensus nodes. The simulator alone accepts transactions but does not execute them.

### 2. Start Gateway

```bash
cd gateway
npm install
BACKEND_URL=http://localhost:8080 GATEWAY_PORT=9010 npm run dev
```

### 3. Start Web App

```bash
cd website
npm install
NEXT_PUBLIC_WS_URL=ws://localhost:9010 npm run dev
```

### 4. Start Mobile App (Expo)

```bash
cd mobile
npm install
EXPO_PUBLIC_WS_URL=ws://<host-ip>:9010 npm start
```

WebSocket URL by platform:
- iOS simulator: `ws://localhost:9010`
- Android emulator: `ws://10.0.2.2:9010`
- Physical device: `ws://<LAN-IP>:9010`

---

## On-Chain Game Specifications (Source of Truth)

All game logic, bet types, and move opcodes are defined in `execution/src/casino/`. The frontends MUST support all bet types defined here.

### 1. Blackjack (`blackjack.rs`)

**Move Opcodes** (`#[repr(u8)]`):
| Move | Opcode | Description |
|------|--------|-------------|
| Hit | 0 | Draw another card |
| Stand | 1 | End turn |
| Double | 2 | Double bet, draw one card |
| Split | 3 | Split pair into two hands |
| Deal | 4 | Start new hand |
| Set21Plus3 | 5 | Optional side bet (payload: `[5, amount:u64 BE]`) |
| Reveal | 6 | Reveal dealer hand |
| Surrender | 7 | Forfeit half bet |
| SetRules | 8 | Configure paytable |

**Side Bets**:
- 21+3: Combination of player's 2 cards + dealer upcard (flush, straight, three of a kind, etc.)

**Test Cases**:
- [ ] Deal with various bet amounts
- [ ] Hit until bust
- [ ] Stand on various totals
- [ ] Double on 9/10/11
- [ ] Split pairs (A-A, 8-8, etc.)
- [ ] Surrender on hard 16 vs dealer 10
- [ ] 21+3 side bet placement and payout
- [ ] Blackjack (natural 21) payout (3:2)
- [ ] Dealer bust scenarios

---

### 2. Roulette (`roulette.rs`)

**Move Opcodes** (`#[repr(u8)]`):
| Move | Opcode | Description |
|------|--------|-------------|
| PlaceBet | 0 | Place a bet (payload below) |
| Spin | 1 | Spin the wheel |
| ClearBets | 2 | Clear all placed bets |
| SetZeroRule | 3 | Configure zero rule (Standard/LaPartage/EnPrison/American) |
| AtomicBatch | 4 | Multiple bets + spin in one tx |

**Bet Types** (`#[repr(u8)]`):
| Bet Type | Code | Description | Payout |
|----------|------|-------------|--------|
| Straight | 0 | Single number | 35:1 |
| Red | 1 | 18 red numbers | 1:1 |
| Black | 2 | 18 black numbers | 1:1 |
| Even | 3 | Even numbers | 1:1 |
| Odd | 4 | Odd numbers | 1:1 |
| Low | 5 | 1-18 | 1:1 |
| High | 6 | 19-36 | 1:1 |
| Dozen | 7 | 1-12, 13-24, or 25-36 | 2:1 |
| Column | 8 | 1st, 2nd, or 3rd column | 2:1 |
| SplitH | 9 | Horizontal split (2 adjacent) | 17:1 |
| SplitV | 10 | Vertical split (2 adjacent) | 17:1 |
| Street | 11 | 3-number row | 11:1 |
| Corner | 12 | 4-number corner | 8:1 |
| SixLine | 13 | 6-number (2 rows) | 5:1 |

**Note**: There is NO Basket bet in this implementation. Total: 14 bet types (0-13).

**Payload Format**: `[0, bet_type:u8, number:u8, amount:u64 BE]`

**Test Cases**:
- [ ] Straight bet on each number 0-36
- [ ] Red bet (code 1)
- [ ] Black bet (code 2)
- [ ] Even bet (code 3)
- [ ] Odd bet (code 4)
- [ ] Low bet (code 5)
- [ ] High bet (code 6)
- [ ] Dozen bets (code 7) - 1-12, 13-24, 25-36
- [ ] Column bets (code 8) - 1st, 2nd, 3rd
- [ ] SplitH (code 9) - horizontal splits
- [ ] SplitV (code 10) - vertical splits
- [ ] Street bets (code 11) - all 12 streets
- [ ] Corner bets (code 12)
- [ ] SixLine bets (code 13)
- [ ] AtomicBatch with multiple bets
- [ ] ClearBets functionality
- [ ] SetZeroRule (Standard/LaPartage/EnPrison/EnPrisonDouble/American)

---

### 3. Craps (`craps.rs`)

**Move Opcodes** (`#[repr(u8)]`):
| Move | Opcode | Description |
|------|--------|-------------|
| PlaceBet | 0 | Place a bet |
| AddOdds | 1 | Add odds to Pass/Come |
| Roll | 2 | Roll the dice |
| ClearBets | 3 | Clear all bets |
| AtomicBatch | 4 | Multiple bets + roll in one tx |

**Bet Types** (`#[repr(u8)]`):
| Bet Type | Code | Target | Description |
|----------|------|--------|-------------|
| Pass | 0 | - | Pass line |
| DontPass | 1 | - | Don't Pass |
| Come | 2 | - | Come bet |
| DontCome | 3 | - | Don't Come |
| Field | 4 | - | Field (2,3,4,9,10,11,12) |
| Yes | 5 | 2-12 (except 7) | Place-style: target hits before 7 |
| No | 6 | 2-12 (except 7) | Lay-style: 7 hits before target |
| Next | 7 | 2-12 | Hop/Proposition: exact total on next roll |
| Hardway4 | 8 | - | 2+2 before 7 or easy 4 |
| Hardway6 | 9 | - | 3+3 before 7 or easy 6 |
| Hardway8 | 10 | - | 4+4 before 7 or easy 8 |
| Hardway10 | 11 | - | 5+5 before 7 or easy 10 |
| Fire | 12 | - | Fire bet (hot streak) |
| ~~Buy~~ | ~~13~~ | - | **(REMOVED)** |
| - | 14 | - | **(UNDEFINED)** |
| AtsSmall | 15 | - | All-Tall-Small: Small (2-6) |
| AtsTall | 16 | - | All-Tall-Small: Tall (8-12) |
| AtsAll | 17 | - | All-Tall-Small: All |
| Muggsy | 18 | - | Muggsy's Corner |
| DiffDoubles | 19 | - | Different Doubles |
| RideLine | 20 | - | Ride the Line |
| Replay | 21 | - | Replay |
| HotRoller | 22 | - | Hot Roller |

**Note**: Yes/No bets accept ANY target 2-12 except 7 (not just traditional place/lay numbers 4,5,6,8,9,10). This allows betting on unlikely totals like 2, 3, 11, 12.

**Payload Format**: `[0, bet_type:u8, target:u8, amount:u64 BE]`

**Atomic Batch Format**: `[4, bet_count:u8, [bet_type:u8, target:u8, amount:u64 BE]...]`

**Test Cases**:
- [ ] Pass line bet + establish point + roll outcomes
- [ ] Don't Pass bet + point scenarios
- [ ] Come bet after point established
- [ ] Don't Come bet
- [ ] Field bet (verify 2x on 2/12)
- [ ] Yes bets on traditional points: 4, 5, 6, 8, 9, 10
- [ ] Yes bets on extended targets: 2, 3, 11, 12 (non-traditional)
- [ ] No bets on traditional points: 4, 5, 6, 8, 9, 10
- [ ] No bets on extended targets: 2, 3, 11, 12 (non-traditional)
- [ ] Next (Hop) bets: all totals 2-12
- [ ] Hardway4 (bet type 8)
- [ ] Hardway6 (bet type 9)
- [ ] Hardway8 (bet type 10)
- [ ] Hardway10 (bet type 11)
- [ ] Fire bet (bet type 12)
- [ ] AtsSmall (bet type 15)
- [ ] AtsTall (bet type 16)
- [ ] AtsAll (bet type 17)
- [ ] Muggsy (bet type 18)
- [ ] DiffDoubles (bet type 19)
- [ ] RideLine (bet type 20)
- [ ] Replay (bet type 21)
- [ ] HotRoller (bet type 22)
- [ ] AddOdds to Pass/Come
- [ ] AtomicBatch with multiple bets
- [ ] Verify bet types 13-14 are rejected

---

### 4. Baccarat (`baccarat.rs`)

**Move Opcodes** (`#[repr(u8)]`):
| Move | Opcode | Description |
|------|--------|-------------|
| PlaceBet | 0 | Place a bet |
| Deal | 1 | Deal cards |
| ClearBets | 2 | Clear all bets |
| AtomicBatch | 3 | Multiple bets + deal in one tx |

**Note**: Baccarat has NO SetRules opcode.

**Bet Types** (`#[repr(u8)]`):
| Bet Type | Code | Payout |
|----------|------|--------|
| Player | 0 | 1:1 |
| Banker | 1 | 0.95:1 (5% commission) |
| Tie | 2 | 8:1 |
| PlayerPair | 3 | 11:1 |
| BankerPair | 4 | 11:1 |
| Lucky6 | 5 | 12:1 (2-card) / 23:1 (3-card) |
| PlayerDragon | 6 | Dragon Bonus (varies by margin) |
| BankerDragon | 7 | Dragon Bonus (varies by margin) |
| Panda8 | 8 | 25:1 |
| PlayerPerfectPair | 9 | 25:1 |
| BankerPerfectPair | 10 | 25:1 |

**Payload Format**: `[0, bet_type:u8, amount:u64 BE]`

**Atomic Batch Format**: `[3, bet_count:u8, [bet_type:u8, amount:u64 BE]...]`

**Test Cases**:
- [ ] Player bet + win/loss scenarios
- [ ] Banker bet + 5% commission verification
- [ ] Tie bet
- [ ] PlayerPair (verify matching rank+suit)
- [ ] BankerPair
- [ ] Lucky6 (2-card vs 3-card payout difference)
- [ ] PlayerDragon bonus payouts by margin (4-9 points)
- [ ] BankerDragon bonus payouts
- [ ] Panda8 (player natural 8 wins with 3 cards)
- [ ] PlayerPerfectPair (same rank AND suit)
- [ ] BankerPerfectPair
- [ ] AtomicBatch with multiple side bets

---

### 5. Sic Bo (`sic_bo.rs`)

**Move Opcodes** (`#[repr(u8)]`):
| Move | Opcode | Description |
|------|--------|-------------|
| PlaceBet | 0 | Place a bet |
| Roll | 1 | Roll three dice |
| ClearBets | 2 | Clear all bets |
| AtomicBatch | 3 | Multiple bets + roll in one tx |

**Note**: Sic Bo has NO SetRules opcode (paytable is set at session init via Macau/AtlanticCity variant).

**Bet Types** (`#[repr(u8)]`):
| Bet Type | Code | Target | Payout |
|----------|------|--------|--------|
| Small | 0 | - | 1:1 (4-10, excludes triples) |
| Big | 1 | - | 1:1 (11-17, excludes triples) |
| Odd | 2 | - | 1:1 |
| Even | 3 | - | 1:1 |
| SpecificTriple | 4 | 1-6 | 150:1 |
| AnyTriple | 5 | - | 24:1 |
| SpecificDouble | 6 | 1-6 | 8:1 |
| Total | 7 | 4-17 | Varies (6:1 to 50:1) |
| Single | 8 | 1-6 | 1:1/2:1/3:1 (appears 1x/2x/3x) |
| Domino | 9 | combo | 5:1 |
| ThreeNumberEasyHop | 10 | combo | 30:1 |
| ThreeNumberHardHop | 11 | combo | 50:1 |
| FourNumberEasyHop | 12 | combo | 7:1 |

**Payload Format**: `[0, bet_type:u8, target:u8, amount:u64 BE]`

**Total Bet Payouts**:
| Total | Payout |
|-------|--------|
| 4, 17 | 50:1 |
| 5, 16 | 18:1 |
| 6, 15 | 14:1 |
| 7, 14 | 12:1 |
| 8, 13 | 8:1 |
| 9, 12 | 6:1 |
| 10, 11 | 6:1 |

**Test Cases**:
- [ ] Small bet (verify excludes triples)
- [ ] Big bet (verify excludes triples)
- [ ] Odd/Even bets
- [ ] SpecificTriple (1-1-1 through 6-6-6)
- [ ] AnyTriple
- [ ] SpecificDouble (1-6)
- [ ] Total bets (4-17 with correct payouts)
- [ ] Single die bets (1-6) with 1x/2x/3x multiplier
- [ ] Domino (two-dice combination)
- [ ] ThreeNumberEasyHop (e.g., 1-2-3)
- [ ] ThreeNumberHardHop (e.g., 1-1-2)
- [ ] FourNumberEasyHop
- [ ] AtomicBatch with multiple bets

---

### 6. Three Card Poker (`three_card.rs`)

**Move Opcodes** (`#[repr(u8)]`):
| Move | Opcode | Description |
|------|--------|-------------|
| Play | 0 | Continue with hand |
| Fold | 1 | Forfeit ante |
| Deal | 2 | Deal cards (optional Pair Plus in payload) |
| SetPairPlus | 3 | Set Pair Plus bet |
| Reveal | 4 | Reveal dealer hand |
| SetSixCardBonus | 5 | Set 6-card bonus bet |
| SetProgressive | 6 | Set progressive jackpot bet |
| AtomicDeal | 7 | Ante + optional bets + deal in one tx |
| SetRules | 8 | Configure paytable |

**Betting Structure**:
- **Ante**: Required opening bet
- **Pair Plus**: Optional side bet on player hand strength
- **6-Card Bonus**: Optional side bet using all 6 cards
- **Progressive**: Optional progressive jackpot bet

**Deal Payload**: `[2, pair_plus_amount:u64 BE]` (optional)

**Test Cases**:
- [ ] Deal with ante only
- [ ] Deal with ante + Pair Plus
- [ ] Play (continue) decision
- [ ] Fold decision
- [ ] Dealer qualifies (Q-high or better)
- [ ] Dealer doesn't qualify (ante push, play returned)
- [ ] Pair Plus payouts: Pair (1:1), Flush (4:1), Straight (6:1), Three of a Kind (30:1), Straight Flush (40:1)
- [ ] Ante Bonus for premium hands

---

### 7. Ultimate Texas Hold'em (`ultimate_holdem.rs`)

**Move Opcodes** (`#[repr(u8)]`):
| Move | Opcode | Description |
|------|--------|-------------|
| Check | 0 | Check (pass without betting) |
| Bet4x | 1 | 4x ante bet (preflop only) |
| Bet2x | 2 | 2x ante bet (flop only) |
| Bet1x | 3 | 1x ante bet (river only) |
| Fold | 4 | Forfeit |
| Deal | 5 | Deal cards (optional Trips in payload) |
| SetTrips | 6 | Set Trips bet |
| Reveal | 7 | Reveal community cards |
| Bet3x | 8 | 3x ante bet (preflop only) |
| SetSixCardBonus | 9 | Set 6-card bonus bet |
| SetProgressive | 10 | Set progressive jackpot bet |
| AtomicDeal | 11 | Ante + Blind + optional bets + deal |
| SetRules | 12 | Configure paytable |

**Betting Structure**:
- **Ante**: Required opening bet
- **Blind**: Required (equal to ante)
- **Trips**: Optional side bet on player hand strength
- **Play Bet**: 4x (preflop), 3x (preflop), 2x (flop), or 1x (river)

**Game Flow**:
1. Ante + Blind placed
2. Deal: Player receives 2 cards
3. Preflop: Check or Bet 4x/3x
4. Flop (3 cards): Check or Bet 2x
5. River (2 cards): Bet 1x or Fold
6. Reveal: Compare hands

**Test Cases**:
- [ ] Deal with ante + blind
- [ ] Deal with ante + blind + Trips
- [ ] Bet 4x preflop with strong hand
- [ ] Bet 3x preflop
- [ ] Check preflop → Bet 2x on flop
- [ ] Check preflop → Check flop → Bet 1x on river
- [ ] Check → Check → Fold
- [ ] Dealer qualifies (pair or better)
- [ ] Dealer doesn't qualify (ante push)
- [ ] Blind bet payouts (straight or better)
- [ ] Trips bet payouts

---

### 8. Hi-Lo (`hilo.rs`)

**Move Opcodes** (`#[repr(u8)]`):
| Move | Opcode | Description |
|------|--------|-------------|
| Higher | 0 | Guess next card is higher |
| Lower | 1 | Guess next card is lower |
| Cashout | 2 | Take winnings and exit |
| Same | 3 | Guess next card is same value |

**Game Flow**:
1. Place initial bet
2. First card dealt
3. Guess: Higher, Lower, or Same
4. Correct: Winnings multiply, continue or Cashout
5. Incorrect: Lose bet

**Test Cases**:
- [ ] Higher guess - correct
- [ ] Higher guess - incorrect
- [ ] Lower guess - correct
- [ ] Lower guess - incorrect
- [ ] Same guess - correct (high payout)
- [ ] Same guess - incorrect
- [ ] Cashout after multiple correct guesses
- [ ] Multiplier accumulation verification

---

### 9. Casino War (`casino_war.rs`)

**Move Opcodes** (`#[repr(u8)]`):
| Move | Opcode | Description |
|------|--------|-------------|
| Play | 0 | Initial deal/play |
| War | 1 | Go to war on tie |
| Surrender | 2 | Surrender on tie (lose half) |
| SetTieBet | 3 | Set tie side bet |
| SetRules | 5 | Configure paytable |

**Game Flow**:
1. Player and dealer each get one card
2. Higher card wins (1:1)
3. On tie: Go to War or Surrender
4. War: Player doubles bet, 3 cards burned, new cards dealt

**Test Cases**:
- [ ] Player wins (higher card)
- [ ] Dealer wins (higher card)
- [ ] Tie → Go to War → Player wins
- [ ] Tie → Go to War → Dealer wins
- [ ] Tie → Surrender (lose half bet)
- [ ] Tie side bet placement and payout

---

### 10. Video Poker (`video_poker.rs`)

**Move Opcodes**:
| Move | Payload | Description |
|------|---------|-------------|
| Hold/Draw | `[holdMask:u8]` | Bits 0-4 indicate which cards to hold |
| SetRules | `[0xFF, rules:u8]` | Configure paytable variant |

**Hold Mask**:
- Bit 0 (1): Hold card 1
- Bit 1 (2): Hold card 2
- Bit 2 (4): Hold card 3
- Bit 3 (8): Hold card 4
- Bit 4 (16): Hold card 5
- Example: `0b11001` (25) = Hold cards 1, 4, 5

**Hand Rankings (Jacks or Better)**:
| Hand | Payout |
|------|--------|
| Royal Flush | 800:1 |
| Straight Flush | 50:1 |
| Four of a Kind | 25:1 |
| Full House | 9:1 |
| Flush | 6:1 |
| Straight | 4:1 |
| Three of a Kind | 3:1 |
| Two Pair | 2:1 |
| Jacks or Better | 1:1 |

**Test Cases**:
- [ ] Hold all 5 cards
- [ ] Hold none (draw 5 new)
- [ ] Hold specific combinations (pair, three of a kind)
- [ ] Verify all winning hand payouts
- [ ] Verify non-winning hands (no payout)

---

## Integration Test Matrix

### Test Execution Checklist

For each game, verify on **both Web and Mobile**:

| Game | Web | Mobile | Notes |
|------|-----|--------|-------|
| **Blackjack** | | | |
| - All moves (Hit/Stand/Double/Split/Surrender) | [ ] | [ ] | |
| - 21+3 side bet | [ ] | [ ] | |
| - Blackjack (3:2) payout | [ ] | [ ] | |
| **Roulette** | | | |
| - All 14 bet types (codes 0-13) | [ ] | [ ] | No Basket bet |
| - SplitH (9) and SplitV (10) separately | [ ] | [ ] | Horizontal vs vertical splits |
| - AtomicBatch multi-bet | [ ] | [ ] | |
| - ClearBets | [ ] | [ ] | |
| **Craps** | | | |
| - All 21 bet types (codes 0-12, 15-22) | [ ] | [ ] | Codes 13-14 removed/undefined |
| - Yes/No with extended targets (2,3,11,12) | [ ] | [ ] | Non-traditional targets |
| - AddOdds | [ ] | [ ] | |
| - AtomicBatch | [ ] | [ ] | |
| **Baccarat** | | | |
| - All 11 bet types | [ ] | [ ] | |
| - AtomicBatch | [ ] | [ ] | |
| - Banker commission (5%) | [ ] | [ ] | |
| **Sic Bo** | | | |
| - All 13 bet types | [ ] | [ ] | |
| - Total bet payouts | [ ] | [ ] | |
| - AtomicBatch | [ ] | [ ] | |
| **Three Card Poker** | | | |
| - Ante/Play/Fold flow | [ ] | [ ] | |
| - Pair Plus side bet | [ ] | [ ] | |
| - Dealer qualification | [ ] | [ ] | |
| **Ultimate Hold'em** | | | |
| - All bet multipliers (1x/2x/3x/4x) | [ ] | [ ] | |
| - Trips side bet | [ ] | [ ] | |
| - Stage transitions | [ ] | [ ] | |
| **Hi-Lo** | | | |
| - Higher/Lower/Same | [ ] | [ ] | |
| - Cashout | [ ] | [ ] | |
| - Multiplier accumulation | [ ] | [ ] | |
| **Casino War** | | | |
| - War/Surrender on tie | [ ] | [ ] | |
| - Tie side bet | [ ] | [ ] | |
| **Video Poker** | | | |
| - All hold mask combinations | [ ] | [ ] | |
| - All winning hand payouts | [ ] | [ ] | |

---

## Parity Verification Protocol

### 1. Payload Encoding Verification

For each bet type, verify the frontend encodes the binary payload exactly as the Rust program expects:

```
Expected: [opcode:u8, bet_type:u8, target:u8, amount:u64 BE/LE]
Actual:   <capture from gateway logs>
```

### 2. State Transition Verification

Compare game state after each move:
- Current stage/phase
- Player balance
- Active bets
- Cards dealt (if applicable)
- Result/payout

### 3. Payout Calculation Verification

For each winning bet, verify:
- Payout ratio matches on-chain paytable
- Commission applied correctly (Baccarat banker)
- Side bet payouts match

### 4. Error Handling Verification

Verify frontends correctly handle:
- Invalid bet amounts (negative, zero, exceeds balance)
- Invalid bet types
- Out-of-sequence moves
- Network/timeout errors

---

## Troubleshooting

### HTTP 403 errors from simulator
**Symptom:** `curl http://localhost:8080/healthz` returns 403
**Cause:** Missing HTTP origin configuration
**Fix:** Export `ALLOW_HTTP_NO_ORIGIN=true` and `ALLOWED_HTTP_ORIGINS="http://localhost:9010"`

### WebSocket connection rejected (403)
**Symptom:** Gateway logs show `WebSocket origin rejected`
**Cause:** Missing WebSocket origin configuration
**Fix:** Export `ALLOW_WS_NO_ORIGIN=true` and `ALLOWED_WS_ORIGINS="http://localhost:9010"`

### Timeout waiting for game events
**Symptom:** Tests connect but timeout on events
**Cause:** Only simulator running (no consensus nodes)
**Fix:** Use `./scripts/start-local-network.sh` (not simulator alone)

### Quick Start (All Environment Variables)

```bash
export ALLOW_HTTP_NO_ORIGIN=true
export ALLOWED_HTTP_ORIGINS="http://localhost:9010"
export ALLOW_WS_NO_ORIGIN=true
export ALLOWED_WS_ORIGINS="http://localhost:9010"
./scripts/start-local-network.sh --fresh
```

---

## Approval Required

**This document describes the integration test plan. No tests will be executed until explicit sign-off is received.**

Test execution will:
1. Start local validator network
2. Connect web and mobile apps
3. Execute each test case in the matrix
4. Record results and any discrepancies
5. Generate parity report

**Awaiting approval to proceed with test execution.**
