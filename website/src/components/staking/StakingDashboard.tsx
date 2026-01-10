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
      <div className="liquid-panel p-3">
        <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Your Stake</div>
        <div className="text-ns mt-1">{staker?.balance ?? 0}</div>
        <div className="text-[10px] text-ns-muted">unlock @ {derived.unlockTs || '—'}</div>
        <div className="text-[10px] text-ns-muted">
          unclaimed {derived.unclaimedRewards.toString()}
        </div>
      </div>
      <div className="liquid-panel p-3">
        <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Voting Power</div>
        <div className="text-ns mt-1">{derived.vp.toString()}</div>
        <div className="text-[10px] text-ns-muted">share ~ {(derived.shareBps / 100).toFixed(2)}%</div>
        <div className="text-[10px] text-ns-muted">
          claimable {derived.claimableRewards.toString()}
        </div>
      </div>
    </div>
  );
};
