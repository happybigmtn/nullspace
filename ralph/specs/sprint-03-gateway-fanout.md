# Sprint 03 - Gateway, WebSocket Fanout, and Auth

## Goal
Provide a robust gateway that authenticates clients, validates messages, and fans out real-time table updates at scale.

## Demo
- Run gateway + engine locally and connect multiple simulated clients to observe synchronized updates and bet acknowledgements.

## Acceptance Criteria
- AC-3.1: WebSocket handshake enforces auth tokens and origin validation; invalid clients are rejected with clear errors.
- AC-3.2: All inbound messages are schema-validated; invalid payloads are rejected without crashing the gateway.
- AC-3.3: Gateway fans out round updates to at least 1,000 simulated clients with backpressure handling.
- AC-3.4: Rate limits apply per client or wallet, with explicit errors when exceeded.
- AC-3.5: Gateway forwards bet intents to the table engine with retries and idempotency keys.
- AC-3.6: Presence and clock sync messages are delivered on connect and during session.

## Tasks/Tickets
- T1: Implement auth handshake and origin validation for WebSocket connections.
  - Validation: `pnpm -C gateway test` includes auth/origin cases.
- T2: Add schema validation for all client messages (bet, subscribe, presence, ping).
  - Validation: unit tests for invalid payload rejection.
- T3: Implement fanout with backpressure (bounded queues, drop policy).
  - Validation: load test with simulated clients asserts no gateway crash.
- T4: Add per-wallet/IP rate limiting with clear error responses.
  - Validation: integration test for rate limit exceed behavior.
- T5: Implement engine forwarding with retries and idempotency keys.
  - Validation: integration test for duplicate bet intent handling.
- T6: Add presence and clock sync broadcasting.
  - Validation: end-to-end test asserts sync message on connect.
