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

// Type exports for type inference
export type ShadowLevel = keyof typeof SHADOW;
export type ShadowConfig = (typeof SHADOW)[ShadowLevel];

export type ElevationLevel = keyof typeof ELEVATION;

export type GlowColor = keyof typeof GLOW;
export type GlowConfig = (typeof GLOW)[GlowColor];
