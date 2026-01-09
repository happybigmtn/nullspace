# L54 - Economy UI components (from scratch)

Focus directories:
- `website/src/components/economy/`
- `website/src/components/staking/`

Goal: explain how the UI presents DeFi primitives (CDP vaults, AMM swaps, liquidity pools, staking) to users. These components bridge on-chain financial state with reactive user interfaces, handling input validation, state synchronization, and transaction submission. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) DeFi UI primitives

DeFi applications require specialized UI patterns:
- **CDP (Collateralized Debt Position)**: Users deposit collateral to borrow synthetic assets. The UI must show health ratios, liquidation thresholds, and available borrow capacity.
- **AMM (Automated Market Maker)**: Constant product pools for token swaps. The UI must compute quotes, handle slippage, and display pool reserves.
- **Liquidity provision**: Users deposit pairs of tokens. The UI must maintain reserve ratios and handle share accounting.
- **Staking**: Time-locked token deposits earning rewards. The UI must display voting power, unlock times, and reward accrual.

### 2) State management in financial UIs

Financial UIs differ from typical CRUD apps:
- **Derived state**: Health ratios, prices, and available liquidity are computed from chain state, not stored.
- **BigInt arithmetic**: All financial calculations use native BigInt to avoid floating-point precision errors.
- **Input parsing**: User inputs must be validated as whole numbers (no decimals in this system).
- **Optimistic updates**: UIs show pending state before chain confirmation to reduce perceived latency.

### 3) Error boundaries and validation

Financial transactions are irreversible. The UI must:
- Validate inputs before allowing submission.
- Show clear error messages when conditions aren't met.
- Disable actions when preconditions fail (insufficient balance, pool not ready, etc.).
- Provide confirmation modals for destructive actions.

### 4) Responsive financial data

DeFi UIs must react to:
- **Price changes**: AMM prices change with every swap.
- **Balance updates**: User balances change from deposits, withdrawals, and swaps.
- **Time-based state**: Staking locks expire, epochs process, rewards accrue.
- **Multi-user state**: Pool reserves and global state change from other users' actions.

---

## Limits & management callouts (important)

### 1) BigInt precision and overflow
- All amounts use BigInt for exact integer math.
- Division rounds down (integer division).
- No overflow protection: inputs must be validated to prevent extreme values.

### 2) Input validation constraints
- `parseAmount()` returns `null` for invalid inputs, `0n` for empty, or BigInt for valid.
- Negative amounts are rejected.
- Non-numeric inputs are rejected.
- Empty inputs are treated as zero to improve UX.

### 3) AMM quote computation
- Constant product formula: `x * y = k`
- Fees are deducted from input before computing output.
- Sell tax (burn) is applied only on RNG→vUSDT swaps.
- Slippage tolerance creates a minimum output threshold.

### 4) Staking mechanics
- Voting power = amount × duration (blocks).
- Rewards are distributed proportionally by voting power.
- Stakes are locked until `unlockTimestamp` passes.
- Epochs must be processed manually (dev mode) or by keepers (production).

### 5) CDP health calculation
- LTV = (debt / collateral_value) in basis points.
- Health zones: SAFE (<80% of max), CAUTION (80%-liquidation), RISK (>liquidation).
- Liquidation threshold is higher than max LTV to provide buffer.
- Available borrow = max_debt - current_debt, clamped to pool liquidity.

---

## Walkthrough with code excerpts

### 1) BorrowPanel: CDP vault interface

**File**: `website/src/components/economy/BorrowPanel.tsx`

```tsx
const health = useMemo(() => {
  const ltvBps = vaultDerived.ltvBps;
  const maxLtv = vaultDerived.maxLtvBps;
  const liquidation = vaultDerived.liquidationThresholdBps;
  const safeCutoff = Math.max(1, Math.floor(maxLtv * 0.8));
  if (ltvBps < safeCutoff) return { label: 'SAFE', className: 'text-action-success' };
  if (ltvBps < liquidation) return { label: 'CAUTION', className: 'text-action-primary' };
  return { label: 'RISK', className: 'text-action-destructive' };
}, [vaultDerived.liquidationThresholdBps, vaultDerived.ltvBps, vaultDerived.maxLtvBps]);
```
**Lines 63-71**

Why this matters:
- Users need instant visual feedback about vault health to avoid liquidation.
- The health indicator must be computed reactively as LTV changes.

What this code does:
- Computes three health zones using LTV and max LTV thresholds.
- SAFE = below 80% of max LTV (conservative buffer).
- CAUTION = between 80% and liquidation threshold.
- RISK = above liquidation threshold (immediate danger).
- Returns both a label and a CSS class for color-coded display.

---

```tsx
<div className="border border-gray-800 rounded p-3 bg-black/30">
  <div className="text-[10px] text-gray-500 tracking-widest">LTV</div>
  <div className="flex items-baseline gap-2 mt-1">
    <div className="text-white">{(vaultDerived.ltvBps / 100).toFixed(2)}%</div>
    <div className={['text-[10px] tracking-widest', health.className].join(' ')}>{health.label}</div>
  </div>
  <div className="text-[10px] text-gray-600">
    max {(vaultDerived.maxLtvBps / 100).toFixed(2)}% · {vaultDerived.tierLabel}
  </div>
  <div className="text-[10px] text-gray-600">
    liq {(vaultDerived.liquidationThresholdBps / 100).toFixed(2)}% · fee {(vaultDerived.stabilityFeeAprBps / 100).toFixed(2)}% APR
  </div>
</div>
```
**Lines 86-98**

Why this matters:
- Users need to see their current LTV, max allowed LTV, liquidation threshold, and stability fee all at once.
- These values determine borrowing capacity and risk.

What this code does:
- Displays current LTV percentage with color-coded health label.
- Shows max LTV and tier (tiers have different risk parameters).
- Shows liquidation threshold and annual stability fee.
- All values are in basis points on-chain, divided by 100 for display.

---

```tsx
<div className="flex items-center gap-2">
  <input
    className="flex-1 bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
    value={borrowAmount}
    onChange={(e) => setBorrowAmount(e.target.value)}
    placeholder="Borrow (vUSDT)"
    inputMode="numeric"
    pattern="[0-9]*"
  />
  <button
    className="text-xs px-3 py-1 rounded border border-action-destructive text-action-destructive hover:bg-action-destructive/10"
    onClick={onBorrowVusdt}
  >
    Borrow
  </button>
</div>
```
**Lines 129-144**

Why this matters:
- Borrowing increases debt and LTV, so the action must be clearly marked as potentially risky.
- The input must be controlled and validated before submission.

What this code does:
- Creates a controlled input for borrow amount with numeric keyboard on mobile.
- Uses `pattern="[0-9]*"` to hint integer-only input.
- Borrow button uses destructive (red) color to signal risk.
- Parent component validates the input before allowing submission.

---

### 2) Savings pool integration

**File**: `website/src/components/economy/BorrowPanel.tsx`

```tsx
<div className="mt-6 border-t border-gray-800 pt-4">
  <div className="text-[10px] text-gray-500 tracking-widest">SAVINGS (vUSDT)</div>
  <div className="grid grid-cols-2 gap-3 text-sm mt-3">
    <div className="border border-gray-800 rounded p-3 bg-black/30">
      <div className="text-[10px] text-gray-500 tracking-widest">DEPOSIT BALANCE</div>
      <div className="text-white mt-1">{savingsBalance?.depositBalance ?? 0}</div>
    </div>
    <div className="border border-gray-800 rounded p-3 bg-black/30">
      <div className="text-[10px] text-gray-500 tracking-widest">UNCLAIMED</div>
      <div className="text-white mt-1">{savingsBalance?.unclaimedRewards ?? 0}</div>
    </div>
    <div className="border border-gray-800 rounded p-3 bg-black/30">
      <div className="text-[10px] text-gray-500 tracking-widest">POOL TVL</div>
      <div className="text-white mt-1">{savingsPool?.totalDeposits ?? 0}</div>
    </div>
    <div className="border border-gray-800 rounded p-3 bg-black/30">
      <div className="text-[10px] text-gray-500 tracking-widest">REWARDS ACCRUED</div>
      <div className="text-white mt-1">{savingsPool?.totalRewardsAccrued ?? 0}</div>
    </div>
  </div>
```
**Lines 163-182**

Why this matters:
- Savings pools are a yield-bearing vUSDT deposit mechanism.
- Users need to see personal balance, unclaimed rewards, and pool-wide stats.

What this code does:
- Displays personal deposit balance and unclaimed rewards in the top row.
- Displays pool-wide TVL (total value locked) and total rewards accrued in bottom row.
- Uses optional chaining to safely handle null state.
- Provides context: users can see their share of the pool implicitly.

---

### 3) LiquidityPanel: Auto-ratio matching

**File**: `website/src/components/economy/LiquidityPanel.tsx`

```tsx
const [autoMatchRatio, setAutoMatchRatio] = useState(true);
const [lastEdited, setLastEdited] = useState<'RNG' | 'vUSDT'>('RNG');

const reserveRng = BigInt(amm?.reserveRng ?? 0);
const reserveVusdt = BigInt(amm?.reserveVusdt ?? 0);
const poolReady = reserveRng > 0n && reserveVusdt > 0n;
```
**Lines 36-41**

Why this matters:
- Liquidity providers must deposit tokens in the pool's reserve ratio to avoid price impact.
- Auto-matching makes this easier by automatically computing the second amount.

What this code does:
- `autoMatchRatio` controls whether the UI syncs both inputs.
- `lastEdited` tracks which input the user changed last (to determine sync direction).
- `poolReady` ensures reserves are non-zero before computing ratios.
- Reserves are converted to BigInt for safe arithmetic.

---

```tsx
const syncFromRng = (rngText: string) => {
  if (!autoMatchRatio || !poolReady) return;
  const rngAmt = parseAmount(rngText);
  if (rngAmt === null) return;
  const vusdtAmt = (rngAmt * reserveVusdt) / reserveRng;
  setAddLiqVusdt(vusdtAmt.toString());
};

const syncFromVusdt = (vusdtText: string) => {
  if (!autoMatchRatio || !poolReady) return;
  const vusdtAmt = parseAmount(vusdtText);
  if (vusdtAmt === null) return;
  const rngAmt = (vusdtAmt * reserveRng) / reserveVusdt;
  setAddLiqRng(rngAmt.toString());
};
```
**Lines 48-62**

Why this matters:
- Users shouldn't have to manually compute reserve ratios.
- The UI computes the matching amount automatically, reducing errors.

What this code does:
- `syncFromRng`: given RNG amount, computes required vUSDT using reserve ratio.
- `syncFromVusdt`: given vUSDT amount, computes required RNG.
- Both functions guard against invalid input and unready pools.
- Uses BigInt arithmetic to maintain precision: `(input * reserve_out) / reserve_in`.
- Converts result back to string for controlled input display.

---

```tsx
<input
  className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
  value={addLiqRng}
  onChange={(e) => {
    setLastEdited('RNG');
    const next = e.target.value;
    setAddLiqRng(next);
    syncFromRng(next);
  }}
  placeholder="RNG"
  inputMode="numeric"
  pattern="[0-9]*"
/>
```
**Lines 115-127**

Why this matters:
- Controlled inputs require careful state management to avoid feedback loops.
- The input must update immediately, then trigger ratio sync.

What this code does:
- Marks 'RNG' as last edited so sync logic knows the direction.
- Updates local state with raw input (even if invalid).
- Calls `syncFromRng` to compute and update the vUSDT input.
- Uses `inputMode="numeric"` to show numeric keyboard on mobile.

---

### 4) SwapPanel: Quote computation and validation

**File**: `website/src/components/economy/SwapPanel.tsx`

```tsx
const [debouncedAmountIn, setDebouncedAmountIn] = useState(swapAmountIn);

useEffect(() => {
  const t = window.setTimeout(() => setDebouncedAmountIn(swapAmountIn), 200);
  return () => window.clearTimeout(t);
}, [swapAmountIn]);
```
**Lines 40-45**

Why this matters:
- AMM quotes are expensive to compute (BigInt arithmetic, reserve lookups).
- Debouncing prevents quote recalculation on every keystroke.

What this code does:
- Creates a debounced copy of the input that updates 200ms after user stops typing.
- Uses `useEffect` with cleanup to reset the timeout on each change.
- Quote computation uses debounced value to avoid jitter and excessive computation.

---

```tsx
const quote = useMemo(() => {
  const amtIn = debouncedAmountInParsed;
  if (amtIn === null) return { invalid: true, exceedsBalance: false, out: 0n, fee: 0n, burned: 0n, minOut: 0n };
  const exceedsBalance = amtIn > balanceIn;
  const isBuyingRng = swapDirection === 'BUY_RNG';
  const { out, fee, burned } = estimateSwapOut(amm, amtIn, isBuyingRng);
  const minOut = minOutWithSlippage(out, slippageBps);
  return { invalid: false, exceedsBalance, out, fee, burned, minOut };
}, [amm, balanceIn, debouncedAmountInParsed, slippageBps, swapDirection]);
```
**Lines 97-105**

Why this matters:
- Users need to see expected output, fees, and minimum guaranteed output before swapping.
- The quote must account for AMM fees, sell tax (burn), and slippage tolerance.

What this code does:
- Returns early with zero values if input is invalid.
- Checks if amount exceeds user's balance.
- Calls `estimateSwapOut` to compute swap output using constant product formula.
- Applies slippage tolerance to compute `minOut` (minimum acceptable output).
- Memoizes to avoid recalculation unless dependencies change.

---

**File**: `website/src/utils/ammQuote.js`

```js
export function estimateSwapOut(amm, amountIn, isBuyingRng) {
  if (!amm) return { out: 0n, fee: 0n, burned: 0n };
  if (typeof amountIn !== 'bigint' || amountIn <= 0n) return { out: 0n, fee: 0n, burned: 0n };

  const reserveRng = BigInt(amm.reserveRng ?? 0);
  const reserveVusdt = BigInt(amm.reserveVusdt ?? 0);
  const feeBps = BigInt(amm.feeBasisPoints ?? 0);
  const sellTaxBps = BigInt(amm.sellTaxBasisPoints ?? 0);

  if (reserveRng <= 0n || reserveVusdt <= 0n) return { out: 0n, fee: 0n, burned: 0n };

  let burned = 0n;
  let effectiveIn = amountIn;
  let reserveIn = reserveVusdt;
  let reserveOut = reserveRng;

  if (!isBuyingRng) {
    reserveIn = reserveRng;
    reserveOut = reserveVusdt;
    burned = (amountIn * sellTaxBps) / 10_000n;
    effectiveIn = amountIn - burned;
    if (effectiveIn <= 0n) return { out: 0n, fee: 0n, burned };
  }

  const fee = (effectiveIn * feeBps) / 10_000n;
  const netIn = effectiveIn - fee;
  if (netIn <= 0n) return { out: 0n, fee, burned };

  const denom = reserveIn + netIn;
  if (denom <= 0n) return { out: 0n, fee, burned };

  const out = (netIn * reserveOut) / denom;
  return { out, fee, burned };
}
```
**Lines 19-52**

Why this matters:
- This is the core AMM pricing logic. Errors here would cause mispriced trades.
- Must handle both buy and sell directions with different fee structures.

What this code does:
1. Validates inputs (non-null AMM, positive BigInt amount).
2. Validates reserves are non-zero (pool must be initialized).
3. If selling RNG: applies sell tax (burn), then computes effective input.
4. Computes swap fee as percentage of effective input.
5. Computes net input after fees.
6. Applies constant product formula: `out = (netIn * reserveOut) / (reserveIn + netIn)`.
7. Returns output, fee, and burned amounts separately for UI display.

**Important**: Division rounds down (integer division), which slightly favors the pool. This is standard in AMMs to prevent pool draining attacks.

---

```tsx
const validationMessage = useMemo(() => {
  if (!player) return 'Register to trade';
  if (amountInParsed === null) return 'Enter a whole number amount';
  if (amountInParsed <= 0n) return 'Enter an amount';
  if (amountInParsed > balanceIn) return `Not enough ${inToken}`;
  if (!poolReady) return 'AMM not initialized yet';
  if (isDebouncing) return 'Updating quote…';
  if (quote.out <= 0n) return 'Quote unavailable';
  return null;
}, [amountInParsed, balanceIn, inToken, isDebouncing, player, poolReady, quote.out]);

const canSubmit = !submitting && validationMessage === null;
```
**Lines 107-118**

Why this matters:
- Users must not be able to submit invalid swaps.
- Clear error messages guide users to fix issues.

What this code does:
- Checks preconditions in order of severity (authentication, input validity, balance, pool state).
- Returns first failing condition as a user-facing message.
- Returns `null` when all validations pass.
- `canSubmit` is true only when not submitting and no validation errors exist.
- Submit button is disabled when `!canSubmit`.

---

### 5) Policy-based trading limits

**File**: `website/src/components/economy/SwapPanel.tsx`

```tsx
const policyInfo = useMemo(() => {
  if (!policy || !amm || !player) return null;
  const reserveRng = BigInt(amm.reserveRng ?? 0);
  const reserveVusdt = BigInt(amm.reserveVusdt ?? 0);
  const balanceRng = BigInt(player.chips ?? 0);
  const balanceVusdt = BigInt(player.vusdtBalance ?? 0);
  const maxSellByBalance = (balanceRng * BigInt(policy.maxDailySellBpsBalance ?? 0)) / 10_000n;
  const maxSellByPool = (reserveRng * BigInt(policy.maxDailySellBpsPool ?? 0)) / 10_000n;
  const maxBuyByBalance = (balanceVusdt * BigInt(policy.maxDailyBuyBpsBalance ?? 0)) / 10_000n;
  const maxBuyByPool = (reserveVusdt * BigInt(policy.maxDailyBuyBpsPool ?? 0)) / 10_000n;
  const dailySellCap = maxSellByBalance < maxSellByPool ? maxSellByBalance : maxSellByPool;
  const dailyBuyCap = maxBuyByBalance < maxBuyByPool ? maxBuyByBalance : maxBuyByPool;
  // ...
}, [amm, player, policy]);
```
**Lines 53-86** (excerpt)

Why this matters:
- Trading limits prevent market manipulation and excessive outflow.
- Limits are computed as a percentage of both user balance and pool reserves.

What this code does:
- Computes max daily sell as minimum of balance-based and pool-based limits.
- Computes max daily buy similarly.
- Uses basis points (divide by 10,000) for percentage calculations.
- Takes the minimum to ensure both constraints are respected.
- Returns `null` if any required data is missing.

---

```tsx
const outflowBps = reserveRng > 0n
  ? Number((dailyNetSell * 10_000n) / reserveRng)
  : 0;
const sellTaxMin = Number(policy.sellTaxMinBps ?? 0);
const sellTaxMid = Number(policy.sellTaxMidBps ?? 0);
const sellTaxMax = Number(policy.sellTaxMaxBps ?? 0);
const outflowLow = Number(policy.sellTaxOutflowLowBps ?? 0);
const outflowMid = Number(policy.sellTaxOutflowMidBps ?? 0);
const currentSellTaxBps = outflowBps < outflowLow ? sellTaxMin : outflowBps < outflowMid ? sellTaxMid : sellTaxMax;
```
**Lines 67-75**

Why this matters:
- Sell tax increases when net outflow is high to stabilize the pool.
- This creates a dynamic fee that responds to market pressure.

What this code does:
- Computes current outflow as percentage of pool reserves.
- Defines three tax bands (min, mid, max) with corresponding outflow thresholds.
- Selects current tax based on which band the outflow falls into.
- Lower outflow = lower tax (encourage normal trading).
- Higher outflow = higher tax (discourage panic selling).

---

### 6) StakeFlow: Time-locked staking with voting power

**File**: `website/src/components/staking/StakeFlow.tsx`

```tsx
const setPercent = (pct: number) => {
  const clamped = Math.max(0, Math.min(100, Math.floor(pct)));
  const value = (balanceIn * BigInt(clamped)) / 100n;
  setSwapAmountIn(value.toString());
};
```
**Lines 120-124** (similar pattern in StakeFlow.tsx, lines 73-84)

Why this matters:
- Users frequently want to stake a percentage of their balance (25%, 50%, all).
- Percentage buttons improve UX over manual calculation.

What this code does:
- Clamps percentage to 0-100 and floors to integer.
- Computes value as `(balance * pct) / 100` using BigInt.
- Converts to string for controlled input.
- Provides quick access to common percentages (25, 50, 75, 100).

---

```tsx
<div className="grid grid-cols-2 gap-2 text-[11px]">
  <div className="text-gray-500">Amount</div>
  <div className="text-white text-right">
    {stakeAmountParsed === null ? '—' : stakeAmountParsed.toString()} RNG
  </div>
  <div className="text-gray-500">Duration</div>
  <div className="text-white text-right">
    {stakeDurationParsed === null ? '—' : stakeDurationParsed.toString()} blocks
  </div>
  <div className="text-gray-500">Voting power</div>
  <div className="text-white text-right">
    {stakeAmountParsed && stakeDurationParsed
      ? (stakeAmountParsed * stakeDurationParsed).toString()
      : '—'}
  </div>
```
**Lines 191-204**

Why this matters:
- Voting power determines reward share, so users must understand the formula.
- The confirmation modal shows the computed voting power before submission.

What this code does:
- Displays parsed amount and duration from user inputs.
- Computes voting power as `amount × duration`.
- Shows '—' placeholder when inputs are invalid.
- Provides transparency: users see exactly what they're staking.

---

### 7) StakingDashboard: Displaying derived state

**File**: `website/src/components/staking/StakingDashboard.tsx`

```tsx
<div className="border border-gray-800 rounded p-3 bg-black/30">
  <div className="text-[10px] text-gray-500 tracking-widest">YOUR STAKE</div>
  <div className="text-white mt-1">{staker?.balance ?? 0}</div>
  <div className="text-[10px] text-gray-600">unlock @ {derived.unlockTs || '—'}</div>
  <div className="text-[10px] text-gray-600">
    unclaimed {derived.unclaimedRewards.toString()}
  </div>
</div>
<div className="border border-gray-800 rounded p-3 bg-black/30">
  <div className="text-[10px] text-gray-500 tracking-widest">VOTING POWER</div>
  <div className="text-white mt-1">{derived.vp.toString()}</div>
  <div className="text-[10px] text-gray-600">share ~ {(derived.shareBps / 100).toFixed(2)}%</div>
  <div className="text-[10px] text-gray-600">
    claimable {derived.claimableRewards.toString()}
  </div>
</div>
```
**Lines 20-35**

Why this matters:
- Stakers need to see their voting power, share percentage, and reward status.
- The parent component computes derived state; this component just displays it.

What this code does:
- Displays staked balance and unlock timestamp.
- Shows unclaimed rewards (accrued but not yet claimable).
- Displays voting power (amount × remaining duration).
- Shows approximate share percentage of total voting power.
- Shows claimable rewards (ready to withdraw).

---

### 8) ConfirmModal: Transaction confirmation pattern

**File**: `website/src/components/ui/ConfirmModal.tsx`

```tsx
const backdropSpring = useSpring({
  blur: open ? GLASS_MEDIUM.blur : 0,
  opacity: open ? 1 : 0,
  config: prefersReducedMotion ? INSTANT_CONFIG : SPRING_LIQUID_CONFIGS.liquidMorph,
});

const transitions = useTransition(open, {
  from: prefersReducedMotion
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.95, y: 10 },
  enter: prefersReducedMotion
    ? { opacity: 1 }
    : { opacity: 1, scale: 1, y: 0 },
  leave: prefersReducedMotion
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.95, y: 10 },
  config: prefersReducedMotion ? INSTANT_CONFIG : SPRING_CONFIGS.modal,
});
```
**Lines 49-67**

Why this matters:
- Confirmation modals prevent accidental transactions.
- Smooth animations improve perceived quality, but must respect user preferences.

What this code does:
- Uses `useSpring` for backdrop blur animation (glassmorphism effect).
- Uses `useTransition` for modal enter/exit animations.
- Detects reduced motion preference and disables animations accordingly.
- Animates opacity, scale, and vertical position for polished entrance.
- Liquid morph spring for backdrop (smooth, flowing motion).
- Snappier spring for modal content (responsive feel).

---

```tsx
<button
  type="button"
  onClick={loading ? undefined : onConfirm}
  className="h-11 px-4 rounded border border-action-destructive text-action-destructive text-[10px] tracking-widest uppercase hover:bg-action-destructive/10 active:scale-[0.98] transition-transform disabled:opacity-60 disabled:cursor-not-allowed"
  disabled={loading}
>
  {loading ? 'Confirming…' : confirmText}
</button>
```
**Lines 142-148**

Why this matters:
- Users must not be able to double-submit transactions.
- Loading state provides feedback during blockchain submission.

What this code does:
- Disables button and removes onClick handler when loading.
- Changes button text to "Confirming…" during submission.
- Reduces opacity and shows disabled cursor when loading.
- Uses `active:scale-[0.98]` for tactile feedback on click.
- Destructive color (red) signals this is a significant action.

---

## Extended deep dive: patterns and trade-offs

### 9) Controlled inputs vs uncontrolled inputs

All financial inputs use the controlled pattern:
```tsx
value={amount}
onChange={(e) => setAmount(e.target.value)}
```

This differs from uncontrolled inputs that use refs. Controlled inputs enable:
- Real-time validation.
- Derived state computation (quotes, ratios).
- Synchronization across multiple inputs (ratio matching).
- Prevention of invalid state (inputs can be clamped or rejected).

Trade-off: Controlled inputs require more React state updates, but the precision gained is critical for financial UIs.

---

### 10) Why BigInt everywhere?

JavaScript's `Number` type uses IEEE 754 double precision, which has precision limits around 2^53. Financial amounts can exceed this, and even small rounding errors are unacceptable.

Example:
```js
// WRONG: floating point
const out = (amountIn * reserveOut) / (reserveIn + amountIn);  // loses precision

// CORRECT: BigInt
const out = (amountIn * reserveOut) / (reserveIn + amountIn);  // exact integer math
```

All on-chain values are integers (no decimals in this system), so BigInt provides:
- Exact arithmetic without precision loss.
- Overflow detection (BigInt can represent arbitrarily large numbers).
- Matches on-chain integer behavior exactly.

Trade-off: BigInt cannot be directly JSON serialized, so values are converted to strings for display and storage.

---

### 11) Debouncing vs throttling

The swap panel uses debouncing (wait 200ms after last keystroke):
```tsx
useEffect(() => {
  const t = window.setTimeout(() => setDebouncedAmountIn(swapAmountIn), 200);
  return () => window.clearTimeout(t);
}, [swapAmountIn]);
```

Alternative: throttling (run at most once per 200ms):
```tsx
// Not used here, but a valid alternative
useEffect(() => {
  const lastRun = useRef(0);
  const now = Date.now();
  if (now - lastRun.current > 200) {
    setDebouncedAmountIn(swapAmountIn);
    lastRun.current = now;
  }
}, [swapAmountIn]);
```

Why debouncing is chosen:
- Quote computation is expensive (multi-step BigInt math).
- Users type in bursts, then pause to read the quote.
- Debouncing ensures quote updates only when user has stopped typing.
- Throttling would compute intermediate quotes that are immediately discarded.

Trade-off: Debouncing adds perceived latency (200ms delay), but reduces unnecessary computation.

---

### 12) Derived state vs stored state

The components distinguish between:
- **Stored state**: Amounts, directions, balances (from chain or user input).
- **Derived state**: Quotes, health ratios, prices (computed from stored state).

Pattern:
```tsx
const quote = useMemo(() => {
  // Compute from stored state
  return estimateSwapOut(amm, amountIn, direction);
}, [amm, amountIn, direction]);
```

Why this matters:
- Derived state is always consistent with stored state (no sync bugs).
- useMemo prevents unnecessary recalculation.
- Single source of truth: chain state drives everything.

Anti-pattern (don't do this):
```tsx
// WRONG: storing derived state
const [quote, setQuote] = useState(null);
useEffect(() => {
  setQuote(estimateSwapOut(amm, amountIn, direction));
}, [amm, amountIn, direction]);
```
This creates a race condition: quote might be stale if dependencies change before effect runs.

---

### 13) The ratio-matching state machine

LiquidityPanel has subtle state machine behavior:
1. User enables auto-match.
2. User edits RNG input.
3. `lastEdited` is set to 'RNG'.
4. `syncFromRng` computes matching vUSDT.
5. vUSDT input updates (but doesn't trigger `syncFromVusdt`).

The key is preventing feedback loops:
```tsx
onChange={(e) => {
  setLastEdited('RNG');  // <-- prevents vUSDT input from syncing back
  const next = e.target.value;
  setAddLiqRng(next);
  syncFromRng(next);
}}
```

If we didn't track `lastEdited`, enabling auto-match would:
1. Sync RNG → vUSDT.
2. vUSDT change triggers sync vUSDT → RNG.
3. RNG change triggers sync RNG → vUSDT.
4. Infinite loop.

The `lastEdited` flag breaks the cycle by establishing directionality.

---

### 14) Validation ordering and short-circuiting

Notice the validation order in SwapPanel:
```tsx
if (!player) return 'Register to trade';
if (amountInParsed === null) return 'Enter a whole number amount';
if (amountInParsed <= 0n) return 'Enter an amount';
if (amountInParsed > balanceIn) return `Not enough ${inToken}`;
if (!poolReady) return 'AMM not initialized yet';
if (isDebouncing) return 'Updating quote…';
if (quote.out <= 0n) return 'Quote unavailable';
return null;
```

This ordering is deliberate:
1. Authentication first (can't trade without account).
2. Input validity (can't check balance of invalid input).
3. Balance check (requires valid input).
4. Pool state (requires valid user state).
5. Debouncing (requires pool ready).
6. Quote validity (requires all above).

This is defensive programming: each check assumes previous checks passed. Out-of-order checks would cause crashes or confusing error messages.

---

### 15) Optimistic UI updates

The confirmation modal pattern:
```tsx
const [submitting, setSubmitting] = useState(false);

onConfirm={async () => {
  setSubmitting(true);
  try {
    await onSubmitSwap({ ... });
    setConfirmOpen(false);  // <-- optimistic close
  } finally {
    setSubmitting(false);
  }
}}
```

The modal closes **before** the transaction is confirmed on-chain. This is intentional:
- Blockchain confirmation can take seconds or minutes.
- Users expect immediate feedback.
- The modal closing signals "submission accepted" not "transaction confirmed".
- Chain state updates will eventually propagate via WebSocket or polling.

Alternative: wait for chain confirmation before closing. This is more accurate but feels unresponsive. The chosen pattern optimizes for perceived performance.

---

### 16) Error handling philosophy

None of these components have explicit error boundaries or try-catch around render logic. Instead:
- All data access uses optional chaining: `amm?.reserveRng ?? 0`.
- Null states are handled gracefully: `if (!amm) return { out: 0n }`.
- Invalid inputs produce null/zero results, not exceptions.

This is a deliberate choice:
- Financial UIs should never crash; show zero instead.
- Users can recover from zero state (refresh, change input).
- Errors are communicated via validation messages, not exceptions.

Trade-off: Silent failures can hide bugs. Mitigation: extensive logging in development mode and comprehensive validation messages.

---

### 17) The constant product invariant

The AMM formula is:
```
x * y = k  (constant product)
```

Where:
- x = reserve of token A
- y = reserve of token B
- k = constant (product of reserves)

When swapping, we maintain k:
```
(x + dx) * (y - dy) = k
```

Solving for dy (amount out):
```
dy = y * dx / (x + dx)
```

This is exactly what `estimateSwapOut` implements:
```js
const out = (netIn * reserveOut) / (reserveIn + netIn);
```

Why this matters:
- Larger trades have worse prices (price impact increases with size).
- The pool naturally balances itself (buying RNG increases RNG price).
- No oracle needed; price is derived from reserves.

Limitation: Large trades can have extreme slippage. This is why slippage tolerance exists.

---

### 18) Basis points as a precision pattern

All percentages use basis points (1 bps = 0.01%):
```tsx
const ltvPercent = (vaultDerived.ltvBps / 100).toFixed(2);  // bps → %
```

Why basis points?
- Avoids floating point in on-chain logic (100% = 10,000 bps).
- Enables sub-percent precision (0.01% = 1 bps).
- Standard in traditional finance.

Pattern for converting:
- bps → %: divide by 100 (10,000 bps = 100%)
- bps → decimal: divide by 10,000 (10,000 bps = 1.0)

On-chain multiplication:
```rust
// 50% of amount (5000 bps)
let half = (amount * 5000) / 10_000;
```

In UI:
```tsx
// Display 5000 bps as "50.00%"
const percent = (5000 / 100).toFixed(2);  // "50.00"
```

---

### 19) Mobile input optimization

All numeric inputs use:
```tsx
inputMode="numeric"
pattern="[0-9]*"
```

Why both?
- `inputMode="numeric"`: Shows numeric keyboard on mobile (iOS/Android).
- `pattern="[0-9]*"`: Older iOS versions require this for numeric keyboard.
- Together they ensure numeric keyboard on all mobile browsers.

Why not `type="number"`?
- `type="number"` allows scientific notation (1e10), which breaks BigInt parsing.
- `type="number"` allows decimal points, which this system doesn't support.
- `type="text"` with `inputMode` gives full control over validation.

---

### 20) Component composition and prop drilling

These components receive many props (10-20 each). This is intentional:
- Components are presentational (no direct chain access).
- Parent container handles all business logic.
- Props are explicit (no hidden dependencies).

Alternative: Context API. Why not used here?
- Financial state is tightly scoped to the economy page.
- Prop drilling is manageable with destructuring.
- Explicit props make data flow clear (easier to debug).

Context would be appropriate if:
- Multiple deeply nested components need the same data.
- State is truly global (auth, theme).
- Performance is degraded by excessive re-renders.

---

### 21) Health indicator zones and user psychology

The health indicator uses three zones, but the thresholds are asymmetric:
```tsx
const safeCutoff = Math.max(1, Math.floor(maxLtv * 0.8));  // 80% of max
if (ltvBps < safeCutoff) return { label: 'SAFE', className: 'text-action-success' };
if (ltvBps < liquidation) return { label: 'CAUTION', className: 'text-action-primary' };
return { label: 'RISK', className: 'text-action-destructive' };
```

Why 80% for safe cutoff?
- Users need a buffer zone to avoid panic.
- 80-100% of max LTV = caution (yellow).
- Above liquidation threshold = risk (red).

Psychology:
- Green (SAFE) = keep borrowing is okay.
- Yellow (CAUTION) = pay attention, don't borrow more.
- Red (RISK) = urgent action needed.

Alternative: linear gradient. Rejected because:
- Three zones are easier to understand than continuous scale.
- Color changes are more noticeable than gradual shift.
- Binary decisions (safe/unsafe) are easier than fuzzy thresholds.

---

### 22) The slippage tolerance trade-off

SwapPanel offers slippage options: 0.5%, 1%, 2%, 5%.

What is slippage tolerance?
- User submits: "I want 100 RNG, but I'll accept minimum 99 RNG (1% slippage)".
- If pool state changes before transaction executes, output might be less.
- Transaction reverts if `actualOut < minOut`.

Low slippage (0.5%):
- Pros: Protects against price movement.
- Cons: Transaction more likely to revert in volatile markets.

High slippage (5%):
- Pros: Transaction almost always succeeds.
- Cons: User might receive far less than expected.

Default: 1% is a balanced choice for moderate liquidity pools.

---

### 23) Feynman analogy: The DeFi UI as a bank teller interface

Imagine a bank teller's computer terminal. It doesn't hold money; it's a view into the bank's ledger. The teller types amounts, sees account balances, and submits transactions to the central ledger.

DeFi UIs work the same way:
- The blockchain is the ledger (source of truth).
- The UI is the teller terminal (query and submission interface).
- Users are customers (own accounts on the ledger).
- Transactions are deposits/withdrawals (irreversible ledger updates).

Key differences:
- Bank teller: centralized ledger, human verification.
- DeFi UI: decentralized ledger, cryptographic verification.
- Bank teller: can reverse errors.
- DeFi UI: transactions are final.

This is why DeFi UIs require:
- Multiple validation layers (teller double-checks amounts).
- Confirmation modals (teller repeats transaction details).
- Clear error messages (teller explains why transaction can't proceed).
- Real-time balance display (teller shows current account state).

The UI is not the bank; it's the window into the bank.

---

### 24) Testing strategies for financial UIs

These components are hard to test because they depend on:
- Chain state (AMM reserves, vault data).
- BigInt arithmetic (must use exact values).
- Time-based state (staking locks, epochs).

Testing approaches:

**Unit tests**: Test pure functions in isolation.
```js
import { estimateSwapOut } from './ammQuote';

test('estimateSwapOut computes constant product correctly', () => {
  const amm = { reserveRng: 1000, reserveVusdt: 2000, feeBasisPoints: 30, sellTaxBasisPoints: 0 };
  const { out, fee } = estimateSwapOut(amm, 100n, true);  // Buy 100 vUSDT worth of RNG
  expect(out).toBe(/* computed expected value */);
});
```

**Integration tests**: Test components with mocked chain state.
```tsx
import { render, screen } from '@testing-library/react';
import { BorrowPanel } from './BorrowPanel';

test('BorrowPanel shows RISK when LTV exceeds liquidation', () => {
  const vaultDerived = { ltvBps: 9000, maxLtvBps: 8000, liquidationThresholdBps: 8500 };
  render(<BorrowPanel vaultDerived={vaultDerived} {...mockProps} />);
  expect(screen.getByText('RISK')).toBeInTheDocument();
});
```

**E2E tests**: Test full user flows with local blockchain.
```js
// Using Playwright + local testnet
test('user can swap RNG for vUSDT', async ({ page }) => {
  await page.goto('/economy');
  await page.fill('input[placeholder*="Amount"]', '100');
  await page.click('button:has-text("Swap")');
  await page.click('button:has-text("Confirm")');
  await expect(page.locator('text=Transaction confirmed')).toBeVisible();
});
```

The E2E tests are most valuable because they catch integration issues (BigInt serialization, chain state sync, etc.).

---

### 25) Accessibility considerations

These components handle some accessibility basics:
- Semantic HTML (`<button>`, `<input>`, `<section>`).
- Labels for inputs (via placeholder and surrounding text).
- Disabled states (prevents invalid actions).
- Keyboard navigation (Escape closes modal).

Missing accessibility features:
- No ARIA labels for screen readers.
- No focus management (modals don't trap focus).
- No keyboard shortcuts for common actions.
- Color-only health indicators (should have icons/text).

Why the gaps?
- Early development (accessibility is iterative).
- Gaming/DeFi users are often power users (less critical than consumer apps).

Future improvements:
- Add `aria-label` to buttons and inputs.
- Implement focus trap in ConfirmModal.
- Add icons to health indicators (checkmark, warning, error).
- Support keyboard shortcuts (Enter to confirm modal, etc.).

---

### 26) Performance optimization: memoization patterns

Notice the extensive use of `useMemo`:
```tsx
const quote = useMemo(() => {
  return estimateSwapOut(amm, amountIn, direction);
}, [amm, amountIn, direction]);

const health = useMemo(() => {
  // ... compute health
}, [ltvBps, maxLtvBps, liquidationThresholdBps]);
```

Why memoize?
- BigInt arithmetic is relatively expensive (not micro-optimized like CPU floats).
- Quote computation involves multiple divisions and multiplications.
- Health computation is simpler but used in multiple places.

When not to memoize:
- Simple lookups: `amm?.reserveRng ?? 0` (faster to recompute than cache).
- Infrequently called code: One-time initialization logic.
- Primitive comparisons: `amountIn > balanceIn` (trivial cost).

Rule of thumb: Memoize if computation involves:
- Loops or iteration.
- Multiple BigInt operations.
- Object/array construction.

---

### 27) The confirm modal loading state machine

ConfirmModal has a subtle state machine:
1. User clicks "Swap".
2. Modal opens (`confirmOpen = true`).
3. User clicks "Confirm".
4. `loading = true`, button disabled, text changes to "Confirming…".
5. Transaction submits (async operation).
6. On success: `confirmOpen = false`, modal closes.
7. On failure: `loading = false`, modal stays open, user can retry.

State transitions:
```
[Closed] --click "Swap"--> [Open, Not Loading]
[Open, Not Loading] --click "Confirm"--> [Open, Loading]
[Open, Loading] --success--> [Closed]
[Open, Loading] --failure--> [Open, Not Loading]
[Open, *] --click "Cancel" or "Escape"--> [Closed]
```

Guard conditions:
- Cannot close modal while loading (prevents accidental cancel during submission).
- Cannot click confirm while loading (prevents double submission).
- Escape key closes modal only when not loading.

This is a classic finite state machine embedded in React state.

---

### 28) Integer division and rounding

All division in `estimateSwapOut` truncates (rounds toward zero):
```js
const out = (netIn * reserveOut) / (reserveIn + netIn);
```

Example:
```
netIn = 100n
reserveOut = 999n
reserveIn = 1000n
out = (100 * 999) / (1000 + 100) = 99900 / 1100 = 90n  (not 90.818...)
```

This favors the pool:
- User pays 100, receives 90 (pool gains 10).
- Over many swaps, rounding errors accumulate in the pool.

This is intentional:
- Prevents pool draining attacks (adversary can't extract value via rounding).
- Provides small but steady income to LPs.
- Standard pattern in Uniswap and other AMMs.

Alternative: round up for users. Rejected because:
- Pool would slowly drain to zero.
- Attackers could exploit rounding to extract value.

---

## Key takeaways

- DeFi UIs are state viewers, not state holders. The chain is the source of truth.
- BigInt is mandatory for financial precision. Never use floating point for money.
- Derived state should be computed via `useMemo`, not stored in state.
- Validation messages guide users to fix issues before submission.
- Confirmation modals prevent accidental irreversible transactions.
- Debouncing reduces computation cost for expensive quote calculations.
- Auto-matching ratios improve UX for liquidity provision.
- Health indicators use color-coded zones to communicate risk.
- Slippage tolerance protects users from front-running and price movement.
- Controlled inputs enable real-time validation and derived state synchronization.

## Next lesson

L55 - Economy page container and state orchestration: `feynman/lessons/L55-economy-page-container.md`

---

## Exercises for mastery

1. Trace a full swap flow: user types amount → debounce → quote → submit → confirm → chain. What state changes at each step?

2. Explain why `syncFromRng` doesn't trigger `syncFromVusdt` in an infinite loop. What prevents the feedback cycle?

3. Compute the output for a swap: 500 RNG → vUSDT with reserves (10,000 RNG, 20,000 vUSDT), fee 30 bps, sell tax 200 bps. Show each step (burn, fee, constant product).

4. Design a new health indicator with five zones instead of three. What thresholds would you use and why?

If you can answer these, you understand DeFi UI patterns deeply.
