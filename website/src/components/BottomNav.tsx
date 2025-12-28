import React from 'react';
import { Link, useLocation } from 'react-router-dom';

type BottomNavItem = { to: string; label: string; end?: boolean };

const ITEMS: BottomNavItem[] = [
  { to: '/', label: 'Play', end: true },
  { to: '/swap', label: 'Swap' },
  { to: '/stake', label: 'Stake' },
  { to: '/bridge', label: 'Bridge' },
  { to: '/security', label: 'Vault' },
  { to: '/explorer', label: 'Explorer' },
];

export const BottomNav: React.FC = () => {
  const pathname = useLocation().pathname;
  const economyActive = pathname.startsWith('/swap') || pathname.startsWith('/borrow') || pathname.startsWith('/liquidity');

  const isItemActive = (to: string) => {
    if (to === '/') return pathname === '/';
    if (to === '/swap') return economyActive;
    if (to === '/stake') return pathname.startsWith('/stake');
    if (to === '/bridge') return pathname.startsWith('/bridge');
    if (to === '/security') return pathname.startsWith('/security');
    if (to === '/explorer') return pathname.startsWith('/explorer');
    return pathname === to;
  };

  const itemClass = (active: boolean) =>
    [
      'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] tracking-widest uppercase transition-colors',
      active ? 'text-action-success bg-action-success/10' : 'text-gray-400 hover:text-white',
    ].join(' ');

  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 left-0 right-0 sm:hidden z-40 border-t border-gray-800 bg-titanium-900/95 backdrop-blur"
      style={{
        height: 'calc(var(--bottom-nav-h) + env(safe-area-inset-bottom))',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="h-full flex items-stretch">
        {ITEMS.map((item) => (
          <Link key={item.to} to={item.to} className={itemClass(isItemActive(item.to))}>
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
};
