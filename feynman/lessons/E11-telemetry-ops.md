# E11 - Telemetry, logs, and ops events (from scratch)

Focus files: `gateway/src/telemetry.ts`, `services/ops/dist/server.js`

Goal: explain how telemetry is enabled and how the ops service collects analytics and admin data. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Tracing and telemetry
OpenTelemetry lets you export traces to a collector. It is optional and only enabled if an endpoint is configured.

### 2) Ops service
The ops service is a lightweight analytics and admin API. It stores JSON and NDJSON locally and can be locked behind tokens and origin checks.

### 3) CORS and admin tokens
Ops endpoints should be limited to known origins and optionally protected with an admin token.

---

## Limits & management callouts (important)

1) **Telemetry is disabled unless OTLP endpoint is set**
- This is safe by default but can hide issues if you forget to configure it.

2) **Ops service stores data on disk**
- If `OPS_DATA_DIR` is not persistent, analytics will be lost on restart.

3) **CORS allowlist default is permissive**
- If `OPS_ALLOWED_ORIGINS` is empty, all origins are allowed.
- This is risky in production; set an allowlist.

---

## Walkthrough with code excerpts

### 1) Gateway telemetry bootstrap
```rust
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();

if (endpoint) {
  if (!process.env.OTEL_SERVICE_NAME) {
    process.env.OTEL_SERVICE_NAME = 'nullspace-gateway';
  }

  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({ url: endpoint }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();

  const shutdown = (): void => {
    sdk.shutdown().catch((err) => {
      console.warn('[telemetry] failed to shut down OTLP exporter', err);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
```

Why this matters:
- This controls whether traces are exported for the gateway.

What this code does:
- Starts the OpenTelemetry SDK only when the endpoint is set.
- Registers shutdown handlers for clean exits.

---

### 2) Ops service CORS allowlist
```rust
const OPS_ALLOW_NO_ORIGIN = ["1", "true", "yes"].includes(String(process.env.OPS_ALLOW_NO_ORIGIN ?? "").toLowerCase());
const allowedOrigins = (process.env.OPS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
app.use(cors({
    origin: (origin, callback) => {
        if (!origin && OPS_ALLOW_NO_ORIGIN) {
            callback(null, true);
            return;
        }
        if (allowedOrigins.length === 0) {
            callback(null, true);
            return;
        }
        if (origin && allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error("Origin not allowed"));
    },
    credentials: false,
}));
```

Why this matters:
- This is the main access control boundary for ops endpoints.

What this code does:
- Allows requests from configured origins.
- Optionally allows requests without Origin (for non-browser clients).
- Rejects other origins.

---

### 3) Ops admin token enforcement
```rust
const adminToken = process.env.OPS_ADMIN_TOKEN ?? "";
const requireAdmin = (req, res, next) => {
    if (!adminToken) {
        next();
        return;
    }
    const authHeader = req.headers.authorization;
    const bearerToken = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice("Bearer ".length)
        : null;
    const headerToken = typeof req.headers["x-admin-token"] === "string" ? req.headers["x-admin-token"] : null;
    if (bearerToken === adminToken || headerToken === adminToken) {
        next();
        return;
    }
    res.status(401).json({ error: "unauthorized" });
};
```

Why this matters:
- Admin endpoints must be protected even on private networks.

What this code does:
- Enforces a bearer token or header token.
- Returns 401 if the token is missing or invalid.

---

## Key takeaways
- Telemetry is opt-in and configured via env vars.
- Ops service is a local data store with CORS and token controls.
- Production requires explicit origin allowlists and admin tokens.

## Next lesson
E12 - CI images + Docker build chain: `feynman/lessons/E12-ci-docker.md`
