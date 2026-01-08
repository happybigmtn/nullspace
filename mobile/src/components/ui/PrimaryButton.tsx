/**
 * Primary action button with haptic feedback, premium depth animation, and anticipatory effects
 *
 * Features:
 * - Y-translate depth simulation on press (button "sinks" into surface)
 * - Shadow reduction on press for tactile illusion
 * - Subtle scale animation combined with depth effect
 * - Optional breathing animation when idle (draws attention to CTA)
 * - Focus state animation for accessibility
 */
import { useEffect, useRef } from 'react';
import { Pressable, Text, StyleSheet, ViewStyle, AppState, type AppStateStatus } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
  interpolate,
  Extrapolation,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { haptics } from '../../services/haptics';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY, ANIMATION, SPRING } from '../../constants/theme';
import { useReducedMotion } from '../../hooks/useReducedMotion';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'normal' | 'large';
  style?: ViewStyle;
  /** Enable breathing animation when idle (subtle pulse) */
  enableBreathing?: boolean;
}

/** Anticipation constants */
const ANTICIPATION = {
  /** Breathing animation scale range */
  breatheMin: 1.0,
  breatheMax: 1.02,
  /** Breathing cycle duration (ms) - 8-10 seconds for subtle effect */
  breatheDuration: 8000,
  /** Idle timeout before breathing starts (ms) */
  idleTimeout: 5000,
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Depth simulation constants */
const DEPTH = {
  /** Y translation when pressed (px) - simulates pressing "into" surface */
  pressY: 2,
  /** Shadow radius when resting */
  shadowRadius: 6,
  /** Shadow offset when resting */
  shadowOffsetY: 3,
  /** Shadow opacity when resting */
  shadowOpacity: 0.25,
  /** Scale on press - subtle squeeze effect */
  scale: 0.98,
};

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  variant = 'primary',
  size = 'normal',
  style,
  enableBreathing = false,
}: PrimaryButtonProps) {
  const prefersReducedMotion = useReducedMotion();

  // 0 = resting, 1 = pressed
  const pressProgress = useSharedValue(0);
  // Breathing scale multiplier (1.0 to 1.02)
  const breatheScale = useSharedValue(1);
  // Track if breathing is active
  const isBreathing = useRef(false);
  // Track last interaction time
  const lastInteractionRef = useRef<number>(Date.now());
  // Idle timer reference
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset idle timer and stop breathing
  const resetIdleTimer = () => {
    lastInteractionRef.current = Date.now();
    isBreathing.current = false;

    // Stop breathing animation
    cancelAnimation(breatheScale);
    breatheScale.value = withSpring(1, SPRING?.chipSettle ?? ANIMATION.spring);

    // Clear existing timer
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }

    // Set new idle timer if breathing is enabled
    if (enableBreathing && !prefersReducedMotion && !disabled) {
      idleTimerRef.current = setTimeout(() => {
        startBreathing();
      }, ANTICIPATION.idleTimeout);
    }
  };

  // Start breathing animation
  const startBreathing = () => {
    if (prefersReducedMotion || disabled || isBreathing.current) return;
    isBreathing.current = true;

    // Smooth breathing: 1.0 → 1.02 → 1.0, repeating
    breatheScale.value = withRepeat(
      withSequence(
        withTiming(ANTICIPATION.breatheMax, {
          duration: ANTICIPATION.breatheDuration / 2,
          easing: Easing.inOut(Easing.sin),
        }),
        withTiming(ANTICIPATION.breatheMin, {
          duration: ANTICIPATION.breatheDuration / 2,
          easing: Easing.inOut(Easing.sin),
        })
      ),
      -1, // Infinite
      false // Don't reverse
    );
  };

  // Initialize idle timer and handle app state changes
  useEffect(() => {
    if (enableBreathing && !prefersReducedMotion && !disabled) {
      resetIdleTimer();
    }

    // Pause breathing when app goes to background
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state !== 'active') {
        cancelAnimation(breatheScale);
        breatheScale.value = 1;
        isBreathing.current = false;
      } else if (enableBreathing && !prefersReducedMotion && !disabled) {
        resetIdleTimer();
      }
    });

    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
      cancelAnimation(breatheScale);
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableBreathing, prefersReducedMotion, disabled]);

  const handlePressIn = () => {
    resetIdleTimer();
    pressProgress.value = withSpring(1, ANIMATION.spring);
  };

  const handlePressOut = () => {
    resetIdleTimer();
    pressProgress.value = withSpring(0, ANIMATION.spring);
  };

  const handlePress = () => {
    if (disabled) return;
    resetIdleTimer();
    // Fire-and-forget haptic (non-blocking)
    haptics.betConfirm().catch(() => {});
    onPress();
  };

  const animatedStyle = useAnimatedStyle(() => {
    const baseScale = interpolate(
      pressProgress.value,
      [0, 1],
      [1, DEPTH.scale],
      Extrapolation.CLAMP
    );
    // Combine press scale with breathing scale
    const scale = baseScale * breatheScale.value;
    const translateY = interpolate(
      pressProgress.value,
      [0, 1],
      [0, DEPTH.pressY],
      Extrapolation.CLAMP
    );
    const shadowRadius = interpolate(
      pressProgress.value,
      [0, 1],
      [DEPTH.shadowRadius, 2],
      Extrapolation.CLAMP
    );
    const shadowOffsetY = interpolate(
      pressProgress.value,
      [0, 1],
      [DEPTH.shadowOffsetY, 1],
      Extrapolation.CLAMP
    );
    const shadowOpacity = interpolate(
      pressProgress.value,
      [0, 1],
      [DEPTH.shadowOpacity, 0.1],
      Extrapolation.CLAMP
    );

    return {
      transform: [{ scale: scale }, { translateY: translateY }] as const,
      shadowRadius,
      shadowOffset: { width: 0, height: shadowOffsetY },
      shadowOpacity,
    };
  });

  const variantStyles = {
    primary: { bg: COLORS.textPrimary, text: COLORS.surface, border: COLORS.textPrimary },
    secondary: { bg: COLORS.surface, text: COLORS.textPrimary, border: COLORS.border },
    danger: { bg: 'transparent', text: COLORS.destructive, border: COLORS.destructive },
    ghost: { bg: 'transparent', text: COLORS.textMuted, border: 'transparent' },
  };

  const colors = variantStyles[variant];

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      style={[
        styles.button,
        size === 'large' && styles.buttonLarge,
        {
          backgroundColor: disabled ? COLORS.textDisabled : colors.bg,
          borderColor: disabled ? COLORS.border : colors.border,
        },
        animatedStyle,
        style,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
    >
      <Text
        style={[
          styles.text,
          size === 'large' && styles.textLarge,
          { color: disabled ? COLORS.textMuted : colors.text },
        ]}
      >
        {label}
      </Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    borderRadius: RADIUS.full, // Modern pill shape
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 140,
    borderWidth: 1,
    // Base shadow for depth (animated values override these)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: DEPTH.shadowOffsetY },
    shadowOpacity: DEPTH.shadowOpacity,
    shadowRadius: DEPTH.shadowRadius,
    elevation: 4,
  },
  buttonLarge: {
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xxl,
    minWidth: 180,
  },
  text: {
    ...TYPOGRAPHY.label,
    letterSpacing: 1,
  },
  textLarge: {
    fontSize: 18,
    fontWeight: '800',
  },
});