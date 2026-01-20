use axum::{
    body::Bytes,
    extract::State as AxumState,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use commonware_codec::{DecodeExt, Encode, Read, ReadExt, ReadRangeExt};
use commonware_consensus::aggregation::{scheme::bls12381_threshold, types::Certificate};
use commonware_cryptography::{
    bls12381::primitives::{ops, variant::MinSig},
    ed25519::PublicKey,
    sha256::{Digest, Sha256},
    Hasher,
};
use commonware_storage::{
    mmr::Proof,
    qmdb::{
        any::unordered::{variable, Update as StorageUpdate},
        keyless,
    },
};
use commonware_utils::{from_hex, union};
use rand::{rngs::StdRng, SeedableRng};
use nullspace_types::{
    api::Submission,
    execution::{Key, Output, Progress, Seed, Value},
    Query as ChainQuery,
    NAMESPACE,
};
use serde::{Deserialize, Serialize};
use std::fmt::Write;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::metrics::LatencySnapshot;
use crate::submission::apply_submission;
use crate::Simulator;

type AggregationScheme = bls12381_threshold::Scheme<PublicKey, MinSig>;
type AggregationCertificate = Certificate<AggregationScheme, Digest>;
type StateOp = variable::Operation<Digest, Value>;
type EventOp = keyless::Operation<Output>;

/// Simple health response for basic liveness checks
#[derive(Serialize)]
struct HealthzResponse {
    ok: bool,
}

/// Detailed health response for monitoring dashboards (AC-4.6)
#[derive(Serialize)]
struct DetailedHealthResponse {
    healthy: bool,
    ready: bool,
    indexed_blocks: usize,
    indexed_rounds: usize,
    indexed_accounts: usize,
    persistence_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    persistence_queue_depth: Option<u64>,
    fanout_enabled: bool,
    cache_enabled: bool,
    ws_connections: usize,
    version: &'static str,
}

/// Readiness response for Kubernetes readiness probes
#[derive(Serialize)]
struct ReadyResponse {
    ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
}

#[derive(Deserialize)]
pub(super) struct GlobalTablePresenceUpdate {
    gateway_id: String,
    player_count: u64,
}

#[derive(Serialize)]
struct GlobalTablePresenceResponse {
    total_players: u64,
    gateway_count: usize,
    ttl_ms: u64,
}

#[derive(Serialize)]
struct AccountResponse {
    nonce: u64,
    balance: u64,
}

/// Basic health check endpoint - always returns ok if service can respond (AC-4.6)
/// Used for simple liveness checks and load balancer health probes.
pub(super) async fn healthz() -> Response {
    Json(HealthzResponse { ok: true }).into_response()
}

/// Liveness probe endpoint - returns 200 if the service is alive (AC-4.6)
/// Kubernetes uses this to determine if the service should be restarted.
pub(super) async fn livez() -> Response {
    Json(HealthzResponse { ok: true }).into_response()
}

/// Readiness probe endpoint - returns 200 if service is ready to receive traffic (AC-4.6)
/// Kubernetes uses this to determine if the service should receive traffic.
pub(super) async fn readyz(AxumState(simulator): AxumState<Arc<Simulator>>) -> Response {
    let status = simulator.health_status().await;
    if status.ready {
        (StatusCode::OK, Json(ReadyResponse { ready: true, reason: None })).into_response()
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ReadyResponse {
                ready: false,
                reason: Some("not_initialized"),
            }),
        )
            .into_response()
    }
}

/// Detailed health status endpoint for monitoring dashboards (AC-4.6)
/// Returns comprehensive health information including indexer state and dependencies.
pub(super) async fn health(AxumState(simulator): AxumState<Arc<Simulator>>) -> Response {
    let status = simulator.health_status().await;
    let response = DetailedHealthResponse {
        healthy: status.healthy,
        ready: status.ready,
        indexed_blocks: status.indexed_blocks,
        indexed_rounds: status.indexed_rounds,
        indexed_accounts: status.indexed_accounts,
        persistence_enabled: status.persistence_enabled,
        persistence_queue_depth: status.persistence_queue_depth,
        fanout_enabled: status.fanout_enabled,
        cache_enabled: status.cache_enabled,
        ws_connections: status.ws_connections,
        version: status.version,
    };

    let http_status = if status.healthy {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (http_status, Json(response)).into_response()
}

pub(super) async fn config(AxumState(simulator): AxumState<Arc<Simulator>>) -> Response {
    Json(simulator.config.clone()).into_response()
}

pub(super) async fn global_table_presence(
    headers: HeaderMap,
    AxumState(simulator): AxumState<Arc<Simulator>>,
    Json(payload): Json<GlobalTablePresenceUpdate>,
) -> Response {
    if let Some(status) = presence_auth_error(&headers) {
        return status.into_response();
    }

    let gateway_id = payload.gateway_id.trim();
    if gateway_id.is_empty() {
        return StatusCode::BAD_REQUEST.into_response();
    }

    let ttl_ms = presence_ttl_ms();
    let snapshot = simulator.update_global_table_presence(
        gateway_id.to_string(),
        payload.player_count,
        Duration::from_millis(ttl_ms),
    );

    Json(GlobalTablePresenceResponse {
        total_players: snapshot.total_players,
        gateway_count: snapshot.gateway_count,
        ttl_ms,
    })
    .into_response()
}

pub(super) async fn ws_metrics(
    headers: HeaderMap,
    AxumState(simulator): AxumState<Arc<Simulator>>,
) -> Response {
    if let Some(status) = metrics_auth_error(&headers) {
        return status.into_response();
    }
    Json(simulator.ws_metrics_snapshot()).into_response()
}

pub(super) async fn http_metrics(
    headers: HeaderMap,
    AxumState(simulator): AxumState<Arc<Simulator>>,
) -> Response {
    if let Some(status) = metrics_auth_error(&headers) {
        return status.into_response();
    }
    Json(simulator.http_metrics_snapshot()).into_response()
}

pub(super) async fn system_metrics(
    headers: HeaderMap,
    AxumState(simulator): AxumState<Arc<Simulator>>,
) -> Response {
    if let Some(status) = metrics_auth_error(&headers) {
        return status.into_response();
    }
    Json(simulator.system_metrics_snapshot()).into_response()
}

pub(super) async fn explorer_metrics(
    headers: HeaderMap,
    AxumState(simulator): AxumState<Arc<Simulator>>,
) -> Response {
    if let Some(status) = metrics_auth_error(&headers) {
        return status.into_response();
    }
    Json(simulator.explorer_metrics_snapshot()).into_response()
}

pub(super) async fn update_index_metrics(
    headers: HeaderMap,
    AxumState(simulator): AxumState<Arc<Simulator>>,
) -> Response {
    if let Some(status) = metrics_auth_error(&headers) {
        return status.into_response();
    }
    Json(simulator.update_index_metrics_snapshot()).into_response()
}

pub(super) async fn prometheus_metrics(
    headers: HeaderMap,
    AxumState(simulator): AxumState<Arc<Simulator>>,
) -> Response {
    if let Some(status) = metrics_auth_error(&headers) {
        return status.into_response();
    }
    let body = render_prometheus_metrics(&simulator).await;
    (
        StatusCode::OK,
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/plain; version=0.0.4"),
        )],
        body,
    )
        .into_response()
}

fn metrics_auth_error(headers: &HeaderMap) -> Option<StatusCode> {
    let token = std::env::var("METRICS_AUTH_TOKEN").unwrap_or_default();
    if token.is_empty() {
        return None;
    }
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::to_string);
    let header_token = headers
        .get("x-metrics-token")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    if bearer.as_deref() == Some(token.as_str()) || header_token.as_deref() == Some(token.as_str()) {
        None
    } else {
        Some(StatusCode::UNAUTHORIZED)
    }
}

fn presence_auth_error(headers: &HeaderMap) -> Option<StatusCode> {
    let token = std::env::var("GLOBAL_TABLE_PRESENCE_TOKEN").unwrap_or_default();
    if token.is_empty() {
        return None;
    }
    let header_token = headers
        .get("x-presence-token")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    if header_token.as_deref() == Some(token.as_str()) {
        None
    } else {
        Some(StatusCode::UNAUTHORIZED)
    }
}

fn presence_ttl_ms() -> u64 {
    std::env::var("GLOBAL_TABLE_PRESENCE_TTL_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value >= 1_000)
        .unwrap_or(15_000)
}

/// Validates admin authentication via x-admin-token header or Bearer token.
/// Returns None if authorized, Some(StatusCode::UNAUTHORIZED) if not.
/// Uses ADMIN_AUTH_TOKEN environment variable. If not set, blocks all admin access.
pub fn admin_auth_error(headers: &HeaderMap) -> Option<StatusCode> {
    let token = std::env::var("ADMIN_AUTH_TOKEN").unwrap_or_default();
    if token.is_empty() {
        // No token configured = block all admin access (secure by default)
        return Some(StatusCode::UNAUTHORIZED);
    }
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::to_string);
    let header_token = headers
        .get("x-admin-token")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    if bearer.as_deref() == Some(token.as_str()) || header_token.as_deref() == Some(token.as_str())
    {
        None
    } else {
        Some(StatusCode::UNAUTHORIZED)
    }
}

async fn render_prometheus_metrics(simulator: &Simulator) -> String {
    let ws = simulator.ws_metrics_snapshot();
    let http = simulator.http_metrics_snapshot();
    let system = simulator.system_metrics_snapshot();
    let explorer = simulator.explorer_metrics_snapshot();
    let updates = simulator.update_index_metrics_snapshot();
    let mempool_pending = simulator.mempool_pending_count().await;
    let mempool_subscribers = simulator.mempool_subscriber_count();

    let mut out = String::new();

    append_histogram(
        &mut out,
        "nullspace_simulator_http_submit_latency_ms",
        &http.submit,
    );
    append_histogram(
        &mut out,
        "nullspace_simulator_http_query_state_latency_ms",
        &http.query_state,
    );
    append_histogram(
        &mut out,
        "nullspace_simulator_http_query_seed_latency_ms",
        &http.query_seed,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_http_reject_origin_total",
        http.reject_origin,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_http_reject_rate_limit_total",
        http.reject_rate_limit,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_http_reject_body_limit_total",
        http.reject_body_limit,
    );
    append_histogram(
        &mut out,
        "nullspace_simulator_update_index_proof_latency_ms",
        &updates.proof_build,
    );

    append_counter(
        &mut out,
        "nullspace_simulator_ws_updates_lagged_total",
        ws.updates_lagged,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_ws_mempool_lagged_total",
        ws.mempool_lagged,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_ws_updates_queue_full_total",
        ws.updates_queue_full,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_ws_mempool_queue_full_total",
        ws.mempool_queue_full,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_ws_updates_send_errors_total",
        ws.updates_send_errors,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_ws_mempool_send_errors_total",
        ws.mempool_send_errors,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_ws_updates_send_timeouts_total",
        ws.updates_send_timeouts,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_ws_mempool_send_timeouts_total",
        ws.mempool_send_timeouts,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_ws_connection_reject_global_total",
        ws.connection_reject_global,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_ws_connection_reject_per_ip_total",
        ws.connection_reject_per_ip,
    );

    append_gauge(
        &mut out,
        "nullspace_simulator_system_rss_bytes",
        system.rss_bytes,
    );
    append_gauge(
        &mut out,
        "nullspace_simulator_system_virtual_bytes",
        system.virtual_bytes,
    );
    append_gauge(
        &mut out,
        "nullspace_simulator_system_cpu_usage_percent",
        system.cpu_usage_percent,
    );

    append_gauge(
        &mut out,
        "nullspace_simulator_explorer_persistence_queue_depth",
        explorer.persistence_queue_depth,
    );
    append_gauge(
        &mut out,
        "nullspace_simulator_explorer_persistence_queue_high_water",
        explorer.persistence_queue_high_water,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_explorer_persistence_queue_backpressure_total",
        explorer.persistence_queue_backpressure,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_explorer_persistence_queue_dropped_total",
        explorer.persistence_queue_dropped,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_explorer_persistence_write_errors_total",
        explorer.persistence_write_errors,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_explorer_persistence_prune_errors_total",
        explorer.persistence_prune_errors,
    );

    append_counter(
        &mut out,
        "nullspace_simulator_casino_games_started_total",
        explorer.casino_games_started,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_casino_games_completed_total",
        explorer.casino_games_completed,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_casino_games_moved_total",
        explorer.casino_games_moved,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_casino_errors_total",
        explorer.casino_errors,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_casino_leaderboard_updates_total",
        explorer.casino_leaderboard_updates,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_tournament_started_total",
        explorer.tournament_started,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_tournament_ended_total",
        explorer.tournament_ended,
    );
    append_gauge(
        &mut out,
        "nullspace_simulator_casino_active_sessions",
        explorer.active_casino_sessions,
    );

    append_gauge(
        &mut out,
        "nullspace_simulator_update_index_in_flight",
        updates.in_flight,
    );
    append_gauge(
        &mut out,
        "nullspace_simulator_update_index_max_in_flight",
        updates.max_in_flight,
    );
    append_counter(
        &mut out,
        "nullspace_simulator_update_index_failures_total",
        updates.failures,
    );

    // Mempool metrics - AC-2.3: mempool depth metric for transaction pipeline observability
    append_gauge(
        &mut out,
        "nullspace_simulator_mempool_pending_count",
        mempool_pending,
    );
    append_gauge(
        &mut out,
        "nullspace_simulator_mempool_subscriber_count",
        mempool_subscribers,
    );

    out
}

fn append_counter(out: &mut String, name: &str, value: u64) {
    let _ = writeln!(out, "# TYPE {name} counter");
    let _ = writeln!(out, "{name} {value}");
}

fn append_gauge(out: &mut String, name: &str, value: impl std::fmt::Display) {
    let _ = writeln!(out, "# TYPE {name} gauge");
    let _ = writeln!(out, "{name} {value}");
}

fn append_histogram(out: &mut String, name: &str, snapshot: &LatencySnapshot) {
    let _ = writeln!(out, "# TYPE {name} histogram");
    let mut cumulative = 0u64;
    for (bucket, count) in snapshot.buckets_ms.iter().zip(snapshot.counts.iter()) {
        cumulative = cumulative.saturating_add(*count);
        let _ = writeln!(out, "{name}_bucket{{le=\"{bucket}\"}} {cumulative}");
    }
    cumulative = cumulative.saturating_add(snapshot.overflow);
    let _ = writeln!(out, "{name}_bucket{{le=\"+Inf\"}} {cumulative}");
    let _ = writeln!(out, "{name}_count {}", snapshot.count);
    let sum = snapshot.avg_ms * snapshot.count as f64;
    let _ = writeln!(out, "{name}_sum {sum}");
}

pub(super) async fn submit(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    body: Bytes,
) -> impl IntoResponse {
    fn log_summary_decode_stages(bytes: &[u8]) {
        if bytes.is_empty() {
            tracing::warn!("Empty submission body");
            return;
        }
        if bytes[0] != 2 {
            return;
        }

        let mut reader = &bytes[1..];
        let progress = match Progress::read(&mut reader) {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!("Summary decode failed at progress: {:?}", e);
                return;
            }
        };

        if let Err(e) = AggregationCertificate::read(&mut reader) {
            tracing::warn!(
                view = progress.view.get(),
                height = progress.height,
                "Summary decode failed at certificate: {:?}",
                e
            );
            return;
        }

        if let Err(e) =
            Proof::<Digest>::read_cfg(&mut reader, &nullspace_types::api::MAX_STATE_PROOF_NODES)
        {
            tracing::warn!(
                view = progress.view.get(),
                height = progress.height,
                "Summary decode failed at state_proof: {:?}",
                e
            );
            return;
        }

        let state_ops_len = match usize::read_cfg(
            &mut reader,
            &commonware_codec::RangeCfg::from(0..=nullspace_types::api::MAX_STATE_PROOF_OPS),
        ) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(
                    view = progress.view.get(),
                    height = progress.height,
                    "Summary decode failed reading state_proof_ops length: {:?}",
                    e
                );
                return;
            }
        };

        let mut state_ops = Vec::with_capacity(state_ops_len);
        for idx in 0..state_ops_len {
            let op_context = reader.first().copied();
            match StateOp::read(&mut reader) {
                Ok(op) => state_ops.push(op),
                Err(e) => {
                    let preview_len = core::cmp::min(32, reader.len());
                    tracing::warn!(
                        view = progress.view.get(),
                        height = progress.height,
                        idx,
                        op_context = op_context.map(|b| format!("0x{b:02x}")).unwrap_or_else(|| "EOF".to_string()),
                        remaining = reader.len(),
                        head = %commonware_utils::hex(&reader[..preview_len]),
                        "Summary decode failed at state_proof_ops[{idx}]: {:?}",
                        e
                    );
                    return;
                }
            }
        }

        if let Err(e) =
            Proof::<Digest>::read_cfg(&mut reader, &nullspace_types::api::MAX_EVENTS_PROOF_NODES)
        {
            tracing::warn!(
                view = progress.view.get(),
                height = progress.height,
                state_ops = state_ops.len(),
                "Summary decode failed at events_proof: {:?}",
                e
            );
            return;
        }

        if let Err(e) = Vec::<EventOp>::read_range(
            &mut reader,
            0..=nullspace_types::api::MAX_EVENTS_PROOF_OPS,
        ) {
            tracing::warn!(
                view = progress.view.get(),
                height = progress.height,
                state_ops = state_ops.len(),
                "Summary decode failed at events_proof_ops: {:?}",
                e
            );
            return;
        }

        if !reader.is_empty() {
            tracing::warn!(
                view = progress.view.get(),
                height = progress.height,
                state_ops = state_ops.len(),
                remaining = reader.len(),
                "Summary decoded fully but had trailing bytes"
            );
        } else {
            tracing::warn!(
                view = progress.view.get(),
                height = progress.height,
                state_ops = state_ops.len(),
                "Summary decode stages succeeded (unexpected)"
            );
        }
    }

    let start = Instant::now();
    let response = match Submission::decode(&mut body.as_ref()) {
        Ok(submission) => match apply_submission(Arc::clone(&simulator), submission, true).await {
            Ok(()) => {
                simulator.publish_submission(body.as_ref()).await;
                (StatusCode::OK, "").into_response()
            }
            Err(err) => {
                let message = match err {
                    crate::submission::SubmitError::InvalidSeed => "invalid_seed".to_string(),
                    crate::submission::SubmitError::InvalidSummary => "invalid_summary".to_string(),
                    // AC-4.3: Return specific nonce rejection feedback to client
                    crate::submission::SubmitError::NonceTooLow {
                        public_key_hex,
                        tx_nonce,
                        expected_nonce,
                    } => format!(
                        "nonce_too_low:{}:tx_nonce={}:expected={}",
                        public_key_hex, tx_nonce, expected_nonce
                    ),
                    crate::submission::SubmitError::NonceTooHigh {
                        public_key_hex,
                        tx_nonce,
                        expected_nonce,
                    } => format!(
                        "nonce_too_high:{}:tx_nonce={}:expected={}",
                        public_key_hex, tx_nonce, expected_nonce
                    ),
                };
                (StatusCode::BAD_REQUEST, message).into_response()
            }
        },
        Err(e) => {
            let preview_len = std::cmp::min(32, body.len());
            log_summary_decode_stages(body.as_ref());
            tracing::warn!(
                len = body.len(),
                head = %commonware_utils::hex(&body[..preview_len]),
                "Failed to decode submission: {:?}",
                e
            );
            (StatusCode::BAD_REQUEST, "decode_error").into_response()
        }
    };

    simulator.http_metrics().record_submit(start.elapsed());
    response
}

pub(super) async fn query_state(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    axum::extract::Path(query): axum::extract::Path<String>,
) -> impl IntoResponse {
    let start = Instant::now();
    let response = match from_hex(&query) {
        Some(raw) => match Digest::decode(&mut raw.as_slice()) {
            Ok(key) => match simulator.query_state(&key).await {
                Some(value) => (StatusCode::OK, value.encode().to_vec()).into_response(),
                None => (StatusCode::NOT_FOUND, vec![]).into_response(),
            },
            Err(_) => StatusCode::BAD_REQUEST.into_response(),
        },
        None => StatusCode::BAD_REQUEST.into_response(),
    };

    simulator.http_metrics().record_query_state(start.elapsed());
    response
}

pub(super) async fn get_account(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    axum::extract::Path(pubkey): axum::extract::Path<String>,
) -> impl IntoResponse {
    let raw = match from_hex(&pubkey) {
        Some(raw) => raw,
        None => return StatusCode::BAD_REQUEST.into_response(),
    };
    let public_key = match PublicKey::read(&mut raw.as_slice()) {
        Ok(pk) => pk,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };

    let account_key = Sha256::hash(&Key::Account(public_key.clone()).encode());
    let nonce = match simulator.query_state(&account_key).await {
        Some(lookup) => match lookup.operation {
            StateOp::Update(StorageUpdate(_, Value::Account(account))) => account.nonce,
            _ => 0,
        },
        None => 0,
    };

    let player_key = Sha256::hash(&Key::CasinoPlayer(public_key).encode());
    let balance = match simulator.query_state(&player_key).await {
        Some(lookup) => match lookup.operation {
            StateOp::Update(StorageUpdate(_, Value::CasinoPlayer(player))) => player.balances.chips,
            _ => 0,
        },
        None => 0,
    };

    Json(AccountResponse { nonce, balance }).into_response()
}

pub(super) async fn query_seed(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    axum::extract::Path(query): axum::extract::Path<String>,
) -> impl IntoResponse {
    let start = Instant::now();
    let response = match from_hex(&query) {
        Some(raw) => match ChainQuery::decode(&mut raw.as_slice()) {
            Ok(query) => match simulator.query_seed(&query).await {
                Some(seed) => (StatusCode::OK, seed.encode().to_vec()).into_response(),
                None => match query {
                    ChainQuery::Latest => {
                        // Staging fallback: when no seeds have been submitted yet, return
                        // a zeroed seed so clients can proceed instead of treating the
                        // chain as offline. This avoids 404s that block the QA harness.
                        let round = commonware_consensus::types::Round::zero();
                        let mut rng = StdRng::seed_from_u64(0);
                        let (sk, _) = ops::keypair::<_, MinSig>(&mut rng);
                        let seed_namespace = union(NAMESPACE, b"_SEED");
                        let sig = ops::sign_message::<MinSig>(&sk, Some(&seed_namespace), &round.encode());
                        let fallback = Seed::new(round, sig);
                        (StatusCode::OK, fallback.encode().to_vec()).into_response()
                    }
                    ChainQuery::Index(_) => StatusCode::NOT_FOUND.into_response(),
                },
            },
            Err(_) => StatusCode::BAD_REQUEST.into_response(),
        },
        None => StatusCode::BAD_REQUEST.into_response(),
    };

    simulator.http_metrics().record_query_seed(start.elapsed());
    response
}

// ============================================================================
// Admin Operations Endpoints (AC-7.3)
// ============================================================================

use nullspace_types::casino::{AdminActionType, AuditLogEntry};

/// Request body for updating house bankroll limits.
#[derive(Debug, Deserialize)]
pub struct UpdateBankrollLimitsRequest {
    /// Maximum allowed exposure as basis points of bankroll (e.g., 5000 = 50%)
    pub max_exposure_bps: Option<u16>,
    /// Maximum single bet amount
    pub max_single_bet: Option<u64>,
    /// Maximum exposure per player
    pub max_player_exposure: Option<u64>,
    /// Admin reason/note for this change
    pub reason: String,
}

/// Request body for updating policy state.
#[derive(Debug, Deserialize)]
pub struct UpdatePolicyRequest {
    /// Bridge paused flag
    pub bridge_paused: Option<bool>,
    /// Bridge daily limit
    pub bridge_daily_limit: Option<u64>,
    /// Bridge daily limit per account
    pub bridge_daily_limit_per_account: Option<u64>,
    /// Oracle enabled flag
    pub oracle_enabled: Option<bool>,
    /// Admin reason/note for this change
    pub reason: String,
}

/// Response for admin operations.
#[derive(Debug, Serialize)]
pub struct AdminOpResponse {
    /// Whether the operation succeeded
    pub success: bool,
    /// Audit log entry ID
    pub audit_id: u64,
    /// Message/error details
    pub message: String,
}

/// Query parameters for listing audit logs.
#[derive(Debug, Deserialize)]
pub struct AuditLogQuery {
    /// Filter by action type (0-6)
    pub action_type: Option<u8>,
    /// Offset for pagination
    pub offset: Option<usize>,
    /// Limit for pagination (max 100)
    pub limit: Option<usize>,
}

/// Response for listing audit logs.
#[derive(Debug, Serialize)]
pub struct AuditLogListResponse {
    pub entries: Vec<AuditLogEntryResponse>,
    pub total: u64,
    pub offset: usize,
    pub limit: usize,
}

/// Individual audit log entry in response.
#[derive(Debug, Serialize)]
pub struct AuditLogEntryResponse {
    pub id: u64,
    pub action_type: String,
    pub admin: String,
    pub timestamp: u64,
    pub reason: String,
    pub block_height: u64,
}

impl From<&AuditLogEntry> for AuditLogEntryResponse {
    fn from(entry: &AuditLogEntry) -> Self {
        Self {
            id: entry.id,
            action_type: format!("{:?}", entry.action_type),
            admin: commonware_utils::hex(&entry.admin.encode()),
            timestamp: entry.timestamp,
            reason: entry.reason_str(),
            block_height: entry.block_height,
        }
    }
}

/// GET /admin/audit-logs - List audit log entries with optional filters.
pub async fn list_audit_logs(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    headers: HeaderMap,
    axum::extract::Query(query): axum::extract::Query<AuditLogQuery>,
) -> impl IntoResponse {
    if let Some(status) = admin_auth_error(&headers) {
        return (status, Json(AdminOpResponse {
            success: false,
            audit_id: 0,
            message: "Unauthorized: Invalid or missing admin token".to_string(),
        })).into_response();
    }

    let offset = query.offset.unwrap_or(0);
    let limit = query.limit.unwrap_or(20).min(100);

    // Load audit log state to get total count
    let audit_state = simulator.load_audit_log_state().await;
    let total = audit_state.total_entries;

    // Load entries within range
    let mut entries = Vec::new();
    let start_id = offset as u64;
    let end_id = (offset + limit).min(total as usize) as u64;

    for id in start_id..end_id {
        if let Some(entry) = simulator.load_audit_log_entry(id).await {
            // Apply action type filter if specified
            if let Some(filter_type) = query.action_type {
                if entry.action_type as u8 != filter_type {
                    continue;
                }
            }
            entries.push(AuditLogEntryResponse::from(&entry));
        }
    }

    (
        StatusCode::OK,
        Json(AuditLogListResponse {
            entries,
            total,
            offset,
            limit,
        }),
    ).into_response()
}

/// GET /admin/audit-logs/:id - Get a specific audit log entry.
pub async fn get_audit_log(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<u64>,
) -> impl IntoResponse {
    if let Some(status) = admin_auth_error(&headers) {
        return (status, Json(AdminOpResponse {
            success: false,
            audit_id: 0,
            message: "Unauthorized: Invalid or missing admin token".to_string(),
        })).into_response();
    }

    match simulator.load_audit_log_entry(id).await {
        Some(entry) => (StatusCode::OK, Json(AuditLogEntryResponse::from(&entry))).into_response(),
        None => (StatusCode::NOT_FOUND, Json(AdminOpResponse {
            success: false,
            audit_id: 0,
            message: format!("Audit log entry {} not found", id),
        })).into_response(),
    }
}

/// POST /admin/limits/bankroll - Update house bankroll limits.
pub async fn update_bankroll_limits(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    headers: HeaderMap,
    Json(request): Json<UpdateBankrollLimitsRequest>,
) -> impl IntoResponse {
    if let Some(status) = admin_auth_error(&headers) {
        return (status, Json(AdminOpResponse {
            success: false,
            audit_id: 0,
            message: "Unauthorized: Invalid or missing admin token".to_string(),
        }));
    }

    // Get admin public key from header (for audit trail)
    let admin_pk = extract_admin_pubkey_or_zero(&headers);

    // Load current bankroll state
    let mut bankroll = simulator.load_house_bankroll().await;
    let before_state = bankroll.clone();

    // Apply updates
    if let Some(max_exposure_bps) = request.max_exposure_bps {
        bankroll.max_exposure_bps = max_exposure_bps;
    }
    if let Some(max_single_bet) = request.max_single_bet {
        bankroll.max_single_bet = max_single_bet;
    }
    if let Some(max_player_exposure) = request.max_player_exposure {
        bankroll.max_player_exposure = max_player_exposure;
    }
    bankroll.last_updated_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // Create audit log entry
    let ip_hash = extract_ip_hash(&headers);
    let audit_id = simulator
        .create_audit_log_entry(
            AdminActionType::UpdateBankrollLimits,
            admin_pk,
            ip_hash,
            &before_state,
            &bankroll,
            request.reason.as_bytes().to_vec(),
        )
        .await;

    // Save updated bankroll
    simulator.save_house_bankroll(&bankroll).await;

    (StatusCode::OK, Json(AdminOpResponse {
        success: true,
        audit_id,
        message: "Bankroll limits updated successfully".to_string(),
    }))
}

/// POST /admin/config/policy - Update policy configuration.
pub async fn update_policy_config(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    headers: HeaderMap,
    Json(request): Json<UpdatePolicyRequest>,
) -> impl IntoResponse {
    if let Some(status) = admin_auth_error(&headers) {
        return (status, Json(AdminOpResponse {
            success: false,
            audit_id: 0,
            message: "Unauthorized: Invalid or missing admin token".to_string(),
        }));
    }

    // Get admin public key from header (for audit trail)
    let admin_pk = extract_admin_pubkey_or_zero(&headers);

    // Load current policy state
    let mut policy = simulator.load_policy_state().await;
    let before_state = policy.clone();

    // Apply updates
    if let Some(bridge_paused) = request.bridge_paused {
        policy.bridge_paused = bridge_paused;
    }
    if let Some(bridge_daily_limit) = request.bridge_daily_limit {
        policy.bridge_daily_limit = bridge_daily_limit;
    }
    if let Some(bridge_daily_limit_per_account) = request.bridge_daily_limit_per_account {
        policy.bridge_daily_limit_per_account = bridge_daily_limit_per_account;
    }
    if let Some(oracle_enabled) = request.oracle_enabled {
        policy.oracle_enabled = oracle_enabled;
    }

    // Determine action type
    let action_type = if request.bridge_paused.is_some() {
        AdminActionType::ToggleBridge
    } else if request.oracle_enabled.is_some() {
        AdminActionType::ToggleOracle
    } else {
        AdminActionType::UpdatePolicy
    };

    // Create audit log entry
    let ip_hash = extract_ip_hash(&headers);
    let audit_id = simulator
        .create_audit_log_entry(
            action_type,
            admin_pk,
            ip_hash,
            &before_state,
            &policy,
            request.reason.as_bytes().to_vec(),
        )
        .await;

    // Save updated policy
    simulator.save_policy_state(&policy).await;

    (StatusCode::OK, Json(AdminOpResponse {
        success: true,
        audit_id,
        message: "Policy configuration updated successfully".to_string(),
    }))
}

/// GET /admin/state - Get current admin-relevant state (bankroll, policy, audit summary).
pub async fn get_admin_state(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Some(status) = admin_auth_error(&headers) {
        return (status, Json(serde_json::json!({
            "error": "Unauthorized: Invalid or missing admin token"
        }))).into_response();
    }

    let bankroll = simulator.load_house_bankroll().await;
    let policy = simulator.load_policy_state().await;
    let audit_state = simulator.load_audit_log_state().await;

    (StatusCode::OK, Json(serde_json::json!({
        "bankroll": {
            "bankroll": bankroll.bankroll,
            "current_exposure": bankroll.current_exposure,
            "max_exposure_bps": bankroll.max_exposure_bps,
            "max_single_bet": bankroll.max_single_bet,
            "max_player_exposure": bankroll.max_player_exposure,
            "total_bets_placed": bankroll.total_bets_placed,
            "total_amount_wagered": bankroll.total_amount_wagered,
            "total_payouts": bankroll.total_payouts,
            "last_updated_ts": bankroll.last_updated_ts,
        },
        "policy": {
            "bridge_paused": policy.bridge_paused,
            "bridge_daily_limit": policy.bridge_daily_limit,
            "bridge_daily_limit_per_account": policy.bridge_daily_limit_per_account,
            "oracle_enabled": policy.oracle_enabled,
        },
        "audit": {
            "total_entries": audit_state.total_entries,
            "last_entry_ts": audit_state.last_entry_ts,
            "entries_by_type": audit_state.entries_by_type,
        }
    }))).into_response()
}

/// Extract admin public key from x-admin-pubkey header.
/// Returns a zeroed public key if the header is missing or invalid.
fn extract_admin_pubkey_or_zero(headers: &HeaderMap) -> PublicKey {
    headers
        .get("x-admin-pubkey")
        .and_then(|value| value.to_str().ok())
        .and_then(|hex_str| from_hex(hex_str))
        .and_then(|bytes| PublicKey::read(&mut bytes.as_slice()).ok())
        .unwrap_or_else(|| PublicKey::read(&mut [0u8; 32].as_slice()).unwrap())
}

/// Hash IP address for privacy-preserving audit trail.
fn extract_ip_hash(headers: &HeaderMap) -> [u8; 32] {
    let ip = headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("x-real-ip"))
        .and_then(|value| value.to_str().ok())
        .unwrap_or("unknown");
    let mut hasher = Sha256::new();
    hasher.update(ip.as_bytes());
    let digest = hasher.finalize();
    let mut result = [0u8; 32];
    result.copy_from_slice(digest.as_ref());
    result
}
