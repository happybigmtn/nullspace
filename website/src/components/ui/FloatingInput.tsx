/**
 * FloatingInput - Animated input field with floating label
 *
 * DS-053: Form input floating label animations
 *
 * Features:
 * - Floating label animation (moves above on focus/has value)
 * - Scale reduces as label rises
 * - Color transitions to accent on focus
 * - Spring physics for natural movement
 * - Focus ring animation with expand effect
 * - Validation state support (checkmark/error)
 * - Shake animation on error (via ref.shake())
 * - Respects prefers-reduced-motion
 */
import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
  type InputHTMLAttributes,
  type ChangeEvent,
  type FocusEvent,
} from 'react';
import { animated, useSpring, to, config } from '@react-spring/web';
import { useReducedMotion } from '../../hooks/useReducedMotion';

// Simple className joiner
const cn = (...args: (string | boolean | undefined | null)[]) =>
  args.filter(Boolean).join(' ');

// Instant config for reduced motion
const INSTANT_CONFIG = { duration: 0 };

// Animation constants
const FLOAT_LABEL = {
  /** Label translateY when floating (px) */
  translateY: -20,
  /** Label scale when floating */
  scale: 0.85,
  /** Animation duration (ms) */
  duration: 200,
};

// Colors as hex strings for interpolation
const COLORS = {
  labelDefault: '#6B7280', // titanium-500
  labelFocused: '#6366F1', // action-indigo
  labelError: '#EF4444', // action-error
  borderDefault: '#D1D5DB', // titanium-300
  borderFocused: '#6366F1', // action-indigo
  borderError: '#EF4444', // action-error
  success: '#22C55E', // action-success
};

/** Handle for imperative shake trigger */
export interface FloatingInputHandle {
  shake: () => void;
  focus: () => void;
  blur: () => void;
}

export interface FloatingInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Floating label text */
  label: string;
  /** Whether input value is valid (shows checkmark) */
  isValid?: boolean;
  /** Whether input has an error */
  hasError?: boolean;
  /** Error message to display */
  errorMessage?: string;
  /** Whether to show validation indicator */
  showValidation?: boolean;
  /** Additional container class names */
  containerClassName?: string;
  /** Input size variant */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * FloatingInput - Animated input field component
 *
 * Use forwardRef to allow parent components to trigger shake animation
 * via ref.current.shake() on submission failure.
 *
 * @example
 * ```tsx
 * const inputRef = useRef<FloatingInputHandle>(null);
 *
 * <FloatingInput
 *   ref={inputRef}
 *   label="Email"
 *   value={email}
 *   onChange={(e) => setEmail(e.target.value)}
 *   isValid={isEmailValid}
 *   showValidation
 * />
 *
 * // Trigger shake on error:
 * inputRef.current?.shake();
 * ```
 */
export const FloatingInput = forwardRef<FloatingInputHandle, FloatingInputProps>(
  function FloatingInput(
    {
      label,
      value,
      defaultValue,
      isValid = false,
      hasError = false,
      errorMessage,
      showValidation = false,
      containerClassName,
      size = 'md',
      className,
      onFocus,
      onBlur,
      onChange,
      disabled,
      ...inputProps
    },
    ref
  ) {
    const inputRef = useRef<HTMLInputElement>(null);
    const prefersReducedMotion = useReducedMotion();
    const [isFocused, setIsFocused] = useState(false);
    const [hasValue, setHasValue] = useState(
      Boolean(value || defaultValue)
    );

    const springConfig = prefersReducedMotion
      ? INSTANT_CONFIG
      : { tension: 300, friction: 20 };

    // Label animation: position, scale, color
    const [labelSpring, labelApi] = useSpring(() => ({
      y: hasValue ? FLOAT_LABEL.translateY : 0,
      scale: hasValue ? FLOAT_LABEL.scale : 1,
      colorProgress: 0,
      config: springConfig,
    }));

    // Container animations: shake, focus ring
    const [containerSpring, containerApi] = useSpring(() => ({
      shakeX: 0,
      focusRing: 0,
      borderProgress: 0,
      config: springConfig,
    }));

    // Checkmark animation
    const [checkSpring, checkApi] = useSpring(() => ({
      opacity: 0,
      scale: 0.8,
      config: springConfig,
    }));

    // Update checkmark visibility when validation state changes
    React.useEffect(() => {
      if (showValidation && isValid) {
        checkApi.start({ opacity: 1, scale: 1 });
      } else {
        checkApi.start({ opacity: 0, scale: 0.8 });
      }
    }, [isValid, showValidation, checkApi]);

    // Update border color on error state
    React.useEffect(() => {
      if (hasError) {
        containerApi.start({ borderProgress: 2 }); // Error state
      } else if (isFocused) {
        containerApi.start({ borderProgress: 1 }); // Focused state
      } else {
        containerApi.start({ borderProgress: 0 }); // Default state
      }
    }, [hasError, isFocused, containerApi]);

    // Handle focus
    const handleFocus = useCallback(
      (e: FocusEvent<HTMLInputElement>) => {
        setIsFocused(true);
        labelApi.start({
          y: FLOAT_LABEL.translateY,
          scale: FLOAT_LABEL.scale,
          colorProgress: hasError ? 2 : 1,
        });
        containerApi.start({
          focusRing: 1,
          borderProgress: hasError ? 2 : 1,
        });
        onFocus?.(e);
      },
      [labelApi, containerApi, onFocus, hasError]
    );

    // Handle blur
    const handleBlur = useCallback(
      (e: FocusEvent<HTMLInputElement>) => {
        setIsFocused(false);
        // Only collapse label if empty
        if (!hasValue) {
          labelApi.start({
            y: 0,
            scale: 1,
            colorProgress: hasError ? 2 : 0,
          });
        } else {
          labelApi.start({
            colorProgress: hasError ? 2 : 0,
          });
        }
        containerApi.start({
          focusRing: 0,
          borderProgress: hasError ? 2 : 0,
        });
        onBlur?.(e);
      },
      [labelApi, containerApi, hasValue, onBlur, hasError]
    );

    // Handle change
    const handleChange = useCallback(
      (e: ChangeEvent<HTMLInputElement>) => {
        const newHasValue = Boolean(e.target.value);
        setHasValue(newHasValue);

        // Float label up when text is entered
        if (newHasValue && !hasValue) {
          labelApi.start({
            y: FLOAT_LABEL.translateY,
            scale: FLOAT_LABEL.scale,
          });
        } else if (!newHasValue && !isFocused) {
          labelApi.start({
            y: 0,
            scale: 1,
          });
        }

        onChange?.(e);
      },
      [labelApi, hasValue, isFocused, onChange]
    );

    // Expose imperative handle
    useImperativeHandle(ref, () => ({
      shake: () => {
        if (prefersReducedMotion) return;
        containerApi.start({
          shakeX: 0,
          from: { shakeX: 0 },
          to: async (next) => {
            await next({ shakeX: 10, config: { duration: 50 } });
            await next({ shakeX: -10, config: { duration: 50 } });
            await next({ shakeX: 8, config: { duration: 50 } });
            await next({ shakeX: -8, config: { duration: 50 } });
            await next({ shakeX: 4, config: { duration: 50 } });
            await next({ shakeX: 0, config: { duration: 50 } });
          },
        });
      },
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
    }));

    // Size variants
    const sizeStyles = {
      sm: {
        container: 'h-12',
        input: 'pt-5 pb-1.5 px-3 text-sm',
        label: 'left-3 text-sm',
      },
      md: {
        container: 'h-14',
        input: 'pt-6 pb-2 px-4 text-base',
        label: 'left-4 text-base',
      },
      lg: {
        container: 'h-16',
        input: 'pt-7 pb-2.5 px-5 text-lg',
        label: 'left-5 text-lg',
      },
    };

    const currentSize = sizeStyles[size];

    // Interpolate border color
    const getBorderColor = (progress: number) => {
      if (progress >= 1.5) return COLORS.borderError;
      if (progress >= 0.5) return COLORS.borderFocused;
      return COLORS.borderDefault;
    };

    // Interpolate label color
    const getLabelColor = (progress: number) => {
      if (progress >= 1.5) return COLORS.labelError;
      if (progress >= 0.5) return COLORS.labelFocused;
      return COLORS.labelDefault;
    };

    return (
      <div className={cn('relative', containerClassName)}>
        <animated.div
          className={cn(
            'relative rounded-lg border bg-white transition-shadow',
            currentSize.container,
            disabled && 'bg-titanium-50 cursor-not-allowed',
            className
          )}
          style={{
            transform: containerSpring.shakeX.to((x) => `translateX(${x}px)`),
            borderColor: containerSpring.borderProgress.to(getBorderColor),
            boxShadow: containerSpring.focusRing.to(
              (v) =>
                v > 0
                  ? `0 0 0 ${3 * v}px rgba(99, 102, 241, ${0.2 * v})`
                  : 'none'
            ),
          }}
        >
          {/* Floating label */}
          <animated.label
            className={cn(
              'absolute top-1/2 pointer-events-none origin-left',
              currentSize.label,
              disabled && 'text-titanium-400'
            )}
            style={{
              transform: to(
                [labelSpring.y, labelSpring.scale],
                (y, s) => `translateY(calc(-50% + ${y}px)) scale(${s})`
              ),
              color: disabled
                ? COLORS.labelDefault
                : labelSpring.colorProgress.to(getLabelColor),
            }}
          >
            {label}
          </animated.label>

          {/* Input */}
          <input
            ref={inputRef}
            value={value}
            defaultValue={defaultValue}
            disabled={disabled}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onChange={handleChange}
            className={cn(
              'w-full h-full bg-transparent outline-none',
              currentSize.input,
              disabled && 'cursor-not-allowed text-titanium-500',
              'text-titanium-900 placeholder-transparent'
            )}
            {...inputProps}
          />

          {/* Validation checkmark */}
          {showValidation && (
            <animated.div
              className="absolute right-3 top-1/2 -translate-y-1/2"
              style={{
                opacity: checkSpring.opacity,
                transform: checkSpring.scale.to(
                  (s) => `translateY(-50%) scale(${s})`
                ),
              }}
            >
              <CheckmarkIcon />
            </animated.div>
          )}
        </animated.div>

        {/* Error message */}
        {hasError && errorMessage && (
          <p className="mt-1.5 text-sm text-action-error">{errorMessage}</p>
        )}
      </div>
    );
  }
);

/**
 * Simple checkmark icon using SVG
 */
function CheckmarkIcon() {
  return (
    <svg
      className="w-5 h-5 text-action-success"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}

export default FloatingInput;
