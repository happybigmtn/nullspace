# L18 - Simulator /submit (register + deposit) (from scratch)

Focus file: `simulator/src/api/http.rs`

Goal: explain how register/deposit submissions are received and validated at the simulator’s `/submit` endpoint. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) `/submit` handles all transactions
Register and deposit are not special. They are just `Submission::Transactions` payloads.

### 2) Decode -> apply -> publish
The simulator decodes the submission, applies it to state, then publishes it for downstream consumers.

---

## Limits & management callouts (important)

1) **Decode failure = 400**
- Any malformed bytes are rejected immediately.

2) **Apply failure = 400**
- If the transaction fails validation, the simulator returns a 400.

---

## Walkthrough with code excerpts

### 1) `/submit` handler
```rust
pub(super) async fn submit(
    AxumState(simulator): AxumState<Arc<Simulator>>,
    body: Bytes,
) -> impl IntoResponse {
    let start = Instant::now();
    let status = match Submission::decode(&mut body.as_ref()) {
        Ok(submission) => match apply_submission(Arc::clone(&simulator), submission, true).await {
            Ok(()) => {
                simulator.publish_submission(body.as_ref()).await;
                StatusCode::OK
            }
            Err(_) => StatusCode::BAD_REQUEST,
        },
        Err(_) => StatusCode::BAD_REQUEST,
    };

    simulator.http_metrics().record_submit(start.elapsed());
    status
}
```

Why this matters:
- This is the acceptance gate for every register and deposit transaction.

What this code does:
- Decodes the request body into a `Submission`.
- Applies it to the simulator’s state machine.
- Publishes raw submission bytes for downstream consumers on success.
- Records latency and returns 200 or 400.

---

## Key takeaways
- Register/deposit are not special at the HTTP layer; they are just transactions.
- Decode or apply failures result in a 400 response.

## Next lesson
L19 - Register submission internals: `feynman/lessons/L19-register-submission.md`
