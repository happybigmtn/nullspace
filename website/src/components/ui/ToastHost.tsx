import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { animated, useTransition, useSpring, config } from '@react-spring/web';
import { useDrag } from '@use-gesture/react';
import {
  dismissToast,
  getToasts,
  subscribeToasts,
  type Toast,
} from '../../services/toasts';
import { SPRING_LIQUID_CONFIGS, DURATIONS } from '../../utils/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

function levelClasses(level: Toast['level']) {
  switch (level) {
    case 'success':
      return 'border-action-success text-action-success';
    case 'error':
      return 'border-action-destructive text-action-destructive';
    default:
      return 'border-gray-700 text-gray-400';
  }
}

/**
 * Progress bar that shows remaining time before auto-dismiss
 */
function ProgressBar({
  duration,
  isPaused,
}: {
  duration: number;
  isPaused: boolean;
}) {
  const [progress, setProgress] = useState(100);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (isPaused) return;

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);
    }, 50);

    return () => clearInterval(interval);
  }, [duration, isPaused]);

  if (prefersReducedMotion) {
    return null;
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-titanium-700/30 overflow-hidden rounded-b">
      <div
        className="h-full bg-current transition-all duration-100 ease-linear"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

/**
 * Individual toast item with swipe-to-dismiss
 */
function ToastItem({
  toast,
  index,
  onDismiss,
}: {
  toast: Toast;
  index: number;
  onDismiss: (id: string) => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const [isPaused, setIsPaused] = useState(false);
  const [{ x, opacity }, api] = useSpring(() => ({
    x: 0,
    opacity: 1,
    config: config.stiff,
  }));

  // Swipe gesture for touch dismiss
  const bind = useDrag(
    ({ movement: [mx], velocity: [vx], direction: [dx], cancel, active }) => {
      // Only allow swiping right (to dismiss)
      if (mx < 0) {
        api.start({ x: 0 });
        return;
      }

      if (active) {
        api.start({ x: mx, immediate: true });
      } else {
        // If swiped far enough or fast enough, dismiss
        if (mx > 100 || (vx > 0.5 && dx > 0)) {
          api.start({
            x: 400,
            opacity: 0,
            onRest: () => onDismiss(toast.id),
          });
        } else {
          api.start({ x: 0 });
        }
      }
    },
    { axis: 'x', filterTaps: true }
  );

  // Calculate remaining time for progress bar
  const remainingTime = useMemo(() => {
    return Math.max(0, toast.expiresAt - Date.now());
  }, [toast.expiresAt]);

  const isInternal = !!toast.href && toast.href.startsWith('/');
  const messageNode = toast.href ? (
    isInternal ? (
      <Link
        to={toast.href}
        className="text-[11px] text-gray-200 hover:underline"
      >
        {toast.message}
      </Link>
    ) : (
      <a
        href={toast.href}
        className="text-[11px] text-gray-200 hover:underline"
        target="_blank"
        rel="noreferrer"
      >
        {toast.message}
      </a>
    )
  ) : (
    <div className="text-[11px] text-gray-200">{toast.message}</div>
  );

  return (
    <animated.div
      {...bind()}
      style={
        prefersReducedMotion
          ? undefined
          : {
              x,
              opacity,
              touchAction: 'pan-y',
            }
      }
      className={[
        'relative pointer-events-auto w-[min(92vw,420px)] rounded border bg-titanium-900/95 backdrop-blur px-3 py-2 shadow-lg cursor-grab active:cursor-grabbing',
        levelClasses(toast.level),
      ].join(' ')}
      role="status"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className="flex items-start gap-3">
        <div className="text-[10px] tracking-widest uppercase whitespace-nowrap">
          {toast.level}
        </div>
        <div className="min-w-0 flex-1">{messageNode}</div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="text-gray-500 hover:text-white text-[12px] leading-none px-1"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      <ProgressBar duration={remainingTime} isPaused={isPaused} />
    </animated.div>
  );
}

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>(() => getToasts());
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    return subscribeToasts(() => {
      setToasts(getToasts());
    });
  }, []);

  const timers = useMemo(() => {
    const now = Date.now();
    return toasts.map((t) => ({
      id: t.id,
      ms: Math.max(0, t.expiresAt - now),
    }));
  }, [toasts]);

  useEffect(() => {
    const handles = timers.map((t) =>
      setTimeout(() => dismissToast(t.id), t.ms)
    );
    return () => {
      for (const h of handles) clearTimeout(h);
    };
  }, [timers]);

  // Spring transitions for enter/exit
  const transitions = useTransition(toasts, {
    keys: (t) => t.id,
    from: prefersReducedMotion
      ? { opacity: 0 }
      : { opacity: 0, x: 100, scale: 0.95 },
    enter: (item, index) => ({
      opacity: 1,
      x: 0,
      scale: 1,
      delay: index * 50, // Stagger delay
    }),
    leave: prefersReducedMotion
      ? { opacity: 0 }
      : { opacity: 0, x: 100, scale: 0.95 },
    config: prefersReducedMotion
      ? { duration: 0 }
      : SPRING_LIQUID_CONFIGS.liquidSettle,
  });

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[1000] space-y-2 pointer-events-none">
      {transitions((style, item, _, index) => (
        <animated.div style={style}>
          <ToastItem
            toast={item}
            index={index}
            onDismiss={dismissToast}
          />
        </animated.div>
      ))}
    </div>
  );
}
