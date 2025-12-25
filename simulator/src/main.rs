use anyhow::Context;
use clap::Parser;
use commonware_codec::DecodeExt;
use nullspace_simulator::{Api, Simulator, SimulatorConfig};
use nullspace_types::Identity;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use tracing::info;

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
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Parse args
    let args = Args::parse();

    // Create logger
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    // Parse identity
    eprintln!("DEBUG: Identity string len: {}", args.identity.len());
    let bytes =
        commonware_utils::from_hex(&args.identity).context("invalid identity hex format")?;
    eprintln!("DEBUG: Parsed {} bytes from hex identity", bytes.len());
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
    };
    let simulator = Arc::new(Simulator::new_with_config(identity, config));
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
