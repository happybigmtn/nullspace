# L37 - Stripe event store + entitlements (from scratch)

Focus file: `website/convex/stripeStore.ts`

Goal: explain how Stripe events are recorded idempotently and translated into entitlement rows. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Idempotency
Stripe may deliver the same webhook more than once. We store `eventId` and ignore duplicates so each Stripe event only affects entitlements once.

### 2) Entitlements
An entitlement is a derived record that says "this user currently has tier X". Stripe subscriptions map into entitlements, which later drive features and freeroll limits.

### 3) Reconcile state
Reconcile jobs need to remember where they left off. This file stores a cursor in a `stripe_reconcile_state` table so reconciliation can resume safely.

---

## Limits & management callouts (important)

1) **Stripe events are stored forever**
- There is no TTL or cleanup in this file.
- Over time, `stripe_events` can grow large.

2) **Entitlements are updated per item, not per subscription only**
- Each subscription item can create or update an entitlement.
- This is good for multi-product subscriptions but increases row count.

3) **Cancellation logic depends on `items` being present**
- If `items` are missing from an event, entitlements may not be marked canceled.
- Reconcile should include items to fix missing updates.

---

## Walkthrough with code excerpts

### 1) Reconcile state helpers
```rust
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
```

Why this matters:
- Reconciliation needs a stable cursor so it can resume safely after each batch.

Syntax notes:
- `v.union(v.string(), v.null())` means the cursor can be missing.

What this code does:
- Defines the schema for reconcile state.
- Fetches the state row by name, or returns null if it does not exist.

---

### 2) Upserting reconcile state
```rust
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
```

Why this matters:
- This lets reconciliation advance one batch at a time without losing progress.

What this code does:
- Updates the existing reconcile row if present.
- Inserts a new row if it does not exist yet.

---

### 3) Idempotent event storage
```rust
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
```

Why this matters:
- Stripe can resend events. Without this check, entitlements could be duplicated.

What this code does:
- Checks whether the event ID was already processed.
- Stores the event as processed before doing any entitlement work.

---

### 4) Finding the user and building items
```rust
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
```

Why this matters:
- Entitlements are user-specific. If there is no user, we cannot apply them.

What this code does:
- Exits early if required IDs are missing.
- Looks up the user by Stripe customer ID.
- Builds a default single-item list if no detailed `items` were provided.

---

### 5) Upserting entitlements per item
```rust
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
```

Why this matters:
- This is where Stripe billing data turns into in-app permissions.

Syntax notes:
- The code chooses between two indexes depending on whether `priceId` exists.
- The spread `...patch` copies fields into the insert payload.

What this code does:
- Finds or creates an entitlement row for each subscription item.
- Updates status, tier, and timestamps from Stripe.
- Ensures entitlements are attached to the correct user.

---

### 6) Canceling entitlements when items disappear
```rust
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
```

Why this matters:
- Without this, canceled subscriptions could keep granting access.

Syntax notes:
- `collect()` loads all matching entitlements so they can be compared.
- `Set` is used for fast membership checks.

What this code does:
- Builds a set of active price IDs from the event.
- Marks any entitlements not in that set as canceled.

---

## Key takeaways
- Stripe events are stored idempotently before entitlements are updated.
- Entitlements are derived per subscription item and kept in sync on updates.
- Reconcile state enables safe, resumable backfills.

## Next lesson
L38 - Entitlements query: `feynman/lessons/L38-convex-entitlements.md`
