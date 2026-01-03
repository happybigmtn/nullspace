# L32 - Auth service endpoints (from scratch)

Focus file: `services/auth/src/server.ts`

Goal: explain the main auth endpoints: challenge creation, signature verification, profile lookup, and freeroll sync. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Challenge/response auth
The server issues a random challenge. The client signs it. The server verifies the signature to prove ownership of the key.

### 2) Origins and CORS
Auth endpoints are protected by an origin allowlist. Requests from untrusted origins are rejected.

### 3) Entitlements + freeroll sync
After login, the server can sync freeroll limits on chain based on Stripe entitlements.

---

## Limits & management callouts (important)

1) **AUTH_CHALLENGE_TTL_MS default = 300000**
- Challenges expire after 5 minutes to prevent replay.

2) **Rate limits (challenge/profile/billing)**
- Each endpoint applies a rate limiter. Adjust carefully to avoid blocking legitimate users.

3) **AUTH_ALLOWED_ORIGINS must be set**
- If empty, server throws on startup.

---

## Walkthrough with code excerpts

### 1) CORS and origin allowlist
```ts
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed"));
    },
    credentials: true,
    exposedHeaders: ["x-request-id"],
  }),
);
```

Why this matters:
- Prevents browsers on unknown domains from accessing auth APIs.

What this code does:
- Allows requests only from configured origins.
- Enables cookies/credentials and exposes request IDs for debugging.

---

### 2) Challenge endpoint
```ts
app.post("/auth/challenge", requireAllowedOrigin, challengeRateLimit, async (req, res) => {
  const publicKey = normalizeHex(String(req.body?.publicKey ?? ""));
  if (!isHex(publicKey, 64)) {
    res.status(400).json({ error: "invalid publicKey" });
    return;
  }
  const challengeId = crypto.randomUUID();
  const challenge = crypto.randomBytes(32).toString("hex");
  const expiresAtMs = Date.now() + challengeTtlMs;

  await convex.mutation(api.auth.createAuthChallenge, {
    serviceToken,
    challengeId,
    publicKey,
    challenge,
    expiresAtMs,
  });

  res.json({ challengeId, challenge, expiresAtMs });
});
```

Why this matters:
- This is the entry point for proving key ownership.

What this code does:
- Validates the public key format.
- Generates a random challenge and stores it in Convex with a TTL.
- Returns the challenge to the client.

---

### 3) Mobile entitlements (signature check)
```ts
app.post("/mobile/entitlements", challengeRateLimit, async (req, res) => {
  if (!mobileEnabled) {
    res.status(403).json({ error: "mobile_disabled" });
    return;
  }
  const publicKey = normalizeHex(String(req.body?.publicKey ?? ""));
  const signature = normalizeHex(String(req.body?.signature ?? ""));
  const challengeId = String(req.body?.challengeId ?? "");
  if (!isHex(publicKey, 64)) {
    res.status(400).json({ error: "invalid publicKey" });
    return;
  }
  if (!isHex(signature, 128)) {
    res.status(400).json({ error: "invalid signature" });
    return;
  }

  const challenge = await convex.mutation(api.auth.consumeAuthChallenge, {
    serviceToken,
    challengeId,
    publicKey,
  });
  if (!challenge) {
    res.status(400).json({ error: "invalid challenge" });
    return;
  }
  if (!verifySignature(publicKey, signature, challenge.challenge)) {
    res.status(400).json({ error: "invalid signature" });
    return;
  }

  // lookup entitlements and sync freeroll limit
  // ...
});
```

Why this matters:
- This is the trust boundary: signature verification proves the user controls the key.

What this code does:
- Validates input formats.
- Consumes the stored challenge (one-time use).
- Verifies the signature before returning entitlements.

---

### 4) Profile endpoint + freeroll sync
```ts
app.get("/profile", requireAllowedOrigin, profileRateLimit, async (req, res) => {
  const session = await getSession(req, authConfig);
  const userId = (session as any)?.user?.id as string | undefined;
  if (!userId) {
    res.status(401).json({ session: null, entitlements: [] });
    return;
  }
  const entitlements = await convex.query(api.entitlements.getEntitlementsByUser, {
    serviceToken,
    userId,
  });
  const evmLink = await convex.query(api.evm.getEvmLinkByUser, {
    serviceToken,
    userId,
  });
  const publicKey = (session as any)?.user?.authSubject as string | undefined;
  if (publicKey) {
    syncFreerollLimit(publicKey, entitlements)
      .catch(() => { /* ignore */ });
  }
  res.json({ session, entitlements, evmLink });
});
```

Why this matters:
- This endpoint connects login state to on‑chain freeroll limits.

What this code does:
- Validates the session.
- Fetches entitlements and EVM links from Convex.
- Triggers `syncFreerollLimit` to update on-chain limits if needed.

---

## Key takeaways
- Auth endpoints use challenge/response and origin allowlists.
- Entitlements can drive on‑chain admin updates.
- Profile requests also trigger freeroll sync as a side effect.

## Next lesson
L33 - Convex auth sync: `feynman/lessons/L33-convex-auth.md`
