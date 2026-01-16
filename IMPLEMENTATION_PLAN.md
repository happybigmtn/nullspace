# Implementation Plan: Runtime Simplification + Rust-Canonical Protocol + Compact Game Encoding

**Phase**: 2 (planning)
**Date**: 2026-01-16
**Scope**: Defer live mode + bridge + liquidity/staking, simplify auth, consolidate codecs around Rust, fix historical chain errors, and roll out compact on-chain game encoding (bitwise, Rust-canonical).

## Sources of Truth

- `ralph/specs/gateway-live-mode-deferment.md`
- `ralph/specs/evm-bridge-deferment.md`
- `ralph/specs/liquidity-staking-deferment.md`
- `ralph/specs/auth-simplification.md`
- `ralph/specs/codec-consolidation-rust-native.md`
- `ralph/specs/transaction-pipeline-and-protocol-compatibility.md`
- `ralph/specs/threshold-signature-reconciliation.md`
- `ralph/specs/consensus-liveness-and-recovery-hardening.md`
- `ralph/specs/compact-encoding-framework.md`
- `ralph/specs/compact-encoding-blackjack.md`
- `ralph/specs/compact-encoding-baccarat.md`
- `ralph/specs/compact-encoding-roulette.md`
- `ralph/specs/compact-encoding-craps.md`
- `ralph/specs/compact-encoding-sicbo.md`
- `ralph/specs/compact-encoding-three-card.md`
- `ralph/specs/compact-encoding-ultimate-holdem.md`
- `ralph/specs/compact-encoding-casino-war.md`
- `ralph/specs/compact-encoding-video-poker.md`
- `ralph/specs/compact-encoding-hilo.md`

## Guiding Principles

1. **Core gameplay first**: preserve session-based casino flows above all else.
2. **Single source of truth**: Rust defines protocol tags + encoding; JS consumes generated artifacts.
3. **Feature deferral over partial support**: disable non-core features cleanly instead of leaving half-functional paths.
4. **Reduce runtime concurrency**: fewer background sockets and parsers, fewer moving parts.
5. **Mobile stays first-class**: changes must keep mobile functional and stable.
6. **Compact on-chain encoding**: shrink move payloads and state blobs without losing information.

## Milestones

### M0: Repository Alignment + Safety Nets

- [x] Inventory references for live mode, bridge, liquidity/staking, auth billing/evm/ai, and codec stacks.
  - Tests: AC-1.1/AC-1.2 (all affected endpoints identified)
  - Perceptual: None
  - Output: `ralph/FEATURE_INVENTORY.md` (comprehensive inventory document)
- [x] Establish feature-disable error codes (`feature_disabled`, `bridge_disabled`) and ensure they surface cleanly.
  - Tests: AC-1.1 (bridge disabled errors), AC-1.1 (liquidity/staking disabled errors)
  - Perceptual: None

**Exit criteria**
- All code paths to be disabled are mapped with concrete file references.

### M0b: Historical Chain Failure Remediation

- [x] Reconcile threshold signature verification and remove staging bypass.
  - Tests: AC-1.1, AC-1.2, AC-3.1
  - Perceptual: None
- [ ] Add mempool connectivity and tx inclusion liveness signals (health check + metrics).
  - Tests: AC-1.1, AC-1.2, AC-1.3
  - Perceptual: None
- [ ] Eliminate protocol payload drift (version header handling, bet format parity).
  - Tests: AC-2.1, AC-3.1, AC-4.1
  - Perceptual: None

**Exit criteria**
- Summary verification passes without bypass; tx inclusion path has explicit liveness signals; protocol payloads are version-consistent.

### M1: Defer Gateway Live Mode

- [ ] Remove live-table wiring from `gateway/src/index.ts` and archive live-table modules.
  - Tests: AC-1.1, AC-1.2, AC-1.3
  - Perceptual: None
- [ ] Remove global-table event decode usage in gateway runtime (no background global-table client).
  - Tests: AC-1.3
  - Perceptual: None
- [ ] Verify standard session flows are unchanged.
  - Tests: AC-2.1, AC-2.2
  - Perceptual: None

**Exit criteria**
- Gateway boots without live mode; standard sessions still function.

### M2: Defer EVM Bridge

- [ ] Gate or remove bridge instructions in execution layer (`execution/src/layer/handlers/bridge.rs`).
  - Tests: AC-1.1, AC-1.2
  - Perceptual: None
- [ ] Remove bridge instruction/event tags from public protocol exports when disabled.
  - Tests: AC-1.1, AC-1.2
  - Perceptual: None
- [ ] Remove Bridge UI + relayer tooling (website + `client` bin).
  - Tests: AC-2.1, AC-2.2
  - Perceptual: AC-PQ.1 (no bridge UI entry points in navigation)
- [ ] Remove EVM bridge config expectations from services.
  - Tests: AC-3.1, AC-3.2
  - Perceptual: None

**Exit criteria**
- Bridge disabled end-to-end; no UI or tooling references remain.

### M3: Defer Liquidity/AMM/Staking

- [ ] Gate or remove AMM + staking handlers in `execution/src/layer/handlers/`.
  - Tests: AC-1.1, AC-1.2
  - Perceptual: None
- [ ] Remove AMM/staking instruction/event tags from public protocol exports when disabled.
  - Tests: AC-1.1, AC-1.2
  - Perceptual: None
- [ ] Remove or hide liquidity/staking UI.
  - Tests: AC-2.1, AC-2.2
  - Perceptual: AC-PQ.1 (no liquidity/staking entry points)

**Exit criteria**
- AMM/staking paths are fully disabled and unreachable.

### M4: Simplify Auth Service

- [ ] Remove billing/Stripe endpoints and Convex hooks (auth + website/convex).
  - Tests: AC-1.1, AC-1.2
  - Perceptual: None
- [ ] Remove EVM linking endpoints and related env dependencies.
  - Tests: AC-2.1, AC-2.2
  - Perceptual: None
- [ ] Remove AI proxy endpoints.
  - Tests: AC-3.1, AC-3.2
  - Perceptual: None
- [ ] Validate core session auth flows remain intact.
  - Tests: AC-4.1, AC-4.2
  - Perceptual: None

**Exit criteria**
- Auth starts without billing/EVM/AI env vars; core auth still works.

### M5: Rust-Canonical Codec Consolidation

- [ ] Define Rust as canonical protocol source and export tags/versions to JS/TS.
  - Tests: AC-1.1
  - Perceptual: None
- [ ] Replace hand-maintained codec logic in `@nullspace/protocol` with generated or WASM-backed bindings.
  - Tests: AC-1.2, AC-3.1, AC-3.2
  - Perceptual: None
- [ ] Remove gateway custom Update decoder (`gateway/src/codec/events.ts`) and rely on raw forwarding or Rust-derived decode.
  - Tests: AC-2.1, AC-2.2
  - Perceptual: None
- [ ] Add golden vector parity tests between Rust and JS/TS (encode/decode).
  - Tests: AC-3.2, AC-4.2
  - Perceptual: None

**Exit criteria**
- Protocol decoding/encoding has a single canonical source and parity tests pass.

### M6: Compact Game Encoding (v2 Bitwise)

**Framework (shared across games)**

- [ ] Implement core BitWriter/BitReader + AmountCodec in Rust (bitwise v2).
  - Tests: AC-1.1, AC-3.1 (framework)
  - Perceptual: None
- [ ] Implement unified bet descriptor + per-game bet-type tables in Rust.
  - Tests: AC-2.1, AC-2.2
  - Perceptual: None
- [ ] Add dual-decode migration layer (accept v1 + v2) and explicit version validation.
  - Tests: AC-4.1, AC-4.2
  - Perceptual: None

**Per‑game move payloads + state blobs**

- [ ] Blackjack v2 payload/state (spec: `compact-encoding-blackjack.md`).
  - Tests: AC-1.1, AC-1.2, AC-2.1, AC-3.1
  - Perceptual: None
- [ ] Baccarat v2 payload/state (spec: `compact-encoding-baccarat.md`).
  - Tests: AC-1.1, AC-1.2, AC-2.1, AC-3.1
  - Perceptual: None
- [ ] Roulette v2 payload/state (spec: `compact-encoding-roulette.md`).
  - Tests: AC-1.1, AC-1.2, AC-2.1, AC-3.1
  - Perceptual: None
- [ ] Craps v2 payload/state (spec: `compact-encoding-craps.md`).
  - Tests: AC-1.1, AC-1.2, AC-2.1, AC-3.1
  - Perceptual: None
- [ ] Sic Bo v2 payload/state (spec: `compact-encoding-sicbo.md`).
  - Tests: AC-1.1, AC-1.2, AC-2.1, AC-3.1
  - Perceptual: None
- [ ] Three Card v2 payload/state (spec: `compact-encoding-three-card.md`).
  - Tests: AC-1.1, AC-1.2, AC-2.1, AC-3.1
  - Perceptual: None
- [ ] Ultimate Hold’em v2 payload/state (spec: `compact-encoding-ultimate-holdem.md`).
  - Tests: AC-1.1, AC-1.2, AC-2.1, AC-3.1
  - Perceptual: None
- [ ] Casino War v2 payload/state (spec: `compact-encoding-casino-war.md`).
  - Tests: AC-1.1, AC-1.2, AC-2.1, AC-3.1
  - Perceptual: None
- [ ] Video Poker v2 payload/state (spec: `compact-encoding-video-poker.md`).
  - Tests: AC-1.1, AC-1.2, AC-2.1, AC-3.1
  - Perceptual: None
- [ ] HiLo v2 payload/state (spec: `compact-encoding-hilo.md`).
  - Tests: AC-1.1, AC-2.1, AC-3.1
  - Perceptual: None

**Bindings + parity**

- [ ] Generate JS/TS bindings from Rust and remove hand-maintained payload encoders.
  - Tests: AC-3.1, AC-3.2, AC-4.2
  - Perceptual: None
- [ ] Add v2 golden vectors + size regression tests (payload + state blobs).
  - Tests: AC-1.1, AC-1.2, AC-4.1, AC-4.2
  - Perceptual: None

**Exit criteria**
- All games accept v2 payloads + compact state blobs; parity and size‑reduction tests pass in Rust + JS/TS.

### M7: Regression + Performance Checks

- [ ] Validate that standard session gameplay remains functional across website + mobile.
  - Tests: AC-2.1, AC-2.2, AC-4.1
  - Perceptual: AC-PQ.1 (UX still coherent with removed features)
- [ ] Confirm no >5% regression in encode/decode latency (gateway + client).
  - Tests: AC-4.1
  - Perceptual: None

**Exit criteria**
- Core gameplay remains stable with simplified runtime surface.

## Dependencies

- M0b depends on M0.
- M1 depends on M0b (stability fixes before removals).
- M2 and M3 can proceed in parallel after M0b.
- M4 depends on M2 (EVM linking) for cleanup sequencing.
- M5 depends on M1 (remove live-table decode) and informs M2/M3 protocol tag pruning.
- M6 depends on M5 (canonical codec) and M0b (payload parity).
- M7 depends on M1–M6.

## Codebase Review Notes (Plan Refinement)

- **Gateway live mode**: `gateway/src/index.ts` wires `crapsLiveTable`; `gateway/src/live-table/**` owns live-mode runtime and `GlobalTableEvent` decode paths.
- **Gateway codec duplication**: `gateway/src/codec/events.ts` and `gateway/src/backend/updates.ts` implement bespoke Update decoding + fallback parsing; `SessionManager` depends on `UpdatesClient`.
- **Bridge**: `execution/src/layer/handlers/bridge.rs`, `types/src/execution.rs` tags/events, `client/src/bin/bridge_relayer.rs`, `website/src/BridgeApp.tsx`.
- **Liquidity/Staking**: `execution/src/layer/mod.rs` applies liquidity/staking, `execution/src/layer/handlers/liquidity.rs`, `execution/src/layer/handlers/staking.rs`, plus instruction tags in `types/src/execution.rs`.
- **Auth Billing/EVM/AI**: `services/auth/src/server.ts` (Stripe/EVM/AI routes), `services/auth/src/utils.ts` (AI prompt), `website/src/services/geminiService.ts` (AI client), `website/convex/stripe*.ts` (billing).
- **Protocol surface**: `packages/protocol/**`, `website/wasm/**`, `types/src/execution.rs`, `types/src/bin/export_ts.rs` (TS export), `gateway/src/codec/**`.
- **Protocol drift hot spots**: `execution/src/casino/protocol_round_trip_tests.rs` (v1 payloads) vs `execution/src/casino/payload.rs` (versioned payloads), `gateway/src/handlers/base.ts` (version stripping).

## Definition of Done

- Live mode, bridge, liquidity/AMM, staking, billing, EVM linking, and AI proxy are disabled cleanly.
- Gateway does not maintain a custom codec stack; Rust is the canonical protocol source.
- Website + mobile still run core session gameplay end-to-end.
- All required tests derived from acceptance criteria exist and pass.
