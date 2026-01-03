# L47 - Simulator HTTP API + rate limits (from scratch)

Focus files: `simulator/src/api/mod.rs`, `simulator/src/api/http.rs`

Goal: explain how the simulator exposes HTTP/WS endpoints, enforces origins, and applies rate limits. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) API router
The simulator is the public HTTP/WS surface for submissions, queries, and updates. It uses Axum to build a router.

### 2) CORS vs origin enforcement
CORS headers are for browsers, but the simulator also enforces an origin allowlist at the middleware layer.

### 3) Rate limits
There is a global HTTP rate limit and a stricter submit-specific rate limit. Both are configurable by env.

### 4) Metrics auth
Metrics endpoints can be protected with a bearer token so only trusted clients can read them.

---

## Limits & management callouts (important)

1) **ALLOWED_HTTP_ORIGINS empty rejects browsers**
- The router warns when `ALLOWED_HTTP_ORIGINS` is empty.
- If you forget to configure it, browser calls will be rejected.

2) **Submit rate limits are per-minute and separate**
- `RATE_LIMIT_SUBMIT_PER_MIN` and `RATE_LIMIT_SUBMIT_BURST` control /submit.
- This prevents mempool abuse without throttling read queries.

3) **Body size limits are enforced**
- `http_body_limit_bytes` can reject oversized payloads.
- This prevents large body DoS.

---

## Walkthrough with code excerpts

### 1) CORS + origin allowlist setup
```rust
let allowed_origins = parse_allowed_origins("ALLOWED_HTTP_ORIGINS");
let allow_any_origin = allowed_origins.contains("*");
let allow_no_origin = parse_allow_no_origin("ALLOW_HTTP_NO_ORIGIN");
if allowed_origins.is_empty() {
    tracing::warn!("ALLOWED_HTTP_ORIGINS is empty; all browser origins will be rejected");
}

let cors = if allow_any_origin {
    CorsLayer::new().allow_origin(AllowOrigin::any())
} else {
    CorsLayer::new().allow_origin(AllowOrigin::list(cors_origins))
}
.allow_methods([Method::GET, Method::POST, Method::OPTIONS])
.allow_headers([
    header::CONTENT_TYPE,
    header::HeaderName::from_static("x-request-id"),
])
.expose_headers([header::HeaderName::from_static("x-request-id")]);
```

Why this matters:
- Browsers will refuse cross-origin calls unless the server explicitly allows them.

What this code does:
- Parses the allowlist from env.
- Builds a CORS layer that allows only those origins (or any origin if `*`).
- Exposes the request ID header for debugging.

---

### 2) Origin enforcement middleware
```rust
async fn enforce_origin(
    config: OriginConfig,
    req: Request,
    next: Next,
) -> axum::response::Response {
    let origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok());
    if let Some(origin) = origin {
        if !config.allow_any_origin && !config.allowed_origins.contains(origin) {
            return (StatusCode::FORBIDDEN, "Origin not allowed").into_response();
        }
    } else if !config.allow_no_origin {
        return (StatusCode::FORBIDDEN, "Origin required").into_response();
    }
    next.run(req).await
}
```

Why this matters:
- CORS headers alone do not protect your server from non-browser requests.

What this code does:
- Rejects requests with missing or unapproved Origin headers.
- Allows no-origin requests only when explicitly enabled.

---

### 3) Submit-specific rate limiting
```rust
let submit_governor_conf = match (submit_rate_per_min, submit_rate_burst) {
    (Some(rate_per_minute), Some(burst_size))
        if rate_per_minute > 0 && burst_size > 0 =>
    {
        let nanos_per_request = (60_000_000_000u64 / rate_per_minute).max(1);
        let period = Duration::from_nanos(nanos_per_request);
        let config = GovernorConfigBuilder::default()
            .period(period)
            .burst_size(burst_size)
            .key_extractor(SmartIpKeyExtractor)
            .finish()
            .or_else(default_governor_config);
        config.map(Arc::new)
    }
    _ => None,
};

let submit_route = match submit_governor_conf {
    Some(config) => Router::new()
        .route("/submit", post(http::submit))
        .layer(GovernorLayer { config }),
    None => Router::new().route("/submit", post(http::submit)),
};
```

Why this matters:
- /submit is the hot path and needs stricter protection.

What this code does:
- Builds a rate limiter based on per-minute env values.
- Applies it only to the /submit route.

---

### 4) Request ID middleware + metrics counters
```rust
async fn request_id_middleware(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    req: Request,
    next: Next,
) -> Response {
    let request_id = req
        .headers()
        .get(header::HeaderName::from_static("x-request-id"))
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let start = Instant::now();
    let mut response = next.run(req).await;
    match response.status() {
        StatusCode::FORBIDDEN => simulator.http_metrics().inc_reject_origin(),
        StatusCode::PAYLOAD_TOO_LARGE => simulator.http_metrics().inc_reject_body_limit(),
        StatusCode::TOO_MANY_REQUESTS => simulator.http_metrics().inc_reject_rate_limit(),
        _ => {}
    }
    if let Ok(header_value) = HeaderValue::from_str(&request_id) {
        response.headers_mut().insert(
            header::HeaderName::from_static("x-request-id"),
            header_value,
        );
    }
    tracing::info!(
        request_id = %request_id,
        method = %method,
        path = %path,
        status = response.status().as_u16(),
        elapsed_ms = start.elapsed().as_millis() as u64,
        "http.request"
    );
    response
}
```

Why this matters:
- Request IDs make it possible to trace a single request across logs and services.

What this code does:
- Ensures every request has an `x-request-id` header.
- Records metrics for rejected requests.
- Logs request timing and status.

---

### 5) Metrics auth checks
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
- Metrics endpoints should not be public in production.

What this code does:
- Requires a bearer token or `x-metrics-token` header if the env var is set.
- Returns 401 when unauthorized.

---

## Key takeaways
- The simulator enforces both CORS and strict origin checks.
- Rate limits protect the /submit endpoint from abuse.
- Metrics endpoints can be locked behind a token.

## Next lesson
L48 - Explorer persistence worker: `feynman/lessons/L48-explorer-persistence.md`
