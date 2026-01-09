# L53 - Casino games deep-dive (from scratch)

Focus directory: `execution/src/casino/`

Goal: explain how each casino game is implemented, including the CasinoGame trait dispatch pattern, RNG integration, game-specific rules, betting mechanics, payouts, house edges, and limits. For every excerpt, you will see **why it matters** and a **plain description of what the code does**. We only explain syntax when it is genuinely tricky.

---

## Concepts from scratch (expanded)

### 1) CasinoGame trait and dispatch pattern
All casino games implement a common interface:
- **CasinoGame trait** defines two methods: `init()` (called after StartGame) and `process_move()` (called for each player action).
- **Dispatcher functions** (`init_game()` and `process_game_move()`) route to the appropriate game module based on `GameType`.
- This design ensures all games follow the same lifecycle and state management conventions.

### 2) GameRng: deterministic randomness from consensus
Every game uses `GameRng`, a deterministic RNG seeded from:
- The consensus seed (network-wide),
- Session ID (unique per player session),
- Move number (increments with each action).

This ensures:
- **Reproducibility**: Any node can replay the exact same game with the same seed.
- **Fairness**: The RNG is derived from consensus, so no single party can manipulate outcomes.
- **Hidden information**: Cards/dice are only drawn when revealed, preventing information leakage.

### 3) State blob format
Each game stores its state in `session.state_blob`:
- **Binary-encoded** for efficiency (uses custom serialization helpers).
- **Versioned** to support backward compatibility during upgrades.
- **Opaque** to the handler layer; only the game module knows how to parse it.

### 4) GameResult enum
Games return a `GameResult` to signal the outcome:
- `Continue(logs)` - game continues, no balance change.
- `ContinueWithUpdate { payout, logs }` - game continues but balance changes (e.g., placing a bet mid-game).
- `Win(amount, logs)` - player wins, receives total return (stake + profit).
- `Loss(logs)` - player loses, no refund.
- `LossWithExtraDeduction(amount, logs)` - loss with additional charge (e.g., double-down then lose).
- `LossPreDeducted(amount, logs)` - loss where chips were already deducted via `ContinueWithUpdate`.
- `Push(amount, logs)` - tie, refund the bet.

### 5) House edge and fair payouts
Each game implements payouts based on:
- **True odds**: theoretical probability of each outcome.
- **House edge**: the casino's advantage, built into payout tables.
- **Wizard of Odds (WoO)**: most games use industry-standard paytables from WoO to ensure fairness.

### 6) Limits and consensus-critical constants
Some games enforce limits to prevent state bloat:
- **Max bets per round** (Baccarat: 11, Craps: 20, Roulette: 20, Sic Bo: 20).
- **Max hands** (Blackjack: 4 splits).
- **Max cards** (Blackjack: 11 cards per hand).

These are consensus-critical because all nodes must agree on validation logic.

---

## Dispatch pattern: CasinoGame trait and routing

### 1) CasinoGame trait definition
```rust
pub trait CasinoGame {
    fn init(session: &mut GameSession, rng: &mut GameRng) -> GameResult;

    fn process_move(
        session: &mut GameSession,
        payload: &[u8],
        rng: &mut GameRng,
    ) -> Result<GameResult, GameError>;
}
```
**Location:** `execution/src/casino/mod.rs:381-393`

Why this matters:
- Standardizes game implementation across all types.
- Ensures every game can be initialized and processed in the same way.

What this code does:
- `init()` is called when a game session starts; it creates the initial state blob and may deal initial cards.
- `process_move()` is called for each player action; it updates the state blob and returns the outcome.

---

### 2) Game type dispatcher
```rust
pub fn init_game(session: &mut GameSession, rng: &mut GameRng) -> GameResult {
    match session.game_type {
        GameType::Baccarat => baccarat::Baccarat::init(session, rng),
        GameType::Blackjack => blackjack::Blackjack::init(session, rng),
        GameType::CasinoWar => casino_war::CasinoWar::init(session, rng),
        GameType::Craps => craps::Craps::init(session, rng),
        GameType::HiLo => hilo::HiLo::init(session, rng),
        GameType::Roulette => roulette::Roulette::init(session, rng),
        GameType::SicBo => sic_bo::SicBo::init(session, rng),
        GameType::ThreeCard => three_card::ThreeCardPoker::init(session, rng),
        GameType::UltimateHoldem => ultimate_holdem::UltimateHoldem::init(session, rng),
        GameType::VideoPoker => video_poker::VideoPoker::init(session, rng),
    }
}
```
**Location:** `execution/src/casino/mod.rs:396-409`

Why this matters:
- Single entry point for all game initialization.
- Ensures type safety and routing to the correct game module.

What this code does:
- Matches on `GameType` enum and calls the corresponding game's `init()` method.
- Returns a `GameResult` indicating the initial state (usually `Continue`).

---

## RNG integration: deterministic fairness

### 1) GameRng structure
```rust
pub struct GameRng {
    state: [u8; 32],
    index: usize,
}

impl GameRng {
    pub fn new(seed: &Seed, session_id: u64, move_number: u32) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(seed.encode().as_ref());
        hasher.update(&session_id.to_be_bytes());
        hasher.update(&move_number.to_be_bytes());
        Self {
            state: hasher.finalize().0,
            index: 0,
        }
    }
}
```
**Location:** `execution/src/casino/mod.rs:55-70`

Why this matters:
- Deterministic RNG ensures all nodes produce identical outcomes for the same game state.
- SHA256-based chaining provides cryptographic-quality randomness.

What this code does:
- Hashes the consensus seed, session ID, and move number into a 32-byte state.
- Uses this state as a source of random bytes, re-hashing when exhausted.

---

### 2) Card drawing and deck management
```rust
pub fn draw_card(&mut self, deck: &mut Vec<u8>) -> Option<u8> {
    if deck.is_empty() {
        return None;
    }
    let idx = if deck.len() <= u8::MAX as usize {
        self.next_bounded(deck.len() as u8) as usize
    } else {
        self.next_bounded_usize(deck.len())
    };
    Some(deck.swap_remove(idx))
}

pub fn create_deck(&mut self) -> Vec<u8> {
    let mut deck = Vec::with_capacity(52);
    for card in 0..52u8 {
        deck.push(card);
    }
    self.shuffle(&mut deck);
    deck
}
```
**Location:** `execution/src/casino/mod.rs:169-190`

Why this matters:
- Cards are represented as `0-51` (suit = card/13, rank = card%13).
- Drawing without replacement prevents duplicate cards in the same hand.

What this code does:
- `draw_card()` picks a random index from the deck and removes it using `swap_remove()` (O(1) operation).
- `create_deck()` generates a full 52-card deck and shuffles it using Fisher-Yates.

---

### 3) Multi-deck shoes (blackjack)
```rust
pub fn create_shoe(&mut self, decks: u8) -> Vec<u8> {
    let decks = decks.max(1);
    let mut deck: Vec<u8> = Vec::with_capacity(52 * decks as usize);
    for _ in 0..decks {
        deck.extend(0u8..52u8);
    }
    self.shuffle(&mut deck);
    deck
}
```
**Location:** `execution/src/casino/mod.rs:195-203`

Why this matters:
- Blackjack uses 8-deck shoes to reduce card counting effectiveness.
- Each card 0-51 can appear multiple times in the shoe.

What this code does:
- Repeats the 52-card range `decks` times.
- Shuffles the combined shoe to ensure randomness.

---

## Blackjack: card counting edge, splitting, insurance

### 1) Blackjack house rules and deck count
```rust
impl Default for BlackjackRules {
    fn default() -> Self {
        Self {
            dealer_hits_soft_17: true,
            blackjack_pays_six_five: false,
            late_surrender: false,
            double_after_split: true,
            resplit_aces: true,
            hit_split_aces: true,
            decks: BlackjackDecks::default(),
        }
    }
}

impl Default for BlackjackDecks {
    fn default() -> Self {
        BlackjackDecks::Eight
    }
}
```
**Location:** `execution/src/casino/blackjack.rs:119-131` and `77-79`

Why this matters:
- House rules determine the house edge. H17 (dealer hits soft 17) increases house edge by ~0.2%.
- 8-deck shoes reduce card counting advantage compared to single deck.
- Blackjack pays 3:2 (not 6:5) to maintain player fairness.

What this code does:
- Defines default rules matching common casino standards.
- Supports configurable rules via the rules byte in the state blob.

---

### 2) Splitting and hand management
```rust
const MAX_HANDS: usize = 4;

struct Hand {
    cards: Vec<u8>,
    bet_mult: u8,  // 1 = base bet, 2 = doubled
    status: HandStatus,
    was_split: bool,
}
```
**Location:** `execution/src/casino/blackjack.rs:61` and hand structure

Why this matters:
- Splitting allows a player to turn a pair into two separate hands.
- Split hands cannot be natural blackjacks (3:2 payout), only 21s.
- Maximum 4 hands prevents state bloat.

What this code does:
- Each hand tracks its cards, bet multiplier (for double-down), status, and split flag.
- The `was_split` flag prevents 3:2 blackjack payout on split aces.

---

### 3) Side bets: 21+3, Lucky Ladies, Perfect Pairs
```rust
fn eval_21plus3_multiplier(cards: [u8; 3]) -> u64 {
    let (rank, _kickers) = evaluate_three_card_hand(&cards);
    match rank {
        ThreeCardRank::StraightFlush => 40,
        ThreeCardRank::ThreeOfAKind => 30,
        ThreeCardRank::Straight => 9,
        ThreeCardRank::Flush => 9,
        _ => 0,
    }
}

fn eval_lucky_ladies_multiplier(cards: [u8; 2], dealer_blackjack: bool) -> u64 {
    let value = cards.iter().map(|&c| blackjack_card_value(*c).min(10)).sum::<u8>();
    if value != 20 { return 0; }

    // Paired Queens of Hearts + dealer blackjack = 200:1
    // ... (logic omitted for brevity)
}
```
**Location:** `execution/src/casino/blackjack.rs:368-408`

Why this matters:
- Side bets add variety and house edge (typically 2-5% for 21+3, ~17% for Lucky Ladies).
- Payouts are based on the player's first two cards (and dealer's for Lucky Ladies).

What this code does:
- Evaluates the player's initial hand against paytables.
- Returns the multiplier (0 if no win).
- Side bets resolve immediately after deal, before player actions.

---

## Baccarat: banker/player odds, third card rules

### 1) Card values and hand totals
```rust
fn card_value(card: u8) -> u8 {
    let rank = cards::card_rank_one_based(card); // 1-13
    match rank {
        1 => 1,        // Ace
        2..=9 => rank, // 2-9
        _ => 0,        // 10, J, Q, K
    }
}

fn hand_total(cards: &[u8]) -> u8 {
    cards.iter().map(|&c| card_value(c)).sum::<u8>() % 10
}
```
**Location:** `execution/src/casino/baccarat.rs:118-131`

Why this matters:
- Baccarat uses modulo-10 scoring. A hand of 7+9 = 16, which scores as 6.
- Face cards and 10s count as 0, making natural 8s and 9s rare.

What this code does:
- Converts each card to its Baccarat value (Ace=1, 2-9=face, 10/J/Q/K=0).
- Sums the values and takes modulo 10 for the final score.

---

### 2) Third card drawing rules
```rust
fn should_player_draw_third(player_total: u8) -> bool {
    player_total <= 5
}

fn should_banker_draw_third(banker_total: u8, player_third_card: Option<u8>) -> bool {
    match player_third_card {
        None => banker_total <= 5,
        Some(third) => {
            let third_value = card_value(third);
            match banker_total {
                0..=2 => true,
                3 => third_value != 8,
                4 => (2..=7).contains(&third_value),
                5 => (4..=7).contains(&third_value),
                6 => (6..=7).contains(&third_value),
                _ => false,
            }
        }
    }
}
```
**Location:** `execution/src/casino/baccarat.rs` (third card logic)

Why this matters:
- Baccarat's third card rules are fixed and asymmetric.
- Player draws on 0-5, banker's draw depends on player's third card.
- These rules create the 1.06% house edge on banker bets (1.24% on player bets).

What this code does:
- Player draws if total is 0-5, stands on 6-7.
- Banker's decision is based on a complex table that considers the player's third card value.

---

### 3) Multi-bet support and atomic batching
```rust
// Payload format:
// [0, bet_type, amount_bytes...] - Place bet (adds to pending bets)
// [1] - Deal cards and resolve all bets
// [2] - Clear all pending bets (with refund)
// [3, bet_count, bets...] - Atomic batch: place all bets + deal in one transaction
```
**Location:** `execution/src/casino/baccarat.rs:10-14`

Why this matters:
- Players can place multiple bets (Player, Banker, Tie, Pair, Dragon Bonus, etc.).
- Atomic batching ensures all-or-nothing semantics: either all bets are placed and resolved, or none are.
- This prevents partial states where some bets are charged but not resolved.

What this code does:
- Supports incremental betting (place bet, place another, then deal).
- Also supports atomic batch mode (place all bets + deal in a single payload).

---

## Roulette: bet types, payout tables

### 1) Bet types and payouts
```rust
mod payouts {
    pub const STRAIGHT: u64 = 35;       // Single number
    pub const EVEN_MONEY: u64 = 1;      // Red, Black, Even, Odd, Low, High
    pub const DOZEN: u64 = 2;           // 1-12, 13-24, 25-36
    pub const COLUMN: u64 = 2;
    pub const SPLIT: u64 = 17;          // 2 adjacent numbers
    pub const STREET: u64 = 11;         // 3 numbers in a row
    pub const CORNER: u64 = 8;          // 4-number corner
    pub const SIX_LINE: u64 = 5;        // 6 numbers (two rows)
}
```
**Location:** `execution/src/casino/roulette.rs:48-57`

Why this matters:
- Roulette payouts are based on true probability minus house edge.
- Straight bet: 1/37 probability (European), but pays 35:1 instead of 36:1. House edge = 2.7%.
- American roulette (with 00) increases house edge to 5.26%.

What this code does:
- Defines payout multipliers as "to 1" winnings (not including the original stake).
- These values are used to calculate returns when a bet wins.

---

### 2) Zero rules: La Partage, En Prison
```rust
enum ZeroRule {
    Standard = 0,      // All even-money bets lose on zero
    LaPartage = 1,     // Half bet returned on zero for even-money bets
    EnPrison = 2,      // Bet is imprisoned, re-played next spin
    EnPrisonDouble = 3,
    American = 4,      // Double zero wheel (0 and 00)
}
```
**Location:** `execution/src/casino/roulette.rs:85-92`

Why this matters:
- La Partage reduces house edge to ~1.35% on even-money bets.
- En Prison allows a second chance: if zero hits, even-money bets are "imprisoned" and resolved on the next spin.
- American roulette has both 0 and 00, doubling the house edge.

What this code does:
- Stores the zero rule in the state blob.
- Applies different logic when zero hits based on the rule.

---

### 3) Bet validation: split, corner, street
```rust
fn is_valid_bet_number(bet_type: BetType, number: u8) -> bool {
    match bet_type {
        BetType::SplitH => number >= 1 && number <= 35 && number % 3 != 0,
        BetType::SplitV => number >= 1 && number <= 33,
        BetType::Street => number >= 1 && number <= 34 && (number - 1) % 3 == 0,
        BetType::Corner => number >= 1 && number <= 32 && number % 3 != 0,
        BetType::SixLine => number >= 1 && number <= 31 && (number - 1) % 3 == 0,
        BetType::Straight => number <= 36 || (number == 37 && /* American */ true),
        _ => true,
    }
}
```
**Location:** `execution/src/casino/roulette.rs` (bet validation logic)

Why this matters:
- Roulette table layout has specific constraints: not every number can be a corner or split.
- Invalid bets must be rejected to prevent exploits.

What this code does:
- Validates that the bet number makes sense for the bet type.
- For example, SplitH (horizontal split) requires a left cell in a row (not multiples of 3).

---

## Ultimate Texas Hold'em: decision tree, ante/blind/trips

### 1) Betting structure: ante, blind, play
```rust
// State blob:
// [playBetMultiplier:u8]  // 0 = none, 1/2/3/4 = multiplier of ante
// [tripsBetAmount:u64 BE]
// [sixCardBonusBetAmount:u64 BE]
// [progressiveBetAmount:u64 BE]
```
**Location:** `execution/src/casino/ultimate_holdem.rs:9-20`

Why this matters:
- UTH requires equal Ante and Blind bets (both equal to `session.bet`).
- Play bet can be 1x, 2x, 3x, or 4x the Ante, depending on when you bet.
- Trips and progressive are optional side bets.

What this code does:
- Stores the play bet multiplier and side bet amounts in the state blob.
- Play bet is charged when the player commits (before reveal).

---

### 2) Decision tree: preflop, flop, river
```rust
enum Stage {
    Betting = 0,         // Optional Trips, then Deal
    Preflop = 1,         // Check or bet 4x (or 3x if rules allow)
    Flop = 2,            // Check or bet 2x
    River = 3,           // Bet 1x or fold
    AwaitingReveal = 4,  // Play bet placed; reveal/resolve next
    Showdown = 5,
}
```
**Location:** `execution/src/casino/ultimate_holdem.rs:110-117`

Why this matters:
- UTH strategy depends on bet timing: 4x preflop for premium hands, 2x on flop for draws, 1x on river for marginal hands.
- Folding sacrifices both Ante and Blind bets.
- Optimal strategy reduces house edge to ~2.2%.

What this code does:
- Tracks which stage the player is in.
- Validates that bet sizes match the stage (4x preflop, 2x flop, 1x river).

---

### 3) Dealer qualification and ante bonus
```rust
enum DealerQualification {
    None = 0,        // Dealer always plays
    PairPlus = 1,    // Dealer must have pair or better
}

// Ante Bonus pay table (WoO standard):
// Straight Flush: 5:1
// Four of a Kind: 4:1 (requires using community cards)
// Full House: 3:1
// Flush: 1.5:1
// Straight: 1:1
```
**Location:** `execution/src/casino/ultimate_holdem.rs:59-65` and paytable logic

Why this matters:
- If dealer doesn't qualify (and rule is PairPlus), Play bet pushes (refunded).
- Ante Bonus pays even if player loses (as long as player plays and qualifies).

What this code does:
- Checks dealer's hand rank against the qualification rule.
- Awards Ante Bonus based on player's best 5-card hand.

---

## Sic Bo: dice combinations, house edge

### 1) Bet types and probabilities
```rust
enum BetType {
    Small = 0,               // 4-10, loses on triple (1:1)
    Big = 1,                 // 11-17, loses on triple (1:1)
    Odd = 2,                 // Odd total (1:1)
    Even = 3,                // Even total (1:1)
    SpecificTriple = 4,      // All three same specific (150:1)
    AnyTriple = 5,           // Any triple (24:1)
    SpecificDouble = 6,      // At least two of specific (8:1)
    Total = 7,               // Specific total (various payouts)
    Single = 8,              // Single number appears 1-3 times (1:1 to 3:1)
    Domino = 9,              // Two-number combination (5:1)
    ThreeNumberEasyHop = 10, // Three unique numbers (30:1)
    ThreeNumberHardHop = 11, // Two of one + one of another (50:1)
    FourNumberEasyHop = 12,  // Three-of-four numbers (7:1)
}
```
**Location:** `execution/src/casino/sic_bo.rs:114-128`

Why this matters:
- Sic Bo uses three six-sided dice, creating 216 possible outcomes.
- Small/Big bets lose on triples, reducing true probability and increasing house edge.
- House edge ranges from 2.8% (Small/Big) to ~30% (specific triple).

What this code does:
- Defines all supported bet types.
- Each bet type has different validation rules for the `number` parameter.

---

### 2) Total bet payouts
```rust
mod payouts {
    pub const TOTAL_3_OR_18: u64 = 180;   // Rarest (1/216 each)
    pub const TOTAL_4_OR_17: u64 = 50;
    pub const TOTAL_5_OR_16: u64 = 18;
    pub const TOTAL_6_OR_15: u64 = 14;
    pub const TOTAL_7_OR_14: u64 = 12;
    pub const TOTAL_8_OR_13: u64 = 8;
    pub const TOTAL_9_OR_12: u64 = 6;
    pub const TOTAL_10_OR_11: u64 = 6;
}
```
**Location:** `execution/src/casino/sic_bo.rs:58-66`

Why this matters:
- Total bets have the highest variance: 3 and 18 pay 180:1 but occur 1 in 216 rolls.
- Symmetric totals (e.g., 3 and 18, 4 and 17) have the same probability due to dice symmetry.

What this code does:
- Defines payout multipliers for each total.
- Higher payouts for rarer totals, but house edge is built in.

---

### 3) Single number bet: 1x, 2x, 3x
```rust
fn single_bet_multiplier(dice: [u8; 3], number: u8) -> u64 {
    let count = dice.iter().filter(|&&d| d == number).count();
    match count {
        1 => 1,
        2 => 2,
        3 => 3,
        _ => 0,
    }
}
```
**Location:** `execution/src/casino/sic_bo.rs` (single bet logic)

Why this matters:
- A single number bet pays based on how many dice show that number.
- True odds: 1 die = 50% (91/216), 2 dice = 7.4% (15/216), 3 dice = 0.46% (1/216).
- House edge: ~3.7% due to payout structure (1:1, 2:1, 3:1 vs true odds).

What this code does:
- Counts occurrences of the bet number in the three dice.
- Returns the multiplier (1, 2, or 3) based on count.

---

## Three Card Poker: pair plus, ante bonus

### 1) Hand rankings for 3-card poker
```rust
pub enum HandRank {
    HighCard = 0,
    Pair = 1,
    Flush = 2,
    Straight = 3,
    ThreeOfAKind = 4,
    StraightFlush = 5,
}

pub fn evaluate_hand(cards: &[u8; 3]) -> (HandRank, [u8; 3]) {
    // ... (evaluation logic)
}
```
**Location:** `execution/src/casino/three_card.rs:179-190`

Why this matters:
- Three-card poker has a different hand ranking than 5-card poker.
- Flush ranks below straight (opposite of 5-card poker) because straights are rarer with 3 cards.
- Hand evaluation must be fast and deterministic for consensus.

What this code does:
- Evaluates a 3-card hand and returns the rank plus tiebreaker kickers.
- Uses fixed arrays to avoid heap allocations.

---

### 2) Pair Plus side bet
```rust
mod payouts {
    pub const PAIRPLUS_STRAIGHT_FLUSH: u64 = 40;
    pub const PAIRPLUS_THREE_OF_A_KIND: u64 = 30;
    pub const PAIRPLUS_STRAIGHT: u64 = 6;
    pub const PAIRPLUS_FLUSH: u64 = 3;
    pub const PAIRPLUS_PAIR: u64 = 1;
}
```
**Location:** `execution/src/casino/three_card.rs:53-58`

Why this matters:
- Pair Plus pays regardless of dealer's hand or whether player wins.
- House edge: ~2.3% (WoO Pair Plus paytable 1).
- Pair Plus is the most popular side bet in Three Card Poker.

What this code does:
- Defines payout multipliers for each qualifying hand.
- Pays immediately after deal, before the Play/Fold decision.

---

### 3) Ante bonus and dealer qualification
```rust
enum DealerQualifier {
    QHigh = 0,   // Queen-high or better (standard)
    Q64 = 1,     // Queen-6-4 or better (stricter)
}

mod payouts {
    pub const ANTE_STRAIGHT_FLUSH: u64 = 5;
    pub const ANTE_THREE_OF_A_KIND: u64 = 4;
    pub const ANTE_STRAIGHT: u64 = 1;
}
```
**Location:** `execution/src/casino/three_card.rs:85-89` and `48-51`

Why this matters:
- Ante Bonus pays when player plays and has a qualifying hand (straight or better).
- Dealer must qualify (Q-high or better) for Ante/Play bets to pay; otherwise Ante pushes.
- Q-6-4 variant (rare) requires dealer to have Q-6-4 or better, reducing dealer qualification rate.

What this code does:
- Checks dealer's hand rank against the qualifier.
- Pays Ante Bonus based on player's hand rank, independent of win/loss.

---

## Casino War: war decision, tie handling

### 1) War vs surrender on tie
```rust
enum Move {
    Play = 0,      // Initial play or continue
    War = 1,       // Go to war (on tie)
    Surrender = 2, // Surrender on tie (forfeit half bet)
}

enum Stage {
    Betting = 0,
    War = 1,       // After tie, player chose War
    Complete = 2,
}
```
**Location:** `execution/src/casino/casino_war.rs:131-137` and `109-113`

Why this matters:
- Casino War is the simplest casino game: highest card wins.
- On tie, player can "go to war" (double bet and compare again) or surrender (lose half bet).
- Going to war gives house edge of ~2.9%; surrendering is worse (~3.7%).

What this code does:
- Tracks whether the game is in war stage after a tie.
- Charges an additional bet when player goes to war.

---

### 2) Tie bet side bet
```rust
enum TieBetPayout {
    TenToOne = 0,
    ElevenToOne = 1,
}

fn tie_bet_multiplier(self) -> u64 {
    match self.tie_bet_payout {
        TieBetPayout::TenToOne => 10,
        TieBetPayout::ElevenToOne => 11,
    }
}
```
**Location:** `execution/src/casino/casino_war.rs:53-69` and `98-103`

Why this matters:
- Tie bet pays when initial cards tie (before war decision).
- Probability of tie: 4/52 (same rank, any suit) ≈ 7.7%.
- 10:1 payout gives house edge of ~18.7%; 11:1 reduces it to ~10.6%.

What this code does:
- Stores the tie bet payout rule (10:1 or 11:1) in the state blob.
- Resolves the tie bet immediately when a tie occurs.

---

### 3) Tie after tie bonus
```rust
struct CasinoWarRules {
    tie_bet_payout: TieBetPayout,
    tie_after_tie_bonus: bool,  // Bonus 1:1 if war round also ties
}
```
**Location:** `execution/src/casino/casino_war.rs:72-76`

Why this matters:
- Some casinos pay a bonus if the war round also ties.
- This slightly reduces house edge and adds excitement.

What this code does:
- Tracks the bonus rule in the state blob.
- Awards an extra 1:1 payout on the war bet if enabled and war ties.

---

## HiLo: streak mechanics

### 1) Accumulator and multiplier system
```rust
const BASE_MULTIPLIER: i64 = 10_000;  // 1.0 = 10000 basis points

struct HiLoState {
    current_card: u8,
    accumulator: i64,  // Pot multiplier in basis points
    rules: HiLoRules,
}

fn calculate_multiplier(current_rank: u8, mv: Move) -> i64 {
    let winning_ranks = match mv {
        Move::Same => 1,                    // 12x multiplier
        Move::Higher => 13 - current_rank,  // Based on ranks above
        Move::Lower => current_rank - 1,    // Based on ranks below
        _ => return 0,
    };
    (12 * BASE_MULTIPLIER) / winning_ranks
}
```
**Location:** `execution/src/casino/hilo.rs:29-30`, `87-91`, `123-160`

Why this matters:
- HiLo is a streak-based game: each correct guess multiplies the pot.
- Multiplier is calculated from true odds: if 10 ranks are higher, multiplier is 12/10 = 1.2x.
- Same rank (tie) pushes in standard rules, no multiplier change.

What this code does:
- Stores the current pot multiplier in the accumulator (basis points, so 15000 = 1.5x).
- Calculates the multiplier for each guess based on winning ranks.
- Multiplies the accumulator on correct guesses; resets to 0 on incorrect guesses.

---

### 2) Higher/Lower logic and edge cases
```rust
enum Move {
    Higher = 0,   // Guess next card is higher rank
    Lower = 1,    // Guess next card is lower rank
    Cashout = 2,  // Take current pot
    Same = 3,     // Guess next card is same rank (Ace/King only)
}

fn card_rank(card: u8) -> u8 {
    cards::card_rank_one_based(card)  // Ace=1, 2=2, ..., K=13
}
```
**Location:** `execution/src/casino/hilo.rs:95-101` and `119-121`

Why this matters:
- Strict inequality: higher means `>`, lower means `<`. Same rank is a push (continue).
- At Ace (rank 1), only Higher and Same are valid. At King (rank 13), only Lower and Same are valid.
- Drawing with replacement (always 52 cards) keeps probabilities constant.

What this code does:
- Compares the next card's rank to the current card.
- On correct guess, multiplies accumulator. On wrong guess, player loses.
- On tie (same rank), game continues with no multiplier change (if tie_push rule enabled).

---

### 3) Super mode integration: streak bonus
```rust
// HiLo uses streak-based super mode (not card-based like other games)
pub fn generate_super_multipliers(game_type: GameType, rng: &mut GameRng) -> Vec<SuperMultiplier> {
    match game_type {
        GameType::HiLo => Vec::new(),  // HiLo uses streak-based system
        _ => /* other games */
    }
}
```
**Location:** `execution/src/casino/mod.rs:489`

Why this matters:
- HiLo doesn't use the standard super mode multipliers (which apply to specific cards or numbers).
- Instead, super mode multiplies the streak accumulator, amplifying long streaks.

What this code does:
- Returns an empty vector for HiLo (no pre-generated multipliers).
- Super mode for HiLo is handled separately via `apply_hilo_streak_multiplier()`.

---

## Video Poker: hand rankings, pay tables

### 1) 5-card hand evaluation
```rust
pub enum Hand {
    HighCard = 0,
    JacksOrBetter = 1,
    TwoPair = 2,
    ThreeOfAKind = 3,
    Straight = 4,
    Flush = 5,
    FullHouse = 6,
    FourOfAKind = 7,
    StraightFlush = 8,
    RoyalFlush = 9,
}

pub fn evaluate_hand(cards: &[u8; 5]) -> Hand {
    // ... (rank/suit extraction, flush/straight checks, rank counting)
}
```
**Location:** `execution/src/casino/video_poker.rs:58-69` and `131-200`

Why this matters:
- Video Poker uses standard 5-card poker rankings.
- Royal Flush (A-10 suited) pays 800:1 (4000:1 with max coins in traditional machines).
- Evaluation must be deterministic and consensus-safe.

What this code does:
- Extracts ranks and suits into fixed arrays.
- Checks for flush, straight, and rank duplicates.
- Returns the best hand rank.

---

### 2) Jacks or Better paytable
```rust
mod payouts {
    pub const HIGH_CARD: u64 = 0;
    pub const JACKS_OR_BETTER: u64 = 1;
    pub const TWO_PAIR: u64 = 2;
    pub const THREE_OF_A_KIND: u64 = 3;
    pub const STRAIGHT: u64 = 4;
    pub const FLUSH: u64 = 6;
    pub const FULL_HOUSE: u64 = 9;
    pub const FOUR_OF_A_KIND: u64 = 25;
    pub const STRAIGHT_FLUSH: u64 = 50;
    pub const ROYAL_FLUSH: u64 = 800;
}
```
**Location:** `execution/src/casino/video_poker.rs:20-31`

Why this matters:
- 9/6 Jacks or Better (Full House 9:1, Flush 6:1) has ~99.5% RTP with perfect play.
- 8/5 variant reduces RTP to ~97.3%.
- Minimum qualifying hand is Jacks or Better (pair of J, Q, K, or A).

What this code does:
- Defines total return multipliers (including original bet).
- For example, JACKS_OR_BETTER = 1 means you get 1x your bet (break even, stake returned).

---

### 3) Hold/discard mechanics
```rust
enum Stage {
    Deal = 0,  // Initial 5 cards dealt
    Draw = 1,  // Cards replaced based on hold mask
}

// Payload format: [holdMask:u8]
// bit 0 = hold card 1, bit 1 = hold card 2, etc.
```
**Location:** `execution/src/casino/video_poker.rs:38-42` and `9-10`

Why this matters:
- Player receives 5 cards, selects which to hold (0-5 cards), and draws replacements.
- Hold mask is a single byte: bits 0-4 indicate which cards to keep.
- Drawing is done from a deck excluding held cards (no duplicates).

What this code does:
- Parses the hold mask from the payload.
- Creates a new deck excluding held cards.
- Draws replacement cards for discarded positions.

---

## Limits & management callouts (important)

### 1) Consensus-critical bet limits
```rust
pub const BACCARAT_MAX_BETS: usize = 11;
pub const CRAPS_MAX_BETS: usize = 20;
pub const ROULETTE_MAX_BETS: usize = 20;
pub const SIC_BO_MAX_BETS: usize = 20;
```
**Location:** `execution/src/casino/limits.rs:6-9`

Why this matters:
- These limits prevent state bloat and DoS attacks (placing thousands of tiny bets).
- All nodes must enforce the same limits or consensus will diverge.
- Changing these values requires a coordinated upgrade.

What this code does:
- Defines maximum number of simultaneous bets for multi-bet games.
- Games reject payloads that exceed these limits.

---

### 2) Blackjack hand and card limits
```rust
const MAX_HAND_SIZE: usize = 11;  // Maximum cards in a single hand
const MAX_HANDS: usize = 4;       // Maximum split hands
```
**Location:** `execution/src/casino/blackjack.rs:59-61`

Why this matters:
- Max 11 cards per hand prevents runaway state growth (soft 18 drawing 10 aces is theoretically possible but extremely rare).
- Max 4 split hands is standard casino practice and prevents state bloat.

What this code does:
- Enforces limits during hit/split actions.
- Returns `GameError::InvalidMove` if limits are exceeded.

---

### 3) House edge by game
- **Blackjack**: ~0.5% with basic strategy (8-deck, H17, 3:2 BJ). Side bets: 2-17% edge.
- **Baccarat**: 1.06% on Banker, 1.24% on Player, ~14% on Tie.
- **Roulette**: 2.7% (European single-zero), 5.26% (American double-zero).
- **Ultimate Hold'em**: ~2.2% with optimal strategy.
- **Sic Bo**: 2.8% (Small/Big) to ~30% (Specific Triple).
- **Three Card Poker**: ~3.4% on Ante/Play, ~2.3% on Pair Plus.
- **Casino War**: ~2.9% (going to war), ~3.7% (surrender).
- **HiLo**: ~0-2% depending on player decisions (edges vary by card).
- **Video Poker**: ~0.5% (9/6 Jacks or Better with perfect play), ~2.7% (8/5 variant).

Why this matters:
- House edge determines long-term profitability and player retention.
- Games with skill (Blackjack, Video Poker, UTH) have lower edges for optimal players.
- Side bets have higher edges but add variance and excitement.

---

### 4) RNG seed rotation and hidden information
```rust
pub fn new(seed: &Seed, session_id: u64, move_number: u32) -> Self {
    let mut hasher = Sha256::new();
    hasher.update(seed.encode().as_ref());
    hasher.update(&session_id.to_be_bytes());
    hasher.update(&move_number.to_be_bytes());
    Self { state: hasher.finalize().0, index: 0 }
}
```
**Location:** `execution/src/casino/mod.rs:62-70`

Why this matters:
- Move number increments with each action, creating a new RNG state.
- Hidden cards (dealer hole card, community cards) are not drawn until revealed, preventing information leakage.
- If a player quits mid-game, the unused RNG state is discarded.

What this code does:
- Re-hashes the RNG state for each move.
- Ensures that cards drawn in move 1 cannot predict cards in move 2.

---

## Key takeaways
- **CasinoGame trait** provides a unified interface for all games: `init()` and `process_move()`.
- **GameRng** ensures deterministic, consensus-safe randomness derived from the network seed.
- **State blobs** are binary-encoded, versioned, and opaque to the handler layer.
- **GameResult** enum signals outcomes: continue, win, loss, push, or intermediate updates.
- **House edges** are built into paytables; most games use industry-standard Wizard of Odds paytables.
- **Limits** (max bets, max hands, max cards) are consensus-critical and prevent state bloat.
- **Multi-bet games** (Baccarat, Roulette, Sic Bo, Craps) support atomic batching for all-or-nothing semantics.
- **Hidden information** (dealer cards, community cards) is drawn only when revealed, preserving fairness.

---

## Feynman recap

Imagine explaining casino games to someone who has never seen them:

"A casino is a place where you make bets on random events. Each game has different rules and different odds. Some games are purely luck (Roulette, Sic Bo), some have a bit of strategy (Blackjack, Video Poker), and some are complex card games (Baccarat, Ultimate Hold'em).

The house (casino) always has a small advantage called the 'house edge.' This edge is built into the payout tables. For example, in Roulette, there are 37 numbers (0-36), but a single-number bet only pays 35:1 instead of 36:1. That missing 1 is the house edge.

In our system, all games are implemented as on-chain smart contracts. They use a deterministic random number generator seeded from consensus, so every node can replay the exact same game and get the exact same result. This prevents cheating and ensures fairness.

Each game stores its state in a binary blob: cards, dice, bets, stage, etc. When you make a move (hit, stand, bet, spin), the game updates the state and returns a result (win, loss, continue, etc.). The handler layer then updates your balance and emits events.

Some games (like Blackjack) have complex rules: splitting, doubling, insurance, side bets. Others (like HiLo) are simple: guess higher or lower. But they all follow the same pattern: initialize state, process moves, resolve outcome.

The key insight is that randomness is not truly random—it's deterministic chaos. Given the same seed and session ID, you'll always draw the same cards in the same order. This is crucial for blockchain consensus."

---

## Exercises

1. **Implement a new side bet for Blackjack**: Design a "Super Seven" side bet that pays if the player's first card is a 7. Define the paytable (e.g., suited 7 = 5:1, any 7 = 3:1) and calculate the house edge. Where in `blackjack.rs` would you add this logic?

2. **Calculate house edge for a Sic Bo bet**: Given that "Small" (4-10, loses on triple) has 105 winning outcomes out of 216 total, and pays 1:1, calculate the expected value and house edge. Why is this bet more favorable than "Specific Triple"?

3. **Design an optimal HiLo strategy**: At what accumulator value should you cash out instead of risking another guess? Consider the multiplier, current card rank, and risk tolerance. How does this compare to the Kelly criterion?

4. **Implement Craps as an exercise**: Craps is the most complex table game (20+ bet types, point establishment, odds bets). Design a state blob format, define all bet types (Pass/Don't Pass, Come/Don't Come, Field, Hardways, etc.), and implement the shooter's roll sequence. What are the consensus-critical limits?

5. **Analyze progressive jackpot fairness**: Three Card Poker has a progressive jackpot that pays on mini royal (A-K-Q suited). The jackpot grows by accumulating a portion of each progressive bet. If the base jackpot is 1000 chips and 1% of each bet is added, how many bets does it take to double the jackpot? What happens if the jackpot gets extremely large?

6. **Multi-game tournament mode**: Design a tournament mode where players compete across multiple games (Blackjack, Roulette, Video Poker) and accumulate points based on wins/losses. How would you track scores across different games with different house edges? Should you normalize by expected value or use raw chip counts?

---

## Next lesson
L54 - Craps deep-dive: `feynman/lessons/L54-craps-deepdive.md` (if it exists, otherwise pick another related lesson)
