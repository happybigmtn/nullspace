/**
 * Custom parallax screen transitions for premium navigation feel
 *
 * Creates depth perception during navigation by:
 * - Scaling outgoing screens down (moves "away" from user)
 * - Scaling incoming screens up (moves "toward" user)
 * - Adding shadow/elevation changes during transition
 * - Using non-linear easing for momentum feel
 *
 * Compatible with @react-navigation/stack v7
 */

import {
  StackCardStyleInterpolator,
  StackCardInterpolationProps,
} from '@react-navigation/stack';
import { Animated, Easing } from 'react-native';
import { DURATION } from '@nullspace/design-tokens';

/**
 * Non-linear easing curve that simulates momentum/deceleration
 * Starts fast, decelerates naturally like physical objects
 */
const MOMENTUM_EASING = Easing.bezier(0.16, 1, 0.3, 1); // easeOutExpo approximation

/**
 * Scale factors for depth perception
 * Outgoing screen shrinks, incoming screen grows
 */
const SCALE = {
  /** Scale when screen is behind another (pushed back) */
  background: 0.92,
  /** Scale when screen is fully visible */
  foreground: 1,
  /** Slight overshoot for spring-like feel */
  overshoot: 1.02,
} as const;

/**
 * Opacity values for dimming effect on background screens
 */
const OPACITY = {
  background: 0.6,
  foreground: 1,
} as const;

/**
 * Shadow configuration for elevation changes during transition
 */
const SHADOW = {
  /** Elevated state (incoming screen) */
  elevated: {
    shadowOpacity: 0.35,
    shadowRadius: 25,
  },
  /** Background state (outgoing screen) */
  flat: {
    shadowOpacity: 0,
    shadowRadius: 0,
  },
} as const;

/**
 * Parallax slide with depth effect
 *
 * Incoming screen slides from right with scale-up animation
 * Outgoing screen scales down and dims, creating depth perception
 */
export const forParallaxHorizontal: StackCardStyleInterpolator = ({
  current,
  next,
  inverted,
  layouts: { screen },
}: StackCardInterpolationProps) => {
  // Translate X: slide from right edge
  const translateX = Animated.multiply(
    current.progress.interpolate({
      inputRange: [0, 1],
      outputRange: [screen.width, 0],
      extrapolate: 'clamp',
    }),
    inverted
  );

  // Background parallax: when another screen pushes on top
  const backgroundTranslateX = next
    ? Animated.multiply(
        next.progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, screen.width * -0.3], // Parallax offset (30% of screen)
          extrapolate: 'clamp',
        }),
        inverted
      )
    : 0;

  // Scale effect for depth perception
  const scale = current.progress.interpolate({
    inputRange: [0, 1],
    outputRange: [SCALE.overshoot, SCALE.foreground], // Slight shrink on enter for spring feel
    extrapolate: 'clamp',
  });

  // When being pushed to background
  const backgroundScale = next
    ? next.progress.interpolate({
        inputRange: [0, 1],
        outputRange: [SCALE.foreground, SCALE.background],
        extrapolate: 'clamp',
      })
    : SCALE.foreground;

  // Opacity dim when in background
  const opacity = next
    ? next.progress.interpolate({
        inputRange: [0, 1],
        outputRange: [OPACITY.foreground, OPACITY.background],
        extrapolate: 'clamp',
      })
    : OPACITY.foreground;

  // Shadow opacity for depth (incoming screen rises)
  const shadowOpacity = current.progress.interpolate({
    inputRange: [0, 1],
    outputRange: [SHADOW.elevated.shadowOpacity, SHADOW.flat.shadowOpacity],
    extrapolate: 'clamp',
  });

  return {
    cardStyle: {
      transform: [
        { translateX: next ? backgroundTranslateX : translateX },
        { scale: next ? backgroundScale : scale },
      ],
      opacity,
    },
    shadowStyle: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: next ? 0 : shadowOpacity,
      shadowRadius: SHADOW.elevated.shadowRadius,
    },
  };
};

/**
 * Vertical parallax for modal-style presentations
 *
 * Screen slides up from bottom with scale animation
 * Background screen scales down and dims
 */
export const forParallaxVertical: StackCardStyleInterpolator = ({
  current,
  next,
  inverted,
  layouts: { screen },
}: StackCardInterpolationProps) => {
  // Translate Y: slide from bottom
  const translateY = Animated.multiply(
    current.progress.interpolate({
      inputRange: [0, 1],
      outputRange: [screen.height, 0],
      extrapolate: 'clamp',
    }),
    inverted
  );

  // Scale with overshoot for spring feel
  const scale = current.progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.9, SCALE.overshoot, SCALE.foreground],
    extrapolate: 'clamp',
  });

  // Background dim
  const backgroundScale = next
    ? next.progress.interpolate({
        inputRange: [0, 1],
        outputRange: [SCALE.foreground, SCALE.background],
        extrapolate: 'clamp',
      })
    : SCALE.foreground;

  const opacity = next
    ? next.progress.interpolate({
        inputRange: [0, 1],
        outputRange: [OPACITY.foreground, OPACITY.background],
        extrapolate: 'clamp',
      })
    : OPACITY.foreground;

  const shadowOpacity = current.progress.interpolate({
    inputRange: [0, 1],
    outputRange: [SHADOW.elevated.shadowOpacity, 0],
    extrapolate: 'clamp',
  });

  return {
    cardStyle: {
      transform: next
        ? [{ scale: backgroundScale }]
        : [{ translateY }, { scale }],
      opacity,
    },
    shadowStyle: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -8 },
      shadowOpacity: next ? 0 : shadowOpacity,
      shadowRadius: SHADOW.elevated.shadowRadius,
    },
  };
};

/**
 * Fade with depth - minimal movement, maximum subtlety
 *
 * Screens fade with slight scale change for depth perception
 * Used for auth/splash transitions where slide feels too aggressive
 */
export const forFadeWithDepth: StackCardStyleInterpolator = ({
  current,
  next,
}: StackCardInterpolationProps) => {
  // Fade in
  const opacity = current.progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 0.5, 1],
    extrapolate: 'clamp',
  });

  // Subtle scale for depth
  const scale = current.progress.interpolate({
    inputRange: [0, 1],
    outputRange: [1.05, SCALE.foreground],
    extrapolate: 'clamp',
  });

  // Background dimming
  const backgroundOpacity = next
    ? next.progress.interpolate({
        inputRange: [0, 1],
        outputRange: [OPACITY.foreground, OPACITY.background],
        extrapolate: 'clamp',
      })
    : OPACITY.foreground;

  const backgroundScale = next
    ? next.progress.interpolate({
        inputRange: [0, 1],
        outputRange: [SCALE.foreground, 0.95],
        extrapolate: 'clamp',
      })
    : SCALE.foreground;

  return {
    cardStyle: {
      opacity: next ? backgroundOpacity : opacity,
      transform: [{ scale: next ? backgroundScale : scale }],
    },
  };
};

/**
 * Screen transition options with proper timing
 * Pairs with CardStyleInterpolators for complete transition config
 */
export const TransitionSpecs = {
  /**
   * Momentum-based horizontal slide
   * Fast start, gradual deceleration
   */
  ParallaxHorizontalSpec: {
    animation: 'timing' as const,
    config: {
      duration: DURATION.normal,
      easing: MOMENTUM_EASING,
    },
  },

  /**
   * Vertical modal presentation
   * Slightly longer for theatrical effect
   */
  ParallaxVerticalSpec: {
    animation: 'timing' as const,
    config: {
      duration: DURATION.slow,
      easing: MOMENTUM_EASING,
    },
  },

  /**
   * Subtle fade transition
   */
  FadeSpec: {
    animation: 'timing' as const,
    config: {
      duration: DURATION.fast,
      easing: Easing.inOut(Easing.ease),
    },
  },
};

/**
 * Complete screen options for different navigation patterns
 */
export const ParallaxTransitionPresets = {
  /**
   * Default horizontal push with parallax depth
   * Use for: Lobby → Game, Lobby → Settings
   */
  slideWithParallax: {
    cardStyleInterpolator: forParallaxHorizontal,
    transitionSpec: {
      open: TransitionSpecs.ParallaxHorizontalSpec,
      close: TransitionSpecs.ParallaxHorizontalSpec,
    },
    gestureEnabled: true,
    gestureDirection: 'horizontal' as const,
  },

  /**
   * Vertical modal-style with parallax
   * Use for: Full-screen modals, sheets
   */
  modalWithParallax: {
    cardStyleInterpolator: forParallaxVertical,
    transitionSpec: {
      open: TransitionSpecs.ParallaxVerticalSpec,
      close: TransitionSpecs.ParallaxVerticalSpec,
    },
    gestureEnabled: true,
    gestureDirection: 'vertical' as const,
  },

  /**
   * Subtle fade with depth
   * Use for: Splash → Auth, Auth → Lobby
   */
  fadeWithDepth: {
    cardStyleInterpolator: forFadeWithDepth,
    transitionSpec: {
      open: TransitionSpecs.FadeSpec,
      close: TransitionSpecs.FadeSpec,
    },
    gestureEnabled: false,
    gestureDirection: 'horizontal' as const,
  },
};
