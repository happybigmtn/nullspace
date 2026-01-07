/**
 * DealtCard - Card with dealing trajectory animation
 *
 * Implements casino-style card dealing with:
 * - Arc trajectory from dealer position (top-center)
 * - Slight rotation mid-flight for realism
 * - Scale bounce landing with spring overshoot
 * - Staggered timing via delay prop
 * - Haptic feedback synced to landing moment
 *
 * @example
 * // Basic usage with staggered dealing
 * {cards.map((card, i) => (
 *   <DealtCard
 *     key={i}
 *     suit={card.suit}
 *     rank={card.rank}
 *     faceUp={true}
 *     dealIndex={i}
 *     dealerPosition={{ x: screenWidth / 2, y: 0 }}
 *   />
 * ))}
 */
import React, { useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet, LayoutChangeEvent, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  withDelay,
  interpolate,
  Extrapolate,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { Card, HiddenCard } from './Card';
import { haptics } from '../../services/haptics';
import { SPRING } from '../../constants/theme';
import type { Suit, Rank } from '../../types';

/** Position coordinates for dealer origin */
export interface DealerPosition {
  /** X coordinate of dealer position (typically screen center) */
  x: number;
  /** Y coordinate of dealer position (typically 0 or top of game area) */
  y: number;
}

export interface DealtCardProps {
  /** Card suit */
  suit: Suit;
  /** Card rank */
  rank: Rank;
  /** Whether card should be face up after dealing */
  faceUp: boolean;
  /** Card size variant */
  size?: 'small' | 'normal' | 'large';
  /** Index in deal sequence for stagger timing (0-based) */
  dealIndex?: number;
  /** Custom dealer position override */
  dealerPosition?: DealerPosition;
  /** Stagger delay between cards in ms */
  staggerDelayMs?: number;
  /** Skip deal animation (for cards already on table) */
  skipAnimation?: boolean;
  /** Callback when deal animation completes */
  onDealComplete?: () => void;
  /** Callback when flip animation completes */
  onFlipComplete?: () => void;
}

/** Default stagger delay between cards (ms) */
const DEFAULT_STAGGER_MS = 120;

/** Duration of the deal trajectory (ms) */
const DEAL_DURATION_MS = 350;

/** Arc height as percentage of travel distance */
const ARC_HEIGHT_RATIO = 0.25;

/** Max rotation during flight (degrees) */
const FLIGHT_ROTATION_DEG = 8;

/** Landing bounce scale overshoot */
const LANDING_SCALE_PEAK = 1.08;

/**
 * Spring config for landing bounce - slightly more dramatic than cardDeal
 * Higher stiffness for snappy landing, lower damping for visible bounce
 */
const LANDING_SPRING = {
  mass: SPRING.cardDeal.mass,
  stiffness: SPRING.cardDeal.stiffness * 1.2,
  damping: SPRING.cardDeal.damping * 0.85,
};

export function DealtCard({
  suit,
  rank,
  faceUp,
  size = 'normal',
  dealIndex = 0,
  dealerPosition,
  staggerDelayMs = DEFAULT_STAGGER_MS,
  skipAnimation = false,
  onDealComplete,
  onFlipComplete,
}: DealtCardProps) {
  // Animation progress: 0 = at dealer, 1 = at destination
  const dealProgress = useSharedValue(skipAnimation ? 1 : 0);

  // Landing bounce scale
  const landingScale = useSharedValue(skipAnimation ? 1 : 0.8);

  // Card position ref for calculating trajectory
  const cardPosition = useRef({ x: 0, y: 0 });

  // Track if deal completed for haptic sync
  const dealCompleteRef = useRef(false);
  const onDealCompleteRef = useRef(onDealComplete);
  onDealCompleteRef.current = onDealComplete;

  // Get screen dimensions for default dealer position
  const { width: screenWidth } = Dimensions.get('window');
  const defaultDealerPos: DealerPosition = dealerPosition ?? {
    x: screenWidth / 2,
    y: -100, // Above visible area
  };

  /**
   * Trigger haptic on landing - run via runOnJS from worklet
   */
  const triggerLandingHaptic = useCallback(() => {
    if (!dealCompleteRef.current) {
      dealCompleteRef.current = true;
      haptics.cardDeal().catch(() => {});
      onDealCompleteRef.current?.();
    }
  }, []);

  /**
   * Capture card's final position on layout
   */
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { x, y } = event.nativeEvent.layout;
    cardPosition.current = { x, y };
  }, []);

  /**
   * Start deal animation with staggered delay
   */
  useEffect(() => {
    if (skipAnimation || process.env.NODE_ENV === 'test') return;

    const staggerDelay = dealIndex * staggerDelayMs;

    // Animate deal progress from 0 to 1 with easeOutQuad
    dealProgress.value = withDelay(
      staggerDelay,
      withTiming(1, {
        duration: DEAL_DURATION_MS,
        easing: Easing.out(Easing.quad),
      })
    );

    // Landing bounce: start small, overshoot to peak, settle to 1
    landingScale.value = withDelay(
      staggerDelay,
      withSequence(
        // Stay small during flight
        withTiming(0.85, { duration: DEAL_DURATION_MS * 0.7 }),
        // Spring to overshoot peak
        withSpring(LANDING_SCALE_PEAK, LANDING_SPRING, (finished) => {
          'worklet';
          if (finished) {
            runOnJS(triggerLandingHaptic)();
          }
        }),
        // Settle to final scale
        withSpring(1, {
          mass: LANDING_SPRING.mass,
          stiffness: LANDING_SPRING.stiffness * 0.8,
          damping: LANDING_SPRING.damping * 1.2,
        })
      )
    );
  }, [dealIndex, staggerDelayMs, skipAnimation, dealProgress, landingScale, triggerLandingHaptic]);

  /**
   * Animated style for trajectory movement
   * - X/Y translation from dealer to destination
   * - Arc path via parabolic Y offset
   * - Rotation during flight
   * - Scale bounce on landing
   */
  const trajectoryStyle = useAnimatedStyle(() => {
    // Calculate travel distance (from dealer position to card position)
    // Since we're animating relative to final position, we animate from offset to 0
    const startX = defaultDealerPos.x - cardPosition.current.x - 40; // Card center offset
    const startY = defaultDealerPos.y - cardPosition.current.y;

    // Linear interpolation for X (horizontal slide)
    const translateX = interpolate(
      dealProgress.value,
      [0, 1],
      [startX, 0],
      Extrapolate.CLAMP
    );

    // Y interpolation with arc (parabolic curve)
    // Peak of arc at progress=0.5
    const arcHeight = Math.abs(startY) * ARC_HEIGHT_RATIO;
    const baseY = interpolate(
      dealProgress.value,
      [0, 1],
      [startY, 0],
      Extrapolate.CLAMP
    );
    // Parabolic offset: peaks at 0.5, zero at 0 and 1
    const arcOffset = -arcHeight * 4 * dealProgress.value * (1 - dealProgress.value);
    const translateY = baseY + arcOffset;

    // Rotation during flight - tilts forward then back
    const rotation = interpolate(
      dealProgress.value,
      [0, 0.3, 0.7, 1],
      [FLIGHT_ROTATION_DEG, FLIGHT_ROTATION_DEG * 1.5, -FLIGHT_ROTATION_DEG * 0.5, 0],
      Extrapolate.CLAMP
    );

    return {
      transform: [
        { translateX },
        { translateY },
        { rotate: `${rotation}deg` },
        { scale: landingScale.value },
      ],
      // Fade in as card enters (first 20% of animation)
      opacity: interpolate(
        dealProgress.value,
        [0, 0.2, 1],
        [0, 1, 1],
        Extrapolate.CLAMP
      ),
    };
  });

  return (
    <Animated.View
      style={[styles.container, trajectoryStyle]}
      onLayout={handleLayout}
    >
      <Card
        suit={suit}
        rank={rank}
        faceUp={faceUp}
        size={size}
        onFlipComplete={onFlipComplete}
      />
    </Animated.View>
  );
}

/**
 * Dealt hidden card with trajectory animation
 * For dealer's face-down card that stays hidden
 */
export function DealtHiddenCard({
  size = 'normal',
  dealIndex = 0,
  dealerPosition,
  staggerDelayMs = DEFAULT_STAGGER_MS,
  skipAnimation = false,
  onDealComplete,
}: Omit<DealtCardProps, 'suit' | 'rank' | 'faceUp' | 'onFlipComplete'>) {
  const dealProgress = useSharedValue(skipAnimation ? 1 : 0);
  const landingScale = useSharedValue(skipAnimation ? 1 : 0.8);
  const cardPosition = useRef({ x: 0, y: 0 });
  const dealCompleteRef = useRef(false);
  const onDealCompleteRef = useRef(onDealComplete);
  onDealCompleteRef.current = onDealComplete;

  const { width: screenWidth } = Dimensions.get('window');
  const defaultDealerPos: DealerPosition = dealerPosition ?? {
    x: screenWidth / 2,
    y: -100,
  };

  const triggerLandingHaptic = useCallback(() => {
    if (!dealCompleteRef.current) {
      dealCompleteRef.current = true;
      haptics.cardDeal().catch(() => {});
      onDealCompleteRef.current?.();
    }
  }, []);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { x, y } = event.nativeEvent.layout;
    cardPosition.current = { x, y };
  }, []);

  useEffect(() => {
    if (skipAnimation || process.env.NODE_ENV === 'test') return;

    const staggerDelay = dealIndex * staggerDelayMs;

    dealProgress.value = withDelay(
      staggerDelay,
      withTiming(1, {
        duration: DEAL_DURATION_MS,
        easing: Easing.out(Easing.quad),
      })
    );

    landingScale.value = withDelay(
      staggerDelay,
      withSequence(
        withTiming(0.85, { duration: DEAL_DURATION_MS * 0.7 }),
        withSpring(LANDING_SCALE_PEAK, LANDING_SPRING, (finished) => {
          'worklet';
          if (finished) {
            runOnJS(triggerLandingHaptic)();
          }
        }),
        withSpring(1, {
          mass: LANDING_SPRING.mass,
          stiffness: LANDING_SPRING.stiffness * 0.8,
          damping: LANDING_SPRING.damping * 1.2,
        })
      )
    );
  }, [dealIndex, staggerDelayMs, skipAnimation, dealProgress, landingScale, triggerLandingHaptic]);

  const trajectoryStyle = useAnimatedStyle(() => {
    const startX = defaultDealerPos.x - cardPosition.current.x - 40;
    const startY = defaultDealerPos.y - cardPosition.current.y;

    const translateX = interpolate(
      dealProgress.value,
      [0, 1],
      [startX, 0],
      Extrapolate.CLAMP
    );

    const arcHeight = Math.abs(startY) * ARC_HEIGHT_RATIO;
    const baseY = interpolate(
      dealProgress.value,
      [0, 1],
      [startY, 0],
      Extrapolate.CLAMP
    );
    const arcOffset = -arcHeight * 4 * dealProgress.value * (1 - dealProgress.value);
    const translateY = baseY + arcOffset;

    const rotation = interpolate(
      dealProgress.value,
      [0, 0.3, 0.7, 1],
      [FLIGHT_ROTATION_DEG, FLIGHT_ROTATION_DEG * 1.5, -FLIGHT_ROTATION_DEG * 0.5, 0],
      Extrapolate.CLAMP
    );

    return {
      transform: [
        { translateX },
        { translateY },
        { rotate: `${rotation}deg` },
        { scale: landingScale.value },
      ],
      opacity: interpolate(
        dealProgress.value,
        [0, 0.2, 1],
        [0, 1, 1],
        Extrapolate.CLAMP
      ),
    };
  });

  return (
    <Animated.View
      style={[styles.container, trajectoryStyle]}
      onLayout={handleLayout}
    >
      <HiddenCard size={size} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    // Position relative for trajectory animation
  },
});
