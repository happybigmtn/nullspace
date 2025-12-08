//! Development executor - processes transactions submitted to the simulator
//!
//! This is a simple executor for local development that:
//! 1. Connects to the simulator's mempool WebSocket
//! 2. Collects pending transactions
//! 3. Executes blocks periodically
//! 4. Submits block summaries back to the simulator

use nullspace_client::Client;
use nullspace_execution::mocks::{create_adbs, create_network_keypair, execute_block};
use nullspace_types::{api, execution::Transaction, Identity};
use clap::Parser;
use commonware_codec::DecodeExt;
use commonware_runtime::{tokio as cw_tokio, Clock, Runner};
use futures_util::StreamExt;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, warn};

#[derive(Parser, Debug)]
#[command(author, version, about = "Development executor for local testing")]
struct Args {
    #[arg(short, long, default_value = "http://localhost:8080")]
    url: String,

    #[arg(short, long)]
    identity: String,

    #[arg(short, long, default_value = "100")]
    block_interval_ms: u64,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Parse args
    let args = Args::parse();

    // Setup logging
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .init();

    // Parse identity
    let identity_bytes =
        commonware_utils::from_hex(&args.identity).ok_or("Invalid identity hex format")?;
    let identity: Identity =
        Identity::decode(&mut identity_bytes.as_slice()).map_err(|_| "Failed to decode identity")?;

    // Get network secret from the same seed used to create identity
    let (network_secret, network_identity) = create_network_keypair();

    // Verify identity matches
    if network_identity != identity {
        return Err("Identity mismatch - use the identity from get_identity example".into());
    }

    info!(url = %args.url, "Starting dev executor");

    // Create client
    let client = Client::new(&args.url, identity);
    let ws_url = format!("{}/mempool", args.url.replace("http://", "ws://"));
    let block_interval_ms = args.block_interval_ms;

    // Run executor using commonware runtime
    let executor = cw_tokio::Runner::default();
    executor.start(|context| async move {
        // Create state and events databases
        let (mut state, mut events) = create_adbs(&context).await;
        let mut pending_txs: Vec<Transaction> = Vec::new();
        let mut view: u64 = 1;

        // Connect to mempool using tokio-tungstenite directly
        info!(url = %ws_url, "Connecting to mempool...");
        let (ws_stream, _) = match tokio_tungstenite::connect_async(&ws_url).await {
            Ok(result) => result,
            Err(e) => {
                warn!(?e, "Failed to connect to mempool");
                return;
            }
        };
        info!("WebSocket connected");

        let (_, mut read) = ws_stream.split();
        let block_interval = Duration::from_millis(block_interval_ms);

        loop {
            // Use tokio::select! to handle both the timer and WebSocket
            tokio::select! {
                // Wait for block interval
                _ = context.sleep(block_interval) => {
                    // Check for pending transactions
                    if pending_txs.is_empty() {
                        continue;
                    }

                    let txs = std::mem::take(&mut pending_txs);
                    info!(count = txs.len(), view, "Executing block");

                    // Execute block
                    let (seed, summary) = execute_block(
                        &network_secret,
                        network_identity,
                        &mut state,
                        &mut events,
                        view,
                        txs,
                    )
                    .await;

                    // Verify and get digests
                    let Some((_state_digests, _events_digests)) = summary.verify(&network_identity) else {
                        warn!("Summary verification failed");
                        continue;
                    };

                    // Submit seed first
                    if let Err(e) = client.submit_seed(seed).await {
                        warn!(?e, "Failed to submit seed");
                    }

                    // Submit summary
                    if let Err(e) = client.submit_summary(summary).await {
                        warn!(?e, "Failed to submit summary");
                    }

                    info!(view, "Block executed and submitted");
                    view += 1;
                }

                // Process WebSocket messages
                msg = read.next() => {
                    match msg {
                        Some(Ok(Message::Binary(data))) => {
                            info!(len = data.len(), "Received binary message from mempool");
                            match api::Pending::decode(&mut data.as_slice()) {
                                Ok(pending) => {
                                    info!(count = pending.transactions.len(), "Received transactions from mempool");
                                    pending_txs.extend(pending.transactions);
                                }
                                Err(e) => {
                                    warn!(?e, "Failed to decode Pending");
                                }
                            }
                        }
                        Some(Ok(Message::Text(text))) => {
                            info!(text = %text, "Received text message from mempool");
                        }
                        Some(Ok(Message::Ping(_))) => {
                            info!("Received ping from mempool");
                        }
                        Some(Ok(Message::Pong(_))) => {
                            info!("Received pong from mempool");
                        }
                        Some(Ok(Message::Close(frame))) => {
                            warn!(?frame, "Mempool WebSocket closed");
                            break;
                        }
                        Some(Ok(Message::Frame(_))) => {
                            info!("Received raw frame from mempool");
                        }
                        Some(Err(e)) => {
                            warn!(?e, "Mempool WebSocket error");
                            break;
                        }
                        None => {
                            warn!("Mempool WebSocket stream ended");
                            break;
                        }
                    }
                }
            }
        }
    });

    Ok(())
}
