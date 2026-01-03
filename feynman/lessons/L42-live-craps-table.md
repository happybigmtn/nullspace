# L42 - LiveCrapsTable (off-chain gateway client) (from scratch)

Focus file: `gateway/src/live-table/craps.ts`

Goal: explain how the gateway maintains a WebSocket connection to the live-table service, sends join/bet requests, and routes results back to clients. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) What a WebSocket is
A WebSocket is a long-lived TCP connection that allows both sides to send messages at any time. Unlike HTTP, it stays open and supports real-time updates.

### 2) Request/response correlation
WebSockets are asynchronous. To match a response to a request, the client attaches a `requestId` and waits for an `ack` or `error` message with the same ID.

### 3) Live-table architecture
The live-table service runs the game loop off-chain. The gateway acts as the client, forwards player requests, and relays results back to player sessions.

---

## Limits & management callouts (important)

1) **Timeouts are short by default**
- `GATEWAY_LIVE_TABLE_TIMEOUT_MS` defaults to 5000 ms.
- Slow networks or overloaded services may cause false timeouts.

2) **Reconnect cadence defaults to 1500 ms**
- `GATEWAY_LIVE_TABLE_RECONNECT_MS` controls retry frequency.
- Too aggressive can hammer the service; too slow hurts UX.

3) **Live-table can be disabled**
- `GATEWAY_LIVE_TABLE_CRAPS` or `GATEWAY_LIVE_TABLE_CRAPS_ONCHAIN` must be set.
- If disabled, all live-table requests return errors.

---

## Walkthrough with code excerpts

### 1) Reading config and enabling live-table
```rust
const ONCHAIN = isTruthy(process.env.GATEWAY_LIVE_TABLE_CRAPS_ONCHAIN);
const ENABLED = isTruthy(process.env.GATEWAY_LIVE_TABLE_CRAPS) || ONCHAIN;

const CONFIG = {
  enabled: ENABLED,
  onchain: ONCHAIN,
  url: process.env.GATEWAY_LIVE_TABLE_CRAPS_URL ?? 'ws://127.0.0.1:9123/ws',
  requestTimeoutMs: readMs('GATEWAY_LIVE_TABLE_TIMEOUT_MS', 5000),
  reconnectMs: readMs('GATEWAY_LIVE_TABLE_RECONNECT_MS', 1500),
  backendUrl: process.env.BACKEND_URL ?? 'http://localhost:8080',
  tickMs: readMs('GATEWAY_LIVE_TABLE_TICK_MS', 1000),
  bettingMs: readMs('GATEWAY_LIVE_TABLE_BETTING_MS', 20_000),
  lockMs: readMs('GATEWAY_LIVE_TABLE_LOCK_MS', 2_000),
  payoutMs: readMs('GATEWAY_LIVE_TABLE_PAYOUT_MS', 4_000),
  cooldownMs: readMs('GATEWAY_LIVE_TABLE_COOLDOWN_MS', 4_000),
  minBet: BigInt(readInt('GATEWAY_LIVE_TABLE_MIN_BET', 5)),
  maxBet: BigInt(readInt('GATEWAY_LIVE_TABLE_MAX_BET', 1000)),
  maxBetsPerRound: readInt('GATEWAY_LIVE_TABLE_MAX_BETS_PER_ROUND', 12),
  settleBatchSize: readInt('GATEWAY_LIVE_TABLE_SETTLE_BATCH', 25),
  botBatchSize: readInt('GATEWAY_LIVE_TABLE_BOT_BATCH', 10),
  adminRetryMs: readMs('GATEWAY_LIVE_TABLE_ADMIN_RETRY_MS', 1500),
  botCount: readInt('GATEWAY_LIVE_TABLE_BOT_COUNT', IS_PROD ? 0 : 100),
  botBetMin: readInt('GATEWAY_LIVE_TABLE_BOT_BET_MIN', 5),
  botBetMax: readInt('GATEWAY_LIVE_TABLE_BOT_BET_MAX', 25),
  botBetsPerRoundMin: readInt('GATEWAY_LIVE_TABLE_BOT_BETS_MIN', 1),
  botBetsPerRoundMax: readInt('GATEWAY_LIVE_TABLE_BOT_BETS_MAX', 3),
  botParticipationRate: Math.max(0, Math.min(1, readFloat('GATEWAY_LIVE_TABLE_BOT_PARTICIPATION', 1))),
};
```

Why this matters:
- These values control live-table timing, limits, and connectivity.

Syntax notes:
- `BigInt(...)` is used because on-chain amounts are 64-bit integers.
- `??` provides a fallback when env vars are missing.

What this code does:
- Reads all live-table settings from env with sane defaults.
- Enables live-table only when configured.
- Defines core timing and bet limits used across the live-table flow.

---

### 2) Joining and leaving the live table
```rust
async join(session: Session): Promise<HandleResult> {
  if (!this.enabled) {
    return {
      success: false,
      error: createError(ErrorCodes.INVALID_MESSAGE, 'LIVE_TABLE_DISABLED'),
    };
  }

  this.sessions.set(session.id, session);

  try {
    await this.ensureConnected();
  } catch (err) {
    return {
      success: false,
      error: createError(ErrorCodes.INVALID_MESSAGE, 'LIVE_TABLE_UNAVAILABLE'),
    };
  }

  const requestId = randomUUID();
  const payload = {
    type: 'join',
    requestId,
    playerId: session.id,
    balance: session.balance.toString(),
  };

  return this.sendRequest(payload, requestId);
}
```

Why this matters:
- The join flow registers a player with the live-table service and enables real-time updates.

What this code does:
- Rejects requests when live-table is disabled.
- Tracks the session locally.
- Ensures a WebSocket connection exists.
- Sends a `join` message and waits for an ack or error.

---

### 3) Ensuring a WebSocket connection
```rust
private async ensureConnected(): Promise<void> {
  this.shouldReconnect = true;
  if (this.ws?.readyState === WebSocket.OPEN) {
    return;
  }

  if (this.connecting) {
    return this.connecting;
  }

  this.connecting = new Promise((resolve, reject) => {
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on('open', () => {
      this.connecting = null;
      resolve();
    });

    ws.on('message', (data: WebSocket.RawData) => {
      this.handleMessage(data);
    });

    ws.on('close', () => {
      this.ws = null;
      this.connecting = null;
      this.failPending('LIVE_TABLE_DISCONNECTED');
      if (this.shouldReconnect && this.sessions.size > 0) {
        this.scheduleReconnect();
      }
    });

    ws.on('error', (err) => {
      if (ws.readyState === WebSocket.CONNECTING) {
        this.connecting = null;
        reject(err);
      }
    });
  });

  return this.connecting;
}
```

Why this matters:
- A stable WebSocket is required for low-latency gameplay updates.

Syntax notes:
- `this.connecting` caches the in-flight connection promise so only one connection is created.
- `ws.on('message', ...)` registers event handlers for incoming frames.

What this code does:
- Opens a WebSocket if one is not already open.
- Registers handlers for open, message, close, and error events.
- Reconnects automatically when there are active sessions.

---

### 4) Routing inbound messages
```rust
private handleMessage(data: WebSocket.RawData): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString());
  } catch (err) {
    return;
  }

  if (!parsed || typeof parsed !== 'object') {
    return;
  }

  const message = parsed as Partial<LiveTableAck & LiveTableError & LiveTableStateEvent & LiveTableResultEvent>;

  if (message.type === 'ack' && message.requestId) {
    this.resolvePending(message.requestId, { success: true });
    return;
  }

  if (message.type === 'error' && message.requestId) {
    this.resolvePending(message.requestId, this.mapServiceError(message.code, message.message));
    return;
  }

  if (message.type === 'state' && message.payload) {
    this.handleStateEvent(message as LiveTableStateEvent);
    return;
  }

  if (message.type === 'result' && message.payload && message.playerId) {
    this.handleResultEvent(message as LiveTableResultEvent);
  }
}
```

Why this matters:
- The gateway must interpret multiple message types: acks, errors, state updates, and results.

Syntax notes:
- The `Partial<...>` cast allows checking fields safely without full type guarantees.

What this code does:
- Parses JSON frames from the WebSocket.
- Resolves pending requests for acks and errors.
- Broadcasts state updates and results to the correct sessions.

---

### 5) Sending a request with timeout
```rust
private sendRequest(payload: Record<string, unknown>, requestId: string): Promise<HandleResult> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      this.pending.delete(requestId);
      resolve({
        success: false,
        error: createError(ErrorCodes.INVALID_MESSAGE, 'LIVE_TABLE_TIMEOUT'),
      });
    }, CONFIG.requestTimeoutMs);

    this.pending.set(requestId, { resolve, timeout });
    if (!this.sendPayload(payload)) {
      clearTimeout(timeout);
      this.pending.delete(requestId);
      resolve({
        success: false,
        error: createError(ErrorCodes.INVALID_MESSAGE, 'LIVE_TABLE_UNAVAILABLE'),
      });
    }
  });
}
```

Why this matters:
- Without timeouts, client requests could hang forever if the service is down.

What this code does:
- Registers a pending request tied to a `requestId`.
- Resolves with an error if the timeout fires.
- Fails fast if the WebSocket is not connected.

---

## Key takeaways
- LiveCrapsTable is a WebSocket client that multiplexes many player sessions.
- Request IDs correlate acks/errors with specific requests.
- Configurable timeouts and reconnects control reliability and UX.

## Next lesson
L43 - Live-table service engine (off-chain): `feynman/lessons/L43-live-table-service.md`
