use axum::{
    extract::State as AxumState,
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use commonware_cryptography::ed25519;
use commonware_cryptography::Signer;
use commonware_math::algebra::Random;
use commonware_utils::{from_hex, hex};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};
use uuid::Uuid;

use crate::Simulator;

#[derive(Clone, Serialize, Deserialize)]
pub struct PasskeyChallenge {
    challenge: String,
    issued_at_ms: u64,
}

#[derive(Clone)]
pub struct PasskeyCredential {
    credential_id: String,
    ed25519_public_key: String,
    ed25519_private_key: ed25519::PrivateKey,
}

#[derive(Clone)]
pub struct PasskeySession {
    credential_id: String,
    expires_at_ms: u64,
}

#[derive(Default)]
pub struct PasskeyStore {
    pub(super) challenges: HashMap<String, PasskeyChallenge>,
    pub(super) credentials: HashMap<String, PasskeyCredential>,
    pub(super) sessions: HashMap<String, PasskeySession>,
}

#[derive(Serialize)]
struct ChallengeResponse {
    challenge: String,
}

pub(crate) async fn get_passkey_challenge(
    AxumState(simulator): AxumState<Arc<Simulator>>,
) -> impl IntoResponse {
    let challenge = Uuid::new_v4().to_string().replace('-', "");
    let issued_at_ms = Simulator::now_ms();
    let passkey_challenge = PasskeyChallenge {
        challenge: challenge.clone(),
        issued_at_ms,
    };

    let mut state = simulator.state.write().await;
    state
        .passkeys
        .challenges
        .insert(challenge.clone(), passkey_challenge);

    Json(ChallengeResponse { challenge }).into_response()
}

#[derive(Deserialize)]
pub(crate) struct RegisterRequest {
    credential_id: String,
    webauthn_public_key: String,
    challenge: String,
}

#[derive(Serialize)]
struct RegisterResponse {
    credential_id: String,
    ed25519_public_key: String,
}

pub(crate) async fn register_passkey(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    Json(req): Json<RegisterRequest>,
) -> impl IntoResponse {
    let RegisterRequest {
        credential_id,
        webauthn_public_key: _webauthn_public_key,
        challenge,
    } = req;
    let mut state = simulator.state.write().await;

    if state.passkeys.challenges.remove(&challenge).is_none() {
        return StatusCode::BAD_REQUEST.into_response();
    }

    let mut rng = OsRng;
    let private = ed25519::PrivateKey::random(&mut rng);
    let public = private.public_key();

    let cred = PasskeyCredential {
        credential_id: credential_id.clone(),
        ed25519_public_key: hex(public.as_ref()),
        ed25519_private_key: private,
    };

    state
        .passkeys
        .credentials
        .insert(credential_id.clone(), cred);

    Json(RegisterResponse {
        credential_id,
        ed25519_public_key: hex(public.as_ref()),
    })
    .into_response()
}

#[derive(Deserialize)]
pub(crate) struct LoginRequest {
    credential_id: String,
    challenge: String,
}

#[derive(Serialize)]
struct LoginResponse {
    session_token: String,
    credential_id: String,
    ed25519_public_key: String,
}

pub(crate) async fn login_passkey(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    Json(req): Json<LoginRequest>,
) -> impl IntoResponse {
    let mut state = simulator.state.write().await;

    if state.passkeys.challenges.remove(&req.challenge).is_none() {
        return StatusCode::BAD_REQUEST.into_response();
    }

    let credential = match state.passkeys.credentials.get(&req.credential_id) {
        Some(c) => c.clone(),
        None => return StatusCode::NOT_FOUND.into_response(),
    };

    let token = Uuid::new_v4().to_string();
    let now = Simulator::now_ms();
    let session = PasskeySession {
        credential_id: credential.credential_id.clone(),
        expires_at_ms: now + 30 * 60 * 1000, // 30 minutes
    };
    state.passkeys.sessions.insert(token.clone(), session);

    Json(LoginResponse {
        session_token: token,
        credential_id: credential.credential_id,
        ed25519_public_key: credential.ed25519_public_key,
    })
    .into_response()
}

#[derive(Deserialize)]
pub(crate) struct SignRequest {
    message_hex: String,
}

#[derive(Serialize)]
struct SignResponse {
    signature_hex: String,
    public_key: String,
}

pub(crate) async fn sign_with_passkey(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    headers: HeaderMap,
    Json(req): Json<SignRequest>,
) -> impl IntoResponse {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string());

    let token = match token {
        Some(t) => t,
        None => return StatusCode::UNAUTHORIZED.into_response(),
    };

    let credential = {
        let mut state = simulator.state.write().await;
        let session = match state.passkeys.sessions.get(&token) {
            Some(s) => s.clone(),
            None => return StatusCode::UNAUTHORIZED.into_response(),
        };

        if session.expires_at_ms < Simulator::now_ms() {
            state.passkeys.sessions.remove(&token);
            return StatusCode::UNAUTHORIZED.into_response();
        }

        match state.passkeys.credentials.get(&session.credential_id) {
            Some(c) => c.clone(),
            None => return StatusCode::UNAUTHORIZED.into_response(),
        }
    };

    let raw = match from_hex(&req.message_hex) {
        Some(raw) => raw,
        None => return StatusCode::BAD_REQUEST.into_response(),
    };
    let signature = credential.ed25519_private_key.sign(
        Some(nullspace_types::execution::TRANSACTION_NAMESPACE),
        &raw,
    );

    Json(SignResponse {
        signature_hex: hex(signature.as_ref()),
        public_key: credential.ed25519_public_key,
    })
    .into_response()
}
