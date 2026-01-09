import React from 'react';

interface BetsSidebarProps<T> {
  confirmedBets: T[];
  pendingBets: T[];
  renderBet: (bet: T, index: number, isPending: boolean) => React.ReactNode;
  title?: string;
  className?: string;
}

export function BetsSidebar<T>({
  confirmedBets,
  pendingBets,
  renderBet,
  title = 'Table Bets',
  className = '',
}: BetsSidebarProps<T>) {
  const hasNoBets = confirmedBets.length === 0 && pendingBets.length === 0;

  return (
    <div
      className={`
        hidden md:flex absolute top-0 right-0 bottom-24 w-36
        bg-titanium-900/80 border-l-2 border-gray-700 p-2 backdrop-blur-sm z-30
        flex-col zen-hide ${className}
      `}
    >
      {/* Header */}
      <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 border-b border-gray-800 pb-1 flex-none text-center">
        {title}
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto flex flex-col space-y-2">
        {hasNoBets ? (
          <div className="text-center text-[10px] text-gray-700 italic">NO BETS</div>
        ) : (
          <>
            {/* Confirmed (on-chain) bets */}
            {confirmedBets.length > 0 && (
              <div className="space-y-1">
                <div className="text-[8px] text-mono-0 dark:text-mono-1000 font-bold uppercase tracking-widest font-bold font-mono">
                  Confirmed ({confirmedBets.length})
                </div>
                {confirmedBets.map((bet, i) => renderBet(bet, i, false))}
              </div>
            )}

            {/* Pending (local staged) bets */}
            {pendingBets.length > 0 && (
              <div className="space-y-1">
                <div className="text-[8px] text-amber-400 uppercase tracking-widest font-bold font-mono">
                  Pending ({pendingBets.length})
                </div>
                {pendingBets.map((bet, i) => renderBet(bet, i, true))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
