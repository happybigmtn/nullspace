# refactor3.md — UX/Product Plan (Casino + Swap/Stake + Mobile) (2025-12-16)

This document is an engineering-facing implementation plan to make the `nullspace` web experience feel *professional-grade* across:

- **All 10 casino games** (Play mode + Freeroll mode)
- **Swap / Liquidity / Borrow** UX (now in `website/src/EconomyApp.tsx`; legacy wrapper remains at `website/src/LiquidityApp.tsx`)
- **Staking** UX (currently combined in `website/src/StakingApp.tsx`)
- **Mobile web buildout** (touch-first, thumb-reachable, responsive, performant)

It is **tailored to this repository** (React + Vite + Tailwind in `website/`, Rust execution in `execution/`, shared types in `types/`, WASM codec in `website/wasm`).

---

## 0) Safety & Product Guardrails (Non-Negotiable)

We will **not** implement deceptive or predatory patterns (e.g., “near-miss” rigging, misleading odds, obscured losses, dark-pattern friction to withdraw). The goal is:

- **Clarity**: users always understand what is happening and what to do next.
- **Honesty**: outcomes and pricing are not manipulated by UI.
- **Responsible play**: provide controls that reduce harm (timeouts, limits, reality checks).
- **Professional casino polish**: fast cycles, satisfying feedback, high trust.

This is especially important because the product is a casino surface; “professional-grade” must include **risk controls**, not just retention mechanics.

---

## 0.1) Scope, Goals, Non‑Goals, and Definitions

### Scope (what this plan covers)
- **Frontend UX** across `/` (casino), `/swap` + `/borrow` + `/liquidity`, `/stake`, `/security`, and `/explorer`.
- **Mobile web** behavior and interaction models (touch-first).
- **Confirmation and “receipt” UX** using existing websocket events and the simulator explorer endpoints.
- **Small enablement changes** in `website/wasm` and/or lightweight JS utilities when required for UX (e.g., computing explorer transaction digests).

### Goals (measurable outcomes)
1. **Mobile users can complete the core loop end-to-end**:
   - vault → register → fund (dev faucet) → swap/stake → play any game → see confirmations.
2. **Swap and staking feel simple**:
   - default screens show only the primary action; advanced controls are discoverable but hidden.
3. **Every game is playable without a keyboard**:
   - tap-first actions exist for every stage; keyboard shortcuts remain power-user accelerators.
4. **Trust and clarity**:
   - balances, fees/taxes, slippage/min received, and game rules are visible with minimal friction.
5. **Responsible play controls ship**:
   - reality check + cooldown + optional local limits.

### Non‑goals (out of scope unless explicitly requested)
- Changing casino odds / RTP / math in `execution/src/casino/*.rs`.
- Adding new games beyond the existing 10.
- Real-money rails, fiat onramps/offramps, bridging, or production wallet support (passkey vault is beta/dev).
- Replacing chain protocol, transaction formats, or consensus-critical encodings.

### Definitions (repo-specific)
- **RNG**: casino chips (`Player.chips` on-chain; labeled RNG in UI).
- **vUSDT**: virtual stable balance (`Player.vusdtBalance`).
- **View / “block”**: the chain view number increments with seeds; staking uses view numbers for lock/unlock.
- **Explorer transaction hash**: `sha256(nonce_be || instruction.encode() || public_key_bytes)` (signature excluded), per `types/src/execution.rs` `Transaction::digest()`. The simulator explorer uses this digest in `simulator/src/explorer.rs`.

---

## 0.2) KPIs, Telemetry, and Validation Approach

### Primary UX KPIs
- **TTFP (Time to first play):** landing → first game started (target: <45s on mobile in dev).
- **TTFS (Time to first swap):** landing → first swap submitted (target: <60s).
- **Swap completion rate:** % of initiated swaps that reach confirmed/success state.
- **Stake completion rate:** % of initiated stakes that reach confirmed/success state.
- **Mobile completeness:** % of core actions possible without keyboard (target: 100%).
- **Error rate:** `CasinoError` per 100 actions and client-side validation errors per 100 actions.

### Telemetry minimalism (dev-first)
This repo currently has no dedicated telemetry system. Start with:
- In-memory + `localStorage` ring buffer of UX events (dev only).
- Optional export to JSON for analysis.

**Proposed file**: `website/src/services/telemetry.ts` (new)
- `track(eventName, props)`
- `exportJson()`

### Suggested event taxonomy (frontend)
- `ui.command_palette.opened` / `ui.help.opened`
- `casino.game.started` / `casino.game.action` / `casino.game.completed`
- `economy.swap.initiated|submitted|confirmed|failed`
- `staking.stake.initiated|submitted|confirmed|failed`
- `vault.locked_blocked_action` (when `getOrCreateKeypair()` returns null)

### Validation approach
- Unit tests for deterministic math (AMM quote, amount parsing).
- Playwright smoke tests for routing + core flows.
- Manual QA scripts for mobile touch-only paths.

---

## 1) Codebase Map (Where Work Lands)

### Casino (10 games)
- Shell + routing: `website/src/CasinoApp.tsx`, `website/src/App.jsx`
- Core state + on-chain integration: `website/src/hooks/useTerminalGame.ts`
- Game views (UI/controls): `website/src/components/casino/games/*View.tsx`
- Shared game UI primitives: `website/src/components/casino/{Layout.tsx,ActiveGame.tsx,GameComponents.tsx,MobileDrawer.tsx,BigWinEffect.tsx}`
- Frontend game enum (UI): `website/src/types.ts` (`GameType`)
- Chain game enum (serialization): `website/src/types/casino.ts` (`GameType`)
- Rust engines: `execution/src/casino/*.rs`
- Payload encoding docs: `docs/api.md`

### Swap / Borrow / Liquidity (currently “cluttered”)
- UI + quote calc: `website/src/EconomyApp.tsx` (legacy wrapper: `website/src/LiquidityApp.tsx`)
- Rust handlers: `execution/src/layer/handlers/liquidity.rs`
- State structs: `types/src/casino/economy.rs` (`AmmPool`, `Vault`, `HouseState`)
- Docs/roadmap: `liquidity.md`, `website/plan2.md`

### Staking (currently “cluttered”)
- UI: `website/src/StakingApp.tsx`
- Rust handlers: `execution/src/layer/handlers/staking.rs`
- State structs: `types/src/casino/economy.rs` (`Staker`, staking fields on `HouseState`)

### Security / Wallet (passkey vault)
- UI: `website/src/SecurityApp.tsx`
- Vault runtime: `website/src/security/*`
- Keypair gating: `website/src/api/client.js` (`getOrCreateKeypair`)

---

## 2) Current UX Gaps (Repo-Specific Observations)

### 2.1 Game discovery is keyboard-only
- The “press to play” screen in `website/src/components/casino/ActiveGame.tsx` looks clickable but has no click handler.
- Command palette is opened via `/` key in `website/src/hooks/useKeyboardControls.ts`, not via UI.
- On mobile, users often cannot reliably trigger keyboard shortcuts → **cannot find games**.

### 2.2 Two games are not playable on mobile (tap-only)
- `HiLoView` and `VideoPokerView` show controls as non-clickable `<div>`s (no `onClick` wired).
  - `website/src/components/casino/games/HiLoView.tsx`
  - `website/src/components/casino/games/VideoPokerView.tsx`

### 2.3 Help UI exists but is not accessible on mobile
- Header shows `"[?] HELP"` as a static `<span>` in `website/src/components/casino/Layout.tsx` instead of an interactive control.
- Help overlay toggles via `?` key in `website/src/hooks/useKeyboardControls.ts`.

### 2.4 Swap/Borrow/LP are bundled together into one dense page
- `website/src/EconomyApp.tsx` contains:
  - Wallet + register + faucet
  - Swap (RNG/vUSDT) with slippage
  - LP add/remove
  - Vault (CDP) create/deposit/borrow/repay
  - House debug
- This violates progressive disclosure and is especially hard on mobile.

### 2.5 Staking page mixes user actions with house/dev controls
- `website/src/StakingApp.tsx` includes `Process Epoch (dev)` next to user stake/claim flows.
- Users don’t know what is “required” vs “debug”.

### 2.6 Repeated connection/polling patterns and inconsistent gating
- `CasinoApp` uses `useTerminalGame` (its own client lifecycle).
- `EconomyApp` + `StakingApp` re-implement client init, WS connect, 1s polling loops.
- Vault-locked gating is inconsistent across pages.

### 2.7 Mobile layout baseline exists but needs a “mobile-first pass”
- `MobileDrawer` is a good pattern and already used for Craps/Roulette/SicBo/ThreeCard/UH.
- However the core casino shell assumes desktop keyboard workflows.

---

## 3) Target Experience (What “Professional-Grade” Means Here)

### 3.1 Core UX principles (implementable with current stack)
- **One obvious next action** per game state (Betting vs Playing vs Result).
- **Fast feedback**: input → animation/sound → state update.
- **Trust signals**:
  - Clear balances + fees + limits
  - Confirmations and “pending” states
  - Explorer links for receipts
- **Mobile touch-first**:
  - Thumb-reachable primary actions
  - Tap targets ≥ 44px
  - Safe-area aware bottom UI
- **Responsible play**:
  - Session time reminders
  - Quick “cooldown” option
  - Optional spend/session caps (client-side first)

---

## 4) Architectural Refactors (Enablers)

### 4.1 Shared “Chain Session” hook/provider (reduce duplicated logic)

**Goal:** One standard way for screens to:
- Initialize WASM (`WasmWrapper`)
- Get keypair (vault/localStorage) via `CasinoClient.getOrCreateKeypair()`
- Connect WS updates
- Initialize nonce manager
- Provide current player/vault/staker/amm/house state

**Proposed additions**
- `website/src/hooks/useCasinoConnection.ts` (new)
  - Handles init + WS + basic status machine: `missing_identity | vault_locked | connected | error`.
- `website/src/chain/CasinoContext.tsx` (optional next step)
  - Provide the same connection to multiple pages without re-connecting.

**Migration path**
1. Migrate `LiquidityApp` + `StakingApp` to `useCasinoConnection` first.
2. Optionally migrate `useTerminalGame` later (bigger change).

**Progress**
- [x] Add `website/src/hooks/useCasinoConnection.ts` (init + WS + nonce manager + status machine).
- [x] Migrate `EconomyApp` (via `LiquidityApp` wrapper) to `useCasinoConnection`.
- [x] Migrate `website/src/StakingApp.tsx` to `useCasinoConnection`.
- [x] Update `website/src/hooks/useTerminalGame.ts` to use `switchUpdates` (avoid `connectUpdates` JSDoc-private).

**Detailed spec (recommended)**

Status machine (single source of truth):
- `missing_identity`: `VITE_IDENTITY` absent → show instructions + link to `website/README.md`.
- `vault_locked`: `CasinoClient.getOrCreateKeypair()` returns `null` → show CTA to `/security`.
- `connecting`: WASM init, client init, WS connect, nonce manager init.
- `connected`: keypair ready, updates WS connected, state refresh loop running.
- `error`: fatal init error (show retry, show backend URL, show identity status).

Suggested return shape:
```ts
type ConnectionStatus = 'missing_identity' | 'vault_locked' | 'connecting' | 'connected' | 'error';

type CasinoConnection = {
  status: ConnectionStatus;
  statusDetail?: string;
  error?: string;
  client: CasinoClient | null;
  wasm: WasmWrapper | null;
  keypair: { publicKey: Uint8Array; publicKeyHex: string } | null;
  currentView: number | null;
  refreshOnce: () => Promise<void>;
  onEvent: (name: string, handler: (evt: any) => void) => () => void;
};

type CasinoConnectionState = {
  player: any | null;
  vault: any | null;
  staker: any | null;
  amm: any | null;
  lpBalance: any | null;
  house: any | null;
};
```

Implementation notes (repo-specific)
- Use `CasinoClient.waitForFirstSeed()` + `CasinoClient.getCurrentView()` instead of ad-hoc “view” polling when possible.
- Consolidate init code currently duplicated in:
  - `website/src/EconomyApp.tsx`
  - `website/src/StakingApp.tsx`
- Prefer WS events to trigger targeted refresh after confirmations (swap/stake), and fall back to polling at a slower interval.

### 4.2 Shared transaction UX state (pending/confirmed/failed)

**Goal:** Every action (swap/stake/claim/borrow) has the same UX lifecycle.

**Implemented**
- [x] `website/src/services/txTracker.js` (+ `website/src/services/txTracker.d.ts`)
  - local activity/tx tracker (pending/confirmed/failed) stored in `localStorage`
  - correlates “submitted” actions with WS events and updates status
- [x] `website/src/hooks/useActivityFeed.ts`
  - lightweight React hook for subscribing to the activity feed per-surface
- [x] `website/src/services/toasts.ts` + `website/src/components/ui/ToastHost.tsx`
  - global success/error toasts for confirmations and failures
- [x] Wired into:
  - `website/src/EconomyApp.tsx`
  - `website/src/StakingApp.tsx`
- [x] Tests:
  - `website/test/txTracker.test.js`

**Notes**
- We already have `NonceManager` resubmission logic in `website/src/api/nonceManager.js`.
- We already receive events like `AmmSwapped`, `LiquidityAdded`, `Staked`, `RewardsClaimed`, `CasinoError`.

**Detailed spec (receipts + explorer deep links)**

Problem: `NonceManager` returns a **display hash** (`computeTxHash`) that does not match explorer’s transaction hash. For professional receipts, we should link to:
- `/explorer/tx/<real_digest_hex>`

Plan options (preference order)
1. **Add a WASM helper to compute the real digest** from encoded tx bytes:
   - Add to `website/wasm/src/lib.rs`: `digest_transaction(tx_bytes: &[u8]) -> String`
   - Update `website/src/api/wasm.js` to call it
   - Update `website/src/api/nonceManager.js` to return `{ txHash: <digest> }`
2. Poll explorer account activity:
   - After submit, call `/api/explorer/account/<pubkey>` until a tx with `nonce` appears; use that `hash`.
   - (Higher latency; depends on explorer indexing.)

`txTracker` responsibilities
- Track pending actions (swap/stake/borrow/liquidity) with `{ kind, nonce, pubkey, startedAtMs, txHash? }`.
- Subscribe to WS events and resolve completion/failure:
  - `AmmSwapped` resolves `swap`
  - `LiquidityAdded/Removed` resolves LP actions
  - `Staked/Unstaked/RewardsClaimed` resolves staking
  - `CasinoPlayerRegistered` resolves register flows
  - `CasinoDeposited` resolves faucet/deposit flows
  - `CasinoError` resolves the nearest pending action for that player
- Emit:
  - toasts (success/error)
  - activity feed items (“Swap completed”, “Stake submitted”, etc.)

Edge cases
- WS disconnect: keep “pending” and rely on `NonceManager` resubmission + later refresh.
- Identity/network reset: clear pending actions (similar to `NonceManager` behavior with `casino_identity`).

### 4.3 Component kit for finance surfaces

**Goal:** Stop re-building form patterns in each app.

**Proposed components**
- `AmountInput` (with Max + % buttons, numeric keypad hints)
- `TokenPill` (icon + symbol)
- `StepFlow` (1/2/3 review stepper)
- `InlineHelp` (small “?” tooltip / drawer)
- [x] `ToastHost` (global)

Location: `website/src/components/ui/*` (new).

**Detailed component requirements**

`AmountInput`
- Props: `label`, `value`, `onChange`, `balance`, `token`, `inputMode="numeric"`, `maxButton`, `% shortcuts`.
- Validation display: inline (no toast) for:
  - “Enter a whole number amount” (current `BigInt` parsing expects integer)
  - “Exceeds balance”
  - “Must be greater than zero”

`ConfirmModal`
- Standard pattern for swap/stake/borrow:
  - summary rows + confirm/cancel
  - explicit “Confirm in passkey prompt” copy when awaiting credential UI

`InlineHint`
- Collapsible hint text for explaining:
  - vUSDT
  - slippage (“price tolerance”)
  - staking duration/voting power

`ToastHost`
- Minimal toasts: success/error/info
- Auto-dismiss and respects reduced motion

---

## 5) Milestone Plan (Sequenced, With Deliverables & Acceptance)

### Milestone M0 — Baseline + IA Fixups (≈ 1 week)

**Deliverables**
- Fix broken/undefined routes and improve entry points for mobile.
- Add UI affordances for game discovery and help.

**Tasks**
- [x] Fix `/borrow` link in `website/src/components/casino/ModeSelectView.tsx`:
  - Option A: add real route `/borrow` (preferred; see M2).
  - Option B: remove link or redirect to `/swap`.
- [x] Make “press to play” clickable:
  - Add `onClick` to open game menu (command palette) in `website/src/components/casino/ActiveGame.tsx`.
- [x] Add a visible “Games” button on mobile + desktop:
  - Implemented near the top tabs in `website/src/CasinoApp.tsx` (toggles `commandOpen` and focuses the palette input).
- [x] Make Help accessible without keyboard:
  - Replace the static `"[?] HELP"` span in `website/src/components/casino/Layout.tsx` with a button that toggles `helpOpen`.
- [x] Add a minimal “Wallet pill” component shown consistently (Play/Swap/Stake):
  - shows RNG + vUSDT + vault status, links to `/security`.

**Detailed engineering checklist (repo-specific)**
- [x] `website/src/components/casino/ActiveGame.tsx`
  - Make the “/” splash clickable and keyboard-focusable:
    - `role="button"`, `tabIndex={0}`, `onClick`, `onKeyDown(Enter/Space)`
    - calls into `CasinoApp` to open the command palette (either via prop or small context).
- [x] `website/src/CasinoApp.tsx`
  - Add a visible “GAMES” button (desktop + mobile) near the tabs that toggles `commandOpen`.
  - Ensure it coexists with keyboard handler in `useKeyboardControls` (no duplicate opens).
- [x] `website/src/components/casino/Layout.tsx`
  - Replace the non-interactive help hint with a real button that toggles `helpOpen`.
  - Keep the keyboard hint text as secondary (don’t remove power-user affordance).
- [x] `website/src/components/PlaySwapStakeTabs.tsx`
  - Increase tap targets on mobile (min height 44px).
  - Ensure active state is obvious (contrast + border).
- [x] Route sanity:
  - Fix `/borrow` link mismatch in `website/src/components/casino/ModeSelectView.tsx` by adding a route or redirect in `website/src/App.jsx`.
- [x] Wallet pill component (new): `website/src/components/WalletPill.tsx`
  - Inputs: `rng`, `vusdt`, `pubkeyHex?` (vault status derived)
  - Links: `/security`, `/explorer/account/:pubkey`

**Acceptance criteria**
- Mobile user can: open game menu, pick a game, view help, and start a round without using a keyboard.

---

### Milestone M1 — Mobile Navigation + Layout Standards (≈ 1–2 weeks)

**Deliverables**
- A mobile-first navigation pattern and safe-area-correct bottom UI.

**Tasks**
- [x] Add Bottom Nav for mobile:
  - Implement in `website/src/components/PlaySwapStakeTabs.tsx` (or split into `TopTabs` + `BottomNav`).
  - Ensure safe-area padding (CSS).
 - [x] Standardize page headers for Swap/Stake/Vault (consistent visual hierarchy).
 - [x] Add a “Touch mode” toggle in casino header:
  - When enabled, show tap labels instead of keyboard keycaps.

**Detailed spec: navigation vs existing fixed bottom UI**

Constraint: the casino page already uses fixed bottom UI:
- bet shortcuts footer (`website/src/components/casino/Layout.tsx` `Footer`)
- per-game action bars inside each `*View.tsx` (absolute positioned)

To avoid collisions, implement a **hybrid**:
- Casino page (`/`):
  - keep the existing top tabs (`PlaySwapStakeTabs`) for navigation
  - do **not** add a persistent bottom nav that would overlap game controls
- Non-casino pages (`/swap`, `/borrow`, `/liquidity`, `/stake`, `/security`, `/explorer`):
  - add a bottom nav for thumb reach
  - ensure `padding-bottom` accounts for safe-area + nav height

Implementation steps
- [x] Add `BottomNav` component (new): `website/src/components/BottomNav.tsx`
  - items: Play, Swap, Stake, Vault, Explorer
  - only renders on `sm` and below (mobile)
- [x] Render it in `website/src/App.jsx` for all routes *except* `/` (casino).
  - via `website/src/components/AppLayout.jsx` wrapper route
- [x] CSS:
  - define a CSS variable `--bottom-nav-h` (e.g., 56px)
  - apply `padding-bottom: calc(var(--bottom-nav-h) + env(safe-area-inset-bottom))` to page wrappers
  - ensure drawers/modals (`MobileDrawer`, `HelpOverlay`) use higher `z-index`

**Acceptance criteria**
- On <640px width: primary navigation is thumb-reachable; no critical action requires keyboard.

---

### Milestone M2 — Swap UX Rebuild (Split Swap vs Borrow vs Liquidity) (≈ 2–3 weeks)

**Goal:** make `/swap` simple and reduce cognitive load.

**IA decision**
- **Preferred:** create *three routes* with shared layout.
  - `/swap` → Swap
  - `/borrow` → Vault/CDP
  - `/liquidity` → LP add/remove
  - Keep existing `/liquidity → /swap` redirect only if needed for backward compatibility.

**Implementation sketch**
- [x] New container: `website/src/EconomyApp.tsx`
  - tabs: Swap / Borrow / Liquidity (route-driven)
  - uses `useCasinoConnection` for shared state
- [x] Route mapping:
  - `/swap` → EconomyApp (Swap tab)
  - `/borrow` → EconomyApp (Borrow tab)
  - `/liquidity` → EconomyApp (Liquidity tab)
- [x] Split into dedicated panels:
  - `website/src/components/economy/SwapPanel.tsx` (new)
  - `website/src/components/economy/BorrowPanel.tsx` (new)
  - `website/src/components/economy/LiquidityPanel.tsx` (new)
- [x] Swap quick controls:
  - Flip direction + Max/% shortcuts (`website/src/components/economy/SwapPanel.tsx`)
- [x] Swap: inline validation + debounced quoting + confirm modal:
  - whole-number + >0 checks, balance checks, pool-not-initialized copy
  - 200ms quote debounce on typing
  - confirm dialog with “Confirming…” state (`website/src/components/ui/ConfirmModal.tsx`)
- [x] Liquidity: ratio helper:
  - auto-match spot ratio toggle (RNG↔vUSDT) (`website/src/components/economy/LiquidityPanel.tsx`)
- [x] Economy actions: client-side guards:
  - amount > 0 + balance checks for swap/borrow/liquidity handlers (`website/src/EconomyApp.tsx`)

**Swap panel spec**
- Inputs:
  - “You pay” (token select fixed to RNG/vUSDT for now) + amount
  - “You receive” + quote output (read-only)
  - “Max” + 25/50/75/100% shortcuts
  - Flip direction button
- Quote:
  - Show: rate, fee, burn (if sell), min received, slippage (as “Price tolerance”)
  - Use existing math in `estimateSwapOut` but move to `website/src/utils/ammQuote.js` + tests.
- Confirmation:
  - Confirm modal summarizing trade before submit.
  - Clear pending state: “Confirming onchain…”
  - Success state with “View in Explorer” link.

**Swap panel: validation + error copy (specific)**
- Invalid amount:
  - Inline: “Enter a whole number amount” (current parsing uses `BigInt` → integers only).
- Insufficient balance:
  - “Not enough RNG” / “Not enough vUSDT”
- Pool unavailable:
  - “AMM not initialized yet” (when reserves are 0).
- Slippage too tight / min out too high:
  - “Price moved; try increasing price tolerance”

**Swap panel: quote details**
Compute and display (direction-aware):
- `spotPrice`: `reserveVusdt / reserveRng`
- `executionPrice`: `amountIn / estOut` (or inverse for display)
- `priceImpactPct`: `(executionPrice - spotPrice) / spotPrice` (absolute %)
- `fee`: from `amm.feeBasisPoints`
- `burn`: only on RNG→vUSDT from `amm.sellTaxBasisPoints`

**Swap panel: UX states**
- `disconnected`: show “Connect to chain” (backend not reachable)
- `vault_locked`: show “Unlock vault to trade” with CTA to `/security`
- `not_registered`: show “Register to trade” with inline register button
- `ready`: swap inputs enabled
- `submitting`: disable inputs + show spinner + show tx hash
- `pending`: show “Pending confirmation…” + explorer link + “Resubmitting if needed…”

**Implementation notes**
- Move `estimateSwapOut` from `website/src/EconomyApp.tsx` to `website/src/utils/ammQuote.js` and add unit tests.
- Add a small debounce (150–250ms) for quote recompute on typing.
- Prefer real explorer tx digest (see Section 4.2) so “View in Explorer” is not a placeholder hash.

**Borrow panel spec (Vault/CDP)**
- Sections:
  - Vault status (created or not)
  - Collateral, debt, LTV, max borrow, available
  - Actions: create vault, deposit, borrow, repay
- Copy:
  - Explain virtual stable (vUSDT) and liquidation semantics (if any).

**Borrow panel: risk UI (must-have)**
- Always show:
  - “Max LTV: 50%”
  - a health indicator based on `ltvBps`:
    - <25% green, 25–40% gold, >40% accent
- Explicitly state: LTV uses AMM spot price (no external oracle).

**Liquidity panel spec**
- Position summary:
  - LP shares, estimated position value, share of pool
- Add/remove:
  - Add: input RNG + vUSDT (with ratio hint)
  - Remove: % shortcuts + shares input

**Liquidity panel: ratio helper**
- Default: “Auto-match ratio” enabled.
- Behavior:
  - entering RNG auto-fills vUSDT at current spot ratio
  - entering vUSDT auto-fills RNG at current spot ratio
- Allow “manual” mode (advanced users) by toggling off auto-match.

**Acceptance criteria**
- A new user can swap with only one card visible (Swap), without seeing Vault or LP.
- Borrow and LP features are discoverable but not forced into the primary swap flow.

---

### Milestone M3 — Staking UX Rebuild (Dashboard + Guided Flow) (≈ 2–3 weeks)

**Implementation sketch**
- New container: `website/src/StakingApp.tsx` becomes a composition of:
  - `StakingDashboard.tsx` (new)
  - `StakeFlow.tsx` (new)
  - `StakingAdvanced.tsx` (new; contains `Process Epoch (dev)` and house debug)

**Progress**
- [x] Hide “Process Epoch (dev)” + house debug behind an `Advanced` toggle in `website/src/StakingApp.tsx`.
- [x] Add stake amount max/% + duration presets + confirm dialog (with basic validation) in `website/src/StakingApp.tsx`.

**Stake flow spec**
- Step 1: Amount (Max + %)
- Step 2: Duration (preset buttons + custom)
- Step 3: Review (lock time, unlock ETA, voting power, reward model)
- Step 4: Confirm/pending/success

**Stake flow: presets + units (repo-specific)**
- Duration is interpreted as *views/blocks* (see `derived.locked` logic in `website/src/StakingApp.tsx`).
- Provide presets (example set):
  - 100 blocks (~5m)
  - 500 blocks (~25m)
  - 2,000 blocks (~1h 40m)
  - 10,000 blocks (~8h 20m)
- Always display both:
  - exact duration in blocks
  - approximate time (reuse `formatApproxTimeFromBlocks`)

**Stake flow: review copy (short + explicit)**
- “Voting power = amount × duration”
- “Rewards are funded from positive epoch net PnL”
- “APY is an estimate; rewards depend on future house performance”

**Dashboard spec**
- Primary tiles:
  - Staked balance
  - Claimable rewards
  - Unlock ETA (if locked)
  - Share of staking power
- Actions:
  - Stake more
  - Claim (disabled if 0)
  - Unstake (disabled if locked, with tooltip)

**Dashboard spec: single primary CTA**
- Not registered → primary CTA “Register to stake”
- Registered + stake = 0 → “Stake RNG”
- Stake > 0 + claimable > 0 → “Claim rewards”
- Locked → show “Unlocks in …” + disabled Unstake with tooltip

**Acceptance criteria**
- Default `/stake` shows only user-relevant actions; “Process Epoch” is hidden behind Advanced.

---

### Milestone M4 — Casino UX Upgrades Across 10 Games (≈ 3–6 weeks; parallelizable)

**Cross-cutting upgrades**
- [x] Make every game fully playable via taps:
  - Convert non-clickable controls in `HiLoView` and `VideoPokerView` to buttons wired to actions.
  - Ensure “Deal” is clickable everywhere.
- [x] Add consistent “Info” access:
  - Use `MobileDrawer` for paytable/rules across all games (not only some).
- [x] Improve “what happens next” prompts:
  - In each `*View.tsx`, show a clear CTA state (“Place bet”, “Choose action”, “Press Deal”).
- [x] Unify control bar component:
  - Introduce `GameControlBar` (new) to standardize spacing, tap targets, safe-area behavior.
- [x] Sound + motion settings:
  - Add settings toggles (sound, reduced motion) in `Layout` header.
  - Respect `prefers-reduced-motion`.

**Cross-cutting upgrades: required click wiring (must-do)**
- [x] Pass `actions` into `HiLoView` and `VideoPokerView`:
  - Update `website/src/components/casino/ActiveGame.tsx`:
    - `HiLoView` currently receives no actions, so it cannot be played via taps.
    - `VideoPokerView` receives no draw action, so draw is keyboard-only.
- [x] Replace non-interactive `<div>` controls with `<button>` elements:
  - ensures accessibility, focus, and correct tap behavior.

**GameControlBar spec (shared)**
Create `website/src/components/casino/GameControlBar.tsx` (new) to unify:
- bottom positioning + safe-area padding
- consistent button sizing (≥44px on mobile)
- overflow behavior (horizontal scroll for many buttons)
- consistent “primary action” emphasis (Deal/Spin/Draw/Cashout)

**Audio + motion settings (spec)**
- Add a lightweight SFX service:
  - `website/src/services/sfx.ts` (new) with `play(name)` and a simple on/off flag
- Respect reduced motion:
  - globally honor `prefers-reduced-motion`
  - disable particle-heavy win effects when reduced motion is on

**Per-game focus areas (high impact first)**
- HiLo (`website/src/components/casino/games/HiLoView.tsx`)
  - [x] Split-screen Higher/Lower tap targets on mobile; make Cashout the dominant CTA.
- Video Poker (`website/src/components/casino/games/VideoPokerView.tsx`)
  - [x] Add clickable Draw; add paytable; highlight detected hand.
- Blackjack (`website/src/components/casino/games/BlackjackView.tsx`)
  - [x] Make insurance prompt explicit; disable invalid actions; add split-hand recap.
- Roulette/Craps/SicBo (`website/src/components/casino/games/{Roulette,Craps,SicBo}View.tsx`)
  - [x] Move more bet entry to taps/table hotspots; keep numeric input as fallback.
- Baccarat / Three Card / UTH (`website/src/components/casino/games/{Baccarat,ThreeCardPoker,UltimateHoldem}View.tsx`)
  - [x] Stage banners + side-bet clarity + confirmation of bet totals.
- Casino War (`website/src/components/casino/games/GenericGameView.tsx`)
  - [x] War/Surrender decision as a focused modal prompt.

**Per-game acceptance checks (tap-only)**
- Blackjack:
  - insurance prompt has a dedicated UI state (not only message text)
  - split hands: active hand is obvious; completed hands are summarized
- Roulette:
  - rebet/undo are reachable via taps
  - inside bets can be placed without numeric typing (table hotspots or preset buttons)
- Craps:
  - core bets (pass/don’t/field/place) can be placed without numeric typing
  - exposure remains available in `MobileDrawer`
- Baccarat:
  - side bets are visually secondary; total bet amount is visible before deal
- Three Card / Ultimate Hold’em:
  - stage banner clearly indicates decision point (bet vs check vs fold)
- Video Poker:
  - Draw is clickable; paytable visible; detected hand is highlighted
- HiLo:
  - Higher/Lower/Cashout are clickable; multiplier projections are visible
- Casino War:
  - War/Surrender prompt is unmissable and correctly gated to tie state

**Acceptance criteria**
- On mobile: user can complete a full round of each game without keyboard input.
- Help/Info is reachable in ≤ 1 tap from each game.

---

### Milestone M5 — Mobile Web “App-Grade” Spec (≈ 2–4 weeks; overlaps)

**Layout + interaction**
- [x] Safe-area support:
  - Update `website/index.html` viewport meta to include `viewport-fit=cover` if needed.
  - Ensure bottom bars use safe-area padding.
- [x] Tap targets:
  - Enforce ≥44px on critical buttons; increase control bar height.
- [x] Touch-friendly inputs:
  - Numeric inputs use `inputMode="numeric"` and appropriate `pattern`.
- [x] Performance:
  - Reduce heavy overlays/particles on low-end; `prefers-reduced-motion` fallback.
  - Lazy-load non-critical panels (Borrow/LP, heavy charts).

**Breakpoints (Tailwind conventions used in repo)**
- `<640px` (`sm`): primary phone layout (single column, stacked panels)
- `≥768px` (`md`): enable side panels (leaderboard) and multi-column layouts

**Touch targets**
- Primary actions: min height 44px; avoid cramped buttons inside horizontal scrollers.
- Replace hover-only affordances with explicit tap affordances (buttons, drawers).

**Performance budgets (targets)**
- First usable interaction:
  - desktop: <2.5s on local dev
  - phone: <4s on mid-range Android
- Avoid constant 1s polling when WS events can drive updates; use polling only as fallback.

**QA matrix**
- Phones: iPhone SE/13/15, Pixel 7, low-end Android
- Tablets: iPad
- Orientations: portrait primary, landscape supported

**Acceptance criteria**
- “Tap-only” usability on phones; no clipped UI; consistent nav; smooth animations.

---

### Milestone M6 — Responsible Play Controls (≈ 1–2 weeks; should ship early)

**Client-side first (fast, low-risk)**
- [x] Add “Reality check” timer (e.g., every 15/30/60 minutes) that interrupts with a summary:
  - session time, net PnL, option to continue or stop.
- [x] Add optional limits (localStorage):
  - max wager per round
  - max loss per session
  - max session duration
- [x] Add a “cooldown” button (locks play UI for N minutes).

**Where**
- UI + settings: `website/src/components/casino/Layout.tsx`
- Enforcement: `website/src/hooks/useTerminalGame.ts` (bet-setting and start/deal actions)

**Acceptance criteria**
- Limits are visible, configurable, and enforced consistently across games.

---

### Milestone M7 — QA, Rollout, and Hardening (continuous)

**Testing**
- [x] Add unit tests for quote math and amount parsing:
  - `website/src/utils/ammQuote.js`
  - `website/src/utils/amounts.js`
  - `website/test/ammQuote.test.js`
- [x] Add Playwright “smoke” flows (existing dependency is present in `website/package.json`):
  - open app → unlock vault (mock/local) → swap → stake → play a game

**Receipts (Explorer deep links)**
- [x] Make “LAST TX” link to a real explorer tx hash:
  - WASM helper: `website/wasm/src/lib.rs` `digest_transaction(tx_bytes)`
  - Client plumbing: `website/src/api/wasm.js` + `website/src/api/nonceManager.js` (`txDigest`)
  - UI links: `website/src/EconomyApp.tsx` + `website/src/StakingApp.tsx`

**Rollout**
- [x] Feature flags for new Swap/Staking UI:
  - allow shipping iteratively while keeping old pages as fallback.
- [x] Telemetry (optional but recommended):
  - track abandonment points (swap flow step dropoffs, staking flow failures).

---

## 6) Route Map (Proposed)

Current (selected):
- `/` → Casino
- `/swap` → EconomyApp (Swap tab)
- `/borrow` → EconomyApp (Borrow tab)
- `/liquidity` → EconomyApp (Liquidity tab)
- `/stake` → StakingApp
- `/security` → Vault
- `/explorer/*` → Explorer

Proposed:
- `/swap` → EconomyApp (Swap tab)
- `/borrow` → EconomyApp (Borrow tab)
- `/liquidity` → EconomyApp (Liquidity tab)
- Keep `/swap` as the “default” money surface for newcomers.

---

## 7) Event → UX Mapping (For Confirmations and Activity)

Use WS events to confirm submissions (reduce reliance on 1s polling):

- Swap: `AmmSwapped` → success toast + update balances
- Add LP: `LiquidityAdded` → success toast + update LP position
- Remove LP: `LiquidityRemoved` → success toast + update LP position
- Stake: `Staked` → success toast + update stake
- Unstake: `Unstaked` → success toast + update balances
- Claim: `RewardsClaimed` → success toast + update balances
- Errors: `CasinoError` → error toast with friendly copy

Fallback:
- If no confirmation after N seconds, show “Still pending” and keep resubmission logic.

---

## 8) Work Breakdown (Suggested Team Parallelization)

If we have multiple engineers, parallelize by surface area:

- **Engineer A (Economy):** M2 swap/borrow/lp refactor + quote utils + tx tracker
- **Engineer B (Staking):** M3 staking dashboard + step flow + shared amount inputs
- **Engineer C (Casino/mobile):** M0/M1/M4 mobile discovery + playable controls + help + bottom nav
- **Engineer D (Infra/tests):** M4 shared control bar + settings + M7 Playwright smoke + unit tests

---

## 9) Definition of Done (Product)

“Professional-grade” is achieved when:

- Every game is playable and understandable on mobile without keyboard.
- Swap and stake flows are clean, guided, and confirm reliably with clear receipts.
- Navigation and wallet status are consistent across the app.
- Responsible play controls exist and are easy to use.
- Basic automated checks exist for critical money flows.

---

## 10) Appendix — Detailed UX Flows (Step-by-step)

### 10.1) New user “happy path” (mobile, dev setup)
1. Open `/` → ModeSelect appears (`website/src/components/casino/ModeSelectView.tsx`).
2. Tap “CASH GAME”.
3. Tap `Vault` tab → `/security` (`website/src/SecurityApp.tsx`).
4. Tap “CREATE PASSKEY VAULT” → vault becomes unlocked.
5. Back to `Play` → tap “GAMES” → pick a game.
6. Tap “DAILY FAUCET” (cash mode) to mint RNG.
7. Tap “DEAL” → complete a round; observe win/loss feedback.
8. Tap “SWAP” → perform RNG↔vUSDT swap; see min received and fee/tax.
9. Tap “STAKE” → stake with a preset duration; see pending → confirmed.
10. Tap “EXPLORER” → confirm the tx receipt exists.

### 10.2) Vault locked “blocked action” (expected behavior)
1. User has `nullspace_vault_enabled=true` but vault is locked.
2. Any page requiring signing calls `getOrCreateKeypair()` and receives `null`.
3. UI shows a single CTA:
   - “Unlock vault to continue” → routes to `/security`
4. No silent failures; no confusing “Failed to connect” when the actual issue is the vault.

### 10.3) Swap flow (buy RNG with vUSDT)
1. Open `/swap` and select direction `vUSDT → RNG`.
2. Enter amount (use Max or %).
3. Quote shows:
   - estimated out
   - minimum out (price tolerance)
   - fee
   - price impact
4. Tap “Swap” → confirm modal summarizing trade.
5. Submit → show pending status until `AmmSwapped` event.
6. Success toast includes link to `/explorer/tx/<hash>`.

### 10.4) Stake flow (stake RNG)
1. Open `/stake`.
2. If not registered, tap “Register”.
3. Enter amount (Max) and choose duration preset.
4. Review shows unlock ETA + voting power.
5. Submit → pending until `Staked` event.
6. Claim rewards is enabled only when claimable > 0.

### 10.5) Tournament (Freeroll) flow (mobile)
1. Open `/` → select “FREEROLL”.
2. Lobby shows:
   - next start in
   - entries left today
   - join/enter CTA
3. Join tournament → confirmation appears.
4. Enter tournament when active → start playing.
5. End tournament → payout summary is visible.

---

## 11) Appendix — Manual QA Scripts (High Value)

### 11.0) Mobile QA pass (detailed, dev)

This is a **touch-only** QA checklist intended for a real phone browser (Safari iOS / Chrome Android).

#### 0) Prep: run the full stack
1. Ensure `website/.env` includes:
   - `VITE_IDENTITY=<96-byte hex>`
   - `VITE_URL=http://localhost:8080`
2. Build binaries (once):
   - `cargo build --release --bin nullspace-simulator -p nullspace-simulator`
   - `cargo build --release --bin dev-executor -p nullspace-client`
3. Start backend services (two terminals):
   - Simulator: `./target/release/nullspace-simulator -i <IDENTITY_HEX> -p 8080`
   - Dev executor: `./target/release/dev-executor -i <IDENTITY_HEX> -u http://localhost:8080`
4. Start frontend (LAN-accessible):
   - `npm -C website run dev -- --host 0.0.0.0 --port 3000 --strictPort`

#### 1) Connect from phone
1. Find your laptop LAN IP:
   - `hostname -I | awk '{print $1}'`
2. On your phone (same Wi‑Fi), open:
   - `http://<LAN_IP>:3000/`

Notes:
- Passkeys/WebAuthn generally require a secure context (HTTPS or localhost). On `http://<LAN_IP>:3000`, `/security` may show “Passkeys unavailable” on mobile — that is expected.

#### 2) Global mobile UX smoke
On `/` (casino), in **portrait** then **landscape**:
- No clipped UI, no horizontal scroll, no unreadable overlays.
- Tap targets feel ≥44px for primary actions (especially control bars).
- `Games` button opens game menu (no keyboard).
- `Help` button opens/closes Help overlay reliably.
- `Safety` button opens Responsible Play overlay.
- Wallet pill renders (mobile in-content; desktop in header; other routes in header).

#### 3) Casino settings + “what next”
On `/`:
- Open Settings drawer (`SET`) and toggle:
  - Sound SFX ON/OFF (deal/win sounds stop when OFF).
  - Motion LOW/FULL (animations reduce when LOW).
  - Touch Mode ON/OFF (hides key glyphs but keeps actions tappable).
- Verify the “NEXT:” prompt appears when you’re expected to act (bet vs play vs result).

#### 4) Per-game touch-only checklist (all 10 games)
For each game: **select game → place bet (or accept default) → primary action (Deal/Spin/Draw) → make at least one in-round decision → reach RESULT → start next round**.

1. Blackjack
   - Hit/Stand (and any available decision) works via taps.
   - Insurance prompt (if shown) has clear tap actions.
   - Split-hand flow (when it occurs) remains tappable and readable.
2. Roulette
   - Place at least one bet without typing.
   - Spin/deal is tappable.
   - Rebet/undo (if present) reachable via taps.
3. Craps
   - Place at least one core bet via taps (Pass/Field/etc per UI).
   - Mobile exposure drawer is reachable and scrollable.
   - Roll/deal is tappable; results don’t overflow.
4. Sic Bo
   - Place a bet via tap UI and roll.
   - Any “sum/target” flows do not require keyboard.
5. HiLo
   - HIGHER / LOWER / CASHOUT tappable.
   - Multiplier projections visible and not clipped.
6. Video Poker
   - Tap cards to toggle HOLD works.
   - DRAW is tappable.
   - Paytable drawer works; winning rank highlights on RESULT.
7. Baccarat
   - Stage badge shows decision point clearly.
   - Total bet + side bet amounts visible before dealing.
8. Three Card
   - Stage badge visible; primary action obvious (bet/check/fold flow via taps).
9. Ultimate Hold’em
   - Stage badge visible (street progression).
   - Total bet shown; bet row wraps cleanly on phone.
10. Casino War
   - If a tie occurs, War/Surrender prompt is unmissable and tappable.

#### 5) Responsible play / safety checks
On `/` → `Safety`:
- Set Max wager to a low value (e.g. `1`), attempt to bet higher → clamps/blocks with clear message.
- Set Cooldown (5m), try to start a new round → blocked at round boundary.
- Set Reality check to `1` minute, play until triggered → overlay interrupts before next round; Continue/Stop works.

#### 6) Economy (Swap/Borrow/Liquidity) mobile pass
Use bottom nav or open `/swap`, `/borrow`, `/liquidity`.

Swap (`/swap`)
- Register + Faucet are tappable; numeric inputs bring numeric keyboard.
- Enter amount (whole number), see quote update; Flip direction; Max/% shortcuts.
- Confirm modal opens; confirm/cancel works; not clipped on small screens.
- After submit/confirm:
  - `LAST TX` becomes a link when digest exists.
  - Toast appears on confirmation.
  - Activity shows PENDING → OK and links to explorer receipt.

Borrow (`/borrow`)
- Create vault → deposit collateral → borrow → repay:
  - Each action shows pending/confirmed in Activity.
  - LTV/availability stays readable on mobile.

Liquidity (`/liquidity`)
- Add/remove liquidity validated and tappable.
- Ratio helper (if enabled) behaves sensibly on small screens.

#### 7) Staking mobile pass (`/stake`)
- Stake amount shortcuts work; confirm modal works.
- After submit:
  - Toast appears on confirmation.
  - Activity shows PENDING → OK and links to explorer receipt.
- Toggle “Advanced” and confirm dev controls are clearly separated.

#### 8) Explorer receipt checks
From Economy/Staking:
- Tap an Activity item with a receipt → opens `/explorer/tx/<digest>` and is readable on mobile.
- Explorer pages scroll correctly and don’t collide with bottom nav.

#### 9) Security page expectations on mobile
On `/security`:
- On plain HTTP LAN, passkeys may be unavailable — confirm no crashes and the page renders.
- In DEV tools:
  - Export/Clear Telemetry works (clipboard may fail on mobile → download fallback expected).
  - Export/Clear Activity works.

#### 10) If something fails (what to capture)
- Screenshot + device + browser version + orientation.
- `/security` dev tools:
  - Export Telemetry JSON.
  - Export Activity JSON.
- Note route and `LAST TX` digest (if present).

### 11.1) Casino tap-only checklist
- Start a game via tap (no keyboard)
- Place bet size via UI (or ensure default bet is visible/adjustable)
- Trigger primary action (Deal/Spin/Draw) via tap
- Complete a round and see result feedback
- Open game Info drawer and read rules/paytable

### 11.2) Economy checklist
- Swap buy + sell directions
- Verify min received updates with slippage
- Add liquidity with auto-match ratio
- Borrow within 50% LTV
- Repay and verify LTV decreases

### 11.3) Staking checklist
- Stake with preset duration
- Verify lock state disables Unstake
- Claim rewards when available
- Ensure Advanced “Process Epoch” is hidden by default

---

## 12) Appendix — Game-by-Game UX Backlog (Repo-Mapped)

This section turns Milestone M4 into an actionable per-game backlog. Each item references the current UI file and the expected improvements.

### 12.0) Shared requirements (apply to all games)
- Every primary action is a `<button>` with:
  - min height 44px on mobile
  - disabled states + tooltip text
  - sound/haptic hooks (if enabled)
- Every game has:
  - a one-tap “Info” entry (mobile drawer) with **rules + payouts + controls**
  - a visible “Next action” prompt (not only a message string)
  - a “Play again / new round” CTA after result

### 12.1) Blackjack
- UI: `website/src/components/casino/games/BlackjackView.tsx`
- Must-fix
  - Add a dedicated insurance prompt UI state (when allowed), not only `gameState.message`.
  - Disable Hit/Stand/Double/Split when not legal and show why (e.g., “No split available”).
  - Improve split-hand clarity: show active hand highlight and completed-hand recap.
- Nice-to-have
  - Add 21+3 info drawer content (paytable and example).
  - Add subtle “dealer reveal” pacing (purely visual timing, no outcome changes).

### 12.2) Baccarat
- UI: `website/src/components/casino/games/BaccaratView.tsx`
- Must-fix
  - Show **total wager** before Deal (main + side bets).
  - Side bets appear visually secondary; main selection remains primary.
  - Improve bet list readability on mobile (drawer shows bet types + amounts).
- Nice-to-have
  - Add history “road” strip (recent outcomes: P/B/T).
  - Add clear banker commission note (0.95:1).

### 12.3) Casino War
- UI: `website/src/components/casino/games/GenericGameView.tsx`
- Must-fix
  - War/Surrender decision becomes a focused prompt (modal-like), not buried in a bar.
  - Tie bet UI: show whether tie bet is active and its cost.
- Nice-to-have
  - Add short explanation for War resolution and tie bet payout.

### 12.4) Craps
- UI: `website/src/components/casino/games/CrapsView.tsx`
- Must-fix
  - Core bets tappable with minimal modes:
    - Pass / Don’t Pass, Field, Place (4/5/6/8/9/10) via tap chips
  - Preserve numeric input as fallback, but do not require it for common actions.
  - Exposure stays available via `MobileDrawer`.
- Nice-to-have
  - Add “Rebet” and “Undo” prominence on mobile.
  - Add small payout previews for selected bets.

### 12.5) Roulette
- UI: `website/src/components/casino/games/RouletteView.tsx`
- Must-fix
  - Inside bets (straight/split/street/corner/six-line) should be placable via taps:
    - table hotspot grid, or a compact picker UI
  - Rebet/Undo/Double bet accessible without keyboard.
  - History strip (last N numbers) visible.
- Nice-to-have
  - Add a more “wheel-like” feel: brief spin pacing + highlight winning number.

### 12.6) Sic Bo
- UI: `website/src/components/casino/games/SicBoView.tsx`
- Must-fix
  - Ensure all bet placements are reachable via taps on mobile.
  - Improve bet list readability (target labels for Domino/Hops).
- Nice-to-have
  - Show payout odds inline when selecting bet types.

### 12.7) Three Card Poker
- UI: `website/src/components/casino/games/ThreeCardPokerView.tsx`
- Must-fix
  - Stage clarity: BETTING → DEAL → PLAY/FOLD → RESULT.
  - Side bet toggles are clear and show cost.
- Nice-to-have
  - Show “dealer qualifies?” state more explicitly.

### 12.8) Ultimate Texas Hold’em
- UI: `website/src/components/casino/games/UltimateHoldemView.tsx`
- Must-fix
  - Always-visible stage banner (preflop/flop/river) with decision guidance.
  - Bet multipliers (4x/3x/2x/1x) are big and tappable on mobile.
- Nice-to-have
  - Show a small “hand strength” hint (no strategy coaching required; just evaluation).

### 12.9) Video Poker
- UI: `website/src/components/casino/games/VideoPokerView.tsx`
- Must-fix
  - “Draw” must be clickable (currently display-only).
  - Paytable visible (drawer or panel), and current hand result highlighted.
- Nice-to-have
  - Optional “auto-hold suggestion” (off by default) using `evaluateVideoPokerHand`.

### 12.10) Hi-Lo
- UI: `website/src/components/casino/games/HiLoView.tsx`
- Must-fix
  - Higher/Lower/Cashout must be clickable (currently display-only).
  - Mobile layout: split-screen Higher vs Lower; Cashout prominent after each win.
- Nice-to-have
  - Add a clearer “risk meter” (multiplier vs odds) with honest presentation.

---

## 13) Appendix — Error Copy + Mapping (CasinoError)

The backend emits `Event::CasinoError { error_code, message, ... }`. For professional UX:
- Prefer mapping by `error_code` where possible, with `message` as detail.
- When `message` strings are inconsistent (e.g., “Insufficient chips” vs “Insufficient RNG”), normalize them in UI copy.

### 13.1) Recommended mapping (economy + staking)
| Backend signal | Suggested user-facing copy |
|---|---|
| `ERROR_INSUFFICIENT_FUNDS` + “Insufficient chips” | “Not enough RNG to complete this action.” |
| “Vault not found” | “Create a vault first.” |
| “Vault already exists” | “Vault already created.” |
| “Insufficient collateral (Max 50% LTV)” | “Borrow limit reached (max 50% LTV).” |
| “Slippage limit exceeded” | “Price moved; increase price tolerance and try again.” |
| staking locked / cannot unstake (message varies) | “Stake is still locked. Unstake available after unlock.” |

### 13.2) Implementation suggestion
- Add `website/src/utils/friendlyError.ts` (new):
  - `friendlyCasinoError(error_code, message) -> { title, detail }`
- Use it in:
  - `website/src/LiquidityApp.tsx` (or new EconomyApp panels)
  - `website/src/StakingApp.tsx`
  - `website/src/hooks/useTerminalGame.ts` (for casino play errors)
