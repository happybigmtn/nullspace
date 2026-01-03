# L49 - Simulator passkey dev endpoints (from scratch)

Focus files: `simulator/src/passkeys.rs`, `simulator/src/api/mod.rs`

Goal: explain the dev-only passkey flow in the simulator and why it is not production-safe. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Dev-only passkeys
The simulator includes a simplified passkey flow for development. It is feature-gated and stores raw private keys in memory.

### 2) Challenge + session flow
The flow is: get a challenge → register → login → sign messages using a session token.

### 3) Why this is unsafe for production
Real passkey systems never expose private keys. This dev flow generates ed25519 keys on the server and signs on demand.

---

## Limits & management callouts (important)

1) **Feature-gated**
- Passkey endpoints only compile with the `passkeys` feature.
- They are intentionally off by default.

2) **Session TTL = 30 minutes**
- Passkey sessions expire after 30 minutes.
- Shorter TTL reduces risk but increases friction.

3) **Private keys live in memory**
- Credentials store raw ed25519 private keys server-side.
- This is acceptable only in dev environments.

---

## Walkthrough with code excerpts

### 1) Passkey routes are feature-gated
```rust
#[cfg(feature = "passkeys")]
let router = router
    .route(
        "/webauthn/challenge",
        get(crate::passkeys::get_passkey_challenge),
    )
    .route(
        "/webauthn/register",
        post(crate::passkeys::register_passkey),
    )
    .route("/webauthn/login", post(crate::passkeys::login_passkey))
    .route("/webauthn/sign", post(crate::passkeys::sign_with_passkey));
```

Why this matters:
- This ensures the dev-only passkey endpoints are not accidentally enabled in production.

What this code does:
- Registers WebAuthn-like endpoints only when the `passkeys` feature is enabled.

---

### 2) Issuing a challenge
```rust
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
```

Why this matters:
- Challenges prevent replay: you must prove possession at a specific time.

What this code does:
- Generates a random challenge ID.
- Stores it in memory for later validation.
- Returns the challenge to the client.

---

### 3) Registering a dev passkey
```rust
pub(crate) async fn register_passkey(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    Json(req): Json<RegisterRequest>,
) -> impl IntoResponse {
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
```

Why this matters:
- Registration generates the keypair that will later sign transactions.

What this code does:
- Validates the challenge is still available.
- Generates a new ed25519 keypair and stores it in memory.
- Returns the public key to the client.

---

### 4) Logging in and creating a session
```rust
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
        expires_at_ms: now + 30 * 60 * 1000,
    };
    state.passkeys.sessions.insert(token.clone(), session);

    Json(LoginResponse {
        session_token: token,
        credential_id: credential.credential_id,
        ed25519_public_key: credential.ed25519_public_key,
    })
    .into_response()
}
```

Why this matters:
- The session token authorizes future signing requests.

What this code does:
- Validates the challenge.
- Creates a short-lived session token (30 minutes).
- Returns the token and public key.

---

### 5) Signing a message with a session token
```rust
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
```

Why this matters:
- This endpoint turns a dev-only passkey session into actual signatures.

What this code does:
- Validates the bearer token and session expiry.
- Signs the provided hex message using the stored private key.
- Returns the signature and public key.

---

## Key takeaways
- Simulator passkeys are dev-only and feature-gated.
- Challenges and sessions are in-memory and short-lived.
- Private keys are stored server-side, which is unsafe for production.

## Next lesson
L50 - Web vault (passkey/password) storage: `feynman/lessons/L50-web-vault-passkeys.md`
