import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireServiceToken } from "./serviceAuth";

const entitlementDoc = v.object({
  _id: v.id("entitlements"),
  _creationTime: v.number(),
  userId: v.id("users"),
  tier: v.string(),
  status: v.string(),
  source: v.string(),
  startsAtMs: v.number(),
  endsAtMs: v.optional(v.number()),
  stripeSubscriptionId: v.optional(v.string()),
  stripePriceId: v.optional(v.string()),
  stripeProductId: v.optional(v.string()),
});

export const getEntitlementsByUser = query({
  args: {
    serviceToken: v.string(),
    userId: v.id("users"),
  },
  returns: v.array(entitlementDoc),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    return await ctx.db
      .query("entitlements")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();
  },
});
