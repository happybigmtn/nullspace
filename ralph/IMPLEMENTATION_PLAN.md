# Implementation Plan: Protocol Hardening v1

**Phase**: 3 (building)
**Date**: 2026-01-16
**Scope**: deal commitment binding, selective reveal, timelock enforcement, artifact availability, Commonware-aligned chain history.

## Sources of Truth

- `specs/protocol_hardening_and_reveal_v1.md`
- `specs/chain_history_commonware.md`
- `overview.md` (protocol overview)

## Guiding Principles

1. Deterministic replay: same ordered log => same hand digest and settlement.
2. Verifiable dealing: deal commitment + artifacts are sufficient for third-party verification.
3. Selective disclosure: only reveal cards required by poker rules.
4. Bounded verification: all payloads are size-bounded and scope-bound.
5. Data availability: deal artifacts are retrievable by hash for the dispute window.

## Milestones

### M0: Interfaces and Canonical Encodings

- [x] Define canonical message formats (`DealCommitment`, `DealCommitmentAck`, `RevealShare`, `TimelockReveal`, artifact requests).
- [x] Add `protocol_version` and domain separation fields to payloads.
- [x] Document canonical hashing (`blake3(encode(x))`) and scope binding.

**Exit criteria**
- Messages compile and encode deterministically.
- Hashes are stable across encode/decode round trips.

### M1: Deal Commitment Integration

- [x] Add `DealCommitment` to consensus payload schema (`crates/codexpoker-onchain/src/messages.rs`).
- [x] Enforce: exactly one commitment before first action.
- [x] Bind `deal_commitment_hash` into `GameActionMessage` signature preimage.
- [x] Add commitment ack gating (sigset or per-player acks).
- [x] Update ordering harness to reject actions without commitment binding.

**Exit criteria**
- Consensus rejects action logs missing a commitment.
- Replay fails if commitment hash changes.

### M2: Shuffle Context Binding

- [x] Extend shuffle context to include `table_id`, `hand_id`, seat order, deck length.
- [x] Update L2 deal plan builder (`crates/codexpoker/src/l2.rs`) to use new context.
- [x] Update verification to reject mismatched context.

**Exit criteria**
- Shuffle verification fails if context is altered.

### M3: Selective Reveal + Timelock Enforcement

- [x] Implement per-street reveal gating in onchain state machine.
- [x] Enforce reveal-only phases (flop/turn/river/showdown).
- [x] Add reveal timeout (`REVEAL_TTL`) and fallback to timelock.
- [x] Enforce timelock scope and proof validation in consensus path.
- [x] Replace full-deck reveal with selective reveal in all flows.

**Exit criteria**
- Reveal payloads rejected if out-of-phase or invalid.
- Timelock fallback produces deterministic continuation.

### M4: Artifact Registry and Availability

- [x] Implement artifact registry (`artifact_hash -> bytes + metadata`).
- [x] Add `deal_commitment_hash -> [artifact_hash]` index.
- [x] Enforce size bounds on persistence and serving.
- [x] Add backfill path for missing artifacts.
- [x] Add audit logs for artifact fetches and misses.

**Exit criteria**
- Validators can fetch artifacts by hash after restart.
- Missing artifacts trigger backfill without corrupting state.

### M5: Chain History + State Persistence (Commonware)

- [x] Implement block header/body structs with receipts root.
- [x] Wire `commonware-consensus::simplex` and `marshal` for ordered finalization.
- [x] Persist blocks, finalizations, and receipts roots.
- [x] Wire QMDB state updates and root checks.
- [ ] Add state sync and proof verification.

**Exit criteria**
- Restart resumes with identical state root.
- Recomputed roots match committed roots.

### M6: Verification and Adversarial Tests

- [ ] Property tests: replay determinism and commitment binding.
- [ ] Adversarial tests: missing reveal, invalid proofs, altered commitment.
- [ ] Fuzz tests for payload decoding and size bounds.
- [ ] Performance tests for reveal verification and artifact retrieval.

**Exit criteria**
- All tests pass in CI and locally.
- No unbounded allocations from malformed payloads.

### M7: Observability and Ops

- [ ] Structured audit logs for commitments, reveals, timelock usage.
- [ ] Metrics for backfill latency, artifact misses, and state root mismatches.
- [ ] Operational docs for retention and snapshot schedules.

**Exit criteria**
- Logs/metrics cover the full deal and reveal lifecycle.

## Dependencies

- M1 depends on M0.
- M3 depends on M1 and M2.
- M4 can run in parallel with M1/M2, but must complete before M6.
- M5 is independent but should align with M4 for artifact storage.

## Definition of Done

- Deal commitments are mandatory and bound to every action signature.
- Shuffle context is bound to table/hand/seat order and verified end-to-end.
- Selective reveal with timelock fallback is enforced in consensus.
- Artifacts are retrievable by hash across restarts and within the dispute window.
- Deterministic replay succeeds across all verified payloads.
