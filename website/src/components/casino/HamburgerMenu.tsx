import React, { useState, useEffect, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { animated, useTransition } from '@react-spring/web';
import { SPRING_CONFIGS } from '../../utils/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/**
 * LUX-018: Minimal HamburgerMenu
 *
 * Design principles:
 * - Maximum 6 menu items
 * - Essential items only: Games, Account, Settings, Help
 * - Clean typography-only list (no icons)
 * - Subtle dividers between groups
 * - Keyboard accessible
 */

interface HamburgerMenuProps {
  playMode: 'CASH' | 'FREEROLL' | null;
  onSetPlayMode: (mode: 'CASH' | 'FREEROLL' | null) => void;
  onOpenSafety: () => void;
  onOpenRewards: () => void;
  onToggleHelp: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  touchMode: boolean;
  onToggleTouchMode: () => void;
  reducedMotion: boolean;
  onToggleReducedMotion: () => void;
  publicKeyHex?: string | null;
  focusMode?: boolean;
  onToggleFocus?: () => void;
  walletSlot?: React.ReactNode;
}

const INSTANT_CONFIG = { duration: 0 };

export const HamburgerMenu: React.FC<HamburgerMenuProps> = ({
  playMode,
  onSetPlayMode,
  onOpenSafety,
  onOpenRewards,
  onToggleHelp,
  soundEnabled,
  onToggleSound,
  reducedMotion,
  onToggleReducedMotion,
  focusMode,
  onToggleFocus,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const prefersReducedMotion = useReducedMotion();

  const toggle = useCallback(() => setIsOpen(prev => !prev), []);
  const close = useCallback(() => setIsOpen(false), []);

  // Close on route change
  useEffect(() => {
    close();
  }, [location.pathname, close]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, close]);

  // Menu transition animation
  const transitions = useTransition(isOpen, {
    from: prefersReducedMotion
      ? { opacity: 0 }
      : { opacity: 0, x: 8 },
    enter: prefersReducedMotion
      ? { opacity: 1 }
      : { opacity: 1, x: 0 },
    leave: prefersReducedMotion
      ? { opacity: 0 }
      : { opacity: 0, x: 8 },
    config: prefersReducedMotion ? INSTANT_CONFIG : SPRING_CONFIGS.snappy,
  });

  // Simple menu item
  const MenuItem = ({ to, label, onClick }: { to?: string; label: string; onClick?: () => void }) => {
    const baseClasses = 'block w-full text-left py-3 px-4 text-body font-medium text-titanium-700 hover:text-titanium-900 dark:text-titanium-300 dark:hover:text-titanium-100 transition-colors';

    if (to) {
      return (
        <NavLink
          to={to}
          onClick={close}
          className={({ isActive }) =>
            `${baseClasses} ${isActive ? 'text-titanium-900 dark:text-white' : ''}`
          }
        >
          {label}
        </NavLink>
      );
    }

    return (
      <button
        type="button"
        onClick={() => {
          onClick?.();
          close();
        }}
        className={baseClasses}
      >
        {label}
      </button>
    );
  };

  // Toggle setting item
  const ToggleItem = ({ label, value, onToggle }: { label: string; value: boolean; onToggle: () => void }) => (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between py-3 px-4 text-body text-titanium-700 dark:text-titanium-300 hover:bg-titanium-50 dark:hover:bg-titanium-800/50 transition-colors"
    >
      <span className="font-medium">{label}</span>
      <span className={`text-caption font-semibold ${value ? 'text-action-success' : 'text-titanium-400'}`}>
        {value ? 'On' : 'Off'}
      </span>
    </button>
  );

  return (
    <div className="relative">
      {/* Hamburger Button */}
      <button
        onClick={toggle}
        aria-label="Menu"
        aria-expanded={isOpen}
        className="w-10 h-10 flex items-center justify-center rounded-full bg-white border border-titanium-200 shadow-soft hover:shadow-md transition-all active:scale-95 dark:bg-titanium-900/70 dark:border-titanium-800"
      >
        <div className="flex flex-col gap-1">
          <span
            className={`w-4 h-0.5 bg-titanium-900 dark:bg-titanium-100 rounded-full transition-transform ${
              isOpen ? 'rotate-45 translate-y-1.5' : ''
            }`}
          />
          <span
            className={`w-4 h-0.5 bg-titanium-900 dark:bg-titanium-100 rounded-full transition-opacity ${
              isOpen ? 'opacity-0' : ''
            }`}
          />
          <span
            className={`w-4 h-0.5 bg-titanium-900 dark:bg-titanium-100 rounded-full transition-transform ${
              isOpen ? '-rotate-45 -translate-y-1.5' : ''
            }`}
          />
        </div>
      </button>

      {/* Menu Overlay */}
      {transitions((style, show) =>
        show ? (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-[90] bg-titanium-900/10 backdrop-blur-sm dark:bg-black/40"
              onClick={close}
            />

            {/* Menu Panel */}
            <animated.div
              style={{
                opacity: style.opacity,
                transform: prefersReducedMotion
                  ? undefined
                  : style.x.to(x => `translateX(${x}px)`),
              }}
              className="absolute top-12 right-0 w-64 bg-white border border-titanium-200 rounded-2xl shadow-float z-[100] overflow-hidden dark:bg-titanium-900 dark:border-titanium-800"
              role="menu"
            >
              {/* Primary Navigation - Essential items only */}
              <div className="py-2">
                <MenuItem to="/" label="Games" />
                <MenuItem label="Rewards" onClick={onOpenRewards} />
                <MenuItem to="/security" label="Account" />
              </div>

              {/* Divider */}
              <div className="h-px bg-titanium-100 dark:bg-titanium-800 mx-4" />

              {/* Settings */}
              <div className="py-2">
                <ToggleItem label="Sound" value={soundEnabled} onToggle={onToggleSound} />
                <ToggleItem label="Motion" value={!reducedMotion} onToggle={onToggleReducedMotion} />
                {onToggleFocus && (
                  <ToggleItem label="Focus" value={Boolean(focusMode)} onToggle={onToggleFocus} />
                )}
              </div>

              {/* Divider */}
              <div className="h-px bg-titanium-100 dark:bg-titanium-800 mx-4" />

              {/* Help & Safety */}
              <div className="py-2">
                <MenuItem label="Help" onClick={onToggleHelp} />
                <MenuItem label="Safety" onClick={onOpenSafety} />
              </div>

              {/* Mode Selector */}
              <div className="p-4 bg-titanium-50 dark:bg-titanium-800/50">
                <div className="text-micro text-titanium-500 uppercase tracking-wider mb-2">
                  Play Mode
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      onSetPlayMode('CASH');
                      close();
                    }}
                    className={`flex-1 py-2 text-caption font-semibold rounded-xl transition-all ${
                      playMode === 'CASH'
                        ? 'bg-titanium-900 text-white dark:bg-action-primary dark:text-white'
                        : 'bg-white text-titanium-600 border border-titanium-200 dark:bg-titanium-900 dark:text-titanium-400 dark:border-titanium-700'
                    }`}
                  >
                    Cash
                  </button>
                  <button
                    onClick={() => {
                      onSetPlayMode('FREEROLL');
                      close();
                    }}
                    className={`flex-1 py-2 text-caption font-semibold rounded-xl transition-all ${
                      playMode === 'FREEROLL'
                        ? 'bg-titanium-900 text-white dark:bg-action-primary dark:text-white'
                        : 'bg-white text-titanium-600 border border-titanium-200 dark:bg-titanium-900 dark:text-titanium-400 dark:border-titanium-700'
                    }`}
                  >
                    Tournament
                  </button>
                </div>
              </div>
            </animated.div>
          </>
        ) : null
      )}
    </div>
  );
};
