/**
 * Jony Ive-inspired design system constants
 * Principles: Radical Simplicity, Progressive Disclosure, Clarity, Tactile Response
 *
 * Imports raw tokens from @nullspace/design-tokens and applies platform-specific transforms
 */

import { Platform } from 'react-native';
import {
  TITANIUM,
  ACTION,
  SPACING_SEMANTIC,
  RADIUS as TOKEN_RADIUS,
  DURATION,
  SPRING,
} from '@nullspace/design-tokens';

const FONT_FAMILY = Platform.select({
  ios: 'System',
  android: 'sans-serif-medium',
  default: 'System',
});

const MONO_FONT = Platform.select({
  ios: 'Courier',
  android: 'monospace',
  default: 'monospace',
});

/**
 * Color palette derived from design-tokens
 * Maps semantic names to platform-appropriate values
 */
export const COLORS = {
  // Titanium Palette (from design-tokens)
  background: TITANIUM[100],
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  border: TITANIUM[200],

  // Action Colors (from design-tokens)
  primary: ACTION.indigo,
  primaryDark: ACTION.indigoHover,
  success: ACTION.success,
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
 * Typography definitions
 * Platform-specific (fonts differ between iOS/Android)
 */
export const TYPOGRAPHY = {
  displayLarge: {
    fontSize: 48,
    fontWeight: '800' as const,
    letterSpacing: -1,
    fontFamily: FONT_FAMILY,
    color: COLORS.textPrimary,
  },
  displayMedium: {
    fontSize: 36,
    fontWeight: '700' as const,
    letterSpacing: -0.5,
    fontFamily: FONT_FAMILY,
    color: COLORS.textPrimary,
  },
  h1: {
    fontSize: 28,
    fontWeight: '700' as const,
    fontFamily: FONT_FAMILY,
    color: COLORS.textPrimary,
  },
  h2: {
    fontSize: 24,
    fontWeight: '600' as const,
    fontFamily: FONT_FAMILY,
    color: COLORS.textPrimary,
  },
  h3: {
    fontSize: 20,
    fontWeight: '600' as const,
    fontFamily: FONT_FAMILY,
    color: COLORS.textPrimary,
  },
  bodyLarge: {
    fontSize: 18,
    fontWeight: '500' as const,
    lineHeight: 28,
    fontFamily: FONT_FAMILY,
    color: COLORS.textPrimary,
  },
  body: {
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 24,
    fontFamily: FONT_FAMILY,
    color: COLORS.textSecondary,
  },
  label: {
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
    fontFamily: FONT_FAMILY,
    textTransform: 'uppercase' as const,
    color: COLORS.textMuted,
  },
  mono: {
    fontFamily: MONO_FONT,
    fontSize: 12,
  },
  // Additional variants used by game screens
  bodySmall: {
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
    fontFamily: FONT_FAMILY,
    color: COLORS.textSecondary,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
    fontFamily: FONT_FAMILY,
    color: COLORS.textMuted,
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
export { SPRING };

// TODO: CHIP_VALUES duplicates @nullspace/constants/chips
// Consider migrating to: import { CHIP_VALUES, type ChipValue } from '@nullspace/constants';
export const CHIP_VALUES = [1, 5, 25, 100, 500, 1000] as const;

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
