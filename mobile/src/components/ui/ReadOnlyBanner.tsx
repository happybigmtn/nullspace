/**
 * ReadOnlyBanner - Persistent banner for read-only mode (AC-8.4)
 *
 * Displays when the app is in read-only mode due to limited connectivity.
 * Shows the reason for read-only mode and provides reconnect actions.
 *
 * ## Features
 *
 * 1. **Persistent visibility**: Stays visible at top of screen during read-only mode
 * 2. **Contextual messaging**: Shows appropriate message based on connectivity state
 * 3. **Action buttons**: Retry/reconnect options when applicable
 * 4. **Progress feedback**: Shows reconnect attempt count and countdown
 * 5. **Accessibility**: ARIA labels and roles for screen readers
 * 6. **Animations**: Smooth enter/exit with color transitions
 */
import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS, ANIMATION } from '../../constants/theme';
import { PulseRing } from './MicroInteractions';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { ReadOnlyReason } from '../../hooks/useReadOnlyMode';

/** Status colors for different read-only reasons */
const REASON_COLORS = {
  offline: '#FF9500',      // Warning orange
  reconnecting: '#FFD700', // Gold (in progress)
  failed: '#FF3B30',       // Destructive red
  connecting: '#FFD700',   // Gold (in progress)
} as const;

/** Icon characters for different read-only reasons */
const REASON_ICONS = {
  offline: '\u26A0',       // Warning sign
  reconnecting: '\u21BB',  // Clockwise loop arrow
  failed: '\u2716',        // Heavy multiplication X
  connecting: '\u2026',    // Horizontal ellipsis
} as const;

export interface ReadOnlyBannerProps {
  /** Whether the banner should be visible */
  visible: boolean;
  /** Reason for read-only mode */
  reason: ReadOnlyReason;
  /** Short message to display */
  message: string;
  /** Current reconnect attempt number */
  reconnectAttempt?: number;
  /** Maximum reconnect attempts */
  maxReconnectAttempts?: number;
  /** Seconds until next reconnect (null if not scheduled) */
  nextReconnectIn?: number | null;
  /** Callback when retry/reconnect button is pressed */
  onRetry?: () => void;
  /** Callback when reset and reconnect is pressed (for failed state) */
  onResetAndRetry?: () => void;
  /** Test ID for e2e testing */
  testID?: string;
}

export function ReadOnlyBanner({
  visible,
  reason,
  message,
  reconnectAttempt = 0,
  maxReconnectAttempts = 10,
  nextReconnectIn = null,
  onRetry,
  onResetAndRetry,
  testID = 'read-only-banner',
}: ReadOnlyBannerProps) {
  const prefersReducedMotion = useReducedMotion();
  const prevReasonRef = useRef<ReadOnlyReason>(reason);

  // Animation shared values
  const shakeX = useSharedValue(0);
  const indicatorScale = useSharedValue(1);

  const color = reason ? REASON_COLORS[reason] : REASON_COLORS.offline;
  const icon = reason ? REASON_ICONS[reason] : '';
  const isReconnecting = reason === 'reconnecting' || reason === 'connecting';
  const isFailed = reason === 'failed';

  // Trigger shake animation when entering failed state
  useEffect(() => {
    if (
      prevReasonRef.current !== 'failed' &&
      reason === 'failed' &&
      !prefersReducedMotion
    ) {
      shakeX.value = withSequence(
        withTiming(-4, { duration: 50 }),
        withTiming(4, { duration: 50 }),
        withTiming(-3, { duration: 50 }),
        withTiming(3, { duration: 50 }),
        withTiming(0, { duration: 50 })
      );
    }

    prevReasonRef.current = reason;
  }, [reason, prefersReducedMotion, shakeX]);

  // Pulse indicator when reconnecting
  useEffect(() => {
    if (isReconnecting && !prefersReducedMotion) {
      indicatorScale.value = withSequence(
        withSpring(1.2, { damping: 8, stiffness: 400 }),
        withSpring(1, ANIMATION.spring)
      );
    }
  }, [isReconnecting, reconnectAttempt, prefersReducedMotion, indicatorScale]);

  // Animated styles
  const containerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const indicatorAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: indicatorScale.value }],
  }));

  if (!visible || !reason) {
    return null;
  }

  // Build progress text
  let progressText = '';
  if (isReconnecting && reconnectAttempt > 0) {
    progressText = `(${reconnectAttempt}/${maxReconnectAttempts})`;
    if (nextReconnectIn !== null && nextReconnectIn > 0) {
      progressText += ` \u2022 ${nextReconnectIn}s`;
    }
  }

  return (
    <Animated.View
      entering={prefersReducedMotion ? undefined : FadeIn.duration(300)}
      exiting={prefersReducedMotion ? undefined : FadeOut.duration(300)}
      style={[
        styles.container,
        { borderColor: color },
        containerAnimatedStyle,
      ]}
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Read-only mode: ${message}`}
    >
      <View style={styles.content}>
        {/* Status indicator with pulse ring */}
        <PulseRing
          isActive={isReconnecting && !prefersReducedMotion}
          size={10}
          color={color}
          rings={2}
        >
          <Animated.View
            style={[
              styles.indicator,
              { backgroundColor: color },
              indicatorAnimatedStyle,
            ]}
            accessibilityElementsHidden
          >
            <Text style={styles.iconText}>{icon}</Text>
          </Animated.View>
        </PulseRing>

        {/* Message and progress */}
        <View style={styles.textContainer}>
          <Text
            style={[styles.message, { color }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {message}
          </Text>
          {progressText ? (
            <Text style={styles.progress}>{progressText}</Text>
          ) : null}
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        {/* Retry button for reconnecting states */}
        {isReconnecting && onRetry && (
          <Pressable
            onPress={onRetry}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.buttonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Retry connection now"
            accessibilityHint="Attempts to reconnect to the server immediately"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        )}

        {/* Reset & retry button for failed state */}
        {isFailed && onResetAndRetry && (
          <Pressable
            onPress={onResetAndRetry}
            style={({ pressed }) => [
              styles.retryButton,
              styles.failedButton,
              pressed && styles.buttonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Reset and reconnect"
            accessibilityHint="Resets the connection and attempts to reconnect"
          >
            <Text style={styles.retryText}>Reconnect</Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 2,
    minHeight: 44, // Touch target minimum
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: SPACING.sm,
  },
  indicator: {
    width: 20,
    height: 20,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 10,
    color: COLORS.surface,
    fontWeight: '700',
  },
  textContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  message: {
    ...TYPOGRAPHY.label,
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
  progress: {
    ...TYPOGRAPHY.label,
    fontSize: 10,
    color: COLORS.textMuted,
    flexShrink: 0,
  },
  actions: {
    flexDirection: 'row',
    gap: SPACING.xs,
    marginLeft: SPACING.sm,
  },
  retryButton: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.textPrimary,
    borderRadius: RADIUS.full,
    minHeight: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  failedButton: {
    backgroundColor: '#FF3B30', // Destructive red
  },
  buttonPressed: {
    opacity: 0.7,
  },
  retryText: {
    color: COLORS.surface,
    ...TYPOGRAPHY.label,
    fontSize: 11,
    fontWeight: '600',
  },
});
