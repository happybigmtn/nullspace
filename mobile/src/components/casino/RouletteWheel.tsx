/**
 * RouletteWheel - Physics-based roulette wheel with ball animation (DS-046)
 *
 * Premium casino features:
 * - Friction-based wheel deceleration (not linear timing)
 * - Ball with damped harmonic bounce motion
 * - Ball settles into winning slot
 * - Haptic pulses as ball crosses slots
 * - Wheel and ball spin in opposite directions (like real roulette)
 */
import React, { useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withSequence,
  withDelay,
  interpolate,
  Extrapolate,
  Easing,
  runOnJS,
  useAnimatedReaction,
  cancelAnimation,
} from 'react-native-reanimated';
import { haptics } from '../../services/haptics';
import { COLORS, RADIUS, SPRING } from '../../constants/theme';

/**
 * European roulette wheel number sequence (clockwise from 0)
 * Ball travels counter-clockwise, wheel spins clockwise
 */
const WHEEL_NUMBERS = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
] as const;

const SLOT_COUNT = WHEEL_NUMBERS.length; // 37 slots
const DEGREES_PER_SLOT = 360 / SLOT_COUNT;

/** Get the angle for a specific number on the wheel */
function getSlotAngle(number: number): number {
  const index = WHEEL_NUMBERS.indexOf(number as typeof WHEEL_NUMBERS[number]);
  if (index < 0) return 0;
  return index * DEGREES_PER_SLOT;
}

/** Get number color: red, black, or green */
function getNumberColor(num: number): string {
  if (num === 0) return ROULETTE_COLORS.green;
  const reds = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  return reds.includes(num) ? ROULETTE_COLORS.red : ROULETTE_COLORS.black;
}

/** Roulette color palette */
const ROULETTE_COLORS = {
  red: '#DC2626',
  black: '#18181B',
  green: '#16A34A',
  gold: '#D4AF37',
  felt: '#1E5631',
  wheelRim: '#8B7355',
  ballSilver: '#E5E5E5',
  ballHighlight: '#FFFFFF',
} as const;

export interface RouletteWheelProps {
  /** Current phase of the game */
  phase: 'betting' | 'spinning' | 'result';
  /** The winning number (null until result phase) */
  result: number | null;
  /** Size of the wheel component */
  size?: number;
  /** Callback when spin animation completes */
  onSpinComplete?: () => void;
}

/**
 * Physics constants for realistic motion
 */
const PHYSICS = {
  /** Initial wheel angular velocity (degrees per second) */
  WHEEL_INITIAL_VELOCITY: 720,
  /** Wheel friction coefficient (higher = faster stop) */
  WHEEL_FRICTION: 0.985,
  /** Initial ball angular velocity (opposite direction) */
  BALL_INITIAL_VELOCITY: -1080,
  /** Ball friction coefficient */
  BALL_FRICTION: 0.975,
  /** Ball bounce amplitude decay per bounce */
  BOUNCE_DECAY: 0.6,
  /** Number of ball bounces before settling */
  BOUNCE_COUNT: 4,
  /** Time for ball to settle into slot (ms) */
  SETTLE_DURATION: 800,
  /** Minimum velocity to trigger slot haptic */
  HAPTIC_VELOCITY_THRESHOLD: 30,
} as const;

export function RouletteWheel({
  phase,
  result,
  size = 200,
  onSpinComplete,
}: RouletteWheelProps) {
  // Wheel rotation (degrees, positive = clockwise)
  const wheelRotation = useSharedValue(0);
  // Ball position relative to wheel (degrees around wheel edge)
  const ballAngle = useSharedValue(0);
  // Ball radial position (1 = edge, 0 = center)
  const ballRadius = useSharedValue(0.85);
  // Ball vertical bounce offset
  const ballBounce = useSharedValue(0);
  // Track last slot for haptic feedback
  const lastSlotRef = useRef(-1);
  // Track spin complete callback
  const onSpinCompleteRef = useRef(onSpinComplete);
  onSpinCompleteRef.current = onSpinComplete;

  /**
   * Trigger haptic when ball crosses a slot
   * Uses chipPlace (light impact) for subtle click feedback
   */
  const triggerSlotHaptic = useCallback(() => {
    haptics.chipPlace().catch(() => {});
  }, []);

  /**
   * Notify spin complete
   */
  const notifySpinComplete = useCallback(() => {
    onSpinCompleteRef.current?.();
  }, []);

  /**
   * Track ball crossing slots for haptic feedback
   */
  useAnimatedReaction(
    () => {
      // Calculate which slot the ball is over
      const totalAngle = (wheelRotation.value + ballAngle.value + 360) % 360;
      return Math.floor(totalAngle / DEGREES_PER_SLOT);
    },
    (currentSlot, previousSlot) => {
      // Only trigger haptic during active spin (when ball is moving fast)
      if (
        previousSlot !== null &&
        currentSlot !== previousSlot &&
        Math.abs(ballAngle.value) > PHYSICS.HAPTIC_VELOCITY_THRESHOLD
      ) {
        runOnJS(triggerSlotHaptic)();
      }
    }
  );

  /**
   * Start the spin animation when phase changes to spinning
   */
  useEffect(() => {
    if (phase === 'spinning') {
      // Reset ball to edge
      ballRadius.value = 0.85;
      ballBounce.value = 0;
      lastSlotRef.current = -1;

      // Animate wheel with friction-based deceleration
      // Using custom timing that simulates friction
      const wheelSpinDuration = 4000; // Base spin time
      const extraSpins = 3 + Math.floor(Math.random() * 2); // 3-4 extra rotations

      wheelRotation.value = withTiming(
        wheelRotation.value + (extraSpins * 360),
        {
          duration: wheelSpinDuration,
          easing: Easing.out(Easing.cubic), // Friction-like deceleration
        }
      );

      // Ball spins opposite direction, faster initial velocity
      const ballSpinDuration = 3500;
      const ballExtraSpins = 4 + Math.floor(Math.random() * 2);

      ballAngle.value = withTiming(
        ballAngle.value + (ballExtraSpins * -360), // Opposite direction
        {
          duration: ballSpinDuration,
          easing: Easing.out(Easing.quad), // Faster deceleration
        }
      );
    }
  }, [phase, wheelRotation, ballAngle, ballRadius, ballBounce]);

  /**
   * Settle ball into winning slot when result arrives
   */
  useEffect(() => {
    if (phase === 'result' && result !== null) {
      // Calculate target position
      const targetSlotAngle = getSlotAngle(result);
      // Ball needs to be at this angle relative to wheel
      const currentWheelPos = wheelRotation.value % 360;
      const targetBallAngle = targetSlotAngle - currentWheelPos;

      // Cancel any ongoing animations
      cancelAnimation(ballAngle);
      cancelAnimation(ballRadius);
      cancelAnimation(ballBounce);

      // Animate ball to slot with bouncing settle
      // First, move ball to correct angle
      ballAngle.value = withTiming(
        targetBallAngle,
        {
          duration: PHYSICS.SETTLE_DURATION,
          easing: Easing.out(Easing.cubic),
        }
      );

      // Move ball inward (from edge toward slot)
      ballRadius.value = withSequence(
        withTiming(0.75, { duration: 300 }),
        withSpring(0.7, {
          mass: SPRING.chipSettle.mass,
          stiffness: SPRING.chipSettle.stiffness,
          damping: SPRING.chipSettle.damping,
        })
      );

      // Bouncing effect - damped harmonic motion
      ballBounce.value = withSequence(
        // Initial drop
        withTiming(-8, { duration: 150, easing: Easing.in(Easing.quad) }),
        // Bounce 1 (highest)
        withTiming(6, { duration: 120, easing: Easing.out(Easing.quad) }),
        withTiming(-5, { duration: 100, easing: Easing.in(Easing.quad) }),
        // Bounce 2
        withTiming(3.5, { duration: 90, easing: Easing.out(Easing.quad) }),
        withTiming(-3, { duration: 80, easing: Easing.in(Easing.quad) }),
        // Bounce 3
        withTiming(2, { duration: 70, easing: Easing.out(Easing.quad) }),
        withTiming(-1.5, { duration: 60, easing: Easing.in(Easing.quad) }),
        // Bounce 4 (final settle)
        withTiming(0.5, { duration: 50, easing: Easing.out(Easing.quad) }),
        withSpring(0, {
          mass: 0.3,
          stiffness: 200,
          damping: 15,
        }, (finished) => {
          'worklet';
          if (finished) {
            runOnJS(notifySpinComplete)();
          }
        })
      );
    }
  }, [phase, result, wheelRotation, ballAngle, ballRadius, ballBounce, notifySpinComplete]);

  /**
   * Wheel rotation style
   */
  const wheelStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${wheelRotation.value}deg` }],
  }));

  /**
   * Ball position style - polar coordinates converted to x/y
   */
  const ballStyle = useAnimatedStyle(() => {
    const angle = ballAngle.value;
    const radius = ballRadius.value;
    const bounce = ballBounce.value;

    // Convert polar to cartesian
    const angleRad = (angle - 90) * (Math.PI / 180); // -90 to start at top
    const r = (size / 2 - 16) * radius; // Offset from edge

    const x = Math.cos(angleRad) * r;
    const y = Math.sin(angleRad) * r + bounce;

    return {
      transform: [
        { translateX: x },
        { translateY: y },
      ],
      opacity: interpolate(
        radius,
        [0, 0.5, 1],
        [0.5, 1, 1],
        Extrapolate.CLAMP
      ),
    };
  });

  const wheelRadius = size / 2;
  const innerRadius = wheelRadius * 0.6;
  const ballSize = 12;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {/* Outer rim (gold) */}
      <View
        style={[
          styles.outerRim,
          {
            width: size,
            height: size,
            borderRadius: wheelRadius,
          },
        ]}
      />

      {/* Wheel with slots */}
      <Animated.View
        style={[
          styles.wheel,
          {
            width: size - 8,
            height: size - 8,
            borderRadius: wheelRadius - 4,
          },
          wheelStyle,
        ]}
      >
        {/* Slot segments (simplified visual representation) */}
        {WHEEL_NUMBERS.map((num, index) => {
          const rotation = index * DEGREES_PER_SLOT;
          const color = getNumberColor(num);

          return (
            <View
              key={num}
              style={[
                styles.slotSegment,
                {
                  transform: [
                    { rotate: `${rotation}deg` },
                    { translateY: -(size / 2 - 20) },
                  ],
                  backgroundColor: color,
                },
              ]}
            >
              <Animated.Text
                style={[
                  styles.slotNumber,
                  { transform: [{ rotate: '-90deg' }] },
                ]}
              >
                {num}
              </Animated.Text>
            </View>
          );
        })}

        {/* Inner circle (cone) */}
        <View
          style={[
            styles.innerCone,
            {
              width: innerRadius * 2,
              height: innerRadius * 2,
              borderRadius: innerRadius,
            },
          ]}
        />
      </Animated.View>

      {/* Ball */}
      <Animated.View
        style={[
          styles.ball,
          {
            width: ballSize,
            height: ballSize,
            borderRadius: ballSize / 2,
            marginLeft: -ballSize / 2,
            marginTop: -ballSize / 2,
          },
          ballStyle,
        ]}
      >
        {/* Ball highlight */}
        <View style={styles.ballHighlight} />
      </Animated.View>

      {/* Result number overlay (shown in result phase) */}
      {phase === 'result' && result !== null && (
        <View style={styles.resultOverlay}>
          <View
            style={[
              styles.resultBadge,
              { backgroundColor: getNumberColor(result) },
            ]}
          >
            <Animated.Text style={styles.resultNumber}>
              {result}
            </Animated.Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  outerRim: {
    position: 'absolute',
    backgroundColor: ROULETTE_COLORS.wheelRim,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  wheel: {
    position: 'absolute',
    backgroundColor: ROULETTE_COLORS.felt,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  slotSegment: {
    position: 'absolute',
    width: 22,
    height: 36,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 2,
    borderRadius: 2,
  },
  slotNumber: {
    color: COLORS.textPrimary,
    fontSize: 9,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  innerCone: {
    position: 'absolute',
    backgroundColor: ROULETTE_COLORS.gold,
    borderWidth: 3,
    borderColor: ROULETTE_COLORS.wheelRim,
  },
  ball: {
    position: 'absolute',
    backgroundColor: ROULETTE_COLORS.ballSilver,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.4,
        shadowRadius: 3,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  ballHighlight: {
    position: 'absolute',
    top: 2,
    left: 2,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: ROULETTE_COLORS.ballHighlight,
    opacity: 0.8,
  },
  resultOverlay: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: ROULETTE_COLORS.gold,
  },
  resultNumber: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 'bold',
  },
});
