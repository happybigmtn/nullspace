/**
 * FeltBackground - Casino table felt texture with woven pattern
 *
 * US-135: Table felt texture backgrounds per game
 *
 * Features:
 * - Woven texture pattern simulating casino table felt
 * - Game-specific colors from design-tokens
 * - Scanline overlay for CRT retro aesthetic
 * - Subtle gradient shift animation (30-60s cycle)
 * - Connection state affects scanline intensity
 */
import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { GAME, type GameId } from '@nullspace/design-tokens';

/**
 * Number of rows for woven texture pattern
 * More rows = finer texture, but more render cost
 */
const TEXTURE_ROWS = 40;
const TEXTURE_COLS = 30;

/**
 * Number of scanline rows for CRT effect
 */
const SCANLINE_ROWS = 80;

/**
 * Pre-computed arrays for rendering
 */
const textureRowsArray = Array.from({ length: TEXTURE_ROWS }, (_, i) => i);
const textureColsArray = Array.from({ length: TEXTURE_COLS }, (_, i) => i);
const scanlineRowsArray = Array.from({ length: SCANLINE_ROWS }, (_, i) => i);

interface FeltBackgroundProps {
  /** Game ID for color scheme */
  gameId: GameId;
  /** Whether the connection is active (affects scanline intensity) */
  isConnected?: boolean;
  /** Whether gradient shift animation is enabled */
  animateGradient?: boolean;
}

/**
 * Individual woven texture cell
 * Alternates horizontal/vertical lines for woven appearance
 */
const TextureCell = React.memo(function TextureCell({
  row,
  col,
  accentColor,
}: {
  row: number;
  col: number;
  accentColor: string;
}) {
  // Checkerboard pattern for woven effect
  const isEven = (row + col) % 2 === 0;

  return (
    <View
      style={[
        styles.textureCell,
        isEven ? styles.textureCellHorizontal : styles.textureCellVertical,
        { borderColor: accentColor },
      ]}
    />
  );
});

/**
 * Woven texture overlay
 */
const WovenTexture = React.memo(function WovenTexture({
  accentColor,
}: {
  accentColor: string;
}) {
  return (
    <View style={styles.textureContainer} pointerEvents="none">
      {textureRowsArray.map((row) => (
        <View key={row} style={styles.textureRow}>
          {textureColsArray.map((col) => (
            <TextureCell
              key={col}
              row={row}
              col={col}
              accentColor={accentColor}
            />
          ))}
        </View>
      ))}
    </View>
  );
});

/**
 * Scanline overlay for CRT retro effect
 */
const ScanlineOverlay = React.memo(function ScanlineOverlay({
  intensity,
}: {
  intensity: number;
}) {
  return (
    <View style={[styles.scanlineOverlay, { opacity: intensity }]} pointerEvents="none">
      {scanlineRowsArray.map((row) => (
        <View key={row} style={styles.scanline} />
      ))}
    </View>
  );
});

/**
 * Animated gradient overlay for subtle color shift
 */
function GradientShiftOverlay({
  primaryColor,
  accentColor,
}: {
  primaryColor: string;
  accentColor: string;
}) {
  const animatedValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // 45-second cycle for subtle gradient shift
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: 1,
          duration: 22500, // 22.5s to peak
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(animatedValue, {
          toValue: 0,
          duration: 22500, // 22.5s back
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [animatedValue]);

  const opacity = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.02, 0.08],
  });

  return (
    <Animated.View
      style={[
        styles.gradientOverlay,
        {
          backgroundColor: accentColor,
          opacity,
        },
      ]}
      pointerEvents="none"
    />
  );
}

/**
 * FeltBackground - Main component
 */
export function FeltBackground({
  gameId,
  isConnected = true,
  animateGradient = true,
}: FeltBackgroundProps) {
  const gameColors = GAME[gameId];
  const { primary: primaryColor, accent: accentColor } = gameColors;

  // Scanline intensity varies with connection state
  // Connected: subtle (0.08), Disconnected: more visible (0.15)
  const scanlineIntensity = isConnected ? 0.08 : 0.15;

  return (
    <View style={[styles.container, { backgroundColor: primaryColor }]}>
      {/* Base woven texture */}
      <WovenTexture accentColor={accentColor} />

      {/* Animated gradient shift (optional) */}
      {animateGradient && (
        <GradientShiftOverlay
          primaryColor={primaryColor}
          accentColor={accentColor}
        />
      )}

      {/* Scanline CRT effect */}
      <ScanlineOverlay intensity={scanlineIntensity} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },

  // Woven texture styles
  textureContainer: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'column',
    justifyContent: 'space-evenly',
    opacity: 0.06,
  },
  textureRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    height: '2.5%', // 100/40 rows
  },
  textureCell: {
    width: '3.33%', // 100/30 cols
    height: '100%',
    borderWidth: 0.5,
  },
  textureCellHorizontal: {
    borderTopWidth: 1,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
  },
  textureCellVertical: {
    borderTopWidth: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 1,
    borderRightWidth: 0,
  },

  // Scanline styles
  scanlineOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  scanline: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },

  // Gradient shift overlay
  gradientOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
});
