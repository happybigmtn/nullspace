/**
 * Swipe-to-dismiss gesture hook for bottom sheets
 *
 * Uses react-native-reanimated and gesture-handler for smooth
 * iOS-style swipe gesture that dismisses modals/sheets.
 *
 * Features:
 * - Velocity-based threshold (quick swipe dismisses)
 * - Distance-based threshold (slow drag past 30% dismisses)
 * - Spring snap-back if threshold not met
 * - Visual feedback (opacity follows drag progress)
 * - Works with SPRING_LIQUID tokens for organic feel
 */
import { useCallback, useMemo } from 'react';
import {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureUpdateEvent, PanGestureHandlerEventPayload } from 'react-native-gesture-handler';
import { useReducedMotion } from './useReducedMotion';

// Spring config matching SPRING_LIQUID.liquidSlide
const SPRING_CONFIG = {
  mass: 0.7,
  stiffness: 150,
  damping: 16,
};

// Instant config for reduced motion
const INSTANT_CONFIG = {
  duration: 0,
};

interface SwipeToDismissOptions {
  /** Height of the dismissible content (for percentage calculation) */
  contentHeight: number;
  /** Callback when dismiss gesture completes */
  onDismiss: () => void;
  /** Minimum velocity (px/s) to trigger dismiss regardless of distance. Default 500 */
  velocityThreshold?: number;
  /** Distance threshold as percentage of content height. Default 0.3 (30%) */
  distanceThreshold?: number;
  /** Whether swipe gesture is enabled. Default true */
  enabled?: boolean;
}

interface SwipeToDismissResult {
  /** Gesture object to attach to GestureDetector */
  gesture: ReturnType<typeof Gesture.Pan>;
  /** Animated style for the content (translateY and opacity) */
  animatedStyle: ReturnType<typeof useAnimatedStyle>;
  /** Animated style for backdrop (opacity only) */
  backdropStyle: ReturnType<typeof useAnimatedStyle>;
  /** Current translateY value (for external use) */
  translateY: ReturnType<typeof useSharedValue<number>>;
}

/**
 * useSwipeToDismiss - Hook for swipe-to-dismiss bottom sheet gesture
 *
 * @example
 * ```tsx
 * function MySheet({ visible, onClose }) {
 *   const { gesture, animatedStyle, backdropStyle } = useSwipeToDismiss({
 *     contentHeight: 400,
 *     onDismiss: onClose,
 *   });
 *
 *   return (
 *     <GestureDetector gesture={gesture}>
 *       <Animated.View style={[styles.sheet, animatedStyle]}>
 *         {content}
 *       </Animated.View>
 *     </GestureDetector>
 *   );
 * }
 * ```
 */
export function useSwipeToDismiss({
  contentHeight,
  onDismiss,
  velocityThreshold = 500,
  distanceThreshold = 0.3,
  enabled = true,
}: SwipeToDismissOptions): SwipeToDismissResult {
  const prefersReducedMotion = useReducedMotion();

  // Shared values for gesture tracking
  const translateY = useSharedValue(0);
  const contextY = useSharedValue(0);
  const isDismissing = useSharedValue(false);

  // Calculate dismiss threshold in pixels
  const dismissDistance = contentHeight * distanceThreshold;

  // Dismiss handler (needs to be wrapped for worklet)
  const handleDismiss = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  // Pan gesture configuration
  const panGesture = useMemo(() => {
    return Gesture.Pan()
      .enabled(enabled)
      .onStart(() => {
        contextY.value = translateY.value;
      })
      .onUpdate((event: GestureUpdateEvent<PanGestureHandlerEventPayload>) => {
        // Only allow downward drag (positive Y)
        const newY = contextY.value + event.translationY;
        translateY.value = Math.max(0, newY);
      })
      .onEnd((event) => {
        if (isDismissing.value) return;

        const shouldDismiss =
          // Quick swipe down
          event.velocityY > velocityThreshold ||
          // Or dragged past threshold
          translateY.value > dismissDistance;

        if (shouldDismiss) {
          isDismissing.value = true;

          // Animate off screen
          const springConfig = prefersReducedMotion ? INSTANT_CONFIG : SPRING_CONFIG;
          translateY.value = withSpring(
            contentHeight + 50, // Extra padding to ensure it's fully off screen
            springConfig,
            (finished) => {
              if (finished) {
                runOnJS(handleDismiss)();
              }
            }
          );
        } else {
          // Snap back to original position
          const springConfig = prefersReducedMotion ? INSTANT_CONFIG : SPRING_CONFIG;
          translateY.value = withSpring(0, springConfig);
        }
      });
  }, [
    enabled,
    contextY,
    translateY,
    isDismissing,
    velocityThreshold,
    dismissDistance,
    prefersReducedMotion,
    contentHeight,
    handleDismiss,
  ]);

  // Animated style for content
  const animatedStyle = useAnimatedStyle(() => {
    // Calculate opacity based on drag progress (1 at top, fades as dragged)
    const progress = translateY.value / contentHeight;
    const opacity = 1 - progress * 0.5; // Fade to 50% opacity at full drag

    return {
      transform: [{ translateY: translateY.value }],
      opacity: Math.max(0.5, Math.min(1, opacity)),
    };
  }, [contentHeight]);

  // Animated style for backdrop
  const backdropStyle = useAnimatedStyle(() => {
    const progress = translateY.value / contentHeight;
    const opacity = 1 - progress;

    return {
      opacity: Math.max(0, Math.min(1, opacity)),
    };
  }, [contentHeight]);

  return {
    gesture: panGesture,
    animatedStyle,
    backdropStyle,
    translateY,
  };
}

/**
 * Reset the dismiss state (call when modal reopens)
 */
export function useResetSwipeState(
  translateY: ReturnType<typeof useSharedValue<number>>
) {
  return useCallback(() => {
    'worklet';
    translateY.value = withTiming(0, { duration: 0 });
  }, [translateY]);
}

export default useSwipeToDismiss;
