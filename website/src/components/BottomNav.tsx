import React, { useRef, useState, useLayoutEffect, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSpring, animated } from '@react-spring/web';
import { MoreHorizontal, X, ArrowRightLeft, Search, BarChart3 } from 'lucide-react';
import { SPRING_LIQUID_CONFIGS } from '../utils/motion';
import { useReducedMotion } from '../hooks/useReducedMotion';

type BottomNavItem = { to: string; label: string; end?: boolean };

// Primary nav items (4-5 max for optimal mobile UX per iOS HIG / Material Design)
const PRIMARY_ITEMS: BottomNavItem[] = [
  { to: '/', label: 'Play', end: true },
  { to: '/swap', label: 'Swap' },
  { to: '/stake', label: 'Stake' },
  { to: '/security', label: 'Vault' },
];

// Secondary items moved to "More" menu
const SECONDARY_ITEMS: BottomNavItem[] = [
  { to: '/bridge', label: 'Bridge' },
  { to: '/explorer', label: 'Explorer' },
];

export const BottomNav: React.FC = () => {
  const pathname = useLocation().pathname;
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLAnchorElement | HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  // Build secondary items dynamically (add Analytics if ops enabled)
  const hasOps =
    !!(import.meta as any)?.env?.VITE_OPS_URL || !!(import.meta as any)?.env?.VITE_ANALYTICS_URL;
  const secondaryItems = hasOps
    ? [...SECONDARY_ITEMS, { to: '/analytics', label: 'Analytics' }]
    : SECONDARY_ITEMS;

  const economyActive = pathname.startsWith('/swap') || pathname.startsWith('/borrow') || pathname.startsWith('/liquidity');

  const isItemActive = (to: string) => {
    if (to === '/') return pathname === '/';
    if (to === '/swap') return economyActive;
    if (to === '/stake') return pathname.startsWith('/stake');
    if (to === '/bridge') return pathname.startsWith('/bridge');
    if (to === '/security') return pathname.startsWith('/security');
    if (to === '/explorer') return pathname.startsWith('/explorer');
    if (to === '/analytics') return pathname.startsWith('/analytics');
    return pathname === to;
  };

  // Check if any secondary item is active (shows indicator on "More" button)
  const isSecondaryActive = secondaryItems.some((item) => isItemActive(item.to));

  // Find active item (from primary items OR treat "More" as active if secondary is active)
  const activeItem = PRIMARY_ITEMS.find((item) => isItemActive(item.to)) ||
    (isSecondaryActive ? { to: 'more', label: 'More' } : undefined);

  // Update indicator position when route changes
  const updateIndicator = useCallback(() => {
    if (!activeItem || !containerRef.current) return;

    const itemEl = itemRefs.current.get(activeItem.to);
    if (!itemEl) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const itemRect = itemEl.getBoundingClientRect();

    setIndicatorStyle({
      left: itemRect.left - containerRect.left,
      width: itemRect.width,
    });
  }, [activeItem]);

  // Calculate position on mount and route change
  useLayoutEffect(() => {
    updateIndicator();
  }, [pathname, updateIndicator]);

  // Recalculate on window resize
  useLayoutEffect(() => {
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [updateIndicator]);

  // Spring animation for indicator
  const spring = useSpring({
    left: indicatorStyle.left,
    width: indicatorStyle.width,
    config: prefersReducedMotion ? { duration: 0 } : SPRING_LIQUID_CONFIGS.liquidSlide,
  });

  const setRef = (to: string) => (el: HTMLAnchorElement | HTMLButtonElement | null) => {
    if (el) {
      itemRefs.current.set(to, el);
    } else {
      itemRefs.current.delete(to);
    }
  };

  // Close menu when route changes
  useLayoutEffect(() => {
    setMoreMenuOpen(false);
  }, [pathname]);

  const itemClass = (active: boolean) =>
    [
      // min-h-11 = 44px touch target (WCAG 2.2 SC 2.5.8)
      'flex-1 flex flex-col items-center justify-center gap-0.5 text-xs tracking-wide uppercase transition-all duration-200 min-h-11',
      active ? 'text-action-success' : 'text-gray-400 hover:text-white',
    ].join(' ');

  const labelClass = (active: boolean) =>
    [
      'transition-transform duration-200',
      active && !prefersReducedMotion ? 'scale-110' : 'scale-100',
    ].join(' ');

  const getIcon = (label: string) => {
    switch (label) {
      case 'Bridge': return <ArrowRightLeft className="w-5 h-5" />;
      case 'Explorer': return <Search className="w-5 h-5" />;
      case 'Analytics': return <BarChart3 className="w-5 h-5" />;
      default: return null;
    }
  };

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed bottom-0 left-0 right-0 sm:hidden z-40 border-t border-gray-800 bg-titanium-900/95 backdrop-blur"
        style={{
          height: 'calc(var(--bottom-nav-h) + env(safe-area-inset-bottom))',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div ref={containerRef} className="h-full flex items-stretch relative">
          {/* Animated indicator line */}
          <animated.div
            className="absolute top-0 h-[2px] bg-action-success rounded-full"
            style={{
              left: spring.left,
              width: spring.width,
            }}
            aria-hidden="true"
          />

          {/* Primary nav items */}
          {PRIMARY_ITEMS.map((item) => {
            const active = isItemActive(item.to);
            return (
              <Link
                key={item.to}
                ref={setRef(item.to) as (el: HTMLAnchorElement | null) => void}
                to={item.to}
                className={itemClass(active)}
              >
                <span className={labelClass(active)}>{item.label}</span>
              </Link>
            );
          })}

          {/* More button for secondary items */}
          <button
            ref={setRef('more') as (el: HTMLButtonElement | null) => void}
            onClick={() => setMoreMenuOpen(true)}
            className={itemClass(isSecondaryActive)}
            aria-expanded={moreMenuOpen}
            aria-haspopup="menu"
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className={labelClass(isSecondaryActive)}>More</span>
          </button>
        </div>
      </nav>

      {/* More menu overlay */}
      {moreMenuOpen && (
        <div
          className="fixed inset-0 z-50 sm:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="More navigation options"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMoreMenuOpen(false)}
          />

          {/* Menu panel */}
          <div
            className="absolute bottom-0 left-0 right-0 bg-titanium-900 border-t border-gray-700 rounded-t-3xl animate-slide-up"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            {/* Handle */}
            <div className="w-12 h-1 bg-gray-600 rounded-full mx-auto mt-3 mb-4" />

            {/* Close button */}
            <button
              onClick={() => setMoreMenuOpen(false)}
              className="absolute top-3 right-4 w-11 h-11 flex items-center justify-center rounded-full bg-gray-800 text-gray-400 hover:text-white transition-colors"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Menu items */}
            <div className="px-4 pb-6 space-y-2">
              {secondaryItems.map((item) => {
                const active = isItemActive(item.to);
                return (
                  <button
                    key={item.to}
                    onClick={() => {
                      navigate(item.to);
                      setMoreMenuOpen(false);
                    }}
                    className={[
                      'w-full flex items-center gap-4 px-4 py-4 rounded-2xl transition-all min-h-14',
                      active
                        ? 'bg-action-success/20 text-action-success'
                        : 'bg-gray-800/50 text-gray-300 hover:bg-gray-800 hover:text-white',
                    ].join(' ')}
                  >
                    {getIcon(item.label)}
                    <span className="text-base font-medium">{item.label}</span>
                    {active && (
                      <span className="ml-auto text-xs text-action-success">Active</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
