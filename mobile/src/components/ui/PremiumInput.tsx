/**
 * PremiumInput - Animated input field with premium UX
 *
 * US-138: Premium input field styling for Vault screens
 *
 * Features:
 * - Animated underline that extends left-to-right on focus
 * - Floating label animation (moves above on focus/has value)
 * - Background color shift on focus (subtle darkening)
 * - Green checkmark animates in on valid input
 * - Shake animation on submission failure
 */
import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  TextInputProps,
  ViewStyle,
  StyleProp,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withSequence,
  interpolate,
  interpolateColor,
  Easing,
} from 'react-native-reanimated';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS } from '../../constants/theme';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/** Handle for imperative shake trigger */
export interface PremiumInputHandle {
  shake: () => void;
}

interface PremiumInputProps extends Omit<TextInputProps, 'style'> {
  /** Floating label text */
  label: string;
  /** Whether input value is valid (shows checkmark) */
  isValid?: boolean;
  /** Custom container style */
  containerStyle?: StyleProp<ViewStyle>;
  /** Whether to show validation checkmark */
  showValidation?: boolean;
}

/**
 * PremiumInput - Animated input field component
 *
 * Use forwardRef to allow parent components to trigger shake animation
 * via ref.current.shake() on submission failure.
 */
export const PremiumInput = forwardRef<PremiumInputHandle, PremiumInputProps>(
  function PremiumInput(
    {
      label,
      value,
      isValid = false,
      containerStyle,
      showValidation = false,
      onFocus,
      onBlur,
      onChangeText,
      ...textInputProps
    },
    ref
  ) {
    const inputRef = useRef<TextInput>(null);
    const [isFocused, setIsFocused] = useState(false);

    // Animation values
    const focusProgress = useSharedValue(0);
    const labelPosition = useSharedValue(value ? 1 : 0);
    const underlineWidth = useSharedValue(0);
    const checkmarkOpacity = useSharedValue(0);
    const shakeOffset = useSharedValue(0);

    // Update animations when focus changes
    const handleFocus = useCallback(
      (e: Parameters<NonNullable<TextInputProps['onFocus']>>[0]) => {
        setIsFocused(true);
        focusProgress.value = withTiming(1, { duration: 200 });
        labelPosition.value = withSpring(1, { damping: 15, stiffness: 150 });
        underlineWidth.value = withTiming(1, {
          duration: 300,
          easing: Easing.out(Easing.cubic),
        });
        onFocus?.(e);
      },
      [focusProgress, labelPosition, underlineWidth, onFocus]
    );

    const handleBlur = useCallback(
      (e: Parameters<NonNullable<TextInputProps['onBlur']>>[0]) => {
        setIsFocused(false);
        focusProgress.value = withTiming(0, { duration: 200 });
        // Only collapse label if empty
        if (!value) {
          labelPosition.value = withSpring(0, { damping: 15, stiffness: 150 });
        }
        underlineWidth.value = withTiming(0, { duration: 200 });
        onBlur?.(e);
      },
      [focusProgress, labelPosition, underlineWidth, value, onBlur]
    );

    const handleChangeText = useCallback(
      (text: string) => {
        // Float label up when text is entered
        if (text && labelPosition.value === 0) {
          labelPosition.value = withSpring(1, { damping: 15, stiffness: 150 });
        } else if (!text && !isFocused) {
          labelPosition.value = withSpring(0, { damping: 15, stiffness: 150 });
        }
        onChangeText?.(text);
      },
      [labelPosition, isFocused, onChangeText]
    );

    // Update checkmark when validation changes
    React.useEffect(() => {
      if (showValidation) {
        checkmarkOpacity.value = withTiming(isValid ? 1 : 0, { duration: 200 });
      }
    }, [isValid, showValidation, checkmarkOpacity]);

    // Expose shake method to parent
    useImperativeHandle(ref, () => ({
      shake: () => {
        shakeOffset.value = withSequence(
          withTiming(10, { duration: 50 }),
          withTiming(-10, { duration: 50 }),
          withTiming(8, { duration: 50 }),
          withTiming(-8, { duration: 50 }),
          withTiming(4, { duration: 50 }),
          withTiming(0, { duration: 50 })
        );
      },
    }));

    // Animated styles
    const containerAnimatedStyle = useAnimatedStyle(() => ({
      transform: [{ translateX: shakeOffset.value }],
    }));

    const inputContainerAnimatedStyle = useAnimatedStyle(() => ({
      backgroundColor: interpolateColor(
        focusProgress.value,
        [0, 1],
        [COLORS.background, COLORS.surface]
      ),
    }));

    const labelAnimatedStyle = useAnimatedStyle(() => ({
      transform: [
        {
          translateY: interpolate(labelPosition.value, [0, 1], [0, -24]),
        },
        {
          scale: interpolate(labelPosition.value, [0, 1], [1, 0.85]),
        },
      ],
      color: interpolateColor(
        focusProgress.value,
        [0, 1],
        [COLORS.textMuted, COLORS.primary]
      ),
    }));

    const underlineAnimatedStyle = useAnimatedStyle(() => ({
      transform: [{ scaleX: underlineWidth.value }],
      opacity: underlineWidth.value,
    }));

    const checkmarkAnimatedStyle = useAnimatedStyle(() => ({
      opacity: checkmarkOpacity.value,
      transform: [
        {
          scale: interpolate(checkmarkOpacity.value, [0, 1], [0.8, 1]),
        },
      ],
    }));

    return (
      <Animated.View style={[styles.container, containerStyle, containerAnimatedStyle]}>
        <Animated.View style={[styles.inputContainer, inputContainerAnimatedStyle]}>
          {/* Floating label */}
          <Animated.Text
            style={[styles.label, labelAnimatedStyle]}
            pointerEvents="none"
          >
            {label}
          </Animated.Text>

          {/* Text input */}
          <AnimatedTextInput
            ref={inputRef}
            value={value}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onChangeText={handleChangeText}
            style={styles.input}
            placeholderTextColor="transparent"
            {...textInputProps}
          />

          {/* Animated underline */}
          <View style={styles.underlineContainer}>
            <View style={styles.underlineBase} />
            <Animated.View style={[styles.underlineActive, underlineAnimatedStyle]} />
          </View>

          {/* Validation checkmark */}
          {showValidation && (
            <Animated.View style={[styles.checkmark, checkmarkAnimatedStyle]}>
              <CheckmarkIcon />
            </Animated.View>
          )}
        </Animated.View>
      </Animated.View>
    );
  }
);

/**
 * Simple checkmark icon using View components
 */
function CheckmarkIcon() {
  return (
    <View style={styles.checkmarkIcon}>
      <View style={styles.checkmarkShort} />
      <View style={styles.checkmarkLong} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: SPACING.sm,
  },
  inputContainer: {
    position: 'relative',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingTop: SPACING.lg,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xs,
  },
  label: {
    position: 'absolute',
    left: SPACING.md,
    top: SPACING.lg,
    ...TYPOGRAPHY.body,
    backgroundColor: 'transparent',
    transformOrigin: 'left center',
  },
  input: {
    ...TYPOGRAPHY.body,
    color: COLORS.textPrimary,
    paddingVertical: SPACING.xs,
    minHeight: 24,
  },
  underlineContainer: {
    position: 'absolute',
    left: SPACING.md,
    right: SPACING.md,
    bottom: SPACING.xs,
    height: 2,
  },
  underlineBase: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: COLORS.border,
  },
  underlineActive: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: COLORS.primary,
    transformOrigin: 'left center',
  },
  checkmark: {
    position: 'absolute',
    right: SPACING.md,
    top: '50%',
    marginTop: 4,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkIcon: {
    width: 16,
    height: 16,
    position: 'relative',
  },
  checkmarkShort: {
    position: 'absolute',
    left: 2,
    bottom: 5,
    width: 6,
    height: 2,
    backgroundColor: COLORS.success,
    borderRadius: 1,
    transform: [{ rotate: '45deg' }],
  },
  checkmarkLong: {
    position: 'absolute',
    left: 5,
    bottom: 5,
    width: 10,
    height: 2,
    backgroundColor: COLORS.success,
    borderRadius: 1,
    transform: [{ rotate: '-45deg' }],
  },
});
