import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireServiceToken } from "./serviceAuth";

export const createAuthChallenge = mutation({
  args: {
    serviceToken: v.string(),
    challengeId: v.string(),
    publicKey: v.string(),
    challenge: v.string(),
    expiresAtMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    await ctx.db.insert("auth_challenges", {
      challengeId: args.challengeId,
      publicKey: args.publicKey,
      challenge: args.challenge,
      expiresAtMs: args.expiresAtMs,
    });
    return null;
  },
});

export const consumeAuthChallenge = mutation({
  args: {
    serviceToken: v.string(),
    challengeId: v.string(),
    publicKey: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      challenge: v.string(),
      expiresAtMs: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const record = await ctx.db
      .query("auth_challenges")
      .withIndex("by_challenge_id", (q) => q.eq("challengeId", args.challengeId))
      .unique();

    if (!record) return null;
    if (record.publicKey !== args.publicKey) return null;
    if (record.usedAtMs) return null;
    if (record.expiresAtMs <= Date.now()) return null;

    await ctx.db.patch(record._id, { usedAtMs: Date.now() });
    return { challenge: record.challenge, expiresAtMs: record.expiresAtMs };
  },
});
