import { SPRING, DURATION, EASING } from '@nullspace/design-tokens';

// Re-export token types for convenience
export type SpringPreset = keyof typeof SPRING;
export type DurationPreset = keyof typeof DURATION;
export type EasingPreset = keyof typeof EASING;

/**
 * Convert design token spring config to react-spring format
 * react-spring uses: mass, tension, friction
 * design-tokens use: mass, stiffness, damping
 */
export const springConfig = (preset: SpringPreset) => {
  const { mass, stiffness, damping } = SPRING[preset];
  return {
    mass,
    tension: stiffness,
    friction: damping,
  };
};

/**
 * All spring presets pre-converted for react-spring
 * Use: config={SPRING_CONFIGS.button}
 */
export const SPRING_CONFIGS = Object.fromEntries(
  Object.keys(SPRING).map((key) => [key, springConfig(key as SpringPreset)])
) as Record<SpringPreset, { mass: number; tension: number; friction: number }>;

/**
 * Duration values in ms for non-spring animations
 */
export const DURATIONS = DURATION;

/**
 * Easing curves as cubic-bezier strings for CSS
 */
export const easingToCss = (preset: EasingPreset): string => {
  const [x1, y1, x2, y2] = EASING[preset];
  return `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
};

/**
 * Common animation variants for react-spring useSpring
 */
export const springVariants = {
  /** Button press animation - scale down slightly */
  buttonPress: {
    from: { scale: 1 },
    to: { scale: 0.96 },
    config: SPRING_CONFIGS.button,
  },

  /** Modal enter - scale up and fade in */
  modalEnter: {
    from: { opacity: 0, scale: 0.95, y: 10 },
    to: { opacity: 1, scale: 1, y: 0 },
    config: SPRING_CONFIGS.modal,
  },

  /** Modal exit - scale down and fade out */
  modalExit: {
    from: { opacity: 1, scale: 1, y: 0 },
    to: { opacity: 0, scale: 0.95, y: 10 },
    config: SPRING_CONFIGS.modal,
  },

  /** Card hover - subtle lift */
  cardHover: {
    from: { scale: 1, y: 0 },
    to: { scale: 1.02, y: -4 },
    config: SPRING_CONFIGS.tooltip,
  },

  /** Dropdown reveal */
  dropdownEnter: {
    from: { opacity: 0, y: -8, scale: 0.98 },
    to: { opacity: 1, y: 0, scale: 1 },
    config: SPRING_CONFIGS.dropdown,
  },

  /** Success feedback - pulse */
  successPulse: {
    from: { scale: 1 },
    to: { scale: 1.05 },
    config: SPRING_CONFIGS.success,
  },

  /** Error shake animation (use with wiggle transform) */
  errorShake: {
    from: { x: 0 },
    to: { x: 0 },
    config: SPRING_CONFIGS.shake,
  },
} as const;
