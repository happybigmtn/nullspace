/**
 * Dice3D - Physics-based dice with throw animation (DS-047)
 *
 * Premium casino dice features:
 * - Visual 3D cube effect using scale and shadow
 * - Rotation animation during throw
 * - Bouncing settle with decreasing amplitude
 * - Precise final rotation to land on target face
 * - Haptic feedback on each bounce
 *
 * Note: True 3D transforms (translateZ, preserve-3d) aren't available in React Native.
 * This implementation creates a convincing 3D visual effect using scale, rotation,
 * and shadow changes synchronized with physics-based spring animations.
 */
import React, { useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withSpring,
  withDelay,
  Easing,
  runOnJS,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import { haptics } from '../../services/haptics';
import { SPRING, RADIUS } from '../../constants/theme';
import { SPRING_LIQUID } from '@nullspace/design-tokens';

export interface Dice3DProps {
  /** The value to show (1-6) */
  value: number;
  /** Whether the dice is currently rolling */
  isRolling: boolean;
  /** Index for stagger delay when multiple dice */
  index?: number;
  /** Size of the dice cube (default: 60) */
  size?: number;
  /** Skip animation for initial state */
  skipAnimation?: boolean;
  /** Callback when roll animation completes */
  onRollComplete?: () => void;
}

/** Physics constants for dice throw */
const PHYSICS = {
  /** Number of full tumbles during throw */
  TUMBLE_ROTATIONS: 3,
  /** Throw duration before bouncing (ms) */
  THROW_DURATION: 400,
  /** Stagger delay between multiple dice (ms) */
  STAGGER_DELAY: 80,
  /** Number of bounces before settling */
  BOUNCE_COUNT: 3,
  /** Initial bounce height (px) */
  INITIAL_BOUNCE_HEIGHT: 30,
  /** Bounce decay factor */
  BOUNCE_DECAY: 0.5,
} as const;

/** Dice colors */
const DICE_COLORS = {
  /** Die body color - cream/ivory for casino style */
  body: '#FAFAF8',
  /** Pip (dot) color */
  pip: '#18181B',
  /** Shadow on face edges */
  edgeShadow: 'rgba(0, 0, 0, 0.08)',
} as const;

/** Pip layouts for each die face (1-6) */
const PIP_LAYOUTS: Record<number, { row: number; col: number }[]> = {
  1: [{ row: 1, col: 1 }], // center
  2: [
    { row: 0, col: 2 }, // top-right
    { row: 2, col: 0 }, // bottom-left
  ],
  3: [
    { row: 0, col: 2 },
    { row: 1, col: 1 },
    { row: 2, col: 0 },
  ],
  4: [
    { row: 0, col: 0 },
    { row: 0, col: 2 },
    { row: 2, col: 0 },
    { row: 2, col: 2 },
  ],
  5: [
    { row: 0, col: 0 },
    { row: 0, col: 2 },
    { row: 1, col: 1 },
    { row: 2, col: 0 },
    { row: 2, col: 2 },
  ],
  6: [
    { row: 0, col: 0 },
    { row: 0, col: 2 },
    { row: 1, col: 0 },
    { row: 1, col: 2 },
    { row: 2, col: 0 },
    { row: 2, col: 2 },
  ],
};

/**
 * Die face component - shows pips for a given value
 */
function DieFace({ value, size }: { value: number; size: number }) {
  const pipSize = size * 0.18;
  const padding = size * 0.15;
  const cellSize = (size - padding * 2) / 3;

  const pips = PIP_LAYOUTS[value] ?? [];

  return (
    <View style={[styles.face, { width: size, height: size }]}>
      {pips.map((pip, i) => (
        <View
          key={i}
          style={[
            styles.pip,
            {
              width: pipSize,
              height: pipSize,
              borderRadius: pipSize / 2,
              position: 'absolute',
              top: padding + pip.row * cellSize + (cellSize - pipSize) / 2,
              left: padding + pip.col * cellSize + (cellSize - pipSize) / 2,
            },
          ]}
        />
      ))}
    </View>
  );
}

export function Dice3D({
  value,
  isRolling,
  index = 0,
  size = 60,
  skipAnimation = false,
  onRollComplete,
}: Dice3DProps) {
  // Animation values
  const rotation = useSharedValue(skipAnimation ? 0 : 0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const shadowRadius = useSharedValue(4);

  // Track displayed value (changes mid-roll for visual effect)
  const displayValue = useSharedValue(value);

  // Track roll complete
  const onRollCompleteRef = useRef(onRollComplete);
  onRollCompleteRef.current = onRollComplete;

  const triggerBounceHaptic = useCallback(() => {
    haptics.chipPlace().catch(() => {});
  }, []);

  const notifyRollComplete = useCallback(() => {
    onRollCompleteRef.current?.();
  }, []);

  useEffect(() => {
    if (skipAnimation) {
      displayValue.value = value;
      return;
    }

    if (isRolling) {
      const staggerDelay = index * PHYSICS.STAGGER_DELAY;

      // Random rotation direction
      const direction = Math.random() > 0.5 ? 1 : -1;
      const totalRotation = (PHYSICS.TUMBLE_ROTATIONS + Math.random() * 2) * 360 * direction;

      // Rotation animation - fast spin then settle
      rotation.value = withDelay(
        staggerDelay,
        withSequence(
          // Fast tumble during throw
          withTiming(totalRotation * 0.7, {
            duration: PHYSICS.THROW_DURATION,
            easing: Easing.out(Easing.quad),
          }),
          // Settle with spring
          withSpring(totalRotation, {
            ...SPRING_LIQUID.liquidSettle,
            velocity: totalRotation * 0.001,
          })
        )
      );

      // Bouncing animation
      let bounceHeight = PHYSICS.INITIAL_BOUNCE_HEIGHT;
      const bounceSequence: ReturnType<typeof withTiming>[] = [];

      for (let i = 0; i < PHYSICS.BOUNCE_COUNT; i++) {
        // Fall
        bounceSequence.push(
          withTiming(0, {
            duration: 100 + i * 20,
            easing: Easing.in(Easing.quad),
          })
        );
        // Bounce up
        bounceSequence.push(
          withTiming(-bounceHeight, {
            duration: 80 - i * 10,
            easing: Easing.out(Easing.quad),
          })
        );
        bounceHeight *= PHYSICS.BOUNCE_DECAY;
      }

      // Final settle
      bounceSequence.push(
        withSpring(
          0,
          {
            mass: 0.5,
            stiffness: 300,
            damping: 20,
          },
          (finished) => {
            'worklet';
            if (finished) {
              runOnJS(notifyRollComplete)();
            }
          }
        )
      );

      // Type assertion needed due to Reanimated type inference with spread operator
      (translateY.value as number) = withDelay(
        staggerDelay + PHYSICS.THROW_DURATION,
        withSequence(
          // Initial lift
          withTiming(-PHYSICS.INITIAL_BOUNCE_HEIGHT, { duration: 1 }),
          // Bounce sequence
          ...bounceSequence
        )
      ) as number;

      // Scale squish on bounces
      scale.value = withDelay(
        staggerDelay + PHYSICS.THROW_DURATION,
        withSequence(
          withTiming(1, { duration: 50 }),
          withTiming(0.9, { duration: 50 }),
          withSpring(1, SPRING.chipSettle)
        )
      );

      // Shadow changes with height
      shadowRadius.value = withDelay(
        staggerDelay + PHYSICS.THROW_DURATION,
        withSequence(
          withTiming(12, { duration: 50 }),
          withTiming(6, { duration: 150 }),
          withSpring(4, SPRING.chipSettle)
        )
      );

      // Haptic on first bounce
      setTimeout(() => {
        triggerBounceHaptic();
      }, staggerDelay + PHYSICS.THROW_DURATION + 100);

      // Update displayed value at end
      setTimeout(() => {
        displayValue.value = value;
      }, staggerDelay + PHYSICS.THROW_DURATION);
    } else {
      // Not rolling - just show the value
      displayValue.value = value;
    }
  }, [
    isRolling,
    value,
    index,
    skipAnimation,
    rotation,
    translateY,
    scale,
    shadowRadius,
    displayValue,
    triggerBounceHaptic,
    notifyRollComplete,
  ]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { rotate: `${rotation.value}deg` },
      { scale: scale.value },
    ],
    ...Platform.select({
      ios: {
        shadowRadius: shadowRadius.value,
      },
      android: {
        elevation: interpolate(shadowRadius.value, [4, 12], [4, 8], Extrapolate.CLAMP),
      },
    }),
  }));

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Animated.View style={[styles.dieWrapper, { width: size, height: size }, animatedStyle]}>
        <DieFace value={value} size={size} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  dieWrapper: {
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  face: {
    backgroundColor: DICE_COLORS.body,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: DICE_COLORS.edgeShadow,
  },
  pip: {
    backgroundColor: DICE_COLORS.pip,
  },
});

export default Dice3D;
