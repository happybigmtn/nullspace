/**
 * StaggerContainer - Choreographed stagger entrance animations
 *
 * DS-043: Creates cascading reveal animations for list items
 *
 * Features:
 * - Sequential fade + translateY + scale entrance
 * - Configurable stagger delay (default 50ms)
 * - Uses SPRING_LIQUID.liquidFloat for natural bounce
 * - Respects prefers-reduced-motion
 * - Can delay start for header settle
 *
 * Usage:
 * ```tsx
 * <StaggerContainer index={idx} initialDelay={200}>
 *   <MyCard />
 * </StaggerContainer>
 * ```
 */
import React from 'react';
import { ViewStyle, StyleProp } from 'react-native';
import Animated, {
  FadeInUp,
  FadeInDown,
  FadeInLeft,
  FadeInRight,
  FadeIn,
  LinearTransition,
  SlideInDown,
  BaseAnimationBuilder,
  EntryExitAnimationFunction,
} from 'react-native-reanimated';
import { SPRING_LIQUID, STAGGER } from '@nullspace/design-tokens';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/**
 * Spring configuration for stagger animations
 * liquidFloat: light floating motion - minimal mass, gentle settle
 */
const STAGGER_SPRING = {
  mass: SPRING_LIQUID.liquidFloat.mass,
  stiffness: SPRING_LIQUID.liquidFloat.stiffness,
  damping: SPRING_LIQUID.liquidFloat.damping,
};

/**
 * Direction of the entrance animation
 */
export type StaggerDirection = 'up' | 'down' | 'left' | 'right' | 'fade';

/**
 * Props for StaggerContainer
 */
export interface StaggerContainerProps {
  children: React.ReactNode;

  /**
   * Index of this item in the list (0-based)
   * Used to calculate stagger delay
   */
  index: number;

  /**
   * Delay between each item's entrance in ms
   * @default 50 (from STAGGER.normal)
   */
  staggerDelay?: number;

  /**
   * Initial delay before first item enters
   * Use to wait for header to settle
   * @default 0
   */
  initialDelay?: number;

  /**
   * Direction of entrance animation
   * @default 'up'
   */
  direction?: StaggerDirection;

  /**
   * Distance to translate from (pixels)
   * @default 20
   */
  translateDistance?: number;

  /**
   * Scale to animate from (0-1)
   * @default 0.95
   */
  initialScale?: number;

  /**
   * Custom style for the container
   */
  style?: StyleProp<ViewStyle>;

  /**
   * Custom entering animation (overrides direction)
   */
  entering?: BaseAnimationBuilder | EntryExitAnimationFunction;

  /**
   * Whether to disable the animation
   * @default false
   */
  disabled?: boolean;
}

/**
 * Get the appropriate entering animation based on direction
 */
function getEnteringAnimation(
  direction: StaggerDirection,
  delay: number,
  reducedMotion: boolean
): BaseAnimationBuilder | undefined {
  // No animation for reduced motion
  if (reducedMotion) {
    return FadeIn.duration(0);
  }

  const animations: Record<StaggerDirection, BaseAnimationBuilder> = {
    up: FadeInUp.delay(delay).springify().mass(STAGGER_SPRING.mass).stiffness(STAGGER_SPRING.stiffness).damping(STAGGER_SPRING.damping),
    down: FadeInDown.delay(delay).springify().mass(STAGGER_SPRING.mass).stiffness(STAGGER_SPRING.stiffness).damping(STAGGER_SPRING.damping),
    left: FadeInLeft.delay(delay).springify().mass(STAGGER_SPRING.mass).stiffness(STAGGER_SPRING.stiffness).damping(STAGGER_SPRING.damping),
    right: FadeInRight.delay(delay).springify().mass(STAGGER_SPRING.mass).stiffness(STAGGER_SPRING.stiffness).damping(STAGGER_SPRING.damping),
    fade: FadeIn.delay(delay).duration(300),
  };

  return animations[direction];
}

/**
 * StaggerContainer Component
 *
 * Wraps children with a choreographed entrance animation.
 * Each item in a list should have an incrementing index for cascading effect.
 */
export function StaggerContainer({
  children,
  index,
  staggerDelay = STAGGER.normal,
  initialDelay = 0,
  direction = 'up',
  style,
  entering,
  disabled = false,
}: StaggerContainerProps): React.ReactElement {
  const prefersReducedMotion = useReducedMotion();

  // Calculate total delay for this item
  const totalDelay = initialDelay + index * staggerDelay;

  // Determine the entering animation
  const enteringAnimation = disabled
    ? undefined
    : entering ?? getEnteringAnimation(direction, totalDelay, prefersReducedMotion);

  return (
    <Animated.View
      entering={enteringAnimation}
      layout={disabled ? undefined : LinearTransition}
      style={style}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Props for StaggerList - convenience wrapper for mapping over data
 */
export interface StaggerListProps<T> {
  data: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  keyExtractor: (item: T, index: number) => string;
  staggerDelay?: number;
  initialDelay?: number;
  direction?: StaggerDirection;
  style?: StyleProp<ViewStyle>;
  itemStyle?: StyleProp<ViewStyle>;
}

/**
 * StaggerList Component
 *
 * Convenience wrapper that maps over data and applies stagger to each item.
 * For simple lists where you don't need FlatList virtualization.
 */
export function StaggerList<T>({
  data,
  renderItem,
  keyExtractor,
  staggerDelay = STAGGER.normal,
  initialDelay = 0,
  direction = 'up',
  style,
  itemStyle,
}: StaggerListProps<T>): React.ReactElement {
  return (
    <Animated.View style={style}>
      {data.map((item, index) => (
        <StaggerContainer
          key={keyExtractor(item, index)}
          index={index}
          staggerDelay={staggerDelay}
          initialDelay={initialDelay}
          direction={direction}
          style={itemStyle}
        >
          {renderItem(item, index)}
        </StaggerContainer>
      ))}
    </Animated.View>
  );
}

/**
 * Hook for generating stagger animation props
 * Use when you need more control than StaggerContainer provides
 */
export function useStaggerEntering(
  index: number,
  options: {
    staggerDelay?: number;
    initialDelay?: number;
    direction?: StaggerDirection;
  } = {}
): BaseAnimationBuilder | undefined {
  const { staggerDelay = STAGGER.normal, initialDelay = 0, direction = 'up' } = options;
  const prefersReducedMotion = useReducedMotion();

  const totalDelay = initialDelay + index * staggerDelay;
  return getEnteringAnimation(direction, totalDelay, prefersReducedMotion);
}

export default StaggerContainer;
