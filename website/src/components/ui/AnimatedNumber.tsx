import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useSpring, animated, type SpringValue } from '@react-spring/web';
import { SPRING_CONFIGS, SPRING_LIQUID_CONFIGS } from '../../utils/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/**
 * DS-057: Safe spring value extraction
 *
 * Subscribes to a SpringValue and extracts its current value on each frame.
 * This prevents React 19 reconciliation issues where raw SpringValue objects
 * leak into the component tree during rapid mount/unmount cycles.
 */
function useSpringValue<T>(springValue: SpringValue<T>): T {
  // Subscribe to the spring animation and get current value
  return useSyncExternalStore(
    (callback) => {
      // Subscribe to spring updates
      const unsubscribe = springValue.animation?.onChange?.(callback) || (() => {});
      return unsubscribe;
    },
    () => springValue.get(),
    () => springValue.get()
  );
}


// Instant config for reduced motion
const INSTANT_CONFIG = { duration: 0 };

export interface AnimatedNumberProps {
  /** The number to display */
  value: number;
  /** Format options for Intl.NumberFormat */
  formatOptions?: Intl.NumberFormatOptions;
  /** Locale for formatting (default: 'en-US') */
  locale?: string;
  /** Spring preset (default: 'success' for money-like counting) */
  preset?: 'button' | 'modal' | 'dropdown' | 'tooltip' | 'success';
  /** Additional CSS classes */
  className?: string;
  /** Prefix text (e.g., "$") */
  prefix?: string;
  /** Suffix text (e.g., "k") */
  suffix?: string;
  /** Decimal places (auto-calculated if not specified) */
  decimals?: number;
  /** Whether to show color flash on change */
  flashOnChange?: boolean;
  /** Color for positive change flash */
  positiveColor?: string;
  /** Color for negative change flash */
  negativeColor?: string;
}

/**
 * AnimatedNumber - Smoothly animates between number values
 *
 * Features:
 * - Springs from current to new value using physics
 * - Respects locale number formatting
 * - Optional color flash on positive/negative changes
 * - Uses monospace font for tabular numerals
 * - Respects prefers-reduced-motion
 *
 * @example
 * ```tsx
 * <AnimatedNumber value={1234.56} prefix="$" />
 * <AnimatedNumber value={50000} flashOnChange />
 * <AnimatedNumber
 *   value={balance}
 *   formatOptions={{ style: 'currency', currency: 'USD' }}
 * />
 * ```
 */
export function AnimatedNumber({
  value,
  formatOptions,
  locale = 'en-US',
  preset = 'success',
  className,
  prefix = '',
  suffix = '',
  decimals,
  flashOnChange = false,
  positiveColor = 'rgb(52, 199, 89)', // action-success
  negativeColor = 'rgb(255, 59, 48)', // action-error
}: AnimatedNumberProps) {
  const prefersReducedMotion = useReducedMotion();
  const prevValueRef = useRef(value);
  const [flashColor, setFlashColor] = useState<string | null>(null);

  // Determine decimal places
  const decimalPlaces =
    decimals !== undefined
      ? decimals
      : formatOptions?.maximumFractionDigits ?? (value % 1 === 0 ? 0 : 2);

  // Spring animation for the number
  const spring = useSpring({
    value,
    from: { value: prevValueRef.current },
    config: prefersReducedMotion ? INSTANT_CONFIG : SPRING_CONFIGS[preset],
  });

  // Flash color on change
  useEffect(() => {
    if (!flashOnChange || prefersReducedMotion) return;

    const diff = value - prevValueRef.current;
    if (diff !== 0) {
      setFlashColor(diff > 0 ? positiveColor : negativeColor);
      const timer = setTimeout(() => setFlashColor(null), 500);
      return () => clearTimeout(timer);
    }
  }, [value, flashOnChange, positiveColor, negativeColor, prefersReducedMotion]);

  // Update previous value ref
  useEffect(() => {
    prevValueRef.current = value;
  }, [value]);

  // DS-057: Memoize formatter to prevent recreation on every render
  const formatter = React.useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces,
        ...formatOptions,
      }),
    [locale, decimalPlaces, formatOptions]
  );

  // DS-057: Extract current spring value to avoid React 19 reconciliation issues
  // Instead of passing SpringValue.to() interpolation to animated.span children,
  // we extract the raw number and format it directly
  const currentValue = useSpringValue(spring.value);
  const displayText = formatter.format(currentValue);

  return (
    <span
      className={['tabular-nums transition-colors duration-200', className].filter(Boolean).join(' ')}
      style={{
        color: flashColor ?? undefined,
      }}
    >
      {prefix}
      {displayText}
      {suffix}
    </span>
  );
}

/**
 * AnimatedBalance - Specialized for currency/balance display
 *
 * @example
 * ```tsx
 * <AnimatedBalance value={12345.67} currency="USD" />
 * ```
 */
export interface AnimatedBalanceProps {
  value: number;
  currency?: string;
  showSign?: boolean;
  className?: string;
}

export function AnimatedBalance({
  value,
  currency = 'USD',
  showSign = false,
  className,
}: AnimatedBalanceProps) {
  return (
    <AnimatedNumber
      value={value}
      formatOptions={{
        style: 'currency',
        currency,
        signDisplay: showSign ? 'exceptZero' : 'auto',
      }}
      className={className}
      flashOnChange
    />
  );
}

/**
 * AnimatedInteger - Optimized for whole numbers
 *
 * @example
 * ```tsx
 * <AnimatedInteger value={50000} />
 * ```
 */
export interface AnimatedIntegerProps {
  value: number;
  className?: string;
  prefix?: string;
  suffix?: string;
  flashOnChange?: boolean;
}

export function AnimatedInteger({
  value,
  className,
  prefix,
  suffix,
  flashOnChange = false,
}: AnimatedIntegerProps) {
  return (
    <AnimatedNumber
      value={Math.floor(value)}
      decimals={0}
      className={className}
      prefix={prefix}
      suffix={suffix}
      flashOnChange={flashOnChange}
    />
  );
}

/**
 * CountUp - Animated counter that starts from 0
 * Useful for dashboard stats that should animate on mount
 *
 * @example
 * ```tsx
 * <CountUp to={1000} duration={2000} />
 * ```
 */
export interface CountUpProps {
  /** Target value */
  to: number;
  /** Starting value (default: 0) */
  from?: number;
  /** Delay before starting in ms */
  delay?: number;
  /** Format options */
  formatOptions?: Intl.NumberFormatOptions;
  /** Locale for formatting */
  locale?: string;
  /** Additional CSS classes */
  className?: string;
  /** Prefix text */
  prefix?: string;
  /** Suffix text */
  suffix?: string;
}

export function CountUp({
  to,
  from = 0,
  delay = 0,
  formatOptions,
  locale = 'en-US',
  className,
  prefix = '',
  suffix = '',
}: CountUpProps) {
  const prefersReducedMotion = useReducedMotion();
  const [started, setStarted] = useState(delay === 0);

  useEffect(() => {
    if (delay > 0) {
      const timer = setTimeout(() => setStarted(true), delay);
      return () => clearTimeout(timer);
    }
  }, [delay]);

  const spring = useSpring({
    value: started ? to : from,
    from: { value: from },
    config: prefersReducedMotion
      ? INSTANT_CONFIG
      : SPRING_LIQUID_CONFIGS.liquidSettle,
  });

  // DS-057: Memoize formatter to prevent recreation on every render
  const formatter = React.useMemo(
    () => new Intl.NumberFormat(locale, formatOptions),
    [locale, formatOptions]
  );

  // DS-057: Extract current spring value for safe rendering
  const currentValue = useSpringValue(spring.value);
  const displayText = formatter.format(currentValue);

  return (
    <span className={['tabular-nums', className].filter(Boolean).join(' ')}>
      {prefix}
      {displayText}
      {suffix}
    </span>
  );
}

export default AnimatedNumber;
