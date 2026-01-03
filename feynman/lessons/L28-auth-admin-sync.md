# L28 - Auth service + admin txs (from scratch)

Focus files:
- `services/auth/src/server.ts`
- `services/auth/src/casinoAdmin.ts`

Goal: explain how the auth service enforces origin checks, signs/validates auth, and submits admin transactions to sync freeroll limits. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Auth service responsibilities
The auth service handles:
- login/session validation,
- origin allowlists,
- optional AI strategy helper,
- and admin-only on‑chain actions like setting freeroll limits.

### 2) Admin transactions
Some changes (like daily tournament limits) are admin instructions that must be signed and submitted on chain. The auth service owns the admin key and handles submissions.

### 3) Convex as a nonce store
Admin transactions must use the correct nonce. The service reserves nonces in Convex to avoid collisions across requests.

---

## Limits & management callouts (important)

1) **AUTH_ALLOWED_ORIGINS is required**
- If it’s empty, the server throws at startup.
- Misconfiguration blocks all clients.

2) **AUTH_CHALLENGE_TTL_MS default = 300000 (5 minutes)**
- Too short causes login failures; too long increases replay risk.

3) **Metrics auth can be required**
- `AUTH_REQUIRE_METRICS_AUTH` + `METRICS_AUTH_TOKEN` gate `/metrics` endpoints.

4) **Freeroll limit caps to 255**
- `parseLimit` clamps daily limits to `<= 255`.

---

## Walkthrough with code excerpts

### 1) Required env values (auth server)
```ts
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
};

const convex = new ConvexHttpClient(required("CONVEX_URL"), {
  skipConvexDeploymentUrlCheck: true,
});
const serviceToken = required("CONVEX_SERVICE_TOKEN");
```

Why this matters:
- Missing environment variables should fail fast. Auth without Convex is not safe.

What this code does:
- Validates that required env vars are present.
- Initializes the Convex client and service token for server-side mutations.

---

### 2) Origin allowlist enforcement
```ts
const allowedOrigins = parseAllowedOrigins();
if (allowedOrigins.length === 0) {
  throw new Error("AUTH_ALLOWED_ORIGINS must be set");
}

const requireAllowedOrigin: express.RequestHandler = (req, res, next) => {
  const origin = getRequestOrigin(req);
  if (!origin || !allowedOrigins.includes(origin)) {
    res.status(403).json({ error: "origin_not_allowed" });
    return;
  }
  next();
};
```

Why this matters:
- Prevents unauthorized websites or apps from hitting auth endpoints.

What this code does:
- Parses allowed origins from env.
- Rejects requests whose Origin/Referer is not in the list.

---

### 3) Metrics auth gate
```ts
const metricsAuthToken = process.env.METRICS_AUTH_TOKEN ?? "";
const requireMetricsAuthToken =
  String(process.env.AUTH_REQUIRE_METRICS_AUTH ?? "").toLowerCase() === "true" ||
  String(process.env.AUTH_REQUIRE_METRICS_AUTH ?? "") === "1" ||
  process.env.NODE_ENV === "production";
if (requireMetricsAuthToken && !metricsAuthToken) {
  throw new Error("METRICS_AUTH_TOKEN must be set when metrics auth is required");
}
const requireMetricsAuth: express.RequestHandler = (req, res, next) => {
  if (!metricsAuthToken) {
    next();
    return;
  }
  const authHeader = req.headers.authorization;
  const bearerToken =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;
  const headerToken =
    typeof req.headers["x-metrics-token"] === "string"
      ? req.headers["x-metrics-token"]
      : null;
  if (bearerToken === metricsAuthToken || headerToken === metricsAuthToken) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized" });
};
```

Why this matters:
- Metrics can expose sensitive operational data. This gate keeps them private.

What this code does:
- Requires a token in production or when explicitly enabled.
- Accepts either a Bearer token or `x-metrics-token` header.

---

### 4) Admin key resolution (casinoAdmin)
```ts
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
- Admin keys are high‑risk secrets. Production should use file or URL sources, not env.

What this code does:
- Tries URL, then file, then env (only in non‑prod or when explicitly allowed).
- Returns an empty string if nothing is available.

---

### 5) Submit admin transaction (freeroll limit)
```ts
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
- Admin limits only take effect after an on‑chain transaction is submitted.

What this code does:
- Wraps a signed transaction in a submission payload.
- Sends it to `/submit` and throws on failure.

---

### 6) Sync freeroll limits
```ts
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
    if (currentLimit === desiredLimit) {
      return { status: "already_set", limit: desiredLimit };
    }

    const nonce = await reserveNonce(state);
    const tx = state.wasm.Transaction.casino_set_tournament_limit(
      state.signer,
      BigInt(nonce),
      playerKeyBytes,
      desiredLimit,
    );
    await submitTransaction(state, tx.encode());
    return { status: "submitted", limit: desiredLimit };
  });
};
```

Why this matters:
- Freeroll limits are part of the abuse‑prevention system. If sync fails, entitlements don’t apply.

What this code does:
- Computes a desired daily limit based on entitlements.
- Fetches the player’s on‑chain state and compares the current limit.
- If needed, builds and submits an admin transaction to set the new limit.

---

## Key takeaways
- The auth service enforces origin allowlists and metrics auth.
- Admin transactions are built in WASM and submitted to the chain.
- Freeroll limits are synced by reading player state and issuing admin updates.

## Next lesson
L29 - Convex admin nonce store: `feynman/lessons/L29-convex-admin-nonce-store.md`
