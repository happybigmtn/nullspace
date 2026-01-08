/**
 * Spacing tokens for Nullspace design system
 *
 * LUX-021: Consistent 4px grid spacing
 *
 * Allowed values: 4, 8, 12, 16, 24, 32, 48, 64, 96
 * Avoid: 6px (gap-1.5), 20px (gap-5), 28px (gap-7), etc.
 *
 * Usage guidelines:
 * - Component internal: 8-16px (gap-2 to gap-4)
 * - Section spacing: 24-32px (gap-6 to gap-8)
 * - Screen padding: 16px mobile, 24px tablet, 32px desktop
 *
 * NO platform-specific code - raw values only (in pixels)
 */

/**
 * Spacing scale values in pixels
 * Pure 4px base unit grid
 */
export const SPACING = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
  12: 48,
  16: 64,
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
