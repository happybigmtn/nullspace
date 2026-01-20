# Archived Specs

This directory contains specifications that have been completed, superseded, or are no longer actively being worked on.

## Archive Date: 2026-01-17

All specs were archived to focus on the critical testnet transaction pipeline fix documented in `ralph/specs/testnet-transaction-pipeline-fix.md`.

## Archived Items

| Spec | Description |
|------|-------------|
| testnet-transaction-pipeline-fix.md | ✅ Complete (2026-01-17) - End-to-end transaction flow debugging, WebSocket origin fix |
| gateway-chain-sync-robustness.md | Transaction pipeline and explorer persistence (BufferedMempool completed) |
| consensus-liveness-and-recovery-hardening.md | Liveness detection and recovery |
| threshold-signature-reconciliation.md | Signature verification alignment |
| transaction-pipeline-and-protocol-compatibility.md | Tx inclusion SLA |
| line-by-line-review-agents.md | Code review automation |
| chain_history_commonware.md | Block structure for Commonware consensus |
| auth-simplification.md | Auth flow simplification |
| codec-consolidation-rust-native.md | Rust-native codec consolidation |
| compact-encoding-*.md | Game-specific compact encoding specs |
| *-deferment.md | Feature deferment specs (EVM bridge, liquidity, live mode) |

## Archive Policy

Specs are moved here when:
1. All acceptance criteria have been met
2. Work has been superseded by a newer spec
3. The spec is no longer a priority

To revive a spec, move it back to `ralph/specs/` and update `INFRASTRUCTURE_PLAN.md`.
