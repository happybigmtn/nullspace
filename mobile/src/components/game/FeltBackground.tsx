/**
 * FeltBackground - Casino table felt texture with monochrome pattern
 *
 * US-135: Table felt texture backgrounds per game
 * US-263: Monochrome game differentiation via geometric patterns
 *
 * Features:
 * - Game-specific geometric patterns (stripes, dots, grids, etc.)
 * - Monochrome design using MONO color scale
 * - Scanline overlay for CRT retro aesthetic
 * - Subtle animation effects
 * - Connection state affects scanline intensity
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { MONO, type GamePatternId } from '@nullspace/design-tokens';
import { GamePattern } from './GamePattern';

/**
 * Number of scanline rows for CRT effect
 */
const SCANLINE_ROWS = 80;

/**
 * Pre-computed array for scanline rendering
 */
const scanlineRowsArray = Array.from({ length: SCANLINE_ROWS }, (_, i) => i);

interface FeltBackgroundProps {
  /** Game ID for pattern selection (US-263) */
  gameId: GamePatternId;
  /** Whether the connection is active (affects scanline intensity) */
  isConnected?: boolean;
  /** Whether gradient shift animation is enabled (ignored in monochrome) */
  animateGradient?: boolean;
}

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
 * FeltBackground - Main component
 *
 * US-263: Uses monochrome geometric patterns for game differentiation
 */
export function FeltBackground({
  gameId,
  isConnected = true,
}: FeltBackgroundProps) {
  // Scanline intensity varies with connection state
  // Connected: subtle (0.08), Disconnected: more visible (0.15)
  const scanlineIntensity = isConnected ? 0.08 : 0.15;

  return (
    <View style={[styles.container, { backgroundColor: MONO[0] }]}>
      {/* Game-specific geometric pattern (US-263) */}
      <GamePattern gameId={gameId} />

      {/* Scanline CRT effect */}
      <ScanlineOverlay intensity={scanlineIntensity} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
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
});
