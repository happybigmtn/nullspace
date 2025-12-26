import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { requireServiceToken } from "./serviceAuth";

const userDoc = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  authProvider: v.string(),
  authSubject: v.string(),
  email: v.optional(v.string()),
  name: v.optional(v.string()),
  publicKey: v.optional(v.string()),
  stripeCustomerId: v.optional(v.string()),
});

export const getUserByAuth = internalQuery({
  args: {
    authProvider: v.string(),
    authSubject: v.string(),
  },
  returns: v.union(v.null(), userDoc),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_auth_provider_and_subject", (q) =>
        q.eq("authProvider", args.authProvider).eq("authSubject", args.authSubject),
      )
      .unique();
    return user ?? null;
  },
});

export const getUserById = internalQuery({
  args: {
    userId: v.id("users"),
  },
  returns: v.union(v.null(), userDoc),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    return user ?? null;
  },
});

export const getUserByIdWithToken = query({
  args: {
    serviceToken: v.string(),
    userId: v.id("users"),
  },
  returns: v.union(v.null(), userDoc),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const user = await ctx.db.get(args.userId);
    return user ?? null;
  },
});

export const upsertUser = mutation({
  args: {
    serviceToken: v.string(),
    authProvider: v.string(),
    authSubject: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    publicKey: v.optional(v.string()),
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const existing = await ctx.db
      .query("users")
      .withIndex("by_auth_provider_and_subject", (q) =>
        q.eq("authProvider", args.authProvider).eq("authSubject", args.authSubject),
      )
      .unique();

    if (existing) {
      const patch: {
        email?: string;
        name?: string;
        publicKey?: string;
      } = {};
      if (args.email !== undefined) patch.email = args.email;
      if (args.name !== undefined) patch.name = args.name;
      if (args.publicKey !== undefined) patch.publicKey = args.publicKey;
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(existing._id, patch);
      }
      return existing._id;
    }

    return await ctx.db.insert("users", {
      authProvider: args.authProvider,
      authSubject: args.authSubject,
      email: args.email,
      name: args.name,
      publicKey: args.publicKey,
    });
  },
});

export const linkPublicKey = mutation({
  args: {
    serviceToken: v.string(),
    userId: v.id("users"),
    publicKey: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const existing = await ctx.db
      .query("users")
      .withIndex("by_public_key", (q) => q.eq("publicKey", args.publicKey))
      .unique();

    if (existing && existing._id !== args.userId) {
      throw new Error("Public key already linked to another account.");
    }

    await ctx.db.patch(args.userId, { publicKey: args.publicKey });
    return null;
  },
});

export const setStripeCustomerId = internalMutation({
  args: {
    userId: v.id("users"),
    stripeCustomerId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { stripeCustomerId: args.stripeCustomerId });
    return null;
  },
});

export const listUsersForStripeReconcile = internalQuery({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    users: v.array(
      v.object({
        _id: v.id("users"),
        stripeCustomerId: v.optional(v.string()),
      }),
    ),
    continueCursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("users")
      .order("asc")
      .paginate(args.paginationOpts);
    return {
      users: result.page.map((user) => ({
        _id: user._id,
        stripeCustomerId: user.stripeCustomerId,
      })),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});
