# Framework Documentation Research: Casino Game Variants with Multiplier Systems

**Research Date**: 2025-12-18
**Focus**: Super Mode implementation with 20% fee collection, random multiplier assignment (2x-500x), multi-phase game reveals, and target 95-99% RTP

---

## Executive Summary

This document synthesizes framework documentation and best practices for implementing a "Super Mode" feature in the nullsociety on-chain casino platform. The research covers four key areas:

1. **Rust/On-Chain**: Deterministic RNG, game state management, and RTP calculations
2. **React/TypeScript Frontend**: Animation systems, state machines, and multi-phase reveals
3. **Mathematical Libraries**: Probability distributions and RTP verification
4. **Testing Frameworks**: Property-based testing for fairness verification

---

## 1. Current Architecture Analysis

### 1.1 On-Chain Game State Management

**File**: `/home/r/Coding/nullsociety/execution/src/casino/mod.rs`

The platform uses a custom deterministic RNG (`GameRng`) based on SHA-256 hash chains:

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

**Key Features**:
- Implements `rand::RngCore` trait for compatibility with Rust ecosystem
- Deterministic: Same seed + session_id + move_number = Same random sequence
- Consensus-safe: All nodes produce identical results
- Methods: `next_u8()`, `next_u32()`, `next_f32()`, `next_bounded()`, `shuffle()`

**Relevance to Super Mode**: This RNG is already used for all existing super mode multiplier generation (see `super_mode.rs`). The system is production-ready for new multiplier schemes.

### 1.2 Existing Super Mode Implementation

**File**: `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs`

The platform already has a comprehensive super mode system with game-specific multiplier generators:

| Game | Generator Function | Multiplier Count | Range | Type |
|------|-------------------|------------------|-------|------|
| Baccarat (Lightning) | `generate_baccarat_multipliers()` | 3-5 Aura Cards | 2-8x | Card-specific |
| Roulette (Quantum) | `generate_roulette_multipliers()` | 5-7 numbers | 50-500x | Number-specific |
| Blackjack (Strike) | `generate_blackjack_multipliers()` | 5 Strike Cards | 2-10x | Card-specific |
| Craps (Thunder) | `generate_craps_multipliers()` | 3 numbers | 3-25x | Total-specific |
| Sic Bo (Fortune) | `generate_sic_bo_multipliers()` | 3 totals | 3-50x | Total-specific |
| Video Poker (Mega) | `generate_video_poker_multipliers()` | 4 Mega Cards | Count-based | Card-specific |
| Three Card (Flash) | `generate_three_card_multipliers()` | 2 Flash Suits | Config-based | Suit-specific |
| Ultimate Holdem (Blitz) | `generate_uth_multipliers()` | 2 Blitz Ranks | Hand-based | Rank-specific |
| Casino War (Strike) | `generate_casino_war_multipliers()` | 3 Strike Ranks | Scenario-based | Rank-specific |
| HiLo (Super) | `generate_hilo_state()` | Streak-based | 1.5x-200x | Progressive |

**Multiplier Application Functions**:
- `apply_super_multiplier_cards()` - Card-based games (multiplicative stacking)
- `apply_super_multiplier_number()` - Roulette
- `apply_super_multiplier_total()` - Sic Bo
- `apply_video_poker_mega_multiplier()` - Count-based system
- `apply_three_card_flash_multiplier()` - Configuration-based
- `apply_uth_blitz_multiplier()` - Hand-strength-based
- `apply_casino_war_strike_multiplier()` - Scenario-based
- `apply_hilo_streak_multiplier()` - Streak-based progressive

**Aura Meter System** (Cross-game feature):
- Meter fills on "near-misses" (Aura element appeared but player lost)
- At 5/5 meter: Next round becomes "Super Aura Round"
- Enhanced multipliers (1.5x boost) + guaranteed Aura element
- Functions: `update_aura_meter()`, `is_super_aura_round()`, `enhance_multipliers_for_aura_round()`

### 1.3 Fee Collection Mechanism

**File**: `/home/r/Coding/nullsociety/execution/src/casino/mod.rs`

```rust
pub fn get_super_mode_fee(bet: u64) -> u64 {
    bet / 5 // 20%
}
```

The 20% fee is already implemented and used across all super mode variants.

### 1.4 State Transition Architecture

**File**: `/home/r/Coding/nullsociety/execution/src/casino/mod.rs`

```rust
pub enum GameResult {
    Continue(Vec<String>),
    ContinueWithUpdate { payout: i64, logs: Vec<String> },
    Win(u64, Vec<String>),
    Loss(Vec<String>),
    LossWithExtraDeduction(u64, Vec<String>),
    LossPreDeducted(u64, Vec<String>),
    Push(u64, Vec<String>),
}

pub trait CasinoGame {
    fn init(session: &mut GameSession, rng: &mut GameRng) -> GameResult;
    fn process_move(
        session: &mut GameSession,
        payload: &[u8],
        rng: &mut GameRng,
    ) -> Result<GameResult, GameError>;
}
```

**Multi-Phase Game Pattern** (Example: Baccarat):
1. **Init Phase**: Generate super mode multipliers, store in `session.super_mode`
2. **Betting Phase**: Player places bets (atomic batch transaction)
3. **Deal Phase**: Cards dealt, multipliers applied to matching cards
4. **Resolution**: Payout calculated with multiplicative stacking

This pattern is suitable for multi-phase reveals required by Super Mode variants.

---

## 2. Rust Framework Documentation

### 2.1 Random Number Generation (`rand` crate)

**Version**: 0.8.5 (current in workspace)
**Documentation**: [rand - Rust](https://docs.rs/rand/0.8.5/rand/)

#### RngCore Trait

The `rand_core::RngCore` trait is the foundation for all RNG implementations in Rust:

```rust
pub trait RngCore {
    fn next_u32(&mut self) -> u32;
    fn next_u64(&mut self) -> u64;
    fn fill_bytes(&mut self, dest: &mut [u8]);
    fn try_fill_bytes(&mut self, dest: &mut [u8]) -> Result<(), Error> {
        self.fill_bytes(dest);
        Ok(())
    }
}
```

**Implementation Recommendations** ([GitHub - rust-random/rand](https://github.com/rust-random/rand)):
- Implement `Debug` without printing internal state
- Implement `Clone` if possible (never `Copy` - prevents accidental duplicate streams)
- Use `SeedableRng` for deterministic generators (not `Default`)

**Current Implementation**: `GameRng` already implements `RngCore` correctly (lines 253-274 in `mod.rs`).

#### Distribution Sampling

The `rand` crate provides uniform distribution sampling:

```rust
use rand::distributions::{Distribution, Uniform};

let die = Uniform::from(1..=6);
let roll = die.sample(&mut rng);
```

**Relevance to Super Mode**: For weighted multiplier selection, use:

```rust
use rand::distributions::WeightedIndex;
use rand::prelude::*;

let choices = [2, 3, 5, 10, 25];
let weights = [40, 30, 20, 7, 3]; // Percentage weights
let dist = WeightedIndex::new(&weights).unwrap();
let multiplier = choices[dist.sample(&mut rng)];
```

**Note**: The current implementation uses `next_f32()` with threshold checks (e.g., `if roll < 0.35`). This is correct but could be refactored to use `WeightedIndex` for clarity.

### 2.2 Deterministic RNG for Blockchain Consensus

**Research Sources**:
- [Pyth Network - Secure Random Numbers for Blockchains](https://www.pyth.network/blog/secure-random-numbers-for-blockchains)
- [Oasis Random Number Generation](https://oasis.net/blog/oasis-random-number-generation)
- [Solidity Patterns - Randomness](https://fravoll.github.io/solidity-patterns/randomness.html)

**Key Challenge**: Blockchains are deterministic - all validators must reach consensus on state transitions.

**Common Solutions**:
1. **Verifiable Random Functions (VRFs)**: Cryptographic function `f_s(x) = (y, p)` where `y` is random-looking but deterministically computed from input `x` and secret key `s`. Proof `p` verifies correctness.
2. **Commit-Reveal Schemes**: Two-phase protocol where users commit to a value (hash), then reveal after other randomness is committed.
3. **Hash-Chain RNG**: Hash deterministic blockchain state (block hash, timestamp, transaction data) with user input.

**nullsociety's Approach**: Hash-chain using SHA-256 with consensus seed + session ID + move number. This is a valid approach for:
- **Provable Fairness**: Players can verify outcomes by recomputing hashes
- **No Miner Manipulation**: Consensus seed is determined before games start
- **Reproducibility**: Any validator can verify game outcomes

**Security Consideration**: Ensure consensus seed has sufficient entropy and cannot be predicted by participants. The `Seed` type from `commonware-cryptography` likely handles this.

### 2.3 Mathematical Precision with Fixed-Point Arithmetic

**File**: `/home/r/Coding/nullsociety/execution/src/fixed.rs`

The platform likely has a fixed-point arithmetic module for precise decimal calculations without floating-point errors. This is critical for:
- RTP calculations (must be exact for regulatory compliance)
- Payout calculations (no rounding errors that could be exploited)
- Probability computations

**Best Practice**: Always use fixed-point or integer arithmetic for financial calculations. Example:

```rust
// Store 1.5x as 15, divide by 10 when applying
let multiplier = 15u64;
let payout = base_payout.saturating_mul(multiplier) / 10;
```

The super mode implementation already uses this pattern (see `apply_hilo_streak_multiplier()`).

---

## 3. React/TypeScript Frontend Documentation

### 3.1 Animation Libraries for Multiplier Reveals

**Primary Library**: Framer Motion (now "Motion") v11 (2025)
**Documentation**: [Motion — JavaScript & React animation library](https://motion.dev/)

#### Key Features for Casino Reveals

1. **Scroll/Visibility-Based Reveals** ([Motion for React - Install & first React animation](https://motion.dev/docs/react)):
```tsx
import { motion } from "framer-motion";

<motion.div
  initial={{ opacity: 0, scale: 0.8 }}
  whileInView={{ opacity: 1, scale: 1 }}
  viewport={{ once: true }}
  transition={{ duration: 0.5, delay: 0.2 }}
>
  <span className="multiplier">500x</span>
</motion.div>
```

2. **Staggered Children Animations** ([5 Cool Animations in React with Framer Motion](https://salehmubashar.com/blog/5-cool-animations-in-react-with-framer-motion)):
```tsx
const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const item = {
  hidden: { y: 20, opacity: 0 },
  show: { y: 0, opacity: 1 }
};

<motion.ul variants={container} initial="hidden" animate="show">
  {multipliers.map((mult, i) => (
    <motion.li key={i} variants={item}>
      Card: {mult.id}, Multiplier: {mult.multiplier}x
    </motion.li>
  ))}
</motion.ul>
```

3. **Animated Counters** ([Motion Documentation](https://motion.dev/)):
```tsx
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect } from "react";

function AnimatedMultiplier({ value }: { value: number }) {
  const count = useMotionValue(1);
  const rounded = useTransform(count, latest => Math.round(latest));

  useEffect(() => {
    const controls = animate(count, value, { duration: 2 });
    return controls.stop;
  }, [value]);

  return <motion.span>{rounded}</motion.span>;
}
```

4. **View Transition API Integration** ([Motion Blog - React's experimental animations API](https://motion.dev/blog/reacts-experimental-view-transition-api)):
- Works with React Suspense for async state updates
- Allows animations from fallback to content when ready
- Only works with `startTransition` and `<Suspense />`

**Performance in 2025**: v11 includes improved layout animations with better handling of complex transitions in React 19 projects with concurrent rendering.

**Limitation**: Suspense currently doesn't support unmount animations for Fallback components ([GitHub Issue #1193](https://github.com/framer/motion/issues/1193)).

### 3.2 State Management for Multi-Phase Games

**Documentation**:
- [State Machines in React: Advanced State Management](https://medium.com/@ignatovich.dm/state-machines-in-react-advanced-state-management-beyond-redux-33ea20e59b62)
- [TSH - Finite State Machines in React](https://tsh.io/blog/finite-state-machines-in-react)

#### XState for Game Phase Management

**Library**: XState (TypeScript state machine library)

```tsx
import { createMachine, interpret } from 'xstate';

const superModeMachine = createMachine({
  id: 'superMode',
  initial: 'betting',
  states: {
    betting: {
      on: {
        PLACE_BET: 'betting',
        CONFIRM_BETS: 'generating_multipliers'
      }
    },
    generating_multipliers: {
      invoke: {
        src: 'generateMultipliers',
        onDone: {
          target: 'revealing_multipliers',
          actions: 'storeMultipliers'
        }
      }
    },
    revealing_multipliers: {
      after: {
        2000: 'dealing_cards' // Delay for suspense
      }
    },
    dealing_cards: {
      on: {
        CARD_DEALT: 'checking_match',
        ALL_DEALT: 'calculating_payout'
      }
    },
    checking_match: {
      on: {
        MATCH_FOUND: {
          target: 'highlighting_match',
          actions: 'applyMultiplier'
        },
        NO_MATCH: 'dealing_cards'
      }
    },
    highlighting_match: {
      after: {
        1000: 'dealing_cards'
      }
    },
    calculating_payout: {
      type: 'final'
    }
  }
});
```

**Benefits for Super Mode**:
- **Predictability**: Explicit state transitions prevent impossible states
- **Clarity**: Visual state diagrams make game flow obvious
- **Testability**: Test each state and transition independently
- **Async Workflows**: Built-in support for promises and callbacks

#### Alternative: Zustand with Custom Phases

**Library**: Zustand (2025 lightweight state management)
**Documentation**: [Do You Need State Management in 2025?](https://dev.to/saswatapal/do-you-need-state-management-in-2025-react-context-vs-zustand-vs-jotai-vs-redux-1ho)

```tsx
import create from 'zustand';

type GamePhase = 'betting' | 'revealing' | 'dealing' | 'resolving';

interface SuperModeState {
  phase: GamePhase;
  multipliers: SuperMultiplier[];
  matchedCards: number[];
  totalMultiplier: number;
  setPhase: (phase: GamePhase) => void;
  addMultiplier: (mult: SuperMultiplier) => void;
  markMatch: (cardId: number) => void;
}

const useSuperModeStore = create<SuperModeState>((set) => ({
  phase: 'betting',
  multipliers: [],
  matchedCards: [],
  totalMultiplier: 1,
  setPhase: (phase) => set({ phase }),
  addMultiplier: (mult) => set((state) => ({
    multipliers: [...state.multipliers, mult]
  })),
  markMatch: (cardId) => set((state) => {
    const mult = state.multipliers.find(m => m.id === cardId);
    return {
      matchedCards: [...state.matchedCards, cardId],
      totalMultiplier: mult
        ? state.totalMultiplier * mult.multiplier
        : state.totalMultiplier
    };
  })
}));
```

**Current Architecture**: The platform uses custom hooks (e.g., `useBaccarat.ts`, `useRoulette.ts`) with local state. For complex multi-phase reveals, consider:
1. Keep existing hooks for game logic
2. Add Zustand store for UI-specific reveal phases
3. Use Framer Motion for animations

### 3.3 WebSocket Pattern for Real-Time Reveals

**File**: `/home/r/Coding/nullsociety/website/src/hooks/useCasinoConnection.ts`

The platform likely has WebSocket infrastructure for real-time game updates. For multiplier reveals:

```tsx
// Pseudo-code pattern
useEffect(() => {
  if (ws && gamePhase === 'revealing_multipliers') {
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'MULTIPLIER_GENERATED') {
        // Stagger reveal animation
        setTimeout(() => {
          setMultipliers(prev => [...prev, message.multiplier]);
        }, message.index * 200); // 200ms stagger
      }
    });
  }
}, [ws, gamePhase]);
```

**Alternative Pattern**: Since the chain is deterministic, multipliers are generated upfront. Use client-side sequenced reveals:

```tsx
async function revealMultipliersSequentially(mults: SuperMultiplier[]) {
  for (let i = 0; i < mults.length; i++) {
    await new Promise(resolve => setTimeout(resolve, 300));
    setRevealedMultipliers(prev => [...prev, mults[i]]);
  }
}
```

---

## 4. Mathematical Libraries & RTP Verification

### 4.1 RTP Calculation Methodology

**Sources**:
- [eCOGRA - RTP Percentage Testing](https://ecogra.org/services/rtp-percentage-testing/)
- [Gaming Associates - Return-to-Player](https://gamingassociates.com/return-to-player-rtp/)
- [Fair Mathematical Models in Casino Games](https://datafairport.org/fair-mathematical-models-in-casino-games-core-principles/)

**Definition**: RTP (Return to Player) = (Total Returned to Players / Total Wagered) × 100%

**Target RTP**: 95-99% for Super Mode variants

#### Industry Standards (2025)

1. **Statistical Testing**: Chi-square tests compare observed outcomes to expected probabilities
2. **Large Sample Sizes**: eCOGRA uses millions of simulated rounds to verify theoretical RTP
3. **Variance Margins**: Actual RTP must converge to theoretical within acceptable variance
4. **Frequency Analysis**: Each outcome (card, number, total) should appear at expected frequency

#### RTP Calculation for Super Mode

**Base Game RTP + Super Mode Fee Adjustment**:

```rust
// Example: Baccarat base RTP ≈ 98.94% (Player bet)
// Super Mode fee: 20%
// Effective wager: 120% of original bet

// For 95% target RTP on Super Mode:
// Total Return = Base Return + Super Multiplier Return
// 95% = (Base_RTP × 100/120) + (Super_RTP × 100/120)

// Solving for Super_RTP:
// Super_RTP = (95% × 1.2) - (98.94% × 1.0)
// Super_RTP = 114% - 98.94% = 15.06%

// This means super multipliers need to pay out 15.06% of the 20% fee collected
```

**Hit Frequency**: Percentage of rounds where super multiplier triggers
- Lightning Baccarat: 3-5 Aura Cards from 52-card deck
- Quantum Roulette: 5-7 numbers from 37 possibilities
- Strike Blackjack: 5 Strike Cards from 52-card deck

**Expected Value Calculation**:

```rust
// Weighted average of multiplier payouts
fn calculate_ev_multiplier(
    probabilities: &[(u16, f64)], // (multiplier, probability)
    hit_frequency: f64,
) -> f64 {
    let weighted_sum: f64 = probabilities.iter()
        .map(|(mult, prob)| (*mult as f64) * prob)
        .sum();
    weighted_sum * hit_frequency
}

// Example: Lightning Baccarat
// Hit frequency: Player or Banker win = ~45.86% + ~44.62% = 90.48%
// Aura Card in hand: (3-5 cards) / 52 ≈ 7.7% - 9.6% avg 8.65%
// Combined hit: 90.48% × 8.65% ≈ 7.83%

let bacc_mults = vec![
    (2, 0.35), (3, 0.30), (4, 0.20), (5, 0.10), (8, 0.05)
];
let ev_mult = calculate_ev_multiplier(&bacc_mults, 0.0783);
// ev_mult ≈ 3.1x × 7.83% ≈ 0.2427 (24.27% return on super fee)
```

**Cap on Maximum Multipliers**: The current implementation caps Baccarat at 512x to prevent unsustainable payouts from multiplicative stacking (theoretical max 8^5 = 32,768x).

### 4.2 Probability Distribution Libraries

**Rust Crate**: `statrs` (Statistical distributions)
**Documentation**: [statrs - crates.io](https://crates.io/crates/statrs)

```rust
use statrs::distribution::{Binomial, Discrete};

// Calculate probability of k Aura Cards appearing in n-card hand
let n = 5; // cards in hand
let p = 5.0 / 52.0; // 5 Aura Cards in 52-card deck
let dist = Binomial::new(p, n as u64).unwrap();

let prob_at_least_one = 1.0 - dist.pmf(0); // ~41.3%
```

**Alternative**: Hand-calculate probabilities for simpler cases:

```rust
// Hypergeometric distribution (drawing without replacement)
fn hypergeometric_pmf(
    population: u32, // Total cards (52)
    successes: u32,  // Aura Cards (3-5)
    draws: u32,      // Cards drawn (2-3)
    hits: u32,       // Aura Cards in hand (1, 2, etc.)
) -> f64 {
    let choose = |n: u32, k: u32| -> f64 {
        (1..=k).fold(1.0, |acc, i| acc * (n - k + i) as f64 / i as f64)
    };

    choose(successes, hits) * choose(population - successes, draws - hits)
        / choose(population, draws)
}
```

### 4.3 Statistical Testing for RTP Verification

**Method 1: Chi-Square Goodness of Fit**

```rust
use statrs::distribution::{ChiSquared, ContinuousCDF};

fn chi_square_test(
    observed: &[u64],
    expected: &[f64],
) -> (f64, f64) { // (chi_square_stat, p_value)
    let chi_square: f64 = observed.iter()
        .zip(expected.iter())
        .map(|(obs, exp)| {
            let diff = *obs as f64 - exp;
            (diff * diff) / exp
        })
        .sum();

    let df = observed.len() - 1;
    let dist = ChiSquared::new(df as f64).unwrap();
    let p_value = 1.0 - dist.cdf(chi_square);

    (chi_square, p_value)
}

// Usage
let observed_mults = [350, 300, 200, 100, 50]; // Counts of 2x, 3x, 4x, 5x, 8x
let expected_mults = [350.0, 300.0, 200.0, 100.0, 50.0]; // Based on 35%, 30%, 20%, 10%, 5%
let (stat, p) = chi_square_test(&observed_mults, &expected_mults);
// If p > 0.05, distribution is not significantly different from expected
```

**Method 2: Monte Carlo Simulation**

```rust
fn simulate_rtp(
    num_rounds: u64,
    base_bet: u64,
    super_fee: u64,
    rng: &mut GameRng,
) -> f64 {
    let mut total_wagered = 0u64;
    let mut total_returned = 0u64;

    for _ in 0..num_rounds {
        total_wagered += base_bet + super_fee;

        // Simulate game outcome
        let won = rng.next_f32() < 0.5; // Example: 50% win rate
        if won {
            let multipliers = generate_baccarat_multipliers(rng);
            let base_payout = base_bet * 2; // 1:1 payout
            let final_payout = apply_super_multiplier_cards(
                &[rng.next_u8() % 52], // Random card
                &multipliers,
                base_payout,
            );
            total_returned += final_payout;
        }
    }

    (total_returned as f64 / total_wagered as f64) * 100.0
}

// Run simulation
let mut rng = GameRng::new(&seed, 1, 0);
let rtp = simulate_rtp(10_000_000, 100, 20, &mut rng);
println!("Simulated RTP: {:.2}%", rtp);
```

**Method 3: Analytical Calculation**

```rust
fn calculate_theoretical_rtp_super_mode(
    base_rtp: f64,
    super_fee_pct: f64,
    multiplier_ev: f64,
    hit_frequency: f64,
) -> f64 {
    // Weighted RTP including super fee
    let base_weight = 1.0 / (1.0 + super_fee_pct);
    let super_weight = super_fee_pct / (1.0 + super_fee_pct);

    let base_contribution = base_rtp * base_weight;
    let super_contribution = multiplier_ev * hit_frequency * super_weight;

    base_contribution + super_contribution
}

// Example: Lightning Baccarat
let rtp = calculate_theoretical_rtp_super_mode(
    98.94,  // Player bet base RTP
    0.20,   // 20% super fee
    3.1,    // Average multiplier
    0.0783, // Hit frequency
);
// rtp ≈ 82.45% base + 4.04% super ≈ 86.49%
// This is below target - need higher multipliers or hit frequency
```

**Adjustment Strategy**: If theoretical RTP is below target, adjust:
1. Increase multiplier values
2. Increase number of Aura elements (hit frequency)
3. Reduce super fee percentage
4. Add guaranteed minimum multiplier on wins

---

## 5. Testing Frameworks

### 5.1 Property-Based Testing with Proptest

**Documentation**:
- [GitHub - proptest-rs/proptest](https://github.com/proptest-rs/proptest)
- [Property-based testing in Rust with Proptest](https://blog.logrocket.com/property-based-testing-in-rust-with-proptest/)
- [Introduction to Property-Based Testing in Rust](https://lpalmieri.com/posts/an-introduction-to-property-based-testing-in-rust/)

**Why Proptest over QuickCheck**:
- Explicit `Strategy` objects (more flexible than type-based generation)
- Better shrinking algorithm (maintains relationships between values)
- Easier custom generators

#### Example: Testing Super Mode Multiplier Generation

```rust
use proptest::prelude::*;

proptest! {
    #[test]
    fn test_baccarat_multipliers_no_duplicates(
        session_id in 0u64..1000000,
        move_number in 0u32..10000,
    ) {
        let (network_secret, _) = create_network_keypair();
        let seed = create_seed(&network_secret, 1);
        let mut rng = GameRng::new(&seed, session_id, move_number);

        let mults = generate_baccarat_multipliers(&mut rng);

        // Property: All card IDs must be unique
        let mut seen = std::collections::HashSet::new();
        for mult in &mults {
            prop_assert!(seen.insert(mult.id), "Duplicate card ID: {}", mult.id);
        }

        // Property: All cards must be valid (0-51)
        for mult in &mults {
            prop_assert!(mult.id < 52, "Invalid card ID: {}", mult.id);
        }

        // Property: Count must be 3-5
        prop_assert!(mults.len() >= 3 && mults.len() <= 5);

        // Property: Multipliers in valid range
        for mult in &mults {
            prop_assert!(
                mult.multiplier >= 2 && mult.multiplier <= 8,
                "Invalid multiplier: {}",
                mult.multiplier
            );
        }
    }

    #[test]
    fn test_multiplier_distribution_chi_square(
        seed_variant in 0u64..100,
    ) {
        // Property: Over many generations, multiplier distribution should match expected
        let (network_secret, _) = create_network_keypair();
        let seed = create_seed(&network_secret, seed_variant);

        let mut counts = [0u64; 5]; // 2x, 3x, 4x, 5x, 8x
        let num_samples = 10000;

        for i in 0..num_samples {
            let mut rng = GameRng::new(&seed, seed_variant, i);
            let mults = generate_baccarat_multipliers(&mut rng);
            for mult in mults {
                let idx = match mult.multiplier {
                    2 => 0, 3 => 1, 4 => 2, 5 => 3, 8 => 4,
                    _ => continue,
                };
                counts[idx] += 1;
            }
        }

        // Expected distribution: 35%, 30%, 20%, 10%, 5%
        let total: u64 = counts.iter().sum();
        let expected = [
            total as f64 * 0.35,
            total as f64 * 0.30,
            total as f64 * 0.20,
            total as f64 * 0.10,
            total as f64 * 0.05,
        ];

        let (chi_square, p_value) = chi_square_test(&counts, &expected);
        prop_assert!(
            p_value > 0.01, // 99% confidence
            "Distribution significantly different from expected (p={:.4})",
            p_value
        );
    }
}
```

#### Example: Testing RTP Convergence

```rust
proptest! {
    #[test]
    fn test_rtp_converges_to_target(
        seed_variant in 0u64..100,
    ) {
        let (network_secret, _) = create_network_keypair();
        let seed = create_seed(&network_secret, seed_variant);
        let mut rng = GameRng::new(&seed, seed_variant, 0);

        let num_rounds = 100_000;
        let rtp = simulate_rtp(num_rounds, 100, 20, &mut rng);

        // Property: RTP should be within 95-99% range (with tolerance)
        prop_assert!(
            rtp >= 94.0 && rtp <= 100.0,
            "RTP {:.2}% outside acceptable range",
            rtp
        );
    }

    #[test]
    fn test_multiplier_cap_prevents_overflow(
        num_aura_cards in 1usize..=5,
        multipliers in prop::collection::vec(2u16..=8, 1..=5),
    ) {
        // Property: Applying multiple multipliers should never overflow
        let base_payout = 1_000_000u64;

        let mut mults = Vec::new();
        for (i, &mult) in multipliers.iter().enumerate().take(num_aura_cards) {
            mults.push(SuperMultiplier {
                id: i as u8,
                multiplier: mult,
                super_type: SuperType::Card,
            });
        }

        let winning_cards: Vec<u8> = (0..num_aura_cards as u8).collect();
        let final_payout = apply_super_multiplier_cards(
            &winning_cards,
            &mults,
            base_payout,
        );

        // Property: Payout should not overflow
        prop_assert!(final_payout <= u64::MAX);

        // Property: Payout should be reasonable (< 512x cap)
        prop_assert!(
            final_payout <= base_payout * 512,
            "Payout {}x exceeds 512x cap",
            final_payout / base_payout
        );
    }
}
```

### 5.2 Integration Testing for Game Sessions

**Pattern**: Simulate complete game sessions with property checks

```rust
#[test]
fn test_super_mode_baccarat_session() {
    let (network_secret, _) = create_network_keypair();
    let seed = create_seed(&network_secret, 1);
    let mut rng = GameRng::new(&seed, 1, 0);

    // Create session with super mode enabled
    let mut session = GameSession {
        session_id: 1,
        player_id: 1,
        game_type: GameType::Baccarat,
        bet: 100,
        state_blob: vec![],
        super_mode: SuperModeState {
            is_active: true,
            multipliers: generate_baccarat_multipliers(&mut rng),
            streak_level: 0,
        },
    };

    // Place bets (atomic batch)
    let bets = vec![
        BaccaratBet { bet_type: BetType::Player, amount: 100 },
    ];
    let payload = serialize_atomic_batch(&bets);

    let result = Baccarat::process_move(&mut session, &payload, &mut rng);

    match result {
        Ok(GameResult::Win(payout, logs)) => {
            // Check super multiplier was applied
            let base_payout = 200; // 100 bet × 2 (1:1 payout)
            assert!(
                payout >= base_payout,
                "Super mode should boost payout: {} >= {}",
                payout,
                base_payout
            );

            // Check logs mention multiplier
            assert!(
                logs.iter().any(|log| log.contains("multiplier")),
                "Logs should mention multiplier application"
            );
        }
        Ok(GameResult::Loss(_)) => {
            // Loss is valid outcome
        }
        _ => panic!("Unexpected game result"),
    }
}
```

### 5.3 Fuzzing with Proptest for Edge Cases

```rust
proptest! {
    #[test]
    fn test_super_mode_never_panics(
        session_id in 0u64..u64::MAX,
        move_number in 0u32..u32::MAX,
        bet_amount in 1u64..1_000_000,
        num_bets in 1usize..=11,
    ) {
        let (network_secret, _) = create_network_keypair();
        let seed = create_seed(&network_secret, 1);
        let mut rng = GameRng::new(&seed, session_id, move_number);

        // Property: Game should never panic with valid inputs
        let mut session = GameSession {
            session_id,
            player_id: 1,
            game_type: GameType::Baccarat,
            bet: bet_amount,
            state_blob: vec![],
            super_mode: SuperModeState {
                is_active: true,
                multipliers: generate_baccarat_multipliers(&mut rng),
                streak_level: 0,
            },
        };

        // Generate random bets
        let bets: Vec<BaccaratBet> = (0..num_bets)
            .map(|i| BaccaratBet {
                bet_type: BetType::try_from((i % 11) as u8).unwrap(),
                amount: bet_amount / num_bets as u64,
            })
            .collect();

        let payload = serialize_atomic_batch(&bets);

        // Should not panic
        let _ = Baccarat::process_move(&mut session, &payload, &mut rng);
    }
}
```

---

## 6. Implementation Recommendations

### 6.1 Super Mode Variant Design Pattern

Based on the existing codebase, here's the recommended pattern for new Super Mode variants:

#### Step 1: Define Multiplier Generation Function

```rust
/// Generate [YourGame] multipliers ([count] [elements], [range]x)
///
/// Distribution:
/// - [Element count logic]
/// - Multipliers: [percentage breakdown]
/// - Expected multiplier: [avg]x
/// - Hit Frequency: [percentage]
pub fn generate_yourgame_multipliers(rng: &mut GameRng) -> Vec<SuperMultiplier> {
    // 1. Determine count (if variable)
    let roll = rng.next_f32();
    let count = if roll < 0.60 {
        3
    } else if roll < 0.90 {
        4
    } else {
        5
    };

    // 2. Select unique elements
    let mut mults = Vec::with_capacity(count);
    let mut used_elements = 0u64; // Bit set for deduplication

    for _ in 0..count {
        let element = loop {
            let e = rng.next_u8() % TOTAL_ELEMENTS;
            if (used_elements & (1 << e)) == 0 {
                used_elements |= 1 << e;
                break e;
            }
        };

        // 3. Assign multiplier based on probability
        let m_roll = rng.next_f32();
        let multiplier = if m_roll < 0.40 {
            2
        } else if m_roll < 0.70 {
            3
        } else if m_roll < 0.90 {
            5
        } else if m_roll < 0.97 {
            10
        } else {
            25
        };

        mults.push(SuperMultiplier {
            id: element,
            multiplier,
            super_type: SuperType::YourType,
        });
    }

    mults
}
```

#### Step 2: Define Application Function

```rust
/// Apply [YourGame] super multiplier based on [logic]
///
/// Returns the boosted payout if [condition].
pub fn apply_yourgame_multiplier(
    outcome_data: &[u8],
    multipliers: &[SuperMultiplier],
    base_payout: u64,
    additional_context: bool,
) -> u64 {
    // 1. Check if multiplier applies
    let has_match = outcome_data.iter().any(|data| {
        multipliers.iter().any(|m| {
            m.super_type == SuperType::YourType && *data == m.id
        })
    });

    if !has_match {
        return base_payout;
    }

    // 2. Calculate multiplier (simple, count-based, or config-based)
    let total_mult: u64 = match MULTIPLIER_STYLE {
        MultiplierStyle::Simple => {
            // Single multiplier applies
            multipliers.iter()
                .find(|m| outcome_data.contains(&m.id))
                .map(|m| m.multiplier as u64)
                .unwrap_or(1)
        }
        MultiplierStyle::Multiplicative => {
            // Stack multipliers multiplicatively
            outcome_data.iter()
                .filter_map(|data| {
                    multipliers.iter()
                        .find(|m| *data == m.id)
                        .map(|m| m.multiplier as u64)
                })
                .fold(1u64, |acc, mult| acc.saturating_mul(mult))
        }
        MultiplierStyle::CountBased => {
            // Multiplier based on count of matches
            let count = outcome_data.iter()
                .filter(|data| multipliers.iter().any(|m| **data == m.id))
                .count();
            match count {
                0 => 1,
                1 => 2,
                2 => 5,
                3 => 10,
                _ => 25,
            }
        }
    };

    // 3. Apply with overflow protection
    base_payout.saturating_mul(total_mult)
}
```

#### Step 3: Integrate with Game Logic

```rust
impl CasinoGame for YourGame {
    fn init(session: &mut GameSession, rng: &mut GameRng) -> GameResult {
        // Generate super multipliers if enabled
        if session.super_mode.is_active {
            session.super_mode.multipliers = generate_yourgame_multipliers(rng);
        }

        // Initialize game state
        let state = YourGameState::new();
        session.state_blob = state.to_blob();

        GameResult::Continue(vec![
            "Game initialized".to_string(),
            format_super_mode_info(&session.super_mode),
        ])
    }

    fn process_move(
        session: &mut GameSession,
        payload: &[u8],
        rng: &mut GameRng,
    ) -> Result<GameResult, GameError> {
        // ... game logic ...

        // When calculating payout
        let mut final_payout = base_payout;

        if session.super_mode.is_active {
            final_payout = apply_yourgame_multiplier(
                &outcome_data,
                &session.super_mode.multipliers,
                base_payout,
                additional_context,
            );
        }

        Ok(GameResult::Win(final_payout, logs))
    }
}
```

### 6.2 RTP Optimization Process

1. **Calculate Theoretical RTP**:
   - Base game RTP (from Wizard of Odds)
   - Super fee percentage (20%)
   - Hit frequency (probability multiplier triggers)
   - Average multiplier value

2. **Target RTP Range**: 95-99%

3. **Adjustment Levers**:
   - Increase multiplier values (e.g., 2-10x → 2-15x)
   - Increase number of Aura elements (e.g., 3-5 → 4-6)
   - Adjust probability distribution (more high multipliers)
   - Add guaranteed minimum on wins (e.g., all wins get at least 1.5x)

4. **Validation**:
   - Run Monte Carlo simulation (10M+ rounds)
   - Compare simulated RTP to theoretical
   - Ensure variance is acceptable
   - Verify distribution with chi-square test

### 6.3 Frontend Integration Pattern

```tsx
// 1. State management (Zustand store)
interface SuperModeState {
  phase: 'idle' | 'generating' | 'revealing' | 'playing' | 'resolved';
  multipliers: SuperMultiplier[];
  revealedMultipliers: SuperMultiplier[];
  matchedElements: number[];
  totalMultiplier: number;
}

// 2. Reveal sequence hook
function useMultiplierReveal(multipliers: SuperMultiplier[]) {
  const [revealed, setRevealed] = useState<SuperMultiplier[]>([]);

  useEffect(() => {
    if (multipliers.length === 0) return;

    const revealNext = async () => {
      for (let i = 0; i < multipliers.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 300));
        setRevealed(prev => [...prev, multipliers[i]]);
      }
    };

    revealNext();
  }, [multipliers]);

  return revealed;
}

// 3. Animation components
function MultiplierCard({ multiplier, index }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 50, rotateX: -90 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{
        delay: index * 0.2,
        duration: 0.5,
        type: "spring",
        stiffness: 200
      }}
      className="multiplier-card"
    >
      <div className="element">
        {formatElement(multiplier.id, multiplier.super_type)}
      </div>
      <div className="value">
        <AnimatedNumber value={multiplier.multiplier} />x
      </div>
    </motion.div>
  );
}

// 4. Game integration
function SuperModeBaccarat() {
  const { session, makeMove } = useCasinoConnection();
  const [phase, setPhase] = useState<GamePhase>('betting');

  const revealed = useMultiplierReveal(
    session?.super_mode?.multipliers || []
  );

  const handleDeal = async () => {
    setPhase('revealing');

    // Wait for multipliers to reveal
    await new Promise(resolve =>
      setTimeout(resolve, revealed.length * 300 + 500)
    );

    setPhase('playing');

    // Send atomic batch payload
    const payload = serializeBaccaratAtomicBatch(bets);
    await makeMove(payload);
  };

  return (
    <div>
      {phase === 'revealing' && (
        <div className="multiplier-reveal">
          {revealed.map((mult, i) => (
            <MultiplierCard key={i} multiplier={mult} index={i} />
          ))}
        </div>
      )}
      {/* ... game UI ... */}
    </div>
  );
}
```

### 6.4 Testing Checklist

- [ ] **Unit Tests**: Each multiplier generation function
- [ ] **Unit Tests**: Each multiplier application function
- [ ] **Property Tests**: No duplicate elements
- [ ] **Property Tests**: Valid ranges for multipliers and elements
- [ ] **Property Tests**: Distribution matches expected probabilities
- [ ] **Property Tests**: No overflow on payout calculation
- [ ] **Integration Tests**: Complete game sessions with super mode
- [ ] **Simulation Tests**: 1M+ rounds, verify RTP in range
- [ ] **Simulation Tests**: Chi-square test for distribution
- [ ] **Edge Case Tests**: Minimum bet, maximum bet
- [ ] **Edge Case Tests**: All elements match (maximum multiplier)
- [ ] **Edge Case Tests**: No elements match (1x multiplier)
- [ ] **Fuzzing**: Random inputs don't cause panics

---

## 7. References & Sources

### Rust Ecosystem
- [rand - Rust Random Number Generation](https://github.com/rust-random/rand)
- [rand_core::RngCore Trait](https://rust-random.github.io/rand/rand_core/trait.RngCore.html)
- [proptest - Property-Based Testing](https://github.com/proptest-rs/proptest)
- [Property-based testing in Rust with Proptest - LogRocket](https://blog.logrocket.com/property-based-testing-in-rust-with-proptest/)
- [Introduction to Property-Based Testing in Rust](https://lpalmieri.com/posts/an-introduction-to-property-based-testing-in-rust/)

### Blockchain RNG
- [Pyth Network - Secure Random Numbers for Blockchains](https://www.pyth.network/blog/secure-random-numbers-for-blockchains)
- [Oasis Random Number Generation](https://oasis.net/blog/oasis-random-number-generation)
- [Solidity Patterns - Randomness](https://fravoll.github.io/solidity-patterns/randomness.html)

### React/TypeScript
- [Motion — JavaScript & React animation library](https://motion.dev/)
- [Motion for React - Documentation](https://motion.dev/docs/react)
- [Motion Blog - React's experimental View Transition API](https://motion.dev/blog/reacts-experimental-view-transition-api)
- [5 Cool Animations in React with Framer Motion](https://salehmubashar.com/blog/5-cool-animations-in-react-with-framer-motion)
- [State Machines in React: Advanced State Management](https://medium.com/@ignatovich.dm/state-machines-in-react-advanced-state-management-beyond-redux-33ea20e59b62)
- [TSH - Finite State Machines in React](https://tsh.io/blog/finite-state-machines-in-react)
- [Do You Need State Management in 2025?](https://dev.to/saswatapal/do-you-need-state-management-in-2025-react-context-vs-zustand-vs-jotai-vs-redux-1ho)

### RTP & Statistical Testing
- [eCOGRA - RTP Percentage Testing](https://ecogra.org/services/rtp-percentage-testing/)
- [Gaming Associates - Return-to-Player](https://gamingassociates.com/return-to-player-rtp/)
- [Fair Mathematical Models in Casino Games](https://datafairport.org/fair-mathematical-models-in-casino-games-core-principles/)

---

## 8. Appendix: Current Super Mode Implementation Summary

### Multiplier Generators (by game)

| Function | File Location | Line Range |
|----------|---------------|------------|
| `generate_baccarat_multipliers()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 18-63 |
| `generate_roulette_multipliers()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 66-105 |
| `generate_blackjack_multipliers()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 115-149 |
| `generate_craps_multipliers()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 152-187 |
| `generate_sic_bo_multipliers()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 190-218 |
| `generate_video_poker_multipliers()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 235-256 |
| `generate_three_card_multipliers()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 318-340 |
| `generate_uth_multipliers()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 404-426 |
| `generate_casino_war_multipliers()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 511-532 |
| `generate_hilo_state()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 592-616 |

### Application Functions

| Function | File Location | Line Range |
|----------|---------------|------------|
| `apply_super_multiplier_cards()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 646-668 |
| `apply_super_multiplier_number()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 673-684 |
| `apply_super_multiplier_total()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 689-700 |
| `apply_video_poker_mega_multiplier()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 262-303 |
| `apply_three_card_flash_multiplier()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 346-384 |
| `apply_uth_blitz_multiplier()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 448-497 |
| `apply_casino_war_strike_multiplier()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 538-571 |
| `apply_hilo_streak_multiplier()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 621-640 |

### Aura Meter System

| Function | File Location | Line Range |
|----------|---------------|------------|
| `update_aura_meter()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 717-728 |
| `is_super_aura_round()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 735-737 |
| `reset_aura_meter()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 740-742 |
| `enhance_multipliers_for_aura_round()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 747-752 |
| `check_aura_element_presence()` | `/home/r/Coding/nullsociety/execution/src/casino/super_mode.rs` | 758-798 |

### Type Definitions

| Type | File Location | Line Range |
|------|---------------|------------|
| `SuperType` enum | `/home/r/Coding/nullsociety/types/src/casino/game.rs` | 54-86 |
| `SuperMultiplier` struct | `/home/r/Coding/nullsociety/types/src/casino/game.rs` | 89-120 |
| `SuperModeState` struct | `/home/r/Coding/nullsociety/types/src/casino/game.rs` | 123-156 |

---

**End of Research Document**
