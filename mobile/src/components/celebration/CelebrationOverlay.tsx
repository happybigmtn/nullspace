/**
 * CelebrationOverlay - Orchestrates all win celebration effects (DS-048)
 *
 * Combines:
 * - Gold particles (multiple shapes, colors, firework patterns)
 * - Screen shake for jackpots
 * - Multiplier badge animation
 * - Haptic feedback
 */
import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { GoldParticles, ColorVariant } from './GoldParticles';
import { MultiplierBadge } from './MultiplierBadge';
import { useScreenShake } from '../../hooks/useScreenShake';
import type { CelebrationState } from '../../hooks/useCelebration';

interface CelebrationOverlayProps {
  /** Current celebration state */
  state: CelebrationState;
  /** Color variant for particles */
  colorVariant?: ColorVariant;
  /** Game ID for game-themed colors */
  gameId?: string;
  /** Show multiplier badge */
  showMultiplier?: boolean;
  /** Win multiplier for badge (defaults to calculated from state) */
  multiplier?: number;
  /** Bet amount for multiplier calculation */
  betAmount?: number;
  /** Enable screen shake for big wins */
  enableScreenShake?: boolean;
  /** Optional callback when celebration ends */
  onComplete?: () => void;
}

/**
 * Overlay that renders all celebration effects
 * Place this at the top level of game layouts
 */
export function CelebrationOverlay({
  state,
  colorVariant = 'gold',
  gameId,
  showMultiplier = true,
  multiplier,
  betAmount = 1,
  enableScreenShake = true,
  onComplete,
}: CelebrationOverlayProps) {
  const [badgeVisible, setBadgeVisible] = useState(false);
  const { shake, shakeStyle } = useScreenShake();

  // Calculate multiplier if not provided
  const displayMultiplier = multiplier ?? (betAmount > 0 ? state.winAmount / betAmount : 1);

  // Trigger effects when celebration starts
  useEffect(() => {
    if (state.isActive) {
      // Show multiplier badge
      if (showMultiplier && displayMultiplier > 1) {
        setBadgeVisible(true);
      }

      // Screen shake for big/jackpot wins
      if (enableScreenShake && (state.intensity === 'jackpot' || state.intensity === 'big')) {
        shake({
          intensity: state.intensity === 'jackpot' ? 'heavy' : 'medium',
          withHaptic: false, // Haptic handled by useCelebration
        });
      }
    }
  }, [state.isActive, state.intensity, enableScreenShake, showMultiplier, displayMultiplier, shake]);

  const handleBadgeDismiss = useCallback(() => {
    setBadgeVisible(false);
  }, []);

  return (
    <Animated.View style={[styles.container, shakeStyle]} pointerEvents="box-none">
      {/* Particle effects */}
      <GoldParticles
        isActive={state.isActive}
        intensity={state.intensity}
        colorVariant={colorVariant}
        gameId={gameId}
        fireworkBurst={state.intensity === 'jackpot' || state.intensity === 'big'}
        onComplete={onComplete}
      />

      {/* Multiplier badge (centered) */}
      {showMultiplier && displayMultiplier > 1 && (
        <View style={styles.badgeContainer} pointerEvents="none">
          <MultiplierBadge
            multiplier={displayMultiplier}
            isVisible={badgeVisible}
            autoDismissMs={state.intensity === 'jackpot' ? 4000 : 3000}
            onDismiss={handleBadgeDismiss}
          />
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  badgeContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 60, // Slightly above center
  },
});
