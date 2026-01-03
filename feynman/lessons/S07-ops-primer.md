# S07 - Observability + production readiness (from scratch)

Focus: (concepts)

Goal: explain the basics of observability and production readiness for this stack.

---

## Concepts from scratch (expanded)

### 1) Metrics vs logs vs traces
- **Metrics**: numeric time series (CPU, requests, errors).
- **Logs**: discrete events (errors, warnings, audit events).
- **Traces**: end-to-end timing across services.

### 2) Health checks
Health endpoints tell load balancers and monitors whether a service is alive.

### 3) Alerts
Alerts are thresholds on metrics or logs that trigger human attention.

---

## Limits & management callouts (important)

1) **Metrics should be authenticated in production**
- Exposing metrics publicly leaks internal state.

2) **Health checks must be fast**
- Health endpoints should not depend on slow downstream calls.

---

## Walkthrough with simple examples

### 1) Metrics scrape flow
```rust
prometheus -> GET /metrics -> parse -> store -> alert rules
```

Why this matters:
- Metrics drive dashboards and alerting.

What this means:
- If `/metrics` is down, you lose visibility.

---

### 2) Health check flow
```rust
load_balancer -> GET /healthz -> 200 OK
```

Why this matters:
- Load balancers route traffic only to healthy instances.

What this means:
- A failing health check removes a node from service.

---

## Key takeaways
- Observability is the foundation of reliable operations.
- Metrics, logs, and traces serve different purposes.
- Health checks and alerts must be configured before production.

## End of primers
You can now return to the main curriculum or dive into specific services.
