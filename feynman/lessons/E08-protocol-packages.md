# E08 - Protocol packages + schemas (from scratch)

Focus files: `types/src/lib.rs`, `packages/types/dist/index.js`, `packages/protocol/dist/schema/websocket.js`

Goal: explain how shared schemas are defined across Rust and TypeScript, and how WebSocket message types are validated. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Shared schemas are consensus-critical
Types that appear on chain or in signed payloads must be consistent across languages. That is why there is a Rust `types` crate and a TypeScript `@nullspace/types` package.

### 2) Runtime validation in TS
TypeScript types disappear at runtime. The protocol package uses `zod` schemas to validate messages that cross the network.

### 3) Separation of concerns
- `@nullspace/types` holds generic shared types.
- `@nullspace/protocol` holds WebSocket schemas and encoding rules.

---

## Limits & management callouts (important)

1) **Schema drift is a real risk**
- If Rust and TS schemas diverge, clients and nodes will disagree.
- Any schema change must be coordinated across packages.

2) **Runtime validation costs CPU**
- Zod validation adds overhead; avoid validating large payloads repeatedly.

---

## Walkthrough with code excerpts

### 1) Rust types crate as the source of truth
```rust
//! Shared schema types for Nullspace.
//!
//! This crate defines the wire and state schema used across the workspace (`api`, `casino`,
//! `execution`, `token`) and re-exports it as a single public surface.
//!
//! By default, items are also re-exported at the crate root for ergonomic imports. Consumers that
//! want a narrower surface can disable default features and import from the module paths instead.

pub mod api;
pub mod casino;
pub mod execution;
pub mod token;
#[cfg(feature = "ts")]
pub mod casino_state;
```

Why this matters:
- This crate is the canonical source for consensus-critical types.

What this code does:
- Declares the main schema modules and re-exports them.
- Allows optional TS-focused exports via features.

---

### 2) TypeScript package re-exports
```rust
export * from './cards.js';
export * from './game.js';
export * from './player.js';
export * from './events.js';
// NOTE: WebSocket protocol types live in @nullspace/protocol/websocket
// Do NOT add protocol types here - they would drift from the authoritative source
// NOTE: Casino on-chain types live in @nullspace/types/casino to avoid name collisions
```

Why this matters:
- The TS package keeps a clean boundary between generic types and protocol-specific schemas.

What this code does:
- Re-exports shared TS types.
- Explicitly documents where protocol schemas live to avoid drift.

---

### 3) WebSocket message schemas
```rust
export const GameStartedMessageSchema = z.object({
    type: z.literal('game_started'),
    sessionId: sessionIdSchema,
    gameType: gameTypeSchema,
    initialState: z.string(), // base64 encoded state
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
    GameStartedMessageSchema,
    GameStateMessageSchema,
    GameResultMessageSchema,
    ErrorMessageSchema,
]);
```

Why this matters:
- Runtime validation protects the gateway from malformed or malicious messages.

What this code does:
- Defines strict schemas for each message type.
- Uses a discriminated union to validate by `type`.

---

## Key takeaways
- Rust `types` is the source of truth for consensus-critical schemas.
- TypeScript packages re-export types and validate runtime messages.
- Protocol schemas live in a dedicated package to avoid drift.

## Next lesson
E09 - Mobile app architecture: `feynman/lessons/E09-mobile-app.md`
