import React from 'react';

type StakingDashboardProps = {
  staker: any | null;
  derived: {
    staked: bigint;
    unlockTs: number;
    vp: bigint;
    unclaimedRewards: bigint;
    claimableRewards: bigint;
    shareBps: number;
    locked: boolean;
    remainingBlocks: number;
  };
};

export const StakingDashboard: React.FC<StakingDashboardProps> = ({ staker, derived }) => {
  return (
    <div className="grid grid-cols-2 gap-3 text-sm mb-4">
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
    </div>
  );
};
