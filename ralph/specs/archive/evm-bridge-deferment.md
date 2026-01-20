# EVM Bridge Deferment

## Overview
Defer cross-chain EVM bridge functionality to stabilize core casino operations. The bridge should be disabled in runtime builds while preserving the ability to re-enable later if needed.

## Acceptance Criteria

### AC-1: Bridge Instructions Disabled
- **AC-1.1**: Bridge-related instructions are rejected with a clear error (e.g., `bridge_disabled`) and do not mutate state.
- **AC-1.2**: Bridge state keys and events are no longer emitted during normal operation.

### AC-2: Client/UX Deactivated
- **AC-2.1**: The web UI no longer exposes Bridge screens or EVM deposit/withdraw actions.
- **AC-2.2**: Bridge relayer tooling is removed from default builds and docs.

### AC-3: Configuration Simplification
- **AC-3.1**: No EVM bridge environment variables are required for services to start.
- **AC-3.2**: Startup logs clearly indicate bridge is deferred/disabled.

## Technical Details
- Gate or remove bridge handler(s) in the execution layer (`execution/src/layer/handlers/bridge.rs`).
- Remove bridge instruction and event tags from public protocol surfaces when the feature is disabled.
- Archive the bridge relayer binary (`client/src/bin/bridge_relayer.rs`) and bridge UI (`website/src/BridgeApp.tsx`).
- Remove bridge-specific environment variables and config expectations from services.

## Examples
- Submitting a BridgeWithdraw transaction yields a `bridge_disabled` error and no state update.
- Bridge-related UI routes are absent and navigation does not expose bridge actions.
