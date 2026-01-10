import React, { useRef, useState, useLayoutEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSpring, animated } from '@react-spring/web';
import { Gamepad2, LineChart, Shield, Layers } from 'lucide-react';
import { SPRING_LIQUID_CONFIGS } from '../utils/motion';
import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * LUX-019: Simplified BottomNav
 *
 * Design principles:
 * - Maximum 4 nav items (iPhone dock model)
 * - Clean icons without permanent labels
 * - Active state with spring-animated indicator
 * - Minimal visual footprint
 */

type BottomNavItem = {
  to: string;
  label: string;
  icon: React.ReactNode;
  match?: (pathname: string) => boolean;
};

// Essential navigation only - 4 items max
const NAV_ITEMS: BottomNavItem[] = [
  {
    to: '/',
    label: 'Play',
    icon: <Gamepad2 className="w-5 h-5" />,
    match: (path) => path === '/',
  },
  {
    to: '/economy',
    label: 'Economy',
    icon: <LineChart className="w-5 h-5" />,
    match: (path) =>
      path.startsWith('/economy') ||
      path.startsWith('/swap') ||
      path.startsWith('/borrow') ||
      path.startsWith('/liquidity'),
  },
  {
    to: '/stake',
    label: 'Stake',
    icon: <Layers className="w-5 h-5" />,
    match: (path) => path.startsWith('/stake'),
  },
  {
    to: '/security',
    label: 'Vault',
    icon: <Shield className="w-5 h-5" />,
    match: (path) => path.startsWith('/security'),
  },
];

export const BottomNav: React.FC = () => {
  const pathname = useLocation().pathname;
  const prefersReducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  // Find active item
  const activeItem = NAV_ITEMS.find((item) =>
    item.match ? item.match(pathname) : pathname === item.to
  );

  // Update indicator position
  const updateIndicator = useCallback(() => {
    if (!activeItem || !containerRef.current) {
      setIndicatorStyle({ left: 0, width: 0 });
      return;
    }

    const itemEl = itemRefs.current.get(activeItem.to);
    if (!itemEl) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const itemRect = itemEl.getBoundingClientRect();

    const inset = 6;
    setIndicatorStyle({
      left: itemRect.left - containerRect.left + inset,
      width: Math.max(24, itemRect.width - inset * 2),
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

  const setRef = (to: string) => (el: HTMLAnchorElement | null) => {
    if (el) {
      itemRefs.current.set(to, el);
    } else {
      itemRefs.current.delete(to);
    }
  };

  return (
    <nav
      aria-label="Primary navigation"
      className="fixed bottom-0 left-0 right-0 sm:hidden z-40"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="mx-auto w-full max-w-md px-3 pb-3">
        <div
          ref={containerRef}
          className="relative flex items-center justify-between gap-1 liquid-card h-16 px-2"
        >
          {/* Animated indicator pill */}
          {activeItem && (
            <animated.div
              className="absolute top-2 bottom-2 rounded-2xl bg-white/70 dark:bg-white/5 border border-black/10 dark:border-white/10 shadow-soft"
              style={{
                left: spring.left,
                width: spring.width,
              }}
              aria-hidden="true"
            />
          )}

          {/* Nav items */}
          {NAV_ITEMS.map((item) => {
            const isActive = activeItem?.to === item.to;
            return (
              <Link
                key={item.to}
                ref={setRef(item.to)}
                to={item.to}
                className={`relative z-10 flex-1 flex flex-col items-center justify-center gap-1 min-h-[44px] transition-all duration-200 ${
                  isActive
                    ? 'text-ns'
                    : 'text-ns-muted hover:text-ns'
                }`}
                aria-current={isActive ? 'page' : undefined}
                title={item.label}
              >
                <span
                  className={`transition-transform duration-200 ${
                    isActive && !prefersReducedMotion ? 'scale-110' : 'scale-100'
                  }`}
                >
                  {item.icon}
                </span>
                <span className="text-[10px] uppercase tracking-[0.28em] font-semibold">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
};
