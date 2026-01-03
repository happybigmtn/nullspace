# L27 - Server tournament scheduler (from scratch)

Focus file: `client/src/bin/tournament_scheduler.rs`

Goal: explain how the server-side scheduler starts and ends freeroll tournaments on a timed loop. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Why a scheduler exists
Freeroll tournaments must start and end on time even if no UI is open. This binary runs on the server and ensures that lifecycle.

### 2) Slot-based scheduling
The day is split into `TOURNAMENTS_PER_DAY` slots. Each slot has:
- a registration window,
- an active window (the tournament itself).

### 3) Admin transactions
Starting and ending a tournament requires admin instructions signed with the admin private key. The scheduler automates this.

---

## Limits & management callouts (important)

1) **Poll interval**
- Default `--poll-secs` is 5 seconds. Too slow can miss boundaries; too fast increases load.

2) **DAY_MS = 86,400,000**
- Schedule boundaries are fixed in UTC ms. Any clock skew affects accuracy.

3) **TOURNAMENT_DURATION_SECS / TOURNAMENTS_PER_DAY**
- These constants define registration length and active length.
- Changing them affects schedule math and UI expectations.

---

## Walkthrough with code excerpts

### 1) Schedule calculation
```rust
fn schedule_for_time(now_ms: u64) -> ScheduleSlot {
    let cycle_ms = DAY_MS / TOURNAMENTS_PER_DAY.max(1);
    let tournament_ms = TOURNAMENT_DURATION_SECS.saturating_mul(1000);
    let registration_ms = cycle_ms.saturating_sub(tournament_ms);

    let slot = now_ms / cycle_ms.max(1);
    let slot_start_ms = slot * cycle_ms;
    let start_time_ms = slot_start_ms.saturating_add(registration_ms);
    let end_time_ms = start_time_ms.saturating_add(tournament_ms);

    ScheduleSlot {
        slot,
        start_time_ms,
        end_time_ms,
    }
}
```

Why this matters:
- All tournament start/end decisions come from this slot math.

What this code does:
- Calculates the length of each daily slot.
- Computes registration vs active windows.
- Returns a `ScheduleSlot` with start/end timestamps.

---

### 2) Nonce tracker for admin key
```rust
struct NonceTracker {
    next_nonce: Option<u64>,
}

impl NonceTracker {
    async fn sync(&mut self, client: &Client, public: &PublicKey) -> Result<u64> {
        let lookup = client.query_state(&Key::Account(public.clone())).await?;
        let nonce = match lookup.and_then(|lookup| lookup.operation.value().cloned()) {
            Some(Value::Account(account)) => account.nonce,
            _ => 0,
        };
        self.next_nonce = Some(nonce);
        Ok(nonce)
    }

    async fn next(&mut self, client: &Client, public: &PublicKey) -> Result<u64> {
        if let Some(nonce) = self.next_nonce {
            self.next_nonce = Some(nonce.saturating_add(1));
            Ok(nonce)
        } else {
            let nonce = self.sync(client, public).await?;
            self.next_nonce = Some(nonce.saturating_add(1));
            Ok(nonce)
        }
    }
}
```

Why this matters:
- Admin transactions must use correct nonces or they will be rejected.

What this code does:
- Keeps a cached nonce for the admin key.
- Syncs from chain if it hasn’t seen a nonce yet.
- Increments the nonce after each use.

---

### 3) Submitting admin instructions
```rust
async fn submit_instruction(
    client: &Client,
    admin_private: &PrivateKey,
    admin_public: &PublicKey,
    nonce_tracker: &mut NonceTracker,
    instruction: Instruction,
) -> Result<()> {
    let nonce = nonce_tracker.next(client, admin_public).await?;
    let tx = Transaction::sign(admin_private, nonce, instruction);
    if let Err(err) = client.submit_transactions(vec![tx]).await {
        nonce_tracker.sync(client, admin_public).await?;
        return Err(anyhow!("Submit failed: {err}"));
    }
    Ok(())
}
```

Why this matters:
- Start/end instructions must be signed and submitted reliably.

What this code does:
- Fetches the next admin nonce.
- Signs the instruction and submits it.
- On failure, resyncs the nonce to recover.

---

### 4) Main loop: start/end tournaments
```rust
let mut ticker = interval(Duration::from_secs(args.poll_secs.max(1)));
loop {
    ticker.tick().await;
    let now_ms = now_ms()?;
    let slot = schedule_for_time(now_ms);
    let prev_slot = slot.slot.saturating_sub(1);
    let slots = if prev_slot == slot.slot {
        vec![slot.slot]
    } else {
        vec![prev_slot, slot.slot]
    };

    for tournament_id in slots {
        let schedule = if tournament_id == slot.slot {
            slot
        } else {
            let slot_start = schedule_for_time(slot.start_time_ms.saturating_sub(1));
            ScheduleSlot {
                slot: prev_slot,
                start_time_ms: slot_start.start_time_ms,
                end_time_ms: slot_start.end_time_ms,
            }
        };

        let tournament = fetch_tournament(&client, tournament_id).await?;
        let phase = tournament
            .as_ref()
            .map(|t| t.phase)
            .unwrap_or(TournamentPhase::Registration);

        if now_ms >= schedule.end_time_ms {
            // end
        }

        if now_ms >= schedule.start_time_ms
            && now_ms < schedule.end_time_ms
            && phase != TournamentPhase::Active
            && phase != TournamentPhase::Complete
        {
            // start
        }
    }
}
```

Why this matters:
- This loop is the automation that keeps tournaments on schedule.

What this code does:
- Polls every few seconds.
- Calculates the current and previous slot.
- Starts tournaments when inside the active window.
- Ends tournaments when the end time passes.

---

## Key takeaways
- The scheduler is a server-side automation for tournament lifecycle.
- It uses slot math and admin-signed transactions to start/end tournaments.

## Next lesson
L28 - Auth admin sync: `feynman/lessons/L28-auth-admin-sync.md`
