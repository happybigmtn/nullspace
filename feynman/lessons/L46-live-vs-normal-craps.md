# L46 - Compare live-table vs normal craps (from scratch)

Focus files: `gateway/src/handlers/craps.ts`, `execution/src/layer/handlers/casino.rs`

Goal: compare the two craps flows end-to-end: normal per-session craps vs live-table (global table) craps. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Normal craps (session-based)
- Each player runs a private `GameSession`.
- Bets and rolls are processed directly in the execution layer.
- The outcome only affects that player’s session.

### 2) Live-table craps (global table)
- Players join a shared round.
- Bets are aggregated and an admin reveals the outcome.
- Each player settles after the round using the shared roll.

### 3) Tradeoffs
- **Normal**: simpler, per-player determinism, fewer admin actions.
- **Live-table**: shared experience, faster feedback, but requires admin orchestration and more complex state.

---

## Limits & management callouts (important)

1) **Normal mode relies on atomic batch payloads**
- If clients do not use the atomic batch, latency and UX degrade.

2) **Live-table mode has more moving parts**
- Requires admin key, global table config, and round orchestration.
- Misconfiguration can stall the table for all players.

3) **Bet limits enforced in different layers**
- Normal mode relies on execution-layer checks.
- Live-table mode enforces additional global table limits.

---

## Walkthrough with code excerpts

### 1) Gateway routing: live vs normal
```rust
switch (msg.type) {
  case 'craps_live_join':
    return this.handleLiveJoin(ctx, msg);
  case 'craps_live_leave':
    return this.handleLiveLeave(ctx, msg);
  case 'craps_live_bet':
    return this.handleLiveBet(ctx, msg);
  case 'craps_bet':
    return this.handleBet(ctx, msg);
  case 'craps_roll':
    return this.handleBet(ctx, msg);
  default:
    return {
      success: false,
      error: createError(ErrorCodes.INVALID_MESSAGE, `Unknown craps message: ${msg.type}`),
    };
}
```

Why this matters:
- This switch decides which flow the player enters.

What this code does:
- Sends live-table requests to the live-table handlers.
- Sends normal bets/rolls to the on-chain session flow.

---

### 2) Normal mode: per-session move handling
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
    let payload_len = payload.len();
    let payload_action = payload.first().copied();

    session.move_count += 1;
    let mut rng = crate::casino::GameRng::new(&self.seed, session_id, session.move_count);

    let result = match crate::casino::process_game_move(&mut session, payload, &mut rng) {
        Ok(r) => r,
        Err(err) => {
            tracing::warn!(
                player = ?public,
                session_id = session_id,
                game_type = ?session.game_type,
                payload_len = payload_len,
                payload_action = payload_action,
                ?err,
                "casino move rejected"
            );
            return Ok(casino_error_vec(
                public,
                Some(session_id),
                nullspace_types::casino::ERROR_INVALID_MOVE,
                "Invalid game move",
            ));
        }
    };

    // ... update balances and emit events
}
```

Why this matters:
- This is the canonical flow for normal craps: a single player’s session advances.

What this code does:
- Loads the session owned by the player.
- Runs the move through the game engine with deterministic RNG.
- Emits success or error events for that one player.

---

### 3) Live-table mode: submitting to a shared round
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

    // ... check config, phase, balances, then apply
}
```

Why this matters:
- In live-table mode, bets are attached to a shared round instead of a private session.

What this code does:
- Validates the game type and bet list.
- Rejects bad requests with a global-table-specific event.
- Later in the function, applies bets and updates the shared round state.

---

### 4) Live-table mode: settling after a shared outcome
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

    // ... apply roll outcome to the player’s session and update balances
}
```

Why this matters:
- Live-table mode requires a separate settlement step for each player.

What this code does:
- Confirms the round outcome exists.
- Applies the shared roll result to the player’s session.
- Updates balances and emits settlement events.

---

## Key takeaways
- Normal craps is private and session-based.
- Live-table craps is shared and round-based, with extra admin steps.
- Both flows reuse the same core game logic, but state ownership differs.

## Next lesson
Optional extensions and concept labs continue in `feynman/lessons/`.
