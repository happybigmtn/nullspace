# L25 - Web nonce manager (from scratch)

Focus file: `gateway/src/session/nonce.ts`

Goal: explain how the gateway tracks and persists nonces to prevent replay and keep transaction ordering. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) What a nonce is
A nonce is a per‑account counter. Each transaction must use the next nonce value or it will be rejected by the chain.

### 2) Why a nonce manager exists
The gateway sends many transactions and must avoid:
- reusing a nonce,
- skipping a nonce,
- racing two transactions with the same nonce.

### 3) Persistence
If the gateway restarts and loses nonce state, it will submit incorrect nonces. Persisting to disk avoids this.

---

## Limits & management callouts (important)

1) **Data directory permissions = 0700**
- Nonces are sensitive; permissions restrict access to the gateway user.

2) **Nonce file permissions = 0600**
- Prevents other users from reading or editing nonce state.

3) **On‑chain nonce sync**
- `syncFromBackend` relies on `/account/<pubkey>`. If that endpoint is down, nonce recovery fails.

---

## Walkthrough with code excerpts

### 1) Data directory setup and legacy migration
```ts
private ensureDataDir(): void {
  try {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    }
    chmodSync(this.dataDir, 0o700);
  } catch (err) {
    console.error('Failed to prepare nonce data directory:', err);
  }
}

private migrateLegacyFile(): void {
  if (!existsSync(this.legacyPath) || existsSync(this.persistPath)) {
    return;
  }
  try {
    const legacyData = readFileSync(this.legacyPath, 'utf8');
    writeFileSync(this.persistPath, legacyData, { mode: 0o600 });
    chmodSync(this.persistPath, 0o600);
    unlinkSync(this.legacyPath);
  } catch (err) {
    console.warn('Failed to migrate legacy nonce file:', err);
  }
}
```

Why this matters:
- Nonce data must survive restarts, and permissions must prevent tampering.

What this code does:
- Ensures the data directory exists and is locked down.
- Migrates a legacy nonce file into the new location with secure permissions.

---

### 2) Get and increment nonce (mark as pending)
```ts
getAndIncrement(publicKeyHex: string): bigint {
  const current = this.nonces.get(publicKeyHex) ?? 0n;
  this.nonces.set(publicKeyHex, current + 1n);

  if (!this.pending.has(publicKeyHex)) {
    this.pending.set(publicKeyHex, new Set());
  }
  this.pending.get(publicKeyHex)!.add(current);

  return current;
}
```

Why this matters:
- This prevents nonce reuse when multiple transactions are submitted.

What this code does:
- Returns the current nonce and immediately increments for the next call.
- Records the used nonce in a pending set until confirmation.

---

### 3) Locking to prevent race conditions
```ts
async withLock<T>(
  publicKeyHex: string,
  fn: (nonce: bigint) => Promise<T>
): Promise<T> {
  const pendingLock = this.locks.get(publicKeyHex);
  if (pendingLock) {
    await pendingLock;
  }

  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  this.locks.set(publicKeyHex, lockPromise);

  try {
    return await fn(this.getCurrentNonce(publicKeyHex));
  } finally {
    this.locks.delete(publicKeyHex);
    releaseLock!();
  }
}
```

Why this matters:
- Two concurrent requests could otherwise use the same nonce.

What this code does:
- Serializes all nonce usage per public key.
- Ensures only one transaction builds at a time for each account.

---

### 4) Sync nonce from backend
```ts
async syncFromBackend(publicKeyHex: string, backendUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${backendUrl}/account/${publicKeyHex}`, {
      headers: { Origin: this.origin },
    });
    if (response.ok) {
      const account = await response.json();
      const onChainNonce = BigInt(account.nonce);

      this.nonces.set(publicKeyHex, onChainNonce);
      this.pending.delete(publicKeyHex);

      return true;
    }
  } catch (err) {
    console.error(`Failed to sync nonce for ${publicKeyHex.slice(0, 8)}:`, err);
  }
  return false;
}
```

Why this matters:
- If the gateway gets out of sync, transactions will be rejected until fixed.

What this code does:
- Queries the backend account endpoint.
- Sets local nonce to the on‑chain value and clears pending entries.
- Returns whether the sync succeeded.

---

### 5) Persist + restore
```ts
persist(): void {
  try {
    this.ensureDataDir();
    const data: Record<string, string> = {};
    for (const [k, v] of this.nonces.entries()) {
      data[k] = v.toString();
    }
    const tmpPath = `${this.persistPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), { mode: 0o600 });
    chmodSync(tmpPath, 0o600);
    renameSync(tmpPath, this.persistPath);
    chmodSync(this.persistPath, 0o600);
  } catch (err) {
    console.error('Failed to persist nonces:', err);
  }
}

restore(): void {
  try {
    if (!existsSync(this.persistPath)) {
      return;
    }
    const data = JSON.parse(readFileSync(this.persistPath, 'utf8'));
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'string') {
        this.nonces.set(k, BigInt(v));
      }
    }
  } catch (err) {
    console.error('Failed to restore nonces:', err);
  }
}
```

Why this matters:
- Without persistence, every restart risks nonce collisions and rejected transactions.

What this code does:
- Writes nonce data to disk atomically via a temp file.
- Restores nonce values on startup.

---

## Key takeaways
- Nonces are critical to transaction ordering and replay protection.
- The manager serializes nonce use, handles mismatches, and persists state to disk.

## Next lesson
L26 - Freeroll scheduler UI: `feynman/lessons/L26-freeroll-scheduler-ui.md`
