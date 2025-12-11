# Phase 2: Player-Owned Economy & Virtual Liquidity

## Executive Summary
This phase transitions the platform from a simple casino into a sophisticated **Player-Owned Economy** with its own monetary policy and decentralized finance primitives. We are building a "Sovereign House" that acts as a Central Bank, and an "Island Economy" that bootstraps liquidity without external bridges.

### Architecture Decision: CPMM vs. CLOB
Based on the review of `raydium-io/raydium-cp-swap`, we have selected a **Constant Product Market Maker (CPMM)** architecture over a Central Limit Order Book (CLOB).
*   **Reasoning:**
    *   **Bootstrapping:** CPMM (`x * y = k`) provides infinite liquidity depth at any price, which is critical for our "Island" environment where initial market makers are scarce. CLOBs suffer from thin books and high spread in these conditions.
    *   **Efficiency:** A CPMM swap is `O(1)` complexity, whereas CLOB matching is `O(n)` or `O(log n)`, ensuring our game execution remains fast and cheap.
    *   **Simplicity:** Native Rust implementation of CPMM is robust and verifiable, aligning with our goal of a "programmatic" monetary policy.

---

## Part 1: The Sovereign House (Tokenomics & Monetary Policy)

### Core Concept: The House as Central Bank
The House is a programmatic entity with a balance sheet, not just a sink for tokens.
*   **Income:** House Edge (Net accumulated losses from players).
*   **Liabilities:** Staker Claims (Dividends).
*   **Monetary Policy:**
    *   **Surplus (Net > 0):** Distributed to stakers at the end of a weekly epoch.
    *   **Deficit (Net < 0):** Protocol mints new RNG tokens (Inflation) to cover player winnings. This debt must be repaid by future surpluses before distributions resume.

### Dashboard Requirements (Refinore-style)
We need real-time visibility into the "Central Bank" operations:
*   **House Solvency:** Net PnL vs. Total Supply.
*   **Inflation Monitor:** Real-time tracking of minting events.
*   **Staker Yield:** Project APY based on current epoch performance.

---

## Part 2: The Island Economy (Virtual Liquidity)

### Raydium-Inspired AMM Implementation
We implement a native Constant Product Market Maker (`x * y = k`) for the RNG/vUSDT pair, adapting the math and precision standards from `raydium-cp-swap`.

#### 1. Mathematical Precision
*   All intermediate calculations use `u128` to prevent overflow and ensure precision before casting back to `u64` for balances.
*   **Constant:** $k = x \times y$ is tracked to ensure $k_{new} \ge k_{old}$ after every swap (minus fees).

#### 2. Swap Flow & Fee Structure
To create deflationary pressure, we implement a multi-layered fee structure on **RNG Sales** (`RNG -> vUSDT`):

1.  **Input Amount:** $Amount_{In}$ (RNG)
2.  **Sell Tax (5%):**
    *   $Tax = Amount_{In} \times 500 / 10000$
    *   **Action:** Immediately **Burned** (Removed from Total Supply).
    *   $Amount_{AfterTax} = Amount_{In} - Tax$
3.  **Liquidity Provider Fee (0.3%):**
    *   $Fee_{LP} = Amount_{AfterTax} \times 30 / 10000$
    *   **Action:** Added to Pool Reserves (increases $k$, rewarding LPs).
    *   $Amount_{Swap} = Amount_{AfterTax}$ (Fee is typically implicit in the output calculation, effectively staying in the pool).
4.  **Constant Product Output:**
    *   $Amount_{Out} = \frac{Amount_{Swap} \times Reserve_{Out}}{Reserve_{In} + Amount_{Swap}}$

### Virtual USDT (vUSDT)
*   **Minted via Vaults (CDPs):** Players lock RNG collateral to borrow vUSDT.
*   **Oracle-Free (Initially):** Price is determined by the internal AMM Spot Price, removing external oracle dependencies for the bootstrap phase.

---

## Implementation Specifications

### 1. Data Structures (`types/src/casino.rs`)

#### `HouseState` (Central Bank)
```rust
struct HouseState {
    current_epoch: u64,
    net_pnl: i128,          // Surplus/Deficit
    total_staked: u64,
    total_burned: u64,      // Track burned tokens
}
```

#### `AmmPool` (Liquidity)
```rust
struct AmmPool {
    reserve_rng: u64,
    reserve_vusdt: u64,
    total_shares: u64,
    fee_bps: u16,           // Standard LP fee (e.g., 30 bps)
    sell_tax_bps: u16,      // 500 bps (5%)
}
```

### 2. Execution Logic (`execution/src/lib.rs`)

The `handle_swap` function must strictly follow the Raydium-inspired logic:
*   **Verify** `u128` overflow protection.
*   **Apply** Sell Tax *before* the constant product formula.
*   **Update** `HouseState.total_burned` atomically.

### 3. Simulation & Dashboarding

#### Enhanced Simulation (`client/examples/simulation_economy.rs`)
The simulation generates a **Time-Series Log** (`economy_log.json`) that the frontend ingests.
*   **Scenario:** 
    *   "Whale" pumps liquidity.
    *   "Traders" buy and sell (triggering tax).
    *   "Gamblers" win (triggering inflation) and lose (triggering surplus).

#### Dashboard Frontend (`website/`)
*   **Route:** `/economy`
*   **Charts:**
    *   **Price Chart:** RNG/vUSDT price over time.
    *   **Supply Dynamics:** Inflation vs. Burn (Dual-axis chart).
    *   **House Health:** Net PnL (Bar chart).

---

## Completed Action Items
1.  **Types Updated:** `total_burned` added to `HouseState`, `sell_tax_bps` added to `AmmPool`.
2.  **Logic Implemented:** `handle_swap` now includes 5% sell tax logic with immediate burn.
3.  **Simulation Upgraded:** `simulation_economy.rs` runs 100 blocks, exporting `economy_log.json`.
4.  **Dashboard Built:** `EconomyDashboard.jsx` visualizes the economic health.
