import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const rateBuckets = new Map<string, RateLimitBucket>();
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
let lastRateLimitCleanup = 0;

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

const getRequestIp = (req: Request): string => {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
};

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

export default http;
