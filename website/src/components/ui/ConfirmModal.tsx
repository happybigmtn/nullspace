import React, { useEffect } from 'react';
import { useTransition, animated, useSpring, to } from '@react-spring/web';
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

const INSTANT_CONFIG = { duration: 0 };

const GLASS_MEDIUM = {
  blur: 16,
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

  const backdropSpring = useSpring({
    blur: open ? GLASS_MEDIUM.blur : 0,
    opacity: open ? 1 : 0,
    config: prefersReducedMotion ? INSTANT_CONFIG : SPRING_LIQUID_CONFIGS.liquidMorph,
  });

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
        <animated.button
          type="button"
          aria-label="Close dialog"
          className="absolute inset-0 bg-black/20"
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
        <animated.div
          className="relative w-full max-w-md liquid-card overflow-hidden"
          style={{
            opacity: style.opacity,
            transform: prefersReducedMotion
              ? undefined
              : to(
                  [style.scale, style.y],
                  (s, y) => `scale(${s}) translateY(${y}px)`
                ),
          }}
        >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%)',
            }}
          />

          <div className="relative z-10">
            <div className="flex items-center justify-between px-4 py-3 border-b border-black/10 dark:border-white/10">
              <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">
                {title}
              </div>
              <button
                type="button"
                onClick={loading ? undefined : onClose}
                className="text-[10px] px-2 py-1 rounded-full liquid-chip text-ns hover:shadow-soft"
              >
                ESC
              </button>
            </div>

            <div className="p-4">{children}</div>

            <div className="px-4 py-3 border-t border-black/10 dark:border-white/10 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={loading ? undefined : onClose}
                className="h-11 px-4 rounded-full liquid-chip text-[10px] tracking-[0.28em] uppercase text-ns hover:shadow-soft active:scale-[0.98] transition-transform"
                disabled={loading}
              >
                {cancelText}
              </button>
              <button
                type="button"
                onClick={loading ? undefined : onConfirm}
                className="h-11 px-4 rounded-full liquid-chip text-action-destructive text-[10px] tracking-[0.28em] uppercase hover:shadow-soft active:scale-[0.98] transition-transform disabled:opacity-60 disabled:cursor-not-allowed"
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
