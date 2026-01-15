# Agent Instructions

- Never edit `.env` or any environment-variable files.
- Don't delete or revert work you didn't author; coordinate if unsure (especially after git operations).
- Never run destructive git commands (`git reset --hard`, `git restore`, `git checkout` to older commits, `rm`) unless the user explicitly instructs it in this thread.
- Ask before deleting files to resolve type/lint failures.
- Always check `git status` before committing; never amend without explicit approval.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes

## Infrastructure

### Staging Environment (testnet.regenesis.dev)

**SSH Access:** `ssh -i ~/.ssh/id_ed25519_hetzner root@<server-ip>`

| Server        | IP              | Private IP   | Role                          |
| ------------- | --------------- | ------------ | ----------------------------- |
| ns-sim-1      | 5.161.67.36     | 10.0.1.2     | Indexer/Simulator             |
| ns-gw-1       | 178.156.212.135 | 10.0.1.6     | Gateway + Website             |
| ns-auth-1     | 5.161.209.39    | 10.0.1.7     | Auth Service                  |
| ns-db-1       | 5.161.124.82    | 10.0.1.1     | Validators (4x consolidated)  |

**Services & URLs:**

- Website: https://testnet.regenesis.dev (ns-gw-1:8080)
- Gateway: https://api.testnet.regenesis.dev (ns-gw-1:9010)
- Indexer: https://indexer.testnet.regenesis.dev (ns-sim-1:8080)
- Auth: https://auth.testnet.regenesis.dev (ns-auth-1:4000)
- Convex: https://convex.testnet.regenesis.dev (ns-db-1:3210)

**Hetzner CLI:** Use `hcloud` for firewall/server management:

```bash
hcloud firewall list
hcloud server list
hcloud firewall add-rule <firewall> --direction in --protocol tcp --port <port> --source-ips <cidr>
```

**Private Network:** Servers communicate via `10.0.1.0/24` (nullspace-private). Gateway uses private IPs to reach backend services.

**Config Locations:** `/etc/nullspace/*.env` on each server. Docker containers use `--env-file`.

### Network Identity (Staging)

```
85a5cfe0aef544f32090e7740eda6c4714c8dc7ee861a6ecf9bf2a6d148611fb0e51d185356686a9af2ea4fafaec78dd051e683f366f7d81e7bb2da0877ed6001f769ba014b4c81dfc00ad776da9dffdf5dd39c1bc7eddfcf7d64139d6252867
```

### Current Infrastructure Notes (Jan 2026)

- Active servers: `ns-sim-1` cpx41 (simulator), `ns-db-1` cpx41 (validators), `ns-gw-1` cpx31 (gateway/website), `ns-auth-1` cpx21 (auth).
- 4 validators consolidated on ns-db-1 (5.161.124.82) for BFT consensus (n≥3f+1, f=1 fault tolerance).
- Validators use per-node YAML config files (`configs/staging/node{0-3}.yaml`) with individual keys, not shared env files.
- Docker port mapping: external 9001-9004 → internal 9001 per container.
- Threshold: 3/4 signatures required for consensus.

### Current Chain Debugging Context (Jan 2026)

- Admin `CasinoRegister` and QA register txs are confirmed executing (nonce increments), but `GlobalTableInit` and `GlobalTableOpenRound` do not execute (admin nonce stays at 1).
- Mempool shows pending admin txs (`future_nonce_total` > 0), yet blocks show `tx_count: 0` and config keys like `/state/<global-table-config-hash>` return 404.
- Suspected causes: protocol mismatch between node image and client/instruction encoding, or transactions dropped before inclusion.

### Staging BLS Signature Bypass (Jan 2026)

**Symptom**: State queries return 404 on indexer; validator state shows nonce=N but indexer shows nonce=0; simulator logs show "Summary verification failed err=InvalidSignature" followed by 400 responses.

**Root Cause**: BLS12-381 threshold signature verification failing between validators and simulator. The validators sign summaries with their polynomial identity, but the simulator identity doesn't match for verification. Exact cause under investigation (possibly library version mismatch or key format issue).

**Temporary Fix Deployed**: Bypass signature verification in `simulator/src/submission.rs` but still extract proof digests:
- Seed submissions: Skip signature check, proceed with submission
- Summary submissions: Log warning, extract state/events digests directly using `verify_proof_and_extract_digests`, then proceed with state sync

**Key Code Changes** (`simulator/src/submission.rs`):
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

**Impact**: State syncs correctly, account queries work, betting functional. Signature verification is bypassed so proofs are not cryptographically validated - acceptable for staging/testnet.

**TODO**: Investigate root cause of signature mismatch. Likely related to:
- Polynomial identity format (`03` prefix for G2 points?)
- Library version differences between node and simulator images
- Threshold aggregation scheme configuration

**Deployment**: The bypass is deployed via a custom Docker image (`nullspace-simulator:bypass`) loaded directly on ns-sim-1. Override conf updated to use local image instead of `ghcr.io/happybigmtn/nullspace-simulator:latest`.

### QA Environment Debugging (Jan 2026)

**Symptom**: Transactions submitted but never finalized; sessions return 404; "propose aborted" messages in node logs.

**Root Cause**: Stale processes holding ports (8080, 9000, 9100) from previous runs. When the startup script attempted to start new processes:
1. The simulator couldn't bind to port 8080 (already in use)
2. The node's P2P listener failed with `BindFailed`
3. The node crashed within 92ms of startup with `task failed e=Exited`
4. Without a running node, no blocks were produced and transactions never finalized

**Fix**: Clean restart with `QA_FRESH=1` and killing all stale processes:
```bash
./scripts/qa-simplify-down.sh
pkill -9 -f 'nullspace-'
pkill -9 -f 'vite'
QA_FRESH=1 ./scripts/qa-simplify-up.sh
```

**Verification**:
- Blocks are being produced: logs show `proposed block view=X`, `processed block height=Y`, `certified block height=Z`
- Transactions are being finalized: account nonce increments
- Session state queries return 200 instead of 404

**Key Insight**: The node connects to the simulator's mempool via WebSocket at `/mempool`. Without this connection, the node has no transactions to include in blocks. Always verify the "connected to mempool stream" log message appears after node startup.

### CI/CD

**Workflows:**

- `build-images.yml` - Builds Docker images on push to main
- `deploy-staging.yml` - Deploys to staging (auto on push, manual via workflow_dispatch)

**GitHub Secrets:** `STAGING_SSH_PRIVATE_KEY`, `STAGING_HOST_*`, `SOPS_AGE_KEY_STAGING`
**GitHub Variables:** `VITE_IDENTITY`, `VITE_URL`, `VITE_AUTH_URL`, etc.

### Testing

**Local Development:**

```bash
cargo run --bin nullspace-simulator -- --identity <hex>  # Backend
pnpm -C website dev                                       # Frontend
```

**Test Commands:**

```bash
cargo test                           # Rust unit tests
pnpm test                            # JS/TS tests (all packages)
pnpm -C website test                 # Website tests only
pnpm -C gateway test                 # Gateway tests only
scripts/health-check.sh              # Staging health check
```

## Protocol Versioning (US-149)

When modifying binary protocol encoding/decoding:

1. **Version Header**: Wire format is `[version][opcode][payload...]` (1-byte version header first).
2. **Cross-Package Updates**: Update `packages/protocol/src/encode.ts`, `packages/protocol/src/games/actions.ts`, `packages/protocol/test/`, and `gateway/tests/unit/codec.test.ts`.
3. **Golden Vectors**: Update `packages/protocol/test/fixtures/golden-vectors.json` and any hardcoded byte expectations.
4. **Round-Trip Tests**: If Rust doesn’t support the version yet, strip the header before sending to Rust.
5. **Craps HARDWAY**: Encode via `CRAPS_HARDWAY_MAP`; target becomes 0.

## Agent-Native Development (default stance)

- Follow the Every.to “Agent-Native Software” guide: enforce parity (anything in the UI must be doable via tools/CLI), granularity (atomic tools over monolith flows), composability (features = prompts + tools), emergent capability (open-ended prompts reveal missing tools), and improvement-over-time (prompts/configs can ship without code).
- Default to agent-first delivery: single non-interactive entrypoints, deterministic seeds/fixtures, idempotent scripts, and zero manual checkpoints.
- Prefer machine-readable outputs (JSON/YAML) and structured logs to stdout + CI artifacts; never rely on local shell state.
- Make configuration explicit and flaggable: env/CLI switches with safe local defaults; secrets live in env files or secret stores, never personal shells.
- Bake in self-healing: pre-flight health checks, bounded retries where safe, graceful teardown/cleanup, and port reclamation to avoid stuck runs.
- Every new feature ships with an executable “golden path” (update `scripts/agent-up.sh`/`agent-loop.sh`/tests) plus fixtures/golden vectors to keep validation green by default.
- Document failure modes and recovery steps inline (README/AGENTS) so agents can autonomously choose next priorities.
