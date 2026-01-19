# Sprint 05 - Web Client MVP

## Goal
Ship a responsive web client that connects to the gateway, places bets, and renders real-time outcomes for one game.

## Demo
- Open the website, connect a wallet, join the table, place a bet, and see a resolved outcome without page reloads.

## Acceptance Criteria
- AC-5.1: Wallet connect and network status are visible and update in real time.
- AC-5.2: Table view shows countdown timers synchronized to server round phases.
- AC-5.3: Bet placement flow includes validation, confirmation, and clear error states.
- AC-5.4: Real-time updates display round outcomes and totals without manual refresh.
- AC-5.5: Fairness verification UI displays RNG commit/reveal values for the round.
- AC-5.6: Core bet controls are keyboard accessible and have visible focus states.
- AC-PQ.1: Round transitions are visually clear and the countdown matches the server phase within 250ms.

## Tasks/Tickets
- T1: Implement wallet connect and network status indicators.
  - Validation: `pnpm -C website test` includes wallet component tests.
- T2: Build table view with countdown and phase labels from gateway updates.
  - Validation: UI tests assert countdown and phase display.
- T3: Implement bet slip, validation, and confirmation flow.
  - Validation: integration tests for bet submission success/failure.
- T4: Render real-time outcomes and totals from WebSocket updates.
  - Validation: mocked WS tests verify UI updates.
- T5: Add fairness verification panel (commit/reveal values).
  - Validation: unit tests for formatting and copy logic.
- T6: Ensure keyboard navigation for bet controls and visible focus styles.
  - Validation: accessibility checks in UI test suite.
