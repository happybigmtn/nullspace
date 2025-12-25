import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const reconcileStateDoc = v.object({
  _id: v.id("stripe_reconcile_state"),
  _creationTime: v.number(),
  name: v.string(),
  cursor: v.union(v.string(), v.null()),
  updatedAtMs: v.number(),
});

export const getStripeReconcileState = internalQuery({
  args: { name: v.string() },
  returns: v.union(v.null(), reconcileStateDoc),
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("stripe_reconcile_state")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .unique();
    return state ?? null;
  },
});

export const setStripeReconcileState = internalMutation({
  args: {
    name: v.string(),
    cursor: v.union(v.string(), v.null()),
    updatedAtMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("stripe_reconcile_state")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .unique();
    const updatedAtMs = args.updatedAtMs ?? Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        cursor: args.cursor,
        updatedAtMs,
      });
      return null;
    }

    await ctx.db.insert("stripe_reconcile_state", {
      name: args.name,
      cursor: args.cursor,
      updatedAtMs,
    });
    return null;
  },
});

export const applyStripeEvent = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.string(),
    customerId: v.optional(v.string()),
    subscriptionId: v.optional(v.string()),
    status: v.optional(v.string()),
    tier: v.optional(v.string()),
    priceId: v.optional(v.string()),
    productId: v.optional(v.string()),
    items: v.optional(
      v.array(
        v.object({
          tier: v.optional(v.string()),
          priceId: v.optional(v.string()),
          productId: v.optional(v.string()),
        }),
      ),
    ),
    startsAtMs: v.optional(v.number()),
    endsAtMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const alreadyProcessed = await ctx.db
      .query("stripe_events")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (alreadyProcessed) {
      return null;
    }

    await ctx.db.insert("stripe_events", {
      eventId: args.eventId,
      eventType: args.eventType,
      processedAtMs: Date.now(),
    });

    if (!args.customerId || !args.subscriptionId) {
      return null;
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_stripe_customer_id", (q) =>
        q.eq("stripeCustomerId", args.customerId),
      )
      .unique();
    if (!user) {
      return null;
    }

    const items =
      args.items !== undefined
        ? args.items
        : [
            {
              tier: args.tier,
              priceId: args.priceId,
              productId: args.productId,
            },
          ];

    for (const item of items) {
      const existing = item.priceId
        ? await ctx.db
            .query("entitlements")
            .withIndex("by_stripe_subscription_id_and_price_id", (q) =>
              q
                .eq("stripeSubscriptionId", args.subscriptionId)
                .eq("stripePriceId", item.priceId),
            )
            .unique()
        : await ctx.db
            .query("entitlements")
            .withIndex("by_stripe_subscription_id", (q) =>
              q.eq("stripeSubscriptionId", args.subscriptionId),
            )
            .unique();

      const patch: {
        tier: string;
        status: string;
        source: string;
        startsAtMs: number;
        stripeSubscriptionId: string;
        stripePriceId?: string;
        stripeProductId?: string;
        endsAtMs?: number;
      } = {
        tier: item.tier ?? "default",
        status: args.status ?? "unknown",
        source: "stripe",
        startsAtMs: args.startsAtMs ?? Date.now(),
        stripeSubscriptionId: args.subscriptionId,
      };

      if (item.priceId) patch.stripePriceId = item.priceId;
      if (item.productId) patch.stripeProductId = item.productId;
      if (args.endsAtMs !== undefined) patch.endsAtMs = args.endsAtMs;

      if (existing) {
        await ctx.db.patch(existing._id, patch);
        continue;
      }

      await ctx.db.insert("entitlements", {
        userId: user._id,
        ...patch,
      });
    }

    if (
      args.items &&
      (args.eventType === "customer.subscription.updated" ||
        args.eventType === "customer.subscription.deleted" ||
        args.eventType === "reconcile")
    ) {
      const activePriceIds =
        args.eventType === "customer.subscription.deleted"
          ? new Set<string>()
          : new Set(
              args.items
                .map((item) => item.priceId)
                .filter((priceId): priceId is string => Boolean(priceId)),
            );
      const existingEntitlements = await ctx.db
        .query("entitlements")
        .withIndex("by_stripe_subscription_id", (q) =>
          q.eq("stripeSubscriptionId", args.subscriptionId),
        )
        .collect();
      const now = Date.now();
      for (const entitlement of existingEntitlements) {
        const priceId = entitlement.stripePriceId;
        if (!priceId || !activePriceIds.has(priceId)) {
          await ctx.db.patch(entitlement._id, {
            status: "canceled",
            endsAtMs: now,
          });
        }
      }
    }
    return null;
  },
});
