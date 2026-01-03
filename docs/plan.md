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
- Legal structure: confirm formation path and retain counsel.
- Launch tiers/pricing (confirm `member` only or additional tiers).

## What You Need To Do
- Provide prod Stripe keys and decide whether to create live prices or reuse test plan mapping.
- Provide admin ed25519 keypair via secret file/URL for production and set
  `CASINO_ADMIN_PUBLIC_KEY_HEX` for non-prod fallback.
- Provision the self-hosted Convex backend (or grant access to do so) with persistent storage and backups.
- Point DNS at your frontend + API domains and confirm allowed origins list.
- Configure simulator origin allowlists: `ALLOWED_HTTP_ORIGINS`, `ALLOWED_WS_ORIGINS`, and (optional) `ALLOW_HTTP_NO_ORIGIN` / `ALLOW_WS_NO_ORIGIN` for non-browser clients.
- Configure gateway persistence + session limits: `GATEWAY_DATA_DIR`,
  `GATEWAY_SESSION_RATE_LIMIT_*`, and `GATEWAY_EVENT_TIMEOUT_MS` for production/staging.
- Approve the target concurrency SLOs so infra sizing can be locked.
- Engage counsel and a registered agent to form the legal entity and
  confirm tax/regulatory posture (gaming + token issuance).

## Reference Self-Hosted Architecture (Scale Targets)
- 1k-5k concurrent players: 1x simulator/indexer, 2x web/app nodes, 1x gateway, 1x auth service, 1x Convex backend with persistent volume + backups, CDN for static site.
- 5k-20k concurrent players: 2x simulator/indexer (active/passive or sharded reads), 3-6x web/app nodes, 2x+ gateways with sticky sessions, Redis/NATS for WS fanout, dedicated Convex backend with external Postgres + object storage.
- 20k+ concurrent players: separate read/indexer tier, multiple gateways behind L7 LB, Redis/NATS fanout, dedicated metrics/logs stack, replicated Convex backend with external DB + storage, multi-region failover plan.

## Practical Scaling Limit (Current Code + Defaults)
- Single simulator node: ~3k-5k concurrent WS connections before latency spikes (depends on update rate and proof load).
- Single validator set: throughput bound by block production + proof generation; expect low hundreds of tx/sec unless tuned.
- Practical ceiling without horizontal scaling: ~5k concurrent active players with moderate gameplay rate.
- 20k requires horizontal scaling of WS/read plane (multiple simulators + LB) and careful rate limiting.

## Hetzner 20k Recommended Setup (Cost-Conscious)
- Region: Ashburn (US-East) is the closest Hetzner region to NYC; use private network + firewall rules.
- Load Balancer: 1x Hetzner LB11 for HTTP/WS (upgrade to 2x for HA if needed).
- Simulator/Indexer nodes: 4x CPX51 (16 vCPU / 32 GB) behind LB for `/submit`, `/updates`, and explorer reads.
- Validators (nullspace-node): 3x CPX31 (4 vCPU / 8 GB) for consensus + execution (tolerates one failure).
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
- Business/compliance gates: formation path, KYC/AML + responsible gaming scope, and geo-fencing plan if required.
- Phase 2 gating: CCA testnet rehearsal + auction parameter validation and contract security plan/audit.
- Product polish: onboarding status copy + accessibility/readability pass updated; remaining UX polish is ongoing.
- Gateway: shared protocol validation updated for roulette/sic bo numeric bet types and `hilo_deal` amount; session rate limiting and event timeouts are configurable; integration bet-type coverage runs in `gateway/tests/all-bet-types.test.ts`.
- Gateway integration testing surfaced the default session creation rate limit (10/hr) and submit endpoint rate limits as bottlenecks; testnet must set explicit rate-limit profiles to avoid onboarding stalls and internal 429s.
- AI strategy defaults to disabled in staging/testnet to avoid external API dependencies; enable only when Gemini keys + billing are provisioned.
- Local staging load test completed (200 bots, 120s, 0 failures); production-scale run still pending.

## Pre-Testnet Deliverables (Post-Review + Full Bet/Game Tests)
- [ ] Enforce non-custodial vaults in staging/testnet by disabling legacy browser keys (`VITE_ALLOW_LEGACY_KEYS=0`) and validating passkey/password fallback UX.
- [ ] Execute the testnet runbook on real infra (bootstrap configs, multi-node soak test, restart recovery, tournament scheduler, bot load) once staging hosts are available.
- [ ] Stand up staging/testnet observability (metrics + logs + alerts) and confirm explorer persistence/backup paths.
- [ ] Deploy Auth + Convex in staging/testnet with production-like secrets, origins, and backup/restore drills.
- [ ] Complete mobile parity QA on real devices, including key vault recovery flows and reconnect scenarios.

## Priority Focus (Business Plan Alignment)

### P1 - Operational readiness (Phase 1/2 gating)
- [ ] Stand up staging environment and validate target load/SLOs.
- [ ] Deploy log aggregation + alerting in staging/prod.

## Business Objective Gaps (Next Dev Priorities)
- [ ] Product analytics pipeline for KPIs: server-side event capture (simulator/gateway/auth), warehouse, and dashboards for DAU/WAU, D7/D30 retention, conversion, ARPDAU, and fee revenue per active user.
- [ ] Public transparency dashboards: publish read-only economy snapshots (cache/export) so analytics pages don’t require `VITE_IDENTITY`.
- [ ] Weekly league/season system: schedule rotation, scoring aggregation across games, leaderboard resets, reward distribution, and admin tooling for streamer events.
- [ ] Referral + invite program tied to proof-of-play and account maturity (anti-sybil gating + reward caps).
- [ ] Mobile monetization parity: subscription/entitlement flows + tier status UI + freeroll limit sync.
- [ ] Retention CRM: push notification backend and campaign scheduler (weekly events, tournament reminders, seasonal rewards).

## CEO Feasibility Review (Plan vs Codebase)
- Phase 1 core controls are implemented (stability fees, liquidations, debt
  ceiling, daily caps, dynamic sell tax, freeroll credit ledger, policy
  state, savings pool, AMM bootstrap, and live economy dashboards). Remaining
  gaps: marketing-scale reporting polish.
- Phase 2 EVM stack exists in `evm/` (RNGToken, BOGO distributor, RecoveryPool,
  BridgeLockbox, deployment/CCA scripts). Remaining gaps: production CCA
  integration/validation and security audits.
- The $10m debt repayment plan is now technically viable with debt ceilings,
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

- [ ] Marketing-friendly economic loops:
  - tournaments, freerolls, and staking yield as primary retention hooks
  - LP rewards (if funded by treasury) as liquidity growth lever

### Phase 2 - External Convertibility (Uniswap v4 CCA via liquidity-launcher)
Goal: open controlled convertibility using a continuous clearing auction and external DEX liquidity.

- [ ] Integrate Uniswap v4 liquidity-launcher (CCA):
  - deploy on testnet, run dry run, and validate clearing logic
  - set auction parameters (duration, tranches, caps, allowlist policy)
  - define minimum raise threshold and fallback plan
  - seed Uniswap v4 pool at clearing price with raised stable + RNG
- [ ] Implement auction bonus + recovery pool:
  - BOGO bonus distribution tied to CCA receipts + Phase 1 freeroll credits
  - recovery pool accounting to retire up to 10m USDT in vUSDT debt
- [ ] Implement bridge service + UI:
  - convertibility policy toggles for phased opening
- [ ] Contract security plan:
  - audits, monitoring, incident response, and pause controls

## Marketing + Growth (Simulation-First)
- [ ] Weekly leagues + streamer tournaments with public leaderboards.
- [ ] Seasonal campaigns and retention rewards (cosmetic + status perks).
- [ ] Referral program tied to proof-of-play (anti-sybil).
- [ ] Pre-Phase 2 CCA testnet simulations + auction awareness campaigns.

## Legal + Governance
Goal: establish a DAO-compatible legal wrapper and governance path for a
staker-owned economy.

- [ ] Form a legal entity for the DAO-style economy:
  - retain counsel and a registered agent
  - file formation/qualification documents in the chosen jurisdiction
  - adopt an operating agreement/DAO charter (governance + treasury rules)
  - define member/staker rights and voting procedures
  - confirm tax posture and reporting obligations (annual filings)
- [ ] Governance setup:
  - initial multisig for treasury and LP NFT custody
  - transition plan from multisig to staker governance
  - compliance policy for auctions, swaps, and rewards distribution
- [ ] Gaming compliance:
  - jurisdictional analysis and geo-fencing plan
  - responsible gaming policy and age checks

## Go-Live Workstreams (Merged from `golive.md`)

### Infrastructure & Deployment
- [ ] Deploy Auth.js service and Convex backend with persistent storage + backups.
- [ ] Add Infrastructure-as-Code (Terraform/Pulumi) and secrets management (SSM/Vault).

### Scalability & Performance
- [ ] Load test with target concurrency and validate SLOs.

### Auth + Billing (Production)
- [ ] Production secrets + Stripe live key rollout and webhook verification.

### Security, Privacy, Compliance
- [ ] Compliance implementation: KYC/AML and responsible gaming controls if required.

### Observability & Operations
- [ ] Deploy metrics/log aggregation + alerting in staging/prod.

### Testing, QA, Release Management
- [ ] Staging environment with production-like traffic.

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
- [ ] Set `CASINO_ADMIN_PUBLIC_KEY_HEX` for simulator/validators and `CASINO_ADMIN_PRIVATE_KEY_FILE` for Auth service.
- [ ] Configure Stripe webhook endpoint to Convex HTTP action and verify signature.
- [ ] Set simulator allowlists (`ALLOWED_HTTP_ORIGINS`, `ALLOWED_WS_ORIGINS`) and origin exemptions if needed.
- [ ] Configure simulator explorer persistence (use `--explorer-persistence-url` for Postgres shared storage).
- [ ] If Postgres uses a hostname or public IP, set `EXPLORER_PERSISTENCE_ALLOW_HOSTNAME=1` or `EXPLORER_PERSISTENCE_ALLOW_PUBLIC=1` as needed.
- [ ] Provision secrets management and backups for Convex and chain state.

## Exit Criteria
- [ ] All P0/P1 items resolved and regression tested.
- [ ] Load test passes with target concurrency and SLOs.
- [ ] Security review complete and webhook/billing flows verified.
