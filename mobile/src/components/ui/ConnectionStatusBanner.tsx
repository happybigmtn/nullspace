/**
 * ConnectionStatusBanner - Shows connection status with reconnection feedback
 * Displays when disconnected or reconnecting, hidden when connected
 *
 * Premium features (US-113, DS-051):
 * - PulseRing animation on status indicator during connection
 * - Smooth color morphing between states
 * - Success celebration on reconnect
 * - Subtle error shake animation
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  interpolateColor,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS, ANIMATION } from '../../constants/theme';
import { PulseRing } from './MicroInteractions';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { ConnectionState } from '../../services/websocket';

/** Status colors for interpolation - must be hex strings for interpolateColor */
const STATUS_COLORS = {
  connected: '#34C759', // success green
  connecting: '#FFD700', // gold
  failed: '#FF3B30', // destructive red
  disconnected: '#6B7280', // muted gray
} as const;

interface ConnectionStatusBannerProps {
  connectionState: ConnectionState;
  reconnectAttempt: number;
  maxReconnectAttempts: number;
  onRetry?: () => void;
}

export function ConnectionStatusBanner({
  connectionState,
  reconnectAttempt,
  maxReconnectAttempts,
  onRetry,
}: ConnectionStatusBannerProps) {
  const prefersReducedMotion = useReducedMotion();

  // Track previous state for detecting transitions
  const prevStateRef = useRef<ConnectionState>(connectionState);
  const [showSuccessFlash, setShowSuccessFlash] = useState(false);

  // Shared values for animations
  const colorProgress = useSharedValue(0);
  const shakeX = useSharedValue(0);
  const flashOpacity = useSharedValue(0);
  const indicatorScale = useSharedValue(1);

  const isFailed = connectionState === 'failed';
  const isConnecting = connectionState === 'connecting';

  const getMessage = (): string => {
    if (isFailed) return 'Disconnected';
    if (isConnecting) return 'Connecting';
    return 'Status Unknown';
  };

  // Map state to color index for interpolation
  const getColorIndex = (state: ConnectionState): number => {
    switch (state) {
      case 'connected':
        return 0;
      case 'connecting':
        return 1;
      case 'failed':
        return 2;
      default:
        return 3;
    }
  };

  // Detect state transitions and trigger animations
  useEffect(() => {
    const prevState = prevStateRef.current;
    const newIndex = getColorIndex(connectionState);
    let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

    if (!prefersReducedMotion) {
      // Smooth color transition
      colorProgress.value = withSpring(newIndex, ANIMATION.spring);

      // Success celebration on reconnect
      if (
        (prevState === 'failed' || prevState === 'connecting') &&
        connectionState === 'connected'
      ) {
        setShowSuccessFlash(true);
        flashOpacity.value = withSequence(
          withTiming(1, { duration: 100 }),
          withTiming(0, { duration: 700, easing: Easing.out(Easing.cubic) })
        );
        indicatorScale.value = withSequence(
          withSpring(1.5, { damping: 8, stiffness: 400 }),
          withSpring(1, ANIMATION.spring)
        );
        cleanupTimer = setTimeout(() => setShowSuccessFlash(false), 800);
      }

      // Error shake when entering failed state
      if (prevState !== 'failed' && connectionState === 'failed') {
        shakeX.value = withSequence(
          withTiming(-4, { duration: 50 }),
          withTiming(4, { duration: 50 }),
          withTiming(-3, { duration: 50 }),
          withTiming(3, { duration: 50 }),
          withTiming(0, { duration: 50 })
        );
      }
    } else {
      colorProgress.value = newIndex;
    }

    prevStateRef.current = connectionState;

    return () => {
      if (cleanupTimer) {
        clearTimeout(cleanupTimer);
      }
    };
  }, [connectionState, prefersReducedMotion, colorProgress, shakeX, flashOpacity, indicatorScale]);

  // Animated styles
  const containerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const indicatorAnimatedStyle = useAnimatedStyle(() => {
    const backgroundColor = interpolateColor(
      colorProgress.value,
      [0, 1, 2, 3],
      [
        STATUS_COLORS.connected,
        STATUS_COLORS.connecting,
        STATUS_COLORS.failed,
        STATUS_COLORS.disconnected,
      ]
    );
    return {
      backgroundColor,
      transform: [{ scale: indicatorScale.value }],
    };
  });

  const textAnimatedStyle = useAnimatedStyle(() => {
    const color = interpolateColor(
      colorProgress.value,
      [0, 1, 2, 3],
      [
        STATUS_COLORS.connected,
        STATUS_COLORS.connecting,
        STATUS_COLORS.failed,
        STATUS_COLORS.disconnected,
      ]
    );
    return { color };
  });

  const flashAnimatedStyle = useAnimatedStyle(() => ({
    opacity: flashOpacity.value,
  }));

  // Don't render when connected (unless showing success flash)
  if (connectionState === 'connected' && !showSuccessFlash) {
    return null;
  }

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(300)}
      style={[
        styles.container,
        isFailed && styles.containerFailed,
        containerAnimatedStyle,
      ]}
    >
      {/* Success flash overlay */}
      <Animated.View
        style={[styles.flashOverlay, flashAnimatedStyle]}
        pointerEvents="none"
      />

      <View style={styles.content}>
        {/* PulseRing draws attention during connecting state */}
        <PulseRing
          isActive={isConnecting && !prefersReducedMotion}
          size={6}
          color={STATUS_COLORS[connectionState as keyof typeof STATUS_COLORS] || STATUS_COLORS.disconnected}
          rings={isConnecting ? 2 : 1}
        >
          <Animated.View style={[styles.indicator, indicatorAnimatedStyle]} />
        </PulseRing>
        <Animated.Text style={[styles.message, textAnimatedStyle]}>
          {getMessage()}
        </Animated.Text>
        {reconnectAttempt > 0 && (
          <Text style={styles.count}>
            ({reconnectAttempt}/{maxReconnectAttempts})
          </Text>
        )}
      </View>
      {isFailed && onRetry && (
        <Pressable
          onPress={onRetry}
          style={styles.retryButton}
          accessibilityRole="button"
          accessibilityLabel="Reconnect to server"
        >
          <Text style={styles.retryText}>Reconnect</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden', // Clip flash overlay
  },
  containerFailed: {
    borderColor: COLORS.destructive,
  },
  flashOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(52, 199, 89, 0.2)', // Success green at 20%
    borderRadius: RADIUS.md,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  indicator: {
    width: 6,
    height: 6,
    borderRadius: RADIUS.full,
  },
  message: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.label,
    fontSize: 11,
  },
  count: {
    ...TYPOGRAPHY.label,
    fontSize: 10,
    color: COLORS.textMuted,
  },
  retryButton: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.textPrimary,
    borderRadius: RADIUS.full,
  },
  retryText: {
    color: COLORS.surface,
    ...TYPOGRAPHY.label,
    fontSize: 10,
  },
});
