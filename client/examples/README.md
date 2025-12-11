# Nullspace Economy Simulations

This directory contains simulation scripts to test and verify the "Player-Owned Economy" (Phase 2) of the Nullspace platform.

## Available Simulations

### 1. Ecosystem Simulation (`simulation_ecosystem.rs`)
A comprehensive, multi-agent simulation that models the entire economy.
- **Actors:**
  - **Tournament Organizer:** Starts/Ends tournaments periodically (every 5s).
  - **Whales:** Realistic traders that buy/sell 10k-50k RNG chunks. They track inventory and only sell what they've bought.
  - **Retail Bots:** Active traders (2-5s interval) that trade, lend/borrow vUSDT (leverage), and play games.
  - **Grinders:** Swarm of 100 bots (2s interval) that join tournaments and play aggressively to win fixed prize pools.
  - **Maximizer:** A smart agent optimizing for PnL via Baccarat and Staking.
- **Output:** Generates `economy_log.json` for dashboard visualization.

### 2. PnL Maximizer (`maximize_pnl.rs`)
A single-actor script representing a sophisticated user trying to "beat" the house.
- **Strategy:** High-volume Baccarat (Banker bets) + Staking + Arbitrage.
- **Goal:** Maximize Net Worth (Chips + Staked + vUSDT - Debt).

---

## Deployment Instructions

Running a simulation requires three components: the **Simulator** (Blockchain), the **Executor** (Block Producer), and the **Simulation Script** (User Agents).

### Prerequisites
- Rust (latest stable)
- Node.js & NPM (for dashboard)

### Step 1: Get Network Identity
First, retrieve the validator identity string that will be used to secure the local network.
```bash
cargo run --example get_identity -p nullspace-simulator
```
*Copy the long hex string output (e.g., `92b05...`). You will use this same string for all following steps.*

### Step 2: Start the Blockchain Simulator
Open a terminal and start the simulator node, passing the identity you just copied:
```bash
cargo run --bin nullspace-simulator -- --identity <IDENTITY_HEX>
```
*Keep this terminal running.*

### Step 3: Start the Executor
In a new terminal (or background), start the block producer using the **same** identity:
```bash
cargo run --bin dev-executor -- --identity <IDENTITY_HEX>
```
*Keep this terminal running.*

### Step 4: Run the Simulation
Now, launch the ecosystem of bots, again using the **same** identity:
```bash
cargo run --release --example simulation_ecosystem -- --identity <IDENTITY_HEX> --duration 300
```
- `--duration`: Seconds to run the simulation (default 300).
- `--traders`: Number of retail traders (default 10).
- `--gamblers`: Number of grinders (default 50).

### Step 5: Visualize Results
The simulation generates `economy_log.json` in the root directory. To view the metrics:

1. **Copy Data:**
   ```bash
   # From project root
   cp economy_log.json website/public/
   ```
   *(Note: The `npm run dev` script in `website/` is configured to do this automatically if you restart it).*

2. **Start Dashboard:**
   ```bash
   cd website
   npm install
   npm run dev
   ```

3. **View:** Open **http://localhost:5173/economy** in your browser.

## Troubleshooting
- **Connection Refused:** Ensure `nullspace-simulator` is running on port 8080.
- **Invalid Identity:** Ensure you copied the full hex string from `get_identity` without newlines.
