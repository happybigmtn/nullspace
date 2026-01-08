import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { animated, useSpring } from '@react-spring/web';
import { SPRING_LIQUID_CONFIGS } from '../utils/motion';
import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * LUX-020: Unified Mode Selector
 *
 * Design principles:
 * - Feels like iOS segment control / physical toggle switch
 * - No outer border - pill alone provides structure
 * - Spring-animated background pill with slight overshoot
 * - Clean typography, readable in both states
 * - Keyboard: Tab to focus group, arrows to navigate
 */

type TabsProps = {
  className?: string;
  tone?: 'default' | 'mode';
  palette?: {
    panel: string;
    text: string;
    border: string;
  };
};

interface TabConfig {
  path: string;
  label: string;
  isActive: (pathname: string) => boolean;
}

const tabs: TabConfig[] = [
  { path: '/', label: 'Play', isActive: (p) => p === '/' },
  {
    path: '/swap',
    label: 'Swap',
    isActive: (p) =>
      p.startsWith('/swap') ||
      p.startsWith('/borrow') ||
      p.startsWith('/liquidity'),
  },
  { path: '/stake', label: 'Stake', isActive: (p) => p.startsWith('/stake') },
  { path: '/bridge', label: 'Bridge', isActive: (p) => p.startsWith('/bridge') },
  {
    path: '/security',
    label: 'Vault',
    isActive: (p) => p.startsWith('/security'),
  },
];

export const PlaySwapStakeTabs: React.FC<TabsProps> = ({
  className,
  tone = 'default',
  palette,
}) => {
  const pathname = useLocation().pathname;
  const prefersReducedMotion = useReducedMotion();
  const navRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState({
    left: 0,
    width: 0,
  });

  const useMode = tone === 'mode' && palette;

  // Find active tab index
  const activeIndex = tabs.findIndex((tab) => tab.isActive(pathname));

  // Measure and update indicator position
  const updateIndicator = useCallback(() => {
    if (activeIndex === -1) return;

    const tab = tabRefs.current[activeIndex];
    const nav = navRef.current;

    if (!tab || !nav) return;

    const navRect = nav.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();

    setIndicatorStyle({
      left: tabRect.left - navRect.left,
      width: tabRect.width,
    });
  }, [activeIndex]);

  // Update on mount and route change
  useEffect(() => {
    updateIndicator();
  }, [pathname, updateIndicator]);

  // Update on resize
  useEffect(() => {
    const handleResize = () => updateIndicator();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateIndicator]);

  // Spring animation for the indicator
  const indicatorSpring = useSpring({
    left: indicatorStyle.left,
    width: indicatorStyle.width,
    config: prefersReducedMotion
      ? { duration: 0 }
      : SPRING_LIQUID_CONFIGS.liquidMorph,
  });

  const tabClass = (active: boolean) =>
    [
      'relative z-10 inline-flex shrink-0 whitespace-nowrap items-center justify-center h-9 px-4 rounded-full text-micro font-semibold tracking-wider uppercase transition-colors duration-150',
      active
        ? 'text-white dark:text-white'
        : 'text-titanium-500 hover:text-titanium-700 dark:text-titanium-400 dark:hover:text-titanium-200',
    ].join(' ');

  const navStyle = useMode
    ? { backgroundColor: palette.panel, borderColor: palette.border }
    : undefined;

  const tabStyle = (active: boolean) =>
    useMode
      ? {
          color: active ? palette.panel : palette.text,
        }
      : undefined;

  const indicatorBgStyle = useMode
    ? { backgroundColor: palette.text }
    : undefined;

  // Keyboard navigation: arrows to move between tabs
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (activeIndex === -1) return;

      let nextIndex = activeIndex;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        nextIndex = (activeIndex + 1) % tabs.length;
        e.preventDefault();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        nextIndex = (activeIndex - 1 + tabs.length) % tabs.length;
        e.preventDefault();
      }

      if (nextIndex !== activeIndex) {
        tabRefs.current[nextIndex]?.click();
        tabRefs.current[nextIndex]?.focus();
      }
    },
    [activeIndex]
  );

  return (
    <nav
      ref={navRef}
      style={navStyle}
      role="tablist"
      aria-label="Navigation modes"
      onKeyDown={handleKeyDown}
      className={[
        'relative flex items-center gap-1 max-w-full overflow-x-auto scrollbar-hide p-1 rounded-full',
        // LUX-020: Remove outer border - pill alone provides structure
        // LUX-021: gap-1 (4px) aligns with 4px grid
        'bg-titanium-100/30 dark:bg-titanium-800/30',
        className ?? '',
      ]
        .join(' ')
        .trim()}
    >
      {/* Sliding indicator background - the visual structure */}
      {activeIndex !== -1 && indicatorStyle.width > 0 && (
        <animated.span
          style={{
            ...indicatorSpring,
            ...indicatorBgStyle,
          }}
          className="absolute z-0 h-9 rounded-full bg-titanium-900 shadow-soft dark:bg-action-primary"
          aria-hidden="true"
        />
      )}

      {/* Tab links */}
      {tabs.map((tab, index) => {
        const isActive = tab.isActive(pathname);
        return (
          <Link
            key={tab.path}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            to={tab.path}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            data-active={isActive}
            className={tabClass(isActive)}
            style={tabStyle(isActive)}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
};
