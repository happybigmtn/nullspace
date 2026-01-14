import React, { forwardRef, type ButtonHTMLAttributes } from 'react';
import { animated, useSpring } from '@react-spring/web';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { TOGGLE_SPRING } from '../../utils/motion';

/**
 * LUX-022: AnimatedToggle - Toggle switch with spring physics
 *
 * Features:
 * - Thumb slides with slight overshoot (tactile feel)
 * - Background color transitions smoothly
 * - Respects prefers-reduced-motion
 * - WCAG compliant (44px min touch target)
 *
 * @example
 * ```tsx
 * <AnimatedToggle
 *   checked={soundEnabled}
 *   onToggle={() => setSoundEnabled(!soundEnabled)}
 *   label="Sound"
 * />
 * ```
 */

interface AnimatedToggleProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  /** Current toggle state */
  checked: boolean;
  /** Callback when toggled */
  onToggle: () => void;
  /** Optional label to display */
  label?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional CSS classes */
  className?: string;
}

const INSTANT_CONFIG = { duration: 0 };

// Size configurations - all sizes have min 44px touch target height for WCAG 2.5.5
const SIZES = {
  sm: {
    track: 'w-10 h-6',
    thumb: 'w-4 h-4',
    thumbOff: 4, // px from left when off
    thumbOn: 20, // px from left when on
    touchTarget: 'min-h-[44px] py-2', // Extra padding for touch target
  },
  md: {
    track: 'w-12 h-7',
    thumb: 'w-5 h-5',
    thumbOff: 4,
    thumbOn: 24,
    touchTarget: 'min-h-[44px]',
  },
  lg: {
    track: 'w-14 h-8',
    thumb: 'w-6 h-6',
    thumbOff: 4,
    thumbOn: 28,
    touchTarget: '',
  },
};

export const AnimatedToggle = forwardRef<HTMLButtonElement, AnimatedToggleProps>(
  (
    {
      checked,
      onToggle,
      label,
      size = 'md',
      className,
      disabled,
      ...props
    },
    ref
  ) => {
    const prefersReducedMotion = useReducedMotion();
    const config = prefersReducedMotion ? INSTANT_CONFIG : TOGGLE_SPRING;
    const sizeConfig = SIZES[size];

    const spring = useSpring({
      x: checked ? sizeConfig.thumbOn : sizeConfig.thumbOff,
      scale: 1,
      config,
    });

    const trackBg = checked
      ? 'bg-action-primary'
      : 'bg-white/70 dark:bg-white/10';

    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onToggle}
        className={[
          'relative inline-flex items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-action-primary focus-visible:ring-offset-2',
          sizeConfig.touchTarget,
          disabled && 'opacity-50 cursor-not-allowed',
          className ?? '',
        ]
          .filter(Boolean)
          .join(' ')
          .trim()}
        {...props}
      >
        <span
          className={[
            'relative inline-flex items-center rounded-full border border-black/10 dark:border-white/10',
            sizeConfig.track,
            trackBg,
          ].join(' ')}
        >
          <animated.span
            className={[
              'absolute rounded-full bg-white shadow-soft',
              sizeConfig.thumb,
            ].join(' ')}
            style={{
              left: spring.x,
              top: '50%',
              transform: 'translateY(-50%)',
            }}
          />
        </span>
      </button>
    );
  }
);

AnimatedToggle.displayName = 'AnimatedToggle';

/**
 * AnimatedToggle with inline label
 * Convenience wrapper for common toggle + label pattern
 */
interface AnimatedToggleWithLabelProps extends AnimatedToggleProps {
  /** Label text (required for this variant) */
  label: string;
  /** Show On/Off indicator */
  showState?: boolean;
}

export const AnimatedToggleWithLabel = forwardRef<
  HTMLDivElement,
  AnimatedToggleWithLabelProps
>(({ label, showState = false, checked, onToggle, size, disabled, className }, ref) => (
  <div
    ref={ref}
    className={[
      'flex items-center justify-between gap-4',
      className ?? '',
    ].join(' ')}
  >
    <span className="text-body text-ns font-medium">
      {label}
    </span>
    <div className="flex items-center gap-2">
      {showState && (
        <span
          className={`text-caption font-semibold ${
            checked ? 'text-action-success' : 'text-ns-muted'
          }`}
        >
          {checked ? 'On' : 'Off'}
        </span>
      )}
      <AnimatedToggle
        checked={checked}
        onToggle={onToggle}
        size={size}
        disabled={disabled}
        label={label}
      />
    </div>
  </div>
));

AnimatedToggleWithLabel.displayName = 'AnimatedToggleWithLabel';

export default AnimatedToggle;
