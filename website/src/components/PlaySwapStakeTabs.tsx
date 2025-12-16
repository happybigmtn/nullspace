import React from 'react';
import { Link, useLocation } from 'react-router-dom';

type TabsProps = {
  className?: string;
};

export const PlaySwapStakeTabs: React.FC<TabsProps> = ({ className }) => {
  const pathname = useLocation().pathname;
  const economyActive = pathname.startsWith('/swap') || pathname.startsWith('/borrow') || pathname.startsWith('/liquidity');

  const tabClass = (active: boolean) =>
    [
      'inline-flex shrink-0 whitespace-nowrap items-center justify-center h-11 px-3 rounded border text-[10px] tracking-widest uppercase transition-colors',
      active
        ? 'border-terminal-green text-terminal-green bg-terminal-green/10'
        : 'border-gray-800 text-gray-400 hover:border-gray-600 hover:text-white',
    ].join(' ');

  return (
    <nav className={['flex items-center gap-2 max-w-full overflow-x-auto', className ?? ''].join(' ').trim()}>
      <Link to="/" className={tabClass(pathname === '/')}>
        Play
      </Link>
      <Link to="/swap" className={tabClass(economyActive)}>
        Swap
      </Link>
      <Link to="/stake" className={tabClass(pathname.startsWith('/stake'))}>
        Stake
      </Link>
      <Link to="/security" className={tabClass(pathname.startsWith('/security'))}>
        Vault
      </Link>
    </nav>
  );
};
