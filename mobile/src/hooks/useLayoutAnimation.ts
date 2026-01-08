/**
 * useLayoutAnimation - FLIP-based layout animation hook for React Native
 *
 * DS-054: Layout animation system for list reordering and content changes
 *
 * FLIP = First, Last, Invert, Play
 * 1. First - Record element positions before change
 * 2. Last - Let layout update, record new positions
 * 3. Invert - Apply transforms to put elements back at old positions
 * 4. Play - Animate transforms back to zero (with spring physics)
 *
 * Features:
 * - Elements animate position when layout changes
 * - Works with add/remove list items
 * - Stagger delays for multiple moving elements
 * - Spring physics for natural settling (Reanimated)
 * - Native driver for 60fps performance
 * - Respects prefers-reduced-motion
 *
 * Note: React Native's LayoutAnimation API is simpler but less flexible.
 * This hook provides more control over individual element animations.
 */
import { useRef, useCallback, useEffect, type RefObject } from 'react';
import type { View, LayoutChangeEvent } from 'react-native';
import {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
  runOnJS,
} from 'react-native-reanimated';
import { useReducedMotion } from './useReducedMotion';
import { ANIMATION } from '../constants/theme';

// Default stagger delay between elements (ms)
const DEFAULT_STAGGER = 30;

// Spring config for layout animations
const LAYOUT_SPRING = {
  damping: 18,
  stiffness: 140,
  mass: 0.8,
};

interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Single element layout animation hook
 *
 * Use when you have a single element that may move position.
 * The element will animate smoothly to its new position.
 *
 * @example
 * ```tsx
 * function MovingCard({ position }: { position: number }) {
 *   const { onLayout, animatedStyle } = useLayoutAnimation(position);
 *
 *   return (
 *     <Animated.View onLayout={onLayout} style={[styles.card, animatedStyle]}>
 *       <Text>Card content</Text>
 *     </Animated.View>
 *   );
 * }
 * ```
 */
export function useLayoutAnimation<T = unknown>(
  /** Dependency that triggers layout change (e.g., position, index) */
  dependency: T
) {
  const prefersReducedMotion = useReducedMotion();
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const previousRect = useRef<ElementRect | null>(null);
  const currentRect = useRef<ElementRect | null>(null);
  const isFirstLayout = useRef(true);

  // Capture new position on layout
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    currentRect.current = { x, y, width, height };

    // If we have a previous position, calculate delta
    if (previousRect.current && !isFirstLayout.current) {
      const deltaX = previousRect.current.x - x;
      const deltaY = previousRect.current.y - y;

      // Start from old position
      translateX.value = deltaX;
      translateY.value = deltaY;

      // Animate to new position (0, 0)
      if (!prefersReducedMotion) {
        translateX.value = withSpring(0, LAYOUT_SPRING);
        translateY.value = withSpring(0, LAYOUT_SPRING);
      } else {
        translateX.value = 0;
        translateY.value = 0;
      }
    }

    // Store current as previous for next change
    previousRect.current = { x, y, width, height };
    isFirstLayout.current = false;
  }, [prefersReducedMotion, translateX, translateY]);

  // Reset animation values when dependency changes
  useEffect(() => {
    // Save current position before dependency change
    if (currentRect.current) {
      previousRect.current = { ...currentRect.current };
    }
  }, [dependency]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  return {
    onLayout,
    animatedStyle,
  };
}

/**
 * List item layout animation hook
 *
 * Use for individual items in a list that may reorder.
 * Each item manages its own animation state.
 *
 * @example
 * ```tsx
 * function ListItem({ item, index }: { item: Item; index: number }) {
 *   const { onLayout, animatedStyle } = useListItemAnimation(item.id, index);
 *
 *   return (
 *     <Animated.View onLayout={onLayout} style={[styles.item, animatedStyle]}>
 *       <Text>{item.content}</Text>
 *     </Animated.View>
 *   );
 * }
 * ```
 */
export function useListItemAnimation(
  /** Unique key for this item */
  key: string,
  /** Current index in list */
  index: number,
  /** Stagger delay (ms per item) */
  stagger = DEFAULT_STAGGER
) {
  const prefersReducedMotion = useReducedMotion();
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const previousRect = useRef<ElementRect | null>(null);
  const isFirstLayout = useRef(true);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;

    // If we have a previous position, animate from there
    if (previousRect.current && !isFirstLayout.current) {
      const deltaX = previousRect.current.x - x;
      const deltaY = previousRect.current.y - y;

      // Only animate if there's actual movement
      if (deltaX !== 0 || deltaY !== 0) {
        translateX.value = deltaX;
        translateY.value = deltaY;

        if (!prefersReducedMotion) {
          // Stagger based on index
          const delay = index * stagger;
          translateX.value = withDelay(delay, withSpring(0, LAYOUT_SPRING));
          translateY.value = withDelay(delay, withSpring(0, LAYOUT_SPRING));
        } else {
          translateX.value = 0;
          translateY.value = 0;
        }
      }
    }

    previousRect.current = { x, y, width, height };
    isFirstLayout.current = false;
  }, [index, stagger, prefersReducedMotion, translateX, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  return {
    onLayout,
    animatedStyle,
  };
}

/**
 * Enter animation hook for new list items
 *
 * Animates items as they're added to a list with fade + slide.
 *
 * @example
 * ```tsx
 * function NewItem({ item, index }: { item: Item; index: number }) {
 *   const animatedStyle = useEnterAnimation(index);
 *
 *   return (
 *     <Animated.View style={[styles.item, animatedStyle]}>
 *       <Text>{item.content}</Text>
 *     </Animated.View>
 *   );
 * }
 * ```
 */
export function useEnterAnimation(
  /** Index for stagger calculation */
  index: number,
  /** Stagger delay (ms per item) */
  stagger = DEFAULT_STAGGER
) {
  const prefersReducedMotion = useReducedMotion();
  const opacity = useSharedValue(prefersReducedMotion ? 1 : 0);
  const translateY = useSharedValue(prefersReducedMotion ? 0 : 20);
  const scale = useSharedValue(prefersReducedMotion ? 1 : 0.95);

  useEffect(() => {
    if (prefersReducedMotion) return;

    const delay = index * stagger;

    opacity.value = withDelay(delay, withSpring(1, LAYOUT_SPRING));
    translateY.value = withDelay(delay, withSpring(0, LAYOUT_SPRING));
    scale.value = withDelay(delay, withSpring(1, LAYOUT_SPRING));
  }, [index, stagger, prefersReducedMotion, opacity, translateY, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return animatedStyle;
}

/**
 * Exit animation hook for removing list items
 *
 * Returns animation trigger and style for exit animation.
 * Call `exit()` before removing the item from state.
 *
 * @example
 * ```tsx
 * function RemovableItem({ item, onRemove }: Props) {
 *   const { exit, animatedStyle, isExiting } = useExitAnimation();
 *
 *   const handleRemove = async () => {
 *     await exit();
 *     onRemove(item.id);
 *   };
 *
 *   return (
 *     <Animated.View style={[styles.item, animatedStyle]}>
 *       <Text>{item.content}</Text>
 *       <Button onPress={handleRemove} disabled={isExiting}>Remove</Button>
 *     </Animated.View>
 *   );
 * }
 * ```
 */
export function useExitAnimation(
  /** Animation duration (ms) */
  duration = 300
) {
  const prefersReducedMotion = useReducedMotion();
  const opacity = useSharedValue(1);
  const translateX = useSharedValue(0);
  const scale = useSharedValue(1);
  const isExiting = useSharedValue(false);

  const exit = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      if (prefersReducedMotion) {
        resolve();
        return;
      }

      isExiting.value = true;

      // Animate out to the right with fade
      opacity.value = withSpring(0, { ...LAYOUT_SPRING, damping: 20 });
      translateX.value = withSpring(50, LAYOUT_SPRING);
      scale.value = withSpring(0.9, LAYOUT_SPRING, (finished) => {
        if (finished) {
          runOnJS(resolve)();
        }
      });

      // Fallback timeout in case spring doesn't finish
      setTimeout(resolve, duration + 100);
    });
  }, [prefersReducedMotion, opacity, translateX, scale, isExiting, duration]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: translateX.value },
      { scale: scale.value },
    ],
  }));

  return {
    exit,
    animatedStyle,
    isExiting: isExiting.value,
  };
}

/**
 * Shared element transition helper
 *
 * Creates a smooth transition between two positions.
 * Useful for hero animations between screens.
 *
 * @example
 * ```tsx
 * function HeroImage({ sourceRect, targetRect }: Props) {
 *   const animatedStyle = useSharedElementTransition(sourceRect, targetRect);
 *
 *   return (
 *     <Animated.Image source={image} style={[styles.image, animatedStyle]} />
 *   );
 * }
 * ```
 */
export function useSharedElementTransition(
  /** Source element rect (from previous screen) */
  sourceRect: ElementRect | null,
  /** Target element rect (current screen) */
  targetRect: ElementRect | null
) {
  const prefersReducedMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!sourceRect || !targetRect) return;

    if (prefersReducedMotion) {
      progress.value = 1;
      return;
    }

    progress.value = withSpring(1, {
      ...LAYOUT_SPRING,
      damping: 20,
      stiffness: 100,
    });
  }, [sourceRect, targetRect, prefersReducedMotion, progress]);

  const animatedStyle = useAnimatedStyle(() => {
    if (!sourceRect || !targetRect) {
      return {};
    }

    const p = progress.value;

    // Interpolate position
    const x = sourceRect.x + (targetRect.x - sourceRect.x) * p;
    const y = sourceRect.y + (targetRect.y - sourceRect.y) * p;

    // Interpolate size
    const width = sourceRect.width + (targetRect.width - sourceRect.width) * p;
    const height = sourceRect.height + (targetRect.height - sourceRect.height) * p;

    return {
      position: 'absolute',
      left: x,
      top: y,
      width,
      height,
    };
  });

  return animatedStyle;
}

export default useLayoutAnimation;
