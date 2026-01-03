# L45 - Global table handlers (on-chain) (from scratch)

Focus file: `execution/src/layer/handlers/casino.rs`

Goal: explain how the on-chain execution layer manages global table rounds for live craps. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Global table vs normal sessions
Normal craps uses a private session per player. Global table uses a shared round with a shared roll result. Players submit bets, the admin reveals the outcome, and then each player settles.

### 2) Admin-controlled phases
The admin key opens, locks, reveals, and finalizes each round. This keeps the round lifecycle consistent across all nodes.

### 3) Deterministic outcome
The reveal step generates a roll seed and processes a roll using the same game logic as normal craps. This makes results deterministic and auditable.

---

## Limits & management callouts (important)

1) **Time is derived from block view**
- `now_ms = seed_view * 3_000` assumes ~3 seconds per view.
- If block timing changes, round timing changes.

2) **Bet caps and limits are enforced here**
- `min_bet`, `max_bet`, and `max_bets_per_round` are enforced on-chain.
- Misconfiguration here will reject valid player bets.

3) **Totals list capped at 64 entries**
- `add_table_total` refuses to grow totals beyond 64.
- This avoids unbounded state growth but may drop rare bet types.

---

## Walkthrough with code excerpts

### 1) Initializing global table config
```rust
pub(in crate::layer) async fn handle_global_table_init(
    &mut self,
    public: &PublicKey,
    config: &nullspace_types::casino::GlobalTableConfig,
) -> anyhow::Result<Vec<Event>> {
    if !super::is_admin_public_key(public) {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_UNAUTHORIZED,
            "Unauthorized admin instruction",
        ));
    }
    if config.min_bet == 0 {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_BET,
            "Minimum bet must be greater than zero",
        ));
    }
    if config.max_bet < config.min_bet {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_BET,
            "Maximum bet must be >= minimum bet",
        ));
    }
    if config.betting_ms == 0
        || config.lock_ms == 0
        || config.payout_ms == 0
        || config.cooldown_ms == 0
    {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_MOVE,
            "Timing windows must be greater than zero",
        ));
    }

    let game_type = config.game_type;
    self.insert(
        Key::GlobalTableConfig(game_type),
        Value::GlobalTableConfig(config.clone()),
    );

    if self
        .get(Key::GlobalTableRound(game_type))
        .await?
        .is_none()
    {
        let round = default_global_table_round(game_type);
        self.insert(
            Key::GlobalTableRound(game_type),
            Value::GlobalTableRound(round),
        );
    }

    Ok(Vec::new())
}
```

Why this matters:
- This sets the authoritative limits and timing for the global table.

What this code does:
- Ensures only the admin can initialize global table config.
- Validates bet and timing constraints.
- Stores the config and initializes a default round if needed.

---

### 2) Opening a new round
```rust
pub(in crate::layer) async fn handle_global_table_open_round(
    &mut self,
    public: &PublicKey,
    game_type: nullspace_types::casino::GameType,
) -> anyhow::Result<Vec<Event>> {
    if !super::is_admin_public_key(public) {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_UNAUTHORIZED,
            "Unauthorized admin instruction",
        ));
    }
    if game_type != nullspace_types::casino::GameType::Craps {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_MOVE,
            "Global table supports craps only",
        ));
    }

    let config = match self.get(Key::GlobalTableConfig(game_type)).await? {
        Some(Value::GlobalTableConfig(config)) => config,
        _ => {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Global table config missing",
            ))
        }
    };

    let now_ms = self.seed_view.saturating_mul(3_000);
    let mut round = match self.get(Key::GlobalTableRound(game_type)).await? {
        Some(Value::GlobalTableRound(round)) => round,
        _ => default_global_table_round(game_type),
    };

    let can_open = round.round_id == 0
        || (matches!(
            round.phase,
            nullspace_types::casino::GlobalTablePhase::Cooldown
        ) && now_ms >= round.phase_ends_at_ms);
    if !can_open {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_MOVE,
            "Round already active",
        ));
    }

    round.round_id = round.round_id.saturating_add(1);
    round.phase = nullspace_types::casino::GlobalTablePhase::Betting;
    round.phase_ends_at_ms = now_ms.saturating_add(config.betting_ms);
    round.roll_seed.clear();

    self.insert(
        Key::GlobalTableRound(game_type),
        Value::GlobalTableRound(round.clone()),
    );

    Ok(vec![Event::GlobalTableRoundOpened { round }])
}
```

Why this matters:
- This starts each new global round and defines the betting window.

What this code does:
- Verifies admin authority and the correct game type.
- Checks the prior round is in cooldown and has ended.
- Advances the round ID and sets the phase to betting.
- Emits a `GlobalTableRoundOpened` event.

---

### 3) Submitting bets to the global table
```rust
pub(in crate::layer) async fn handle_global_table_submit_bets(
    &mut self,
    public: &PublicKey,
    game_type: nullspace_types::casino::GameType,
    round_id: u64,
    bets: &[nullspace_types::casino::GlobalTableBet],
) -> anyhow::Result<Vec<Event>> {
    if game_type != nullspace_types::casino::GameType::Craps {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_MOVE,
            "Global table supports craps only",
        ));
    }

    if bets.is_empty() {
        return Ok(vec![Event::GlobalTableBetRejected {
            player: public.clone(),
            round_id,
            error_code: nullspace_types::casino::ERROR_INVALID_BET,
            message: "No bets provided".to_string(),
        }]);
    }

    let config = match self.get(Key::GlobalTableConfig(game_type)).await? {
        Some(Value::GlobalTableConfig(config)) => config,
        _ => {
            return Ok(vec![Event::GlobalTableBetRejected {
                player: public.clone(),
                round_id,
                error_code: nullspace_types::casino::ERROR_INVALID_MOVE,
                message: "Global table config missing".to_string(),
            }])
        }
    };

    let now_ms = self.seed_view.saturating_mul(3_000);
    let mut round = match self.get(Key::GlobalTableRound(game_type)).await? {
        Some(Value::GlobalTableRound(round)) => round,
        _ => {
            return Ok(vec![Event::GlobalTableBetRejected {
                player: public.clone(),
                round_id,
                error_code: nullspace_types::casino::ERROR_INVALID_MOVE,
                message: "Round not initialized".to_string(),
            }])
        }
    };

    if round.round_id != round_id {
        return Ok(vec![Event::GlobalTableBetRejected {
            player: public.clone(),
            round_id,
            error_code: nullspace_types::casino::ERROR_INVALID_MOVE,
            message: "Round ID mismatch".to_string(),
        }]);
    }

    if !matches!(
        round.phase,
        nullspace_types::casino::GlobalTablePhase::Betting
    ) || now_ms >= round.phase_ends_at_ms
    {
        return Ok(vec![Event::GlobalTableBetRejected {
            player: public.clone(),
            round_id,
            error_code: nullspace_types::casino::ERROR_INVALID_MOVE,
            message: "Betting window closed".to_string(),
        }]);
    }

    // ... validate session, amounts, and balances, then apply
}
```

Why this matters:
- This is where player bets are accepted or rejected on-chain.

What this code does:
- Validates the round, phase, and game type.
- Ensures the betting window is still open.
- Rejects invalid bets with a structured event.

---

### 4) Revealing the outcome
```rust
pub(in crate::layer) async fn handle_global_table_reveal(
    &mut self,
    public: &PublicKey,
    game_type: nullspace_types::casino::GameType,
    round_id: u64,
) -> anyhow::Result<Vec<Event>> {
    if !super::is_admin_public_key(public) {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_UNAUTHORIZED,
            "Unauthorized admin instruction",
        ));
    }

    let config = match self.get(Key::GlobalTableConfig(game_type)).await? {
        Some(Value::GlobalTableConfig(config)) => config,
        _ => {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Global table config missing",
            ))
        }
    };

    let now_ms = self.seed_view.saturating_mul(3_000);
    let mut round = match self.get(Key::GlobalTableRound(game_type)).await? {
        Some(Value::GlobalTableRound(round)) => round,
        _ => {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Round not initialized",
            ))
        }
    };

    if !matches!(
        round.phase,
        nullspace_types::casino::GlobalTablePhase::Locked
    ) || now_ms < round.phase_ends_at_ms
    {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_MOVE,
            "Round not locked",
        ));
    }

    let mut rng = crate::casino::GameRng::new(&self.seed, round.round_id, 0);
    round.roll_seed = rng.state().to_vec();

    let mut table_session = nullspace_types::casino::GameSession {
        id: round.round_id,
        player: public.clone(),
        game_type,
        bet: 0,
        state_blob: vec![],
        move_count: 0,
        created_at: self.seed_view,
        is_complete: false,
        super_mode: nullspace_types::casino::SuperModeState::default(),
        is_tournament: false,
        tournament_id: None,
    };
    let mut init_rng = crate::casino::GameRng::new(&self.seed, round.round_id, 0);
    crate::casino::init_game(&mut table_session, &mut init_rng);
    sync_craps_session_to_table(&mut table_session, &round);

    let seed_bytes: [u8; 32] = round
        .roll_seed
        .as_slice()
        .try_into()
        .unwrap_or([0u8; 32]);
    let mut roll_rng = crate::casino::GameRng::from_state(seed_bytes);
    let _ = crate::casino::process_game_move(&mut table_session, &[2], &mut roll_rng)
        .map_err(|_| anyhow::anyhow!("roll failed"))?;

    if let Some(state) = read_craps_table_state(&table_session.state_blob) {
        round.main_point = state.main_point;
        round.d1 = state.d1;
        round.d2 = state.d2;
        round.made_points_mask = state.made_points_mask;
        round.epoch_point_established = state.epoch_point_established;
        round.field_paytable = state.field_paytable;
    }

    round.phase = nullspace_types::casino::GlobalTablePhase::Payout;
    round.phase_ends_at_ms = now_ms.saturating_add(config.payout_ms);

    self.insert(
        Key::GlobalTableRound(game_type),
        Value::GlobalTableRound(round.clone()),
    );

    Ok(vec![Event::GlobalTableOutcome { round }])
}
```

Why this matters:
- This is where the shared roll outcome is generated and recorded on chain.

What this code does:
- Confirms the round is locked and ready for reveal.
- Generates a roll seed and runs the craps roll in a temp session.
- Copies the resulting state (dice, point, etc) into the round record.
- Emits a `GlobalTableOutcome` event.

---

### 5) Settling a player
```rust
pub(in crate::layer) async fn handle_global_table_settle(
    &mut self,
    public: &PublicKey,
    game_type: nullspace_types::casino::GameType,
    round_id: u64,
) -> anyhow::Result<Vec<Event>> {
    let mut round = match self.get(Key::GlobalTableRound(game_type)).await? {
        Some(Value::GlobalTableRound(round)) => round,
        _ => {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Round not initialized",
            ))
        }
    };

    if round.roll_seed.len() != 32 {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_MOVE,
            "Round outcome not revealed",
        ));
    }

    let mut player = match self.casino_player_or_error(public, None).await? {
        Ok(player) => player,
        Err(events) => return Ok(events),
    };

    let mut player_session = match self
        .get(Key::GlobalTablePlayerSession(game_type, public.clone()))
        .await?
    {
        Some(Value::GlobalTablePlayerSession(session)) => session,
        _ => {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Player not registered for global table",
            ))
        }
    };

    if player_session.last_settled_round.saturating_add(1) != round.round_id {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_INVALID_MOVE,
            "Round already settled or out of order",
        ));
    }

    // ... apply roll result and update balances
}
```

Why this matters:
- Each player must settle after the outcome to finalize their balance changes.

What this code does:
- Ensures the outcome has been revealed and the player is registered.
- Prevents double settlement or out-of-order settlement.
- Proceeds to apply the roll result and update balances.

---

### 6) Totals management helpers
```rust
fn add_table_total(
    totals: &mut Vec<nullspace_types::casino::GlobalTableTotal>,
    bet_type: u8,
    target: u8,
    amount: u64,
) {
    if amount == 0 {
        return;
    }
    if let Some(existing) = totals
        .iter_mut()
        .find(|entry| entry.bet_type == bet_type && entry.target == target)
    {
        existing.amount = existing.amount.saturating_add(amount);
        return;
    }
    if totals.len() >= 64 {
        return;
    }
    totals.push(nullspace_types::casino::GlobalTableTotal {
        bet_type,
        target,
        amount,
    });
}
```

Why this matters:
- Totals are used for UI and auditability. They must stay bounded and accurate.

What this code does:
- Aggregates amounts for each bet type + target.
- Prevents the totals list from growing beyond 64 entries.

---

## Key takeaways
- Global table rounds are controlled by admin instructions.
- Bets are validated and stored in a shared round record.
- Outcomes are computed deterministically and settled per player.

## Next lesson
L46 - Compare live-table vs normal craps: `feynman/lessons/L46-live-vs-normal-craps.md`
