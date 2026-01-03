#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const usage = () => {
  console.log(`Usage:\n  node scripts/preflight-management.mjs <service> <envFile|-> [<service> <envFile|-> ...]\n\nExamples:\n  node scripts/preflight-management.mjs gateway /etc/nullspace/gateway.env simulator /etc/nullspace/simulator.env\n  node scripts/preflight-management.mjs auth ./services/auth/.env.production.example website /etc/nullspace/website.env\n  node scripts/preflight-management.mjs gateway -`);
};

const parseEnvFile = (filePath) => {
  const raw = fs.readFileSync(filePath, 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2] ?? '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
};

const isProd = (env) => {
  const raw = String(env.NODE_ENV ?? '').toLowerCase();
  return raw === 'production' || raw === 'prod';
};

const parseIntSafe = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed);
};

const requireKeys = (env, keys, errors) => {
  for (const key of keys) {
    const value = String(env[key] ?? '').trim();
    if (!value) errors.push(`Missing ${key}`);
  }
};

const warnIf = (condition, warnings, message) => {
  if (condition) warnings.push(message);
};

const checkGateway = (env, errors, warnings) => {
  if (isProd(env)) {
    requireKeys(env, [
      'BACKEND_URL',
      'GATEWAY_ORIGIN',
      'GATEWAY_DATA_DIR',
      'GATEWAY_ALLOWED_ORIGINS',
      'MAX_CONNECTIONS_PER_IP',
      'MAX_TOTAL_SESSIONS',
      'GATEWAY_SESSION_RATE_LIMIT_POINTS',
      'GATEWAY_SESSION_RATE_LIMIT_WINDOW_MS',
      'GATEWAY_SESSION_RATE_LIMIT_BLOCK_MS',
      'GATEWAY_EVENT_TIMEOUT_MS',
    ], errors);
  }
  const maxPerIp = parseIntSafe(env.MAX_CONNECTIONS_PER_IP);
  warnIf(maxPerIp !== null && maxPerIp < 50, warnings,
    'MAX_CONNECTIONS_PER_IP looks low for NAT-heavy traffic (<50).');
};

const checkSimulator = (env, errors, warnings) => {
  if (isProd(env)) {
    requireKeys(env, [
      'ALLOWED_HTTP_ORIGINS',
      'ALLOWED_WS_ORIGINS',
      'METRICS_AUTH_TOKEN',
      'RATE_LIMIT_HTTP_PER_SEC',
      'RATE_LIMIT_HTTP_BURST',
      'RATE_LIMIT_SUBMIT_PER_MIN',
      'RATE_LIMIT_SUBMIT_BURST',
      'RATE_LIMIT_WS_CONNECTIONS',
      'RATE_LIMIT_WS_CONNECTIONS_PER_IP',
    ], errors);
  }
  const wsPerIp = parseIntSafe(env.RATE_LIMIT_WS_CONNECTIONS_PER_IP);
  warnIf(wsPerIp !== null && wsPerIp < 100, warnings,
    'RATE_LIMIT_WS_CONNECTIONS_PER_IP looks low for shared IPs (<100).');
};

const checkNode = (env, errors) => {
  if (isProd(env)) {
    requireKeys(env, ['NODE_CONFIG', 'METRICS_AUTH_TOKEN'], errors);
  }
};

const checkAuth = (env, errors, warnings) => {
  requireKeys(env, ['AUTH_ALLOWED_ORIGINS', 'CONVEX_URL', 'CONVEX_SERVICE_TOKEN', 'STRIPE_PRICE_TIERS'], errors);
  const requireMetrics = ['1', 'true', 'yes'].includes(String(env.AUTH_REQUIRE_METRICS_AUTH ?? '').toLowerCase()) || isProd(env);
  if (requireMetrics && !String(env.METRICS_AUTH_TOKEN ?? '').trim()) {
    errors.push('Missing METRICS_AUTH_TOKEN (AUTH_REQUIRE_METRICS_AUTH or production)');
  }
  const ttl = parseIntSafe(env.AUTH_CHALLENGE_TTL_MS);
  warnIf(ttl !== null && ttl > 15 * 60 * 1000, warnings,
    'AUTH_CHALLENGE_TTL_MS is > 15 minutes; consider lowering to reduce replay risk.');
};

const checkOps = (env, errors) => {
  if (isProd(env)) {
    requireKeys(env, ['OPS_DATA_DIR', 'OPS_ALLOWED_ORIGINS', 'OPS_ADMIN_TOKEN'], errors);
  }
};

const checkLiveTable = (env, errors) => {
  if (isProd(env)) {
    requireKeys(env, ['LIVE_TABLE_HOST', 'LIVE_TABLE_PORT'], errors);
  }
};

const checkWebsite = (env, errors, warnings) => {
  requireKeys(env, ['VITE_IDENTITY', 'VITE_URL', 'VITE_AUTH_URL', 'VITE_AUTH_PROXY_URL'], errors);
  const legacy = String(env.VITE_ALLOW_LEGACY_KEYS ?? '').toLowerCase();
  warnIf(['1', 'true', 'yes'].includes(legacy), warnings,
    'VITE_ALLOW_LEGACY_KEYS is enabled; keep it off in staging/production.');
  const stripeTiers = String(env.VITE_STRIPE_TIERS ?? '').trim();
  const stripePrice = String(env.VITE_STRIPE_PRICE_ID ?? '').trim();
  warnIf(!stripeTiers || !stripePrice, warnings,
    'Stripe tier config missing (VITE_STRIPE_TIERS/VITE_STRIPE_PRICE_ID). Billing UI will be disabled.');
};

const checks = {
  gateway: checkGateway,
  simulator: checkSimulator,
  node: checkNode,
  auth: checkAuth,
  ops: checkOps,
  'live-table': checkLiveTable,
  livetable: checkLiveTable,
  website: checkWebsite,
};

const args = process.argv.slice(2);
if (args.length === 0 || args.length % 2 !== 0) {
  usage();
  process.exit(args.length === 0 ? 0 : 1);
}

let hasErrors = false;
for (let i = 0; i < args.length; i += 2) {
  const service = args[i];
  const file = args[i + 1];
  const checker = checks[service];
  if (!checker) {
    console.error(`Unknown service: ${service}`);
    hasErrors = true;
    continue;
  }

  const env = file === '-' ? process.env : parseEnvFile(path.resolve(file));
  const errors = [];
  const warnings = [];
  checker(env, errors, warnings);

  if (errors.length > 0) {
    hasErrors = true;
    console.error(`\n[${service}] errors:`);
    for (const err of errors) console.error(`- ${err}`);
  }
  if (warnings.length > 0) {
    console.warn(`\n[${service}] warnings:`);
    for (const warn of warnings) console.warn(`- ${warn}`);
  }
  if (errors.length === 0 && warnings.length === 0) {
    console.log(`\n[${service}] OK`);
  }
}

process.exit(hasErrors ? 1 : 0);
