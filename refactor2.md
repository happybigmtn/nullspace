# refactor2.md — Rust codebase review (2025-12-14)

This is a second-pass review of the current workspace with a focus on idiomatic Rust, correctness/safety, and performance/scalability. Recommendations aim to preserve external behavior unless explicitly marked **behavior-changing**.

## Start: preflight requests (please confirm / answer)

### Workspace/crate layout (inferred)
- Workspace members: `node`, `client`, `execution`, `simulator`, `types`, `website/wasm`
- Entrypoints:
  - `nullspace-node` → `node/src/main.rs`
  - `nullspace-simulator` → `simulator/src/main.rs`
  - `dev-executor` → `client/src/bin/dev_executor.rs`
  - `stress-test` → `client/src/bin/stress_test.rs`
  - `nullspace-wasm` (cdylib) → `website/wasm/src/lib.rs`
- Public APIs (high level, inferred from `lib.rs` re-exports):
  - `nullspace-types`: re-exports `api`, `casino`, `execution`, `token`
  - `nullspace-execution`: `Layer`, `State`, `Adb`, `Memory`, `Noncer`, `nonce`, `state_transition`
  - `nullspace-node`: config parsing/validation + `engine`, `supervisor`, and actor modules
  - `nullspace-client`: `Client`, `RetryPolicy`, `Stream`, `Error`
  - `nullspace-simulator`: `Simulator`, `Api` (Axum router), plus websocket endpoints

### Entrypoints & external/public API expectations (questions)
- Which crates are “production critical” vs “dev-only” (`simulator`, `website/wasm`, `client/examples`)?
- Which data structures/encodings are **consensus-critical** (must be deterministic across machines and versions)?
- Are `node`/`execution` allowed to crash-fast on internal/storage corruption, or must they degrade gracefully?

### Known hotspots / correctness risks (questions)
- Where are the latency/CPU hotspots today (execution, proof generation, networking, storage IO, mempool)?
- Any known incidents: chain wedged, non-determinism, corrupted stores, memory growth, websocket backpressure?

## Implementation Status (2025-12-14)

- [x] `node/src/application/ingress.rs`: remove panic-on-send/receive; return safe defaults on mailbox closure.
- [x] `node/src/aggregator/ingress.rs`: remove panic-on-send/receive; keep `deliver()` default-accept behavior to avoid blocking.
- [x] `node/src/supervisor.rs`: remove `block_on` from `peer_set_id()`; avoid `unimplemented!()` panics in `Su::leader()`.
- [x] `node/src/indexer.rs`: treat invalid tx batches as drop+continue (do not permanently stop mempool ingestion).
- [x] `node/src/seeder/actor.rs`: do not panic on dropped `oneshot` receivers/listeners.
- [x] `node/src/aggregator/actor.rs`: do not panic on dropped `oneshot` receivers.
- [x] `node/src/application/actor.rs`: avoid panic on missing blocks during verify join.
- [x] `node/src/application/mempool.rs`: remove non-test dead-code warnings by gating test-only defaults/constructor.
- [x] Idiomatic/clippy cleanups in core games: `execution/src/casino/{baccarat,roulette,blackjack,sic_bo}.rs`.
- [x] Test hygiene: `types/src/casino/tests.rs`, `types/src/token.rs` clippy warning fixes.
- [x] `types/src/casino/player.rs` + `execution/src/layer/handlers/casino.rs`: stop using `Player::new_with_block`; keep it as a compatibility shim that forwards to `Player::new` (behavior-preserving).
- [x] Proof limit unification: centralize summary/events decode limits in `types/src/api.rs` and reuse in `node/src/aggregator/actor.rs` + `simulator/src/lib.rs`.
- [x] `client/src/client.rs`: switch retryable POST bodies to `bytes::Bytes` (avoid per-attempt cloning).
- [x] `client/src/{client,consensus}.rs` + `client/src/lib.rs`: include a size-limited response body snippet in HTTP failure errors (`Error::FailedWithBody`).
- [x] `client/src/events.rs`: dedupe websocket reader loop; unify verified/unverified paths.
- [x] `client/examples/*` + `client/src/bin/stress_test.rs`: remove unused imports/vars to eliminate build warnings.
- [x] `node/src/lib.rs`: validate additional non-zero config fields (`worker_threads`, `message_backlog`, `mailbox_size`, `deque_size`, `execution_concurrency`).
- [x] `node/src/lib.rs`: validate indexer URL (http/https with host) and reject `port == metrics_port`.
- [x] `node/src/main.rs`: dedupe `load_peers` parsing and replace `NonZeroU32::new(...).unwrap()` with `NZU32!` (behavior-preserving).
- [x] `types/src/api.rs`: derive `thiserror::Error` for `VerifyError` (remove manual `Display` boilerplate).
- [x] `types/src/execution.rs`: add `Block::try_new` + `BlockBuildError` (checked constructor).
- [x] `types/src/lib.rs`: add crate-level docs describing stability and consensus-critical encoding.
- [x] `execution/src/casino/video_poker.rs`: fix clippy `needless_range_loop` via iterator-based indexing.
- [x] `execution/src/lib.rs`: add crate-level docs describing determinism and recovery invariants.
- [x] `execution/src/layer/mod.rs`: make progressive-bet parsing fail-closed (no silent `0` on short blobs).
- [x] `execution/src/layer/mod.rs`: split `apply()` dispatch by domain (`casino`, `staking`, `liquidity`) for maintainability (behavior-preserving).
- [x] `execution/src/layer/handlers/casino.rs`: centralize `CasinoError` construction + add player/session lookup helpers (behavior-preserving).
- [x] `execution/src/layer/handlers/staking.rs`: clarify dev/demo staking epoch/duration semantics (behavior-preserving).
- [x] `execution/src/layer/handlers/liquidity.rs`: extract AMM math into pure helpers and add unit tests (behavior-preserving).
- [x] `simulator/src/lib.rs`: replace `GovernorConfigBuilder::finish().unwrap()` with safe fallback to defaults.
- [x] `simulator/src/{lib,explorer}.rs`: split explorer indexing + HTTP handlers into a dedicated module.
- [x] `simulator/src/{lib,passkeys}.rs`: split passkeys storage + HTTP handlers into a dedicated module (feature-gated).
- [x] `simulator/src/{lib,api/*}.rs`: move `Api` router + HTTP + websocket handlers into dedicated modules.
- [x] `simulator/src/{lib,state}.rs`: move core `State`/`InternalUpdate` + proof/query logic into a dedicated module.
- [x] `simulator/src/{lib,explorer,state,main}.rs`: add configurable explorer retention limits (opt-in) to bound memory growth.
- [x] (**behavior-changing**) `types/src/execution.rs` + `execution/src/layer/handlers/casino.rs`: add `Event::CasinoDeposited` and emit it for `CasinoDeposit`; update simulator/wasm decoders.
- [x] `website/wasm/src/lib.rs`: gate private-key exports behind `private-key-export` feature.
- [x] `website/wasm/Cargo.toml`: make `private-key-export` default-off.
- [x] `node/src/application/actor.rs`: replace metadata `.unwrap()` with logged fallback; add retry/backoff for proof generation; make prune failures non-fatal.
- [x] (**behavior-changing / API-breaking**) `execution/src/{state,state_transition,layer/*}.rs` + `node/src/application/actor.rs`: make execution `State` operations fallible (`anyhow::Result`) and propagate storage errors instead of logging+continuing.
- [x] (**behavior-changing**) `execution/src/state_transition.rs`: fail on non-sequential height gaps instead of silently no-op’ing.
- [x] `execution/src/state_transition.rs`: compare recovery outputs via `Eq` (no `encode()` allocations).
- [x] `node/src/application/actor.rs`: cache per-account next nonce for inbound tx ingestion (reduces `nonce(&state, ...)` reads).
- [x] `node/src/{engine.rs,main.rs,tests.rs}`: refactor `engine::Config` into nested structs (`IdentityConfig`, `StorageConfig`, `ConsensusConfig`, `ApplicationConfig`) to reduce parameter soup.
- [x] `node/src/engine.rs`: document storage sizing constants and tradeoffs.
- [x] `node/src/engine.rs`: stop the node when any sub-actor terminates; abort remaining actors and propagate failure (avoid partial-liveness).
- [x] `node/src/application/actor.rs`: remove `.expect`/`panic!` in init + steady-state; log fatal errors and exit actor (engine handles crash-fast shutdown).
- [x] `node/src/seeder/actor.rs`: remove `.expect` on storage ops; log fatal errors and exit actor (crash-fast policy).
- [x] `node/src/aggregator/actor.rs`: remove `unwrap`/`expect` on storage ops; log fatal errors and exit actor (crash-fast policy).
- [x] `node/src/engine.rs`: honor runtime stop signal for graceful shutdown (no panic on stop).
- [x] `node/src/{seeder,aggregator}/actor.rs`: add upload metrics (attempts/failures, outstanding, lag) and exponential backoff for indexer uploads.
- [x] `node/src/{seeder,aggregator}/actor.rs`: add jittered sleep to upload backoff (reduce thundering herd on indexer outages).
- [x] `node/src/{seeder,aggregator}/actor.rs`: harden `uploads_outstanding` decrement (no underflow on unexpected completion messages).
- [x] `node/src/indexer.rs`: preserve mempool websocket error details from `nullspace-client` (stop collapsing to `UnexpectedResponse`).
- [x] `node/src/indexer.rs`: add mempool stream metrics (connect attempts/failures, invalid batches, forwarded batches) and exponential reconnect backoff (with jitter).

---

## node/src/application/ingress.rs

### Summary
- Defines the application mailbox and implements consensus traits (`Automaton`, `Relay`, `Reporter`) by proxying messages into the application actor.
- Sits directly on the consensus hot path: if it panics, consensus progress halts.

### Top Issues (ranked)
1. **Mailbox panics on normal shutdown / actor failure**
   - Impact: consensus tasks can panic during shutdown, restarts, or transient channel closure.
   - Risk: high (panic in production control-plane).
   - Effort: low–medium.
   - Location: `node/src/application/ingress.rs:66`–`169` (`.expect("Failed to send ...")` and `.expect("Failed to receive ...")`).

### Idiomatic Rust Improvements
- Make mailbox operations fallible (match `node/src/seeder/ingress.rs` pattern) instead of panic-on-send.

**Before:**
```rust
self.sender.send(Message::Genesis { response }).await
    .expect("Failed to send genesis");
receiver.await.expect("Failed to receive genesis")
```

**After (pseudocode; wiring depends on consensus engine expectations):**
```rust
#[derive(Debug, thiserror::Error)]
pub enum MailboxError {
    #[error("application mailbox closed")]
    Closed,
    #[error("application request canceled")]
    Canceled,
}

async fn try_send<E: Clock>(
    sender: &mut futures::channel::mpsc::Sender<Message<E>>,
    msg: Message<E>,
) -> Result<(), MailboxError> {
    sender.send(msg).await.map_err(|_| MailboxError::Closed)
}
```

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Current `.expect(...)` makes “clean shutdown” indistinguishable from “bug”; it converts a recoverable state into a hard crash.

### Performance & Scaling Notes
- Panics cause restart churn and exacerbate instability; in distributed systems, “stop-the-world on shutdown” is a real availability risk.

### Refactor Plan
- Phase 1: replace `.expect("Failed to send ...")` with `if send().await.is_err() { return; }` + `tracing::warn!` (minimal behavior change).
- Phase 2: introduce mailbox error types and thread them through callers if consensus engine supports it.
- Phase 3: propagate a shutdown `Signal` (like seeder) to allow bounded waits and cancellation.

### Open Questions
- Does `commonware_consensus::Automaton` allow returning an error, or must we “best-effort” and return defaults?

---

## node/src/aggregator/ingress.rs

### Summary
- Bridges aggregation consensus and the aggregator actor via an mpsc mailbox.
- Also implements `Consumer`/`Producer` for p2p backfill plumbing.

### Top Issues (ranked)
1. **Panic on send throughout aggregation ingress**
   - Impact: aggregation can panic on shutdown/actor restart; can halt progress or crash node.
   - Risk: high.
   - Effort: low–medium.
   - Location: `node/src/aggregator/ingress.rs:75`–`215` (`.expect(...)` on send; `.expect(...)` on receive).
2. **`deliver()` defaults to `true` if response channel is dropped**
   - Impact: can acknowledge delivery even when aggregator didn’t process it; risks masking failures.
   - Risk: medium (depends on resolver semantics).
   - Effort: low.
   - Location: `node/src/aggregator/ingress.rs:184`–`195`.

### Idiomatic Rust Improvements
- Adopt the seeder ingress’ `Signal`-based shutdown handling and mailbox error enum.

**Before:**
```rust
self.sender.send(Message::Deliver { .. }).await
    .expect("failed to send deliver");
receiver.await.unwrap_or(true)
```

**After (pseudocode):**
```rust
if self.sender.send(Message::Deliver { .. }).await.is_err() {
    tracing::warn!("aggregator mailbox closed");
    return false;
}
receiver.await.unwrap_or(false)
```

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- `unwrap_or(true)` in `deliver` is semantically risky: it treats “no response” as success.

### Performance & Scaling Notes
- Avoid panics in control-plane code; it amplifies transient overload into outages.

### Refactor Plan
- Phase 1: remove `.expect(...)`; replace with early-return + logging.
- Phase 2: add `Signal` to mailbox and bounded waits.
- Phase 3: decide a consistent “default on drop” policy (`false` is safer than `true`).

### Open Questions
- What does the resolver expect on mailbox failure: retry, fail-fast, or ignore?

---

## node/src/supervisor.rs

### Summary
- Implements view/epoch supervisors for threshold consensus and aggregation, including epoch subscription and leader selection (via `ThresholdSupervisor`).
- Coordinates p2p peer-set identity based on current epoch.

### Top Issues (ranked)
1. **`futures::executor::block_on` inside `peer_set_id()`**
   - Impact: can block an executor thread; can deadlock if `RwLock` requires the same executor to make progress.
   - Risk: high in async runtimes; deadlocks are catastrophic and hard to debug.
   - Effort: medium.
   - Location: `node/src/supervisor.rs:121`–`124`.
2. **`unimplemented!()` in `Supervisor` trait `leader()`**
   - Impact: runtime panic if upstream code ever calls `Su::leader`.
   - Risk: medium–high (future refactors can accidentally trigger it).
   - Effort: medium (needs correct semantics).
   - Location: `node/src/supervisor.rs:131`–`133`, `189`–`191`.

### Idiomatic Rust Improvements
- Replace `block_on(async { lock.read().await })` with synchronous state.

**Before:**
```rust
fn peer_set_id(&self) -> u64 {
    futures::executor::block_on(async { self.inner.epoch_manager.read().await.current() })
}
```

**After (pseudocode; choose one):**
```rust
// Option A: store epoch in AtomicU64 for sync reads (preferred).
use std::sync::atomic::{AtomicU64, Ordering};
// epoch.store(new_epoch, Ordering::Release); peer_set_id reads Ordering::Acquire.

// Option B: use a std::sync::RwLock for epoch-only reads (no async boundary).
```

### Data Structure & Algorithm Changes
- Consider replacing `participants_map: HashMap<PublicKey, u32>` with `BTreeMap` if determinism across Rust versions/platforms matters (HashMap iteration order is randomized).
  - Complexity: `O(1)` average → `O(log n)`; likely fine for validator set sizes.

### Safety & Concurrency Notes
- `unimplemented!()` is not a safety contract. If it’s truly unreachable, prefer `unreachable!("...")` + a unit test that exercises the expected call paths.
- Better: implement `Su::leader` in a safe way consistent with protocol expectations (needs confirmation of `commonware_consensus` behavior).

### Performance & Scaling Notes
- Blocking on async locks is one of the fastest ways to create distributed “liveness bugs” under load.

### Refactor Plan
- Phase 1: remove `block_on` by maintaining a synchronously readable epoch value (atomic or std lock).
- Phase 2: eliminate `unimplemented!` by implementing `Su::leader` or proving it unreachable via tests.
- Phase 3: consolidate supervisor traits if upstream allows (reduce duplicated leader selection logic).

### Open Questions
- Is `Su::leader` ever invoked by the engines used here, or only the threshold variant (`TSu::leader`)?

---

## node/src/application/mempool.rs

### Summary
- Maintains per-account pending transactions and selects “next tx” in a round-robin manner.
- Provides metrics for mempool size and account count.

### Top Issues (ranked)
1. **Dead-code warnings in non-test builds**
   - Impact: noisy CI, hides real warnings; suggests API surface isn’t aligned with production usage.
   - Risk: low.
   - Effort: low.
   - Location: `node/src/application/mempool.rs:9`–`41` (`DEFAULT_*` constants and `Mempool::new` unused outside tests).
2. **Queue compaction strategy is coarse**
   - Impact: potential `O(n)` retains on large queues; potential memory churn if many stale keys accumulate.
   - Risk: low–medium; depends on churn.
   - Effort: medium.
   - Location: `node/src/application/mempool.rs:122`–`190`.

### Idiomatic Rust Improvements
- Prefer removing unused public constructors/constants rather than `#[allow(dead_code)]` unless you need API stability.

**Before:**
```rust
pub fn new(context: impl Metrics) -> Self {
    Self::new_with_limits(context, DEFAULT_MAX_BACKLOG, DEFAULT_MAX_TRANSACTIONS)
}
```

**After (behavior-changing if `new` is public API you want to keep):**
```rust
// Option A: remove `new` and DEFAULT_*; tests call `new_with_limits`.
// Option B: keep `new` but make DEFAULT_* `pub const` and use it from production code.
```

### Data Structure & Algorithm Changes
- If queue staleness becomes common, switch `queued`/`queue` to a single structure that avoids duplicates by construction (e.g., `indexmap::IndexSet`), or maintain a per-key “generation” counter to lazily drop stale entries.
  - Complexity: reduces periodic `retain` scans; improves predictable latency.

### Safety & Concurrency Notes
- No obvious safety issues; purely in-memory, single-threaded assumptions should be documented if true.

### Performance & Scaling Notes
- The current design is good for “nonce scheduling” and avoids digest-driven scans.
- Measure under adversarial inputs: many accounts spamming high nonces to trigger `pop_last()` churn.

### Refactor Plan
- Phase 1: resolve dead-code warnings by aligning constructors with production usage.
- Phase 2: add fuzz/regression tests for adversarial queue staleness and backlog clipping.
- Phase 3: optional alternative queue structure if profiling shows compaction cost.

### Open Questions
- Is `Mempool::new_with_limits` the intended production entrypoint (config-driven)?

---

## node/src/indexer.rs

### Summary
- Defines an `Indexer` trait (submit seed, submit summary, and stream mempool).
- Provides a reconnecting wrapper for the mempool stream that batch-verifies transaction signatures.

### Progress (implemented)
- Invalid mempool tx batches are now drop+continue (reconnect loop stays alive).
- `nullspace-client` mempool errors are no longer collapsed to `UnexpectedResponse`.
- Reconnecting mempool stream now emits metrics and uses exponential reconnect backoff with jitter.

### Top Issues (ranked)
1. **Reconnect/backoff policy is still simplistic**
   - Impact: reconnect behavior may be too aggressive or too slow depending on outage mode; no max-attempt cutover.
   - Risk: low–medium.
   - Effort: low.
   - Location: `node/src/indexer.rs` (`ReconnectingStream` backoff loop).

### Idiomatic Rust Improvements
- Treat invalid tx batches as “drop + continue” unless protocol requires fail-fast.

**Before:**
```rust
if !batcher.verify(&mut context) {
    warn!("received invalid transaction from indexer");
    return;
}
```

**After:**
```rust
if !batcher.verify(&mut context) {
    warn!("received invalid transaction batch from indexer; dropping");
    continue;
}
```

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Backpressure: the channel is bounded; `send().await` can stall the reconnect loop. This is good (pressure propagates), but ensure it can’t deadlock with other locks held.

### Performance & Scaling Notes
- Batch verification is good; consider using `pending.transactions.iter().map(...)` with reserve capacity if allocations show up in profiles.

### Refactor Plan
- Phase 1 (**done**): decide tolerate policy for invalid txs; implement drop+continue.
- Phase 2 (**done**): preserve error details and add mempool stream metrics + exponential reconnect backoff.
- Phase 3: add integration tests for reconnect behavior and invalid batches.

### Open Questions
- Is the indexer trusted (local) or untrusted (remote)? The policy should differ.

---

## node/src/aggregator/actor.rs

### Summary
- Maintains aggregator storage (cache/results/certificates), handles backfill via resolver, and participates in aggregation consensus.
- Produces and stores proof objects used by clients/validators.

### Progress (implemented)
- Proof decode limits are centralized in `types/src/api.rs` and reused by the aggregator.
- Actor init + steady-state no longer use `unwrap`/`expect`; fatal storage errors are logged and cause the actor to exit (engine is crash-fast).
- Summary uploads now use exponential backoff with jitter and emit metrics (attempts/failures, outstanding uploads, and upload lag).

### Top Issues (ranked)
1. **Crash-fast on storage/indexer faults**
   - Impact: any storage/IO failure (or invariant break) halts the node (safety > availability).
   - Risk: medium (availability).
   - Effort: low (document) → medium (restart/retry design).
   - Location: `node/src/aggregator/actor.rs`; `node/src/engine.rs:526`.
2. **Infinite retry loop for summary uploads**
   - Impact: prolonged indexer outages lead to unbounded retries; now uses exponential backoff + metrics but still has no max-attempt cutover.
   - Risk: medium.
   - Effort: low.
   - Location: `node/src/aggregator/actor.rs:627`.

### Idiomatic Rust Improvements
- (optional) Split into `run_inner(...) -> anyhow::Result<()>` to reduce boilerplate and add richer context via `anyhow::Context` while keeping the engine’s crash-fast policy explicit.

### Data Structure & Algorithm Changes
- Unify proof limits into a shared constant module (preferably in `nullspace-types` because clients verify proofs).
  - Complexity impact: none; reduces config drift risk.

### Safety & Concurrency Notes
- Treat storage errors as explicit faults: either crash-fast with clear logs (intentional) or recover with retries/backoff.

### Performance & Scaling Notes
- Storing proofs can be IO-heavy; measure:
  - journal fsync cost (`sync().await`)
  - proof size distribution (ops per block)
  - cache hit ratio during backfill

### Refactor Plan
- Phase 1 (**done**): replace `unwrap`/`expect` in init + steady-state with logged errors and actor exit (crash-fast policy).
- Phase 2 (**done**): centralize proof limits and codec config; ensure producer and verifier agree.
- Phase 3: add metrics for proof sizes and cache effectiveness.

### Open Questions
- Should the engine restart the aggregator actor on transient failures, or is crash-fast acceptable?

---

## node/src/engine.rs

### Summary
- Wires together application, seeder, aggregator, buffer, marshal, consensus, and aggregation engines.
- Owns many constants governing storage layout and networking limits.

### Progress (implemented)
- `engine::Config` is now grouped into `IdentityConfig`, `StorageConfig`, `ConsensusConfig`, and `ApplicationConfig` (behavior-preserving structural refactor).
- Engine now terminates the node when any sub-actor exits/fails (abort remaining actors; avoid partial-liveness).
- Engine now honors the runtime stop signal to allow clean shutdown without reporting it as an actor failure.
- Documented storage sizing defaults (buffers, freezer table/journal knobs) with units and operational tradeoffs.

### Top Issues (ranked)
1. **Large constant block without clear rationale or sizing guidance**
   - Impact: hard to tune; unclear memory/disk impacts.
   - Risk: low–medium.
   - Effort: low.
   - Location: `node/src/engine.rs:33`–`45`.

### Idiomatic Rust Improvements
- Group config into nested structs (`NetworkConfig`, `StorageConfig`, `ConsensusConfig`, `ExecutionConfig`) to prevent “parameter soup”.

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Ensure all sub-actors are either supervised or shut down cleanly; current panic-based ingress code fights graceful shutdown.

### Performance & Scaling Notes
- Most wins here are around “sane defaults” + telemetry for tuning:
  - per-component queue sizes
  - upload concurrency and backfill quotas
  - storage buffers and replay buffers

### Refactor Plan
- Phase 1 (**done**): document constants with concrete sizing math and operational tradeoffs.
- Phase 2 (**done**): refactor config into nested structs; update call sites.
- Phase 3: add a “dry-run sizing report” mode to print derived resource estimates (**behavior-changing** if you add CLI flags).

### Open Questions
- Which deployments matter: laptop sim, small testnet, or production validators with SSDs?

---

## execution/src/state.rs

### Summary
- Defines the execution `State` abstraction and adapters (`Adb`, `Memory`, `Noncer`).
- `Layer` and state transition logic depend on it for reads/writes.

### Progress (implemented)
- `State::{get,insert,delete,apply}` now return `anyhow::Result` and propagate storage failures.
- `Adb` no longer logs+returns `None` on IO/storage errors; it returns an error and bubbles up.
- `Layer::execute` and `execute_state_transition` now fail fast on storage errors instead of producing partial/no-op state.
- `nonce(&state, pk)` now returns `anyhow::Result<u64>`; `node` drops incoming txs on nonce read failure.

### Top Issues (ranked)
1. **Storage errors are logged and silently dropped**
   - Impact: can mask corrupted/failed storage as “missing key”, causing incorrect execution results.
   - Risk: high if this path is used in production validation.
   - Effort: medium–high (API change).
   - Location: `execution/src/state.rs:41`–`66`.

### Idiomatic Rust Improvements
- Make state access fallible; “infallible trait over fallible backend” is a correctness footgun.

**Before:**
```rust
async fn get(&self, key: &Key) -> Option<Value> {
    match self.get(&key_hash).await {
        Ok(v) => v,
        Err(e) => { warn!(...); None }
    }
}
```

**After (pseudocode; likely requires broad signature changes):**
```rust
pub trait State {
    fn get(&self, key: &Key) -> impl Future<Output = anyhow::Result<Option<Value>>>;
    // ...
}
```

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- In distributed systems, “swallow IO errors” often becomes “silent fork”: one node silently misses state and still produces outputs.

### Performance & Scaling Notes
- Returning `Result` will likely improve performance debugging because failures become explicit rather than cascading into strange behavior.

### Refactor Plan
- Phase 1 (**done**): make `State` fallible and propagate errors through `Layer` and `state_transition`.
- Phase 2 (**optional**): add metrics counters (per-op error counts) and structured error logs at boundaries (node actor / supervisor).

### Open Questions
- Are storage errors expected/transient, or should they be treated as fatal corruption?

---

## execution/src/state_transition.rs

### Summary
- Executes block transitions by running the `Layer`, writing event outputs, and committing state.
- Includes recovery logic for partial commits.

### Progress (implemented)
- Height gaps (`requested != state_height + 1`) now return an error instead of a silent no-op (**behavior-changing**).
- Recovery compares outputs via `Output: Eq` instead of allocating `encode()` buffers.

### Top Issues (ranked)
1. **No explicit outcome enum (Applied vs AlreadyApplied)**
   - Impact: callers infer “no-op” from empty proof ranges; workable but indirect.
   - Risk: low.
   - Effort: medium (API change).
   - Location: `execution/src/state_transition.rs` return type.

### Idiomatic Rust Improvements
- Separate “already applied” from “out-of-order” results with an explicit enum, not “empty proof ranges”.

**Before:**
```rust
if height <= state_height || height > state_height + 1 {
    return Ok(StateTransitionResult { start_op: op, end_op: op, .. });
}
```

**After (pseudocode):**
```rust
pub enum TransitionOutcome {
    Applied(StateTransitionResult),
    AlreadyApplied { height: u64 },
    OutOfOrder { requested: u64, expected: u64 },
}
```

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Recovery is the right idea: “commit events first, then state”. Ensure it’s documented as an invariant so future changes don’t break it.

### Performance & Scaling Notes
- Recovery should be extremely rare; optimize only after correctness.

### Refactor Plan
- Phase 1 (**done**): fail on height gaps; keep “already applied” as a no-op.
- Phase 2 (**done**): remove recovery `encode()` allocations by comparing `Output` values directly.
- Phase 3 (**done**): add crash-recovery test that commits `events` but not `state`, then reruns transition (`execution/src/mocks.rs` tests).

### Open Questions
- Do any callers rely on “no-op returns valid proof ranges” semantics?

---

## execution/src/layer/mod.rs

### Summary
- Implements the execution `Layer`: transaction prepare/apply, state updates, and handlers for casino/staking/liquidity.
- Contains various helper parsers for game state blobs.

### Progress (implemented)
- Progressive state-blob parsing is now fail-closed for short/malformed blobs (no silent `0` fallbacks).
- `apply()` dispatch is now split by domain (`casino` / `staking` / `liquidity`) to reduce cross-cutting change risk.

### Top Issues (ranked)
1. **Monolithic `apply()` match makes cross-cutting changes risky**
   - Impact: hard to extend; easy to introduce subtle behavior changes.
   - Risk: medium.
   - Effort: medium.
   - Location: `execution/src/layer/mod.rs` (`apply` match over `Instruction`).
2. **State-blob parsing silently defaults on malformed blobs**
   - Impact: corrupted state could silently affect payouts/logic (e.g., progressive bet inferred as `0`).
   - Risk: medium.
   - Effort: low–medium.
   - Location: `execution/src/layer/mod.rs:40`–`140` (`unwrap_or(0)` fallbacks).

### Idiomatic Rust Improvements
- For blob parsing, prefer explicit `Result`/`Option` handling and log once per session when decoding fails (avoid silent “0” values).

**Before:**
```rust
let progressive_bet = if version >= 3 {
    parse_u64_be_at(state_blob, 24).unwrap_or(0)
} else { 0 };
```

**After:**
```rust
let progressive_bet = match version {
    v if v >= 3 => parse_u64_be_at(state_blob, 24)?,
    _ => 0,
};
```

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Keep execution deterministic: no wall-clock time, no randomness beyond `Seed`/session RNG, no HashMap iteration order feeding into outputs.

### Performance & Scaling Notes
- `apply()` should stay allocation-light; prefer passing slices/refs where possible.

### Refactor Plan
- Phase 1 (**done**): refactor blob parsing helpers to return `Option`/`Result` and handle failures explicitly.
- Phase 2 (**done**): split `apply()` by domain (`casino`, `staking`, `liquidity`) behind a trait or helper object to reduce match size.
- Phase 3: add property tests for determinism given identical seeds/tx order.

### Open Questions
- Are state blobs versioned and validated anywhere else, or only by implicit length checks?

---

## execution/src/layer/handlers/casino.rs

### Summary
- Implements casino-related state transitions (register, faucet deposit, start/move/complete games, tournaments, super mode).
- Emits `Event`s that clients consume for UI/analytics.

### Progress (implemented)
- `CasinoDeposit` now emits `Event::CasinoDeposited` (**behavior-changing**).
- Centralized `CasinoError` construction and added helper lookups for player/session retrieval.

### Top Issues (ranked)
1. **Repeated boilerplate for “get player or error” and error construction**
   - Impact: slows iteration; increases chances of inconsistent error codes/messages.
   - Risk: medium.
   - Effort: medium.
   - Location: throughout `execution/src/layer/handlers/casino.rs`.

### Idiomatic Rust Improvements
- Centralize error creation and common lookups.

**Before:**
```rust
return vec![Event::CasinoError { player: public.clone(), session_id: None, error_code: ..., message: "...".to_string() }];
```

**After (pseudocode):**
```rust
fn casino_error(player: &PublicKey, session_id: Option<u64>, code: u32, msg: impl Into<String>) -> Event {
    Event::CasinoError { player: player.clone(), session_id, error_code: code, message: msg.into() }
}
```

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Event stream is part of your external contract. Changing it is **behavior-changing**; do it with versioning or a migration plan.

### Performance & Scaling Notes
- Avoid repeated `public.clone()` in hot loops by taking `&PublicKey` and cloning once per event.

### Refactor Plan
- Phase 1 (**done**): add helpers for error construction and player/session retrieval.
- Phase 2: standardize error codes/messages across handlers.

### Open Questions
- Is `CasinoDeposit` intended to be a faucet/dev-only instruction, or a real “deposit”?

---

## execution/src/layer/handlers/staking.rs

### Summary
- Implements staking actions (stake/unstake/claim/process epoch) using `Player`, `Staker`, and `House` state.
- Currently includes placeholder reward behavior and “short epoch” constants for testing.

### Progress (implemented)
- Clarified dev/demo staking epoch and duration semantics (expressed in consensus views/blocks, not wall-clock time).

### Top Issues (ranked)
1. **Claim rewards is a placeholder returning `amount: 0`**
   - Impact: instruction exists but does nothing; can confuse users and clients.
   - Risk: medium (API correctness).
   - Effort: medium–high (design needed).
   - Location: `execution/src/layer/handlers/staking.rs:101`–`131`.
2. **Epoch length/min duration constants are “dev simplified”**
   - Impact: behavior differs from comments; could surprise users if shipped.
   - Risk: medium.
   - Effort: low.
   - Location: `execution/src/layer/handlers/staking.rs:22`–`33`, `135`–`176`.

### Idiomatic Rust Improvements
- Encode “dev mode” parameters in config/state, not as hard-coded constants, or gate via feature flags.

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Keep arithmetic saturating where it affects balances. Consider a single “checked math” helper to make invariants explicit.

### Performance & Scaling Notes
- Staking operations are simple; correctness and determinism matter more than micro-optimizations.

### Refactor Plan
- Phase 1 (**done**): clarify whether staking is MVP/demo or production; rename constants/comments accordingly.
- Phase 2: implement rewards or remove the instruction (**behavior-changing**).
- Phase 3: add invariants/tests (stake/unstake, multiple stakes, epoch rollover).

### Open Questions
- What is the intended staking economics (reward source, distribution schedule, anti-sybil constraints)?

---

## execution/src/layer/handlers/liquidity.rs

### Summary
- Implements vault creation, collateral deposit, borrow/repay, and AMM operations (swap/add/remove liquidity).
- Maintains “virtual USDT” accounting and house burn tracking.

### Progress (implemented)
- Extracted swap quote math (`constant_product_quote`) and borrow price ratio (`rng_price_ratio`) into pure helpers + added unit tests.

### Top Issues (ranked)
1. **AMM math and “bootstrap price” are embedded and implicit**
   - Impact: easy to change accidentally; hard to audit; may cause economic bugs.
   - Risk: high if value-bearing.
   - Effort: medium.
   - Location: `execution/src/layer/handlers/liquidity.rs:71`–`134`, `150`+.
2. **Division-by-zero and saturating behavior may mask invalid states**
   - Impact: may silently proceed under impossible states.
   - Risk: medium.
   - Effort: low–medium.
   - Location: `execution/src/layer/handlers/liquidity.rs:156`–`197` (`denominator == 0` path).

### Idiomatic Rust Improvements
- Extract AMM math into a pure, tested function with explicit inputs/outputs and invariants.

**Before:**
```rust
let numerator = amount_in_with_fee.saturating_mul(reserve_out);
let denominator = reserve_in.saturating_mul(10_000).saturating_add(amount_in_with_fee);
let amount_out = (numerator / denominator) as u64;
```

**After (pseudocode):**
```rust
fn constant_product_out(reserve_in: u128, reserve_out: u128, amount_in: u128, fee_bps: u128) -> Option<u128> {
    let net_in = amount_in.saturating_sub((amount_in * fee_bps) / 10_000);
    let denom = reserve_in.saturating_add(net_in);
    (denom != 0).then(|| (net_in * reserve_out) / denom)
}
```

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Economic code needs clear invariants:
  - reserves never negative
  - min liquidity lock enforced
  - total LP supply consistency

### Performance & Scaling Notes
- Pure math refactor enables cheap unit/property tests and reduces regression risk.

### Refactor Plan
- Phase 1 (**done**): extract AMM math into pure functions + unit tests.
- Phase 2: define explicit invariants and validate them at key transitions (debug asserts or error events).
- Phase 3 (**behavior-changing**): revisit bootstrap pricing and fee model with economic design review.

### Open Questions
- Are these mechanics meant to be economically real or purely a game mechanic?

---

## execution/src/casino/mod.rs

### Summary
- Aggregates casino game implementations and exports game logic used by the execution layer.
- Contains many self-contained game state machines with their own RNG usage.

### Top Issues (ranked)
1. **Clippy warnings indicate repeated non-idiomatic patterns**
   - Impact: reduces readability; increases bug surface.
   - Risk: low.
   - Effort: low.
   - Location: examples:
     - `execution/src/casino/baccarat.rs:232`, `:239` (manual range contains)
     - `execution/src/casino/roulette.rs:160`–`:161`, `:432` (manual range contains / negated contains)
     - `execution/src/casino/blackjack.rs:702`+ (`if_same_then_else`)

### Idiomatic Rust Improvements
- Replace range checks with `(a..=b).contains(&x)` and simplify duplicated branches.

**Before:**
```rust
v >= 2 && v <= 7
```

**After:**
```rust
(2..=7).contains(&v)
```

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Ensure all game logic is deterministic given the same seed and transaction sequence.

### Performance & Scaling Notes
- These are CPU-bound; if execution is a hotspot, focus on:
  - avoiding repeated allocations in state blobs
  - minimizing cloning of large vectors
  - reducing per-move recomputation (cache hand evaluation where possible)

### Refactor Plan
- Phase 1: apply clippy-suggested cleanups (low risk).
- Phase 2: extract shared card/deck helpers into a single module to reduce duplication.
- Phase 3: add property tests (e.g., no negative balances, payout invariants).

### Open Questions
- Which games are most played (hot path) vs rarely used?

---

## types/src/execution.rs

### Summary
- Defines core consensus/execution types: namespaces, transactions, instructions, blocks, notarizations/finalizations, etc.
- Provides codec and digest implementations; correctness and determinism here are consensus-critical.

### Top Issues (ranked)
1. **`Block::new` uses `assert!` for transaction limit**
   - Impact: panics on invalid input; could be hit by internal misuse.
   - Risk: medium.
   - Effort: low–medium.
   - Location: `types/src/execution.rs:641`–`650`.
2. **Allocating transaction payload per sign/verify**
   - Impact: repeated allocations in hot paths (mempool verification, signing bots).
   - Risk: low.
   - Effort: medium.
   - Location: `types/src/execution.rs:101`–`124` (`Transaction::payload` returns `Vec<u8>`).

### Idiomatic Rust Improvements
- Convert panicky constructors into checked constructors when used on untrusted inputs.

**Before:**
```rust
pub fn new(parent: Digest, view: View, height: u64, transactions: Vec<Transaction>) -> Self {
    assert!(transactions.len() <= MAX_BLOCK_TRANSACTIONS);
    // ...
}
```

**After (pseudocode; API change):**
```rust
pub fn try_new(parent: Digest, view: View, height: u64, transactions: Vec<Transaction>) -> Result<Self, BlockError> {
    if transactions.len() > MAX_BLOCK_TRANSACTIONS { return Err(BlockError::TooManyTransactions); }
    // ...
}
```

### Data Structure & Algorithm Changes
- If determinism across versions matters, ensure any map/set used inside digestible/encoded structs has canonical ordering (BTree* or sorted Vec).

### Safety & Concurrency Notes
- Digest computation is deterministic because it iterates over `transactions` in order; preserve that property.

### Performance & Scaling Notes
- If signature verification becomes a hotspot, optimize payload construction:
  - use a stack buffer for `nonce` + instruction encoding when possible
  - use `bytes::Bytes`/`BytesMut` to avoid repeated `Vec` allocations

### Refactor Plan
- Phase 1: introduce `try_new` (keep `new` for internal callers if needed).
- Phase 2: optimize `Transaction::payload` allocations; benchmark (criterion) before/after.
- Phase 3: consider a “pre-encoded instruction bytes” path for repeated verification (careful: must remain canonical).

### Open Questions
- Which constructors are exposed to untrusted inputs vs only internal usage?

---

## types/src/api.rs

### Summary
- Defines API wire types (`Summary`, `Events`, `Lookup`, filters) and proof verification logic.
- Acts as the “client-side verifier” for consensus proofs.

### Top Issues (ranked)
1. **Proof limits duplicated across producer/verifier code**
   - Impact: mismatch can cause verification failures or DoS vectors.
   - Risk: medium.
   - Effort: medium.
   - Location: `types/src/api.rs:11`–`18` (`MAX_PROOF_*`) vs `node/src/aggregator/actor.rs` proof limits.
2. **Custom error type manually implements Display**
   - Impact: more boilerplate than necessary; easier to make mistakes.
   - Risk: low.
   - Effort: low.
   - Location: `types/src/api.rs:18`–`63`.

### Idiomatic Rust Improvements
- Use `thiserror::Error` derives for `VerifyError` for clarity and consistency with the rest of the workspace.

### Data Structure & Algorithm Changes
- Centralize proof sizing limits (single source of truth) and use them in:
  - proof creation
  - proof encoding/decoding
  - verification

### Safety & Concurrency Notes
- Verification code should be strict and explicit: never default-accept when a proof fails to decode/verify.

### Performance & Scaling Notes
- Proof verification can be CPU-heavy; measure:
  - ops length distribution
  - proof node count distribution
  - failure rate (invalid signatures/proofs)

### Refactor Plan
- Phase 1: introduce shared constants for proof limits.
- Phase 2: derive `thiserror::Error` for `VerifyError` (no behavior change).
- Phase 3: add fuzz tests for proof decoding/verification with size bounds.

### Open Questions
- Are clients expected to handle multiple proof-limit “profiles” (light vs full nodes), or is there one canonical set?

---

## types/src/token.rs

### Summary
- Implements token metadata/account structures with JSON and binary encoding, including allowance tracking.
- Likely consumed by both on-chain execution and off-chain UI/client code.

### Top Issues (ranked)
1. **Large manual serde implementation surface**
   - Impact: easy to introduce subtle inconsistencies between JSON and binary representations.
   - Risk: medium.
   - Effort: medium.
   - Location: `types/src/token.rs` (manual `Serialize`/`Deserialize` blocks).
2. **Test-only clippy warnings**
   - Impact: noisy CI; minor hygiene.
   - Risk: low.
   - Effort: low.
   - Location: `types/src/token.rs:605`–`612` (`field_reassign_with_default`).

### Idiomatic Rust Improvements
- Prefer `#[derive(Serialize, Deserialize)]` + small `serde(with = "...")` adapters for hex keys where possible.

### Data Structure & Algorithm Changes
- If token state ever becomes consensus-critical, keep enforcing canonical ordering for map-like fields (already true for allowances).

### Safety & Concurrency Notes
- Ensure any “default key material” used for placeholder values cannot be mistaken for real authority in production contexts.

### Performance & Scaling Notes
- JSON serialization of large allowance maps could be expensive; if it’s hot, offer a compact representation (keep canonical order).

### Refactor Plan
- Phase 1: fix clippy warnings in tests (hygiene).
- Phase 2: refactor manual serde blocks into derived serde + adapters (if feasible without changing external JSON).
- Phase 3: add property tests that JSON↔binary roundtrips preserve canonical ordering and semantics.

### Open Questions
- Is the JSON shape part of a stable external API, or internal-only?

---

## types/src/casino/tournament.rs

### Summary
- Defines tournament state and player membership operations.
- Membership ordering affects determinism and lookup performance.

### Top Issues (ranked)
1. **Player membership invariants must remain enforced (sorted + unique)**
   - Impact: without canonicalization, encoding and membership checks can diverge.
   - Risk: medium.
   - Effort: low (keep current invariant enforcement).
   - Location: `types/src/casino/tournament.rs` decode/insert paths.

### Idiomatic Rust Improvements
- Expose the invariant in the API via a helper (`players_sorted_unique()` or `validate()`), and call it in debug builds.

### Data Structure & Algorithm Changes
- Current sorted-vec + binary search approach is good for “smallish N”; for very large tournaments consider `BTreeSet` or `IndexSet`.
  - Complexity: `O(n)` insert (vec shift) → `O(log n)` (tree), but worse iteration locality.

### Safety & Concurrency Notes
- Deterministic ordering matters if tournament state affects outputs/events hashed into proofs.

### Performance & Scaling Notes
- If tournaments can reach tens of thousands of players, sorted-vec insert costs dominate; profile before switching.

### Refactor Plan
- Phase 1: keep invariant enforcement and add tests for edge cases.
- Phase 2: add a benchmark harness for membership operations under target sizes.
- Phase 3: switch structure if profiling shows insert hotness.

### Open Questions
- Expected tournament sizes and join frequency?

---

## types/src/casino/player.rs

### Summary
- Defines the core player and game-session state for casino and other mechanics.
- Codec implementations define what can be stored on-chain.

### Progress (implemented)
- `Player::new_with_block` now forwards to `Player::new`, and the executor no longer uses the unused `_block` argument.

### Top Issues (ranked)
1. **Player struct is “wide” with many loosely related fields**
   - Impact: harder to maintain invariants; increases accidental coupling.
   - Risk: medium.
   - Effort: medium.
   - Location: `types/src/casino/player.rs:10`–`48`.
2. **`new_with_block` is a compatibility shim with an unused parameter**
   - Impact: mildly confusing API surface; keep call sites on `Player::new`.
   - Risk: low.
   - Effort: low.
   - Location: `types/src/casino/player.rs`.

### Idiomatic Rust Improvements
- Split `Player` into nested structs by domain (`Balances`, `Toggles`, `TournamentState`), keeping codec stable via explicit `Write/Read`.

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Document invariants for fields that must stay bounded (`aura_meter` in 0..=5, shields/doubles non-negative, etc.).

### Performance & Scaling Notes
- Wide structs increase codec size and disk IO; measure serialized size if storage grows.

### Refactor Plan
- Phase 1 (**done**): stop using the unused `_block` argument and make `new_with_block` a compatibility shim.
- Phase 2: refactor to nested structs while preserving codec order (requires careful migration plan).
- Phase 3: add invariant validation helpers and property tests.

### Open Questions
- Is codec format stable across versions, or can it change with migrations?

---

## client/src/client.rs

### Summary
- Implements the HTTP/WebSocket client used by bots and other services.
- Handles retries and verification of consensus messages (seeds/events/lookups).

### Top Issues (ranked)
1. **POST retry path clones request body**
   - Impact: unnecessary allocations if retries enabled for non-idempotent requests.
   - Risk: low.
   - Effort: low.
   - Location: `client/src/client.rs:84`–`98` (`body.clone()` inside closure).
2. **Error `Failed(StatusCode)` drops response body**
   - Impact: hard to debug server-side failures.
   - Risk: low.
   - Effort: low–medium.
   - Location: `client/src/lib.rs` error type + `client/src/client.rs` status handling.

### Idiomatic Rust Improvements
- Use `bytes::Bytes` for cheap clones in retry paths.

**Before:**
```rust
pub(crate) async fn post_bytes_with_retry(&self, url: Url, body: Vec<u8>) -> Result<()> {
    self.send_with_retry(Method::POST, || self.http_client.post(url.clone()).body(body.clone())).await?;
    Ok(())
}
```

**After (pseudocode):**
```rust
pub(crate) async fn post_bytes_with_retry(&self, url: Url, body: bytes::Bytes) -> Result<()> {
    self.send_with_retry(Method::POST, || self.http_client.post(url.clone()).body(body.clone())).await?;
    Ok(())
}
```

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Always verify consensus messages before acting (already done for `Lookup`, `Seed`, `Events`).

### Performance & Scaling Notes
- For high-throughput bots, connection pooling params are good; verify under load with many concurrent websocket streams.

### Refactor Plan
- Phase 1: switch POST body to `Bytes` internally (no external API change if kept private).
- Phase 2: enrich `Error::Failed` with optional response body snippet (size-limited).
- Phase 3: add load tests for retries and websocket reconnect behavior.

### Open Questions
- Is the client intended for untrusted networks (internet) or trusted LAN/test environments?

---

## client/src/events.rs

### Summary
- Provides a typed stream wrapper around a WebSocket connection and optionally verifies consensus signatures.
- Exposes both a custom `next()` and `Stream` impl.

### Top Issues (ranked)
1. **Duplicate decode loop logic between verified/unverified constructors**
   - Impact: increases maintenance cost; bug fixes must be duplicated.
   - Risk: low.
   - Effort: low–medium.
   - Location: `client/src/events.rs:49`–`198`.

### Idiomatic Rust Improvements
- Factor the shared websocket loop into a single function parameterized by an optional verifier.

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- `Drop` aborts the task: good; ensure task cannot hold locks that cause deadlocks.

### Performance & Scaling Notes
- Bounded channel provides backpressure; choose default capacity based on expected burst size.

### Refactor Plan
- Phase 1: dedupe the websocket loop logic.
- Phase 2: add metrics/logging for message sizes and decode errors.
- Phase 3: provide a “lossy mode” option (drop old messages) if UIs fall behind (**behavior-changing** if exposed).

### Open Questions
- Do consumers prefer “backpressure and stall” or “drop and stay live” under overload?

---

## simulator/src/lib.rs

### Summary
- Implements a local Axum-based backend that mimics the node/indexer API: submissions, queries, websockets, and explorer endpoints.
- Maintains a large in-memory state guarded by `RwLock`, plus broadcast channels for updates and mempool streams.

### Progress (implemented)
- Explorer indexing/endpoints moved to `simulator/src/explorer.rs`.
- Passkeys state + endpoints moved to `simulator/src/passkeys.rs` (feature-gated).
- API router + HTTP/WS handlers moved to `simulator/src/api/{mod,http,ws}.rs`.
- Core state/proof logic moved to `simulator/src/state.rs`.
- Explorer retention limits added (opt-in via `SimulatorConfig` / `simulator` CLI flags).
- Rate limiter config no longer panics on invalid builder output (falls back to defaults).

### Top Issues (ranked)
1. **Unbounded in-memory growth**
   - Impact: simulator may grow without bound by default; opt-in explorer retention limits exist now.
   - Risk: medium (long-running sims).
   - Effort: medium.
   - Location: `simulator/src/lib.rs` state maps (`State`); `simulator/src/explorer.rs` (`ExplorerState`).
2. **`SystemTime` used for timestamps (non-deterministic)**
   - Impact: harder to reproduce runs; undermines deterministic tests if called.
   - Risk: low–medium.
   - Effort: low–medium.
   - Location: `simulator/src/explorer.rs:70` (`Simulator::now_ms()`).

### Idiomatic Rust Improvements
- Module split is complete (`api/`, `explorer.rs`, `passkeys.rs`, `state.rs`); keep new logic out of `lib.rs` and add targeted module tests.

### Data Structure & Algorithm Changes
- Bounded retention is available (opt-in):
  - Keep last N blocks in explorer: `--explorer-max-blocks`.
  - Keep last N txs/events per account: `--explorer-max-account-entries`.

### Safety & Concurrency Notes
- `RwLock<State>` around large state can become a bottleneck; avoid holding write locks across expensive operations (proof creation, hashing, serialization).

### Performance & Scaling Notes
- Hotspots likely include:
  - proof creation (`create_proof`, `verify_proof`, multiproof)
  - websocket fanout (broadcast)
  - explorer indexing per block
- Add timing spans around submit paths and proof generation.

### Refactor Plan
- Phase 1: module split without behavior changes.
- Phase 2: add retention limits and make them configurable (CLI flags or builder; **behavior-changing** if defaults change).
- Phase 3: optimize lock granularity (shard explorer state, or use `dashmap` if acceptable).

### Open Questions
- Is the simulator intended for long-lived services, or only short local runs?

---

## website/wasm/src/lib.rs

### Summary
- Exposes a wasm-bindgen interface for generating keys and building/signing transactions from the browser.
- Provides instruction helpers and JSON conversion utilities.

### Progress (implemented)
- Private-key getters are gated behind `private-key-export`, and the feature is now default-off (`website/wasm/Cargo.toml`).

### Top Issues (ranked)
1. **WASM `Signer` exposes private key bytes/hex**
   - Impact: easy to leak keys via logs/JS; security footgun.
   - Risk: high if used beyond testing.
   - Effort: low–medium (API design).
   - Location: `website/wasm/src/lib.rs:128`–`167` (private key getters).
2. **Instruction-kind mapping duplicates logic from Rust enums**
   - Impact: drift risk when instructions change.
   - Risk: medium.
   - Effort: medium.
   - Location: `website/wasm/src/lib.rs:33`–`124`.

### Idiomatic Rust Improvements
- Keep private-key exports opt-in only (done) and consider renaming to `testing`/`dev` or removing entirely (**behavior-changing** for JS consumers that relied on exports).

**Before:**
```rust
#[wasm_bindgen(getter)]
pub fn private_key_hex(&self) -> String { hex(self.private_key.as_ref()) }
```

**After (behavior-changing):**
```rust
#[cfg(feature = "testing")]
#[wasm_bindgen(getter)]
pub fn private_key_hex(&self) -> String { hex(self.private_key.as_ref()) }
```

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Browser key handling should assume hostile JS environment; reduce accidental exposure of secret material.

### Performance & Scaling Notes
- WASM boundary allocations (`Vec<u8>`, `String`) can be expensive; keep interfaces coarse-grained.

### Refactor Plan
- Phase 1: decide security posture for browser keys (dev-only vs real wallets).
- Phase 2: reduce duplication by generating `InstructionKind` from shared tags (if feasible) or add compile-time tests that enforce mapping completeness.
- Phase 3: provide a “sign transaction” API that takes typed instructions rather than raw bytes (already present in parts).

### Open Questions
- Is the wasm signer intended to hold real funds/identities, or only sandbox/dev play?

---

## node/src/application/actor.rs

### Summary
- Central application actor: builds proposed blocks from mempool, verifies incoming blocks, executes finalized blocks, generates proofs, and forwards results to aggregator/indexer.
- One of the highest-risk files: it mixes IO, consensus coordination, storage, and execution; failures here are liveness failures.

### Progress (implemented)
- Inbound mempool tx ingestion now caches per-account “next nonce” to avoid per-transaction state reads.
- Actor init + steady-state no longer use `.expect`/`panic!`; fatal errors are logged and cause the actor to exit (engine stops the node to avoid partial-liveness).

### Top Issues (ranked)
1. **Crash-fast policy on actor failure/exit**
   - Impact: any fatal execution/storage/proof-gen error halts the node (safer, but reduces availability).
   - Risk: medium (availability).
   - Effort: low (document) → medium (actor restart/retry design).
   - Location: `node/src/application/actor.rs:272`, `node/src/application/actor.rs:650`, `node/src/application/actor.rs:710`; `node/src/engine.rs:526`.
2. **Repeated `state.get_metadata()` calls inside hot paths**
   - Impact: redundant IO/locking; increases latency during propose.
   - Risk: low–medium.
   - Effort: low.
   - Location: `node/src/application/actor.rs:384`, `node/src/application/actor.rs:443`.
3. **Ancestry computation is recomputed**
   - Impact: avoidable repeated work under repeated propose/verify requests.
   - Risk: low.
   - Effort: medium.
   - Location: `node/src/application/actor.rs:56`.

### Idiomatic Rust Improvements
- (**implemented**) Replace `unwrap`/`expect`/`panic!` in init and steady-state with logged errors and a clean actor exit; keep crash-fast policy at `node/src/engine.rs`.
- (optional) Split the body into `run_inner(...) -> anyhow::Result<()>` to reduce boilerplate and add richer context via `anyhow::Context`.

Example pattern (snippet):
```rust
let mut state = match Adb::init(...).await {
    Ok(state) => state,
    Err(err) => { error!(?err, "init failed"); return; }
};
```

### Data Structure & Algorithm Changes
- Cache the finalized height locally to avoid repeated metadata reads.
  - Complexity: `O(1)` cache read vs repeated async IO.
- If mempool ingestion is hot: batch nonces per account instead of calling `nonce(&state, &tx.public).await` for every incoming tx.

### Safety & Concurrency Notes
- `blocks.last().unwrap()` assumes ancestry is never empty; encode this as a type invariant or return an error early.
- Avoid holding `Mutex` guards across `.await` (currently looks okay, but any future edits can accidentally violate this).

### Performance & Scaling Notes
- Likely hotspots:
  - proof generation (`historical_proof`)
  - storage prune/sync
  - repeated metadata reads
  - ancestry computation (currently recomputed each request; comment already notes caching)
- Measurement suggestions:
  - add spans around `execute_state_transition`, proof generation, and prune
  - log proof op counts per block to correlate with latency

### Refactor Plan
- Phase 1 (**done**): remove `.expect`/`panic!` from init + steady-state; log and exit on fatal errors.
- Phase 2 (**done**): crash-fast fault policy at the engine level (node terminates when any actor stops/fails).
- Phase 3: performance work based on profiling (nonce caching, ancestry caching, proof generation batching).

### Open Questions
- Is crash-fast the desired long-term policy, or should the engine restart actors / retry transient failures?

---

## node/src/lib.rs

### Summary
- Defines `Config` and `ValidatedConfig` for the node along with parsing/validation helpers.
- This is the boundary between operator-provided YAML and strongly typed runtime config.

### Progress (implemented)
- Added non-zero validation for all required sizing/concurrency fields.
- Added validation for `indexer` URL (http/https with host) and for `port`/`metrics_port` conflicts.

### Top Issues (ranked)
1. **Stringly-typed config fields**
   - Impact: repeated parse/validate logic; error-prone; harder to keep consistent.
   - Risk: low–medium.
   - Effort: medium.
   - Location: `node/src/lib.rs` (`private_key`, `share`, `polynomial`, and peer-related lists as `String`/`Vec<String>`).

### Idiomatic Rust Improvements
- Prefer `serde` deserialization into strongly typed fields (newtypes) with good errors, instead of parsing post-deserialize.

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Config parsing is a common attack surface in long-lived daemons; keep error messages clear but avoid leaking secrets in logs.

### Performance & Scaling Notes
- Not performance critical.

### Refactor Plan
- Phase 1 (**done**): extend validation to all “must be > 0” fields and to URL/socket formats.
- Phase 2: introduce newtypes for hex-encoded fields and decode during deserialization.
- Phase 3: add a `Config::redacted_debug()` helper to avoid accidentally logging secrets.

### Open Questions
- Is config format stable and public, or can it change between versions without migration support?

---

## node/src/main.rs

### Summary
- CLI entrypoint: loads config and peer set, initializes runtime, and boots the engine.
- Owns operational defaults (quotas, message sizes, buffer sizes).

### Progress (implemented)
- `load_peers` now shares bootstrapper parsing + address mapping logic between `--hosts` and `--peers`.
- Replaced `NonZeroU32::new(...).unwrap()` quota construction with `NZU32!`.

### Top Issues (ranked)
1. **Duplicated peer-loading logic for `--hosts` vs `--peers`**
   - Impact: harder to maintain; easy to introduce inconsistent behavior.
   - Risk: low.
   - Effort: low–medium.
   - Location: `node/src/main.rs:44`–`141` (`load_peers`).
2. **Hard-coded quotas and sizes sprinkled through main**
   - Impact: tuning requires code changes; config drift between environments.
   - Risk: medium.
   - Effort: medium.
   - Location: `node/src/main.rs` constants and quota setup (`NonZeroU32::new(...).unwrap()`).

### Idiomatic Rust Improvements
- Use `NonZero*` constructor macros consistently (you already use `NZUsize!`); avoid `.unwrap()` when a macro can enforce the invariant at compile time.

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- `with_catch_panics(true)` is good, but panics inside control-plane actors can still wedge progress; prefer explicit errors when possible.

### Performance & Scaling Notes
- Main’s impact is configuration; the key is making tuning observable and safe.

### Refactor Plan
- Phase 1 (**done**): refactor `load_peers` to share parsing logic and reduce duplication.
- Phase 2: move tunables into config with defaults (quotas, sizes) and print them on startup.
- Phase 3: add a `--dry-run` report that includes derived resource estimates (memory/disk) (**behavior-changing** if you add output formats).

### Open Questions
- Which tunables must be runtime-configurable vs compile-time constants?

---

## client/src/lib.rs

### Summary
- Defines the client crate’s public API surface: `Client`, `RetryPolicy`, `Stream`, and `Error`.
- Includes integration-style tests that exercise simulator APIs.

### Top Issues (ranked)
1. **`Error::Failed(StatusCode)` lacks structured context**
   - Impact: debugging is difficult when server returns non-200; body/endpoint not preserved.
   - Risk: low.
   - Effort: low–medium.
   - Location: `client/src/lib.rs:25`–`59`.

### Idiomatic Rust Improvements
- Keep `Error` variants actionable: include URL path and (bounded) response body for `Failed`.

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Tests spawn servers and abort them on drop: good. Ensure abort doesn’t leave tasks holding resources in other runtimes.

### Performance & Scaling Notes
- Not performance critical; correctness and usability matter more.

### Refactor Plan
- Phase 1: enrich `Error::Failed` with context (endpoint + optional body snippet).
- Phase 2: add an error variant for “verification failed with reason” instead of collapsing to `InvalidSignature`.
- Phase 3: document retry policy semantics (idempotent vs non-idempotent).

### Open Questions
- Is client error type part of stable public API (semver guarantees), or can it change freely?

---

## client/src/consensus.rs

### Summary
- Implements consensus-related client helpers (currently seed querying/verification).
- Ensures returned seeds match the query and verify against the network identity.

### Top Issues (ranked)
1. **Minimal context on `UnexpectedResponse`**
   - Impact: hard to debug mismatched view/index cases.
   - Risk: low.
   - Effort: low.
   - Location: `client/src/consensus.rs:20`–`38`.

### Idiomatic Rust Improvements
- Return an error that carries “expected vs got” when a seed doesn’t match the requested index.

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Verifying seeds is mandatory; current code does it (good).

### Performance & Scaling Notes
- Not a hotspot.

### Refactor Plan
- Phase 1: improve error detail for mismatch cases.
- Phase 2: add a helper for “wait for latest seed >= X” if bots need it (**behavior-changing** if exposed as new API).
- Phase 3: unify URL construction helpers across client modules.

### Open Questions
- Do clients frequently query by index (historical) or mostly `Latest`?

---

## execution/src/casino/baccarat.rs

### Summary
- Baccarat game implementation (rules, dealing, payouts).
- Used by execution `Layer` when processing game instructions.

### Top Issues (ranked)
1. **Non-idiomatic range checks**
   - Impact: readability; easy to get wrong in edge cases.
   - Risk: low.
   - Effort: low.
   - Location: `execution/src/casino/baccarat.rs:232`, `:239` (clippy `manual_range_contains`).

### Idiomatic Rust Improvements
**Before:**
```rust
v >= 2 && v <= 7
```

**After:**
```rust
(2..=7).contains(&v)
```

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Determinism: ensure RNG usage is solely derived from the seeded game RNG (no wall-clock).

### Performance & Scaling Notes
- Not likely a hotspot relative to proof generation and storage IO.

### Refactor Plan
- Phase 1: apply clippy fixes.
- Phase 2: add property tests for payout invariants.
- Phase 3: refactor repeated card utilities into shared helpers if duplicated across games.

### Open Questions
- Are baccarat rules meant to be configurable (commission variants), or fixed?

---

## execution/src/casino/roulette.rs

### Summary
- Roulette game implementation including bet parsing and payout rules.
- Processes a variety of bet types with many range checks.

### Top Issues (ranked)
1. **Repeated manual range checks and negated contains**
   - Impact: readability and correctness; range boundaries are easy to mishandle.
   - Risk: low–medium.
   - Effort: low.
   - Location: e.g. `execution/src/casino/roulette.rs:160`–`161`, `:432` (clippy `manual_range_contains` / `manual_range_contains` negation).

### Idiomatic Rust Improvements
**Before:**
```rust
result >= 1 && result <= 18
if number < 1 || number > 35 || number % 3 == 0 { ... }
```

**After:**
```rust
(1..=18).contains(&result)
if !(1..=35).contains(&number) || number % 3 == 0 { ... }
```

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Ensure bet parsing rejects invalid payloads deterministically and emits consistent errors.

### Performance & Scaling Notes
- Parsing bet payloads should avoid unnecessary allocations; consider parsing directly from byte slices.

### Refactor Plan
- Phase 1: apply clippy fixes.
- Phase 2: add roundtrip tests for bet encoding/decoding and payout correctness.
- Phase 3: unify bet-validation helpers across table games.

### Open Questions
- Is roulette bet payload format stable and documented for external clients?

---

## execution/src/casino/blackjack.rs

### Summary
- Blackjack game implementation, including move processing and payout resolution.
- Contains complex branching logic for hand outcomes.

### Top Issues (ranked)
1. **Duplicate `if` branches (clippy `if_same_then_else`)**
   - Impact: harder to audit payouts; duplicates are fertile ground for subtle bugs.
   - Risk: medium (payout correctness).
   - Effort: low–medium.
   - Location: `execution/src/casino/blackjack.rs:702`+ (clippy warning site).

### Idiomatic Rust Improvements
- Consolidate duplicated branches and make payout calculation table-driven where possible.

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Deterministic RNG and consistent state-blob updates are essential.

### Performance & Scaling Notes
- Blackjack move processing can be hot if popular; consider caching hand value computations within a single move.

### Refactor Plan
- Phase 1: remove duplicated branches and add tests for the affected payout cases.
- Phase 2: extract hand evaluation and payout rules into isolated helpers.
- Phase 3: add property tests for “no balance underflow” and payout bounds.

### Open Questions
- Are side-bets and variants expected to expand (more complexity), or should the core remain minimal?

---

## types/src/casino/leaderboard.rs

### Summary
- Maintains the top-N leaderboard entries, sorted by chip count, and encodes/decodes to binary.
- Used for UI display and potentially for reward logic.

### Top Issues (ranked)
1. **Tie-breaking on equal chips is implicit**
   - Impact: ordering among equal chip counts can vary depending on insertion order; may be fine but should be explicit if consensus-critical.
   - Risk: low–medium.
   - Effort: low.
   - Location: `types/src/casino/leaderboard.rs:47`–`99` (`binary_search_by(|e| chips.cmp(&e.chips))`).

### Idiomatic Rust Improvements
- Make tie-breaker explicit (e.g., by player pubkey) if deterministic ordering is required across all histories.

### Data Structure & Algorithm Changes
- For fixed top-10, `Vec` is ideal; avoid switching to heavier structures.

### Safety & Concurrency Notes
- If leaderboard updates are part of consensus-visible state, ordering should be explicitly deterministic under ties.

### Performance & Scaling Notes
- Bounded to 10 entries; performance is already optimal.

### Refactor Plan
- Phase 1: decide tie-breaker policy and document it.
- Phase 2: implement tie-breaker in the comparator if needed.
- Phase 3: add tests for equal-chip ordering.

### Open Questions
- Is leaderboard state consensus-critical, or purely informational?

---

## types/src/casino/codec.rs

### Summary
- Provides helpers for length-prefixed string encoding and decoding with max length enforcement.
- Used by many casino types to keep binary codec consistent.

### Top Issues (ranked)
1. **Decoding allocates a `Vec<u8>` per string**
   - Impact: minor allocation overhead; may matter if strings are decoded frequently.
   - Risk: low.
   - Effort: low–medium.
   - Location: `types/src/casino/codec.rs:14`–`27`.

### Idiomatic Rust Improvements
- If profiling shows this matters, use `bytes::Bytes`/`copy_to_bytes` to reduce intermediate allocations (while still validating UTF-8).

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Max length checks are good; keep them.

### Performance & Scaling Notes
- Likely negligible compared to proof verification and storage IO.

### Refactor Plan
- Phase 1: keep as-is (it’s clear and safe).
- Phase 2: optimize only if profiling shows string decoding is hot.
- Phase 3: add fuzz tests for malformed UTF-8 and length overflows.

### Open Questions
- Are any of these strings user-controlled and potentially adversarial at scale (spam/DoS)?

---

## execution/src/lib.rs

### Summary
- Crate root for execution: exposes `casino`, `state_transition`, mocks (feature-gated), and core state abstractions.
- Defines what `nullspace-execution` exports publicly.

### Progress (implemented)
- Added crate/module docs describing determinism requirements and recovery invariants.

### Top Issues (ranked)
1. **Public API surface is broad and lightly documented**
   - Impact: harder for downstream users to understand stability and intended usage.
   - Risk: low.
   - Effort: low–medium.
   - Location: `execution/src/lib.rs` exports.

### Idiomatic Rust Improvements
- Add rustdoc at the crate root describing:
  - determinism requirements
  - storage invariants (events committed before state)
  - which modules are stable vs internal

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Feature-gated mocks are good; ensure production builds don’t accidentally enable them.

### Performance & Scaling Notes
- Not applicable.

### Refactor Plan
- Phase 1 (**done**): add crate-level docs and module docs.
- Phase 2: shrink public exports if possible (avoid exposing internals) (**behavior-changing** if semver matters).
- Phase 3: add examples showing a minimal execution pipeline.

### Open Questions
- Is `nullspace-execution` intended as a general-purpose crate for others, or internal-only?

---

## types/src/lib.rs

### Summary
- Re-exports `api`, `casino`, `execution`, and `token` modules as a single types crate.
- Acts as the shared “wire and state schema” across the workspace.

### Progress (implemented)
- Added crate/module docs describing stability expectations and consensus-critical encoding concerns.

### Top Issues (ranked)
1. **No clear stability policy for exported modules**
   - Impact: consumers can accidentally depend on unstable internals.
   - Risk: low–medium.
   - Effort: low.
   - Location: `types/src/lib.rs` re-exports.

### Idiomatic Rust Improvements
- Use `pub(crate)` for internal-only modules and `pub use` only the intended stable surface (if possible).

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Deterministic encoding is the primary safety concern here; prefer canonical data structures for anything hashed/committed.

### Performance & Scaling Notes
- Not applicable.

### Refactor Plan
- Phase 1 (**done**): document module responsibilities and stability expectations.
- Phase 2: optionally narrow exports (**behavior-changing**).
- Phase 3: add a compatibility test suite for encoding stability across versions.

### Open Questions
- Do external clients rely on these types directly (semver required), or are they internal?

---

## simulator/src/main.rs

### Summary
- CLI entrypoint for running the local simulator server.
- Parses identity, starts Axum server, and logs.

### Top Issues (ranked)
1. **Identity passed as hex string without ergonomic helpers**
   - Impact: usability; easy to fat-finger.
   - Risk: low.
   - Effort: low.
   - Location: `simulator/src/main.rs:13`–`41`.

### Idiomatic Rust Improvements
- Add a `--gen-identity` helper or allow reading from a file (**behavior-changing** if CLI changes).

### Data Structure & Algorithm Changes
- None.

### Safety & Concurrency Notes
- Server binds to `0.0.0.0` by default; ensure this is intended for local dev (security).

### Performance & Scaling Notes
- Not applicable.

### Refactor Plan
- Phase 1: keep as-is; it’s small and clear.
- Phase 2: improve CLI ergonomics and safety defaults (bind to localhost unless explicit).
- Phase 3: add a “print config” / “healthcheck” endpoint for dev convenience.

### Open Questions
- Should the simulator be reachable from the LAN by default, or only localhost?

---

## node/src/seeder/actor.rs

### Summary
- Maintains and backfills the seed chain, serves seeds to other components, and uploads seeds to the indexer.
- Runs continuously and interacts with storage, p2p resolver, and external indexer APIs.

### Progress (implemented)
- Listener sends are best-effort (dropped receivers no longer panic the actor).
- Storage operations no longer use `.expect`; fatal storage errors are logged and cause the actor to exit (engine is crash-fast).
- Seed uploads now use exponential backoff with jitter and emit metrics (attempts/failures, outstanding uploads, and upload lag).

### Top Issues (ranked)
1. **Crash-fast on storage/indexer faults**
   - Impact: any storage/IO failure halts the node (safety > availability).
   - Risk: medium (availability).
   - Effort: low (document) → medium (restart/retry design).
   - Location: `node/src/seeder/actor.rs`; `node/src/engine.rs:526`.
2. **Infinite retry loop for seed uploads**
   - Impact: prolonged indexer outages lead to unbounded retries; now uses exponential backoff + metrics but still has no max-attempt cutover.
   - Risk: medium.
   - Effort: low.
   - Location: `node/src/seeder/actor.rs` (seed submit task loop).

### Idiomatic Rust Improvements
- Treat listener send failure as non-fatal; drop disconnected listeners.

**Before:**
```rust
listener.send(seed.clone()).expect("failed to send seed");
```

**After:**
```rust
let _ = listener.send(seed.clone());
```

### Data Structure & Algorithm Changes
- `listeners: HashMap<View, Vec<oneshot::Sender<Seed>>>` is fine; if high fanout becomes common, consider bounding waiters per view to avoid memory blowups under adversarial clients.

### Safety & Concurrency Notes
- Seeder ingress uses a shutdown `Signal`; seeder actor should honor the same shutdown semantics and avoid panics during shutdown.

### Performance & Scaling Notes
- Seed upload loop retries forever; add metrics for retry counts and upload lag (`cursor - boundary`) to detect indexer outages.

### Refactor Plan
- Phase 1 (**done**): remove `expect` for listener sends and replace with best-effort.
- Phase 2 (**done**): convert storage operations to logged failures and actor exit; crash-fast fault policy at engine level.
- Phase 3: add backpressure/bounds for listener accumulation and upload concurrency.

### Open Questions
- Is the indexer always available/required for seeder progress, or can the node operate while indexer is down?
