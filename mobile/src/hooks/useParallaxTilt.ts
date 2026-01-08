/**
 * useParallaxTilt - Touch-based 3D parallax rotation hook (DS-055)
 *
 * Provides physics-based 3D tilt effect for cards and other elements.
 * Adapts the web TiltedCard interaction pattern to React Native touch.
 *
 * Features:
 * - Continuous touch tracking with PanGestureHandler
 * - Spring physics for organic motion (SPRING_LIQUID.liquidRipple)
 * - Configurable rotation amplitude and scale
 * - Reset to neutral on touch release
 * - Perspective-correct 3D transforms
 *
 * @example
 * const { gestureHandler, animatedStyle, ref } = useParallaxTilt({
 *   rotateAmplitude: 12,
 *   scaleOnTouch: 1.05,
 * });
 *
 * <PanGestureHandler {...gestureHandler}>
 *   <Animated.View ref={ref} style={animatedStyle}>
 *     <Card ... />
 *   </Animated.View>
 * </PanGestureHandler>
 */
import { useRef, useCallback } from 'react';
import { LayoutChangeEvent } from 'react-native';
import {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  SharedValue,
} from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';
import { SPRING_LIQUID } from '@nullspace/design-tokens';

export interface ParallaxTiltOptions {
  /** Maximum rotation in degrees (default: 14) */
  rotateAmplitude?: number;
  /** Scale factor when touched (default: 1.05) */
  scaleOnTouch?: number;
  /** Enable/disable the effect (default: true) */
  enabled?: boolean;
  /** Perspective depth in pixels (default: 800) */
  perspective?: number;
  /** Custom spring config override */
  springConfig?: {
    mass: number;
    stiffness: number;
    damping: number;
  };
  /** Callback when tilt starts */
  onTiltStart?: () => void;
  /** Callback when tilt ends */
  onTiltEnd?: () => void;
}

export interface ParallaxTiltResult {
  /** Animated style to apply to the tilting element */
  animatedStyle: ReturnType<typeof useAnimatedStyle>;
  /** Gesture object for GestureDetector */
  gesture: ReturnType<typeof Gesture.Pan>;
  /** Layout handler to measure element dimensions */
  onLayout: (event: LayoutChangeEvent) => void;
  /** Current tilt state (for debugging) */
  isActive: SharedValue<boolean>;
  /** Manually reset tilt to neutral */
  reset: () => void;
}

/**
 * Spring configuration optimized for card tilt
 * Uses liquid ripple preset for organic, fluid motion
 */
const TILT_SPRING = {
  mass: SPRING_LIQUID.liquidRipple.mass,
  stiffness: SPRING_LIQUID.liquidRipple.stiffness,
  damping: SPRING_LIQUID.liquidRipple.damping,
};

/**
 * Reset spring - slightly stiffer for snappy return
 */
const RESET_SPRING = {
  mass: SPRING_LIQUID.liquidRipple.mass,
  stiffness: SPRING_LIQUID.liquidRipple.stiffness * 1.5,
  damping: SPRING_LIQUID.liquidRipple.damping * 1.2,
};

export function useParallaxTilt(options: ParallaxTiltOptions = {}): ParallaxTiltResult {
  const {
    rotateAmplitude = 14,
    scaleOnTouch = 1.05,
    enabled = true,
    perspective = 800,
    springConfig,
    onTiltStart,
    onTiltEnd,
  } = options;

  // Element dimensions for calculating relative touch position
  const dimensions = useRef({ width: 0, height: 0 });

  // Animation values
  const rotateX = useSharedValue(0);
  const rotateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const isActive = useSharedValue(false);

  // Callbacks refs
  const onTiltStartRef = useRef(onTiltStart);
  const onTiltEndRef = useRef(onTiltEnd);
  onTiltStartRef.current = onTiltStart;
  onTiltEndRef.current = onTiltEnd;

  // Spring config - use provided or default
  const spring = springConfig ?? TILT_SPRING;

  /**
   * Handle layout to capture element dimensions
   */
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    dimensions.current = { width, height };
  }, []);

  /**
   * Calculate rotation from touch position
   * Center of element = 0 rotation
   * Edges = ± rotateAmplitude
   */
  const calculateRotation = useCallback(
    (x: number, y: number) => {
      'worklet';
      const { width, height } = dimensions.current;
      if (width === 0 || height === 0) return { rotX: 0, rotY: 0 };

      // Offset from center (-0.5 to 0.5)
      const offsetX = (x / width) - 0.5;
      const offsetY = (y / height) - 0.5;

      // Map to rotation: Y-axis rotation from X movement, X-axis from Y movement
      // Invert Y rotation for natural "push away from finger" feel
      const rotY = offsetX * rotateAmplitude * 2;
      const rotX = -offsetY * rotateAmplitude * 2;

      return { rotX, rotY };
    },
    [rotateAmplitude]
  );

  /**
   * Pan gesture handler
   */
  const gesture = Gesture.Pan()
    .enabled(enabled)
    .onBegin((event) => {
      'worklet';
      isActive.value = true;
      scale.value = withSpring(scaleOnTouch, spring);

      const { rotX, rotY } = calculateRotation(event.x, event.y);
      rotateX.value = withSpring(rotX, spring);
      rotateY.value = withSpring(rotY, spring);

      if (onTiltStartRef.current) {
        runOnJS(onTiltStartRef.current)();
      }
    })
    .onUpdate((event) => {
      'worklet';
      const { rotX, rotY } = calculateRotation(event.x, event.y);
      rotateX.value = withSpring(rotX, spring);
      rotateY.value = withSpring(rotY, spring);
    })
    .onEnd(() => {
      'worklet';
      isActive.value = false;
      rotateX.value = withSpring(0, RESET_SPRING);
      rotateY.value = withSpring(0, RESET_SPRING);
      scale.value = withSpring(1, RESET_SPRING);

      if (onTiltEndRef.current) {
        runOnJS(onTiltEndRef.current)();
      }
    })
    .onFinalize(() => {
      'worklet';
      // Ensure reset even on gesture cancellation
      if (isActive.value) {
        isActive.value = false;
        rotateX.value = withSpring(0, RESET_SPRING);
        rotateY.value = withSpring(0, RESET_SPRING);
        scale.value = withSpring(1, RESET_SPRING);
      }
    });

  /**
   * Animated style with 3D transforms
   * Order matters: perspective → rotations → scale
   */
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective },
      { rotateX: `${rotateX.value}deg` },
      { rotateY: `${rotateY.value}deg` },
      { scale: scale.value },
    ],
  }));

  /**
   * Manual reset function
   */
  const reset = useCallback(() => {
    rotateX.value = withSpring(0, RESET_SPRING);
    rotateY.value = withSpring(0, RESET_SPRING);
    scale.value = withSpring(1, RESET_SPRING);
    isActive.value = false;
  }, [rotateX, rotateY, scale, isActive]);

  return {
    animatedStyle,
    gesture,
    onLayout,
    isActive,
    reset,
  };
}

export default useParallaxTilt;
