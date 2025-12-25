"use node";

import Stripe from "stripe";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireServiceToken } from "./serviceAuth";

const stripeSecret = process.env.STRIPE_SECRET_KEY ?? "";
const stripe = new Stripe(stripeSecret, {
  apiVersion: "2023-10-16",
});

const extractSubscriptionDetails = (subscription: Stripe.Subscription) => {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  const subscriptionTier = Object.prototype.hasOwnProperty.call(
    subscription.metadata ?? {},
    "tier",
  )
    ? subscription.metadata?.tier
    : undefined;
  const items = subscription.items.data
    .map(
      (item): { priceId: string; productId?: string; tier?: string } | null => {
        const price = item?.price;
        if (!price) return null;
        const productId =
          typeof price.product === "string" ? price.product : price.product?.id;
        return {
          priceId: price.id,
          productId,
          tier: price.metadata?.tier ?? subscriptionTier,
        };
      },
    )
    .filter(
      (item): item is { priceId: string; productId?: string; tier?: string } =>
        Boolean(item?.priceId),
    );
  const startsAtMs = subscription.current_period_start * 1000;
  const endsAtMs = subscription.current_period_end
    ? subscription.current_period_end * 1000
    : undefined;
  return { customerId, items, startsAtMs, endsAtMs };
};

const resolveSubscriptionLimit = (value?: number, fallback = 100): number => {
  if (value && value > 0) return Math.min(value, 100);
  return fallback;
};

const resolveBatchSize = (value?: number, fallback = 100): number => {
  if (value && value > 0) return Math.min(value, 200);
  return fallback;
};

const parsePositiveNumber = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const reconcileStripeCustomerSubscriptions = async (
  ctx: any,
  customerId: string,
  limit: number,
) => {
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit,
  });

  let processed = 0;
  for (const subscription of subscriptions.data) {
    const { items, startsAtMs, endsAtMs } = extractSubscriptionDetails(subscription);
    const eventId = `reconcile:${subscription.id}:${subscription.status}:${subscription.current_period_end}`;
    await ctx.runMutation(internal.stripeStore.applyStripeEvent, {
      eventId,
      eventType: "reconcile",
      customerId,
      subscriptionId: subscription.id,
      status: subscription.status,
      items,
      startsAtMs,
      endsAtMs,
    });
    processed += 1;
  }

  return processed;
};

const requireStripeSecret = () => {
  if (!stripeSecret) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }
};

export const handleStripeWebhook = internalAction({
  args: {
    signature: v.string(),
    payload: v.bytes(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireStripeSecret();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error("Missing STRIPE_WEBHOOK_SECRET");
    }

    const event = stripe.webhooks.constructEvent(
      Buffer.from(args.payload),
      args.signature,
      webhookSecret,
    );

    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const { customerId, items, startsAtMs, endsAtMs } =
          extractSubscriptionDetails(subscription);

        await ctx.runMutation(internal.stripeStore.applyStripeEvent, {
          eventId: event.id,
          eventType: event.type,
          customerId,
          subscriptionId: subscription.id,
          status: subscription.status,
          items,
          startsAtMs,
          endsAtMs,
        });
        return null;
      }
      default:
        await ctx.runMutation(internal.stripeStore.applyStripeEvent, {
          eventId: event.id,
          eventType: event.type,
        });
        return null;
    }
  },
});

export const createCheckoutSession: ReturnType<typeof action> = action({
  args: {
    serviceToken: v.string(),
    userId: v.id("users"),
    priceId: v.string(),
    successUrl: v.string(),
    cancelUrl: v.string(),
    tier: v.optional(v.string()),
    allowPromotionCodes: v.optional(v.boolean()),
  },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, args): Promise<{ url: string }> => {
    requireServiceToken(args.serviceToken);
    requireStripeSecret();
    const user = await ctx.runQuery(internal.users.getUserById, {
      userId: args.userId,
    });
    if (!user) {
      throw new Error("User not found");
    }

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: user.name ?? undefined,
        metadata: {
          userId: user._id,
        },
      });
      customerId = customer.id;
      await ctx.runMutation(internal.users.setStripeCustomerId, {
        userId: user._id,
        stripeCustomerId: customerId,
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: args.priceId, quantity: 1 }],
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
      allow_promotion_codes: args.allowPromotionCodes ?? false,
      subscription_data: args.tier
        ? {
            metadata: {
              tier: args.tier,
            },
          }
        : undefined,
    });

    if (!session.url) {
      throw new Error("Stripe checkout session missing URL");
    }

    return { url: session.url };
  },
});

export const createBillingPortalSession = action({
  args: {
    serviceToken: v.string(),
    userId: v.id("users"),
    returnUrl: v.string(),
  },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    requireStripeSecret();
    const user = await ctx.runQuery(internal.users.getUserById, {
      userId: args.userId,
    });
    if (!user?.stripeCustomerId) {
      throw new Error("Stripe customer not linked");
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: args.returnUrl,
    });

    if (!session.url) {
      throw new Error("Stripe portal session missing URL");
    }

    return { url: session.url };
  },
});

export const reconcileCustomerSubscriptions = action({
  args: {
    serviceToken: v.string(),
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  returns: v.object({ processed: v.number() }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    requireStripeSecret();
    const user = await ctx.runQuery(internal.users.getUserById, {
      userId: args.userId,
    });
    if (!user?.stripeCustomerId) {
      throw new Error("Stripe customer not linked");
    }

    const limit = resolveSubscriptionLimit(args.limit, 100);
    const processed = await reconcileStripeCustomerSubscriptions(
      ctx,
      user.stripeCustomerId,
      limit,
    );

    return { processed };
  },
});

export const reconcileStripeCustomers: ReturnType<typeof internalAction> = internalAction({
  args: {
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    processedCustomers: v.number(),
    processedSubscriptions: v.number(),
    nextCursor: v.union(v.string(), v.null()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ processedCustomers: number; processedSubscriptions: number; nextCursor: string | null }> => {
    requireStripeSecret();
    const batchSize = resolveBatchSize(
      args.batchSize,
      parsePositiveNumber(process.env.STRIPE_RECONCILE_BATCH_SIZE, 100),
    );
    const subscriptionLimit = resolveSubscriptionLimit(
      parsePositiveNumber(process.env.STRIPE_RECONCILE_SUBSCRIPTION_LIMIT, 100),
    );
    const state = await ctx.runQuery(internal.stripeStore.getStripeReconcileState, {
      name: "default",
    });
    const page = await ctx.runQuery(internal.users.listUsersForStripeReconcile, {
      paginationOpts: {
        numItems: batchSize,
        cursor: state?.cursor ?? null,
      },
    });

    let processedCustomers = 0;
    let processedSubscriptions = 0;
    for (const user of page.users) {
      if (!user.stripeCustomerId) continue;
      processedCustomers += 1;
      processedSubscriptions += await reconcileStripeCustomerSubscriptions(
        ctx,
        user.stripeCustomerId,
        subscriptionLimit,
      );
    }

    const nextCursor = page.isDone ? null : page.continueCursor;
    await ctx.runMutation(internal.stripeStore.setStripeReconcileState, {
      name: "default",
      cursor: nextCursor ?? null,
    });

    return { processedCustomers, processedSubscriptions, nextCursor };
  },
});
