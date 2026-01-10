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
        liquid-panel flex justify-between items-center text-xs p-2 cursor-pointer transition-colors
        ${isCandidate
          ? 'border-action-primary/50 bg-action-primary/10'
          : isPending
            ? 'border-dashed border-amber-500/40 bg-amber-500/10 opacity-80'
            : 'border-ns-border/60 hover:border-ns-border'
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
                ? 'text-amber-500'
                : 'text-ns'
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
        <div className="text-ns font-mono text-[10px]">${amount}</div>
        {oddsAmount && oddsAmount > 0 && (
          <div className="text-[9px] text-ns-muted font-mono">+${oddsAmount}</div>
        )}
      </div>
    </div>
  );
};
