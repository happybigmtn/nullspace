import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireServiceToken } from "./serviceAuth";

const normalizeNonce = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
};

export const reserveAdminNonce = mutation({
  args: {
    serviceToken: v.string(),
    adminPublicKey: v.string(),
    fallbackNonce: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const fallbackNonce = normalizeNonce(args.fallbackNonce);
    const existing = await ctx.db
      .query("admin_nonces")
      .withIndex("by_admin_public_key", (q) =>
        q.eq("adminPublicKey", args.adminPublicKey),
      )
      .unique();

    if (!existing) {
      await ctx.db.insert("admin_nonces", {
        adminPublicKey: args.adminPublicKey,
        nextNonce: fallbackNonce + 1,
        updatedAtMs: Date.now(),
      });
      return fallbackNonce;
    }

    const reserved = normalizeNonce(existing.nextNonce);
    await ctx.db.patch(existing._id, {
      nextNonce: reserved + 1,
      updatedAtMs: Date.now(),
    });
    return reserved;
  },
});

export const resetAdminNonce = mutation({
  args: {
    serviceToken: v.string(),
    adminPublicKey: v.string(),
    nextNonce: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const nextNonce = normalizeNonce(args.nextNonce);
    const existing = await ctx.db
      .query("admin_nonces")
      .withIndex("by_admin_public_key", (q) =>
        q.eq("adminPublicKey", args.adminPublicKey),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        nextNonce,
        updatedAtMs: Date.now(),
      });
      return null;
    }

    await ctx.db.insert("admin_nonces", {
      adminPublicKey: args.adminPublicKey,
      nextNonce,
      updatedAtMs: Date.now(),
    });
    return null;
  },
});
