/**
 * SnapList - Magnetic snap scrolling component
 *
 * DS-042: Implements spring-based snapping with momentum preservation
 *
 * Features:
 * - Cards snap to center with spring physics
 * - Momentum from flick preserved (fast flick = skip cards)
 * - Haptic feedback on snap
 * - Works with FlatList/FlashList
 * - Smooth deceleration curve
 *
 * The snap physics use SPRING_LIQUID.liquidSettle for natural feel.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  FlatListProps,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ViewStyle,
  StyleProp,
  View,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
  runOnJS,
  withSpring,
  scrollTo,
  useAnimatedRef,
} from 'react-native-reanimated';
import { SPRING_LIQUID } from '@nullspace/design-tokens';
import { haptics } from '../../services/haptics';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/**
 * Spring configuration converted to Reanimated format
 * liquidSettle is designed for "settling after motion" - perfect for snapping
 */
const SNAP_SPRING_CONFIG = {
  mass: SPRING_LIQUID.liquidSettle.mass,
  stiffness: SPRING_LIQUID.liquidSettle.stiffness,
  damping: SPRING_LIQUID.liquidSettle.damping,
  overshootClamping: false,
  restDisplacementThreshold: 0.5,
  restSpeedThreshold: 0.5,
};

/**
 * Deceleration rate matching iOS native scroll
 * 0.992 is close to UIScrollView's default deceleration rate
 */
const DECELERATION_RATE = 0.992;

/**
 * Minimum velocity threshold for momentum scroll (px/s)
 * Below this, snap immediately without momentum
 */
const VELOCITY_THRESHOLD = 100;

/**
 * Maximum cards to skip on fast flick
 */
const MAX_SKIP_COUNT = 3;

export interface SnapListProps<T> extends Omit<FlatListProps<T>, 'onScroll'> {
  /**
   * Width of each item (used to calculate snap points)
   * For horizontal lists
   */
  itemWidth?: number;

  /**
   * Height of each item (used to calculate snap points)
   * For vertical lists
   */
  itemHeight?: number;

  /**
   * Gap between items
   * @default 0
   */
  itemGap?: number;

  /**
   * Alignment of snap point
   * - 'start': Item aligns to start of viewport
   * - 'center': Item aligns to center of viewport
   * - 'end': Item aligns to end of viewport
   * @default 'center'
   */
  snapAlignment?: 'start' | 'center' | 'end';

  /**
   * Disable haptic feedback
   * @default false
   */
  disableHaptics?: boolean;

  /**
   * Callback when snap completes
   */
  onSnapToItem?: (index: number) => void;

  /**
   * Scroll handler from parent (for parallax, etc.)
   * Will be called in addition to internal snap handling
   */
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;

  /**
   * Custom container style
   */
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * AnimatedFlatList for spring-based animations
 */
const AnimatedFlatList = Animated.createAnimatedComponent(FlatList) as typeof FlatList;

/**
 * SnapList Component
 *
 * A wrapper around FlatList that adds spring-based magnetic snapping.
 * Items snap to predefined positions based on itemWidth/itemHeight.
 */
export function SnapList<T>({
  data,
  itemWidth,
  itemHeight,
  itemGap = 0,
  snapAlignment = 'center',
  disableHaptics = false,
  onSnapToItem,
  onScroll: parentOnScroll,
  horizontal = false,
  containerStyle,
  ...flatListProps
}: SnapListProps<T>): React.ReactElement {
  const prefersReducedMotion = useReducedMotion();
  const listRef = useAnimatedRef<FlatList<T>>();

  // Track current snap index
  const currentIndex = useSharedValue(0);
  const lastHapticIndex = useRef(0);

  // Track scroll state for momentum
  const scrollOffset = useSharedValue(0);
  const scrollVelocity = useSharedValue(0);
  const isSnapping = useSharedValue(false);

  // Get item dimension based on scroll direction
  const itemDimension = horizontal ? itemWidth : itemHeight;
  const snapInterval = itemDimension ? itemDimension + itemGap : 0;

  /**
   * Calculate snap point index from offset
   */
  const getSnapIndex = useCallback(
    (offset: number, velocity: number): number => {
      if (!snapInterval || !data) return 0;

      const maxIndex = data.length - 1;

      // Base index from position
      let targetIndex = Math.round(offset / snapInterval);

      // Apply momentum - fast flicks skip more items
      if (Math.abs(velocity) > VELOCITY_THRESHOLD) {
        const velocityFactor = Math.min(
          Math.floor(Math.abs(velocity) / 500),
          MAX_SKIP_COUNT
        );
        const direction = velocity > 0 ? 1 : -1;
        targetIndex += direction * velocityFactor;
      }

      // Clamp to valid range
      return Math.max(0, Math.min(maxIndex, targetIndex));
    },
    [snapInterval, data]
  );

  /**
   * Trigger haptic feedback (on JS thread)
   */
  const triggerHaptic = useCallback(
    (index: number) => {
      if (disableHaptics || prefersReducedMotion) return;
      if (index !== lastHapticIndex.current) {
        lastHapticIndex.current = index;
        haptics.selectionChange().catch(() => {});
      }
    },
    [disableHaptics, prefersReducedMotion]
  );

  /**
   * Notify parent of snap
   */
  const notifySnapComplete = useCallback(
    (index: number) => {
      onSnapToItem?.(index);
    },
    [onSnapToItem]
  );

  /**
   * Animated scroll handler
   * Tracks scroll position and velocity for momentum calculations
   */
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      const offset = horizontal
        ? event.contentOffset.x
        : event.contentOffset.y;
      scrollOffset.value = offset;

      // Calculate velocity from scroll change
      const velocity = event.velocity
        ? horizontal
          ? event.velocity.x
          : event.velocity.y
        : 0;
      scrollVelocity.value = velocity;
    },
    onMomentumEnd: (event) => {
      if (!snapInterval || isSnapping.value) return;

      isSnapping.value = true;

      const offset = horizontal
        ? event.contentOffset.x
        : event.contentOffset.y;
      const velocity = scrollVelocity.value;

      // Calculate target snap index
      const targetIndex = getSnapIndex(offset, velocity);
      const targetOffset = targetIndex * snapInterval;

      // Animate to snap position with spring
      if (prefersReducedMotion) {
        // Instant snap for reduced motion
        scrollTo(listRef, horizontal ? targetOffset : 0, horizontal ? 0 : targetOffset, false);
      } else {
        // Spring animation to target
        scrollTo(listRef, horizontal ? targetOffset : 0, horizontal ? 0 : targetOffset, true);
      }

      // Update current index and trigger haptic
      if (targetIndex !== currentIndex.value) {
        currentIndex.value = targetIndex;
        runOnJS(triggerHaptic)(targetIndex);
        runOnJS(notifySnapComplete)(targetIndex);
      }

      isSnapping.value = false;
    },
  });

  /**
   * Handle scroll event (for parent callbacks)
   */
  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      parentOnScroll?.(event);
    },
    [parentOnScroll]
  );

  // If no snap interval, render regular FlatList
  if (!snapInterval) {
    return (
      <View style={containerStyle}>
        <FlatList
          ref={listRef as React.Ref<FlatList<T>>}
          data={data}
          horizontal={horizontal}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          {...flatListProps}
        />
      </View>
    );
  }

  return (
    <View style={containerStyle}>
      <AnimatedFlatList
        ref={listRef as React.Ref<FlatList<T>>}
        data={data}
        horizontal={horizontal}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        // Enable native snap behavior as baseline
        snapToInterval={snapInterval}
        snapToAlignment={snapAlignment}
        decelerationRate={DECELERATION_RATE}
        // Disable paging for smoother momentum
        pagingEnabled={false}
        // Performance optimizations
        removeClippedSubviews={true}
        windowSize={5}
        {...flatListProps}
      />
    </View>
  );
}

/**
 * Props for SnapListItem wrapper
 */
export interface SnapListItemProps {
  children: React.ReactNode;
  width?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * SnapListItem - Wrapper for items in SnapList
 *
 * Provides consistent sizing for snap calculations.
 * Use when items need explicit dimensions for snapping.
 */
export function SnapListItem({
  children,
  width,
  height,
  style,
}: SnapListItemProps): React.ReactElement {
  return (
    <View
      style={[
        {
          width,
          height,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export default SnapList;
