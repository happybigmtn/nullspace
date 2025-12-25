import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

const parseRetentionMs = (raw: string | undefined, fallbackMs: number): number => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
  return Math.floor(parsed);
};

const CHALLENGE_RETENTION_MS = parseRetentionMs(
  process.env.AUTH_CHALLENGE_RETENTION_MS,
  60 * 60 * 1000,
);
const STRIPE_EVENT_RETENTION_MS = parseRetentionMs(
  process.env.STRIPE_EVENT_RETENTION_MS,
  30 * 24 * 60 * 60 * 1000,
);
const PRUNE_BATCH = 200;

export const pruneAuthChallenges = internalMutation({
  args: { nowMs: v.optional(v.number()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const now = args.nowMs ?? Date.now();
    const cutoff = now - CHALLENGE_RETENTION_MS;
    const expired = await ctx.db
      .query("auth_challenges")
      .withIndex("by_expires_at", (q) => q.lte("expiresAtMs", cutoff))
      .take(PRUNE_BATCH);
    for (const record of expired) {
      await ctx.db.delete(record._id);
    }
    return expired.length;
  },
});

export const pruneStripeEvents = internalMutation({
  args: { nowMs: v.optional(v.number()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const now = args.nowMs ?? Date.now();
    const cutoff = now - STRIPE_EVENT_RETENTION_MS;
    const expired = await ctx.db
      .query("stripe_events")
      .withIndex("by_processed_at", (q) => q.lte("processedAtMs", cutoff))
      .take(PRUNE_BATCH);
    for (const record of expired) {
      await ctx.db.delete(record._id);
    }
    return expired.length;
  },
});
