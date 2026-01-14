/**
 * Glass morphism modal component
 *
 * A premium modal with frosted glass background effect.
 * Uses expo-blur for native blur performance with:
 * - 60% opacity + 20px blur on backdrop
 * - Elevated glass card for content
 * - Subtle inner glow and border glow
 *
 * @example
 * ```tsx
 * <GlassModal visible={showModal} onClose={() => setShowModal(false)}>
 *   <Text>Modal content</Text>
 * </GlassModal>
 * ```
 */
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  ViewStyle,
  StyleProp,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import { ReactNode } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useThemedColors } from '../../hooks/useThemedColors';
import { RADIUS, SPACING, DARK_MODE_GLOW } from '../../constants/theme';
import { GlassIntensity } from './GlassView';

/** Modal position on screen */
export type ModalPosition = 'center' | 'bottom';

interface GlassModalProps {
  /** Whether modal is visible */
  visible: boolean;
  /** Called when backdrop is pressed or modal dismissed */
  onClose: () => void;
  /** Modal content */
  children: ReactNode;
  /** Position of modal content (default: bottom) */
  position?: ModalPosition;
  /** Blur intensity for backdrop (default: medium) */
  backdropIntensity?: GlassIntensity;
  /** Whether to show glow effect on content card (default: true) */
  withGlow?: boolean;
  /** Custom style for content container */
  contentStyle?: StyleProp<ViewStyle>;
  /** Whether backdrop tap closes modal (default: true) */
  closeOnBackdrop?: boolean;
  /** Test ID for testing */
  testID?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * GlassModal - Premium modal with glassmorphism backdrop
 */
export function GlassModal({
  visible,
  onClose,
  children,
  position = 'bottom',
  backdropIntensity = 'medium',
  withGlow = true,
  contentStyle,
  closeOnBackdrop = true,
  testID,
}: GlassModalProps) {
  const { isDark } = useTheme();
  const colors = useThemedColors();

  // Backdrop blur intensity
  const blurIntensity = {
    light: 15,
    medium: 20,
    heavy: 30,
  }[backdropIntensity];

  // Backdrop overlay opacity
  const backdropOpacity = isDark ? 0.7 : 0.5;

  // Card glow style for dark mode
  const glowStyle = withGlow && isDark ? DARK_MODE_GLOW.subtle : {};

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
      testID={testID}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        {/* Blurred backdrop */}
        <AnimatedPressable
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(150)}
          style={StyleSheet.absoluteFill}
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
          style={[
            styles.contentWrapper,
            position === 'center' && styles.contentCenter,
            position === 'bottom' && styles.contentBottom,
          ]}
          pointerEvents="box-none"
          accessibilityViewIsModal={true}
          accessibilityRole="dialog"
        >
          {/* Glass content card */}
          <Animated.View
            entering={
              position === 'bottom'
                ? SlideInDown.springify().damping(18).stiffness(120)
                : FadeIn.duration(250)
            }
            exiting={
              position === 'bottom'
                ? SlideOutDown.duration(200)
                : FadeOut.duration(150)
            }
            style={[
              styles.card,
              position === 'bottom' && styles.cardBottom,
              position === 'center' && styles.cardCenter,
              { backgroundColor: colors.surface },
              glowStyle,
              contentStyle,
            ]}
          >
            {/* Frosted glass inner effect */}
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
            {withGlow && (
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
            )}
            {children}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
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
  contentCenter: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  contentBottom: {
    justifyContent: 'flex-end',
  },
  card: {
    overflow: 'hidden',
    position: 'relative',
  },
  cardBottom: {
    borderTopLeftRadius: RADIUS['2xl'],
    borderTopRightRadius: RADIUS['2xl'],
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  cardCenter: {
    borderRadius: RADIUS['2xl'],
    padding: SPACING.lg,
    maxWidth: '90%',
    width: 340,
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

/**
 * GlassSheet - Bottom sheet variant of GlassModal
 *
 * Convenience wrapper for bottom-positioned modal.
 */
interface GlassSheetProps extends Omit<GlassModalProps, 'position'> {
  /** Max height as percentage of screen (default: 80%) */
  maxHeight?: number;
}

export function GlassSheet({
  maxHeight = 80,
  contentStyle,
  ...props
}: GlassSheetProps) {
  return (
    <GlassModal
      {...props}
      position="bottom"
      contentStyle={[{ maxHeight: `${maxHeight}%` }, contentStyle]}
    />
  );
}
