/**
 * Tutorial overlay component for progressive disclosure of game rules
 *
 * Uses glassmorphism for premium visual treatment:
 * - Frosted blur backdrop (20px blur + 60% opacity)
 * - Elevated glass card with inner glow
 * - Theme-aware styling (light/dark mode)
 */
import { View, Text, StyleSheet, Pressable, Modal } from 'react-native';
import { useState, useEffect } from 'react';
import { BlurView } from 'expo-blur';
import Animated, { FadeIn, FadeOut, SlideInDown } from 'react-native-reanimated';
import { haptics } from '../../services/haptics';
import { isTutorialCompleted, markTutorialCompleted } from '../../services/storage';
import { SPACING, RADIUS, TYPOGRAPHY, DARK_MODE_GLOW } from '../../constants/theme';
import { OPACITY_SEMANTIC, OPACITY } from '@nullspace/design-tokens';
import { useTheme } from '../../context/ThemeContext';
import { useThemedColors } from '../../hooks/useThemedColors';
import type { TutorialStep } from '../../types';

interface TutorialOverlayProps {
  gameId: string;
  steps: TutorialStep[];
  onComplete: () => void;
  forceShow?: boolean;
}

export function TutorialOverlay({
  gameId,
  steps,
  onComplete,
  forceShow = false,
}: TutorialOverlayProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const { isDark } = useTheme();
  const colors = useThemedColors();

  useEffect(() => {
    // Check if tutorial was already completed
    if (forceShow) {
      setVisible(true);
    } else {
      try {
        const completed = isTutorialCompleted(gameId);
        setVisible(!completed);
      } catch {
        // Storage not initialized yet, show tutorial by default
        setVisible(true);
      }
    }
  }, [gameId, forceShow]);

  const handleNext = () => {
    // Fire-and-forget haptic (non-blocking)
    haptics.buttonPress().catch(() => {});
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleComplete = () => {
    try {
      markTutorialCompleted(gameId);
    } catch {
      // Storage not available, tutorial will show again next time
    }
    setVisible(false);
    onComplete();
  };

  const handleSkip = () => {
    // Fire-and-forget haptic (non-blocking)
    haptics.buttonPress().catch(() => {});
    try {
      markTutorialCompleted(gameId);
    } catch {
      // Storage not available, tutorial will show again next time
    }
    setVisible(false);
    onComplete();
  };

  if (!visible || steps.length === 0) return null;

  const step = steps[currentStep];
  if (!step) return null;

  // Dynamic styles based on theme
  const cardGlow = isDark ? DARK_MODE_GLOW.subtle : {};
  const innerBorderColor = isDark
    ? 'rgba(255, 255, 255, 0.1)'
    : 'rgba(255, 255, 255, 0.5)';
  const innerGlowColor = isDark
    ? 'rgba(255, 255, 255, 0.05)'
    : 'rgba(255, 255, 255, 0.3)';

  return (
    <Modal transparent animationType="none" statusBarTranslucent>
      {/* Glassmorphism backdrop */}
      <Animated.View
        entering={FadeIn.duration(200)}
        exiting={FadeOut.duration(150)}
        style={styles.overlay}
      >
        <BlurView
          intensity={20}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: isDark
                ? `rgba(0, 0, 0, ${OPACITY.xl})`
                : `rgba(0, 0, 0, ${OPACITY.lg})`,
            },
          ]}
        />
      </Animated.View>

      {/* Content positioned at bottom */}
      <View style={styles.contentWrapper} pointerEvents="box-none">
        <Animated.View
          entering={SlideInDown.springify().damping(18).stiffness(120)}
          exiting={FadeOut.duration(200)}
          style={[
            styles.card,
            { backgroundColor: colors.surface },
            cardGlow,
          ]}
        >
          {/* Inner border for glass effect */}
          <View
            style={[styles.cardInnerBorder, { borderColor: innerBorderColor }]}
            pointerEvents="none"
          />
          {/* Inner glow highlight */}
          <View
            style={[styles.innerGlow, { backgroundColor: innerGlowColor }]}
            pointerEvents="none"
          />

          <Text style={[styles.title, { color: colors.textPrimary }]}>
            {step.title}
          </Text>
          <Text style={[styles.description, { color: colors.textSecondary }]}>
            {step.description}
          </Text>

          <View style={styles.progress}>
            {steps.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  { backgroundColor: colors.border },
                  i === currentStep && [styles.dotActive, { backgroundColor: colors.primary }],
                  i < currentStep && { backgroundColor: colors.primary },
                ]}
              />
            ))}
          </View>

          <View style={styles.actions}>
            <Pressable onPress={handleSkip} style={styles.skipButton}>
              <Text style={[styles.skipText, { color: colors.textMuted }]}>
                Skip tutorial
              </Text>
            </Pressable>
            <Pressable
              onPress={handleNext}
              style={[styles.nextButton, { backgroundColor: colors.primary, borderColor: colors.primary }]}
            >
              <Text style={[styles.nextText, { color: colors.background }]}>
                {currentStep === steps.length - 1 ? 'GOT IT' : 'NEXT'}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  contentWrapper: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: SPACING.md,
  },
  card: {
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  cardInnerBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
  },
  innerGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
  },
  title: {
    ...TYPOGRAPHY.label,
    marginBottom: SPACING.sm,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  description: {
    ...TYPOGRAPHY.bodySmall,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  progress: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    width: 24,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  skipButton: {
    padding: SPACING.sm,
  },
  skipText: {
    ...TYPOGRAPHY.bodySmall,
    textTransform: 'uppercase',
  },
  nextButton: {
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.xl,
    borderRadius: RADIUS.md,
    borderWidth: 2,
  },
  nextText: {
    ...TYPOGRAPHY.label,
  },
});
