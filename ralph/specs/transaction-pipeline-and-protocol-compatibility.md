# Transaction Pipeline and Protocol Compatibility

**Status**: draft  
**Date**: 2026-01-16  
**Scope**: Mempool ingestion, transaction inclusion, protocol version compatibility, and backpressure across gateway, simulator, and validators.

This spec addresses failures where transactions were submitted but blocks finalized with `tx_count=0`. It focuses on making the transaction path observable, deterministic, and compatible across client/server versions.

## 1. Goals

1. **Consistent tx inclusion**: Pending mempool transactions are included in blocks within a bounded number of rounds.
2. **Protocol compatibility**: Gateways, clients, and validators agree on encoding versions and reject mismatches explicitly.
3. **Bet format parity**: Game move payloads (including bet formats) are consistent across Rust/JS/TS and do not require ad-hoc stripping or rewrites.
4. **Backpressure**: Mempool admission and batching are bounded and observable.
5. **Clear error reporting**: Every rejected transaction has a reason code and is logged.

## 2. Non-Goals

- Changing the game instruction set.
- Replacing the mempool with a new architecture.

## 3. Architecture

### 3.1 Version Negotiation

Introduce a lightweight compatibility handshake:
- Gateway advertises protocol version and min-compatible version.
- Nodes reject transactions whose version header is unsupported.
- Errors are surfaced as explicit API responses (not silent drops).

### 3.1b Payload Parity

- Rust is the canonical encoder for game move payloads; JS/TS uses generated bindings.
- Eliminate per-surface rewrites (e.g., version-header stripping) by supporting versioned payloads end-to-end.
- Add golden vectors that include all bet-format variants.

### 3.2 Mempool Admission

- Enforce per-account backlog limits and global caps with metrics.
- Track pending-by-account and pending-total gauges.
- Emit structured reject reasons (nonce mismatch, backlog cap, invalid signature).

### 3.3 Block Inclusion SLA

- Define an inclusion SLA: a valid transaction must be proposed within N rounds.
- If SLA is violated, emit a liveness warning and trace the queue state.

## 4. Testing Requirements

### 4.1 Integration Tests
- Submit valid transactions; verify inclusion within N rounds.
- Submit invalid version; verify explicit rejection reason.
- Mempool caps trigger rejections with metrics.

### 4.2 Protocol Tests
- Golden vectors for all protocol versions.
- Cross-version encode/decode round-trip tests.

## 5. Acceptance Criteria

### AC-1: Inclusion SLA
- **AC-1.1**: Valid transactions are included within 2 consensus rounds under normal load.
- **AC-1.2**: If inclusion exceeds SLA, a liveness warning is emitted with queue state details.

### AC-2: Explicit Rejection Reasons
- **AC-2.1**: Invalid version headers return a clear error code.
- **AC-2.2**: Nonce mismatches and backlog limits return explicit errors and metrics.

### AC-3: Protocol Compatibility
- **AC-3.1**: Gateway rejects clients below minimum supported version.
- **AC-3.2**: Validators reject incompatible payloads and log the version.

## 6. Implementation Map

- Protocol encoding/versioning: `packages/protocol/src/encode.ts`, `packages/protocol/src/games/actions.ts`
- Gateway codec/tests: `gateway/src/codec`, `gateway/tests/unit/codec.test.ts`
- Mempool logic: `node/src/application/mempool.rs`
- Admission logs/metrics: `node/src/application/actor.rs`
