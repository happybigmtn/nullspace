# L12 - Updates WebSocket + event decoding (from scratch)

Focus files:
- `simulator/src/api/ws.rs`
- `gateway/src/backend/updates.ts`
- `gateway/src/codec/events.ts`

Goal: explain how updates are streamed over WebSocket, how clients subscribe, and how binary events are decoded. For every excerpt, you will see **why it matters** and a **plain description of what the code does**. We only explain syntax when it is genuinely tricky.

---

## Concepts from scratch (expanded)

### 1) Updates stream in plain terms
The simulator emits a stream of updates (seeds + events). Clients subscribe over WebSocket and receive binary messages containing those updates.

### 2) Filters reduce bandwidth
Clients can subscribe to:
- **All updates** (full firehose),
- **Account updates** (only events for a player),
- **Session updates** (only events for a game session).

Filters are encoded as bytes, hex‑encoded in the URL path.

### 3) Binary events and decoding
Updates are binary packets. The gateway decodes them into typed events (started/moved/completed/error and global table events). If decoding fails, the UI never sees state changes.

### 4) Backpressure and queueing
The simulator uses an outbound queue per connection. If the queue fills or sending times out, it drops or closes the connection to avoid stalling.

### 5) Origin checks for WebSocket
Browsers include an `Origin` header. The simulator validates it against allowlists to prevent untrusted pages from connecting.

---

## Limits & management callouts (important)

1) **WS send timeout = 2 seconds** (`WS_SEND_TIMEOUT`)
- If a client cannot receive within 2s, the simulator closes the connection.
- Too low = disconnects on slow clients; too high = memory growth.

2) **WS message size caps**
- `ws_max_message_bytes` is enforced at upgrade time.
- If you increase payload sizes, you must update this too.

3) **Outbound queue capacity**
- `ws_outbound_capacity()` controls the per-client queue.
- If too small, clients lag and drop updates; if too large, memory grows.

4) **Binary reader limits** (`events.ts`)
- Vec length capped at 10,000.
- String length capped at 10,000.
- Varint is rejected if shift > 35.
These prevent malformed payloads from allocating huge memory.

5) **Origin allowlist**
- If `ALLOWED_WS_ORIGINS` is empty, all browser origins are rejected.
- `ALLOW_WS_NO_ORIGIN` must be set for native clients without Origin headers.

---

## Walkthrough with code excerpts

### 1) Origin validation (simulator)
```rust
fn validate_origin(headers: &HeaderMap) -> bool {
    let allowed = std::env::var("ALLOWED_WS_ORIGINS").unwrap_or_default();
    let allow_no_origin = matches!(
        std::env::var("ALLOW_WS_NO_ORIGIN").as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE") | Ok("yes") | Ok("YES")
    );

    let origin = match headers.get(ORIGIN) {
        Some(o) => match o.to_str() {
            Ok(s) => s,
            Err(_) => {
                tracing::warn!("Invalid Origin header encoding");
                return false;
            }
        },
        None => {
            tracing::debug!("No Origin header in WebSocket request");
            return allow_no_origin;
        }
    };

    let allowed_list: Vec<&str> = allowed
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if allowed_list.contains(&"*") || allowed_list.contains(&origin) {
        return true;
    }

    tracing::warn!("WebSocket origin rejected: {} (allowed: {})", origin, allowed);
    false
}
```

Why this matters:
- Origin checks prevent hostile web pages from connecting to your backend.

What this code does:
- Reads allowed origins from env.
- If there is no Origin header, only allows it when `ALLOW_WS_NO_ORIGIN` is set.
- Accepts `*` or exact origin matches; rejects everything else.

---

### 2) Updates WebSocket upgrade (simulator)
```rust
pub(super) async fn updates_ws(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    axum::extract::Path(filter): axum::extract::Path<String>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    if !validate_origin(&headers) {
        return (StatusCode::FORBIDDEN, "Origin not allowed").into_response();
    }

    let guard = match simulator.try_acquire_ws_connection(addr.ip()) {
        Ok(guard) => guard,
        Err(reason) => {
            let message = match reason {
                WsConnectionRejection::GlobalLimit => "WebSocket connection limit reached",
                WsConnectionRejection::PerIpLimit => "WebSocket per-IP limit reached",
            };
            return (StatusCode::TOO_MANY_REQUESTS, message).into_response();
        }
    };

    let max_message_bytes = simulator.config.ws_max_message_bytes();
    ws.max_message_size(max_message_bytes)
        .max_frame_size(max_message_bytes)
        .on_upgrade(move |socket| handle_updates_ws(socket, simulator, filter, guard))
        .into_response()
}
```

Why this matters:
- This gate controls who can connect and how much they can send.

What this code does:
- Validates origin and rate limits connections (global + per-IP).
- Enforces a maximum frame size to protect memory.
- Hands off to the async handler once the WebSocket upgrades.

---

### 3) Updates handler: parse filter and subscribe
```rust
let filter = match from_hex(&filter) {
    Some(filter) => filter,
    None => {
        tracing::warn!("Failed to parse filter hex");
        return;
    }
};
let subscription = match UpdatesFilter::decode(&mut filter.as_slice()) {
    Ok(subscription) => subscription,
    Err(e) => {
        tracing::warn!("Failed to decode UpdatesFilter: {:?}", e);
        return;
    }
};

let (mut updates, _subscription_guard) =
    simulator.tracked_update_subscriber(subscription.clone());
let (out_tx, mut out_rx) = outbound_channel(simulator.config.ws_outbound_capacity());
```

Why this matters:
- The filter decides which events the client sees. If it’s wrong, you’ll get too much or too little data.

What this code does:
- Decodes the filter from hex into an `UpdatesFilter` enum.
- Creates a tracked subscription so the simulator can index updates correctly.
- Creates an outbound queue for backpressure control.

---

### 4) Updates handler: send loop + backpressure
```rust
let writer_handle = tokio::spawn(async move {
    while let Some(msg) = out_rx.recv().await {
        match timeout(WS_SEND_TIMEOUT, sender.send(msg)).await {
            Ok(Ok(())) => {}
            Ok(Err(_)) => {
                record_send_error(&writer_simulator, WsStreamKind::Updates);
                break;
            }
            Err(_) => {
                record_send_timeout(&writer_simulator, WsStreamKind::Updates);
                break;
            }
        }
    }
    let _ = sender.close().await;
});
```

Why this matters:
- Without timeouts, a slow client can block the server forever.

What this code does:
- Pulls messages off the outbound queue.
- Attempts to send them with a timeout.
- Records metrics and closes on error or timeout.

---

### 5) Updates filter to event selection
```rust
let update = match internal_update {
    InternalUpdate::Seed(seed) => {
        match &subscription {
            UpdatesFilter::Session(_) => None,
            _ => Some(EncodedUpdate::new(Update::Seed(seed))),
        }
    }
    InternalUpdate::Events(indexed) => match &subscription {
        UpdatesFilter::All => {
            indexed
                .full_update
                .clone()
                .or_else(|| {
                    Some(EncodedUpdate::new(Update::Events(
                        indexed.events.as_ref().clone(),
                    )))
                })
        }
        UpdatesFilter::Account(account) => indexed.update_for_account(account),
        UpdatesFilter::Session(session_id) => indexed.update_for_session(*session_id),
    },
};
```

Why this matters:
- This is the rule that determines which updates each client sees.

What this code does:
- Filters seeds out of session-specific subscriptions.
- For events, picks a pre‑encoded update based on the filter type.
- Falls back to full updates if a cached encoded update is missing.

---

### 6) Gateway updates filter encoding
```ts
export enum UpdatesFilterType {
  All = 0,
  Account = 1,
  Session = 2,
}

export function encodeUpdatesFilter(
  filterType: UpdatesFilterType,
  data?: Uint8Array | bigint
): string {
  let buffer: Uint8Array;

  switch (filterType) {
    case UpdatesFilterType.All:
      buffer = new Uint8Array([0]);
      break;
    case UpdatesFilterType.Account:
      if (!data || !(data instanceof Uint8Array) || data.length !== 32) {
        throw new Error('Account filter requires 32-byte public key');
      }
      buffer = new Uint8Array(1 + 32);
      buffer[0] = 1;
      buffer.set(data, 1);
      break;
    case UpdatesFilterType.Session:
      if (typeof data !== 'bigint') {
        throw new Error('Session filter requires session ID (bigint)');
      }
      buffer = new Uint8Array(1 + 8);
      buffer[0] = 2;
      const view = new DataView(buffer.buffer);
      view.setBigUint64(1, data, false); // big-endian
      break;
    default:
      throw new Error(`Unknown filter type: ${filterType}`);
  }

  return Buffer.from(buffer).toString('hex');
}
```

Why this matters:
- The URL filter must match the backend’s binary format exactly.

What this code does:
- Encodes All/Account/Session into a small byte buffer.
- Ensures account filters are 32‑byte public keys and session filters are u64 big‑endian.
- Converts the filter bytes to hex for the WebSocket URL path.

---

### 7) Gateway updates client (receive + parse)
```ts
this.ws.on('message', (data: Buffer) => {
  this.handleMessage(data);
});

private handleMessage(data: Buffer): void {
  const events = extractCasinoEvents(new Uint8Array(data));
  for (const event of events) {
    const pending = this.pendingEvents.get(event.sessionId) ?? [];
    pending.push(event);
    this.pendingEvents.set(event.sessionId, pending);
    this.emit('gameEvent', event);
  }

  const globalEvents = extractGlobalTableEvents(new Uint8Array(data));
  for (const event of globalEvents) {
    this.emit('globalTableEvent', event);
  }
}
```

Why this matters:
- This is the boundary between binary updates and app-level events.

What this code does:
- Decodes incoming binary updates into casino and global table events.
- Stores per‑session events to avoid race conditions with event waiters.
- Emits events to application listeners.

---

### 8) Binary reader with bounds checks
```ts
class BinaryReader {
  readVarint(): number {
    let result = 0;
    let shift = 0;
    while (true) {
      if (this.offset >= this.data.length) throw new Error('End of buffer reading varint');
      const byte = this.data[this.offset++];
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
      if (shift > 35) throw new Error('Varint too long');
    }
    return result;
  }

  readVec(): Uint8Array {
    const length = this.readVarint();
    if (length > 10000) {
      throw new Error(`Vec length ${length} too large (remaining=${this.remaining})`);
    }
    return this.readBytes(length);
  }
}
```

Why this matters:
- Malformed or malicious packets could otherwise allocate huge buffers or crash the client.

What this code does:
- Decodes a LEB128 varint with a hard upper bound on length.
- Enforces a maximum vector size before allocating or slicing.

---

### 9) Parsing casino events
```ts
function parseCasinoGameCompleted(reader: BinaryReader): CasinoGameEvent {
  const sessionId = reader.readU64BE();
  const player = reader.readPublicKey();
  const gameType = reader.readU8();
  const payout = reader.readI64BE();
  const finalChips = reader.readU64BE();
  const wasShielded = reader.readBool();
  const wasDoubled = reader.readBool();
  const logs = reader.readStringVecU32();
  const balanceSnapshot = reader.readPlayerBalanceSnapshot();

  return {
    type: 'completed',
    sessionId,
    player,
    gameType,
    payout,
    finalChips,
    wasShielded,
    wasDoubled,
    logs,
    balanceSnapshot,
  };
}
```

Why this matters:
- This defines how raw bytes become usable UI events.

What this code does:
- Reads fields in the exact order the Rust backend writes them.
- Returns a structured `CasinoGameEvent` object for the rest of the app.

---

### 10) Decode Update::Events vs Update::FilteredEvents
```ts
function decodeFilteredEvents(
  data: Uint8Array
): { casino: CasinoGameEvent[]; global: GlobalTableEvent[] } {
  const casino: CasinoGameEvent[] = [];
  const global: GlobalTableEvent[] = [];

  if (data.length === 0 || data[0] !== 0x02) {
    return { casino, global };
  }

  const reader = new BinaryReader(data);
  reader.readU8(); // Update::FilteredEvents tag

  skipProgress(reader);
  skipCertificate(reader);
  skipProof(reader);

  const opsLen = reader.readVarint();
  for (let i = 0; i < opsLen; i += 1) {
    reader.readU64BE(); // location
    const context = reader.readU8();
    // ... decode Output::Event and parse tag ...
  }

  return { casino, global };
}
```

Why this matters:
- Most subscriptions receive filtered events. If this parser is wrong, real-time updates disappear.

What this code does:
- Verifies the tag and skips over proof headers.
- Iterates over `events_proof_ops` and extracts only Event outputs.
- Splits results into casino vs global table events.

---

### 11) Fallback scanning (for malformed headers)
```ts
for (let i = Math.max(0, data.length - 3); i >= scanStart; i--) {
  if (data[i] === 0x05 && data[i + 1] === 0x00) {
    const eventTag = data[i + 2];
    if (
      eventTag === EVENT_TAGS.CASINO_GAME_STARTED ||
      eventTag === EVENT_TAGS.CASINO_GAME_MOVED ||
      eventTag === EVENT_TAGS.CASINO_GAME_COMPLETED ||
      eventTag === EVENT_TAGS.CASINO_ERROR
    ) {
      // ... attempt parse ...
    }
  }
}
```

Why this matters:
- Binary proofs can vary in size. This fallback rescues events when strict parsing fails.

What this code does:
- Scans the buffer for a known event signature pattern.
- Attempts to parse the event starting at that point.
- Returns the first valid event found.

---

## Key takeaways
- Updates are filtered at the simulator and decoded at the gateway.
- Origin checks and WS limits prevent abuse.
- The binary decoder enforces strict bounds to avoid crashes.

## Next lesson
L13 - Gateway register + faucet endpoints: `feynman/lessons/L13-gateway-register-faucet.md`
