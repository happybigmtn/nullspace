/**
 * GoldParticles - Animated gold particle burst effect for win celebrations
 *
 * Uses react-native-reanimated for performant particle animations.
 * Particles burst outward from center with gravity and fade.
 */
import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import type { CelebrationIntensity } from '../../hooks/useCelebration';
import { PARTICLE_COUNTS, CELEBRATION_DURATIONS } from '../../hooks/useCelebration';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CENTER_X = SCREEN_WIDTH / 2;
const CENTER_Y = SCREEN_HEIGHT * 0.3; // Burst from upper third (near balance)

/** Gold color shades for variety */
const GOLD_COLORS = [
  '#FFD700', // Pure gold
  '#FFCC00', // Theme gold
  '#FFC107', // Amber
  '#FFB300', // Deep gold
  '#FFCA28', // Light gold
];

interface ParticleConfig {
  id: number;
  angle: number;
  distance: number;
  size: number;
  delay: number;
  color: string;
  rotationSpeed: number;
}

interface GoldParticlesProps {
  /** Is the celebration active */
  isActive: boolean;
  /** Celebration intensity determines particle count */
  intensity: CelebrationIntensity;
  /** Callback when animation completes */
  onComplete?: () => void;
}

/**
 * Generate particle configurations with seeded randomness
 */
function generateParticles(count: number, intensity: CelebrationIntensity): ParticleConfig[] {
  const particles: ParticleConfig[] = [];
  const baseDistance = intensity === 'jackpot' ? 200 : intensity === 'big' ? 160 : 120;

  for (let i = 0; i < count; i++) {
    // Distribute particles evenly with some randomness
    const baseAngle = (i / count) * Math.PI * 2;
    const angleVariation = (Math.random() - 0.5) * 0.5;

    particles.push({
      id: i,
      angle: baseAngle + angleVariation,
      distance: baseDistance * (0.6 + Math.random() * 0.8),
      size: 4 + Math.random() * 8,
      delay: Math.random() * 100,
      color: GOLD_COLORS[i % GOLD_COLORS.length] ?? '#FFD700',
      rotationSpeed: (Math.random() - 0.5) * 720, // -360 to 360 degrees
    });
  }

  return particles;
}

/**
 * Individual animated particle
 */
function Particle({
  config,
  isActive,
  duration,
}: {
  config: ParticleConfig;
  isActive: boolean;
  duration: number;
}) {
  const progress = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (isActive) {
      // Reset
      progress.value = 0;
      opacity.value = 0;

      // Animate outward with gravity curve
      progress.value = withDelay(
        config.delay,
        withTiming(1, {
          duration: duration * 0.9,
          easing: Easing.out(Easing.quad),
        })
      );

      // Fade in quickly, then fade out
      opacity.value = withDelay(
        config.delay,
        withSequence(
          withTiming(1, { duration: 100, easing: Easing.out(Easing.quad) }),
          withTiming(1, { duration: duration * 0.4 }),
          withTiming(0, { duration: duration * 0.4, easing: Easing.in(Easing.quad) })
        )
      );
    } else {
      opacity.value = withTiming(0, { duration: 150 });
    }
  }, [isActive, config.delay, duration, progress, opacity]);

  const animatedStyle = useAnimatedStyle(() => {
    // Calculate position with gravity effect
    const x = Math.cos(config.angle) * config.distance * progress.value;
    const gravityOffset = progress.value * progress.value * 80; // Gravity pulls down
    const y = Math.sin(config.angle) * config.distance * progress.value + gravityOffset;
    const rotation = config.rotationSpeed * progress.value;
    const scale = 1 - progress.value * 0.3; // Shrink as they fly

    return {
      opacity: opacity.value,
      transform: [
        { translateX: x },
        { translateY: y },
        { rotate: `${rotation}deg` },
        { scale },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.particle,
        {
          width: config.size,
          height: config.size,
          borderRadius: config.size / 2,
          backgroundColor: config.color,
        },
        animatedStyle,
      ]}
    />
  );
}

/**
 * Gold particle burst effect container
 */
export function GoldParticles({ isActive, intensity, onComplete }: GoldParticlesProps) {
  const particleCount = PARTICLE_COUNTS[intensity];
  const duration = CELEBRATION_DURATIONS[intensity];

  // Generate particle configs (memoized on intensity change)
  const particles = useMemo(
    () => (isActive ? generateParticles(particleCount, intensity) : []),
    [isActive, particleCount, intensity]
  );

  // Handle completion callback
  useEffect(() => {
    if (isActive && onComplete) {
      const timer = setTimeout(() => {
        runOnJS(onComplete)();
      }, duration);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isActive, duration, onComplete]);

  if (!isActive && particles.length === 0) return null;

  return (
    <View style={styles.container} pointerEvents="none">
      <View style={[styles.burstOrigin, { left: CENTER_X, top: CENTER_Y }]}>
        {particles.map((config) => (
          <Particle key={config.id} config={config} isActive={isActive} duration={duration} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    zIndex: 100,
  },
  burstOrigin: {
    position: 'absolute',
    width: 0,
    height: 0,
  },
  particle: {
    position: 'absolute',
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 4,
  },
});
