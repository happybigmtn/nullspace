# L41 - Gateway craps handler (live vs normal routing) (from scratch)

Focus file: `gateway/src/handlers/craps.ts`

Goal: explain how the gateway routes craps messages to either normal on-chain play or the live-table flow. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) The gateway is the traffic director
The gateway receives client messages and decides where they go. For craps, it can:
- route bets to the normal on-chain session flow, or
- route bets to the live-table service (global table).

### 2) Atomic batch payloads
For normal craps, the gateway uses a single transaction that batches bets and the roll. This reduces latency and avoids multi-step client flows.

### 3) Live-table mode
Live-table mode is a shared, round-based experience. Players join a table and submit bets that get settled through a different pipeline.

---

## Limits & management callouts (important)

1) **No explicit bet limits here**
- Bet limits are enforced later in the execution layer or live-table service.
- If those layers are misconfigured, the gateway will not block large bets.

2) **Session counter is local**
- `gameSessionCounter` increments in memory. If the gateway restarts, counters reset.
- This is usually fine because the session ID also uses the public key.

---

## Walkthrough with code excerpts

### 1) Routing by message type
```rust
async handleMessage(
  ctx: HandlerContext,
  msg: OutboundMessage
): Promise<HandleResult> {
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
}
```

Why this matters:
- This is the decision point for whether a request is live-table or normal on-chain.

Syntax notes:
- The `switch` uses the `msg.type` string to branch to the right handler.
- Both `craps_bet` and `craps_roll` share the same handler to support batching.

What this code does:
- Routes live-table messages to live-table handlers.
- Routes standard bet/roll messages to the on-chain flow.
- Returns a structured error for unknown message types.

---

### 2) Creating a normal on-chain session ID
```rust
const gameSessionId = generateSessionId(
  ctx.session.publicKey,
  ctx.session.gameSessionCounter++
);

// Start game with bet=0 (Craps requires bet as first move, not at start).
const startResult = await this.startGame(ctx, 0n, gameSessionId);
if (!startResult.success) {
  return startResult;
}
```

Why this matters:
- The session ID ties all later moves to a specific on-chain game session.

Syntax notes:
- `0n` is a BigInt literal for zero.
- `gameSessionCounter++` increments after using the current value.

What this code does:
- Builds a deterministic session ID from the public key and a counter.
- Starts the game with a zero bet, because craps places bets as the first move.

---

### 3) Normalizing bets and encoding the payload
```rust
const normalizeType = (value: string | number): CrapsAtomicBetInput['type'] => (
  typeof value === 'string' ? value.toUpperCase() as CrapsAtomicBetInput['type'] : value
);

const bets: CrapsAtomicBetInput[] = msg.type === 'craps_bet'
  ? [{
      type: normalizeType(msg.betType),
      amount: BigInt(msg.amount),
      target: msg.target,
    }]
  : msg.bets.map((bet) => ({
      type: normalizeType(bet.type),
      amount: BigInt(bet.amount),
      target: bet.target,
    }));

const payload = encodeAtomicBatchPayload('craps', bets);
return this.makeMove(ctx, payload);
```

Why this matters:
- This is where client-friendly input becomes the strict binary format used on chain.

Syntax notes:
- `as CrapsAtomicBetInput['type']` is a TypeScript type assertion.
- `BigInt(...)` converts numeric amounts into 64-bit integer format.

What this code does:
- Normalizes bet types to match the protocol format.
- Builds a list of bets from either a single bet or a batch.
- Encodes the bets into a single atomic payload and submits it as a move.

---

### 4) Live-table delegation
```rust
private async handleLiveJoin(
  ctx: HandlerContext,
  _msg: CrapsLiveJoinRequest
): Promise<HandleResult> {
  return crapsLiveTable.join(ctx.session);
}

private async handleLiveBet(
  ctx: HandlerContext,
  msg: CrapsLiveBetRequest
): Promise<HandleResult> {
  return crapsLiveTable.placeBets(ctx.session, msg.bets);
}
```

Why this matters:
- Live-table mode bypasses normal on-chain session flow and uses a dedicated table manager.

What this code does:
- Delegates join and bet actions to `crapsLiveTable`.
- Keeps the gateway handler small and focused on routing.

---

## Key takeaways
- The gateway routes live-table messages and normal on-chain messages differently.
- Normal craps uses an atomic batch payload for bets + roll.
- Live-table actions are delegated to a separate table manager.

## Next lesson
L42 - LiveCrapsTable (off-chain gateway client): `feynman/lessons/L42-live-craps-table.md`
