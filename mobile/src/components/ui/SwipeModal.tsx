/**
 * SwipeModal - Bottom sheet with swipe-to-dismiss gesture
 *
 * Wraps GlassModal with iOS-style swipe down gesture for dismissal.
 * Uses react-native-gesture-handler for smooth 60fps gesture tracking.
 *
 * @example
 * ```tsx
 * <SwipeModal visible={showModal} onClose={() => setShowModal(false)}>
 *   <Text>Swipe down to dismiss</Text>
 * </SwipeModal>
 * ```
 */
import { ReactNode, useEffect, useState, useCallback } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  Dimensions,
  Platform,
  KeyboardAvoidingView,
  LayoutChangeEvent,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import {
  GestureDetector,
  Gesture,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import { useTheme } from '../../context/ThemeContext';
import { useThemedColors } from '../../hooks/useThemedColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { RADIUS, SPACING, DARK_MODE_GLOW } from '../../constants/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// Spring config matching SPRING_LIQUID.liquidSlide
const SPRING_CONFIG = {
  mass: 0.7,
  stiffness: 150,
  damping: 16,
};

const INSTANT_CONFIG = {
  duration: 0,
};

interface SwipeModalProps {
  /** Whether modal is visible */
  visible: boolean;
  /** Called when modal is dismissed (backdrop tap or swipe) */
  onClose: () => void;
  /** Modal content */
  children: ReactNode;
  /** Minimum velocity (px/s) to trigger dismiss. Default 500 */
  velocityThreshold?: number;
  /** Distance threshold as percentage. Default 0.3 (30%) */
  distanceThreshold?: number;
  /** Whether swipe gesture is enabled. Default true */
  swipeEnabled?: boolean;
  /** Whether backdrop tap closes modal. Default true */
  closeOnBackdrop?: boolean;
  /** Whether to show drag handle indicator. Default true */
  showHandle?: boolean;
  /** Test ID for testing */
  testID?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function SwipeModal({
  visible,
  onClose,
  children,
  velocityThreshold = 500,
  distanceThreshold = 0.3,
  swipeEnabled = true,
  closeOnBackdrop = true,
  showHandle = true,
  testID,
}: SwipeModalProps) {
  const { isDark } = useTheme();
  const colors = useThemedColors();
  const prefersReducedMotion = useReducedMotion();

  // Track content height for threshold calculation
  const [contentHeight, setContentHeight] = useState(SCREEN_HEIGHT * 0.5);

  // Shared values for gesture
  const translateY = useSharedValue(0);
  const contextY = useSharedValue(0);
  const isDismissing = useSharedValue(false);
  const isActive = useSharedValue(false);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      translateY.value = 0;
      isDismissing.value = false;
    }
  }, [visible, translateY, isDismissing]);

  // Calculate dismiss threshold
  const dismissDistance = contentHeight * distanceThreshold;

  // Handle dismiss callback (wrapped for worklet)
  const handleDismiss = useCallback(() => {
    onClose();
  }, [onClose]);

  // Measure content height on layout
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout;
    if (height > 0) {
      setContentHeight(height);
    }
  }, []);

  // Pan gesture for swipe-to-dismiss
  const panGesture = Gesture.Pan()
    .enabled(swipeEnabled)
    .onStart(() => {
      contextY.value = translateY.value;
      isActive.value = true;
    })
    .onUpdate((event) => {
      // Only allow downward drag (positive Y)
      const newY = contextY.value + event.translationY;
      translateY.value = Math.max(0, newY);
    })
    .onEnd((event) => {
      isActive.value = false;

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
          contentHeight + 100,
          springConfig,
          (finished) => {
            if (finished) {
              runOnJS(handleDismiss)();
            }
          }
        );
      } else {
        // Snap back
        const springConfig = prefersReducedMotion ? INSTANT_CONFIG : SPRING_CONFIG;
        translateY.value = withSpring(0, springConfig);
      }
    });

  // Animated style for content
  const animatedContentStyle = useAnimatedStyle(() => {
    const progress = translateY.value / Math.max(contentHeight, 1);
    const opacity = 1 - progress * 0.5;

    return {
      transform: [{ translateY: translateY.value }],
      opacity: Math.max(0.5, Math.min(1, opacity)),
    };
  }, [contentHeight]);

  // Animated style for backdrop
  const animatedBackdropStyle = useAnimatedStyle(() => {
    const progress = translateY.value / Math.max(contentHeight, 1);
    const opacity = 1 - progress;

    return {
      opacity: Math.max(0, Math.min(1, opacity)),
    };
  }, [contentHeight]);

  // Backdrop blur intensity
  const blurIntensity = isDark ? 20 : 15;
  const backdropOpacity = isDark ? 0.7 : 0.5;

  // Glow style for dark mode
  const glowStyle = isDark ? DARK_MODE_GLOW.subtle : {};

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
      testID={testID}
    >
      <GestureHandlerRootView style={styles.container}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.container}
        >
          {/* Blurred backdrop */}
          <AnimatedPressable
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(150)}
            style={[StyleSheet.absoluteFill, animatedBackdropStyle]}
            onPress={closeOnBackdrop ? onClose : undefined}
            accessibilityRole="button"
            accessibilityLabel="Close modal"
          >
            <BlurView
              intensity={blurIntensity}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: isDark
                    ? `rgba(0, 0, 0, ${backdropOpacity})`
                    : `rgba(0, 0, 0, ${backdropOpacity * 0.7})`,
                },
              ]}
            />
          </AnimatedPressable>

          {/* Content wrapper */}
          <View
            style={styles.contentWrapper}
            pointerEvents="box-none"
            accessibilityViewIsModal={true}
            accessibilityRole="dialog"
          >
            <GestureDetector gesture={panGesture}>
              <Animated.View
                entering={
                  prefersReducedMotion
                    ? FadeIn.duration(150)
                    : SlideInDown.springify().damping(18).stiffness(120)
                }
                style={[
                  styles.card,
                  { backgroundColor: colors.surface },
                  glowStyle,
                  animatedContentStyle,
                ]}
                onLayout={handleLayout}
              >
                {/* Drag handle */}
                {showHandle && (
                  <View
                    style={styles.handleContainer}
                    accessible={true}
                    accessibilityLabel="Drag handle"
                    accessibilityHint="Swipe down to dismiss"
                  >
                    <View
                      style={[
                        styles.handle,
                        {
                          backgroundColor: isDark
                            ? 'rgba(255, 255, 255, 0.3)'
                            : 'rgba(0, 0, 0, 0.2)',
                        },
                      ]}
                    />
                  </View>
                )}

                {/* Inner border effect */}
                <View
                  style={[
                    styles.cardInnerBorder,
                    {
                      borderColor: isDark
                        ? 'rgba(255, 255, 255, 0.1)'
                        : 'rgba(255, 255, 255, 0.5)',
                    },
                  ]}
                  pointerEvents="none"
                />

                {/* Inner glow highlight */}
                <View
                  style={[
                    styles.innerGlow,
                    {
                      backgroundColor: isDark
                        ? 'rgba(255, 255, 255, 0.05)'
                        : 'rgba(255, 255, 255, 0.3)',
                    },
                  ]}
                  pointerEvents="none"
                />

                {/* Content */}
                {children}
              </Animated.View>
            </GestureDetector>
          </View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentWrapper: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  card: {
    borderTopLeftRadius: RADIUS['2xl'],
    borderTopRightRadius: RADIUS['2xl'],
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
    overflow: 'hidden',
    position: 'relative',
  },
  handleContainer: {
    alignItems: 'center',
    paddingBottom: SPACING.md,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  cardInnerBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderTopLeftRadius: RADIUS['2xl'],
    borderTopRightRadius: RADIUS['2xl'],
  },
  innerGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
});

export default SwipeModal;
