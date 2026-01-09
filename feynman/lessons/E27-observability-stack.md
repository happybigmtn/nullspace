# E27 - Observability stack: distributed tracing, metrics, and log correlation

Focus files:
- `docker/observability/docker-compose.yml`
- `docker/observability/tempo.yml`
- `docker/observability/grafana/provisioning/datasources/datasource.yml`
- `gateway/src/telemetry.ts`
- `services/auth/src/telemetry.ts`

Goal: explain how the Nullspace observability stack enables distributed tracing with OpenTelemetry, how traces flow from services through Tempo to Grafana, how RED metrics are derived from traces, and how trace-to-logs correlation connects Tempo and Loki. This is a complete walkthrough of the tracing infrastructure and how to use it for debugging production issues.

---

## Learning objectives

After this lesson you should be able to:

1) Explain how OpenTelemetry traces flow from services to Tempo and Grafana.
2) Describe W3C Trace Context propagation and why it matters for distributed tracing.
3) Understand how Tempo's metrics generator creates RED metrics from trace data.
4) Trace the complete path from a service span to a Grafana dashboard visualization.
5) Use trace-to-logs correlation to jump from a trace to related log lines in Loki.
6) Debug performance issues using distributed traces and span attributes.

---

## 1) The observability stack overview (architecture first)

Before diving into configuration files, you need to understand the complete observability architecture and how the pieces fit together.

### 1.1 Four layers of observability

The Nullspace observability stack has four distinct layers:

- **Application instrumentation**: OpenTelemetry SDKs in gateway and auth services create spans.
- **Trace collection**: Tempo receives traces via OTLP (OpenTelemetry Protocol) and stores them.
- **Metrics derivation**: Tempo's metrics generator creates RED metrics from spans and pushes to Prometheus.
- **Visualization**: Grafana connects all data sources and enables correlation between traces, metrics, and logs.

This separation means traces are the source of truth, and metrics are derived from them. This is the opposite of traditional monitoring where metrics and traces are independent.

### 1.2 Why distributed tracing matters

A single user action (like starting a game) triggers a cascade of operations:

1) Gateway receives WebSocket message
2) Gateway authenticates with auth service
3) Gateway validates game state
4) Gateway returns result to client

Without distributed tracing, you see four separate events in logs. With tracing, you see one **trace** with four **spans** that are causally linked. The trace ID ties them together so you can see the complete timeline and where time was spent.

### 1.3 The three signals (and why they must connect)

OpenTelemetry defines three observability signals:

- **Traces**: show request flow across services (causal relationships)
- **Metrics**: show aggregated numbers over time (trends and alerts)
- **Logs**: show discrete events (debugging specific failures)

The power comes from **correlation**: clicking a metric spike shows traces, clicking a trace shows logs. The Nullspace stack implements this three-way correlation.

---

## 2) OpenTelemetry distributed tracing in services

The first step is instrumenting services to create and export traces.

### 2.1 Auth service telemetry setup (`services/auth/src/telemetry.ts`)

The auth service demonstrates a complete OpenTelemetry setup:

```ts
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();

if (endpoint) {
  const resource = new Resource({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: DEPLOYMENT_ENV,
  });

  const sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({ url: endpoint }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-express': { enabled: true },
        '@opentelemetry/instrumentation-http': { enabled: true },
      }),
    ],
  });

  sdk.start();
}
```

Walkthrough:

1) Read `OTEL_EXPORTER_OTLP_ENDPOINT` - if absent, telemetry is disabled (safe by default).
2) Create a `Resource` with service name, version, and environment - these become trace attributes.
3) Configure `OTLPTraceExporter` to send traces to Tempo's HTTP endpoint.
4) Enable auto-instrumentation for Express and HTTP, disable noisy instrumentation (filesystem, DNS).
5) Start the SDK immediately so early requests are traced.

The critical insight: **telemetry is opt-in via environment variable**. In development, traces are no-ops. In production, set `OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo:4318/v1/traces` and tracing activates.

### 2.2 W3C Trace Context propagation

The auth service configures W3C Trace Context propagation:

```ts
propagation.setGlobalPropagator(new W3CTraceContextPropagator());
```

This enables cross-service trace correlation. When the gateway calls the auth service, it sends a `traceparent` header:

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

Format: `version-traceId-spanId-flags`

The auth service extracts this header and creates child spans with the same trace ID. This links all operations in a single request across services. Without W3C Trace Context, every service would start a new trace and you would lose causal relationships.

### 2.3 Manual span creation with `withSpan`

Auto-instrumentation handles HTTP requests, but business logic needs manual spans:

```ts
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      if (attributes) {
        for (const [key, value] of Object.entries(attributes)) {
          span.setAttribute(key, value);
        }
      }
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  });
}
```

This helper:

1) Starts an active span (becomes parent for nested spans)
2) Sets initial attributes (operation context)
3) Executes the function
4) On success: marks span as OK
5) On error: records exception and marks span as ERROR
6) Always ends the span (prevents leaks)

The gateway uses this to trace game operations:

```ts
await withSpan(`gateway.${msgType}`, async (span) => {
  addSpanAttributes(span, {
    'message.type': msgType,
    'message.size_bytes': rawData.length,
    'trace.id': traceId,
  });
  // ... handle message
});
```

Span attributes are key-value pairs that make traces searchable. You can filter traces by `message.type=start_game` or `game.type=plinko`.

### 2.4 Trace context extraction and propagation

The auth service provides helpers to extract and propagate trace context:

```ts
export function extractTraceContext(
  headers: Record<string, string | string[] | undefined>,
): { traceId: string; spanId: string } | null {
  const traceparent = headers['traceparent'];
  if (!traceparent || typeof traceparent !== 'string') {
    return null;
  }

  const parts = traceparent.split('-');
  if (parts.length !== 4) {
    return null;
  }

  const [_version, traceId, spanId] = parts;
  return { traceId, spanId };
}
```

This parses the W3C `traceparent` header and extracts the trace ID. The gateway uses this to log the trace ID alongside errors, making it easy to find the corresponding trace in Grafana.

```ts
export function getTraceContext(): { traceId: string; spanId: string; traceparent: string } | null {
  const span = trace.getActiveSpan();
  if (!span) return null;

  const ctx = span.spanContext();
  const traceparent = `00-${ctx.traceId}-${ctx.spanId}-01`;
  return {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    traceparent,
  };
}
```

This gets the current trace context and formats a `traceparent` header for outgoing requests. This is how the gateway propagates trace context when calling the auth service or simulator.

---

## 3) Tempo: distributed trace storage and OTLP receivers

Tempo is the backend that receives, stores, and serves traces.

### 3.1 Tempo OTLP receivers (`docker/observability/tempo.yml`)

Tempo exposes two OTLP receivers:

```yaml
distributor:
  receivers:
    otlp:
      protocols:
        grpc:
          endpoint: 0.0.0.0:4317
        http:
          endpoint: 0.0.0.0:4318
```

- **gRPC (port 4317)**: binary protocol, lower overhead, preferred for production
- **HTTP (port 4318)**: JSON payload, easier debugging, used by Node.js OTLP exporter

Services send traces to `http://tempo:4318/v1/traces` (the HTTP endpoint). Tempo's distributor receives the batch and writes to storage.

### 3.2 Trace storage and retention

Tempo stores traces in local filesystem for single-node deployments:

```yaml
storage:
  trace:
    backend: local
    local:
      path: /tmp/tempo/blocks
    wal:
      path: /tmp/tempo/wal

compactor:
  compaction:
    block_retention: 336h  # 14 days
```

Traces are written to a write-ahead log (WAL) and then compacted into blocks. Blocks are retained for 14 days. After 14 days, traces are deleted to manage disk usage.

The WAL ensures durability: if Tempo crashes, traces in the WAL are recovered on restart. Blocks are immutable and optimized for range queries.

### 3.3 Metrics generator: RED metrics from traces

This is where Tempo becomes more than a trace store:

```yaml
metrics_generator:
  registry:
    external_labels:
      source: tempo
  storage:
    path: /tmp/tempo/generator/wal
    remote_write:
      - url: http://prometheus:9090/api/v1/write
        send_exemplars: true

overrides:
  defaults:
    metrics_generator:
      processors: [service-graphs, span-metrics]
```

The metrics generator processes every trace and creates metrics:

- **span-metrics**: `traces_spanmetrics_calls_total` (request rate), `traces_spanmetrics_latency_bucket` (latency histogram)
- **service-graphs**: `traces_service_graph_request_total` (service-to-service request rates)

These metrics are sent to Prometheus via remote write. The key is `send_exemplars: true`: exemplars link metrics back to trace IDs, enabling metric-to-trace correlation.

This means every RED metric (Rate, Error, Duration) is automatically generated from traces. You do not need to instrument metrics separately.

---

## 4) Grafana dashboards and RED metrics pattern

Grafana visualizes traces and trace-derived metrics.

### 4.1 RED metrics from trace-derived metrics

The Nullspace Traces dashboard (`docker/observability/grafana/dashboards/nullspace-traces.json`) uses trace-derived metrics for RED:

**Request Rate (Rate):**

```promql
sum(rate(traces_spanmetrics_calls_total[5m])) by (service)
```

This counts spans per second, grouped by service. Every span represents one operation, so this is the request rate.

**Error Rate (Errors):**

```promql
sum(rate(traces_spanmetrics_calls_total{status_code="STATUS_CODE_ERROR"}[5m])) by (span_name)
/
sum(rate(traces_spanmetrics_calls_total[5m])) by (span_name)
```

This divides error spans by total spans to get error percentage. Spans with `status_code="STATUS_CODE_ERROR"` are marked by `withSpan` when exceptions are caught.

**Duration (P99 Latency):**

```promql
histogram_quantile(0.99, sum(rate(traces_spanmetrics_latency_bucket[5m])) by (le, service))
```

Tempo generates latency histograms from span durations. This query computes the 99th percentile latency per service.

The insight: **you instrument once (traces), get metrics for free**. This reduces instrumentation overhead and ensures metrics are always consistent with traces.

### 4.2 Gateway-specific dashboards

The Gateway dashboard (`docker/observability/grafana/dashboards/nullspace-gateway.json`) shows operation-level RED metrics:

**Message Rate by Type:**

```promql
rate(gateway_messages_total[5m])
```

This uses application-specific metrics from the gateway. These are manually instrumented counters, not trace-derived. This shows that trace-derived metrics complement (not replace) application metrics.

**P95 Message Latency:**

```promql
histogram_quantile(0.95, sum(rate(gateway_message_latency_ms_bucket[5m])) by (le))
```

This uses a manually instrumented histogram. The gateway measures message handling time and exports it as a Prometheus histogram.

The pattern: **use trace-derived metrics for service-level RED, use application metrics for domain-specific insights** (like game type, message type, rate limit hits).

### 4.3 Trace search and filtering

The Traces dashboard includes a trace search panel using Tempo's TraceQL:

```yaml
queryType: traceql
filters:
  - id: service-name
    tag: service.name
  - id: span-name
    tag: name
```

You can filter traces by:

- Service name (`service.name="nullspace-gateway"`)
- Span name (`name="gateway.start_game"`)
- Custom attributes (`game.type="plinko"`)
- Trace ID (paste from logs or metrics)

This is how you go from "latency is high" to "here are the slow traces" to "this trace shows the auth call took 2 seconds".

---

## 5) Trace-to-logs correlation between Tempo and Loki

This is the most powerful feature: clicking a trace shows related logs.

### 5.1 Grafana datasource configuration

The datasource config (`docker/observability/grafana/provisioning/datasources/datasource.yml`) connects Tempo and Loki:

```yaml
- name: Tempo
  type: tempo
  jsonData:
    tracesToLogs:
      datasourceUid: loki
      tags: ['service.name', 'game.type']
      spanStartTimeShift: '-1h'
      spanEndTimeShift: '1h'
      filterByTraceID: true
      filterBySpanID: false
      lokiSearch: true
```

Walkthrough:

- `datasourceUid: loki`: link to Loki datasource
- `tags: ['service.name', 'game.type']`: extract these span attributes as Loki labels
- `spanStartTimeShift: '-1h'`: show logs from 1 hour before span start (catches setup logs)
- `spanEndTimeShift: '1h'`: show logs up to 1 hour after span end (catches cleanup logs)
- `filterByTraceID: true`: automatically filter Loki logs by trace ID
- `lokiSearch: true`: enable the "Logs for this trace" button

When you click "Logs for this trace" in Grafana, it queries Loki:

```logql
{service_name="nullspace-gateway"} |~ "4bf92f3577b34da6a3ce929d0e0e4736"
```

This finds all logs from the gateway service containing the trace ID. If your logs include trace IDs (via `getTraceContext()`), they are automatically correlated.

### 5.2 Loki-to-Tempo correlation (reverse direction)

The Loki datasource also links back to Tempo:

```yaml
- name: Loki
  type: loki
  jsonData:
    derivedFields:
      - datasourceUid: tempo
        matcherRegex: '"traceId":"([a-f0-9]+)"'
        name: TraceID
        url: '$${__value.raw}'
        urlDisplayLabel: View Trace
```

If a log line contains `"traceId":"abc123..."`, Grafana extracts the trace ID and shows a "View Trace" link. Clicking it opens the trace in Tempo.

This bidirectional linking means:

- Trace → Logs: "show me logs for this slow trace"
- Logs → Trace: "this error log mentions a trace ID, show me the full trace"

### 5.3 How to log trace IDs for correlation

For trace-to-logs correlation to work, logs must include trace IDs. The gateway does this:

```ts
const traceContext = getTraceContext();
if (error) {
  console.error(`[error] Failed to handle message: ${error.message}`, {
    traceId: traceContext?.traceId,
    msgType,
  });
}
```

This logs a JSON object with `traceId`. Promtail scrapes logs and sends to Loki with the trace ID in the log line. Grafana's `matcherRegex` extracts it.

The pattern is simple: **always log trace IDs with errors**. This makes debugging trivial: find the error log, click "View Trace", see the complete request timeline.

---

## 6) Trace-to-metrics correlation (exemplars)

Tempo also links to Prometheus via exemplars.

### 6.1 What are exemplars?

An **exemplar** is a sample trace ID attached to a metric. When Tempo generates `traces_spanmetrics_calls_total`, it includes exemplars:

```
traces_spanmetrics_calls_total{service="nullspace-gateway"} 1000 # {trace_id="abc123"} 15 1234567890
```

This says: "at timestamp 1234567890, the counter value was 1000, and an example trace is abc123 with value 15".

Grafana shows exemplars as dots on metric graphs. Clicking a dot jumps to that trace. This is how you go from "error rate spiked at 2:30pm" to "here is an example trace from that spike".

### 6.2 Tempo datasource configuration for exemplars

The datasource config enables metric-to-trace linking:

```yaml
- name: Prometheus
  type: prometheus
  jsonData:
    exemplarTraceIdDestinations:
      - name: traceID
        datasourceUid: tempo
```

This tells Grafana: "when you see an exemplar in Prometheus, the trace ID links to Tempo".

The complete flow:

1) Service creates span
2) Tempo generates metric with exemplar
3) Prometheus stores metric + exemplar
4) Grafana shows metric graph with exemplar dots
5) Click dot → jump to trace

### 6.3 Trace-to-metrics queries

The Tempo datasource also links traces to metrics:

```yaml
tracesToMetrics:
  datasourceUid: prometheus
  queries:
    - name: Request rate
      query: 'sum(rate(traces_spanmetrics_calls_total{$$__tags}[5m]))'
    - name: Error rate
      query: 'sum(rate(traces_spanmetrics_calls_total{status_code="STATUS_CODE_ERROR",$$__tags}[5m]))'
    - name: P99 latency
      query: 'histogram_quantile(0.99, sum(rate(traces_spanmetrics_latency_bucket{$$__tags}[5m])) by (le))'
```

When viewing a trace, Grafana shows a "Related metrics" panel. The `$$__tags` placeholder is replaced with span attributes (like `service="nullspace-gateway"`), so you see metrics for that specific service or operation.

This completes the three-way correlation:

- Metrics → Traces (via exemplars)
- Traces → Metrics (via related metrics panel)
- Traces ↔ Logs (via trace IDs)

---

## 7) Observability stack deployment

The docker-compose file (`docker/observability/docker-compose.yml`) orchestrates all components.

### 7.1 Component dependencies

```yaml
tempo:
  depends_on:
    - prometheus

grafana:
  depends_on:
    - prometheus
    - loki
    - tempo
```

Tempo depends on Prometheus (for remote write). Grafana depends on all three data sources. This ensures startup order: Prometheus and Loki start first, then Tempo, then Grafana.

### 7.2 Tempo ports

```yaml
tempo:
  ports:
    - "3200:3200"   # Tempo HTTP API
    - "4317:4317"   # OTLP gRPC receiver
    - "4318:4318"   # OTLP HTTP receiver
```

Services send traces to `4318` (OTLP HTTP). Grafana queries traces via `3200` (Tempo API). The gRPC receiver (`4317`) is unused but exposed for future high-throughput scenarios.

### 7.3 Grafana feature toggles

```yaml
grafana:
  environment:
    - GF_FEATURE_TOGGLES_ENABLE=traceToLogs,traceToMetrics
```

These feature toggles enable the trace correlation features. Without them, the "Logs for this trace" and "Related metrics" buttons would not appear.

### 7.4 Log collection with Promtail

```yaml
promtail:
  volumes:
    - ../..:/var/log/nullspace:ro
  depends_on:
    - loki
```

Promtail mounts the repository root and scrapes `*.log` files (configured in `promtail.yml`). It sends logs to Loki for storage and querying.

This means services just write logs to files. Promtail handles collection and forwarding. This decouples log generation from log storage.

---

## 8) How to use traces for debugging (real-world workflow)

Here is how you use the observability stack to debug a production issue.

### 8.1 Workflow: high latency investigation

**Step 1: Detect the issue in RED metrics**

Open the Gateway dashboard. See P99 latency spike from 50ms to 500ms at 3:15pm.

**Step 2: Find example traces**

Open the Traces dashboard. Filter by `service.name="nullspace-gateway"` and time range 3:10pm - 3:20pm. Sort by duration (slowest first). Click a slow trace.

**Step 3: Analyze the trace timeline**

The trace shows:

- `gateway.start_game`: 480ms total
  - `http.request` to auth service: 5ms
  - `game.validate_state`: 470ms ← this is the problem
  - `websocket.send`: 5ms

The trace reveals that game state validation is slow, not auth or network.

**Step 4: View related logs**

Click "Logs for this trace". Grafana shows logs from the gateway during that trace. You see:

```
[warn] Game state validation slow: 470ms (traceId: abc123)
[debug] Fetched 10000 historical games (traceId: abc123)
```

The logs reveal that the slow validation is fetching too many historical games.

**Step 5: Check related metrics**

Click "Related metrics" in the trace view. You see `traces_spanmetrics_calls_total{span_name="game.validate_state"}` spiked at 3:15pm. This correlates with a game promotion that increased play volume.

**Step 6: Root cause and fix**

Root cause: game validation fetches all historical games, which is slow when players have thousands of games. Fix: add pagination or cache validation results.

This workflow (metric → trace → logs → fix) is only possible with full observability stack integration.

### 8.2 Workflow: error rate investigation

**Step 1: Detect error rate spike**

Gateway dashboard shows error rate jumped from 0.1% to 5% at 2:45pm.

**Step 2: Find error traces**

Traces dashboard, filter by `status_code="STATUS_CODE_ERROR"` and `service.name="nullspace-gateway"`. Click an error trace.

**Step 3: Analyze error span**

The trace shows:

- `gateway.claim_reward`: ERROR
  - Exception: "Signature verification failed"

The span attributes show `auth.public_key=xyz...`. This is a specific player.

**Step 4: View error logs**

Click "Logs for this trace". You see:

```
[error] Signature verification failed: Invalid signature (traceId: def456)
[debug] Challenge: {...}, Signature: {...} (traceId: def456)
```

The logs show the exact challenge and signature that failed.

**Step 5: Reproduce locally**

Copy the challenge and signature from logs. Run signature verification locally with the same inputs. You discover that the mobile app is sending signatures in uppercase hex, but the server expects lowercase.

**Step 6: Fix and verify**

Deploy fix to normalize hex before verification. Check Traces dashboard - error rate drops to 0.1%. Check an example trace - `gateway.claim_reward` now shows SUCCESS.

This demonstrates the value of trace attributes (captured `auth.public_key`) and trace-to-logs correlation (found exact inputs).

### 8.3 Best practices for tracing

**1) Always trace critical paths**

Wrap game operations, auth flows, and database queries in spans. These are where bugs hide.

**2) Add meaningful attributes**

```ts
addSpanAttributes(span, {
  'game.type': gameType,
  'game.bet_amount': betAmount,
  'player.public_key': publicKey,
});
```

Attributes make traces searchable. You can find "all traces where bet_amount > 1000" or "traces for this specific player".

**3) Log trace IDs with errors**

```ts
const { traceId } = getTraceContext() || {};
console.error(`Failed to start game: ${error.message}`, { traceId, gameType });
```

This links logs back to traces. Always log trace ID with errors, warnings, and important business events.

**4) Use trace context propagation**

When calling downstream services, propagate trace context:

```ts
const { traceparent } = getTraceContext() || {};
await fetch(authUrl, {
  headers: { traceparent },
});
```

This ensures all spans in the request flow share the same trace ID.

**5) Keep spans focused**

A span should represent one operation. If a function does three things, create three spans (or one parent with three children). This makes traces easier to analyze.

**6) Set span status correctly**

Always call `span.setStatus({ code: SpanStatusCode.ERROR })` on errors. This makes error traces filterable and shows up in RED metrics.

---

## 9) Service graph and topology visualization

The Traces dashboard includes a service graph panel:

```json
{
  "type": "nodeGraph",
  "targets": [
    {
      "queryType": "serviceMap"
    }
  ],
  "title": "Service Topology"
}
```

Tempo's `service-graphs` processor analyzes traces and builds a dependency graph:

- Nodes: services (gateway, auth, simulator)
- Edges: request rates and latencies between services

This visualizes the architecture automatically from traces. You see which services call which, request rates per edge, and error rates per edge.

This is useful for:

- Understanding system architecture (especially for new team members)
- Identifying bottleneck services (high error rate on incoming edges)
- Detecting unexpected dependencies (services that should not be calling each other)

The service graph is generated from traces, not configuration. If you add a new service and start tracing, it appears in the graph automatically.

---

## 10) Retention and storage management

Tempo's compactor manages trace retention:

```yaml
compactor:
  compaction:
    block_retention: 336h  # 14 days
```

Traces older than 14 days are deleted. This prevents unbounded disk growth. For production, you may want longer retention (30-90 days) for historical analysis.

Trace storage scales with request volume:

- 1000 req/min × 60 min × 24 hours × 14 days = ~20M traces
- Average trace size: ~10KB
- Total storage: ~200GB for 14 days retention

For high-volume production, consider:

- Object storage backend (S3, GCS) instead of local filesystem
- Sampling (trace 10% of requests, always trace errors)
- Separate retention for error traces (keep longer) vs success traces (keep shorter)

The metrics generator does not consume significant storage because it only stores exemplars (sample trace IDs), not full traces.

---

## 11) OpenTelemetry semantic conventions

The auth service uses semantic conventions for span attributes:

```ts
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} from '@opentelemetry/semantic-conventions';
```

These are standardized attribute names from the OpenTelemetry spec. Using semantic conventions makes traces portable across tools and allows Grafana to recognize common attributes (like `service.name` for filtering).

Custom attributes (like `game.type` or `message.type`) should use a consistent naming convention:

- Use dot notation: `game.type`, not `game_type` or `gameType`
- Use lowercase: `game.bet_amount`, not `game.betAmount`
- Use descriptive names: `auth.public_key`, not `auth.key`

This makes traces easier to query and understand.

---

## 12) Development vs production telemetry

The gateway uses no-op tracing in development:

```ts
const noopSpan: Span = {
  setAttribute: () => {},
  setStatus: () => {},
  recordException: () => {},
  end: () => {},
};

export const tracer = {
  startSpan: (_name: string): Span => noopSpan,
};

console.log('[telemetry] Running in development mode - tracing disabled');
```

This prevents OpenTelemetry package issues in development (the gateway comment mentions "package compatibility issues"). The telemetry helpers are the same in dev and prod, but in dev they are no-ops.

This design keeps the code simple: you write the same tracing code everywhere. The environment variable `OTEL_EXPORTER_OTLP_ENDPOINT` controls whether traces are exported.

The auth service takes the opposite approach: full OpenTelemetry in dev and prod, controlled by environment variable. Both approaches are valid. The key is consistency within a service.

---

## 13) Feynman recap

The Nullspace observability stack is a complete distributed tracing system. Services create spans with OpenTelemetry. Tempo receives traces via OTLP and stores them. Tempo's metrics generator creates RED metrics and sends to Prometheus. Grafana connects Tempo, Prometheus, and Loki to enable trace-to-metrics, trace-to-logs, and metric-to-trace correlation.

This three-way correlation is the key insight: you instrument once (traces), and get metrics for free. Traces link to logs via trace IDs. Metrics link to traces via exemplars. This makes debugging fast: see a metric spike, find an example trace, view related logs, identify root cause.

---

## 14) Limits and management callouts

### 14.1 Trace volume and sampling

At high request volumes, tracing every request is expensive:

- Storage: 10KB per trace × 1M requests/day = 10GB/day
- CPU: Tempo processes every span to generate metrics
- Network: OTLP export adds latency to requests

For high-scale production, enable sampling:

- Trace 10% of success requests
- Trace 100% of error requests (or high latency requests)
- Use head-based sampling (decide at request start) or tail-based sampling (decide after request completes)

OpenTelemetry supports sampling via `TraceIdRatioBased` sampler:

```ts
sampler: new TraceIdRatioBased(0.1), // sample 10%
```

This reduces trace volume while preserving error traces for debugging.

### 14.2 Span attribute cardinality

Span attributes become metric labels. High cardinality labels (like `user_id` or `trace_id`) can explode metric storage:

```promql
traces_spanmetrics_calls_total{user_id="abc123",...}
traces_spanmetrics_calls_total{user_id="def456",...}
```

This creates millions of time series, which overwhelms Prometheus.

**Best practice**: only use low-cardinality attributes as metric labels (service name, operation name, game type). Store high-cardinality attributes as span attributes (searchable in TraceQL) but not as metric labels.

### 14.3 Trace retention and compliance

Traces may contain sensitive data (player IDs, IP addresses, bet amounts). Ensure trace retention complies with data privacy regulations:

- 14-day retention is typical for operational debugging
- 90-day retention for compliance and auditing
- Scrub sensitive attributes before export (or use separate Tempo instance for PII-free traces)

Tempo supports tenant isolation (multi-tenancy) for separating production and staging traces or different data sensitivity levels.

### 14.4 Observability cost

Running the full observability stack (Prometheus, Tempo, Loki, Grafana) has resource costs:

- CPU: Tempo metrics generator, Prometheus scraping, Loki indexing
- Memory: Prometheus time series, Tempo in-memory buffers, Grafana dashboards
- Disk: 14 days of traces + 30 days of logs + 30 days of metrics = ~500GB

For production, monitor observability stack resource usage. If Tempo or Prometheus runs out of memory, request volumes may overwhelm the stack. Scale vertically (more RAM) or horizontally (Tempo distributed mode).

### 14.5 Cold start and trace completeness

If Tempo is down or restarting, traces are lost (unless services buffer locally). The OTLP exporter does not retry indefinitely. This means:

- During Tempo outages, tracing is degraded
- After Tempo restart, some traces may be incomplete (missing spans from services that exported before Tempo was ready)

For production, ensure Tempo is highly available:

- Run multiple Tempo instances behind a load balancer
- Use persistent storage (not `/tmp`) for WAL and blocks
- Monitor Tempo health and alert on downtime

The auth service handles SDK shutdown gracefully:

```ts
const shutdown = (): void => {
  sdk.shutdown().catch((err) => {
    console.warn('[telemetry] failed to shut down OTLP exporter', err);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

This ensures traces are flushed before the service exits. Without graceful shutdown, in-flight traces may be lost.

### 14.6 Trace propagation across non-HTTP boundaries

W3C Trace Context is designed for HTTP. For other protocols (WebSockets, message queues, gRPC), you must propagate trace context manually:

```ts
const { traceparent } = getTraceContext() || {};
websocket.send(JSON.stringify({
  type: 'game_event',
  traceparent, // propagate trace context
  ...payload
}));
```

On the receiving side, extract `traceparent` and create a child span:

```ts
const span = createSpanFromTraceparent('gateway.handle_game_event', message.traceparent);
```

This ensures WebSocket messages are traced within the parent HTTP request's trace. Without manual propagation, WebSocket handlers would start new traces and lose causal relationships.

---

## 15) Exercises

1) What is the difference between trace-derived metrics (`traces_spanmetrics_calls_total`) and application metrics (`gateway_messages_total`)?
2) How does W3C Trace Context enable cross-service tracing?
3) Walk through the complete flow from service span to Grafana dashboard visualization.
4) How does trace-to-logs correlation work, and what must logs include for it to work?
5) Why does Tempo generate metrics from traces instead of services exporting metrics directly?
6) What happens if a service crashes before calling `sdk.shutdown()`?

---

## Next lesson

E28 - Onchain program architecture and instruction handlers: `feynman/lessons/E28-onchain-program.md`
