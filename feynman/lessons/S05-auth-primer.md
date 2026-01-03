# S05 - Auth flows + threat model (from scratch)

Focus: (concepts)

Goal: explain the basic auth flow used by the system and the threat model behind it.

---

## Concepts from scratch (expanded)

### 1) Challenge-response login
The server issues a random challenge. The client signs it with a private key. The server verifies the signature using the public key.

### 2) Sessions and tokens
Once authenticated, the server creates a session (cookie or token). The session represents the logged-in user.

### 3) Threat model
- **Replay attacks**: reuse a valid signature to log in again.
- **Phishing**: trick the user into signing a malicious challenge.
- **Origin spoofing**: use a malicious website to call the auth API.

---

## Limits & management callouts (important)

1) **Challenge TTL must be short**
- Long TTLs increase replay risk.
- Very short TTLs can break login on slow networks.

2) **Origin allowlists are required**
- Browsers can be tricked into calling APIs from untrusted origins.
- Always enforce allowlists for auth endpoints.

---

## Walkthrough with simple examples

### 1) Challenge-response flow
```rust
server -> challenge
client -> sign(challenge)
server -> verify(signature)
```

Why this matters:
- This is the core proof of key ownership.

What this means:
- Only someone with the private key can complete the login.

---

### 2) Replay prevention
```rust
if challenge.used || now > challenge.expires:
  reject
```

Why this matters:
- This prevents attackers from reusing old challenges.

What this means:
- Each challenge is single-use and time-limited.

---

## Key takeaways
- Challenge/response proves key ownership without sharing secrets.
- Sessions carry the authenticated identity forward.
- TTLs and origin checks are critical security controls.

## Next primer
S06 - Payments + webhook idempotency: `feynman/lessons/S06-payments-primer.md`
