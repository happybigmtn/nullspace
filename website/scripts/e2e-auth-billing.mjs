import crypto from "node:crypto";
import process from "node:process";
import { ConvexHttpClient } from "convex/browser";

const AUTH_URL = (process.env.E2E_AUTH_URL ?? process.env.VITE_AUTH_URL ?? "http://127.0.0.1:4000")
  .replace(/\/$/, "");
const ORIGIN =
  process.env.E2E_ORIGIN ??
  (process.env.AUTH_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)[0];
const STRIPE_PRICE_ID = process.env.E2E_STRIPE_PRICE_ID ?? "";
const STRIPE_TIER = process.env.E2E_STRIPE_TIER ?? "member";
const STRIPE_PRODUCT_ID = process.env.E2E_STRIPE_PRODUCT_ID ?? undefined;
const CONVEX_URL = process.env.CONVEX_URL ?? "";
const CONVEX_ADMIN_KEY =
  process.env.CONVEX_ADMIN_KEY ?? process.env.CONVEX_SELF_HOSTED_ADMIN_KEY ?? "";
const SKIP_STRIPE = /^(1|true)$/i.test(process.env.E2E_SKIP_STRIPE ?? "");
const SKIP_ENTITLEMENTS = /^(1|true)$/i.test(process.env.E2E_SKIP_ENTITLEMENTS ?? "");
const EXPECT_ADMIN = /^(1|true)$/i.test(process.env.E2E_EXPECT_ADMIN ?? "");

const ensure = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const readSetCookies = (res) => {
  if (typeof res.headers.getSetCookie === "function") {
    return res.headers.getSetCookie();
  }
  const header = res.headers.get("set-cookie");
  if (!header) return [];
  return header.split(/,(?=[^;]+?=)/);
};

const cookieJar = new Map();

const storeCookies = (res) => {
  const setCookies = readSetCookies(res);
  for (const cookie of setCookies) {
    const [pair] = cookie.split(";");
    if (!pair) continue;
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!name) continue;
    if (!value) {
      cookieJar.delete(name);
      continue;
    }
    cookieJar.set(name, value);
  }
};

const cookieHeader = () => {
  if (cookieJar.size === 0) return "";
  return Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
};

const authFetch = async (path, init = {}) => {
  const headers = new Headers(init.headers ?? {});
  headers.set("Origin", ORIGIN);
  headers.set("Referer", `${ORIGIN}/`);
  const cookie = cookieHeader();
  if (cookie) headers.set("Cookie", cookie);
  const res = await fetch(`${AUTH_URL}${path}`, {
    ...init,
    headers,
  });
  storeCookies(res);
  return res;
};

const AUTH_CHALLENGE_PREFIX = "nullspace-auth:";
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const buildAuthMessage = (challengeHex) => {
  return Buffer.concat([
    Buffer.from(AUTH_CHALLENGE_PREFIX, "utf8"),
    Buffer.from(challengeHex, "hex"),
  ]);
};

const exportPublicKeyHex = (publicKey) => {
  const spki = publicKey.export({ format: "der", type: "spki" });
  ensure(spki.subarray(0, SPKI_PREFIX.length).equals(SPKI_PREFIX), "Unexpected SPKI prefix");
  const raw = spki.subarray(SPKI_PREFIX.length);
  ensure(raw.length === 32, "Unexpected public key length");
  return raw.toString("hex");
};

const signChallenge = (privateKey, challengeHex) => {
  const message = buildAuthMessage(challengeHex);
  const signature = crypto.sign(null, message, privateKey);
  return signature.toString("hex");
};

const assertOk = async (res, label) => {
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  throw new Error(`${label} failed (${res.status}): ${text.slice(0, 200)}`);
};

async function main() {
  ensure(ORIGIN, "Missing E2E_ORIGIN or AUTH_ALLOWED_ORIGINS");

  console.log("[e2e] auth url:", AUTH_URL);
  console.log("[e2e] origin:", ORIGIN);

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyHex = exportPublicKeyHex(publicKey);

  const challengeRes = await authFetch("/auth/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: publicKeyHex }),
  });
  await assertOk(challengeRes, "auth challenge");
  const challenge = await challengeRes.json();
  ensure(challenge?.challengeId, "Missing challengeId");
  ensure(challenge?.challenge, "Missing challenge");

  const csrfRes = await authFetch("/auth/csrf", { method: "GET" });
  await assertOk(csrfRes, "csrf token");
  const csrfBody = await csrfRes.json();
  ensure(csrfBody?.csrfToken, "Missing csrf token");

  const signatureHex = signChallenge(privateKey, challenge.challenge);
  const callbackUrl = `${ORIGIN}/`;
  const body = new URLSearchParams({
    csrfToken: csrfBody.csrfToken,
    publicKey: publicKeyHex,
    signature: signatureHex,
    challengeId: challenge.challengeId,
    callbackUrl,
  });

  const loginRes = await authFetch("/auth/callback/credentials", {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  ensure(loginRes.status === 302 || loginRes.ok, `Login failed (${loginRes.status})`);

  const profileRes = await authFetch("/profile", { method: "GET" });
  await assertOk(profileRes, "profile");
  const profile = await profileRes.json();
  const userId = profile?.session?.user?.id;
  ensure(userId, "Missing user id after login");
  console.log("[e2e] session ok:", userId);

  if (!SKIP_STRIPE) {
    ensure(STRIPE_PRICE_ID, "Missing E2E_STRIPE_PRICE_ID for billing test");
    const checkoutRes = await authFetch("/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        priceId: STRIPE_PRICE_ID,
        tier: STRIPE_TIER,
        successUrl: `${ORIGIN}/billing/success`,
        cancelUrl: `${ORIGIN}/billing/cancel`,
      }),
    });
    await assertOk(checkoutRes, "billing checkout");
    const checkout = await checkoutRes.json();
    ensure(checkout?.url && /^https?:/i.test(checkout.url), "Invalid checkout url");
    console.log("[e2e] checkout ok:", checkout.url);
  } else {
    console.log("[e2e] skipping stripe checkout");
  }

  if (!SKIP_ENTITLEMENTS) {
    ensure(CONVEX_URL, "Missing CONVEX_URL for entitlement test");
    ensure(
      CONVEX_ADMIN_KEY,
      "Missing CONVEX_ADMIN_KEY (or CONVEX_SELF_HOSTED_ADMIN_KEY) for entitlement test",
    );
    let internal;
    try {
      ({ internal } = await import("../convex/_generated/api.js"));
    } catch (error) {
      throw new Error("Missing convex generated API. Run `npx convex codegen` in website/.");
    }
    const convex = new ConvexHttpClient(CONVEX_URL, {
      skipConvexDeploymentUrlCheck: true,
    });
    convex.setAdminAuth(CONVEX_ADMIN_KEY);
    const customerId = `cus_e2e_${Date.now()}`;
    const subscriptionId = `sub_e2e_${Date.now()}`;
    await convex.mutation(internal.users.setStripeCustomerId, {
      userId,
      stripeCustomerId: customerId,
    });
    await convex.mutation(internal.stripeStore.applyStripeEvent, {
      eventId: `e2e-${Date.now()}`,
      eventType: "customer.subscription.created",
      customerId,
      subscriptionId,
      status: "active",
      items: [
        {
          tier: STRIPE_TIER,
          priceId: STRIPE_PRICE_ID || "price_e2e",
          productId: STRIPE_PRODUCT_ID,
        },
      ],
      startsAtMs: Date.now(),
      endsAtMs: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    const profileAfterRes = await authFetch("/profile", { method: "GET" });
    await assertOk(profileAfterRes, "profile after entitlements");
    const profileAfter = await profileAfterRes.json();
    const entitlements = Array.isArray(profileAfter?.entitlements)
      ? profileAfter.entitlements
      : [];
    const hasMember = entitlements.some(
      (entitlement) =>
        entitlement?.tier === STRIPE_TIER &&
        (entitlement?.status === "active" || entitlement?.status === "trialing"),
    );
    ensure(hasMember, "Entitlement not applied");
    console.log("[e2e] entitlement ok:", STRIPE_TIER);
  } else {
    console.log("[e2e] skipping entitlement sync");
  }

  const syncRes = await authFetch("/profile/sync-freeroll", { method: "POST" });
  await assertOk(syncRes, "freeroll sync");
  const sync = await syncRes.json();
  const status = sync?.status;
  const allowed = new Set([
    "submitted",
    "already_set",
    "admin_unconfigured",
    "player_not_found",
  ]);
  ensure(allowed.has(status), `Unexpected freeroll sync status: ${status}`);
  if (EXPECT_ADMIN) {
    ensure(status !== "admin_unconfigured", "Admin expected but not configured");
  }
  console.log("[e2e] freeroll sync ok:", status);

  console.log("[e2e] complete");
}

main().catch((error) => {
  console.error("[e2e] failed:", error.message ?? error);
  process.exit(1);
});
