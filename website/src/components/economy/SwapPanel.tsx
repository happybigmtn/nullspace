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
    const currentSellTaxBps = outflowBps < outflowLow ? sellTaxMin : outflowBps < outflowMid ? sellTaxMid : sellTaxMax;
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
    <section className="border border-gray-800 rounded p-4 bg-gray-900/30 lg:col-span-2">
      <div className="text-xs text-gray-400 tracking-widest mb-3">AMM (RNG/vUSDT)</div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="border border-gray-800 rounded p-3 bg-black/30">
          <div className="text-[10px] text-gray-500 tracking-widest">RESERVE RNG</div>
          <div className="text-white mt-1">{amm?.reserveRng ?? 0}</div>
        </div>
        <div className="border border-gray-800 rounded p-3 bg-black/30">
          <div className="text-[10px] text-gray-500 tracking-widest">RESERVE vUSDT</div>
          <div className="text-white mt-1">{amm?.reserveVusdt ?? 0}</div>
        </div>
        <div className="border border-gray-800 rounded p-3 bg-black/30">
          <div className="text-[10px] text-gray-500 tracking-widest">PRICE</div>
          <div className="text-white mt-1">{ammDerived.price === null ? '—' : ammDerived.price.toFixed(6)}</div>
          <div className="text-[10px] text-gray-600">vUSDT per RNG</div>
        </div>
        <div className="border border-gray-800 rounded p-3 bg-black/30">
          <div className="text-[10px] text-gray-500 tracking-widest">TVL</div>
          <div className="text-white mt-1">{ammDerived.tvlVusdt.toString()}</div>
          <div className="text-[10px] text-gray-600">~vUSDT</div>
        </div>
      </div>

      <div className="mt-4 border-t border-gray-800 pt-4 space-y-3">
        <div className="text-[10px] text-gray-500 tracking-widest">SWAP</div>
        <div className="flex items-center gap-2">
          <select
            className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
            value={swapDirection}
            onChange={(e) => setSwapDirection(e.target.value as any)}
          >
            <option value="BUY_RNG">Buy RNG (vUSDT → RNG)</option>
            <option value="SELL_RNG">Sell RNG (RNG → vUSDT)</option>
          </select>
          <button
            type="button"
            className="h-11 px-3 rounded border border-gray-800 text-gray-300 text-[10px] tracking-widest uppercase hover:border-gray-600 hover:text-white"
            onClick={() => setSwapDirection(swapDirection === 'BUY_RNG' ? 'SELL_RNG' : 'BUY_RNG')}
            title="Flip direction"
          >
            Flip
          </button>
          <select
            className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
            value={slippageBps}
            onChange={(e) => setSlippageBps(parseInt(e.target.value))}
          >
            <option value={50}>0.50% slippage</option>
            <option value={100}>1.00% slippage</option>
            <option value={200}>2.00% slippage</option>
            <option value={500}>5.00% slippage</option>
          </select>
        </div>

        <div className="flex items-center justify-between gap-2 text-[10px] text-gray-600 tracking-widest uppercase">
          <span>Amount In ({inToken})</span>
          <span>
            Balance <span className="text-white">{balanceIn.toString()}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            className="flex-1 min-w-[180px] h-11 bg-gray-950 border border-gray-800 rounded px-2 text-xs"
            value={swapAmountIn}
            onChange={(e) => setSwapAmountIn(e.target.value)}
            placeholder={`Amount in ${inToken}`}
            inputMode="numeric"
            pattern="[0-9]*"
          />
          <button
            type="button"
            className="h-11 px-3 rounded border border-gray-800 text-gray-300 text-[10px] tracking-widest uppercase hover:border-gray-600 hover:text-white"
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
              className="h-11 px-3 rounded border border-gray-800 text-gray-300 text-[10px] tracking-widest uppercase hover:border-gray-600 hover:text-white"
              onClick={() => setPercent(pct)}
              disabled={balanceIn <= 0n}
              title={`${pct}%`}
            >
              {pct}%
            </button>
          ))}
          <button
            className={[
              'h-11 px-3 rounded border text-[10px] tracking-widest uppercase',
              canSubmit
                ? 'border-action-destructive text-action-destructive hover:bg-action-destructive/10'
                : 'border-gray-800 text-gray-600 cursor-not-allowed',
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
          <div className="text-[10px] text-gray-500 leading-relaxed">
            Est. out: <span className="text-white">{quote.out.toString()}</span> · Min out:{' '}
            <span className="text-white">{quote.minOut.toString()}</span>
            {quote.burned > 0n ? ` · Burn: ${quote.burned.toString()}` : ''}
            {quote.fee > 0n ? ` · Fee: ${quote.fee.toString()}` : ''}
          </div>
        )}
        {policyInfo ? (
          <div className="text-[10px] text-gray-600 leading-relaxed">
            {swapDirection === 'SELL_RNG' ? (
              <>
                Daily sell: <span className="text-white">{policyInfo.dailyNetSell.toString()}</span> /{' '}
                <span className="text-white">{policyInfo.dailySellCap.toString()}</span>
                {' '}· Sell tax {policyInfo.currentSellTaxBps / 100}% (band {policyInfo.sellTaxMin / 100}-{policyInfo.sellTaxMax / 100}%)
              </>
            ) : (
              <>
                Daily buy: <span className="text-white">{policyInfo.dailyNetBuy.toString()}</span> /{' '}
                <span className="text-white">{policyInfo.dailyBuyCap.toString()}</span>
              </>
            )}
          </div>
        ) : null}
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
          <div className="text-[10px] text-gray-500 tracking-widest uppercase">Summary</div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="text-gray-500">You pay</div>
            <div className="text-white text-right">
              {amountInParsed === null ? '—' : amountInParsed.toString()} {inToken}
            </div>
            <div className="text-gray-500">Est. receive</div>
            <div className="text-white text-right">
              {quote.out.toString()} {swapDirection === 'BUY_RNG' ? 'RNG' : 'vUSDT'}
            </div>
            <div className="text-gray-500">Min receive</div>
            <div className="text-white text-right">
              {quote.minOut.toString()} {swapDirection === 'BUY_RNG' ? 'RNG' : 'vUSDT'}
            </div>
            <div className="text-gray-500">Price tolerance</div>
            <div className="text-white text-right">{(slippageBps / 100).toFixed(2)}%</div>
            {quote.burned > 0n ? (
              <>
                <div className="text-gray-500">Burn</div>
                <div className="text-white text-right">{quote.burned.toString()} RNG</div>
              </>
            ) : null}
            {quote.fee > 0n ? (
              <>
                <div className="text-gray-500">Fee</div>
                <div className="text-white text-right">
                  {quote.fee.toString()} {inToken}
                </div>
              </>
            ) : null}
          </div>
          <div className="text-[10px] text-gray-600 leading-relaxed">
            You may be prompted to unlock your vault to confirm this transaction.
          </div>
        </div>
      </ConfirmModal>
    </section>
  );
};
