/**
 * Glass morphism container component
 *
 * Provides frosted glass aesthetic using expo-blur BlurView with:
 * - Platform blur (60% opacity background + 20px blur intensity)
 * - Subtle inner glow on elevated surfaces
 * - Theme-aware tint (light/dark mode optimized)
 *
 * Performance: expo-blur uses native UIVisualEffectView (iOS) and
 * RenderScript (Android). Low-end devices fall back to semi-transparent overlay.
 *
 * @example
 * ```tsx
 * <GlassView intensity="medium" withGlow>
 *   <Text>Content on frosted glass</Text>
 * </GlassView>
 * ```
 */
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { BlurView, BlurTint } from 'expo-blur';
import { ReactNode } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { RADIUS } from '../../constants/theme';

/** Blur intensity presets */
export type GlassIntensity = 'light' | 'medium' | 'heavy';

/** Glass tint mode - auto follows theme, or force light/dark */
export type GlassTint = 'auto' | 'light' | 'dark';

interface GlassViewProps {
  children: ReactNode;
  /** Blur intensity level (default: medium) */
  intensity?: GlassIntensity;
  /** Tint mode - auto follows system theme (default: auto) */
  tint?: GlassTint;
  /** Add subtle inner glow for depth perception */
  withGlow?: boolean;
  /** Custom container style */
  style?: StyleProp<ViewStyle>;
  /** Border radius (default: RADIUS['2xl'] for glass-morphism) */
  borderRadius?: number;
  /** Test ID for testing */
  testID?: string;
}

/** Map intensity names to expo-blur intensity values */
const INTENSITY_MAP: Record<GlassIntensity, number> = {
  light: 15,
  medium: 20,
  heavy: 30,
};

/** Opacity values for the overlay tint */
const OPACITY_MAP: Record<GlassIntensity, number> = {
  light: 0.4,
  medium: 0.6,
  heavy: 0.75,
};

/**
 * GlassView - Frosted glass container component
 *
 * Creates a premium glassmorphism effect with native blur.
 * Automatically adapts to light/dark theme for optimal contrast.
 */
export function GlassView({
  children,
  intensity = 'medium',
  tint = 'auto',
  withGlow = false,
  style,
  borderRadius = RADIUS['2xl'],
  testID,
}: GlassViewProps) {
  const { isDark } = useTheme();

  // Determine blur tint based on mode
  const blurTint: BlurTint =
    tint === 'auto' ? (isDark ? 'dark' : 'light') : tint;

  // Get intensity value
  const blurIntensity = INTENSITY_MAP[intensity];

  // Inner glow color based on theme
  const glowColor = isDark
    ? 'rgba(255, 255, 255, 0.08)'
    : 'rgba(255, 255, 255, 0.5)';

  // Border color for depth
  const borderColor = isDark
    ? 'rgba(255, 255, 255, 0.1)'
    : 'rgba(255, 255, 255, 0.3)';

  return (
    <View
      style={[
        styles.container,
        { borderRadius },
        withGlow && isDark && styles.glowDark,
        withGlow && !isDark && styles.glowLight,
        style,
      ]}
      testID={testID}
    >
      <BlurView
        intensity={blurIntensity}
        tint={blurTint}
        style={[styles.blur, { borderRadius }]}
      />
      {/* Inner border for depth perception */}
      <View
        style={[
          styles.innerBorder,
          { borderRadius, borderColor },
        ]}
        pointerEvents="none"
      />
      {/* Inner glow highlight (top edge) */}
      {withGlow && (
        <View
          style={[
            styles.innerGlow,
            { borderRadius, backgroundColor: glowColor },
          ]}
          pointerEvents="none"
        />
      )}
      {/* Content */}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    position: 'relative',
  },
  blur: {
    ...StyleSheet.absoluteFillObject,
  },
  innerBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
  },
  innerGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  content: {
    position: 'relative',
    zIndex: 1,
  },
  glowDark: {
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  glowLight: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
});

/**
 * GlassOverlay - Full screen frosted overlay
 *
 * Used behind modals and sheets for glassmorphism backdrop.
 * Combines blur with semi-transparent tint for depth.
 */
interface GlassOverlayProps {
  /** Overlay opacity (0-1, default: 0.6) */
  opacity?: number;
  /** Blur intensity (default: medium) */
  intensity?: GlassIntensity;
  /** Custom style */
  style?: StyleProp<ViewStyle>;
  /** Test ID */
  testID?: string;
}

export function GlassOverlay({
  opacity = 0.6,
  intensity = 'medium',
  style,
  testID,
}: GlassOverlayProps) {
  const { isDark } = useTheme();

  const blurIntensity = INTENSITY_MAP[intensity];
  const overlayColor = isDark
    ? `rgba(0, 0, 0, ${opacity})`
    : `rgba(0, 0, 0, ${opacity * 0.8})`;

  return (
    <View style={[overlayStyles.container, style]} testID={testID}>
      <BlurView
        intensity={blurIntensity}
        tint={isDark ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: overlayColor }]}
      />
    </View>
  );
}

const overlayStyles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
});
