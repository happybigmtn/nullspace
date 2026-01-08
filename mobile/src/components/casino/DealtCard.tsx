/**
 * DealtCard - Card with dealing trajectory animation (DS-045)
 *
 * Implements casino-style card dealing with:
 * - Arc trajectory from dealer position (top-center)
 * - Rotation during flight (45° → 0°) for authentic dealer motion
 * - Scale bounce landing with spring overshoot
 * - Staggered timing via dealIndex for choreographed dealing
 * - **Sequential flip: card flips AFTER reaching destination**
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
import React, { useEffect, useRef, useCallback, useState } from 'react';
import { View, StyleSheet, LayoutChangeEvent, Dimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import {
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
import { GestureDetector } from 'react-native-gesture-handler';
import { Card, HiddenCard } from './Card';
import { haptics } from '../../services/haptics';
import { SPRING, STAGGER } from '../../constants/theme';
import { useParallaxTilt } from '../../hooks/useParallaxTilt';
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
  /**
   * DS-055: Enable 3D parallax tilt after card lands
   * Card becomes interactive with touch-based 3D rotation
   */
  enableParallax?: boolean;
  /** DS-055: Maximum rotation amplitude in degrees (default: 12) */
  parallaxAmplitude?: number;
  /** DS-055: Scale when touching card (default: 1.05) */
  parallaxScale?: number;
}

/** Default stagger delay between cards (ms) - uses STAGGER.normal (50ms) for premium feel */
const DEFAULT_STAGGER_MS = STAGGER.normal;

/** Duration of the deal trajectory (ms) */
const DEAL_DURATION_MS = 350;

/** Arc height as percentage of travel distance */
const ARC_HEIGHT_RATIO = 0.25;

/**
 * DS-045: Flight rotation range (degrees)
 * Card starts at 45° (like being pulled from a deck at angle)
 * and rotates to 0° (flat) as it reaches destination
 */
const FLIGHT_ROTATION_START_DEG = 45;
const FLIGHT_ROTATION_END_DEG = 0;

/** Landing bounce scale overshoot */
const LANDING_SCALE_PEAK = 1.08;

/** Delay before flip starts after landing (ms) */
const FLIP_DELAY_AFTER_LANDING_MS = 80;

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
  enableParallax = false,
  parallaxAmplitude = 12,
  parallaxScale = 1.05,
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

  /**
   * DS-045: Sequential flip state
   * Card starts face down during flight, flips AFTER reaching destination
   */
  const [shouldFlip, setShouldFlip] = useState(skipAnimation ? faceUp : false);

  /**
   * DS-055: Track if deal animation has completed for parallax activation
   */
  const [dealCompleted, setDealCompleted] = useState(skipAnimation);

  /**
   * DS-055: Parallax tilt hook - only active after card lands
   */
  const {
    animatedStyle: parallaxStyle,
    gesture: parallaxGesture,
    onLayout: parallaxLayout,
  } = useParallaxTilt({
    rotateAmplitude: parallaxAmplitude,
    scaleOnTouch: parallaxScale,
    enabled: enableParallax && dealCompleted,
  });

  // Get screen dimensions for default dealer position
  const { width: screenWidth } = Dimensions.get('window');
  const defaultDealerPos: DealerPosition = dealerPosition ?? {
    x: screenWidth / 2,
    y: -100, // Above visible area
  };

  /**
   * DS-045: Trigger flip after landing - card flips to face up after reaching position
   */
  const triggerFlipAfterLanding = useCallback(() => {
    if (faceUp && !shouldFlip) {
      setShouldFlip(true);
    }
  }, [faceUp, shouldFlip]);

  /**
   * Trigger haptic on landing - run via runOnJS from worklet
   */
  const triggerLandingHaptic = useCallback(() => {
    if (!dealCompleteRef.current) {
      dealCompleteRef.current = true;
      haptics.cardDeal().catch(() => {});
      onDealCompleteRef.current?.();
      // DS-055: Mark deal as completed for parallax activation
      setDealCompleted(true);
      // DS-045: Trigger flip after a brief delay for smooth sequencing
      setTimeout(triggerFlipAfterLanding, FLIP_DELAY_AFTER_LANDING_MS);
    }
  }, [triggerFlipAfterLanding]);

  /**
   * Capture card's final position on layout
   * DS-055: Also captures dimensions for parallax tilt
   */
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { x, y } = event.nativeEvent.layout;
    cardPosition.current = { x, y };
    // DS-055: Also call parallax layout for dimension tracking
    parallaxLayout(event);
  }, [parallaxLayout]);

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

    /**
     * DS-045: Rotation during flight (45° → 0°)
     * Card starts tilted (like being pulled from angled deck)
     * and rotates to flat as it reaches destination
     * Smooth easeOut curve for professional dealer motion
     */
    const rotation = interpolate(
      dealProgress.value,
      [0, 0.4, 0.8, 1],
      [FLIGHT_ROTATION_START_DEG, FLIGHT_ROTATION_START_DEG * 0.5, FLIGHT_ROTATION_END_DEG + 2, FLIGHT_ROTATION_END_DEG],
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

  /**
   * DS-055: Render with parallax if enabled
   * Wraps in GestureDetector and applies parallax transforms after deal completes
   */
  const cardContent = (
    <Card
      suit={suit}
      rank={rank}
      faceUp={shouldFlip}
      size={size}
      onFlipComplete={onFlipComplete}
    />
  );

  // DS-055: When parallax is enabled and deal is complete, wrap with gesture detector
  if (enableParallax && dealCompleted) {
    return (
      <Animated.View
        style={[styles.container, trajectoryStyle]}
        onLayout={handleLayout}
      >
        <GestureDetector gesture={parallaxGesture}>
          <Animated.View style={[styles.parallaxContainer, parallaxStyle]}>
            {cardContent}
          </Animated.View>
        </GestureDetector>
      </Animated.View>
    );
  }

  // Standard render without parallax
  return (
    <Animated.View
      style={[styles.container, trajectoryStyle]}
      onLayout={handleLayout}
    >
      {cardContent}
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

    /**
     * DS-045: Rotation during flight (45° → 0°)
     * Same rotation as DealtCard for consistency
     */
    const rotation = interpolate(
      dealProgress.value,
      [0, 0.4, 0.8, 1],
      [FLIGHT_ROTATION_START_DEG, FLIGHT_ROTATION_START_DEG * 0.5, FLIGHT_ROTATION_END_DEG + 2, FLIGHT_ROTATION_END_DEG],
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
  // DS-055: Parallax container for 3D transforms
  // Note: React Native handles perspective via transform array
  parallaxContainer: {},
});
