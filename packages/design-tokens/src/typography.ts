/**
 * Typography tokens for Nullspace design system
 * Consumed by CSS/Tailwind (web) and StyleSheet (mobile)
 *
 * NO platform-specific code - raw values only
 *
 * Monochrome Redesign (US-260):
 * - Syne: Expressive geometric display font for headlines
 * - Space Grotesk: Clean, modern sans-serif for body text
 * - JetBrains Mono: Technical/code font for numbers and data
 */

/**
 * Font family definitions - Monochrome Redesign
 *
 * Display: Syne - Bold geometric display font with sharp, edgy character
 * Body: Space Grotesk - Clean, slightly technical sans-serif
 * Mono: JetBrains Mono - Precise monospace for tabular data and code
 *
 * Font weights:
 * - Display: 600-800 (bold to extrabold for impact)
 * - Body: 400-500 (regular to medium for readability)
 * - Mono: 400-500 (regular to medium for clarity)
 */
export const FONTS = {
  // Primary fonts - Monochrome Redesign
  display: 'Syne',
  body: 'Space Grotesk',
  mono: 'JetBrains Mono',
  // Legacy alias
  sans: 'Space Grotesk',
} as const;

/**
 * Type scale - Luxury Redesign v4.0
 *
 * Strict 4-level hierarchy + 1 micro size:
 * - Hero (48px): Page titles, splash screens
 * - Headline (24px): Section titles, card headers
 * - Body (16px): All readable content
 * - Caption (12px): Labels, hints, timestamps
 * - Micro (10px): Badges, tiny labels
 *
 * Letter-spacing in pixels (converted from em at base 16px):
 * -0.02em = -0.32px, -0.015em = -0.24px, 0.01em = 0.16px
 */
export const TYPE_SCALE = {
  // Micro: Badges, tiny labels (10px)
  micro: { size: 10, lineHeight: 12, weight: 500, letterSpacing: 0.16 },

  // Caption: Labels, hints, timestamps (12px)
  caption: { size: 12, lineHeight: 16, weight: 400, letterSpacing: 0.16 },

  // Body: All readable content (16px) - THE default
  body: { size: 16, lineHeight: 24, weight: 400, letterSpacing: 0 },

  // Headline: Section titles, card headers (24px)
  headline: { size: 24, lineHeight: 32, weight: 500, letterSpacing: -0.24 },

  // Hero: Page titles, splash screens (48px)
  hero: { size: 48, lineHeight: 56, weight: 600, letterSpacing: -0.32 },

  // Legacy aliases for backwards compatibility (map to new hierarchy)
  label: { size: 12, lineHeight: 16, weight: 400, letterSpacing: 0.16 },
  bodyLarge: { size: 16, lineHeight: 24, weight: 400, letterSpacing: 0 },
  heading: { size: 24, lineHeight: 32, weight: 500, letterSpacing: -0.24 },
  headingLarge: { size: 24, lineHeight: 32, weight: 500, letterSpacing: -0.24 },
  display: { size: 48, lineHeight: 56, weight: 600, letterSpacing: -0.32 },
} as const;

/**
 * Font weights as numeric values
 * Maps to standard font-weight CSS/RN values
 */
export const FONT_WEIGHTS = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
} as const;

// Type exports for type inference
export type FontFamily = keyof typeof FONTS;
export type TypeVariant = keyof typeof TYPE_SCALE;
export type TypeStyle = (typeof TYPE_SCALE)[TypeVariant];
export type FontWeight = keyof typeof FONT_WEIGHTS;
