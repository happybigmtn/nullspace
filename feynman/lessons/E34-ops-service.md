# E34 - Ops service: file-based analytics and operational endpoints

Focus file: `/home/r/Coding/nullspace/services/ops/src/server.ts` (1,051 LOC)

Goal: explain how the ops service provides operational analytics, health monitoring, and admin tooling without requiring a database. This is a complete walkthrough of a file-based analytics system that tracks users, leaderboards, referrals, and push notifications while remaining simple enough to operate without external dependencies.

---

## Learning objectives

After this lesson you should be able to:

1) Explain why file-based analytics can be viable for operational scale.
2) Describe how event normalization and actor identity work across anonymous and authenticated sessions.
3) Trace an analytics event from ingestion through storage to leaderboard updates.
4) Understand the security model: CORS, admin tokens, and origin allowlists.
5) Navigate the data directory structure and retention strategy.
6) Explain how referral qualification tracking works.
7) Use the push notification segmentation system.
8) Compute KPIs from time-series event logs.

---

## 1) Why file-based analytics (architectural rationale)

Before diving into code, you need to understand why the ops service uses files instead of a database.

### 1.1 The operational analytics tier

Most systems have three analytics tiers:

- **System telemetry**: OpenTelemetry traces for debugging latency and errors (see E11, E27)
- **Operational analytics**: user events, leaderboards, KPIs (this service)
- **Data warehouse**: historical analysis, machine learning pipelines (not yet needed)

The ops service sits in the middle tier. It needs to be real-time enough for leaderboards but does not need complex queries or historical aggregations. This makes files viable.

### 1.2 Files vs database tradeoffs

**File-based pros:**

- Zero external dependencies (no Postgres, no Redis)
- Simple deployment (just mount a persistent volume)
- Easy backups (copy a directory)
- Append-only NDJSON scales well for time-series data
- No schema migrations or connection pools

**File-based cons:**

- Range queries are slower (must read multiple files)
- No transactions (must implement atomic writes manually)
- Retention requires manual cleanup
- Cannot handle millions of concurrent writers (but we do not need to)

For Nullspace scale (thousands of active players, hundreds of events per second), files work fine. The design explicitly trades query flexibility for operational simplicity.

### 1.3 When you would need a database

File-based analytics breaks down when:

- Event volume exceeds disk I/O capacity (tens of thousands of events per second)
- You need complex joins or aggregations (correlating user behavior across weeks)
- Multiple services need concurrent read-write access to the same data
- You need real-time streaming analytics (sub-second KPI updates)

The ops service is designed to avoid these requirements. It processes events in batches, stores pre-aggregated leaderboards, and only one service writes to the data directory.

---

## 2) Server bootstrap and data directory resolution

The ops service is an Express server that resolves a persistent data directory before starting.

### 2.1 Data directory resolution logic (lines 16-31)

```ts
const resolveDataDir = (): string => {
  const envDir = process.env.OPS_DATA_DIR?.trim();
  if (envDir) return path.resolve(envDir);
  const cwd = process.cwd();
  const candidateRoot = path.resolve(cwd, "data");
  if (fs.existsSync(candidateRoot)) {
    return path.join(candidateRoot, "ops");
  }
  return path.resolve(cwd, "..", "..", "data", "ops");
};

const DATA_DIR = resolveDataDir();
const EVENTS_DIR = path.join(DATA_DIR, "events");
const LEAGUE_DIR = path.join(DATA_DIR, "league");
const SEASON_DIR = path.join(DATA_DIR, "league-season");
const ECONOMY_DIR = path.join(DATA_DIR, "economy");
```

Walkthrough:

1) Try `OPS_DATA_DIR` environment variable first (explicit override).
2) If not set, look for `data/` in current working directory.
3) If `data/` exists, use `data/ops/` subdirectory.
4) Otherwise, assume we are running from a service subdirectory and use `../../data/ops/`.

This heuristic handles both monorepo development (running from repo root) and production deployment (explicit `OPS_DATA_DIR`).

The data directory contains four subdirectories:

- `events/`: daily NDJSON event logs (one file per UTC day)
- `league/`: weekly leaderboard JSON snapshots
- `league-season/`: monthly season leaderboard JSON snapshots
- `economy/`: economy snapshot JSON (for dashboard consumption)

### 2.2 Directory initialization (lines 78-86)

```ts
const ensureDir = async (dir: string) => {
  await fsp.mkdir(dir, { recursive: true });
};

await ensureDir(DATA_DIR);
await ensureDir(EVENTS_DIR);
await ensureDir(LEAGUE_DIR);
await ensureDir(SEASON_DIR);
await ensureDir(ECONOMY_DIR);
```

The service creates all directories at startup. The `recursive: true` option means parent directories are created automatically. This is safe to call multiple times (no-op if directories already exist).

This initialization is critical: if `OPS_DATA_DIR` points to a missing directory, the service creates it rather than failing. This makes deployment simpler because you do not need pre-provisioning scripts.

### 2.3 Why explicit subdirectories matter

The data layout is intentional:

- `events/YYYY-MM-DD.ndjson`: append-only event logs, partitioned by UTC day
- `league/YYYY-Wxx.json`: weekly leaderboard snapshots
- `league-season/YYYY-MM.json`: monthly season snapshots
- `economy/latest.json`: single snapshot file for current economy state

This structure makes retention simple: to keep 30 days of events, delete `events/*.ndjson` files older than 30 days. To keep 12 weeks of leaderboards, delete `league/*.json` files older than 12 weeks. No database vacuuming or partition management.

---

## 3) Security model: CORS, origins, and admin tokens

The ops service has two security layers: CORS for public endpoints and admin tokens for sensitive endpoints.

### 3.1 Origin allowlist configuration (lines 33-54)

```ts
const OPS_ALLOW_NO_ORIGIN = ["1", "true", "yes"].includes(
  String(process.env.OPS_ALLOW_NO_ORIGIN ?? "").toLowerCase(),
);

const isProduction = ["production", "prod"].includes(
  String(process.env.NODE_ENV ?? "").toLowerCase(),
);

const requireAllowedOrigins =
  isProduction ||
  ["1", "true", "yes"].includes(
    String(process.env.OPS_REQUIRE_ALLOWED_ORIGINS ?? "").toLowerCase(),
  );

const allowedOrigins = (process.env.OPS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (requireAllowedOrigins && allowedOrigins.length === 0) {
  throw new Error("OPS_ALLOWED_ORIGINS must be set when origin checks are required");
}
```

Walkthrough:

1) In production or when `OPS_REQUIRE_ALLOWED_ORIGINS=true`, an allowlist is required.
2) Parse `OPS_ALLOWED_ORIGINS` as a comma-separated list.
3) If the allowlist is empty in production, the service refuses to start.
4) `OPS_ALLOW_NO_ORIGIN` controls whether requests with no Origin header are allowed (useful for CLI tools and server-to-server calls).

This design is safe by default: production deployments must explicitly set allowed origins. If you forget, the service will not start (fail-fast).

### 3.2 CORS middleware implementation (lines 56-76)

```ts
app.use(
  cors({
    origin: (origin, callback) => {
      const normalizedOrigin = origin === "null" ? null : origin;
      if (!normalizedOrigin && OPS_ALLOW_NO_ORIGIN) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.length === 0) {
        callback(null, true);
        return;
      }
      if (normalizedOrigin && allowedOrigins.includes(normalizedOrigin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed"));
    },
    credentials: false,
  }),
);
```

Walkthrough:

1) Normalize `origin === "null"` to `null` (some browsers send literal string "null").
2) If no origin and `OPS_ALLOW_NO_ORIGIN` is true, allow the request.
3) If allowlist is empty, allow all origins (development mode).
4) If origin is in the allowlist, allow the request.
5) Otherwise, reject with CORS error.

The `credentials: false` setting means cookies are not sent cross-origin. This keeps the ops service stateless and prevents CSRF attacks.

### 3.3 Admin token middleware (lines 87-115)

```ts
const requireAdminToken =
  isProduction ||
  ["1", "true", "yes"].includes(
    String(process.env.OPS_REQUIRE_ADMIN_TOKEN ?? "").toLowerCase(),
  );
const adminToken = (process.env.OPS_ADMIN_TOKEN ?? "").trim();

if (requireAdminToken && !adminToken) {
  throw new Error("OPS_ADMIN_TOKEN must be set when admin auth is required");
}

const requireAdmin: express.RequestHandler = (req, res, next) => {
  if (!adminToken) {
    next();
    return;
  }
  const authHeader = req.headers.authorization;
  const bearerToken =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;
  const headerToken =
    typeof req.headers["x-admin-token"] === "string" ? req.headers["x-admin-token"] : null;
  if (bearerToken === adminToken || headerToken === adminToken) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized" });
};
```

Walkthrough:

1) In production or when explicitly required, an admin token must be set.
2) The `requireAdmin` middleware checks two headers:
   - `Authorization: Bearer <token>`
   - `x-admin-token: <token>`
3) If no admin token is configured, the middleware is a no-op (allows all requests).
4) If a token is configured but the request does not provide it, return 401.

This dual-header support is pragmatic: `Authorization: Bearer` is standard for web clients, but `x-admin-token` is easier for CLI tools and scripts that do not want to construct Bearer headers.

The admin token protects endpoints like:

- `POST /push/send` (send push notifications)
- `POST /crm/campaigns` (schedule campaigns)
- `GET /crm/campaigns` (list campaigns)

### 3.4 Security best practices for ops service

**In development:**

- Leave `OPS_ALLOWED_ORIGINS` and `OPS_ADMIN_TOKEN` unset.
- The service allows all origins and does not require admin tokens.

**In production:**

- Set `OPS_ALLOWED_ORIGINS=https://app.nullspace.gg,https://admin.nullspace.gg`.
- Set `OPS_ADMIN_TOKEN` to a long random string (use `openssl rand -hex 32`).
- Do not expose the ops service directly to the internet (put behind a reverse proxy or VPN).
- Monitor request rates and set Express rate limits if needed.

The ops service is not designed to handle hostile traffic. It assumes a trusted network environment (internal services or authenticated users). If you need public-facing analytics, add rate limiting and request validation.

---

## 4) Storage primitives: atomic JSON writes and NDJSON appends

The ops service implements three storage helpers that form the foundation of all persistence.

### 4.1 Reading JSON with fallback (lines 117-124)

```ts
const readJson = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};
```

This helper reads a JSON file and returns a typed fallback on any error (file not found, parse error, permission error). The fallback pattern makes code simpler: you do not need existence checks before reading.

Example:

```ts
const league = await readJson<LeagueBoard>(leaguePath, {
  weekKey,
  updatedAt: Date.now(),
  players: {},
});
```

If the file does not exist, you get an empty leaderboard. This is safe because the first event will create the file. If the file is corrupted, you get the fallback (data loss, but no crash).

### 4.2 Atomic JSON writes (lines 126-130)

```ts
const writeJson = async (filePath: string, data: unknown) => {
  const tmpPath = `${filePath}.tmp`;
  await fsp.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fsp.rename(tmpPath, filePath);
};
```

Walkthrough:

1) Write JSON to a temporary file (`filePath.tmp`).
2) Rename the temporary file to the target path.

The rename operation is atomic on POSIX filesystems (Linux, macOS). This means readers never see a partially written file. Either the old file exists, or the new file exists, but never a truncated intermediate state.

The `JSON.stringify(data, null, 2)` call formats JSON with 2-space indentation. This makes files human-readable for debugging. The trailing newline is a POSIX convention (makes `cat` and `tail` work correctly).

### 4.3 NDJSON appends (lines 132-136)

```ts
const appendNdjson = async (filePath: string, rows: unknown[]) => {
  if (rows.length === 0) return;
  const lines = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  await fsp.appendFile(filePath, lines, "utf8");
};
```

NDJSON (newline-delimited JSON) is a text format where each line is a separate JSON object. This has several benefits:

- Appending is cheap (no need to parse the entire file).
- Partial corruption only affects one line.
- Line-based tools work (grep, awk, wc -l).
- Easy to stream (process one line at a time without loading the entire file).

The helper builds a string of all rows joined by newlines, then appends in a single write. This is more efficient than appending one row at a time (fewer syscalls).

### 4.4 Why not use a database for this?

Consider what these helpers give you:

- Atomic writes (rename-based)
- Type-safe reads with fallbacks
- Append-only event logs
- Human-readable debugging (cat events/2026-01-08.ndjson)

A database would give you transactions and indexes, but you would lose:

- Zero external dependencies
- Simple backups (cp -r)
- Easy debugging (text files)

For operational analytics at Nullspace scale, these tradeoffs favor files. If event volume grows 10x, you can switch to Postgres or ClickHouse. But until then, files are simpler to operate.

---

## 5) Event normalization and actor identity

The ops service tracks actors (users) across events, even when users are anonymous or not fully authenticated.

### 5.1 Actor identity resolution (lines 296-302)

```ts
const getActorId = (actor?: ActorInfo): string | null => {
  const publicKey = actor?.publicKey ? normalizeHex(actor.publicKey) : "";
  if (publicKey && publicKey.length === 64) return publicKey;
  const deviceId = actor?.deviceId ? String(actor.deviceId).trim() : "";
  if (deviceId) return deviceId;
  return null;
};
```

Walkthrough:

1) Prefer `publicKey` (normalize hex and check length 64).
2) Fall back to `deviceId` (any non-empty string).
3) Return null if neither is available.

This design allows tracking actors before they register:

- Anonymous session: actor ID is device ID
- Registered user: actor ID is public key

The public key is the stable identity. Device IDs may change (app reinstalls, new devices), but public keys are permanent. This is why public key takes precedence.

The `normalizeHex` helper strips `0x` prefix and lowercases. This prevents duplicate actors from hex casing inconsistencies (0xABC vs 0xabc vs abc).

### 5.2 Event normalization (lines 306-345)

```ts
const normalizeEvent = (
  input: AnalyticsEventInput,
  defaults: {
    actor?: ActorInfo;
    source?: AnalyticsSource;
    session?: AnalyticsSession;
  },
  receivedAt: number,
): AnalyticsEvent | null => {
  const name = typeof input.name === "string" ? sanitizeName(input.name) : "";
  if (!name) return null;
  const ts = Number.isFinite(input.ts) ? Number(input.ts) : receivedAt;
  const actor = { ...defaults.actor, ...input.actor } as ActorInfo | undefined;
  const source = { ...defaults.source, ...input.source } as AnalyticsSource | undefined;
  const session = { ...defaults.session, ...input.session } as AnalyticsSession | undefined;
  const props =
    input.props && typeof input.props === "object" && !Array.isArray(input.props)
      ? (input.props as JsonRecord)
      : undefined;
  const meta =
    input.meta && typeof input.meta === "object" && !Array.isArray(input.meta)
      ? (input.meta as JsonRecord)
      : undefined;

  if (actor?.publicKey) {
    actor.publicKey = normalizeHex(actor.publicKey);
  }

  return {
    id: crypto.randomUUID(),
    ts,
    name,
    props,
    actor,
    source,
    session,
    meta,
    receivedAt,
  };
};
```

Walkthrough:

1) Sanitize event name (trim and enforce max length).
2) If name is empty, discard the event (invalid).
3) Use provided timestamp or fall back to `receivedAt`.
4) Merge default actor/source/session with event-specific overrides.
5) Validate `props` and `meta` are objects (not arrays or primitives).
6) Normalize actor public key (strip 0x, lowercase).
7) Assign a unique event ID and return.

The defaults pattern is important: when a client sends a batch of events, they can provide actor/source/session once at the top level, and each event inherits those defaults. This reduces payload size for bulk ingestion.

Example payload:

```json
{
  "actor": { "publicKey": "0xabc...", "platform": "ios" },
  "source": { "app": "mobile", "version": "1.2.3" },
  "events": [
    { "name": "casino.game.completed", "props": { "game": "plinko" } },
    { "name": "casino.game.completed", "props": { "game": "roulette" } }
  ]
}
```

Both events inherit the actor and source. This keeps the wire format compact.

### 5.3 Actor store updates (lines 347-377)

```ts
const updateActorsStore = (store: ActorsStore, events: AnalyticsEvent[]) => {
  for (const event of events) {
    const actorId = getActorId(event.actor);
    if (!actorId) continue;
    const existing = store.actors[actorId];
    if (!existing) {
      store.actors[actorId] = {
        actorId,
        publicKey: event.actor?.publicKey,
        deviceId: event.actor?.deviceId,
        platform: event.actor?.platform,
        appVersion: event.actor?.appVersion,
        locale: event.actor?.locale,
        firstSeen: event.ts,
        lastSeen: event.ts,
        events: 1,
        lastEvent: event.name,
      };
      continue;
    }
    existing.lastSeen = Math.max(existing.lastSeen, event.ts);
    existing.events += 1;
    existing.lastEvent = event.name;
    if (event.actor?.platform) existing.platform = event.actor.platform;
    if (event.actor?.appVersion) existing.appVersion = event.actor.appVersion;
    if (event.actor?.locale) existing.locale = event.actor.locale;
    if (event.actor?.publicKey) existing.publicKey = event.actor.publicKey;
    if (event.actor?.deviceId) existing.deviceId = event.actor.deviceId;
  }
  store.updatedAt = Date.now();
};
```

Walkthrough:

1) For each event, extract actor ID.
2) If no actor ID, skip (cannot track this event to a user).
3) If actor does not exist, create a new record with `firstSeen`, `lastSeen`, and counts.
4) If actor exists, update `lastSeen`, increment `events`, and overwrite fields if present.

The field overwrite logic is important: if an event provides a new `appVersion`, it updates the actor record. This means the actor store always reflects the most recent metadata.

The actor store is a lightweight user registry. It is not a database of users, but it is good enough for segmentation (find inactive users, filter by platform, etc.).

---

## 6) Event ingestion pipeline

The main ingestion endpoint processes events in batches and updates multiple data stores.

### 6.1 Ingestion endpoint (lines 562-592)

```ts
app.post("/analytics/events", async (req, res) => {
  const payload = req.body ?? {};
  const rawEvents: AnalyticsEventInput[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.events)
      ? payload.events
      : payload.name
        ? [payload]
        : [];

  if (rawEvents.length === 0) {
    res.status(400).json({ error: "no events" });
    return;
  }

  const defaults = {
    actor: payload.actor as ActorInfo | undefined,
    source: payload.source as AnalyticsSource | undefined,
    session: payload.session as AnalyticsSession | undefined,
  };

  const receivedAt = Date.now();
  const normalized: AnalyticsEvent[] = [];
  for (const event of rawEvents.slice(0, 200)) {
    const normalizedEvent = normalizeEvent(event, defaults, receivedAt);
    if (normalizedEvent) normalized.push(normalizedEvent);
  }

  await ingestEvents(normalized);
  res.status(202).json({ received: normalized.length });
});
```

Walkthrough:

1) Parse request body (supports three formats: single event, events array, or bare array).
2) If no events, return 400.
3) Extract defaults (actor, source, session) from payload root.
4) Normalize up to 200 events (clamp to prevent overload).
5) Call `ingestEvents` to process the batch.
6) Return 202 Accepted with count of received events.

The 202 status code is important: it means "accepted for processing, but not yet completed". This is accurate because ingestion is async (writes to disk may happen later). The response is fast, and the client does not block on disk I/O.

The 200-event limit prevents abuse. If a client sends 10,000 events, only the first 200 are processed. This is a simple defense against accidental or malicious overload.

### 6.2 Ingestion implementation (lines 530-556)

```ts
const ingestEvents = async (events: AnalyticsEvent[]) => {
  if (events.length === 0) return;
  const dayBuckets = new Map<string, AnalyticsEvent[]>();
  for (const event of events) {
    const dayKey = formatDayKey(event.ts);
    const existing = dayBuckets.get(dayKey) ?? [];
    existing.push(event);
    dayBuckets.set(dayKey, existing);
  }

  const actorsStore = await readJson<ActorsStore>(ACTORS_PATH, {
    updatedAt: Date.now(),
    actors: {},
  });
  updateActorsStore(actorsStore, events);
  await writeJson(ACTORS_PATH, actorsStore);

  for (const [dayKey, dayEvents] of dayBuckets.entries()) {
    const filePath = path.join(EVENTS_DIR, `${dayKey}.ndjson`);
    await appendNdjson(filePath, dayEvents);
  }

  for (const event of events) {
    await updateLeagueBoard(event);
    await updateReferralProgress(event);
  }
};
```

Walkthrough:

1) Bucket events by UTC day (computed from `event.ts`).
2) Load the actor store, update it with all events, and write back atomically.
3) For each day bucket, append events to that day's NDJSON file.
4) For each event, update league leaderboards and referral progress.

This pipeline is sequential (not parallel) for simplicity. Each step depends on the previous step completing. In production, you could parallelize some steps (actor store updates and NDJSON appends are independent), but the complexity tradeoff is not worth it at current scale.

### 6.3 Daily event bucketing

Events are partitioned by UTC day. The `formatDayKey` helper returns `YYYY-MM-DD`:

```ts
const dayKey = formatDayKey(event.ts);
const filePath = path.join(EVENTS_DIR, `${dayKey}.ndjson`);
```

This creates files like:

```
events/2026-01-08.ndjson
events/2026-01-09.ndjson
events/2026-01-10.ndjson
```

Each file contains all events for that UTC day. This makes retention simple: delete files older than 30 days. It also makes range queries easier: to load events for a week, read 7 files (no need to scan the entire event log).

The UTC choice is critical. If you used local time, day boundaries would shift with timezone, making aggregations inconsistent. UTC ensures that 2026-01-08 means the same thing for all users.

---

## 7) Health check endpoint

### 7.1 Simple liveness probe (lines 558-560)

```ts
app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});
```

This is the simplest possible health check: always return 200 OK. This tells load balancers and orchestration systems (Kubernetes, Docker Swarm) that the service is alive.

A more sophisticated health check would verify:

- Data directory is writable
- Recent ingestion succeeded
- Disk space is available

But the simple version is often enough. If the Express server responds, the service is probably working. If the server does not respond, something is wrong (crash, deadlock, OOM).

This endpoint is intentionally unauthenticated. Health checks run frequently (every few seconds), and requiring auth would add latency and complexity.

---

## 8) Leaderboard system: weekly and seasonal scoring

The ops service maintains two leaderboard types: weekly (resets every Monday) and seasonal (resets monthly).

### 8.1 Scoring logic (lines 379-418)

```ts
const leaguePointsMode = String(process.env.OPS_LEAGUE_POINTS_MODE ?? "wager")
  .trim()
  .toLowerCase();
const includeFreeroll = ["1", "true", "yes"].includes(
  String(process.env.OPS_LEAGUE_INCLUDE_FREEROLL ?? "").toLowerCase(),
);

const computePoints = (event: AnalyticsEvent): number => {
  const wagerRaw = event.props?.wager;
  const netRaw = event.props?.netPnL;
  const wager = typeof wagerRaw === "number" ? wagerRaw : Number(wagerRaw ?? 0);
  const netPnl = typeof netRaw === "number" ? netRaw : Number(netRaw ?? 0);
  let points = 0;
  if (leaguePointsMode === "net") {
    points = Math.max(0, Math.floor(netPnl));
  } else if (leaguePointsMode === "net-abs") {
    points = Math.max(0, Math.floor(Math.abs(netPnl)));
  } else {
    points = Math.max(0, Math.floor(wager));
  }
  if (!Number.isFinite(points) || points <= 0) points = 1;
  const superRound = Boolean(event.props?.superRound ?? event.props?.super);
  if (superRound) points *= 2;
  return points;
};

const shouldScoreEvent = (event: AnalyticsEvent): boolean => {
  if (event.name !== "casino.game.completed" && event.name !== "casino.super.round_completed") {
    return false;
  }
  const sourceApp = event.source?.app ? String(event.source.app).toLowerCase() : "";
  if (sourceApp === "mobile") {
    return false;
  }
  const mode = event.props?.mode;
  if (!includeFreeroll && mode && String(mode).toUpperCase() !== "CASH") {
    return false;
  }
  return true;
};
```

Walkthrough (scoring rules):

1) Only score `casino.game.completed` and `casino.super.round_completed` events.
2) Exclude mobile events (to focus on web play).
3) Exclude freeroll events unless `OPS_LEAGUE_INCLUDE_FREEROLL=true`.
4) Points are computed based on `OPS_LEAGUE_POINTS_MODE`:
   - `wager`: points = floor(wager amount)
   - `net`: points = floor(net PnL), minimum 0
   - `net-abs`: points = floor(absolute net PnL)
5) Minimum 1 point per game (prevents zero-point games).
6) Super rounds double points.

This design makes leaderboards tunable: you can reward volume (wager mode) or profitability (net mode). The super round multiplier incentivizes high-stakes games.

### 8.2 Leaderboard updates (lines 420-473)

```ts
const updateLeagueBoard = async (event: AnalyticsEvent) => {
  if (!shouldScoreEvent(event)) return;
  const publicKey = event.actor?.publicKey ? normalizeHex(event.actor.publicKey) : "";
  if (!publicKey) return;

  const weekKey = formatWeekKey(event.ts);
  const seasonKey = formatSeasonKey(event.ts);

  const leaguePath = path.join(LEAGUE_DIR, `${weekKey}.json`);
  const seasonPath = path.join(SEASON_DIR, `${seasonKey}.json`);

  const league = await readJson<LeagueBoard>(leaguePath, {
    weekKey,
    updatedAt: Date.now(),
    players: {},
  });
  const season = await readJson<SeasonBoard>(seasonPath, {
    seasonKey,
    updatedAt: Date.now(),
    players: {},
  });

  const points = computePoints(event);
  const wagerRaw = event.props?.wager;
  const netRaw = event.props?.netPnL;
  const wager = typeof wagerRaw === "number" ? wagerRaw : Number(wagerRaw ?? 0);
  const netPnl = typeof netRaw === "number" ? netRaw : Number(netRaw ?? 0);

  const updateEntry = (board: { players: Record<string, LeagueEntry> }) => {
    const entry = board.players[publicKey] ?? {
      publicKey,
      points: 0,
      games: 0,
      wager: 0,
      netPnl: 0,
      lastGameAt: 0,
    };
    entry.points += points;
    entry.games += 1;
    entry.wager += Number.isFinite(wager) ? wager : 0;
    entry.netPnl += Number.isFinite(netPnl) ? netPnl : 0;
    entry.lastGameAt = Math.max(entry.lastGameAt, event.ts);
    board.players[publicKey] = entry;
  };

  updateEntry(league);
  updateEntry(season);

  league.updatedAt = Date.now();
  season.updatedAt = Date.now();

  await writeJson(leaguePath, league);
  await writeJson(seasonPath, season);
};
```

Walkthrough:

1) Check if the event should be scored (game completed, not mobile, not freeroll).
2) Extract actor public key (leaderboards only track authenticated users).
3) Compute week key (`YYYY-Wxx`) and season key (`YYYY-MM`).
4) Load both leaderboards (or create empty if they do not exist).
5) Compute points and extract wager/netPnl.
6) Update both leaderboards (increment points, games, wager, netPnl).
7) Write both leaderboards atomically.

This means every game event updates two files. This is acceptable because:

- Events are not that frequent (hundreds per second, not thousands).
- Atomic writes are fast (rename is O(1)).
- Leaderboards are pre-aggregated (no need to recompute on every query).

### 8.3 Leaderboard query endpoint (lines 743-767)

```ts
app.get("/league/leaderboard", async (req, res) => {
  const weekKey = typeof req.query.week === "string" ? req.query.week : formatWeekKey(Date.now());
  const seasonKey = typeof req.query.season === "string" ? req.query.season : undefined;

  if (seasonKey) {
    const seasonPath = path.join(SEASON_DIR, `${seasonKey}.json`);
    const season = await readJson<SeasonBoard>(seasonPath, {
      seasonKey,
      updatedAt: 0,
      players: {},
    });
    const entries = Object.values(season.players).sort((a, b) => b.points - a.points);
    res.json({ seasonKey, updatedAt: season.updatedAt, entries });
    return;
  }

  const leaguePath = path.join(LEAGUE_DIR, `${weekKey}.json`);
  const league = await readJson<LeagueBoard>(leaguePath, {
    weekKey,
    updatedAt: 0,
    players: {},
  });
  const entries = Object.values(league.players).sort((a, b) => b.points - a.points);
  res.json({ weekKey, updatedAt: league.updatedAt, entries });
});
```

Walkthrough:

1) If `?season=YYYY-MM` is provided, load seasonal leaderboard.
2) Otherwise, load weekly leaderboard (default to current week).
3) Sort players by points descending.
4) Return JSON with week/season key, updated timestamp, and sorted entries.

This endpoint is unauthenticated because leaderboards are public data. Anyone can query them. If you want private leaderboards, add authentication middleware.

---

## 9) Referral system: code generation and qualification tracking

The ops service implements a referral system where users can create codes, claim codes, and qualify for rewards.

### 9.1 Referral code generation (lines 475-484)

```ts
const createReferralCode = (publicKey: string, existingCodes: Record<string, { publicKey: string }>) => {
  const base = crypto.createHash("sha256").update(publicKey).digest("hex").slice(0, 8).toUpperCase();
  let code = base;
  let attempt = 0;
  while (existingCodes[code] && existingCodes[code].publicKey !== publicKey && attempt < 10) {
    attempt += 1;
    code = `${base}${attempt}`.slice(0, 10).toUpperCase();
  }
  return code;
};
```

Walkthrough:

1) Hash the public key with SHA-256.
2) Take the first 8 hex characters and uppercase.
3) If there is a collision, append a numeric suffix (up to 10 attempts).
4) If still colliding after 10 attempts, give up (extremely unlikely).

This generates codes like `A3F8B2C9` or `A3F8B2C91` (with collision suffix). The codes are deterministic (same public key always generates the same base code) but likely unique (8 hex characters = 4 billion possibilities).

### 9.2 Referral code issuance (lines 769-792)

```ts
app.post("/referrals/code", async (req, res) => {
  const publicKey = normalizeHex(String(req.body?.publicKey ?? ""));
  if (!publicKey || publicKey.length !== 64) {
    res.status(400).json({ error: "invalid publicKey" });
    return;
  }
  const referralStore = await readJson<ReferralStore>(REFERRALS_PATH, {
    updatedAt: Date.now(),
    codes: {},
    owners: {},
    claims: {},
  });
  const existingCode = referralStore.owners[publicKey];
  if (existingCode) {
    res.json({ code: existingCode });
    return;
  }
  const code = createReferralCode(publicKey, referralStore.codes);
  referralStore.codes[code] = { publicKey, createdAt: Date.now() };
  referralStore.owners[publicKey] = code;
  referralStore.updatedAt = Date.now();
  await writeJson(REFERRALS_PATH, referralStore);
  res.json({ code });
});
```

Walkthrough:

1) Validate public key (64-character hex).
2) Load referral store.
3) If user already has a code, return it (idempotent).
4) Otherwise, generate a new code.
5) Store bidirectional mappings: `codes[code] -> publicKey`, `owners[publicKey] -> code`.
6) Write store atomically and return the code.

This endpoint is idempotent: calling it multiple times with the same public key returns the same code. This is safe because code generation is deterministic.

### 9.3 Referral code claiming (lines 794-834)

```ts
app.post("/referrals/claim", async (req, res) => {
  const publicKey = normalizeHex(String(req.body?.publicKey ?? ""));
  const code = String(req.body?.code ?? "").trim().toUpperCase();
  if (!publicKey || publicKey.length !== 64) {
    res.status(400).json({ error: "invalid publicKey" });
    return;
  }
  if (!code) {
    res.status(400).json({ error: "missing code" });
    return;
  }
  const referralStore = await readJson<ReferralStore>(REFERRALS_PATH, {
    updatedAt: Date.now(),
    codes: {},
    owners: {},
    claims: {},
  });
  const owner = referralStore.codes[code];
  if (!owner) {
    res.status(404).json({ error: "invalid code" });
    return;
  }
  if (owner.publicKey === publicKey) {
    res.status(400).json({ error: "self_referral" });
    return;
  }
  if (referralStore.claims[publicKey]) {
    res.json({ status: "already_claimed" });
    return;
  }
  const claim: ReferralClaim = {
    referredPublicKey: publicKey,
    code,
    referrerPublicKey: owner.publicKey,
    claimedAt: Date.now(),
  };
  referralStore.claims[publicKey] = claim;
  referralStore.updatedAt = Date.now();
  await writeJson(REFERRALS_PATH, referralStore);
  res.json({ status: "claimed" });
});
```

Walkthrough:

1) Validate public key and code.
2) Load referral store.
3) Check that the code exists.
4) Prevent self-referral (cannot claim your own code).
5) Check if user already claimed a code (one claim per user).
6) Create claim record and store it.

The claim record is keyed by `referredPublicKey`, which enforces the one-claim-per-user rule. Users cannot claim multiple referral codes.

### 9.4 Referral qualification tracking (lines 486-528)

```ts
const referralMinGames = Number.parseInt(process.env.OPS_REFERRAL_MIN_GAMES ?? "10", 10);
const referralMinDays = Number.parseInt(process.env.OPS_REFERRAL_MIN_DAYS ?? "3", 10);

const updateReferralProgress = async (event: AnalyticsEvent) => {
  if (!shouldScoreEvent(event)) return;
  const publicKey = event.actor?.publicKey ? normalizeHex(event.actor.publicKey) : "";
  if (!publicKey) return;

  const progress = await readJson<ReferralProgressStore>(REFERRAL_PROGRESS_PATH, {
    updatedAt: Date.now(),
    players: {},
  });
  const entry = progress.players[publicKey] ?? {
    publicKey,
    games: 0,
    activeDays: [],
    lastGameAt: 0,
  };
  entry.games += 1;
  const dayKey = formatDayKey(event.ts);
  if (!entry.activeDays.includes(dayKey)) entry.activeDays.push(dayKey);
  entry.lastGameAt = Math.max(entry.lastGameAt, event.ts);
  progress.players[publicKey] = entry;
  progress.updatedAt = Date.now();
  await writeJson(REFERRAL_PROGRESS_PATH, progress);

  const referralStore = await readJson<ReferralStore>(REFERRALS_PATH, {
    updatedAt: Date.now(),
    codes: {},
    owners: {},
    claims: {},
  });
  const claim = referralStore.claims[publicKey];
  if (claim && !claim.qualifiedAt) {
    if (entry.games >= referralMinGames && entry.activeDays.length >= referralMinDays) {
      claim.qualifiedAt = Date.now();
      claim.rewardStatus = "pending";
      referralStore.claims[publicKey] = claim;
      referralStore.updatedAt = Date.now();
      await writeJson(REFERRALS_PATH, referralStore);
    }
  }
};
```

Walkthrough:

1) Only track progress for scored events (game completed, not mobile, not freeroll).
2) Load referral progress store.
3) Increment game count and add active day (deduplicated).
4) Write progress store.
5) If user has a referral claim and is not yet qualified:
   - Check if `games >= referralMinGames` and `activeDays.length >= referralMinDays`.
   - If qualified, mark claim with `qualifiedAt` and `rewardStatus = "pending"`.

This implements a simple qualification rule: referred users must play at least 10 games on at least 3 different days. This prevents referral fraud (creating fake accounts and claiming immediately).

The `rewardStatus = "pending"` means an admin must manually process rewards. This is intentional: automated reward payouts require integration with a payment system or onchain token minting, which is outside the scope of the ops service.

---

## 10) Push notification system: token registration and segmentation

The ops service provides push notification infrastructure for targeting users.

### 10.1 Token registration (lines 863-885)

```ts
app.post("/push/register", async (req, res) => {
  const token = String(req.body?.token ?? "").trim();
  if (!token) {
    res.status(400).json({ error: "missing token" });
    return;
  }
  const publicKey = req.body?.publicKey ? normalizeHex(String(req.body.publicKey)) : undefined;
  const platform = req.body?.platform ? String(req.body.platform) : undefined;
  const appVersion = req.body?.appVersion ? String(req.body.appVersion) : undefined;
  const store = await readJson<PushStore>(PUSH_PATH, { updatedAt: Date.now(), tokens: {} });
  const now = Date.now();
  store.tokens[token] = {
    token,
    publicKey,
    platform,
    appVersion,
    createdAt: store.tokens[token]?.createdAt ?? now,
    lastSeenAt: now,
  };
  store.updatedAt = now;
  await writeJson(PUSH_PATH, store);
  res.json({ ok: true });
});
```

Walkthrough:

1) Validate that token is provided.
2) Optionally associate token with public key, platform, and app version.
3) Load push store.
4) Upsert token (preserve `createdAt` if token already exists, update `lastSeenAt`).
5) Write store and return success.

This endpoint is called by mobile apps when they receive a push token from the OS (APNs on iOS, FCM on Android). The token is an opaque string that identifies the device for push notifications.

The public key association is optional because users may grant push permissions before signing in. Once they sign in, the app can call this endpoint again with the same token and a public key, which updates the record.

### 10.2 Token segmentation (lines 887-912)

```ts
const resolveTokensForSegment = async (segment?: SegmentFilter): Promise<PushToken[]> => {
  const store = await readJson<PushStore>(PUSH_PATH, { updatedAt: Date.now(), tokens: {} });
  let tokens = Object.values(store.tokens);
  if (segment?.publicKeys && segment.publicKeys.length > 0) {
    const allowed = new Set(segment.publicKeys.map((k) => normalizeHex(k)));
    tokens = tokens.filter((token) => token.publicKey && allowed.has(normalizeHex(token.publicKey)));
  }
  if (segment?.inactiveDays || segment?.activeWithinDays) {
    const actorsStore = await readJson<ActorsStore>(ACTORS_PATH, {
      updatedAt: Date.now(),
      actors: {},
    });
    const now = Date.now();
    const inactiveCutoff = segment.inactiveDays ? now - segment.inactiveDays * 86400000 : null;
    const activeCutoff = segment.activeWithinDays ? now - segment.activeWithinDays * 86400000 : null;
    tokens = tokens.filter((token) => {
      if (!token.publicKey) return false;
      const actor = actorsStore.actors[normalizeHex(token.publicKey)];
      if (!actor) return false;
      if (inactiveCutoff && actor.lastSeen >= inactiveCutoff) return false;
      if (activeCutoff && actor.lastSeen < activeCutoff) return false;
      return true;
    });
  }
  return tokens;
};
```

Walkthrough:

1) Load all push tokens.
2) If segment specifies `publicKeys`, filter to only those users.
3) If segment specifies `inactiveDays` or `activeWithinDays`, load actor store and filter by `lastSeen`:
   - `inactiveDays=7`: only users who have not been seen in 7+ days.
   - `activeWithinDays=1`: only users who have been seen in the last 1 day.

This segmentation system allows targeted push campaigns:

- Win-back campaign: `inactiveDays: 30` (users who have not played in 30 days)
- Engagement campaign: `activeWithinDays: 7` (users who played recently)
- VIP campaign: `publicKeys: [...]` (specific high-value users)

### 10.3 Push sending via Expo (lines 914-959)

```ts
const sendExpoPush = async (messages: JsonRecord[]) => {
  const endpoint = process.env.OPS_EXPO_ENDPOINT ?? "https://exp.host/--/api/v2/push/send";
  const accessToken = process.env.OPS_EXPO_ACCESS_TOKEN;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(messages),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Expo push failed: ${response.status} ${text.slice(0, 200)}`);
  }
  return await response.json();
};

const sendPushToTokens = async (payload: {
  title: string;
  body: string;
  data?: JsonRecord;
  segment?: SegmentFilter;
  tokens?: string[];
}) => {
  const tokens = payload.tokens?.length
    ? payload.tokens.map((token) => ({ token }))
    : await resolveTokensForSegment(payload.segment);

  const messages = tokens.map((entry) => ({
    to: entry.token,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
  }));

  const results = [] as unknown[];
  const batchSize = 100;
  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);
    const result = await sendExpoPush(batch);
    results.push(result);
  }

  return { sent: messages.length, results };
};
```

Walkthrough:

1) If explicit tokens are provided, use those. Otherwise, resolve tokens from segment.
2) Build Expo push messages (to, title, body, data).
3) Batch messages in groups of 100 (Expo API limit).
4) Send each batch to Expo API.
5) Return count of sent messages and Expo results.

The Expo API handles delivery to APNs and FCM. The ops service just needs to provide tokens and message payloads. This keeps the push system simple (no APNs certificates or FCM keys).

---

## 11) CRM campaigns: scheduled push notifications

The ops service provides campaign scheduling on top of the push system.

### 11.1 Campaign creation (lines 978-1007)

```ts
app.post("/crm/campaigns", requireAdmin, async (req, res) => {
  const title = String(req.body?.title ?? "").trim();
  const body = String(req.body?.body ?? "").trim();
  if (!title || !body) {
    res.status(400).json({ error: "missing title/body" });
    return;
  }
  const sendAtMs = Number.isFinite(req.body?.sendAtMs) ? Number(req.body.sendAtMs) : Date.now();
  const campaign: Campaign = {
    id: crypto.randomUUID(),
    name: req.body?.name ? String(req.body.name).trim() : undefined,
    title,
    body,
    data: req.body?.data,
    sendAtMs,
    status: "scheduled",
    createdAt: Date.now(),
    segment: req.body?.segment,
  };

  const store = await readJson<CampaignStore>(CAMPAIGNS_PATH, {
    updatedAt: Date.now(),
    campaigns: [],
  });
  store.campaigns.push(campaign);
  store.updatedAt = Date.now();
  await writeJson(CAMPAIGNS_PATH, store);

  res.json({ id: campaign.id, status: campaign.status });
});
```

Walkthrough:

1) Require admin token.
2) Validate title and body.
3) Parse `sendAtMs` (default to now if not provided).
4) Create campaign record with UUID and status "scheduled".
5) Append campaign to store and write atomically.

Campaigns are stored in a simple JSON array. This is fine for operational scale (dozens of campaigns, not thousands). If you need high-volume campaigns, use a database.

### 11.2 Campaign processing loop (lines 1014-1047)

```ts
const processCampaigns = async () => {
  const store = await readJson<CampaignStore>(CAMPAIGNS_PATH, { updatedAt: Date.now(), campaigns: [] });
  const now = Date.now();
  let changed = false;
  for (const campaign of store.campaigns) {
    if (campaign.status !== "scheduled") continue;
    if (campaign.sendAtMs > now) continue;
    campaign.attemptCount = (campaign.attemptCount ?? 0) + 1;
    try {
      const result = await sendPushToTokens({
        title: campaign.title,
        body: campaign.body,
        data: campaign.data,
        segment: campaign.segment,
      });
      campaign.status = "sent";
      campaign.sentAtMs = Date.now();
      campaign.lastError = undefined;
      campaign.data = { ...(campaign.data ?? {}), sent: result.sent };
    } catch (error) {
      campaign.status = "failed";
      campaign.lastError = error instanceof Error ? error.message : "push failed";
    }
    changed = true;
  }
  if (changed) {
    store.updatedAt = Date.now();
    await writeJson(CAMPAIGNS_PATH, store);
  }
};

setInterval(() => {
  void processCampaigns();
}, 30000);
```

Walkthrough:

1) Every 30 seconds, load campaigns.
2) For each scheduled campaign:
   - Check if `sendAtMs` has passed.
   - Increment `attemptCount`.
   - Try to send push notifications.
   - On success: mark "sent", record `sentAtMs`, store send count.
   - On failure: mark "failed", record error message.
3) If any campaign changed, write store atomically.

This is a simple background loop. It does not use a queue or worker pool, just a 30-second timer. This is acceptable because:

- Campaign volume is low (a few per day, not hundreds).
- Send latency is not critical (30-second resolution is fine).
- Failures are recorded (admins can retry manually).

For high-volume campaigns, you would use a job queue (Bull, BullMQ) or a cron system.

---

## 12) KPI aggregation: computing metrics from event logs

The KPI endpoint computes product metrics from raw event logs.

### 12.1 KPI endpoint structure (lines 632-731)

```ts
app.get("/analytics/kpis", async (req, res) => {
  const now = Date.now();
  const since = parseDateInput(req.query.since as string | undefined, now - 30 * 86400000);
  const until = parseDateInput(req.query.until as string | undefined, now);

  const events = await loadEventsInRange(since, until);
  const actorsByDay = new Map<string, Set<string>>();
  const actorDays = new Map<string, Set<string>>();
  const firstSeen = new Map<string, string>();
  const byName: Record<string, number> = {};
  let revenue = 0;
  const converted = new Set<string>();

  for (const event of events) {
    byName[event.name] = (byName[event.name] ?? 0) + 1;
    const actorId = getActorId(event.actor);
    if (actorId) {
      const dayKey = formatDayKey(event.ts);
      if (!actorsByDay.has(dayKey)) actorsByDay.set(dayKey, new Set());
      actorsByDay.get(dayKey)!.add(actorId);
      if (!actorDays.has(actorId)) actorDays.set(actorId, new Set());
      actorDays.get(actorId)!.add(dayKey);
      if (!firstSeen.has(actorId)) firstSeen.set(actorId, dayKey);
    }
    if (event.name.startsWith("billing.")) {
      const amount = Number(event.props?.amount ?? 0);
      if (Number.isFinite(amount) && amount > 0) revenue += amount;
      if (actorId) converted.add(actorId);
    }
  }
  // ... retention and metric computation
});
```

Walkthrough:

1) Parse date range (default last 30 days).
2) Load all events in range from daily NDJSON files.
3) Build data structures:
   - `actorsByDay`: set of actors active on each day
   - `actorDays`: set of days each actor was active
   - `firstSeen`: first day each actor appeared
   - `byName`: count of events by name
   - `revenue`: sum of billing event amounts
   - `converted`: set of actors with billing events
4) Compute DAU, WAU, MAU, retention, conversion rate, ARPDAU.

### 12.2 Event range loading (lines 594-621)

```ts
const loadEventsInRange = async (since: number, until: number): Promise<AnalyticsEvent[]> => {
  const events: AnalyticsEvent[] = [];
  const startDate = new Date(since);
  startDate.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(until);
  endDate.setUTCHours(0, 0, 0, 0);
  const cursor = new Date(startDate);
  while (cursor.getTime() <= endDate.getTime()) {
    const dayKey = formatDayKey(cursor.getTime());
    const filePath = path.join(EVENTS_DIR, `${dayKey}.ndjson`);
    if (fs.existsSync(filePath)) {
      const raw = await fsp.readFile(filePath, "utf8");
      const lines = raw.split("\n").filter((line) => line.trim().length > 0);
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as AnalyticsEvent;
          if (event.ts >= since && event.ts <= until) {
            events.push(event);
          }
        } catch {
          // ignore parse errors
        }
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return events;
};
```

Walkthrough:

1) Round `since` and `until` to UTC day boundaries.
2) Walk from start day to end day.
3) For each day, load the NDJSON file (if it exists).
4) Parse each line as JSON.
5) Filter events to the exact timestamp range (day boundaries are inclusive, but events may have millisecond timestamps outside the range).
6) Ignore parse errors (corrupted lines do not crash the query).

This implementation is simple but scales linearly with the number of days in the range. For a 30-day range, it reads 30 files. For a 365-day range, it reads 365 files. This is acceptable for operational analytics but not for historical deep dives.

### 12.3 Retention computation (lines 690-712)

```ts
let d7Cohort = 0;
let d7Retained = 0;
let d30Cohort = 0;
let d30Retained = 0;

for (const [actorId, firstDay] of firstSeen.entries()) {
  const cohortDayMs = dayToMs(firstDay);
  if (cohortDayMs >= since && cohortDayMs <= until) {
    const daySet = actorDays.get(actorId);
    if (daySet) {
      const d7Target = formatDayKey(cohortDayMs + 7 * 86400000);
      const d30Target = formatDayKey(cohortDayMs + 30 * 86400000);
      if (dayToMs(d7Target) <= until) {
        d7Cohort += 1;
        if (daySet.has(d7Target)) d7Retained += 1;
      }
      if (dayToMs(d30Target) <= until) {
        d30Cohort += 1;
        if (daySet.has(d30Target)) d30Retained += 1;
      }
    }
  }
}
```

Walkthrough:

1) For each actor, find their first seen day (cohort day).
2) Check if their cohort day is within the query range.
3) Compute day 7 and day 30 after cohort day.
4) If day 7 is within the query range, increment `d7Cohort`.
5) If the actor was active on day 7, increment `d7Retained`.
6) Same logic for day 30.

This is classic cohort retention analysis. The retention rate is `retained / cohort`. If 100 users joined on day 0 and 20 of them were active on day 7, the D7 retention rate is 20%.

---

## 13) Economy snapshot endpoint

### 13.1 Simple snapshot serving (lines 733-741)

```ts
app.get("/economy/snapshot", async (_req, res) => {
  const snapshotPath = path.join(ECONOMY_DIR, "latest.json");
  if (!fs.existsSync(snapshotPath)) {
    res.status(404).json({ error: "snapshot_not_found" });
    return;
  }
  const payload = await readJson(snapshotPath, null);
  res.json(payload);
});
```

This endpoint serves a single file: `economy/latest.json`. The file is written by an external process (not the ops service). This is intentional: the ops service is read-only for economy data.

The economy snapshot might include:

- Total currency in circulation
- Top wallet balances
- Treasury reserves
- Token burn/mint events

This endpoint is for dashboard consumption. It provides a single source of truth for economy metrics without embedding them into the main simulator or gateway services.

---

## 14) Limits and management callouts

### 14.1 Data retention strategy

The ops service does not implement automatic retention. Old files accumulate indefinitely. For production, implement a retention policy:

- Keep 30 days of raw events (`events/*.ndjson`)
- Keep 90 days of leaderboards (`league/*.json`, `league-season/*.json`)
- Keep 365 days of actor summaries (`actors.json` is cumulative, prune inactive actors)

Example retention script:

```bash
#!/bin/bash
find /data/ops/events -name "*.ndjson" -mtime +30 -delete
find /data/ops/league -name "*.json" -mtime +90 -delete
```

Run this daily via cron. The `-mtime +30` flag deletes files older than 30 days.

### 14.2 Disk space monitoring

The ops service writes to disk continuously. If the disk fills, the service crashes or deadlocks. Monitor disk usage:

- Alert when data directory is 80% full.
- Alert when write latency exceeds 100ms (indicates slow disk).
- Monitor NDJSON file sizes (large files indicate high event volume).

### 14.3 Event payload validation

The ops service accepts arbitrary JSON payloads. Malicious or buggy clients can send:

- Giant payloads (OOM risk)
- Deeply nested objects (JSON parse performance)
- Non-UTF8 strings (encoding issues)

The 2MB body limit (`express.json({ limit: "2mb" })`) provides basic protection. For production, add stricter validation:

- Enforce event name allowlist (only known event names)
- Validate prop types (wager must be number, game must be string)
- Reject events with future timestamps (clock skew attacks)

### 14.4 Admin token rotation

The admin token is static (set via environment variable). If it leaks, you must restart the service to rotate it. For production, implement token rotation:

- Store admin tokens in a file or secret manager.
- Reload tokens on SIGHUP signal.
- Support multiple valid tokens during rotation (old + new).

Example:

```ts
let adminTokens = [process.env.OPS_ADMIN_TOKEN];

process.on("SIGHUP", () => {
  adminTokens = readTokensFromFile("/etc/ops/admin-tokens.json");
});

const requireAdmin: express.RequestHandler = (req, res, next) => {
  const bearerToken = extractBearerToken(req);
  if (adminTokens.includes(bearerToken)) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized" });
};
```

### 14.5 File locking and concurrency

The ops service assumes single-writer (only one ops service instance). If you run multiple instances, they will race on file writes and corrupt data. For multi-instance deployments:

- Use file locking (`flock` via `fs.flock` or `lockfile` npm package).
- Or migrate to a database (Postgres, ClickHouse).
- Or partition instances by shard (each instance owns a subset of users).

### 14.6 Event time vs ingestion time

Events include both `ts` (event timestamp) and `receivedAt` (ingestion timestamp). The KPI endpoint uses `ts` for day bucketing. This is correct for time-series analysis, but it means:

- Events with clock skew (client time is wrong) are bucketed incorrectly.
- Events sent hours after they occurred are still bucketed by event time.

For production, validate that `ts` is within a reasonable range (e.g., not more than 1 hour in the past or future). If outside the range, use `receivedAt` instead.

---

## 15) Feynman recap

The ops service is a file-based operational analytics system. It stores events in daily NDJSON logs, maintains pre-aggregated leaderboards, tracks referral progress, and provides push notification segmentation. It is designed to be simple to deploy and operate, trading query flexibility for operational simplicity.

Events flow from client to ingestion endpoint, where they are normalized, bucketed by day, and written to NDJSON files. The ingestion pipeline also updates actor summaries, leaderboard snapshots, and referral progress in atomic JSON writes.

The security model uses CORS origin allowlists for public endpoints and admin tokens for sensitive endpoints. The data directory is persistent and must be backed up regularly. Retention is manual (delete old files via cron).

The system is intentionally simple: no database, no queue, no workers. This keeps operations lightweight but requires careful monitoring of disk space and write latency. For higher scale, migrate to a database or event streaming platform.

---

## 16) Key takeaways

1) File-based analytics can scale to thousands of events per second with careful design (daily partitioning, NDJSON appends, atomic writes).
2) Actor identity resolution (public key or device ID) enables tracking across anonymous and authenticated sessions.
3) Pre-aggregated leaderboards keep queries fast (no need to scan raw events).
4) Referral qualification tracking implements anti-fraud rules (minimum games, minimum days).
5) Push notification segmentation (inactive users, active users, specific users) enables targeted campaigns.
6) KPI computation from raw event logs is feasible for 30-90 day ranges at operational scale.
7) Security layers (CORS, admin tokens, payload limits) are essential for public-facing operational services.

---

## 17) Systemd integration and production deployment

The ops service runs under systemd supervision in production, just like the gateway and other core services.

### 17.1 Systemd unit file (ops/systemd/nullspace-ops.service)

```ini
[Unit]
Description=Nullspace Ops Service
After=network.target

[Service]
Type=simple
User=nullspace
Group=nullspace
WorkingDirectory=/opt/nullspace/services/ops
EnvironmentFile=/etc/nullspace/ops.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Walkthrough:

1) `After=network.target`: start after basic networking is available
2) `Type=simple`: the process runs in the foreground (standard for Node services)
3) `User=nullspace`: run as non-root user for security
4) `WorkingDirectory=/opt/nullspace/services/ops`: set working directory for relative paths
5) `EnvironmentFile=/etc/nullspace/ops.env`: load environment variables from secure config file
6) `Environment=NODE_ENV=production`: ensure production mode regardless of env file
7) `ExecStart=/usr/bin/node dist/server.js`: run the built server (requires `npm run build` first)
8) `Restart=on-failure`: automatically restart if the service crashes
9) `RestartSec=5`: wait 5 seconds between restarts to prevent tight crash loops

### 17.2 Why the ops service does not set LimitNOFILE

Unlike the gateway (which sets `LimitNOFILE=100000` for WebSocket connections), the ops service uses the default file descriptor limit. This is intentional:

- The ops service is HTTP-only (no persistent connections)
- File I/O is sequential (one NDJSON append or JSON write at a time)
- No need for thousands of concurrent file descriptors

If you see file descriptor errors in production, check:

1) How many events are being ingested simultaneously (batching may help)
2) Whether multiple processes are writing to the same data directory (not supported)
3) System-wide limits (`ulimit -n`)

### 17.3 Environment file structure

The ops service expects `/etc/nullspace/ops.env` with production configuration:

```bash
# Server
OPS_PORT=9020
OPS_DATA_DIR=/var/lib/nullspace/ops

# Security (REQUIRED in production)
OPS_ALLOWED_ORIGINS=https://app.nullspace.gg,https://admin.nullspace.gg
OPS_ADMIN_TOKEN=<long-random-token>
OPS_REQUIRE_ADMIN_TOKEN=true
OPS_REQUIRE_ALLOWED_ORIGINS=true
OPS_ALLOW_NO_ORIGIN=false

# Analytics
OPS_LEAGUE_POINTS_MODE=wager
OPS_LEAGUE_INCLUDE_FREEROLL=false
OPS_REFERRAL_MIN_GAMES=10
OPS_REFERRAL_MIN_DAYS=3

# Push (optional)
OPS_EXPO_ENDPOINT=https://exp.host/--/api/v2/push/send
OPS_EXPO_ACCESS_TOKEN=<expo-token>
```

Critical settings for production:

- `OPS_ALLOWED_ORIGINS`: **must** be set to prevent CORS bypass
- `OPS_ADMIN_TOKEN`: **must** be set to protect admin endpoints
- `OPS_DATA_DIR`: **must** point to persistent storage (not `/tmp` or ephemeral volumes)

### 17.4 Deployment workflow

The ops service requires a build step before systemd can start it:

```bash
# 1. Build the service
cd /opt/nullspace/services/ops
npm install --production
npm run build

# 2. Verify build output exists
ls -la dist/server.js

# 3. Copy systemd unit
sudo cp /opt/nullspace/ops/systemd/nullspace-ops.service /etc/systemd/system/

# 4. Create environment file
sudo vim /etc/nullspace/ops.env

# 5. Reload systemd and start
sudo systemctl daemon-reload
sudo systemctl enable nullspace-ops
sudo systemctl start nullspace-ops

# 6. Verify service is running
sudo systemctl status nullspace-ops
curl http://localhost:9020/healthz
```

If the service fails to start:

1) Check logs: `journalctl -u nullspace-ops -n 50`
2) Verify build output: `ls /opt/nullspace/services/ops/dist/`
3) Check environment file: `sudo systemctl show nullspace-ops | grep EnvironmentFile`
4) Test manually: `cd /opt/nullspace/services/ops && node dist/server.js`

### 17.5 Health monitoring and operational checks

The `/healthz` endpoint is critical for production monitoring:

```bash
# Basic health check
curl http://localhost:9020/healthz
# Expected: {"ok":true}

# Check from load balancer or monitoring system
curl -f http://ops-internal:9020/healthz || alert
```

Systemd does not include native health checks, so you must configure external monitoring:

- **Uptime monitoring**: ping `/healthz` every 30 seconds
- **Disk space**: alert when `OPS_DATA_DIR` is 80% full
- **Write latency**: monitor NDJSON append times (should be <10ms)
- **Event ingestion rate**: track `POST /analytics/events` request rate

### 17.6 Common operational issues

**Issue: Service starts but crashes immediately**

Check: `journalctl -u nullspace-ops -n 100`

Common causes:
- Missing `dist/server.js` (forgot to build)
- Invalid `OPS_DATA_DIR` path (permissions or missing directory)
- Required env vars not set (`OPS_ADMIN_TOKEN` in production)

**Issue: CORS errors from browser clients**

Check: `OPS_ALLOWED_ORIGINS` is set correctly

```bash
# Test CORS headers
curl -v -H "Origin: https://app.nullspace.gg" http://localhost:9020/healthz
# Should include: Access-Control-Allow-Origin: https://app.nullspace.gg
```

**Issue: Disk filling up**

The ops service does not implement automatic retention. Old NDJSON files accumulate. Implement a cleanup script:

```bash
#!/bin/bash
# /opt/nullspace/scripts/ops-retention.sh
find /var/lib/nullspace/ops/events -name "*.ndjson" -mtime +30 -delete
find /var/lib/nullspace/ops/league -name "*.json" -mtime +90 -delete
find /var/lib/nullspace/ops/league-season -name "*.json" -mtime +180 -delete
```

Run via cron:

```bash
# /etc/cron.d/ops-retention
0 2 * * * root /opt/nullspace/scripts/ops-retention.sh
```

**Issue: 401 Unauthorized on admin endpoints**

Check: `OPS_ADMIN_TOKEN` is set and matches the request header

```bash
# Test admin endpoint
curl -H "x-admin-token: your-token-here" http://localhost:9020/crm/campaigns
# Or with Bearer token
curl -H "Authorization: Bearer your-token-here" http://localhost:9020/crm/campaigns
```

---

## 18) Docker containerization and healthchecks

The ops service includes a production Dockerfile with built-in healthcheck.

### 18.1 Dockerfile structure (services/ops/Dockerfile)

```dockerfile
FROM node:20-slim AS build

RUN corepack enable

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/ops/package.json /app/services/ops/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter nullspace-ops...

COPY services/ops/tsconfig.json /app/services/ops/
COPY services/ops/src /app/services/ops/src

WORKDIR /app/services/ops
RUN pnpm run build

FROM node:20-slim

RUN corepack enable

WORKDIR /app
ENV NODE_ENV=production

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/ops/package.json /app/services/ops/

RUN pnpm install --prod --frozen-lockfile --filter nullspace-ops... --ignore-scripts

COPY --from=build /app/services/ops/dist /app/services/ops/dist

RUN chown -R node:node /app/services/ops
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.OPS_PORT || 9020) + '/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "/app/services/ops/dist/server.js"]
```

Walkthrough:

1) **Multi-stage build**: build stage compiles TypeScript, runtime stage only includes production dependencies
2) **Corepack enable**: uses pnpm from Node.js 20's built-in corepack
3) **Workspace filtering**: `--filter nullspace-ops...` installs only ops dependencies
4) **Non-root user**: runs as `node:node` for security (line 35-36)
5) **Built-in healthcheck**: Docker automatically checks `/healthz` every 30 seconds
6) **Port flexibility**: healthcheck respects `OPS_PORT` environment variable

### 18.2 Docker healthcheck explained

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.OPS_PORT || 9020) + '/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

This healthcheck:

1) Runs every 30 seconds (`--interval=30s`)
2) Times out if no response in 5 seconds (`--timeout=5s`)
3) Waits 5 seconds after container start before first check (`--start-period=5s`)
4) Marks container unhealthy after 3 consecutive failures (`--retries=3`)
5) Uses Node's built-in `fetch` to check `/healthz` endpoint
6) Exits 0 if response is OK, exits 1 otherwise

This is more robust than `curl`-based healthchecks because:

- No need to install `curl` in the container (smaller image)
- Uses the same HTTP stack as the service itself
- Respects `OPS_PORT` configuration

### 18.3 Running the ops service in Docker

```bash
# Build the image
docker build -f services/ops/Dockerfile -t nullspace-ops:latest .

# Run with persistent volume
docker run -d \
  --name nullspace-ops \
  -p 9020:9020 \
  -v /var/lib/nullspace/ops:/app/data/ops \
  -e OPS_DATA_DIR=/app/data/ops \
  -e OPS_ALLOWED_ORIGINS=https://app.nullspace.gg \
  -e OPS_ADMIN_TOKEN=your-secret-token \
  -e OPS_PORT=9020 \
  nullspace-ops:latest

# Check health status
docker ps --format "table {{.Names}}\t{{.Status}}"
# Should show: nullspace-ops    Up 2 minutes (healthy)

# View healthcheck logs
docker inspect nullspace-ops | jq '.[0].State.Health'
```

Critical: The `-v /var/lib/nullspace/ops:/app/data/ops` mount is **required**. Without it, all analytics data is lost when the container stops.

### 18.4 Docker Compose deployment

```yaml
# docker-compose.yml
services:
  ops:
    build:
      context: .
      dockerfile: services/ops/Dockerfile
    ports:
      - "9020:9020"
    volumes:
      - ops-data:/app/data/ops
    environment:
      OPS_DATA_DIR: /app/data/ops
      OPS_PORT: 9020
      OPS_ALLOWED_ORIGINS: ${OPS_ALLOWED_ORIGINS}
      OPS_ADMIN_TOKEN: ${OPS_ADMIN_TOKEN}
      OPS_LEAGUE_POINTS_MODE: wager
      OPS_REFERRAL_MIN_GAMES: 10
      OPS_REFERRAL_MIN_DAYS: 3
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:9020/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 5s

volumes:
  ops-data:
    driver: local
```

Deploy:

```bash
# Create .env file with secrets
cat > .env <<EOF
OPS_ALLOWED_ORIGINS=https://app.nullspace.gg,https://admin.nullspace.gg
OPS_ADMIN_TOKEN=$(openssl rand -hex 32)
EOF

# Start service
docker compose up -d ops

# Check logs
docker compose logs -f ops
```

### 18.5 Kubernetes deployment considerations

For Kubernetes deployments, the ops service requires:

1) **Persistent Volume Claim** for `OPS_DATA_DIR`
2) **Liveness probe** using `/healthz`
3) **Readiness probe** using `/healthz`
4) **Secrets** for `OPS_ADMIN_TOKEN` and `OPS_ALLOWED_ORIGINS`

Example pod spec:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nullspace-ops
spec:
  containers:
  - name: ops
    image: ghcr.io/nullspace/ops:latest
    ports:
    - containerPort: 9020
    env:
    - name: OPS_DATA_DIR
      value: /data
    - name: OPS_PORT
      value: "9020"
    envFrom:
    - secretRef:
        name: ops-secrets
    volumeMounts:
    - name: data
      mountPath: /data
    livenessProbe:
      httpGet:
        path: /healthz
        port: 9020
      initialDelaySeconds: 5
      periodSeconds: 30
    readinessProbe:
      httpGet:
        path: /healthz
        port: 9020
      initialDelaySeconds: 3
      periodSeconds: 10
  volumes:
  - name: data
    persistentVolumeClaim:
      claimName: ops-data
```

The key insight: Kubernetes healthchecks use the same `/healthz` endpoint as Docker, but with more granular control (separate liveness and readiness probes).

---

## 19) Exercises

1) Why does the ops service use NDJSON for event logs instead of a single JSON array?
2) How does atomic JSON writing (via temp file and rename) prevent data corruption?
3) Walk through the flow of a game event from ingestion to leaderboard update.
4) Why does actor identity prefer public key over device ID?
5) How does referral qualification prevent fraud?
6) What happens if you run two ops service instances pointing to the same data directory?
7) Design a retention script that keeps 30 days of events and 90 days of leaderboards.
8) How would you migrate the ops service to Postgres while preserving the same API?
9) Why does the ops service not set `LimitNOFILE` in its systemd unit, unlike the gateway?
10) Explain why the Docker healthcheck uses Node's `fetch` instead of installing `curl`.
11) What would happen if you ran the ops service container without the persistent volume mount?
12) Compare systemd supervision vs Docker healthchecks: what does each provide?

---

## Next lesson

E35 - Integration tests and test harnesses: `feynman/lessons/E35-integration-tests.md`
