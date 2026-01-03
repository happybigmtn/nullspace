# L36 - Stripe actions + sessions (from scratch)

Focus file: `website/convex/stripe.ts`

Goal: explain how Stripe events are verified, how checkout and billing portal sessions are created, and how reconciliation is performed. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Why this file uses Node
Stripe’s official SDK and webhook verification require Node APIs like `Buffer`. Convex actions can run in a Node environment, which is why this file starts with `"use node"`.

### 2) Stripe objects you need to know
- **Customer**: a Stripe account representing a user.
- **Subscription**: the billing relationship for a recurring plan.
- **Checkout session**: a hosted Stripe page to start a subscription.
- **Billing portal session**: a hosted Stripe page to manage subscriptions.

### 3) Entitlements
Subscriptions are converted into entitlements (tiers). Those entitlements are later used to adjust on-chain freeroll limits.

### 4) Reconciliation
Webhooks are reliable, but systems can still drift. Reconciliation re-reads Stripe’s current state and replays entitlements so Convex matches Stripe.

---

## Limits & management callouts (important)

1) **Subscription list limit is capped at 100**
- `resolveSubscriptionLimit` clamps to 100.
- This is safe for rate limits but may miss very large customer histories.

2) **Batch size capped at 200**
- `resolveBatchSize` caps to 200 customers per reconcile batch.
- Good for safety, but full backfills can take many runs.

3) **Stripe API version fixed**
- `apiVersion: "2023-10-16"` locks behavior.
- When Stripe deprecates fields, you must update and test.

---

## Walkthrough with code excerpts

### 1) Stripe client setup and subscription parsing
```rust
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
```

Why this matters:
- This function normalizes Stripe data into the format used by entitlements.

Syntax notes:
- `subscription.customer` can be a string or a full object; this handles both.
- The `filter` uses a type predicate to keep TypeScript happy.

What this code does:
- Creates the Stripe client using the secret key.
- Extracts customer ID, line items, and timestamps from a subscription.
- Pulls a tier from metadata if present.

---

### 2) Webhook verification + event forwarding
```rust
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
```

Why this matters:
- Stripe verification is the security boundary that prevents forged events.

Syntax notes:
- `internalAction` means only internal Convex code can call this.
- `Buffer.from(args.payload)` converts bytes into the format Stripe expects.

What this code does:
- Requires Stripe secrets to be configured.
- Verifies the webhook signature.
- For subscription events, extracts details and writes them to `stripeStore`.
- For other events, records the event type only.

---

### 3) Creating a checkout session
```rust
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
```

Why this matters:
- This is the primary entrypoint for users to start paid subscriptions.

Syntax notes:
- `ReturnType<typeof action>` keeps the exported type aligned with Convex.
- `args.allowPromotionCodes ?? false` uses nullish coalescing to set a default.

What this code does:
- Requires a service token and Stripe secret.
- Ensures the user has a Stripe customer ID (creates one if missing).
- Creates a subscription checkout session and returns the hosted URL.

---

### 4) Creating a billing portal session
```rust
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
```

Why this matters:
- Users need a secure way to manage or cancel subscriptions without handling payment data directly.

What this code does:
- Requires a linked Stripe customer.
- Creates a billing portal session in Stripe.
- Returns a hosted URL for the user to manage billing.

---

### 5) Reconciliation across all Stripe customers
```rust
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
```

Why this matters:
- Reconciliation keeps entitlements correct if webhook events are missed or out of order.

Syntax notes:
- `internalAction` means this is callable only from internal Convex code.
- The return type describes a resumable cursor-based scan.

What this code does:
- Reads a stored cursor to continue reconciliation in batches.
- For each user with a Stripe customer ID, lists subscriptions and applies events.
- Stores the next cursor so the next run can resume.

---

## Key takeaways
- Stripe webhooks are verified and translated into entitlement events.
- Checkout and billing portal sessions are created through safe service-token actions.
- Reconciliation replays Stripe state in batches to repair drift.

## Next lesson
L37 - Stripe event store + entitlements: `feynman/lessons/L37-convex-stripe-store.md`
