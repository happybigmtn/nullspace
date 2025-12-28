import React from 'react';
import { Link, useLocation } from 'react-router-dom';

type TabsProps = {
  className?: string;
};

export const PlaySwapStakeTabs: React.FC<TabsProps> = ({ className }) => {
  const pathname = useLocation().pathname;
  const economyActive = pathname.startsWith('/swap') || pathname.startsWith('/borrow') || pathname.startsWith('/liquidity');
  const bridgeActive = pathname.startsWith('/bridge');

  const tabClass = (active: boolean) =>
    [
      'inline-flex shrink-0 whitespace-nowrap items-center justify-center h-10 px-5 rounded-full text-[11px] font-bold tracking-tight transition-all duration-200 border',
      active
        ? 'bg-titanium-900 text-white border-titanium-900 shadow-sm'
        : 'bg-white text-titanium-800 border-titanium-200 hover:border-titanium-400',
    ].join(' ');

  return (
    <nav className={['flex items-center gap-2 max-w-full overflow-x-auto scrollbar-hide p-1 bg-titanium-100/50 rounded-full border border-titanium-200', className ?? ''].join(' ').trim()}>
      <Link to="/" className={tabClass(pathname === '/')}>
        Play
      </Link>
      <Link to="/swap" className={tabClass(economyActive)}>
        Swap
      </Link>
      <Link to="/stake" className={tabClass(pathname.startsWith('/stake'))}>
        Stake
      </Link>
      <Link to="/bridge" className={tabClass(bridgeActive)}>
        Bridge
      </Link>
      <Link to="/security" className={tabClass(pathname.startsWith('/security'))}>
        Vault
      </Link>
    </nav>
  );
};
