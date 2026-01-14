import React, { useEffect, useMemo, useState } from 'react';
import { estimateSwapOut, minOutWithSlippage } from '../../utils/ammQuote.js';
import { parseAmount } from '../../utils/amounts.js';
import { ConfirmModal } from '../ui/ConfirmModal';

type AmmDerived = {
  price: number | null;
  tvlVusdt: bigint;
};

type SwapPanelProps = {
  amm: any | null;
  ammDerived: AmmDerived;
  player: any | null;
  policy: any | null;
  swapDirection: 'BUY_RNG' | 'SELL_RNG';
  slippageBps: number;
  swapAmountIn: string;
  setSwapDirection: (dir: 'BUY_RNG' | 'SELL_RNG') => void;
  setSlippageBps: (bps: number) => void;
  setSwapAmountIn: (value: string) => void;
  onSubmitSwap: (payload: { amountIn: bigint; minOut: bigint; isBuyingRng: boolean }) => Promise<void>;
};

export const SwapPanel: React.FC<SwapPanelProps> = ({
  amm,
  ammDerived,
  player,
  policy,
  swapDirection,
  slippageBps,
  swapAmountIn,
  setSwapDirection,
  setSlippageBps,
  setSwapAmountIn,
  onSubmitSwap,
}) => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [debouncedAmountIn, setDebouncedAmountIn] = useState(swapAmountIn);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedAmountIn(swapAmountIn), 200);
    return () => window.clearTimeout(t);
  }, [swapAmountIn]);

  const inToken = swapDirection === 'BUY_RNG' ? 'vUSDT' : 'RNG';
  const balanceIn = useMemo(() => {
    if (swapDirection === 'BUY_RNG') return BigInt(player?.vusdtBalance ?? 0);
    return BigInt(player?.chips ?? 0);
  }, [player?.chips, player?.vusdtBalance, swapDirection]);

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
    const dailyNetSell = BigInt(player.dailyNetSell ?? 0);
    const dailyNetBuy = BigInt(player.dailyNetBuy ?? 0);
    const outflowBps = reserveRng > 0n
      ? Number((dailyNetSell * 10_000n) / reserveRng)
      : 0;
    const sellTaxMin = Number(policy.sellTaxMinBps ?? 0);
    const sellTaxMid = Number(policy.sellTaxMidBps ?? 0);
    const sellTaxMax = Number(policy.sellTaxMaxBps ?? 0);
    const outflowLow = Number(policy.sellTaxOutflowLowBps ?? 0);
    const outflowMid = Number(policy.sellTaxOutflowMidBps ?? 0);
    const getCurrentSellTaxBps = () => {
      if (outflowBps < outflowLow) return sellTaxMin;
      if (outflowBps < outflowMid) return sellTaxMid;
      return sellTaxMax;
    };
    const currentSellTaxBps = getCurrentSellTaxBps();
    return {
      dailySellCap,
      dailyBuyCap,
      dailyNetSell,
      dailyNetBuy,
      sellTaxMin,
      sellTaxMid,
      sellTaxMax,
      currentSellTaxBps,
    };
  }, [amm, player, policy]);

  const amountInParsed = useMemo(() => parseAmount(swapAmountIn), [swapAmountIn]);
  const debouncedAmountInParsed = useMemo(() => parseAmount(debouncedAmountIn), [debouncedAmountIn]);
  const isDebouncing = debouncedAmountIn !== swapAmountIn;
  const poolReady = useMemo(() => {
    const reserveRng = BigInt(amm?.reserveRng ?? 0);
    const reserveVusdt = BigInt(amm?.reserveVusdt ?? 0);
    return reserveRng > 0n && reserveVusdt > 0n;
  }, [amm?.reserveRng, amm?.reserveVusdt]);

  const quote = useMemo(() => {
    const amtIn = debouncedAmountInParsed;
    if (amtIn === null) return { invalid: true, exceedsBalance: false, out: 0n, fee: 0n, burned: 0n, minOut: 0n };
    const exceedsBalance = amtIn > balanceIn;
    const isBuyingRng = swapDirection === 'BUY_RNG';
    const { out, fee, burned } = estimateSwapOut(amm, amtIn, isBuyingRng);
    const minOut = minOutWithSlippage(out, slippageBps);
    return { invalid: false, exceedsBalance, out, fee, burned, minOut };
  }, [amm, balanceIn, debouncedAmountInParsed, slippageBps, swapDirection]);

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

  const setPercent = (pct: number) => {
    const clamped = Math.max(0, Math.min(100, Math.floor(pct)));
    const value = (balanceIn * BigInt(clamped)) / 100n;
    setSwapAmountIn(value.toString());
  };

  return (
    <section className="liquid-card p-5 lg:col-span-2">
      <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase mb-3">AMM (RNG/vUSDT)</div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="liquid-panel p-3">
          <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Reserve RNG</div>
          <div className="text-ns mt-1">{amm?.reserveRng ?? 0}</div>
        </div>
        <div className="liquid-panel p-3">
          <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Reserve vUSDT</div>
          <div className="text-ns mt-1">{amm?.reserveVusdt ?? 0}</div>
        </div>
        <div className="liquid-panel p-3">
          <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Price</div>
          <div className="text-ns mt-1">{ammDerived.price === null ? '—' : ammDerived.price.toFixed(6)}</div>
          <div className="text-[10px] text-ns-muted">vUSDT per RNG</div>
        </div>
        <div className="liquid-panel p-3">
          <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">TVL</div>
          <div className="text-ns mt-1">{ammDerived.tvlVusdt.toString()}</div>
          <div className="text-[10px] text-ns-muted">~vUSDT</div>
        </div>
      </div>

      <div className="mt-4 border-t border-black/10 dark:border-white/10 pt-4 space-y-3">
        <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Swap</div>
        <div className="flex items-center gap-2">
          <select
            className="liquid-input px-3 py-2 text-xs"
            value={swapDirection}
            onChange={(e) => setSwapDirection(e.target.value as any)}
          >
            <option value="BUY_RNG">Buy RNG (vUSDT → RNG)</option>
            <option value="SELL_RNG">Sell RNG (RNG → vUSDT)</option>
          </select>
          <button
            type="button"
            className="h-11 px-3 rounded-full liquid-chip text-ns text-[10px] tracking-[0.28em] uppercase hover:shadow-soft"
            onClick={() => setSwapDirection(swapDirection === 'BUY_RNG' ? 'SELL_RNG' : 'BUY_RNG')}
            title="Flip direction"
          >
            Flip
          </button>
          <select
            className="liquid-input px-3 py-2 text-xs"
            value={slippageBps}
            onChange={(e) => setSlippageBps(parseInt(e.target.value))}
          >
            <option value={50}>0.50% slippage</option>
            <option value={100}>1.00% slippage</option>
            <option value={200}>2.00% slippage</option>
            <option value={500}>5.00% slippage</option>
          </select>
        </div>

        <div className="flex items-center justify-between gap-2 text-[10px] text-ns-muted tracking-[0.28em] uppercase">
          <span>Amount In ({inToken})</span>
          <span>
            Balance <span className="text-ns">{balanceIn.toString()}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            className="flex-1 min-w-[180px] h-11 liquid-input px-3 text-xs"
            value={swapAmountIn}
            onChange={(e) => setSwapAmountIn(e.target.value)}
            placeholder={`Amount in ${inToken}`}
            inputMode="numeric"
            pattern="[0-9]*"
          />
          <button
            type="button"
            className="h-11 px-3 rounded-full liquid-chip text-ns text-[10px] tracking-[0.28em] uppercase hover:shadow-soft"
            onClick={() => setSwapAmountIn(balanceIn.toString())}
            disabled={balanceIn <= 0n}
            title="Max"
          >
            Max
          </button>
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              type="button"
              className="h-11 px-3 rounded-full liquid-chip text-ns text-[10px] tracking-[0.28em] uppercase hover:shadow-soft"
              onClick={() => setPercent(pct)}
              disabled={balanceIn <= 0n}
              title={`${pct}%`}
            >
              {pct}%
            </button>
          ))}
          <button
            className={[
              'h-11 px-4 rounded-full liquid-chip text-[10px] tracking-[0.28em] uppercase',
              canSubmit
                ? 'text-action-destructive hover:shadow-soft'
                : 'text-ns-muted opacity-60 cursor-not-allowed',
            ].join(' ')}
            onClick={() => (canSubmit ? setConfirmOpen(true) : null)}
            disabled={!canSubmit}
          >
            Swap
          </button>
        </div>

        {validationMessage ? (
          <div className="text-[10px] text-action-destructive">{validationMessage}</div>
        ) : (
          <div className="text-[10px] text-ns-muted leading-relaxed">
            Est. out: <span className="text-ns">{quote.out.toString()}</span> · Min out:{' '}
            <span className="text-ns">{quote.minOut.toString()}</span>
            {quote.burned > 0n ? ` · Burn: ${quote.burned.toString()}` : ''}
            {quote.fee > 0n ? ` · Fee: ${quote.fee.toString()}` : ''}
          </div>
        )}
        {policyInfo && (
          <div className="text-[10px] text-ns-muted leading-relaxed">
            {swapDirection === 'SELL_RNG' ? (
              <>
                Daily sell: <span className="text-ns">{policyInfo.dailyNetSell.toString()}</span> /{' '}
                <span className="text-ns">{policyInfo.dailySellCap.toString()}</span>
                {' '}· Sell tax {policyInfo.currentSellTaxBps / 100}% (band {policyInfo.sellTaxMin / 100}-{policyInfo.sellTaxMax / 100}%)
              </>
            ) : (
              <>
                Daily buy: <span className="text-ns">{policyInfo.dailyNetBuy.toString()}</span> /{' '}
                <span className="text-ns">{policyInfo.dailyBuyCap.toString()}</span>
              </>
            )}
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Confirm Swap"
        confirmText="Confirm Swap"
        loading={submitting}
        onClose={() => (submitting ? null : setConfirmOpen(false))}
        onConfirm={async () => {
          if (!canSubmit) return;
          if (amountInParsed === null || amountInParsed <= 0n) return;
          const isBuyingRng = swapDirection === 'BUY_RNG';
          setSubmitting(true);
          try {
            await onSubmitSwap({ amountIn: amountInParsed, minOut: quote.minOut, isBuyingRng });
            setConfirmOpen(false);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <div className="space-y-3 text-sm">
          <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Summary</div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="text-ns-muted">You pay</div>
            <div className="text-ns text-right">
              {amountInParsed === null ? '—' : amountInParsed.toString()} {inToken}
            </div>
            <div className="text-ns-muted">Est. receive</div>
            <div className="text-ns text-right">
              {quote.out.toString()} {swapDirection === 'BUY_RNG' ? 'RNG' : 'vUSDT'}
            </div>
            <div className="text-ns-muted">Min receive</div>
            <div className="text-ns text-right">
              {quote.minOut.toString()} {swapDirection === 'BUY_RNG' ? 'RNG' : 'vUSDT'}
            </div>
            <div className="text-ns-muted">Price tolerance</div>
            <div className="text-ns text-right">{(slippageBps / 100).toFixed(2)}%</div>
            {quote.burned > 0n && (
              <>
                <div className="text-ns-muted">Burn</div>
                <div className="text-ns text-right">{quote.burned.toString()} RNG</div>
              </>
            )}
            {quote.fee > 0n && (
              <>
                <div className="text-ns-muted">Fee</div>
                <div className="text-ns text-right">
                  {quote.fee.toString()} {inToken}
                </div>
              </>
            )}
          </div>
          <div className="text-[10px] text-ns-muted leading-relaxed">
            You may be prompted to unlock your vault to confirm this transaction.
          </div>
        </div>
      </ConfirmModal>
    </section>
  );
};
