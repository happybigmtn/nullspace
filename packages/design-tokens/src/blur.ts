/**
 * Blur tokens for Nullspace design system
 * Used for glassmorphism, frosted glass effects, and depth
 *
 * Values in pixels - converted to CSS backdrop-filter or RN blur views
 * NO platform-specific code - raw values only
 */

/**
 * Blur scale - numeric values in pixels
 * Progressive scale for varying blur intensities
 */
export const BLUR = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
} as const;

/**
 * Semantic blur mappings for specific use cases
 * References BLUR scale values
 */
export const BLUR_SEMANTIC = {
  /** Barely perceptible blur for subtle depth - 4px */
  subtle: BLUR.xs,
  /** Standard glassmorphism effect - 16px */
  glass: BLUR.md,
  /** Heavy blur for overlays and modals - 24px */
  heavy: BLUR.lg,
  /** Maximum frosted glass effect - 32px */
  frosted: BLUR.xl,
  /** Background dimming with blur - 8px */
  backdrop: BLUR.sm,
  /** Modal/dialog backdrop blur - 16px */
  modal: BLUR.md,
  /** Overlay backdrop blur - 24px */
  overlay: BLUR.lg,
} as const;

/**
 * Blur radius for focus/glow effects (different from backdrop blur)
 * Used for box-shadow blur radius
 */
export const BLUR_GLOW = {
  /** Tight glow - 8px */
  tight: 8,
  /** Standard glow - 16px */
  standard: 16,
  /** Wide glow - 24px */
  wide: 24,
  /** Expansive glow for jackpots - 40px */
  expansive: 40,
} as const;

// Type exports for type inference
export type BlurLevel = keyof typeof BLUR;
export type BlurValue = (typeof BLUR)[BlurLevel];

export type BlurSemanticKey = keyof typeof BLUR_SEMANTIC;
export type BlurSemanticValue = (typeof BLUR_SEMANTIC)[BlurSemanticKey];

export type BlurGlowKey = keyof typeof BLUR_GLOW;
export type BlurGlowValue = (typeof BLUR_GLOW)[BlurGlowKey];
