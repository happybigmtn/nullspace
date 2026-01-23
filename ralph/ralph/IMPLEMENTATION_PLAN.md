# Implementation Plan - Mempool-Aware Nonce Management

**Date**: 2026-01-23
**Scope**: Implement confirmation-based nonce management to fix transaction ordering issues

## Tasks (Priority Order)

- [ ] 1. Enhance NonceManager with pending transaction tracking
  - Specs: `specs/mempool-aware-nonce-management.md` AC-1.1, AC-1.2, AC-1.3
  - Tests/backpressure:
    - Programmatic: Unit tests for queue ordering and timeout handling
    - Programmatic: Verify subsequent txs block until confirmation
  - Perceptual: None

- [ ] 2. Implement ConfirmationWatcher using /updates WebSocket
  - Specs: `specs/mempool-aware-nonce-management.md` AC-2.1, AC-2.2, AC-2.3
  - Tests/backpressure:
    - Programmatic: Test confirmation detection from block events
    - Programmatic: Test fallback polling on WS disconnect
  - Perceptual: None

- [ ] 3. Add TransactionQueue for per-account serialization
  - Specs: `specs/mempool-aware-nonce-management.md` AC-3.1, AC-3.2, AC-3.3, AC-3.4
  - Tests/backpressure:
    - Programmatic: Queue depth enforcement
    - Programmatic: Concurrent read, serial write behavior
  - Perceptual: None

- [ ] 4. Update SessionManager.submitWithRetry to use new nonce manager
  - Specs: `specs/mempool-aware-nonce-management.md` AC-1.1, AC-4.1, AC-4.2
  - Tests/backpressure:
    - Programmatic: Integration tests with backend
    - Programmatic: Error handling triggers resync
  - Perceptual: None

- [ ] 5. Add configuration environment variables
  - Specs: `specs/mempool-aware-nonce-management.md` Configuration section
  - Tests/backpressure:
    - Programmatic: Config parsing tests
  - Perceptual: None

- [ ] 6. Run casino stress tests and verify fixes
  - Specs: `specs/mempool-aware-nonce-management.md` AC-5.1, AC-5.2, AC-5.3
  - Tests/backpressure:
    - Programmatic: All stress tests pass
    - Programmatic: No nonce_too_high errors in logs
  - Perceptual: None

## Missing/Unknown

- Block time variability: Need to tune confirmation timeout based on actual chain performance
- Updates WebSocket reliability: May need circuit breaker if it's flaky

## Checklist

- Every referenced AC exists in specs: yes
- No phantom AC-PQ introduced: yes
- No control characters in output: yes
