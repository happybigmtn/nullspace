use anyhow::{Context, Result};
use clap::Parser;
use commonware_codec::DecodeExt;
use nullspace_simulator::{Api, Simulator, SimulatorConfig, SummaryPersistence};
use nullspace_types::Identity;
use opentelemetry_otlp::WithExportConfig;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use opentelemetry::trace::TracerProvider as _;
use tracing::info;
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::Layer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

fn init_tracing() -> Result<()> {
    let endpoint = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
        .ok()
        .and_then(|value| {
            let trimmed = value.trim().to_string();
            (!trimmed.is_empty()).then_some(trimmed)
        });

    if let Some(endpoint) = endpoint {
        let service_name =
            std::env::var("OTEL_SERVICE_NAME").unwrap_or_else(|_| "nullspace-simulator".to_string());
        let rate = std::env::var("OTEL_SAMPLING_RATE")
            .ok()
            .and_then(|value| value.parse::<f64>().ok())
            .map(|value| value.clamp(0.0, 1.0))
            .unwrap_or(1.0);
        let exporter = opentelemetry_otlp::SpanExporter::builder()
            .with_http()
            .with_endpoint(endpoint)
            .build()
            .context("failed to build OTLP exporter")?;
        let tracer_provider = opentelemetry_sdk::trace::SdkTracerProvider::builder()
            .with_sampler(opentelemetry_sdk::trace::Sampler::TraceIdRatioBased(rate))
            .with_resource(
                opentelemetry_sdk::Resource::builder_empty()
                    .with_attributes([opentelemetry::KeyValue::new("service.name", service_name)])
                    .build(),
            )
            .with_batch_exporter(exporter)
            .build();
        let tracer = tracer_provider.tracer("nullspace-simulator");
        opentelemetry::global::set_tracer_provider(tracer_provider);

        tracing_subscriber::registry()
            .with(tracing_subscriber::fmt::layer().with_filter(LevelFilter::INFO))
            .with(tracing_opentelemetry::layer().with_tracer(tracer))
            .init();
    } else {
        tracing_subscriber::fmt()
            .with_max_level(tracing::Level::INFO)
            .init();
    }

    Ok(())
}

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Host interface to bind (default: localhost).
    #[arg(long, default_value = "127.0.0.1")]
    host: IpAddr,

    #[arg(short, long, default_value_t = 8080)]
    port: u16,

    #[arg(short, long)]
    identity: String,

    /// Maximum number of blocks retained by the explorer index (0 disables limit).
    #[arg(long)]
    explorer_max_blocks: Option<usize>,

    /// Maximum number of txs/events retained per account in the explorer (0 disables limit).
    #[arg(long)]
    explorer_max_account_entries: Option<usize>,

    /// Maximum number of accounts retained in the explorer index (0 disables limit).
    #[arg(long)]
    explorer_max_accounts: Option<usize>,

    /// Maximum number of accounts retained in game history index (0 disables limit).
    #[arg(long)]
    explorer_max_game_event_accounts: Option<usize>,

    /// Path to SQLite database for explorer persistence (disabled when omitted).
    #[arg(long)]
    explorer_persistence_path: Option<PathBuf>,

    /// Path to SQLite database for summary persistence (disabled when omitted).
    #[arg(long)]
    summary_persistence_path: Option<PathBuf>,

    /// Maximum number of blocks retained by the summary persistence (0 disables limit).
    #[arg(long)]
    summary_persistence_max_blocks: Option<usize>,

    /// Postgres connection string for explorer persistence (overrides SQLite path when set).
    #[arg(long)]
    explorer_persistence_url: Option<String>,

    /// Max queued explorer persistence updates (0 uses default).
    #[arg(long)]
    explorer_persistence_buffer: Option<usize>,

    /// Max explorer persistence batch size (0 uses default).
    #[arg(long)]
    explorer_persistence_batch_size: Option<usize>,

    /// Explorer persistence backpressure policy: block or drop.
    #[arg(long)]
    explorer_persistence_backpressure: Option<String>,

    /// Maximum number of key versions retained per state key (0 disables limit).
    #[arg(long)]
    state_max_key_versions: Option<usize>,

    /// Maximum number of progress entries retained for state proofs (0 disables limit).
    #[arg(long)]
    state_max_progress_entries: Option<usize>,

    /// Maximum number of submitted heights tracked for dedupe (0 disables limit).
    #[arg(long)]
    submission_history_limit: Option<usize>,

    /// Maximum number of seeds retained in memory (0 disables limit).
    #[arg(long)]
    seed_history_limit: Option<usize>,

    /// HTTP rate limit per IP in requests per second (0 disables rate limiting).
    #[arg(long)]
    http_rate_limit_per_second: Option<u64>,

    /// HTTP rate limit burst size (0 disables rate limiting).
    #[arg(long)]
    http_rate_limit_burst: Option<u32>,

    /// Submit endpoint rate limit per IP in requests per minute (default: 100).
    #[arg(long)]
    submit_rate_limit_per_minute: Option<u64>,

    /// Submit endpoint rate limit burst size (default: 10).
    #[arg(long)]
    submit_rate_limit_burst: Option<u32>,

    /// Max request body size in bytes (0 disables limit).
    #[arg(long)]
    http_body_limit_bytes: Option<usize>,

    /// Max queued WebSocket outbound messages per connection (0 uses default).
    #[arg(long)]
    ws_outbound_buffer: Option<usize>,

    /// Max concurrent WebSocket connections (0 disables limit).
    #[arg(long)]
    ws_max_connections: Option<usize>,

    /// Max concurrent WebSocket connections per IP (0 disables limit).
    #[arg(long)]
    ws_max_connections_per_ip: Option<usize>,

    /// Max WebSocket message size in bytes (0 uses default).
    #[arg(long)]
    ws_max_message_bytes: Option<usize>,

    /// Max queued updates in the broadcast channel (0 uses default).
    #[arg(long)]
    updates_broadcast_buffer: Option<usize>,

    /// Max queued mempool items in the broadcast channel (0 uses default).
    #[arg(long)]
    mempool_broadcast_buffer: Option<usize>,

    /// Max concurrent proofs built for update filtering (0 uses default).
    #[arg(long)]
    updates_index_concurrency: Option<usize>,

    /// Redis URL for submission fanout (enables pubsub).
    #[arg(long)]
    fanout_redis_url: Option<String>,

    /// Redis channel for submission fanout.
    #[arg(long)]
    fanout_channel: Option<String>,

    /// Optional fanout origin identifier.
    #[arg(long)]
    fanout_origin: Option<String>,

    /// Publish submissions to fanout channel (default: true).
    #[arg(long, value_parser = clap::value_parser!(bool))]
    fanout_publish: Option<bool>,

    /// Subscribe to fanout channel (default: true).
    #[arg(long, value_parser = clap::value_parser!(bool))]
    fanout_subscribe: Option<bool>,

    /// Redis URL for explorer response caching.
    #[arg(long)]
    cache_redis_url: Option<String>,

    /// Redis key prefix for explorer response caching.
    #[arg(long)]
    cache_redis_prefix: Option<String>,

    /// Redis cache TTL in seconds (0 disables).
    #[arg(long)]
    cache_redis_ttl_seconds: Option<u64>,
}

fn is_production() -> bool {
    matches!(
        std::env::var("NODE_ENV").as_deref(),
        Ok("production") | Ok("prod")
    )
}

fn require_env(var: &str) -> Result<String> {
    let value = std::env::var(var).unwrap_or_default();
    if value.trim().is_empty() {
        anyhow::bail!("Missing required env: {var}");
    }
    Ok(value)
}

fn require_positive_u64(var: &str) -> Result<()> {
    let value = require_env(var)?;
    let parsed: u64 = value
        .parse()
        .with_context(|| format!("Invalid {var}: {value}"))?;
    if parsed == 0 {
        anyhow::bail!("Invalid {var}: {value}");
    }
    Ok(())
}

fn ensure_production_env() -> Result<()> {
    if !is_production() {
        return Ok(());
    }

    require_env("ALLOWED_HTTP_ORIGINS")?;
    require_env("ALLOWED_WS_ORIGINS")?;
    require_env("METRICS_AUTH_TOKEN")?;
    require_positive_u64("RATE_LIMIT_HTTP_PER_SEC")?;
    require_positive_u64("RATE_LIMIT_HTTP_BURST")?;
    require_positive_u64("RATE_LIMIT_SUBMIT_PER_MIN")?;
    require_positive_u64("RATE_LIMIT_SUBMIT_BURST")?;
    require_positive_u64("RATE_LIMIT_WS_CONNECTIONS")?;
    require_positive_u64("RATE_LIMIT_WS_CONNECTIONS_PER_IP")?;

    Ok(())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Parse args
    let args = Args::parse();

    // Create logger
    init_tracing()?;

    ensure_production_env()?;

    // Parse identity
    let bytes =
        commonware_utils::from_hex(&args.identity).context("invalid identity hex format")?;
    let identity: Identity =
        Identity::decode(&mut bytes.as_slice()).context("failed to decode identity")?;

    let defaults = SimulatorConfig::default();
    let explorer_persistence_backpressure = match args
        .explorer_persistence_backpressure
        .as_deref()
    {
        Some(value) => Some(value.parse().map_err(|err| {
            anyhow::anyhow!("invalid explorer persistence backpressure policy: {err}")
        })?),
        None => defaults.explorer_persistence_backpressure,
    };
    let config = SimulatorConfig {
        explorer_max_blocks: match args.explorer_max_blocks {
            Some(0) => None,
            Some(value) => Some(value),
            None => defaults.explorer_max_blocks,
        },
        explorer_max_account_entries: match args.explorer_max_account_entries {
            Some(0) => None,
            Some(value) => Some(value),
            None => defaults.explorer_max_account_entries,
        },
        explorer_max_accounts: match args.explorer_max_accounts {
            Some(0) => None,
            Some(value) => Some(value),
            None => defaults.explorer_max_accounts,
        },
        explorer_max_game_event_accounts: match args.explorer_max_game_event_accounts {
            Some(0) => None,
            Some(value) => Some(value),
            None => defaults.explorer_max_game_event_accounts,
        },
        explorer_persistence_path: args.explorer_persistence_path,
        explorer_persistence_url: args.explorer_persistence_url,
        explorer_persistence_buffer: match args.explorer_persistence_buffer {
            Some(0) => None,
            Some(value) => Some(value),
            None => defaults.explorer_persistence_buffer,
        },
        explorer_persistence_batch_size: match args.explorer_persistence_batch_size {
            Some(0) => None,
            Some(value) => Some(value),
            None => defaults.explorer_persistence_batch_size,
        },
        explorer_persistence_backpressure,
        summary_persistence_path: args.summary_persistence_path.clone(),
        summary_persistence_max_blocks: match args.summary_persistence_max_blocks {
            Some(0) => None,
            Some(value) => Some(value),
            None => None,
        },
        state_max_key_versions: match args.state_max_key_versions {
            Some(0) => None,
            Some(value) => Some(value),
            None => defaults.state_max_key_versions,
        },
        state_max_progress_entries: match args.state_max_progress_entries {
            Some(0) => None,
            Some(value) => Some(value),
            None => defaults.state_max_progress_entries,
        },
        submission_history_limit: match args.submission_history_limit {
            Some(0) => None,
            Some(value) => Some(value),
            None => defaults.submission_history_limit,
        },
        seed_history_limit: match args.seed_history_limit {
            Some(0) => None,
            Some(value) => Some(value),
            None => defaults.seed_history_limit,
        },
        http_rate_limit_per_second: match args.http_rate_limit_per_second {
            Some(0) => None,
            Some(value) => Some(value),
            None => defaults.http_rate_limit_per_second,
        },
        http_rate_limit_burst: match args.http_rate_limit_burst {
            Some(0) => None,
            Some(value) => Some(value),
            None => defaults.http_rate_limit_burst,
        },
        submit_rate_limit_per_minute: match args.submit_rate_limit_per_minute {
            Some(0) => None,
            Some(value) => Some(value),
            None => defaults.submit_rate_limit_per_minute,
        },
        submit_rate_limit_burst: match args.submit_rate_limit_burst {
            Some(0) => None,
            Some(value) => Some(value),
            None => defaults.submit_rate_limit_burst,
        },
        http_body_limit_bytes: match args.http_body_limit_bytes {
            Some(0) => None,
            Some(value) => Some(value),
            None => defaults.http_body_limit_bytes,
        },
        ws_outbound_buffer: match args.ws_outbound_buffer {
            Some(0) => defaults.ws_outbound_buffer,
            Some(value) => Some(value),
            None => defaults.ws_outbound_buffer,
        },
        ws_max_connections: match args.ws_max_connections {
            Some(0) => None,
            Some(value) => Some(value),
            None => defaults.ws_max_connections,
        },
        ws_max_connections_per_ip: match args.ws_max_connections_per_ip {
            Some(0) => None,
            Some(value) => Some(value),
            None => defaults.ws_max_connections_per_ip,
        },
        ws_max_message_bytes: match args.ws_max_message_bytes {
            Some(0) => defaults.ws_max_message_bytes,
            Some(value) => Some(value),
            None => defaults.ws_max_message_bytes,
        },
        updates_broadcast_buffer: match args.updates_broadcast_buffer {
            Some(0) => defaults.updates_broadcast_buffer,
            Some(value) => Some(value),
            None => defaults.updates_broadcast_buffer,
        },
        mempool_broadcast_buffer: match args.mempool_broadcast_buffer {
            Some(0) => defaults.mempool_broadcast_buffer,
            Some(value) => Some(value),
            None => defaults.mempool_broadcast_buffer,
        },
        updates_index_concurrency: match args.updates_index_concurrency {
            Some(0) => defaults.updates_index_concurrency,
            Some(value) => Some(value),
            None => defaults.updates_index_concurrency,
        },
        fanout_redis_url: args.fanout_redis_url,
        fanout_channel: args.fanout_channel.or_else(|| defaults.fanout_channel.clone()),
        fanout_origin: args.fanout_origin,
        fanout_publish: args.fanout_publish.or(defaults.fanout_publish),
        fanout_subscribe: args.fanout_subscribe.or(defaults.fanout_subscribe),
        cache_redis_url: args.cache_redis_url,
        cache_redis_prefix: args
            .cache_redis_prefix
            .or_else(|| defaults.cache_redis_prefix.clone()),
        cache_redis_ttl_seconds: match args.cache_redis_ttl_seconds {
            Some(0) => None,
            Some(value) => Some(value),
            None => defaults.cache_redis_ttl_seconds,
        },
    };

    let (summary_persistence, summaries) = if let Some(path) = &args.summary_persistence_path {
        let (persistence, summaries) = SummaryPersistence::load_and_start_sqlite(
            path,
            config.summary_persistence_max_blocks,
            1000, // buffer size
        )
        .context("load and start summary persistence")?;
        info!(
            path = %path.display(),
            count = summaries.len(),
            "Summary persistence enabled"
        );
        (Some(persistence), summaries)
    } else {
        (None, Vec::new())
    };

    let simulator = Arc::new(Simulator::new_with_config(
        identity,
        config,
        summary_persistence,
    ));

    for summary in summaries {
        let (state_digests, events_digests) = summary
            .verify(&simulator.identity())
            .context("verify persisted summary")?;
        simulator
            .submit_events(summary.clone(), events_digests)
            .await;
        simulator.submit_state(summary, state_digests).await;
    }

    simulator.start_fanout();
    let api = Api::new(simulator);
    let app = api.router();

    // Start server
    let addr = SocketAddr::new(args.host, args.port);
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed to bind {addr}"))?;
    info!("Listening on {}", addr);
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await
    .context("axum server error")?;

    Ok(())
}
