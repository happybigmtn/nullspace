import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { animated, useSpring } from '@react-spring/web';
import { SPRING_LIQUID_CONFIGS } from '../utils/motion';
import { useReducedMotion } from '../hooks/useReducedMotion';

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
      'relative z-10 inline-flex shrink-0 whitespace-nowrap items-center justify-center h-8 px-4 rounded-full text-[10px] font-medium tracking-[0.18em] uppercase transition-colors motion-interaction',
      active
        ? 'text-white dark:text-action-success'
        : 'text-titanium-700 hover:text-titanium-900 dark:text-titanium-200 dark:hover:text-white',
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

  return (
    <nav
      ref={navRef}
      style={navStyle}
      className={[
        'relative flex items-center gap-0.5 max-w-full overflow-x-auto scrollbar-hide p-1 bg-titanium-100/50 rounded-full border border-titanium-200 dark:bg-titanium-900/60 dark:border-titanium-800',
        className ?? '',
      ]
        .join(' ')
        .trim()}
    >
      {/* Sliding indicator background */}
      {activeIndex !== -1 && indicatorStyle.width > 0 && (
        <animated.span
          style={{
            ...indicatorSpring,
            ...indicatorBgStyle,
          }}
          className="absolute z-0 h-8 rounded-full bg-titanium-900 shadow-sm dark:bg-action-success/20"
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
