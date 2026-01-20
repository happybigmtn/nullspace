# Gateway Live Mode Deferment

## Overview
Temporarily disable the global-table “live mode” pathways in the gateway to reduce runtime complexity and failure modes while keeping standard session-based games fully operational.

## Acceptance Criteria

### AC-1: Live Mode Disabled
- **AC-1.1**: Gateway no longer initializes or configures the live-table subsystem at startup.
- **AC-1.2**: Live-table endpoints (WebSocket/HTTP, if any) return a clear “disabled” response or 404.
- **AC-1.3**: No background UpdatesClient is created for global-table feeds.

### AC-2: Standard Sessions Unchanged
- **AC-2.1**: Register → deposit → start game → move → complete flows behave exactly as before for session-based games.
- **AC-2.2**: Update streams for account/session filters still function for standard games.

### AC-3: Configuration Simplification
- **AC-3.1**: No live-mode env vars are required for gateway startup.
- **AC-3.2**: Logs explicitly state that live mode is disabled.

## Technical Details
- Remove the live-table module wiring from `gateway/src/index.ts`.
- Archive `gateway/src/live-table/**` and any live-mode-only handlers or helpers.
- Remove global-table event decoding from the gateway once live mode is disabled.
- If a feature flag is retained, default it to off (`GATEWAY_ENABLE_LIVE_MODE=0`).

## Examples
- Connecting to a live-table WS route returns `{"error":"live_mode_disabled"}` or HTTP 404.
- A normal session client continues to receive `CasinoGameStarted`/`Moved`/`Completed` updates.
