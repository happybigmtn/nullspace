/**
 * useScreenShake - Hook for screen shake effect on jackpot wins (DS-048)
 *
 * Creates subtle screen shake animation using Reanimated
 * for dramatic jackpot celebration moments.
 */
import { useCallback } from 'react';
import {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { haptics } from '../services/haptics';

export type ShakeIntensity = 'light' | 'medium' | 'heavy';

interface ShakeConfig {
  /** Shake intensity */
  intensity?: ShakeIntensity;
  /** Duration of full shake effect in ms */
  duration?: number;
  /** Enable haptic feedback */
  withHaptic?: boolean;
}

/** Shake amplitude by intensity (pixels) */
const SHAKE_AMPLITUDE: Record<ShakeIntensity, number> = {
  light: 3,
  medium: 6,
  heavy: 10,
};

/** Number of shake cycles by intensity */
const SHAKE_CYCLES: Record<ShakeIntensity, number> = {
  light: 3,
  medium: 5,
  heavy: 8,
};

/**
 * Hook for screen shake animation
 */
export function useScreenShake() {
  const shakeX = useSharedValue(0);
  const shakeY = useSharedValue(0);

  /**
   * Trigger screen shake animation
   */
  const shake = useCallback(
    (config: ShakeConfig = {}) => {
      const {
        intensity = 'medium',
        duration = 600,
        withHaptic = true,
      } = config;

      const amplitude = SHAKE_AMPLITUDE[intensity];
      const cycles = SHAKE_CYCLES[intensity];
      const cycleTime = duration / cycles;

      // Build shake sequence with decreasing amplitude
      const buildShakeSequence = (axis: 'x' | 'y') => {
        const sequence: ReturnType<typeof withTiming>[] = [];
        const phaseOffset = axis === 'y' ? cycleTime / 4 : 0; // Y slightly out of phase

        for (let i = 0; i < cycles; i++) {
          const decayFactor = 1 - (i / cycles) * 0.7; // Amplitude decays to 30%
          const currentAmplitude = amplitude * decayFactor;

          // Random direction with slight bias toward returning to center
          const direction = i % 2 === 0 ? 1 : -1;

          sequence.push(
            withTiming(currentAmplitude * direction, {
              duration: cycleTime / 2,
              easing: Easing.out(Easing.sin),
            })
          );
          sequence.push(
            withTiming(-currentAmplitude * direction * 0.8, {
              duration: cycleTime / 2,
              easing: Easing.inOut(Easing.sin),
            })
          );
        }

        // Final settle to 0
        sequence.push(
          withTiming(0, {
            duration: cycleTime / 2,
            easing: Easing.out(Easing.quad),
          })
        );

        return axis === 'y'
          ? withDelay(phaseOffset, withSequence(...sequence))
          : withSequence(...sequence);
      };

      // Trigger animations (type assertion needed due to Reanimated type inference)
      (shakeX.value as number) = buildShakeSequence('x') as number;
      (shakeY.value as number) = buildShakeSequence('y') as number;

      // Haptic feedback
      if (withHaptic) {
        haptics.bigWin().catch(() => {});
      }
    },
    [shakeX, shakeY]
  );

  /**
   * Animated style to apply to root container
   */
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: shakeX.value },
      { translateY: shakeY.value },
    ],
  }));

  return {
    shake,
    shakeStyle,
    shakeX,
    shakeY,
  };
}
