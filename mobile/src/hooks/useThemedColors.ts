/**
 * Hook for accessing theme-aware colors
 * Provides colors that automatically update based on current color scheme
 */
import { useMemo } from 'react';
import { useTheme } from '../context/ThemeContext';
import { getColors, getGlowStyle, DARK_MODE_GLOW, type ThemedColors, type GlowStyle } from '../constants/theme';

/**
 * Hook that returns the current color palette based on active color scheme
 *
 * Usage:
 * ```tsx
 * function MyComponent() {
 *   const colors = useThemedColors();
 *   return <View style={{ backgroundColor: colors.background }} />;
 * }
 * ```
 */
export function useThemedColors(): ThemedColors {
  const { colorScheme } = useTheme();
  return useMemo(() => getColors(colorScheme), [colorScheme]);
}

/**
 * Hook that returns glow style for dark mode
 *
 * Usage:
 * ```tsx
 * function PrimaryButton() {
 *   const glow = useGlow('primary');
 *   return <TouchableOpacity style={[styles.button, glow]} />;
 * }
 * ```
 */
export function useGlow(
  variant: keyof typeof DARK_MODE_GLOW = 'primary'
): GlowStyle | Record<string, never> {
  const { isDark } = useTheme();
  return useMemo(() => getGlowStyle(isDark, variant), [isDark, variant]);
}
