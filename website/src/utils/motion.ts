import { SPRING, SPRING_LIQUID, DURATION, EASING } from '@nullspace/design-tokens';

// Re-export token types for convenience
export type SpringPreset = keyof typeof SPRING;
export type SpringLiquidPreset = keyof typeof SPRING_LIQUID;
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
 * Convert liquid spring config to react-spring format
 */
export const liquidSpringConfig = (preset: SpringLiquidPreset) => {
  const { mass, stiffness, damping } = SPRING_LIQUID[preset];
  return {
    mass,
    tension: stiffness,
    friction: damping,
  };
};

/**
 * Liquid spring presets for organic, water-like motion
 * Use: config={SPRING_LIQUID_CONFIGS.liquidMorph}
 */
export const SPRING_LIQUID_CONFIGS = Object.fromEntries(
  Object.keys(SPRING_LIQUID).map((key) => [
    key,
    liquidSpringConfig(key as SpringLiquidPreset),
  ])
) as Record<SpringLiquidPreset, { mass: number; tension: number; friction: number }>;

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
 * LUX-022: Toggle switch spring config
 * Slight overshoot for tactile feel
 */
export const TOGGLE_SPRING = {
  tension: 400,
  friction: 20,
  mass: 1,
};

/**
 * LUX-022: Menu stagger animation helpers
 * For staggered list item reveals
 */
export const STAGGER_CONFIG = {
  /** Delay between each item in ms */
  itemDelay: 30,
  /** Base animation duration */
  duration: 150,
  /** Spring config for menu items */
  spring: { tension: 300, friction: 24 },
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
