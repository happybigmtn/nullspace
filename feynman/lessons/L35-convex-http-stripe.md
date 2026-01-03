# L35 - Stripe webhook ingress (from scratch)

Focus file: `website/convex/http.ts`

Goal: explain how Stripe webhooks enter the system, how rate limits are enforced, and how payloads are handed off to Convex actions. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) What a webhook is
A webhook is an HTTP callback sent by another service (Stripe). Stripe calls our `/stripe/webhook` endpoint whenever a billing event happens. We must verify that the request is authentic and process it quickly.

### 2) Why we rate limit webhooks
Even legitimate services can retry aggressively. Rate limits protect the service from floods, misconfigurations, or abuse. Here we use an in-memory bucket per IP address.

### 3) Convex HTTP actions
Convex has a special HTTP router. It lets you expose routes that run inside Convex, then forward work to internal actions or mutations.

---

## Limits & management callouts (important)

1) **Rate limit window defaults to 60 seconds**
- `STRIPE_WEBHOOK_RATE_LIMIT_WINDOW_MS` default is 60,000 ms.
- At most `STRIPE_WEBHOOK_RATE_LIMIT_MAX` events per window (default 120).
- This is reasonable for small deployments but may be too low at high volume.

2) **Bucket memory cap defaults to 10,000 IPs**
- `STRIPE_WEBHOOK_RATE_LIMIT_BUCKET_MAX` prevents unbounded memory growth.
- If too low, legitimate bursts from many IPs may be evicted.

3) **Rate limiting is per instance only**
- Buckets live in memory, so limits reset if the instance restarts.
- In a multi-instance deployment, each instance has its own counters.

---

## Walkthrough with code excerpts

### 1) Parsing integer env values safely
```rust
const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};
```

Why this matters:
- This prevents bad env values from crashing the service or disabling rate limits.

What this code does:
- Attempts to parse a string into a positive integer.
- Falls back to a safe default if parsing fails.

---

### 2) Rate limit configuration
```rust
const RATE_LIMIT_WINDOW_MS = parsePositiveInt(
  process.env.STRIPE_WEBHOOK_RATE_LIMIT_WINDOW_MS,
  60_000,
);
const RATE_LIMIT_MAX = parsePositiveInt(
  process.env.STRIPE_WEBHOOK_RATE_LIMIT_MAX,
  120,
);
const RATE_LIMIT_BUCKET_MAX = parsePositiveInt(
  process.env.STRIPE_WEBHOOK_RATE_LIMIT_BUCKET_MAX,
  10_000,
);
const RATE_LIMIT_CLEANUP_MS = parsePositiveInt(
  process.env.STRIPE_WEBHOOK_RATE_LIMIT_CLEANUP_MS,
  300_000,
);
```

Why this matters:
- These values control how many Stripe events we can handle before throttling.

What this code does:
- Reads configurable limits from env, with safe defaults.
- Ensures everything is positive and integer.

---

### 3) Bucket cleanup logic
```rust
const cleanupRateBuckets = (now: number) => {
  if (rateBuckets.size === 0) return;
  if (now - lastRateLimitCleanup < RATE_LIMIT_CLEANUP_MS && rateBuckets.size <= RATE_LIMIT_BUCKET_MAX) {
    return;
  }
  lastRateLimitCleanup = now;
  for (const [key, bucket] of rateBuckets.entries()) {
    if (now > bucket.resetAt) {
      rateBuckets.delete(key);
    }
  }
  if (rateBuckets.size > RATE_LIMIT_BUCKET_MAX) {
    const toRemove = rateBuckets.size - RATE_LIMIT_BUCKET_MAX;
    let removed = 0;
    for (const key of rateBuckets.keys()) {
      rateBuckets.delete(key);
      removed += 1;
      if (removed >= toRemove) break;
    }
  }
};
```

Why this matters:
- Without cleanup, the in-memory bucket map would grow forever.

Syntax notes:
- `rateBuckets` is a `Map<string, RateLimitBucket>` keyed by IP.
- `.entries()` returns `[key, value]` pairs you can iterate.

What this code does:
- Periodically removes expired buckets.
- If the map grows beyond the max size, it evicts the oldest entries.

---

### 4) Getting the client IP
```rust
const getRequestIp = (req: Request): string => {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
};
```

Why this matters:
- Rate limits are per IP, so we must derive a consistent key.

What this code does:
- Prefers `x-forwarded-for` (common behind proxies).
- Falls back to `x-real-ip`.
- Uses "unknown" if neither is present.

---

### 5) Enforcing the rate limit
```rust
const enforceRateLimit = (key: string): boolean => {
  const now = Date.now();
  cleanupRateBuckets(now);
  const bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) {
    return false;
  }
  bucket.count += 1;
  return true;
};
```

Why this matters:
- This logic is the guardrail that blocks abusive traffic.

What this code does:
- Creates or resets a bucket when the window expires.
- Rejects when the count hits the limit.
- Increments the counter for each request.

---

### 6) Stripe webhook route
```rust
http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const startedAt = Date.now();
    const requestId = req.headers.get("x-request-id") ?? "unknown";
    const ip = getRequestIp(req);
    if (!enforceRateLimit(`stripe:${ip}`)) {
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "stripe.webhook.rate_limited",
          requestId,
          ip,
        }),
      );
      return new Response("rate limited", { status: 429 });
    }

    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "stripe.webhook.missing_signature",
          requestId,
          ip,
        }),
      );
      return new Response("Missing stripe signature", { status: 400 });
    }

    try {
      const payload = await req.arrayBuffer();
      await ctx.runAction(internal.stripe.handleStripeWebhook, {
        signature,
        payload,
      });
      const elapsedMs = Date.now() - startedAt;
      console.info(
        JSON.stringify({
          level: "info",
          message: "stripe.webhook.ok",
          requestId,
          ip,
          elapsedMs,
        }),
      );
      return new Response("ok", { status: 200 });
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "stripe.webhook.failed",
          requestId,
          ip,
          elapsedMs,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return new Response("webhook failed", { status: 500 });
    }
  }),
});
```

Why this matters:
- This is the public entrypoint from Stripe into your system.

Syntax notes:
- `httpAction` wraps an async handler so it can run in Convex.
- `ctx.runAction` calls an internal Convex action from inside the HTTP handler.
- `req.arrayBuffer()` reads the raw bytes needed for Stripe signature verification.

What this code does:
- Applies the rate limit and rejects if over limit.
- Requires the Stripe signature header.
- Forwards the raw payload and signature to the internal Stripe handler.
- Logs success or failure with a request ID and timing.

---

## Key takeaways
- Stripe webhooks arrive through Convex HTTP routes.
- Rate limiting protects the service from overload or retries.
- The raw payload is forwarded to the Stripe handler for signature verification.

## Next lesson
L36 - Stripe actions + sessions: `feynman/lessons/L36-convex-stripe-actions.md`
