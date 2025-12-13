# Casino Games Review vs Wizard of Odds (WoO)

This document reviews the casino games implemented in `execution/src/casino/` against Wizard of Odds rules, records WoO-alignment decisions, and tracks remaining parity gaps.

Unless stated otherwise, comparisons below assume:
- **Super mode disabled** (`session.super_mode.is_active = false`) — super multipliers are out-of-scope for WoO parity.
- **Card shoes:** Baccarat/Blackjack/Casino War use multi-deck shoes (cards still encoded `0..51`, duplicates represent multiple decks); other card games use a single deck.

WoO reference pages (primary):
- Baccarat basics: https://wizardofodds.com/games/baccarat/basics/
- Baccarat side bets: https://wizardofodds.com/games/baccarat/side-bets/
- Blackjack basics: https://wizardofodds.com/games/blackjack/basics/
- Blackjack side bets index: https://wizardofodds.com/games/blackjack/side-bets/
- Casino War: https://wizardofodds.com/games/casino-war/
- Craps basics: https://wizardofodds.com/games/craps/basics/
- Craps index (side bets): https://wizardofodds.com/games/craps/
- Roulette basics: https://wizardofodds.com/games/roulette/basics/
- Sic Bo: https://wizardofodds.com/games/sic-bo/
- Three Card Poker: https://wizardofodds.com/games/three-card-poker/
- Ultimate Texas Hold ’Em: https://wizardofodds.com/games/ultimate-texas-hold-em/
- Video Poker basics: https://wizardofodds.com/games/video-poker/basics/
- Jacks or Better (9/6) strategy reference: https://wizardofodds.com/games/video-poker/strategy/jacks-or-better/9-6/optimal/

---

## Cross-Cutting Alignment Decisions

### 1) Table-Game Betting/Settlement Model (Chosen: Per-Bet)
For “table-style” games with multiple simultaneous wagers, we standardized on **per-bet deductions** (rather than pre-reserving a single `session.bet` for the whole round):

- **Baccarat / Craps / Roulette / Sic Bo** start with `bet=0`; each wager is deducted via `GameResult::ContinueWithUpdate { payout: -amount }` when placed.
- **Blackjack / Three Card Poker / Ultimate Texas Hold ’Em** use `session.bet` for the main wager (deducted at start) and deduct additional wagers (splits/doubles, Pairplus/Trips, Play, etc.) via `ContinueWithUpdate`.
- Resolution uses **total credited returns**:
  - `GameResult::Win(total_return)` for any non-zero credited return (including stake returns on pushes).
  - `GameResult::LossPreDeducted(total_wagered)` for full losses (because wagers were already deducted during play).

Fix summary:
- Standardized table-style games on per-bet deductions + `Win(total_return)` / `LossPreDeducted(total_wagered)` to represent mixed outcomes without relying on `GameResult::Push`.

### 1b) Website Net PnL (On-Chain)
Executor events report `CasinoGameCompleted.payout` as:
- **Positive:** credited return (stake + winnings).
- **Negative:** total loss amount.

Fix summary:
- Website now computes net PnL correctly from signed payout semantics and supports mid-game credits that aren’t reflected in the completion payout (used by Casino War tie bet).

### 2) Hidden-Information Leakage (Fixed for Staged Card Games)
Some games previously stored “hidden” cards directly in `session.state_blob` at `init()`, leaking dealer/community cards via emitted events.

Fix summary:
- Blackjack now uses **state v2** with a betting stage and explicit **Deal/Reveal** moves.
- Three Card Poker and Ultimate Texas Hold ’Em use **versioned state** with `0xFF` sentinels for unrevealed cards and staged **Deal/Reveal** moves.
- Website decodes `0xFF` as “hidden card” and shows only allowed information per stage.

### 3) Multi-Deck Shoes
WoO commonly describes multi-deck shoes for Baccarat/Blackjack/Casino War. We support this by allowing duplicate card IDs (`0..51`) in the shoe.

Decision:
- Cards remain encoded as `u8` rank/suit IDs `0..51`; multi-deck duplicates are represented by allowing repeated IDs in the shoe.

Fix summary:
- Added multi-deck shoe support in `GameRng` and switched Baccarat (8 decks), Blackjack (8 decks), and Casino War (6 decks) to WoO-typical deck counts.

---

## Game-by-Game Review

### Baccarat (`execution/src/casino/baccarat.rs`)
**WoO:** https://wizardofodds.com/games/baccarat/basics/

**Current implementation**
- Bets placed via moves; per-bet deductions (session starts with `bet=0`).
- Bet types: Player (1:1), Banker (0.95:1 commission), Tie (8:1), Player Pair (11:1), Banker Pair (11:1), Lucky 6 (WoO side bet variant).
- Uses an **8-deck** shoe (WoO typical).

**Notable gaps vs WoO**
- Pair side-bet offering is fixed (not parameterized across common paytables).

Fix summary:
- Implemented **Lucky 6** (`BetType::Lucky6`) with a 12:1 / 23:1 table (2-card vs 3-card banker 6) and standardized per-bet settlement.
- Switched to an **8-deck** shoe for WoO parity.

---

### Blackjack (`execution/src/casino/blackjack.rs`)
**WoO:** https://wizardofodds.com/games/blackjack/basics/

**Current implementation**
- Staged protocol (state v2): betting → deal → player actions → reveal/resolve.
- Supports Hit/Stand/Double/Split (up to 4 hands); dealer H17; blackjack pays 3:2.
- Implements **21+3** side bet (WoO “Version 4” pay table).
- Uses an **8-deck** shoe.

**Notable gaps vs WoO**
- Not modeled: insurance (intentionally not supported in current protocol), surrender, split-aces restrictions, DAS ruleset selection, resplit aces, etc.

Fix summary:
- Added staged Deal/Reveal to prevent hole-card leakage and implemented **21+3** (`Move::Set21Plus3`) settlement independent of main hand outcome.
- Switched to an **8-deck** shoe.

---

### Casino War (`execution/src/casino/casino_war.rs`)
**WoO:** https://wizardofodds.com/games/casino-war/

**Current implementation**
- Staged pre-deal betting (state v1) so optional side bets can’t be placed after seeing cards.
- One card each; tie leads to “War” stage; optional **tie bet** (pays 10:1) is settled on the initial tie.
- Uses a **6-deck** shoe (WoO).
- War burns 3 cards then draws one each.
- Implements WoO-documented **tie-after-tie bonus** variant: a war tie awards a bonus equal to the ante (Mirage/Casino Niagara-style).
- Surrender returns half the ante (half-loss).

**Notable gaps vs WoO**
- Other casino variants not modeled (e.g., no bonus, higher bonus schedules).

Fix summary:
- Added WoO tie bet support via a pre-deal betting stage (`Move::SetTieBet`) and updated website parsing/controls to place the side bet before dealing.
- Implemented the WoO “bonus equal to the original wager” tie-after-tie variant (war tie returns `3×` ante in our single-bet model).
- Switched to a **6-deck** shoe.

---

### Craps (`execution/src/casino/craps.rs`)
**WoO:** https://wizardofodds.com/games/craps/basics/

**Current implementation**
- Multi-bet state with per-bet deductions (session starts with `bet=0`).
- Supports core bet types (pass/don’t, come/don’t, field, place/lay, hop “next”, hardways) and **Fire Bet**.
- Supports odds as a separate action.

**Notable gaps vs WoO**
- Still missing many common bets (buy-on-win commission variants, full prop menu, etc).
- Horn/world-style prop combos are intentionally not implemented (we treat YES/NO/NEXT as sufficient for “one-roll” coverage in our UI).

Fix summary:
- Corrected payouts/odds semantics and implemented **Fire Bet** as a stateful side bet aligned to WoO pay table A.
- Added **Buy** bets (fair odds with 5% commission charged at placement) and **All Tall Small** (Small/Tall/All) stateful bonuses that resolve on completion or seven‑out.
- Restored/kept **YES/NO/NEXT** payout semantics (1% commission variant) and did not add horn/world prop-combo bets.

---

### HiLo (`execution/src/casino/hilo.rs`)
**WoO:** no direct matching WoO game page found; treat as proprietary.

**Notable gaps**
- Current multiplier model is heuristic and not WoO-comparable; define intended RTP/edge if we want formal parity.

---

### Roulette (`execution/src/casino/roulette.rs`)
**WoO:** https://wizardofodds.com/games/roulette/basics/

**Current implementation**
- European wheel: 0–36 (37 outcomes).
- Supported bets: straight, red/black, even/odd, low/high, dozen, column, plus inside bets (split/street/corner/six-line).
- Settlement uses per-bet deduction (session starts with `bet=0`) and resolves with total returns.

**Notable gaps vs WoO**
- None for the selected European wheel + rule set (Standard/La Partage/En Prison variants).

Fix summary:
- Added split (horizontal/vertical), street, corner, and six-line bet types end-to-end (engine validation + payouts, website bet entry + exposure + serialization).
- Added selectable even‑money‑on‑zero rules (**Standard**, **La Partage**, **En Prison**, **En Prison Double**) including double‑imprisonment continuation.

---

### Sic Bo (`execution/src/casino/sic_bo.rs`)
**WoO:** https://wizardofodds.com/games/sic-bo/

**Current implementation**
- Small/Big, Odd/Even (lose on triples), any/specific triple, specific double, totals 4–17, single-number count payout.
- Adds WoO **Domino (two faces)** two-number combination bet (5:1).
- Payouts match a common Macau-style table for those bets (e.g., any triple 24:1, specific triple 150:1, double 8:1, totals table).
- Settlement uses per-bet deduction (session starts with `bet=0`) and resolves with total returns.

**Notable gaps vs WoO**
- Some paytable variants are not parameterized (e.g., “Domino (one face)” payout ranges); we use a fixed table.

Fix summary:
- Added **Domino (two faces)** (`BetType::Domino`) with encoding `(min<<4)|max` and website support (input mode + serialization + local resolution).
- Added WoO “uncommon bets”: **Three-Number Easy Hop** (30:1), **Three-Number Hard Hop** (50:1), and **Four-Number Easy Hop** (7:1), with compact encodings and website support.

---

### Three Card Poker (`execution/src/casino/three_card.rs`)
**WoO:** https://wizardofodds.com/games/three-card-poker/

**Current implementation**
- Staged protocol (state v3): betting → deal → play/fold → reveal/resolve.
- Dealer qualification: Q-6-4 or better (WoO).
- Implements **Pairplus** side bet (WoO pay table 1) and **6‑Card Bonus** (WoO Version 1‑A).
- Implements **Progressive** side bet (WoO Progressive v2A; bet=1; fixed jackpot amount).

**Notable gaps vs WoO**
- Progressive **meter/envy bonuses** are not implemented (we use a fixed jackpot amount, single-player).

Fix summary:
- Added staged Deal/Reveal (no dealer-card leakage) and implemented **Pairplus** (`Move::SetPairPlus`) per WoO pay table 1.
- Added **6‑Card Bonus** (`Move::SetSixCardBonus`) using best-5-of-6 (player+dealer) with WoO Version 1‑A pay table.
- Added **Progressive** (`Move::SetProgressive`) using WoO Progressive v2A payouts (for-one) with a fixed jackpot amount (no meter/envy).

---

### Ultimate Texas Hold ’Em (`execution/src/casino/ultimate_holdem.rs`)
**WoO:** https://wizardofodds.com/games/ultimate-texas-hold-em/

**Current implementation**
- Staged protocol (state v3): betting → deal → decisions → reveal/resolve.
- Ante is `session.bet`; Blind is deducted via `ContinueWithUpdate` on init; Play bet is deducted when chosen.
- Dealer qualifies with pair or better; Ante pushes when dealer doesn’t qualify (WoO).
- Blind paytable uses 3:2 for flush (WoO).
- Implements **Trips** side bet (WoO pay table 1) and **6‑Card Bonus** (WoO Version 1‑A; player 2 + 4 dummy).
- Implements **Progressive** side bet (WoO “Common Progressive”; bet=1; fixed jackpot amount; evaluated from hole cards + flop).

**Notable gaps vs WoO**
- Progressive **meter/envy bonuses** are not implemented (we use a fixed jackpot amount, single-player).

Fix summary:
- Added staged Deal/Reveal (no community/dealer leakage), added **preflop 3x bet** support, and implemented **Trips** per WoO pay table 1.
- Added **6‑Card Bonus** (`Action::SetSixCardBonus`) using player hole cards + 4 dummy cards with WoO Version 1‑A pay table.
- Added **Progressive** (`Action::SetProgressive`) using WoO “Common Progressive” payouts (for-one) with a fixed jackpot amount (no meter/envy).

---

### Video Poker (Jacks or Better) (`execution/src/casino/video_poker.rs`)
**WoO:** https://wizardofodds.com/games/video-poker/basics/

**Current implementation**
- 5-card deal; one draw with hold mask.
- Paytable resembles 9/6 Jacks or Better (e.g., Full House 9, Flush 6, Royal 800).

**Notable gaps vs WoO**
- Strategy/UI: no paytable selector or strategy hints.

Fix summary:
- Fixed draw/hold semantics and ensured payouts are “to-1” aligned with the chosen paytable (including stake handling).

---

## Top Side Bets by Game (Shortlist)

This is “commonly offered” (not “best for the player”).

- Baccarat: Lucky 6, Perfect Pairs, Natural side bets, Even/Odd.
- Blackjack: Perfect Pairs, 21+3, Lucky Ladies, Royal Match, Match the Dealer.
- Casino War: Tie bet.
- Craps: Fire Bet, Hot Shooter / Lucky Shooter family, Repeater-style bonuses.
- Roulette: (mostly additional bet types) inside bets; optionally La Partage / En Prison variants.
- Sic Bo: expand bet menu (Domino, additional proposition bets).
- Three Card Poker: Pairplus, 6-card bonus, progressive variants.
- Ultimate Texas Hold ’Em: Trips, 6-card bonus, progressive variants.
- Video Poker: progressive/max-coin behavior; double-up feature (variant).

---

## Detailed Implementation Guidance (5 Side Bets)

These were chosen for variety across card-eval, totals-based, and stateful multi-roll betting.

### 1) Blackjack — 21+3
**WoO:** https://wizardofodds.com/games/blackjack/side-bets/21plus3/

- Evaluated from player’s first two cards + dealer up card as a 3-card poker hand category.
- Implemented as an optional wager set during betting stage (`Move::Set21Plus3`) and settled independently at reveal.
- Pay table implemented: WoO 21+3 “Version 4” 30/20/10/5 (to-1) for Straight Flush / Trips / Straight / Flush.

### 2) Baccarat — Lucky 6
**WoO:** https://wizardofodds.com/games/baccarat/side-bets/lucky-6/

- Wins when banker wins with total 6; pay depends on banker using 2 vs 3 cards.
- Implemented: 12:1 (2 cards), 23:1 (3 cards).

### 3) Craps — Fire Bet
**WoO:** https://wizardofodds.com/games/craps/side-bets/fire-bet/

- Tracks unique points made by shooter; pays on seven-out based on 4/5/6 points made.
- Implemented: WoO Fire Bet pay table A (4→24, 5→249, 6→999 to-1).

### 4) Three Card Poker — Pairplus
**WoO:** https://wizardofodds.com/games/three-card-poker/

- Pays based only on player’s hand category, independent of dealer.
- Implemented: WoO Pairplus pay table 1 (40/30/6/3/1 to-1 for SF/Trips/Straight/Flush/Pair).

### 5) Ultimate Texas Hold ’Em — Trips
**WoO:** https://wizardofodds.com/games/ultimate-texas-hold-em/

- Pays based on player’s final 7-card hand (hole + community), independent of dealer outcome.
- Implemented: WoO Trips pay table 1 (50/40/30/9/7/4/3 to-1 for Royal / SF / Quads / FH / Flush / Straight / Trips).

---

## Consolidated Implementation Roadmap

### Phase 0 — Decide targets
- Pick a canonical ruleset per game (deck count, H17/S17, paytables) and document it.
- Choose global settlement model (reserve-at-start vs per-bet).

### Phase 1 — Fix correctness blockers
Completed:
- Fixed hidden-card leakage in Blackjack / Three Card / Ultimate Hold ’Em (versioned/staged states + Deal/Reveal).
- Fixed video poker draw + paytable scaling.
- Fixed craps odds/payout semantics and standardized settlement.

### Phase 2 — Expand bet menus (WoO parity)
Completed:
- Roulette: added missing inside bets (split/street/corner/six-line).
- Roulette: added selectable La Partage / En Prison / En Prison Double (even-money-on-zero variants).
- Sic Bo: added Domino (two faces) + uncommon hop bets.

### Phase 3 — Implement 5 highlighted side bets
Completed:
- Blackjack: 21+3
- Baccarat: Lucky 6
- Craps: Fire Bet
- Three Card: Pairplus
- Ultimate Hold ’Em: Trips

### Phase 4 — Validation harness
Not started:
- Add a simulator/Monte‑Carlo harness to estimate house edge for each game + side bet and compare to WoO expected returns for the chosen rulesets.

---

## Remaining High-Impact Gaps (Next Priorities)

- Progressive meters / envy bonuses (optional): if we want true WoO-style progressives, we need a shared on-chain jackpot meter and multi-player envy payouts.
