import React, { type ReactNode, type HTMLAttributes, forwardRef } from 'react';
import {
  useRipple,
  RippleAnimation,
  type RippleConfig,
} from '../../hooks/useRipple';

// Simple className joiner
const cn = (...args: (string | boolean | undefined | null)[]) =>
  args.filter(Boolean).join(' ');

export interface LiquidRippleProps extends HTMLAttributes<HTMLDivElement> {
  /** Child elements to wrap */
  children: ReactNode;
  /** Configuration for the ripple effect */
  rippleConfig?: RippleConfig;
  /** Whether the ripple effect is disabled */
  disabled?: boolean;
  /** Additional CSS class names */
  className?: string;
  /** HTML element to render as (defaults to 'div') */
  as?: 'div' | 'button' | 'span';
}

/**
 * LiquidRipple - Wrapper component that adds water-like ripple effects on click
 *
 * Inspired by Material Design ripples but with softer, more organic spring physics
 * for a luxury feel. The ripple expands from the exact click point and fades
 * smoothly during expansion.
 *
 * @example
 * ```tsx
 * <LiquidRipple>
 *   <button>Click me</button>
 * </LiquidRipple>
 *
 * <LiquidRipple
 *   rippleConfig={{ color: 'rgba(94, 92, 230, 0.2)' }}
 *   className="rounded-lg"
 * >
 *   <Card>...</Card>
 * </LiquidRipple>
 * ```
 */
export const LiquidRipple = forwardRef<HTMLDivElement, LiquidRippleProps>(
  (
    {
      children,
      rippleConfig,
      disabled = false,
      className,
      as: Component = 'div',
      ...props
    },
    ref
  ) => {
    const { ripples, addRipple, config, prefersReducedMotion } =
      useRipple(rippleConfig);

    // Skip ripple container for reduced motion or disabled state
    const showRipples = !prefersReducedMotion && !disabled;

    return (
      <Component
        ref={ref}
        className={cn('relative overflow-hidden', className)}
        onMouseDown={showRipples ? addRipple : undefined}
        {...props}
      >
        {children}
        {showRipples && ripples.length > 0 && (
          <span
            className="pointer-events-none absolute inset-0 overflow-hidden"
            aria-hidden="true"
          >
            {ripples.map((ripple) => (
              <RippleAnimation key={ripple.id} ripple={ripple} config={config} />
            ))}
          </span>
        )}
      </Component>
    );
  }
);

LiquidRipple.displayName = 'LiquidRipple';

/**
 * HOC to add ripple effect to any component
 * Useful when you need more control over the wrapped component
 */
export function withLiquidRipple<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  rippleConfig?: RippleConfig
) {
  const WithRipple = forwardRef<HTMLDivElement, P & { disabled?: boolean }>(
    (props, ref) => {
      return (
        <LiquidRipple
          ref={ref}
          rippleConfig={rippleConfig}
          disabled={props.disabled}
        >
          <WrappedComponent {...props} />
        </LiquidRipple>
      );
    }
  );

  WithRipple.displayName = `WithLiquidRipple(${WrappedComponent.displayName || WrappedComponent.name || 'Component'})`;

  return WithRipple;
}

export default LiquidRipple;
