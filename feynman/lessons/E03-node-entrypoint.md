# E03 - Node entrypoint + network wiring (from scratch)

Focus file: `node/src/main.rs`

Goal: explain how a validator node boots, validates config, starts telemetry, and wires network channels. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Node entrypoint
This file is the main binary for validators. It loads configuration, wires up the P2P network, and starts the consensus engine. Execution runs inside this validator process; there is no standalone dev-executor in the production flow.

### 2) Metrics and telemetry
Metrics endpoints expose internal counters; in production they must be authenticated.

### 3) Channelized P2P traffic
Different message types are sent on different channels (pending, recovered, resolver, etc) with their own rate limits.

---

## Limits & management callouts (important)

1) **Metrics auth is required in production**
- If `NODE_ENV=production`, `METRICS_AUTH_TOKEN` must be set.
- Without it, metrics requests are rejected.

2) **Network channels are rate-limited**
- Each channel has a `Quota::per_second(...)` limit.
- Misconfigured rates can cause stalls or flooding.

---

## Walkthrough with code excerpts

### 1) Metrics auth enforcement
```rust
fn ensure_metrics_auth_token() -> Result<()> {
    let require_token = is_production()
        || matches!(
            std::env::var("NODE_REQUIRE_METRICS_AUTH").as_deref(),
            Ok("1") | Ok("true") | Ok("yes")
        );
    if require_token && metrics_auth_token().is_none() {
        anyhow::bail!("METRICS_AUTH_TOKEN must be set when metrics auth is required");
    }
    Ok(())
}
```

Why this matters:
- Metrics expose operational data; leaving them open in production is a security risk.

What this code does:
- Requires a metrics token when in production (or when explicitly enabled).
- Fails fast if the token is missing.

---

### 2) CLI parsing and dry-run validation
```rust
let matches = Command::new("node")
    .about("Node for a nullspace chain.")
    .arg(Arg::new("hosts").long("hosts").required(false))
    .arg(Arg::new("peers").long("peers").required(false))
    .arg(
        Arg::new("dry-run")
            .long("dry-run")
            .help("Validate config/peers and exit without starting the node")
            .action(ArgAction::SetTrue),
    )
    .arg(Arg::new("config").long("config").required(true))
    .get_matches();

if hosts_file.is_none() && peers_file.is_none() {
    anyhow::bail!("Either --hosts or --peers must be provided");
}
```

Why this matters:
- Bad configs should be caught before the node joins the network.

What this code does:
- Parses CLI flags for config and peer lists.
- Enforces that either `--hosts` or `--peers` is provided.

---

### 3) Starting telemetry + metrics server
```rust
ensure_metrics_auth_token()?;

let cfg = tokio::Config::default()
    .with_tcp_nodelay(Some(true))
    .with_worker_threads(config.worker_threads)
    .with_storage_directory(PathBuf::from(&config.directory))
    .with_catch_panics(true);
let executor = tokio::Runner::new(cfg);

executor.start(|context| async move {
    let context = context.with_label("nullspace");
    let result: Result<()> = async {
        let use_json_logs = hosts_file.is_some();

        let log_level = Level::from_str(&config.log_level).context("Invalid log level")?;
        tokio::telemetry::init(
            context.with_label("telemetry"),
            tokio::telemetry::Logging { level: log_level, json: use_json_logs },
            None,
            resolve_trace_config(),
        );
        spawn_metrics_server(
            context.clone(),
            SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), config.metrics_port),
        );
        info!(config = ?config.redacted_debug(), "loaded config file");
        // ...
        Ok(())
    }
    .await;

    if let Err(e) = result {
        error!(?e, "node initialization failed");
    }
});
```

Why this matters:
- This is where the node runtime and observability are initialized.

What this code does:
- Builds a tokio runtime with configured threads and storage directory.
- Starts structured logging and optional tracing.
- Spawns the metrics HTTP server.

Terminology note:
- The `executor` variable here is the tokio runtime runner. It is not a separate dev-executor binary.

---

### 4) Wiring P2P channels
```rust
let pending_limit = Quota::per_second(config.pending_rate_per_second);
let pending = network.register(PENDING_CHANNEL, pending_limit, config.message_backlog);

let recovered_limit = Quota::per_second(config.recovered_rate_per_second);
let recovered = network.register(RECOVERED_CHANNEL, recovered_limit, config.message_backlog);

let resolver_limit = Quota::per_second(config.resolver_rate_per_second);
let resolver = network.register(RESOLVER_CHANNEL, resolver_limit, config.message_backlog);

let broadcaster_limit = Quota::per_second(config.broadcaster_rate_per_second);
let broadcaster = network.register(
    BROADCASTER_CHANNEL,
    broadcaster_limit,
    config.message_backlog,
);
```

Why this matters:
- Different channels isolate traffic types and prevent one class of messages from starving others.

What this code does:
- Creates per-channel quotas and registers them with the P2P network.
- Uses a shared backlog size to buffer bursts.

---

## Key takeaways
- The node entrypoint enforces config validity and metrics auth.
- Telemetry and metrics are started before consensus begins.
- P2P traffic is partitioned into rate-limited channels.

## Next lesson
E04 - Consensus pipeline + seeding: `feynman/lessons/E04-consensus-seeding.md`
