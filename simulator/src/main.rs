use anyhow::{Context, Result};
use clap::Parser;
use commonware_codec::{DecodeExt, Encode};
use commonware_cryptography::sha256::{Digest, Sha256};
use commonware_storage::mmr::{hasher::Standard, Location};
use commonware_storage::qmdb::verify_proof_and_extract_digests;
use futures::stream::{self, StreamExt};
use nullspace_simulator::{Api, Simulator, SimulatorConfig, SummaryPersistence};
use nullspace_types::{api::VerifyError, Identity};
use opentelemetry_otlp::WithExportConfig;
use reqwest::Client;
use serde_json::Value;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_deterministic_config_fields() {
        let args = Args::parse_from([
            "simulator",
            "--identity",
            "deadbeef",
            "--deterministic-seed",
            "7",
            "--deterministic-time-scale-ms",
            "5",
        ]);
        let config = build_config(&args).expect("config should parse");
        assert_eq!(config.deterministic_seed, Some(7));
        assert_eq!(config.deterministic_time_scale_ms, Some(5));
    }

    #[test]
    fn rejects_zero_time_scale() {
        let args = Args::parse_from([
            "simulator",
            "--identity",
            "deadbeef",
            "--deterministic-time-scale-ms",
            "0",
        ]);
        let err = build_config(&args).unwrap_err();
        assert!(
            err.to_string().contains("deterministic_time_scale_ms"),
            "unexpected error: {err}"
        );
    }
}

fn resolve_summary_replay_concurrency(value: Option<usize>) -> usize {
    let fallback = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(1);
    match value {
        Some(0) | None => fallback,
        Some(value) => value,
    }
    .max(1)
}

#[allow(clippy::type_complexity)]
fn verify_persisted_summary(
    summary: &nullspace_types::api::Summary,
    identity: &Identity,
    enforce_signature_verification: bool,
) -> Result<(Vec<(commonware_storage::mmr::Position, Digest)>, Vec<(commonware_storage::mmr::Position, Digest)>)> {
    match summary.verify(identity) {
        Ok(digests) => Ok(digests),
        Err(err) => {
            if enforce_signature_verification || !matches!(err, VerifyError::InvalidSignature) {
                return Err(anyhow::anyhow!(err));
            }

            tracing::warn!(
                ?err,
                height = summary.progress.height,
                state_ops = summary.state_proof_ops.len(),
                events_ops = summary.events_proof_ops.len(),
                "Persisted summary verification failed; bypassing signature check for staging"
            );

            let mut hasher = Standard::<Sha256>::new();
            let state_ops_len = summary.state_proof_ops.len();
            let events_ops_len = summary.events_proof_ops.len();

            let state_digests = if summary.progress.state_start_op + state_ops_len as u64
                == summary.progress.state_end_op
            {
                let state_start_loc = Location::from(summary.progress.state_start_op);
                verify_proof_and_extract_digests(
                    &mut hasher,
                    &summary.state_proof,
                    state_start_loc,
                    &summary.state_proof_ops,
                    &summary.progress.state_root,
                )
                .unwrap_or_default()
            } else {
                tracing::warn!(
                    start = summary.progress.state_start_op,
                    end = summary.progress.state_end_op,
                    ops_len = state_ops_len,
                    "State ops range mismatch while bypassing persisted summary signature"
                );
                Vec::new()
            };

            let events_digests = if summary.progress.events_start_op + events_ops_len as u64
                == summary.progress.events_end_op
            {
                let events_start_loc = Location::from(summary.progress.events_start_op);
                verify_proof_and_extract_digests(
                    &mut hasher,
                    &summary.events_proof,
                    events_start_loc,
                    &summary.events_proof_ops,
                    &summary.progress.events_root,
                )
                .unwrap_or_default()
            } else {
                tracing::warn!(
                    start = summary.progress.events_start_op,
                    end = summary.progress.events_end_op,
                    ops_len = events_ops_len,
                    "Events ops range mismatch while bypassing persisted summary signature"
                );
                Vec::new()
            };

            Ok((state_digests, events_digests))
        }
    }
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

    /// Seed for deterministic scheduling (optional).
    #[arg(long)]
    deterministic_seed: Option<u64>,

    /// Deterministic time scale per tick in milliseconds (must be > 0 when set).
    #[arg(long)]
    deterministic_time_scale_ms: Option<u64>,

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

    /// Max number of persisted summaries verified concurrently on startup (0 uses logical cores).
    #[arg(long)]
    summary_replay_concurrency: Option<usize>,

    /// Enforce signature verification for seeds and summaries (disable staging bypass).
    #[arg(long, default_value_t = false)]
    enforce_signature_verification: bool,

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

    /// URL of a remote simulator to backfill blocks from on empty storage.
    #[arg(long)]
    backfill_source_url: Option<String>,

    /// Maximum number of blocks to backfill from source (0 for unlimited).
    #[arg(long)]
    backfill_max_blocks: Option<usize>,
}

fn is_production() -> bool {
    matches!(
        std::env::var("NODE_ENV").as_deref(),
        Ok("production") | Ok("prod")
    )
}

/// Maps an optional arg value to Option: 0 => None, Some(v) => Some(v), None => default
fn map_optional_limit<T: Copy + PartialEq + From<u8>>(
    arg: Option<T>,
    default: Option<T>,
) -> Option<T> {
    match arg {
        Some(v) if v == T::from(0) => None,
        Some(v) => Some(v),
        None => default,
    }
}

/// Maps an optional arg value keeping default on 0: 0 => default, Some(v) => Some(v), None => default
fn map_optional_default_on_zero<T: Copy + PartialEq + From<u8>>(
    arg: Option<T>,
    default: Option<T>,
) -> Option<T> {
    match arg {
        Some(v) if v == T::from(0) => default,
        Some(v) => Some(v),
        None => default,
    }
}

fn build_config(args: &Args) -> Result<SimulatorConfig> {
    let defaults = SimulatorConfig::default();
    let explorer_persistence_backpressure = match args.explorer_persistence_backpressure.as_deref()
    {
        Some(value) => Some(value.parse().map_err(|err| {
            anyhow::anyhow!("invalid explorer persistence backpressure policy: {err}")
        })?),
        None => defaults.explorer_persistence_backpressure,
    };
    if let Some(0) = args.deterministic_time_scale_ms {
        anyhow::bail!("deterministic_time_scale_ms must be > 0 when set");
    }

    Ok(SimulatorConfig {
        explorer_max_blocks: map_optional_limit(args.explorer_max_blocks, defaults.explorer_max_blocks),
        explorer_max_account_entries: map_optional_limit(args.explorer_max_account_entries, defaults.explorer_max_account_entries),
        explorer_max_accounts: map_optional_limit(args.explorer_max_accounts, defaults.explorer_max_accounts),
        explorer_max_game_event_accounts: map_optional_limit(args.explorer_max_game_event_accounts, defaults.explorer_max_game_event_accounts),
        deterministic_seed: args.deterministic_seed.or(defaults.deterministic_seed),
        deterministic_time_scale_ms: args
            .deterministic_time_scale_ms
            .or(defaults.deterministic_time_scale_ms),
        explorer_persistence_path: args.explorer_persistence_path.clone(),
        explorer_persistence_url: args.explorer_persistence_url.clone(),
        explorer_persistence_buffer: map_optional_limit(args.explorer_persistence_buffer, defaults.explorer_persistence_buffer),
        explorer_persistence_batch_size: map_optional_limit(args.explorer_persistence_batch_size, defaults.explorer_persistence_batch_size),
        explorer_persistence_backpressure,
        summary_persistence_path: args.summary_persistence_path.clone(),
        summary_persistence_max_blocks: map_optional_limit(args.summary_persistence_max_blocks, None),
        enforce_signature_verification: args.enforce_signature_verification,
        state_max_key_versions: map_optional_limit(args.state_max_key_versions, defaults.state_max_key_versions),
        state_max_progress_entries: map_optional_limit(args.state_max_progress_entries, defaults.state_max_progress_entries),
        submission_history_limit: map_optional_limit(args.submission_history_limit, defaults.submission_history_limit),
        seed_history_limit: map_optional_limit(args.seed_history_limit, defaults.seed_history_limit),
        http_rate_limit_per_second: map_optional_limit(args.http_rate_limit_per_second, defaults.http_rate_limit_per_second),
        http_rate_limit_burst: map_optional_limit(args.http_rate_limit_burst, defaults.http_rate_limit_burst),
        submit_rate_limit_per_minute: map_optional_limit(args.submit_rate_limit_per_minute, defaults.submit_rate_limit_per_minute),
        submit_rate_limit_burst: map_optional_limit(args.submit_rate_limit_burst, defaults.submit_rate_limit_burst),
        http_body_limit_bytes: map_optional_limit(args.http_body_limit_bytes, defaults.http_body_limit_bytes),
        ws_outbound_buffer: map_optional_default_on_zero(args.ws_outbound_buffer, defaults.ws_outbound_buffer),
        ws_max_connections: map_optional_limit(args.ws_max_connections, defaults.ws_max_connections),
        ws_max_connections_per_ip: map_optional_limit(args.ws_max_connections_per_ip, defaults.ws_max_connections_per_ip),
        ws_max_message_bytes: map_optional_default_on_zero(args.ws_max_message_bytes, defaults.ws_max_message_bytes),
        updates_broadcast_buffer: map_optional_default_on_zero(args.updates_broadcast_buffer, defaults.updates_broadcast_buffer),
        mempool_broadcast_buffer: map_optional_default_on_zero(args.mempool_broadcast_buffer, defaults.mempool_broadcast_buffer),
        updates_index_concurrency: map_optional_default_on_zero(args.updates_index_concurrency, defaults.updates_index_concurrency),
        fanout_redis_url: args.fanout_redis_url.clone(),
        fanout_channel: args.fanout_channel.clone().or_else(|| defaults.fanout_channel.clone()),
        fanout_origin: args.fanout_origin.clone(),
        fanout_publish: args.fanout_publish.or(defaults.fanout_publish),
        fanout_subscribe: args.fanout_subscribe.or(defaults.fanout_subscribe),
        cache_redis_url: args.cache_redis_url.clone(),
        cache_redis_prefix: args.cache_redis_prefix.clone().or_else(|| defaults.cache_redis_prefix.clone()),
        cache_redis_ttl_seconds: map_optional_limit(args.cache_redis_ttl_seconds, defaults.cache_redis_ttl_seconds),
        backfill_source_url: args.backfill_source_url.clone(),
        backfill_max_blocks: map_optional_limit(args.backfill_max_blocks, defaults.backfill_max_blocks),
    })
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

fn parse_identity_hex(body: &str) -> Result<String> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        anyhow::bail!("empty identity response");
    }
    if trimmed.starts_with('{') {
        let value: Value = serde_json::from_str(trimmed)
            .context("invalid identity response JSON")?;
        if let Some(hex) = value.get("identity").and_then(|value| value.as_str()) {
            return Ok(hex.trim().to_string());
        }
        anyhow::bail!("identity field missing in response JSON");
    }
    Ok(trimmed.to_string())
}

async fn verify_validator_identities(identity: &Identity) -> Result<()> {
    let urls_raw = match std::env::var("VALIDATOR_IDENTITY_URLS") {
        Ok(value) => value,
        Err(_) => return Ok(()),
    };
    let urls = urls_raw
        .split(',')
        .map(|url| url.trim())
        .filter(|url| !url.is_empty())
        .map(|url| url.to_string())
        .collect::<Vec<_>>();
    if urls.is_empty() {
        return Ok(());
    }

    let token = std::env::var("VALIDATOR_IDENTITY_AUTH_TOKEN")
        .ok()
        .and_then(|value| (!value.trim().is_empty()).then_some(value))
        .or_else(|| {
            std::env::var("METRICS_AUTH_TOKEN")
                .ok()
                .and_then(|value| (!value.trim().is_empty()).then_some(value))
        });

    let expected = identity.encode();
    let expected_hex = commonware_utils::hex(expected.as_ref());
    let client = Client::new();
    info!(
        expected = %expected_hex,
        count = urls.len(),
        "verifying validator identities"
    );

    let mut mismatches = Vec::new();
    for url in urls {
        let mut request = client.get(&url);
        if let Some(token) = token.as_deref() {
            request = request.header("x-metrics-token", token);
        }
        let response = request
            .send()
            .await
            .with_context(|| format!("failed to fetch validator identity from {url}"))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .with_context(|| format!("failed to read validator identity from {url}"))?;
        if !status.is_success() {
            anyhow::bail!(
                "validator identity fetch failed ({url}): HTTP {}",
                status.as_u16()
            );
        }
        let identity_hex = parse_identity_hex(&body)
            .with_context(|| format!("invalid identity response from {url}"))?;
        let bytes = commonware_utils::from_hex(&identity_hex)
            .with_context(|| format!("invalid identity hex from {url}"))?;
        let decoded =
            Identity::decode(&mut bytes.as_slice()).with_context(|| format!("decode failed for {url}"))?;
        if decoded.encode().as_ref() != expected.as_ref() {
            mismatches.push((url, commonware_utils::hex(decoded.encode().as_ref())));
        }
    }

    if !mismatches.is_empty() {
        let summary = mismatches
            .into_iter()
            .map(|(url, found)| format!("{url}={found}"))
            .collect::<Vec<_>>()
            .join(", ");
        anyhow::bail!("validator identity mismatch: expected {expected_hex}, found {summary}");
    }

    info!("validator identities verified");
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
    info!(
        identity = %commonware_utils::hex(identity.encode().as_ref()),
        "simulator identity loaded"
    );

    verify_validator_identities(&identity).await?;

    let config = build_config(&args)?;
    let enforce_signature_verification = config.enforce_signature_verification;

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

    if !summaries.is_empty() {
        let total = summaries.len();
        let replay_concurrency = resolve_summary_replay_concurrency(args.summary_replay_concurrency);
        info!(
            total,
            concurrency = replay_concurrency,
            "Replaying persisted summaries"
        );
        let identity = simulator.identity();
        let mut stream = stream::iter(summaries.into_iter().map(|summary| {
            let identity = identity.clone();
            tokio::task::spawn_blocking(move || {
                let digests =
                    verify_persisted_summary(&summary, &identity, enforce_signature_verification);
                (summary, digests)
            })
        }))
        .buffered(replay_concurrency);

        let mut processed = 0usize;
        while let Some(result) = stream.next().await {
            let (summary, digests) = result.context("summary replay task failed")?;
            let (state_digests, events_digests) =
                digests.context("verify persisted summary")?;
            simulator
                .submit_events(summary.clone(), events_digests)
                .await;
            simulator.submit_state(summary, state_digests).await;
            processed += 1;
            if processed % 1000 == 0 || processed == total {
                info!(processed, total, "Replayed persisted summaries");
            }
        }
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
