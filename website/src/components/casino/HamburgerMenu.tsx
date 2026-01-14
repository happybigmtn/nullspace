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
    const baseClasses = 'block w-full text-left py-3 px-4 text-body font-medium text-ns-muted hover:text-ns transition-colors';

    if (to) {
      return (
        <NavLink
          to={to}
          onClick={close}
          className={({ isActive }) =>
            `${baseClasses} ${isActive ? 'text-ns' : ''}`
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
      className="w-full flex items-center justify-between py-3 px-4 text-body text-ns-muted hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
    >
      <span className="font-medium">{label}</span>
      <span className={`text-caption font-semibold ${value ? 'text-ns font-bold' : 'text-ns-muted'}`}>
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
        className="w-10 h-10 flex items-center justify-center rounded-full liquid-chip shadow-soft hover:shadow-md transition-all active:scale-95"
      >
        <div className="flex flex-col gap-1">
          <span
            className={`w-4 h-0.5 bg-black/80 dark:bg-white/80 rounded-full transition-transform ${
              isOpen ? 'rotate-45 translate-y-1.5' : ''
            }`}
          />
          <span
            className={`w-4 h-0.5 bg-black/80 dark:bg-white/80 rounded-full transition-opacity ${
              isOpen ? 'opacity-0' : ''
            }`}
          />
          <span
            className={`w-4 h-0.5 bg-black/80 dark:bg-white/80 rounded-full transition-transform ${
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
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-[90] bg-black/20 backdrop-blur-sm cursor-default"
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
              className="absolute top-12 right-0 w-64 liquid-card shadow-float z-[100] overflow-hidden"
              role="menu"
            >
              {/* Primary Navigation - Essential items only */}
              <div className="py-2">
                <MenuItem to="/" label="Games" />
                <MenuItem label="Rewards" onClick={onOpenRewards} />
                <MenuItem to="/security" label="Account" />
              </div>

              {/* Divider */}
              <div className="h-px bg-black/10 dark:bg-white/10 mx-4" />

              {/* Settings */}
              <div className="py-2">
                <ToggleItem label="Sound" value={soundEnabled} onToggle={onToggleSound} />
                <ToggleItem label="Motion" value={!reducedMotion} onToggle={onToggleReducedMotion} />
                {onToggleFocus && (
                  <ToggleItem label="Focus" value={Boolean(focusMode)} onToggle={onToggleFocus} />
                )}
              </div>

              {/* Divider */}
              <div className="h-px bg-black/10 dark:bg-white/10 mx-4" />

              {/* Help & Safety */}
              <div className="py-2">
                <MenuItem label="Help" onClick={onToggleHelp} />
                <MenuItem label="Safety" onClick={onOpenSafety} />
              </div>

              {/* Mode Selector */}
              <div className="p-4 bg-white/60">
                <div className="text-micro text-ns-muted uppercase tracking-[0.3em] mb-2">
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
                        ? 'bg-black/80 text-white'
                        : 'bg-white/70 text-ns-muted border border-black/10'
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
                        ? 'bg-black/80 text-white'
                        : 'bg-white/70 text-ns-muted border border-black/10'
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
