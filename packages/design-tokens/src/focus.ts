/**
 * Focus ring tokens for Nullspace design system
 *
 * Provides accessible focus indicators that meet WCAG 2.1 requirements:
 * - Focus indicators must have 3:1 contrast ratio against adjacent colors
 * - Focus must be clearly visible for keyboard navigation
 * - Ring width should be at least 2px for visibility
 *
 * NO platform-specific code - raw values only
 *
 * Usage Guidelines:
 * - button: Standard interactive elements (buttons, links)
 * - input: Form fields requiring clear input boundary
 * - interactive: Cards, list items, complex interactive regions
 * - error: Invalid form fields requiring attention
 * - subtle: Low-emphasis focus for secondary elements
 */

/**
 * Focus ring configuration values
 * These raw values can be used to construct CSS or RN styles
 */
export const FOCUS = {
  /**
   * Standard button/link focus ring
   * Indigo brand color with moderate glow
   */
  button: {
    /** Ring thickness in pixels */
    width: 2,
    /** Ring color (indigo brand) */
    color: '#5E5CE6',
    /** Offset from element edge in pixels */
    offset: 2,
    /** Glow blur radius in pixels */
    glowBlur: 8,
    /** Glow opacity (0-1) */
    glowOpacity: 0.4,
  },

  /**
   * Form input focus ring
   * Wider ring with larger offset for text fields
   */
  input: {
    width: 2,
    color: '#5E5CE6',
    offset: 3,
    glowBlur: 10,
    glowOpacity: 0.35,
  },

  /**
   * Interactive region focus (cards, list items)
   * Thicker ring for larger areas
   */
  interactive: {
    width: 3,
    color: '#5E5CE6',
    offset: 2,
    glowBlur: 12,
    glowOpacity: 0.3,
  },

  /**
   * Error state focus ring
   * Red color to indicate validation error
   */
  error: {
    width: 2,
    color: '#FF3B30',
    offset: 2,
    glowBlur: 8,
    glowOpacity: 0.4,
  },

  /**
   * Subtle focus ring for secondary elements
   * Lower contrast for less prominent elements
   */
  subtle: {
    width: 1,
    color: '#737373',
    offset: 2,
    glowBlur: 4,
    glowOpacity: 0.2,
  },
} as const;

/**
 * Focus ring colors for different contexts
 * Allows easy color-only customization
 */
export const FOCUS_COLORS = {
  /** Default brand indigo */
  primary: '#5E5CE6',
  /** Success/valid state */
  success: '#34C759',
  /** Error/invalid state */
  error: '#FF3B30',
  /** Warning state */
  warning: '#FF9500',
  /** Subtle/muted gray */
  muted: '#737373',
  /** High contrast white (for dark backgrounds) */
  high: '#FFFFFF',
} as const;

/**
 * Focus ring width scale
 * Progressively thicker rings for different use cases
 */
export const FOCUS_WIDTH = {
  /** 1px - Subtle indicators */
  sm: 1,
  /** 2px - Standard focus rings */
  md: 2,
  /** 3px - Prominent focus for large interactive areas */
  lg: 3,
} as const;

/**
 * Focus ring offset scale
 * Distance between element edge and focus ring
 */
export const FOCUS_OFFSET = {
  /** 1px - Tight offset for compact elements */
  sm: 1,
  /** 2px - Standard offset */
  md: 2,
  /** 3px - Larger offset for form inputs */
  lg: 3,
  /** 4px - Extra offset for spacious layouts */
  xl: 4,
} as const;

// Type exports for type inference
export type FocusVariant = keyof typeof FOCUS;
export type FocusConfig = (typeof FOCUS)[FocusVariant];

export type FocusColorKey = keyof typeof FOCUS_COLORS;
export type FocusColorValue = (typeof FOCUS_COLORS)[FocusColorKey];

export type FocusWidthKey = keyof typeof FOCUS_WIDTH;
export type FocusWidthValue = (typeof FOCUS_WIDTH)[FocusWidthKey];

export type FocusOffsetKey = keyof typeof FOCUS_OFFSET;
export type FocusOffsetValue = (typeof FOCUS_OFFSET)[FocusOffsetKey];
