# E06 - Execution engine internals (game logic) (from scratch)

Focus file: `execution/src/casino/mod.rs`

Goal: explain how the execution engine dispatches game logic and applies modifiers. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) One engine, many games
Each casino game implements the same interface. The execution layer routes to the correct implementation based on `GameType`.

### 2) Deterministic game moves
`process_game_move` takes a session, a payload, and a deterministic RNG. This keeps results reproducible across nodes.

### 3) Modifiers and super mode
Modifiers like shield/double and super mode multipliers adjust payouts after the game result is computed.

---

## Limits & management callouts (important)

1) **Super mode fee is fixed at 20%**
- `get_super_mode_fee` returns `bet / 5`.
- Changing this affects economics and must be coordinated.

2) **Dispatch is exhaustive over GameType**
- If a new game is added, it must be wired into both `init_game` and `process_game_move`.

---

## Walkthrough with code excerpts

### 1) The game interface
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

Why this matters:
- All games must conform to the same contract, which keeps the engine simple.

What this code does:
- Defines the common interface for game modules.
- Ensures each game can initialize and process moves deterministically.

---

### 2) Dispatching initialization
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

Why this matters:
- This is how the engine chooses the correct game logic.

What this code does:
- Routes initialization to the correct game module based on `GameType`.

---

### 3) Dispatching game moves
```rust
pub fn process_game_move(
    session: &mut GameSession,
    payload: &[u8],
    rng: &mut GameRng,
) -> Result<GameResult, GameError> {
    match session.game_type {
        GameType::Baccarat => baccarat::Baccarat::process_move(session, payload, rng),
        GameType::Blackjack => blackjack::Blackjack::process_move(session, payload, rng),
        GameType::CasinoWar => casino_war::CasinoWar::process_move(session, payload, rng),
        GameType::Craps => craps::Craps::process_move(session, payload, rng),
        GameType::HiLo => hilo::HiLo::process_move(session, payload, rng),
        GameType::Roulette => roulette::Roulette::process_move(session, payload, rng),
        GameType::SicBo => sic_bo::SicBo::process_move(session, payload, rng),
        GameType::ThreeCard => three_card::ThreeCardPoker::process_move(session, payload, rng),
        GameType::UltimateHoldem => {
            ultimate_holdem::UltimateHoldem::process_move(session, payload, rng)
        }
        GameType::VideoPoker => video_poker::VideoPoker::process_move(session, payload, rng),
    }
}
```

Why this matters:
- Every move is executed through this single dispatch point.

What this code does:
- Uses the session’s game type to route to the correct processing function.

---

### 4) Applying shield/double modifiers
```rust
pub fn apply_modifiers(player: &mut Player, payout: i64) -> (i64, bool, bool) {
    let mut final_payout = payout;
    let mut was_shielded = false;
    let mut was_doubled = false;

    if payout < 0 && player.modifiers.active_shield && player.modifiers.shields > 0 {
        player.modifiers.shields -= 1;
        final_payout = 0;
        was_shielded = true;
    }

    if payout > 0 && player.modifiers.active_double && player.modifiers.doubles > 0 {
        player.modifiers.doubles -= 1;
        final_payout = payout.saturating_mul(2);
        was_doubled = true;
    }

    player.modifiers.active_shield = false;
    player.modifiers.active_double = false;

    (final_payout, was_shielded, was_doubled)
}
```

Why this matters:
- Modifiers change payout outcomes and must be applied deterministically.

What this code does:
- Applies shield to avoid losses and double to increase wins.
- Resets modifier activation flags after each move.

---

### 5) Super mode fee
```rust
pub fn get_super_mode_fee(bet: u64) -> u64 {
    bet / 5 // 20%
}
```

Why this matters:
- Super mode economics depend on this fee.

What this code does:
- Charges a fixed 20% fee based on bet size.

---

## Key takeaways
- Game logic is modular but dispatched centrally.
- Deterministic RNG is injected into every move.
- Modifiers and super mode adjust outcomes after core logic.

## Next lesson
E07 - RNG + fairness model: `feynman/lessons/E07-rng-fairness.md`
