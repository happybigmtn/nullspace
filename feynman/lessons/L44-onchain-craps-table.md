# L44 - OnchainCrapsTable (global table orchestration) (from scratch)

Focus file: `gateway/src/live-table/craps.ts`

Goal: explain how the gateway orchestrates the on-chain global table for live craps. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) On-chain global table
Instead of each player running an individual session, the global table creates a shared round on chain. Admin transactions open, lock, reveal, and finalize each round.

### 2) Updates client
The gateway subscribes to on-chain events through the updates service, then pushes those updates to connected players.

### 3) Nonce management for admin txs
Admin instructions must be signed and submitted in order. The gateway uses a nonce manager to handle retries and resyncs.

---

## Limits & management callouts (important)

1) **Bet and timing limits are env-configured**
- `GATEWAY_LIVE_TABLE_MIN_BET`, `MAX_BET`, `MAX_BETS_PER_ROUND`.
- Timing windows: `BETTING_MS`, `LOCK_MS`, `PAYOUT_MS`, `COOLDOWN_MS`.
- Misconfiguration will break UX or economics.

2) **Admin key handling in prod**
- Production requires a key file unless `GATEWAY_LIVE_TABLE_ALLOW_ADMIN_ENV=1`.
- This is important for security.

3) **Retry throttling**
- `GATEWAY_LIVE_TABLE_ADMIN_RETRY_MS` limits how often admin actions are retried.
- Too low can spam the chain; too high can stall rounds.

---

## Walkthrough with code excerpts

### 1) Starting the on-chain table
```rust
configure(deps: LiveTableDependencies): void {
  this.deps = deps;
  if (this.enabled) {
    void this.ensureStarted().catch((err) => {
      console.error('[LiveTable] Failed to start on-chain table:', err);
    });
  }
}

private async ensureStarted(): Promise<void> {
  if (this.started) return;
  if (this.startPromise) {
    await this.startPromise;
    return;
  }
  if (!this.deps) {
    throw new Error('Live table dependencies not configured');
  }

  this.startPromise = (async () => {
    const admin = this.buildAdminSigner();
    if (!admin) {
      throw new Error('Missing admin key');
    }
    this.admin = admin;

    await this.deps!.nonceManager.syncFromBackend(admin.publicKeyHex, this.deps!.backendUrl)
      .catch(() => undefined);

    await this.connectUpdates();
    await this.initGlobalTable();
    await this.attemptOpenRound();
    this.ensureBots();
    void this.registerBots();

    if (!this.ticker) {
      this.ticker = setInterval(() => {
        void this.tick();
      }, CONFIG.tickMs);
    }

    this.started = true;
  })();

  try {
    await this.startPromise;
  } finally {
    this.startPromise = null;
  }
}
```

Why this matters:
- This bootstraps the global table and starts the round machine.

What this code does:
- Stores dependencies and ensures the table starts only once.
- Builds the admin signer and syncs nonce state.
- Connects to updates, initializes the table, and opens the first round.
- Starts the ticking loop that drives phases.

---

### 2) Loading the admin key safely
```rust
private buildAdminSigner(): SignerState | null {
  if (this.admin) return this.admin;
  const envKeyRaw = (process.env.GATEWAY_LIVE_TABLE_ADMIN_KEY
    ?? process.env.CASINO_ADMIN_PRIVATE_KEY_HEX
    ?? '').trim();
  if (envKeyRaw && !ALLOW_ADMIN_KEY_ENV) {
    throw new Error(
      'Live-table admin key env vars are disabled in production. Use GATEWAY_LIVE_TABLE_ADMIN_KEY_FILE or set GATEWAY_LIVE_TABLE_ALLOW_ADMIN_ENV=1.',
    );
  }

  let key: Uint8Array | null = null;
  if (ADMIN_KEY_FILE) {
    try {
      const raw = readFileSync(ADMIN_KEY_FILE, 'utf8').trim();
      key = parseHexKey(raw) ?? null;
    } catch {
      key = null;
    }
  }
  if (!key && ALLOW_ADMIN_KEY_ENV) {
    key = parseHexKey(envKeyRaw);
  }

  if (!key) return null;

  const publicKey = ed25519.getPublicKey(key);
  const publicKeyHex = Buffer.from(publicKey).toString('hex');
  this.admin = { privateKey: key, publicKey, publicKeyHex };
  return this.admin;
}
```

Why this matters:
- The admin key is required to open/lock/reveal rounds on chain.

What this code does:
- Loads the admin key from file (preferred) or env (if allowed).
- Derives the public key and caches the signer for later use.

---

### 3) Placing bets on the global table
```rust
async placeBets(session: Session, bets: LiveCrapsBetInput[]): Promise<HandleResult> {
  if (!this.enabled) {
    return {
      success: false,
      error: createError(ErrorCodes.INVALID_MESSAGE, 'LIVE_TABLE_DISABLED'),
    };
  }

  if (!this.sessions.has(session.id)) {
    return {
      success: false,
      error: createError(ErrorCodes.INVALID_MESSAGE, 'NOT_SUBSCRIBED'),
    };
  }

  if (!session.registered) {
    return {
      success: false,
      error: createError(ErrorCodes.NOT_REGISTERED, 'Player not registered'),
    };
  }

  try {
    await this.ensureStarted();
  } catch (err) {
    return {
      success: false,
      error: createError(ErrorCodes.INVALID_MESSAGE, 'LIVE_TABLE_UNAVAILABLE'),
    };
  }

  if (this.roundId === 0n) {
    return {
      success: false,
      error: createError(ErrorCodes.INVALID_MESSAGE, 'LIVE_TABLE_NOT_READY'),
    };
  }

  let normalized: { betType: number; target: number; amount: bigint }[] = [];
  try {
    normalized = this.normalizeBets(bets);
  } catch (err) {
    return {
      success: false,
      error: createError(ErrorCodes.INVALID_BET, err instanceof Error ? err.message : 'Invalid bet'),
    };
  }

  if (normalized.length === 0) {
    return {
      success: false,
      error: createError(ErrorCodes.INVALID_BET, 'No bets submitted'),
    };
  }

  if (normalized.length > CONFIG.maxBetsPerRound) {
    return {
      success: false,
      error: createError(ErrorCodes.INVALID_BET, 'Too many bets submitted'),
    };
  }

  const instruction = encodeGlobalTableSubmitBets(
    GameType.Craps,
    this.roundId,
    normalized
  );

  const accepted = await this.submitInstruction(session, instruction);
  if (!accepted) {
    return {
      success: false,
      error: createError(ErrorCodes.TRANSACTION_REJECTED, 'Bet submission rejected'),
    };
  }

  this.sendConfirmation(session.publicKeyHex, 'pending', 'Awaiting on-chain confirmation', session.balance, this.roundId);
  return { success: true };
}
```

Why this matters:
- This function is where player bets become on-chain global table instructions.

What this code does:
- Validates session membership, registration, and round availability.
- Normalizes bets and enforces max bet count.
- Encodes a global table submission instruction and submits it on chain.
- Sends a pending confirmation back to the player.

---

### 4) Opening and advancing rounds
```rust
private async attemptOpenRound(): Promise<void> {
  if (!this.admin || !this.shouldAttempt('open')) return;
  if (this.pendingSettlements.size > 0 || this.settleInFlight.size > 0) {
    return;
  }
  const instruction = encodeGlobalTableOpenRound(GameType.Craps);
  await this.submitInstruction(this.admin, instruction);
}

private async attemptLockRound(): Promise<void> {
  if (!this.admin || !this.shouldAttempt('lock')) return;
  if (this.roundId === 0n) return;
  const instruction = encodeGlobalTableLock(GameType.Craps, this.roundId);
  await this.submitInstruction(this.admin, instruction);
}
```

Why this matters:
- These admin actions drive the global table lifecycle on chain.

What this code does:
- Submits admin instructions to open or lock the round.
- Uses retry throttling to avoid spamming the chain.

---

### 5) Handling on-chain events
```rust
private handleGlobalTableEvent = (event: GlobalTableEvent): void => {
  switch (event.type) {
    case 'round_opened': {
      this.applyRoundUpdate(event.round);
      this.botQueue = this.bots.map((bot) => bot.publicKeyHex);
      this.broadcastState();
      break;
    }
    case 'outcome': {
      this.applyRoundUpdate(event.round);
      this.pendingSettlements = new Set(this.activePlayers);
      this.settleInFlight.clear();
      this.broadcastState();
      break;
    }
    case 'bet_accepted': {
      const playerHex = Buffer.from(event.player).toString('hex');
      if (this.roundId !== event.roundId) {
        this.roundId = event.roundId;
        if (this.phase !== 'betting') {
          this.setPhase('betting', CONFIG.bettingMs);
        }
      }
      this.activePlayers.add(playerHex);
      this.addBetsToMap(this.playerBets, playerHex, event.bets);
      this.addBetsToTotals(event.bets);
      if (event.balanceSnapshot?.chips !== undefined) {
        this.updateSessionsBalance(playerHex, event.balanceSnapshot.chips);
      }
      this.sendConfirmation(
        playerHex,
        'confirmed',
        'On-chain bet accepted',
        event.balanceSnapshot?.chips,
        event.roundId,
      );
      this.broadcastState();
      break;
    }
    default:
      break;
  }
};
```

Why this matters:
- The on-chain events are the source of truth for table state and player balances.

What this code does:
- Updates round state and phase from on-chain events.
- Tracks active players and their bets.
- Broadcasts state and confirmations back to clients.

---

### 6) Submitting instructions with nonce management
```rust
private async submitInstruction(signer: SignerState, instruction: Uint8Array): Promise<boolean> {
  if (!this.deps) return false;
  const { submitClient, nonceManager, backendUrl } = this.deps;

  return nonceManager.withLock(signer.publicKeyHex, async (nonce) => {
    const tx = buildTransaction(nonce, instruction, signer.privateKey);
    const submission = wrapSubmission(tx);
    const result = await submitClient.submit(submission);

    if (result.accepted) {
      nonceManager.setCurrentNonce(signer.publicKeyHex, nonce + 1n);
      return true;
    }

    if (result.error && nonceManager.handleRejection(signer.publicKeyHex, result.error)) {
      const synced = await nonceManager.syncFromBackend(signer.publicKeyHex, backendUrl);
      if (synced) {
        const retryNonce = nonceManager.getCurrentNonce(signer.publicKeyHex);
        const retryTx = buildTransaction(retryNonce, instruction, signer.privateKey);
        const retrySubmission = wrapSubmission(retryTx);
        const retryResult = await submitClient.submit(retrySubmission);
        if (retryResult.accepted) {
          nonceManager.setCurrentNonce(signer.publicKeyHex, retryNonce + 1n);
          return true;
        }
      }
    }

    return false;
  });
}
```

Why this matters:
- Admin and player instructions must use correct nonces or they will be rejected.

Syntax notes:
- `withLock` serializes nonce usage per public key.
- The retry path resyncs from the backend if a rejection suggests nonce drift.

What this code does:
- Builds and submits a signed transaction.
- Updates the local nonce on success.
- Attempts a resync and retry if a rejection indicates a nonce mismatch.

---

## Key takeaways
- OnchainCrapsTable orchestrates global rounds through admin instructions.
- It listens to on-chain events to update client state.
- Nonce management and retries are essential for reliability.

## Next lesson
L45 - Global table handlers (on-chain): `feynman/lessons/L45-global-table-handlers.md`
