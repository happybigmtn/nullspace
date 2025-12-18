use axum::{
    extract::{ws::WebSocketUpgrade, State as AxumState},
    response::IntoResponse,
};
use commonware_codec::{DecodeExt, Encode};
use commonware_cryptography::{ed25519::PublicKey, sha256::Digest};
use commonware_storage::adb::{create_multi_proof, create_proof_store_from_digests};
use commonware_storage::store::operation::Keyless;
use commonware_utils::from_hex;
use futures::{SinkExt, StreamExt};
use nullspace_types::{
    api::{Events, FilteredEvents, Update, UpdatesFilter},
    execution::{Event, Output},
};
use std::sync::Arc;
use tokio::sync::broadcast;

use crate::{InternalUpdate, Simulator};

pub(super) async fn updates_ws(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    axum::extract::Path(filter): axum::extract::Path<String>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_updates_ws(socket, simulator, filter))
}

pub(super) async fn mempool_ws(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_mempool_ws(socket, simulator))
}

async fn handle_updates_ws(
    socket: axum::extract::ws::WebSocket,
    simulator: Arc<Simulator>,
    filter: String,
) {
    tracing::info!("Updates WebSocket connected, filter: {}", filter);
    let (mut sender, mut receiver) = socket.split();
    let mut updates = simulator.update_subscriber();

    // Parse filter from URL path using UpdatesFilter
    let filter = match from_hex(&filter) {
        Some(filter) => filter,
        None => {
            tracing::warn!("Failed to parse filter hex");
            let _ = sender.close().await;
            return;
        }
    };
    let subscription = match UpdatesFilter::decode(&mut filter.as_slice()) {
        Ok(subscription) => subscription,
        Err(e) => {
            tracing::warn!("Failed to decode UpdatesFilter: {:?}", e);
            let _ = sender.close().await;
            return;
        }
    };
    tracing::info!("UpdatesFilter parsed successfully: {:?}", subscription);

    // Send updates based on subscription
    loop {
        tokio::select! {
            // Handle incoming WebSocket messages (ping/pong/close)
            msg = receiver.next() => {
                match msg {
                    Some(Ok(axum::extract::ws::Message::Close(_))) => {
                        tracing::info!("Client closed WebSocket connection");
                        break;
                    }
                    Some(Ok(axum::extract::ws::Message::Ping(data))) => {
                        if sender.send(axum::extract::ws::Message::Pong(data)).await.is_err() {
                            tracing::warn!("Failed to send pong, client disconnected");
                            break;
                        }
                    }
                    Some(Err(e)) => {
                        tracing::warn!("WebSocket error: {:?}", e);
                        break;
                    }
                    None => {
                        tracing::info!("WebSocket stream ended");
                        break;
                    }
                    _ => {} // Ignore other message types
                }
            }
            // Handle broadcast updates
            update_result = updates.recv() => {
                match update_result {
                    Ok(internal_update) => {
                        tracing::debug!("Received internal update");
                        // Convert InternalUpdate to Update and apply filtering
                        let update = match internal_update {
                            InternalUpdate::Seed(seed) => {
                                tracing::debug!("Broadcasting Seed update");
                                Some(Update::Seed(seed))
                            }
                            InternalUpdate::Events(events, digests) => match &subscription {
                                UpdatesFilter::All => {
                                    tracing::debug!("Broadcasting Events update (All filter)");
                                    Some(Update::Events(events))
                                }
                                UpdatesFilter::Account(account) => {
                                    tracing::debug!("Filtering Events for account");
                                    filter_updates_for_account(events, digests, account).await
                                }
                            },
                        };
                        let Some(update) = update else {
                            tracing::debug!("Update filtered out");
                            continue;
                        };

                        // Send update
                        tracing::info!("Sending update to WebSocket client");
                        if sender
                            .send(axum::extract::ws::Message::Binary(update.encode().to_vec()))
                            .await
                            .is_err()
                        {
                            tracing::warn!("Failed to send update, client disconnected");
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(
                            "WebSocket client lagged behind, skipped {} messages. Consider increasing buffer size.",
                            skipped
                        );
                        // Continue receiving - client may catch up
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        tracing::info!("Broadcast channel closed");
                        break;
                    }
                }
            }
        }
    }
    tracing::info!("Updates WebSocket handler exiting");
    let _ = sender.close().await;
}

async fn handle_mempool_ws(socket: axum::extract::ws::WebSocket, simulator: Arc<Simulator>) {
    tracing::info!("Mempool WebSocket connected");
    let (mut sender, mut receiver) = socket.split();
    let mut txs = simulator.mempool_subscriber();

    loop {
        tokio::select! {
            // Handle incoming WebSocket messages (ping/pong/close)
            msg = receiver.next() => {
                match msg {
                    Some(Ok(axum::extract::ws::Message::Close(_))) => {
                        tracing::info!("Client closed mempool WebSocket connection");
                        break;
                    }
                    Some(Ok(axum::extract::ws::Message::Ping(data))) => {
                        if sender.send(axum::extract::ws::Message::Pong(data)).await.is_err() {
                            tracing::warn!("Failed to send pong, client disconnected");
                            break;
                        }
                    }
                    Some(Err(e)) => {
                        tracing::warn!("Mempool WebSocket error: {:?}", e);
                        break;
                    }
                    None => {
                        tracing::info!("Mempool WebSocket stream ended");
                        break;
                    }
                    _ => {} // Ignore other message types
                }
            }
            // Handle broadcast transactions
            tx_result = txs.recv() => {
                match tx_result {
                    Ok(tx) => {
                        if sender
                            .send(axum::extract::ws::Message::Binary(tx.encode().to_vec()))
                            .await
                            .is_err()
                        {
                            tracing::warn!("Failed to send mempool update, client disconnected");
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(
                            "Mempool WebSocket client lagged behind, skipped {} messages. Consider increasing buffer size.",
                            skipped
                        );
                        // Continue receiving - client may catch up
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        tracing::info!("Mempool broadcast channel closed");
                        break;
                    }
                }
            }
        }
    }
    tracing::info!("Mempool WebSocket handler exiting");
    let _ = sender.close().await;
}

pub(crate) async fn filter_updates_for_account(
    events: Events,
    digests: Vec<(u64, Digest)>,
    account: &PublicKey,
) -> Option<Update> {
    // Determine which operations to include
    let mut filtered_ops = Vec::new();
    for (i, op) in events.events_proof_ops.into_iter().enumerate() {
        let should_include = match &op {
            Keyless::Append(output) => match output {
                Output::Event(event) => is_event_relevant_to_account(event, account),
                Output::Transaction(tx) => tx.public == *account,
                _ => false,
            },
            Keyless::Commit(_) => false,
        };
        if should_include {
            // Convert index to absolute location
            filtered_ops.push((events.progress.events_start_op + i as u64, op));
        }
    }

    // If no relevant events, skip this update entirely
    if filtered_ops.is_empty() {
        return None;
    }

    // Create a ProofStore directly from the pre-verified digests
    // Use the size from the original proof, not the operation count
    let proof_store = create_proof_store_from_digests(&events.events_proof, digests);

    // Generate a filtered proof for only the relevant locations
    let locations_to_include = filtered_ops.iter().map(|(loc, _)| *loc).collect::<Vec<_>>();
    let filtered_proof = match create_multi_proof(&proof_store, &locations_to_include).await {
        Ok(proof) => proof,
        Err(e) => {
            tracing::error!("Failed to generate filtered proof: {:?}", e);
            return None;
        }
    };
    Some(Update::FilteredEvents(FilteredEvents {
        progress: events.progress,
        certificate: events.certificate,
        events_proof: filtered_proof,
        events_proof_ops: filtered_ops,
    }))
}

fn is_event_relevant_to_account(event: &Event, account: &PublicKey) -> bool {
    match event {
        // Casino events - check if player matches
        Event::CasinoPlayerRegistered { player, .. } => player == account,
        Event::CasinoDeposited { player, .. } => player == account,
        Event::CasinoGameStarted { player, .. } => player == account,
        Event::CasinoGameMoved { .. } => true, // Broadcast all moves - clients filter by session_id
        Event::CasinoGameCompleted { player, .. } => player == account,
        Event::CasinoLeaderboardUpdated { .. } => true, // Leaderboard updates are public
        Event::CasinoError { player, .. } => player == account,
        Event::PlayerModifierToggled { player, .. } => player == account,
        // Tournament events
        Event::TournamentStarted { .. } => true, // Tournament start is public
        Event::PlayerJoined { player, .. } => player == account,
        Event::TournamentPhaseChanged { .. } => true, // Phase changes are public
        Event::TournamentEnded { rankings, .. } => {
            // Check if account is in the rankings
            rankings.iter().any(|(player, _)| player == account)
        }
        // Liquidity / Vault events
        Event::VaultCreated { player } => player == account,
        Event::CollateralDeposited { player, .. } => player == account,
        Event::VusdtBorrowed { player, .. } => player == account,
        Event::VusdtRepaid { player, .. } => player == account,
        Event::AmmSwapped { player, .. } => player == account,
        Event::LiquidityAdded { player, .. } => player == account,
        Event::LiquidityRemoved { player, .. } => player == account,
        // Staking events
        Event::Staked { player, .. } => player == account,
        Event::Unstaked { player, .. } => player == account,
        Event::RewardsClaimed { player, .. } => player == account,
        Event::EpochProcessed { .. } => true,
    }
}
