# E15 - Testing strategy + harnesses (from scratch)

Focus files: `gateway/tests/all-bet-types.test.ts`, `node/src/tests.rs`

Goal: explain how integration and simulation tests validate the gateway and node logic. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Integration tests
Gateway tests spin up WebSocket clients and run real flows (session ready, bets, results). These catch end-to-end protocol bugs.

### 2) Deterministic simulations
Node tests use a deterministic runtime to simulate a network and verify consensus behavior without nondeterminism.

### 3) Security regression tests
Some tests validate that secrets are not leaked in logs or debug output.

---

## Limits & management callouts (important)

1) **Long test timeouts**
- Integration tests default to 20 minutes (`TEST_TIMEOUT_MS`).
- This is safe for slow environments but can hide stalls.

2) **Integration tests require a running gateway**
- Tests depend on `RUN_INTEGRATION=true` and a live gateway port.
- CI must provision a gateway or skip these tests.

---

## Walkthrough with code excerpts

### 1) Integration test setup and timeouts
```rust
const GATEWAY_PORT = process.env.TEST_GATEWAY_PORT || '9010';
const GATEWAY_URL = `ws://localhost:${GATEWAY_PORT}`;
const INTEGRATION_ENABLED = process.env.RUN_INTEGRATION === 'true';
const TEST_TIMEOUT_MS = (() => {
  const raw = process.env.TEST_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1_200_000;
})();
const RESPONSE_TIMEOUT_MS = (() => {
  const raw = process.env.TEST_RESPONSE_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60000;
})();
```

Why this matters:
- Integration tests need explicit timeouts to avoid hanging forever.

What this code does:
- Reads gateway port and timeout values from env.
- Uses long defaults to tolerate slow staging environments.

---

### 2) Waiting for a session to be ready
```rust
async function waitForReady(ws: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('session_ready timeout')), 60000);
    const handler = (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'session_ready') {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve();
      }
    };
    ws.on('message', handler);
  });

  for (let i = 0; i < 30; i++) {
    const balance = await sendAndReceive(ws, { type: 'get_balance' });
    if (balance.registered && balance.hasBalance) {
      return;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Registration timeout');
}
```

Why this matters:
- Tests must confirm the gateway session is fully initialized before betting.

What this code does:
- Waits for `session_ready` over WebSocket.
- Polls balance until registration and balance are confirmed.

---

### 3) Redacting secrets in node config
```rust
#[test]
fn config_redacted_debug_does_not_leak_secrets() {
    let private_key = HexBytes::from_hex_formatted("deadbeef").expect("valid hex");
    let share = HexBytes::from_hex_formatted("cafebabe").expect("valid hex");
    let polynomial = HexBytes::from_hex_formatted("0123456789abcdef").expect("valid hex");
    let config = super::Config {
        private_key,
        share,
        polynomial,
        port: 3000,
        metrics_port: 3001,
        directory: "/tmp/nullspace".to_string(),
        worker_threads: 4,
        log_level: "info".to_string(),
        // ...
        fetch_rate_per_peer_per_second: 128,
    };

    let rendered = format!("{:?}", config.redacted_debug());
    for secret in ["deadbeef", "cafebabe", "0123456789abcdef"] {
        assert!(!rendered.contains(secret), "secret leaked in debug output");
    }
    assert!(rendered.contains("<redacted>"));
}
```

Why this matters:
- Logs must never leak secret keys or shares.

What this code does:
- Builds a config with fake secrets.
- Ensures `redacted_debug()` hides those secrets.

---

## Key takeaways
- Gateway tests validate real WebSocket flows and bet coverage.
- Node tests use deterministic simulation to validate consensus behavior.
- Security-focused tests prevent secret leakage.

## Next lesson
Supplemental primers begin with S01: `feynman/lessons/S01-networking-primer.md`
