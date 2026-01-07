import { useState, useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Hook to detect user's reduced motion accessibility setting
 * Returns true if user has enabled "Reduce Motion" in device settings
 *
 * On iOS: Settings > Accessibility > Motion > Reduce Motion
 * On Android: Settings > Accessibility > Remove animations
 *
 * Usage:
 * ```tsx
 * const prefersReducedMotion = useReducedMotion();
 *
 * // Skip spring animation for reduced motion
 * const animConfig = prefersReducedMotion
 *   ? { duration: 0 }
 *   : SPRING.button;
 * ```
 */
export function useReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    // Get initial value
    AccessibilityInfo.isReduceMotionEnabled().then((isEnabled) => {
      setPrefersReducedMotion(isEnabled);
    });

    // Subscribe to changes
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (isEnabled) => {
        setPrefersReducedMotion(isEnabled);
      }
    );

    return () => {
      subscription.remove();
    };
  }, []);

  return prefersReducedMotion;
}

/**
 * Get animation config that respects reduced motion preference
 * Returns instant duration if user prefers reduced motion
 */
export function getAccessibleAnimationConfig<T extends { duration?: number }>(
  config: T,
  prefersReducedMotion: boolean
): T | { duration: number } {
  if (prefersReducedMotion) {
    return { duration: 0 };
  }
  return config;
}

/**
 * Get spring config that respects reduced motion preference
 * For react-native-reanimated withSpring
 */
export function getAccessibleSpringConfig(
  config: { mass?: number; stiffness?: number; damping?: number },
  prefersReducedMotion: boolean
): { mass?: number; stiffness?: number; damping?: number } | { duration: number } {
  if (prefersReducedMotion) {
    // Instant transition - no spring physics
    return { duration: 0 };
  }
  return config;
}
