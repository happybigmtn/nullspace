import "dotenv/config";
import crypto from "crypto";
import express from "express";
import cors from "cors";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { formatDayKey, formatSeasonKey, formatWeekKey, normalizeHex } from "./utils.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

const PORT = Number.parseInt(process.env.OPS_PORT ?? "9020", 10);

function resolveDataDir(): string {
  const envDir = process.env.OPS_DATA_DIR?.trim();
  if (envDir) {
    return path.resolve(envDir);
  }
  const cwd = process.cwd();
  const candidateRoot = path.resolve(cwd, "data");
  if (fs.existsSync(candidateRoot)) {
    return path.join(candidateRoot, "ops");
  }
  return path.resolve(cwd, "..", "..", "data", "ops");
}

const DATA_DIR = resolveDataDir();
const EVENTS_DIR = path.join(DATA_DIR, "events");
const LEAGUE_DIR = path.join(DATA_DIR, "league");
const SEASON_DIR = path.join(DATA_DIR, "league-season");
const ECONOMY_DIR = path.join(DATA_DIR, "economy");

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

async function ensureDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

await ensureDir(DATA_DIR);
await ensureDir(EVENTS_DIR);
await ensureDir(LEAGUE_DIR);
await ensureDir(SEASON_DIR);
await ensureDir(ECONOMY_DIR);
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

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await fsp.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fsp.rename(tmpPath, filePath);
}

async function appendNdjson(filePath: string, rows: unknown[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const lines = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  await fsp.appendFile(filePath, lines, "utf8");
}


type JsonRecord = Record<string, unknown>;

type ActorInfo = {
  publicKey?: string;
  deviceId?: string;
  platform?: string;
  appVersion?: string;
  locale?: string;
};

type AnalyticsSource = {
  app?: string;
  surface?: string;
  version?: string;
  env?: string;
};

type AnalyticsSession = {
  id?: string;
};

type AnalyticsEventInput = {
  ts?: number;
  name?: string;
  props?: JsonRecord;
  actor?: ActorInfo;
  source?: AnalyticsSource;
  session?: AnalyticsSession;
  meta?: JsonRecord;
};

type AnalyticsEvent = {
  id: string;
  ts: number;
  name: string;
  props?: JsonRecord;
  actor?: ActorInfo;
  source?: AnalyticsSource;
  session?: AnalyticsSession;
  meta?: JsonRecord;
  receivedAt: number;
};

type ActorSummary = {
  actorId: string;
  publicKey?: string;
  deviceId?: string;
  platform?: string;
  appVersion?: string;
  locale?: string;
  firstSeen: number;
  lastSeen: number;
  events: number;
  lastEvent?: string;
};

type ActorsStore = {
  updatedAt: number;
  actors: Record<string, ActorSummary>;
};

type LeagueEntry = {
  publicKey: string;
  points: number;
  games: number;
  wager: number;
  netPnl: number;
  lastGameAt: number;
};

type LeagueBoard = {
  weekKey: string;
  updatedAt: number;
  players: Record<string, LeagueEntry>;
};

type SeasonBoard = {
  seasonKey: string;
  updatedAt: number;
  players: Record<string, LeagueEntry>;
};

type ReferralClaim = {
  referredPublicKey: string;
  code: string;
  referrerPublicKey: string;
  claimedAt: number;
  qualifiedAt?: number;
  rewardStatus?: "pending" | "paid";
};

type ReferralStore = {
  updatedAt: number;
  codes: Record<string, { publicKey: string; createdAt: number }>;
  owners: Record<string, string>;
  claims: Record<string, ReferralClaim>;
};

type ReferralProgressStore = {
  updatedAt: number;
  players: Record<
    string,
    {
      publicKey: string;
      games: number;
      activeDays: string[];
      lastGameAt: number;
    }
  >;
};

type PushToken = {
  token: string;
  publicKey?: string;
  platform?: string;
  appVersion?: string;
  createdAt: number;
  lastSeenAt: number;
};

type PushStore = {
  updatedAt: number;
  tokens: Record<string, PushToken>;
};

type Campaign = {
  id: string;
  name?: string;
  title: string;
  body: string;
  data?: JsonRecord;
  sendAtMs: number;
  status: "scheduled" | "sent" | "failed";
  createdAt: number;
  sentAtMs?: number;
  attemptCount?: number;
  lastError?: string;
  segment?: SegmentFilter;
};

type CampaignStore = {
  updatedAt: number;
  campaigns: Campaign[];
};

type SegmentFilter = {
  inactiveDays?: number;
  activeWithinDays?: number;
  publicKeys?: string[];
};

const ACTORS_PATH = path.join(DATA_DIR, "actors.json");
const REFERRALS_PATH = path.join(DATA_DIR, "referrals.json");
const REFERRAL_PROGRESS_PATH = path.join(DATA_DIR, "referral-progress.json");
const PUSH_PATH = path.join(DATA_DIR, "push-tokens.json");
const CAMPAIGNS_PATH = path.join(DATA_DIR, "campaigns.json");

function getActorId(actor?: ActorInfo): string | null {
  const publicKey = actor?.publicKey ? normalizeHex(actor.publicKey) : "";
  if (publicKey && publicKey.length === 64) {
    return publicKey;
  }
  const deviceId = actor?.deviceId ? String(actor.deviceId).trim() : "";
  if (deviceId) {
    return deviceId;
  }
  return null;
}

function sanitizeName(name: string): string {
  return name.trim().slice(0, 128);
}

function normalizeEvent(
  input: AnalyticsEventInput,
  defaults: {
    actor?: ActorInfo;
    source?: AnalyticsSource;
    session?: AnalyticsSession;
  },
  receivedAt: number,
): AnalyticsEvent | null {
  const name = typeof input.name === "string" ? sanitizeName(input.name) : "";
  if (!name) {
    return null;
  }
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
}

function updateActorsStore(store: ActorsStore, events: AnalyticsEvent[]): void {
  for (const event of events) {
    const actorId = getActorId(event.actor);
    if (!actorId) {
      continue;
    }
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
    if (event.actor?.platform) {
      existing.platform = event.actor.platform;
    }
    if (event.actor?.appVersion) {
      existing.appVersion = event.actor.appVersion;
    }
    if (event.actor?.locale) {
      existing.locale = event.actor.locale;
    }
    if (event.actor?.publicKey) {
      existing.publicKey = event.actor.publicKey;
    }
    if (event.actor?.deviceId) {
      existing.deviceId = event.actor.deviceId;
    }
  }
  store.updatedAt = Date.now();
}

const leaguePointsMode = String(process.env.OPS_LEAGUE_POINTS_MODE ?? "wager")
  .trim()
  .toLowerCase();
const includeFreeroll = ["1", "true", "yes"].includes(
  String(process.env.OPS_LEAGUE_INCLUDE_FREEROLL ?? "").toLowerCase(),
);

function computePoints(event: AnalyticsEvent): number {
  const wagerRaw = event.props?.wager;
  const netRaw = event.props?.netPnL;
  const wager = typeof wagerRaw === "number" ? wagerRaw : Number(wagerRaw ?? 0);
  const netPnl = typeof netRaw === "number" ? netRaw : Number(netRaw ?? 0);

  let points: number;
  switch (leaguePointsMode) {
    case "net":
      points = Math.max(0, Math.floor(netPnl));
      break;
    case "net-abs":
      points = Math.max(0, Math.floor(Math.abs(netPnl)));
      break;
    default:
      points = Math.max(0, Math.floor(wager));
  }

  if (!Number.isFinite(points) || points <= 0) {
    points = 1;
  }

  const superRound = Boolean(event.props?.superRound ?? event.props?.super);
  if (superRound) {
    points *= 2;
  }
  return points;
}

function shouldScoreEvent(event: AnalyticsEvent): boolean {
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
}

async function updateLeagueBoard(event: AnalyticsEvent): Promise<void> {
  if (!shouldScoreEvent(event)) {
    return;
  }
  const publicKey = event.actor?.publicKey ? normalizeHex(event.actor.publicKey) : "";
  if (!publicKey) {
    return;
  }

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
}

function createReferralCode(publicKey: string, existingCodes: Record<string, { publicKey: string }>): string {
  const base = crypto.createHash("sha256").update(publicKey).digest("hex").slice(0, 8).toUpperCase();
  let code = base;
  let attempt = 0;
  while (existingCodes[code] && existingCodes[code].publicKey !== publicKey && attempt < 10) {
    attempt += 1;
    code = `${base}${attempt}`.slice(0, 10).toUpperCase();
  }
  return code;
}

const referralMinGames = Number.parseInt(process.env.OPS_REFERRAL_MIN_GAMES ?? "10", 10);
const referralMinDays = Number.parseInt(process.env.OPS_REFERRAL_MIN_DAYS ?? "3", 10);

async function updateReferralProgress(event: AnalyticsEvent): Promise<void> {
  if (!shouldScoreEvent(event)) {
    return;
  }
  const publicKey = event.actor?.publicKey ? normalizeHex(event.actor.publicKey) : "";
  if (!publicKey) {
    return;
  }

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
}

async function ingestEvents(events: AnalyticsEvent[]): Promise<void> {
  if (events.length === 0) {
    return;
  }
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
}

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

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

async function loadEventsInRange(since: number, until: number): Promise<AnalyticsEvent[]> {
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
}

function parseDateInput(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return fallback;
}

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

  const days = Array.from(actorsByDay.keys()).sort();
  const lastDay = days[days.length - 1] ?? formatDayKey(until);
  const dayToMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

  const activeUsers = new Set<string>();
  for (const set of actorsByDay.values()) {
    for (const actor of set) activeUsers.add(actor);
  }

  const wauCutoff = dayToMs(lastDay) - 6 * 86400000;
  const mauCutoff = dayToMs(lastDay) - 29 * 86400000;
  const wauActors = new Set<string>();
  const mauActors = new Set<string>();
  for (const [day, set] of actorsByDay.entries()) {
    const dayMs = dayToMs(day);
    if (dayMs >= wauCutoff) {
      for (const actor of set) wauActors.add(actor);
    }
    if (dayMs >= mauCutoff) {
      for (const actor of set) mauActors.add(actor);
    }
  }

  const dau = actorsByDay.get(lastDay)?.size ?? 0;
  const wau = wauActors.size;
  const mau = mauActors.size;

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

  const conversionRate = activeUsers.size > 0 ? converted.size / activeUsers.size : 0;
  const arpDau = dau > 0 ? revenue / dau : 0;

  res.json({
    range: { since, until },
    activeUsers: activeUsers.size,
    newUsers: Array.from(firstSeen.values()).filter((day) => dayToMs(day) >= since).length,
    dau,
    wau,
    mau,
    d7: { cohort: d7Cohort, retained: d7Retained, rate: d7Cohort ? d7Retained / d7Cohort : 0 },
    d30: { cohort: d30Cohort, retained: d30Retained, rate: d30Cohort ? d30Retained / d30Cohort : 0 },
    conversion: { converted: converted.size, rate: conversionRate },
    revenue,
    arpDau,
    events: { total: events.length, byName },
  });
});

app.get("/economy/snapshot", async (_req, res) => {
  const snapshotPath = path.join(ECONOMY_DIR, "latest.json");
  if (!fs.existsSync(snapshotPath)) {
    res.status(404).json({ error: "snapshot_not_found" });
    return;
  }
  const payload = await readJson(snapshotPath, null);
  res.json(payload);
});

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

app.get("/referrals/summary", async (req, res) => {
  const publicKey = normalizeHex(String(req.query.publicKey ?? ""));
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
  const progress = await readJson<ReferralProgressStore>(REFERRAL_PROGRESS_PATH, {
    updatedAt: Date.now(),
    players: {},
  });
  const code = referralStore.owners[publicKey] ?? null;
  const claims = Object.values(referralStore.claims).filter((c) => c.referrerPublicKey === publicKey);
  const qualified = claims.filter((c) => c.qualifiedAt);
  res.json({
    code,
    referrals: claims.length,
    qualified: qualified.length,
    progress: progress.players[publicKey] ?? null,
  });
});

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

async function resolveTokensForSegment(segment?: SegmentFilter): Promise<PushToken[]> {
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
}

async function sendExpoPush(messages: JsonRecord[]): Promise<unknown> {
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
}

async function sendPushToTokens(payload: {
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
}

app.post("/push/send", requireAdmin, async (req, res) => {
  const title = String(req.body?.title ?? "").trim();
  const body = String(req.body?.body ?? "").trim();
  if (!title || !body) {
    res.status(400).json({ error: "missing title/body" });
    return;
  }
  const tokens = Array.isArray(req.body?.tokens) ? req.body.tokens.map(String) : undefined;
  const segment = req.body?.segment as SegmentFilter | undefined;
  try {
    const result = await sendPushToTokens({ title, body, data: req.body?.data, segment, tokens });
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "push failed" });
  }
});

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

app.get("/crm/campaigns", requireAdmin, async (_req, res) => {
  const store = await readJson<CampaignStore>(CAMPAIGNS_PATH, { updatedAt: Date.now(), campaigns: [] });
  res.json(store);
});

async function processCampaigns(): Promise<void> {
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
}

setInterval(() => {
  void processCampaigns();
}, 30000);

app.listen(PORT, () => {
  console.log(`[ops] listening on :${PORT} data=${DATA_DIR}`);
});
