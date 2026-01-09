# System Architecture

Complete technical architecture for auditors, CEO, and CTO. This document covers the full system design, security model, and implementation details.

## Table of Contents

1. [System Overview](#system-overview)
2. [Execution Layer](#execution-layer)
3. [Casino Games](#casino-games)
4. [RNG & Fairness](#rng--fairness)
5. [Economic System](#economic-system)
6. [Bridge Architecture](#bridge-architecture)
7. [Security Model](#security-model)
8. [Services Architecture](#services-architecture)
9. [Data Flow](#data-flow)
10. [Trust Assumptions](#trust-assumptions)

---

## System Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  Web App     │  │  Mobile App  │  │  Admin Tools │              │
│  │  (React)     │  │  (Expo)      │  │  (CLI)       │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
└─────────┼─────────────────┼─────────────────┼───────────────────────┘
          │ WebSocket       │ WebSocket       │ HTTP
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         GATEWAY LAYER                                │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Gateway (TypeScript)                                         │  │
│  │  - Session management (ED25519 keypair per session)          │  │
│  │  - Protocol validation (Zod schemas)                         │  │
│  │  - Rate limiting (per-IP, per-session)                       │  │
│  │  - Global table coordination                                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ HTTP/gRPC
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       CONSENSUS LAYER                                │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Simulator (Rust)                                             │  │
│  │  - HTTP API (/submit, /state, /account, /explorer/*)         │  │
│  │  - WebSocket updates (/updates, /mempool)                    │  │
│  │  - Explorer indexing (SQLite/Postgres)                       │  │
│  │  - Prometheus metrics                                         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Validators (nullspace-node) × 3-5                           │  │
│  │  - BLS12-381 threshold signatures                            │  │
│  │  - Consensus seed generation per epoch                       │  │
│  │  - Deterministic block execution                             │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       EXECUTION LAYER                                │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  State Machine (Rust - Deterministic)                        │  │
│  │  - Casino handlers (10 games, tournaments, freerolls)        │  │
│  │  - Liquidity handlers (AMM, vaults, staking, savings)        │  │
│  │  - Bridge handlers (deposits, withdrawals, daily limits)     │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Summary

| Component | Language | Purpose | LOC |
|-----------|----------|---------|-----|
| `execution/` | Rust | Deterministic game logic, DeFi handlers | ~25,000 |
| `types/` | Rust | Core data structures, constants | ~8,000 |
| `node/` | Rust | Consensus validators, mempool | ~12,000 |
| `simulator/` | Rust | HTTP API, indexer, metrics | ~6,000 |
| `gateway/` | TypeScript | WebSocket bridge, session management | ~5,000 |
| `services/auth/` | TypeScript | Authentication, Stripe, AI proxy | ~1,200 |
| `services/ops/` | TypeScript | Analytics, leagues, CRM | ~1,100 |
| `evm/` | Solidity | Bridge, token, distributions | ~500 |

---

## Execution Layer

### Determinism Guarantees

The execution layer is **fully deterministic**:

1. **No wall-clock time** - Only consensus-derived timestamps
2. **No external randomness** - RNG from cryptographic seed chain
3. **Ordered iteration** - BTreeMap instead of HashMap
4. **Atomic commits** - All-or-nothing state transitions

### State Transition Pipeline

```
Transaction Received
        │
        ▼
┌───────────────────┐
│ Nonce Validation  │ ← Prevents replay, enforces ordering
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Instruction Route │ ← Casino | Liquidity | Bridge | Staking
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Handler Execution │ ← Game logic, balance updates
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Event Emission    │ ← Audit trail, client updates
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Atomic Commit     │ ← State finalized or rolled back
└───────────────────┘
```

### Key Data Structures

```rust
// Central bank for casino economy
pub struct HouseState {
    pub net_pnl: i128,              // Running P&L (can be negative)
    pub total_staked: u64,          // Total RNG staked
    pub total_vusdt_debt: u64,      // Outstanding vUSDT loans
    pub total_burned: u64,          // RNG removed from circulation
    pub total_issuance: u64,        // RNG minted via freerolls
    pub progressive_jackpots: Vec<(GameType, u64)>,
}

// Player account state
pub struct Player {
    pub profile: PlayerProfile,      // Name, KYC status
    pub balances: PlayerBalances,    // chips, vusdt, freeroll_credits
    pub modifiers: PlayerModifiers,  // shields, doubles
    pub tournament_state: Option<TournamentPlayerState>,
    pub session_state: Option<SessionState>,
    pub vault: Option<Vault>,        // Collateralized debt position
    pub staker: Option<Staker>,      // Staking position
}

// AMM liquidity pool
pub struct AmmPool {
    pub reserve_rng: u64,
    pub reserve_vusdt: u64,
    pub total_lp_shares: u64,
    pub fee_basis_points: u16,       // 30 = 0.30%
    pub sell_tax_basis_points: u16,  // Dynamic 300-1000
}
```

---

## Casino Games

### Game Catalog (10 Games)

| Game | Type | Max Bets | House Edge | LOC |
|------|------|----------|------------|-----|
| Blackjack | Cards | Unlimited | 0.5-1.0% | 2,309 |
| Roulette | Wheel | 20 | 2.7% (EU) | 1,641 |
| Craps | Dice | 20 | 1.4% (Pass) | 3,891 |
| Baccarat | Cards | 11 | 1.06% | 2,357 |
| Sic Bo | Dice | 20 | 2.8% | 1,269 |
| Video Poker | Cards | 1 | 0.5-2% | 615 |
| Casino War | Cards | 2 | 2.9% | 1,055 |
| HiLo | Cards | 1 | 2-4% | 778 |
| Three Card Poker | Cards | 4 | 3.4% | 1,265 |
| Ultimate Texas Hold'em | Cards | 4 | 2.2% | 1,518 |

### Game State Machine

Each game follows a standard lifecycle:

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   BETTING   │───▶│    LOCK     │───▶│   RESOLVE   │
│  (12-20s)   │    │    (2s)     │    │   (1-3s)    │
└─────────────┘    └─────────────┘    └──────┬──────┘
                                             │
      ┌──────────────────────────────────────┘
      ▼
┌─────────────┐    ┌─────────────┐
│   PAYOUT    │───▶│  COOLDOWN   │───▶ (Next Round)
│   (2-4s)    │    │   (4-7s)    │
└─────────────┘    └─────────────┘
```

### Bet Validation

All bets validated at multiple layers:

1. **Gateway** - Schema validation (Zod), amount bounds
2. **Simulator** - Rate limiting, balance check
3. **Execution** - Game rules, bet limits, state consistency

```rust
// Consensus-critical limits (immutable)
pub const BACCARAT_MAX_BETS: usize = 11;
pub const CRAPS_MAX_BETS: usize = 20;
pub const ROULETTE_MAX_BETS: usize = 20;
pub const SIC_BO_MAX_BETS: usize = 20;
pub const CASINO_MAX_PAYLOAD_LENGTH: usize = 256;
```

---

## RNG & Fairness

### Cryptographic RNG Chain

```rust
pub struct GameRng {
    state: [u8; 32],  // SHA256 state
    index: usize,      // Current byte position
}

impl GameRng {
    pub fn new(seed: &Seed, session_id: u64, move_number: u32) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(seed.encode().as_ref());      // Network seed
        hasher.update(&session_id.to_be_bytes());   // Per-session isolation
        hasher.update(&move_number.to_be_bytes());  // Per-move uniqueness
        Self {
            state: hasher.finalize().0,
            index: 0,
        }
    }

    // Generates bytes deterministically
    pub fn next_byte(&mut self) -> u8 {
        if self.index >= 32 {
            self.state = Sha256::digest(&self.state).0;
            self.index = 0;
        }
        let byte = self.state[self.index];
        self.index += 1;
        byte
    }
}
```

### Fairness Guarantees

| Property | Mechanism | Verification |
|----------|-----------|--------------|
| **Deterministic** | SHA256 hash chain | Re-execute with same seed |
| **Unpredictable** | Consensus seed (>66% validators) | Seed committed at lock |
| **Per-session isolated** | session_id in seed derivation | Cannot predict other sessions |
| **Auditable** | State snapshots stored | Replay any historical round |
| **Non-manipulable** | No player input to RNG | Seed fixed before bets |

### Outcome Formula

```
outcome = H(network_seed || session_id || move_number)
```

Where:
- `network_seed` = Validator-aggregated random value (committed at block creation)
- `session_id` = Unique per player session
- `move_number` = Incrementing counter per game action

---

## Economic System

### Token Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        SOURCES (Emissions)                       │
├─────────────────────────────────────────────────────────────────┤
│  Freeroll Credits (25% cap) ──────────────────────────────────▶ │
│  Tournament Prizes ───────────────────────────────────────────▶ │
│  LP Rewards (treasury-funded) ────────────────────────────────▶ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PLAYER BALANCES                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │    RNG      │  │   vUSDT     │  │  Freeroll   │             │
│  │   (chips)   │  │  (stable)   │  │  Credits    │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         SINKS (Removal)                          │
├─────────────────────────────────────────────────────────────────┤
│  House Edge (game losses) ────────────────────────────────────▶ │
│  AMM Sell Tax (3-10% dynamic) ────────────────────────────────▶ │
│  AMM Buy Tax (10% during CCA) ────────────────────────────────▶ │
│  Vault Stability Fee (8% APR) ────────────────────────────────▶ │
└─────────────────────────────────────────────────────────────────┘
```

### Vault/CDP Mechanics

```rust
pub struct Vault {
    pub collateral: u64,           // RNG locked
    pub debt_vusdt: u64,           // vUSDT borrowed
    pub last_accrual_ts: u64,      // Timestamp for interest
}

// Risk parameters
const MAX_LTV_MATURE: u16 = 4500;     // 45% for tier 2 accounts
const MAX_LTV_NEW: u16 = 3000;        // 30% for new accounts
const LIQUIDATION_THRESHOLD: u16 = 6000;  // 60% triggers liquidation
const LIQUIDATION_PENALTY: u16 = 1000;    // 10% penalty
const STABILITY_FEE_APR: u16 = 800;       // 8% annual
```

### AMM (Constant Product)

```rust
// Swap formula: x * y = k (with fees)
pub fn calculate_swap(
    amount_in: u64,
    reserve_in: u64,
    reserve_out: u64,
    fee_bps: u16,
    tax_bps: u16,
) -> u64 {
    let fee = amount_in * fee_bps as u64 / 10000;
    let tax = amount_in * tax_bps as u64 / 10000;
    let amount_after_fees = amount_in - fee - tax;

    // Constant product: (x + dx) * (y - dy) = x * y
    let numerator = amount_after_fees * reserve_out;
    let denominator = reserve_in + amount_after_fees;
    numerator / denominator
}
```

---

## Bridge Architecture

### Cross-Chain Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     ETHEREUM (EVM)                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  RNGToken   │  │ BridgeLock  │  │  Recovery   │             │
│  │  (ERC-20)   │  │    box      │  │    Pool     │             │
│  └─────────────┘  └──────┬──────┘  └─────────────┘             │
└──────────────────────────┼──────────────────────────────────────┘
                           │
           ┌───────────────┴───────────────┐
           │       BRIDGE RELAYER          │
           │  (Rust, centralized operator) │
           │  - Watches EVM deposits       │
           │  - Submits to Commonware      │
           │  - Executes withdrawals       │
           └───────────────┬───────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────────┐
│                    COMMONWARE                                    │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Bridge Handler                                              ││
│  │  - Daily limits (global + per-account)                      ││
│  │  - Withdrawal delay (configurable)                          ││
│  │  - Emergency pause                                           ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Deposit Flow (EVM → Commonware)

1. User calls `BridgeLockbox.deposit(amount, destination)`
2. Event emitted: `Deposited(from, amount, destination)`
3. Relayer waits N confirmations (default: 3)
4. Relayer submits `Instruction::BridgeDeposit` to Commonware
5. Handler credits chips to player

### Withdrawal Flow (Commonware → EVM)

1. Player submits `Instruction::BridgeWithdraw`
2. Chips burned, withdrawal created with delay
3. After delay, relayer calls `BridgeLockbox.withdraw(to, amount)`
4. EVM transaction confirmed
5. Relayer submits `FinalizeBridgeWithdrawal`

### Security Controls

| Control | Implementation |
|---------|----------------|
| Daily limit (global) | `policy.bridge_daily_limit` |
| Daily limit (per-user) | `policy.bridge_daily_limit_per_account` |
| Withdrawal delay | `bridge_delay_secs` |
| Emergency pause | `policy.bridge_paused` |
| Confirmation depth | `evm_confirmations` (default: 3) |

---

## Security Model

### Authentication Layers

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: Gateway Session                                        │
│  - ED25519 keypair generated per session                        │
│  - Private key never transmitted                                │
│  - Rate limiting per IP (5 connections, 10 sessions/hour)       │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2: Auth Service (Optional)                                │
│  - Passkey (WebAuthn) or password vault                         │
│  - JWT sessions with CSRF protection                            │
│  - Stripe integration for billing                               │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3: On-Chain Identity                                      │
│  - Public key registered via CasinoRegister                     │
│  - All transactions signed by session key                       │
│  - Nonce prevents replay                                        │
└─────────────────────────────────────────────────────────────────┘
```

### Cryptographic Operations

| Operation | Algorithm | Key Size |
|-----------|-----------|----------|
| Transaction signing | ED25519 | 256-bit |
| Validator signatures | BLS12-381 | 384-bit |
| RNG generation | SHA256 | 256-bit |
| Password vault | PBKDF2 + AES-GCM | 256-bit |
| Passkey vault | WebAuthn PRF + HKDF | 256-bit |

### Rate Limiting Matrix

| Layer | Limit | Window |
|-------|-------|--------|
| Gateway connections/IP | 5 | Concurrent |
| Gateway sessions/IP | 10 | 1 hour |
| Gateway total sessions | 1,000 | Concurrent |
| Auth challenges | 30 | 1 minute |
| Auth profile ops | 60 | 1 minute |
| Auth billing ops | 20 | 1 minute |
| Simulator HTTP | 1,000 | 1 second |
| Simulator submit | 100 | 1 minute |

### Admin Key Management

```
Priority Order:
1. CASINO_ADMIN_PRIVATE_KEY_URL (with vault token)
2. CASINO_ADMIN_PRIVATE_KEY_FILE
3. CASINO_ADMIN_PRIVATE_KEY_HEX (dev only, blocked in production)
```

**Admin Operations:**
- Set freeroll limits per player
- Sync tournament limits from entitlements
- Bridge pause/unpause

---

## Services Architecture

### Gateway Service

**Purpose:** WebSocket bridge for mobile/web clients

**Key Responsibilities:**
- Session lifecycle (create, register, cleanup)
- Protocol validation (Zod schemas)
- Global table coordination (multi-player games)
- Nonce persistence (disk-backed)

**Configuration:**
```bash
MAX_CONNECTIONS_PER_IP=5
MAX_TOTAL_SESSIONS=1000
GATEWAY_DATA_DIR=./.gateway-data
GATEWAY_EVENT_TIMEOUT_MS=30000
```

### Auth Service

**Purpose:** Authentication, billing, AI proxy

**Endpoints:**
| Path | Method | Purpose |
|------|--------|---------|
| `/auth/challenge` | POST | Generate login challenge |
| `/mobile/challenge` | POST | Mobile login |
| `/profile/link-public-key` | POST | Link casino key |
| `/billing/checkout` | POST | Create Stripe session |
| `/ai/strategy` | POST | Gemini AI proxy |

**Security:**
- CSRF protection on all POST routes
- Timing-safe token comparison
- Challenge TTL (5 min default, 15 min max)

### OPS Service

**Purpose:** Analytics, leagues, CRM

**Features:**
- Event ingestion (200/request limit)
- League scoring (wager, net, or net-abs mode)
- Referral tracking
- Push notifications (Expo)

---

## Data Flow

### Transaction Lifecycle

```
Client                Gateway              Simulator           Validators
  │                     │                     │                    │
  │ ─── Bet Intent ───▶ │                     │                    │
  │                     │ ─── Sign + Submit ─▶│                    │
  │                     │                     │ ─── Mempool ─────▶ │
  │                     │                     │                    │
  │                     │                     │ ◀── Block ──────── │
  │                     │                     │                    │
  │                     │ ◀── State Update ── │                    │
  │ ◀── Result ──────── │                     │                    │
```

### State Persistence

| Data | Storage | Backup |
|------|---------|--------|
| Chain state | Validator disk | Snapshots before upgrades |
| Explorer | SQLite/Postgres | WAL archiving, daily base |
| Users/Entitlements | Convex | Volume snapshots |
| Nonces | Gateway disk | Part of gateway data dir |
| Sessions | In-memory | Stateless (reconstructable) |

---

## Trust Assumptions

### Centralized Components

| Component | Trust Level | Mitigation |
|-----------|-------------|------------|
| Bridge Relayer | High (can mint/burn) | HSM keys, daily limits, monitoring |
| Auth Service | Medium (identity linkage) | Rate limits, CSRF, audit logs |
| OPS Service | Low (analytics only) | Origin validation, admin token |
| Gateway | Medium (session keys) | Entropy validation, rate limits |

### Decentralized Components

| Component | Trust Model |
|-----------|-------------|
| Validators | BFT (>66% honest) |
| Game RNG | Consensus seed (cannot be predicted) |
| State transitions | Deterministic (reproducible) |
| Proofs | Merkle (cryptographic verification) |

### Attack Surface

| Vector | Risk | Mitigation |
|--------|------|------------|
| RNG manipulation | Low | Consensus-derived seed, committed before bets |
| Replay attacks | Low | Nonce sequencing per account |
| Double spending | None | Atomic state commits |
| Bridge compromise | Medium | Daily limits, withdrawal delay, pause |
| Session hijacking | Low | Keys never transmitted, per-device |
| DDoS | Medium | Rate limiting, connection caps |

---

## Appendix: Key File Locations

### Execution Layer
- `execution/src/layer/mod.rs` - Core execution engine
- `execution/src/casino/` - All game implementations
- `execution/src/layer/handlers/` - Instruction handlers

### Types & Constants
- `types/src/casino/player.rs` - Player state
- `types/src/casino/economy.rs` - AMM, Vault, House
- `types/src/casino/constants.rs` - All limits and defaults

### Node & Consensus
- `node/src/engine.rs` - Consensus orchestration
- `node/src/application/mempool.rs` - Transaction queue
- `node/src/seeder/` - RNG seed generation

### Services
- `gateway/src/session/manager.ts` - Session lifecycle
- `services/auth/src/server.ts` - Auth endpoints
- `services/ops/src/server.ts` - Analytics endpoints

### EVM Contracts
- `evm/contracts/RNGToken.sol` - Main token
- `evm/contracts/BridgeLockbox.sol` - Bridge custody
- `evm/contracts/BogoDistributor.sol` - Airdrop claims
