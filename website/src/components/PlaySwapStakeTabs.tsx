import React from 'react';
import { Link, useLocation } from 'react-router-dom';

type TabsProps = {
  className?: string;
  tone?: 'default' | 'mode';
  palette?: {
    panel: string;
    text: string;
    border: string;
  };
};

export const PlaySwapStakeTabs: React.FC<TabsProps> = ({ className, tone = 'default', palette }) => {
  const pathname = useLocation().pathname;
  const economyActive = pathname.startsWith('/swap') || pathname.startsWith('/borrow') || pathname.startsWith('/liquidity');
  const bridgeActive = pathname.startsWith('/bridge');
  const useMode = tone === 'mode' && palette;

  const tabClass = (active: boolean) =>
    [
      'inline-flex shrink-0 whitespace-nowrap items-center justify-center h-8 px-4 rounded-full text-[10px] font-medium tracking-[0.18em] uppercase transition-all motion-interaction border',
      active
        ? 'bg-titanium-900 text-white border-titanium-900 shadow-sm dark:bg-action-success/20 dark:text-action-success dark:border-action-success'
        : 'bg-white text-titanium-700 border-titanium-200 hover:border-titanium-400 dark:bg-titanium-900/60 dark:text-titanium-200 dark:border-titanium-800 dark:hover:border-titanium-600',
    ].join(' ');

  const navStyle = useMode
    ? { backgroundColor: palette.panel, borderColor: palette.border }
    : undefined;
  const tabStyle = (active: boolean) =>
    useMode
      ? {
          backgroundColor: active ? palette.text : 'transparent',
          color: active ? palette.panel : palette.text,
          borderColor: palette.border,
        }
      : undefined;

  return (
    <nav
      style={navStyle}
      className={[
        'flex items-center gap-2 max-w-full overflow-x-auto scrollbar-hide p-1 bg-titanium-100/50 rounded-full border border-titanium-200 dark:bg-titanium-900/60 dark:border-titanium-800',
        className ?? '',
      ]
        .join(' ')
        .trim()}
    >
      <Link to="/" data-active={pathname === '/'} className={tabClass(pathname === '/')} style={tabStyle(pathname === '/')}>
        Play
      </Link>
      <Link to="/swap" data-active={economyActive} className={tabClass(economyActive)} style={tabStyle(economyActive)}>
        Swap
      </Link>
      <Link to="/stake" data-active={pathname.startsWith('/stake')} className={tabClass(pathname.startsWith('/stake'))} style={tabStyle(pathname.startsWith('/stake'))}>
        Stake
      </Link>
      <Link to="/bridge" data-active={bridgeActive} className={tabClass(bridgeActive)} style={tabStyle(bridgeActive)}>
        Bridge
      </Link>
      <Link to="/security" data-active={pathname.startsWith('/security')} className={tabClass(pathname.startsWith('/security'))} style={tabStyle(pathname.startsWith('/security'))}>
        Vault
      </Link>
    </nav>
  );
};
