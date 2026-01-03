# S06 - Payments + webhook idempotency (from scratch)

Focus: (concepts)

Goal: explain how payment webhooks work and why idempotency is required.

---

## Concepts from scratch (expanded)

### 1) Payment providers send webhooks
Stripe sends events like subscription created/updated/deleted. These are inbound HTTP calls to your server.

### 2) Idempotency
Webhooks can be retried. The server must handle duplicates safely, usually by storing the event ID.

### 3) Entitlements
Billing status is converted into internal entitlements (tiers). These entitlements drive app features and limits.

---

## Limits & management callouts (important)

1) **Webhooks must be verified**
- Always validate the signature to prevent forged events.

2) **Idempotency is mandatory**
- Without it, duplicates can create duplicate entitlements or double-grant access.

---

## Walkthrough with simple examples

### 1) Webhook verification
```rust
if !verify_signature(raw_payload, stripe_signature, webhook_secret):
  reject
```

Why this matters:
- Prevents attackers from forging billing events.

What this means:
- Only Stripe-signed requests are processed.

---

### 2) Idempotent event handling
```rust
event_id = payload.id
if event_id already processed:
  return ok
store event_id as processed
apply entitlements
```

Why this matters:
- Stripe may resend the same event multiple times.

What this means:
- The system applies each event at most once.

---

## Key takeaways
- Webhooks are how payment state enters your system.
- Signature verification is non-negotiable.
- Idempotency prevents duplicate billing effects.

## Next primer
S07 - Observability + production readiness: `feynman/lessons/S07-ops-primer.md`
