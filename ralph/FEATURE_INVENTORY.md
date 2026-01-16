# Feature Inventory: Code Paths to Disable/Remove

**Generated**: 2026-01-16
**Purpose**: Map all code paths for live mode, bridge, liquidity/staking, auth billing/EVM/AI, and codec stacks per M0 acceptance criteria AC-1.1/AC-1.2.

## 1. Gateway Live Mode

**Spec**: `specs/gateway-live-mode-deferment.md`

### Files to Archive/Remove

| File | Purpose | Action |
|------|---------|--------|
| `gateway/src/live-table/index.ts` | Live-table module export | Archive |
| `gateway/src/live-table/craps.ts` | Live craps table implementation (44KB) | Archive |
| `gateway/tests/integration/live-table.test.ts` | Live-table integration tests | Archive |

### References to Remove

| File | Line(s) | Reference | Action |
|------|---------|-----------|--------|
| `gateway/src/index.ts` | 17 | `import { crapsLiveTable } from './live-table/index.js'` | Remove import |
| `gateway/src/index.ts` | 188 | `crapsLiveTable.configure(...)` | Remove configuration |
| `gateway/src/index.ts` | 651 | `crapsLiveTable.removeSession(destroyed)` | Remove cleanup call |
| `gateway/src/handlers/craps.ts` | - | References live-table module | Update/remove |

### Affected Endpoints

- WebSocket route for live-table connections (if any exposed)
- No HTTP endpoints identified

---

## 2. EVM Bridge

**Spec**: `specs/evm-bridge-deferment.md`

### Execution Layer

| File | Purpose | Action |
|------|---------|--------|
| `execution/src/layer/handlers/bridge.rs` | Bridge instruction handlers (10KB) | Gate/remove |
| `execution/src/layer/handlers/mod.rs:67` | `mod bridge;` declaration | Remove |

### Types/Protocol (Rust)

| File | Items | Action |
|------|-------|--------|
| `types/src/execution.rs` | `BridgeWithdraw`, `BridgeDeposit`, `FinalizeBridgeWithdrawal` instructions | Gate/remove |
| `types/src/execution.rs` | `BridgeState`, `BridgeWithdrawal(u64)` keys | Gate/remove |
| `types/src/execution.rs` | `BridgeWithdrawalRequested`, `BridgeWithdrawalFinalized`, `BridgeDepositCredited` events | Gate/remove |
| `types/src/execution.rs` | Tag constants: `BRIDGE_WITHDRAW=53`, `BRIDGE_DEPOSIT=54`, `FINALIZE_BRIDGE_WITHDRAWAL=55` | Gate/remove |
| `types/src/casino/economy.rs` | Bridge-related types | Review |
| `types/src/casino/player.rs` | Bridge-related player state | Review |

### Client Tooling

| File | Purpose | Action |
|------|---------|--------|
| `client/src/bin/bridge_relayer.rs` | Bridge relayer binary | Archive/remove |
| `client/Cargo.toml` | Bridge relayer binary entry | Remove entry |

### Website/UI

| File | Purpose | Action |
|------|---------|--------|
| `website/src/BridgeApp.tsx` | Bridge UI component | Archive/remove |
| `website/src/App.jsx` | Bridge route registration | Remove route |
| `website/src/components/AppLayout.jsx` | Bridge navigation links | Remove links |
| `website/src/components/PlaySwapStakeTabs.tsx` | Bridge tab reference | Remove tab |
| `website/src/api/client.js` | Bridge API methods | Remove methods |
| `website/src/api/nonceManager.js` | Bridge-related nonce handling | Review |
| `website/src/api/wasm.js` | Bridge WASM bindings | Remove bindings |
| `website/wasm/src/lib.rs` | Bridge WASM exports | Remove exports |
| `website/src/SecurityApp.tsx` | Bridge security references | Review |

### Simulator

| File | Purpose | Action |
|------|---------|--------|
| `simulator/src/submission.rs` | Bridge instruction handling | Gate/remove |
| `simulator/src/state.rs` | Bridge state management | Gate/remove |
| `simulator/src/explorer.rs` | Bridge event display | Gate/remove |

### Gateway

| File | Purpose | Action |
|------|---------|--------|
| `gateway/src/codec/events.ts` | Bridge event decoding | Remove decode paths |
| `gateway/src/utils/address-validation.ts` | Bridge address validation | Review |
| `gateway/src/session/nonce.ts` | Bridge nonce handling | Review |

### EVM Contracts

| File | Purpose | Action |
|------|---------|--------|
| `evm/contracts/BridgeLockbox.sol` | Bridge lockbox contract | Archive |
| `evm/scripts/deployPhase2.js` | Bridge deployment | Archive |
| `evm/test/contracts.test.js` | Bridge contract tests | Archive |
| `evm/test/security.test.js` | Bridge security tests | Archive |

### Config/Env

| File | Variables | Action |
|------|-----------|--------|
| `configs/staging/gateway.env.example` | Bridge-related env vars | Remove |
| `website/.env.example` | Bridge-related env vars | Remove |
| `website/.env.staging.example` | Bridge-related env vars | Remove |
| `website/.env.production.example` | Bridge-related env vars | Remove |

---

## 3. Liquidity/AMM/Staking

**Spec**: `specs/liquidity-staking-deferment.md`

### Execution Layer

| File | Purpose | Action |
|------|---------|--------|
| `execution/src/layer/handlers/liquidity.rs` | AMM/liquidity handlers (85KB) | Gate/remove |
| `execution/src/layer/handlers/staking.rs` | Staking handlers (34KB) | Gate/remove |
| `execution/src/layer/handlers/mod.rs:68-69` | `mod liquidity; mod staking;` | Remove |
| `execution/src/layer/mod.rs` | Liquidity/staking application | Gate/remove |

### Types/Protocol (Rust)

| File | Items | Action |
|------|-------|--------|
| `types/src/execution.rs` | Staking instructions (tags 18-21): `Stake`, `Unstake`, `ClaimRewards`, `SetStakingLimit` | Gate/remove |
| `types/src/execution.rs` | Liquidity instructions (tags 22-25): `VaultDeposit`, `VaultWithdraw`, `ClaimVaultRewards`, `SetVaultConfig` | Gate/remove |
| `types/src/execution.rs` | AMM instructions (tags 26-28): `Swap`, `AddLiquidity`, `RemoveLiquidity` | Gate/remove |
| `types/src/execution.rs` | Admin AMM: `SeedAmm=39`, `FinalizeAmmBootstrap=40` | Gate/remove |
| `types/src/execution.rs` | AMM events: `AmmSwapped`, `LiquidityAdded`, `LiquidityRemoved`, `AmmBootstrapped`, `AmmBootstrapFinalized` | Gate/remove |
| `types/src/execution.rs` | Keys: `StakingPool`, `StakingPosition`, `AmmPool` | Gate/remove |
| `types/src/casino/economy.rs` | AMM/staking economy types | Review |
| `types/src/casino/constants.rs` | AMM/staking constants | Review |

### Website/UI

| File | Purpose | Action |
|------|---------|--------|
| `website/src/StakingApp.tsx` | Staking UI | Archive/remove |
| `website/src/LegacyStakingApp.tsx` | Legacy staking UI | Archive/remove |
| `website/src/LiquidityApp.tsx` | Liquidity UI | Archive/remove |
| `website/src/LegacyLiquidityApp.tsx` | Legacy liquidity UI | Archive/remove |
| `website/src/EconomyApp.tsx` | Economy dashboard (includes AMM) | Review/simplify |
| `website/src/components/staking/StakingDashboard.tsx` | Staking dashboard component | Archive/remove |
| `website/src/components/staking/StakingAdvanced.tsx` | Advanced staking component | Archive/remove |
| `website/src/components/economy/SwapPanel.tsx` | AMM swap panel | Archive/remove |
| `website/src/components/economy/LiquidityPanel.tsx` | Liquidity panel | Archive/remove |
| `website/src/components/EconomyDashboard.jsx` | Economy overview | Review/simplify |
| `website/src/components/PlaySwapStakeTabs.tsx` | Swap/stake tabs | Remove tabs |
| `website/src/components/BottomNav.tsx` | Staking navigation | Remove links |
| `website/src/App.jsx` | Staking/liquidity routes | Remove routes |
| `website/src/api/client.js` | AMM/staking API methods | Remove methods |
| `website/src/api/nonceManager.js` | AMM/staking nonce handling | Review |
| `website/src/api/wasm.js` | AMM/staking WASM bindings | Remove bindings |
| `website/wasm/src/lib.rs` | AMM/staking WASM exports | Remove exports |
| `website/src/explorer/TxDetailPage.jsx` | AMM/staking tx display | Review |

### Simulator

| File | Purpose | Action |
|------|---------|--------|
| `simulator/src/submission.rs` | AMM/staking instruction handling | Gate/remove |
| `simulator/src/state.rs` | AMM/staking state management | Gate/remove |
| `simulator/src/explorer.rs` | AMM/staking event display | Gate/remove |

### Gateway

| File | Purpose | Action |
|------|---------|--------|
| `gateway/src/codec/events.ts` | AMM/staking event decoding | Remove decode paths |

### Tests

| File | Purpose | Action |
|------|---------|--------|
| `website/tests/integration/ammQuote.test.js` | AMM quote tests | Archive/remove |
| `website/tests/integration/client.test.js` | Client tests (AMM/staking parts) | Review |
| `website/tests/integration/txTracker.test.js` | Tx tracker tests (AMM/staking parts) | Review |

### Services

| File | Purpose | Action |
|------|---------|--------|
| `website/src/services/featureFlags.ts` | AMM/staking feature flags | Update flags |
| `website/src/services/txTracker.d.ts` | Tx tracker types (AMM/staking) | Review |

---

## 4. Auth Service: Billing/EVM/AI

**Spec**: `specs/auth-simplification.md`

### Auth Service Endpoints

| Endpoint | Line | Purpose | Action |
|----------|------|---------|--------|
| `POST /profile/evm-challenge` | 884 | EVM linking challenge | Remove |
| `POST /profile/link-evm` | 937 | Link EVM address | Remove |
| `POST /profile/unlink-evm` | 1010 | Unlink EVM address | Remove |
| `POST /ai/strategy` | 1061 | AI strategy proxy | Remove |
| `POST /billing/checkout` | 1135 | Stripe checkout | Remove |
| `POST /billing/portal` | 1194 | Stripe billing portal | Remove |
| `POST /billing/reconcile` | 1241 | Billing reconciliation | Remove |

### Auth Service Files

| File | Purpose | Action |
|------|---------|--------|
| `services/auth/src/server.ts` | Main server (lines 884-1241) | Remove EVM/AI/billing routes |
| `services/auth/.env.example` | Env template | Remove EVM/AI/Stripe vars |
| `services/auth/.env.staging.example` | Staging env | Remove EVM/AI/Stripe vars |
| `services/auth/.env.production.example` | Production env | Remove EVM/AI/Stripe vars |
| `services/auth/package.json` | Dependencies | Remove unused deps |

### Convex (Website Backend)

| File | Purpose | Action |
|------|---------|--------|
| `website/convex/stripe.ts` | Stripe actions | Archive/remove |
| `website/convex/stripeStore.ts` | Stripe data store | Archive/remove |
| `website/convex/evm.ts` | EVM linking | Archive/remove |
| `website/convex/http.ts` | HTTP routes (Stripe webhooks) | Remove Stripe handlers |
| `website/convex/entitlements.ts` | Entitlements (Stripe-related) | Review |
| `website/convex/users.ts` | User billing fields | Review |
| `website/convex/schema.ts` | Schema (billing fields) | Review |
| `website/convex/cron.ts` | Cron jobs (billing sync) | Review |
| `website/convex/maintenance.ts` | Maintenance (billing cleanup) | Review |

### Website Client

| File | Purpose | Action |
|------|---------|--------|
| `website/src/services/authClient.ts` | Auth client (EVM/AI/billing methods) | Remove methods |
| `website/src/services/membershipConfig.ts` | Membership/billing config | Archive/remove |
| `website/src/components/AuthStatusPill.tsx` | Auth status (billing display) | Review |

### Mobile

| File | Purpose | Action |
|------|---------|--------|
| `mobile/src/screens/LobbyScreen.tsx` | Lobby (billing/membership refs) | Review |

### Secrets

| File | Purpose | Action |
|------|---------|--------|
| `secrets/staging/secrets.enc.yaml` | Encrypted secrets (Stripe keys) | Remove Stripe secrets |
| `scripts/decrypt-secrets.sh` | Secret decryption | Review |

---

## 5. Codec Stacks

**Spec**: `specs/codec-consolidation-rust-native.md`

### Gateway Codec (Custom TS)

| File | Purpose | Action |
|------|---------|--------|
| `gateway/src/codec/index.ts` | Codec exports | Review |
| `gateway/src/codec/events.ts` | Custom event decoding (36KB) | Replace with Rust-derived |
| `gateway/src/codec/instructions.ts` | Instruction encoding (6KB) | Replace with Rust-derived |
| `gateway/src/codec/transactions.ts` | Transaction encoding (5KB) | Replace with Rust-derived |
| `gateway/src/codec/constants.ts` | Protocol constants (5KB) | Derive from Rust |

### Packages/Protocol (Hand-maintained JS/TS)

| File | Purpose | Action |
|------|---------|--------|
| `packages/protocol/src/index.ts` | Protocol exports | Convert to Rust-derived |
| `packages/protocol/src/encode.ts` | Instruction encoding (12KB) | Replace with Rust-derived |
| `packages/protocol/src/decode.ts` | Event decoding (7KB) | Replace with Rust-derived |
| `packages/protocol/src/version.ts` | Protocol version | Derive from Rust |
| `packages/protocol/src/games/` | Game-specific codecs | Replace with Rust-derived |
| `packages/protocol/src/schema/` | Schema definitions | Derive from Rust |
| `packages/protocol/src/mobile.ts` | Mobile codec wrapper | Review |
| `packages/protocol/src/validation.ts` | Validation logic | Review |
| `packages/protocol/test/` | Codec tests | Update for Rust-derived |

### Website WASM

| File | Purpose | Action |
|------|---------|--------|
| `website/wasm/src/lib.rs` | WASM bindings source | Extend for all codecs |
| `website/wasm/Cargo.toml` | WASM crate config | Update deps |
| `website/wasm/pkg/` | Built WASM package | Rebuild |
| `website/src/api/wasm.js` | WASM JS wrapper | Update for new exports |

### Rust Types (Canonical Source)

| File | Purpose | Status |
|------|---------|--------|
| `types/src/execution.rs` | Protocol tags + encoding | **Canonical** |
| `types/Cargo.toml` | Types crate config | Add export tooling |

---

## Summary Statistics

| Category | Files Affected | Estimated Lines |
|----------|----------------|-----------------|
| Live Mode | 4 | ~45,000 |
| Bridge | 25+ | ~15,000 |
| Liquidity/Staking | 30+ | ~120,000 |
| Auth Billing/EVM/AI | 20+ | ~3,000 |
| Codec Stacks | 15+ | ~70,000 |
| **Total** | **~95** | **~253,000** |

---

## Validation Checklist (AC-1.1/AC-1.2)

- [x] All live-table module paths identified
- [x] All bridge instruction/event paths identified
- [x] All liquidity/AMM/staking paths identified
- [x] All auth billing/EVM/AI endpoints identified
- [x] All codec stack locations identified
- [x] Website/mobile UI entry points documented
- [x] Configuration/env dependencies documented
- [x] Test files documented
