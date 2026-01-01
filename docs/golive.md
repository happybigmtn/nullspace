# Go-Live Roadmap

## Scope
This roadmap covers deployment, data, scalability, UI/UX usability, security, and production readiness for releasing the codebase publicly. It also defines a recommended authentication + Stripe membership approach aligned with a production database.

## Current System Snapshot (as-is)
- Consensus network: `nullspace-node` validators with local disk storage and YAML configs.
- Indexer/explorer: `nullspace-simulator` serving HTTP/WS, in-memory state, optional SQLite persistence.
- Gateway: `gateway` WebSocket bridge for mobile/web clients, validates the shared
  protocol, persists nonces in `GATEWAY_DATA_DIR`, and uses configurable session
  rate limits and event wait timeouts (`GATEWAY_SESSION_RATE_LIMIT_*`,
  `GATEWAY_EVENT_TIMEOUT_MS`).
- Frontend: `website` (Vite + React + WASM) consuming simulator APIs and WebSockets.
- Mobile: `mobile` (Expo/native) consuming the gateway WebSocket API.
- Dev-only auth: simulator passkeys are feature-gated, store raw Ed25519 keys in memory, and are not production-safe.
- No centralized DB for accounts, billing, or analytics; no production deployment pipeline; Dockerfile only targets simulator.
- Convex schema + functions, Stripe webhook handling, Auth.js v5 service, and billing UI are implemented; on-chain freeroll limits can be synced from entitlements, but Stripe price IDs and production infra are still pending.

## Decisions to Lock Early (P0)
- **Primary application database/back-end:** Self-hosted Convex (functions + database) for accounts, entitlements, and Stripe linkage.
- **Auth framework:** Auth.js v5 (self-hosted) with JWT sessions and Convex-backed user/entitlement records; local key auth only.
- **Stripe integration:** Stripe Billing + webhooks implemented as Convex `httpAction` endpoints -> `entitlements` table with feature flags and tier gating.
- **Membership perks:** $5/month `member` tier grants 10x daily freerolls, enforced on-chain via admin-synced limits.
- **Explorer/indexer persistence:** move from SQLite to Convex-backed explorer tables or a separate analytics store when multi-node deployments are required.

## Go-Live Workstreams

### 1) Infrastructure & Deployment
- Build real deployment topology: validators, indexer/explorer, API gateway, and frontend host/CDN.
- Containerize **all** deployable services (node, simulator/indexer, executor, gateway, website build).
- Deploy the Auth.js v5 service (see `services/auth`) alongside Convex and Stripe webhooks.
- Deploy a self-hosted Convex backend with persistent storage, backups, and staging/prod isolation.
  - Source: open-source Convex backend (`get-convex/convex-backend`), follow its self-hosted README.
  - Standardize `CONVEX_URL` and `CONVEX_SELF_HOSTED_URL` across services.
- Add Infrastructure-as-Code (Terraform/Pulumi) and secrets management (SSM/Vault).
- Define staging + production environments with independent configs and keys.
- Terminate TLS at the edge, enforce HTTPS/WSS, and enable HSTS.
- Replace local scripts with production-grade process supervision (systemd/K8s).
- Add health checks that do not rely on missing runtime deps (current Dockerfile lacks curl).
- Standardize gateway envs: `GATEWAY_DATA_DIR`, `GATEWAY_EVENT_TIMEOUT_MS`,
  `GATEWAY_SESSION_RATE_LIMIT_POINTS`, `GATEWAY_SESSION_RATE_LIMIT_WINDOW_MS`,
  and `GATEWAY_SESSION_RATE_LIMIT_BLOCK_MS`.

### 2) Data & Persistence
- Define Convex schema and indexes in `convex/schema.ts` with retention for events and explorer history.
- Implement data migration plan from in-memory/SQLite explorer to Convex tables.
- Establish backups + restore drills for Convex storage (RPO/RTO targets).
- Create data access layer boundaries (Convex functions vs indexer vs frontend).

### 3) Scalability & Performance
- Separate read and write paths: indexer service for reads, validators for consensus.
- Add WS fanout scaling strategy (Redis/NATS or sharded WS gateways).
- Add caching layer for high-traffic endpoints (Redis + HTTP cache headers).
- Load test with realistic concurrent players; define SLOs for latency and disconnects.
- Introduce backpressure policies for ingestion and persistence (now configurable).
- Tune gateway event wait timeouts (`GATEWAY_EVENT_TIMEOUT_MS`) to avoid
  client hangs during high latency or partial outages.
- Document resource sizing: CPU/memory for nodes, indexer, frontend.

### 4) Authentication + Stripe Memberships (Recommended Plan)
- Stand up Auth.js v5 + Convex-backed auth and entitlements:
  - Users table + linked public keys (on-chain identity mapping).
  - Sessions table with rotation and revocation.
  - Entitlements table (feature flags, tiers, expiry, source).
- Implement local key sign-in (ed25519 challenge) and map identity to Convex user records.
- Stripe Billing:
  - Customer creation at signup.
  - Subscription plans tied to membership tiers.
  - Webhook handler (Convex `httpAction`) to update entitlements (idempotent).
- Daily freeroll limits are enforced on-chain and synced by the Auth service using an admin key.
- Frontend gating:
  - Use entitlements to unlock perks (cosmetics, limits, tournaments).
  - Server-side enforcement for privileged actions.
- Migrate/replace simulator passkey endpoints (dev-only) with production auth.

### 5) Security, Privacy, and Compliance
- Threat model: signing keys, API abuse, WS flooding, replay, and botting.
- Move private keys out of the browser or mark strictly dev-only.
- Add rate-limits for WebSockets and per-account actions.
- Implement audit logging (auth, payments, privileged actions).
- Set up security headers (CSP, X-Frame-Options, etc.).
- Compliance roadmap:
  - KYC/AML and geofencing if required by jurisdiction.
  - Responsible gaming: self-exclusion, deposit limits, cooldowns.
  - Licensing assessments for real-money deployment.

### 6) UI/UX Usability and Product Readiness
- Eliminate frontend re-implementation of game outcomes; consume authoritative logs.
- Standardize game layouts and side-bet UX (see `website/docs/frontendchanges.md`).
- Improve onboarding:
  - Clear wallet/auth status, error messages, and recovery flows.
  - Visibility when chain is syncing or backend disconnected.
- Accessibility: keyboard, contrast, focus states, readable logs on mobile.
- Performance: reduce heavy 3D usage on low-end devices; LCP/CLS targets.

### 7) Observability & Operations
- Centralize metrics (Prometheus/Grafana) for nodes, indexer, frontend.
- Log aggregation (ELK/Datadog) with correlation IDs.
- Alerts for consensus stalls, WS disconnect rates, queue backpressure, and DB errors.
- Runbooks for incidents (data loss, chain forks, auth outages).
- SLO dashboards with error budgets.
- Add Convex function metrics, error tracking, and audit logs for auth/Stripe flows.

### 8) Testing, QA, and Release Management
- CI/CD pipeline for Rust + web build/test + wasm compilation.
- End-to-end tests for game flows across all games and devices.
- Integration bet coverage via `gateway/tests/all-bet-types.test.ts` in staging.
- Security testing: SAST, dependency scanning, and web vulnerability scans.
- Staging environment with production-like traffic.
- Release process with versioning, rollback, and canary deploys.

## Suggested Sequencing (Phase Gates)
- **Phase 0 (Design lock):** Convex self-hosting plan, auth flow finalization, deployment topology.
- **Phase 1 (Foundation):** Convex deployment, auth + entitlements, Stripe integration, infra/IaC, staging env.
- **Phase 2 (Scale + Reliability):** explorer persistence migration, WS fanout, caching, load tests.
- **Phase 3 (Product polish):** UI/UX consistency, authoritative logs, accessibility.
- **Phase 4 (Launch readiness):** compliance sign-off, incident playbooks, support ops, marketing.

## Open Questions
- Do we require a shared, multi-node explorer DB or can Convex handle explorer history at scale?
- Should the $5/month `member` tier be the only launch plan, or do we need additional tiers?
