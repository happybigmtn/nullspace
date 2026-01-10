import React from 'react';
import { Label } from '../ui/Label';

type BetSlipProps = {
  totalBet: number;
  oddsLabel: string;
  maxWin?: number;
  className?: string;
};

const formatAmount = (amount: number) => {
  if (!Number.isFinite(amount) || amount <= 0) return '0';
  return Math.floor(amount).toLocaleString();
};

export const BetSlip: React.FC<BetSlipProps> = ({ totalBet, oddsLabel, maxWin, className }) => (
  <div
    className={[
      'flex flex-wrap items-center gap-4 rounded-full border border-ns bg-ns-surface px-4 py-2 shadow-soft backdrop-blur-md text-ns',
      'motion-state',
      className ?? '',
    ]
      .join(' ')
      .trim()}
    role="status"
    aria-live="polite"
  >
    <div className="flex flex-col gap-1">
      <Label size="micro">Bet Slip</Label>
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-ns-muted">Total</span>
        <span className="text-sm font-bold tabular-nums text-ns">
          ${formatAmount(totalBet)}
        </span>
      </div>
    </div>

    <div className="h-6 w-px bg-ns-border opacity-60" />

    <div className="flex flex-col gap-1">
      <Label size="micro">Odds</Label>
      <div className="text-sm font-bold text-ns">{oddsLabel}</div>
    </div>

    {typeof maxWin === 'number' && (
      <>
        <div className="h-6 w-px bg-ns-border opacity-60" />
        <div className="flex flex-col gap-1">
          <Label size="micro">Max Win</Label>
          <div className="text-sm font-bold text-ns">
            ${formatAmount(maxWin)}
          </div>
        </div>
      </>
    )}
  </div>
);
