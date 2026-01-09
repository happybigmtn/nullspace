/**
 * Jony Ive-inspired design system constants
 * Principles: Radical Simplicity, Progressive Disclosure, Clarity, Tactile Response
 *
 * Imports raw tokens from @nullspace/design-tokens and applies platform-specific transforms
 */

import { Platform, StyleSheet } from 'react-native';
import { CHIP_VALUES } from '@nullspace/constants/chips';
import {
  // Primary monochrome palette (US-260/US-262)
  MONO,
  SEMANTIC,
  STATE,
  EDGE,
  // Spacing and layout
  SPACING_SEMANTIC,
  RADIUS as TOKEN_RADIUS,
  // Animation
  DURATION,
  SPRING,
  SPRING_LIQUID,
  STAGGER,
  EASING_LUXURY,
  // Opacity
  OPACITY_SEMANTIC,
  // Shadows
  SHADOW,
  // Typography
  TYPE_SCALE,
  // Liquid Crystal Typography (US-267)
  TRACKING,
  FONT_FEATURES,
  LC_TYPE_ROLE,
  LC_TYPE_SEMANTIC,
  LC_GLASS_ADJUSTMENTS,
  // Liquid Crystal Motion Language (US-269)
  MOTION_TIER,
  MOTION_TIMING,
  MOTION_PRIORITY,
  LC_SWEEP,
  LC_REFRACT,
  LC_EDGE,
  LC_ENTRANCE,
  LC_SPRING,
  GAME_STATE_MOTION_RULES,
} from '@nullspace/design-tokens';

/**
 * Font family constants - synced with @nullspace/design-tokens
 *
 * These map to the fonts loaded in App.tsx via @expo-google-fonts packages.
 * The naming convention follows expo-google-fonts: FontName_WeightVariant
 *
 * Display font (Outfit): Headlines, large text, numbers in displays
 * Body font (Plus Jakarta Sans): Readable paragraphs, UI text, labels
 */

/** Display font family - Outfit (from design-tokens FONTS.display) */
export const FONT_DISPLAY = {
  regular: 'Outfit_400Regular',
  medium: 'Outfit_500Medium',
  semibold: 'Outfit_600SemiBold',
  bold: 'Outfit_700Bold',
  extrabold: 'Outfit_800ExtraBold',
} as const;

/** Body font family - Plus Jakarta Sans (from design-tokens FONTS.body) */
export const FONT_BODY = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;

/**
 * Mono font family for code and tabular numbers
 * Uses platform default since JetBrains Mono isn't bundled (would add ~200KB)
 */
const MONO_FONT = Platform.select({
  ios: 'Courier',
  android: 'monospace',
  default: 'monospace',
});

/**
 * Legacy FONT_FAMILY export for backwards compatibility
 * New code should use FONT_DISPLAY or FONT_BODY directly
 * @deprecated Use FONT_BODY.regular for body text or FONT_DISPLAY.bold for headlines
 */
const FONT_FAMILY = FONT_BODY.regular;

/**
 * Light color palette - Monochrome redesign (US-262)
 *
 * High-contrast pure white theme. All colors from MONO/SEMANTIC tokens.
 * States differentiated by contrast and icons, not hue.
 */
export const LIGHT_COLORS = {
  // Monochrome backgrounds (from SEMANTIC.light)
  background: SEMANTIC.light.background,     // Pure white
  surface: SEMANTIC.light.surface,           // Near-white cards
  surfaceElevated: SEMANTIC.light.surfaceElevated,
  border: SEMANTIC.light.border,

  // Monochrome interactive states (from STATE)
  primary: STATE.interactive.default,        // Black
  primaryDark: STATE.interactive.hover,      // Dark gray
  success: MONO[0],                          // Black (use icons for semantics)
  warning: MONO[300],                        // Dark gray
  error: MONO[0],                            // Black (use icons for semantics)
  destructive: MONO[0],                      // Black
  gold: MONO[0],                             // Black (no gold accent)

  // Text hierarchy (from SEMANTIC.light)
  textPrimary: SEMANTIC.light.textPrimary,   // Pure black
  textSecondary: SEMANTIC.light.textSecondary,
  textMuted: SEMANTIC.light.textMuted,
  textDisabled: SEMANTIC.light.textDisabled,

  // Card suits - monochrome contrast
  suitRed: MONO[500],                        // Mid-gray (distinguishable but muted)
  suitBlack: MONO[0],                        // Pure black

  // Glass (monochrome)
  glassLight: EDGE.light.highlight,
  glassDark: EDGE.light.shadow,
} as const;

/**
 * Dark color palette - Monochrome redesign (US-262)
 *
 * OLED-optimized pure black theme. Maximum battery savings on AMOLED.
 * States differentiated by contrast and icons, not hue.
 */
export const DARK_COLORS = {
  // Monochrome backgrounds (from SEMANTIC.dark)
  background: SEMANTIC.dark.background,      // Pure black - OLED savings
  surface: SEMANTIC.dark.surface,            // Near-black cards
  surfaceElevated: SEMANTIC.dark.surfaceElevated,
  border: SEMANTIC.dark.border,

  // Monochrome interactive states (inverted for dark mode)
  primary: MONO[1000],                       // White on dark
  primaryDark: MONO[800],                    // Light gray
  success: MONO[1000],                       // White (use icons for semantics)
  warning: MONO[700],                        // Light gray
  error: MONO[1000],                         // White (use icons for semantics)
  destructive: MONO[1000],                   // White
  gold: MONO[1000],                          // White (no gold accent)

  // Text hierarchy (from SEMANTIC.dark)
  textPrimary: SEMANTIC.dark.textPrimary,    // Pure white
  textSecondary: SEMANTIC.dark.textSecondary,
  textMuted: SEMANTIC.dark.textMuted,
  textDisabled: SEMANTIC.dark.textDisabled,

  // Card suits - monochrome contrast on dark
  suitRed: MONO[500],                        // Mid-gray (distinguishable but muted)
  suitBlack: MONO[1000],                     // Pure white on dark

  // Glass (monochrome)
  glassLight: EDGE.dark.highlight,
  glassDark: EDGE.dark.shadow,
} as const;

/** Color scheme type for theming */
export type ColorScheme = 'light' | 'dark';

/** Type for themed colors object - union of both palettes for flexibility */
export type ThemedColors = typeof LIGHT_COLORS | typeof DARK_COLORS;

/**
 * Get colors for a specific color scheme
 * @param scheme - 'light' or 'dark'
 * @returns Themed color palette
 */
export function getColors(scheme: ColorScheme): ThemedColors {
  return scheme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
}

/**
 * Legacy export for backwards compatibility
 * Components should migrate to useTheme() + getColors() pattern
 * @deprecated Use getColors(scheme) or useThemedColors() hook instead
 */
export const COLORS = LIGHT_COLORS;

/**
 * Spacing scale from design-tokens
 */
export const SPACING = {
  xs: SPACING_SEMANTIC.xs,
  sm: SPACING_SEMANTIC.sm,
  md: SPACING_SEMANTIC.md,
  lg: SPACING_SEMANTIC.lg,
  xl: SPACING_SEMANTIC.xl,
  xxl: SPACING_SEMANTIC['2xl'],
} as const;

/**
 * Border radius from design-tokens
 *
 * Direct mapping to tokens for platform consistency:
 * - sm: 4px (subtle rounding for small elements)
 * - md: 8px (standard rounding for cards, buttons)
 * - lg: 12px (larger rounding for panels, containers)
 * - xl: 16px (extra large for modals, overlays)
 * - 2xl: 24px (glass-morphism containers, bottom sheets)
 * - full: 9999px (circular elements, pills)
 */
export const RADIUS = {
  sm: TOKEN_RADIUS.sm,    // 4px
  md: TOKEN_RADIUS.md,    // 8px
  lg: TOKEN_RADIUS.lg,    // 12px
  xl: TOKEN_RADIUS.xl,    // 16px
  '2xl': TOKEN_RADIUS['2xl'], // 24px - glass-morphism radius
  full: TOKEN_RADIUS.full,
} as const;

/**
 * Shadow styles derived from @nullspace/design-tokens
 *
 * React Native uses a different shadow format than CSS:
 * - iOS: shadowOffset, shadowRadius, shadowOpacity, shadowColor
 * - Android: elevation (single value that determines shadow intensity)
 *
 * Each level includes both iOS shadow props and Android elevation for cross-platform.
 */
type ShadowToken = {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly blur: number;
  readonly spread: number;
  readonly opacity: number;
};

const toRNShadow = (shadow: ShadowToken, elevation: number) => ({
  shadowColor: '#000000',
  shadowOffset: { width: shadow.offsetX, height: shadow.offsetY },
  shadowRadius: shadow.blur,
  shadowOpacity: shadow.opacity,
  elevation,
});

export const SHADOWS = {
  /** No shadow */
  none: toRNShadow(SHADOW.none, 0),
  /** Subtle shadow for raised buttons */
  sm: toRNShadow(SHADOW.sm, 2),
  /** Standard card shadow */
  md: toRNShadow(SHADOW.md, 4),
  /** Dropdown/floating element shadow */
  lg: toRNShadow(SHADOW.lg, 8),
  /** Modal shadow */
  xl: toRNShadow(SHADOW.xl, 12),
  /** Overlay/heavy shadow */
  '2xl': toRNShadow(SHADOW['2xl'], 16),
} as const;

/**
 * Semantic elevation mappings for common UI patterns
 * Maps design-token ELEVATION levels to SHADOWS
 */
export const ELEVATION_STYLES = {
  /** Flat surface - no elevation */
  flat: SHADOWS.none,
  /** Slightly raised - button at rest */
  raised: SHADOWS.sm,
  /** Card surface */
  card: SHADOWS.md,
  /** Dropdown menus, floating buttons */
  dropdown: SHADOWS.lg,
  /** Modal dialogs */
  modal: SHADOWS.xl,
  /** Overlays, bottom sheets */
  overlay: SHADOWS['2xl'],
} as const;

/**
 * Glow effects - Monochrome redesign (US-262)
 *
 * All glows use white for dark mode, differentiated by intensity/radius.
 * Used for focus rings, win animations, and interactive highlights.
 */
export const GLOW_STYLES = {
  /** Primary glow - focused states */
  indigo: {
    shadowColor: MONO[1000],               // White glow
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 20,
    shadowOpacity: 0.4,
    elevation: 6,
  },
  /** Success/win glow - medium intensity */
  success: {
    shadowColor: MONO[1000],
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 20,
    shadowOpacity: 0.35,
    elevation: 6,
  },
  /** Error/loss glow - subtle */
  error: {
    shadowColor: MONO[1000],
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 16,
    shadowOpacity: 0.25,
    elevation: 4,
  },
  /** Win/jackpot glow - high intensity */
  gold: {
    shadowColor: MONO[1000],
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 30,
    shadowOpacity: 0.5,
    elevation: 8,
  },
} as const;

/** Type for shadow style properties */
export type ShadowStyle = (typeof SHADOWS)[keyof typeof SHADOWS];
export type ElevationStyle = (typeof ELEVATION_STYLES)[keyof typeof ELEVATION_STYLES];
export type GlowStyleType = (typeof GLOW_STYLES)[keyof typeof GLOW_STYLES];

/**
 * Helper to map TYPE_SCALE weight number to React Native font weight string
 */
const weightToString = (weight: number): '400' | '500' | '600' | '700' | '800' => {
  const map: Record<number, '400' | '500' | '600' | '700' | '800'> = {
    400: '400',
    500: '500',
    600: '600',
    700: '700',
    800: '800',
  };
  return map[weight] || '400';
};

/**
 * Helper to get font family based on weight for display font
 */
const getDisplayFont = (weight: number) => {
  if (weight >= 800) return FONT_DISPLAY.extrabold;
  if (weight >= 700) return FONT_DISPLAY.bold;
  if (weight >= 600) return FONT_DISPLAY.semibold;
  if (weight >= 500) return FONT_DISPLAY.medium;
  return FONT_DISPLAY.regular;
};

/**
 * Helper to get font family based on weight for body font
 */
const getBodyFont = (weight: number) => {
  if (weight >= 800) return FONT_BODY.extrabold;
  if (weight >= 700) return FONT_BODY.bold;
  if (weight >= 600) return FONT_BODY.semibold;
  if (weight >= 500) return FONT_BODY.medium;
  return FONT_BODY.regular;
};

/**
 * Typography definitions - synced with @nullspace/design-tokens TYPE_SCALE
 *
 * Display variants use Outfit (display font) for visual impact
 * Body variants use Plus Jakarta Sans (body font) for readability
 *
 * Note: fontWeight is kept for React Native compatibility, but the actual
 * weight is determined by the loaded font variant (e.g., Outfit_700Bold)
 */
export const TYPOGRAPHY = {
  // ─────────────────────────────────────────────────────────────────────────────
  // TYPE_SCALE tokens from design system (exact match)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Micro - 10px, labels, badges */
  micro: {
    fontSize: TYPE_SCALE.micro.size,
    lineHeight: TYPE_SCALE.micro.lineHeight,
    fontWeight: weightToString(TYPE_SCALE.micro.weight),
    letterSpacing: TYPE_SCALE.micro.letterSpacing,
    fontFamily: getBodyFont(TYPE_SCALE.micro.weight),
  },
  /** Label - 12px, form labels, section headers */
  label: {
    fontSize: TYPE_SCALE.label.size,
    lineHeight: TYPE_SCALE.label.lineHeight,
    fontWeight: weightToString(TYPE_SCALE.label.weight),
    letterSpacing: TYPE_SCALE.label.letterSpacing,
    fontFamily: getBodyFont(TYPE_SCALE.label.weight),
  },
  /** Body - 14px, standard body text */
  body: {
    fontSize: TYPE_SCALE.body.size,
    lineHeight: TYPE_SCALE.body.lineHeight,
    fontWeight: weightToString(TYPE_SCALE.body.weight),
    letterSpacing: TYPE_SCALE.body.letterSpacing,
    fontFamily: getBodyFont(TYPE_SCALE.body.weight),
  },
  /** Body Large - 16px, emphasized body text */
  bodyLarge: {
    fontSize: TYPE_SCALE.bodyLarge.size,
    lineHeight: TYPE_SCALE.bodyLarge.lineHeight,
    fontWeight: weightToString(TYPE_SCALE.bodyLarge.weight),
    letterSpacing: TYPE_SCALE.bodyLarge.letterSpacing,
    fontFamily: getBodyFont(TYPE_SCALE.bodyLarge.weight),
  },
  /** Heading - 20px, section headings */
  heading: {
    fontSize: TYPE_SCALE.heading.size,
    lineHeight: TYPE_SCALE.heading.lineHeight,
    fontWeight: weightToString(TYPE_SCALE.heading.weight),
    letterSpacing: TYPE_SCALE.heading.letterSpacing,
    fontFamily: getDisplayFont(TYPE_SCALE.heading.weight),
  },
  /** Heading Large - 24px, page titles */
  headingLarge: {
    fontSize: TYPE_SCALE.headingLarge.size,
    lineHeight: TYPE_SCALE.headingLarge.lineHeight,
    fontWeight: weightToString(TYPE_SCALE.headingLarge.weight),
    letterSpacing: TYPE_SCALE.headingLarge.letterSpacing,
    fontFamily: getDisplayFont(TYPE_SCALE.headingLarge.weight),
  },
  /** Display - 32px, hero sections */
  display: {
    fontSize: TYPE_SCALE.display.size,
    lineHeight: TYPE_SCALE.display.lineHeight,
    fontWeight: weightToString(TYPE_SCALE.display.weight),
    letterSpacing: TYPE_SCALE.display.letterSpacing,
    fontFamily: getDisplayFont(TYPE_SCALE.display.weight),
  },
  /** Hero - 48px, splash screens, large statements */
  hero: {
    fontSize: TYPE_SCALE.hero.size,
    lineHeight: TYPE_SCALE.hero.lineHeight,
    fontWeight: weightToString(TYPE_SCALE.hero.weight),
    letterSpacing: TYPE_SCALE.hero.letterSpacing,
    fontFamily: getDisplayFont(TYPE_SCALE.hero.weight),
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Legacy variants (backward compatibility)
  // ─────────────────────────────────────────────────────────────────────────────

  /** @deprecated Use 'hero' instead */
  displayLarge: {
    fontSize: TYPE_SCALE.hero.size,
    fontWeight: '800' as const,
    letterSpacing: TYPE_SCALE.hero.letterSpacing,
    fontFamily: FONT_DISPLAY.extrabold,
  },
  /** @deprecated Use 'display' instead */
  displayMedium: {
    fontSize: 36,
    fontWeight: '700' as const,
    letterSpacing: -0.5,
    fontFamily: FONT_DISPLAY.bold,
  },
  /** @deprecated Use 'headingLarge' instead */
  h1: {
    fontSize: 28,
    fontWeight: '700' as const,
    fontFamily: FONT_DISPLAY.bold,
  },
  /** @deprecated Use 'headingLarge' instead */
  h2: {
    fontSize: TYPE_SCALE.headingLarge.size,
    fontWeight: '600' as const,
    fontFamily: FONT_DISPLAY.semibold,
  },
  /** @deprecated Use 'heading' instead */
  h3: {
    fontSize: TYPE_SCALE.heading.size,
    fontWeight: '600' as const,
    fontFamily: FONT_DISPLAY.semibold,
  },
  // Mono for code and technical content
  mono: {
    fontFamily: MONO_FONT,
    fontSize: 12,
  },
  // Additional body variants
  bodySmall: {
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
    fontFamily: FONT_BODY.regular,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
    fontFamily: FONT_BODY.regular,
  },
  /**
   * Tabular figures style for numeric displays (balance, bets, payouts)
   * Uses display font for visual impact + fontVariant for aligned digits
   * This ensures numbers don't shift when values change (e.g., $999 → $1000)
   */
  numeric: {
    fontSize: 24,
    fontWeight: '600' as const,
    fontFamily: FONT_DISPLAY.semibold,
    fontVariant: ['tabular-nums'] as const,
  },
  /** Large numeric display for balance */
  numericLarge: {
    fontSize: 32,
    fontWeight: '700' as const,
    fontFamily: FONT_DISPLAY.bold,
    fontVariant: ['tabular-nums'] as const,
  },
} as const;

/**
 * Liquid Crystal Typography System (US-267)
 *
 * Role-based typography optimized for glass surfaces and edge contrast.
 * Use these for new components following the Liquid Crystal design language.
 *
 * Font feature: tabular-nums for numeric roles ensures alignment
 */

/** Helper to get mono font - for tabular numbers */
const getMonoFont = () => MONO_FONT;

export const LC_TYPOGRAPHY = {
  // ─────────────────────────────────────────────────────────────────────────────
  // Display roles - Syne/Outfit for headlines
  // ─────────────────────────────────────────────────────────────────────────────

  /** Hero display - 48px, splash screens */
  displayHero: {
    fontSize: LC_TYPE_ROLE.displayHero.size,
    lineHeight: LC_TYPE_ROLE.displayHero.lineHeight,
    fontWeight: weightToString(LC_TYPE_ROLE.displayHero.weight),
    letterSpacing: LC_TYPE_ROLE.displayHero.letterSpacing,
    fontFamily: getDisplayFont(LC_TYPE_ROLE.displayHero.weight),
  },

  /** Large display - 36px, page titles */
  displayLarge: {
    fontSize: LC_TYPE_ROLE.displayLarge.size,
    lineHeight: LC_TYPE_ROLE.displayLarge.lineHeight,
    fontWeight: weightToString(LC_TYPE_ROLE.displayLarge.weight),
    letterSpacing: LC_TYPE_ROLE.displayLarge.letterSpacing,
    fontFamily: getDisplayFont(LC_TYPE_ROLE.displayLarge.weight),
  },

  /** Medium display - 24px, card/modal headers */
  displayMedium: {
    fontSize: LC_TYPE_ROLE.displayMedium.size,
    lineHeight: LC_TYPE_ROLE.displayMedium.lineHeight,
    fontWeight: weightToString(LC_TYPE_ROLE.displayMedium.weight),
    letterSpacing: LC_TYPE_ROLE.displayMedium.letterSpacing,
    fontFamily: getDisplayFont(LC_TYPE_ROLE.displayMedium.weight),
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Body roles - Space Grotesk/Plus Jakarta Sans for UI text
  // ─────────────────────────────────────────────────────────────────────────────

  /** Headline - 18px, section labels */
  headline: {
    fontSize: LC_TYPE_ROLE.headline.size,
    lineHeight: LC_TYPE_ROLE.headline.lineHeight,
    fontWeight: weightToString(LC_TYPE_ROLE.headline.weight),
    letterSpacing: LC_TYPE_ROLE.headline.letterSpacing,
    fontFamily: getBodyFont(LC_TYPE_ROLE.headline.weight),
  },

  /** Label - 14px, form labels, buttons */
  label: {
    fontSize: LC_TYPE_ROLE.label.size,
    lineHeight: LC_TYPE_ROLE.label.lineHeight,
    fontWeight: weightToString(LC_TYPE_ROLE.label.weight),
    letterSpacing: LC_TYPE_ROLE.label.letterSpacing,
    fontFamily: getBodyFont(LC_TYPE_ROLE.label.weight),
  },

  /** Uppercase label - 12px, badges, tags */
  labelUppercase: {
    fontSize: LC_TYPE_ROLE.labelUppercase.size,
    lineHeight: LC_TYPE_ROLE.labelUppercase.lineHeight,
    fontWeight: weightToString(LC_TYPE_ROLE.labelUppercase.weight),
    letterSpacing: LC_TYPE_ROLE.labelUppercase.letterSpacing,
    fontFamily: getBodyFont(LC_TYPE_ROLE.labelUppercase.weight),
    textTransform: 'uppercase' as const,
  },

  /** Body - 16px, paragraph text */
  body: {
    fontSize: LC_TYPE_ROLE.body.size,
    lineHeight: LC_TYPE_ROLE.body.lineHeight,
    fontWeight: weightToString(LC_TYPE_ROLE.body.weight),
    letterSpacing: LC_TYPE_ROLE.body.letterSpacing,
    fontFamily: getBodyFont(LC_TYPE_ROLE.body.weight),
  },

  /** Small body - 14px, helper text */
  bodySmall: {
    fontSize: LC_TYPE_ROLE.bodySmall.size,
    lineHeight: LC_TYPE_ROLE.bodySmall.lineHeight,
    fontWeight: weightToString(LC_TYPE_ROLE.bodySmall.weight),
    letterSpacing: LC_TYPE_ROLE.bodySmall.letterSpacing,
    fontFamily: getBodyFont(LC_TYPE_ROLE.bodySmall.weight),
  },

  /** Caption - 12px, timestamps, hints */
  caption: {
    fontSize: LC_TYPE_ROLE.caption.size,
    lineHeight: LC_TYPE_ROLE.caption.lineHeight,
    fontWeight: weightToString(LC_TYPE_ROLE.caption.weight),
    letterSpacing: LC_TYPE_ROLE.caption.letterSpacing,
    fontFamily: getBodyFont(LC_TYPE_ROLE.caption.weight),
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Numeric roles - JetBrains Mono/monospace for tabular data
  // ─────────────────────────────────────────────────────────────────────────────

  /** Numeric - 16px, balances, odds */
  numeric: {
    fontSize: LC_TYPE_ROLE.numeric.size,
    lineHeight: LC_TYPE_ROLE.numeric.lineHeight,
    fontWeight: weightToString(LC_TYPE_ROLE.numeric.weight),
    letterSpacing: LC_TYPE_ROLE.numeric.letterSpacing,
    fontFamily: getMonoFont(),
    fontVariant: ['tabular-nums'] as const,
  },

  /** Large numeric - 32px, hero balances */
  numericLarge: {
    fontSize: LC_TYPE_ROLE.numericLarge.size,
    lineHeight: LC_TYPE_ROLE.numericLarge.lineHeight,
    fontWeight: weightToString(LC_TYPE_ROLE.numericLarge.weight),
    letterSpacing: LC_TYPE_ROLE.numericLarge.letterSpacing,
    fontFamily: getMonoFont(),
    fontVariant: ['tabular-nums'] as const,
  },

  /** Hero numeric - 48px, big wins, jackpots */
  numericHero: {
    fontSize: LC_TYPE_ROLE.numericHero.size,
    lineHeight: LC_TYPE_ROLE.numericHero.lineHeight,
    fontWeight: weightToString(LC_TYPE_ROLE.numericHero.weight),
    letterSpacing: LC_TYPE_ROLE.numericHero.letterSpacing,
    fontFamily: getMonoFont(),
    fontVariant: ['tabular-nums'] as const,
  },

  /** Small numeric - 14px, odds, multipliers */
  numericSmall: {
    fontSize: LC_TYPE_ROLE.numericSmall.size,
    lineHeight: LC_TYPE_ROLE.numericSmall.lineHeight,
    fontWeight: weightToString(LC_TYPE_ROLE.numericSmall.weight),
    letterSpacing: LC_TYPE_ROLE.numericSmall.letterSpacing,
    fontFamily: getMonoFont(),
    fontVariant: ['tabular-nums'] as const,
  },

  /** Code - 14px, technical identifiers */
  code: {
    fontSize: LC_TYPE_ROLE.code.size,
    lineHeight: LC_TYPE_ROLE.code.lineHeight,
    fontWeight: weightToString(LC_TYPE_ROLE.code.weight),
    letterSpacing: LC_TYPE_ROLE.code.letterSpacing,
    fontFamily: getMonoFont(),
  },
} as const;

/**
 * Re-export LC typography tokens for direct access
 */
export { TRACKING, FONT_FEATURES, LC_TYPE_ROLE, LC_TYPE_SEMANTIC, LC_GLASS_ADJUSTMENTS };

/**
 * Animation durations from design-tokens
 * Spring configs available via SPRING export
 */
export const ANIMATION = {
  fast: DURATION.fast,
  normal: DURATION.normal,
  slow: DURATION.slow,
  spring: SPRING.modal, // Default spring for UI elements
} as const;

// Re-export spring configs for components that need physics-based animations
export { SPRING, STAGGER, CHIP_VALUES };

/**
 * Liquid Crystal Motion Language (US-269)
 *
 * Motion should feel like liquid glass reacting to user interaction.
 * Specular highlights sweep across surfaces, refraction pulses on touch,
 * and edges glow subtly to create material depth.
 *
 * Key principle: Motion is subordinate to game state. Decorative motion
 * should never compete with win/loss animations.
 */
export const LC_MOTION = {
  // Motion tiers
  tier: MOTION_TIER,
  timing: MOTION_TIMING,
  priority: MOTION_PRIORITY,

  // Animation configurations
  sweep: LC_SWEEP,
  refract: LC_REFRACT,
  edge: LC_EDGE,
  entrance: LC_ENTRANCE,

  // Spring configs for Reanimated
  spring: LC_SPRING,

  // Game state rules
  gameRules: GAME_STATE_MOTION_RULES,

  // Easing curves (format: [x1, y1, x2, y2] for Reanimated)
  easing: {
    liquidSmooth: EASING_LUXURY.liquidSmooth,
    liquidElastic: EASING_LUXURY.liquidElastic,
    liquidSettle: EASING_LUXURY.liquidSettle,
    breathe: EASING_LUXURY.breathe,
    snapSettle: EASING_LUXURY.snapSettle,
  },
} as const;

// Re-export motion primitives for direct access
export { MOTION_TIER, MOTION_TIMING, MOTION_PRIORITY, SPRING_LIQUID, EASING_LUXURY };
export { LC_SWEEP, LC_REFRACT, LC_EDGE, LC_ENTRANCE, LC_SPRING, GAME_STATE_MOTION_RULES };

/**
 * Game accent colors - Monochrome redesign (US-262)
 *
 * All games use the same monochrome accent. Game identity
 * is established via patterns/textures (GAME_PATTERN), not color.
 */
export const GAME_COLORS = {
  hi_lo: MONO[300],
  blackjack: MONO[300],
  roulette: MONO[300],
  craps: MONO[300],
  baccarat: MONO[300],
  casino_war: MONO[300],
  video_poker: MONO[300],
  sic_bo: MONO[300],
  three_card_poker: MONO[300],
  ultimate_texas_holdem: MONO[300],
} as const;

/**
 * Game-specific detail colors - Monochrome redesign (US-262)
 *
 * Uses contrast levels instead of hue to differentiate game elements.
 */
export const GAME_DETAIL_COLORS = {
  roulette: {
    red: MONO[400],              // Distinguishable mid-gray
    black: MONO[0],              // Pure black
    green: MONO[600],            // Lighter gray
  },
  craps: {
    pass: MONO[0],               // Black
    dontPass: MONO[400],         // Mid-gray
    field: MONO[300],            // Dark gray
  },
} as const;

/**
 * Reusable style primitives for game screens
 * Consolidates ~175 LOC of duplication across 10 game screen stylesheets
 */

/**
 * Common game area layouts
 */
export const GAME_LAYOUT_STYLES = StyleSheet.create({
  /** Main game area container - flex 1, centered content */
  gameArea: {
    flex: 1,
    justifyContent: 'space-around',
    paddingHorizontal: SPACING_SEMANTIC.md,
  },
  /** Variant: centered content (for HiLo, VideoPoker) */
  gameAreaCentered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING_SEMANTIC.md,
  },
  /** Hand container for card games */
  handContainer: {
    alignItems: 'center',
  },
  /** Card wrapper with shadow - use for individual cards */
  cardWrapper: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  /** Cards row container */
  cards: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  /** Cards row with gap (for HiLo style layouts) */
  cardsWithGap: {
    flexDirection: 'row',
    gap: SPACING_SEMANTIC.lg,
    marginBottom: SPACING_SEMANTIC.lg,
  },
});

/**
 * Message styles - Monochrome redesign (US-262)
 *
 * Status text uses contrast and weight instead of color.
 * Win = high contrast (black/white), Loss = muted gray.
 */
export const MESSAGE_STYLES = StyleSheet.create({
  /** Base message style */
  message: {
    color: MONO[500],
    fontSize: 20,
    fontWeight: '600' as const,
    textAlign: 'center',
  },
  /** Win state - high contrast, bold */
  messageWin: {
    color: MONO[0],            // Black in light mode (inverted by theme)
    fontWeight: '700' as const,
  },
  /** Loss state - muted */
  messageLoss: {
    color: MONO[400],
    fontWeight: '400' as const,
  },
  /** Push/tie state - neutral */
  messagePush: {
    color: MONO[500],
  },
  /** Error state - high contrast */
  messageError: {
    color: MONO[0],
  },
  /** Blackjack/special win - bold emphasis */
  messageBlackjack: {
    color: MONO[0],
    fontWeight: '800' as const,
  },
  /** Tie (Baccarat style) */
  messageTie: {
    color: MONO[500],
  },
});

/**
 * Bet display styles - Monochrome redesign (US-262)
 */
export const BET_STYLES = StyleSheet.create({
  /** Container for bet amount display */
  betContainer: {
    alignItems: 'center',
  },
  /** "Bet" or "Total Bet" label */
  betLabel: {
    color: MONO[500],
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
  },
  /** Bet amount - high contrast */
  betAmount: {
    color: MONO[0],              // Black (or white in dark mode via theme)
    fontSize: 24,
    fontWeight: '600' as const,
  },
  /** Win amount display - bold emphasis */
  winAmount: {
    color: MONO[0],
    fontSize: 24,
    fontWeight: '700' as const,
    textAlign: 'center',
    marginBottom: SPACING_SEMANTIC.md,
  },
});

/**
 * Action button container styles
 */
export const ACTION_STYLES = StyleSheet.create({
  /** Row of action buttons */
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: SPACING_SEMANTIC.sm,
    paddingHorizontal: SPACING_SEMANTIC.md,
    marginBottom: SPACING_SEMANTIC.md,
  },
  /** Centered single action */
  actionsCentered: {
    alignItems: 'center',
    marginBottom: SPACING_SEMANTIC.md,
  },
});

/**
 * Drawer/modal styles - Monochrome redesign (US-262)
 */
export const DRAWER_STYLES = StyleSheet.create({
  /** Modal overlay with semi-transparent background */
  drawerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: `rgba(0, 0, 0, ${OPACITY_SEMANTIC.backdrop})`,
  },
  /** Drawer container */
  drawer: {
    backgroundColor: MONO[1000],             // Pure white
    borderTopLeftRadius: TOKEN_RADIUS['2xl'],
    borderTopRightRadius: TOKEN_RADIUS['2xl'],
    padding: SPACING_SEMANTIC.md,
    maxHeight: '80%',
  },
  /** Drawer header */
  drawerHeader: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING_SEMANTIC.md,
  },
  /** Drawer handle/close button */
  drawerHandle: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING_SEMANTIC.xs,
    paddingHorizontal: SPACING_SEMANTIC.md,
    borderRadius: TOKEN_RADIUS.full,
    borderWidth: 1,
    borderColor: MONO[700],                  // Light border
    backgroundColor: MONO[1000],
  },
  /** Drawer handle text */
  drawerHandleText: {
    color: MONO[500],
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
  },
  /** Section title in drawer */
  sectionTitle: {
    color: MONO[500],
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: SPACING_SEMANTIC.md,
    marginBottom: SPACING_SEMANTIC.sm,
  },
  /** Row of bet options */
  betRow: {
    flexDirection: 'row',
    gap: SPACING_SEMANTIC.sm,
  },
  /** Individual advanced bet button */
  advancedBet: {
    flex: 1,
    paddingVertical: SPACING_SEMANTIC.sm,
    backgroundColor: MONO[1000],
    borderRadius: TOKEN_RADIUS.lg,
    alignItems: 'center',
  },
  /** Advanced bet text */
  advancedBetText: {
    color: MONO[0],                          // Black text
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
});

/**
 * Hand label styles - Monochrome redesign (US-262)
 */
export const HAND_STYLES = StyleSheet.create({
  /** Hand label (e.g., "Dealer", "Player") */
  handLabel: {
    color: MONO[500],
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: SPACING_SEMANTIC.sm,
  },
  /** Hand total display */
  handTotal: {
    color: MONO[0],                          // Black (or white via theme)
    fontSize: 24,
    fontWeight: '600' as const,
  },
  /** Hand header row (label + total) */
  handHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING_SEMANTIC.md,
    marginBottom: SPACING_SEMANTIC.sm,
  },
});

/**
 * Common interactive element styles - Monochrome redesign (US-262)
 */
export const INTERACTIVE_STYLES = StyleSheet.create({
  /** Pressed state opacity */
  pressed: {
    opacity: 0.7,
  },
  /** Disabled state opacity */
  disabled: {
    opacity: 0.5,
  },
  /** "More bets" header button */
  moreBetsButton: {
    paddingVertical: SPACING_SEMANTIC.xs,
    paddingHorizontal: SPACING_SEMANTIC.sm,
    backgroundColor: MONO[1000],
    borderRadius: TOKEN_RADIUS.lg,
  },
  /** More bets button text */
  moreBetsText: {
    color: MONO[500],
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
  },
});

/**
 * Chip area styles
 */
export const CHIP_AREA_STYLES = StyleSheet.create({
  /** Container for chip selector + clear button */
  chipArea: {
    alignItems: 'center',
    paddingBottom: SPACING_SEMANTIC.lg,
  },
});

/**
 * Dark mode ambient glow effects - Monochrome redesign (US-262)
 *
 * All glows use white (#FFFFFF) for monochrome consistency.
 * Differentiation is via opacity and radius, not color.
 */
export const DARK_MODE_GLOW = {
  /** Primary action button glow - strong white */
  primary: {
    shadowColor: MONO[1000],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  /** Success action glow - medium white */
  success: {
    shadowColor: MONO[1000],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  /** Win/highlight glow - intense white */
  gold: {
    shadowColor: MONO[1000],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 8,
  },
  /** Error/destructive action glow - subtle white */
  error: {
    shadowColor: MONO[1000],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  /** Subtle glow for less important interactive elements */
  subtle: {
    shadowColor: MONO[1000],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
} as const;

/** Glow style type for shadow properties */
export type GlowStyle = (typeof DARK_MODE_GLOW)[keyof typeof DARK_MODE_GLOW];

/**
 * Get glow style for dark mode, or empty object for light mode
 * @param isDark - Whether dark mode is active
 * @param variant - Glow variant ('primary' | 'success' | 'gold' | 'error' | 'subtle')
 * @returns Shadow style object or empty object
 */
export function getGlowStyle(
  isDark: boolean,
  variant: keyof typeof DARK_MODE_GLOW = 'primary'
): GlowStyle | Record<string, never> {
  return isDark ? DARK_MODE_GLOW[variant] : {};
}

/**
 * Glassmorphism configuration constants
 *
 * Used by GlassView, GlassModal, and other glass-effect components.
 * Defines blur intensity levels and overlay opacities.
 */
export const GLASS = {
  /** Blur intensity values for expo-blur (0-100) */
  blur: {
    light: 15,
    medium: 20,
    heavy: 30,
  },
  /** Backdrop overlay opacity values */
  backdropOpacity: {
    light: 0.4,
    medium: 0.6,
    heavy: 0.75,
  },
  /** Inner border colors for glass cards */
  border: {
    light: 'rgba(255, 255, 255, 0.3)',
    dark: 'rgba(255, 255, 255, 0.1)',
  },
  /** Inner glow colors for elevated surfaces */
  innerGlow: {
    light: 'rgba(255, 255, 255, 0.3)',
    dark: 'rgba(255, 255, 255, 0.05)',
  },
} as const;

/** Type for glass blur intensity */
export type GlassBlurIntensity = keyof typeof GLASS.blur;
