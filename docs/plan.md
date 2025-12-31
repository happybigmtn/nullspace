# Plan

Docs index:
- `BUSINESS_PLAN.md`
- `economy.md`
- `liquidity.md`
- `golive.md`
- `SECURITY.md`
- `updates.md`
- `observability.md`
- `persistence.md`
- `resource_sizing.md`
- `runbooks.md`
- `release.md`

Business strategy summary and CEO view: `BUSINESS_PLAN.md`.

## Kickoff Requirements (From You)
- Target scale: peak concurrent players (5k, 10k, 50k) + expected WS connections.
- Hosting choice + access (cloud provider, region, and whether I can provision infra).
- Confirm NYC region choice (Hetzner Ashburn US-East is closest available).
- Domains + TLS strategy (CDN/WAF, cert management).
- Production secrets: Stripe live keys + webhook secret, Convex service token, admin keypair.
- Compliance scope (jurisdictions, KYC/AML requirements, responsible gaming scope).
- Legal structure: confirm Wyoming DUNA formation path and retain counsel.
- Launch tiers/pricing (confirm `member` only or additional tiers).

## What You Need To Do
- Provide prod Stripe keys and decide whether to create live prices or reuse test plan mapping.
- Provide admin ed25519 keypair and set `CASINO_ADMIN_PUBLIC_KEY_HEX` for simulator/executor.
- Provision the self-hosted Convex backend (or grant access to do so) with persistent storage and backups.
- Point DNS at your frontend + API domains and confirm allowed origins list.
- Configure simulator origin allowlists: `ALLOWED_HTTP_ORIGINS`, `ALLOWED_WS_ORIGINS`, and (optional) `ALLOW_HTTP_NO_ORIGIN` / `ALLOW_WS_NO_ORIGIN` for non-browser clients.
- Approve the target concurrency SLOs so infra sizing can be locked.
- Engage Wyoming counsel and a registered agent to form the DUNA entity and
  confirm tax/regulatory posture (gaming + token issuance).

## Reference Self-Hosted Architecture (Scale Targets)
- 1k-5k concurrent players: 1x simulator/indexer, 2x web/app nodes, 1x auth service, 1x Convex backend with persistent volume + backups, CDN for static site.
- 5k-20k concurrent players: 2x simulator/indexer (active/passive or sharded reads), 3-6x web/app nodes, WS gateways with sticky sessions, Redis/NATS for WS fanout, dedicated Convex backend with external Postgres + object storage.
- 20k+ concurrent players: separate read/indexer tier, multiple WS gateways behind L7 LB, Redis/NATS fanout, dedicated metrics/logs stack, replicated Convex backend with external DB + storage, multi-region failover plan.

## Practical Scaling Limit (Current Code + Defaults)
- Single simulator node: ~3k-5k concurrent WS connections before latency spikes (depends on update rate and proof load).
- Single executor/validator set: throughput bound by block production + proof generation; expect low hundreds of tx/sec unless tuned.
- Practical ceiling without horizontal scaling: ~5k concurrent active players with moderate gameplay rate.
- 20k requires horizontal scaling of WS/read plane (multiple simulators + LB) and careful rate limiting.

## Hetzner 20k Recommended Setup (Cost-Conscious)
- Region: Ashburn (US-East) is the closest Hetzner region to NYC; use private network + firewall rules.
- Load Balancer: 1x Hetzner LB11 for HTTP/WS (upgrade to 2x for HA if needed).
- Simulator/Indexer nodes: 4x CPX51 (16 vCPU / 32 GB) behind LB for `/submit`, `/updates`, and explorer reads.
- Validators (nullspace-node): 3x CPX31 (4 vCPU / 8 GB) for consensus (tolerates one failure).
- Executor: 1x CPX31 (active) + 1x CPX21 (standby) until HA execution is implemented.
- Auth service: 2x CPX21 (2 vCPU / 4 GB) behind LB.
- Convex backend: 1x CPX41 (8 vCPU / 16 GB) + persistent volume; dashboard restricted to VPN.
- Database: dedicated Postgres VM (CPX41/CPX51) with WAL archiving + Storage Box backups (Hetzner Managed Postgres not available in US regions).
- Object storage: Backblaze B2 (us-east) recommended; Wasabi (us-east) as alternative; Hetzner Object Storage only if EU residency is acceptable.
- Backups: Hetzner Storage Box for offsite backups of Postgres and Convex data.
- CDN/DNS/WAF: Cloudflare (free/pro) for static site + TLS + DDoS protection.

## Other Paid Services Required?
- Stripe: required for billing (fees only; no infra).
- DNS/CDN: Cloudflare recommended (free tier is sufficient to start).
- Object storage + Postgres: recommended for durability at 20k scale (managed where available, otherwise self-managed).

## Goal
- Reach production readiness with secure auth/billing, scalable infra, and consistent UX, while enforcing the $5/month `member` freeroll perk (1 -> 10 daily).

## Latest Review Summary
- Production blockers: self-hosted Convex + Auth deployment with persistent storage/backups, production secrets + Stripe live webhook rollout, staging environment with production-like traffic, and production-scale load tests + SLO validation.
- Ops readiness gaps: metrics/log aggregation + alerting in staging/prod and backup/restore drills for Convex + explorer data.
- Business/compliance gates: DUNA formation path, KYC/AML + responsible gaming scope, and geo-fencing plan if required.
- Phase 2 gating: CCA testnet rehearsal + auction parameter validation and contract security plan/audit.
- Product polish: onboarding status copy + accessibility/readability pass updated; remaining UX polish is ongoing.
- Local staging load test completed (200 bots, 120s, 0 failures); production-scale run still pending.

## Priority Focus (Business Plan Alignment)
### P0 - Phase 1 readiness + transparency
- [x] Implement treasury vesting enforcement (allocation unlock schedule + admin tooling).
- [x] Define and ship AMM bootstrap seeding mechanism; decide on optional bootstrap-finalize snapshot.
- [x] Replace simulated analytics with live economy dashboards (issuance/burn/fees/house PnL, debt, distribution).
- [x] Add proof-of-play weighting + sybil heuristics and tighten faucet/tournament churn limits.
- [x] Close go-live blockers: containerize node/executor/website, fix simulator Dockerfile healthcheck, remove browser private keys or enforce dev-only.

### P1 - Phase 2 launch prep
- [x] Write Uniswap v4 CCA testnet runbook (`cca_runbook.md`).
- [ ] Validate Uniswap v4 CCA deployment flow on testnet (params, clearance, liquidity seeding).
- [x] Implement fee distributor for staker USDT routing with governance controls.
- [x] Ship Commonware bridge module + UI flows with caps, delays, and emergency pause.
- [x] Build bridge relayer/service for EVM lockbox sync.
- [x] Implement recovery pool payout tooling + treasury wiring for Phase 2 proceeds.
- [x] Add oracle feed ingestion for AMM risk controls.
- [x] Ship heuristic sybil detection pipeline (device/IP/time clustering).
- [x] Align docs (`economy.md`, `liquidity.md`) with the existing `evm/` workspace status.

### P1 - Operational readiness (Phase 1/2 gating)
- [x] Document persistence model, migration path, backups, and data access boundaries (`persistence.md`).
- [x] Add Prometheus metrics endpoints + local Grafana stack (`observability.md`, `docker/observability/`).
- [x] Publish incident runbooks + rollback guidance (`runbooks.md`, `release.md`).
- [x] Define resource sizing targets for 5k/20k/50k (`resource_sizing.md`).
- [ ] Stand up staging environment and validate target load/SLOs.
- [ ] Deploy log aggregation + alerting in staging/prod.

## CEO Feasibility Review (Plan vs Codebase)
- Phase 1 core controls are implemented (stability fees, liquidations, debt
  ceiling, daily caps, dynamic sell tax, freeroll credit ledger, policy
  state, savings pool, AMM bootstrap, and live economy dashboards). Remaining
  gaps: marketing-scale reporting polish.
- Phase 2 EVM stack exists in `evm/` (RNGToken, BOGO distributor, RecoveryPool,
  BridgeLockbox, deployment/CCA scripts). Remaining gaps: production CCA
  integration/validation and security audits.
- The $20m debt repayment plan is now technically viable with debt ceilings,
  stability fees, and recovery-pool ordering; governance must still enforce
  treasury policies to prevent moral hazard.
- Optional full lending markets are a scope and risk multiplier; defer until
  after the Phase 2 launch unless strong demand emerges.
- Multi-chain expansion and advanced governance tooling should be deferred
  until after the Phase 2 launch stabilizes.

## Economy Plan
- The Phase 1 island economy and Phase 2 convertibility roadmap lives in `economy.md`.
- The liquidity + supply allocation roadmap lives in `liquidity.md`.

## Economic Sustainability + Convertibility Roadmap (Phase 1/2)

### Codebase Baseline (current reality)
- RNG exists as `Player.balances.chips` (internal, non-transferable).
- Freeroll credits exist as separate balances with vesting + expiry controls.
- vUSDT exists as `Player.balances.vusdt_balance` (internal stable balance).
- AMM (RNG/vUSDT) exists as `AmmPool` with CPMM math, 0.30% fee, and policy-driven sell tax bands.
- CDP/Vault exists (tiered 30-45% LTV against AMM spot) to mint vUSDT from RNG collateral.
- House accounting exists (`HouseState` tracks net PnL, fees, burned RNG, issuance, and vUSDT debt).
- Freeroll emissions are capped at 15% of supply and parameterized via
  `TOTAL_SUPPLY`, `ANNUAL_EMISSION_RATE_BPS`, `REWARD_POOL_BPS`.
- Staking exists; rewards distribute from positive epoch net PnL into a reward pool.
- Detailed tokenomics + liquidity roadmap lives in `liquidity.md`.

### Phase 1 - Island Economy With Capital Controls (internal convertibility only)
Goal: operate as a closed economy with strong internal DeFi loops before any external convertibility.

- [x] Define and publish Phase 1 monetary policy (sinks vs sources):
  - emission caps (`TOTAL_SUPPLY`, `REWARD_POOL_BPS`, `ANNUAL_EMISSION_RATE_BPS`)
  - faucet + initial chips (`FAUCET_AMOUNT`, `INITIAL_CHIPS`)
  - freeroll schedule (tournaments/day, payout curve)
  - freeroll credits + expiry + Phase 2 bonus eligibility
  - membership perks (10x freerolls; decide if any swap/LP/staking boosts apply)
- [x] Implement treasury vesting enforcement for the Phase 2 allocation
  (20% auction, 10% liquidity, up to 15% bonus, remainder to players/treasury/team).
- [x] Add stability mechanics for vUSDT (Phase 1 risk controls):
  - introduce stability fees / interest on vUSDT debt
  - add liquidation logic for LTV breaches
  - enforce a system debt ceiling + circuit breaker
  - define a bounded oracle policy (AMM spot + bootstrap guardrails)
- [x] Add AMM guardrails to enforce capital controls internally:
  - per-swap / per-day notional caps
  - dynamic sell-tax/fee bands (policy-driven)
- [x] Define treasury seeding mechanism for AMM bootstrap reserves (admin `SeedAmm` instruction).
- [x] Add an optional Phase 1 bootstrap-finalize snapshot for the closing price (`FinalizeAmmBootstrap`).
- [x] Expand domestic DeFi UX and analytics:
  - swap/borrow panels show caps, tax bands, and health metrics
  - conversion funnel metrics tracked via tx submission/confirmation telemetry
- [x] Add a vUSDT savings/deposit market funded by stability fees.
- [ ] Marketing-friendly economic loops:
  - tournaments, freerolls, and staking yield as primary retention hooks
  - LP rewards (if funded by treasury) as liquidity growth lever
  - public dashboards for emission, fees, burn, and house PnL (live)

### Phase 2 - External Convertibility (Uniswap v4 CCA via liquidity-launcher)
Goal: open controlled convertibility using a continuous clearing auction and external DEX liquidity.

- [x] Decide canonical RNG domain (EVM canonical) and bridge model (lock/mint).
- [x] Build ERC-20 RNG on EVM with capped supply + treasury controls.
- [ ] Integrate Uniswap v4 liquidity-launcher (CCA):
  - deploy on testnet, run dry run, and validate clearing logic
  - set auction parameters (duration, tranches, caps, allowlist policy)
  - define minimum raise threshold and fallback plan
  - seed Uniswap v4 pool at clearing price with raised stable + RNG
- [ ] Implement auction bonus + recovery pool:
  - BOGO bonus distribution tied to CCA receipts + Phase 1 freeroll credits
  - recovery pool accounting to retire up to 20m USDT in vUSDT debt
- [ ] Implement bridge service + UI:
  - export/import flows with caps, delays, and emergency pause (Commonware module + UI shipped)
  - convertibility policy toggles for phased opening
- [x] Introduce external price oracle feed into Phase 1 AMM controls.
- [ ] Contract security plan:
  - audits, monitoring, incident response, and pause controls

## Marketing + Growth (Simulation-First)
- [ ] Weekly leagues + streamer tournaments with public leaderboards.
- [x] Public economy dashboards (issuance, burn, fees, liquidity depth).
- [ ] Seasonal campaigns and retention rewards (cosmetic + status perks).
- [ ] Referral program tied to proof-of-play (anti-sybil).
- [ ] Pre-Phase 2 CCA testnet simulations + auction awareness campaigns.

## Sybil + Abuse Mitigation (Phase 1)
- [x] Account age + stake tiering for LTV (Tier 2 unlock).
- [x] Account age gating for freeroll limits and membership perks.
- [x] Proof-of-play weighting for freeroll rewards (session count/duration).
- [x] Heuristic sybil detection pipeline (device/IP/time clustering).
- [x] Rate-limit faucet and tournament churn beyond current caps.

## Analytics + Reporting
- [x] Public dashboards for issuance/burn/fees/house PnL.
- [x] Distribution concentration metrics (Gini/top-1% share).
- [x] AMM depth monitoring + vUSDT debt health dashboards.

## Legal + Governance (Wyoming DUNA)
Goal: establish a DAO-compatible legal wrapper and governance path for a
staker-owned economy.

- [ ] Form a Wyoming Decentralized Unincorporated Nonprofit Association (DUNA):
  - retain Wyoming counsel and a registered agent
  - file DUNA formation/qualification documents with the WY Secretary of State
  - adopt a DUNA operating agreement/DAO charter (governance + treasury rules)
  - define member/staker rights and voting procedures
  - confirm tax posture and reporting obligations (annual filings)
- [ ] Governance setup:
  - initial multisig for treasury and LP NFT custody
  - transition plan from multisig to staker governance
  - compliance policy for auctions, swaps, and rewards distribution
- [ ] Gaming compliance:
  - jurisdictional analysis and geo-fencing plan
  - responsible gaming policy and age checks

## Codebase Deliverables (Expanded Scope)
Phase 1 (Commonware codebase):
- [x] Update emission constants to 15% cap and add freeroll credit ledger with
  expiry + Phase 2 eligibility flags.
- [x] Split RNG credits from spendable chips (internal points vs supply ledger)
  to preserve supply accounting and prevent accidental externalization.
- [x] Implement stability fees, liquidation path, and a system debt ceiling.
- [x] Add treasury + vesting ledger for Phase 2 allocation buckets (enforced vesting + admin tooling).
- [x] Add vUSDT savings/deposit market funded by stability fees.
- [x] Add recovery-pool debt retirement hooks (vUSDT debt burn + audit trail).
- [x] Add recovery-pool payout ordering (LTV risk + debt age) to reduce
  insolvency risk.
- [x] Add policy state + admin updates for caps/fees/tiers.
- [x] UI for credit balances, vesting, debt health, and policy caps.

Phase 2 (EVM + bridge workstream):
- [x] New `evm/` workspace with RNG ERC-20, BOGO distributor, recovery pool, bridge lockbox,
  and CCA simulation scripts for testnet dry runs.
- [x] Wire BOGO distributor to Phase 1 credit ledger snapshots + eligibility pipeline
  (player registry + `freeroll-snapshot` exporter + eligibility merge script).
- [x] Uniswap v4 CCA parameter validation runbook.
- [ ] Uniswap v4 CCA deployment rehearsal (testnet dry run).
- [x] Recovery pool payout tooling (funding + redemption flow) and treasury wiring.
- [x] Fee distributor routing Uniswap v4 fees to stakers (USDT).
- [x] Bridge relayer/validator service (Commonware module + UI shipped).
- [x] Oracle feed ingestion for on-chain risk controls.
- [x] Player-to-EVM address linking workflow for BOGO claims (auth profile + export pipeline).

## Latest Deliverables
- [x] Uniswap v4 CCA testnet runbook (`docs/cca_runbook.md`).
- [x] Fee distributor contract + tests for USDT staker routing (`evm/contracts/FeeDistributor.sol`).
- [x] Commonware bridge module + UI route (`Bridge` instruction set + website flow).
- [x] Bridge relayer CLI for EVM lockbox sync (`client/src/bin/bridge_relayer.rs`).
- [x] Recovery pool admin tooling (Commonware CLI + EVM actions script).
- [x] Oracle ingestion path (Policy/Oracle state + `UpdateOracle` instruction + wasm/JS bindings).
- [x] Sybil scan CLI with device/IP/time clustering (`client/src/bin/sybil_scan.rs`).
- [x] Prometheus metrics endpoints + local Grafana stack (`/metrics/prometheus`, `docker/observability/`).
- [x] Loki + Promtail log aggregation stack for local dev (`docker/observability/`).
- [x] Ops docs for observability, persistence, runbooks, release, and sizing (`docs/observability.md`, `docs/persistence.md`, `docs/runbooks.md`, `docs/release.md`, `docs/resource_sizing.md`).
- [x] Node dependency audits in CI (warn-only) for auth + website.
- [x] SAST + filesystem vulnerability scans in CI (Semgrep + Trivy, warn-only).
- [x] Explorer HTTP cache headers for CDN-friendly caching.
- [x] Redis submission fanout (publish/subscribe) for multi-node updates with origin de-dupe.
- [x] Redis explorer response cache with TTL for high-traffic endpoints.
- [x] Connection status pill with offline handling + retry CTA (onboarding UX).
- [x] TLS/HSTS nginx template for production edge termination (`website/nginx.ssl.conf`).
- [x] Systemd unit templates for simulator/node/auth/website (`ops/systemd/`).
- [x] Staging/production env examples for simulator/auth/website (`configs/`, `services/auth/`, `website/`).
- [x] GameResult logging pipeline: per-move logs now flow through `GameResult` and into
  `CasinoGameMoved`/`CasinoGameCompleted` events for UI rendering.
- [x] Phase 1/2 simulation tooling: `phase_simulation` CLI, `scripts/phase-sim.sh`, and
  `scripts/phase2-e2e-sim.sh` (100-bot end-to-end flow).
- [x] Phase 2 EVM workspace with ERC-20 RNG, BOGO distributor, recovery pool, bridge lockbox,
  plus Hardhat tests and CCA bid/snapshot scripts.
- [x] Phase 2 allocation assumptions logged in `client/examples/simulation_ecosystem.rs`.
- [x] Player registry + `freeroll-snapshot` CLI to export Phase 1 freeroll eligibility,
  plus updated `buildEligibilitySnapshot.mjs` to merge bids + player mappings.
- [x] EVM wallet self-linking (challenge + signature), profile exposure, and export pipeline
  (`/profile/evm-challenge`, `/profile/link-evm`, `/profile/unlink-evm`, `export-evm-links.mjs`).
- [x] Economy UI now surfaces daily caps, sell tax bands, tiered LTV limits, and stability fee hints.
- [x] Wallet pill includes freeroll credit balances (locked + unlocked).
- [x] Treasury allocations readable in Economy UI (when configured).
- [x] PolicyState on-chain controls (sell-tax bands, daily caps, LTV tiers, stability fee, debt ceiling).
- [x] TreasuryState struct and admin setter for allocation tracking (ledger only).
- [x] Stability fee accrual on vault debt and house-level debt accounting.
- [x] Liquidation path with penalty split (liquidator + stability pool).
- [x] Recovery pool funding + debt retirement hooks.
- [x] Recovery-pool retirement now targets worst LTV vaults (tie-broken by oldest accrual).
- [x] Treasury updates emit events and refresh the Economy UI state.
- [x] Borrow panel surfaces recovery-pool and vUSDT debt metrics (debug view).
- [x] Vault registry key exposed via WASM/client for audits and admin tools.
- [x] Markdown documentation consolidated under `docs/`.
- [x] vUSDT savings pool (deposit/withdraw/claim) with stability-fee funding.
- [x] Freeroll daily limits enforce account age gating for new accounts.
- [x] Stripe test membership created for tier `member` ($5/month).
  - Product: `prod_TfP7ygigcze2Ar`
  - Price: `price_1Si4J93nipX4Oc41ak3eP67k`
- [x] On-chain daily freeroll limit enforcement + admin sync flow.
- [x] Auth.js v5 + Convex + Stripe integration wired end-to-end (env-driven tiers).
- [x] Convex service-token gating + billing validation + shared admin nonce allocator.
- [x] Stripe multi-item entitlement updates + scheduled retention pruning.
- [x] Stripe entitlement reconciliation endpoint for manual repair.
- [x] Auth service rate limiting for challenge/profile/billing endpoints.
- [x] Simulator HTTP/WS origin allowlists, HTTP body limits, and WS connection/message caps.
- [x] Stripe reconciliation cron and webhook rate limiting for Convex.
- [x] Postgres-backed explorer persistence option for multi-node deployments.
- [x] Simulator + auth request IDs, structured request logs, and auth metrics endpoint.
- [x] Frontend security headers baseline via `website/public/_headers`.
- [x] Postgres explorer private-host enforcement with override env vars.
- [x] Edge/shared rate limiting guidance for simulator + auth.
- [x] QA + compliance checklists for launch readiness.
- [x] Auth + billing + entitlement + freeroll E2E automation script (`website/scripts/e2e-auth-billing.mjs`).
- [x] Layout smoke automation for breakpoints + side bet drawers (`website/scripts/layout-smoke.mjs`).
  - WebKit runs on Arch use `website/scripts/setup-webkit-libs.sh` + `PW_WEBKIT_LIB_PATH`.
- [x] Capped in-memory rate-limit buckets for auth + Convex Stripe webhook.
- [x] Convex Stripe storage moved to non-node module (`website/convex/stripeStore.ts`) to satisfy `use node` action rules.
- [x] Stripe-enabled E2E run against self-hosted Convex + Auth service (checkout + entitlements + freeroll sync; freeroll sync reports `admin_unconfigured` without casino keys).
- [x] Removed compiled `website/convex/*.js` artifacts to prevent Convex bundling collisions.
- [x] Documented load testing steps for simulator/WS scale validation.
- [x] Added local E2E bootstrap script for self-hosted Convex + Auth + Stripe (`scripts/e2e-auth-billing-local.sh`).
- [x] Ran local E2E bootstrap (checkout + entitlements OK; freeroll sync `admin_unconfigured` without casino keys).
- [x] Ran local load-test smoke run (50 bots, 60s, 0 failed; output in `load-test-20251225-015307`).

## Blocking Issues (P0)
- [x] Lock down Convex auth/user/entitlement/stripe functions with a service token gate.
- [x] Add server-side validation of Stripe price/tier and origin checks for billing endpoints.
- [x] Add a safe nonce strategy for admin transactions when Auth service scales horizontally.

## Remediation Plan

### Phase 0 - Security & Access Control (P0)
- [x] Guard Convex user/auth/entitlement mutations with a service token; make `getUserByAuth` internal.
- [x] Require service token on Stripe checkout/portal actions.
- [x] Add server-side validation in Auth service: allowed `priceId` list and tier mapping (reject client-provided values outside the allowlist).
- [x] Add CSRF/origin enforcement for `/profile/*` and `/billing/*` endpoints (fail closed if `AUTH_ALLOWED_ORIGINS` is unset).
- [x] Require signature proof when linking a public key to a user profile.
- [x] Lock down simulator HTTP + WS origins (fail closed unless allowlisted).
- [x] Enforce request body size limits on simulator submit endpoints.

### Phase 1 - Data Integrity & Retention (P1)
- [x] Add TTL/cleanup job for `auth_challenges` table and for `stripe_events` retention.
- [x] Add entitlement reconciliation support (manual endpoint; cron optional).
- [x] Add idempotent event handling for multiple subscription items (multi-price support).
- [x] Schedule periodic entitlement reconciliation (cron) for self-hosted Convex.

### Phase 2 - Scalability & Reliability (P1/P2)
- [x] Introduce distributed nonce management for admin transactions using Convex `admin_nonces`.
- [x] Add rate limits to Convex HTTP actions (Auth service rate limits implemented).
- [x] Enforce websocket connection limits and per-connection memory caps (configurable).
- [x] Establish shared explorer persistence backend for multi-node deployments (Postgres; SQLite remains for single-node).
- [x] Add TLS or private-network enforcement for explorer Postgres connections (private-host enforcement with overrides).
- [x] Add shared rate limiting guidance (edge/WAF config) for Auth service and simulator endpoints.

### Phase 3 - Observability & Operations (P2)
- [x] Structured logging + request IDs across simulator/auth/front-end HTTP paths.
- [x] Metrics for auth/billing success/failures, webhook latency logs, and freeroll sync attempts.
- [x] Health checks and alert hooks for Stripe webhook failures and admin tx submit failures (metrics/logs exposed).
- [x] Add security headers (CSP, HSTS, X-Frame-Options) for frontend hosting/CDN.

### Phase 4 - UX/Compliance/QA (P2/P3)
- [x] End-to-end tests for signup, billing, entitlement enforcement, and freeroll limit syncing.
- [x] Validate mobile/desktop UX consistency for all games and side-bet drawers.
- [x] Compliance gap analysis (KYC/AML, responsible gaming, geo-fencing if required).
- [x] Draft QA and compliance checklists.

## Go-Live Workstreams (Merged from `golive.md`)

### Infrastructure & Deployment
- [x] Containerize all deployable services (validator/node, simulator/indexer, executor, website build).
- [ ] Deploy Auth.js service and Convex backend with persistent storage + backups.
- [x] Define staging + production environments with independent configs and keys.
- [ ] Add Infrastructure-as-Code (Terraform/Pulumi) and secrets management (SSM/Vault).
- [x] Terminate TLS at the edge, enforce HTTPS/WSS, and enable HSTS.
- [x] Replace local scripts with production-grade supervision (systemd/K8s).
- [x] Add health checks that don't rely on missing runtime deps (Dockerfile curl gap).

### Data & Persistence
- [x] Convex schema + indexes for auth/billing/entitlements (`website/convex/schema.ts`).
- [x] Explorer/event history persistence model + retention documented (`docs/persistence.md`).
- [x] Migration plan from SQLite to shared Postgres documented (`docs/persistence.md`).
- [x] Data access boundaries documented (`docs/persistence.md`).
- [x] Backup + restore plan + RPO/RTO targets documented (`docs/persistence.md`).
- [x] Backup + restore drills for Convex and explorer data.

### Scalability & Performance
- [x] Backpressure controls and rate limits for simulator + auth (configurable caps).
- [x] Separate read/indexer and write/validator paths for scale; add WS fanout (Redis/NATS).
- [x] Add HTTP cache headers for explorer endpoints.
- [x] Add Redis caching layer for high-traffic endpoints.
- [x] Define SLOs + alert thresholds (`docs/observability.md`).
- [ ] Load test with target concurrency and validate SLOs.
- [x] Document resource sizing per component for 5k/20k/50k concurrency (`docs/resource_sizing.md`).

### Auth + Billing (Production)
- [x] Auth.js v5 + Convex-backed entitlements + Stripe webhook sync.
- [x] On-chain freeroll limit sync from entitlements.
- [x] Migrate/replace simulator dev passkeys with production auth-only flows.
- [ ] Production secrets + Stripe live key rollout and webhook verification.

### Security, Privacy, Compliance
- [x] Service-token gating, origin allowlists, and rate limits for auth + Convex + simulator.
- [x] Frontend security headers baseline via `website/public/_headers`.
- [x] Move private keys out of the browser or enforce dev-only key handling.
- [x] Audit logging for privileged actions (admin txs, billing, policy updates).
- [x] Update `SECURITY.md` with Null/Space disclosure contacts and bounty policy.
- [ ] Compliance implementation: KYC/AML and responsible gaming controls if required.

### UI/UX Usability
- [x] Side-bet drawer alignment + breakpoint smoke automation.
- [x] Authoritative logs consumption across all games (remove any frontend re-sims).
- [x] Onboarding baseline: connection status + offline handling + retry CTA.
- [x] Onboarding flow polish (wallet/auth status copy, recovery UX, offline fallback).
- [x] Accessibility baseline: global focus-visible styling.
- [x] Accessibility pass (contrast, keyboard navigation, mobile log readability).

### Observability & Operations
- [x] Request IDs + structured logging + auth metrics endpoint.
- [x] Prometheus metrics endpoints + local Grafana stack (`/metrics/prometheus`, `docker/observability/`).
- [x] SLO dashboards + alert thresholds documented (`docs/observability.md`).
- [x] Log aggregation + alerting plan documented (`docs/observability.md`).
- [x] Local Loki/Promtail stack for log aggregation.
- [ ] Deploy metrics/log aggregation + alerting in staging/prod.
- [x] Incident runbooks and on-call rotations documented (`docs/runbooks.md`).

### Testing, QA, Release Management
- [x] E2E auth/billing + freeroll enforcement scripts.
- [x] Layout + load-test smoke scripts.
- [x] CI/CD for Rust + web + wasm builds and tests.
- [x] Dependency scanning in CI (cargo audit + npm audit warn-only).
- [x] Release rollback plan documented (`docs/release.md`).
- [x] Staging environment plan documented (`docs/release.md`).
- [ ] Staging environment with production-like traffic.
- [x] SAST/code scanning and filesystem vulnerability scans in CI (Semgrep/Trivy, warn-only).

## Self-Hosted Convex Backend Steps
- [ ] Provision a host and persistent volumes for Convex backend + dashboard.
- [ ] Configure `docker/convex/.env` with public origins, Stripe keys, and `CONVEX_SERVICE_TOKEN`.
- [ ] Ensure `docker/convex/docker-compose.yml` passes Stripe + service-token env vars to the backend.
- [ ] Start Convex with `docker compose up -d` and generate an admin key.
- [ ] Set `CONVEX_SELF_HOSTED_URL` + `CONVEX_SELF_HOSTED_ADMIN_KEY` for the CLI.
- [ ] Push Convex functions (`npx convex dev` or `npx convex deploy`).
- [ ] Set Convex deployment env vars via CLI (`npx convex env set`) for `CONVEX_SERVICE_TOKEN`, Stripe keys, and retention settings.
- [ ] Point `CONVEX_URL` in Auth service to the self-hosted backend.
- [ ] Set up backups + alerting for Convex storage and database volumes.
- [ ] For >5k concurrency, move Convex data off local volume and configure external Postgres + object storage.
- [ ] Secure Convex dashboard behind VPN/SSO and set `INSTANCE_SECRET` for production.

## Deployment Checklist (Go-Live)
- [ ] Set `VITE_STRIPE_TIERS=member:<priceId>` and `FREEROLL_MEMBER_TIERS=member` in production env.
- [ ] Set `CASINO_ADMIN_PUBLIC_KEY_HEX` for simulator/executor and `CASINO_ADMIN_PRIVATE_KEY_FILE` for Auth service.
- [ ] Configure Stripe webhook endpoint to Convex HTTP action and verify signature.
- [ ] Set simulator allowlists (`ALLOWED_HTTP_ORIGINS`, `ALLOWED_WS_ORIGINS`) and origin exemptions if needed.
- [ ] Configure simulator explorer persistence (use `--explorer-persistence-url` for Postgres shared storage).
- [ ] If Postgres uses a hostname or public IP, set `EXPLORER_PERSISTENCE_ALLOW_HOSTNAME=1` or `EXPLORER_PERSISTENCE_ALLOW_PUBLIC=1` as needed.
- [ ] Provision secrets management and backups for Convex and chain state.

## Exit Criteria
- [ ] All P0/P1 items resolved and regression tested.
- [ ] Load test passes with target concurrency and SLOs.
- [ ] Security review complete and webhook/billing flows verified.
