use axum::{
    body::Bytes,
    extract::State as AxumState,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use commonware_codec::{DecodeExt, Encode, Read, ReadExt, ReadRangeExt};
use commonware_consensus::aggregation::types::Certificate;
use commonware_cryptography::{
    bls12381::primitives::variant::MinSig,
    sha256::Digest,
};
use commonware_storage::{
    mmr::verification::Proof,
    store::operation::{Keyless, Variable},
};
use commonware_utils::from_hex;
use nullspace_types::{
    api::Submission,
    execution::{Output, Progress, Value},
    Query as ChainQuery,
};
use serde::Serialize;
use std::fmt::Write;
use std::sync::Arc;
use std::time::Instant;

use crate::metrics::LatencySnapshot;
use crate::submission::apply_submission;
use crate::Simulator;

#[derive(Serialize)]
struct HealthzResponse {
    ok: bool,
}

pub(super) async fn healthz() -> Response {
    Json(HealthzResponse { ok: true }).into_response()
}

pub(super) async fn config(AxumState(simulator): AxumState<Arc<Simulator>>) -> Response {
    Json(simulator.config.clone()).into_response()
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
    let body = render_prometheus_metrics(&simulator);
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

fn render_prometheus_metrics(simulator: &Simulator) -> String {
    let ws = simulator.ws_metrics_snapshot();
    let http = simulator.http_metrics_snapshot();
    let system = simulator.system_metrics_snapshot();
    let explorer = simulator.explorer_metrics_snapshot();
    let updates = simulator.update_index_metrics_snapshot();

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

        if let Err(e) = Certificate::<MinSig, Digest>::read(&mut reader) {
            tracing::warn!(
                view = progress.view,
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
                view = progress.view,
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
                    view = progress.view,
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
            match Variable::<Digest, Value>::read(&mut reader) {
                Ok(op) => state_ops.push(op),
                Err(e) => {
                    let preview_len = core::cmp::min(32, reader.len());
                    tracing::warn!(
                        view = progress.view,
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
                view = progress.view,
                height = progress.height,
                state_ops = state_ops.len(),
                "Summary decode failed at events_proof: {:?}",
                e
            );
            return;
        }

        if let Err(e) = Vec::<Keyless<Output>>::read_range(
            &mut reader,
            0..=nullspace_types::api::MAX_EVENTS_PROOF_OPS,
        ) {
            tracing::warn!(
                view = progress.view,
                height = progress.height,
                state_ops = state_ops.len(),
                "Summary decode failed at events_proof_ops: {:?}",
                e
            );
            return;
        }

        if !reader.is_empty() {
            tracing::warn!(
                view = progress.view,
                height = progress.height,
                state_ops = state_ops.len(),
                remaining = reader.len(),
                "Summary decoded fully but had trailing bytes"
            );
        } else {
            tracing::warn!(
                view = progress.view,
                height = progress.height,
                state_ops = state_ops.len(),
                "Summary decode stages succeeded (unexpected)"
            );
        }
    }

    let start = Instant::now();
    let status = match Submission::decode(&mut body.as_ref()) {
        Ok(submission) => match apply_submission(Arc::clone(&simulator), submission, true).await {
            Ok(()) => {
                simulator.publish_submission(body.as_ref()).await;
                StatusCode::OK
            }
            Err(_) => StatusCode::BAD_REQUEST,
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
            StatusCode::BAD_REQUEST
        }
    };

    simulator.http_metrics().record_submit(start.elapsed());
    status
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

pub(super) async fn query_seed(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    axum::extract::Path(query): axum::extract::Path<String>,
) -> impl IntoResponse {
    let start = Instant::now();
    let response = match from_hex(&query) {
        Some(raw) => match ChainQuery::decode(&mut raw.as_slice()) {
            Ok(query) => match simulator.query_seed(&query).await {
                Some(seed) => (StatusCode::OK, seed.encode().to_vec()).into_response(),
                None => (StatusCode::NOT_FOUND, vec![]).into_response(),
            },
            Err(_) => StatusCode::BAD_REQUEST.into_response(),
        },
        None => StatusCode::BAD_REQUEST.into_response(),
    };

    simulator.http_metrics().record_query_seed(start.elapsed());
    response
}
