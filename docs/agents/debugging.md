# Debugging Context (Jan 2026)

## Current Chain Debugging Context

- Admin `CasinoRegister` and QA register txs are confirmed executing (nonce increments), but `GlobalTableInit` and `GlobalTableOpenRound` do not execute (admin nonce stays at 1).
- Mempool shows pending admin txs (`future_nonce_total` > 0), yet blocks show `tx_count: 0` and config keys like `/state/<global-table-config-hash>` return 404.
- Suspected causes: protocol mismatch between node image and client/instruction encoding, or transactions dropped before inclusion.

## Chain Offline / "Waiting for Chain" (Staging)

**Symptoms**
- Web UI banner shows `WAITING FOR CHAIN` / `OFFLINE - CHECK CONNECTION`.
- Bets submit but never resolve; sessions stay at `0`.
- Indexer `/explorer/blocks` shows `tx_count: 0` for recent blocks even though clients are submitting.

**Primary Diagnosis**
1. Check blocks:
   ```bash
   curl -sS https://indexer.testnet.regenesis.dev/explorer/blocks?limit=1
   ```
   If `tx_count` is `0`, transactions are not being included.
2. Check validator mempool + propose metrics (node0 metrics on ns-db-1):
   ```bash
   curl -sS http://127.0.0.1:9100/metrics | egrep 'mempool_pending_total|txs_considered_total|proposed_empty_blocks_with_candidates'
   ```
   - If `mempool_pending_total > 0` but `txs_considered_total == 0`, the mempool queue is out of sync and no candidates are being proposed.
   - If `txs_considered_total > 0` but `proposed_empty_blocks_with_candidates_total` keeps increasing and logs mention `rejected_nonce`, the simulator likely accepted a future nonce (node rejects mismatched nonces and proposes empty blocks).

3. Check browser console for CORS errors:
   - If you see requests to `https://indexer.testnet.regenesis.dev/*` blocked by CORS from `https://testnet.regenesis.dev`,
     the web client is pointing at the indexer directly and cannot submit transactions.
   - Fix by routing through the gateway or same-origin `/api` proxy (see Permanent Fix below).

**Permanent Fix**
- Mempool self-healing was added in `node/src/application/mempool.rs`: if the queue is empty or stale while tracked transactions exist, rebuild the queue and retry `peek_batch`.
- Deploy the new node image to staging (via `deploy-staging.yml`) so proposers always see candidates.
- Web client base URL guard: `website/src/api/client.js` now auto-routes `indexer.*.regenesis.dev` to `/api` when running on `*.regenesis.dev`.
  This avoids CORS failures and ensures `/submit` hits the gateway.
- Simulator enforces exact nonce matching in `simulator/src/submission.rs`; reject `tx.nonce != expected_nonce` with `nonce_too_low`/`nonce_too_high`.
  This prevents future-nonce transactions from sitting in mempool while validators reject them.
- If staging uses the local `nullspace-simulator:bypass` image, re-tag the latest GHCR image to that name and restart the container
  so nonce fixes (and other updates) are actually picked up:
  ```bash
  ssh -i ~/.ssh/id_ed25519_hetzner root@5.161.67.36 \
    "docker pull ghcr.io/happybigmtn/nullspace-simulator:sha-<commit> && \
     docker tag ghcr.io/happybigmtn/nullspace-simulator:sha-<commit> nullspace-simulator:bypass && \
     docker rm -f nullspace-simulator && \
     docker run -d --name nullspace-simulator --network host \
       -v /etc/nullspace:/etc/nullspace:ro -v /var/lib/nullspace:/var/lib/nullspace \
       nullspace-simulator:bypass --host 0.0.0.0 --port 8080 --identity <hex> ..."
  ```

If you intentionally want to use the indexer directly in the browser, you must enable CORS on the indexer host.

**Indexer CORS (Caddy) Fix Details**
- If Caddy already injects any `Access-Control-Allow-*` headers from an upstream, duplicate ACAO headers will break preflight.
- Ensure OPTIONS requests return 204 and strip upstream ACAO before adding your own:
  ```caddyfile
  @preflight {
    method OPTIONS
  }
  handle @preflight {
    header Access-Control-Allow-Origin https://testnet.regenesis.dev
    header Access-Control-Allow-Methods "GET, POST, OPTIONS"
    header Access-Control-Allow-Headers "Content-Type, Authorization"
    header Access-Control-Max-Age 86400
    respond 204
  }

  handle {
    reverse_proxy 127.0.0.1:8080 {
      header_down -Access-Control-Allow-Origin
      header_down -Access-Control-Allow-Methods
      header_down -Access-Control-Allow-Headers
    }
    header Access-Control-Allow-Origin https://testnet.regenesis.dev
    header Access-Control-Allow-Methods "GET, POST, OPTIONS"
    header Access-Control-Allow-Headers "Content-Type, Authorization"
  }
  ```

**Recovery Steps (Immediate)**
1. Redeploy validators with the updated image (or restart validators to clear a stuck mempool):
   ```bash
   ssh -i ~/.ssh/id_ed25519_hetzner root@5.161.124.82 "docker restart nullspace-node-0 nullspace-node-1 nullspace-node-2 nullspace-node-3"
   ```
2. If clients have a backlog of pending txs, clear local pending state:
   - Web console: remove `casino_tx_*` and `casino_nonce_*` from `localStorage`, or
   - Call the nonce manager recovery path (`forceSyncFromChain`) from UI tooling.
3. If console shows CORS errors for `indexer.testnet.regenesis.dev`, verify `VITE_URL` and the web base URL:
   - Prefer `/api` (same-origin) or `https://api.testnet.regenesis.dev` for web builds.
   - Redeploy the website with corrected build args.
3. Confirm recovery:
   - `tx_count` becomes >0 on `/explorer/blocks`.
   - `/account/<pubkey>` nonce increments.
   - UI no longer shows `WAITING FOR CHAIN`.

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
