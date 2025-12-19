# Frontend Standardization Plan

## Overview

Standardize all 9 casino games to follow the chain-authoritative design pattern and consistent layout established in CrapsView.

## Core Patterns to Apply

### 1. Chain-Authoritative State
- All bets have `local?: boolean` field to track pending vs confirmed
- PnL calculated by comparing chain state snapshots before/after game actions
- Win notifications only from authoritative `CasinoGameCompleted` events
- Pending additions (like odds) tracked separately until confirmed

### 2. UI Layout Standards
- **Left Sidebar**: Toggle between EXPOSURE and SIDE_BETS/BONUS views
- **Right Sidebar**: Split between CONFIRMED and PENDING bets
- **Bottom Controls**: Group into Normal bets vs Bonus/Side bets
- **Consistent styling**: Terminal theme, monospace, 2px borders

### 3. Shared Components to Extract

```
src/components/casino/shared/
├── GameLayout.tsx           # Main 3-column layout wrapper
├── ExposureSidebar.tsx      # Left sidebar with toggle
├── BetsSidebar.tsx          # Right sidebar with confirmed/pending split
├── BetItem.tsx              # Single bet display component
├── SideBetProgress.tsx      # Bonus bet progress indicators
└── ChipSelector.tsx         # Unified chip selector (already exists as MobileChipSelector)
```

## Game-Specific Changes

### Phase 1: Type Updates (types.ts)

Add `local?: boolean` field to all bet types:
- [x] CrapsBet - already has `local` field
- [ ] RouletteBet - add `local?: boolean`
- [ ] SicBoBet - add `local?: boolean`
- [ ] BaccaratBet - add `local?: boolean`

### Phase 2: Shared Components

1. **GameLayout.tsx** - Wrapper providing consistent 3-column structure
   - Props: leftSidebar, centerContent, rightSidebar, bottomControls
   - Handles responsive layout (mobile drawer vs desktop sidebars)

2. **BetsSidebar.tsx** - Right panel
   - Split view: CONFIRMED section (chain bets) / PENDING section (local bets)
   - Generic bet rendering via render prop or slot

3. **ExposureSidebar.tsx** - Left panel
   - Toggle between EXPOSURE and SIDE_BETS views
   - Content passed via props

4. **BetItem.tsx** - Unified bet row component
   - Shows bet type, target, amount
   - Visual distinction for pending (dashed border, opacity)
   - Click to add more

### Phase 3: Game View Updates

#### Baccarat
- Side bets: TIE, P_PAIR, B_PAIR, LUCKY6, P_DRAGON, B_DRAGON, PANDA8, P_PERFECT_PAIR, B_PERFECT_PAIR
- Group controls: Normal (PLAYER/BANKER) | Bonus (side bets)
- Left sidebar: Exposure view (win probability per outcome)
- Add pending bet tracking for staged bets

#### Roulette
- Already has exposure sidebar
- Add pending/confirmed split to bets sidebar
- Group controls: Outside bets | Inside bets
- Track local staged bets before spin

#### Sic Bo
- Already has exposure sidebar (Totals + Combos)
- Add pending/confirmed split to bets sidebar
- Group controls: Basic (BIG/SMALL/ODD/EVEN) | Specific (DIE/DOUBLE/TRIPLE) | Advanced (DOMINO/HOP)
- Track local staged bets before roll

#### Blackjack
- Bonus bets: 21+3, Insurance
- No exposure sidebar needed (deterministic)
- Right sidebar: Current hand, side bets
- Handle split hands in bets display

#### Three Card Poker
- Bonus bets: Pair Plus, 6-Card Bonus, Progressive
- Left sidebar: Hand rankings reference or Progressive jackpot tracker
- Group controls: Normal (Ante/Play) | Bonus (Pair+, 6-Card, Progressive)

#### Ultimate Texas Hold'em
- Bonus bets: Trips, 6-Card Bonus, Progressive
- Left sidebar: Hand rankings or jackpot tracker
- Group controls: Normal (Ante/Blind/Play) | Bonus (Trips, 6-Card, Progressive)

#### Video Poker
- No side bets currently
- Left sidebar: Pay table reference
- Simpler layout - mainly hold/draw controls

#### Hi-Lo
- No side bets
- Simple layout with accumulator graph
- No sidebar changes needed

#### Casino War
- Bonus bet: Tie bet
- Simple layout
- Group: Normal (War) | Bonus (Tie)

### Phase 4: Hook Updates

Update game hooks to properly track local vs confirmed state:
- useBaccarat.ts - add local bet staging
- useRoulette.ts - track pending bets
- useSicBo.ts - track pending bets

Already done:
- useCraps.ts - has localOddsAmount pattern

## Implementation Order

1. **Extract shared components** (1 agent)
   - Create GameLayout, BetsSidebar, ExposureSidebar, BetItem
   - Refactor CrapsView to use them (validates components work)

2. **Update types.ts** (quick change)
   - Add `local?: boolean` to RouletteBet, SicBoBet, BaccaratBet

3. **Update multi-bet games in parallel** (3 agents)
   - Agent A: Roulette (already has good exposure sidebar)
   - Agent B: Sic Bo (similar to craps)
   - Agent C: Baccarat (add exposure, split bets)

4. **Update poker games in parallel** (2 agents)
   - Agent D: ThreeCardPoker + UltimateHoldem (similar patterns)
   - Agent E: VideoPoker + Blackjack (simpler changes)

5. **Update simple games** (1 agent)
   - HiLo, CasinoWar - minimal changes needed

## Keyboard Shortcuts Standard

All games should support two-letter shortcuts where applicable:
- First letter: Category (n=Normal, b=Bonus, m=Modern if applicable)
- Second letter: Specific bet

Examples from Craps: `np` (normal pass), `bf` (bonus fire)
Apply similar patterns to other games.

## Success Criteria

- [ ] All games use shared layout components
- [ ] All bet types have `local` field
- [ ] All bets sidebars show confirmed vs pending
- [ ] Left sidebars have toggle where applicable
- [ ] Bet controls grouped into Normal/Bonus categories
- [ ] PnL calculated from chain state snapshots
- [ ] Win notifications only from authoritative events
- [ ] Consistent visual styling across all games
