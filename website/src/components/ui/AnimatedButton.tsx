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

// Simple className joiner
const cn = (...args: (string | boolean | undefined | null)[]) =>
  args.filter(Boolean).join(' ');

// Instant config for reduced motion
const INSTANT_CONFIG = { duration: 0 };

// Anticipation constants - subtle is key
const ANTICIPATION = {
  /** Lift on hover (px) */
  hoverLift: 2,
  /** Scale on hover */
  hoverScale: 1.01,
  /** Shadow expansion on hover */
  hoverShadow: 1.3,
  /** Breathing animation scale range */
  breatheMin: 1.0,
  breatheMax: 1.02,
  /** Breathing cycle duration (ms) */
  breatheDuration: 8000,
  /** Idle timeout before breathing starts (ms) */
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

    // Track interaction state for breathing
    const [isIdle, setIsIdle] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastInteractionRef = useRef<number>(Date.now());

    // Spring values: scale, shadow, lift (translateY), breathe
    const [spring, api] = useSpring(() => ({
      scale: 1,
      shadow: 1,
      lift: 0,
      breathe: 1,
      config,
    }));

    const isDisabled = disabled || loading;

    // Reset idle timer on any interaction
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

    // Start breathing animation when idle
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

    // Initialize idle timer on mount
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

    // Hover handlers - anticipatory lift and shadow expansion
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

    // Press handlers - scale down and reduce shadow
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

    // Base styles
    const baseStyles =
      'relative inline-flex items-center justify-center font-semibold rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2';

    // Variant styles
    const variantStyles = {
      primary:
        'bg-action-indigo text-white hover:bg-action-indigoHover focus-visible:ring-action-indigo disabled:bg-titanium-300 disabled:text-titanium-500',
      secondary:
        'bg-titanium-100 text-titanium-900 hover:bg-titanium-200 focus-visible:ring-titanium-400 disabled:bg-titanium-100 disabled:text-titanium-400',
      ghost:
        'bg-transparent text-titanium-700 hover:bg-titanium-100 focus-visible:ring-titanium-400 disabled:text-titanium-400',
      danger:
        'bg-action-error text-white hover:bg-red-600 focus-visible:ring-action-error disabled:bg-titanium-300 disabled:text-titanium-500',
      success:
        'bg-action-success text-white hover:bg-green-600 focus-visible:ring-action-success disabled:bg-titanium-300 disabled:text-titanium-500',
    };

    // Size styles (min-h-11 = 44px minimum touch target per WCAG 2.2 SC 2.5.8)
    const sizeStyles = {
      sm: 'px-3 py-1.5 text-sm gap-1.5 min-h-10',
      md: 'px-4 py-2 text-sm gap-2 min-h-11',
      lg: 'px-6 py-3 text-base gap-2 min-h-12',
      xl: 'px-8 py-4 text-lg gap-3 min-h-14',
    };

    // Shadow styles - interpolated via spring.shadow value
    // Shadow value ranges: 0.5 (pressed), 1.0 (rest), 1.3 (hover expanded)
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

    // Hover handlers - anticipatory scale up and lift
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
      // Return to hover state if still hovered
      if (isHovered) {
        api.start({ scale: 1.1, lift: -1 });
      } else {
        api.start({ scale: 1, lift: 0 });
      }
    };

    // Size styles (min 40px touch target, md=44px per WCAG 2.2 SC 2.5.8)
    const sizeStyles = {
      sm: 'w-10 h-10',
      md: 'w-11 h-11',
      lg: 'w-12 h-12',
    };

    const variantStyles = {
      primary:
        'bg-action-indigo text-white hover:bg-action-indigoHover disabled:bg-titanium-300',
      secondary:
        'bg-titanium-100 text-titanium-700 hover:bg-titanium-200 disabled:bg-titanium-100',
      ghost:
        'bg-transparent text-titanium-600 hover:bg-titanium-100 disabled:text-titanium-400',
    };

    return (
      <animated.button
        ref={ref}
        disabled={disabled}
        className={cn(
          'inline-flex items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-titanium-400',
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
