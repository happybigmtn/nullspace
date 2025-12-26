# Liquidity Bootstrapping Plan for Nullsociety RNG

This document is the canonical roadmap for RNG token distribution + liquidity across the Commonware (Nullspace) stack and Ethereum.

## Token Economics (Target)

**Total supply:** 1,000,000,000 RNG

| Bucket | % of supply | Amount (RNG) | Mechanism | Status in code |
|---|---:|---:|---|---|
| Freeroll bonus pool | up to 15% | 150,000,000 | Phase 2 BOGO bonus for successful CCA bidders (not airdropped) | **EVM contract implemented (BogoDistributor); deployment + eligibility root pending** |
| Phase 2 auction sale | 20% | 200,000,000 | Ethereum CCA raising USDT; proceeds seed a v4 pool | **CCA integration scripts present; runbook done, deployment/testnet rehearsal pending** |
| Liquidity reserve | 10% | 100,000,000 | Paired with auction proceeds at clearing price | **EVM token reserve accounted for; pool launch pending** |
| Player snapshot + rewards | 35% | 350,000,000 | Phase 1 earnings + allocations | **Partially implemented (credits ledger + emissions; snapshot exporter exists)** |
| Treasury / ops / partnerships | 15% | 150,000,000 | Treasury allocations + market-making | **Ledger + vesting enforcement implemented; schedule config pending** |
| Team / investor vesting | 5% | 50,000,000 | Time-locked vesting | **Ledger + vesting enforcement implemented; schedule config pending** |

Baseline example totals 100%. Final allocation must be reconciled to Phase 1
snapshot data before launch.

### Freeroll emission schedule (implemented)
On each tournament start, the executor mints a **per-tournament prize pool**:

`per_tournament = floor( floor( floor(TOTAL_SUPPLY * 5% / 365) / TOURNAMENTS_PER_DAY ) )`

Current protocol constants:
- `types/src/casino/constants.rs`: `TOTAL_SUPPLY = 1_000_000_000`
- `types/src/casino/constants.rs`: `ANNUAL_EMISSION_RATE_BPS = 300` (3%/year)
- `types/src/casino/constants.rs`: `REWARD_POOL_BPS = 1500` (15% cap)
- `types/src/casino/constants.rs`: `TOURNAMENTS_PER_DAY = 240` (1m registration + 5m active schedule)

Policy target update (Phase 2 plan):
- Reduce cap to 15% (`REWARD_POOL_BPS=1500`, `ANNUAL_EMISSION_RATE_BPS=300`).
- Track freeroll credits as Phase 2 bonus eligibility rather than direct
  airdrop.

This yields approximately:
- Annual emission target: `30,000,000 RNG/year`
- Daily emission target: `~82,192 RNG/day`
- Per-tournament prize pool: `~342 RNG/tournament` (integer division rounding)

The executor tracks `HouseState.total_issuance` and caps total freeroll issuance to
`15% * TOTAL_SUPPLY` today (Phase 2 bonus gating).

Policy update (Phase 1 -> Phase 2):
- Freeroll payouts track a non-transferable credit ledger (not direct
  RNG minting).
- Credits become eligibility for Phase 2 auction bonuses, with vesting.

## Current Codebase Snapshot (Reality Today)

The current “economy” lives inside the casino state machine. RNG is represented as the player’s `chips` balance.

### What exists on the Commonware stack (today)
- **RNG balance (in-protocol):** `types/src/casino/player.rs` `Player.balances.chips`
- **vUSDT (virtual stable):** `types/src/casino/player.rs` `Player.balances.vusdt_balance`
- **CPMM AMM (RNG/vUSDT):**
  - State: `types/src/casino/economy.rs` `AmmPool { reserve_rng, reserve_vusdt, total_shares, fee_basis_points, sell_tax_basis_points, bootstrap_price_vusdt_numerator, bootstrap_price_rng_denominator, bootstrap_finalized, bootstrap_final_price_vusdt_numerator, bootstrap_final_price_rng_denominator, bootstrap_finalized_ts }`
  - Execution: `execution/src/layer/handlers/liquidity.rs` `handle_swap`, `handle_add_liquidity`, `handle_remove_liquidity`
  - Defaults: 0.3% LP fee (`fee_basis_points=30`) + 5% sell-tax on RNG→vUSDT (`sell_tax_basis_points=500`) + bootstrap price (default: `1 RNG = 1 vUSDT`)
  - Accounting: sell-tax increments `HouseState.total_burned`; LP fee increments `HouseState.accumulated_fees`
- **CDP/Vault to mint vUSDT:** `execution/src/layer/handlers/liquidity.rs` `handle_create_vault`, `handle_deposit_collateral`, `handle_borrow_usdt`, `handle_repay_usdt`
  - LTV: tiered 30-45% based on AMM spot price (no external oracle)
- **Freeroll tournaments + payouts (top 15%):**
  - Join limit: 5/day enforced in `execution/src/layer/handlers/casino.rs` `handle_casino_join_tournament`
  - Start: `execution/src/layer/handlers/casino.rs` `handle_casino_start_tournament` (mints prize pool; resets tournament stacks)
  - End: `execution/src/layer/handlers/casino.rs` `handle_casino_end_tournament` (harmonic payout across top 15%)
- **Staking (dev / MVP):**
  - Stake/unstake bookkeeping exists (`execution/src/layer/handlers/staking.rs` `handle_stake`, `handle_unstake`)
  - Rewards distribution is implemented: positive epoch `HouseState.net_pnl` is allocated to stakers; `ClaimRewards` pays from a tracked reward pool.
- **Analytics tooling (live):**
  - Dashboard: `website/src/components/EconomyDashboard.jsx` polls live `House`, `AmmPool`, and registry data
  - Simulation: `client/examples/simulation_ecosystem.rs` still writes `economy_log.json` for offline runs

### What does NOT exist yet (and is required for the roadmap)
- A protocol-native **token ledger** (CTI-20 / “real RNG token”) separate from casino player state.
- Full Phase 2 deployment flow (testnet CCA rehearsal, liquidity launcher governance).
- Bridge relayer/service (Commonware bridge module + UI flows implemented; relayer shipped).

## Stage 1 — On-Chain Price Discovery (RNG/vUSD on Commonware)

**Goal:** discover a credible on-chain price curve and liquidity baseline *inside* Nullspace before any external bridge exists.

### Stage 1A (now): make the existing AMM usable for price discovery
Leverage the already-implemented CPMM:
- Implement/ship a **Swap + LP + Vault UI** in the website:
  - Swap RNG↔vUSDT with slippage controls.
  - Add/remove liquidity and show LP share price.
  - Create vault, deposit collateral, borrow/repay vUSDT; show health (LTV).
- Emit and index **events** for swaps/liquidity/vault actions (currently most return `vec![]`), so:
  - the UI can show confirmations without polling,
  - the dashboard can consume real chain data (not just simulation logs),
  - we can audit price discovery behavior over time.
- Define a **treasury seeding mechanism**:
  - Decide how initial reserves are provisioned (genesis allocation vs. privileged instruction vs. multisig account).
  - Establish initial AMM parameters (fee, sell-tax, min liquidity, bootstrap price).

### Stage 1B (optional but recommended): time-limited “futures” / bootstrap auction mode
If we want a *fixed* “closing price” that later anchors Phase 2:
- Add an on-chain **Auction/Bootstrap state** (deadline + finalized flag + closing price snapshot).
- Add `finalize()` logic that:
  - freezes trading after deadline,
  - records `closing_price = reserve_vusdt / reserve_rng`,
  - optionally disables further vault borrowing if the oracle is “closed”.

This can be implemented as a wrapper around the existing `AmmPool` state (no need to replace swap math).

## Stage 2 — Ethereum Auction + Uniswap Liquidity (RNG/USDT or RNG/USDC)

**Goal:** sell the Phase 2 allocation (20% of supply) via an Ethereum-native mechanism,
seed 10% liquidity at the clearing price, and distribute up to 15% in BOGO bonuses.

### Stage 2A: Ethereum contracts + testnet dry run
Deliverables:
- **ERC-20 RNG (Ethereum)**:
  - initial mint = auction allocation + liquidity reserve + bonus pool.
  - admin = multisig / timelock.
- **Continuous Clearing Auction (CCA)** (or equivalent):
  - accepts USDT/USDC bids over time/tranches,
  - clears at a uniform price per tranche,
  - produces a final clearing price + allocations + refunds.
  - enforces a minimum raise threshold (liquidity pairing requirement).
- **Liquidity launcher**:
  - upon auction finalization, seeds a Uniswap pool at the discovered price with
    the 10% RNG liquidity reserve and matching USDT.
  - excess proceeds fund the 20m USDT recovery pool, then treasury/insurance.

Operational requirements:
- Deployment scripts (Foundry/Hardhat), subgraph/indexing, and a minimal bidding UI.
- Security review/audit plan (CCA and launch contracts are high-risk).

### Stage 2B: mainnet launch
- Finalize auction parameters: duration, tranche schedule, max bid size, allowlist (if any), and disclosures.
- Run the auction, then automatically seed Uniswap liquidity.
- Publish the canonical on-chain addresses and verification artifacts.

## Stage 3 — Bridge + Multi-Chain Liquidity (Canonical Supply Across Commonware + Ethereum)

**Goal:** unify the ecosystems so RNG can move between chains without inflating supply.

### Bridge architecture decision (must be made)
Pick one canonical supply domain:
- **Option A (recommended):** Commonware RNG is canonical; Ethereum RNG is a wrapped representation.
- **Option B:** Ethereum RNG is canonical; Commonware RNG becomes a wrapped representation.

Then implement a bridge that is **supply-preserving**:
- lock/mint (canonical token locked, wrapped minted),
- or burn/mint (canonical burned, wrapped minted), with strong replay protection.

### Stage 3 deliverables
- Ethereum bridge contracts (lockbox + mint/burn roles).
- Commonware-side bridge module (new instructions + state) *or* a trusted relayer/MPC for an MVP.
- End-to-end integration in the website:
  - deposit/withdraw flows,
  - clear “where your RNG lives” UX,
  - safety rails (limits, delays, emergency pause).
- Ongoing liquidity:
  - RNG/USDC, RNG/USDT pools on Ethereum L1/L2s,
  - optional incentive program (separate from freeroll emissions) for external LPs.

## Open Questions / Decisions Needed
- **Canonical token ledger:** when do we graduate from `Player.chips` to a protocol-native CTI-20 RNG ledger?
- **Treasury + vesting:** how are the treasury/ops + team allocations controlled
  (multisig) and vested (time locks)?
- **Stable choice:** USDT vs USDC (and which chain/L2 for Phase 2).
- **Oracle strategy:** do we import Ethereum price back into Commonware (and how) once the bridge exists?
- **AMM parameter governance:** who can change fee/sell-tax and under what process?

## Next Steps (Concrete, Codebase-Aligned)

### Immediate (this repo)
- [x] Complete treasury vesting enforcement for Phase 2 allocation buckets.
- [x] Implement website UI flows for AMM swap + LP management, vault borrow/repay,
  and price/TVL/LP share metrics.
- [x] Add execution events for AMM/vault/stake actions so the UI can rely on updates instead of polling.
- [ ] Update `client/examples/simulation_ecosystem.rs` assumptions to match the
  Phase 2 allocation (20/10/15 bonus plus remaining buckets).
- [ ] Decide whether Stage 1 needs an explicit time-limited “finalize” step; if yes, design new state + instructions.

### New repos / new modules (Phase 2/3)
6. Create an `evm/` workspace (or separate repo) for Ethereum contracts + deployment scripts.
7. Implement Stage 2 contracts (ERC-20 RNG, CCA, liquidity launcher) and run a full testnet rehearsal.
8. Design and implement the canonical bridge (Stage 3), starting with an MVP trust model and a path to decentralization.
