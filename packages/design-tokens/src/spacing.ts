/**
 * Spacing tokens for Nullspace design system
 * Based on an 8pt grid with half-step for tight spacing
 *
 * NO platform-specific code - raw values only (in pixels)
 */

/**
 * Spacing scale values in pixels
 * Uses 4px base unit for flexibility
 */
export const SPACING = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
} as const;

/**
 * Common spacing values by semantic name
 * More readable than numeric keys in component code
 */
export const SPACING_SEMANTIC = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
} as const;

/**
 * Border radius values in pixels
 * Follows the design system's rounded aesthetic
 */
export const RADIUS = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 24,
  full: 9999,
} as const;

/**
 * Container max-widths for responsive layouts
 * Values in pixels
 */
export const CONTAINER = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

// Type exports for type inference
export type SpacingKey = keyof typeof SPACING;
export type SpacingValue = (typeof SPACING)[SpacingKey];

export type SemanticSpacingKey = keyof typeof SPACING_SEMANTIC;
export type RadiusKey = keyof typeof RADIUS;
export type ContainerKey = keyof typeof CONTAINER;
