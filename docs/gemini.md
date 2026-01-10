# Development Priorities & Investigation Log

## Executive Summary
**Role**: CEO/CTO
**Date**: 2026-01-09
**Status**: Critical Issue Identified (Betting Failure) & Strategic Review Complete.

This document serves as the central source of truth for current development priorities, architectural findings, and the roadmap for stabilizing and improving the Nullspace platform.

## 1. Immediate Critical Issues (Hotfix)
### 1.1. Fix Betting Functionality on Testnet
- **Symptom**: Users cannot successfully place bets on the deployed testnet.
- **Root Cause Analysis (High Probability)**:
    1.  **CORS/Origin Mismatch**: The Simulator (running via `start-network.sh`) likely restricts `ALLOWED_HTTP_ORIGINS`. The Gateway submits transactions from `http://localhost:9010` (or its container IP), which is likely not in the allowlist. This results in the Simulator rejecting `POST /submit` requests.
    2.  **Protocol Fragility**: The Gateway uses a workaround (`stripVersionHeader`) to remove protocol version bytes before sending to the backend. This mismatch between the `@nullspace/protocol` encoding and the Rust backend is a major fragility point.
- **Action Plan**:
    - [ ] **Ops**: Verify `ALLOWED_HTTP_ORIGINS` env var on the Testnet Simulator service. Ensure it includes the Gateway's origin.
    - [ ] **Ops**: Verify `BACKEND_URL` on the Gateway service points to the correct Simulator API port.
    - [ ] **Dev**: Implement US-149 (Protocol Versioning support in Rust Backend) to remove the `stripVersionHeader` hack.

## 2. Strategic Priorities

### 2.1. Reliability & Security (Core Mandate)
- **Rust Panic Elimination**: The codebase (`node/src/indexer.rs`, `types/src`) contains `unwrap()` and `panic!()` calls in data processing paths. This creates a Denial of Service (DoS) vector if malformed data hits these paths.
    - *Goal*: Zero panics in execution and networking paths.
- **Bridge Hardening**: The "Bridge Relayer" is a centralized trust point with minting privileges.
    - *Goal*: Implement multi-sig controls and strict rate-limiting at the contract level, independent of the relayer software.

### 2.2. Scalability & Performance
- **Gateway Architecture**: The current `GameHandler` uses a 1:1 `waitForEvent` pattern, effectively polling or holding connections open for every user action. This will not scale to 10k+ concurrent users.
    - *Goal*: Refactor to a reactive **Pub/Sub model** where the Gateway subscribes to a global stream and routes updates to user sessions asynchronously.
- **Deterministic Throughput**: The consensus limit is currently 500 tx/block. We need to verify if this meets our target "slot machine" frequency (e.g., 100ms response times for thousands of users).

### 2.3. Developer Experience (DevEx)
- **Single Source of Truth**: Protocol constants (`GameType`, `InstructionTag`) are duplicated across Rust and TypeScript.
    - *Goal*: Implement **Code Generation** (e.g., `types-share` or custom build script) to generate TypeScript definitions directly from Rust structs during the build process.
- **End-to-End Testing**: Current testing relies heavily on unit tests or manual verification.
    - *Goal*: Create a CI-driven "Test Universe" that spins up a ephemeral Simulator + Gateway + Client to run a full betting scenario on every PR.

## 3. Rollout Plan

### Phase 1: Stabilization (Weeks 1-2)
*Focus: Fix the bleeding, ensure the testnet works.*
1.  **Ops**: Fix CORS/Origin configuration on Testnet.
2.  **Dev**: Remove `stripVersionHeader` hack by implementing version awareness in Rust (`US-149`).
3.  **Dev**: Audit and patch the top 10 most dangerous `unwrap()` calls in `node/` and `execution/`.
4.  **Dev**: Centralize protocol constants (manual sync for now, prepare for codegen).

### Phase 2: Foundation (Months 1-2)
*Focus: Pay down tech debt, prepare for scale.*
1.  **Arch**: Refactor Gateway Event Loop (Move from Request/Response to Pub/Sub).
2.  **DevEx**: Implement automated TypeScript type generation from Rust.
3.  **Quality**: Deploy the "Test Universe" E2E pipeline.
4.  **Security**: Internal audit of the Bridge smart contracts and Relayer logic.

### Phase 3: Acceleration (Months 3-6)
*Focus: Feature velocity and user retention.*
1.  **Product**: Implement "Liquid Crystal" UX fidelity improvements (animations, haptics) based on user feedback.
2.  **Scale**: Load test the new Gateway architecture to 50k concurrent sessions.
3.  **Biz**: Launch first "Tournament" season with verified fair RNG.

## 4. Investigation Log

### 2026-01-09: Initial Assessment
- **Architecture**: Mapped the Betting Flow (Client -> Gateway -> Simulator -> Execution).
- **Findings**:
    - **Protocol**: Fragile versioning hack identified.
    - **Code Quality**: High usage of panics in Rust networking code.
    - **Performance**: Gateway event waiting is a bottleneck.
    - **Ops**: likely configuration drift between Gateway origin and Simulator allowlist.