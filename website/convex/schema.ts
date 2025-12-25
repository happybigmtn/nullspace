import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    authProvider: v.string(),
    authSubject: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    publicKey: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
  })
    .index("by_auth_provider_and_subject", ["authProvider", "authSubject"])
    .index("by_stripe_customer_id", ["stripeCustomerId"])
    .index("by_public_key", ["publicKey"]),
  entitlements: defineTable({
    userId: v.id("users"),
    tier: v.string(),
    status: v.string(),
    source: v.string(),
    startsAtMs: v.number(),
    endsAtMs: v.optional(v.number()),
    stripeSubscriptionId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    stripeProductId: v.optional(v.string()),
  })
    .index("by_user_id", ["userId"])
    .index("by_stripe_subscription_id", ["stripeSubscriptionId"])
    .index("by_stripe_subscription_id_and_price_id", [
      "stripeSubscriptionId",
      "stripePriceId",
    ]),
  stripe_events: defineTable({
    eventId: v.string(),
    eventType: v.string(),
    processedAtMs: v.number(),
  })
    .index("by_event_id", ["eventId"])
    .index("by_processed_at", ["processedAtMs"]),
  stripe_reconcile_state: defineTable({
    name: v.string(),
    cursor: v.union(v.string(), v.null()),
    updatedAtMs: v.number(),
  }).index("by_name", ["name"]),
  auth_challenges: defineTable({
    challengeId: v.string(),
    publicKey: v.string(),
    challenge: v.string(),
    expiresAtMs: v.number(),
    usedAtMs: v.optional(v.number()),
  })
    .index("by_challenge_id", ["challengeId"])
    .index("by_public_key", ["publicKey"])
    .index("by_expires_at", ["expiresAtMs"]),
  admin_nonces: defineTable({
    adminPublicKey: v.string(),
    nextNonce: v.number(),
    updatedAtMs: v.number(),
  }).index("by_admin_public_key", ["adminPublicKey"]),
});
