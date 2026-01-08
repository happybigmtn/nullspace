import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { animated, useSpring, useTransition, to } from '@react-spring/web';
import { SPRING_CONFIGS, SPRING_LIQUID_CONFIGS } from '../../utils/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

type MobileDrawerProps = {
  label: string;
  title: string;
  children: React.ReactNode;
  className?: string;
};

// Instant config for reduced motion users
const INSTANT_CONFIG = { duration: 0 };

// Glass effect values from design tokens (GLASS.medium)
const GLASS_MEDIUM = {
  blur: 16, // BLUR.md
  border: 'rgba(255, 255, 255, 0.15)',
};

export const MobileDrawer: React.FC<MobileDrawerProps> = ({
  label,
  title,
  children,
  className,
}) => {
  const [open, setOpen] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // Animated backdrop blur
  const backdropSpring = useSpring({
    blur: open ? GLASS_MEDIUM.blur : 0,
    opacity: open ? 1 : 0,
    config: prefersReducedMotion
      ? INSTANT_CONFIG
      : SPRING_LIQUID_CONFIGS.liquidMorph,
  });

  // Panel transition
  const transitions = useTransition(open, {
    from: prefersReducedMotion
      ? { opacity: 0 }
      : { opacity: 0, scale: 0.95, y: 20 },
    enter: prefersReducedMotion
      ? { opacity: 1 }
      : { opacity: 1, scale: 1, y: 0 },
    leave: prefersReducedMotion
      ? { opacity: 0 }
      : { opacity: 0, scale: 0.95, y: 20 },
    config: prefersReducedMotion ? INSTANT_CONFIG : SPRING_CONFIGS.modal,
  });

  const overlay = transitions((style, show) =>
    show ? (
      <div
        className="fixed inset-0 z-[100] md:hidden flex items-center justify-center"
        data-testid="mobile-drawer"
      >
        {/* Animated glassmorphism backdrop */}
        <animated.div
          className="absolute inset-0 bg-black/70"
          style={
            prefersReducedMotion
              ? { opacity: backdropSpring.opacity }
              : {
                  opacity: backdropSpring.opacity,
                  backdropFilter: backdropSpring.blur.to((b) => `blur(${b}px)`),
                  WebkitBackdropFilter: backdropSpring.blur.to(
                    (b) => `blur(${b}px)`
                  ),
                }
          }
          onClick={() => setOpen(false)}
        />
        {/* Panel with glass border */}
        <animated.div
          className="relative w-[92%] max-w-sm sm:max-w-md max-h-[80vh] sm:max-h-[85vh] rounded-xl shadow-2xl overflow-hidden flex flex-col"
          style={{
            opacity: style.opacity,
            transform: prefersReducedMotion
              ? undefined
              : to(
                  [style.scale, style.y],
                  (s, y) => `scale(${s}) translateY(${y}px)`
                ),
            border: `1px solid ${GLASS_MEDIUM.border}`,
            backgroundColor: 'rgb(23, 23, 23)', // titanium-950
            boxShadow: `
              0 25px 50px -12px rgba(0, 0, 0, 0.5),
              inset 0 1px 1px rgba(255, 255, 255, 0.05)
            `,
          }}
          data-testid="mobile-drawer-panel"
          data-drawer-label={label}
        >
          {/* Glass sheen effect */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%)',
            }}
          />

          <div className="relative z-10 flex flex-col h-full">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800/50">
              <div className="text-[10px] text-gray-500 uppercase tracking-widest">
                {title}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs px-3 py-2 min-h-10 rounded border border-gray-700 bg-black/40 text-gray-400 hover:border-gray-500"
                aria-label="Close drawer"
              >
                ESC
              </button>
            </div>
            <div className="p-3 overflow-y-auto flex-1">{children}</div>
          </div>
        </animated.div>
      </div>
    ) : null
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`md:hidden text-xs tracking-widest uppercase font-mono px-3 py-2 min-h-11 rounded border border-gray-700 bg-black/40 text-gray-300 hover:border-gray-500 hover:text-white ${className ?? ''}`}
      >
        {label}
      </button>
      {typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay}
    </>
  );
};
