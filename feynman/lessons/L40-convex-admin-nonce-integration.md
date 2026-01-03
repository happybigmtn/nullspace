# L40 - Admin nonce store (integration) (from scratch)

Focus file: `website/convex/admin.ts`

Goal: explain how Convex stores and reserves admin nonces so multiple services do not collide. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Why nonces need a shared store
Admin transactions must be strictly ordered. If two processes submit the same nonce, one fails. A shared store hands out nonces in sequence.

### 2) Service token access
Only backend services should reserve admin nonces. That is why every mutation requires a service token.

---

## Limits & management callouts (important)

1) **No TTL on nonce records**
- `admin_nonces` rows are never deleted.
- This is usually fine, but the table can grow with multiple admin keys.

2) **Normalization only clamps to >= 0**
- `normalizeNonce` does not enforce a maximum.
- If a bug sets an extremely large nonce, it will be stored as-is.

---

## Walkthrough with code excerpts

### 1) Normalizing nonces
```rust
const normalizeNonce = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
};
```

Why this matters:
- It prevents NaN or negative values from corrupting the nonce store.

What this code does:
- Converts the input to a non-negative integer.
- Returns 0 when the input is invalid.

---

### 2) Reserving a nonce
```rust
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
- This is the global counter that prevents two admin transactions from colliding.

Syntax notes:
- The function returns the reserved nonce and advances `nextNonce` for the next caller.

What this code does:
- Creates a new nonce record if one does not exist.
- Otherwise returns the current `nextNonce` and increments it.

---

### 3) Resetting the nonce after a failure
```rust
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
- If a transaction fails, the local nonce cache can be wrong. Resetting fixes the sequence.

What this code does:
- Updates the stored nonce to a known value.
- Inserts a new record if one does not exist yet.

---

## Key takeaways
- Convex provides a simple global counter for admin nonces.
- Service token gating protects the nonce store.
- Resetting is essential for recovery after submission errors.

## Next lesson
L41 - Gateway craps handler (live vs normal routing): `feynman/lessons/L41-gateway-craps-handler.md`
