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
    <section className="border border-gray-800 rounded p-4 bg-gray-900/30">
      <div className="text-xs text-gray-400 tracking-widest mb-3">HOUSE / REWARDS</div>
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Epoch</span>
          <span className="text-white">{house?.currentEpoch ?? 0}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Net PnL</span>
          <span className="text-white">{house?.netPnl ?? '0'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Total Staked</span>
          <span className="text-white">{house?.totalStakedAmount ?? 0}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Total Voting Power</span>
          <span className="text-white">{house?.totalVotingPower ?? '0'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">AMM Fees</span>
          <span className="text-white">{house?.accumulatedFees ?? 0}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Total Burned</span>
          <span className="text-white">{house?.totalBurned ?? 0}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Total Issuance</span>
          <span className="text-white">{house?.totalIssuance ?? 0}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Reward Pool</span>
          <span className="text-white">{derived.rewardPool.toString()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">Reward Carry</span>
          <span className="text-white">{house?.stakingRewardCarry ?? 0}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">View</span>
          <span className="text-white">{currentView ?? '—'}</span>
        </div>
      </div>

      <div className="mt-4 border-t border-gray-800 pt-4 space-y-2">
        <button
          className="w-full text-xs px-3 py-2 rounded border border-gray-700 text-gray-300 hover:border-gray-500"
          onClick={onProcessEpoch}
        >
          Process Epoch (dev)
        </button>
        <div className="text-[10px] text-gray-600">Anyone can call this in dev; later it’s a keeper/admin action.</div>
      </div>
    </section>
  );
};
