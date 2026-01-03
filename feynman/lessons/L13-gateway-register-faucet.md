# L13 - Gateway entrypoint (register + faucet paths) (from scratch)

Focus file: `gateway/src/index.ts`

Goal: explain how the gateway accepts connections, auto‑registers sessions, handles faucet claims, and routes messages to game handlers. For every excerpt, you will see **why it matters** and a **plain description of what the code does**. We only explain syntax when it is genuinely tricky.

---

## Concepts from scratch (expanded)

### 1) The gateway is the client’s front door
Clients connect to the gateway via WebSocket. The gateway:
- creates a session,
- generates keys,
- auto‑registers the player on chain,
- and forwards game actions to the backend.

### 2) Auto‑registration
When a session is created, the gateway can register the player automatically. This reduces client complexity but requires careful error handling.

### 3) Faucet claims
The gateway exposes a “faucet_claim” message that triggers an on‑chain deposit. The gateway enforces cooldowns and sends a balance update afterward.

### 4) Origin and connection limits
Connections are validated by origin allowlist and rate limits. This prevents browsers or bots from overwhelming the gateway.

---

## Limits & management callouts (important)

1) **FAUCET_COOLDOWN_MS**
- Used in `requestFaucet` to throttle claims.
- Must align with on‑chain faucet rules to avoid confusing rejections.

2) **DEFAULT_FAUCET_AMOUNT**
- Used when the client does not specify an amount.
- If this differs from backend expectations, users will see mismatched balances.

3) **Origin allowlist** (`GATEWAY_ALLOWED_ORIGINS`)
- If set, connections without origin are rejected unless `GATEWAY_ALLOW_NO_ORIGIN` is true.

4) **Connection limits**
- `MAX_CONNECTIONS_PER_IP` and `MAX_TOTAL_SESSIONS` enforce caps.
- If too low, NAT’d users are blocked; if too high, memory can spike.

---

## Walkthrough with code excerpts

### 1) Handle a faucet claim
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

Why this matters:
- Faucet claims are the first funding step for new users. If this fails, onboarding fails.

What this code does:
- Loads the current session and rejects if missing.
- Parses the requested amount (or uses a default).
- Calls `requestFaucet` with a cooldown window.
- Refreshes balance and sends a balance update back to the client.

---

### 2) WebSocket connection validation (origin + limits)
```ts
const clientIp = req.socket.remoteAddress ?? 'unknown';
const originHeader = req.headers.origin;
const originValue = typeof originHeader === 'string' ? originHeader : null;
const origin = originValue === 'null' ? null : originValue;

if (GATEWAY_ALLOWED_ORIGINS.length > 0) {
  if (!origin) {
    if (!GATEWAY_ALLOW_NO_ORIGIN) {
      sendError(ws, ErrorCodes.INVALID_MESSAGE, 'Origin required');
      ws.close(1008, 'Origin required');
      return;
    }
  } else if (!GATEWAY_ALLOWED_ORIGINS.includes(origin)) {
    sendError(ws, ErrorCodes.INVALID_MESSAGE, 'Origin not allowed');
    ws.close(1008, 'Origin not allowed');
    return;
  }
}

const limitCheck = connectionLimiter.canConnect(clientIp);
if (!limitCheck.allowed) {
  sendError(ws, limitCheck.code ?? ErrorCodes.BACKEND_UNAVAILABLE, limitCheck.reason ?? 'Connection limit exceeded');
  ws.close(1013, limitCheck.reason);
  return;
}
```

Why this matters:
- Prevents unauthorized browsers and throttles abusive clients.

What this code does:
- Reads the Origin header and enforces allowlist rules.
- Uses a connection limiter to apply per‑IP and global limits.
- Closes the socket with appropriate WebSocket close codes on rejection.

---

### 3) Create a session and auto‑register
```ts
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
- Session creation is the moment the client gets its keypair and on‑chain identity.

What this code does:
- Creates a session (which may auto‑register the player).
- Starts periodic balance refresh.
- Sends `session_ready` with identifiers so the client can proceed.

---

### 4) Message routing to handlers
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

const ctx: HandlerContext = {
  session,
  submitClient,
  nonceManager,
  backendUrl: BACKEND_URL,
  origin: GATEWAY_ORIGIN,
};

const result = await handler.handleMessage(ctx, validatedMsg);
```

Why this matters:
- This routing is the bridge between client UI and on‑chain transactions.

What this code does:
- Validates the incoming message schema.
- Fetches the session and resolves the correct game handler.
- Builds a handler context and executes the handler.

---

### 5) Cleanup on disconnect
```ts
ws.on('close', () => {
  const destroyed = sessionManager.destroySession(ws);
  if (destroyed) {
    crapsLiveTable.removeSession(destroyed);
  }
  connectionLimiter.unregisterConnection(clientIp, connectionId);
});
```

Why this matters:
- Without cleanup, sessions would leak memory and keep stale live‑table state.

What this code does:
- Destroys the session, removes it from the live table, and updates connection limits.

---

## Key takeaways
- The gateway auto‑creates sessions and can auto‑register players.
- Faucet claims are throttled and immediately reflected in balance updates.
- Origin allowlists and connection limits protect the gateway from abuse.

## Next lesson
L14 - Session registration + faucet flows: `feynman/lessons/L14-session-register-faucet.md`
