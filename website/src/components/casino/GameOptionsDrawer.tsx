import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { animated, useSpring, useTransition, to } from '@react-spring/web';
import { X, ChevronDown } from 'lucide-react';
import { SPRING_CONFIGS } from '../../utils/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/**
 * LUX-017: Unified GameOptionsDrawer
 *
 * Consolidates SideBetsDrawer, PanelDrawer, BetsDrawer, and MobileDrawer
 * into a single, consistent component.
 *
 * Features:
 * - Works on both mobile and desktop
 * - Consistent styling with luxury design language
 * - Collapsible sections for organization
 * - Smooth spring animations
 * - Keyboard accessible (Escape to close)
 */

type GameOptionsDrawerProps = {
  /** Title shown in drawer header */
  title?: string;
  /** Label shown on trigger button */
  label?: string;
  /** Optional count badge on trigger button */
  count?: number;
  /** Keyboard shortcut hint shown in header */
  shortcutHint?: string;
  /** Disable the trigger button */
  disabled?: boolean;
  /** Additional className for trigger button */
  className?: string;
  /** Drawer content */
  children: React.ReactNode;
  /** Controlled open state */
  open?: boolean;
  /** Controlled open state handler */
  onOpenChange?: (open: boolean) => void;
  /** Variant for styling */
  variant?: 'default' | 'compact';
  /** Size of the drawer */
  size?: 'sm' | 'md' | 'lg';
};

type SectionProps = {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

// Instant config for reduced motion users
const INSTANT_CONFIG = { duration: 0 };

/**
 * Collapsible section for organizing drawer content
 */
export const GameOptionsSection: React.FC<SectionProps> = ({
  title,
  children,
  defaultOpen = true,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const prefersReducedMotion = useReducedMotion();

  const chevronSpring = useSpring({
    rotate: isOpen ? 180 : 0,
    config: prefersReducedMotion ? INSTANT_CONFIG : { tension: 300, friction: 20 },
  });

  const contentSpring = useSpring({
    height: isOpen ? 'auto' : 0,
    opacity: isOpen ? 1 : 0,
    config: prefersReducedMotion ? INSTANT_CONFIG : { tension: 300, friction: 26 },
  });

  return (
    <div className={`border-b border-ns last:border-b-0 ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-3 px-1 text-caption font-medium text-ns-muted hover:text-ns transition-colors"
        aria-expanded={isOpen}
      >
        <span className="uppercase tracking-wider text-micro">{title}</span>
        <animated.div style={{ transform: chevronSpring.rotate.to(r => `rotate(${r}deg)`) }}>
          <ChevronDown className="w-4 h-4" />
        </animated.div>
      </button>
      <animated.div style={{ height: contentSpring.height, opacity: contentSpring.opacity, overflow: 'hidden' }}>
        <div className="pb-4">{children}</div>
      </animated.div>
    </div>
  );
};

const SIZE_CLASSES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-xl',
};

export const GameOptionsDrawer: React.FC<GameOptionsDrawerProps> = ({
  title = 'Options',
  label = 'Options',
  count = 0,
  shortcutHint,
  disabled = false,
  className,
  children,
  open,
  onOpenChange,
  variant = 'default',
  size = 'md',
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const hasActive = count > 0;
  const prefersReducedMotion = useReducedMotion();

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, setOpen]);

  // Click outside handler - memoized
  const handleBackdropClick = useCallback(() => setOpen(false), [setOpen]);

  // Backdrop animation
  const backdropSpring = useSpring({
    opacity: isOpen ? 1 : 0,
    config: prefersReducedMotion ? INSTANT_CONFIG : { tension: 200, friction: 26 },
  });

  // Panel transition
  const transitions = useTransition(isOpen, {
    from: prefersReducedMotion
      ? { opacity: 0 }
      : { opacity: 0, scale: 0.96, y: 16 },
    enter: prefersReducedMotion
      ? { opacity: 1 }
      : { opacity: 1, scale: 1, y: 0 },
    leave: prefersReducedMotion
      ? { opacity: 0 }
      : { opacity: 0, scale: 0.96, y: 16 },
    config: prefersReducedMotion ? INSTANT_CONFIG : SPRING_CONFIGS.modal,
  });

  const overlay = transitions((style, show) =>
    show ? (
      <div
        className="fixed inset-0 z-[110] flex items-center justify-center p-4"
        data-testid="game-options-drawer"
      >
        {/* Backdrop */}
        <animated.div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          style={{ opacity: backdropSpring.opacity }}
          onClick={handleBackdropClick}
        />

        {/* Panel */}
        <animated.div
          className={`relative w-full ${SIZE_CLASSES[size]} max-h-[85vh] rounded-2xl liquid-card liquid-sheen border border-ns shadow-float overflow-hidden flex flex-col`}
          style={{
            opacity: style.opacity,
            transform: prefersReducedMotion
              ? undefined
              : to([style.scale, style.y], (s, y) => `scale(${s}) translateY(${y}px)`),
          }}
          data-testid="game-options-panel"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-ns bg-ns-surface">
            <div className="flex items-center gap-3">
              <h2 className="text-caption font-semibold uppercase tracking-widest text-ns-muted">
                {title}
              </h2>
              {shortcutHint && (
                <kbd className="text-micro font-mono text-ns-muted liquid-chip px-1.5 py-0.5 rounded">
                  {shortcutHint}
                </kbd>
              )}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-2 rounded-lg text-ns-muted hover:text-ns hover:bg-ns-surface transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {children}
          </div>
        </animated.div>
      </div>
    ) : null
  );

  // Trigger button styles
  const triggerClasses = variant === 'compact'
    ? `h-9 px-3 rounded-xl text-micro font-semibold uppercase tracking-wider transition-all liquid-chip ${
        disabled
          ? 'text-ns-muted cursor-not-allowed'
          : hasActive
            ? 'text-mono-0 dark:text-mono-1000 bg-mono-0/10'
            : 'text-ns-muted hover:text-ns'
      }`
    : `h-10 px-4 rounded-full border text-caption font-semibold uppercase tracking-widest transition-all liquid-chip ${
        disabled
          ? 'border-ns text-ns-muted cursor-not-allowed'
          : hasActive
            ? 'border-mono-0/50 text-mono-0 dark:text-mono-1000 bg-mono-0/10'
            : 'border-ns text-ns-muted hover:text-ns hover:border-ns'
      }`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={`${triggerClasses} ${className ?? ''}`}
      >
        {label}
        {count > 0 && (
          <span className="ml-2 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-mono-0/20 text-micro font-bold text-mono-0 dark:text-mono-1000">
            {count}
          </span>
        )}
      </button>
      {typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay}
    </>
  );
};

// Re-export for backwards compatibility during migration
export { GameOptionsDrawer as SideBetsDrawer };
export { GameOptionsDrawer as PanelDrawer };
