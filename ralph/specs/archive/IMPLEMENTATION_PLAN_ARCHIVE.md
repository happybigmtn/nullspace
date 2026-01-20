# Implementation Plan Archive

Completed work items moved from `IMPLEMENTATION_PLAN.md`.

---

## Archived: 2026-01-17

### BufferedMempool Implementation ✅

- [x] Created `simulator/src/mempool.rs` with BufferedMempool struct
- [x] Implemented replay window for late subscribers (30s default)
- [x] Fixed race condition where transactions were lost before subscribers connected
- [x] Added sequence-based ordering for guaranteed delivery
- [x] Fixed bug where only last transaction was delivered to subscribers
- [x] All mempool unit tests passing

**Files Changed**:
- `simulator/src/mempool.rs` (new)
- `simulator/src/lib.rs` (integration)
- `simulator/src/state.rs` (updated to use BufferedMempool)
- `simulator/src/api/ws.rs` (updated mempool WebSocket handler)

### Nonce Floor Bug Fix ✅

- [x] Identified FLOOR_MAP overriding lower chain nonces after reset
- [x] Added check: `floor <= serverNonce` to prevent override
- [x] Deployed via CI/CD (commit c132e2c)

**Files Changed**:
- `website/src/api/nonceManager.js`

### Phase 1: Debug Website Rendering ✅ (Critical)

- [x] Add visible error boundaries with error messages
- [x] Add WASM initialization logging
- [x] Add startup health check endpoint
- [x] Add visual loading states

### Phase 2: Transaction Pipeline Observability ✅ (Critical)

- [x] Add transaction submission logging
- [x] Add validator transaction receipt logging
- [x] Add mempool depth metric
- [x] Add end-to-end transaction test

**Files Changed**:
- `scripts/test-transaction-flow.sh` (new)
- `scripts/test-transaction-submit.mjs` (new)

### Phase 3: Recovery Automation ✅ (Medium)

- [x] Add nonce reset command (`scripts/clear-browser-nonce.sh`)
- [x] Add full-stack health check (`scripts/health-check-full.sh`)
- [x] Add transaction flow smoke test (`scripts/smoke-test-transactions.sh`)

### Phase 4: Defensive Improvements ✅ (Low)

- [x] Remove FLOOR_MAP entirely (AC-4.1)
- [x] Add nonce sync on every transaction (AC-4.2)
- [x] Add transaction rejection feedback (AC-4.3)

**AC-4.3 Implementation Details**:
- Added `SubmitError::NonceTooLow` variant to `simulator/src/submission.rs`
- Simulator now validates transaction nonces against on-chain state before mempool broadcast
- HTTP `/submit` endpoint returns structured rejection reason: `nonce_too_low:<pubkey>:tx_nonce=<N>:expected=<M>`
- Gateway's `NonceManager.isNonceMismatch()` auto-detects the new error format and triggers nonce resync
- Gateway handlers already call `handleRejection()` to surface errors to browser

**Files Changed**:
- `simulator/src/submission.rs` (new error variant + nonce validation)
- `simulator/src/api/http.rs` (structured error response)

---

## Archived: 2026-01-20

### Sprint 01: Deterministic seed/time-scaling config parsing ✅

- [x] Added deterministic seed + time scale fields to simulator config and CLI parsing
- [x] Added deterministic seed + time scale fields to node config parsing
- [x] Simulator validation rejects `deterministic_time_scale_ms=0`

**Files Reviewed**:
- `simulator/src/state.rs` (SimulatorConfig fields)
- `simulator/src/main.rs` (CLI args + validation tests)
- `node/src/lib.rs` (config fields + validation wiring)

### Sprint 01: Local bootstrap guardrails ✅

- [x] Agent bootstrap validates configs and env prerequisites before start
- [x] Health check script returns non-zero on failed endpoints or stale metrics
- [x] Agent bootstrap fails fast when expected ports are already in use

**Files Reviewed/Updated**:
- `scripts/agent-up.sh` (port reuse checks, bootstrap prerequisites)
- `scripts/agent-loop.sh` (local stack orchestration)
- `scripts/health-check.sh` (endpoint + metric checks)

### Sprint 01: Faucet helper for test wallets ✅

- [x] Added CLI wrapper for funding new or existing wallets
- [x] Added faucet implementation with register + deposit flow
- [x] Integration coverage for faucet funding path

**Files Reviewed**:
- `scripts/faucet.sh` (CLI wrapper, health check, error handling)
- `scripts/faucet.mjs` (register + deposit flow)
- `tests/integration/faucet.test.ts` (funding integration tests)

### Sprint 01: Config schema validation ✅

- [x] Production config validation rejects placeholder credentials
- [x] Origin list validation enforces valid http/https URLs
- [x] Unit tests cover placeholder detection, short secrets, and error messaging

**Files Reviewed**:
- `gateway/src/config/validation.ts` (validation rules)
- `gateway/tests/unit/config-validation.test.ts` (unit test coverage)
