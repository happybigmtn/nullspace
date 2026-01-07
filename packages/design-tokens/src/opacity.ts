/**
 * Opacity tokens for Nullspace design system
 *
 * Provides consistent opacity values for overlays, glassmorphism,
 * and layered UI elements across web and mobile.
 *
 * NO platform-specific code - raw values only (0-1 range)
 *
 * Usage Guidelines:
 * - xs/sm: Subtle hints, disabled states, light overlays
 * - md: Standard overlays, glassmorphism backgrounds
 * - lg: Modal backdrops, focused overlays
 * - xl: Heavy overlays, tutorial backdrops
 * - 2xl/3xl: Near-opaque overlays, blocking modals
 */

/**
 * Opacity scale values (0-1)
 * Named keys follow T-shirt sizing for intuitive use
 */
export const OPACITY = {
  /** 0.08 - Subtle hints, very light overlays */
  xs: 0.08,
  /** 0.12 - Light overlays, soft backgrounds */
  sm: 0.12,
  /** 0.24 - Standard glassmorphism, medium overlays */
  md: 0.24,
  /** 0.38 - Modal backdrops, focused overlays */
  lg: 0.38,
  /** 0.56 - Heavy overlays, dimmed backgrounds */
  xl: 0.56,
  /** 0.72 - Near-opaque, blocking overlays */
  '2xl': 0.72,
  /** 0.85 - Almost opaque, tutorial/splash overlays */
  '3xl': 0.85,
} as const;

/**
 * Semantic opacity values for common UI patterns
 */
export const OPACITY_SEMANTIC = {
  /** For disabled UI elements */
  disabled: 0.38,
  /** For placeholder text */
  placeholder: 0.56,
  /** For hover state overlays */
  hover: 0.08,
  /** For pressed/active state overlays */
  pressed: 0.12,
  /** For glassmorphism backgrounds */
  glass: 0.24,
  /** For modal/dialog backdrops */
  backdrop: 0.56,
  /** For tutorial/onboarding overlays */
  tutorial: 0.85,
} as const;

// Type exports for type inference
export type OpacityKey = keyof typeof OPACITY;
export type OpacityValue = (typeof OPACITY)[OpacityKey];

export type OpacitySemanticKey = keyof typeof OPACITY_SEMANTIC;
export type OpacitySemanticValue = (typeof OPACITY_SEMANTIC)[OpacitySemanticKey];
