# Sprint 01 - Foundations and Local Dev

## Goal
Provide a reproducible local stack, deterministic fixtures, and baseline tooling so engineers can run and test the platform end-to-end.

## Demo
- Run `./scripts/agent-loop.sh` with mock backend and observe successful health checks, gateway smoke, and website preview.

## Acceptance Criteria
- AC-1.1: A single command boots the local validator network, gateway, auth, ops, and website with deterministic seeds on a clean checkout.
- AC-1.2: Local config validation fails fast with clear, actionable errors for missing or invalid settings.
- AC-1.3: A faucet or helper command can fund a test wallet and the funded balance is visible in logs or CLI output.
- AC-1.4: README or docs include bootstrap, teardown, and troubleshooting steps that match the local stack behavior.
- AC-1.5: `scripts/health-check.sh` validates the running stack and returns non-zero on failure.
- AC-1.6: Structured logs include a correlation/request id across gateway -> table engine -> indexer for at least one request path.

## Tasks/Tickets
- T1: Add deterministic seed/time-scaling config parsing for simulator and node.
  - Validation: `cargo test -p nullspace-simulator` with fixture config parsing tests.
- T2: Add local bootstrap script guardrails (missing env/config checks, port reuse handling).
  - Validation: `./scripts/agent-loop.sh` (mock backend) succeeds from a clean repo.
- T3: Add faucet helper (CLI or script) to mint or transfer test funds.
  - Validation: CLI/script output shows updated balance; integration test in `tests/` verifies funds.
- T4: Add config schema validation and error messages for gateway and services.
  - Validation: unit tests for config loader; `pnpm -C gateway test`.
- T5: Update docs to reflect local dev steps and troubleshooting.
  - Validation: manual doc review; `rg` confirms commands exist in scripts.
- T6: Add correlation id propagation in gateway -> engine -> indexer logs.
  - Validation: integration test logs include shared request id.
