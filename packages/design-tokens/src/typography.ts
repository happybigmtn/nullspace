/**
 * Typography tokens for Nullspace design system
 * Consumed by CSS/Tailwind (web) and StyleSheet (mobile)
 *
 * NO platform-specific code - raw values only
 */

/**
 * Font family definitions
 * Display: Headlines and large text
 * Body: Readable paragraphs and UI text
 * Mono: Code, numbers, and technical content
 */
export const FONTS = {
  display: 'Outfit',
  body: 'Plus Jakarta Sans',
  mono: 'JetBrains Mono',
} as const;

/**
 * Type scale with size, line height, weight, and letter spacing
 * All numeric values are in pixels (consumers convert as needed)
 */
export const TYPE_SCALE = {
  micro: { size: 10, lineHeight: 12, weight: 500, letterSpacing: 0.5 },
  label: { size: 12, lineHeight: 16, weight: 500, letterSpacing: 0.25 },
  body: { size: 14, lineHeight: 20, weight: 400, letterSpacing: 0 },
  bodyLarge: { size: 16, lineHeight: 24, weight: 400, letterSpacing: 0 },
  heading: { size: 20, lineHeight: 28, weight: 600, letterSpacing: -0.25 },
  headingLarge: { size: 24, lineHeight: 32, weight: 600, letterSpacing: -0.5 },
  display: { size: 32, lineHeight: 40, weight: 700, letterSpacing: -0.5 },
  hero: { size: 48, lineHeight: 56, weight: 800, letterSpacing: -1 },
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
