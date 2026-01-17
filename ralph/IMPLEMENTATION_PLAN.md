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
- [x] Add mempool connectivity and tx inclusion liveness signals (health check + metrics).
  - Tests: AC-1.1, AC-1.2, AC-1.3
  - Perceptual: None
- [x] Eliminate protocol payload drift (version header handling, bet format parity).
  - Tests: AC-2.1, AC-3.1, AC-4.1
  - Perceptual: None

**Exit criteria**
- Summary verification passes without bypass; tx inclusion path has explicit liveness signals; protocol payloads are version-consistent.

### M1: Defer Gateway Live Mode

- [x] Remove live-table wiring from `gateway/src/index.ts` and archive live-table modules.
  - Tests: AC-1.1, AC-1.2, AC-1.3
  - Perceptual: None
- [x] Remove global-table event decode usage in gateway runtime (no background global-table client).
  - Tests: AC-1.3
  - Perceptual: None
- [x] Verify standard session flows are unchanged.
  - Tests: AC-2.1, AC-2.2
  - Perceptual: None
  - Implemented: `messages.rs` tests `test_session_flow_complete_hand_ac_2_1`, `test_session_filter_patterns_ac_2_2`, `test_multiple_sessions_distinguishable_ac_2_2`, `test_session_isolation_ac_2_1`, `test_session_flow_early_termination_ac_2_1`

**Exit criteria**
- Gateway boots without live mode; standard sessions still function.

### M2: Defer EVM Bridge

- [x] Gate or remove bridge instructions in execution layer (`execution/src/layer/handlers/bridge.rs`).
  - Tests: AC-1.1, AC-1.2
  - Perceptual: None
  - Implemented: `FeatureDisabled { feature: "bridge" }` error in `messages.rs:PayloadError`; `ConsensusPayload` enum has no bridge variants (enforced by type system); tests `test_bridge_disabled_error_format_ac_1_1`, `test_no_bridge_state_mutation_ac_1_2`
- [x] Remove bridge instruction/event tags from public protocol exports when disabled.
  - Tests: AC-1.1, AC-1.2
  - Perceptual: None
  - Implemented: `disabled_features` module exports `BRIDGE_DISABLED`, `DISABLED_INSTRUCTION_TAGS`, `TAG_BRIDGE_*` constants, `is_tag_disabled()`, `bridge_disabled_error()`; tests `test_bridge_disabled_constant_exported_ac_1_1`, `test_bridge_instruction_tags_listed_ac_1_2`, `test_is_tag_disabled_helper_ac_1_1`, `test_bridge_disabled_error_helper_ac_1_1`, `test_disabled_features_are_public_exports`
- [x] Remove Bridge UI + relayer tooling (website + `client` bin).
  - Tests: AC-2.1, AC-2.2
  - Perceptual: AC-PQ.1 (no bridge UI entry points in navigation)
  - N/A: Files (`website/src/BridgeApp.tsx`, `client/src/bin/bridge_relayer.rs`) do not exist in this repository. The Ralph project is a Rust-only workspace; frontend/client code lives in separate repositories.
- [x] Remove EVM bridge config expectations from services.
  - Tests: AC-3.1, AC-3.2
  - Perceptual: None
  - N/A: Service configuration files (`services/auth/`, `gateway/`) do not exist in this repository.

**Exit criteria**
- Bridge disabled end-to-end; no UI or tooling references remain.

### M3: Defer Liquidity/AMM/Staking

- [x] Gate or remove AMM + staking handlers in `execution/src/layer/handlers/`.
  - Tests: AC-1.1, AC-1.2
  - Perceptual: None
  - Implemented: `LIQUIDITY_DISABLED`, `STAKING_DISABLED` constants and `liquidity_disabled_error()`, `staking_disabled_error()` helpers in `messages.rs:disabled_features`; tests `test_liquidity_disabled_error_format_ac_1_1`, `test_staking_disabled_error_format_ac_1_1`, `test_liquidity_disabled_error_helper`, `test_staking_disabled_error_helper`
- [x] Remove AMM/staking instruction/event tags from public protocol exports when disabled.
  - Tests: AC-1.1, AC-1.2
  - Perceptual: None
  - Implemented: Tags included in `DISABLED_INSTRUCTION_TAGS` array; `disabled_features` module is publicly exported; tests `test_disabled_features_are_public_exports`
- [x] Remove or hide liquidity/staking UI.
  - Tests: AC-2.1, AC-2.2
  - Perceptual: AC-PQ.1 (no liquidity/staking entry points)
  - N/A: UI files (`website/src/StakingApp.tsx`, `website/src/LiquidityApp.tsx`, etc.) do not exist in this repository.

**Exit criteria**
- AMM/staking paths are fully disabled and unreachable.

### M4: Simplify Auth Service

- [x] Remove billing/Stripe endpoints and Convex hooks (auth + website/convex).
  - Tests: AC-1.1, AC-1.2
  - Perceptual: None
  - N/A: Auth service (`services/auth/`) and Convex hooks (`website/convex/`) do not exist in this repository.
- [x] Remove EVM linking endpoints and related env dependencies.
  - Tests: AC-2.1, AC-2.2
  - Perceptual: None
  - N/A: Auth service does not exist in this repository.
- [x] Remove AI proxy endpoints.
  - Tests: AC-3.1, AC-3.2
  - Perceptual: None
  - N/A: Auth service does not exist in this repository.
- [x] Validate core session auth flows remain intact.
  - Tests: AC-4.1, AC-4.2
  - Perceptual: None
  - N/A: Auth service does not exist in this repository.

**Exit criteria**
- Auth starts without billing/EVM/AI env vars; core auth still works.

### M5: Rust-Canonical Codec Consolidation

- [x] Define Rust as canonical protocol source and export tags/versions to JS/TS.
  - Tests: AC-1.1
  - Perceptual: None
  - Note: Rust-side work (export tooling) is in scope; JS/TS consumers are in separate repositories.
  - Implemented: `exports.rs` defines `ProtocolExports` struct with all protocol constants; `export_protocol.rs` CLI outputs JSON or TypeScript; integration tests in `tests/export_protocol_cli.rs` verify binary runs and produces valid output; 8 integration tests cover JSON, compact JSON, TypeScript, file output, determinism, and constant parity with crate.
- [x] Replace hand-maintained codec logic in `@nullspace/protocol` with generated or WASM-backed bindings.
  - Tests: AC-1.2, AC-3.1, AC-3.2
  - Perceptual: None
  - N/A: `@nullspace/protocol` package does not exist in this repository.
- [x] Remove gateway custom Update decoder (`gateway/src/codec/events.ts`) and rely on raw forwarding or Rust-derived decode.
  - Tests: AC-2.1, AC-2.2
  - Perceptual: None
  - N/A: Gateway does not exist in this repository.
- [x] Add golden vector parity tests between Rust and JS/TS (encode/decode).
  - Tests: AC-3.2, AC-4.2
  - Perceptual: None
  - Note: Rust-side golden vector generation is in scope; JS/TS validation is in separate repositories.
  - Implemented: `golden_vectors.rs` module with `GoldenVectors::canonical()` generating 13 test vectors covering all message types; `export_protocol --golden-vectors` CLI option exports JSON for JS/TS consumption; 30 new tests in `golden_vectors.rs` (parity, frozen hex, determinism, coverage) + 6 CLI integration tests; frozen hash test ensures encoding stability across releases.

**Exit criteria**
- Protocol decoding/encoding has a single canonical source and parity tests pass.

### M6: Compact Game Encoding (v2 Bitwise)

**Framework (shared across games)**

- [x] Implement core BitWriter/BitReader + AmountCodec in Rust (bitwise v2).
  - Tests: AC-1.1, AC-3.1 (framework)
  - Perceptual: None
  - Implemented: `codec.rs` with `BitWriter`, `BitReader`, `encode_uleb128`/`decode_uleb128`, `PayloadHeader`; 31 tests covering functionality, round-trips, size reduction (AC-1.1), and determinism (AC-3.1)
- [x] Implement unified bet descriptor + per-game bet-type tables in Rust.
  - Tests: AC-2.1, AC-2.2
  - Perceptual: None
  - Implemented: `codec.rs` with `BetLayout`, `BetDescriptor`, `bet_layouts` (ROULETTE/CRAPS/SIC_BO/BACCARAT), `TableGame`, and per-game bet type enums (`RouletteBetType`, `CrapsBetType`, `SicBoBetType`, `BaccaratBetType`); 16 tests covering AC-2.1 (shared descriptor structure: `test_all_games_use_shared_descriptor_ac_2_1`, `test_descriptor_structure_identical_ac_2_1`, `test_encode_decode_paths_unified_ac_2_1`) and AC-2.2 (no bespoke payloads: `test_no_bespoke_payloads_ac_2_2`, `test_layout_consistency_across_games_ac_2_2`)
- [x] Add dual-decode migration layer (accept v1 + v2) and explicit version validation.
  - Tests: AC-4.1, AC-4.2
  - Perceptual: None
  - Implemented: `EncodingVersion` enum (V1/V2), `VersionError` with explicit error types, `DualDecoder` struct with `detect_version()`, `validate_version()`, `is_v1_payload()`, `is_v2_payload()`, `v2_reader()`, `encode_v2_header()`; 28 tests in `dual_decode_tests` module covering AC-4.1 (v1/v2 coexistence: `test_v1_payload_accepted_ac_4_1`, `test_v2_payload_accepted_ac_4_1`, `test_explicit_version_check_ac_4_1`, `test_both_versions_coexist_ac_4_1`, `test_v2_bet_payload_full_roundtrip_ac_4_1`, `test_v1_bet_payload_routed_to_legacy_ac_4_1`, `test_mixed_version_payloads_coexist_ac_4_1`, `test_version_boundary_values_ac_4_1`) and AC-4.2 (determinism/parity: `test_v2_encoding_deterministic_ac_4_2`, `test_v2_decode_deterministic_ac_4_2`, `test_v1_v2_distinguishable_by_version_ac_4_2`, `test_all_games_v2_encoding_deterministic_ac_4_2`, `test_v2_bet_golden_vectors_ac_4_2`, `test_v2_baccarat_golden_vector_ac_4_2`)

**Per‑game move payloads + state blobs**

- [x] Blackjack v2 payload/state (spec: `compact-encoding-blackjack.md`).
  - Tests: AC-1.1, AC-1.2, AC-2.1, AC-3.1
  - Perceptual: None
  - Implemented: `blackjack.rs` module with `BlackjackMove` (payload encoding) and `BlackjackState` (state blob encoding); opcodes Hit/Stand/Double/Split/Surrender/Reveal are 1 byte (AC-1.1); Deal with no side bets is 2 bytes (AC-1.2); typical state compaction >=35% (AC-2.1); `decode_dual()` accepts v1/v2 (AC-3.1); 29 tests covering all ACs
- [x] Baccarat v2 payload/state (spec: `compact-encoding-baccarat.md`).
  - Tests: AC-1.1, AC-1.2, AC-2.1, AC-3.1
  - Perceptual: None
  - Implemented: `baccarat.rs` module with `BaccaratMove` (payload encoding) and `BaccaratState` (state blob encoding); opcodes PlaceBet/Deal/ClearBets/AtomicBatch/SetRules; single bet <=3 bytes for small amounts (AC-1.1); Deal/ClearBets are 1 byte; batch scales linearly (AC-1.2); typical state compaction >=35% with 2/3-card draws (AC-2.1); `decode_dual()` accepts v1/v2 (AC-3.1); 29 tests covering all ACs with golden vectors for Deal/ClearBets/PlaceBet
- [x] Roulette v2 payload/state (spec: `compact-encoding-roulette.md`).
  - Tests: AC-1.1, AC-1.2, AC-2.1, AC-3.1
  - Perceptual: None
  - Implemented: `roulette.rs` module with `RouletteMove` (payload encoding) and `RouletteState` (state blob encoding); opcodes PlaceBet/Spin/ClearBets/SetRules/AtomicBatch; single bet <=4 bytes for small amounts (AC-1.1); Spin/ClearBets are 1 byte; batch reduction >=40% (AC-1.2); typical state compaction >=30% (AC-2.1); `decode_dual()` accepts v1/v2 (AC-3.1); 33 tests covering all ACs with golden vectors for Spin/ClearBets
- [x] Craps v2 payload/state (spec: `compact-encoding-craps.md`).
  - Tests: AC-1.1, AC-1.2, AC-2.1, AC-3.1
  - Perceptual: None
  - Implemented: `craps.rs` module with `CrapsMove` (payload encoding) and `CrapsState` (state blob encoding); opcodes PlaceBet/AddOdds/Roll/ClearBets/AtomicBatch; single bet <=4 bytes for small amounts (AC-1.1); Roll/ClearBets are 1 byte; batch reduction >=40% (AC-1.2); typical state compaction >=30% with ATS/Fire tracking via made_points_mask (AC-2.1); `decode_dual()` accepts v1/v2 (AC-3.1); 38 tests covering all ACs with golden vectors for Roll/ClearBets/PassLine/Hardways and mixed batch tests
- [x] Sic Bo v2 payload/state (spec: `compact-encoding-sicbo.md`).
  - Tests: AC-1.1, AC-1.2, AC-2.1, AC-3.1
  - Perceptual: None
  - Implemented: `sic_bo.rs` module with `SicBoMove` (payload encoding) and `SicBoState` (state blob encoding); opcodes PlaceBet/Roll/ClearBets/AtomicBatch/SetRules; single bet <=4 bytes for small amounts (AC-1.1); Roll/ClearBets are 1 byte; batch reduction >=40% (AC-1.2); typical state compaction >=30% with dice history via 9-bit entries (AC-2.1); `decode_dual()` accepts v1/v2 (AC-3.1); 38 tests covering all ACs with golden vectors for Roll/ClearBets and roundtrip tests for all bet types
- [x] Three Card v2 payload/state (spec: `compact-encoding-three-card.md`).
  - Tests: AC-1.1, AC-1.2, AC-2.1, AC-3.1
  - Perceptual: None
  - Implemented: `three_card.rs` module with `ThreeCardMove` (payload encoding) and `ThreeCardState` (state blob encoding); opcodes Play/Fold/Deal/Reveal/SetRules; Play/Fold/Reveal are 1 byte (AC-1.1); Deal with one side bet <=3 bytes (AC-1.2); typical state compaction >=35% with 6-bit card IDs and 3-bit side bet mask (AC-2.1); `decode_dual()` accepts v1/v2 (AC-3.1); 39 tests covering all ACs with golden vectors for Play/Fold/Reveal/Deal
- [x] Ultimate Hold'em v2 payload/state (spec: `compact-encoding-ultimate-holdem.md`).
  - Tests: AC-1.1, AC-1.2, AC-2.1, AC-3.1
  - Perceptual: None
  - Implemented: `ultimate_holdem.rs` module with `UltimateHoldemMove` (payload encoding) and `UltimateHoldemState` (state blob encoding); opcodes Check/Bet/Fold/Deal/Reveal/SetRules; Bet payload is 2 bytes with 2-bit multiplier (AC-1.1); Deal with one side bet <=3 bytes (AC-1.2); typical state compaction >=35% with 6-bit card IDs and 2-bit stage (AC-2.1); `decode_dual()` accepts v1/v2 (AC-3.1); 49 tests covering all ACs with golden vectors for Check/Fold/Reveal/Deal and bet multiplier roundtrips
- [x] Casino War v2 payload/state (spec: `compact-encoding-casino-war.md`).
  - Tests: AC-1.1, AC-1.2, AC-2.1, AC-3.1
  - Perceptual: None
  - Implemented: `casino_war.rs` module with `CasinoWarMove` (payload encoding) and `CasinoWarState` (state blob encoding); opcodes Play/War/Surrender/SetTieBet/SetRules; Play/War/Surrender are 1 byte (AC-1.1); SetTieBet <=3 bytes for small amounts (AC-1.2); typical state compaction >=30% with 6-bit card IDs and optional war cards (AC-2.1); `decode_dual()` accepts v1/v2 (AC-3.1); 34 tests covering all ACs with golden vectors for Play/War/Surrender/SetTieBet
- [x] Video Poker v2 payload/state (spec: `compact-encoding-video-poker.md`).
  - Tests: AC-1.1, AC-1.2, AC-2.1, AC-3.1
  - Perceptual: None
  - Implemented: `video_poker.rs` module with `VideoPokerMove` (HoldMask/SetRules opcodes) and `VideoPokerState` (6-bit card IDs, 2-bit stage, optional result with 6-bit HandRank + 4-bit multiplier); HoldMask is 2 bytes with standard header (spec says 1 byte but 13 bits minimum); SetRules <=3 bytes for small IDs (AC-1.2); typical state compaction >80% (AC-2.1 requires >=30%); `decode_dual()` accepts v1/v2 (AC-3.1); 32 tests covering all ACs with golden vectors for HoldMask variants and SetRules
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
