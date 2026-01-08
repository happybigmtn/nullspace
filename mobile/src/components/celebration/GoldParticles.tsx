/**
 * GoldParticles - Animated particle burst effect for win celebrations (DS-048)
 *
 * Features:
 * - Multiple particle shapes: circles, squares, triangles
 * - Color variants: gold, multicolor, game-themed
 * - Firework burst patterns for big wins
 * - Physics-based gravity and rotation
 *
 * Uses react-native-reanimated for performant particle animations.
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
import { GAME } from '@nullspace/design-tokens';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CENTER_X = SCREEN_WIDTH / 2;
const CENTER_Y = SCREEN_HEIGHT * 0.3; // Burst from upper third (near balance)

/** Particle shape types */
export type ParticleShape = 'circle' | 'square' | 'triangle' | 'star';

/** Color theme variants */
export type ColorVariant = 'gold' | 'multicolor' | 'game';

/** Gold color shades for variety */
const GOLD_COLORS = [
  '#FFD700', // Pure gold
  '#FFCC00', // Theme gold
  '#FFC107', // Amber
  '#FFB300', // Deep gold
  '#FFCA28', // Light gold
];

/** Multicolor rainbow palette */
const MULTICOLOR_PALETTE = [
  '#FF3B30', // Red
  '#FF9500', // Orange
  '#FFCC00', // Yellow
  '#34C759', // Green
  '#5AC8FA', // Light blue
  '#007AFF', // Blue
  '#AF52DE', // Purple
  '#FF2D55', // Pink
];

/** Get game-themed colors based on gameId */
function getGameColors(gameId?: string): string[] {
  if (!gameId) return GOLD_COLORS;

  const gameColors = GAME[gameId as keyof typeof GAME];
  if (!gameColors) return GOLD_COLORS;

  // Create palette from game's primary and accent
  return [
    gameColors.primary,
    gameColors.accent,
    '#FFD700', // Add gold for sparkle
    gameColors.primary,
    gameColors.accent,
  ];
}

interface ParticleConfig {
  id: number;
  angle: number;
  distance: number;
  size: number;
  delay: number;
  color: string;
  rotationSpeed: number;
  shape: ParticleShape;
  /** For firework patterns: which burst wave */
  wave: number;
}

interface GoldParticlesProps {
  /** Is the celebration active */
  isActive: boolean;
  /** Celebration intensity determines particle count */
  intensity: CelebrationIntensity;
  /** Color variant (default: gold) */
  colorVariant?: ColorVariant;
  /** Game ID for game-themed colors */
  gameId?: string;
  /** Enable firework burst pattern for big wins */
  fireworkBurst?: boolean;
  /** Callback when animation completes */
  onComplete?: () => void;
}

/**
 * Generate particle configurations with seeded randomness
 */
function generateParticles(
  count: number,
  intensity: CelebrationIntensity,
  colorVariant: ColorVariant,
  gameId?: string,
  fireworkBurst?: boolean
): ParticleConfig[] {
  const particles: ParticleConfig[] = [];
  const baseDistance = intensity === 'jackpot' ? 200 : intensity === 'big' ? 160 : 120;

  // Get color palette based on variant
  let colors: string[];
  switch (colorVariant) {
    case 'multicolor':
      colors = MULTICOLOR_PALETTE;
      break;
    case 'game':
      colors = getGameColors(gameId);
      break;
    case 'gold':
    default:
      colors = GOLD_COLORS;
  }

  // Shape distribution based on intensity
  const shapes: ParticleShape[] =
    intensity === 'jackpot'
      ? ['circle', 'square', 'triangle', 'star', 'circle', 'square']
      : intensity === 'big'
        ? ['circle', 'square', 'triangle', 'circle']
        : ['circle', 'circle', 'square'];

  // Number of firework waves
  const waveCount = fireworkBurst && (intensity === 'jackpot' || intensity === 'big') ? 3 : 1;

  for (let wave = 0; wave < waveCount; wave++) {
    const waveParticleCount = Math.floor(count / waveCount);
    const waveDelay = wave * 200; // 200ms between waves

    for (let i = 0; i < waveParticleCount; i++) {
      // Distribute particles evenly with some randomness
      const baseAngle = (i / waveParticleCount) * Math.PI * 2;
      const angleVariation = (Math.random() - 0.5) * 0.5;

      // Vary distance per wave for firework effect
      const waveDistanceMultiplier = 1 - wave * 0.2;

      particles.push({
        id: wave * 1000 + i,
        angle: baseAngle + angleVariation,
        distance: baseDistance * (0.6 + Math.random() * 0.8) * waveDistanceMultiplier,
        size: 4 + Math.random() * 8,
        delay: waveDelay + Math.random() * 100,
        color: colors[i % colors.length] ?? '#FFD700',
        rotationSpeed: (Math.random() - 0.5) * 720, // -360 to 360 degrees
        shape: shapes[i % shapes.length] ?? 'circle',
        wave,
      });
    }
  }

  return particles;
}

/**
 * Triangle shape component
 */
function TriangleShape({ size, color }: { size: number; color: string }) {
  return (
    <View
      style={{
        width: 0,
        height: 0,
        borderLeftWidth: size / 2,
        borderRightWidth: size / 2,
        borderBottomWidth: size,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
        borderBottomColor: color,
      }}
    />
  );
}

/**
 * Star shape component (simplified 4-point star)
 */
function StarShape({ size, color }: { size: number; color: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Horizontal bar */}
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size / 3,
          backgroundColor: color,
          borderRadius: size / 6,
        }}
      />
      {/* Vertical bar */}
      <View
        style={{
          position: 'absolute',
          width: size / 3,
          height: size,
          backgroundColor: color,
          borderRadius: size / 6,
        }}
      />
    </View>
  );
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

  // Render shape based on config
  const renderShape = () => {
    switch (config.shape) {
      case 'triangle':
        return <TriangleShape size={config.size} color={config.color} />;
      case 'star':
        return <StarShape size={config.size} color={config.color} />;
      case 'square':
        return (
          <View
            style={{
              width: config.size,
              height: config.size,
              backgroundColor: config.color,
              borderRadius: config.size / 6, // Slightly rounded
            }}
          />
        );
      case 'circle':
      default:
        return (
          <View
            style={{
              width: config.size,
              height: config.size,
              borderRadius: config.size / 2,
              backgroundColor: config.color,
            }}
          />
        );
    }
  };

  return (
    <Animated.View
      style={[
        styles.particle,
        animatedStyle,
      ]}
    >
      {renderShape()}
    </Animated.View>
  );
}

/**
 * Gold particle burst effect container
 */
export function GoldParticles({
  isActive,
  intensity,
  colorVariant = 'gold',
  gameId,
  fireworkBurst = false,
  onComplete,
}: GoldParticlesProps) {
  const particleCount = PARTICLE_COUNTS[intensity];
  const duration = CELEBRATION_DURATIONS[intensity];

  // Auto-enable firework burst for jackpot wins
  const shouldFirework = fireworkBurst || intensity === 'jackpot';

  // Generate particle configs (memoized on intensity change)
  const particles = useMemo(
    () => (isActive ? generateParticles(particleCount, intensity, colorVariant, gameId, shouldFirework) : []),
    [isActive, particleCount, intensity, colorVariant, gameId, shouldFirework]
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
