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
        <div className="text-[10px] text-gray-500 tracking-widest">LIQUIDITY</div>
        <div className="text-[10px] text-gray-600">
          LP shares: <span className="text-white">{lpBalance?.balance ?? 0}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-gray-600 tracking-widest uppercase">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="accent-terminal-green"
              checked={autoMatchRatio}
              onChange={(e) => onToggleAutoMatch(e.target.checked)}
              disabled={!poolReady}
            />
            Auto-match ratio
          </label>
          <div className="text-gray-500 normal-case tracking-normal">{ratioHint}</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
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
          <input
            className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
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
          className="w-full text-xs px-3 py-2 rounded border border-action-success text-action-success hover:bg-action-success/10"
          onClick={onAddLiquidity}
        >
          Add Liquidity
        </button>

        <div className="flex items-center gap-2">
          <input
            className="flex-1 bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
            value={removeLiqShares}
            onChange={(e) => setRemoveLiqShares(e.target.value)}
            placeholder="Shares"
            inputMode="numeric"
            pattern="[0-9]*"
          />
          <button
            className="text-xs px-3 py-1 rounded border border-gray-700 text-gray-300 hover:border-gray-500"
            onClick={onRemoveLiquidity}
          >
            Remove
          </button>
        </div>
      </div>
    </section>
  );
};
