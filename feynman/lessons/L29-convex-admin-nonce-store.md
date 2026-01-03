# L29 - Convex admin nonce store (from scratch)

Focus file: `website/convex/admin.ts`

Goal: explain how the admin nonce is reserved and reset in Convex to avoid collisions across auth requests. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Why a nonce store exists
Admin transactions must use sequential nonces. If multiple requests happen at once, they could reuse a nonce and cause rejections. The Convex store reserves nonces atomically.

### 2) Service token protection
These mutations are admin-only. They require a service token so arbitrary users cannot mutate admin nonce state.

---

## Limits & management callouts (important)

1) **Nonce values are normalized**
- `normalizeNonce` clamps to `>= 0` and floors to an integer.
- This avoids negative or NaN values corrupting nonce state.

---

## Walkthrough with code excerpts

### 1) Reserve a nonce
```ts
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
```

Why this matters:
- Only one request can safely reserve a nonce at a time. This prevents admin tx collisions.

What this code does:
- Looks up the stored nonce for the admin public key.
- If none exists, inserts a new record with `fallbackNonce + 1` and returns the fallback nonce.
- If one exists, returns `nextNonce` and increments it for the next reservation.

---

### 2) Reset a nonce
```ts
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
```

Why this matters:
- If an admin transaction fails or the chain nonce changes, the store must be reset.

What this code does:
- Normalizes the requested nonce and writes it into the store.
- Upserts the record if it doesn’t exist.

---

## Key takeaways
- The Convex nonce store prevents collisions across admin requests.
- Service tokens protect these mutations.

## Next lesson
L30 - Tournament handlers: `feynman/lessons/L30-tournament-handlers.md`
