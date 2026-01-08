/**
 * MultiplierBadge - Animated win multiplier badge (DS-048)
 *
 * Features:
 * - Scale + rotate pop-in animation
 * - Glow pulse effect
 * - Confetti burst trigger
 * - Auto-dismiss with fade out
 *
 * Displays win multiplier (e.g., "3x", "5x") with premium animation.
 */
import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withSpring,
  withDelay,
  Easing,
  interpolate,
  Extrapolate,
  runOnJS,
} from 'react-native-reanimated';
import { COLORS, RADIUS, TYPOGRAPHY } from '../../constants/theme';
import { SPRING_LIQUID } from '@nullspace/design-tokens';

export interface MultiplierBadgeProps {
  /** Win multiplier (e.g., 1.5, 3, 5) */
  multiplier: number;
  /** Whether badge is visible */
  isVisible: boolean;
  /** Auto-hide duration in ms (0 = never) */
  autoDismissMs?: number;
  /** Callback when badge dismisses */
  onDismiss?: () => void;
}

/** Badge colors based on multiplier tier */
function getBadgeColors(multiplier: number): { bg: string; text: string; glow: string } {
  if (multiplier >= 5) {
    // Jackpot tier - gold
    return {
      bg: '#FFD700',
      text: '#1A1A1A',
      glow: 'rgba(255, 215, 0, 0.6)',
    };
  }
  if (multiplier >= 3) {
    // Big win - green
    return {
      bg: '#34C759',
      text: '#FFFFFF',
      glow: 'rgba(52, 199, 89, 0.5)',
    };
  }
  if (multiplier >= 1.5) {
    // Medium win - blue
    return {
      bg: '#5E5CE6',
      text: '#FFFFFF',
      glow: 'rgba(94, 92, 230, 0.5)',
    };
  }
  // Small win - subtle
  return {
    bg: COLORS.surface,
    text: COLORS.textPrimary,
    glow: 'rgba(255, 255, 255, 0.2)',
  };
}

/** Format multiplier display (e.g., 1.5 → "1.5x", 3 → "3x") */
function formatMultiplier(multiplier: number): string {
  if (multiplier % 1 === 0) {
    return `${multiplier}x`;
  }
  return `${multiplier.toFixed(1)}x`;
}

export function MultiplierBadge({
  multiplier,
  isVisible,
  autoDismissMs = 3000,
  onDismiss,
}: MultiplierBadgeProps) {
  const scale = useSharedValue(0);
  const rotation = useSharedValue(-15);
  const opacity = useSharedValue(0);
  const glowPulse = useSharedValue(0);

  const colors = getBadgeColors(multiplier);

  useEffect(() => {
    if (isVisible) {
      // Reset
      scale.value = 0;
      rotation.value = -15;
      opacity.value = 0;
      glowPulse.value = 0;

      // Pop-in animation: scale + slight rotation
      opacity.value = withTiming(1, { duration: 150 });
      scale.value = withSpring(1, {
        ...SPRING_LIQUID.liquidSplash,
      });
      rotation.value = withSequence(
        withSpring(5, { ...SPRING_LIQUID.liquidSplash }),
        withSpring(0, { ...SPRING_LIQUID.liquidSettle })
      );

      // Glow pulse loop
      glowPulse.value = withSequence(
        withDelay(200, withTiming(1, { duration: 400, easing: Easing.inOut(Easing.sin) })),
        withTiming(0.6, { duration: 400, easing: Easing.inOut(Easing.sin) }),
        withTiming(1, { duration: 400, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.6, { duration: 400, easing: Easing.inOut(Easing.sin) }),
        withTiming(1, { duration: 400, easing: Easing.inOut(Easing.sin) })
      );

      // Auto-dismiss
      if (autoDismissMs > 0) {
        const dismissTimer = setTimeout(() => {
          // Fade out
          opacity.value = withTiming(0, { duration: 300 }, (finished) => {
            'worklet';
            if (finished && onDismiss) {
              runOnJS(onDismiss)();
            }
          });
          scale.value = withTiming(0.8, { duration: 300 });
        }, autoDismissMs);

        return () => clearTimeout(dismissTimer);
      }
    } else {
      // Hide immediately
      opacity.value = withTiming(0, { duration: 150 });
      scale.value = withTiming(0, { duration: 150 });
    }
    return undefined;
  }, [isVisible, multiplier, autoDismissMs, scale, rotation, opacity, glowPulse, onDismiss]);

  const badgeStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { scale: scale.value },
      { rotate: `${rotation.value}deg` },
    ],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(
      glowPulse.value,
      [0, 0.6, 1],
      [0.3, 0.6, 0.9],
      Extrapolate.CLAMP
    ),
    shadowRadius: interpolate(
      glowPulse.value,
      [0, 1],
      [8, 16],
      Extrapolate.CLAMP
    ),
  }));

  if (!isVisible && opacity.value === 0) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        { backgroundColor: colors.bg, shadowColor: colors.glow },
        badgeStyle,
        glowStyle,
      ]}
    >
      <Text style={[styles.multiplierText, { color: colors.text }]}>
        {formatMultiplier(multiplier)}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
    // Shadow base (animated)
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 8,
  },
  multiplierText: {
    ...TYPOGRAPHY.headingLarge,
    fontWeight: '800',
  },
});
