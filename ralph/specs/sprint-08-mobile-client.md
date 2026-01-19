# Sprint 08 - Mobile Client

## Goal
Deliver a mobile client with core gameplay flows and resilient connectivity.

## Demo
- Install the mobile app, connect a wallet, place a bet, and receive outcome updates on mobile.

## Acceptance Criteria
- AC-8.1: Mobile app supports wallet connection and network status display.
- AC-8.2: Mobile app can join a table and place bets for at least one game.
- AC-8.3: WebSocket reconnect strategy keeps the app updated after brief network loss.
- AC-8.4: App provides a read-only mode when connectivity is limited.
- AC-PQ.2: Mobile UI fits common screen sizes and primary actions are reachable with one hand.

## Tasks/Tickets
- T1: Implement wallet connection and session persistence on mobile.
  - Validation: mobile unit tests for wallet state.
- T2: Build table view and bet controls optimized for touch.
  - Validation: component tests for bet controls.
- T3: Add WebSocket reconnect strategy and offline detection.
  - Validation: integration test simulating network drop.
- T4: Add read-only mode with banner messaging.
  - Validation: UI tests for connectivity states.
