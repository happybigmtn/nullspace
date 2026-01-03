# L34 - Convex user linking (from scratch)

Focus file: `website/convex/users.ts`

Goal: explain how user records are created, linked to auth identities, and connected to public keys and Stripe customers. For every excerpt, you will see **why it matters** and a **plain description of what the code does**. We only explain syntax when it is genuinely tricky.

---

## Concepts from scratch (expanded)

### 1) What a user record represents
A user record is the bridge between external identity providers (auth) and internal game state. It stores:
- the auth provider + subject (identity),
- optional profile data (name/email),
- optional on-chain public key,
- optional Stripe customer ID.

### 2) Internal vs public Convex functions
- **internalQuery / internalMutation**: only callable from server-side Convex code.
- **query / mutation**: callable by clients or external services, usually gated by a service token.

### 3) Indexes are for fast lookups
This file depends on indexes like `by_auth_provider_and_subject` and `by_public_key`. Without them, lookups would be slow and expensive.

### 4) Upsert logic
An upsert either updates an existing user or inserts a new one. This avoids duplicates when the same user logs in again.

---

## Limits & management callouts (important)

1) **Public key uniqueness is enforced**
- `linkPublicKey` throws if a public key is already linked to another user.
- This is good for safety but makes key migration hard without an admin tool.

2) **Fields can only be updated, not cleared**
- `upsertUser` only patches fields that are provided.
- There is no way to erase a field (like `email`) through this API.

3) **Stripe reconcile pagination depends on caller input**
- `listUsersForStripeReconcile` accepts pagination options; the caller controls batch size.
- Very large batches could increase latency or cost.

---

## Walkthrough with code excerpts

### 1) User document schema
```rust
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
```

Why this matters:
- This is the contract for what a user record looks like everywhere else in the system.

Syntax notes:
- `v.object({...})` declares a schema used for validation and typed returns.
- `v.optional(...)` marks a field as nullable/absent.

What this code does:
- Defines the required and optional fields for user documents.
- Ensures any returned user matches this schema.

---

### 2) Looking up a user by auth identity
```rust
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
```

Why this matters:
- This is how the system links an auth session to a specific user record.

Syntax notes:
- `internalQuery` means this can only be called from server-side Convex code.
- `v.union(v.null(), userDoc)` means the return can be either a user or null.

What this code does:
- Queries by the compound index of auth provider and subject.
- Returns the matching user or null if none exists.

---

### 3) Service-token gated lookups
```rust
export const getUserByPublicKey = query({
  args: {
    serviceToken: v.string(),
    publicKey: v.string(),
  },
  returns: v.union(v.null(), userDoc),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const user = await ctx.db
      .query("users")
      .withIndex("by_public_key", (q) => q.eq("publicKey", args.publicKey))
      .unique();
    return user ?? null;
  },
});
```

Why this matters:
- External services (like the auth service) need to query users securely.

What this code does:
- Requires a service token before any lookup.
- Fetches a user by their linked public key, or returns null.

---

### 4) Upsert user by auth identity
```rust
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
```

Why this matters:
- Upserts prevent duplicate users while still allowing profile updates.

Syntax notes:
- `v.id("users")` indicates the return value is a users-table document ID.
- The `patch` object is built conditionally so undefined values do not overwrite existing fields.

What this code does:
- Looks for an existing user by auth identity.
- If found, patches only the provided fields.
- If not found, inserts a new user record.

---

### 5) Linking a public key
```rust
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
```

Why this matters:
- Prevents two user accounts from claiming the same on-chain identity.

What this code does:
- Checks whether the public key is already linked to a different user.
- If safe, patches the user record with the new public key.

---

### 6) Stripe reconcile pagination
```rust
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
```

Why this matters:
- Stripe reconciliation needs to scan users in manageable batches.

Syntax notes:
- `paginate` returns a page of results plus a cursor for the next page.
- `paginationOptsValidator` ensures the pagination parameters are valid.

What this code does:
- Reads a page of users in ascending order.
- Returns only the minimal fields needed for Stripe reconcile.

---

## Key takeaways
- Users are keyed by auth provider + subject and can optionally link to a public key.
- Service-token gated queries protect sensitive lookups.
- Pagination is required for scalable Stripe reconciliation.

## Next lesson
L35 - Stripe webhook ingress: `feynman/lessons/L35-convex-http-stripe.md`
