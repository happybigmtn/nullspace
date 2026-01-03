# L03 - Instruction encoding (binary formats) from scratch

Focus file: `gateway/src/codec/instructions.ts`

Goal: explain how instructions and game payloads are encoded into bytes. For every excerpt, you’ll see **why it matters** and a **plain description of what the code does**.

Supporting references:
- `gateway/src/codec/constants.ts`
- `types/src/execution.rs`

---

## Concepts from scratch (expanded)

### 1) “Binary encoding” in plain words
Computers only understand bytes (0–255). When we send a transaction to the chain, we don’t send JSON — we send **bytes** in a strict layout. The Rust backend decodes those bytes into instructions.

If the layout is wrong by even one byte, the chain will reject the transaction.

### 2) Big‑endian numbers
Multi‑byte numbers can be written in two ways:
- **Big‑endian**: most significant byte first (used here).
- **Little‑endian**: least significant byte first.

Both sides must agree on the same endianness.

### 3) Instruction vs game payload
- **Instruction**: top‑level action like “register”, “deposit”, “start game”.
- **Game payload**: the internal move bytes inside a `CasinoGameMove` instruction (e.g., blackjack hit).

### 4) Tags are opcodes
The first byte of every instruction is a tag (opcode). Tags are defined in `gateway/src/codec/constants.ts` and must match Rust exactly.

---

## Limits & management callouts (important)

1) **Player name length is u32**
- There is no gateway‑side cap in this file. A malicious client could send huge names.
- Recommendation: enforce max length in the client and/or gateway.

2) **CasinoGameMove payload length is u32**
- Theoretically allows payloads up to ~4GB. Must be capped elsewhere.

3) **GlobalTable maxBetsPerRound is u8**
- Hard limit 255 bets per round. Real configs should be much lower.

4) **Roulette and SicBo bet counts are u8**
- Max 255 bets per move.

---

## Walkthrough with code excerpts

### 1) CasinoRegister
```ts
export function encodeCasinoRegister(name: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const result = new Uint8Array(1 + 4 + nameBytes.length);
  const view = new DataView(result.buffer);

  result[0] = InstructionTag.CasinoRegister;
  view.setUint32(1, nameBytes.length, false); // BE
  result.set(nameBytes, 5);

  return result;
}
```

Why this matters:
- Registration is the first on‑chain action for every player. If it fails, nothing else works.

What this code does:
- Encodes a register instruction as bytes: tag (10), name length (u32), name bytes.
- Allocates an output buffer sized exactly to fit the tag, length, and UTF‑8 bytes.
- Writes the tag at byte 0, the name length at byte 1 (big‑endian), then copies the name at byte 5.
- Returns the final byte array ready to be signed and submitted.

---

### 2) CasinoDeposit
```ts
export function encodeCasinoDeposit(amount: bigint): Uint8Array {
  const result = new Uint8Array(9);
  const view = new DataView(result.buffer);

  result[0] = InstructionTag.CasinoDeposit;
  view.setBigUint64(1, amount, false);  // BE

  return result;
}
```

Why this matters:
- Faucet deposits and test chips use this encoding. Any mismatch breaks onboarding.

What this code does:
- Encodes a deposit as tag (11) plus a 64‑bit amount.
- Allocates a fixed 9‑byte buffer and writes the tag first.
- Writes the amount as a big‑endian u64 at offset 1.

---

### 3) CasinoStartGame
```ts
export function encodeCasinoStartGame(gameType: GameType, bet: bigint, sessionId: bigint): Uint8Array {
  const result = new Uint8Array(18);
  const view = new DataView(result.buffer);

  result[0] = InstructionTag.CasinoStartGame;
  result[1] = gameType;
  view.setBigUint64(2, bet, false);  // BE
  view.setBigUint64(10, sessionId, false);  // BE

  return result;
}
```

Why this matters:
- Starting a game creates a session on chain. Wrong encoding here breaks gameplay entirely.

What this code does:
- Builds a fixed‑size instruction: tag + game type + bet + session ID.
- Allocates 18 bytes and writes the tag and game type into the first two bytes.
- Writes the bet (u64) at offset 2 and the session ID (u64) at offset 10, both big‑endian.

---

### 4) CasinoGameMove
```ts
export function encodeCasinoGameMove(sessionId: bigint, payload: Uint8Array): Uint8Array {
  const result = new Uint8Array(1 + 8 + 4 + payload.length);
  const view = new DataView(result.buffer);

  result[0] = InstructionTag.CasinoGameMove;
  view.setBigUint64(1, sessionId, false);  // BE
  view.setUint32(9, payload.length, false);  // BE
  result.set(payload, 13);

  return result;
}
```

Why this matters:
- Every move during gameplay uses this instruction. If payload length is wrong, the chain can’t parse moves.

What this code does:
- Encodes a game move with: tag, session ID, payload length, payload bytes.
- Allocates space for the fixed header plus the variable payload.
- Writes tag and session ID, then writes the payload length (u32) so the decoder knows where it ends.
- Copies the payload bytes after the header and returns the combined buffer.

---

### 5) CasinoPlayerAction
```ts
export function encodeCasinoPlayerAction(action: PlayerAction): Uint8Array {
  const result = new Uint8Array(2);

  result[0] = InstructionTag.CasinoPlayerAction;
  result[1] = action;

  return result;
}
```

Why this matters:
- This toggles modifiers (shield, double, super). If encoded incorrectly, modifiers fail silently.

What this code does:
- Encodes an action as tag + 1‑byte action code.
- Allocates a 2‑byte buffer and writes both bytes directly.

---

### 6) CasinoJoinTournament
```ts
export function encodeCasinoJoinTournament(tournamentId: bigint): Uint8Array {
  const result = new Uint8Array(9);
  const view = new DataView(result.buffer);

  result[0] = InstructionTag.CasinoJoinTournament;
  view.setBigUint64(1, tournamentId, false);  // BE

  return result;
}
```

Why this matters:
- Tournament participation depends on this. If it fails, freeroll lifecycle breaks.

What this code does:
- Encodes join with tag + tournament ID.
- Allocates 9 bytes, writes the tag, then writes the tournament ID as a big‑endian u64.

---

### 7) Global table init
```ts
export function encodeGlobalTableInit(config: GlobalTableConfigInput): Uint8Array {
  const result = new Uint8Array(1 + 1 + (8 * 6) + 1);
  const view = new DataView(result.buffer);

  result[0] = InstructionTag.GlobalTableInit;
  result[1] = config.gameType;
  view.setBigUint64(2, BigInt(config.bettingMs), false);
  view.setBigUint64(10, BigInt(config.lockMs), false);
  view.setBigUint64(18, BigInt(config.payoutMs), false);
  view.setBigUint64(26, BigInt(config.cooldownMs), false);
  view.setBigUint64(34, config.minBet, false);
  view.setBigUint64(42, config.maxBet, false);
  result[50] = config.maxBetsPerRound;

  return result;
}
```

Why this matters:
- Global table config controls the timing and limits for live‑table rounds.

What this code does:
- Encodes a fixed‑size config instruction with time windows and bet limits.
- Writes tag + game type, then six u64 values (betting/lock/payout/cooldown/min/max) in big‑endian.
- Writes `maxBetsPerRound` as a single byte at the end.

---

### 8) Global table submit bets
```ts
export function encodeGlobalTableSubmitBets(
  gameType: GameType,
  roundId: bigint,
  bets: GlobalTableBetInput[]
): Uint8Array {
  const lenVarint = encodeVarint(bets.length);
  const result = new Uint8Array(1 + 1 + 8 + lenVarint.length + bets.length * 10);
  const view = new DataView(result.buffer);

  let offset = 0;
  result[offset] = InstructionTag.GlobalTableSubmitBets;
  offset += 1;
  result[offset] = gameType;
  offset += 1;
  view.setBigUint64(offset, roundId, false);
  offset += 8;
  result.set(lenVarint, offset);
  offset += lenVarint.length;

  for (const bet of bets) {
    result[offset] = bet.betType;
    result[offset + 1] = bet.target;
    view.setBigUint64(offset + 2, bet.amount, false);
    offset += 10;
  }

  return result;
}
```

Why this matters:
- Batch bet submission is the heart of live‑table on‑chain mode. Any mistake here invalidates the entire round.

What this code does:
- Encodes a vector of bets with a varint length, then writes each bet into the buffer.
- Calculates the total buffer size using the varint length and per‑bet size (10 bytes each).
- Writes header fields in order (tag, gameType, roundId, bet count).
- Loops through bets and writes `[betType][target][amount]` for each.

---

### 9) Global table state transitions
```ts
export function encodeGlobalTableLock(gameType: GameType, roundId: bigint): Uint8Array {
  const result = new Uint8Array(10);
  const view = new DataView(result.buffer);
  result[0] = InstructionTag.GlobalTableLock;
  result[1] = gameType;
  view.setBigUint64(2, roundId, false);
  return result;
}

export function encodeGlobalTableReveal(gameType: GameType, roundId: bigint): Uint8Array {
  const result = new Uint8Array(10);
  const view = new DataView(result.buffer);
  result[0] = InstructionTag.GlobalTableReveal;
  result[1] = gameType;
  view.setBigUint64(2, roundId, false);
  return result;
}

export function encodeGlobalTableSettle(gameType: GameType, roundId: bigint): Uint8Array {
  const result = new Uint8Array(10);
  const view = new DataView(result.buffer);
  result[0] = InstructionTag.GlobalTableSettle;
  result[1] = gameType;
  view.setBigUint64(2, roundId, false);
  return result;
}
```

Why this matters:
- These transitions control the round lifecycle (lock → reveal → settle). If they are wrong, rounds never finish.

What this code does:
- Encodes a simple tag + gameType + roundId for each stage.
- Each function returns a 10‑byte buffer with the correct opcode for lock/reveal/settle.
- The layout is identical across stages, so the backend only switches on the tag byte.

---

### 10) Game‑specific payloads (examples)

**Blackjack move**
```ts
export function buildBlackjackPayload(move: BlackjackMoveAction): Uint8Array {
  return encodeGameMovePayload({ game: 'blackjack', move });
}
```

Why this matters:
- Blackjack relies on a separate protocol encoding. If that encoder is wrong, every blackjack move fails.

What this code does:
- Delegates to the shared protocol library to encode a blackjack move.
- Wraps the `move` inside a typed payload object so the protocol encoder can choose the right schema.

**Hi‑Lo move**
```ts
export function buildHiLoPayload(guess: 'higher' | 'lower' | 'same'): Uint8Array {
  return encodeGameActionPayload({ game: 'hilo', action: guess });
}
```

Why this matters:
- Hi‑Lo is a single‑action game; the payload must be compact and correct.

What this code does:
- Encodes the guess action into protocol bytes.
- Uses the shared protocol encoder so the binary format matches the Rust decoder.

**Roulette bet payload**
```ts
export function buildRoulettePayload(bets: RouletteBet[]): Uint8Array {
  const result = new Uint8Array(1 + bets.length * 10);
  const view = new DataView(result.buffer);

  result[0] = bets.length;
  let offset = 1;

  for (const bet of bets) {
    result[offset] = bet.type;
    result[offset + 1] = bet.value;
    view.setBigUint64(offset + 2, bet.amount, false);
    offset += 10;
  }

  return result;
}
```

Why this matters:
- Roulette can include many bets in one move. This layout is how the chain decodes them.

What this code does:
- Encodes the number of bets and then each bet as `[type][value][amount]`.
- Allocates a buffer sized to the count and writes the count in byte 0.
- Writes each bet in 10‑byte chunks with a big‑endian u64 amount.

**Craps bet payload + roll payload**
```ts
export function buildCrapsPayload(betType: number, amount: bigint, target: number = 0): Uint8Array {
  const result = new Uint8Array(11);
  const view = new DataView(result.buffer);

  result[0] = 0;  // Action 0 = Place bet
  result[1] = betType;
  result[2] = target;
  view.setBigUint64(3, amount, false);

  return result;
}

export function buildCrapsRollPayload(): Uint8Array {
  return new Uint8Array([2]);
}
```

Why this matters:
- Craps is the most complex game; a single wrong action byte or amount breaks the round.

What this code does:
- Encodes a bet as `[action][betType][target][amount]`.
- Uses action byte `0` to indicate “place bet”.
- Writes amount as a big‑endian u64 starting at offset 3.
- Encodes a roll as a single action byte (`2`) to trigger the roll step.

---

### 11) Other game payload helpers (Video Poker, SicBo, War, Three Card, Ultimate Hold’em)
```ts
export function buildVideoPokerPayload(holds: boolean[]): Uint8Array {
  return encodeGameActionPayload({
    game: 'videopoker',
    action: 'hold',
    holds,
  });
}

export function buildSicBoPayload(bets: SicBoBet[]): Uint8Array {
  const result = new Uint8Array(1 + bets.length * 9);
  const view = new DataView(result.buffer);

  result[0] = bets.length;
  let offset = 1;

  for (const bet of bets) {
    result[offset] = bet.type;
    view.setBigUint64(offset + 1, bet.amount, false);
    offset += 9;
  }

  return result;
}

export function buildCasinoWarPayload(goToWar: boolean): Uint8Array {
  return encodeGameActionPayload({
    game: 'casinowar',
    action: goToWar ? 'war' : 'surrender',
  });
}

export function buildThreeCardPayload(play: boolean): Uint8Array {
  return encodeGameActionPayload({
    game: 'threecard',
    action: play ? 'play' : 'fold',
  });
}

export function buildUltimateHoldemPayload(action: 'check' | 'bet', multiplier: number = 1): Uint8Array {
  if (action === 'check') {
    return encodeGameActionPayload({ game: 'ultimateholdem', action: 'check' });
  }
  const normalized = multiplier === 4 || multiplier === 3 || multiplier === 2 ? multiplier : 1;
  return encodeGameActionPayload({
    game: 'ultimateholdem',
    action: 'bet',
    multiplier: normalized,
  });
}
```

Why this matters:
- These helpers cover the rest of the casino catalog. If any are wrong, that entire game mode breaks.

What this code does:
- Video Poker: encodes which cards to hold using the shared protocol format.
- SicBo: allocates a buffer, writes the bet count, then writes `[type][amount]` for each bet.
- Casino War / Three Card: encodes a single action string using the protocol encoder.
- Ultimate Hold’em: normalizes multipliers to valid values (4/3/2/1), then encodes either “check” or “bet”.

---

## Key takeaways
- Instructions are strict byte layouts; a single wrong byte breaks the chain interface.
- Game payloads are separate from top‑level instructions and have their own rules.
- Big‑endian and length fields must match Rust exactly.

## Next lesson
L04 - Transaction building + signing: `feynman/lessons/L04-transactions-signing.md`
