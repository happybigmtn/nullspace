# Sprint 07 - Payments, Treasury, and Admin Ops

## Goal
Enable deposit/withdraw flows, house bankroll controls, and administrative configuration with auditability.

## Demo
- Deposit funds, place bets, withdraw winnings, and review an admin audit log entry for a config change.

## Acceptance Criteria
- AC-7.1: Deposit and withdrawal flows update a ledger and reflect on-chain balances.
- AC-7.2: House bankroll and exposure metrics are tracked with configurable limits.
- AC-7.3: Admin ops service can update game limits/config with audit logging.
- AC-7.4: Responsible gaming limits (daily/weekly caps) are enforced at bet validation.
- AC-7.5: Client displays limit errors and current bankroll/exposure warnings.

## Tasks/Tickets
- T1: Implement deposit/withdraw ledger entries and reconciliation against chain state.
  - Validation: integration tests for ledger updates.
- T2: Add house bankroll/exposure tracking and limit checks.
  - Validation: unit tests for limit enforcement.
- T3: Build admin ops endpoints for config updates and audit log entries.
  - Validation: API tests for admin auth and audit log writes.
- T4: Implement responsible gaming caps in bet validation.
  - Validation: tests for limit rejections in execution layer.
- T5: Update web client to show limit errors and exposure warnings.
  - Validation: UI tests for error messaging.
