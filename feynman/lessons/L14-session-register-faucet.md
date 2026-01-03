# L14 - Session manager (register + deposit flow) (from scratch)

Focus file: `gateway/src/session/manager.ts`

Goal: explain how sessions are auto‑registered, how faucet deposits work, and how nonce handling is retried safely. For every excerpt, you will see **why it matters** and a **plain description of what the code does**. We only explain syntax when it is genuinely tricky.

---

## Concepts from scratch (expanded)

### 1) Session registration
The gateway creates a session and then sends a `CasinoRegister` transaction on behalf of the player. This is the on‑chain identity step.

### 2) Nonce management
Every transaction must have the correct nonce. The gateway tracks nonces locally and resyncs from the backend when a rejection implies a mismatch.

### 3) Faucet claims are deposits
A faucet claim is just a `CasinoDeposit` instruction. The gateway enforces a client‑side cooldown to avoid spam.

### 4) Updates stream subscription
The session manager connects to the updates stream **before** sending transactions, so the client won’t miss registration events.

---

## Limits & management callouts (important)

1) **Client‑side faucet cooldown**
- Enforced by `requestFaucet` using the `cooldownMs` argument.
- This must match or be stricter than the on‑chain faucet rules.

2) **Initial balance assumption = 1000**
- After registration, the session sets `hasBalance=true` and `balance=1000n`.
- If the backend changes initial chips, this will show incorrect balances until refreshed.

3) **Update subscription is best‑effort**
- If updates stream fails to connect, registration still proceeds but real‑time events are missed.

---

## Walkthrough with code excerpts

### 1) Initialize player (subscribe before register)
```ts
private async initializePlayer(
  session: Session,
  _initialBalance: bigint,
): Promise<void> {
  // Step 1: Connect to updates stream FIRST (before any transactions)
  try {
    const updatesClient = new UpdatesClient(this.backendUrl, this.origin);
    await updatesClient.connectForAccount(session.publicKey);
    session.updatesClient = updatesClient;
  } catch (err) {
    // Non-fatal - game can still work, just won't get real-time events
  }

  // Step 2: Register player (grants INITIAL_CHIPS automatically)
  const registerResult = await this.registerPlayer(session);
  if (!registerResult) {
    return;
  }

  session.hasBalance = true;
  session.balance = 1000n;
}
```

Why this matters:
- If the updates stream isn’t connected first, the client can miss its own registration event.

What this code does:
- Connects to the updates stream for the player’s public key.
- Sends a registration transaction.
- Marks the session as funded with the assumed initial balance.

---

### 2) Register player (nonce‑safe submission)
```ts
private async registerPlayer(session: Session): Promise<boolean> {
  return this.nonceManager.withLock(session.publicKeyHex, async (nonce) => {
    const instruction = encodeCasinoRegister(session.playerName);
    const tx = buildTransaction(nonce, instruction, session.privateKey);
    const submission = wrapSubmission(tx);

    const result = await this.submitClient.submit(submission);

    if (result.accepted) {
      session.registered = true;
      this.nonceManager.setCurrentNonce(session.publicKeyHex, nonce + 1n);
      return true;
    }

    if (
      result.error &&
      this.nonceManager.handleRejection(session.publicKeyHex, result.error)
    ) {
      const synced = await this.nonceManager.syncFromBackend(
        session.publicKeyHex,
        this.getBackendUrl(),
      );
      if (synced) {
        const retryNonce = this.nonceManager.getCurrentNonce(session.publicKeyHex);
        const retryTx = buildTransaction(
          retryNonce,
          instruction,
          session.privateKey,
        );
        const retrySubmission = wrapSubmission(retryTx);
        const retryResult = await this.submitClient.submit(retrySubmission);
        if (retryResult.accepted) {
          session.registered = true;
          this.nonceManager.setCurrentNonce(session.publicKeyHex, retryNonce + 1n);
          return true;
        }
      }
    }

    return false;
  });
}
```

Why this matters:
- Registration is the first on‑chain action. If nonce handling is wrong, every later transaction fails.

What this code does:
- Locks nonce access for the public key.
- Builds and submits a `CasinoRegister` transaction.
- If rejected, attempts a nonce resync and retries once.
- Updates the local nonce tracker when accepted.

---

### 3) Deposit chips (faucet path)
```ts
private async depositChips(
  session: Session,
  amount: bigint,
): Promise<boolean> {
  return this.nonceManager.withLock(session.publicKeyHex, async (nonce) => {
    const instruction = encodeCasinoDeposit(amount);
    const tx = buildTransaction(nonce, instruction, session.privateKey);
    const submission = wrapSubmission(tx);

    const result = await this.submitClient.submit(submission);

    if (result.accepted) {
      session.hasBalance = true;
      session.balance = session.balance + amount;
      this.nonceManager.setCurrentNonce(session.publicKeyHex, nonce + 1n);
      return true;
    }

    // Retry on nonce mismatch
    // ... same resync + retry logic as register ...

    return false;
  });
}
```

Why this matters:
- This is how faucet claims become actual on‑chain deposits.

What this code does:
- Builds a `CasinoDeposit` transaction and submits it.
- On success, updates the local balance and nonce.
- Uses the same nonce resync pattern if rejected.

---

### 4) Client‑side faucet cooldown
```ts
async requestFaucet(
  session: Session,
  amount: bigint,
  cooldownMs: number,
): Promise<{ success: boolean; error?: string }> {
  const now = Date.now();
  const lastClaim = session.lastFaucetAt ?? 0;
  if (now - lastClaim < cooldownMs) {
    const seconds = Math.ceil((cooldownMs - (now - lastClaim)) / 1000);
    return {
      success: false,
      error: `Faucet cooling down. Try again in ${seconds}s.`,
    };
  }

  const ok = await this.depositChips(session, amount);
  if (ok) {
    session.lastFaucetAt = now;
    return { success: true };
  }

  return { success: false, error: "Faucet claim rejected" };
}
```

Why this matters:
- Without cooldowns, a single client could spam deposit requests.

What this code does:
- Checks a local timestamp and rejects if the cooldown has not elapsed.
- Performs a deposit and updates the last claim time on success.

---

## Key takeaways
- Registration is a transaction, so nonce handling must be correct.
- The gateway subscribes to updates before sending registration to avoid races.
- Faucet claims are just deposits with a client‑side cooldown.

## Next lesson
L15 - Register instruction encoding: `feynman/lessons/L15-register-instructions.md`
