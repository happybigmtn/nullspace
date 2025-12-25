import "dotenv/config";
import crypto from "crypto";
import express from "express";
import cors from "cors";
import { ExpressAuth, getSession } from "@auth/express";
import Credentials from "@auth/express/providers/credentials";
import { ConvexHttpClient } from "convex/browser";
import { createRequire } from "module";
import { syncFreerollLimit } from "./casinoAdmin.js";
// Avoid pulling Convex source files into the auth build output.
const require = createRequire(import.meta.url);
const { api } = require("../../../website/convex/_generated/api.js");
const required = (name) => {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing ${name}`);
    }
    return value;
};
const convex = new ConvexHttpClient(required("CONVEX_URL"), {
    skipConvexDeploymentUrlCheck: true,
});
const serviceToken = required("CONVEX_SERVICE_TOKEN");
const CHALLENGE_TTL_MS = Number(process.env.AUTH_CHALLENGE_TTL_MS ?? "300000");
const challengeTtlMs = Number.isFinite(CHALLENGE_TTL_MS) && CHALLENGE_TTL_MS > 0 ? CHALLENGE_TTL_MS : 300000;
const AUTH_CHALLENGE_PREFIX = "nullspace-auth:";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const normalizeHex = (value) => value.trim().toLowerCase().replace(/^0x/, "");
const isHex = (value, length) => {
    if (!/^[0-9a-f]+$/.test(value))
        return false;
    if (length !== undefined && value.length !== length)
        return false;
    return true;
};
const buildAuthMessage = (challengeHex) => {
    return Buffer.concat([
        Buffer.from(AUTH_CHALLENGE_PREFIX, "utf8"),
        Buffer.from(challengeHex, "hex"),
    ]);
};
const verifySignature = (publicKeyHex, signatureHex, challengeHex) => {
    try {
        const keyBytes = Buffer.from(publicKeyHex, "hex");
        const sigBytes = Buffer.from(signatureHex, "hex");
        const spki = Buffer.concat([ED25519_SPKI_PREFIX, keyBytes]);
        const key = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
        const message = buildAuthMessage(challengeHex);
        return crypto.verify(null, message, key, sigBytes);
    }
    catch {
        return false;
    }
};
const parseAllowedOrigins = () => {
    return (process.env.AUTH_ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
};
const allowedOrigins = parseAllowedOrigins();
if (allowedOrigins.length === 0) {
    throw new Error("AUTH_ALLOWED_ORIGINS must be set");
}
const getRequestOrigin = (req) => {
    const originHeader = req.headers.origin;
    if (typeof originHeader === "string" && originHeader) {
        return originHeader;
    }
    const referer = req.headers.referer;
    if (typeof referer === "string" && referer) {
        try {
            return new URL(referer).origin;
        }
        catch {
            return null;
        }
    }
    return null;
};
const requireAllowedOrigin = (req, res, next) => {
    const origin = getRequestOrigin(req);
    if (!origin || !allowedOrigins.includes(origin)) {
        res.status(403).json({ error: "origin_not_allowed" });
        return;
    }
    next();
};
const parseStripeTierMap = (raw) => {
    const map = new Map();
    raw
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((entry) => {
        const [tier, priceId] = entry.split(":").map((value) => value.trim());
        if (tier && priceId) {
            map.set(priceId, tier);
        }
    });
    return map;
};
const stripeTierMap = parseStripeTierMap(process.env.STRIPE_PRICE_TIERS ?? "");
if (stripeTierMap.size === 0) {
    throw new Error("STRIPE_PRICE_TIERS must be set");
}
const resolveStripeTier = (priceId, tier) => {
    const expectedTier = stripeTierMap.get(priceId);
    if (!expectedTier) {
        throw new Error("priceId not allowed");
    }
    if (tier && tier !== expectedTier) {
        throw new Error("tier does not match price");
    }
    return expectedTier;
};
const ensureAllowedRedirect = (value) => {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error("invalid redirect URL");
    }
    if (!allowedOrigins.includes(url.origin)) {
        throw new Error("redirect origin not allowed");
    }
    return url.toString();
};
const parsePositiveInt = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return fallback;
    return Math.floor(parsed);
};
const rateBuckets = new Map();
const rateBucketMax = parsePositiveInt(process.env.AUTH_RATE_BUCKET_MAX, 50_000);
const rateBucketCleanupMs = parsePositiveInt(process.env.AUTH_RATE_BUCKET_CLEANUP_INTERVAL_MS, 300_000);
let lastRateBucketCleanup = 0;
const cleanupRateBuckets = (now) => {
    if (rateBuckets.size === 0)
        return;
    if (now - lastRateBucketCleanup < rateBucketCleanupMs && rateBuckets.size <= rateBucketMax) {
        return;
    }
    lastRateBucketCleanup = now;
    for (const [key, bucket] of rateBuckets.entries()) {
        if (now > bucket.resetAt) {
            rateBuckets.delete(key);
        }
    }
    if (rateBuckets.size > rateBucketMax) {
        const toRemove = rateBuckets.size - rateBucketMax;
        let removed = 0;
        for (const key of rateBuckets.keys()) {
            rateBuckets.delete(key);
            removed += 1;
            if (removed >= toRemove)
                break;
        }
    }
};
const rateLimit = (keyPrefix, windowMs, max) => {
    return (req, res, next) => {
        const now = Date.now();
        cleanupRateBuckets(now);
        const key = `${keyPrefix}:${req.ip}`;
        const bucket = rateBuckets.get(key);
        if (!bucket || now > bucket.resetAt) {
            rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
            next();
            return;
        }
        if (bucket.count >= max) {
            const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
            res.setHeader("Retry-After", retryAfterSec.toString());
            res.status(429).json({ error: "rate_limited" });
            return;
        }
        bucket.count += 1;
        next();
    };
};
const challengeRateLimit = rateLimit("challenge", parsePositiveInt(process.env.AUTH_CHALLENGE_RATE_LIMIT_WINDOW_MS, 60_000), parsePositiveInt(process.env.AUTH_CHALLENGE_RATE_LIMIT_MAX, 30));
const profileRateLimit = rateLimit("profile", parsePositiveInt(process.env.AUTH_PROFILE_RATE_LIMIT_WINDOW_MS, 60_000), parsePositiveInt(process.env.AUTH_PROFILE_RATE_LIMIT_MAX, 60));
const billingRateLimit = rateLimit("billing", parsePositiveInt(process.env.AUTH_BILLING_RATE_LIMIT_WINDOW_MS, 60_000), parsePositiveInt(process.env.AUTH_BILLING_RATE_LIMIT_MAX, 20));
const counters = new Map();
const timings = new Map();
const inc = (name, value = 1) => {
    counters.set(name, (counters.get(name) ?? 0) + value);
};
const observe = (name, ms) => {
    const sample = timings.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 };
    sample.count += 1;
    sample.totalMs += ms;
    sample.maxMs = Math.max(sample.maxMs, ms);
    timings.set(name, sample);
};
const logJson = (level, message, data) => {
    const line = JSON.stringify({ level, message, ...data });
    if (level === "error") {
        console.error(line);
    }
    else if (level === "warn") {
        console.warn(line);
    }
    else {
        console.info(line);
    }
};
const credentialsProvider = Credentials({
    credentials: {
        publicKey: { label: "Public key", type: "text" },
        signature: { label: "Signature", type: "text" },
        challengeId: { label: "Challenge ID", type: "text" },
    },
    authorize: async (credentials) => {
        const publicKey = normalizeHex(String(credentials?.publicKey ?? ""));
        const signature = normalizeHex(String(credentials?.signature ?? ""));
        const challengeId = String(credentials?.challengeId ?? "");
        if (!isHex(publicKey, 64))
            return null;
        if (!isHex(signature, 128))
            return null;
        if (!challengeId)
            return null;
        const challenge = await convex.mutation(api.auth.consumeAuthChallenge, {
            serviceToken,
            challengeId,
            publicKey,
        });
        if (!challenge)
            return null;
        const ok = verifySignature(publicKey, signature, challenge.challenge);
        if (!ok)
            return null;
        const userId = await convex.mutation(api.users.upsertUser, {
            serviceToken,
            authProvider: "passkey",
            authSubject: publicKey,
            publicKey,
        });
        return { id: userId, authProvider: "passkey", authSubject: publicKey, publicKey };
    },
});
const authConfig = {
    trustHost: true,
    secret: required("AUTH_SECRET"),
    session: {
        strategy: "jwt",
    },
    providers: [credentialsProvider],
    callbacks: {
        async jwt({ token, user, account }) {
            if (account || user) {
                const authProvider = account?.provider ?? user?.authProvider ?? "passkey";
                const authSubject = account?.providerAccountId ??
                    user?.authSubject ??
                    user?.publicKey ??
                    (authProvider === "passkey" ? user?.id : undefined) ??
                    user?.email ??
                    "unknown";
                const existingId = user?.id;
                const publicKey = authProvider === "passkey" ? user?.publicKey ?? authSubject : undefined;
                const convexUserId = existingId
                    ? existingId
                    : await convex.mutation(api.users.upsertUser, {
                        serviceToken,
                        authProvider,
                        authSubject,
                        email: user?.email ?? undefined,
                        name: user?.name ?? undefined,
                        publicKey,
                    });
                token.convexUserId = convexUserId;
                token.authProvider = authProvider;
                token.authSubject = authSubject;
            }
            return token;
        },
        async session({ session, token }) {
            if (token?.convexUserId) {
                session.user = {
                    ...(session.user ?? {}),
                    id: token.convexUserId,
                    authProvider: token.authProvider,
                    authSubject: token.authSubject,
                };
            }
            return session;
        },
    },
};
const app = express();
app.set("trust proxy", true);
app.use((req, res, next) => {
    const incoming = req.headers["x-request-id"];
    const requestId = Array.isArray(incoming)
        ? incoming[0]
        : typeof incoming === "string" && incoming
            ? incoming
            : crypto.randomUUID();
    res.locals.requestId = requestId;
    res.setHeader("x-request-id", requestId);
    const start = Date.now();
    res.on("finish", () => {
        const durationMs = Date.now() - start;
        inc("http.requests");
        inc(`http.method.${req.method.toLowerCase()}`);
        observe("http.request_ms", durationMs);
        logJson("info", "http.request", {
            requestId,
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            durationMs,
        });
    });
    next();
});
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error("Origin not allowed"));
    },
    credentials: true,
    exposedHeaders: ["x-request-id"],
}));
app.use(express.json());
app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
});
app.get("/metrics", (_req, res) => {
    const countersObj = {};
    for (const [name, value] of counters.entries()) {
        countersObj[name] = value;
    }
    const timingsObj = {};
    for (const [name, sample] of timings.entries()) {
        timingsObj[name] = {
            count: sample.count,
            totalMs: sample.totalMs,
            maxMs: sample.maxMs,
            avgMs: sample.count ? Math.round(sample.totalMs / sample.count) : 0,
        };
    }
    res.status(200).json({ counters: countersObj, timings: timingsObj });
});
app.post("/auth/challenge", requireAllowedOrigin, challengeRateLimit, async (req, res) => {
    const publicKey = normalizeHex(String(req.body?.publicKey ?? ""));
    if (!isHex(publicKey, 64)) {
        inc("auth.challenge.invalid");
        res.status(400).json({ error: "invalid publicKey" });
        return;
    }
    const challengeId = crypto.randomUUID();
    const challenge = crypto.randomBytes(32).toString("hex");
    const expiresAtMs = Date.now() + challengeTtlMs;
    await convex.mutation(api.auth.createAuthChallenge, {
        serviceToken,
        challengeId,
        publicKey,
        challenge,
        expiresAtMs,
    });
    inc("auth.challenge.created");
    res.json({ challengeId, challenge, expiresAtMs });
});
app.use("/auth/*", ExpressAuth(authConfig));
const requireSession = async (req, res) => {
    const session = await getSession(req, authConfig);
    const userId = session?.user?.id;
    if (!userId) {
        res.status(401).json({ error: "unauthorized" });
        return null;
    }
    return { session, userId };
};
app.get("/profile", requireAllowedOrigin, profileRateLimit, async (req, res) => {
    const session = await getSession(req, authConfig);
    const userId = session?.user?.id;
    if (!userId) {
        inc("profile.unauthorized");
        res.status(401).json({ session: null, entitlements: [] });
        return;
    }
    const entitlements = await convex.query(api.entitlements.getEntitlementsByUser, {
        serviceToken,
        userId,
    });
    const publicKey = session?.user?.authSubject;
    if (publicKey) {
        inc("freeroll.sync.attempt");
        syncFreerollLimit(publicKey, entitlements)
            .then(() => inc("freeroll.sync.success"))
            .catch((error) => {
            inc("freeroll.sync.failure");
            logJson("warn", "freeroll.sync.failed", {
                requestId: res.locals.requestId,
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }
    inc("profile.success");
    res.json({ session, entitlements });
});
app.post("/profile/link-public-key", requireAllowedOrigin, profileRateLimit, async (req, res) => {
    const session = await requireSession(req, res);
    if (!session)
        return;
    const publicKey = normalizeHex(String(req.body?.publicKey ?? ""));
    const signature = normalizeHex(String(req.body?.signature ?? ""));
    const challengeId = String(req.body?.challengeId ?? "");
    if (!isHex(publicKey, 64)) {
        inc("profile.link_public_key.invalid");
        res.status(400).json({ error: "invalid publicKey" });
        return;
    }
    if (!isHex(signature, 128)) {
        inc("profile.link_public_key.invalid");
        res.status(400).json({ error: "invalid signature" });
        return;
    }
    if (!challengeId) {
        inc("profile.link_public_key.invalid");
        res.status(400).json({ error: "challengeId is required" });
        return;
    }
    const challenge = await convex.mutation(api.auth.consumeAuthChallenge, {
        serviceToken,
        challengeId,
        publicKey,
    });
    if (!challenge) {
        inc("profile.link_public_key.invalid");
        res.status(400).json({ error: "invalid challenge" });
        return;
    }
    if (!verifySignature(publicKey, signature, challenge.challenge)) {
        inc("profile.link_public_key.invalid");
        res.status(400).json({ error: "invalid signature" });
        return;
    }
    await convex.mutation(api.users.linkPublicKey, {
        serviceToken,
        userId: session.userId,
        publicKey,
    });
    inc("profile.link_public_key.success");
    res.json({ ok: true });
});
app.post("/profile/sync-freeroll", requireAllowedOrigin, profileRateLimit, async (req, res) => {
    const session = await requireSession(req, res);
    if (!session)
        return;
    const entitlements = await convex.query(api.entitlements.getEntitlementsByUser, {
        serviceToken,
        userId: session.userId,
    });
    const publicKey = session.session?.user?.authSubject;
    if (!publicKey) {
        inc("freeroll.sync.failure");
        res.status(400).json({ error: "public key not found in session" });
        return;
    }
    let result;
    try {
        inc("freeroll.sync.attempt");
        const start = Date.now();
        result = await syncFreerollLimit(publicKey, entitlements);
        observe("freeroll.sync_ms", Date.now() - start);
        inc("freeroll.sync.success");
    }
    catch (error) {
        inc("freeroll.sync.failure");
        logJson("warn", "freeroll.sync.failed", {
            requestId: res.locals.requestId,
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(502).json({ error: "freeroll sync failed" });
        return;
    }
    res.json({ ok: true, ...result });
});
app.post("/billing/checkout", requireAllowedOrigin, billingRateLimit, async (req, res) => {
    const session = await requireSession(req, res);
    if (!session)
        return;
    const { priceId, successUrl, cancelUrl, tier, allowPromotionCodes } = req.body ?? {};
    if (!priceId || !successUrl || !cancelUrl) {
        inc("billing.checkout.invalid");
        res.status(400).json({ error: "priceId, successUrl, cancelUrl required" });
        return;
    }
    let resolvedTier;
    let safeSuccessUrl;
    let safeCancelUrl;
    try {
        resolvedTier = resolveStripeTier(String(priceId), tier ? String(tier) : undefined);
        safeSuccessUrl = ensureAllowedRedirect(String(successUrl));
        safeCancelUrl = ensureAllowedRedirect(String(cancelUrl));
    }
    catch (error) {
        inc("billing.checkout.invalid");
        res.status(400).json({ error: error instanceof Error ? error.message : "invalid request" });
        return;
    }
    try {
        const start = Date.now();
        const result = await convex.action(api.stripe.createCheckoutSession, {
            serviceToken,
            userId: session.userId,
            priceId: String(priceId),
            successUrl: safeSuccessUrl,
            cancelUrl: safeCancelUrl,
            tier: resolvedTier,
            allowPromotionCodes,
        });
        observe("billing.checkout_ms", Date.now() - start);
        inc("billing.checkout.success");
        res.json(result);
    }
    catch (error) {
        inc("billing.checkout.failure");
        logJson("warn", "billing.checkout.failed", {
            requestId: res.locals.requestId,
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(502).json({ error: "checkout failed" });
    }
});
app.post("/billing/portal", requireAllowedOrigin, billingRateLimit, async (req, res) => {
    const session = await requireSession(req, res);
    if (!session)
        return;
    const { returnUrl } = req.body ?? {};
    if (!returnUrl) {
        inc("billing.portal.invalid");
        res.status(400).json({ error: "returnUrl required" });
        return;
    }
    let safeReturnUrl;
    try {
        safeReturnUrl = ensureAllowedRedirect(String(returnUrl));
    }
    catch (error) {
        inc("billing.portal.invalid");
        res.status(400).json({ error: error instanceof Error ? error.message : "invalid returnUrl" });
        return;
    }
    try {
        const start = Date.now();
        const result = await convex.action(api.stripe.createBillingPortalSession, {
            serviceToken,
            userId: session.userId,
            returnUrl: safeReturnUrl,
        });
        observe("billing.portal_ms", Date.now() - start);
        inc("billing.portal.success");
        res.json(result);
    }
    catch (error) {
        inc("billing.portal.failure");
        logJson("warn", "billing.portal.failed", {
            requestId: res.locals.requestId,
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(502).json({ error: "portal failed" });
    }
});
app.post("/billing/reconcile", requireAllowedOrigin, billingRateLimit, async (req, res) => {
    const session = await requireSession(req, res);
    if (!session)
        return;
    const limitRaw = req.body?.limit;
    const limit = Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : undefined;
    try {
        const start = Date.now();
        const result = await convex.action(api.stripe.reconcileCustomerSubscriptions, {
            serviceToken,
            userId: session.userId,
            limit,
        });
        observe("billing.reconcile_ms", Date.now() - start);
        inc("billing.reconcile.success");
        res.json(result);
    }
    catch (error) {
        inc("billing.reconcile.failure");
        logJson("warn", "billing.reconcile.failed", {
            requestId: res.locals.requestId,
            error: error instanceof Error ? error.message : String(error),
        });
        res.status(502).json({ error: "reconcile failed" });
    }
});
const port = Number(process.env.PORT ?? "4000");
app.listen(port, () => {
    console.log(`Auth service listening on :${port}`);
});
