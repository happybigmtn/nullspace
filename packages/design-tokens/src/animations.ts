/**
 * Animation tokens for Nullspace design system
 * Spring configs consumed by Framer Motion (web) and Reanimated (mobile)
 * Both libraries accept { mass, stiffness, damping } format
 *
 * NO platform-specific code - raw values only
 */

/**
 * Spring physics configurations
 * Each preset is tuned for specific interaction types
 */
export const SPRING = {
  // UI interactions - quick and responsive
  button: { mass: 0.5, stiffness: 400, damping: 30 },
  modal: { mass: 0.8, stiffness: 300, damping: 28 },
  dropdown: { mass: 0.6, stiffness: 350, damping: 26 },
  tooltip: { mass: 0.4, stiffness: 500, damping: 35 },

  // Game elements - more theatrical
  cardFlip: { mass: 1, stiffness: 200, damping: 20 },
  cardDeal: { mass: 0.7, stiffness: 280, damping: 22 },
  chipStack: { mass: 0.8, stiffness: 300, damping: 25 },
  chipToss: { mass: 0.6, stiffness: 250, damping: 18 },
  wheelSpin: { mass: 2, stiffness: 50, damping: 10 },
  diceTumble: { mass: 1.2, stiffness: 150, damping: 15 },

  // Feedback animations
  success: { mass: 0.5, stiffness: 350, damping: 25 },
  error: { mass: 0.3, stiffness: 600, damping: 40 },
  shake: { mass: 0.2, stiffness: 800, damping: 15 },
} as const;

/**
 * Duration values in milliseconds
 * For non-spring animations (opacity, color transitions)
 */
export const DURATION = {
  instant: 100,
  fast: 200,
  normal: 300,
  slow: 500,
  dramatic: 1000,
  cinematic: 2000,
} as const;

/**
 * Easing curves as cubic bezier arrays
 * Format: [x1, y1, x2, y2] for CSS cubic-bezier()
 */
export const EASING = {
  linear: [0, 0, 1, 1],
  easeIn: [0.4, 0, 1, 1],
  easeOut: [0.16, 1, 0.3, 1],
  easeInOut: [0.4, 0, 0.2, 1],
  bounce: [0.34, 1.56, 0.64, 1],
  anticipate: [0.68, -0.6, 0.32, 1.6],
} as const;

/**
 * Stagger delays for sequential animations
 * Values in milliseconds
 */
export const STAGGER = {
  fast: 30,
  normal: 50,
  slow: 100,
  dramatic: 150,
} as const;

// Type exports for type inference
export type SpringPreset = keyof typeof SPRING;
export type SpringConfig = (typeof SPRING)[SpringPreset];

export type DurationKey = keyof typeof DURATION;
export type DurationValue = (typeof DURATION)[DurationKey];

export type EasingKey = keyof typeof EASING;
export type EasingCurve = (typeof EASING)[EasingKey];

export type StaggerKey = keyof typeof STAGGER;
