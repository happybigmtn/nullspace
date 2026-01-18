# Debugging Context (Jan 2026)

## Current Chain Debugging Context

- Admin `CasinoRegister` and QA register txs are confirmed executing (nonce increments), but `GlobalTableInit` and `GlobalTableOpenRound` do not execute (admin nonce stays at 1).
- Mempool shows pending admin txs (`future_nonce_total` > 0), yet blocks show `tx_count: 0` and config keys like `/state/<global-table-config-hash>` return 404.
- Suspected causes: protocol mismatch between node image and client/instruction encoding, or transactions dropped before inclusion.

## Staging BLS Signature Bypass

Symptom: state queries return 404 on indexer; validator state shows nonce=N but indexer shows nonce=0; simulator logs show "Summary verification failed err=InvalidSignature" followed by 400 responses.

Root cause: BLS12-381 threshold signature verification failing between validators and simulator. Validators sign summaries with their polynomial identity, but the simulator identity does not match for verification (library version/key format mismatch suspected).

Temporary fix deployed: bypass signature verification in `simulator/src/submission.rs` but still extract proof digests.

- Seed submissions: skip signature check, proceed with submission.
- Summary submissions: log warning, extract state/events digests via `verify_proof_and_extract_digests`, then proceed with state sync.
- Flag: `nullspace-simulator --enforce-signature-verification` disables the bypass and fails invalid summaries/seeds.
- Persistence: enable summary/explorer SQLite at `/var/lib/nullspace/simulator/{summary,explorer}.sqlite` via systemd override (no `.env` edits).

Key code changes (`simulator/src/submission.rs`):

```rust
// For Summary submissions when signature fails:
// Instead of returning Err(InvalidSummary), extract digests and continue
let mut hasher = Standard::<Sha256>::new();
let state_digests = verify_proof_and_extract_digests(
    &mut hasher, &summary.state_proof, state_start_loc,
    &state_ops, &summary.progress.state_root
).unwrap_or_default();
// Same for events_digests...
```

Impact: state syncs correctly, account queries work, betting functional. Signature verification is bypassed so proofs are not cryptographically validated - acceptable for staging/testnet.

TODO (likely causes):

- Polynomial identity format (`03` prefix for G2 points?)
- Library version differences between node and simulator images
- Threshold aggregation scheme configuration

Deployment: bypass is deployed via custom Docker image (`nullspace-simulator:bypass`) loaded directly on ns-sim-1. Override conf uses local image instead of `ghcr.io/happybigmtn/nullspace-simulator:latest`.

## QA Environment Debugging

Symptom: transactions submitted but never finalized; sessions return 404; "propose aborted" messages in node logs.

Root cause: stale processes holding ports (8080, 9000, 9100) from previous runs. Startup script failed to bind (simulator port 8080, node P2P listener), node crashed, no blocks produced.

Fix:

```bash
./scripts/qa-simplify-down.sh
pkill -9 -f 'nullspace-'
pkill -9 -f 'vite'
QA_FRESH=1 ./scripts/qa-simplify-up.sh
```

Verification:

- Blocks are being produced: logs show `proposed block view=X`, `processed block height=Y`, `certified block height=Z`.
- Transactions are being finalized: account nonce increments.
- Session state queries return 200 instead of 404.

Key insight: node connects to simulator mempool via WebSocket at `/mempool`. Without this connection, the node has no transactions to include. Always verify the "connected to mempool stream" log message after node startup.
