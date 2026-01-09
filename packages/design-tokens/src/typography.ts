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
 *
 * Liquid Crystal Typography (US-267):
 * - Edge contrast optimization with tight tracking for headlines
 * - Tabular numbers for financial data (balances, odds, payouts)
 * - Weight hierarchy: display (600-800), body (400-500), mono (400)
 * - Glass surface readability via contrast and weight, not color
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

/**
 * Liquid Crystal Typography System (US-267)
 *
 * Optimized for glass surfaces and edge contrast. The system defines:
 * - Tracking rules (letter-spacing) optimized for edge visibility
 * - Weight mapping for each role (label, headline, body, number)
 * - Font feature settings for tabular numbers
 * - Glass surface-specific adjustments
 */

/**
 * Tracking (letter-spacing) presets for different contexts
 *
 * Headlines need tight tracking for visual density and "edge" feel.
 * Labels need slightly loose tracking for legibility at small sizes.
 * Body text uses neutral tracking for comfortable reading.
 */
export const TRACKING = {
  /** Tight tracking for headlines (-0.02em at base 16px = -0.32px) */
  tight: -0.32,
  /** Tighter tracking for large display text (-0.025em = -0.4px) */
  tighter: -0.4,
  /** Normal/neutral tracking */
  normal: 0,
  /** Wide tracking for labels and captions (0.01em = 0.16px) */
  wide: 0.16,
  /** Extra wide for all-caps text (0.05em = 0.8px) */
  wider: 0.8,
  /** Maximum tracking for micro text or badges (0.1em = 1.6px) */
  widest: 1.6,
} as const;

/**
 * Font feature settings for numeric display
 *
 * Tabular numbers are essential for financial data alignment.
 * Oldstyle figures can be used for body text with numbers.
 */
export const FONT_FEATURES = {
  /** Tabular (fixed-width) numerals - use for balances, odds, payouts, tables */
  tabularNums: 'tnum',
  /** Lining (uppercase) numerals - default for most numbers */
  liningNums: 'lnum',
  /** Oldstyle (lowercase) numerals - for body text with embedded numbers */
  oldstyleNums: 'onum',
  /** Proportional (variable-width) numerals - for running text */
  proportionalNums: 'pnum',
  /** Slashed zero - distinguishes 0 from O */
  slashedZero: 'zero',
  /** Ordinals - 1st, 2nd, 3rd styling */
  ordinals: 'ordn',
  /** Fractions - proper fraction rendering */
  fractions: 'frac',
} as const;

/**
 * Liquid Crystal type role definitions
 *
 * Each role defines the complete typographic treatment for a semantic purpose.
 * Roles are designed to work on glass surfaces with proper contrast.
 *
 * Usage:
 * - displayHero: Splash screens, landing page heroes
 * - displayLarge: Page titles, section headers
 * - displayMedium: Card titles, modal headers
 * - headline: Section labels, group headers
 * - label: Form labels, button text, navigation items
 * - labelUppercase: Badges, status indicators, category tags
 * - body: Paragraph text, descriptions
 * - bodySmall: Hints, helper text, timestamps
 * - numeric: Balances, odds, payouts, quantities
 * - numericLarge: Hero balance displays, big wins
 * - code: Code snippets, technical identifiers
 */
export const LC_TYPE_ROLE = {
  /** Hero display - largest headlines (48px Syne Bold) */
  displayHero: {
    fontFamily: 'display',
    size: 48,
    lineHeight: 56,
    weight: 700,
    letterSpacing: TRACKING.tighter,
    textTransform: 'none' as const,
    fontFeatures: null,
  },

  /** Large display - page titles (36px Syne SemiBold) */
  displayLarge: {
    fontFamily: 'display',
    size: 36,
    lineHeight: 44,
    weight: 600,
    letterSpacing: TRACKING.tight,
    textTransform: 'none' as const,
    fontFeatures: null,
  },

  /** Medium display - card titles, modal headers (24px Syne SemiBold) */
  displayMedium: {
    fontFamily: 'display',
    size: 24,
    lineHeight: 32,
    weight: 600,
    letterSpacing: TRACKING.tight,
    textTransform: 'none' as const,
    fontFeatures: null,
  },

  /** Headline - section labels (18px Space Grotesk Medium) */
  headline: {
    fontFamily: 'body',
    size: 18,
    lineHeight: 24,
    weight: 500,
    letterSpacing: TRACKING.normal,
    textTransform: 'none' as const,
    fontFeatures: null,
  },

  /** Label - form labels, buttons (14px Space Grotesk Medium) */
  label: {
    fontFamily: 'body',
    size: 14,
    lineHeight: 20,
    weight: 500,
    letterSpacing: TRACKING.wide,
    textTransform: 'none' as const,
    fontFeatures: null,
  },

  /** Uppercase label - badges, tags (12px Space Grotesk SemiBold) */
  labelUppercase: {
    fontFamily: 'body',
    size: 12,
    lineHeight: 16,
    weight: 600,
    letterSpacing: TRACKING.widest,
    textTransform: 'uppercase' as const,
    fontFeatures: null,
  },

  /** Body text - paragraphs (16px Space Grotesk Regular) */
  body: {
    fontFamily: 'body',
    size: 16,
    lineHeight: 24,
    weight: 400,
    letterSpacing: TRACKING.normal,
    textTransform: 'none' as const,
    fontFeatures: null,
  },

  /** Small body - helper text (14px Space Grotesk Regular) */
  bodySmall: {
    fontFamily: 'body',
    size: 14,
    lineHeight: 20,
    weight: 400,
    letterSpacing: TRACKING.normal,
    textTransform: 'none' as const,
    fontFeatures: null,
  },

  /** Caption - timestamps, hints (12px Space Grotesk Regular) */
  caption: {
    fontFamily: 'body',
    size: 12,
    lineHeight: 16,
    weight: 400,
    letterSpacing: TRACKING.wide,
    textTransform: 'none' as const,
    fontFeatures: null,
  },

  /** Numeric - balances, odds (16px JetBrains Mono Regular, tabular) */
  numeric: {
    fontFamily: 'mono',
    size: 16,
    lineHeight: 24,
    weight: 400,
    letterSpacing: TRACKING.normal,
    textTransform: 'none' as const,
    fontFeatures: FONT_FEATURES.tabularNums,
  },

  /** Large numeric - hero balances (32px JetBrains Mono Medium, tabular) */
  numericLarge: {
    fontFamily: 'mono',
    size: 32,
    lineHeight: 40,
    weight: 500,
    letterSpacing: TRACKING.tight,
    textTransform: 'none' as const,
    fontFeatures: FONT_FEATURES.tabularNums,
  },

  /** Extra large numeric - big wins, jackpots (48px JetBrains Mono Bold, tabular) */
  numericHero: {
    fontFamily: 'mono',
    size: 48,
    lineHeight: 56,
    weight: 700,
    letterSpacing: TRACKING.tight,
    textTransform: 'none' as const,
    fontFeatures: FONT_FEATURES.tabularNums,
  },

  /** Small numeric - odds, multipliers (14px JetBrains Mono Regular, tabular) */
  numericSmall: {
    fontFamily: 'mono',
    size: 14,
    lineHeight: 20,
    weight: 400,
    letterSpacing: TRACKING.normal,
    textTransform: 'none' as const,
    fontFeatures: FONT_FEATURES.tabularNums,
  },

  /** Code - technical identifiers (14px JetBrains Mono Regular) */
  code: {
    fontFamily: 'mono',
    size: 14,
    lineHeight: 20,
    weight: 400,
    letterSpacing: TRACKING.normal,
    textTransform: 'none' as const,
    fontFeatures: null,
  },
} as const;

/**
 * Semantic type mappings for casino UI elements
 *
 * Maps UI elements to their appropriate LC_TYPE_ROLE.
 * Use these for consistent typography across the casino.
 */
export const LC_TYPE_SEMANTIC = {
  /** Main balance display in header/wallet */
  balance: 'numericLarge',
  /** Session P&L display */
  sessionPnl: 'numeric',
  /** Bet amount in slip */
  betAmount: 'numeric',
  /** Odds/multiplier display */
  odds: 'numericSmall',
  /** Payout amount on result */
  payout: 'numericLarge',
  /** Big win celebration */
  bigWin: 'numericHero',
  /** Game title in header */
  gameTitle: 'displayMedium',
  /** Section headers */
  sectionTitle: 'headline',
  /** Button text */
  button: 'label',
  /** Status badges (WIN/LOSS) */
  badge: 'labelUppercase',
  /** Input labels */
  inputLabel: 'label',
  /** Helper/hint text */
  hint: 'caption',
  /** Descriptive text */
  description: 'body',
  /** Small descriptions */
  descriptionSmall: 'bodySmall',
} as const;

/**
 * Glass surface typography adjustments
 *
 * On translucent glass surfaces, text needs specific treatment:
 * - Heavier weights for thin text to maintain legibility
 * - Slightly larger sizes at small scales
 * - Shadow for extreme translucency levels
 */
export const LC_GLASS_ADJUSTMENTS = {
  /** Mist/light glass - minimal adjustment */
  mist: {
    weightBoost: 0,     // No change
    sizeBoost: 0,       // No change
    textShadow: null,   // No shadow needed
  },
  /** Veil/standard glass - slight boost */
  veil: {
    weightBoost: 0,     // No change
    sizeBoost: 0,       // No change
    textShadow: null,   // No shadow needed
  },
  /** Smoke/prominent glass - minor boost */
  smoke: {
    weightBoost: 100,   // +100 to weight (400→500, 500→600)
    sizeBoost: 0,       // No size change
    textShadow: null,   // No shadow needed
  },
  /** Fog/modal glass - boost for readability */
  fog: {
    weightBoost: 100,   // +100 to weight
    sizeBoost: 0,       // No size change
    textShadow: '0 1px 2px rgba(0,0,0,0.1)', // Subtle shadow
  },
  /** Frost/heavy glass - maximum boost */
  frost: {
    weightBoost: 100,   // +100 to weight
    sizeBoost: 1,       // +1px to size
    textShadow: '0 1px 3px rgba(0,0,0,0.15)', // More visible shadow
  },
} as const;

// Type exports for type inference
export type FontFamily = keyof typeof FONTS;
export type TypeVariant = keyof typeof TYPE_SCALE;
export type TypeStyle = (typeof TYPE_SCALE)[TypeVariant];
export type FontWeight = keyof typeof FONT_WEIGHTS;
export type TrackingPreset = keyof typeof TRACKING;
export type TrackingValue = (typeof TRACKING)[TrackingPreset];
export type FontFeature = keyof typeof FONT_FEATURES;
export type FontFeatureValue = (typeof FONT_FEATURES)[FontFeature];
export type LCTypeRole = keyof typeof LC_TYPE_ROLE;
export type LCTypeRoleConfig = (typeof LC_TYPE_ROLE)[LCTypeRole];
export type LCTypeSemantic = keyof typeof LC_TYPE_SEMANTIC;
export type LCGlassLevel = keyof typeof LC_GLASS_ADJUSTMENTS;
export type LCGlassAdjustment = (typeof LC_GLASS_ADJUSTMENTS)[LCGlassLevel];
