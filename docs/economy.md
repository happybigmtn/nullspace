# Economy Design: Phase 1 Island -> Phase 2 Convertibility

This document defines the Phase 1 and Phase 2 economic systems, with explicit
capital controls in Phase 1 and external convertibility in Phase 2. It is
grounded in the current codebase primitives and highlights the gaps needed to
complete the vision.

Related references:
- `liquidity.md` (existing liquidity and token distribution roadmap)
- `types/src/casino/constants.rs` (emissions and default parameters)
- `types/src/casino/economy.rs` (House, Vault, AMM state)
- `execution/src/layer/handlers/liquidity.rs` (AMM + vault execution)
- `execution/src/layer/handlers/staking.rs` (staking rewards)
- `execution/src/layer/handlers/casino.rs` (freerolls, faucet, tournaments)

## Objectives
- Build a real player base and a functioning domestic economy before any
  external convertibility.
- Defend against sybil farming and "down only" price dynamics.
- Create a credible, auditable price discovery process before Uniswap launch.
- Make Phase 2 convertibility sustainable and aligned with long-term staking
  rewards (real USDT distribution).
- Retire up to 20m USDT of vUSDT debt via Phase 2 recovery pool proceeds.

## Current Primitive Inventory (codebase reality)
- RNG (internal): `Player.balances.chips`
- Freeroll credits: tracked separately from RNG (non-transferable credits with
  vesting + expiry).
- vUSDT (internal stable): `Player.balances.vusdt_balance`
- AMM (RNG/vUSDT): CPMM with fee + sell tax
- Vault/CDP: borrow vUSDT against RNG collateral (tiered 30-45% LTV)
- Staking: stake RNG (chips) for voting power; epoch rewards from positive
  `HouseState.net_pnl`
- House accounting: `net_pnl`, `accumulated_fees`, `total_burned`, `total_issuance`
- Savings pool: deposit vUSDT to earn stability fee distribution.
- Freeroll emissions: capped at 15% of total supply with Phase 2 auction gating.
- Freeroll credit ledger: implemented (separate balance with vesting + expiry).

## Threat Model
- Sybil farming: many accounts maximize freerolls and internal rewards.
- "Down only" price: once external trading opens, early farmers dump.
- vUSDT instability: no interest or liquidations means long-term debt risk.
- AMM manipulation: low liquidity + no guards can distort price signals.
- Debt spiral: cheap leverage + no debt ceiling can amplify volatility.

## Phase 1 (Year 1) - Island Economy With Capital Controls
Goal: build a self-contained economy that users engage with for utility and
status, not immediate cash-out.

### Capital Controls (hard rules)
- No external transfer or bridge in Phase 1.
- RNG/vUSDT are internal-only balances.
- Limits on daily net sell and swap notional.
- Convertibility caps tied to account age, stake, or activity history.

### Monetary Policy Framework
Sources (emissions):
- Freeroll credits (up to 15% of supply) tracked in Phase 1; non-transferable
  and redeemable only through Phase 2 auction participation (BOGO bonus).
- Credits should be activity-bound (expire after prolonged inactivity) to
  reduce farmed balance hoarding.
- Credits are internal reward points; they do not increase transferable RNG
  supply until redeemed in Phase 2.
- Optional incentive pools (LP rewards) funded by treasury only.
- Membership perks increase opportunity, not direct minting.

Sinks (removing RNG from circulation):
- House edge on games (net PnL).
- AMM sell tax burn.
- Vault stability fee (new).
- Fees for optional premium services or cosmetics (future).

Stability (vUSDT):
- Introduce stability fee on vUSDT debt.
- Add liquidation mechanics for LTV breaches.
- Define oracle policy (AMM spot + guardrails).

### Concrete Parameter Proposals (initial values)
These are starting values for Phase 1. All should be configurable and
governed by admin policy with a clear audit log.

Emissions and rewards:
- Freeroll credits: target `ANNUAL_EMISSION_RATE_BPS=300` and
  `REWARD_POOL_BPS=1500` (15% cap); credits convert to bonus RNG only via
  Phase 2 auction participation.
- Credits are usable for internal tournaments/rewards but are non-transferable
  and excluded from external convertibility until Phase 2.
- Credit expiry: credits decay to 0 after 180 days of inactivity.
- Membership perk: 10 freerolls/day; require account age >= 7 days to unlock
  full 10 (else cap at 3/day for the first week).
- Reward vesting: 20% immediate, 80% linear over 180 days (per account).
- Stake bonus for retention: +10% freeroll weight for accounts staking >= 30 days.

AMM controls (RNG/vUSDT):
- Base fee: 0.30% (existing).
- Dynamic sell tax: 3% to 10% based on 7-day net outflow vs pool TVL.
  - <1% net outflow: 3%
  - 1-5% net outflow: 5% (current default)
  - >5% net outflow: 7-10% (stepped)
- Per-account net sell cap: min(3% of account RNG balance, 0.15% of pool TVL) per day.
- Per-account net buy cap: min(6% of account RNG balance, 0.30% of pool TVL) per day.

Vault/vUSDT (stability):
- Max LTV (borrow limit): 45% for mature stakers, 30% for new accounts
  (<7 days or no stake).
- Liquidation threshold: 60% LTV (liquidate to 45% target).
- Liquidation penalty: 10% (4% to liquidator, 6% to stability pool).
- Stability fee: 8% APR baseline, adjustable 6-14% based on system debt ratio.
- Debt ceiling: total vUSDT debt <= 30% of AMM vUSDT reserves; block new borrows
  when above the ceiling.

Capital control schedule:
- Account age tiers:
  - Tier 0 (<7 days): reduced caps, no LP removal, borrow <= 30% LTV.
  - Tier 1 (7-30 days): standard caps, LP allowed, borrow <= 30% LTV.
  - Tier 2 (30+ days + stake >= 1k RNG): higher caps, borrow <= 45% LTV.
- Convertibility remains disabled in Phase 1 (no bridge).

Down-only mitigation toolkit:
- Reward vesting + account maturity tiers (prevents instant dump behavior).
- Dynamic sell tax tied to net outflows.
- Per-account net sell caps and borrow caps.
- Stability fee + liquidation + debt ceiling to prevent debt spirals.
- Treasury buyback and burn using accumulated fees during severe sell pressure.
- Freeroll credits redeemable only via auction, with bonus vesting in Phase 2.

### Remaining DeFi Gaps (Phase 1)
1) Optional auction bootstrap finalization (if we want a locked closing price for Phase 2).

### Sybil Mitigation Strategy (Phase 1)
Economic controls:
- Progressive reward caps by account age and stake.
- Reward vesting: earned RNG unlocks over time, not immediately.
- Minimum stake requirement for higher freeroll tiers or borrow limits.

Behavioral controls:
- "Proof of play" weighting for freeroll rewards (duration, outcomes, session count).
- Rate-limit high-frequency farm behaviors (faucet, tournament churn).
- Heuristic flags for multi-account patterns (device fingerprint + IP + timing).
- Auction gating: allowlist or proof-of-play requirement for Phase 2 bonuses.

Membership integration:
- Membership increases freeroll opportunities, but does not mint RNG directly.
- High-tier perks require stake lock or activity thresholds.

### Vesting + Account Maturity Tiers
Vesting schedule proposal (Phase 1 rewards):
- Freeroll rewards:
  - 20% immediate, 80% linear over 180 days as credit unlocks.
  - Claim frequency: daily.
- Phase 2 bonus tokens:
  - 0% immediate, 100% linear over 180 days after TGE.
- Staking rewards:
  - Immediate claim but with a 7-day cool-down for large claims (>10k RNG).
- Vault liquidations:
  - Liquidator payout immediate; penalty share to stability pool.

Account maturity tiers (anti-sybil):
- Tier 0: age < 7 days OR no stake OR < 10 sessions played.
- Tier 1: age 7-30 days AND stake >= 100 RNG OR >= 10 sessions played.
- Tier 2: age > 30 days AND stake >= 1k RNG AND >= 50 sessions played.

### Internal Market Health Metrics
Track and publish a dashboard (public or internal):
- Emission vs burn per day and per epoch.
- Gini coefficient / distribution concentration.
- AMM liquidity depth and slippage at fixed sizes.
- vUSDT outstanding debt and liquidation queue health.
- Sybil indicators: suspicious account clusters, repeated patterns.

### Phase 1 Marketing Plan (Simulation-first)
Core message: "Earn and use RNG in a real economy before any external trading."

Channels:
- Weekly league tournaments with public leaderboards.
- Creator-led events (streamer tournaments).
- Transparent on-chain dashboards (issuance, burn, fees).
- Seasonal themes and limited-time in-game rewards.

Positioning:
- Emphasize skill + participation, not airdrops.
- Make it clear Phase 1 is a closed economy.
- Showcase internal DeFi (swap/borrow/stake) as gameplay depth.

### Phase 1 Marketing Execution Plan (12 months)
Months 0-2 (Foundations):
- Launch "Season 0" closed economy announcement.
- Publish transparent emission/fee dashboards.
- Run weekly tournaments with visible leaderboards.

Months 3-6 (Growth):
- Creator-led events and community leagues.
- Release staking dashboards and LP incentives.
- Introduce referral program tied to proof-of-play (avoid pure invite farming).

Months 7-10 (Retention):
- Seasonal resets with cosmetic rewards.
- Highlight economic milestones (burn milestones, fee distributions).
- Publish quarterly economic reports.

Months 11-12 (Pre-convertibility):
- Announce Phase 2 auction plan and timeline.
- Run testnet CCA simulations and publish results.
- Start KYC or allowlist strategy if required for auction compliance.

Channels and content playbook:
- Weekly "economy report" thread (issuance, burns, fees, liquidity depth).
- Streamer spotlight tournaments (sponsorship budget, prize boosts).
- "RNG Insider" newsletter (season recaps + roadmap milestones).
- Transparent anti-sybil policy (publish rules and enforcement stats).

KPIs:
- DAU/WAU, tournament participation, retention (D7/D30).
- Swap/borrow/LP conversion rates.
- Distribution metrics (top 1% share of supply).
- Sybil flags per 1k accounts.

## Phase 2 - External Convertibility via Uniswap v4 CCA
Goal: open limited, structured convertibility with a fair price discovery
process and fee flow back to stakers.

### Phase 2 Architecture
1) ERC-20 RNG on EVM (capped supply, treasury controlled).
2) Uniswap v4 liquidity launcher (CCA) as the canonical pool on Ethereum:
   - Auction allocation: 20% of total RNG (raised from 15%).
   - Liquidity reserve: 10% of total RNG.
   - Raised USDT seeds a v4 pool at the CCA clearing price.
3) Convertibility bridge between Commonware and EVM:
   - Lock/mint model with EVM canonical token (Phase 2 decision).
   - Caps, delays, and emergency pause.
4) Freeroll bonus pool (Phase 2 only):
   - Up to 15% of total RNG reserved for a "buy 1, get 1 free" bonus tied to
     successful auction participation.

### Liquidity Launcher CCA Mechanics (summary)
The launcher uses a continuous clearing auction (CCA) for price discovery and
automatically seeds a Uniswap v4 pool at the clearing price. Key mechanics to
plan for (validate against repo before deployment):
- Auction tranches: tokens are released in steps; each step clears at a single
  price based on aggregate bids; tranche sizes should be non-decreasing.
- Bids: participants bid a max price with a spend amount; fills happen at the
  tranche clearing price; partial fills apply at the marginal price.
- Bid withdrawals: typically limited to out-of-range bids to reduce gaming.
- Clearing price: uniform price per step; higher bids fill first; the last
  tranche should be large enough to anchor final price discovery.
- Floor price: minimum price to avoid underselling during the auction.
- Graduation threshold: optional minimum raise requirement to finalize.
- Migration: after the auction, proceeds plus reserved tokens seed the v4
  pool; the pool starts at the final clearing price; unsold tokens roll into
  initial liquidity.
- Liquidity positions: start with full-range liquidity; optional one-sided or
  concentrated positions for leftover balances.
- LP position NFT: the initial v4 position is minted and sent to a designated
  treasury or timelock to prevent liquidity rug risk.
- Token requirements: standard ERC-20; avoid rebasing or fee-on-transfer.

### Aztec-style Launch Lessons (apply to RNG)
- Use a multi-day CCA to avoid sniping and gas wars.
- Set a sensible floor price and large final tranche for robust price
  discovery.
- Consider sybil controls for auction participation (allowlist, proof of
  personhood, or capped bids).
- Seed liquidity with the reserve at clearing price; allocate excess proceeds
  to the recovery pool and balance sheet to reduce systemic risk.
- Publish transparent post-mortems and dashboards around distribution and
  clearing prices.

### Token Allocation Blueprint (Phase 2)
This is a recommended starting point; the exact split should be finalized
after a 12-month snapshot of Phase 1 balances.
- 20% public CCA auction (price discovery + distribution).
- 10% reserved for initial v4 liquidity.
- Up to 15% freeroll bonus pool (BOGO for successful bids).
- 30-40% for player balances and in-game rewards (earned in Phase 1).
- 10-15% for treasury, ops, partnerships, and market-making.
- 5-10% team/investor vesting (time-locked).

Baseline example (totals 100%):
- 20% auction + 10% liquidity + 15% freeroll bonus + 35% players + 15%
  treasury + 5% team/investor.

### Freeroll Bonus Mechanics (Phase 2)
Constraint: a 15% bonus pool cannot fully cover a 20% auction with 1:1
matching for every bidder. We need a deterministic rule:
- Option A (pro-rata): every successful bidder receives a bonus ratio of
  15%/20% = 0.75 RNG per 1 RNG purchased.
- Option B (capped BOGO tranche): only the first 15% of auction sales qualify
  for 1:1; remaining 5% are standard auction purchases.
- Option C (tiered): 1:1 up to a per-wallet cap, pro-rata above the cap.

Recommended: Option A for fairness and to avoid race conditions. If marketing
demands "buy 1, get 1 free," use Option B with clear tranche limits.

Eligibility requirements:
- Only successful CCA bidders who also have Phase 1 freeroll credits.
- Bonus amount capped by each player's accumulated freeroll credits.
- Bonus tokens vest 180 days to reduce immediate dumping.

Auction success criteria:
- Minimum raise threshold must cover liquidity pairing for 10% RNG reserve.
- If the auction fails to sell at least 50% of its allocation, delay
  convertibility and run a second auction window or reduce the liquidity
  reserve proportionally.

### Bridge Architecture (Commonware <-> Ethereum)
Canonical liquidity is on Ethereum; Commonware remains the fast game chain.
Two viable models:
1) Lock/mint (canonical EVM):
   - Players lock RNG on Commonware to mint ERC-20 RNG on Ethereum.
   - Reverse flow burns on EVM and unlocks on Commonware.
2) Burn/mint (canonical Commonware):
   - Commonware RNG is canonical; EVM RNG is wrapped.

Decision (locked for Phase 2): canonical EVM token with Commonware as a wrapped
representation (lock/mint) so Uniswap v4 is the source of price truth.

Bridge rollout options:
- One-time airdrop claim on EVM based on a Phase 1 snapshot.
- Follow-up bridge for ongoing 1:1 conversion.
- Initial bridge can be multisig-controlled with strict limits and monitoring,
  moving toward threshold or light-client validation over time.

### Phase 2 Launch Flow (step-by-step)
1) Finalize token supply and allocation from Phase 1 snapshot.
2) Deploy ERC-20 RNG on Ethereum (no rebasing or transfer-fee behavior).
3) Configure CCA parameters (auction schedule, floor price, bid caps).
4) Run the multi-day CCA auction and publish live dashboards.
5) Migrate to Uniswap v4 pool at final clearing price; lock LP NFT.
6) Fund recovery pool and compute bonus distribution from CCA receipts.
7) Activate bridge and claims for Phase 1 holders.
8) Integrate price oracles (Uniswap TWAP) for in-game risk controls.
9) Update on-chain policy caps to reflect real-world convertibility.

### Auction Proceeds Waterfall + Recovery Pool
Use auction proceeds in a fixed order to keep the launch auditable:
1) Liquidity seeding: allocate USDT equal to the final price of 10% RNG to
   pair with the 10% RNG liquidity reserve.
2) Recovery pool: allocate up to 20,000,000 USDT to retire vUSDT debt or
   undercollateralized vaults.
3) Remainder (if any): split across treasury runway, protocol insurance, and
   optional extra liquidity or buyback/burn.

Recommended default split for remainder:
- 50% treasury runway (ops + compliance + audits).
- 30% protocol insurance reserve (coverage for edge cases and exploits).
- 20% supplemental liquidity or buyback/burn based on volatility.

Debt recovery mechanics:
- One-time or time-bounded program to avoid ongoing moral hazard.
- Eligibility filters: proof-of-play, account age, and stake lock.
- Debt retirements at a haircut (e.g., borrower repays 30-50%) to preserve
  incentives and reduce strategic defaults.
- If recovery pool funding is short of 20m, retire the remainder using
  stability fees + a fixed share of house edge over a defined window.
- Priority order: highest-risk (LTV) positions first, then oldest debt, to
  minimize systemic insolvency.

### Feasibility and Impact Assessment
- BOGO constraint: a 15% bonus pool cannot cover a 20% auction at 1:1 for all
  bidders; choose a deterministic allocation (pro-rata or capped tranche).
- Demand signal: effective price discount for eligible bidders can improve
  participation but increases circulating supply; vesting is required to
  reduce immediate sell pressure.
- BOGO dilution: discount reduces net capital raised; floor price and tranche
  sizing must still cover the 10% liquidity pairing plus recovery pool target.
- Liquidity depth: seeding only the 10% reserve at the clearing price gives a
  strong baseline, but a portion of excess proceeds may be needed if early
  volatility is high.
- Recovery pool: improves solvency and lowers systemic debt before
  convertibility; must be limited in scope to avoid encouraging risky leverage.
- Debt repayment: if total vUSDT debt exceeds 20m USDT, remaining balance
  should be retired via stability fees and treasury buybacks over time.
- Treasury impact: excess proceeds should prioritize balance sheet strength
  and protocol insurance before discretionary spending.
- Auction failure risk: if the minimum raise threshold is not met, delay Phase
  2 convertibility rather than under-seeding liquidity or underfunding debt
  retirement.

### Fee Distribution (USDT to stakers)
Design requirements:
- Swap fees must flow to RNG stakers in USDT.
- Distribution should be on-chain and auditable.
- Treasury custody (LP NFT + fee streams) should live under the DUNA or its
  governance-controlled multisig until staker governance is activated.

Options:
- EVM staking contract receives fees directly (stakers stake EVM RNG).
- Bridge fees back to Commonware, distribute in vUSDT or wrapped USDT.
- Hybrid: allow both EVM and Commonware staking, with mirrored accounting.

### Convertibility Ramp
To prevent immediate dumping:
- Gradual ramp of withdrawal limits.
- Vesting schedule for Phase 1 rewards.
- Initial liquidity depth guarantees (treasury seeded).
- Ongoing buyback and burn using house fees.

### Phase 2 Parameter Proposals (CCA + Pool)
- Auction duration: 10-28 days, daily tranches (6 weeks max if demand is low).
- Allocation: 20% of total RNG supply.
- Liquidity reserve: 10%.
- Freeroll bonus pool: up to 15% (BOGO via pro-rata or capped tranche).
- Minimum raise threshold: >= 50% of auction allocation sold (or explicit
  USDT floor to cover liquidity pairing).
- Floor price: derived from Phase 1 internal economy valuation + buffer.
- Min bid: $25 USDT; max bid per wallet per day: $50k USDT (adjustable).
- Price discovery: CCA clearing price sets initial pool price.
- Pool fee: 0.30% with 100% of swap fees routed to RNG stakers (USDT).
- Convertibility ramp:
  - Month 1: 0.1% of circulating RNG per day max withdraw per address.
  - Month 2: 0.25% per day.
  - Month 3+: 0.5% per day + raised caps for long-term stakers.

## Implementation Steps (Phase 1 -> Phase 2)

Phase 1 (0-12 months)
1) Add treasury + vesting ledger on-chain.
2) Add vUSDT stability fee + liquidation path.
3) Add savings market (vUSDT focus); defer general lending until post-Phase 2.
4) Add risk parameter governance (fee/tax/caps + debt ceiling).
5) Add reward vesting, freeroll credit ledger, and anti-sybil gating.
6) Ship full DeFi UX (swap, borrow, LP, stake, health metrics).
7) Publish economic dashboards and transparency reports.

Phase 2 (convertibility)
8) Canonical RNG domain chosen: EVM canonical with lock/mint bridge; Commonware bridge module + UI + relayer shipped.
9) Build ERC-20 RNG + deploy CCA + v4 liquidity launcher.
10) Implement fee distributor and staking payout (USDT).
11) Launch convertibility with caps and monitoring.
12) Expand liquidity pools to additional venues as needed.

## Codebase Remediation Plan (Implement 1-3 Above)

### Phase 1 Remediation (domestic DeFi + sybil controls)
1) Add economic policy state:
   - New `PolicyState` stored on-chain with fee bands, caps, LTV thresholds.
   - Files: `types/src/casino/economy.rs`, `types/src/execution.rs`
   - New admin instruction to update policy parameters.
   - Update defaults in `types/src/casino/constants.rs`.
2) Add stability fee + interest accrual:
   - Extend `Vault` with `debt_index` and `last_accrual_ts`.
   - Add `accrue_debt()` helper in `execution/src/layer/handlers/liquidity.rs`.
   - Introduce `StabilityFeeAccrued` event.
   - Add tests for debt accrual edge cases and rounding.
3) Add liquidations:
   - Add instruction `LiquidateVault { target }`.
   - Implement partial liquidation to target LTV (45%).
   - Add `VaultLiquidated` event (penalty split + pool updates).
   - Add oracle guardrails (EWMA price + bootstrap clamps).
4) Add savings market (vUSDT):
   - New `SavingsAccount` state keyed by player.
   - Instructions: `DepositSavings`, `WithdrawSavings`, `ClaimSavingsYield`.
   - Yield funded by stability fees + portion of AMM fees.
5) Add vesting ledger for rewards:
   - New `VestingAccount` (per-player) with unlock schedule.
   - Freeroll and staking rewards mint into vesting by default.
   - New `ClaimVested` instruction and `RewardsVested` event.
   - Integrate vesting checks in `execution/src/layer/handlers/casino.rs`.
6) Add freeroll credit ledger and auction eligibility:
   - Track Phase 1 freeroll credits (non-transferable).
   - Enforce 15% global cap and per-account limits.
   - Record eligible bonus amount for Phase 2 BOGO claims.
7) Add sybil controls in execution layer:
   - Track account age, session count, and stake.
   - Enforce caps in `handle_swap`, `handle_borrow_usdt`, `handle_casino_join_tournament`.
8) UI updates:
   - Add savings panel and vesting view.
   - Show dynamic caps, LTV health, interest rate, and penalties.
   - Update `website/src/EconomyApp.tsx` + related panels.
   - Add policy warnings and maturity tier status in the UI.
9) Metrics + dashboards:
   - Emit events for all economic actions.
   - Update simulator indexer to expose treasury, vesting, and savings metrics.
   - Add metrics for liquidation counts, debt ratio, and vesting unlock rate.

### Phase 2 Remediation (convertibility + fee distribution)
9) EVM contracts (new repo or `evm/` workspace):
   - ERC-20 RNG + CCA contracts + v4 liquidity launcher integration.
10) Fee distribution contract:
    - Route Uniswap v4 fees to stakers (USDT).
11) Bridge + policy toggles:
    - Lock/mint or burn/mint, with caps and delays.
    - Add emergency pause and monitoring hooks.
12) Auction bonus + recovery pool plumbing:
    - BOGO claim contract keyed to CCA receipts and freeroll credits.
    - Recovery pool accounting and debt retirement tooling.

## Executive Decisions (Locked)
- Canonical RNG domain: EVM canonical, Commonware wraps.
- Reward vesting: 20% immediate, 80% linear over 180 days; Phase 2 bonus vests
  100% over 180 days.
- vUSDT stability policy: 8% APR baseline, 6-14% band; 60% liquidation
  threshold, 45% target, 10% penalty.
- Staking payout location: EVM-only USDT distribution (bridge required).
- Governance model: multisig in Phase 1/early Phase 2, transition to staker
  governance post-audit.
- BOGO allocation: pro-rata (0.75 bonus per 1 RNG purchased).
- Recovery pool remainder: 50% treasury, 30% insurance, 20% supplemental
  liquidity/buyback.
