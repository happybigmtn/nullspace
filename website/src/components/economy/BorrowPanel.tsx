import React, { useMemo } from 'react';

const SHOW_DEBUG = Boolean(import.meta.env?.DEV);

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
    const { ltvBps, maxLtvBps, liquidationThresholdBps } = vaultDerived;
    const safeCutoff = Math.max(1, Math.floor(maxLtvBps * 0.8));

    if (ltvBps < safeCutoff) return { label: 'SAFE', className: 'text-action-success' };
    if (ltvBps < liquidationThresholdBps) return { label: 'CAUTION', className: 'text-action-primary' };
    return { label: 'RISK', className: 'text-action-destructive' };
  }, [vaultDerived]);

  return (
    <section className="liquid-card p-5 lg:col-span-2">
      <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase mb-3">Vault (CDP)</div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="liquid-panel p-3">
          <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Collateral RNG</div>
          <div className="text-ns mt-1">{vault?.collateralRng ?? 0}</div>
        </div>
        <div className="liquid-panel p-3">
          <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Debt vUSDT</div>
          <div className="text-ns mt-1">{vault?.debtVusdt ?? 0}</div>
        </div>
        <div className="liquid-panel p-3">
          <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">LTV</div>
          <div className="flex items-baseline gap-2 mt-1">
            <div className="text-ns">{(vaultDerived.ltvBps / 100).toFixed(2)}%</div>
            <div className={['text-[10px] tracking-widest', health.className].join(' ')}>{health.label}</div>
          </div>
          <div className="text-[10px] text-ns-muted">
            max {(vaultDerived.maxLtvBps / 100).toFixed(2)}% · {vaultDerived.tierLabel}
          </div>
          <div className="text-[10px] text-ns-muted">
            liq {(vaultDerived.liquidationThresholdBps / 100).toFixed(2)}% · fee {(vaultDerived.stabilityFeeAprBps / 100).toFixed(2)}% APR
          </div>
        </div>
        <div className="liquid-panel p-3">
          <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Available Borrow</div>
          <div className="text-ns mt-1">{vaultDerived.availableDebt.toString()}</div>
          <div className="text-[10px] text-ns-muted">vUSDT</div>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <button
          className="w-full text-xs px-3 py-2 rounded-full liquid-chip text-action-success hover:shadow-soft"
          onClick={onCreateVault}
        >
          Create Vault
        </button>
        <div className="flex items-center gap-2">
          <input
            className="flex-1 liquid-input px-3 py-2 text-xs"
            value={collateralAmount}
            onChange={(e) => setCollateralAmount(e.target.value)}
            placeholder="Deposit collateral (RNG)"
            inputMode="numeric"
            pattern="[0-9]*"
          />
          <button
            className="text-xs px-3 py-2 rounded-full liquid-chip text-action-success hover:shadow-soft"
            onClick={onDepositCollateral}
          >
            Deposit
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="flex-1 liquid-input px-3 py-2 text-xs"
            value={borrowAmount}
            onChange={(e) => setBorrowAmount(e.target.value)}
            placeholder="Borrow (vUSDT)"
            inputMode="numeric"
            pattern="[0-9]*"
          />
          <button
            className="text-xs px-3 py-2 rounded-full liquid-chip text-action-destructive hover:shadow-soft"
            onClick={onBorrowVusdt}
          >
            Borrow
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="flex-1 liquid-input px-3 py-2 text-xs"
            value={repayAmount}
            onChange={(e) => setRepayAmount(e.target.value)}
            placeholder="Repay (vUSDT)"
            inputMode="numeric"
            pattern="[0-9]*"
          />
          <button
            className="text-xs px-3 py-2 rounded-full liquid-chip text-ns hover:shadow-soft"
            onClick={onRepayVusdt}
          >
            Repay
          </button>
        </div>
      </div>

      <div className="mt-6 border-t border-black/10 dark:border-white/10 pt-4">
        <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Savings (vUSDT)</div>
        <div className="grid grid-cols-2 gap-3 text-sm mt-3">
          <div className="liquid-panel p-3">
            <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Deposit Balance</div>
            <div className="text-ns mt-1">{savingsBalance?.depositBalance ?? 0}</div>
          </div>
          <div className="liquid-panel p-3">
            <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Unclaimed</div>
            <div className="text-ns mt-1">{savingsBalance?.unclaimedRewards ?? 0}</div>
          </div>
          <div className="liquid-panel p-3">
            <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Pool TVL</div>
            <div className="text-ns mt-1">{savingsPool?.totalDeposits ?? 0}</div>
          </div>
          <div className="liquid-panel p-3">
            <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Rewards Accrued</div>
            <div className="text-ns mt-1">{savingsPool?.totalRewardsAccrued ?? 0}</div>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              className="flex-1 liquid-input px-3 py-2 text-xs"
              value={savingsDepositAmount}
              onChange={(e) => setSavingsDepositAmount(e.target.value)}
              placeholder="Deposit (vUSDT)"
              inputMode="numeric"
              pattern="[0-9]*"
            />
            <button
              className="text-xs px-3 py-2 rounded-full liquid-chip text-action-success hover:shadow-soft"
              onClick={onDepositSavings}
            >
              Deposit
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="flex-1 liquid-input px-3 py-2 text-xs"
              value={savingsWithdrawAmount}
              onChange={(e) => setSavingsWithdrawAmount(e.target.value)}
              placeholder="Withdraw (vUSDT)"
              inputMode="numeric"
              pattern="[0-9]*"
            />
            <button
              className="text-xs px-3 py-2 rounded-full liquid-chip text-ns hover:shadow-soft"
              onClick={onWithdrawSavings}
            >
              Withdraw
            </button>
          </div>
          <button
            className="w-full text-xs px-3 py-2 rounded-full liquid-chip text-action-primary hover:shadow-soft"
            onClick={onClaimSavingsRewards}
          >
            Claim Savings Rewards
          </button>
        </div>
      </div>

      {SHOW_DEBUG && (
        <details className="mt-4 border-t border-black/10 dark:border-white/10 pt-4">
          <summary className="text-[10px] text-ns-muted tracking-[0.28em] uppercase cursor-pointer select-none">
            House (Debug)
          </summary>
          <div className="mt-2 text-[10px] text-ns-muted space-y-1">
            <div>
              Burned: <span className="text-ns">{house?.totalBurned ?? 0}</span>
            </div>
            <div>
              Issuance: <span className="text-ns">{house?.totalIssuance ?? 0}</span>
            </div>
            <div>
              Fees: <span className="text-ns">{house?.accumulatedFees ?? 0}</span>
            </div>
            <div>
              vUSDT debt: <span className="text-ns">{house?.totalVusdtDebt ?? 0}</span>
            </div>
            <div>
              Stability fees: <span className="text-ns">{house?.stabilityFeesAccrued ?? 0}</span>
            </div>
            <div>
              Recovery pool: <span className="text-ns">{house?.recoveryPoolVusdt ?? 0}</span>
            </div>
            <div>
              Recovered: <span className="text-ns">{house?.recoveryPoolRetired ?? 0}</span>
            </div>
          </div>
        </details>
      )}
    </section>
  );
};
