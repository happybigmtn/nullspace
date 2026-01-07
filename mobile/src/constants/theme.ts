/**
 * Jony Ive-inspired design system constants
 * Principles: Radical Simplicity, Progressive Disclosure, Clarity, Tactile Response
 *
 * Imports raw tokens from @nullspace/design-tokens and applies platform-specific transforms
 */

import { Platform, StyleSheet } from 'react-native';
import { CHIP_VALUES } from '@nullspace/constants/chips';
import {
  TITANIUM,
  ACTION,
  SPACING_SEMANTIC,
  RADIUS as TOKEN_RADIUS,
  DURATION,
  SPRING,
  GAME,
  FONTS,
  OPACITY,
  OPACITY_SEMANTIC,
  SHADOW,
  ELEVATION,
  GLOW,
  TYPE_SCALE,
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
 * Light color palette derived from design-tokens
 * Maps semantic names to platform-appropriate values
 */
export const LIGHT_COLORS = {
  // Titanium Palette (from design-tokens)
  background: TITANIUM[100],
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  border: TITANIUM[200],

  // Action Colors (from design-tokens)
  primary: ACTION.indigo,
  primaryDark: ACTION.indigoHover,
  success: ACTION.success,
  warning: ACTION.warning,
  error: ACTION.error,
  destructive: ACTION.error,
  gold: '#FFCC00', // Not in design-tokens yet

  // Text hierarchy (derived from titanium scale)
  textPrimary: TITANIUM[900],
  textSecondary: TITANIUM[500],
  textMuted: TITANIUM[400], // WCAG AA compliant on white
  textDisabled: TITANIUM[300],

  // Card suits
  suitRed: ACTION.error,
  suitBlack: TITANIUM[900],

  // Glass (platform-specific - not in tokens)
  glassLight: 'rgba(255, 255, 255, 0.75)',
  glassDark: 'rgba(28, 28, 30, 0.8)',
} as const;

/**
 * OLED-optimized dark color palette
 * Uses pure black (#000000) for maximum AMOLED battery savings
 * Inverts the titanium scale for text/surface contrast
 */
export const DARK_COLORS = {
  // OLED-optimized backgrounds - pure black saves battery
  background: '#000000',
  surface: TITANIUM[900], // Elevated surfaces use dark gray
  surfaceElevated: TITANIUM[800], // Higher elevation = lighter
  border: TITANIUM[700],

  // Action Colors - same as light (brand colors)
  primary: ACTION.indigo,
  primaryDark: ACTION.indigoHover,
  success: ACTION.success,
  warning: ACTION.warning,
  error: ACTION.error,
  destructive: ACTION.error,
  gold: '#FFCC00',

  // Text hierarchy - inverted from light mode
  textPrimary: TITANIUM[50], // Near-white for maximum contrast
  textSecondary: TITANIUM[400],
  textMuted: TITANIUM[500], // WCAG AA compliant on dark
  textDisabled: TITANIUM[600],

  // Card suits - adjusted for dark backgrounds
  suitRed: '#FF6B6B', // Slightly brighter red for dark mode
  suitBlack: TITANIUM[200], // Light for visibility on dark

  // Glass - darker, higher contrast glass effect
  glassLight: `rgba(255, 255, 255, ${OPACITY.xs})`,
  glassDark: `rgba(0, 0, 0, ${OPACITY_SEMANTIC.tutorial})`,
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
 * Glow effects for focus/highlight states from design tokens
 * Used for focus rings, win animations, and interactive highlights
 */
export const GLOW_STYLES = {
  /** Brand indigo glow - focused states */
  indigo: {
    shadowColor: GLOW.indigo.color,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: GLOW.indigo.blur,
    shadowOpacity: GLOW.indigo.opacity,
    elevation: 6,
  },
  /** Success/win glow */
  success: {
    shadowColor: GLOW.success.color,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: GLOW.success.blur,
    shadowOpacity: GLOW.success.opacity,
    elevation: 6,
  },
  /** Error/loss glow */
  error: {
    shadowColor: GLOW.error.color,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: GLOW.error.blur,
    shadowOpacity: GLOW.error.opacity,
    elevation: 6,
  },
  /** Gold/jackpot glow */
  gold: {
    shadowColor: GLOW.gold.color,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: GLOW.gold.blur,
    shadowOpacity: GLOW.gold.opacity,
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
export { SPRING, CHIP_VALUES };

export const GAME_COLORS = {
  hi_lo: GAME.hiLo.accent,
  blackjack: GAME.blackjack.accent,
  roulette: GAME.roulette.accent,
  craps: GAME.craps.accent,
  baccarat: GAME.baccarat.accent,
  casino_war: GAME.casinoWar.accent,
  video_poker: GAME.videoPoker.accent,
  sic_bo: GAME.sicBo.accent,
  three_card_poker: GAME.threeCard.accent,
  ultimate_texas_holdem: GAME.ultimateHoldem.accent,
} as const;

export const GAME_DETAIL_COLORS = {
  roulette: {
    red: ACTION.error,
    black: TITANIUM[900],
    green: ACTION.success,
  },
  craps: {
    pass: ACTION.success,
    dontPass: ACTION.error,
    field: '#FFCC00',
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
 * Message styles - status text shown during gameplay
 */
export const MESSAGE_STYLES = StyleSheet.create({
  /** Base message style */
  message: {
    color: TITANIUM[500],
    fontSize: 20,
    fontWeight: '600' as const,
    textAlign: 'center',
  },
  /** Win state */
  messageWin: {
    color: ACTION.success,
  },
  /** Loss state */
  messageLoss: {
    color: ACTION.error,
  },
  /** Push/tie state */
  messagePush: {
    color: ACTION.warning,
  },
  /** Error state */
  messageError: {
    color: ACTION.error,
  },
  /** Blackjack/special win */
  messageBlackjack: {
    color: '#FFCC00',
  },
  /** Tie (Baccarat style) */
  messageTie: {
    color: '#FFCC00',
  },
});

/**
 * Bet display styles
 */
export const BET_STYLES = StyleSheet.create({
  /** Container for bet amount display */
  betContainer: {
    alignItems: 'center',
  },
  /** "Bet" or "Total Bet" label */
  betLabel: {
    color: TITANIUM[400],
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
  },
  /** Bet amount in gold */
  betAmount: {
    color: '#FFCC00',
    fontSize: 24,
    fontWeight: '600' as const,
  },
  /** Win amount display */
  winAmount: {
    color: ACTION.success,
    fontSize: 24,
    fontWeight: '600' as const,
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
 * Drawer/modal styles - for advanced bet panels
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
    backgroundColor: '#FFFFFF',
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
    borderColor: TITANIUM[200],
    backgroundColor: '#FFFFFF',
  },
  /** Drawer handle text */
  drawerHandleText: {
    color: TITANIUM[500],
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
  },
  /** Section title in drawer */
  sectionTitle: {
    color: TITANIUM[500],
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
    backgroundColor: '#FFFFFF',
    borderRadius: TOKEN_RADIUS.lg,
    alignItems: 'center',
  },
  /** Advanced bet text */
  advancedBetText: {
    color: TITANIUM[900],
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
});

/**
 * Hand label styles - for card games (Blackjack, Baccarat)
 */
export const HAND_STYLES = StyleSheet.create({
  /** Hand label (e.g., "Dealer", "Player") */
  handLabel: {
    color: TITANIUM[500],
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: SPACING_SEMANTIC.sm,
  },
  /** Hand total display */
  handTotal: {
    color: TITANIUM[900],
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
 * Common interactive element styles
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
    backgroundColor: '#FFFFFF',
    borderRadius: TOKEN_RADIUS.lg,
  },
  /** More bets button text */
  moreBetsText: {
    color: TITANIUM[500],
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
 * Dark mode ambient glow effects
 * Applied to primary action buttons in dark mode for visual emphasis
 * Uses box-shadow to create a soft halo around interactive elements
 */
export const DARK_MODE_GLOW = {
  /** Primary action button glow (indigo) */
  primary: {
    shadowColor: ACTION.indigo,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 8,
  },
  /** Success action glow (green) */
  success: {
    shadowColor: ACTION.success,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
  /** Gold/highlight glow (for wins, special states) */
  gold: {
    shadowColor: '#FFCC00',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 8,
  },
  /** Error/destructive action glow */
  error: {
    shadowColor: ACTION.error,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  /** Subtle glow for less important interactive elements */
  subtle: {
    shadowColor: '#FFFFFF',
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
