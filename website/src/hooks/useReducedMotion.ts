import { useState, useEffect } from 'react';

/**
 * Hook to detect user's prefers-reduced-motion setting
 * Returns true if user prefers reduced motion (for accessibility)
 *
 * Usage:
 * ```tsx
 * const prefersReducedMotion = useReducedMotion();
 * const spring = useSpring({
 *   scale: prefersReducedMotion ? 1 : (isPressed ? 0.96 : 1),
 *   config: prefersReducedMotion ? { duration: 0 } : SPRING_CONFIGS.button,
 * });
 * ```
 */
export function useReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    // SSR-safe: check if window exists
    if (typeof window === 'undefined') return false;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    return query.matches;
  });

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');

    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    // Modern browsers
    query.addEventListener('change', handleChange);

    // Set initial value in case it changed between render and effect
    setPrefersReducedMotion(query.matches);

    return () => {
      query.removeEventListener('change', handleChange);
    };
  }, []);

  return prefersReducedMotion;
}

/**
 * Get spring config that respects reduced motion preference
 * Returns instant config if user prefers reduced motion
 */
export function getAccessibleSpringConfig<T extends Record<string, unknown>>(
  config: T,
  prefersReducedMotion: boolean
): T | { duration: number } {
  if (prefersReducedMotion) {
    return { duration: 0 };
  }
  return config;
}
