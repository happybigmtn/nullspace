# L30 - Casino handlers (tournament lifecycle) (from scratch)

Focus file: `execution/src/layer/handlers/casino.rs`

Goal: explain how tournaments are joined, started, and ended on chain. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Tournament phases
- **Registration**: players can join.
- **Active**: games are played with tournament chips.
- **Complete**: prizes distributed, tournament closed.

### 2) Freeroll rewards
Prizes are granted as freeroll credits (not cash) and may vest/expire.

---

## Walkthrough with code excerpts

### 1) Join tournament
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

    // cooldown + daily limit checks
    // ...

    let mut tournament = match self.get(Key::Tournament(tournament_id)).await? {
        Some(Value::Tournament(t)) => t,
        _ => nullspace_types::casino::Tournament {
            id: tournament_id,
            phase: nullspace_types::casino::TournamentPhase::Registration,
            start_block: 0,
            start_time_ms: 0,
            end_time_ms: 0,
            players: Vec::new(),
            prize_pool: 0,
            starting_chips: nullspace_types::casino::STARTING_CHIPS,
            starting_shields: nullspace_types::casino::STARTING_SHIELDS,
            starting_doubles: nullspace_types::casino::STARTING_DOUBLES,
            leaderboard: nullspace_types::casino::CasinoLeaderboard::default(),
        },
    };

    if !matches!(
        tournament.phase,
        nullspace_types::casino::TournamentPhase::Registration
    ) {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_TOURNAMENT_NOT_REGISTERING,
            "Tournament is not in registration phase",
        ));
    }

    if !tournament.add_player(public.clone()) {
        return Ok(casino_error_vec(
            public,
            None,
            nullspace_types::casino::ERROR_ALREADY_IN_TOURNAMENT,
            "Already joined this tournament",
        ));
    }

    // update player + tournament records
    // ...

    Ok(vec![Event::PlayerJoined { tournament_id, player: public.clone() }])
}
```

Why this matters:
- Joining is the gateway into tournament play and reward eligibility.

What this code does:
- Enforces cooldown and daily limit checks.
- Creates the tournament record if missing.
- Adds the player to the tournament and emits a join event.

---

### 2) Start tournament
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

    // enforce fixed duration
    let expected_duration_ms =
        nullspace_types::casino::TOURNAMENT_DURATION_SECS.saturating_mul(1000);
    let end_time_ms = if end_time_ms >= start_time_ms
        && end_time_ms.saturating_sub(start_time_ms) == expected_duration_ms
    {
        end_time_ms
    } else {
        start_time_ms.saturating_add(expected_duration_ms)
    };

    // compute prize pool + update players
    // ...

    Ok(vec![Event::TournamentStarted { id: tournament_id, start_block: self.seed_view }])
}
```

Why this matters:
- Starting a tournament mints the prize pool and resets player stacks.

What this code does:
- Requires admin authorization.
- Enforces a fixed duration.
- Calculates prize pool and initializes tournament state.
- Emits a `TournamentStarted` event.

---

### 3) End tournament
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

    if !matches!(
        tournament.phase,
        nullspace_types::casino::TournamentPhase::Active
    ) {
        return Ok(vec![]);
    }

    // compute rankings, distribute freeroll credits
    // reset tournament flags
    // ...

    Ok(vec![Event::TournamentEnded { id: tournament_id, rankings: rankings_summary }])
}
```

Why this matters:
- Ending is when rewards are distributed and the tournament is finalized.

What this code does:
- Requires admin authorization and active phase.
- Calculates rankings and distributes freeroll credits.
- Clears tournament state and emits a `TournamentEnded` event.

---

## Key takeaways
- Tournament lifecycle is strictly enforced by phase checks.
- Start/end actions are admin-only and affect rewards.

## Next lesson
L31 - Tournament types: `feynman/lessons/L31-tournament-types.md`
