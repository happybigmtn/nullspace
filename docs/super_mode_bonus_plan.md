# Super Mode Bonus Game Implementation Plan

## Executive Summary

This document specifies the enhanced "Super Mode" bonus variants for all 10 casino games, implementing a **20% fee-funded multiplier system** targeting **98-99% RTP** (1-2% house edge). The design synthesizes three expert analyses to maximize psychological engagement while maintaining mathematical sustainability.

---

## Core Design Pattern

### Economic Model
- **Fee Structure**: 20% of bet (player bets B, pays total 1.2B)
- **Target RTP**: 98-99% on total wagered amount
- **Budget Allocation**:
  - ~18% returned as bonus EV (multiplier payouts)
  - ~1-2% house margin
  - Base game mechanics unchanged

### Flow Per Game
1. Player enables Super Mode (pays 20% fee)
2. Pre-round: System generates "Aura" elements (cards/numbers/suits) with multipliers
3. Round plays normally with base game rules
4. If winning outcome intersects Aura elements → multiplied payout
5. Near-misses charge "Aura Meter" for future enhanced rounds

---

## File Locations

### Backend (Rust)
- `execution/src/casino/super_mode.rs` - Multiplier generation (EXISTS - needs refinement)
- `execution/src/casino/mod.rs` - Fee calculation and dispatch (EXISTS)
- `types/src/casino.rs` - SuperMultiplier, SuperModeState types (EXISTS)

### Frontend (TypeScript)
- `website/src/hooks/useTerminalGame.ts` - Game state management
- `website/src/services/CasinoChainService.ts` - Chain integration
- `website/src/components/casino/` - UI components

---

## Game-by-Game Specifications

### 1. Super Lightning Baccarat

**Concept**: Enhanced Lightning Baccarat with Aura Cards and compounding multipliers.

**Multiplier Generation** (refine `generate_baccarat_multipliers`):
```rust
// Select 3-5 Aura Cards with weighted multipliers
// Distribution: 35% 2x, 30% 3x, 20% 4x, 10% 5x, 5% 8x
// Expected multiplier per card: 3.1x
```

| Aura Cards | Probability | Multiplier Distribution |
|------------|-------------|------------------------|
| 3 cards    | 60%         | Standard distribution  |
| 4 cards    | 30%         | Standard distribution  |
| 5 cards    | 10%         | Standard distribution  |

**Hit Frequency Analysis**:
- Probability any dealt card is Aura: 5/52 = 9.62%
- Average cards per hand: 4-5
- Expected Aura Cards hitting: ~0.48 per hand
- Two+ Aura Cards (for stacking): ~8% of hands

**Multiplier Values**:
| Value | Probability | Notes |
|-------|-------------|-------|
| 2x    | 35%         | Base excitement |
| 3x    | 30%         | Common mid-tier |
| 4x    | 20%         | Notable hits |
| 5x    | 10%         | Significant |
| 8x    | 5%          | Premium |

**Max Multiplier**: 8^5 = 32,768x (capped at 512x for sustainability)

**RTP Calculation**:
- Base Baccarat RTP: 98.76% (Player bet)
- Effective base on 1.2B total: 82.30%
- Multiplier contribution: ~16.2%
- **Final RTP: ~98.5%** (1.5% house edge)

**UX Requirements**:
1. Pre-deal: Lightning animation strikes 3-5 cards sequentially (0.3s each)
2. Cards glow when dealt if they're Aura Cards
3. On win with Aura: Explosion effect, multiplier counter animation
4. Near-miss (Aura in losing hand): Brief flash + meter increment

---

### 2. Super Strike Blackjack

**Concept**: Strike Cards in shoe that multiply winning hand payouts.

**Multiplier Generation** (refine `generate_blackjack_multipliers`):
```rust
// Select 5 Strike Cards (specific rank+suit)
// Distribution: 40% 2x, 30% 3x, 20% 5x, 7% 7x, 3% 10x
```

| Value | Probability | Notes |
|-------|-------------|-------|
| 2x    | 40%         | Common |
| 3x    | 30%         | Regular |
| 5x    | 20%         | Significant |
| 7x    | 7%          | Notable |
| 10x   | 3%          | Premium |

**Special Rules**:
- Player Blackjack: Guaranteed minimum 2x multiplier
- If Blackjack contains Strike Card: Stack multipliers (2x × Strike)
- Maximum: 10x × 10x × 2x = 200x

**Hit Frequency**:
- 5 Strike Cards from 312-card shoe (6 decks): 5/312 = 1.6% per position
- Average player cards: 2.7
- At least one Strike Card in winning hand: ~12.5%

**RTP Calculation**:
- Base Blackjack RTP: 99.5%
- Effective on 1.2B: 82.92%
- Strike contribution: ~8.75%
- Blackjack bonus: ~4.83% × 1.5 × 1.0 = 7.25%
- **Final RTP: ~98.2%** (1.8% house edge)

**UX Requirements**:
1. Strike Cards revealed before deal with electric effect
2. Cards spark when dealt if Strike
3. Blackjack with Strike: Double celebration (BJ fanfare + Strike explosion)
4. Progressive Strike Counter showing remaining in shoe section

---

### 3. Super Thunder Craps

**Concept**: Thunder Numbers on point values with multiplied Pass Line payouts.

**Multiplier Generation** (refine `generate_craps_multipliers`):
```rust
// Select 3 Thunder Numbers from [4,5,6,8,9,10]
// Multiplier based on point difficulty + 5% chance of 25x
```

| Point   | Base Multiplier | 25x Chance |
|---------|-----------------|------------|
| 6 or 8  | 3x              | 5%         |
| 5 or 9  | 5x              | 5%         |
| 4 or 10 | 10x             | 5%         |

**Hit Frequency**:
- Point established: 66.67%
- Thunder Number is point: 50% (3 of 6 points)
- Point made (weighted): ~40.4%
- Combined Thunder win: ~13.47%

**Special Feature - Thunder Odds**:
- Free odds bets on Thunder Numbers receive automatic 2x
- Odds bets have 0% house edge - pure multiplier bonus

**RTP Calculation**:
- Base Pass Line RTP: 98.59%
- Thunder multiplier contribution: ~5.84%
- Thunder Odds: ~8% additional when odds taken
- Lightning Come-Out bonus: ~4.17%
- **Final RTP: ~99.0%** (1.0% house edge)

**UX Requirements**:
1. Thunder animation across felt before come-out
2. Three point numbers struck by lightning with multiplier reveal
3. Thunder Number glows when established as point
4. Each roll builds tension if point is Thunder
5. Point made: Thunder crash celebration

---

### 4. Super Blitz Ultimate Texas Hold'em

**Concept**: Blitz Cards (2 ranks) that multiply winning hands.

**Multiplier Generation** (refine `generate_uth_multipliers`):
```rust
// Select 2 Blitz ranks (any suit matches)
// 8 specific cards from 52 = 15.38% per card position
```

**Multiplier Matrix** (hand strength based):
| Hand with Blitz | Multiplier |
|-----------------|-----------|
| Pair            | 2x        |
| Two Pair        | 3x        |
| Three of a Kind | 5x        |
| Straight        | 4x        |
| Flush           | 4x        |
| Full House      | 6x        |
| Four of a Kind  | 15x       |
| Straight Flush  | 25x       |
| Royal Flush     | 50x       |

**Special Features**:
- **Blitz Bonus**: Both hole cards are Blitz + win = automatic 5x
- **Community Blitz**: 3+ Blitz Cards in community = all players 2x minimum

**Hit Frequency**:
- Blitz Card in 7 cards: ~63%
- Blitz in final 5-card hand: ~45%
- Blitz in winning pair+: ~18%

**RTP Calculation**:
- Base UTH RTP: 97.81%
- Blitz contribution: ~2.67%
- Trips bonus enhancement: ~3.42%
- **Final RTP: ~98.5%** (1.5% house edge)

**UX Requirements**:
1. Blitz ranks highlighted on virtual card display
2. Community cards reveal with Blitz check animation
3. Hand evaluation shows Blitz bonus calculation
4. "Blitz Bonus" banner for double hole card hits

---

### 5. Super Flash Three Card Poker

**Concept**: Flash Suits (2 suits) that multiply hands with matching cards.

**Multiplier Generation** (refine `generate_three_card_multipliers`):
```rust
// Select 2 Flash Suits
// 26 cards (half deck) eligible for Flash bonus
```

| Flash Configuration | Multiplier |
|--------------------|-----------|
| 2 cards same Flash Suit | 2x |
| 3 cards same Flash Suit (Flush) | 5x |
| Flash Suit Straight | 4x |
| Flash Suit Straight Flush | 25x |

**Hit Frequency**:
- 2+ cards in same Flash Suit: ~29%
- Flash Flush: ~2.5%
- Flash Straight Flush: ~0.11%

**RTP Calculation**:
- Base 3CP RTP: 97.99%
- Flash contributions: ~12%
- Pair Plus Flash bonus: ~5%
- **Final RTP: ~98.7%** (1.3% house edge)

**UX Requirements**:
1. Flash Suits announced with suit icons glowing
2. Dealt cards highlight if matching Flash Suit
3. Flush in Flash Suit: Rainbow explosion effect
4. Straight Flush: Full-screen lightning celebration

---

### 6. Super Quantum Roulette

**Concept**: Evolution-style Lightning Roulette with sector bonuses.

**Multiplier Generation** (refine `generate_roulette_multipliers`):
```rust
// 5-7 Quantum Numbers with multipliers
// Distribution: 35% 50x, 30% 100x, 18% 200x, 10% 300x, 5% 400x, 2% 500x
```

| Value | Probability |
|-------|-------------|
| 50x   | 35%         |
| 100x  | 30%         |
| 200x  | 18%         |
| 300x  | 10%         |
| 400x  | 5%          |
| 500x  | 2%          |

**Base Payout Adjustment**:
- Straight-up: 29:1 (reduced from 35:1)
- Non-multiplied RTP: 78.38%

**Sector Bonus** (NEW):
- If ball lands in sector with 3+ Quantum Numbers, adjacent numbers receive 2x

**RTP Calculation**:
- Non-multiplied straight-up: 65.32% (on 1.2B)
- Multiplier contribution: ~35.20%
- Sector bonus: ~1-2%
- **Final RTP: ~97.3%** (2.7% house edge - matches Lightning Roulette)

**UX Requirements**:
1. Quantum Numbers struck with lightning before spin
2. Wheel shows glowing numbers
3. Slow-motion ball drop near Quantum Numbers
4. Sector highlight when multiple Quantums in range
5. Win celebration scaled to multiplier (bigger for 500x)

---

### 7. Super Strike Casino War

**Concept**: Strike Ranks that multiply winning outcomes.

**Multiplier Generation** (refine `generate_casino_war_multipliers`):
```rust
// Select 3 Strike Ranks (any suit)
// 24 cards per rank in 6-deck shoe
```

| Scenario | Multiplier |
|----------|-----------|
| Your card is Strike Rank, win | 2x |
| Both cards Strike Rank, win war | 3x |
| Both cards same Strike Rank (tie), win war | 5x |

**Hit Frequency**:
- Your card is Strike: 3/13 = 23.08%
- Both cards Strike: 5.33%
- Strike Rank tie: 0.39%

**War Bonus Wheel** (NEW):
- When going to war, spin bonus wheel (10% chance)
- Wheel: 2x-5x boost (average 2.5x)

**RTP Calculation**:
- Base War RTP: 97.12%
- Strike contributions: ~14.02%
- War Bonus Wheel: ~0.93%
- **Final RTP: ~98.0%** (2.0% house edge)

**UX Requirements**:
1. Strike Ranks announced with rank symbols glowing
2. Card flip reveals Strike status immediately
3. War sequence: Bonus wheel appears before burn card
4. Progressive war wins: 2x → 4x → 8x multiplier ladder

---

### 8. Super Mega Video Poker

**Concept**: Mega Cards in deck that multiply winning hands.

**Multiplier Generation** (refine `generate_video_poker_multipliers`):
```rust
// Select 4 Mega Cards (specific rank+suit)
// Revealed BEFORE draw decision (influences strategy)
```

| Mega Cards in Final Hand | Multiplier |
|--------------------------|-----------|
| 1 Mega Card              | 1.5x      |
| 2 Mega Cards             | 3x        |
| 3 Mega Cards             | 10x       |
| 4 Mega Cards             | 100x      |
| Mega Card in Royal       | 1000x     |

**Hit Frequency**:
- At least 1 Mega in 5-card hand: ~35%
- 2+ Mega Cards: ~4.5%
- Mega in Royal: Virtually negligible but aspirational

**Mega Hold Feature** (NEW):
- If dealt 3+ Mega Cards, can "hold" for guaranteed 2x minimum

**RTP Calculation**:
- Base JoB RTP: 99.54%
- Mega contributions: ~11.07%
- Mega Hold bonus: ~4%
- **Final RTP: ~98.0%** (2.0% house edge)

**UX Requirements**:
1. Mega Cards revealed on deal with glow effect
2. Strategy hint: "Mega Card - consider keeping!"
3. Draw animation highlights if Mega Card drawn
4. Mega Royal: Full-screen jackpot celebration
5. Visible Mega Card counter for deck section

---

### 9. Super Fortune Sic Bo

**Concept**: Fortune Totals with multipliers based on probability.

**Multiplier Generation** (refine `generate_sic_bo_multipliers`):
```rust
// Select 3 Fortune Totals from 4-17
// Multiplier based on total probability
```

| Fortune Total Type | Multiplier Range |
|-------------------|-----------------|
| 10-11 (most common) | 3x-5x |
| 7-8, 13-14 (medium) | 5x-10x |
| 4-6, 15-17 (rare) | 10x-50x |

**Fortune Wheel** (on any triple):
- Appears when triple is rolled
- Multiplies existing triple payout (30:1) by 2x-5x

**Big/Small Enhancement**:
- Fortune overlay applies to Big/Small when adjacent total hits

**RTP Calculation**:
- Base Sic Bo RTP: ~88%
- Fortune contributions: ~8.75%
- Fortune Wheel: ~10.42%
- Big/Small bonus: ~1%
- **Final RTP: ~98.0%** (2.0% house edge)

**UX Requirements**:
1. Fortune Totals struck with lightning on table layout
2. Dice tumble animation with Fortune check
3. Triple: Fortune Wheel spins with dramatic music
4. Total matches Fortune: Number explodes with multiplier
5. Near-miss (adjacent total): Flash effect + meter fill

---

### 10. Super Streak Hi-Lo

**Concept**: Progressive streak multipliers with Ace bonus.

**Streak Multiplier Table** (update `generate_hilo_state`):
| Correct Calls | Multiplier | Probability from Start |
|---------------|-----------|----------------------|
| 1             | 1.5x      | ~50%                 |
| 2             | 2.5x      | ~25%                 |
| 3             | 4x        | ~12.5%               |
| 4             | 7x        | ~6.25%               |
| 5             | 12x       | ~3.13%               |
| 6             | 20x       | ~1.56%               |
| 7             | 35x       | ~0.78%               |
| 8             | 60x       | ~0.39%               |
| 9             | 100x      | ~0.20%               |
| 10+           | 200x      | ~0.10%               |

**Ace Bonus**:
- Correct call on Ace (hardest): 3x multiplier boost
- Ace appearance: 1/13 = 7.69%
- Correct call on Ace: ~92%

**Special Features**:
- **Skip Card**: Once per streak, skip a card (costs 1 multiplier tier)
- **Insurance**: Pay extra 10% fee to protect one wrong call

**RTP Calculation**:
- Base Hi-Lo RTP: ~98%
- Streak multiplier contribution: ~22%
- Ace bonus: ~5%
- **Final RTP: ~98.5%** (1.5% house edge)

**UX Requirements**:
1. Ladder visualization showing current position and potential
2. Card flip with slow-motion for tension
3. Streak counter with celebratory effects on advancement
4. Ace appearance: Special golden card effect
5. Cash-out prompt at each tier showing current/potential winnings
6. Streak leaderboard: Daily/weekly competition

---

## Aura Meter System (Cross-Game Feature)

### Purpose
Convert near-miss frustration into future excitement by tracking "close calls."

### Mechanics
1. Each player has 5-segment Aura Meter (stored in `Player` struct)
2. Meter increments when:
   - Player paid Super Mode fee
   - Player lost the round
   - BUT at least one Aura element appeared (cards, numbers, etc.)
3. At 5/5, next round becomes "Super Aura Round":
   - Enhanced distribution (multiply all base multipliers by 1.5x)
   - Guaranteed at least one Aura element in player's outcome area
4. After Super Aura Round, meter resets

### Implementation
```rust
// In types/src/casino.rs
pub struct Player {
    // ... existing fields
    pub aura_meter: u8,  // 0-5
}

// In execution/src/casino/mod.rs
pub fn update_aura_meter(player: &mut Player, had_aura_element: bool, won: bool) {
    if had_aura_element && !won {
        player.aura_meter = (player.aura_meter + 1).min(5);
    }
}

pub fn is_super_aura_round(player: &Player) -> bool {
    player.aura_meter >= 5
}
```

---

## Animation & UX Guidelines

### Timing Delays (Critical for Excitement)

| Event | Delay | Purpose |
|-------|-------|---------|
| Aura element selection | 0.3s per element | Build anticipation |
| Card/number reveal | 0.5s | Suspense |
| Multiplier display | 0.8s | Let it sink in |
| Win celebration | 1.5-3s (scaled) | Savoring moment |
| Near-miss acknowledgment | 0.5s | Brief validation |

### Visual Effects Priority
1. **Lightning/Electric** - Quantum/Lightning games
2. **Golden Glow** - Aura/Streak games
3. **Fire/Explosion** - Big wins (10x+)
4. **Shimmer/Pulse** - Near-miss elements

### Sound Design
| Event | Sound Type |
|-------|------------|
| Aura selection | Rising electrical crackle |
| Element match | Satisfying "ding" |
| Multiplier reveal | Escalating whoosh |
| Big win | Fanfare + coins |
| Near-miss | Brief "almost" sting |
| Streak advance | Level-up chime |
| Aura Meter fill | Charge-up sound |
| Super Aura Round | Epic intro |

### Near-Miss Highlights
- Aura element in losing hand: Brief flash (0.2s) + subtle sound
- One number away from Quantum: Wheel slow-down near it
- Almost-streak (failed on last card): Sympathetic animation
- Adjacent Fortune Total: Flash on missed total

---

## Implementation Priority

### Phase 1: Core Multiplier Refinement
1. Update `super_mode.rs` multiplier distributions per spec
2. Add Aura Meter to Player struct
3. Implement `is_super_aura_round()` logic
4. Write unit tests for all probability distributions

### Phase 2: Game Integration
1. Update each game's payout calculation to apply multipliers
2. Integrate near-miss detection per game type
3. Add Super Aura Round enhanced generation
4. Integration tests for RTP validation

### Phase 3: Frontend Implementation
1. Aura element reveal animations
2. Near-miss visual feedback
3. Aura Meter UI component
4. Win celebration effects (scaled by multiplier)
5. Super Aura Round special intro

### Phase 4: Testing & Tuning
1. Monte Carlo simulation for RTP verification
2. Play-testing for excitement factor
3. Adjust multiplier distributions if needed
4. Performance optimization

---

## RTP Verification Checklist

For each game, verify:
- [ ] Fee correctly deducted (20%)
- [ ] Base game RTP unchanged
- [ ] Multiplier EV equals ~18% of fee
- [ ] Edge cases handled (max multiplier cap)
- [ ] Near-miss detection accurate
- [ ] Aura Meter increments correctly
- [ ] Super Aura Round triggers at 5/5

---

## Summary Table

| Game | Base RTP | Super Mode RTP | Hit Frequency | Max Multiplier |
|------|----------|----------------|---------------|----------------|
| Baccarat | 98.76% | 98.5% | ~48% | 512x |
| Blackjack | 99.50% | 98.2% | ~13% | 200x |
| Craps | 98.59% | 99.0% | ~15% | 25x |
| Ultimate Hold'em | 97.81% | 98.5% | ~18% | 50x |
| Three Card Poker | 97.99% | 98.7% | ~29% | 25x |
| Roulette | 97.30% | 97.3% | ~16% | 500x |
| Casino War | 97.12% | 98.0% | ~23% | 10x |
| Video Poker | 99.54% | 98.0% | ~35% | 1000x |
| Sic Bo | 97.22% | 98.0% | ~21% | 50x |
| Hi-Lo | 98.00% | 98.5% | streak-based | 200x |
