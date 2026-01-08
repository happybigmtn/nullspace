import { useRef, useState, useEffect, useCallback, type RefObject } from 'react';
import { useSpring, to, type SpringConfig } from '@react-spring/web';
import { SPRING_LIQUID_CONFIGS, type SpringLiquidPreset } from '../utils/motion';
import { useReducedMotion } from './useReducedMotion';

interface MagneticCursorOptions {
  /** Distance threshold for activation in pixels. Default 100 */
  threshold?: number;
  /** Maximum translation in pixels. Default 6 */
  maxTranslation?: number;
  /** Spring preset for return animation. Default 'liquidFloat' */
  spring?: SpringLiquidPreset;
  /** Custom spring config (overrides spring preset) */
  springConfig?: SpringConfig;
  /** Disable the effect entirely. Default false */
  disabled?: boolean;
}

interface MagneticCursorResult<T extends HTMLElement> {
  ref: RefObject<T | null>;
  style: Record<string, unknown>;
  isActive: boolean;
}

/**
 * Check if device supports hover (desktop) vs touch-only
 */
function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia('(hover: none)').matches
  );
}

/**
 * useMagneticCursor - Creates a subtle magnetic pull effect toward cursor
 *
 * When the cursor is within a threshold distance of the element, the element
 * translates slightly toward the cursor position. On mouse leave, it springs
 * back to center. Only active on desktop (no effect on touch devices).
 *
 * @example
 * function MagneticButton() {
 *   const { ref, style } = useMagneticCursor<HTMLButtonElement>();
 *   return (
 *     <animated.button ref={ref} style={style}>
 *       Click me
 *     </animated.button>
 *   );
 * }
 *
 * @example
 * // With custom options
 * const { ref, style, isActive } = useMagneticCursor({
 *   threshold: 150,
 *   maxTranslation: 8,
 *   spring: 'liquidMorph',
 * });
 */
export function useMagneticCursor<T extends HTMLElement = HTMLDivElement>(
  options: MagneticCursorOptions = {}
): MagneticCursorResult<T> {
  const {
    threshold = 100,
    maxTranslation = 6,
    spring = 'liquidFloat',
    springConfig: customSpringConfig,
    disabled = false,
  } = options;

  const ref = useRef<T>(null);
  const [isActive, setIsActive] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const isTouch = useRef<boolean>(false);

  // Detect touch device on mount
  useEffect(() => {
    isTouch.current = isTouchDevice();
  }, []);

  // Determine spring config
  const config = customSpringConfig ?? SPRING_LIQUID_CONFIGS[spring];

  // Spring for x/y translation
  const [springStyle, api] = useSpring(() => ({
    x: 0,
    y: 0,
    config: prefersReducedMotion ? { duration: 0 } : config,
  }));

  // Handle mouse movement
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (disabled || prefersReducedMotion || isTouch.current) return;

      const element = ref.current;
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      // Calculate distance from cursor to element center
      const deltaX = e.clientX - centerX;
      const deltaY = e.clientY - centerY;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      if (distance < threshold) {
        // Within threshold - apply magnetic effect
        // Closer = stronger effect (inverted distance ratio)
        const strength = 1 - distance / threshold;

        // Calculate translation (capped at maxTranslation)
        const translateX = deltaX * strength * (maxTranslation / threshold);
        const translateY = deltaY * strength * (maxTranslation / threshold);

        // Clamp to max translation
        const clampedX = Math.max(-maxTranslation, Math.min(maxTranslation, translateX));
        const clampedY = Math.max(-maxTranslation, Math.min(maxTranslation, translateY));

        api.start({ x: clampedX, y: clampedY });
        setIsActive(true);
      } else {
        // Outside threshold - return to center
        api.start({ x: 0, y: 0 });
        setIsActive(false);
      }
    },
    [api, disabled, maxTranslation, prefersReducedMotion, threshold]
  );

  // Handle mouse leave - spring back to center
  const handleMouseLeave = useCallback(() => {
    api.start({ x: 0, y: 0 });
    setIsActive(false);
  }, [api]);

  // Attach event listeners
  useEffect(() => {
    if (disabled || prefersReducedMotion || isTouch.current) return;

    // Use window mousemove for smoother tracking
    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    const element = ref.current;
    if (element) {
      element.addEventListener('mouseleave', handleMouseLeave);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (element) {
        element.removeEventListener('mouseleave', handleMouseLeave);
      }
    };
  }, [disabled, handleMouseLeave, handleMouseMove, prefersReducedMotion]);

  // For disabled or reduced motion, return no-op
  if (disabled || prefersReducedMotion) {
    return {
      ref,
      style: {},
      isActive: false,
    };
  }

  return {
    ref,
    style: {
      transform: to(
        [springStyle.x, springStyle.y],
        (x, y) => `translate3d(${x}px, ${y}px, 0)`
      ),
    },
    isActive,
  };
}

/**
 * MagneticWrapper props for the component version
 */
interface MagneticWrapperProps extends MagneticCursorOptions {
  children: React.ReactNode;
  className?: string;
  as?: keyof JSX.IntrinsicElements;
}

export default useMagneticCursor;
