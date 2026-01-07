import { useSpring, useTransition } from '@react-spring/web';
import { SPRING_CONFIGS, type SpringPreset } from '../utils/motion';
import { useReducedMotion } from './useReducedMotion';

// Instant config for reduced motion - no animation, instant state change
const INSTANT_CONFIG = { duration: 0 };

/**
 * Hook for button press spring animation
 * Returns spring styles and press handlers
 * Respects prefers-reduced-motion accessibility setting
 */
export function useButtonPress(preset: SpringPreset = 'button') {
  const prefersReducedMotion = useReducedMotion();
  const config = prefersReducedMotion ? INSTANT_CONFIG : SPRING_CONFIGS[preset];

  const [spring, api] = useSpring(() => ({
    scale: 1,
    config,
  }));

  // Skip animation for reduced motion preference
  if (prefersReducedMotion) {
    return {
      style: {},
      onMouseDown: () => {},
      onMouseUp: () => {},
      onMouseLeave: () => {},
    };
  }

  return {
    style: { transform: spring.scale.to((s) => `scale(${s})`) },
    onMouseDown: () => api.start({ scale: 0.96 }),
    onMouseUp: () => api.start({ scale: 1 }),
    onMouseLeave: () => api.start({ scale: 1 }),
  };
}

/**
 * Hook for modal open/close spring animation
 * Returns spring styles based on open state
 * Respects prefers-reduced-motion accessibility setting
 */
export function useModalSpring(isOpen: boolean) {
  const prefersReducedMotion = useReducedMotion();
  const config = prefersReducedMotion ? INSTANT_CONFIG : SPRING_CONFIGS.modal;

  const spring = useSpring({
    opacity: isOpen ? 1 : 0,
    scale: isOpen ? 1 : 0.95,
    y: isOpen ? 0 : 10,
    config,
  });

  // For reduced motion, just use opacity (no scale/translate)
  if (prefersReducedMotion) {
    return {
      style: {
        opacity: spring.opacity,
      },
      backdropStyle: {
        opacity: spring.opacity,
      },
    };
  }

  return {
    style: {
      opacity: spring.opacity,
      transform: spring.scale.to(
        (s) => `scale(${s}) translateY(${spring.y.get()}px)`
      ),
    },
    backdropStyle: {
      opacity: spring.opacity,
    },
  };
}

/**
 * Hook for card hover spring animation
 * Returns spring styles and hover handlers
 * Respects prefers-reduced-motion accessibility setting
 */
export function useCardHover(preset: SpringPreset = 'tooltip') {
  const prefersReducedMotion = useReducedMotion();
  const config = prefersReducedMotion ? INSTANT_CONFIG : SPRING_CONFIGS[preset];

  const [spring, api] = useSpring(() => ({
    scale: 1,
    y: 0,
    config,
  }));

  // Skip animation for reduced motion preference
  if (prefersReducedMotion) {
    return {
      style: {},
      onMouseEnter: () => {},
      onMouseLeave: () => {},
    };
  }

  return {
    style: {
      transform: spring.scale.to(
        (s) => `scale(${s}) translateY(${spring.y.get()}px)`
      ),
    },
    onMouseEnter: () => api.start({ scale: 1.02, y: -4 }),
    onMouseLeave: () => api.start({ scale: 1, y: 0 }),
  };
}

/**
 * Hook for dropdown/tooltip reveal animation
 * Returns transition for mounting/unmounting with spring physics
 * Respects prefers-reduced-motion accessibility setting
 */
export function useDropdownTransition(isOpen: boolean) {
  const prefersReducedMotion = useReducedMotion();
  const config = prefersReducedMotion ? INSTANT_CONFIG : SPRING_CONFIGS.dropdown;

  // For reduced motion, only animate opacity
  const transitions = useTransition(isOpen, {
    from: prefersReducedMotion
      ? { opacity: 0 }
      : { opacity: 0, y: -8, scale: 0.98 },
    enter: prefersReducedMotion
      ? { opacity: 1 }
      : { opacity: 1, y: 0, scale: 1 },
    leave: prefersReducedMotion
      ? { opacity: 0 }
      : { opacity: 0, y: -8, scale: 0.98 },
    config,
  });

  return transitions;
}

/**
 * Hook for success/error feedback animation
 * Returns spring styles and trigger function
 * Respects prefers-reduced-motion accessibility setting
 */
export function useFeedbackPulse(type: 'success' | 'error' = 'success') {
  const prefersReducedMotion = useReducedMotion();
  const config = prefersReducedMotion ? INSTANT_CONFIG : SPRING_CONFIGS[type];

  const [spring, api] = useSpring(() => ({
    scale: 1,
    config,
  }));

  const trigger = () => {
    if (prefersReducedMotion) return; // No-op for reduced motion

    api.start({
      scale: 1.05,
      onRest: () => api.start({ scale: 1 }),
    });
  };

  return {
    style: prefersReducedMotion
      ? {}
      : { transform: spring.scale.to((s) => `scale(${s})`) },
    trigger,
  };
}

/**
 * Generic spring hook with design token preset
 * For custom animations using our spring configs
 * Respects prefers-reduced-motion accessibility setting
 */
export function useDesignSpring<T extends Record<string, unknown>>(
  values: T,
  preset: SpringPreset = 'button'
) {
  const prefersReducedMotion = useReducedMotion();
  const config = prefersReducedMotion ? INSTANT_CONFIG : SPRING_CONFIGS[preset];

  return useSpring({
    ...values,
    config,
  });
}
