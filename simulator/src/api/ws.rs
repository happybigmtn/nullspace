use axum::{
    extract::{
        ws::Message, ws::WebSocketUpgrade, ConnectInfo, State as AxumState,
    },
    http::{header::ORIGIN, HeaderMap, StatusCode},
    response::IntoResponse,
};
use commonware_codec::{DecodeExt, Encode};
use commonware_utils::from_hex;
use futures::{SinkExt, StreamExt};
use nullspace_types::{
    api::{Update, UpdatesFilter},
};
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc};
use tokio::time::{timeout, Duration};

use crate::{InternalUpdate, Simulator, WsConnectionGuard, WsConnectionRejection};
use crate::state::EncodedUpdate;

const WS_SEND_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Copy)]
enum WsStreamKind {
    Updates,
    Mempool,
}

type OutboundSender = mpsc::Sender<Message>;
type OutboundReceiver = mpsc::Receiver<Message>;

enum OutboundSendError {
    Closed,
    Full,
}

fn outbound_channel(capacity: usize) -> (OutboundSender, OutboundReceiver) {
    mpsc::channel(capacity)
}

/// Validates the WebSocket Origin header against allowed origins.
/// Returns true if the origin is allowed, false otherwise.
///
/// When `ALLOWED_WS_ORIGINS` is empty, all browser origins are rejected.
/// `ALLOW_WS_NO_ORIGIN` can be set to permit non-browser clients.
fn validate_origin(headers: &HeaderMap) -> bool {
    let allowed = std::env::var("ALLOWED_WS_ORIGINS").unwrap_or_default();
    let allow_no_origin = matches!(
        std::env::var("ALLOW_WS_NO_ORIGIN").as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE") | Ok("yes") | Ok("YES")
    );

    // Get origin from headers
    let origin = match headers.get(ORIGIN) {
        Some(o) => match o.to_str() {
            Ok(s) => s,
            Err(_) => {
                tracing::warn!("Invalid Origin header encoding");
                return false;
            }
        },
        None => {
            // No origin header - could be same-origin or non-browser client
            tracing::debug!("No Origin header in WebSocket request");
            return allow_no_origin;
        }
    };

    // Check if origin is in allowed list
    let allowed_list: Vec<&str> = allowed
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if allowed_list.contains(&origin) {
        tracing::debug!("WebSocket origin validated: {}", origin);
        return true;
    }

    tracing::warn!("WebSocket origin rejected: {} (allowed: {})", origin, allowed);
    false
}

pub(super) async fn updates_ws(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    axum::extract::Path(filter): axum::extract::Path<String>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    // Validate origin
    if !validate_origin(&headers) {
        return (StatusCode::FORBIDDEN, "Origin not allowed").into_response();
    }

    let guard = match simulator.try_acquire_ws_connection(addr.ip()) {
        Ok(guard) => guard,
        Err(reason) => {
            let message = match reason {
                WsConnectionRejection::GlobalLimit => "WebSocket connection limit reached",
                WsConnectionRejection::PerIpLimit => "WebSocket per-IP limit reached",
            };
            return (StatusCode::TOO_MANY_REQUESTS, message).into_response();
        }
    };

    let max_message_bytes = simulator.config.ws_max_message_bytes();
    ws.max_message_size(max_message_bytes)
        .max_frame_size(max_message_bytes)
        .on_upgrade(move |socket| handle_updates_ws(socket, simulator, filter, guard))
        .into_response()
}

pub(super) async fn mempool_ws(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    // Validate origin
    if !validate_origin(&headers) {
        return (StatusCode::FORBIDDEN, "Origin not allowed").into_response();
    }

    let guard = match simulator.try_acquire_ws_connection(addr.ip()) {
        Ok(guard) => guard,
        Err(reason) => {
            let message = match reason {
                WsConnectionRejection::GlobalLimit => "WebSocket connection limit reached",
                WsConnectionRejection::PerIpLimit => "WebSocket per-IP limit reached",
            };
            return (StatusCode::TOO_MANY_REQUESTS, message).into_response();
        }
    };

    let max_message_bytes = simulator.config.ws_max_message_bytes();
    ws.max_message_size(max_message_bytes)
        .max_frame_size(max_message_bytes)
        .on_upgrade(move |socket| handle_mempool_ws(socket, simulator, guard))
        .into_response()
}

async fn handle_updates_ws(
    socket: axum::extract::ws::WebSocket,
    simulator: Arc<Simulator>,
    filter: String,
    _guard: WsConnectionGuard,
) {
    tracing::info!("Updates WebSocket connected, filter: {}", filter);
    let (mut sender, mut receiver) = socket.split();

    // Parse filter from URL path using UpdatesFilter
    let filter = match from_hex(&filter) {
        Some(filter) => filter,
        None => {
            tracing::warn!("Failed to parse filter hex");
            return;
        }
    };
    let subscription = match UpdatesFilter::decode(&mut filter.as_slice()) {
        Ok(subscription) => subscription,
        Err(e) => {
            tracing::warn!("Failed to decode UpdatesFilter: {:?}", e);
            return;
        }
    };
    tracing::info!("UpdatesFilter parsed successfully: {:?}", subscription);

    let (mut updates, _subscription_guard) =
        simulator.tracked_update_subscriber(subscription.clone());
    let (out_tx, mut out_rx) = outbound_channel(simulator.config.ws_outbound_capacity());
    let writer_simulator = simulator.clone();
    let writer_handle = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            match timeout(WS_SEND_TIMEOUT, sender.send(msg)).await {
                Ok(Ok(())) => {}
                Ok(Err(_)) => {
                    record_send_error(&writer_simulator, WsStreamKind::Updates);
                    tracing::warn!("Failed to send update, client disconnected");
                    break;
                }
                Err(_) => {
                    record_send_timeout(&writer_simulator, WsStreamKind::Updates);
                    tracing::warn!("WebSocket send timed out, closing connection");
                    break;
                }
            }
        }
        let _ = sender.close().await;
    });

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
                        let result = enqueue_message(
                            &out_tx,
                            Message::Pong(data),
                            &simulator,
                            WsStreamKind::Updates,
                        );
                        if result.is_err() {
                            tracing::warn!("Failed to enqueue pong, closing connection");
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
                                match &subscription {
                                    UpdatesFilter::Session(_) => None,
                                    _ => Some(EncodedUpdate::new(Update::Seed(seed))),
                                }
                            }
                            InternalUpdate::Events(indexed) => match &subscription {
                                UpdatesFilter::All => {
                                    tracing::debug!("Broadcasting Events update (All filter)");
                                    indexed
                                        .full_update
                                        .clone()
                                        .or_else(|| {
                                            Some(EncodedUpdate::new(Update::Events(
                                                indexed.events.as_ref().clone(),
                                            )))
                                        })
                                }
                                UpdatesFilter::Account(account) => {
                                    tracing::debug!("Fetching indexed events for account");
                                    indexed.update_for_account(account)
                                }
                                UpdatesFilter::Session(session_id) => {
                                    tracing::debug!("Fetching indexed events for session");
                                    indexed.update_for_session(*session_id)
                                }
                            },
                        };
                        let Some(update) = update else {
                            tracing::debug!("Update filtered out");
                            continue;
                        };

                        // Send update
                        tracing::info!("Sending update to WebSocket client");
                        let result = enqueue_message(
                            &out_tx,
                            Message::Binary(update.bytes.as_ref().clone()),
                            &simulator,
                            WsStreamKind::Updates,
                        );
                        if result.is_err() {
                            tracing::warn!("Failed to enqueue update, closing connection");
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(
                            "WebSocket client lagged behind, skipped {} messages. Consider increasing buffer size.",
                            skipped
                        );
                        record_lagged(&simulator, WsStreamKind::Updates, skipped as u64);
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
    drop(out_tx);
    let _ = writer_handle.await;
}

async fn handle_mempool_ws(
    socket: axum::extract::ws::WebSocket,
    simulator: Arc<Simulator>,
    _guard: WsConnectionGuard,
) {
    tracing::info!("Mempool WebSocket connected");
    let (mut sender, mut receiver) = socket.split();
    let mut txs = simulator.mempool_subscriber();
    let (out_tx, mut out_rx) = outbound_channel(simulator.config.ws_outbound_capacity());
    let writer_simulator = simulator.clone();
    let writer_handle = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            match timeout(WS_SEND_TIMEOUT, sender.send(msg)).await {
                Ok(Ok(())) => {}
                Ok(Err(_)) => {
                    record_send_error(&writer_simulator, WsStreamKind::Mempool);
                    tracing::warn!("Failed to send mempool update, client disconnected");
                    break;
                }
                Err(_) => {
                    record_send_timeout(&writer_simulator, WsStreamKind::Mempool);
                    tracing::warn!("Mempool WebSocket send timed out, closing connection");
                    break;
                }
            }
        }
        let _ = sender.close().await;
    });

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
                        let result = enqueue_message(
                            &out_tx,
                            Message::Pong(data),
                            &simulator,
                            WsStreamKind::Mempool,
                        );
                        if result.is_err() {
                            tracing::warn!("Failed to enqueue pong, closing connection");
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
                        let result = enqueue_message(
                            &out_tx,
                            Message::Binary(tx.encode().to_vec()),
                            &simulator,
                            WsStreamKind::Mempool,
                        );
                        if result.is_err() {
                            tracing::warn!("Failed to enqueue mempool update, closing connection");
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(
                            "Mempool WebSocket client lagged behind, skipped {} messages. Consider increasing buffer size.",
                            skipped
                        );
                        record_lagged(&simulator, WsStreamKind::Mempool, skipped as u64);
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
    drop(out_tx);
    let _ = writer_handle.await;
}

fn record_lagged(simulator: &Simulator, kind: WsStreamKind, skipped: u64) {
    match kind {
        WsStreamKind::Updates => simulator.ws_metrics().add_updates_lagged(skipped),
        WsStreamKind::Mempool => simulator.ws_metrics().add_mempool_lagged(skipped),
    }
}

fn record_queue_full(simulator: &Simulator, kind: WsStreamKind) {
    match kind {
        WsStreamKind::Updates => simulator.ws_metrics().inc_updates_queue_full(),
        WsStreamKind::Mempool => simulator.ws_metrics().inc_mempool_queue_full(),
    }
}

fn record_send_error(simulator: &Simulator, kind: WsStreamKind) {
    match kind {
        WsStreamKind::Updates => simulator.ws_metrics().inc_updates_send_error(),
        WsStreamKind::Mempool => simulator.ws_metrics().inc_mempool_send_error(),
    }
}

fn record_send_timeout(simulator: &Simulator, kind: WsStreamKind) {
    match kind {
        WsStreamKind::Updates => simulator.ws_metrics().inc_updates_send_timeout(),
        WsStreamKind::Mempool => simulator.ws_metrics().inc_mempool_send_timeout(),
    }
}

fn enqueue_message(
    sender: &OutboundSender,
    message: Message,
    simulator: &Simulator,
    kind: WsStreamKind,
) -> Result<(), OutboundSendError> {
    match sender.try_send(message) {
        Ok(()) => Ok(()),
        Err(mpsc::error::TrySendError::Full(_)) => {
            record_queue_full(simulator, kind);
            Err(OutboundSendError::Full)
        }
        Err(mpsc::error::TrySendError::Closed(_)) => Err(OutboundSendError::Closed),
    }
}
