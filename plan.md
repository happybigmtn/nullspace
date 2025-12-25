# Plan

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

## CEO Feasibility Review (Plan vs Codebase)
- Phase 1 is feasible with targeted changes: the code already supports
  tournaments, AMM swaps, vault borrows, and staking, but lacks stability
  fees, liquidation logic, debt ceiling controls, treasury/vesting ledgers,
  and freeroll credit accounting.
- Phase 2 requires a parallel EVM stack (ERC-20, CCA launcher, staking, and
  bridge) that does not exist in this repo; it is a separate build and audit
  track.
- The $20m debt repayment plan is only viable if we enforce debt ceilings and
  interest in Phase 1; otherwise the recovery pool creates moral hazard.
- Optional full lending markets are a scope and risk multiplier; defer until
  after Phase 2 unless strong demand emerges.
- Multi-chain expansion and advanced governance tooling should be deferred
  until after the Phase 2 launch stabilizes.

## Economy Plan
- The Phase 1 island economy and Phase 2 convertibility roadmap lives in `economy.md`.
- The liquidity + supply allocation roadmap lives in `liquidity.md`.

## Economic Sustainability + Convertibility Roadmap (Phase 1/2)

### Codebase Baseline (current reality)
- RNG exists as `Player.balances.chips` (internal, non-transferable).
- vUSDT exists as `Player.balances.vusdt_balance` (internal stable balance).
- AMM (RNG/vUSDT) exists as `AmmPool` with CPMM math, 0.30% fee, 5.00% sell tax, and bootstrap price.
- CDP/Vault exists (50% LTV against AMM spot) to mint vUSDT from RNG collateral.
- House accounting exists (`HouseState` tracks net PnL, fees, burned RNG, issuance).
- Freeroll emissions are currently capped at 25% of supply (policy target: 15%)
  and parameterized via `TOTAL_SUPPLY` and `ANNUAL_EMISSION_RATE_BPS`.
- Staking exists; rewards distribute from positive epoch net PnL into a reward pool.
- Detailed tokenomics + liquidity roadmap lives in `liquidity.md`.

### Phase 1 - Island Economy With Capital Controls (internal convertibility only)
Goal: operate as a closed economy with strong internal DeFi loops before any external convertibility.

- [ ] Define and publish Phase 1 monetary policy (sinks vs sources):
  - emission caps (`TOTAL_SUPPLY`, `REWARD_POOL_BPS`, `ANNUAL_EMISSION_RATE_BPS`)
  - faucet + initial chips (`FAUCET_AMOUNT`, `INITIAL_CHIPS`)
  - freeroll schedule (tournaments/day, payout curve)
  - freeroll credits + expiry + Phase 2 bonus eligibility
  - membership perks (10x freerolls; decide if any swap/LP/staking boosts apply)
- [ ] Implement a treasury + vesting ledger for the Phase 2 allocation
  (20% auction, 10% liquidity, up to 15% bonus, remainder to players/treasury/team)
  with on-chain accounting and audit trail.
- [ ] Add stability mechanics for vUSDT (Phase 1 risk controls):
  - introduce stability fees / interest on vUSDT debt
  - add liquidation logic for LTV breaches
  - enforce a system debt ceiling + circuit breaker
  - define a bounded oracle policy (AMM spot + bootstrap guardrails)
- [ ] Add AMM guardrails to enforce capital controls internally:
  - per-swap / per-day notional caps
  - dynamic sell-tax/fee bands (policy-driven)
  - optional "bootstrap finalize" snapshot for Phase 1 closing price
- [ ] Expand domestic DeFi UX and analytics:
  - swap/borrow/liquidity panels show fees, tax, and health metrics
  - track conversion funnel metrics (swap/borrow/LP starts and completions)
- [ ] Marketing-friendly economic loops:
  - tournaments, freerolls, and staking yield as primary retention hooks
  - LP rewards (if funded by treasury) as liquidity growth lever
  - public dashboards for emission, fees, burn, and house PnL

### Phase 2 - External Convertibility (Uniswap v4 CCA via liquidity-launcher)
Goal: open controlled convertibility using a continuous clearing auction and external DEX liquidity.

- [ ] Decide canonical RNG domain (Commonware vs EVM) and bridge model (lock/mint or burn/mint).
- [ ] Build ERC-20 RNG on EVM with capped supply + treasury controls.
- [ ] Integrate Uniswap v4 liquidity-launcher (CCA):
  - deploy on testnet, run dry run, and validate clearing logic
  - set auction parameters (duration, tranches, caps, allowlist policy)
  - define minimum raise threshold and fallback plan
  - seed Uniswap v4 pool at clearing price with raised stable + RNG
- [ ] Implement auction bonus + recovery pool:
  - BOGO bonus distribution tied to CCA receipts + Phase 1 freeroll credits
  - recovery pool accounting to retire up to 20m USDT in vUSDT debt
- [ ] Implement bridge service + UI:
  - export/import flows with caps, delays, and emergency pause
  - convertibility policy toggles for phased opening
- [ ] Introduce external price oracle feed into Phase 1 AMM controls.
- [ ] Contract security plan:
  - audits, monitoring, incident response, and pause controls

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
- [ ] Update emission constants to 15% cap and add freeroll credit ledger with
  expiry + Phase 2 eligibility flags.
- [ ] Split RNG credits from spendable chips (internal points vs supply ledger)
  to preserve supply accounting and prevent accidental externalization.
- [ ] Implement stability fees, liquidation path, and a system debt ceiling.
- [ ] Add treasury + vesting ledger for Phase 2 allocation buckets.
- [ ] Add recovery-pool debt retirement hooks (vUSDT debt burn + audit trail).
- [ ] Add recovery-pool payout ordering (LTV risk + debt age) to reduce
  insolvency risk.
- [ ] Add policy state + admin updates for caps/fees/tiers.
- [ ] UI for credit balances, vesting, debt health, and policy caps.

Phase 2 (EVM + bridge workstream):
- [ ] New `evm/` workspace or external repo for ERC-20 RNG + CCA integration.
- [ ] Bonus distribution contract (BOGO) keyed to CCA receipts + credit ledger.
- [ ] Recovery pool contract + payout tooling (up to 20m USDT).
- [ ] Fee distributor routing Uniswap v4 fees to stakers (USDT).
- [ ] Bridge contracts + relayer/validator service and UI flows.
- [ ] Oracle feed ingestion for on-chain risk controls.

## Latest Deliverables
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
- [ ] Set `CASINO_ADMIN_PUBLIC_KEY_HEX` for simulator/executor and `CASINO_ADMIN_PRIVATE_KEY_HEX` for Auth service.
- [ ] Configure Stripe webhook endpoint to Convex HTTP action and verify signature.
- [ ] Set simulator allowlists (`ALLOWED_HTTP_ORIGINS`, `ALLOWED_WS_ORIGINS`) and origin exemptions if needed.
- [ ] Configure simulator explorer persistence (use `--explorer-persistence-url` for Postgres shared storage).
- [ ] If Postgres uses a hostname or public IP, set `EXPLORER_PERSISTENCE_ALLOW_HOSTNAME=1` or `EXPLORER_PERSISTENCE_ALLOW_PUBLIC=1` as needed.
- [ ] Provision secrets management and backups for Convex and chain state.

## Exit Criteria
- [ ] All P0/P1 items resolved and regression tested.
- [ ] Load test passes with target concurrency and SLOs.
- [ ] Security review complete and webhook/billing flows verified.
