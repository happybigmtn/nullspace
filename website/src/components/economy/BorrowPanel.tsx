import React, { useMemo } from 'react';

type VaultDerived = {
  ltvBps: number;
  availableDebt: bigint;
  maxLtvBps: number;
  liquidationThresholdBps: number;
  stabilityFeeAprBps: number;
  tierLabel: string;
};

type BorrowPanelProps = {
  vault: any | null;
  vaultDerived: VaultDerived;
  house: any | null;
  savingsPool: any | null;
  savingsBalance: any | null;
  collateralAmount: string;
  borrowAmount: string;
  repayAmount: string;
  savingsDepositAmount: string;
  savingsWithdrawAmount: string;
  setCollateralAmount: (value: string) => void;
  setBorrowAmount: (value: string) => void;
  setRepayAmount: (value: string) => void;
  setSavingsDepositAmount: (value: string) => void;
  setSavingsWithdrawAmount: (value: string) => void;
  onCreateVault: () => void;
  onDepositCollateral: () => void;
  onBorrowVusdt: () => void;
  onRepayVusdt: () => void;
  onDepositSavings: () => void;
  onWithdrawSavings: () => void;
  onClaimSavingsRewards: () => void;
};

export const BorrowPanel: React.FC<BorrowPanelProps> = ({
  vault,
  vaultDerived,
  house,
  savingsPool,
  savingsBalance,
  collateralAmount,
  borrowAmount,
  repayAmount,
  savingsDepositAmount,
  savingsWithdrawAmount,
  setCollateralAmount,
  setBorrowAmount,
  setRepayAmount,
  setSavingsDepositAmount,
  setSavingsWithdrawAmount,
  onCreateVault,
  onDepositCollateral,
  onBorrowVusdt,
  onRepayVusdt,
  onDepositSavings,
  onWithdrawSavings,
  onClaimSavingsRewards,
}) => {
  const health = useMemo(() => {
    const ltvBps = vaultDerived.ltvBps;
    const maxLtv = vaultDerived.maxLtvBps;
    const liquidation = vaultDerived.liquidationThresholdBps;
    const safeCutoff = Math.max(1, Math.floor(maxLtv * 0.8));
    if (ltvBps < safeCutoff) return { label: 'SAFE', className: 'text-action-success' };
    if (ltvBps < liquidation) return { label: 'CAUTION', className: 'text-action-primary' };
    return { label: 'RISK', className: 'text-action-destructive' };
  }, [vaultDerived.liquidationThresholdBps, vaultDerived.ltvBps, vaultDerived.maxLtvBps]);

  return (
    <section className="border border-gray-800 rounded p-4 bg-gray-900/30 lg:col-span-2">
      <div className="text-xs text-gray-400 tracking-widest mb-3">VAULT (CDP)</div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="border border-gray-800 rounded p-3 bg-black/30">
          <div className="text-[10px] text-gray-500 tracking-widest">COLLATERAL RNG</div>
          <div className="text-white mt-1">{vault?.collateralRng ?? 0}</div>
        </div>
        <div className="border border-gray-800 rounded p-3 bg-black/30">
          <div className="text-[10px] text-gray-500 tracking-widest">DEBT vUSDT</div>
          <div className="text-white mt-1">{vault?.debtVusdt ?? 0}</div>
        </div>
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
        <div className="border border-gray-800 rounded p-3 bg-black/30">
          <div className="text-[10px] text-gray-500 tracking-widest">AVAILABLE BORROW</div>
          <div className="text-white mt-1">{vaultDerived.availableDebt.toString()}</div>
          <div className="text-[10px] text-gray-600">vUSDT</div>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <button
          className="w-full text-xs px-3 py-2 rounded border border-action-success text-action-success hover:bg-action-success/10"
          onClick={onCreateVault}
        >
          Create Vault
        </button>
        <div className="flex items-center gap-2">
          <input
            className="flex-1 bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
            value={collateralAmount}
            onChange={(e) => setCollateralAmount(e.target.value)}
            placeholder="Deposit collateral (RNG)"
            inputMode="numeric"
            pattern="[0-9]*"
          />
          <button
            className="text-xs px-3 py-1 rounded border border-action-success text-action-success hover:bg-action-success/10"
            onClick={onDepositCollateral}
          >
            Deposit
          </button>
        </div>
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
        <div className="flex items-center gap-2">
          <input
            className="flex-1 bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
            value={repayAmount}
            onChange={(e) => setRepayAmount(e.target.value)}
            placeholder="Repay (vUSDT)"
            inputMode="numeric"
            pattern="[0-9]*"
          />
          <button
            className="text-xs px-3 py-1 rounded border border-gray-700 text-gray-300 hover:border-gray-500"
            onClick={onRepayVusdt}
          >
            Repay
          </button>
        </div>
      </div>

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

        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              className="flex-1 bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
              value={savingsDepositAmount}
              onChange={(e) => setSavingsDepositAmount(e.target.value)}
              placeholder="Deposit (vUSDT)"
              inputMode="numeric"
              pattern="[0-9]*"
            />
            <button
              className="text-xs px-3 py-1 rounded border border-action-success text-action-success hover:bg-action-success/10"
              onClick={onDepositSavings}
            >
              Deposit
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="flex-1 bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs"
              value={savingsWithdrawAmount}
              onChange={(e) => setSavingsWithdrawAmount(e.target.value)}
              placeholder="Withdraw (vUSDT)"
              inputMode="numeric"
              pattern="[0-9]*"
            />
            <button
              className="text-xs px-3 py-1 rounded border border-gray-700 text-gray-300 hover:border-gray-500"
              onClick={onWithdrawSavings}
            >
              Withdraw
            </button>
          </div>
          <button
            className="w-full text-xs px-3 py-2 rounded border border-action-primary text-action-primary hover:bg-action-primary/10"
            onClick={onClaimSavingsRewards}
          >
            Claim Savings Rewards
          </button>
        </div>
      </div>

      <details className="mt-4 border-t border-gray-800 pt-4">
        <summary className="text-[10px] text-gray-500 tracking-widest cursor-pointer select-none">
          HOUSE (DEBUG)
        </summary>
        <div className="mt-2 text-[10px] text-gray-600 space-y-1">
          <div>
            Burned: <span className="text-white">{house?.totalBurned ?? 0}</span>
          </div>
          <div>
            Issuance: <span className="text-white">{house?.totalIssuance ?? 0}</span>
          </div>
          <div>
            Fees: <span className="text-white">{house?.accumulatedFees ?? 0}</span>
          </div>
          <div>
            vUSDT debt: <span className="text-white">{house?.totalVusdtDebt ?? 0}</span>
          </div>
          <div>
            Stability fees: <span className="text-white">{house?.stabilityFeesAccrued ?? 0}</span>
          </div>
          <div>
            Recovery pool: <span className="text-white">{house?.recoveryPoolVusdt ?? 0}</span>
          </div>
          <div>
            Recovered: <span className="text-white">{house?.recoveryPoolRetired ?? 0}</span>
          </div>
        </div>
      </details>
    </section>
  );
};
