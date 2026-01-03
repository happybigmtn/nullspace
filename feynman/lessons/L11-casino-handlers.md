# L11 - Casino handlers (state transitions + events) (from scratch)

Focus file: `execution/src/layer/handlers/casino.rs`

Goal: explain how casino actions update player state, sessions, leaderboards, tournaments, and global table rounds. For every excerpt, you will see **why it matters** and a **plain description of what the code does**. We only explain syntax when it is genuinely tricky.

---

## Concepts from scratch (expanded)

### 1) Player state in this file
A player has multiple balances and lifecycle flags:
- **Cash chips** (normal play),
- **Tournament chips** (freeroll sessions only),
- **Freeroll credits** (non‑transferable rewards that vest over time),
- **Modifiers** (shield/double/super),
- **Session history** (played sessions, last deposit time, etc).

### 2) Sessions are the unit of gameplay
A `GameSession` tracks one game round:
- the game type,
- the bet size,
- the state blob (game-specific bytes),
- move count,
- completion status,
- whether it is part of a tournament.

### 3) Modifiers and super mode
Modifiers change payout mechanics:
- **Shield** can prevent a loss,
- **Double** can double a win,
- **Super** changes odds and adds a fee.
Super mode and aura meter are tracked separately and can change multipliers.

### 4) Tournaments and freeroll credits
Tournaments create a separate economy:
- players receive tournament chips,
- prizes are paid as **freeroll credits** (not cash),
- credits can vest gradually and expire after inactivity.

### 5) Global table (live craps)
The global table is a shared round:
- Admin opens the round,
- players submit bets,
- admin reveals the outcome,
- players settle,
- admin finalizes into cooldown.

### 6) House PnL and leaderboards
The house tracks net profit and progressive jackpots. Leaderboards track player rankings in both cash and tournament contexts.

---

## Limits & management callouts (important)

1) **Time is derived from block view**
- This file assumes `1 view = ~3 seconds` by using `seed_view * 3`.
- If block time changes, all time-based rules (cooldowns, expiries) change too.

2) **Faucet limits**
- Uses constants like `FAUCET_MIN_ACCOUNT_AGE_SECS`, `FAUCET_MIN_SESSIONS`, and `FAUCET_RATE_LIMIT`.
- Daily faucet is enforced by day boundary (`/ 86_400`).
- If these are too strict, onboarding feels broken; too loose, faucet abuse rises.

3) **Tournament limits**
- `TOURNAMENT_JOIN_COOLDOWN_SECS` enforces a cooldown between joins.
- `FREEROLL_DAILY_LIMIT_FREE` / `FREEROLL_DAILY_LIMIT_TRIAL` cap daily tournaments.
- New accounts get a stricter daily limit (`ACCOUNT_TIER_NEW_SECS`).

4) **Tournament duration is fixed**
- `TOURNAMENT_DURATION_SECS` is enforced even if clients send other end times.
- This prevents payout abuse via shortened or extended tournaments.

5) **Prize pool emissions are capped**
- Emission is based on `TOTAL_SUPPLY`, `ANNUAL_EMISSION_RATE_BPS`, `TOURNAMENTS_PER_DAY`.
- Reward pool is capped by `REWARD_POOL_BPS` of total supply.

6) **Global table bet limits**
- Enforces `min_bet`, `max_bet`, `max_bets_per_round` from config.
- Totals list is capped at 64 entries (hardcoded in this file).

7) **Progressive jackpot parsing is layout-dependent**
- Helper parsers assume exact offsets in `state_blob`.
- Changing game state layout requires updating these offsets.

---

## Walkthrough with code excerpts

### 1) Freeroll credit vesting
```rust
fn settle_freeroll_credits(
    player: &mut nullspace_types::casino::Player,
    now: u64,
) {
    let locked = player.balances.freeroll_credits_locked;
    let start = player.balances.freeroll_credits_unlock_start_ts;
    let end = player.balances.freeroll_credits_unlock_end_ts;
    if locked == 0 || start == 0 || end <= start || now <= start {
        return;
    }
    let duration = end.saturating_sub(start);
    if duration == 0 {
        return;
    }
    let elapsed = now.saturating_sub(start).min(duration);
    let unlocked = (locked as u128)
        .saturating_mul(elapsed as u128)
        .checked_div(duration as u128)
        .unwrap_or(0) as u64;
    if unlocked > 0 {
        player.balances.freeroll_credits_locked =
            player.balances.freeroll_credits_locked.saturating_sub(unlocked);
        player.balances.freeroll_credits =
            player.balances.freeroll_credits.saturating_add(unlocked);
    }
    if now >= end {
        player.balances.freeroll_credits_locked = 0;
        player.balances.freeroll_credits_unlock_start_ts = 0;
        player.balances.freeroll_credits_unlock_end_ts = 0;
    } else {
        player.balances.freeroll_credits_unlock_start_ts = now;
    }
}
```

Why this matters:
- Freeroll credits must vest over time to prevent instant cash‑out behavior.

What this code does:
- Computes how much of the locked credits should unlock based on elapsed time.
- Moves that amount into the spendable balance.
- If the vesting period is complete, clears the vesting schedule; otherwise updates the start timestamp.

---

### 2) Expire + award freeroll credits
```rust
fn expire_freeroll_credits(
    player: &mut nullspace_types::casino::Player,
    now: u64,
    policy: &nullspace_types::casino::PolicyState,
) {
    let last_ts = player.tournament.last_tournament_ts;
    if last_ts == 0 {
        return;
    }
    if now.saturating_sub(last_ts) < policy.credit_expiry_secs {
        return;
    }
    player.balances.freeroll_credits = 0;
    player.balances.freeroll_credits_locked = 0;
    player.balances.freeroll_credits_unlock_start_ts = 0;
    player.balances.freeroll_credits_unlock_end_ts = 0;
}

fn award_freeroll_credits(
    player: &mut nullspace_types::casino::Player,
    amount: u64,
    now: u64,
    policy: &nullspace_types::casino::PolicyState,
) {
    if amount == 0 {
        return;
    }
    expire_freeroll_credits(player, now, policy);
    settle_freeroll_credits(player, now);

    let immediate = (amount as u128)
        .saturating_mul(policy.credit_immediate_bps as u128)
        .checked_div(10_000)
        .unwrap_or(0) as u64;
    let locked = amount.saturating_sub(immediate);

    if immediate > 0 {
        player.balances.freeroll_credits =
            player.balances.freeroll_credits.saturating_add(immediate);
    }
    if locked > 0 {
        if player.balances.freeroll_credits_locked == 0 {
            player.balances.freeroll_credits_unlock_start_ts = now;
            player.balances.freeroll_credits_unlock_end_ts =
                now.saturating_add(policy.credit_vest_secs);
        } else {
            let desired_end = now.saturating_add(policy.credit_vest_secs);
            if player.balances.freeroll_credits_unlock_end_ts < desired_end {
                player.balances.freeroll_credits_unlock_end_ts = desired_end;
            }
            if player.balances.freeroll_credits_unlock_start_ts == 0 {
                player.balances.freeroll_credits_unlock_start_ts = now;
            }
        }
        player.balances.freeroll_credits_locked =
            player.balances.freeroll_credits_locked.saturating_add(locked);
    }
}
```

Why this matters:
- Rewards are only meaningful if they are enforced consistently across all players.

What this code does:
- Expires credits if the player has been inactive past the policy expiry window.
- Splits new rewards into immediate vs locked portions using basis points.
- Extends or initializes a vesting schedule for the locked portion.

---

### 3) Play session tracking + proof‑of‑play multiplier
```rust
fn record_play_session(
    player: &mut nullspace_types::casino::Player,
    session: &nullspace_types::casino::GameSession,
    now: u64,
) {
    let created_at_secs = session.created_at.saturating_mul(3);
    let duration_secs = now.saturating_sub(created_at_secs).max(1);
    player.session.sessions_played = player.session.sessions_played.saturating_add(1);
    player.session.play_seconds = player.session.play_seconds.saturating_add(duration_secs);
    player.session.last_session_ts = now;
}

fn proof_of_play_multiplier(
    player: &nullspace_types::casino::Player,
    now: u64,
) -> u128 {
    // ... compute session and age weights ...
}
```

Why this matters:
- Tournament rewards depend on a player’s engagement. This prevents “one‑shot” farming.

What this code does:
- Computes session duration based on block time and increments play counters.
- Uses sessions played, play seconds, and account age to calculate a multiplier.
- The multiplier later weights tournament prize distribution.

---

### 4) Player registry and common error helpers
```rust
async fn ensure_player_registry(&mut self, public: &PublicKey) -> anyhow::Result<()> {
    let mut registry = self.get_or_init_player_registry().await?;
    if registry.players.iter().any(|pk| pk == public) {
        return Ok(());
    }
    registry.players.push(public.clone());
    registry.players.sort_unstable();
    registry.players.dedup();
    self.insert(Key::PlayerRegistry, Value::PlayerRegistry(registry));
    Ok(())
}

async fn casino_player_or_error(
    &mut self,
    public: &PublicKey,
    session_id: Option<u64>,
) -> anyhow::Result<Result<nullspace_types::casino::Player, Vec<Event>>> {
    match self.get(Key::CasinoPlayer(public.clone())).await? {
        Some(Value::CasinoPlayer(player)) => Ok(Ok(player)),
        _ => Ok(Err(casino_error_vec(
            public,
            session_id,
            nullspace_types::casino::ERROR_PLAYER_NOT_FOUND,
            "Player not found",
        ))),
    }
}
```

Why this matters:
- Centralized helpers prevent inconsistent error behavior across handlers.

What this code does:
- Ensures a player is registered in the global registry.
- Provides a shared “get or error event” helper for missing players.

---

### 5) Register a player
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
- Registration creates the on-chain player record. Everything else depends on it.

What this code does:
- Rejects duplicate registrations.
- Creates a player struct and stamps the creation time.
- Inserts the player into state and the global registry.
- Emits a registration event and (optionally) a leaderboard update.

---

### 6) Faucet deposit with rate limiting
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

    let current_block = self.seed_view;
    let current_time_sec = current_block.saturating_mul(3);
    let account_age = if player.profile.created_ts == 0 {
        0
    } else {
        current_time_sec.saturating_sub(player.profile.created_ts)
    };
    if account_age < nullspace_types::casino::FAUCET_MIN_ACCOUNT_AGE_SECS
        && player.session.sessions_played < nullspace_types::casino::FAUCET_MIN_SESSIONS
    {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_RATE_LIMITED,
            "Faucet locked until you have some play time",
        ));
    }
    // ... cooldown and daily limit checks ...

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
- Faucet abuse is an easy attack. These checks protect the test economy.

What this code does:
- Enforces account age and play-time requirements before faucet claims.
- Enforces per-block and per-day cooldowns.
- Credits chips and emits a deposit event (and leaderboard update).

---

### 7) Start game: bet checks, session creation, super mode init
```rust
pub(in crate::layer) async fn handle_casino_start_game(
    &mut self,
    public: &PublicKey,
    game_type: nullspace_types::casino::GameType,
    bet: u64,
    session_id: u64,
) -> anyhow::Result<Vec<Event>> {
    let mut player = match self
        .casino_player_or_error(public, Some(session_id))
        .await?
    {
        Ok(player) => player,
        Err(events) => return Ok(events),
    };

    // Determine play mode (cash vs tournament)
    let mut is_tournament = false;
    let mut tournament_id = None;
    if let Some(active_tid) = player.tournament.active_tournament {
        if let Some(Value::Tournament(t)) = self.get(Key::Tournament(active_tid)).await? {
            if matches!(t.phase, nullspace_types::casino::TournamentPhase::Active) {
                is_tournament = true;
                tournament_id = Some(active_tid);
            } else {
                player.tournament.active_tournament = None;
            }
        } else {
            player.tournament.active_tournament = None;
        }
    }

    // Some table-style games allow bet=0 at start
    let allows_zero_bet = matches!(
        game_type,
        nullspace_types::casino::GameType::Baccarat
            | nullspace_types::casino::GameType::Craps
            | nullspace_types::casino::GameType::Roulette
            | nullspace_types::casino::GameType::SicBo
    );
    if bet == 0 && !allows_zero_bet {
        return Ok(casino_error_vec(
            public,
            Some(session_id),
            nullspace_types::casino::ERROR_INVALID_BET,
            "Bet must be greater than zero",
        ));
    }

    let wants_super = player.modifiers.active_super;
    let super_fee = if wants_super && bet > 0 {
        crate::casino::get_super_mode_fee(bet)
    } else {
        0
    };
    let required_stack = bet.saturating_add(super_fee);
    let available_stack = if is_tournament {
        player.tournament.chips
    } else {
        player.balances.chips
    };
    if available_stack < required_stack {
        return Ok(casino_error_vec(
            public,
            Some(session_id),
            nullspace_types::casino::ERROR_INSUFFICIENT_FUNDS,
            format!(
                "Insufficient chips: have {}, need {}",
                available_stack, required_stack
            ),
        ));
    }

    // ... create session, initialize RNG/game, emit GameStarted event ...
}
```

Why this matters:
- Starting a game is where bets are validated, chips are reserved, and sessions are created. If this is wrong, the economy breaks.

What this code does:
- Loads the player and determines if the session is tournament or cash.
- Enforces bet rules, including special cases for table games.
- Calculates a super‑mode fee and ensures the player can afford it.
- Creates a new session, initializes RNG, and emits a `CasinoGameStarted` event.

---

### 8) Game move execution (high level)
```rust
pub(in crate::layer) async fn handle_casino_game_move(
    &mut self,
    public: &PublicKey,
    session_id: u64,
    payload: &[u8],
) -> anyhow::Result<Vec<Event>> {
    let mut session = match self
        .casino_session_owned_active_or_error(public, session_id)
        .await?
    {
        Ok(session) => session,
        Err(events) => return Ok(events),
    };
    let now = self.seed_view.saturating_mul(3);

    session.move_count += 1;
    let mut rng = crate::casino::GameRng::new(&self.seed, session_id, session.move_count);

    let result = match crate::casino::process_game_move(&mut session, payload, &mut rng) {
        Ok(r) => r,
        Err(_) => {
            return Ok(casino_error_vec(
                public,
                Some(session_id),
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Invalid game move",
            ));
        }
    };

    let result = self
        .apply_progressive_meters_for_completion(&session, result)
        .await?;

    // ... handle Continue / ContinueWithUpdate / Win / Push / Loss ...
}
```

Why this matters:
- This is the heart of gameplay. It applies each move, updates balances, and emits events.

What this code does:
- Loads and validates the session.
- Advances move count and runs the game engine with a deterministic RNG.
- Applies progressive jackpots if the game completed.
- Branches into different payout logic depending on the result (continue, win, push, loss).

---

### 9) Modifiers: shield/double/super toggles
```rust
pub(in crate::layer) async fn handle_casino_player_action(
    &mut self,
    public: &PublicKey,
    action: nullspace_types::casino::PlayerAction,
) -> anyhow::Result<Vec<Event>> {
    use nullspace_types::casino::PlayerAction;

    let mut player = match self.casino_player_or_error(public, None).await? {
        Ok(player) => player,
        Err(events) => return Ok(events),
    };

    match action {
        PlayerAction::ToggleShield | PlayerAction::ToggleDouble => {
            let is_in_active_tournament = match player.tournament.active_tournament {
                Some(tid) => match self.get(Key::Tournament(tid)).await? {
                    Some(Value::Tournament(t)) => {
                        t.phase == nullspace_types::casino::TournamentPhase::Active
                    }
                    _ => false,
                },
                None => false,
            };

            if !is_in_active_tournament {
                return Ok(casino_error_vec(
                    public,
                    None,
                    nullspace_types::casino::ERROR_NOT_IN_TOURNAMENT,
                    "Shield/Double modifiers are only available in active tournaments",
                ));
            }

            if matches!(action, PlayerAction::ToggleShield) {
                player.modifiers.active_shield = !player.modifiers.active_shield;
            } else {
                player.modifiers.active_double = !player.modifiers.active_double;
            }
        }
        PlayerAction::ToggleSuper => {
            player.modifiers.active_super = !player.modifiers.active_super;
        }
    }

    self.insert(
        Key::CasinoPlayer(public.clone()),
        Value::CasinoPlayer(player.clone()),
    );

    Ok(vec![Event::PlayerModifierToggled {
        player: public.clone(),
        action,
        active_shield: player.modifiers.active_shield,
        active_double: player.modifiers.active_double,
        active_super: player.modifiers.active_super,
    }])
}
```

Why this matters:
- Modifiers change payouts, so they must be tightly controlled.

What this code does:
- Enforces tournament-only rules for shield/double.
- Toggles the requested modifier on the player.
- Stores the updated player and emits an event for UI/state sync.

---

### 10) Join tournament (daily limits + cooldown)
```rust
pub(in crate::layer) async fn handle_casino_join_tournament(
    &mut self,
    public: &PublicKey,
    tournament_id: u64,
) -> anyhow::Result<Vec<Event>> {
    let mut player = match self.casino_player_or_error(public, None).await? {
        Ok(player) => player,
        Err(events) => return Ok(events),
    };

    let current_time_sec = self.seed_view * 3;
    let current_day = current_time_sec / 86400;
    let last_played_day = player.tournament.last_tournament_ts / 86400;
    if current_day > last_played_day {
        player.tournament.tournaments_played_today = 0;
    }

    if player.tournament.last_tournament_ts > 0 {
        let since_last =
            current_time_sec.saturating_sub(player.tournament.last_tournament_ts);
        if since_last < nullspace_types::casino::TOURNAMENT_JOIN_COOLDOWN_SECS {
            return Ok(casino_error_vec(
                public,
                None,
                nullspace_types::casino::ERROR_TOURNAMENT_LIMIT_REACHED,
                "Tournament cooldown active, try again later",
            ));
        }
    }

    // ... daily limits and register into tournament ...
}
```

Why this matters:
- Freeroll tournaments are a faucet. This prevents a single account from farming unlimited prizes.

What this code does:
- Resets the daily counter at day boundaries.
- Enforces a cooldown between tournaments.
- Later checks the daily limit and registers the player into the tournament.

---

### 11) Start tournament (admin‑only, emission logic)
```rust
pub(in crate::layer) async fn handle_casino_start_tournament(
    &mut self,
    public: &PublicKey,
    tournament_id: u64,
    start_time_ms: u64,
    end_time_ms: u64,
) -> anyhow::Result<Vec<Event>> {
    if !super::is_admin_public_key(public) {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_UNAUTHORIZED,
            "Unauthorized admin instruction",
        ));
    }

    // Enforce fixed tournament duration
    let expected_duration_ms =
        nullspace_types::casino::TOURNAMENT_DURATION_SECS.saturating_mul(1000);
    let end_time_ms = if end_time_ms >= start_time_ms
        && end_time_ms.saturating_sub(start_time_ms) == expected_duration_ms
    {
        end_time_ms
    } else {
        start_time_ms.saturating_add(expected_duration_ms)
    };

    // Calculate prize pool from emissions
    let total_supply = nullspace_types::casino::TOTAL_SUPPLY as u128;
    let annual_bps = nullspace_types::casino::ANNUAL_EMISSION_RATE_BPS as u128;
    let tournaments_per_day = nullspace_types::casino::TOURNAMENTS_PER_DAY as u128;
    let reward_pool_cap =
        total_supply * nullspace_types::casino::REWARD_POOL_BPS as u128 / 10000;

    // ... compute capped emission and update house issuance ...
}
```

Why this matters:
- Tournament rewards are inflationary. Emission must be capped or the economy breaks.

What this code does:
- Requires admin authorization.
- Forces a fixed tournament duration regardless of client input.
- Calculates a per-tournament emission amount with a global cap.
- Updates house issuance and starts the tournament with a new leaderboard.

---

### 12) End tournament (rankings + payouts)
```rust
pub(in crate::layer) async fn handle_casino_end_tournament(
    &mut self,
    public: &PublicKey,
    tournament_id: u64,
) -> anyhow::Result<Vec<Event>> {
    if !super::is_admin_public_key(public) {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_UNAUTHORIZED,
            "Unauthorized admin instruction",
        ));
    }

    // Gather rankings and proof-of-play weights
    let mut rankings: Vec<(PublicKey, u64, u128)> = Vec::new();
    for player_pk in &tournament.players {
        if let Some(Value::CasinoPlayer(p)) =
            self.get(Key::CasinoPlayer(player_pk.clone())).await?
        {
            let proof_weight = proof_of_play_multiplier(&p, now);
            rankings.push((player_pk.clone(), p.tournament.chips, proof_weight));
        }
    }

    // Determine winners and distribute credits
    // ...
}
```

Why this matters:
- Ending a tournament is where prizes are awarded. This is high‑stakes logic.

What this code does:
- Requires admin authorization and validates tournament phase.
- Computes rankings, then applies proof‑of‑play weighting.
- Distributes the prize pool as freeroll credits.
- Clears tournament flags and emits a `TournamentEnded` event.

---

### 13) Global table init + open round
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
- Global table configuration controls timing and bet limits. Bad config breaks live rounds.

What this code does:
- Restricts configuration to admins only.
- Validates minimum/maximum bets and timing windows.
- Stores the config and initializes a round record if one does not exist.

---

### 14) Global table bet submission (validation + balance changes)
```rust
pub(in crate::layer) async fn handle_global_table_submit_bets(
    &mut self,
    public: &PublicKey,
    game_type: nullspace_types::casino::GameType,
    round_id: u64,
    bets: &[nullspace_types::casino::GlobalTableBet],
) -> anyhow::Result<Vec<Event>> {
    if bets.is_empty() {
        return Ok(vec![Event::GlobalTableBetRejected {
            player: public.clone(),
            round_id,
            error_code: nullspace_types::casino::ERROR_INVALID_BET,
            message: "No bets provided".to_string(),
        }]);
    }

    // ... validate round, phase, and max bet count ...

    for bet in bets {
        if bet.amount < config.min_bet || bet.amount > config.max_bet {
            return Ok(vec![Event::GlobalTableBetRejected {
                player: public.clone(),
                round_id,
                error_code: nullspace_types::casino::ERROR_INVALID_BET,
                message: "Bet amount out of range".to_string(),
            }]);
        }
        // Simulate bet in a working session to compute delta
        // ...
    }

    // Apply balance delta and update totals
    // ...
}
```

Why this matters:
- This is the betting gate for live craps. It enforces fairness and protects balances.

What this code does:
- Validates round state, betting window, and bet count.
- Simulates each bet to compute its net delta.
- Applies the net delta to the player balance and updates house PnL.
- Stores updated player/session/round and emits accepted or rejected events.

---

### 15) Global table reveal + settle + finalize (summary)
```rust
pub(in crate::layer) async fn handle_global_table_reveal(
    &mut self,
    public: &PublicKey,
    game_type: nullspace_types::casino::GameType,
    round_id: u64,
) -> anyhow::Result<Vec<Event>> {
    // admin-only, phase must be Locked
    // RNG seed derived and roll is executed
    // round moves into Payout and emits GlobalTableOutcome
}

pub(in crate::layer) async fn handle_global_table_settle(
    &mut self,
    public: &PublicKey,
    game_type: nullspace_types::casino::GameType,
    round_id: u64,
) -> anyhow::Result<Vec<Event>> {
    // player settlement using roll_seed
    // updates balances and emits GlobalTablePlayerSettled
}

pub(in crate::layer) async fn handle_global_table_finalize(
    &mut self,
    public: &PublicKey,
    game_type: nullspace_types::casino::GameType,
    round_id: u64,
) -> anyhow::Result<Vec<Event>> {
    // admin-only, phase must be Payout and cooldown window is set
}
```

Why this matters:
- These steps drive the live round lifecycle. If any step is wrong, players cannot reconcile outcomes.

What this code does:
- Reveal: derives roll seed, runs a roll, and publishes the round outcome.
- Settle: applies the outcome to each player’s session and balance.
- Finalize: moves the round into cooldown and signals end of round.

---

### 16) Leaderboards and progressive jackpots
```rust
async fn update_casino_leaderboard(
    &mut self,
    public: &PublicKey,
    player: &nullspace_types::casino::Player,
) -> anyhow::Result<Option<Event>> {
    let mut leaderboard = match self.get(Key::CasinoLeaderboard).await? {
        Some(Value::CasinoLeaderboard(lb)) => lb,
        _ => nullspace_types::casino::CasinoLeaderboard::default(),
    };
    let previous = leaderboard.clone();
    leaderboard.update(
        public.clone(),
        player.profile.name.clone(),
        player.balances.chips,
    );
    if leaderboard == previous {
        return Ok(None);
    }
    self.insert(
        Key::CasinoLeaderboard,
        Value::CasinoLeaderboard(leaderboard.clone()),
    );
    Ok(Some(Event::CasinoLeaderboardUpdated { leaderboard }))
}
```

Why this matters:
- Leaderboards are a key UX signal. They must only update when state actually changes.

What this code does:
- Loads or initializes the leaderboard, updates the player’s entry, and only emits an event if the leaderboard changed.

---

### 17) Progressive jackpots (Three Card + UTH)
```rust
async fn apply_three_card_progressive_meter(
    &mut self,
    session: &nullspace_types::casino::GameSession,
    result: crate::casino::GameResult,
) -> anyhow::Result<crate::casino::GameResult> {
    let Some((progressive_bet, player_cards)) =
        parse_three_card_progressive_state(&session.state_blob)
    else {
        return Ok(result);
    };
    if progressive_bet == 0 {
        return Ok(result);
    }

    let mut house = self.get_or_init_house().await?;
    let base = nullspace_types::casino::THREE_CARD_PROGRESSIVE_BASE_JACKPOT;

    let mut jackpot = house.three_card_progressive_jackpot.max(base);
    jackpot = jackpot.saturating_add(progressive_bet);

    let can_adjust = matches!(result, crate::casino::GameResult::Win(..));
    let is_jackpot = can_adjust && is_three_card_mini_royal_spades(&player_cards);
    let delta = if is_jackpot {
        progressive_bet.saturating_mul(jackpot.saturating_sub(base))
    } else {
        0
    };

    house.three_card_progressive_jackpot = if is_jackpot { base } else { jackpot };
    self.insert(Key::House, Value::House(house));

    Ok(match result {
        crate::casino::GameResult::Win(payout, logs) if delta > 0 => {
            crate::casino::GameResult::Win(payout.saturating_add(delta), logs)
        }
        other => other,
    })
}
```

Why this matters:
- Progressive jackpots create large payouts. If the meter or payout logic is wrong, funds can be lost.

What this code does:
- Extracts the progressive bet from the state blob.
- Updates the jackpot meter in the house state.
- If the jackpot condition is met, increases the payout accordingly.

---

### 18) Global table state helpers
```rust
fn default_global_table_round(
    game_type: nullspace_types::casino::GameType,
) -> nullspace_types::casino::GlobalTableRound {
    nullspace_types::casino::GlobalTableRound {
        game_type,
        round_id: 0,
        phase: nullspace_types::casino::GlobalTablePhase::Cooldown,
        phase_ends_at_ms: 0,
        main_point: 0,
        d1: 0,
        d2: 0,
        made_points_mask: 0,
        epoch_point_established: false,
        field_paytable: 0,
        roll_seed: Vec::new(),
        totals: Vec::new(),
    }
}

fn extract_craps_bets(
    blob: &[u8],
) -> Vec<nullspace_types::casino::GlobalTableBet> {
    if blob.len() < 8 || blob[0] != 2 {
        return Vec::new();
    }
    let bet_count = blob[7] as usize;
    let mut bets = Vec::with_capacity(bet_count);
    let mut offset = 8usize;
    for _ in 0..bet_count {
        if offset + 19 > blob.len() {
            break;
        }
        let bet_type = blob[offset];
        let target = blob[offset + 1];
        let amount = u64::from_be_bytes([
            blob[offset + 3],
            blob[offset + 4],
            blob[offset + 5],
            blob[offset + 6],
            blob[offset + 7],
            blob[offset + 8],
            blob[offset + 9],
            blob[offset + 10],
        ]);
        if amount > 0 {
            bets.push(nullspace_types::casino::GlobalTableBet {
                bet_type,
                target,
                amount,
            });
        }
        offset = offset.saturating_add(19);
    }
    bets
}
```

Why this matters:
- Global table state is stored in opaque blobs. These helpers decode them consistently.

What this code does:
- Creates a new default round structure.
- Parses bet data out of a craps session blob with fixed offsets.
- Skips invalid or zero‑amount entries.

---

### 19) Logging game completion
```rust
fn log_game_completion(
    public: &PublicKey,
    session: &nullspace_types::casino::GameSession,
    result: &crate::casino::GameResult,
) {
    let (outcome, payout, loss) = match result {
        crate::casino::GameResult::Win(amount, _) => ("win", Some(*amount), None),
        crate::casino::GameResult::Push(amount, _) => ("push", Some(*amount), None),
        crate::casino::GameResult::Loss(_) => ("loss", None, None),
        crate::casino::GameResult::LossWithExtraDeduction(amount, _) => {
            ("loss_extra", None, Some(*amount))
        }
        crate::casino::GameResult::LossPreDeducted(amount, _) => {
            ("loss_prededucted", None, Some(*amount))
        }
        _ => return,
    };
    tracing::info!(
        player = ?public,
        session_id = session.id,
        game_type = ?session.game_type,
        outcome,
        payout,
        loss,
        "casino game completed"
    );
}
```

Why this matters:
- Logs provide an audit trail for outcomes and payouts, useful for debugging and compliance.

What this code does:
- Normalizes different result types into a small log schema.
- Emits a structured log message with player, session, outcome, and payout/loss info.

---

## Key takeaways
- Casino handlers validate players, sessions, and balances before mutating state.
- Tournaments and freeroll credits have strict limits and time-based rules.
- Global table rounds enforce a strict lifecycle: open -> bet -> lock -> reveal -> settle -> finalize.
- House PnL and leaderboards update on every meaningful balance change.

## Next lesson
L12 - Updates and events: `feynman/lessons/L12-updates-and-events.md`
