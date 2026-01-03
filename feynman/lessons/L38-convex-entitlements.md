# L38 - Entitlements query (from scratch)

Focus file: `website/convex/entitlements.ts`

Goal: explain how entitlements are queried securely for a user. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) What an entitlement is
An entitlement is a server-side record that says "this user has tier X". These are created from Stripe subscriptions and used to enable features and set freeroll limits.

### 2) Service token gating
Entitlements are sensitive. Only trusted services (like the auth service) should be able to read them. That is why a service token is required.

### 3) Indexes and ordering
The query uses an index on `userId` and returns records in descending order. This tends to surface the most recent entitlement first.

---

## Limits & management callouts (important)

1) **No pagination here**
- The query returns all entitlements for a user.
- If entitlements grow large, you may need pagination.

2) **Service token is the only access control**
- If the token is leaked, entitlements become readable.
- Rotate and protect service tokens carefully.

---

## Walkthrough with code excerpts

### 1) Entitlement schema
```rust
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
```

Why this matters:
- This schema defines the entitlement contract used by the rest of the system.

What this code does:
- Lists all fields an entitlement may contain.
- Marks Stripe-related fields as optional.

---

### 2) Query by user ID
```rust
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
```

Why this matters:
- Entitlements are the input to freeroll limit sync and feature gating.

Syntax notes:
- `.order("desc")` returns results in descending order (newest first).
- `.collect()` returns the full list in memory.

What this code does:
- Requires a service token before any data access.
- Queries entitlements by user ID using an index.
- Returns all entitlements for that user.

---

## Key takeaways
- Entitlements are protected by a service token.
- The query returns all entitlements without pagination.
- These records power downstream authorization decisions.

## Next lesson
L39 - Auth admin sync (wasm + /submit): `feynman/lessons/L39-auth-casino-admin.md`
