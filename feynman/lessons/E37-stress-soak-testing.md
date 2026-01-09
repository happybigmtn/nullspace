# E37 - Stress testing and soak testing (from scratch, deep dive)

Focus files:
- `gateway/tests/stress/websocket-stress.test.ts`
- `scripts/soak-test.sh`

Goal: explain how stress tests validate gateway capacity under high concurrent load, how soak tests verify system stability over time, and how to interpret latency percentiles and capacity limits for scaling decisions. This is a full walkthrough of connection batching, latency measurement, and operational health monitoring.

---

## Learning objectives

After this lesson you should be able to:

1) Explain the difference between stress testing and soak testing.
2) Describe how percentile latencies (P50, P95, P99) guide capacity planning.
3) Understand connection batching and why it prevents overwhelming the system under test.
4) Trace how the stress test measures both connection establishment and message round-trip latency.
5) Explain how capacity tests verify graceful rejection instead of crashes.
6) Understand the soak test methodology and health check intervals.
7) Interpret stress test results to make scaling decisions.
8) Describe when to use deterministic simulation vs real network stress tests.

---

## 0) Feynman summary (why this lesson matters)

Stress testing tells you the gateway's capacity ceiling. Soak testing tells you if it stays stable when running at capacity for hours.

A stress test answers: "Can the gateway handle 100 concurrent connections with acceptable latency?" A soak test answers: "Will the gateway stay healthy for 5 minutes at full load without memory leaks, connection drops, or metric scrape failures?"

Together they prevent two classes of production failure:

1) **Sudden load spikes** that exceed capacity and crash the service.
2) **Gradual resource exhaustion** that only appears after hours of operation.

If you ship without these tests, you discover your limits in production when users are waiting. That is unacceptable for a real-time casino system.

---

## 1) Stress vs soak: two different questions

### 1.1 Stress testing: find the breaking point

Stress testing pushes a system to its limit by increasing load until performance degrades or the system fails. The goal is to answer:

- How many concurrent connections can the gateway sustain?
- At what point does latency become unacceptable?
- Does the system reject gracefully at capacity or does it crash?

A stress test is typically short (minutes) and intense.

### 1.2 Soak testing: verify stability over time

Soak testing runs a system at moderate load for an extended period (hours or days). The goal is to detect:

- Memory leaks that only appear after hours of operation
- Connection pool exhaustion
- Metric endpoint degradation
- Background task failures
- File descriptor leaks

A soak test is typically longer (hours) and sustained.

### 1.3 Why you need both

Stress tests find the ceiling. Soak tests find the cracks. A system might handle 1000 connections for 10 seconds but crash after 30 minutes at 500 connections due to a slow memory leak. Only soak testing catches that.

For a casino gateway serving real money, both are critical. Stress tests inform your scaling strategy. Soak tests prove your scaling strategy works in production.

---

## 2) Latency percentiles: why P99 matters more than average

### 2.1 Average latency hides outliers

If 99 requests complete in 10ms and 1 request takes 500ms, the average is ~15ms. That sounds fine, but 1% of your users are experiencing terrible performance.

Average latency is a misleading metric for user experience.

### 2.2 Percentiles reveal the user experience distribution

- **P50 (median)**: half of requests are faster, half slower. This is the typical experience.
- **P95**: 95% of requests are faster. This captures the experience of most users.
- **P99**: 99% of requests are faster. This captures the tail latency that affects a small but significant fraction of users.
- **P99.9**: the worst 0.1%. Important for SLAs.

For a real-time system, P99 latency is often more important than average because tail latency determines the worst-case user experience.

### 2.3 Why the gateway targets P99 < 100ms

The stress test includes this assertion:

```typescript
const P99_LATENCY_TARGET_MS = parseInt(process.env.P99_LATENCY_TARGET_MS || '100', 10);

expect(result.p99LatencyMs).toBeLessThan(P99_LATENCY_TARGET_MS);
```

100ms is the threshold where users perceive noticeable delay. For a casino game, delays feel laggy and hurt the experience. The target ensures that 99% of messages complete fast enough to feel instant.

This is a product decision encoded as a test assertion. If P99 exceeds 100ms under load, the gateway needs optimization or scaling.

---

## 3) Stress test configuration (environment-based tuning)

File: `gateway/tests/stress/websocket-stress.test.ts`

The stress test is opt-in and highly configurable via environment variables:

```typescript
const GATEWAY_URL = process.env.STRESS_GATEWAY_URL || 'ws://localhost:9010';
const STRESS_CONNECTIONS = parseInt(process.env.STRESS_CONNECTIONS || '100', 10);
const P99_LATENCY_TARGET_MS = parseInt(process.env.P99_LATENCY_TARGET_MS || '100', 10);
const CONNECTION_BATCH_SIZE = parseInt(process.env.CONNECTION_BATCH_SIZE || '50', 10);
const MESSAGE_ROUNDS = parseInt(process.env.MESSAGE_ROUNDS || '5', 10);

const STRESS_ENABLED = process.env.RUN_STRESS === 'true';
```

Walkthrough:

1) **GATEWAY_URL**: the WebSocket endpoint to test. Defaults to localhost, but can target a remote staging environment.
2) **STRESS_CONNECTIONS**: total number of concurrent connections to establish. Default 100 is moderate; you can scale up to 1000+ for capacity tests.
3) **P99_LATENCY_TARGET_MS**: the latency SLA. If P99 exceeds this, the test fails.
4) **CONNECTION_BATCH_SIZE**: how many connections to open in parallel before pausing. This prevents overwhelming the gateway during connection establishment.
5) **MESSAGE_ROUNDS**: how many ping-pong message exchanges to perform on a sample of connections. More rounds produce more latency samples.
6) **RUN_STRESS**: the gate. Stress tests only run when explicitly enabled, because they are slow and require infrastructure.

This design allows the same test code to run in CI (100 connections, quick validation) and in staging (1000 connections, full capacity test).

---

## 4) Connection batching: avoiding self-inflicted overload

The stress test opens connections in batches instead of all at once:

```typescript
for (let batch = 0; batch < Math.ceil(count / batchSize); batch++) {
  const batchStart = batch * batchSize;
  const batchEnd = Math.min(batchStart + batchSize, count);
  const batchPromises: Promise<WebSocket | null>[] = [];

  for (let i = batchStart; i < batchEnd; i++) {
    const connectionPromise = new Promise<WebSocket | null>((resolve) => {
      const start = Date.now();
      const ws = new WebSocket(gatewayUrl);
      // ... connection logic
    });
    batchPromises.push(connectionPromise);
  }

  const batchResults = await Promise.all(batchPromises);
  connections.push(...batchResults.filter((ws): ws is WebSocket => ws !== null));

  // Small delay between batches to let the system stabilize
  if (batch < Math.ceil(count / batchSize) - 1) {
    await new Promise((r) => setTimeout(r, 100));
  }
}
```

Walkthrough:

1) Divide total connections into batches (default 50 per batch).
2) Open all connections in a batch concurrently via `Promise.all`.
3) Wait for the batch to complete before starting the next batch.
4) Insert a 100ms delay between batches to let the gateway process the new connections.

### 4.1 Why batching matters

If you open 1000 connections simultaneously, you might overwhelm:

- The OS file descriptor limit
- The gateway's connection accept queue
- The test client's event loop
- Network bandwidth for SYN/ACK handshakes

This would produce test failures that don't reflect the gateway's true capacity. Batching ensures the test measures the gateway's limits, not the test harness's limits.

The 100ms inter-batch delay is a stabilization period. It allows the gateway to finish connection setup (session allocation, auth checks) before the next batch arrives.

### 4.2 Connection timeout handling

Each connection has a 30-second timeout:

```typescript
const timeout = setTimeout(() => {
  ws.terminate();
  stats.failed++;
  stats.errors.push(`Connection ${i} timed out`);
  resolve(null);
}, 30000);

ws.on('open', () => {
  clearTimeout(timeout);
  stats.connected++;
  stats.latencies.push(Date.now() - start);
  resolve(ws);
});
```

This prevents the test from hanging if the gateway becomes unresponsive. If a connection takes longer than 30 seconds to open, it is marked as failed and the test continues.

Connection establishment latency is recorded in `stats.latencies`. This measures how long the WebSocket handshake takes, which includes network RTT, TLS negotiation, and gateway accept processing.

---

## 5) Measuring message round-trip latency

After opening connections, the stress test samples a subset and measures message latency:

```typescript
if (connections.length > 0 && MESSAGE_ROUNDS > 0) {
  const sampleSize = Math.min(100, connections.length);
  const sampledConnections = connections.slice(0, sampleSize);

  for (let round = 0; round < MESSAGE_ROUNDS; round++) {
    const roundPromises = sampledConnections.map((ws) => {
      return new Promise<number | null>((resolve) => {
        const start = Date.now();
        const timeout = setTimeout(() => {
          resolve(null);
        }, 5000);

        const handler = () => {
          clearTimeout(timeout);
          ws.removeListener('message', handler);
          resolve(Date.now() - start);
        };

        ws.on('message', handler);
        ws.send(JSON.stringify({ type: 'ping', ts: start }));
      });
    });

    const latencies = await Promise.all(roundPromises);
    for (const lat of latencies) {
      if (lat !== null) {
        stats.latencies.push(lat);
      }
    }

    if (round < MESSAGE_ROUNDS - 1) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}
```

Walkthrough:

1) Sample up to 100 connections to avoid sending thousands of pings.
2) For each round, send a ping message on all sampled connections simultaneously.
3) Wait for the response and record the round-trip time.
4) Repeat for `MESSAGE_ROUNDS` (default 5), inserting a 50ms delay between rounds.
5) Accumulate latencies into `stats.latencies` for percentile calculation.

### 5.1 Why sample instead of testing all connections?

If you opened 1000 connections, sending 5 rounds of pings on all of them produces 5000 messages. This could overwhelm the gateway's message queue and produce misleading latency results.

Sampling 100 connections provides statistically significant latency data without distorting the test. The sample is taken from the first 100 connections, which are representative of the full set.

### 5.2 Message timeout and error handling

Each ping has a 5-second timeout. If no response arrives, the latency is recorded as `null` and excluded from percentile calculations.

This is important: if some messages hang, the test should not hang with them. The timeout ensures the test completes and reports how many messages succeeded vs failed.

The handler is removed after receiving a response to avoid memory leaks from accumulating event listeners.

---

## 6) Percentile calculation: turning latencies into insights

After collecting latencies, the stress test computes percentiles:

```typescript
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

const sortedLatencies = [...stats.latencies].sort((a, b) => a - b);

return {
  p50LatencyMs: percentile(sortedLatencies, 50),
  p95LatencyMs: percentile(sortedLatencies, 95),
  p99LatencyMs: percentile(sortedLatencies, 99),
  avgLatencyMs:
    sortedLatencies.length > 0
      ? sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length
      : 0,
  maxLatencyMs: sortedLatencies.length > 0 ? sortedLatencies[sortedLatencies.length - 1] : 0,
  minLatencyMs: sortedLatencies.length > 0 ? sortedLatencies[0] : 0,
};
```

Walkthrough:

1) Sort latencies in ascending order.
2) For each percentile, find the index `(p/100) * length` and return that element.
3) Compute average, min, and max for additional context.

This produces a latency distribution that reveals the user experience. For example:

- P50 = 15ms: typical request is fast
- P95 = 45ms: most requests are still fast
- P99 = 120ms: **fails the test** because it exceeds the 100ms target

This tells you that under load, the worst 1% of requests are too slow. You might need to optimize the gateway, add more instances, or reduce the connection target.

---

## 7) Capacity test: graceful rejection vs crashes

The stress test includes a critical test case:

```typescript
it('should gracefully reject connections when at capacity', async () => {
  const overCapacity = 1100;
  console.log(`Capacity Test: ${overCapacity} connections (expecting some rejections)`);

  const result = await runStressTest(overCapacity, 100, GATEWAY_URL);

  console.log(`   Successful: ${result.successfulConnections}`);
  console.log(`   Rejected: ${result.failedConnections}`);

  // Some connections should fail (gateway should reject beyond capacity)
  // But it should be graceful, not a crash
  expect(result.successfulConnections + result.failedConnections).toBe(overCapacity);
}, 300000);
```

This test attempts to exceed the gateway's configured limit (default 1000 sessions). The assertion is subtle:

- **Not asserting all connections succeed**: that would be wrong, because the gateway should reject beyond capacity.
- **Not asserting the gateway crashes**: that would be a failure.
- **Asserting graceful rejection**: all connection attempts should either succeed or fail cleanly, with no hanging or crashes.

### 7.1 Why graceful rejection matters

In production, you cannot prevent load spikes. What you can control is how the system behaves at capacity:

- **Bad behavior**: accept all connections, run out of memory, crash, and take down all existing sessions.
- **Good behavior**: reject new connections with a clear error while maintaining existing sessions.

This test verifies the good behavior. If the gateway crashes or hangs when you exceed capacity, this test fails, and you know you have a reliability problem.

### 7.2 Connection limits and backpressure

The gateway should have a configured connection limit (e.g., 1000 sessions). When this limit is reached, the gateway should:

1) Reject new WebSocket handshakes with a 503 Service Unavailable or similar error.
2) Continue serving existing sessions without degradation.

This is called **backpressure**: the system signals to clients that it is at capacity, giving them a chance to retry later or connect to a different instance.

The capacity test validates that backpressure works correctly.

---

## 8) Interpreting stress test results

The stress test outputs a detailed summary:

```
Stress Test: 100 connections to ws://localhost:9010
   Batch size: 50, Message rounds: 5

Results:
   Total connections: 100
   Successful: 100
   Failed: 0
   Duration: 4532ms

Latency (ms):
   P50: 12.3
   P95: 34.7
   P99: 58.2
   Avg: 18.5
   Min: 8.1
   Max: 61.4
```

How to interpret this:

1) **Successful vs failed**: 100% success means the gateway handled the load without dropping connections.
2) **Duration**: 4.5 seconds to open 100 connections and run 5 message rounds is reasonable. If this were 30+ seconds, the gateway might be overloaded.
3) **P50 = 12.3ms**: median latency is excellent. Typical requests are nearly instant.
4) **P95 = 34.7ms**: 95% of requests complete in <35ms. Still good.
5) **P99 = 58.2ms**: **passes the test** because 58.2 < 100ms. The worst 1% of requests are acceptable.

### 8.1 When P99 exceeds the target

If P99 = 150ms, the test fails. This tells you:

- The gateway is either CPU-bound or waiting on a slow dependency.
- You might need to optimize hot paths (session lookup, message parsing).
- You might need to add more gateway instances behind a load balancer.
- You might need to reduce the connection target per instance.

### 8.2 When connections fail

If 10 out of 100 connections fail, this could mean:

- The gateway is hitting resource limits (file descriptors, memory).
- Network instability (packet loss, high latency).
- Configuration errors (firewall, connection limits).

The `errors` array in the result includes the first 10 error messages, which help diagnose the root cause.

---

## 9) Soak test overview (`scripts/soak-test.sh`)

File: `scripts/soak-test.sh`

The soak test is a bash script that:

1) Starts a local network (simulator + nodes + gateway).
2) Waits for all services to become healthy.
3) Runs for a configured duration (default 300 seconds = 5 minutes).
4) Periodically checks health endpoints and metrics.
5) Fails if any service crashes or metrics scrape fails.
6) Cleans up the network on exit.

This is a **long-running stability test**, not a capacity test. It is designed to catch issues that only appear after sustained operation.

---

## 10) Soak test configuration

The soak test uses environment variables for configuration:

```bash
CONFIG_DIR="${1:-configs/local}"
NODES="${2:-4}"
DURATION_SECONDS="${DURATION_SECONDS:-300}"
SLEEP_SECONDS="${SLEEP_SECONDS:-5}"
FRESH="${FRESH:-false}"
NO_BUILD="${NO_BUILD:-false}"
CURL_MAX_TIME="${CURL_MAX_TIME:-2}"
ALLOW_HTTP_NO_ORIGIN="${ALLOW_HTTP_NO_ORIGIN:-1}"
ALLOW_WS_NO_ORIGIN="${ALLOW_WS_NO_ORIGIN:-1}"
```

Walkthrough:

1) **CONFIG_DIR**: path to node config files (default `configs/local`).
2) **NODES**: number of validator nodes to start (default 4).
3) **DURATION_SECONDS**: how long to run the soak test (default 5 minutes).
4) **SLEEP_SECONDS**: interval between health checks (default 5 seconds).
5) **FRESH**: if true, wipe state before starting (clean test).
6) **NO_BUILD**: if true, skip rebuilding binaries (faster iteration).
7) **CURL_MAX_TIME**: timeout for health check requests (default 2 seconds).
8) **ALLOW_HTTP_NO_ORIGIN, ALLOW_WS_NO_ORIGIN**: relaxed CORS for local testing.

### 10.1 Why 5 minutes is the default duration

5 minutes is long enough to catch:

- Early memory leaks (e.g., event listeners accumulating).
- Connection pool exhaustion.
- Metric endpoint failures.
- Background task failures (e.g., periodic cleanup).

But short enough to run in CI without excessive build time. For staging or pre-production, you might run a 1-hour or 24-hour soak test to catch slower leaks.

---

## 11) Network startup and health checks

The soak test starts the network in the background:

```bash
./scripts/start-local-network.sh "${ARGS[@]}" &
NETWORK_PID=$!

cleanup() {
  if kill -0 "$NETWORK_PID" 2>/dev/null; then
    kill -INT "$NETWORK_PID" 2>/dev/null || true
    for _ in {1..10}; do
      if ! kill -0 "$NETWORK_PID" 2>/dev/null; then
        break
      fi
      sleep 1
    done
    if kill -0 "$NETWORK_PID" 2>/dev/null; then
      kill -TERM "$NETWORK_PID" 2>/dev/null || true
      sleep 1
    fi
    if kill -0 "$NETWORK_PID" 2>/dev/null; then
      kill -KILL "$NETWORK_PID" 2>/dev/null || true
    fi
    wait "$NETWORK_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM
```

Walkthrough:

1) Start the network script in the background and capture its PID.
2) Register a cleanup function that:
   - Sends SIGINT (graceful shutdown).
   - Waits up to 10 seconds for the process to exit.
   - Escalates to SIGTERM, then SIGKILL if needed.
3) Trap EXIT, INT, and TERM signals to ensure cleanup runs even if the soak test is interrupted.

This is critical for CI and local testing. Without cleanup, failed soak tests leave zombie processes that consume resources and interfere with subsequent tests.

---

## 12) Waiting for service health

Before running the soak loop, the script waits for all services to become ready:

```bash
echo "Waiting for simulator health..."
READY=false
for _ in {1..60}; do
  if curl -sf --max-time "$CURL_MAX_TIME" http://localhost:8080/healthz > /dev/null 2>&1; then
    READY=true
    break
  fi
  sleep 1
done

if [[ "$READY" != "true" ]]; then
  echo "Simulator did not become ready within 60 seconds."
  exit 1
fi
```

Then it waits for each node's metrics endpoint:

```bash
wait_for_metrics() {
  local url="$1"
  local label="$2"
  local attempts=60

  for _ in $(seq 1 "$attempts"); do
    if curl -sf --max-time "$CURL_MAX_TIME" "$url" > /dev/null; then
      return 0
    fi
    sleep 1
  done

  echo "${label} did not become ready within ${attempts}s."
  return 1
}

for port in "${METRICS_PORTS[@]}"; do
  echo "Waiting for node metrics on port ${port}..."
  wait_for_metrics "http://localhost:${port}/metrics" "Node metrics on port ${port}"
done
```

### 12.1 Why health checks prevent flaky tests

If the soak loop started immediately, it might check metrics before the nodes are ready, causing false failures. The health check loop ensures the system is fully operational before testing begins.

The 60-second timeout is generous. If a service takes longer than 60 seconds to start, that is a sign of a deeper problem (slow compilation, resource exhaustion, configuration error).

### 12.2 Metrics port extraction from config files

The script reads metrics ports from node config files:

```bash
get_metrics_port() {
  local config="$1"
  awk -F: '/^metrics_port:/{gsub(/ /, "", $2); print $2}' "$config"
}

METRICS_PORTS=()
for i in $(seq 0 $((NODES - 1))); do
  port="$(get_metrics_port "$CONFIG_DIR/node$i.yaml")"
  if [[ -z "$port" ]]; then
    echo "Missing metrics_port in $CONFIG_DIR/node$i.yaml"
    exit 1
  fi
  METRICS_PORTS+=("$port")
done
```

This is a pragmatic approach: instead of hardcoding ports, the script extracts them from the config files. This ensures the soak test works with any config directory (local, staging, testnet).

---

## 13) Soak loop: continuous health monitoring

After setup, the soak test enters the main loop:

```bash
echo "Running soak for ${DURATION_SECONDS}s..."
end_time=$(( $(date +%s) + DURATION_SECONDS ))
while [[ $(date +%s) -lt $end_time ]]; do
  if ! kill -0 "$NETWORK_PID" 2>/dev/null; then
    echo "Network process exited early."
    exit 1
  fi

  if ! curl -sf --max-time "$CURL_MAX_TIME" http://localhost:8080/metrics/prometheus > /dev/null; then
    echo "Simulator metrics scrape failed."
    exit 1
  fi
  for port in "${METRICS_PORTS[@]}"; do
    if ! curl -sf --max-time "$CURL_MAX_TIME" "http://localhost:${port}/metrics" > /dev/null; then
      echo "Node metrics scrape failed on port ${port}."
      exit 1
    fi
  done

  sleep "$SLEEP_SECONDS"
done

echo "Soak test completed."
```

Walkthrough:

1) Compute the end time as `current_time + DURATION_SECONDS`.
2) While current time < end time:
   - Check if the network process is still running. If not, fail immediately.
   - Scrape the simulator metrics endpoint. If it fails, exit with an error.
   - Scrape each node's metrics endpoint. If any fail, exit with an error.
   - Sleep for `SLEEP_SECONDS` (default 5 seconds).
3) If the loop completes without errors, print success.

### 13.1 Why the network process check matters

If a node crashes or the simulator exits, the soak test should fail immediately instead of waiting for the full duration. The `kill -0` check detects if the network process is still running.

This provides fast feedback: if a crash happens 30 seconds into the soak test, you know about it in 30 seconds, not 5 minutes.

### 13.2 Why metrics scraping is the health signal

Metrics endpoints are not just for dashboards. They are also a liveness signal. If a metrics endpoint stops responding, it means:

- The service is deadlocked.
- The service crashed but the process is still running.
- The metrics server thread hung.

Any of these is a soak test failure. By scraping metrics every 5 seconds, the test detects these issues quickly.

### 13.3 Silent metrics scraping

The script discards the metrics output (`> /dev/null`). This is intentional: the soak test does not care about the metric values, only that the endpoint responds.

If you wanted to monitor specific metrics (e.g., memory usage growing over time), you could parse the output and track trends. That would be a more sophisticated soak test.

---

## 14) Soak test failure modes

The soak test fails if:

1) **Any service fails to start** within 60 seconds.
2) **The network process exits early** (crash or graceful shutdown).
3) **Any metrics endpoint fails to respond** during the soak loop.

Each failure mode provides diagnostic output:

- "Simulator did not become ready within 60 seconds."
- "Network process exited early."
- "Node metrics scrape failed on port 8001."

These messages guide debugging. For example, if node 0's metrics fail, you check the node 0 logs for crashes or errors.

---

## 15) Soak testing vs stress testing: when to use which

### 15.1 Stress test use cases

- **Capacity planning**: "How many connections can one gateway instance handle?"
- **Latency validation**: "Does P99 latency stay under 100ms at 500 connections?"
- **Scaling decisions**: "Do we need 3 or 5 gateway instances for 2000 concurrent users?"

### 15.2 Soak test use cases

- **Memory leak detection**: "Does the gateway stay stable for 24 hours?"
- **Connection pool exhaustion**: "Do database connections accumulate and exhaust the pool?"
- **Background task validation**: "Does the periodic cleanup task run correctly over time?"
- **Metrics stability**: "Do all metrics endpoints stay responsive under sustained load?"

### 15.3 Combining both in CI

A robust CI pipeline runs:

1) **Unit tests** on every commit (fast feedback).
2) **Integration tests** on PRs (protocol correctness).
3) **Stress tests** on PRs that change gateway or networking code (capacity validation).
4) **Soak tests** on merge to main (stability validation).
5) **Extended soak tests** (1+ hour) on a schedule (weekly, pre-release).

This layered approach catches different classes of bugs at different stages.

---

## 16) Scaling decisions from stress test results

Stress test results guide production configuration. Here is how to translate results into scaling decisions:

### 16.1 Example result: 100 connections, P99 = 45ms

- **Interpretation**: gateway is underutilized. P99 is well below the 100ms target.
- **Decision**: safe to increase connection limit or reduce the number of gateway instances.

### 16.2 Example result: 500 connections, P99 = 120ms

- **Interpretation**: gateway is at capacity. P99 exceeds the target.
- **Decision**: this is the capacity ceiling. In production, limit each gateway instance to ~400 connections (20% buffer below the breaking point) and scale horizontally.

### 16.3 Example result: 1000 connections, 10% failure rate

- **Interpretation**: gateway is rejecting connections, possibly due to OS limits (file descriptors) or configured session limits.
- **Decision**: increase OS limits (ulimit -n), increase the session limit config, or add more gateway instances.

### 16.4 Example result: 200 connections, P99 = 150ms, but 500 connections P99 = 200ms

- **Interpretation**: latency degrades sublinearly. Likely waiting on a shared resource (database, lock, single-threaded event loop).
- **Decision**: profile the gateway under load to find the bottleneck. Optimize the hot path or scale the dependency (e.g., read replicas for the database).

---

## 17) Limits and management callouts

### 17.1 OS limits: file descriptors

Each WebSocket connection consumes a file descriptor. On Linux, the default limit is often 1024. If you try to open 2000 connections, you will hit this limit and connections will fail.

To increase the limit:

```bash
ulimit -n 10000
```

For production, set this in systemd service files or `/etc/security/limits.conf`.

### 17.2 Connection limits: gateway configuration

The gateway should have a configurable connection limit (e.g., `MAX_SESSIONS=1000`). This prevents the gateway from accepting more connections than it can handle.

The capacity stress test validates that this limit works correctly.

### 17.3 Network limits: bandwidth and latency

Stress tests over the internet are affected by network conditions. If you run a stress test from a remote client, high P99 latency might be due to network RTT, not gateway performance.

For accurate results, run stress tests on the same network or data center as the gateway (e.g., EC2 instances in the same VPC).

### 17.4 Test client limits

The stress test client itself has limits:

- Node.js event loop can saturate if you open too many connections simultaneously.
- The client machine's CPU and memory can become the bottleneck.

If you see strange results (e.g., increasing connections from 1000 to 2000 does not change latency), the client might be the bottleneck. Run the stress test from multiple machines or use a distributed load testing tool like k6.

---

## 18) Deterministic simulation tests vs real network stress tests

The node simulation tests (see E15) use deterministic runtime and simulated networks. Stress tests use real WebSockets and real networking. Why both?

### 18.1 Deterministic simulation advantages

- **Repeatability**: same seed produces same results.
- **Controlled network conditions**: precise latency, jitter, packet loss.
- **Fast execution**: no real network overhead.
- **Isolation**: no external dependencies.

### 18.2 Real network stress test advantages

- **Real-world behavior**: tests actual OS networking, TLS, WebSocket framing.
- **External dependency validation**: tests database, load balancer, firewalls.
- **Production-like conditions**: same code paths that run in production.

### 18.3 When to use which

- Use **simulation tests** for consensus logic, state machine correctness, and distributed system properties.
- Use **stress tests** for capacity planning, latency validation, and load balancer configuration.

Both are necessary. Simulation tests prove correctness. Stress tests prove scalability.

---

## 19) Feynman recap

Stress testing finds the capacity ceiling by pushing the system to its limit. Soak testing finds cracks by running at sustained load for hours. Together they prevent production failures from sudden load spikes and gradual resource exhaustion.

The stress test measures two kinds of latency:

1) **Connection establishment latency**: how long the WebSocket handshake takes.
2) **Message round-trip latency**: how long a ping-pong message exchange takes.

It reports percentiles (P50, P95, P99) to reveal the user experience distribution. P99 latency is the most important metric for real-time systems because it captures the tail latency that affects a small but significant fraction of users.

Connection batching prevents self-inflicted overload during testing. Capacity tests verify graceful rejection instead of crashes. Health checks prevent flaky tests by waiting for services to be ready before testing begins.

The soak test runs a full local network for a configured duration (default 5 minutes) and continuously scrapes health and metrics endpoints. If any service crashes or metrics scrape fails, the test fails. This catches memory leaks, connection pool exhaustion, and background task failures.

Stress test results guide scaling decisions. If P99 exceeds the target, you optimize or scale horizontally. If connections fail, you increase limits or add instances. If latency degrades sublinearly, you profile and find the bottleneck.

Both stress tests and soak tests are necessary. If you can explain these tests to someone new, you understand how to validate system capacity and stability before production.

---

## 20) Key takeaways

1) **Stress testing answers "how much?"** Soak testing answers "how long?"
2) **Percentiles reveal user experience.** P99 latency is more important than average for real-time systems.
3) **Connection batching prevents self-inflicted overload.** Open connections in batches with delays to avoid overwhelming the test client or the system under test.
4) **Capacity tests validate graceful rejection.** The system should reject new connections cleanly at capacity, not crash.
5) **Soak tests catch resource leaks.** Memory leaks, connection pool exhaustion, and background task failures only appear after sustained operation.
6) **Health checks prevent flaky tests.** Wait for services to be ready before testing begins.
7) **Metrics scraping is a liveness signal.** If metrics endpoints stop responding, the service is unhealthy.
8) **Stress test results guide scaling decisions.** Use P99 latency and failure rates to determine instance capacity and horizontal scaling needs.

---

## 21) Exercises

1) What is the difference between stress testing and soak testing? Give an example of a bug each would catch.
2) Why does the stress test report P99 latency instead of average latency?
3) Explain why connection batching matters. What happens if you open 1000 connections simultaneously?
4) The stress test samples 100 connections for message latency measurement instead of using all connections. Why?
5) What does the capacity test validate? Why is graceful rejection important?
6) The soak test scrapes metrics endpoints every 5 seconds. Why is this a good liveness signal?
7) You run a stress test with 500 connections and see P99 = 150ms. What does this tell you, and what action should you take?
8) The soak test runs for 5 minutes by default. When would you run a longer soak test, and what would it catch?
9) Describe the flow of a stress test: how connections are opened, how latency is measured, and how results are computed.

---

## Next lessons

- E15 - Testing strategy + harnesses: `feynman/lessons/E15-testing-strategy.md`
- E11 - Telemetry, logs, and ops events: `feynman/lessons/E11-telemetry-ops.md`
- E27 - Observability stack deep dive: `feynman/lessons/E27-observability-stack.md`
