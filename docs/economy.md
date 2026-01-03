# Economy Design: Testnet → Token Launch → Rolling CCAs

This document defines the pre-token launch window (testnet → end of the first CCA) and the
rolling CCA program (10 auctions over 30 months). It is grounded in current codebase
primitives and highlights the gaps needed to complete the vision.

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
- Make convertibility sustainable and aligned with long-term staking
  rewards (real USDT distribution).
- Retire up to 10m USDT of vUSDT debt via a recovery pool funded by 80% of sell
  tax (CCA program target: 10% on RNG sales), with 20% routed to the
  operating budget; after the 10m threshold, 80% of sell tax flows to RNG
  stakers.

## Timeline
- Testnet launch (T0).
- First CCA starts at T0 + 3 months and runs ~1 month.
- Token launch occurs at the end of the first CCA period.
- Remaining 9 CCAs run quarterly; total program length is 30 months.

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
- Freeroll emissions: capped to support up to 25% bonus supply across the 10-CCA program (2.5% per auction).
- Freeroll credit ledger: implemented (separate balance with vesting + expiry).

## Threat Model

- Sybil farming: many accounts maximize freerolls and internal rewards.
- "Down only" price: once external trading opens, early farmers dump.
- vUSDT instability: no interest or liquidations means long-term debt risk.
- AMM manipulation: low liquidity + no guards can distort price signals.
- Debt spiral: cheap leverage + no debt ceiling can amplify volatility.

## Pre-token Launch Window (Testnet → Token Launch)

Build a self-contained economy that users engage with for utility and status,
not immediate cash-out.

### Capital Controls (hard rules)

- No external transfer or bridge before token launch.
- RNG/vUSDT are internal-only balances.
- Limits on daily net sell and swap notional.
- Convertibility caps tied to account age, stake, or activity history.

### Monetary Policy Framework

Sources (emissions):

- Freeroll credits (up to 25% of supply across the program) tracked pre-token launch;
  non-transferable and redeemable only through CCA participation (BOGO bonus).
- Credits are internal reward points; they do not increase transferable RNG
  supply until redeemed in the CCA program.
- Optional incentive pools (LP rewards) funded by treasury only.
- Membership perks increase opportunity, not direct minting.

Sinks (removing RNG from circulation):

- House edge on games (net PnL).
- AMM sell tax split: 80% to the recovery pool until $10m, 20% to operating
  budget; after the threshold, 80% to RNG stakers and 20% to operating budget.
- AMM buy tax: 10% during the CCA program (to encourage CCA bidding).
- Vault stability fee (new).
- Fees for optional premium services or cosmetics (future).

Stability (vUSDT):

- Introduce stability fee on vUSDT debt.
- Add liquidation mechanics for LTV breaches.
- Define oracle policy (AMM spot + guardrails).

### Concrete Parameter Proposals (initial values)

These are starting values for the pre-token launch window. All should be configurable and
governed by admin policy with a clear audit log.

Emissions and rewards:

- Freeroll credits: target `ANNUAL_EMISSION_RATE_BPS=300` and
  `REWARD_POOL_BPS=1500` (cap should be revisited to support the 25% bonus program);
  credits convert to bonus RNG only via CCA participation.
- Credits are usable for internal tournaments/rewards but are non-transferable
  and excluded from external convertibility until token launch.
- Credit expiry: credits decay to 0 after 180 days of inactivity.
- Membership perk: 10 freerolls/day; require account age >= 7 days to unlock
  full 10 (else cap at 3/day for the first week).
- Reward vesting: 0% immediate, 100% continuous over 30 months (per account).
- Stake bonus for retention: +10% freeroll weight for accounts staking >= 30 days.

AMM controls (RNG/vUSDT):

- Base fee: 0.30% (existing).
- Buy tax: 10% on RNG buys via the AMM during the CCA program (encourages CCA bidding).
- Dynamic sell tax: 3% to 10% based on 7-day net outflow vs pool TVL
  (pre-token launch); CCA program sets a fixed 10% sell tax split 80% to the recovery pool until
  $10m (then 80% to RNG stakers), with 20% to operating budget.
  - <1% net outflow: 3%
  - 1-5% net outflow: 5% (current default)
  - > 5% net outflow: 7-10% (stepped)
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
- Convertibility remains disabled before token launch (no bridge).

Down-only mitigation toolkit:

- Reward vesting + account maturity tiers (prevents instant dump behavior).
- Dynamic sell tax tied to net outflows.
- Per-account net sell caps and borrow caps.
- Stability fee + liquidation + debt ceiling to prevent debt spirals.
- Treasury buyback and burn using accumulated fees during severe sell pressure.
- Freeroll credits redeemable only via auction, with bonus vesting over a continuous
  3-month schedule.

### Testnet Policy Checkpoint (5k concurrent target)
Adopt current code defaults as the baseline for testnet and re-evaluate after
telemetry and abuse review:

Faucet + onboarding:
- `FAUCET_AMOUNT=1000`
- `FAUCET_MIN_ACCOUNT_AGE_SECS=86400` (24h)
- `FAUCET_MIN_SESSIONS=3`
- `FAUCET_RATE_LIMIT=100` (daily faucet claims per account)

Freerolls + tournaments:
- `FREEROLL_DAILY_LIMIT_FREE=1`
- `FREEROLL_DAILY_LIMIT_TRIAL=3`
- `FREEROLL_DAILY_LIMIT_MEMBER=10`
- `TOURNAMENT_JOIN_COOLDOWN_SECS=300`
- `TOURNAMENTS_PER_DAY=240` (one every 6 minutes)
- `TOURNAMENT_DURATION_SECS=300` (5 minutes)

Freeroll credits:
- `FREEROLL_CREDIT_IMMEDIATE_BPS=2000` (20% immediate)
- `FREEROLL_CREDIT_VEST_SECS=180 days`
- `FREEROLL_CREDIT_EXPIRY_SECS=180 days`

Revisit these parameters after 1-2 weeks of testnet telemetry and any abuse
investigations.

### Remaining DeFi Gaps (pre-token launch window)

1. Optional auction bootstrap finalization (if we want a locked closing price for token launch).

### Sybil Mitigation Strategy (pre-token launch window)

Economic controls:

- Progressive reward caps by account age and stake.
- Reward vesting: earned RNG unlocks over time, not immediately.
- Minimum stake requirement for higher freeroll tiers or borrow limits.

Behavioral controls:

- "Proof of play" weighting for freeroll rewards (duration, outcomes, session count).
- Rate-limit high-frequency farm behaviors (faucet, tournament churn).
- Heuristic flags for multi-account patterns (device fingerprint + IP + timing).
- Auction gating: allowlist or proof-of-play requirement for CCA bonuses.

Membership integration:

- Membership increases freeroll opportunities, but does not mint RNG directly.
- High-tier perks require stake lock or activity thresholds.

### Vesting + Account Maturity Tiers

Vesting schedule proposal (pre-token launch rewards):

- Freeroll rewards:
  - 0% immediate, 100% continuous over 30 months as credit unlocks.
  - Claim frequency: daily.
- CCA bonus tokens:
  - 0% immediate, 100% continuous vest over 3 months after TGE.
- Staking rewards:
  - 0% immediate, 100% continuous over 30 months (same schedule as freeroll rewards).
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

### Marketing Plan (Simulation-first)

Core message: "Earn and use RNG in a real economy before any external trading."

Channels:

- Weekly league tournaments with public leaderboards.
- Creator-led events (streamer tournaments).
- Transparent on-chain dashboards (issuance, burn, fees).
- Seasonal themes and limited-time in-game rewards.

Positioning:

- Emphasize skill + participation, not airdrops.
- Make it clear the pre-token launch window is a closed economy.
- Showcase internal DeFi (swap/borrow/stake) as gameplay depth.

### Marketing Execution Plan (Months 0–12)

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

- Announce the CCA program auction plan and timeline.
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

## Token Launch + Rolling CCAs (External Convertibility)

Open limited, structured convertibility with fair price discovery and fee
flow back to stakers.

### CCA Program Architecture

1. ERC-20 RNG on EVM (capped supply, treasury controlled).
2. Uniswap v4 liquidity launcher (CCA) as the canonical pool on Ethereum:
   - Quarterly CCAs (10 total); first auction 3 months after testnet launch; each auction sells 2.5% of total supply.
   - Up to 2.5% additional supply per auction via freeroll BOGO credits.
   - Raised USDT seeds a v4 pool at the CCA clearing price (100% of proceeds).
   - RNG liquidity reserve for the pool is sourced from the developer-controlled allocation.
3. Convertibility bridge between Commonware and EVM:
   - Lock/mint model with EVM canonical token (token launch decision).
   - Caps, delays, and emergency pause.
4. Freeroll bonus pool (CCA program only):
   - Up to 2.5% of total RNG per auction reserved for a "buy 1, get 1 free" bonus;
     unclaimed bonus supply rolls into a treasury reserve.

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

- Use a longer CCA window (quarterly cadence) to avoid sniping and gas wars.
- Set a sensible floor price and large final tranche for robust price
  discovery.
- Consider sybil controls for auction participation (allowlist, proof of
  personhood, or capped bids).
- Seed liquidity with the reserve at clearing price; direct 100% of auction
  proceeds into the v4 pool and fund the recovery pool via 80% of sell tax
  until $10m (then 80% to RNG stakers), with 20% to operating budget.
- Publish transparent post-mortems and dashboards around distribution and
  clearing prices.

### Token Allocation Blueprint (CCA program)

Updated distribution program for the CCA program.

- 25% base auction supply across 10 quarterly CCAs (2.5% of total supply per auction).
- Up to 25% bonus supply via freeroll BOGO credits (up to 2.5% per auction); unclaimed bonus
  supply rolls into a treasury reserve.
- 50% developer-controlled supply (treasury/ops/liquidity/partnerships/insurance), which also
  sources RNG liquidity reserves for the v4 pool.

### Freeroll Bonus Mechanics (CCA program)

BOGO is 1:1 up to each bidder's available freeroll credits and the per-auction bonus cap.

Eligibility requirements:

- Only successful CCA bidders who also have pre-token launch freeroll credits.
- Bonus amount capped by each player's accumulated freeroll credits.
- Bonus tokens vest continuously over 3 months to reduce immediate dumping.

Auction success criteria:

- Minimum raise threshold must cover liquidity pairing for 10% RNG reserve.
- If an auction fails to clear its 2.5% allocation, roll the remainder into
  the next scheduled auction or return it to the developer-controlled reserve.

### Bridge Architecture (Commonware <-> Ethereum)

Canonical liquidity is on Ethereum; Commonware remains the fast game chain.
Two viable models:

1. Lock/mint (canonical EVM):
   - Players lock RNG on Commonware to mint ERC-20 RNG on Ethereum.
   - Reverse flow burns on EVM and unlocks on Commonware.
2. Burn/mint (canonical Commonware):
   - Commonware RNG is canonical; EVM RNG is wrapped.

Decision (locked for CCA program): canonical EVM token with Commonware as a wrapped
representation (lock/mint) so Uniswap v4 is the source of price truth.

Bridge rollout options:

- One-time airdrop claim on EVM based on a pre-token launch snapshot.
- Follow-up bridge for ongoing 1:1 conversion.
- Initial bridge can be multisig-controlled with strict limits and monitoring,
  moving toward threshold or light-client validation over time.

### CCA Launch Flow (step-by-step)

1. Finalize token supply and allocation from the pre-token launch snapshot.
2. Deploy ERC-20 RNG on Ethereum (no rebasing or transfer-fee behavior).
3. Configure CCA parameters (auction schedule, floor price, bid caps).
4. Run each CCA auction (quarterly cadence, starting 3 months after testnet launch) and publish live dashboards.
5. Migrate to Uniswap v4 pool at final clearing price; lock LP NFT.
6. Fund recovery pool via 80% of sell tax (CCA program fixed 10%) and compute bonus distribution from CCA receipts.
7. Activate bridge and claims for pre-token launch holders.
8. Integrate price oracles (Uniswap TWAP) for in-game risk controls.
9. Update on-chain policy caps to reflect real-world convertibility.

### Auction Proceeds + Recovery Pool Funding

- Auction proceeds: 100% of USDT raised in the CCA is paired with an RNG
  liquidity reserve sourced from the developer-controlled allocation and
  locked in the v4 pool.
- Recovery pool: funded by 80% of the sell tax (CCA program fixed 10% on RNG
  sales) until the 10,000,000 USDT target is reached; 20% goes to operating
  budget. After the threshold, 80% of sell tax goes to RNG stakers and 20%
  continues to the operating budget.

Debt recovery mechanics:

- One-time or time-bounded program to avoid ongoing moral hazard.
- Eligibility filters: proof-of-play, account age, and stake lock.
- Debt retirements at a haircut (e.g., borrower repays 30-50%) to preserve
  incentives and reduce strategic defaults.
- If recovery pool funding is short of 10m, retire the remainder using
  stability fees + a fixed share of house edge over a defined window.
- Priority order: highest-risk (LTV) positions first, then oldest debt, to
  minimize systemic insolvency.

### Feasibility and Impact Assessment

- BOGO constraint: per-auction bonus supply is capped at 2.5% of total supply;
  unclaimed bonus rolls into the treasury reserve.
- Demand signal: effective price discount for eligible bidders can improve
  participation but increases circulating supply; vesting is required to
  reduce immediate sell pressure.
- BOGO dilution: discount reduces net capital raised; floor price and tranche
  sizing must still cover the per-auction liquidity pairing.
- Liquidity depth: pairing the 10% RNG reserve with 100% of auction proceeds
  provides the baseline; supplemental liquidity or buyback may still be needed
  during early volatility.
- Recovery pool: improves solvency and lowers systemic debt before
  convertibility; must be limited in scope to avoid encouraging risky leverage.
- Debt repayment: if total vUSDT debt exceeds 10m USDT, remaining balance
  should be retired via stability fees and treasury buybacks over time.
- Treasury impact: with auction proceeds locked as liquidity, operating budget
  relies on ongoing revenues, including 20% of sell tax plus house edge and
  stability fees.
- Auction failure risk: if the minimum raise threshold is not met, delay Phase
  2 convertibility rather than under-seeding liquidity or underfunding debt
  retirement.

### Fee Distribution (USDT to stakers)

Design requirements:

- Swap fees must flow to RNG stakers in USDT.
- Distribution should be on-chain and auditable.
- Treasury custody (LP NFT + fee streams) should live under the legal entity or its
  governance-controlled multisig until staker governance is activated.

Options:

- EVM staking contract receives fees directly (stakers stake EVM RNG).
- Bridge fees back to Commonware, distribute in vUSDT or wrapped USDT.
- Hybrid: allow both EVM and Commonware staking, with mirrored accounting.

### Convertibility Ramp

To prevent immediate dumping:

- Gradual ramp of withdrawal limits.
- Vesting schedule for pre-token launch rewards.
- Initial liquidity depth guarantees (treasury seeded).
- Ongoing buyback and burn using house fees.

### CCA Program Parameters (CCA + Pool)

- Auction duration: set per-auction window on a quarterly cadence (10 auctions total, starting 3 months after testnet).
- Allocation: 2.5% of total supply per auction (25% base across 10 auctions).
- Liquidity reserve: sourced from the developer-controlled allocation (sizing
  set per auction).
- Freeroll bonus pool: up to 2.5% per auction (25% max across the program).
- Minimum raise threshold: >= 50% of auction allocation sold (or explicit
  USDT floor to cover liquidity pairing).
- Floor price: derived from pre-token launch internal economy valuation + buffer.
- Min bid: $25 USDT; max bid per wallet per day: $50k USDT (adjustable).
- Price discovery: CCA clearing price sets initial pool price.
- Pool fee: 0.30% with 100% of swap fees routed to RNG stakers (USDT).
- Convertibility ramp:
  - Month 1: 0.1% of circulating RNG per day max withdraw per address.
  - Month 2: 0.25% per day.
  - Month 3+: 0.5% per day + raised caps for long-term stakers.

## Implementation Steps (Testnet → Token Launch → CCA Program)

Pre-token launch window (testnet → end of first CCA)
1. Add treasury + vesting ledger on-chain.
2. Add vUSDT stability fee + liquidation path.
3. Add savings market (vUSDT focus); defer general lending until post-CCA program.
4. Add risk parameter governance (fee/tax/caps + debt ceiling).
5. Add reward vesting, freeroll credit ledger, and anti-sybil gating.
6. Ship full DeFi UX (swap, borrow, LP, stake, health metrics).
7. Publish economic dashboards and transparency reports.

CCA program (convertibility)
8. Canonical RNG domain chosen: EVM canonical with lock/mint bridge; Commonware bridge module + UI + relayer shipped.
9. Build ERC-20 RNG + deploy CCA + v4 liquidity launcher.
10. Implement fee distributor and staking payout (USDT).
11. Launch convertibility with caps and monitoring.
12. Expand liquidity pools to additional venues as needed.

## Codebase Remediation Plan (Implement 1-3 Above)

### Pre-token Launch Remediation (domestic DeFi + sybil controls)

1. Add economic policy state:
   - New `PolicyState` stored on-chain with fee bands, caps, LTV thresholds.
   - Files: `types/src/casino/economy.rs`, `types/src/execution.rs`
   - New admin instruction to update policy parameters.
   - Update defaults in `types/src/casino/constants.rs`.
2. Add stability fee + interest accrual:
   - Extend `Vault` with `debt_index` and `last_accrual_ts`.
   - Add `accrue_debt()` helper in `execution/src/layer/handlers/liquidity.rs`.
   - Introduce `StabilityFeeAccrued` event.
   - Add tests for debt accrual edge cases and rounding.
3. Add liquidations:
   - Add instruction `LiquidateVault { target }`.
   - Implement partial liquidation to target LTV (45%).
   - Add `VaultLiquidated` event (penalty split + pool updates).
   - Add oracle guardrails (EWMA price + bootstrap clamps).
4. Add savings market (vUSDT):
   - New `SavingsAccount` state keyed by player.
   - Instructions: `DepositSavings`, `WithdrawSavings`, `ClaimSavingsYield`.
   - Yield funded by stability fees + portion of AMM fees.
5. Add vesting ledger for rewards:
   - New `VestingAccount` (per-player) with unlock schedule.
   - Freeroll and staking rewards mint into vesting by default.
   - New `ClaimVested` instruction and `RewardsVested` event.
   - Integrate vesting checks in `execution/src/layer/handlers/casino.rs`.
6. Add freeroll credit ledger and auction eligibility:
   - Track pre-token launch freeroll credits (non-transferable).
   - Enforce 25% global cap and per-account limits.
   - Record eligible bonus amount for CCA BOGO claims.
7. Add sybil controls in execution layer:
   - Track account age, session count, and stake.
   - Enforce caps in `handle_swap`, `handle_borrow_usdt`, `handle_casino_join_tournament`.
8. UI updates:
   - Add savings panel and vesting view.
   - Show dynamic caps, LTV health, interest rate, and penalties.
   - Update `website/src/EconomyApp.tsx` + related panels.
   - Add policy warnings and maturity tier status in the UI.
9. Metrics + dashboards:
   - Emit events for all economic actions.
   - Update simulator indexer to expose treasury, vesting, and savings metrics.
   - Add metrics for liquidation counts, debt ratio, and vesting unlock rate.

### CCA Program Remediation (convertibility + fee distribution)

9. EVM contracts (new repo or `evm/` workspace):
   - ERC-20 RNG + CCA contracts + v4 liquidity launcher integration.
10. Fee distribution contract:
    - Route Uniswap v4 fees to stakers (USDT).
11. Bridge + policy toggles:
    - Lock/mint or burn/mint, with caps and delays.
    - Add emergency pause and monitoring hooks.
12. Auction bonus + recovery pool plumbing:
    - BOGO claim contract keyed to CCA receipts and freeroll credits.
    - Recovery pool accounting and debt retirement tooling.

## Executive Decisions (Locked)

- Canonical RNG domain: EVM canonical, Commonware wraps.
- Reward vesting: 0% immediate, 100% continuous over 30 months; CCA program bonus vests
  continuously over 3 months.
- vUSDT stability policy: 8% APR baseline, 6-14% band; 60% liquidation
  threshold, 45% target, 10% penalty.
- Staking payout location: EVM-only USDT distribution (bridge required).
- Governance model: multisig in pre-token launch/early CCA program, transition to staker
  governance post-audit.
- BOGO allocation: 1:1 up to available freeroll credits and the per-auction cap;
  unclaimed bonus rolls into the treasury reserve.
- Sell tax allocation: 80% to recovery pool until $10m, then 80% to RNG
  stakers; 20% to operating budget in both phases.
