import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { requireServiceToken } from "./serviceAuth";

const RELINK_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const STATUS_ACTIVE = "active";
const STATUS_UNLINKED = "unlinked";

const evmLinkDoc = v.object({
  _id: v.id("evm_links"),
  _creationTime: v.number(),
  userId: v.id("users"),
  evmAddress: v.string(),
  chainId: v.number(),
  status: v.string(),
  signatureType: v.string(),
  linkedAtMs: v.number(),
  lastVerifiedAtMs: v.number(),
  unlinkedAtMs: v.optional(v.number()),
});

export const createEvmChallenge = mutation({
  args: {
    serviceToken: v.string(),
    challengeId: v.string(),
    userId: v.id("users"),
    evmAddress: v.string(),
    chainId: v.number(),
    challenge: v.string(),
    expiresAtMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    await ctx.db.insert("evm_challenges", {
      challengeId: args.challengeId,
      userId: args.userId,
      evmAddress: args.evmAddress.toLowerCase(),
      chainId: args.chainId,
      challenge: args.challenge,
      expiresAtMs: args.expiresAtMs,
    });
    return null;
  },
});

export const consumeEvmChallenge = mutation({
  args: {
    serviceToken: v.string(),
    challengeId: v.string(),
    userId: v.id("users"),
    evmAddress: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      challenge: v.string(),
      chainId: v.number(),
      expiresAtMs: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const record = await ctx.db
      .query("evm_challenges")
      .withIndex("by_challenge_id", (q) => q.eq("challengeId", args.challengeId))
      .unique();

    if (!record) return null;
    if (record.userId !== args.userId) return null;
    if (record.evmAddress !== args.evmAddress.toLowerCase()) return null;
    if (record.usedAtMs) return null;
    if (record.expiresAtMs <= Date.now()) return null;

    await ctx.db.patch(record._id, { usedAtMs: Date.now() });
    return {
      challenge: record.challenge,
      chainId: record.chainId,
      expiresAtMs: record.expiresAtMs,
    };
  },
});

export const getEvmLinkByUser = query({
  args: {
    serviceToken: v.string(),
    userId: v.id("users"),
  },
  returns: v.union(v.null(), evmLinkDoc),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const link = await ctx.db
      .query("evm_links")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .unique();
    if (!link || link.status !== STATUS_ACTIVE) {
      return null;
    }
    return link;
  },
});

export const linkEvmAddress = mutation({
  args: {
    serviceToken: v.string(),
    userId: v.id("users"),
    evmAddress: v.string(),
    chainId: v.number(),
    signatureType: v.string(),
  },
  returns: evmLinkDoc,
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const now = Date.now();
    const address = args.evmAddress.toLowerCase();

    const user = await ctx.db.get(args.userId);
    if (!user || !user.publicKey) {
      throw new Error("User must link a casino public key before linking EVM.");
    }

    const existingByAddress = await ctx.db
      .query("evm_links")
      .withIndex("by_evm_address", (q) => q.eq("evmAddress", address))
      .unique();
    if (
      existingByAddress &&
      existingByAddress.userId !== args.userId &&
      existingByAddress.status === STATUS_ACTIVE
    ) {
      throw new Error("EVM address already linked to another account.");
    }

    const existingByUser = await ctx.db
      .query("evm_links")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .unique();

    if (existingByUser) {
      if (existingByUser.evmAddress !== address) {
        const lastUnlink = existingByUser.unlinkedAtMs ?? existingByUser.linkedAtMs;
        if (now - lastUnlink < RELINK_COOLDOWN_MS) {
          throw new Error("EVM relink cooldown active.");
        }
      }

      await ctx.db.patch(existingByUser._id, {
        evmAddress: address,
        chainId: args.chainId,
        status: STATUS_ACTIVE,
        signatureType: args.signatureType,
        linkedAtMs: existingByUser.evmAddress === address ? existingByUser.linkedAtMs : now,
        lastVerifiedAtMs: now,
        unlinkedAtMs: undefined,
      });
      return (await ctx.db.get(existingByUser._id)) as typeof existingByUser;
    }

    const id = await ctx.db.insert("evm_links", {
      userId: args.userId,
      evmAddress: address,
      chainId: args.chainId,
      status: STATUS_ACTIVE,
      signatureType: args.signatureType,
      linkedAtMs: now,
      lastVerifiedAtMs: now,
    });
    return (await ctx.db.get(id))!;
  },
});

export const unlinkEvmAddress = mutation({
  args: {
    serviceToken: v.string(),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const existing = await ctx.db
      .query("evm_links")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .unique();
    if (!existing || existing.status !== STATUS_ACTIVE) {
      return null;
    }
    await ctx.db.patch(existing._id, {
      status: STATUS_UNLINKED,
      unlinkedAtMs: Date.now(),
    });
    return null;
  },
});

export const listEvmLinks = query({
  args: {
    serviceToken: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    links: v.array(
      v.object({
        userId: v.id("users"),
        publicKey: v.optional(v.string()),
        evmAddress: v.string(),
        chainId: v.number(),
        linkedAtMs: v.number(),
      }),
    ),
    continueCursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const result = await ctx.db
      .query("evm_links")
      .withIndex("by_status", (q) => q.eq("status", STATUS_ACTIVE))
      .order("desc")
      .paginate(args.paginationOpts);

    const links = await Promise.all(
      result.page.map(async (link) => {
        const user = await ctx.db.get(link.userId);
        return {
          userId: link.userId,
          publicKey: user?.publicKey,
          evmAddress: link.evmAddress,
          chainId: link.chainId,
          linkedAtMs: link.linkedAtMs,
        };
      }),
    );

    return {
      links,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});
