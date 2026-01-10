import React, {
  type ButtonHTMLAttributes,
  forwardRef,
  type ReactNode,
  useRef,
  useEffect,
  useState,
} from 'react';
import { animated, useSpring, to } from '@react-spring/web';
import { SPRING_CONFIGS, SPRING_LIQUID_CONFIGS, type SpringPreset } from '../../utils/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const cn = (...args: (string | boolean | undefined | null)[]) =>
  args.filter(Boolean).join(' ');

const INSTANT_CONFIG = { duration: 0 };

const ANTICIPATION = {
  hoverLift: 2,
  hoverScale: 1.01,
  hoverShadow: 1.3,
  breatheMin: 1.0,
  breatheMax: 1.02,
  breatheDuration: 8000,
  idleTimeout: 5000,
};

export interface AnimatedButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Button variant styling */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  /** Button size */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Spring animation preset */
  springPreset?: SpringPreset;
  /** Additional CSS classes */
  className?: string;
  /** Button contents */
  children: ReactNode;
  /** Whether button is in loading state */
  loading?: boolean;
  /** Enable breathing animation when idle (subtle pulse) */
  enableBreathing?: boolean;
}

/**
 * AnimatedButton - Button with spring physics and anticipatory animations
 *
 * Features:
 * - Anticipation: Lifts and expands shadow on hover (signals pressable)
 * - Press: Squishy scale-down with spring overshoot on release
 * - Breathing: Optional subtle pulse when idle (draws attention to CTA)
 * - Respects prefers-reduced-motion
 * - Works with all button variants
 *
 * @example
 * ```tsx
 * <AnimatedButton variant="primary" size="lg">
 *   Place Bet
 * </AnimatedButton>
 *
 * <AnimatedButton variant="primary" enableBreathing>
 *   Idle CTA with breathing
 * </AnimatedButton>
 * ```
 */
export const AnimatedButton = forwardRef<
  HTMLButtonElement,
  AnimatedButtonProps
>(
  (
    {
      variant = 'primary',
      size = 'md',
      springPreset = 'button',
      className,
      children,
      disabled,
      loading,
      enableBreathing = false,
      ...props
    },
    ref
  ) => {
    const prefersReducedMotion = useReducedMotion();
    const config = prefersReducedMotion
      ? INSTANT_CONFIG
      : SPRING_CONFIGS[springPreset];

    const [isIdle, setIsIdle] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastInteractionRef = useRef<number>(Date.now());

    const [spring, api] = useSpring(() => ({
      scale: 1,
      shadow: 1,
      lift: 0,
      breathe: 1,
      config,
    }));

    const isDisabled = disabled || loading;

    const resetIdleTimer = () => {
      lastInteractionRef.current = Date.now();
      setIsIdle(false);

      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }

      if (enableBreathing && !prefersReducedMotion && !isDisabled) {
        idleTimerRef.current = setTimeout(() => {
          setIsIdle(true);
        }, ANTICIPATION.idleTimeout);
      }
    };

    useEffect(() => {
      if (!enableBreathing || prefersReducedMotion || isDisabled || isHovered) {
        api.start({ breathe: 1 });
        return;
      }

      if (isIdle) {
        // Start breathing: smooth oscillation between 1.0 and 1.02
        const breatheCycle = () => {
          api.start({
            breathe: ANTICIPATION.breatheMax,
            config: { duration: ANTICIPATION.breatheDuration / 2 },
            onRest: () => {
              api.start({
                breathe: ANTICIPATION.breatheMin,
                config: { duration: ANTICIPATION.breatheDuration / 2 },
                onRest: breatheCycle,
              });
            },
          });
        };
        breatheCycle();
      }

      return () => {
        api.stop();
      };
    }, [isIdle, enableBreathing, prefersReducedMotion, isDisabled, isHovered, api]);

    useEffect(() => {
      if (enableBreathing && !prefersReducedMotion && !isDisabled) {
        resetIdleTimer();
      }
      return () => {
        if (idleTimerRef.current) {
          clearTimeout(idleTimerRef.current);
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enableBreathing, prefersReducedMotion, isDisabled]);

    const handleMouseEnter = () => {
      if (prefersReducedMotion || isDisabled) return;
      setIsHovered(true);
      resetIdleTimer();
      api.start({
        scale: ANTICIPATION.hoverScale,
        shadow: ANTICIPATION.hoverShadow,
        lift: -ANTICIPATION.hoverLift, // Negative Y = lift up
        breathe: 1,
        config: SPRING_LIQUID_CONFIGS?.liquidFloat ?? config,
      });
    };

    const handleMouseLeave = () => {
      if (prefersReducedMotion || isDisabled) return;
      setIsHovered(false);
      resetIdleTimer();
      api.start({
        scale: 1,
        shadow: 1,
        lift: 0,
        config: SPRING_LIQUID_CONFIGS?.liquidFloat ?? config,
      });
    };

    const handleMouseDown = () => {
      if (prefersReducedMotion || isDisabled) return;
      resetIdleTimer();
      api.start({
        scale: 0.95,
        shadow: 0.5,
        lift: 0, // Button sinks back to surface on press
        breathe: 1,
      });
    };

    const handleMouseUp = () => {
      if (prefersReducedMotion || isDisabled) return;
      resetIdleTimer();
      // If still hovered, return to hover state; otherwise return to rest
      if (isHovered) {
        api.start({
          scale: ANTICIPATION.hoverScale,
          shadow: ANTICIPATION.hoverShadow,
          lift: -ANTICIPATION.hoverLift,
        });
      } else {
        api.start({ scale: 1, shadow: 1, lift: 0 });
      }
    };

    const baseStyles =
      'relative inline-flex items-center justify-center font-semibold rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-action-primary/50 focus-visible:ring-offset-2';

    const variantStyles = {
      primary:
        'bg-action-primary text-white hover:bg-action-primary/90 border border-black/10 dark:border-white/10 disabled:bg-black/10 disabled:text-ns-muted',
      secondary:
        'bg-white/70 dark:bg-white/10 text-ns hover:bg-white/90 dark:hover:bg-white/20 border border-black/10 dark:border-white/10 disabled:bg-black/5 disabled:text-ns-muted',
      ghost:
        'bg-transparent text-ns-muted hover:text-ns hover:bg-black/5 dark:hover:bg-white/10 border border-black/5 dark:border-white/10 disabled:text-ns-muted',
      danger:
        'bg-action-error text-white hover:bg-action-error/90 border border-black/10 dark:border-white/10 disabled:bg-black/10 disabled:text-ns-muted',
      success:
        'bg-action-success text-white hover:bg-action-success/90 border border-black/10 dark:border-white/10 disabled:bg-black/10 disabled:text-ns-muted',
    };

    const sizeStyles = {
      sm: 'px-3 py-1.5 text-sm gap-1.5 min-h-10',
      md: 'px-4 py-2 text-sm gap-2 min-h-11',
      lg: 'px-6 py-3 text-base gap-2 min-h-12',
      xl: 'px-8 py-4 text-lg gap-3 min-h-14',
    };

    const getShadow = (shadowVal: number) => {
      if (shadowVal <= 0.75) {
        // Pressed state - minimal shadow
        return '0 1px 2px 0 rgba(0, 0, 0, 0.05)';
      } else if (shadowVal <= 1.0) {
        // Rest state - normal shadow
        return '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)';
      } else {
        // Hover state - expanded shadow for "lifted" feel
        return '0 8px 12px -2px rgba(0, 0, 0, 0.15), 0 4px 6px -2px rgba(0, 0, 0, 0.1)';
      }
    };

    return (
      <animated.button
        ref={ref}
        disabled={isDisabled}
        className={cn(
          baseStyles,
          variantStyles[variant],
          sizeStyles[size],
          isDisabled && 'cursor-not-allowed',
          className
        )}
        style={
          prefersReducedMotion
            ? undefined
            : {
                // Combine scale (from hover/press), lift (translateY), and breathe
                transform: to(
                  [spring.scale, spring.breathe, spring.lift],
                  (s, b, l) => `scale(${s * b}) translateY(${l}px)`
                ),
                boxShadow: spring.shadow.to(getShadow),
              }
        }
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchEnd={handleMouseUp}
        {...props}
      >
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <svg
              className="animate-spin h-5 w-5"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </span>
        )}
        <span className={loading ? 'opacity-0' : undefined}>{children}</span>
      </animated.button>
    );
  }
);

AnimatedButton.displayName = 'AnimatedButton';

/**
 * AnimatedIconButton - Circular icon button with spring physics and anticipation
 *
 * Features:
 * - Lifts and scales up slightly on hover (anticipation)
 * - Squishy press animation with spring overshoot
 * - Respects prefers-reduced-motion
 *
 * @example
 * ```tsx
 * <AnimatedIconButton size="md" variant="ghost">
 *   <X className="w-5 h-5" />
 * </AnimatedIconButton>
 * ```
 */
export interface AnimatedIconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Button variant styling */
  variant?: 'primary' | 'secondary' | 'ghost';
  /** Button size */
  size?: 'sm' | 'md' | 'lg';
  /** Spring animation preset */
  springPreset?: SpringPreset;
  /** Additional CSS classes */
  className?: string;
  /** Icon element */
  children: ReactNode;
}

export const AnimatedIconButton = forwardRef<
  HTMLButtonElement,
  AnimatedIconButtonProps
>(
  (
    {
      variant = 'ghost',
      size = 'md',
      springPreset = 'button',
      className,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const prefersReducedMotion = useReducedMotion();
    const [isHovered, setIsHovered] = useState(false);
    const config = prefersReducedMotion
      ? INSTANT_CONFIG
      : SPRING_CONFIGS[springPreset];

    const [spring, api] = useSpring(() => ({
      scale: 1,
      lift: 0,
      config,
    }));

    const handleMouseEnter = () => {
      if (prefersReducedMotion || disabled) return;
      setIsHovered(true);
      api.start({
        scale: 1.1,
        lift: -1,
        config: SPRING_LIQUID_CONFIGS?.liquidFloat ?? config,
      });
    };

    const handleMouseLeave = () => {
      if (prefersReducedMotion || disabled) return;
      setIsHovered(false);
      api.start({ scale: 1, lift: 0 });
    };

    const handleMouseDown = () => {
      if (prefersReducedMotion || disabled) return;
      api.start({ scale: 0.9, lift: 0 });
    };

    const handleMouseUp = () => {
      if (prefersReducedMotion || disabled) return;
      if (isHovered) {
        api.start({ scale: 1.1, lift: -1 });
      } else {
        api.start({ scale: 1, lift: 0 });
      }
    };

    const sizeStyles = {
      sm: 'w-10 h-10',
      md: 'w-11 h-11',
      lg: 'w-12 h-12',
    };

    const variantStyles = {
      primary:
        'bg-action-primary text-white hover:bg-action-primary/90 border border-black/10 dark:border-white/10 disabled:bg-black/10 disabled:text-ns-muted',
      secondary:
        'bg-white/70 dark:bg-white/10 text-ns hover:bg-white/90 dark:hover:bg-white/20 border border-black/10 dark:border-white/10 disabled:bg-black/5 disabled:text-ns-muted',
      ghost:
        'bg-transparent text-ns-muted hover:text-ns hover:bg-black/5 dark:hover:bg-white/10 border border-black/5 dark:border-white/10 disabled:text-ns-muted',
    };

    return (
      <animated.button
        ref={ref}
        disabled={disabled}
        className={cn(
          'inline-flex items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-action-primary/50',
          sizeStyles[size],
          variantStyles[variant],
          disabled && 'cursor-not-allowed',
          className
        )}
        style={
          prefersReducedMotion
            ? undefined
            : {
                transform: to(
                  [spring.scale, spring.lift],
                  (s, l) => `scale(${s}) translateY(${l}px)`
                ),
              }
        }
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchEnd={handleMouseUp}
        {...props}
      >
        {children}
      </animated.button>
    );
  }
);

AnimatedIconButton.displayName = 'AnimatedIconButton';

export default AnimatedButton;
