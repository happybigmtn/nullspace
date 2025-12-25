use axum::{
    body::Bytes, extract::State as AxumState, http::StatusCode, response::IntoResponse, Json,
};
use commonware_codec::{DecodeExt, Encode, Read, ReadExt, ReadRangeExt};
use commonware_consensus::aggregation::types::Certificate;
use commonware_cryptography::{bls12381::primitives::variant::MinSig, sha256::Digest};
use commonware_storage::{
    mmr::verification::Proof,
    store::operation::{Keyless, Variable},
};
use commonware_utils::from_hex;
use nullspace_types::{
    api::{Submission, Summary},
    execution::{Output, Progress, Value},
    Query as ChainQuery, NAMESPACE,
};
use serde::Serialize;
use std::sync::Arc;
use std::time::Instant;

use crate::Simulator;

#[derive(Serialize)]
struct HealthzResponse {
    ok: bool,
}

pub(super) async fn healthz() -> impl IntoResponse {
    Json(HealthzResponse { ok: true })
}

pub(super) async fn config(AxumState(simulator): AxumState<Arc<Simulator>>) -> impl IntoResponse {
    Json(simulator.config.clone())
}

pub(super) async fn ws_metrics(
    AxumState(simulator): AxumState<Arc<Simulator>>,
) -> impl IntoResponse {
    Json(simulator.ws_metrics_snapshot())
}

pub(super) async fn http_metrics(
    AxumState(simulator): AxumState<Arc<Simulator>>,
) -> impl IntoResponse {
    Json(simulator.http_metrics_snapshot())
}

pub(super) async fn system_metrics(
    AxumState(simulator): AxumState<Arc<Simulator>>,
) -> impl IntoResponse {
    Json(simulator.system_metrics_snapshot())
}

pub(super) async fn explorer_metrics(
    AxumState(simulator): AxumState<Arc<Simulator>>,
) -> impl IntoResponse {
    Json(simulator.explorer_metrics_snapshot())
}

pub(super) async fn update_index_metrics(
    AxumState(simulator): AxumState<Arc<Simulator>>,
) -> impl IntoResponse {
    Json(simulator.update_index_metrics_snapshot())
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
        Ok(submission) => match submission {
            Submission::Seed(seed) => {
                if !seed.verify(NAMESPACE, &simulator.identity) {
                    tracing::warn!("Seed verification failed (bad identity or corrupted seed)");
                    StatusCode::BAD_REQUEST
                } else {
                    simulator.submit_seed(seed).await;
                    StatusCode::OK
                }
            }
            Submission::Transactions(txs) => {
                simulator.submit_transactions(txs);
                StatusCode::OK
            }
            Submission::Summary(summary) => submit_summary(simulator.clone(), summary).await,
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

async fn submit_summary(simulator: Arc<Simulator>, summary: Summary) -> StatusCode {
    let (state_digests, events_digests) = match summary.verify(&simulator.identity) {
        Ok(digests) => digests,
        Err(err) => {
            tracing::warn!(
                ?err,
                view = summary.progress.view,
                height = summary.progress.height,
                state_ops = summary.state_proof_ops.len(),
                events_ops = summary.events_proof_ops.len(),
                "Summary verification failed"
            );
            return StatusCode::BAD_REQUEST;
        }
    };

    simulator
        .submit_events(summary.clone(), events_digests)
        .await;
    simulator.submit_state(summary, state_digests).await;
    StatusCode::OK
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
