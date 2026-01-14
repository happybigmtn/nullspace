import React from 'react';

type StakingAdvancedProps = {
  house: any | null;
  derived: {
    rewardPool: bigint;
  };
  currentView: number | null;
  onProcessEpoch: () => Promise<void>;
};

export const StakingAdvanced: React.FC<StakingAdvancedProps> = ({ house, derived, currentView, onProcessEpoch }) => {
  return (
    <section className="liquid-card p-5">
      <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase mb-3">House / Rewards</div>
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-ns-muted">Epoch</span>
          <span className="text-ns">{house?.currentEpoch ?? 0}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ns-muted">Net PnL</span>
          <span className="text-ns">{house?.netPnl ?? '0'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ns-muted">Total Staked</span>
          <span className="text-ns">{house?.totalStakedAmount ?? 0}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ns-muted">Total Voting Power</span>
          <span className="text-ns">{house?.totalVotingPower ?? '0'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ns-muted">AMM Fees</span>
          <span className="text-ns">{house?.accumulatedFees ?? 0}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ns-muted">Total Burned</span>
          <span className="text-ns">{house?.totalBurned ?? 0}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ns-muted">Total Issuance</span>
          <span className="text-ns">{house?.totalIssuance ?? 0}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ns-muted">Reward Pool</span>
          <span className="text-ns">{derived.rewardPool.toString()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ns-muted">Reward Carry</span>
          <span className="text-ns">{house?.stakingRewardCarry ?? 0}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ns-muted">View</span>
          <span className="text-ns">{currentView ?? '—'}</span>
        </div>
      </div>

      <div className="mt-4 border-t border-black/10 dark:border-white/10 pt-4 space-y-2">
        <button
          className="w-full text-xs px-3 py-2 rounded-full liquid-chip text-ns hover:shadow-soft"
          onClick={onProcessEpoch}
        >
          Process Epoch (dev)
        </button>
        <div className="text-[10px] text-ns-muted">Anyone can call this in dev; later it’s a keeper/admin action.</div>
      </div>
    </section>
  );
};
