# Liquidity/AMM/Staking Deferment

## Overview
Defer liquidity (AMM) and staking subsystems to reduce execution surface area and consensus complexity. Core casino game execution must remain unaffected.

## Acceptance Criteria

### AC-1: AMM & Staking Instructions Disabled
- **AC-1.1**: Liquidity and staking instructions are rejected with a clear error code (e.g., `feature_disabled`).
- **AC-1.2**: No AMM or staking state keys are created or mutated during normal operation.

### AC-2: Client/UX Deactivated
- **AC-2.1**: Web UI surfaces for liquidity or staking are removed or hidden.
- **AC-2.2**: Any automated or scheduled AMM/staking jobs are disabled.

### AC-3: Configuration Simplification
- **AC-3.1**: No AMM or staking env vars are required for services to start.
- **AC-3.2**: Startup logs indicate AMM/staking are disabled.

## Technical Details
- Gate or remove liquidity and staking handlers in `execution/src/layer/handlers/`.
- Remove instruction and event tags from public protocol surfaces when disabled.
- Archive any client tooling or UI code that exposes AMM/staking flows.

## Examples
- Submitting an AMM swap transaction yields `feature_disabled` and no state change.
- No staking or liquidity widgets appear in the web UI.
