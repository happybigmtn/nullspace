# L31 - Rust types (tournament instructions + events) (from scratch)

Focus file: `types/src/execution.rs`

Goal: explain the on‑chain instruction and event types that represent tournament lifecycle. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Tournament lifecycle is encoded as instructions + events
- Instructions: join, start, end, and admin limit updates.
- Events: player joined, tournament started/ended, phase changes.

---

## Walkthrough with code excerpts

### 1) Tournament instructions
```rust
pub enum Instruction {
    /// Admin: Set a player's daily tournament limit.
    /// Binary: [15] [player:PublicKey] [dailyLimit:u8]
    CasinoSetTournamentLimit {
        player: PublicKey,
        daily_limit: u8,
    },

    /// Join a tournament.
    /// Binary: [16] [tournamentId:u64 BE]
    CasinoJoinTournament { tournament_id: u64 },

    /// Start a tournament (Registration -> Active).
    /// Binary: [17] [tournamentId:u64 BE] [startTimeMs:u64 BE] [endTimeMs:u64 BE]
    CasinoStartTournament {
        tournament_id: u64,
        start_time_ms: u64,
        end_time_ms: u64,
    },

    /// End a tournament.
    /// Binary: [29] [tournamentId:u64 BE]
    CasinoEndTournament { tournament_id: u64 },
    // ...
}
```

Why this matters:
- These opcodes define the wire format for all tournament transactions.

What this code does:
- Declares each tournament instruction with exact binary layout notes.

---

### 2) Tournament events
```rust
pub enum Event {
    TournamentStarted {
        id: u64,
        start_block: u64,
    },
    PlayerJoined {
        tournament_id: u64,
        player: PublicKey,
    },
    TournamentPhaseChanged {
        tournament_id: u64,
        phase: crate::casino::TournamentPhase,
    },
    TournamentEnded {
        id: u64,
        rankings: Vec<(PublicKey, u64)>,
    },
    // ...
}
```

Why this matters:
- Clients and indexers only see tournament state via these events.

What this code does:
- Defines the event payloads emitted during tournament lifecycle.

---

## Key takeaways
- Tournament lifecycle is encoded in a small set of instructions and events.
- Binary layouts are fixed and must match gateway encoding.

## Next lesson
L32 - Auth server (login + signature verification): `feynman/lessons/L32-auth-server.md`
