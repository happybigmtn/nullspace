# Strategy & Economic Design

This document consolidates the business strategy, token economics, and deployment roadmap for Nullspace.

## Executive Summary

Nullspace is a self-contained casino + DeFi economy that matures in a closed system (pre-token launch) before opening to external convertibility through a Uniswap v4 continuous clearing auction (CCA) program.

**Vision:** Build the most resilient, playable crypto-native economy by:
- Proving the economy in "island mode" before external trading
- Rewarding participation and retention, not airdrop farming
- Routing all long-term cash flows to RNG stakers

**End-State:** 100% of protocol revenues flow to RNG stakers; treasury operations are staker-governed.

---

## Token Economics

### Total Supply: 1,000,000,000 RNG

| Bucket | % | Amount | Mechanism |
|--------|---|--------|-----------|
| CCA Auction (base) | 25% | 250M | 10 quarterly auctions (2.5% each); proceeds seed v4 pool |
| Freeroll Bonus Pool | up to 25% | 250M | BOGO bonus for CCA bidders; unclaimed → treasury |
| Developer Reserve | 50% | 500M | Treasury/ops/liquidity/partnerships; vests 5%/year over 10 years |

### Timeline
- **Testnet Launch (T0)**
- **First CCA:** T0 + 3 months (runs ~1 month)
- **Token Launch:** End of first CCA
- **Remaining CCAs:** 9 more quarterly auctions (30-month total program)

---

## Phased Strategy

### Phase 1: Island Economy (Pre-Token Launch)

**Goals:**
- Build real player base and retention
- Stress test AMM, vaults, and staking under real usage
- Prevent early extraction and "down only" dumping

**Capital Controls:**
- No external transfer or bridge before token launch
- RNG/vUSDT are internal-only balances
- Limits on daily net sell and swap notional
- Convertibility caps tied to account age, stake, and activity

**Monetary Policy:**

| Type | Sources/Sinks |
|------|---------------|
| Emissions | Freeroll credits (25% cap), optional LP rewards from treasury |
| Sinks | House edge, AMM sell tax (80% recovery pool → stakers), buy tax (10% during CCA), vault stability fees |

**Account Maturity Tiers:**
- **Tier 0 (<7 days):** Reduced caps, no LP removal, borrow ≤30% LTV
- **Tier 1 (7-30 days):** Standard caps, LP allowed, borrow ≤30% LTV
- **Tier 2 (30+ days + stake ≥1k RNG):** Higher caps, borrow ≤45% LTV

### Phase 2: CCA Program (External Convertibility)

**Goals:**
- Open controlled convertibility via CCA + Uniswap v4
- Distribute 100% of swap fees and protocol revenue to stakers (USDT)

**CCA Mechanics:**
- 10 quarterly auctions (2.5% supply each)
- BOGO bonus: 1:1 match of freeroll credits for successful bidders
- 100% of auction proceeds → v4 liquidity pool at clearing price
- Floor price: derived from internal economy valuation

### CCA Auction Details

**Auction Parameters:**
| Parameter | Value |
|-----------|-------|
| Duration | ~1 month per auction |
| Min Bid | $25 USDT |
| Max Bid/wallet/day | $50,000 USDT |
| Min Raise Threshold | ≥50% of allocation sold |
| Clearing Price | Uniform price (all winners pay same) |

**Auction Flow:**
1. Bidders submit (max_price, amount) during auction window
2. Uses Permit2 for gasless approvals
3. At end, clearing price computed (highest price clearing all supply)
4. Winners pay clearing price, receive tokens
5. Below-clearing bids refunded
6. Proceeds + RNG liquidity reserve → Uniswap v4 pool

**Failure Handling:**
- If min raise not met → delay auction, rerun
- Unsold tokens → roll into next auction or developer reserve

### BOGO Bonus Distribution

**Eligibility:**
- Must be successful CCA bidder
- Must have accumulated freeroll credits (pre-token launch)
- Bonus = min(bid amount, available credits)

**Mechanics:**
- Claims via `BogoDistributor.sol` (Merkle proof)
- Vesting: 0% immediate → 100% over 3 months
- Unclaimed bonus → treasury reserve

### Recovery Pool

**Purpose:** Retire up to $10M vUSDT debt and provide operational buffer

**Funding:**
- 80% of sell tax (10% on RNG sales) until $10M target
- After $10M: 80% → RNG stakers, 20% → ops budget

**Debt Retirement:**
- Priority: highest-risk (LTV) positions first
- Haircut: borrowers repay 30-50% to participate
- Eligibility: proof-of-play, account age, stake lock

---

## Bridge Architecture

### Cross-Chain Model

**Design Decision:** EVM canonical (lock/mint)
- Ethereum RNGToken is the canonical supply
- Commonware RNG is a wrapped representation
- Uniswap v4 is the source of price truth

### EVM Contracts

| Contract | Purpose | Lines |
|----------|---------|-------|
| `RNGToken.sol` | ERC-20 with immutable 1B cap | 22 |
| `BridgeLockbox.sol` | Custody for cross-chain transfers | 33 |
| `BogoDistributor.sol` | Merkle-based airdrop claims | 54 |
| `FeeDistributor.sol` | Recurring fee distributions to stakers | 82 |
| `RecoveryPool.sol` | Manual user recovery fund | 45 |

### Bridge Flow

**Deposit (EVM → Commonware):**
```
User → BridgeLockbox.deposit(amount, destination)
     → Event: Deposited(from, amount, destination)
     → Relayer waits N confirmations
     → Relayer → Commonware BridgeDeposit instruction
     → Player credited with chips
```

**Withdrawal (Commonware → EVM):**
```
Player → BridgeWithdraw instruction
      → Chips burned, withdrawal created with delay
      → Relayer waits for delay
      → Relayer → BridgeLockbox.withdraw(to, amount)
      → EVM transaction confirmed
      → Relayer → FinalizeBridgeWithdrawal
```

### Bridge Security Controls

| Control | Implementation |
|---------|----------------|
| Daily Limit (global) | `policy.bridge_daily_limit` |
| Daily Limit (per-user) | `policy.bridge_daily_limit_per_account` |
| Withdrawal Delay | `bridge_delay_secs` (configurable) |
| Emergency Pause | `policy.bridge_paused` |
| Confirmation Depth | `evm_confirmations` (default: 3) |

### Relayer Trust Model

The bridge relayer is a **centralized operator** holding:
- Commonware admin private key
- EVM lockbox owner key

**If Compromised:**
- Can credit arbitrary deposits
- Can drain lockbox
- Cannot exceed daily limits (application-enforced)

**Mitigations:**
- HSM key storage
- Conservative daily limits
- Monitoring and alerting
- Emergency pause capability

---

## Freeroll Credit System

### Credit Mechanics

Freeroll credits are **non-transferable internal points** that:
- Accumulate from tournament participation and freeroll wins
- Cannot be traded or withdrawn before token launch
- Convert to CCA bonus eligibility (BOGO)
- Expire after 180 days of inactivity

### Credit Parameters

| Parameter | Value |
|-----------|-------|
| Annual Emission Rate | 3% of total supply |
| Reward Pool Cap | 25% of supply (over 30 months) |
| Immediate Vest | 20% |
| Vesting Period | 180 days (remaining 80%) |
| Expiry | 180 days of inactivity |

### Daily Limits by Tier

| Tier | Freerolls/Day | Requirements |
|------|---------------|--------------|
| Free | 1 | Any account |
| Trial | 3 | First 7 days |
| Member | 10 | $5/month subscription |

### Credit → Token Conversion

At token launch (CCA):
1. Credits snapshot taken
2. Eligible credits → BOGO bonus pool
3. 1:1 match for CCA bid amount (up to available credits)
4. Bonus tokens vest over 3 months
5. Unclaimed bonus → treasury reserve

---

## Game Economics

### House Edge by Game

| Game | House Edge | Volume Driver |
|------|------------|---------------|
| Blackjack | 0.5-1.0% | High skill appeal |
| Baccarat | 1.06% (Player) | High-roller favorite |
| Roulette | 2.7% (EU) | Casual accessibility |
| Craps | 1.4% (Pass) | Social/exciting |
| Sic Bo | 2.8% | Fast rounds |
| Video Poker | 0.5-2% | Skill-based |
| Casino War | 2.9% | Simple/fast |
| HiLo | 2-4% | Streak excitement |
| Three Card | 3.4% | Progressive jackpots |
| Ultimate Texas | 2.2% | Poker variant appeal |

### Revenue Flow

```
Game Wagers
    │
    ▼
┌──────────────────┐
│   House Edge     │ → Net PnL (can be negative short-term)
│   (2-3% avg)     │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Weekly Burn     │ → Positive PnL burned, reduces supply
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Staker Rewards  │ → Remaining distributed to stakers
└──────────────────┘
```

### Progressive Jackpots

| Game | Base Jackpot | Contribution |
|------|--------------|--------------|
| Three Card Poker | 10,000 chips | % of ante |
| Ultimate Texas | 10,000 chips | % of trips bet |

### Tournament Economics

| Parameter | Value |
|-----------|-------|
| Tournaments/Day | 240 (one every 6 minutes) |
| Duration | 5 minutes |
| Starting Chips | 1,000 |
| Starting Shields | 3 |
| Starting Doubles | 3 |
| Payout | Top 15% (harmonic distribution) |

---

## Economic Controls

### Vault/vUSDT Stability

| Parameter | Value |
|-----------|-------|
| Max LTV | 45% (mature stakers), 30% (new accounts) |
| Liquidation Threshold | 60% LTV → target 45% |
| Liquidation Penalty | 10% (4% liquidator, 6% stability pool) |
| Stability Fee | 8% APR baseline (6-14% band based on debt ratio) |
| Debt Ceiling | ≤30% of AMM vUSDT reserves |

### AMM Controls (RNG/vUSDT)

| Parameter | Value |
|-----------|-------|
| Base Fee | 0.30% |
| Buy Tax (CCA program) | 10% |
| Dynamic Sell Tax | 3-10% based on 7-day net outflow |
| Per-account Net Sell Cap | min(3% balance, 0.15% pool TVL) per day |

### Vesting Schedules

| Reward Type | Vesting |
|-------------|---------|
| Freeroll/Staking Rewards | 0% immediate → 100% over 30 months |
| CCA Bonus Tokens | 0% immediate → 100% over 3 months |
| Developer Reserve | 5% per year over 10 years |

---

## Sybil Mitigation

**Economic Controls:**
- Progressive reward caps by account age and stake
- Reward vesting (earned RNG unlocks over time)
- Minimum stake requirement for higher tiers

**Behavioral Controls:**
- "Proof of play" weighting for freeroll rewards
- Rate-limit high-frequency farm behaviors
- Heuristic flags for multi-account patterns
- Auction gating: allowlist or proof-of-play for CCA bonuses

---

## Revenue Model

| Source | Description |
|--------|-------------|
| House Edge | Net PnL from casino games |
| AMM Fees | 0.30% LP fee + dynamic sell/buy taxes |
| Stability Fees | 8% APR on vUSDT debt |
| Membership | Optional $5/month subscription for 10x daily freerolls |

**Distribution (Post-Token Launch):**
- 100% of net protocol revenues → RNG stakers
- Net positive house edge burned weekly
- Treasury funding governed by stakers

---

## Infrastructure

### Self-Hosted Architecture

| Scale | Components |
|-------|------------|
| 1k-5k concurrent | 1x simulator/indexer, 2x web/app, 1x gateway, 1x auth, 1x Convex, CDN |
| 5k-20k concurrent | 2x simulator, 3-6x web/app, 2x+ gateways, Redis/NATS fanout, dedicated Convex |
| 20k+ concurrent | Separate read/indexer tier, multi-gateway, dedicated metrics/logs, multi-region failover |

### Production Stack
- **Auth:** Auth.js v5 (self-hosted) with JWT sessions
- **Backend:** Self-hosted Convex (accounts, entitlements, Stripe)
- **Gateway:** WebSocket session manager with rate limiting
- **Billing:** Stripe webhooks → Convex entitlements

### Deployment Environment
- **Recommended:** Hetzner Ashburn (US-East)
- **CDN/DNS:** Cloudflare
- **Database:** Self-managed Postgres with WAL archiving
- **Object Storage:** Backblaze B2 or Wasabi (us-east)

---

## Marketing Strategy

**Pre-Token Launch:**
- Weekly leagues + leaderboards + streamer events
- Transparent economic dashboards (issuance, burn, fees, liquidity)
- Seasonal campaigns and retention rewards

**CCA Program:**
- Auction awareness campaigns
- Testnet CCA simulations and public results
- Convertibility ramps and fee distribution transparency

**Core Message:** "Earn and use RNG in a real economy before external trading."

---

## KPIs

| Metric | Description |
|--------|-------------|
| DAU/WAU | Daily/weekly active users |
| D7/D30 Retention | 7-day and 30-day retention rates |
| Conversion | Swap/borrow/LP conversion rates |
| Distribution | Top 1% share of supply concentration |
| Revenue | Fee revenue per active user |
| Sybil | Flags per 1k accounts |

---

## Locked Executive Decisions

- **Canonical RNG domain:** EVM canonical, Commonware wraps
- **Reward vesting:** 0% immediate, 100% continuous over 30 months
- **vUSDT stability:** 8% APR baseline, 60% liquidation threshold, 45% target
- **Staking payout:** EVM-only USDT distribution (bridge required)
- **BOGO allocation:** 1:1 up to freeroll credits; unclaimed → treasury
- **Sell tax split:** 80% recovery pool until $10M, then 80% to stakers; 20% to ops

---

## Open Questions

- Token ledger migration timeline (Player.chips → ERC-20)
- Treasury governance and multisig structure
- Stable choice (USDT vs USDC) and which chain/L2
- Oracle strategy post-bridge
- Full lending markets scope (deferred post-Phase 2)

---

## Related Documents

- [ARCHITECTURE.md](ARCHITECTURE.md) - Complete technical architecture for auditors
- [RUNBOOK.md](RUNBOOK.md) - Operations procedures and incident response
- [convex-guidelines.md](convex-guidelines.md) - Convex development standards
- [SERVERS.md](SERVERS.md) - Staging infrastructure inventory
