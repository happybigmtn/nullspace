use anyhow::Context;
use clap::Parser;
use commonware_codec::DecodeExt;
use nullspace_simulator::{Api, Simulator, SimulatorConfig};
use nullspace_types::Identity;
use std::net::{IpAddr, SocketAddr};
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

    /// Maximum number of blocks retained by the explorer index (unbounded if unset).
    #[arg(long)]
    explorer_max_blocks: Option<usize>,

    /// Maximum number of txs/events retained per account in the explorer (unbounded if unset).
    #[arg(long)]
    explorer_max_account_entries: Option<usize>,
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
    let bytes =
        commonware_utils::from_hex(&args.identity).context("invalid identity hex format")?;
    let identity: Identity =
        Identity::decode(&mut bytes.as_slice()).context("failed to decode identity")?;

    let config = SimulatorConfig {
        explorer_max_blocks: args.explorer_max_blocks,
        explorer_max_account_entries: args.explorer_max_account_entries,
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
