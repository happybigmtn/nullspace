import React, { useMemo, useState } from 'react';
import { parseAmount } from '../../utils/amounts.js';

type AmmDerived = {
  price: number | null;
  tvlVusdt: bigint;
};

type LiquidityPanelProps = {
  amm: any | null;
  ammDerived: AmmDerived;
  lpBalance: any | null;
  addLiqRng: string;
  addLiqVusdt: string;
  removeLiqShares: string;
  setAddLiqRng: (value: string) => void;
  setAddLiqVusdt: (value: string) => void;
  setRemoveLiqShares: (value: string) => void;
  onAddLiquidity: () => void;
  onRemoveLiquidity: () => void;
};

export const LiquidityPanel: React.FC<LiquidityPanelProps> = ({
  amm,
  ammDerived,
  lpBalance,
  addLiqRng,
  addLiqVusdt,
  removeLiqShares,
  setAddLiqRng,
  setAddLiqVusdt,
  setRemoveLiqShares,
  onAddLiquidity,
  onRemoveLiquidity,
}) => {
  const [autoMatchRatio, setAutoMatchRatio] = useState(true);
  const [lastEdited, setLastEdited] = useState<'RNG' | 'vUSDT'>('RNG');

  const reserveRng = BigInt(amm?.reserveRng ?? 0);
  const reserveVusdt = BigInt(amm?.reserveVusdt ?? 0);
  const poolReady = reserveRng > 0n && reserveVusdt > 0n;

  const ratioHint = useMemo(() => {
    if (!poolReady || ammDerived.price === null) return '—';
    return `1 RNG ≈ ${ammDerived.price.toFixed(6)} vUSDT`;
  }, [ammDerived.price, poolReady]);

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

  const onToggleAutoMatch = (next: boolean) => {
    setAutoMatchRatio(next);
    if (!next) return;
    if (lastEdited === 'RNG') syncFromRng(addLiqRng);
    else syncFromVusdt(addLiqVusdt);
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
        <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Liquidity</div>
        <div className="text-[10px] text-ns-muted">
          LP shares: <span className="text-ns">{lpBalance?.balance ?? 0}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-ns-muted tracking-[0.28em] uppercase">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="accent-action-success"
              checked={autoMatchRatio}
              onChange={(e) => onToggleAutoMatch(e.target.checked)}
              disabled={!poolReady}
            />
            Auto-match ratio
          </label>
          <div className="text-ns-muted normal-case tracking-normal">{ratioHint}</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            className="liquid-input px-3 py-2 text-xs"
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
          <input
            className="liquid-input px-3 py-2 text-xs"
            value={addLiqVusdt}
            onChange={(e) => {
              setLastEdited('vUSDT');
              const next = e.target.value;
              setAddLiqVusdt(next);
              syncFromVusdt(next);
            }}
            placeholder="vUSDT"
            inputMode="numeric"
            pattern="[0-9]*"
          />
        </div>
        <button
          className="w-full text-xs px-3 py-2 rounded-full liquid-chip text-action-success hover:shadow-soft"
          onClick={onAddLiquidity}
        >
          Add Liquidity
        </button>

        <div className="flex items-center gap-2">
          <input
            className="flex-1 liquid-input px-3 py-2 text-xs"
            value={removeLiqShares}
            onChange={(e) => setRemoveLiqShares(e.target.value)}
            placeholder="Shares"
            inputMode="numeric"
            pattern="[0-9]*"
          />
          <button
            className="text-xs px-3 py-2 rounded-full liquid-chip text-ns hover:shadow-soft"
            onClick={onRemoveLiquidity}
          >
            Remove
          </button>
        </div>
      </div>
    </section>
  );
};
