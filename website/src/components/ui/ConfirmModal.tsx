import React, { useEffect } from 'react';
import { useTransition, animated, useSpring } from '@react-spring/web';
import { SPRING_CONFIGS, SPRING_LIQUID_CONFIGS } from '../../utils/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

type ConfirmModalProps = {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

// Instant config for reduced motion users
const INSTANT_CONFIG = { duration: 0 };

// Glass effect values from design tokens (GLASS.medium)
const GLASS_MEDIUM = {
  blur: 16, // BLUR.md
  background: 'rgba(255, 255, 255, 0.15)',
  border: 'rgba(255, 255, 255, 0.15)',
};

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  title,
  children,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  loading = false,
  onClose,
  onConfirm,
}) => {
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  // Animated backdrop blur - tracks modal open progress
  const backdropSpring = useSpring({
    blur: open ? GLASS_MEDIUM.blur : 0,
    opacity: open ? 1 : 0,
    config: prefersReducedMotion ? INSTANT_CONFIG : SPRING_LIQUID_CONFIGS.liquidMorph,
  });

  // Spring transition for modal content
  const transitions = useTransition(open, {
    from: prefersReducedMotion
      ? { opacity: 0 }
      : { opacity: 0, scale: 0.95, y: 10 },
    enter: prefersReducedMotion
      ? { opacity: 1 }
      : { opacity: 1, scale: 1, y: 0 },
    leave: prefersReducedMotion
      ? { opacity: 0 }
      : { opacity: 0, scale: 0.95, y: 10 },
    config: prefersReducedMotion ? INSTANT_CONFIG : SPRING_CONFIGS.modal,
  });

  return transitions((style, show) =>
    show ? (
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
        {/* Animated glassmorphism backdrop */}
        <animated.button
          type="button"
          aria-label="Close dialog"
          className="absolute inset-0 bg-black/70"
          style={
            prefersReducedMotion
              ? { opacity: backdropSpring.opacity }
              : {
                  opacity: backdropSpring.opacity,
                  backdropFilter: backdropSpring.blur.to((b) => `blur(${b}px)`),
                  WebkitBackdropFilter: backdropSpring.blur.to((b) => `blur(${b}px)`),
                }
          }
          onClick={loading ? undefined : onClose}
        />
        {/* Modal content with glass border */}
        <animated.div
          className="relative w-full max-w-md rounded-lg shadow-2xl overflow-hidden"
          style={{
            opacity: style.opacity,
            transform: prefersReducedMotion
              ? undefined
              : style.scale.to(
                  (s) => `scale(${s}) translateY(${style.y.get()}px)`
                ),
            // Glass border effect
            border: `1px solid ${GLASS_MEDIUM.border}`,
            backgroundColor: 'rgb(23, 23, 23)', // titanium-950 base
            boxShadow: `
              0 25px 50px -12px rgba(0, 0, 0, 0.5),
              inset 0 1px 1px rgba(255, 255, 255, 0.05)
            `,
          }}
        >
          {/* Glass sheen effect */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%)',
            }}
          />

          <div className="relative z-10">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800/50">
              <div className="text-[10px] text-gray-500 tracking-widest uppercase">
                {title}
              </div>
              <button
                type="button"
                onClick={loading ? undefined : onClose}
                className="text-[10px] px-2 py-1 rounded border border-gray-700 bg-black/40 text-gray-400 hover:border-gray-500"
              >
                ESC
              </button>
            </div>

            <div className="p-4">{children}</div>

            <div className="px-4 py-3 border-t border-gray-800/50 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={loading ? undefined : onClose}
                className="h-11 px-4 rounded border border-gray-700 text-gray-300 text-[10px] tracking-widest uppercase hover:border-gray-500 active:scale-[0.98] transition-transform"
                disabled={loading}
              >
                {cancelText}
              </button>
              <button
                type="button"
                onClick={loading ? undefined : onConfirm}
                className="h-11 px-4 rounded border border-action-destructive text-action-destructive text-[10px] tracking-widest uppercase hover:bg-action-destructive/10 active:scale-[0.98] transition-transform disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={loading}
              >
                {loading ? 'Confirming…' : confirmText}
              </button>
            </div>
          </div>
        </animated.div>
      </div>
    ) : null
  );
};
