# L06 - Simulator /submit and HTTP API (from scratch)

Focus file: `simulator/src/api/http.rs`

Goal: explain how the simulator receives binary submissions, applies them, publishes updates, and exposes health/config/metrics/query endpoints. For every excerpt, you will see **why it matters** and a **plain description of what the code does**. We only explain syntax when it is genuinely tricky.

---

## Concepts from scratch (expanded)

### 1) What the simulator does
The simulator is the backend execution engine. It:
- receives transactions from the gateway,
- applies them to the game state,
- emits updates and events,
- and exposes metrics for ops monitoring.

If this layer is slow, misconfigured, or untrusted, the entire network feels broken to players.

### 2) HTTP handlers in Axum (Rust)
Each endpoint is a function that takes inputs (headers, body, shared state) and returns a response.
Axum lets us write these as async functions and automatically turns their return value into an HTTP response.

### 3) Raw bytes vs JSON
For `/submit`, we accept raw bytes (a binary Submission), not JSON. This keeps payloads small and fast to parse.
For config and metrics snapshots, we return JSON because humans and dashboards read it easily.

### 4) Submission decoding in plain terms
A Submission is a structured byte blob:
- it has a tag (what kind of submission it is),
- then a length-prefixed payload.

If decoding fails, the request is rejected with a 400 (Bad Request).

### 5) Proofs and certificates in this endpoint
The simulator may receive summary submissions that include:
- a progress header,
- an aggregation certificate (a group signature),
- Merkle/MMR proofs and ops.

The `log_summary_decode_stages` helper does not verify; it just tells us which decoding step failed.

### 6) Metrics in two formats
We expose metrics in two ways:
- **JSON snapshots** for internal dashboards.
- **Prometheus text format** for standard monitoring.

Both draw from the same internal counters and histograms.

### 7) Counters, gauges, histograms
- **Counters** only go up (errors, rejects, totals).
- **Gauges** go up and down (queue depth, memory).
- **Histograms** show latency distributions (fast vs slow requests).

### 8) Metric auth
Metrics can be protected by a token. If `METRICS_AUTH_TOKEN` is set, the caller must supply it.
If it is empty, metrics are public.

### 9) Latency timing
Each handler takes an `Instant::now()` timestamp at the start, and records the elapsed time at the end.
This feeds the latency histograms.

---

## Limits and management callouts (important)

1) **Metrics auth token**
- `METRICS_AUTH_TOKEN` empty means all metrics are public.
- Appropriate for local dev; not appropriate for production.

2) **Summary proof decode limits (from `types/src/api.rs`)**
- `MAX_STATE_PROOF_OPS = 3000`
- `MAX_EVENTS_PROOF_OPS = 2000`
- `MAX_STATE_PROOF_NODES = 3000`
- `MAX_EVENTS_PROOF_NODES = 2000`
These scale with `MAX_BLOCK_TRANSACTIONS` (currently 500). If you increase block size or add more ops per tx, you must revisit these or summary decoding will fail.

3) **HTTP body and submit rate limits**
- The simulator tracks `reject_body_limit` and `reject_rate_limit` metrics.
- Defaults live in `simulator/src/state.rs` (8 MB body, 100 submits/min with burst 10).
These defaults are reasonable for testnet but likely too low for load tests or production spikes.

4) **Config endpoint exposure**
- `/config` returns `simulator.config`, which can include internal URLs and paths.
- If you expose this publicly, you may leak deployment details.

5) **Query endpoints are unauthenticated**
- `/query_state` and `/query_seed` do not require auth in this file.
- If public, add rate limits or cache to prevent scraping and DoS.

---

## Walkthrough with code excerpts

### 1) Type aliases used in summary decode
```rust
type AggregationScheme = bls12381_threshold::Scheme<PublicKey, MinSig>;
type AggregationCertificate = Certificate<AggregationScheme, Digest>;
type StateOp = variable::Operation<Digest, Value>;
type EventOp = keyless::Operation<Output>;
```

Why this matters:
- These types describe the exact structure of summary submissions. If we decode with the wrong type, every summary will fail.

What this code does:
- Creates short type aliases for complex generic types so the decode logic is readable.
- Ties each alias to the exact cryptography and storage types used by the summary format.
- Lets later decode code stay focused on the steps rather than unreadable type noise.

Syntax notes (only the tricky part):
- `type Alias = ...;` is just a name for a long type. It does not create a new type; it is a shorthand.

---

### 2) Health check and config endpoints
```rust
#[derive(Serialize)]
struct HealthzResponse {
    ok: bool,
}

pub(super) async fn healthz() -> Response {
    Json(HealthzResponse { ok: true }).into_response()
}

pub(super) async fn config(AxumState(simulator): AxumState<Arc<Simulator>>) -> Response {
    Json(simulator.config.clone()).into_response()
}
```

Why this matters:
- `/healthz` is how load balancers decide if the simulator is alive.
- `/config` is how you inspect runtime settings without SSHing into the box.

What this code does:
- Returns `{ ok: true }` for health checks.
- Uses Axum’s JSON wrapper to serialize the struct into a response body.
- Returns a JSON copy of the simulator config for debugging, cloning it to avoid borrow issues.

Syntax notes:
- `AxumState(simulator): AxumState<Arc<Simulator>>` destructures the extractor so we get `simulator` directly.
- `pub(super)` means the function is public within the current module tree, not globally.

---

### 3) Metrics endpoints (JSON snapshots)
```rust
pub(super) async fn ws_metrics(
    headers: HeaderMap,
    AxumState(simulator): AxumState<Arc<Simulator>>,
) -> Response {
    if let Some(status) = metrics_auth_error(&headers) {
        return status.into_response();
    }
    Json(simulator.ws_metrics_snapshot()).into_response()
}
```

Why this matters:
- These endpoints are your live dashboard feed. If they fail, you lose operational visibility.

What this code does:
- Checks metrics auth. If unauthorized, returns 401.
- Otherwise returns a JSON snapshot of current WebSocket metrics.
- Mirrors the same pattern for HTTP/system/explorer/update metrics in sibling handlers.

Syntax notes:
- `if let Some(status) = ...` is Rust's way to handle an optional value without a full `match`.

---

### 4) Prometheus metrics endpoint
```rust
pub(super) async fn prometheus_metrics(
    headers: HeaderMap,
    AxumState(simulator): AxumState<Arc<Simulator>>,
) -> Response {
    if let Some(status) = metrics_auth_error(&headers) {
        return status.into_response();
    }
    let body = render_prometheus_metrics(&simulator);
    (
        StatusCode::OK,
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/plain; version=0.0.4"),
        )],
        body,
    )
        .into_response()
}
```

Why this matters:
- Prometheus expects a very specific plain-text format. Without this endpoint, standard monitoring breaks.

What this code does:
- Rejects unauthorized requests.
- Renders all metrics to a single text blob in Prometheus format.
- Returns a response with the correct content-type so Prometheus can parse it.

Syntax notes:
- Returning a tuple `(StatusCode, headers, body)` is an Axum shortcut. Axum knows how to turn it into a response.

---

### 5) Metrics auth gate
```rust
fn metrics_auth_error(headers: &HeaderMap) -> Option<StatusCode> {
    let token = std::env::var("METRICS_AUTH_TOKEN").unwrap_or_default();
    if token.is_empty() {
        return None;
    }
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::to_string);
    let header_token = headers
        .get("x-metrics-token")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    if bearer.as_deref() == Some(token.as_str()) || header_token.as_deref() == Some(token.as_str()) {
        None
    } else {
        Some(StatusCode::UNAUTHORIZED)
    }
}
```

Why this matters:
- Metrics can reveal sensitive operational info. This is the only protection layer for those endpoints.

What this code does:
- If `METRICS_AUTH_TOKEN` is empty, metrics are open.
- Otherwise it checks either:
  - `Authorization: Bearer <token>` or
  - `x-metrics-token: <token>`
- Accepts either header as valid and denies all others.
- Returns 401 if neither header matches.

Syntax notes:
- `and_then` chains fallible steps without nested `match` blocks.
- `as_deref()` turns `Option<String>` into `Option<&str>` for easy comparison.

---

### 6) Prometheus renderer + helpers
```rust
fn render_prometheus_metrics(simulator: &Simulator) -> String {
    let ws = simulator.ws_metrics_snapshot();
    let http = simulator.http_metrics_snapshot();
    let system = simulator.system_metrics_snapshot();
    let explorer = simulator.explorer_metrics_snapshot();
    let updates = simulator.update_index_metrics_snapshot();

    let mut out = String::new();

    append_histogram(
        &mut out,
        "nullspace_simulator_http_submit_latency_ms",
        &http.submit,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_http_reject_origin_total",
        http.reject_origin,
    );
    append_gauge(
        &mut out,
        "nullspace_simulator_system_rss_bytes",
        system.rss_bytes,
    );
    // ... dozens more metrics appended ...

    out
}
```

Why this matters:
- This maps internal counters to exported metric names. If a name changes, dashboards break.

What this code does:
- Pulls all metric snapshots (ws/http/system/explorer/update index).
- Appends them to a single Prometheus-formatted string with stable metric names.
- Uses helper functions so counters, gauges, and histograms are encoded consistently.

Syntax notes:
- `let mut out = String::new();` creates a mutable string that we append to in place.

---

### 7) Histogram formatting
```rust
fn append_histogram(out: &mut String, name: &str, snapshot: &LatencySnapshot) {
    let _ = writeln!(out, "# TYPE {name} histogram");
    let mut cumulative = 0u64;
    for (bucket, count) in snapshot.buckets_ms.iter().zip(snapshot.counts.iter()) {
        cumulative = cumulative.saturating_add(*count);
        let _ = writeln!(out, "{name}_bucket{{le=\"{bucket}\"}} {cumulative}");
    }
    cumulative = cumulative.saturating_add(snapshot.overflow);
    let _ = writeln!(out, "{name}_bucket{{le=\"+Inf\"}} {cumulative}");
    let _ = writeln!(out, "{name}_count {}", snapshot.count);
    let sum = snapshot.avg_ms * snapshot.count as f64;
    let _ = writeln!(out, "{name}_sum {sum}");
}
```

Why this matters:
- Latency histograms are how you detect slowdowns before they become outages.

What this code does:
- Writes the Prometheus histogram format: bucket counts, total count, and total sum.
- Uses cumulative counts so each bucket includes all faster latencies.
- Adds the `+Inf` bucket and computes `_sum` using average * count.

Syntax notes:
- `let _ = writeln!(...)` ignores formatting errors. This is intentional because writing to a `String` should not fail.
- `saturating_add` avoids overflow if counters are very large.

---

### 8) Submission decode helper (debug-only stages)
```rust
fn log_summary_decode_stages(bytes: &[u8]) {
    if bytes.is_empty() {
        tracing::warn!("Empty submission body");
        return;
    }
    if bytes[0] != 2 {
        return;
    }

    let mut reader = &bytes[1..];
    let progress = match Progress::read(&mut reader) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("Summary decode failed at progress: {:?}", e);
            return;
        }
    };

    if let Err(e) = AggregationCertificate::read(&mut reader) {
        tracing::warn!(view = progress.view, height = progress.height, "Summary decode failed at certificate: {:?}", e);
        return;
    }

    if let Err(e) = Proof::<Digest>::read_cfg(&mut reader, &nullspace_types::api::MAX_STATE_PROOF_NODES) {
        tracing::warn!(view = progress.view, height = progress.height, "Summary decode failed at state_proof: {:?}", e);
        return;
    }
    // ... decode state ops, events proof, events ops ...
}
```

Why this matters:
- When a submission fails to decode, you need to know *where* it failed. This function provides that forensic trail.

What this code does:
- Checks the tag byte and only proceeds if it looks like a summary submission (tag `2`).
- Attempts to decode each stage one by one: progress, certificate, state proof, state ops, events proof, events ops.
- Logs the exact stage that failed so operators can pinpoint malformed payloads.
- Does not verify cryptographic validity; it only tests whether decoding can succeed.

Syntax notes:
- `&bytes[1..]` creates a slice that skips the tag byte.
- `Progress::read(&mut reader)` consumes bytes from the slice as it decodes.

---

### 9) The main /submit handler
```rust
pub(super) async fn submit(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    body: Bytes,
) -> impl IntoResponse {
    let start = Instant::now();
    let status = match Submission::decode(&mut body.as_ref()) {
        Ok(submission) => match apply_submission(Arc::clone(&simulator), submission, true).await {
            Ok(()) => {
                simulator.publish_submission(body.as_ref()).await;
                StatusCode::OK
            }
            Err(_) => StatusCode::BAD_REQUEST,
        },
        Err(e) => {
            let preview_len = std::cmp::min(32, body.len());
            log_summary_decode_stages(body.as_ref());
            tracing::warn!(
                len = body.len(),
                head = %commonware_utils::hex(&body[..preview_len]),
                "Failed to decode submission: {:?}",
                e
            );
            StatusCode::BAD_REQUEST
        }
    };

    simulator.http_metrics().record_submit(start.elapsed());
    status
}
```

Why this matters:
- This is the critical gate for every transaction. If it is wrong, the chain never advances.

What this code does:
- Tries to decode the raw request body into a `Submission`.
- If decoding works, it applies the submission to the simulator state.
- On success, it publishes the raw bytes for downstream consumers (fanout/indexers).
- On decode failure, logs a short hex preview and attempts the staged summary decoder.
- Records latency and returns 200 or 400 based on the outcome.

Syntax notes:
- `body: Bytes` gives you the raw request payload without extra copies.
- `impl IntoResponse` means "anything Axum can turn into a response".

---

### 10) Query state by key
```rust
pub(super) async fn query_state(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    axum::extract::Path(query): axum::extract::Path<String>,
) -> impl IntoResponse {
    let start = Instant::now();
    let response = match from_hex(&query) {
        Some(raw) => match Digest::decode(&mut raw.as_slice()) {
            Ok(key) => match simulator.query_state(&key).await {
                Some(value) => (StatusCode::OK, value.encode().to_vec()).into_response(),
                None => (StatusCode::NOT_FOUND, vec![]).into_response(),
            },
            Err(_) => StatusCode::BAD_REQUEST.into_response(),
        },
        None => StatusCode::BAD_REQUEST.into_response(),
    };

    simulator.http_metrics().record_query_state(start.elapsed());
    response
}
```

Why this matters:
- This endpoint is used by clients and tools to fetch current on-chain values.

What this code does:
- Parses a hex string into a Digest key.
- Queries the simulator state store for the latest value.
- Returns 200 with encoded bytes, 404 if missing, or 400 for bad input.
- Records latency for query performance tracking.

Syntax notes:
- `axum::extract::Path(query)` pulls the URL path segment into a variable.

---

### 11) Query seed
```rust
pub(super) async fn query_seed(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    axum::extract::Path(query): axum::extract::Path<String>,
) -> impl IntoResponse {
    let start = Instant::now();
    let response = match from_hex(&query) {
        Some(raw) => match ChainQuery::decode(&mut raw.as_slice()) {
            Ok(query) => match simulator.query_seed(&query).await {
                Some(seed) => (StatusCode::OK, seed.encode().to_vec()).into_response(),
                None => (StatusCode::NOT_FOUND, vec![]).into_response(),
            },
            Err(_) => StatusCode::BAD_REQUEST.into_response(),
        },
        None => StatusCode::BAD_REQUEST.into_response(),
    };

    simulator.http_metrics().record_query_seed(start.elapsed());
    response
}
```

Why this matters:
- Seeds drive randomness in games. This endpoint is how clients verify that randomness.

What this code does:
- Parses a hex-encoded query (latest or index).
- Decodes the query into a `ChainQuery` enum.
- Looks up the seed in the simulator and returns encoded bytes if found.
- Records latency for seed query performance tracking.

---

## Key takeaways
- `/submit` is the critical path: decode -> apply -> publish -> record latency.
- Metrics are available both as JSON and Prometheus, with optional token auth.
- Query endpoints are unauthenticated and should be rate-limited or cached in production.

## Next lesson
L07 - Simulator submission internals: `feynman/lessons/L07-simulator-submission.md`
