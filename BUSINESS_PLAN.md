# Null/Space Business Strategy

## Executive Summary
Null/Space is building a self-contained casino + DeFi economy that matures
inside a closed system (Phase 1) before opening to external convertibility
through a Uniswap v4 continuous clearing auction (Phase 2). The strategy is
to grow a real player base and stable internal markets first, then allow
controlled on/off-ramping once economic primitives are proven under load.

The end-state objective (Phase 2) is an economy that is 100% owned by RNG
stakers: all protocol revenues flow to stakers, and treasury operations are
governed by stakers.

## Vision
Build the most resilient, playable crypto-native economy by:
- Proving the economy in an "island mode" before external trading.
- Rewarding participation and retention rather than airdrop farming.
- Routing all long-term cash flows to stakers.

## Product Overview
Core loops:
- Casino games + freerolls (engagement and emissions).
- Internal DeFi: AMM (RNG/vUSDT), vaults, staking, and liquidity.
- Membership tier for expanded freeroll access and retention.

Internal assets:
- RNG (chips): internal unit of account and staking asset.
- vUSDT: internal stable balance for swap/borrow/lend.

## Phased Strategy

### Phase 1 (Year 1): Island Economy + Capital Controls
Goals:
- Grow player base and retention.
- Stress test AMM, vaults, and staking under real usage.
- Prevent early extraction and "down only" dumping.

Key design pillars:
- Capital controls (no external bridge; internal-only balances).
- Reward vesting and account maturity tiers.
- Dynamic fees/taxes and strict swap/borrow caps.
- Full internal DeFi suite + transparent economic dashboards.

### Phase 2: Convertibility + Staker Ownership
Goals:
- Launch RNG on EVM via Uniswap v4 liquidity launcher (CCA).
- Open on/off-ramp with caps and phased ramp-up.
- Distribute 100% of swap fees and protocol revenue to stakers (USDT).

Key design pillars:
- ERC-20 RNG + CCA auction + v4 liquidity pool.
- 20% auction allocation + 10% liquidity reserve.
- Up to 15% bonus supply for successful bidders (freeroll BOGO).
- Bridge policy with caps, delays, and emergency pause.
- USDT fee distribution contract for stakers.
- Staker-governed treasury and operations.

## Revenue Model (Maximize System Revenues)
Primary revenue sources:
- House edge on casino games (net PnL).
- AMM fees and dynamic sell tax.
- Stability fees on vUSDT debt.
- Optional membership subscriptions.

Distribution (Phase 2):
- 100% of net protocol revenues routed to RNG stakers.
- Treasury funding for operations is governed by stakers.

## Token Economy Strategy
See `economy.md` and `liquidity.md` for full parameters and allocation design.

Key mechanics:
- Emissions: freeroll credits capped at 15% of supply, redeemed only via
  Phase 2 auction participation (BOGO bonus).
- Sinks: house edge, sell tax burn, stability fees.
- Anti-sybil: vesting schedules, account maturity gating, proof-of-play rules.
- vUSDT stability: interest accrual, liquidation mechanics, and guardrails.

Phase 2 proceeds policy:
- Seed v4 liquidity with proceeds equal to 10% RNG at the clearing price.
- Fund a 20m USDT recovery pool to retire vUSDT debt or bad positions.
- Allocate any remaining proceeds to treasury runway, insurance, and optional
  supplemental liquidity (governance decides).

## Marketing Strategy (Simulation-First)
Phase 1:
- Weekly leagues + leaderboards + streamer events.
- Transparent economic reporting (issuance, burn, fees, liquidity).
- Seasonal campaigns and retention rewards.

Phase 2:
- Auction awareness campaigns.
- Testnet CCA simulations and public results.
- Convertibility ramps and fee distribution transparency.

## Operations and Scaling
Technical plan and infra sizing live in `plan.md` and `golive.md`.
Scale targets are prioritized around simulator/indexer throughput, WebSocket
fanout, and Convex-backed auth/billing.

## Legal Structure (Wyoming DUNA)
We will form a Wyoming Decentralized Unincorporated Nonprofit Association
(DUNA) as the legal wrapper for the DAO-style economy. This enables a
staker-governed entity to hold treasury assets, manage contracts, and define
member rights. Formation details and compliance steps live in `plan.md`.

## Risk and Compliance
Primary risks:
- Sybil farming and supply concentration.
- vUSDT instability and AMM manipulation.
- Regulatory uncertainty for convertibility and gaming.

Mitigations:
- Capital controls, vesting, and account maturity tiers.
- Liquidations and stability fees.
- Compliance planning and security controls.

## KPIs
- DAU/WAU and D7/D30 retention.
- Swap/borrow/LP conversion rates.
- Distribution concentration (top 1% share).
- Fee revenue per active user.
- Sybil flags per 1k accounts.

## References (Authoritative)
- Roadmap + delivery plan: `plan.md`
- Economic design + parameters: `economy.md`
- Liquidity + allocation roadmap: `liquidity.md`
- Production readiness: `golive.md`
- Security disclosure: `SECURITY.md`
