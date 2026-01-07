/**
 * Premium micro-interaction components (US-113)
 *
 * - AnimatedSelectionRing: Expanding ring on selection (not instant)
 * - SkeletonShimmer: Premium loading state with traveling highlight
 * - PulseRing: Attention-drawing pulse effect for status indicators
 * - FloatAnimation: Subtle idle movement for interactive elements
 */
import React, { useEffect, ReactNode } from 'react';
import { View, StyleSheet, ViewStyle, StyleProp, DimensionValue } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { COLORS, RADIUS, SPACING } from '../../constants/theme';

/* ─────────────────────────────────────────────────────────────────────────────
 * AnimatedSelectionRing
 * ───────────────────────────────────────────────────────────────────────────── */

interface AnimatedSelectionRingProps {
  /** Whether the item is selected */
  isSelected: boolean;
  /** Size of the ring (diameter) - defaults to content size */
  size?: number;
  /** Ring color when selected */
  color?: string;
  /** Ring thickness */
  ringWidth?: number;
  /** Additional styles */
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/**
 * Animated selection ring that expands outward when selected
 * Use this wrapper around selectable elements for premium selection feedback
 *
 * @example
 * <AnimatedSelectionRing isSelected={chip.selected} size={56} color={COLORS.primary}>
 *   <ChipView value={chip.value} />
 * </AnimatedSelectionRing>
 */
export function AnimatedSelectionRing({
  isSelected,
  size = 48,
  color = COLORS.primary,
  ringWidth = 2,
  style,
  children,
}: AnimatedSelectionRingProps) {
  // 0 = not selected, 1 = selected
  const selectionProgress = useSharedValue(isSelected ? 1 : 0);

  useEffect(() => {
    selectionProgress.value = withSpring(isSelected ? 1 : 0, {
      damping: 15,
      stiffness: 200,
    });
  }, [isSelected, selectionProgress]);

  const ringStyle = useAnimatedStyle(() => {
    // Ring starts 4px smaller and expands to full size
    const ringScale = interpolate(
      selectionProgress.value,
      [0, 1],
      [0.9, 1],
      Extrapolation.CLAMP
    );
    const ringOpacity = interpolate(
      selectionProgress.value,
      [0, 0.5, 1],
      [0, 0.5, 1],
      Extrapolation.CLAMP
    );

    return {
      transform: [{ scale: ringScale }],
      opacity: ringOpacity,
      borderColor: color,
    };
  });

  return (
    <View style={[styles.selectionContainer, { width: size, height: size }, style]}>
      <Animated.View
        style={[
          styles.selectionRing,
          {
            width: size + ringWidth * 4,
            height: size + ringWidth * 4,
            borderRadius: (size + ringWidth * 4) / 2,
            borderWidth: ringWidth,
          },
          ringStyle,
        ]}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * SkeletonShimmer
 * ───────────────────────────────────────────────────────────────────────────── */

interface SkeletonShimmerProps {
  /** Width of the skeleton - number or percentage string like '100%' */
  width: DimensionValue;
  /** Height of the skeleton */
  height: number;
  /** Border radius (defaults to md) */
  borderRadius?: number;
  /** Variant for different content types */
  variant?: 'text' | 'circle' | 'card' | 'chip';
  /** Additional styles */
  style?: StyleProp<ViewStyle>;
}

/**
 * Premium skeleton loader with traveling shimmer highlight
 * Replaces boring loading dots with a more sophisticated loading state
 *
 * @example
 * <SkeletonShimmer width={200} height={20} variant="text" />
 * <SkeletonShimmer width={56} height={56} variant="chip" />
 */
export function SkeletonShimmer({
  width,
  height,
  borderRadius = RADIUS.sm,
  variant = 'text',
  style,
}: SkeletonShimmerProps) {
  const shimmerOffset = useSharedValue(-1);

  useEffect(() => {
    shimmerOffset.value = withRepeat(
      withTiming(2, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      -1,
      false
    );
  }, [shimmerOffset]);

  const shimmerStyle = useAnimatedStyle(() => {
    const translateXPercent = interpolate(
      shimmerOffset.value,
      [-1, 2],
      [-100, 200],
      Extrapolation.CLAMP
    );

    return {
      transform: [{ translateX: `${translateXPercent}%` as unknown as number }],
    };
  });

  // Determine radius based on variant
  const getRadius = (): number => {
    switch (variant) {
      case 'circle':
      case 'chip':
        // For circle/chip, use half the width if it's a number
        return typeof width === 'number' ? width / 2 : RADIUS.full;
      case 'card':
        return RADIUS.md;
      default:
        return borderRadius;
    }
  };

  return (
    <View
      style={[
        styles.skeleton,
        {
          width,
          height,
          borderRadius: getRadius(),
        },
        style,
      ]}
    >
      <Animated.View
        style={[styles.shimmerHighlight, shimmerStyle]}
        pointerEvents="none"
      />
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * PulseRing
 * ───────────────────────────────────────────────────────────────────────────── */

interface PulseRingProps {
  /** Whether the pulse is active */
  isActive?: boolean;
  /** Size of the center indicator */
  size?: number;
  /** Color of the pulse rings */
  color?: string;
  /** Number of rings (1-3) */
  rings?: 1 | 2 | 3;
  /** Additional styles */
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/**
 * Expanding pulse rings that draw attention to status indicators
 * Perfect for connection status, notifications, or alert states
 *
 * @example
 * <PulseRing isActive={isConnecting} size={6} color={COLORS.gold}>
 *   <View style={styles.indicator} />
 * </PulseRing>
 */
export function PulseRing({
  isActive = true,
  size = 8,
  color = COLORS.primary,
  rings = 2,
  style,
  children,
}: PulseRingProps) {
  const ring1Scale = useSharedValue(1);
  const ring1Opacity = useSharedValue(0.6);
  const ring2Scale = useSharedValue(1);
  const ring2Opacity = useSharedValue(0.4);
  const ring3Scale = useSharedValue(1);
  const ring3Opacity = useSharedValue(0.2);

  useEffect(() => {
    if (isActive) {
      // Ring 1 - primary pulse
      ring1Scale.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 0 }),
          withTiming(2.5, { duration: 1200, easing: Easing.out(Easing.ease) })
        ),
        -1,
        false
      );
      ring1Opacity.value = withRepeat(
        withSequence(
          withTiming(0.6, { duration: 0 }),
          withTiming(0, { duration: 1200, easing: Easing.out(Easing.ease) })
        ),
        -1,
        false
      );

      // Ring 2 - delayed secondary pulse
      if (rings >= 2) {
        ring2Scale.value = withRepeat(
          withSequence(
            withTiming(1, { duration: 400 }),
            withTiming(2.2, { duration: 1200, easing: Easing.out(Easing.ease) })
          ),
          -1,
          false
        );
        ring2Opacity.value = withRepeat(
          withSequence(
            withTiming(0.4, { duration: 400 }),
            withTiming(0, { duration: 1200, easing: Easing.out(Easing.ease) })
          ),
          -1,
          false
        );
      }

      // Ring 3 - further delayed tertiary pulse
      if (rings >= 3) {
        ring3Scale.value = withRepeat(
          withSequence(
            withTiming(1, { duration: 800 }),
            withTiming(2, { duration: 1200, easing: Easing.out(Easing.ease) })
          ),
          -1,
          false
        );
        ring3Opacity.value = withRepeat(
          withSequence(
            withTiming(0.2, { duration: 800 }),
            withTiming(0, { duration: 1200, easing: Easing.out(Easing.ease) })
          ),
          -1,
          false
        );
      }
    } else {
      ring1Scale.value = 1;
      ring1Opacity.value = 0;
      ring2Scale.value = 1;
      ring2Opacity.value = 0;
      ring3Scale.value = 1;
      ring3Opacity.value = 0;
    }
  }, [isActive, rings, ring1Scale, ring1Opacity, ring2Scale, ring2Opacity, ring3Scale, ring3Opacity]);

  const ring1Style = useAnimatedStyle(() => ({
    transform: [{ scale: ring1Scale.value }],
    opacity: ring1Opacity.value,
  }));

  const ring2Style = useAnimatedStyle(() => ({
    transform: [{ scale: ring2Scale.value }],
    opacity: ring2Opacity.value,
  }));

  const ring3Style = useAnimatedStyle(() => ({
    transform: [{ scale: ring3Scale.value }],
    opacity: ring3Opacity.value,
  }));

  const ringSize = size * 2;
  const ringRadius = ringSize / 2;

  return (
    <View style={[styles.pulseContainer, { width: ringSize * 3, height: ringSize * 3 }, style]}>
      {/* Pulse rings */}
      <Animated.View
        style={[
          styles.pulseRing,
          { width: ringSize, height: ringSize, borderRadius: ringRadius, borderColor: color },
          ring1Style,
        ]}
        pointerEvents="none"
      />
      {rings >= 2 && (
        <Animated.View
          style={[
            styles.pulseRing,
            { width: ringSize, height: ringSize, borderRadius: ringRadius, borderColor: color },
            ring2Style,
          ]}
          pointerEvents="none"
        />
      )}
      {rings >= 3 && (
        <Animated.View
          style={[
            styles.pulseRing,
            { width: ringSize, height: ringSize, borderRadius: ringRadius, borderColor: color },
            ring3Style,
          ]}
          pointerEvents="none"
        />
      )}
      {/* Center content */}
      <View style={styles.pulseCenter}>{children}</View>
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * FloatAnimation
 * ───────────────────────────────────────────────────────────────────────────── */

interface FloatAnimationProps {
  /** Whether the float animation is active */
  isActive?: boolean;
  /** Vertical float distance (px) */
  distance?: number;
  /** Animation duration (ms) */
  duration?: number;
  /** Additional styles */
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/**
 * Subtle floating animation for idle interactive elements
 * Adds life to UI without being distracting
 *
 * @example
 * <FloatAnimation isActive={!isBusy} distance={4} duration={3000}>
 *   <ActionButton />
 * </FloatAnimation>
 */
export function FloatAnimation({
  isActive = true,
  distance = 4,
  duration = 3000,
  style,
  children,
}: FloatAnimationProps) {
  const floatY = useSharedValue(0);

  useEffect(() => {
    if (isActive) {
      floatY.value = withRepeat(
        withSequence(
          withTiming(-distance / 2, { duration: duration / 2, easing: Easing.inOut(Easing.ease) }),
          withTiming(distance / 2, { duration: duration / 2, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
    } else {
      floatY.value = withTiming(0, { duration: 300 });
    }
  }, [isActive, distance, duration, floatY]);

  const floatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatY.value }],
  }));

  return (
    <Animated.View style={[floatStyle, style]}>
      {children}
    </Animated.View>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * SkeletonRow - Convenience component for loading text lines
 * ───────────────────────────────────────────────────────────────────────────── */

interface SkeletonRowProps {
  /** Number of skeleton lines */
  lines?: number;
  /** Line width pattern - 'full' | 'varied' | DimensionValue[] */
  widths?: 'full' | 'varied' | DimensionValue[];
  /** Line height */
  lineHeight?: number;
  /** Gap between lines */
  gap?: number;
  /** Additional styles */
  style?: StyleProp<ViewStyle>;
}

/**
 * Multiple skeleton lines for loading content
 *
 * @example
 * <SkeletonRow lines={3} widths="varied" />
 */
export function SkeletonRow({
  lines = 3,
  widths = 'varied',
  lineHeight = 16,
  gap = SPACING.sm,
  style,
}: SkeletonRowProps) {
  const getWidth = (index: number): DimensionValue => {
    if (widths === 'full') return '100%';
    if (widths === 'varied') {
      // Alternating widths: 100%, 85%, 70%
      const patterns: DimensionValue[] = ['100%', '85%', '70%'];
      return patterns[index % patterns.length] ?? '100%';
    }
    return widths[index] ?? '100%';
  };

  return (
    <View style={[styles.skeletonRow, { gap }, style]}>
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonShimmer key={i} width={getWidth(i)} height={lineHeight} variant="text" />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Selection Ring styles
  selectionContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionRing: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: COLORS.primary,
  },

  // Skeleton styles
  skeleton: {
    backgroundColor: COLORS.border,
    overflow: 'hidden',
  },
  shimmerHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: '50%',
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    // Diagonal gradient effect via rotation
    transform: [{ skewX: '-20deg' }],
  },
  skeletonRow: {
    flexDirection: 'column',
  },

  // Pulse Ring styles
  pulseContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    borderWidth: 2,
  },
  pulseCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
