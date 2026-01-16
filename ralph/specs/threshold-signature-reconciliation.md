# Threshold Signature Reconciliation and Summary Verification

**Status**: draft  
**Date**: 2026-01-16  
**Scope**: Align validator/simulator threshold signature verification and remove staging bypass.

This spec removes the staging BLS signature bypass by reconciling identity formats, aggregation schemes, and verification inputs across validators and simulator. The goal is for summary verification to pass deterministically in all environments.

## 1. Goals

1. **Eliminate bypass**: Remove the staging-only signature verification bypass in `simulator/src/submission.rs`.
2. **Canonical identity format**: Define a single canonical encoding for validator identities and polynomial shares.
3. **Deterministic verification**: Summary verification passes consistently across all nodes.
4. **Fail fast on mismatch**: Simulator refuses to start if identity or scheme mismatch is detected.

## 2. Non-Goals

- Changing the consensus threshold scheme or cryptographic primitives.
- Implementing multi-network identity rotation (future work).

## 3. Architecture

### 3.1 Canonical Identity Encoding

Define and enforce a canonical encoding for:
- Threshold public keys
- Polynomial identities (including any prefix normalization)
- Namespace bindings used for signatures

### 3.2 Compatibility Handshake

At startup, simulator performs a handshake with validators:
- Fetch validator identity set
- Verify encoding and scheme parameters
- Abort startup on mismatch (clear error + remediation)

### 3.3 Verification Path

Ensure summary verification uses the same:
- Scheme variant
- Namespace
- Hashing and transcript configuration

Remove bypass logic once verification passes in staging.

## 4. Testing Requirements

### 4.1 Integration Tests
- Simulator verifies summaries produced by validators with no bypass.
- Signature verification fails with explicit error on malformed identity.

### 4.2 Regression Tests
- Golden vector test for threshold signature verification.
- Cross-version compatibility test for identity encoding.

## 5. Acceptance Criteria

### AC-1: Summary Verification
- **AC-1.1**: Summaries verify without bypass in staging and QA.
- **AC-1.2**: Invalid summaries are rejected with clear error logs.

### AC-2: Identity Canonicalization
- **AC-2.1**: All validator identities serialize to the canonical format.
- **AC-2.2**: Simulator rejects startup when identity encoding mismatches.

### AC-3: Bypass Removal
- **AC-3.1**: `simulator/src/submission.rs` no longer bypasses signature verification.
- **AC-3.2**: State sync remains correct with full verification enabled.

## 6. Implementation Map

- Simulator verification: `simulator/src/submission.rs`
- Identity encoding: `nullspace_types` (identity types) and validator config loading
- Startup handshake: `simulator/src/lib.rs` and validator APIs
