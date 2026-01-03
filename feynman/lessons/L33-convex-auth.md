# L33 - Convex auth challenge store (from scratch)

Focus file: `website/convex/auth.ts`

Goal: explain how Convex stores auth challenges and enforces one-time use with expiry. For every excerpt, you will see **why it matters** and a **plain description of what the code does**. We only explain syntax when it is genuinely tricky.

---

## Concepts from scratch (expanded)

### 1) What Convex is doing here
Convex is the server-side database and function runtime. You define **mutations** (write operations) and **queries** (read operations), each with validated inputs. These functions are the authoritative store for auth challenges.

### 2) Challenge/response in plain terms
The server creates a random challenge string and stores it. The client signs it. The server then checks the signature and consumes the challenge so it cannot be reused. This prevents replay attacks.

### 3) One-time use + expiration
A challenge is only valid if:
- it matches the public key,
- it has not been used before,
- it is not expired.

All three checks are required to avoid stolen or reused challenges.

---

## Limits & management callouts (important)

1) **TTL is enforced by the caller, not by Convex**
- This file trusts the `expiresAtMs` value it is given.
- If the auth service sets a long TTL, replay risk goes up.
- If it sets a short TTL, login may fail for slow users.

2) **No cleanup job here**
- Used and expired challenges are not deleted in this file.
- You should consider TTL cleanup or a scheduled purge to keep the table small.

3) **Challenge ID uniqueness relies on UUID quality**
- There is no explicit dedupe on insert; the code assumes UUID collision is practically impossible.
- This is usually fine, but it is still a trust assumption.

---

## Walkthrough with code excerpts

### 1) Creating a challenge record
```rust
export const createAuthChallenge = mutation({
  args: {
    serviceToken: v.string(),
    challengeId: v.string(),
    publicKey: v.string(),
    challenge: v.string(),
    expiresAtMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    await ctx.db.insert("auth_challenges", {
      challengeId: args.challengeId,
      publicKey: args.publicKey,
      challenge: args.challenge,
      expiresAtMs: args.expiresAtMs,
    });
    return null;
  },
});
```

Why this matters:
- This is the single source of truth for whether a challenge exists and when it expires.

Syntax notes:
- `mutation({ args, returns, handler })` defines a Convex write endpoint.
- `v.string()` and `v.number()` are runtime validators for incoming fields.
- `ctx.db.insert("table", {...})` writes a document to the named table.

What this code does:
- Requires a service token so only backend services can create challenges.
- Inserts one challenge row into the `auth_challenges` table.
- Stores the challenge alongside the public key and expiry time.

---

### 2) Looking up a challenge by ID
```rust
const record = await ctx.db
  .query("auth_challenges")
  .withIndex("by_challenge_id", (q) => q.eq("challengeId", args.challengeId))
  .unique();

if (!record) return null;
```

Why this matters:
- If the challenge cannot be found, the login attempt must stop immediately.

Syntax notes:
- `.withIndex("by_challenge_id", ...)` uses a pre-built index for fast lookup.
- `.unique()` means "there should be at most one matching record" and returns one or null.

What this code does:
- Queries the `auth_challenges` table by `challengeId`.
- Returns `null` if no matching record exists.

---

### 3) Enforcing one-time use + expiry
```rust
if (record.publicKey !== args.publicKey) return null;
if (record.usedAtMs) return null;
if (record.expiresAtMs <= Date.now()) return null;
```

Why this matters:
- These checks block replay attacks and prevent using someone else’s challenge.

What this code does:
- Ensures the challenge belongs to the same public key that requested it.
- Rejects challenges that were already used.
- Rejects challenges that are past their expiration time.

---

### 4) Marking the challenge as consumed
```rust
await ctx.db.patch(record._id, { usedAtMs: Date.now() });
return { challenge: record.challenge, expiresAtMs: record.expiresAtMs };
```

Why this matters:
- Marking the challenge as used closes the replay window immediately.

Syntax notes:
- `patch` updates only the fields provided, not the whole document.

What this code does:
- Writes `usedAtMs` to the record so future attempts are rejected.
- Returns the original challenge data to the caller.

---

## Key takeaways
- Convex stores auth challenges and enforces one-time usage.
- Expiry is enforced by the auth service through `expiresAtMs`.
- Challenges are not deleted here, so cleanup is an operational concern.

## Next lesson
L34 - Convex user linking: `feynman/lessons/L34-convex-users.md`
