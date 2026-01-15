# Review Issues Log

This file tracks cumulative issues or potential improvements discovered during the walkthrough.
Each entry captures the file, issue, impact, and any suggested action.

## Open Issues
(none)

## Resolved
- gateway/src/session/manager.ts, gateway/src/handlers/base.ts: add UpdatesClient error listeners to avoid unhandled error crashes when updates WS returns 429 under load.
- scripts/load-test-global-table.mjs: wait for session_ready before joining + add counters for error messages and bets sent.
- docker/observability/docker-compose.yml, docker/observability/prometheus.yml: Prometheus now boots locally without unsupported config flags.
- evm/scripts/*: duplicated env parsing and bidder key helpers now live in `evm/src/utils` and are shared across scripts.
- evm/scripts/*: standardized on CJS and added typed env validation via `parseEnv` to avoid silent config drift.
- packages/protocol/src/encode.ts: removed the placeholder `encodeGameStart` from the public API to prevent endian drift vs Rust.
- evm/src/abis/*.js: internal ABIs now sourced from Hardhat artifacts with ERC20 artifact fallback; external ABIs are explicitly minimal surface.
- execution/src/casino/super_mode.rs: RNG now uses integer-threshold sampling to avoid float determinism risk.
- gateway/src/codec/instructions.ts: legacy payload builders removed; gateway handlers and tests now use protocol encoders.
- packages/protocol/src/schema/mobile.ts: tightened bet schemas to enums from `@nullspace/constants` so invalid bet types are rejected during validation.
