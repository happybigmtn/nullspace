import React, { useState } from 'react';
import { ConfirmModal } from '../ui/ConfirmModal';
import { formatApproxTimeFromBlocks } from '../../utils/time';

type StakeFlowProps = {
  player: any | null;
  derived: {
    locked: boolean;
    remainingBlocks: number;
    claimableRewards: bigint;
  };
  stakeBalance: bigint;
  stakeAmount: string;
  stakeDuration: string;
  stakeAmountParsed: bigint | null;
  stakeDurationParsed: bigint | null;
  canStake: boolean;
  stakeValidationMessage: string | null;
  setStakeAmount: (val: string) => void;
  setStakeDuration: (val: string) => void;
  setStakePercent: (pct: number) => void;
  onStake: (amount: bigint, duration: bigint) => Promise<void>;
  onUnstake: () => Promise<void>;
  onClaimRewards: () => Promise<void>;
};

export const StakeFlow: React.FC<StakeFlowProps> = ({
  player,
  derived,
  stakeBalance,
  stakeAmount,
  stakeDuration,
  stakeAmountParsed,
  stakeDurationParsed,
  canStake,
  stakeValidationMessage,
  setStakeAmount,
  setStakeDuration,
  setStakePercent,
  onStake,
  onUnstake,
  onClaimRewards,
}) => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-[10px] text-gray-600 tracking-widest uppercase">
        <span>Amount (RNG)</span>
        <span>
          Balance <span className="text-white">{stakeBalance.toString()}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="flex-1 min-w-[180px] h-11 bg-gray-950 border border-gray-800 rounded px-2 text-xs"
          value={stakeAmount}
          onChange={(e) => setStakeAmount(e.target.value)}
          placeholder="Amount (RNG)"
          inputMode="numeric"
          pattern="[0-9]*"
        />
        <button
          type="button"
          className="h-11 px-3 rounded border border-gray-800 text-gray-300 text-[10px] tracking-widest uppercase hover:border-gray-600 hover:text-white"
          onClick={() => setStakeAmount(stakeBalance.toString())}
          disabled={stakeBalance <= 0n}
          title="Max"
        >
          Max
        </button>
        {[25, 50, 75, 100].map((pct) => (
          <button
            key={pct}
            type="button"
            className="h-11 px-3 rounded border border-gray-800 text-gray-300 text-[10px] tracking-widest uppercase hover:border-gray-600 hover:text-white"
            onClick={() => setStakePercent(pct)}
            disabled={stakeBalance <= 0n}
            title={`${pct}%`}
          >
            {pct}%
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 text-[10px] text-gray-600 tracking-widest uppercase">
        <span>Duration (blocks)</span>
        <span className="text-gray-500">
          {stakeDurationParsed && stakeDurationParsed > 0n && stakeDurationParsed < 1_000_000n
            ? formatApproxTimeFromBlocks(Number(stakeDurationParsed))
            : '—'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="flex-1 min-w-[180px] h-11 bg-gray-950 border border-gray-800 rounded px-2 text-xs"
          value={stakeDuration}
          onChange={(e) => setStakeDuration(e.target.value)}
          placeholder="Duration (blocks)"
          inputMode="numeric"
          pattern="[0-9]*"
        />
        {[100, 500, 2000, 10000].map((blocks) => (
          <button
            key={blocks}
            type="button"
            className="h-11 px-3 rounded border border-gray-800 text-gray-300 text-[10px] tracking-widest uppercase hover:border-gray-600 hover:text-white"
            onClick={() => setStakeDuration(String(blocks))}
            title={`${blocks} blocks`}
          >
            {blocks >= 1000 ? `${blocks / 1000}k` : blocks}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          className={`flex-1 text-xs px-3 py-2 rounded border ${
            canStake
              ? 'border-terminal-green text-terminal-green hover:bg-terminal-green/10'
              : 'border-gray-800 text-gray-600 cursor-not-allowed'
          }`}
          onClick={() => (canStake ? setConfirmOpen(true) : null)}
          disabled={!canStake}
        >
          Stake
        </button>
        <button
          className={`text-xs px-3 py-2 rounded border ${
            derived.locked
              ? 'border-gray-800 text-gray-600 cursor-not-allowed'
              : 'border-gray-700 text-gray-300 hover:border-gray-500'
          }`}
          onClick={onUnstake}
          disabled={derived.locked}
          title={derived.locked ? `Locked for ${derived.remainingBlocks} blocks` : 'Unstake'}
        >
          Unstake
        </button>
        <button
          className={`text-xs px-3 py-2 rounded border ${
            derived.claimableRewards === 0n
              ? 'border-gray-800 text-gray-600 cursor-not-allowed'
              : 'border-gray-700 text-gray-300 hover:border-gray-500'
          }`}
          onClick={onClaimRewards}
          disabled={derived.claimableRewards === 0n}
          title={derived.claimableRewards === 0n ? 'No rewards to claim' : 'Claim rewards'}
        >
          Claim
        </button>
      </div>

      {derived.locked && (
        <div className="text-[10px] text-gray-500">
          Locked: {derived.remainingBlocks} blocks ({formatApproxTimeFromBlocks(derived.remainingBlocks)})
        </div>
      )}

      {stakeValidationMessage ? (
        <div className="text-[10px] text-terminal-accent">{stakeValidationMessage}</div>
      ) : null}

      <div className="text-[10px] text-gray-600 leading-relaxed">
        Rewards are funded from positive epoch net PnL and distributed pro-rata by voting power (amount * duration). Call
        “Process Epoch” after ~100 blocks to roll the epoch and update the reward pool.
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Confirm Stake"
        confirmText="Confirm Stake"
        loading={submitting}
        onClose={() => (submitting ? null : setConfirmOpen(false))}
        onConfirm={async () => {
          if (!canStake) return;
          if (stakeAmountParsed === null || stakeDurationParsed === null) return;
          setSubmitting(true);
          try {
            await onStake(stakeAmountParsed, stakeDurationParsed);
            setConfirmOpen(false);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <div className="space-y-3 text-sm">
          <div className="text-[10px] text-gray-500 tracking-widest uppercase">Summary</div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="text-gray-500">Amount</div>
            <div className="text-white text-right">
              {stakeAmountParsed === null ? '—' : stakeAmountParsed.toString()} RNG
            </div>
            <div className="text-gray-500">Duration</div>
            <div className="text-white text-right">
              {stakeDurationParsed === null ? '—' : stakeDurationParsed.toString()} blocks
            </div>
            <div className="text-gray-500">Voting power</div>
            <div className="text-white text-right">
              {stakeAmountParsed && stakeDurationParsed
                ? (stakeAmountParsed * stakeDurationParsed).toString()
                : '—'}
            </div>
            <div className="text-gray-500">Unlock ETA</div>
            <div className="text-white text-right">
              {stakeDurationParsed && stakeDurationParsed > 0n && stakeDurationParsed < 1_000_000n
                ? formatApproxTimeFromBlocks(Number(stakeDurationParsed))
                : '—'}
            </div>
          </div>
          <div className="text-[10px] text-gray-600 leading-relaxed">
            Voting power = amount × duration. Rewards depend on future epoch net PnL.
          </div>
        </div>
      </ConfirmModal>
    </div>
  );
};
