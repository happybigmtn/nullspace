# L01 - Gateway WS entrypoint and message routing (from scratch)

Focus file: `gateway/src/index.ts`

Goal: explain the gateway in plain language and walk most of the file. For every code excerpt, you’ll see **why it matters** and a **plain description of what the code does**. We only explain syntax when it’s truly confusing.

---

## Concepts from scratch (expanded)

### 1) Client ↔ Gateway ↔ Backend
- The **gateway** is the “front desk.” Clients connect to it, and it forwards their actions to the backend (the simulator or validators).
- The gateway **does not execute games**. It only translates client messages into on‑chain transactions and returns results.

### 2) WebSocket basics
- A WebSocket is a **two‑way pipe** that stays open. Either side can send a message at any time.
- This is essential for real‑time games because we can send events instantly (e.g., “your roll finished”).

### 3) Security boundary: Origin checks
- Browsers send an `Origin` header that tells the server which website opened the socket.
- **CORS** only affects browsers. Your server still must decide which origins to trust.
- If you do not check origin, **any website** can connect and spam your gateway.

### 4) Rate limiting and capacity limits
- The gateway enforces **per‑IP** and **global** connection limits.
- This protects you from abuse and keeps the server stable under load.

### 5) Sessions and identity
- Every connection becomes a **session** with its own Ed25519 keypair.
- That keypair is the user’s on‑chain identity for the lifetime of the session.

### 6) Nonces and transaction ordering
- A **nonce** is a counter that must increase with each transaction for a given account.
- The gateway stores nonces and persists them to disk so restarts don’t break the ordering.

### 7) Observability & operations
- The gateway logs key settings and tracks events (e.g., faucet claims).
- Health checks and graceful shutdowns are essential for reliable deployments.

---

## Limits & management callouts (important)

1) **MAX_CONNECTIONS_PER_IP (default 5)**
- Protects against one IP consuming all sockets.
- Too low will block legitimate users behind NAT. Consider increasing for production.

2) **MAX_TOTAL_SESSIONS (default 1000)**
- Hard cap on concurrent users. Must match server capacity and scaling plan.

3) **FAUCET_COOLDOWN_MS (default 60s)**
- Client‑side throttle only. If it is looser than on‑chain faucet rules, users will see confusing rejections.

4) **BALANCE_REFRESH_MS (default 60s)**
- Shorter = fresher UI, higher backend load.
- Longer = less load, more stale UI.

5) **GATEWAY_ALLOWED_ORIGINS**
- Mandatory in production. Incorrect config can block all users or allow untrusted origins.

6) **GATEWAY_EVENT_TIMEOUT_MS** (validated here, used elsewhere)
- If too short, games appear to “hang.” If too long, users wait too long on errors.

---

## Allowlist management checklist (practical)

Use this whenever you add a new client (web or mobile).

### Web app (browser)
1) Add your domain to the gateway allowlist:
```
GATEWAY_ALLOWED_ORIGINS="https://app.example.com,https://www.example.com"
GATEWAY_ALLOW_NO_ORIGIN=false
```
2) Deploy the gateway with the updated config.
3) Confirm the client’s Origin header matches exactly (scheme + host).

### Mobile app (native client)
Most native WS clients **do not send an Origin header** by default.

Preferred (more secure):
1) Configure the mobile client to send an Origin header (e.g., `https://app.example.com`).
2) Keep `GATEWAY_ALLOW_NO_ORIGIN=false`.

Fallback (only if you trust the network boundary):
1) Set:
```
GATEWAY_ALLOW_NO_ORIGIN=true
```
2) Keep `GATEWAY_ALLOWED_ORIGINS` tight for browser clients.
3) Add network‑level protections (firewall, IP allowlists, or private networking).

### Backend alignment (critical)
The gateway also sends an Origin header to the backend. Make sure backend allowlists include:
```
GATEWAY_ORIGIN
```
If not, submissions will fail even if the gateway accepts clients.

---

## Walkthrough with code excerpts

### 1) Environment mode detection
```ts
const NODE_ENV = process.env.NODE_ENV ?? 'development';
const IS_PROD = NODE_ENV === 'production';
```

Why this matters:
- Production runs need stricter validation. This flag decides how strict the gateway should be.

What this code does:
- Reads `NODE_ENV` and sets a boolean for production mode.

---

### 2) Env helpers for strings and numbers
```ts
const readStringEnv = (key: string, fallback: string, requiredInProd = false): string => {
  const raw = process.env[key]?.trim();
  if (raw) return raw;
  if (requiredInProd && IS_PROD) {
    throw new Error(`Missing required env: ${key}`);
  }
  return fallback;
};
```

Why this matters:
- Centralizes environment handling so every config value is validated the same way.

What this code does:
- Reads a string env var.
- Throws in production if required and missing.
- Returns fallback otherwise.

```ts
const parsePositiveInt = (
  key: string,
  fallback: number,
  options: { allowZero?: boolean; requiredInProd?: boolean } = {},
): number => {
  const raw = process.env[key];
  if (!raw) {
    if (options.requiredInProd && IS_PROD) {
      throw new Error(`Missing required env: ${key}`);
    }
    return fallback;
  }
  const parsed = Number(raw);
  const valid = Number.isFinite(parsed) && (options.allowZero ? parsed >= 0 : parsed > 0);
  if (!valid) {
    if (IS_PROD) {
      throw new Error(`Invalid ${key}: ${raw}`);
    }
    logWarn(`[Gateway] Invalid ${key}=${raw}; using ${fallback}`);
    return fallback;
  }
  return Math.floor(parsed);
};
```

Why this matters:
- Bad numeric env values can crash production or silently break limits. This avoids both.

What this code does:
- Reads a number from env.
- Validates it is finite and positive.
- In production, throws on invalid values; in dev, logs and uses fallback.

---

### 3) Configuration constants (limits live here)
```ts
const PORT = parsePositiveInt('GATEWAY_PORT', 9010, { requiredInProd: true });
const BACKEND_URL = readStringEnv('BACKEND_URL', 'http://localhost:8080', true);
const GATEWAY_ORIGIN = readStringEnv('GATEWAY_ORIGIN', `http://localhost:${PORT}`, true);
const GATEWAY_DATA_DIR = readStringEnv('GATEWAY_DATA_DIR', '.gateway-data', true);
const MAX_CONNECTIONS_PER_IP = parsePositiveInt('MAX_CONNECTIONS_PER_IP', 5, { requiredInProd: true });
const MAX_TOTAL_SESSIONS = parsePositiveInt('MAX_TOTAL_SESSIONS', 1000, { requiredInProd: true });
const DEFAULT_FAUCET_AMOUNT = 1000n;
const FAUCET_COOLDOWN_MS = 60_000;
const BALANCE_REFRESH_MS = parsePositiveInt('BALANCE_REFRESH_MS', 60_000);
const NONCE_PERSIST_INTERVAL_MS = parsePositiveInt(
  'GATEWAY_NONCE_PERSIST_INTERVAL_MS',
  15_000,
  { allowZero: true },
);
```

Why this matters:
- These settings control capacity, security, and performance.
- Incorrect values here can break the gateway or create security holes.

What this code does:
- Loads all important runtime settings from env with safe defaults.
- Sets sensible development defaults while enforcing strict production requirements.

---

### 4) Origin allowlist parsing
```ts
const GATEWAY_ALLOW_NO_ORIGIN = ['1', 'true', 'yes'].includes(
  String(process.env.GATEWAY_ALLOW_NO_ORIGIN ?? '').toLowerCase(),
);
const GATEWAY_ALLOWED_ORIGINS = (process.env.GATEWAY_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
```

Why this matters:
- This is the security policy for who is allowed to connect.

What this code does:
- Reads the allowlist string, splits it by commas, trims whitespace, and removes empty entries.
- Reads a flag that allows “no origin” requests if you want to support non‑browser clients.

---

### 5) Production validation
```ts
const validateProductionEnv = (): void => {
  if (!IS_PROD) return;
  parsePositiveInt('GATEWAY_SESSION_RATE_LIMIT_POINTS', 10, { requiredInProd: true });
  parsePositiveInt('GATEWAY_SESSION_RATE_LIMIT_WINDOW_MS', 60 * 60 * 1000, { requiredInProd: true });
  parsePositiveInt('GATEWAY_SESSION_RATE_LIMIT_BLOCK_MS', 60 * 60 * 1000, { requiredInProd: true });
  parsePositiveInt('GATEWAY_EVENT_TIMEOUT_MS', 30_000, { allowZero: true, requiredInProd: true });
  if (GATEWAY_ALLOWED_ORIGINS.length === 0) {
    throw new Error('GATEWAY_ALLOWED_ORIGINS must be set in production');
  }
};

validateProductionEnv();
```

Why this matters:
- Production should fail fast instead of starting with unsafe defaults.

What this code does:
- Forces required env values to exist in production.
- Ensures an allowlist is configured.

---

### 6) Core services wiring
```ts
const nonceManager = new NonceManager({ origin: GATEWAY_ORIGIN, dataDir: GATEWAY_DATA_DIR });
const submitClient = new SubmitClient(BACKEND_URL, 10_000, GATEWAY_ORIGIN);
const sessionManager = new SessionManager(submitClient, BACKEND_URL, nonceManager, GATEWAY_ORIGIN);
const connectionLimiter = new ConnectionLimiter({
  maxConnectionsPerIp: MAX_CONNECTIONS_PER_IP,
  maxTotalSessions: MAX_TOTAL_SESSIONS,
});
const handlers = createHandlerRegistry();

crapsLiveTable.configure({ submitClient, nonceManager, backendUrl: BACKEND_URL, origin: GATEWAY_ORIGIN });
```

Why this matters:
- This is where the system components are assembled. If one of these is miswired, the whole gateway fails.

What this code does:
- Creates instances of NonceManager, SubmitClient, SessionManager, ConnectionLimiter, and the handler registry.
- Configures the live‑table craps module with backend access.

---

### 7) Helper: send JSON
```ts
function send(ws: WebSocket, msg: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
```

Why this matters:
- A single helper ensures every response is serialized the same way and avoids sending on closed sockets.

What this code does:
- Converts a JS object to JSON and sends it if the socket is open.

---

### 8) Helper: send errors
```ts
function sendError(ws: WebSocket, code: string, message: string): void {
  send(ws, { type: 'error', code, message });
}
```

Why this matters:
- Clients need a consistent error format to show messages to users.

What this code does:
- Wraps error details into a standard JSON payload.

---

### 9) Message parsing
```ts
let msg: Record<string, unknown>;
try {
  msg = JSON.parse(rawData.toString());
} catch {
  sendError(ws, ErrorCodes.INVALID_MESSAGE, 'Invalid JSON');
  return;
}
```

Why this matters:
- All client traffic is JSON. If JSON is invalid, we must stop immediately.

What this code does:
- Converts raw bytes to a string and parses JSON.
- Sends an error if parsing fails.

---

### 10) System messages (ping, get_balance, faucet_claim)
```ts
if (msgType === 'ping') {
  send(ws, { type: 'pong', timestamp: Date.now() });
  return;
}
```

What this code does:
- Replies to a ping so the client can check the connection.

```ts
if (msgType === 'get_balance') {
  const session = sessionManager.getSession(ws);
  if (session) {
    await sessionManager.refreshBalance(session);
    send(ws, {
      type: 'balance',
      registered: session.registered,
      hasBalance: session.hasBalance,
      publicKey: session.publicKeyHex,
      balance: session.balance.toString(),
    });
  } else {
    sendError(ws, ErrorCodes.SESSION_EXPIRED, 'No active session');
  }
  return;
}
```

What this code does:
- Looks up the current session.
- Refreshes the balance from the backend.
- Sends a `balance` message or an error if there is no session.

```ts
if (msgType === 'faucet_claim') {
  const session = sessionManager.getSession(ws);
  if (!session) {
    sendError(ws, ErrorCodes.SESSION_EXPIRED, 'No active session');
    return;
  }

  const amountRaw = typeof msg.amount === 'number' ? msg.amount : null;
  const amount = amountRaw && amountRaw > 0 ? BigInt(Math.floor(amountRaw)) : DEFAULT_FAUCET_AMOUNT;

  const result = await sessionManager.requestFaucet(session, amount, FAUCET_COOLDOWN_MS);
  if (!result.success) {
    sendError(ws, ErrorCodes.INVALID_MESSAGE, result.error ?? 'Faucet claim failed');
    return;
  }

  await sessionManager.refreshBalance(session);
  send(ws, {
    type: 'balance',
    registered: session.registered,
    hasBalance: session.hasBalance,
    publicKey: session.publicKeyHex,
    balance: session.balance.toString(),
    message: 'FAUCET_CLAIMED',
  });
  trackGatewayFaucet(session, amount);
  return;
}
```

What this code does:
- Validates session, computes faucet amount, and calls `requestFaucet`.
- On success, refreshes balance and notifies the client.
- Tracks the faucet event for ops/analytics.

---

### 11) Schema validation and handler routing
```ts
const validation = OutboundMessageSchema.safeParse(msg);
if (!validation.success) {
  sendError(ws, ErrorCodes.INVALID_MESSAGE, 'Invalid message payload');
  return;
}

const validatedMsg = validation.data as OutboundMessage;
const validatedType = validatedMsg.type;

const session = sessionManager.getSession(ws);
if (!session) {
  sendError(ws, ErrorCodes.SESSION_EXPIRED, 'Session not found');
  return;
}

const gameType = getOutboundMessageGameType(validatedType);
if (gameType === null || gameType === undefined) {
  sendError(ws, ErrorCodes.INVALID_MESSAGE, `Unknown message type: ${validatedType}`);
  return;
}

const handler = handlers.get(gameType);
if (!handler) {
  sendError(ws, ErrorCodes.INVALID_GAME_TYPE, `No handler for game type: ${gameType}`);
  return;
}
```

Why this matters:
- This is the main **validation gate** for gameplay messages. It ensures only known, well‑formed messages reach the handlers.

What this code does:
- Validates the message schema.
- Confirms a session exists.
- Maps message type to game type.
- Looks up the corresponding handler.

---

### 12) Execute handler and respond
```ts
const ctx: HandlerContext = {
  session,
  submitClient,
  nonceManager,
  backendUrl: BACKEND_URL,
  origin: GATEWAY_ORIGIN,
};

const result = await handler.handleMessage(ctx, validatedMsg);

if (result.success) {
  if (result.response) {
    send(ws, result.response);
    trackGatewayResponse(session, result.response as Record<string, unknown>);
  }
} else if (result.error) {
  sendError(ws, result.error.code, result.error.message);
}
```

Why this matters:
- This is the **bridge point** where JSON messages become on‑chain transactions via handlers.

What this code does:
- Builds a context object the handler needs (session, nonce manager, submit client).
- Executes the handler.
- Sends back success or error responses.

---

### 13) HTTP server + WebSocket server
```ts
const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url?.split('?')[0] === '/healthz') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.statusCode = 404;
  res.end();
});

const wss = new WebSocketServer({ server });
server.listen(PORT);
```

Why this matters:
- The health check allows load balancers to know if the service is alive.
- The WebSocket server is the main entrypoint for game traffic.

What this code does:
- Builds an HTTP server with a `/healthz` route.
- Attaches a WebSocket server to it.
- Starts listening.

---

### 14) Connection handling and origin checks
```ts
wss.on('connection', async (ws: WebSocket, req) => {
  const clientIp = req.socket.remoteAddress ?? 'unknown';
  const originHeader = req.headers.origin;
  const originValue = typeof originHeader === 'string' ? originHeader : null;
  const origin = originValue === 'null' ? null : originValue;

  if (GATEWAY_ALLOWED_ORIGINS.length > 0) {
    if (!origin) {
      if (!GATEWAY_ALLOW_NO_ORIGIN) {
        logWarn('[Gateway] Connection rejected: missing origin header');
        sendError(ws, ErrorCodes.INVALID_MESSAGE, 'Origin required');
        ws.close(1008, 'Origin required');
        return;
      }
    } else if (!GATEWAY_ALLOWED_ORIGINS.includes(origin)) {
      logWarn(`[Gateway] Connection rejected: origin not allowed (${origin})`);
      sendError(ws, ErrorCodes.INVALID_MESSAGE, 'Origin not allowed');
      ws.close(1008, 'Origin not allowed');
      return;
    }
  }
```

Why this matters:
- This is the **security gate** for WebSocket connections.

What this code does:
- Reads the client IP and origin header.
- Rejects connections from disallowed origins.

---

### 15) Connection limits, session creation, and session_ready
```ts
const limitCheck = connectionLimiter.canConnect(clientIp);
if (!limitCheck.allowed) {
  logWarn(`[Gateway] Connection rejected: ${limitCheck.reason}`);
  sendError(ws, limitCheck.code ?? ErrorCodes.BACKEND_UNAVAILABLE, limitCheck.reason ?? 'Connection limit exceeded');
  ws.close(1013, limitCheck.reason); // 1013 = Try Again Later
  return;
}

const connectionId = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
connectionLimiter.registerConnection(clientIp, connectionId);

const session = await sessionManager.createSession(ws, {}, clientIp);
sessionManager.startBalanceRefresh(session, BALANCE_REFRESH_MS);

send(ws, {
  type: 'session_ready',
  sessionId: session.id,
  publicKey: session.publicKeyHex,
  registered: session.registered,
  hasBalance: session.hasBalance,
});
trackGatewaySession(session);
```

Why this matters:
- This is where a connected socket becomes a real player session.
- The `session_ready` message is the client’s “you’re in” confirmation.

What this code does:
- Enforces connection limits.
- Registers the connection and creates a session.
- Starts balance refresh.
- Sends the session handshake.

---

### 16) Message, close, and error handlers
```ts
ws.on('message', async (data: Buffer) => {
  try {
    await handleMessage(ws, data);
  } catch (err) {
    logError('[Gateway] Message handling error:', err);
    sendError(ws, ErrorCodes.BACKEND_UNAVAILABLE, err instanceof Error ? err.message : 'Internal error');
  }
});

ws.on('close', () => {
  logDebug(`[Gateway] Client disconnected: ${session.id}`);
  const destroyed = sessionManager.destroySession(ws);
  if (destroyed) {
    crapsLiveTable.removeSession(destroyed);
  }
  connectionLimiter.unregisterConnection(clientIp, connectionId);
});

ws.on('error', (err) => {
  logError(`[Gateway] WebSocket error for ${session.id}:`, err);
});
```

Why this matters:
- This keeps session lifecycle correct and prevents leaks.

What this code does:
- Routes incoming messages.
- Cleans up sessions on disconnect.
- Logs errors for diagnosis.

---

### 17) Server‑level error handling
```ts
wss.on('error', (err) => {
  logError('[Gateway] Server error:', err);
});
```

Why this matters:
- Captures crashes at the WebSocket server level.

What this code does:
- Logs any server‑level WebSocket errors.

---

### 18) Nonce persistence
```ts
const noncePersistTimer =
  NONCE_PERSIST_INTERVAL_MS > 0
    ? setInterval(() => {
        nonceManager.persist();
      }, NONCE_PERSIST_INTERVAL_MS)
    : null;
noncePersistTimer?.unref?.();
```

Why this matters:
- If the gateway restarts, nonces must not reset to zero or transactions will be rejected.

What this code does:
- Periodically saves nonce state to disk.
- Disables persistence if interval is set to 0.

---

### 19) Graceful shutdown
```ts
const shutdown = (label: string): void => {
  logInfo(`[Gateway] ${label}...`);
  nonceManager.persist();
  if (noncePersistTimer) {
    clearInterval(noncePersistTimer);
  }
  wss.close(() => {
    server.close(() => {
      logInfo('[Gateway] Server closed');
      process.exit(0);
    });
  });
};

process.on('SIGINT', () => shutdown('Shutting down'));
process.on('SIGTERM', () => shutdown('Terminating'));
```

Why this matters:
- Prevents data loss and half‑open sockets during shutdown.

What this code does:
- Saves nonces, clears timers, closes sockets, and exits cleanly on OS signals.

---

### 20) Startup restoration and logging
```ts
nonceManager.restore();

logInfo(`[Gateway] Mobile gateway listening on ws://0.0.0.0:${PORT}`);
logInfo(`[Gateway] Backend URL: ${BACKEND_URL}`);
logInfo(`[Gateway] Gateway Origin: ${GATEWAY_ORIGIN}`);
logInfo(`[Gateway] Connection limits: ${MAX_CONNECTIONS_PER_IP} per IP, ${MAX_TOTAL_SESSIONS} total`);
logInfo(`[Gateway] Registered handlers for ${handlers.size} game types`);
```

Why this matters:
- Restoring nonces prevents replay errors after a restart.
- Logging the configuration helps operators verify the deployment.

What this code does:
- Loads nonce state from disk and prints key startup diagnostics.

---

## Key takeaways
- The gateway is a **translator and gatekeeper**: it turns JSON into transactions and enforces security/limits.
- Limits and env validation are **operational safety rails**.
- Nonce persistence and graceful shutdowns make the system stable over time.

## Next lesson
L02 - Session manager and account lifecycle: `feynman/lessons/L02-session-manager.md`
