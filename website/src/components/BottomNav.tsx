import React, { useRef, useState, useLayoutEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSpring, animated } from '@react-spring/web';
import { Gamepad2, Gift, Shield, User } from 'lucide-react';
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
    label: 'Games',
    icon: <Gamepad2 className="w-6 h-6" />,
    match: (path) => path === '/',
  },
  {
    to: '/rewards',
    label: 'Rewards',
    icon: <Gift className="w-6 h-6" />,
    match: (path) => path.startsWith('/rewards'),
  },
  {
    to: '/security',
    label: 'Account',
    icon: <Shield className="w-6 h-6" />,
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

    setIndicatorStyle({
      left: itemRect.left - containerRect.left + itemRect.width / 2 - 16, // Center 32px indicator
      width: 32,
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
      className="fixed bottom-0 left-0 right-0 sm:hidden z-40 bg-white/80 dark:bg-titanium-900/90 backdrop-blur-lg border-t border-titanium-200 dark:border-titanium-800"
      style={{
        height: 'calc(var(--bottom-nav-h) + env(safe-area-inset-bottom))',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div ref={containerRef} className="h-full flex items-stretch relative max-w-md mx-auto">
        {/* Animated indicator pill */}
        {activeItem && (
          <animated.div
            className="absolute top-2 h-1 bg-titanium-900 dark:bg-action-primary rounded-full"
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
              className={`flex-1 flex flex-col items-center justify-center gap-1 min-h-[44px] transition-all duration-200 ${
                isActive
                  ? 'text-titanium-900 dark:text-white'
                  : 'text-titanium-400 hover:text-titanium-600 dark:text-titanium-500 dark:hover:text-titanium-300'
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
              {/* Label only visible for active item */}
              <span
                className={`text-micro uppercase tracking-wider font-medium transition-opacity duration-200 ${
                  isActive ? 'opacity-100' : 'opacity-0'
                }`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};
