import React from 'react';

interface BetItemProps {
  betType: string;
  target?: number | string;
  amount: number;
  oddsAmount?: number;
  isPending?: boolean;
  isCandidate?: boolean;
  candidateLabel?: string;
  onClick?: () => void;
  className?: string;
}

export const BetItem: React.FC<BetItemProps> = ({
  betType,
  target,
  amount,
  oddsAmount,
  isPending = false,
  isCandidate = false,
  candidateLabel,
  onClick,
  className = '',
}) => {
  return (
    <div
      onClick={onClick}
      className={`
        flex justify-between items-center text-xs border p-1 rounded cursor-pointer transition-colors
        ${isCandidate
          ? 'border-action-primary bg-action-primary/10'
          : isPending
            ? 'border-dashed border-amber-600/50 bg-amber-900/20 opacity-80'
            : 'border-gray-800 bg-black/50 hover:bg-gray-800'
        }
        ${className}
      `}
    >
      <div className="flex flex-col">
        <span
          className={`font-bold font-mono text-[10px] ${
            isCandidate
              ? 'text-action-primary'
              : isPending
                ? 'text-amber-400'
                : 'text-action-success'
          }`}
        >
          {candidateLabel ? `${candidateLabel} ` : ''}
          {betType}
          {target !== undefined ? ` ${target}` : ''}
        </span>
        {isPending && (
          <span className="text-[9px] text-amber-500 tracking-wider">PENDING</span>
        )}
      </div>
      <div className="text-right">
        <div className="text-white font-mono text-[10px]">${amount}</div>
        {oddsAmount && oddsAmount > 0 && (
          <div className="text-[9px] text-action-primary font-mono">+${oddsAmount}</div>
        )}
      </div>
    </div>
  );
};
