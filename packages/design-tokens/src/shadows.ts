/**
 * Shadow tokens for Nullspace design system
 * Elevation system inspired by Material Design and Apple HIG
 *
 * NO platform-specific code - raw values only
 */

/**
 * Shadow elevation definitions
 * Each level has multiple layers for realistic depth
 *
 * Format for web (CSS box-shadow):
 *   `${offsetX}px ${offsetY}px ${blur}px ${spread}px ${color}`
 *
 * Format for mobile (React Native):
 *   shadowOffset: { width, height }, shadowRadius, shadowOpacity, shadowColor
 */
export const SHADOW = {
  none: {
    offsetX: 0,
    offsetY: 0,
    blur: 0,
    spread: 0,
    opacity: 0,
  },
  sm: {
    offsetX: 0,
    offsetY: 1,
    blur: 2,
    spread: 0,
    opacity: 0.05,
  },
  md: {
    offsetX: 0,
    offsetY: 4,
    blur: 6,
    spread: -1,
    opacity: 0.1,
  },
  lg: {
    offsetX: 0,
    offsetY: 10,
    blur: 15,
    spread: -3,
    opacity: 0.1,
  },
  xl: {
    offsetX: 0,
    offsetY: 20,
    blur: 25,
    spread: -5,
    opacity: 0.1,
  },
  '2xl': {
    offsetX: 0,
    offsetY: 25,
    blur: 50,
    spread: -12,
    opacity: 0.25,
  },
} as const;

/**
 * Elevation levels for semantic usage
 * Maps common UI patterns to shadow levels
 */
export const ELEVATION = {
  flat: 'none',
  raised: 'sm',
  card: 'md',
  dropdown: 'lg',
  modal: 'xl',
  overlay: '2xl',
} as const;

/**
 * Glow effects for interactive states
 * Used for focus rings, hover highlights, win animations
 */
export const GLOW = {
  indigo: {
    color: '#5E5CE6',
    blur: 20,
    opacity: 0.4,
  },
  success: {
    color: '#34C759',
    blur: 20,
    opacity: 0.4,
  },
  error: {
    color: '#FF3B30',
    blur: 20,
    opacity: 0.4,
  },
  gold: {
    color: '#FFD700',
    blur: 30,
    opacity: 0.5,
  },
} as const;

/**
 * Colored shadow variants for brand cohesion
 * Each variant has offset, blur, spread, color, and opacity
 *
 * Usage Guidelines:
 * - indigoGlow: Selected states, focused elements, brand highlights
 * - goldAccent: Win celebrations, achievements, premium features
 * - successGlow: Success states, confirmations, positive feedback
 * - errorGlow: Error states, warnings, destructive actions
 * - warmShadow: Day mode, warm themes, inviting elements
 * - coolShadow: Night mode, cool themes, calm elements
 */
export const SHADOW_COLORED = {
  /** Brand indigo glow - selected states, focus */
  indigoGlow: {
    offsetX: 0,
    offsetY: 4,
    blur: 16,
    spread: -2,
    color: '#5E5CE6',
    opacity: 0.4,
  },
  /** Gold accent - wins, achievements, premium */
  goldAccent: {
    offsetX: 0,
    offsetY: 4,
    blur: 20,
    spread: -2,
    color: '#FFD700',
    opacity: 0.45,
  },
  /** Success glow - confirmations, positive feedback */
  successGlow: {
    offsetX: 0,
    offsetY: 4,
    blur: 16,
    spread: -2,
    color: '#34C759',
    opacity: 0.4,
  },
  /** Error glow - warnings, destructive actions */
  errorGlow: {
    offsetX: 0,
    offsetY: 4,
    blur: 16,
    spread: -2,
    color: '#FF3B30',
    opacity: 0.4,
  },
  /** Warm shadow - day mode, inviting elements */
  warmShadow: {
    offsetX: 0,
    offsetY: 6,
    blur: 20,
    spread: -4,
    color: '#8B4513',
    opacity: 0.15,
  },
  /** Cool shadow - night mode, calm elements */
  coolShadow: {
    offsetX: 0,
    offsetY: 6,
    blur: 20,
    spread: -4,
    color: '#1E3A5F',
    opacity: 0.2,
  },
} as const;

/**
 * Inset shadow variants for card depth effects
 * Used for pressed states, sunken panels, and debossed elements
 *
 * Usage Guidelines:
 * - sm: Subtle depression, text fields, minor pressed states
 * - md: Card insets, panel depressions, pressed buttons
 * - lg: Deep insets, well containers, significant pressed states
 */
export const SHADOW_INSET = {
  /** Subtle inset - text fields, minor pressed states */
  sm: {
    offsetX: 0,
    offsetY: 1,
    blur: 3,
    spread: 0,
    opacity: 0.1,
  },
  /** Medium inset - card wells, pressed buttons */
  md: {
    offsetX: 0,
    offsetY: 2,
    blur: 6,
    spread: -1,
    opacity: 0.15,
  },
  /** Large inset - deep wells, significant pressed states */
  lg: {
    offsetX: 0,
    offsetY: 4,
    blur: 10,
    spread: -2,
    opacity: 0.2,
  },
} as const;

// Type exports for type inference
export type ShadowLevel = keyof typeof SHADOW;
export type ShadowConfig = (typeof SHADOW)[ShadowLevel];

export type ElevationLevel = keyof typeof ELEVATION;

export type GlowColor = keyof typeof GLOW;
export type GlowConfig = (typeof GLOW)[GlowColor];

export type ShadowColoredKey = keyof typeof SHADOW_COLORED;
export type ShadowColoredConfig = (typeof SHADOW_COLORED)[ShadowColoredKey];

export type ShadowInsetLevel = keyof typeof SHADOW_INSET;
export type ShadowInsetConfig = (typeof SHADOW_INSET)[ShadowInsetLevel];
