# L23 - Casino handlers (register + deposit) (from scratch)

Focus file: `execution/src/layer/handlers/casino.rs`

Goal: explain how register and deposit instructions change on‑chain player state. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Register creates the player record
This allocates the player object and puts them in the registry.

### 2) Deposit is the faucet path
Deposits are rate‑limited and then credited to the player balance.

---

## Walkthrough with code excerpts

### 1) Register handler
```rust
pub(in crate::layer) async fn handle_casino_register(
    &mut self,
    public: &PublicKey,
    name: &str,
) -> anyhow::Result<Vec<Event>> {
    if self
        .get(Key::CasinoPlayer(public.clone()))
        .await?
        .is_some()
    {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_PLAYER_ALREADY_REGISTERED,
            "Player already registered",
        ));
    }

    let mut player = nullspace_types::casino::Player::new(name.to_string());
    let current_time_sec = self.seed_view.saturating_mul(3);
    player.profile.created_ts = current_time_sec;

    self.insert(
        Key::CasinoPlayer(public.clone()),
        Value::CasinoPlayer(player.clone()),
    );
    self.ensure_player_registry(public).await?;

    let mut events = vec![Event::CasinoPlayerRegistered {
        player: public.clone(),
        name: name.to_string(),
    }];
    if let Some(event) = self.update_casino_leaderboard(public, &player).await? {
        events.push(event);
    }

    Ok(events)
}
```

Why this matters:
- Without a player record, no other casino actions can succeed.

What this code does:
- Prevents duplicate registrations.
- Creates a new player, stamps creation time, and inserts into state.
- Emits a registration event and updates the leaderboard.

---

### 2) Deposit handler (faucet)
```rust
pub(in crate::layer) async fn handle_casino_deposit(
    &mut self,
    public: &PublicKey,
    amount: u64,
) -> anyhow::Result<Vec<Event>> {
    let mut player = match self.casino_player_or_error(public, None).await? {
        Ok(player) => player,
        Err(events) => return Ok(events),
    };

    // ... rate limit checks ...

    player.balances.chips = player.balances.chips.saturating_add(amount);
    player.session.last_deposit_block = current_block;

    self.insert(
        Key::CasinoPlayer(public.clone()),
        Value::CasinoPlayer(player.clone()),
    );

    let mut events = vec![Event::CasinoDeposited {
        player: public.clone(),
        amount,
        new_chips: player.balances.chips,
    }];
    if let Some(event) = self.update_casino_leaderboard(public, &player).await? {
        events.push(event);
    }

    Ok(events)
}
```

Why this matters:
- Faucet deposits are a core onboarding feature. If this fails, new users are blocked.

What this code does:
- Loads the player or returns an error event if missing.
- Enforces faucet rate limits (age + cooldown + daily).
- Adds chips and emits a deposit event and leaderboard update.

---

## Key takeaways
- Register creates a player record and updates the leaderboard.
- Deposit adds chips but is protected by multiple rate limits.

## Next lesson
L24 - Register types: `feynman/lessons/L24-register-types.md`
