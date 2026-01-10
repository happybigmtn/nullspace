import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { BottomNav } from './BottomNav';
import { PageTransition } from './ui/PageTransition';
import { GlassSurface } from './ui';
import { ThemeToggle } from './ui/ThemeToggle';

const NAV_ITEMS = [
  {
    to: '/',
    label: 'Play',
    helper: 'Casino',
    match: (path) => path === '/',
  },
  {
    to: '/economy',
    label: 'Economy',
    helper: 'Swap & Borrow',
    match: (path) =>
      path.startsWith('/economy') ||
      path.startsWith('/swap') ||
      path.startsWith('/borrow') ||
      path.startsWith('/liquidity'),
  },
  {
    to: '/stake',
    label: 'Stake',
    helper: 'Earn',
    match: (path) => path.startsWith('/stake'),
  },
  {
    to: '/bridge',
    label: 'Bridge',
    helper: 'Move RNG',
    match: (path) => path.startsWith('/bridge'),
  },
  {
    to: '/security',
    label: 'Security',
    helper: 'Vault',
    match: (path) => path.startsWith('/security'),
  },
  {
    to: '/explorer',
    label: 'Explorer',
    helper: 'Blocks',
    match: (path) => path.startsWith('/explorer'),
  },
  {
    to: '/analytics',
    label: 'Analytics',
    helper: 'Ops',
    match: (path) => path.startsWith('/analytics'),
  },
];

export default function AppLayout() {
  const location = useLocation();
  return (
    <div className="min-h-screen pb-bottom-nav liquid-shell">
      <a
        href="#app-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:border focus:border-black/20 focus:bg-white/90 focus:px-4 focus:py-2 focus:text-[11px] focus:tracking-[0.3em] focus:text-black"
      >
        Skip to content
      </a>
      <GlassSurface
        as="header"
        depth="flat"
        className="sticky top-0 z-40 border-b border-black/5 dark:border-white/10 bg-white/70 dark:bg-black/30 backdrop-blur-xl"
      >
        <div className="mx-auto flex w-full max-w-container-2xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-2 font-display text-lg tracking-tight text-ns">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white/80 text-[12px] font-semibold uppercase tracking-[0.3em] dark:border-white/10 dark:bg-white/5">
                ns
              </span>
              <span className="hidden sm:inline">nullspace</span>
            </Link>
            <nav className="hidden lg:flex items-center gap-2">
              {NAV_ITEMS.map((item) => {
                const active = item.match(location.pathname);
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={`liquid-chip px-3 py-2 transition-all ${
                      active
                        ? 'text-ns border-black/20 dark:border-white/20'
                        : 'text-ns-muted hover:text-ns border-black/10 dark:border-white/10'
                    }`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <div className="text-[11px] uppercase tracking-[0.28em] font-semibold">{item.label}</div>
                    <div className="text-[10px] text-ns-muted">{item.helper}</div>
                  </NavLink>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle className="hidden md:inline-flex" />
          </div>
        </div>
      </GlassSurface>
      <main id="app-main" tabIndex={-1}>
        <div className="mx-auto w-full max-w-container-2xl px-4 pb-20 pt-6 sm:px-6">
          <PageTransition>
            <Outlet />
          </PageTransition>
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
