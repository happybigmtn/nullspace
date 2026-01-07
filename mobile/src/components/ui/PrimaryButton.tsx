/**
 * Primary action button with haptic feedback and premium depth animation
 *
 * Features:
 * - Y-translate depth simulation on press (button "sinks" into surface)
 * - Shadow reduction on press for tactile illusion
 * - Subtle scale animation combined with depth effect
 */
import { Pressable, Text, StyleSheet, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { haptics } from '../../services/haptics';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY, ANIMATION } from '../../constants/theme';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'normal' | 'large';
  style?: ViewStyle;
}

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
}: PrimaryButtonProps) {
  // 0 = resting, 1 = pressed
  const pressProgress = useSharedValue(0);

  const handlePressIn = () => {
    pressProgress.value = withSpring(1, ANIMATION.spring);
  };

  const handlePressOut = () => {
    pressProgress.value = withSpring(0, ANIMATION.spring);
  };

  const handlePress = () => {
    if (disabled) return;
    // Fire-and-forget haptic (non-blocking)
    haptics.betConfirm().catch(() => {});
    onPress();
  };

  const animatedStyle = useAnimatedStyle(() => {
    const scale = interpolate(
      pressProgress.value,
      [0, 1],
      [1, DEPTH.scale],
      Extrapolation.CLAMP
    );
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
      transform: [{ scale }, { translateY }],
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