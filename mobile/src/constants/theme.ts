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
  glassLight: 'rgba(255, 255, 255, 0.08)',
  glassDark: 'rgba(0, 0, 0, 0.85)',
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
 * Mobile uses slightly larger values for touch targets
 */
export const RADIUS = {
  sm: TOKEN_RADIUS.md,  // 8px
  md: TOKEN_RADIUS.lg,  // 12px
  lg: 20,               // Mobile-specific
  xl: TOKEN_RADIUS['2xl'], // 24px
  full: TOKEN_RADIUS.full,
} as const;

/**
 * Typography definitions - synced with @nullspace/design-tokens
 *
 * Display variants use Outfit (display font) for visual impact
 * Body variants use Plus Jakarta Sans (body font) for readability
 *
 * Note: fontWeight is kept for React Native compatibility, but the actual
 * weight is determined by the loaded font variant (e.g., Outfit_700Bold)
 */
export const TYPOGRAPHY = {
  // Display variants - Outfit font for headlines and large text
  displayLarge: {
    fontSize: 48,
    fontWeight: '800' as const,
    letterSpacing: -1,
    fontFamily: FONT_DISPLAY.extrabold,
  },
  displayMedium: {
    fontSize: 36,
    fontWeight: '700' as const,
    letterSpacing: -0.5,
    fontFamily: FONT_DISPLAY.bold,
  },
  h1: {
    fontSize: 28,
    fontWeight: '700' as const,
    fontFamily: FONT_DISPLAY.bold,
  },
  h2: {
    fontSize: 24,
    fontWeight: '600' as const,
    fontFamily: FONT_DISPLAY.semibold,
  },
  h3: {
    fontSize: 20,
    fontWeight: '600' as const,
    fontFamily: FONT_DISPLAY.semibold,
  },
  // Body variants - Plus Jakarta Sans for readable text
  bodyLarge: {
    fontSize: 18,
    fontWeight: '500' as const,
    lineHeight: 28,
    fontFamily: FONT_BODY.medium,
  },
  body: {
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 24,
    fontFamily: FONT_BODY.regular,
  },
  label: {
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
    fontFamily: FONT_BODY.bold,
    textTransform: 'uppercase' as const,
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
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
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
