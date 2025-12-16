import React from 'react';

type GameControlBarProps = {
  children: React.ReactNode;
  className?: string;
  variant?: 'row' | 'stack';
  ariaLabel?: string;
};

export const GameControlBar: React.FC<GameControlBarProps> = ({
  children,
  className = '',
  variant = 'row',
  ariaLabel = 'Game controls',
}) => {
  const base =
    'ns-controlbar fixed bottom-0 left-0 right-0 sm:absolute sm:bottom-[calc(2rem+env(safe-area-inset-bottom))] bg-terminal-black/95 backdrop-blur border-t-2 border-gray-700 z-50 pb-[env(safe-area-inset-bottom)]';
  const layout =
    variant === 'stack'
      ? 'p-2'
      : 'h-16 flex items-center justify-start md:justify-center gap-2 p-2 overflow-x-auto overflow-y-hidden';

  return (
    <div role="group" aria-label={ariaLabel} className={[base, layout, className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
};
