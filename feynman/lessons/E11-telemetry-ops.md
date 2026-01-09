# E11 - Telemetry, logs, and ops events (from scratch, deep dive)

Focus files:
- `gateway/src/telemetry.ts`
- `services/ops/dist/server.js`

Goal: explain how telemetry is enabled, how the ops service collects analytics and admin data, and why these operational features matter for correctness and product health. This is a full walkthrough of configuration, storage, and endpoint behavior.

---

## Learning objectives

After this lesson you should be able to:

1) Explain when gateway telemetry is enabled and what it exports.
2) Describe how OpenTelemetry traces flow from services through the collector to Grafana Tempo.
3) Understand W3C Trace Context propagation across service boundaries.
4) Navigate Grafana dashboards to debug service issues using metrics, logs, and traces.
5) Describe how the ops service stores events and aggregates KPIs.
6) Understand the security controls for ops endpoints (CORS, admin tokens).
7) Trace an analytics event from ingestion to storage and leaderboard updates.
8) Describe the referral and push notification workflows.

---

## 1) Observability fundamentals (before the code)

You need a shared vocabulary before the walkthroughs make sense.

### 1.1 Logs, metrics, and traces are different tools

- **Logs** are discrete events: "request failed", "balance updated". Great for debugging specific failures.
- **Metrics** are numbers over time: latency, error rate, throughput. Great for dashboards and alerts.
- **Traces** are end-to-end request timelines: which services and functions were involved, how long each step took.

If you only have logs, you can debug incidents but cannot easily see trends. If you only have metrics, you see trends but cannot explain root cause. Traces connect the two.

### 1.2 A trace is a tree of spans

A **trace** is one user request or one background job, and it is made up of **spans**:

- A span has a start time, end time, and attributes (method, URL, status).
- Spans can be nested (HTTP request -> DB query -> cache lookup).
- A trace ID ties all spans together across services.

This is how you answer, "where did the time go?"

### 1.3 OpenTelemetry is the plumbing

OpenTelemetry (OTel) provides:

- **Instrumentation**: hooks into HTTP clients, servers, DBs.
- **SDK**: collects spans in process.
- **Exporter**: sends spans to a collector or backend.
- **Collector** (optional): centralized service that receives spans and forwards them.

This pipeline is why you see `OTLP` endpoints in configs: OTLP is the standard wire format for sending telemetry.

### 1.3.1 W3C Trace Context propagation

OpenTelemetry implements the W3C Trace Context standard, which defines how trace context is propagated across service boundaries via HTTP headers:

- `traceparent`: contains trace ID, parent span ID, and sampling decision
- `tracestate`: vendor-specific trace state information

When a request flows from the gateway to the simulator, the trace context is automatically propagated. This allows you to follow a single user request across multiple services in your distributed tracing backend. Without this standard, each service would create independent, disconnected traces.

The gateway's auto-instrumentation handles this propagation automatically for outbound HTTP requests.

### 1.4 Product ops analytics is not telemetry

Telemetry is about system behavior. Ops analytics is about user behavior and business rules:

- telemetry: "this HTTP request took 120ms"
- ops analytics: "player completed a game with bet X and payout Y"

We treat them as separate layers so they can be scaled and secured differently.

### 1.5 Why file-based ops analytics can still work

The ops service stores data in JSON/NDJSON files instead of a database. This is a deliberate tradeoff:

- **Pros**: simple to deploy, easy to back up, no external dependencies.
- **Cons**: range queries are slower, retention is manual.

For our scale, this keeps ops simple while still enabling KPIs and leaderboards.

---

## 2) Telemetry vs ops: two different layers

It is easy to confuse telemetry and ops analytics, but they are different layers:

- **Telemetry (OpenTelemetry)** is about low-level traces and spans. It helps you debug latency and service behavior.
- **Ops analytics** is about product and operational metrics: user events, leaderboards, referrals, push notifications.

Gateway telemetry is optional and export-based. Ops analytics is always local and file-based. Together they provide both system-level visibility and product-level visibility.

---

## 3) Gateway telemetry bootstrap (`gateway/src/telemetry.ts`)

The telemetry file is small but important. It uses OpenTelemetry's Node SDK and only starts if a collector endpoint is configured:

```ts
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
  ...
}
```

Walkthrough:

1) Read `OTEL_EXPORTER_OTLP_ENDPOINT`. If it is absent, the SDK never starts.
2) Default the service name so traces are labeled consistently.
3) Create a `NodeSDK` with an OTLP exporter and auto-instrumentation.
4) Start the SDK immediately so it captures early requests.

The critical insight: **telemetry is opt-in by environment**. This keeps dev safe and prod explicit.

### 3.1 Why the endpoint gate matters

If `OTEL_EXPORTER_OTLP_ENDPOINT` is not set, telemetry does nothing. This is safe by default. It prevents accidental exports in development and ensures you do not send data unless you intend to.

### 3.2 Service name defaulting

If `OTEL_SERVICE_NAME` is not provided, the gateway uses `nullspace-gateway`. This makes traces easy to identify in multi-service environments.

### 3.3 Auto instrumentation

`getNodeAutoInstrumentations()` wires up common Node libraries (HTTP, DNS, etc.) automatically. This gives you a baseline trace without manual span creation.

### 3.4 Graceful shutdown

The file registers handlers for `SIGTERM` and `SIGINT` to shut down the SDK. This prevents spans from being lost during restarts.

### 3.5 Where traces go: Grafana Tempo

In production, the gateway exports traces to Grafana Tempo via the OpenTelemetry Collector. The flow is:

1. Gateway SDK exports spans to `OTEL_EXPORTER_OTLP_ENDPOINT` (typically the collector).
2. OpenTelemetry Collector receives spans and forwards them to Tempo.
3. Tempo stores traces in object storage (S3-compatible).
4. Grafana queries Tempo to visualize traces.

This architecture separates concerns:

- **Gateway**: lightweight OTLP export, no storage logic.
- **Collector**: buffering, batching, and routing.
- **Tempo**: durable trace storage.
- **Grafana**: query and visualization.

Tempo is designed for high-volume traces. It uses object storage instead of a database, which makes it cost-effective and scalable. Traces are indexed by trace ID, service name, and span attributes, allowing you to search for specific requests or errors.

For a deep dive on the full observability stack (Grafana, Tempo, Loki, Prometheus), see **E27 - Observability stack deep dive**.

### 3.6 Grafana dashboards: service-level visibility

Nullspace runs Grafana dashboards for each major service:

- **Gateway dashboard**: HTTP request rates, latency percentiles (p50, p95, p99), error rates, active connections
- **Simulator dashboard**: game execution time, RNG call counts, state transitions, error rates
- **Auth service dashboard**: authentication success/failure rates, token issuance rates, session counts
- **Game services dashboard**: per-game metrics (blackjack, roulette, slots), bet distributions, payout ratios

These dashboards query:

- **Prometheus** for metrics (request counts, latency histograms, error rates)
- **Loki** for structured logs (error messages, audit events)
- **Tempo** for distributed traces (end-to-end request timelines)

A typical debugging workflow:

1. See elevated error rate in the gateway dashboard.
2. Query Loki for error logs in that time window.
3. Find a trace ID in the logs.
4. Open that trace in Tempo to see which downstream service failed.
5. Drill into that service's span to see the root cause (timeout, validation error, etc.).

This three-pillar approach (metrics, logs, traces) is why Grafana is the unified query layer. You can correlate data across sources without switching tools.

---

## 4) Ops service overview (`services/ops/dist/server.js`)

The ops service is an Express server that stores analytics data on disk and exposes a set of admin endpoints. It is designed to be simple and file-based so it can run without an external analytics stack.

Key characteristics:

- JSON body limit is 2 MB.
- Data directory is resolved from `OPS_DATA_DIR` or a default `data/ops` path.
- Data is stored in JSON and NDJSON files.
- CORS allowlist and optional admin token protect sensitive routes.

Concrete excerpt (data dir + CORS + admin guard):

```ts
const resolveDataDir = () => {
  const envDir = process.env.OPS_DATA_DIR?.trim();
  if (envDir) return path.resolve(envDir);
  const cwd = process.cwd();
  const candidateRoot = path.resolve(cwd, 'data');
  if (fs.existsSync(candidateRoot)) return path.join(candidateRoot, 'ops');
  return path.resolve(cwd, '..', '..', 'data', 'ops');
};

const requireAdmin = (req, res, next) => {
  if (!adminToken) return next();
  const authHeader = req.headers.authorization;
  const bearerToken = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : null;
  const headerToken = typeof req.headers['x-admin-token'] === 'string'
    ? req.headers['x-admin-token']
    : null;
  if (bearerToken === adminToken || headerToken === adminToken) return next();
  res.status(401).json({ error: 'unauthorized' });
};
```

Walkthrough:

1) Resolve a persistent data directory with sensible defaults.
2) Protect admin routes if a token is configured.
3) Allow both `Authorization: Bearer` and `x-admin-token` for tooling flexibility.

---

## 4.1) Health checks as a deployment hook

The ops service exposes `GET /healthz`, which simply returns `{ ok: true }`. This endpoint is small but important: load balancers and monitoring systems use it to determine whether the service is alive. Without a health check, you cannot automate failover or safe deployment rollouts. It also simplifies uptime dashboards.

This is an example of operational engineering: a one-line endpoint that makes automation possible.

---

## 5) Data directory resolution and persistence

The ops server computes its data root as follows:

1) If `OPS_DATA_DIR` is set, it uses that.
2) Otherwise, it looks for `data/ops` in the current working directory.
3) If not found, it uses `../../data/ops` relative to the working directory.

It creates subdirectories for:

- `events` (daily NDJSON files)
- `league` (weekly leaderboard JSON)
- `league-season` (monthly leaderboard JSON)
- `economy` (economy snapshots)

This design assumes a persistent data directory. If `OPS_DATA_DIR` points to ephemeral storage, analytics will be lost on restart.

---

## 6) CORS and origin allowlists

The ops service uses CORS rules that are configurable through environment variables:

- `OPS_ALLOWED_ORIGINS`: comma-separated allowlist.
- `OPS_ALLOW_NO_ORIGIN`: allow non-browser clients with no Origin header.

The logic is explicit:

- If allowlist is empty, all origins are allowed.
- If allowlist is set, only those origins are allowed.
- If no Origin and `OPS_ALLOW_NO_ORIGIN` is true, allow it.

This makes the ops service flexible but dangerous if you forget to set the allowlist. In production, you should always set `OPS_ALLOWED_ORIGINS`.

---

## 7) Admin token enforcement

Some endpoints are protected by an admin token (`OPS_ADMIN_TOKEN`). The `requireAdmin` middleware checks either:

- An `Authorization: Bearer <token>` header, or
- An `x-admin-token` header.

If the token is not present or does not match, the request is rejected with 401.

This is a simple but effective control. It is intentionally optional: if no admin token is configured, the routes are open. That is fine for dev but risky for production.

---

## 8) Storage helpers: JSON and NDJSON

The ops server implements three core helpers:

- `readJson(path, fallback)` reads a JSON file and returns a fallback on error.
- `writeJson(path, data)` writes JSON via a temp file and atomic rename.
- `appendNdjson(path, rows)` appends newline-delimited JSON rows.

The atomic rename pattern prevents partially written JSON from corrupting the file. NDJSON is used for event logs because it is append-friendly and can be streamed or parsed line by line.

---

## 8.1) Time keys and normalization helpers

The ops service includes small helpers that have outsized impact on data quality:

- `formatDayKey(ts)` returns `YYYY-MM-DD` in UTC.
- `formatWeekKey(ts)` computes ISO-like week keys (`YYYY-Wxx`).
- `formatSeasonKey(ts)` returns `YYYY-MM`.

These functions guarantee that buckets are stable and timezone-independent. If you used local time, daily and weekly aggregates would shift with timezone, which would make comparisons unreliable.

Normalization helpers like `normalizeHex` and `sanitizeName` enforce consistent formatting. `normalizeHex` strips `0x` and lowercases public keys; `sanitizeName` trims event names and enforces a length cap. This prevents unbounded or inconsistent data from poisoning analytics.

These details are easy to overlook, but they are the difference between analytics you can trust and analytics that are quietly wrong.

---
## 9) Event normalization and actor identity

Incoming analytics events are normalized before storage. The normalization logic:

- Requires a non-empty event name.
- Adds a UUID `id` and `receivedAt` timestamp.
- Normalizes `actor`, `source`, and `session` by merging defaults with event fields.
- Normalizes `actor.publicKey` by stripping `0x` and lowercasing.

An actor ID is derived from either a public key or a device id. This allows the system to track activity across events without requiring a full user account.

This is a key design choice: event ingestion does not depend on authentication being perfect. It can still track sessions and devices, which is useful for funnel analysis.

---

## 9.1) Actor store and identity updates

The ops service maintains an `actors.json` store that tracks one record per actor. The `updateActorsStore` function updates fields such as:

- `firstSeen` and `lastSeen`
- `events` count
- `lastEvent`
- `platform`, `appVersion`, `locale`
- `publicKey` or `deviceId`

This store is updated on every ingestion batch. The design is intentionally simple: it is a lightweight user registry derived from analytics events. That makes it useful even if auth systems are down, because it does not rely on database joins or external services.

The actor id is derived using `getActorId`, which prefers a normalized public key and falls back to a device id. This is a pragmatic compromise: public keys are stable, but device ids allow you to track anonymous sessions before registration.

---

## 10) Event ingestion flow

The main ingestion endpoint is:

`POST /analytics/events`

It accepts either:

- A single event object, or
- An object with an `events` array, or
- A raw array of events.

The server normalizes up to 200 events per request and then processes them:

1) Bucket events by day (UTC) and append to NDJSON files.
2) Update the actor store (`actors.json`), tracking last seen, platform, etc.
3) Update league leaderboards and referral progress for each event.

The response is `202 Accepted` with the count of ingested events.

This pipeline is intentionally simple. It does not require a database and can be backed up by copying the data directory.

Concrete excerpt:

```ts
app.post('/analytics/events', async (req, res) => {
  const payload = req.body ?? {};
  const rawEvents = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.events)
      ? payload.events
      : payload.name
        ? [payload]
        : [];
  if (rawEvents.length === 0) {
    res.status(400).json({ error: 'no events' });
    return;
  }
  const defaults = { actor: payload.actor, source: payload.source, session: payload.session };
  const receivedAt = Date.now();
  const normalized = [];
  for (const event of rawEvents.slice(0, 200)) {
    const normalizedEvent = normalizeEvent(event, defaults, receivedAt);
    if (normalizedEvent) normalized.push(normalizedEvent);
  }
  await ingestEvents(normalized);
  res.status(202).json({ received: normalized.length });
});
```

Walkthrough:

1) Accept a single event or an array.
2) Apply defaults (actor/source/session).
3) Normalize and clamp to 200 events.
4) Ingest and respond with a 202 + count.

---

## 10.1) Daily NDJSON buckets

Events are stored in daily files, named by `YYYY-MM-DD`. The format is newline-delimited JSON (NDJSON). This has several benefits:

- Appending is cheap and does not require rewriting a full JSON array.
- Partial corruption only affects one line, not the entire file.
- It is easy to stream or parse with line-based tools.

The day key is computed in UTC (`formatDayKey`). This avoids timezone ambiguity. All analytics and retention calculations assume UTC day boundaries, which is consistent and predictable.

This design choice is why the ops service can be file-based yet still handle large numbers of events. It turns the file system into a simple time-series database.

---

## 10.2) Payload limits and defensive ingestion

The ops service sets `express.json({ limit: "2mb" })`, which caps request bodies at 2 MB. It also clamps ingestion to at most 200 events per request. These limits exist to prevent accidental or malicious overload.

The normalization step discards events without a valid name. This is another defense: it prevents arbitrary JSON from bloating the event log and keeps analytics clean. The combination of size limits, event count limits, and normalization makes ingestion predictable and safer to operate.

---

## 11) KPI aggregation endpoint

`GET /analytics/kpis` loads events from a time range (default last 30 days) and computes:

- DAU, WAU, MAU
- D7 and D30 retention
- Conversion rate (based on `billing.*` events)
- Revenue and ARPDAU
- Event counts by name

The endpoint parses NDJSON files for each day in the range. It builds sets of actors per day and calculates retention by checking whether each actor is present on day 7 or day 30 after their first seen day.

This is a fairly sophisticated KPI computation for a file-based system. It shows that you can get meaningful analytics without a full data warehouse, as long as you structure your logs well.

---

## 11.1) Retention math and cohorts

The KPI endpoint computes retention by building a map of each actor's active days. When it encounters an actor for the first time, it stores the day key in `firstSeen`. Later, it checks whether that actor appeared on day 7 or day 30 after first seen.

This is classic cohort analysis:

- A **cohort** is the set of actors first seen on a day.

- **Retained** means those actors appear again on a later day.

- Retention rate is retained / cohort.

The endpoint also computes DAU/WAU/MAU by building sets of actors in the last 1, 7, and 30 days. These metrics are approximate but good enough for product health monitoring.

The fact that this is computed from raw NDJSON files is a design tradeoff: it is slower than a database query but easier to operate and reason about.

## 11.2) Date parsing and range loading

The KPI endpoint accepts `since` and `until` as query parameters. It supports both numeric timestamps and date strings. The helper `parseDateInput` tries numeric parsing first, then `Date.parse`. If parsing fails, it falls back to a default range.

`loadEventsInRange` walks from the start day to the end day, loading each day's NDJSON file if it exists. This is simple, but it does mean KPI requests scale with the number of days in the range. For long ranges, this can be expensive. In practice, the default 30-day window is a reasonable compromise for a file-based store.

---

## 12) Economy snapshot endpoint

`GET /economy/snapshot` returns the contents of `economy/latest.json` if it exists. If not, it returns a 404 with `snapshot_not_found`.

This endpoint is for dashboard consumption. It provides a single source of truth for economy metrics without embedding them into the main simulator or gateway services.

---

## 13) League leaderboard endpoints

`GET /league/leaderboard` returns either weekly or seasonal leaderboards. It uses:

- `league` data for weekly (key like `YYYY-Wxx`).
- `league-season` data for monthly (key like `YYYY-MM`).

Points are computed via `computePoints`, which is controlled by env vars:

- `OPS_LEAGUE_POINTS_MODE`: `wager`, `net`, or `net-abs`.
- `OPS_LEAGUE_INCLUDE_FREEROLL`: include or exclude freeroll games.

Super rounds double points. This logic means the leaderboard is not just a list of wins; it is shaped by business rules.

---

## 13.1) League scoring details

The scoring logic is in `computePoints` and `shouldScoreEvent`. The rules are:

- Only `casino.game.completed` and `casino.super.round_completed` events are considered.

- Mobile events are excluded (`source.app === "mobile"`).

- Freeroll events are excluded unless `OPS_LEAGUE_INCLUDE_FREEROLL` is true.

Points are computed from wager or net PnL depending on `OPS_LEAGUE_POINTS_MODE`:

- `wager`: points based on wager size (default).
- `net`: points based on net profit (floor of net PnL, at least 1).
- `net-abs`: points based on absolute net PnL.

Super rounds double points. This means the leaderboard can be tuned to reward different behaviors (volume vs profitability). It is explicitly a product decision, not just a technical one.

---

## 14) Referrals: code issuance and claims

The ops service provides referral endpoints:

- `POST /referrals/code`: create or fetch a code for a public key.
- `POST /referrals/claim`: claim a referral code for a new public key.
- `GET /referrals/summary`: get summary for a public key.

The referral store is a JSON file with:

- `codes`: map code -> owner public key.
- `owners`: map public key -> code.
- `claims`: map referred public key -> claim info.

The claim flow checks for:

- valid public key
- valid code
- no self-referral
- no duplicate claim

Referral progress is stored separately in `referral-progress.json`. This allows the system to track when referred users qualify (for example, after a purchase or a number of games).

---

## 14.1) How referral qualification works

The ops service defines two thresholds:

- `OPS_REFERRAL_MIN_GAMES` (default 10)

- `OPS_REFERRAL_MIN_DAYS` (default 3)

Each scored event increments the referred player's game count and adds the active day to a list. When both thresholds are satisfied, the claim is marked with `qualifiedAt` and `rewardStatus = "pending"`. This is a lightweight reward workflow that can be processed later by an admin tool or script.

Referral codes are generated by hashing the public key with SHA-256, taking the first 8 hex characters, and uppercasing. If there is a collision, a numeric suffix is appended (up to 10 characters). This ensures codes are deterministic but still likely unique.

---

## 15) Push notifications

The ops service supports push tokens and push sending.

### 15.1 Token registration

`POST /push/register` stores a token with optional public key, platform, and app version. The data is saved in `push-tokens.json` with `createdAt` and `lastSeenAt` timestamps.

### 15.2 Token segmentation

When sending pushes, the service can filter tokens by:

- A list of public keys
- Inactive days (users who have not been seen in N days)
- Active within days (users who have been seen recently)

This uses the actors store to compute last seen times. It is a simple but powerful targeting mechanism.

### 15.3 Sending via Expo

Push messages are sent via the Expo API (`OPS_EXPO_ENDPOINT`). The service batches messages in groups of 100 and returns results for each batch.

This is a pragmatic implementation: it relies on Expo's infrastructure but keeps scheduling and segmentation in-house.

---

## 15.4) Batching and error handling

The push sender returns a count of messages sent and the raw results from Expo. If Expo responds with an error, the ops service throws an exception and the endpoint returns a 502. This is intentional: push is an external dependency, so failures should be visible.

Batching is capped at 100 messages per request. This keeps payload sizes manageable and aligns with typical push provider constraints. If you need to send to thousands of devices, the service loops through batches and accumulates results.

This design keeps the system simple while still supporting meaningful outreach. If you need more sophisticated delivery guarantees, you can build on top of this by adding retry queues or failure tracking in campaigns.

---

## 16) CRM campaigns

The ops service provides lightweight campaign scheduling:

- `POST /crm/campaigns` creates a scheduled campaign.
- `GET /crm/campaigns` lists campaigns (admin only).

Campaigns are stored in `campaigns.json` with fields like `sendAtMs`, `segment`, and `status`. A background loop runs every 30 seconds and sends campaigns that are due. If sending fails, the campaign is marked failed with an error.

This is not a full CRM system, but it is enough for simple campaigns like new feature announcements or win-back messages.

---

## 17) Security and operational considerations

Key operational constraints:

- `OPS_DATA_DIR` must be on persistent storage.
- `OPS_ALLOWED_ORIGINS` should be set in production.
- `OPS_ADMIN_TOKEN` should protect admin endpoints.
- JSON body limit is 2 MB; large payloads are rejected.

The ops service is intentionally simple, but that simplicity means it must be guarded. If you expose it to the public internet with no allowlist or token, it becomes an attack surface.

---

## 17.1) Backups and data retention

Because the ops service writes JSON and NDJSON files, backups are straightforward: snapshot the `OPS_DATA_DIR` directory. You can also rotate daily NDJSON files to manage disk usage. The key is consistency: if you delete old files, KPI ranges will change because data is missing.

This is the main tradeoff of a file-based analytics system. It is easy to operate, but retention and backups are your responsibility. The runbook's emphasis on persistent volumes is critical here.

---

## 18) Feynman recap

Telemetry is the engine dashboard: it shows how the gateway behaves. Ops analytics is the scoreboard: it shows what users are doing.

Telemetry is optional and export-based. OpenTelemetry captures traces with W3C Trace Context propagation, exports them via OTLP to the collector, which forwards them to Grafana Tempo for storage. Grafana provides unified dashboards that query Prometheus (metrics), Loki (logs), and Tempo (traces), enabling a complete debugging workflow from high-level error rates down to individual request timelines.

Ops analytics is local and file-based, storing events in daily NDJSON buckets. This keeps it simple and dependency-free while still supporting KPIs, leaderboards, referrals, and push campaigns.

Both layers are needed if you want to run a real system and understand it. For the full observability architecture, see E27.

---

## 19) Exercises

1) What triggers telemetry to start in the gateway?
2) How does W3C Trace Context enable distributed tracing across services?
3) What are the three data sources that Grafana dashboards query, and what does each provide?
4) Describe the flow of a trace from the gateway to Grafana Tempo.
5) Why does the ops service store daily NDJSON instead of a single JSON file?
6) How does `OPS_LEAGUE_POINTS_MODE` change the leaderboard?
7) What does `OPS_ALLOW_NO_ORIGIN` do, and why could it be risky?
8) How does the ops service decide whether an actor is the same across events?
9) You see a spike in gateway errors. Walk through how you would use Grafana, Loki, and Tempo to find the root cause.

---

## Next lesson

E12 - CI, Docker, and build workflows: `feynman/lessons/E12-ci-docker.md`
