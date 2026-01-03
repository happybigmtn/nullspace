# Feynman Curriculum (1 Week) - Nullspace End-to-End

Goal: Use the "Common Path -> feature flows" to build a rigorous, file-by-file understanding of the system. Each bullet from the original feynman.md is now a standalone lesson. Live-table craps is the deep dive use case, then we compare it to the normal craps mode.

How to use this curriculum:
- One lesson per bullet (exhaustive but not line-by-line). Each lesson has key excerpts, concepts, and mental models.
- Do lessons in order. Later lessons assume earlier ones.
- Supplemental concept lessons are inserted where they best support the flow.

Deep dive use case: Live-table craps (off-chain service) vs normal craps (on-chain session). We will compare behavior, failure modes, and latency tradeoffs.

Note on execution: This curriculum assumes validator-first execution. There is no standalone dev-executor binary; execution happens inside validator nodes alongside consensus.

---

## Week-at-a-glance

Day 1 (Gateway entry and session lifecycle)
- L01-L06
- Concept Lab A: Networking primer (HTTP/WS, CORS, origins)

Day 2 (Submission path and mempool)
- L07-L12
- Concept Lab B: Distributed systems primer (mempool, blocks, execution)

Day 3 (Registration + Faucet flow)
- L13-L18
- Concept Lab C: Cryptography primer (ed25519, signatures, nonces)

Day 4 (Registration + Faucet continued + Tournament kickoff)
- L19-L25
- Concept Lab D: WASM pipeline (web client tx builders)

Day 5 (Tournament lifecycle + Auth)
- L26-L33
- Concept Lab E: Authn/Z and challenge flows

Day 6 (Stripe/Convex entitlements)
- L34-L40
- Concept Lab F: Payments + idempotency + webhooks

Day 7 (Live-table craps deep dive + comparison)
- L41-L46
- Concept Lab G: Observability + production readiness

Optional extensions (woven into the flow where they fit best)
- Foundations + architecture (E01-E02)
- Node/consensus/storage (E03-E05)
- Protocol + clients + execution internals (E06-E10)
- Ops/deployment/testing (E11-E16)

---

## Table of contents

### Foundations (recommended before Day 1)
- E01 Architecture overview: `feynman/lessons/E01-architecture-overview.md`
- E02 Component roles + deployment topology: `feynman/lessons/E02-component-roles-topology.md`

### Common Path (Mobile -> Chain -> Event)
- L01 Gateway WS entrypoint and message routing: `feynman/lessons/L01-gateway-index.md`
- L02 Session manager and account lifecycle: `feynman/lessons/L02-session-manager.md`
- L03 Instruction encoding (binary formats): `feynman/lessons/L03-instructions-encoding.md`
- L04 Transaction building + signing: `feynman/lessons/L04-transactions-signing.md`
- E08 Protocol packages + schemas (cross-cutting): `feynman/lessons/E08-protocol-packages.md`
- L05 Submit client and HTTP submission: `feynman/lessons/L05-submit-client.md`
- L47 Simulator HTTP API + rate limits: `feynman/lessons/L47-simulator-http-api.md`
- L06 Simulator /submit endpoint (decode + dispatch): `feynman/lessons/L06-simulator-submit-http.md`
- L07 Submission routing to mempool: `feynman/lessons/L07-simulator-submission.md`
- L08 Mempool broadcast internals: `feynman/lessons/L08-simulator-state-mempool.md`
- E03 Node entrypoint + network wiring (context): `feynman/lessons/E03-node-entrypoint.md`
- E04 Consensus pipeline + seeding (context): `feynman/lessons/E04-consensus-seeding.md`
- E05 Storage, proofs, and persistence (context): `feynman/lessons/E05-storage-persistence.md`
- L10 Execution layer dispatch: `feynman/lessons/L10-execution-dispatch.md`
- L11 Casino handler (state transitions + events): `feynman/lessons/L11-casino-handlers.md`
- L12 Updates WS + event decoding: `feynman/lessons/L12-updates-and-events.md`
- L48 Explorer persistence + replay: `feynman/lessons/L48-explorer-persistence.md`

### Clients (optional, to accompany L01-L04)
- E09 Mobile app architecture: `feynman/lessons/E09-mobile-app.md`
- E10 Web app architecture: `feynman/lessons/E10-web-app.md`
- L50 Web vault + passkeys: `feynman/lessons/L50-web-vault-passkeys.md`

### Registration + Faucet (CasinoRegister / CasinoDeposit)
- L13 Gateway entrypoint (register/faucet paths): `feynman/lessons/L13-gateway-register-faucet.md`
- L14 Session manager (register/deposit flow): `feynman/lessons/L14-session-register-faucet.md`
- L15 Instruction encoding (register/deposit): `feynman/lessons/L15-register-instructions.md`
- L16 Transaction building (register/deposit): `feynman/lessons/L16-register-transactions.md`
- L17 Submit client (register/deposit): `feynman/lessons/L17-register-submit-client.md`
- L18 Simulator /submit (register/deposit): `feynman/lessons/L18-register-submit-http.md`
- L19 Submission -> mempool (register/deposit): `feynman/lessons/L19-register-submission.md`
- L20 Mempool broadcast (register/deposit): `feynman/lessons/L20-register-mempool.md`
- L22 Execution dispatch (register/deposit): `feynman/lessons/L22-register-dispatch.md`
- L23 Casino handlers (register/deposit): `feynman/lessons/L23-register-handlers.md`
- L24 Rust type definitions (register/deposit): `feynman/lessons/L24-register-types.md`

### Tournament Join / Start / End (Freeroll lifecycle)
- L25 Web client nonce manager: `feynman/lessons/L25-web-nonce-manager.md`
- L26 Freeroll UI scheduler: `feynman/lessons/L26-freeroll-scheduler-ui.md`
- L27 Server tournament scheduler: `feynman/lessons/L27-tournament-scheduler.md`
- L28 Auth service + admin txs: `feynman/lessons/L28-auth-admin-sync.md`
- L29 Convex admin nonce store: `feynman/lessons/L29-convex-admin-nonce-store.md`
- L30 Casino handlers (tournament lifecycle): `feynman/lessons/L30-tournament-handlers.md`
- L31 Rust types (tournament instructions): `feynman/lessons/L31-tournament-types.md`

### Auth + Stripe + Convex (Entitlements & Freeroll sync)
- L32 Auth service endpoints: `feynman/lessons/L32-auth-server.md`
- L49 Simulator passkeys (dev endpoints): `feynman/lessons/L49-simulator-passkeys.md`
- L33 Convex auth challenge store: `feynman/lessons/L33-convex-auth.md`
- L34 Convex user linking: `feynman/lessons/L34-convex-users.md`
- L35 Stripe webhook ingress: `feynman/lessons/L35-convex-http-stripe.md`
- L36 Stripe actions + sessions: `feynman/lessons/L36-convex-stripe-actions.md`
- L37 Stripe event store + entitlements: `feynman/lessons/L37-convex-stripe-store.md`
- L38 Entitlements query: `feynman/lessons/L38-convex-entitlements.md`
- L39 Auth admin sync (wasm + /submit): `feynman/lessons/L39-auth-casino-admin.md`
- L40 Admin nonce store (integration): `feynman/lessons/L40-convex-admin-nonce-integration.md`

### Live-table Craps (Off-chain service + On-chain global table)
- L41 Gateway craps handler (live vs normal routing): `feynman/lessons/L41-gateway-craps-handler.md`
- L42 LiveCrapsTable (off-chain gateway client): `feynman/lessons/L42-live-craps-table.md`
- L43 Live-table service engine (off-chain): `feynman/lessons/L43-live-table-service.md`
- L44 OnchainCrapsTable (global table orchestration): `feynman/lessons/L44-onchain-craps-table.md`
- L45 Global table handlers (on-chain): `feynman/lessons/L45-global-table-handlers.md`
- L46 Compare live-table vs normal craps: `feynman/lessons/L46-live-vs-normal-craps.md`
- E06 Execution engine internals (game logic): `feynman/lessons/E06-execution-engine.md`
- E07 RNG + fairness model: `feynman/lessons/E07-rng-fairness.md`

### Supplemental Concept Labs
- S01 Networking primer (HTTP/WS, CORS, origins): `feynman/lessons/S01-networking-primer.md`
- S02 Distributed systems primer (mempool, blocks, execution): `feynman/lessons/S02-distributed-systems-primer.md`
- S03 Cryptography primer (ed25519, signatures, nonces): `feynman/lessons/S03-crypto-primer.md`
- S04 WASM pipeline (web tx builders): `feynman/lessons/S04-wasm-primer.md`
- S05 Auth flows + threat model: `feynman/lessons/S05-auth-primer.md`
- S06 Payments + webhook idempotency: `feynman/lessons/S06-payments-primer.md`
- S07 Observability + production readiness: `feynman/lessons/S07-ops-primer.md`

### Ops + Deployment (recommended after Day 7)
- E11 Telemetry, logs, and ops events: `feynman/lessons/E11-telemetry-ops.md`
- E12 CI images + Docker build chain: `feynman/lessons/E12-ci-docker.md`
- E13 Systemd + service orchestration: `feynman/lessons/E13-systemd-services.md`
- E14 Hetzner infra + hardening checklist: `feynman/lessons/E14-hetzner-runbook.md`
- E15 Testing strategy + harnesses: `feynman/lessons/E15-testing-strategy.md`
- E16 Limits inventory + tuning checklist: `feynman/lessons/E16-limits-inventory.md`
