/**
 * AmbientParticles - Subtle floating dust motes for atmosphere (DS-049)
 *
 * Features:
 * - Slow drifting particles (8-15s cycle)
 * - Random size, opacity, speed variation
 * - Very subtle - ambient not distracting
 * - Pauses when app backgrounded
 * - Respects reduce motion accessibility setting
 *
 * Like dust in sunlight - creates atmosphere without drawing attention.
 */
import React, { useMemo, useEffect } from 'react';
import { View, StyleSheet, Dimensions, AppState, AppStateStatus } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ParticleConfig {
  id: number;
  /** X position as percentage (0-1) */
  x: number;
  /** Y position as percentage (0-1) */
  y: number;
  /** Particle size in pixels */
  size: number;
  /** Base opacity (0-1) */
  opacity: number;
  /** Animation duration in ms */
  duration: number;
  /** Animation delay in ms */
  delay: number;
  /** X drift amount in pixels */
  xDrift: number;
  /** Y travel distance in pixels */
  yTravel: number;
}

interface AmbientParticlesProps {
  /** Number of particles (default: 12) */
  count?: number;
  /** Color of particles */
  color?: string;
  /** Enable/disable the effect */
  enabled?: boolean;
}

/**
 * Generate random particles with varied properties
 */
function generateParticles(count: number): ParticleConfig[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random(),
    y: Math.random(),
    size: 2 + Math.random() * 3, // 2-5px
    opacity: 0.1 + Math.random() * 0.15, // 0.1-0.25 (very subtle)
    duration: (8 + Math.random() * 7) * 1000, // 8-15s in ms
    delay: Math.random() * 5000, // 0-5s stagger in ms
    xDrift: (Math.random() - 0.5) * 30, // -15 to +15px horizontal drift
    yTravel: 15 + Math.random() * 10, // 15-25px vertical travel
  }));
}

/**
 * Individual floating particle with Reanimated
 */
function FloatingParticle({
  config,
  color,
  isPaused,
}: {
  config: ParticleConfig;
  color: string;
  isPaused: boolean;
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  useEffect(() => {
    if (isPaused) {
      // Don't cancel - just let existing animation continue
      // (we don't want sudden jumps when resuming)
      return;
    }

    // Sinusoidal float animation
    translateY.value = withDelay(
      config.delay,
      withRepeat(
        withSequence(
          withTiming(-config.yTravel, {
            duration: config.duration / 2,
            easing: Easing.inOut(Easing.sin),
          }),
          withTiming(0, {
            duration: config.duration / 2,
            easing: Easing.inOut(Easing.sin),
          })
        ),
        -1, // Infinite repeat
        false // No reverse (we handle it in the sequence)
      )
    );

    translateX.value = withDelay(
      config.delay,
      withRepeat(
        withSequence(
          withTiming(config.xDrift, {
            duration: config.duration / 2,
            easing: Easing.inOut(Easing.sin),
          }),
          withTiming(0, {
            duration: config.duration / 2,
            easing: Easing.inOut(Easing.sin),
          })
        ),
        -1,
        false
      )
    );

    return () => {
      cancelAnimation(translateX);
      cancelAnimation(translateY);
    };
  }, [isPaused, config, translateX, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.particle,
        {
          left: config.x * SCREEN_WIDTH,
          top: config.y * SCREEN_HEIGHT,
          width: config.size,
          height: config.size,
          borderRadius: config.size / 2,
          backgroundColor: color,
          opacity: config.opacity,
        },
        animatedStyle,
      ]}
    />
  );
}

/**
 * Ambient floating particles overlay
 */
export function AmbientParticles({
  count = 12,
  color = 'rgba(255, 255, 255, 0.5)',
  enabled = true,
}: AmbientParticlesProps) {
  const prefersReducedMotion = useReducedMotion();
  const [isPaused, setIsPaused] = React.useState(false);

  // Generate particles once
  const particles = useMemo(() => generateParticles(count), [count]);

  // Pause when app is backgrounded
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      setIsPaused(nextState !== 'active');
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  // Don't render if reduced motion or disabled
  if (prefersReducedMotion || !enabled) {
    return null;
  }

  return (
    <View style={styles.container} pointerEvents="none">
      {particles.map((particle) => (
        <FloatingParticle
          key={particle.id}
          config={particle}
          color={color}
          isPaused={isPaused}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  particle: {
    position: 'absolute',
  },
});

export default AmbientParticles;
