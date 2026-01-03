# L07 - Submission routing inside the simulator (from scratch)

Focus file: `simulator/src/submission.rs`

Goal: explain how the simulator validates incoming submissions (seed, transactions, summary) and how admin transactions are logged. For every excerpt, you will see **why it matters** and a **plain description of what the code does**. We only explain syntax when it is genuinely tricky.

---

## Concepts from scratch (expanded)

### 1) What is a submission?
The gateway sends the simulator a **Submission**. It can contain:
- **Seed**: a randomness seed for a round.
- **Transactions**: user actions (bets, moves, deposits).
- **Summary**: a consensus checkpoint with proofs and digests.

The simulator’s job is to accept only valid submissions and reject bad ones.

### 2) Why multiple submission types?
Different data serves different purposes:
- **Seeds** establish randomness.
- **Transactions** mutate state.
- **Summaries** sync the simulator to consensus in a verifiable way.

### 3) Threshold signatures (BLS) in one paragraph
Validators collectively sign the same message. Instead of sending N signatures, they combine them into a **single certificate**. Verification checks that:
1) the signers are valid validators, and
2) the threshold was met.

### 4) Domain separation (`NAMESPACE`)
A signature can be “reused” in a different context if the same hash is signed. Domain separation adds a fixed label (namespace) so a signature for one message type cannot be replayed as another.

### 5) Summary verification
Summaries include proofs for state and event changes. Verifying a summary yields:
- **state digests** (commitments to state changes),
- **event digests** (commitments to emitted events).

If these digests do not match, the simulator must reject the summary.

### 6) Why log admin transactions?
Admin actions change core rules (policy, treasury, oracle prices). Logging them creates an audit trail so you can see who did what and when.

---

## Limits and management callouts (important)

1) **No rate limits here**
- This file assumes request limits are enforced earlier (HTTP layer or gateway).
- If the upstream filter fails, this code will happily attempt to process everything.

2) **Admin logs are sensitive**
- Logs include admin public keys and tx hashes. That is usually safe, but treat logs as sensitive operational data.

3) **Audit hash is lossy**
- For large admin payloads (policy, treasury), only a hash is logged.
- This keeps logs small but makes debugging harder if you need full content later.

4) **Error reporting is coarse**
- `SubmitError` only distinguishes `InvalidSeed` and `InvalidSummary`.
- Transaction failures at this layer do not return a reason.

---

## Walkthrough with code excerpts

### 1) Submission error type
```rust
#[derive(Debug)]
pub enum SubmitError {
    InvalidSeed,
    InvalidSummary,
}
```

Why this matters:
- Clear error categories make it obvious why a submission was rejected.

What this code does:
- Defines two rejection reasons the caller can report or log.
- Keeps the error surface small so upstream code can map errors to HTTP status codes.

Syntax notes:
- `enum` declares a type with multiple variants.
- `#[derive(Debug)]` lets the error be printed in logs with `{:?}`.

---

### 2) Top-level submission dispatcher
```rust
pub async fn apply_submission(
    simulator: Arc<Simulator>,
    submission: Submission,
    log_admin: bool,
) -> Result<(), SubmitError> {
    match submission {
        Submission::Seed(seed) => { /* ... */ }
        Submission::Transactions(txs) => { /* ... */ }
        Submission::Summary(summary) => { /* ... */ }
    }
}
```

Why this matters:
- This is the central routing point for all submissions. Every incoming payload ends up here.

What this code does:
- Pattern-matches the submission and delegates to the correct validation path.
- Ensures exactly one of seed/transactions/summary code paths runs for any submission.

Syntax notes:
- `match submission { ... }` is exhaustive; every variant must be handled.
- `Arc<Simulator>` means shared ownership of the simulator across async tasks.

---

### 3) Seed verification path
```rust
Submission::Seed(seed) => {
    let verifier =
        bls12381_threshold::Scheme::<PublicKey, MinSig>::certificate_verifier(
            simulator.identity.clone(),
        );
    if !seed.verify(&verifier, NAMESPACE) {
        tracing::warn!("Seed verification failed (bad identity or corrupted seed)");
        return Err(SubmitError::InvalidSeed);
    }
    simulator.submit_seed(seed).await;
    Ok(())
}
```

Why this matters:
- Seeds decide randomness. If a bad seed is accepted, the game can be manipulated.

What this code does:
- Builds a threshold certificate verifier from the simulator identity.
- Verifies the seed’s certificate with domain separation (`NAMESPACE`).
- Logs a warning and returns `InvalidSeed` if verification fails.
- Submits the seed to the simulator on success.

Syntax notes:
- `Scheme::<PublicKey, MinSig>` explicitly fills in generic type parameters.
- `simulator.identity.clone()` clones the identity so the simulator remains usable elsewhere.

---

### 4) Transactions path (with admin logging)
```rust
Submission::Transactions(txs) => {
    if log_admin {
        log_admin_transactions(&txs);
    }
    simulator.submit_transactions(txs);
    Ok(())
}
```

Why this matters:
- This is the entry point for all user actions. If it fails, the game never advances.

What this code does:
- Optionally logs any admin transactions in the batch.
- Passes the transactions into the simulator for execution.
- Returns `Ok(())` without further validation because signature/nonce checks happen elsewhere.

Syntax notes:
- `log_admin` is a flag passed in by the HTTP handler to control audit logging.

---

### 5) Summary verification path
```rust
Submission::Summary(summary) => {
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
            return Err(SubmitError::InvalidSummary);
        }
    };
    simulator
        .submit_events(summary.clone(), events_digests)
        .await;
    simulator.submit_state(summary, state_digests).await;
    Ok(())
}
```

Why this matters:
- Summaries are the bridge between consensus and state. Accepting a bad one corrupts the chain state.

What this code does:
- Verifies the summary using the simulator’s identity.
- Logs rich context if verification fails (view, height, ops counts).
- On success, extracts state and event digests from the verification result.
- Submits event digests first, then state digests, to keep event indexing ahead of state queries.

Syntax notes:
- `match summary.verify(...)` allows fine-grained logging on error.
- `summary.clone()` is required because `submit_state` consumes the summary later.

---

### 6) Hashing for audit logs
```rust
fn audit_hash<T: Encode>(value: &T) -> String {
    let bytes = value.encode();
    let mut hasher = Sha256::new();
    hasher.update(bytes.as_ref());
    hex(hasher.finalize().as_ref())
}
```

Why this matters:
- Admin payloads can be large. Hashing keeps logs short while still allowing integrity checks.

What this code does:
- Encodes a value into bytes.
- Hashes with SHA‑256.
- Returns the hex string so logs stay compact and readable.

Syntax notes:
- `T: Encode` is a trait bound: any type that can be encoded is accepted.

---

### 7) Admin transaction logging (representative patterns)
```rust
fn log_admin_transactions(txs: &[Transaction]) {
    for tx in txs {
        let admin = hex(&tx.public.encode());
        let tx_hash = hex(tx.digest().as_ref());
        match &tx.instruction {
            Instruction::SetPolicy { policy } => {
                tracing::info!(
                    action = "set_policy",
                    admin = %admin,
                    tx_hash = %tx_hash,
                    nonce = tx.nonce,
                    policy_hash = %audit_hash(policy),
                    "admin transaction submitted"
                );
            }
            Instruction::UpdateOracle {
                price_vusdt_numerator,
                price_rng_denominator,
                updated_ts,
                source,
            } => {
                tracing::info!(
                    action = "update_oracle",
                    admin = %admin,
                    tx_hash = %tx_hash,
                    nonce = tx.nonce,
                    price_vusdt_numerator = *price_vusdt_numerator,
                    price_rng_denominator = *price_rng_denominator,
                    updated_ts = *updated_ts,
                    source_len = source.len(),
                    "admin transaction submitted"
                );
            }
            _ => {}
        }
    }
}
```

Why this matters:
- Logs make admin actions auditable. Without them, privileged changes are invisible.

What this code does:
- Iterates every transaction in the batch.
- Computes the admin public key and transaction hash for logging context.
- Logs only the admin-related instructions and ignores user actions.
- Uses hashes or sizes for large payload fields to avoid log bloat.

Syntax notes:
- `match &tx.instruction` matches by reference so the instruction is not moved.
- `source_len = source.len()` logs size rather than full data.

---

## Key takeaways
- The simulator accepts three submission types and validates each differently.
- Seed and summary verification protect randomness and state integrity.
- Admin transactions are logged for audit, with hashes to keep logs small.

## Next lesson
L08 - Simulator state and mempool: `feynman/lessons/L08-simulator-state-mempool.md`
