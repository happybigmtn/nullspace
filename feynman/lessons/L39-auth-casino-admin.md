# L39 - Auth admin sync (wasm + /submit) (from scratch)

Focus file: `services/auth/src/casinoAdmin.ts`

Goal: explain how the auth service loads admin secrets, builds admin transactions via WASM, manages nonces, and submits on-chain updates for freeroll limits. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Why an admin key exists
Some changes (like setting daily freeroll limits) are administrative on-chain actions. Those actions must be signed by a trusted admin key.

### 2) Why WASM is used
The transaction format and crypto are implemented in Rust and compiled to WASM. The auth service loads that WASM so it can build valid transactions without re-implementing the logic in TypeScript.

### 3) Nonces prevent replay and ordering bugs
Every on-chain transaction has a nonce. If two requests use the same nonce, one will fail. This file uses a nonce store and a queue to avoid collisions.

### 4) Entitlements drive on-chain policy
Stripe entitlements determine whether a user is a free or paid member. The auth service converts that into a numeric freeroll limit and submits an admin transaction to set it.

---

## Limits & management callouts (important)

1) **Admin private key must be 64 hex chars**
- `CASINO_ADMIN_PRIVATE_KEY_*` must decode to 32 bytes (64 hex chars).
- If missing or invalid, admin sync is disabled.

2) **Identity hex must be 192 hex chars**
- `CASINO_IDENTITY_HEX` must be 96 bytes (192 hex chars).
- Without it, state decoding and submissions fail.

3) **Freeroll limits are capped at 255**
- `parseLimit` clamps limits to 255.
- Defaults: free=1, member=10. Validate these against business goals.

4) **Env-based admin keys are blocked in production**
- `ALLOW_INSECURE_ADMIN_KEY_ENV` must be set to allow env keys in prod.
- This is the right default; file or URL secrets are safer.

5) **Nonce store is optional but important**
- If Convex nonce store is unavailable, the service uses an in-memory counter.
- This can drift across restarts, causing nonce conflicts.

---

## Walkthrough with code excerpts

### 1) Resolving the admin private key
```rust
const resolveAdminKeyHex = async (): Promise<string> => {
  const secretUrl = process.env.CASINO_ADMIN_PRIVATE_KEY_URL;
  if (secretUrl) {
    const fromUrl = await readSecretUrl(secretUrl, "admin key");
    if (fromUrl) return fromUrl;
  }

  const filePath = process.env.CASINO_ADMIN_PRIVATE_KEY_FILE;
  if (filePath) {
    const fromFile = await readSecretFile(filePath, "admin key");
    if (fromFile) return fromFile;
  }

  const fromEnv = process.env.CASINO_ADMIN_PRIVATE_KEY_HEX ?? "";
  const allowEnv =
    process.env.ALLOW_INSECURE_ADMIN_KEY_ENV === "true" || process.env.NODE_ENV !== "production";
  if (fromEnv && allowEnv) {
    return fromEnv;
  }
  if (fromEnv && !allowEnv) {
    console.warn(
      "[auth] CASINO_ADMIN_PRIVATE_KEY_HEX is not allowed in production; use CASINO_ADMIN_PRIVATE_KEY_FILE instead.",
    );
  }
  return "";
};
```

Why this matters:
- The admin key is the root of trust for on-chain admin actions. Loading it safely is critical.

Syntax notes:
- The function checks URL, file, then environment variable in priority order.
- `process.env.NODE_ENV !== "production"` permits env keys in dev.

What this code does:
- Attempts to read the admin key from a secret URL first.
- Falls back to a file-based secret.
- Uses an env var only in non-production (or if explicitly allowed).
- Returns an empty string if no valid key is found.

---

### 2) Limit parsing and entitlement checks
```rust
const parseLimit = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(255, Math.floor(parsed));
};

const getMemberTiers = (): string[] => {
  const raw = process.env.FREEROLL_MEMBER_TIERS ?? "";
  return raw
    .split(",")
    .map((tier) => tier.trim())
    .filter(Boolean);
};

const hasActiveEntitlement = (entitlements: Entitlement[], tiers: string[]): boolean => {
  return entitlements.some((entitlement) => {
    if (!ACTIVE_STATUSES.has(entitlement.status ?? "")) return false;
    if (tiers.length === 0) return true;
    return tiers.includes(entitlement.tier ?? "");
  });
};
```

Why this matters:
- This is where business policy (tiers and limits) turns into a numeric value used on chain.

Syntax notes:
- `Math.min(255, ...)` enforces a hard cap at 255.
- `entitlements.some(...)` returns true if any entitlement matches the rules.

What this code does:
- Parses limit values safely and clamps them.
- Reads the list of member tiers from env.
- Checks whether a user has an active entitlement in those tiers.

---

### 3) Loading the WASM transaction builder
```rust
const loadWasm = async (): Promise<WasmModule | null> => {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      const wasmModulePath = require.resolve("website/wasm/pkg/nullspace_wasm.js");
      const wasmBinPath = require.resolve("website/wasm/pkg/nullspace_wasm_bg.wasm");
      const wasmModule = (await import(pathToFileURL(wasmModulePath).href)) as WasmModule;
      const fs = await import("fs/promises");
      const wasmBytes = await fs.readFile(wasmBinPath);
      await wasmModule.default({ module_or_path: wasmBytes });
      return wasmModule;
    })().catch((error) => {
      console.warn("[auth] Failed to load wasm module:", error);
      return null;
    });
  }
  return wasmPromise;
};
```

Why this matters:
- Without this WASM module, the auth service cannot build valid admin transactions.

Syntax notes:
- `require.resolve(...)` finds the compiled WASM assets.
- The `wasmPromise` cache prevents multiple concurrent loads.

What this code does:
- Loads both the JS loader and the WASM binary from the website package.
- Initializes the WASM module with the raw bytes.
- Caches the module for future calls.

---

### 4) Building admin state (key + identity)
```rust
const initAdminState = async (adminKeyHex: string): Promise<AdminState | null> => {
  const normalizedKey = normalizeHex(adminKeyHex);
  const identityHex = normalizeHex(process.env.CASINO_IDENTITY_HEX ?? "");
  const baseUrl = process.env.CASINO_API_URL ?? "http://localhost:8080/api";

  if (!normalizedKey || normalizedKey.length !== 64) {
    console.warn("[auth] Missing or invalid casino admin private key");
    return null;
  }
  if (!identityHex || identityHex.length !== 192) {
    console.warn("[auth] Missing or invalid CASINO_IDENTITY_HEX");
    return null;
  }

  const wasm = await loadWasm();
  if (!wasm) return null;

  const adminKeyBytes = hexToBytes(normalizedKey);
  const signer = wasm.Signer.from_bytes(adminKeyBytes);
  const adminPublicKeyBytes = signer.public_key as Uint8Array;
  const identityBytes = hexToBytes(identityHex);

  return { wasm, signer, adminPublicKeyBytes, identityBytes, baseUrl };
};
```

Why this matters:
- Admin state contains everything needed to sign and submit on-chain transactions.

Syntax notes:
- `wasm.Signer.from_bytes(...)` constructs the signer from the private key.
- `signer.public_key` is accessed as a raw byte array.

What this code does:
- Validates the admin key and identity lengths.
- Loads the WASM module and creates a signer.
- Returns the admin state used by all later functions.

---

### 5) Initializing the nonce store
```rust
const initNonceStore = async (state: AdminState): Promise<NonceStore | null> => {
  const convexUrl = process.env.CONVEX_URL ?? "";
  const serviceToken = process.env.CONVEX_SERVICE_TOKEN ?? "";
  if (!convexUrl || !serviceToken) {
    console.warn("[auth] Missing CONVEX_URL or CONVEX_SERVICE_TOKEN; using local nonce cache.");
    return null;
  }
  const client = new ConvexHttpClient(convexUrl, {
    skipConvexDeploymentUrlCheck: true,
  });
  return {
    client,
    serviceToken,
    adminPublicKeyHex: bytesToHex(state.adminPublicKeyBytes),
  };
};
```

Why this matters:
- Shared nonce state prevents two parallel requests from using the same nonce.

What this code does:
- Builds a Convex client if the URL and service token are available.
- Returns a nonce store object for later reservation calls.
- Falls back to an in-memory counter if Convex is not configured.

---

### 6) Reserving and resetting nonces
```rust
const reserveNonce = async (state: AdminState): Promise<number> => {
  const store = await getNonceStore(state);
  if (store) {
    const fallbackNonce = await getAccountNonce(state);
    try {
      return await store.client.mutation(api.admin.reserveAdminNonce, {
        serviceToken: store.serviceToken,
        adminPublicKey: store.adminPublicKeyHex,
        fallbackNonce,
      });
    } catch (error) {
      console.warn("[auth] Nonce store reservation failed, falling back:", error);
    }
  }

  if (state.nextNonce === undefined) {
    state.nextNonce = await getAccountNonce(state);
  }
  const nonce = state.nextNonce;
  state.nextNonce += 1;
  return nonce;
};
```

Why this matters:
- Nonces must be unique and ordered. This prevents double-spends and rejected admin txs.

What this code does:
- Tries to reserve a nonce through Convex for global consistency.
- If Convex is unavailable, uses a local in-memory counter.
- Falls back to on-chain nonce if needed.

---

### 7) Submitting an admin transaction
```rust
const submitTransaction = async (state: AdminState, tx: Uint8Array): Promise<void> => {
  const submission = state.wasm.wrap_transaction_submission(tx);
  const response = await fetch(`${state.baseUrl}/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
    },
    body: Buffer.from(submission),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Submit failed (${response.status}): ${text}`);
  }
};
```

Why this matters:
- This is the actual point where a signed admin transaction hits the chain.

Syntax notes:
- `wrap_transaction_submission` adds the protocol framing expected by the backend.
- The body is raw bytes, not JSON.

What this code does:
- Wraps a raw transaction into the submission format.
- Posts it to the casino backend `/submit` endpoint.
- Throws if the backend rejects it.

---

### 8) Syncing freeroll limits end-to-end
```rust
export const syncFreerollLimit = async (
  publicKeyHex: string,
  entitlements: Entitlement[],
): Promise<{ status: string; limit?: number }> => {
  const state = await getAdminState();
  if (!state) {
    return { status: "admin_unconfigured" };
  }

  const normalizedKey = normalizeHex(publicKeyHex);
  if (normalizedKey.length !== 64) {
    return { status: "invalid_public_key" };
  }

  const freeLimit = parseLimit(process.env.FREEROLL_DAILY_LIMIT_FREE, 1);
  const memberLimit = parseLimit(process.env.FREEROLL_DAILY_LIMIT_MEMBER, 10);
  const tiers = getMemberTiers();
  const desiredLimit = hasActiveEntitlement(entitlements, tiers)
    ? memberLimit
    : freeLimit;

  return enqueueAdmin(async () => {
    const playerKeyBytes = hexToBytes(normalizedKey);
    const player = await getPlayer(state, playerKeyBytes);
    if (!player) {
      return { status: "player_not_found" };
    }

    const currentLimit = Number(player.tournament_daily_limit ?? 0);
    const adminPublicKeyHex = bytesToHex(state.adminPublicKeyBytes);
    if (currentLimit === desiredLimit) {
      console.info("[auth][audit] tournament_limit.no_change", {
        playerPublicKey: normalizedKey,
        currentLimit,
        desiredLimit,
        adminPublicKey: adminPublicKeyHex,
      });
      return { status: "already_set", limit: desiredLimit };
    }

    try {
      const nonce = await reserveNonce(state);
      const tx = state.wasm.Transaction.casino_set_tournament_limit(
        state.signer,
        BigInt(nonce),
        playerKeyBytes,
        desiredLimit,
      );
      console.info("[auth][audit] tournament_limit.submit", {
        playerPublicKey: normalizedKey,
        currentLimit,
        desiredLimit,
        adminPublicKey: adminPublicKeyHex,
      });
      await submitTransaction(state, tx.encode());
      console.info("[auth][audit] tournament_limit.submitted", {
        playerPublicKey: normalizedKey,
        desiredLimit,
        adminPublicKey: adminPublicKeyHex,
      });
      return { status: "submitted", limit: desiredLimit };
    } catch (error) {
      console.warn("[auth][audit] tournament_limit.failed", {
        playerPublicKey: normalizedKey,
        desiredLimit,
        adminPublicKey: adminPublicKeyHex,
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        await resetNonceStore(state);
      } catch (resetError) {
        console.warn("[auth] Failed to reset nonce store:", resetError);
      }
      throw error;
    }
  });
};
```

Why this matters:
- This function ties Stripe entitlements to on-chain limits, which is the heart of the paid/free experience.

Syntax notes:
- `enqueueAdmin` serializes all admin tasks so nonces are never reused in parallel.
- `BigInt(nonce)` is required because the WASM API expects a 64-bit integer.

What this code does:
- Loads admin state and validates the player key.
- Computes the desired daily limit based on entitlements.
- Uses the admin queue to submit a signed transaction.
- If submission fails, resets nonce state to recover.

---

## Key takeaways
- Admin keys are loaded securely and validated before use.
- WASM handles transaction construction and signing.
- Nonces are reserved via Convex when possible and sequenced with a queue.
- Entitlements directly control on-chain freeroll limits.

## Next lesson
L40 - Admin nonce store (integration): `feynman/lessons/L40-convex-admin-nonce-integration.md`
