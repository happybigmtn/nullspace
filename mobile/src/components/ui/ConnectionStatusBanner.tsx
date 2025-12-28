/**
 * ConnectionStatusBanner - Shows connection status with reconnection feedback
 * Displays when disconnected or reconnecting, hidden when connected
 */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS } from '../../constants/theme';
import type { ConnectionState } from '../../services/websocket';

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
  const pulseOpacity = useSharedValue(1);

  useEffect(() => {
    if (connectionState === 'connecting') {
      pulseOpacity.value = withRepeat(
        withTiming(0.4, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    } else {
      pulseOpacity.value = 1;
    }
  }, [connectionState]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  if (connectionState === 'connected') {
    return null;
  }

  const isFailed = connectionState === 'failed';
  const isConnecting = connectionState === 'connecting';
  const statusColor = isFailed ? COLORS.destructive : isConnecting ? COLORS.gold : COLORS.textMuted;

  const getMessage = (): string => {
    if (isFailed) return 'Disconnected';
    if (isConnecting) return 'Connecting';
    return 'Status Unknown';
  };

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(300)}
      style={[styles.container, isFailed && styles.containerFailed]}
    >
      <View style={styles.content}>
        <Animated.View style={[styles.indicator, pulseStyle, { backgroundColor: statusColor }]} />
        <Text style={styles.message}>{getMessage()}</Text>
        {reconnectAttempt > 0 && (
            <Text style={styles.count}>({reconnectAttempt}/{maxReconnectAttempts})</Text>
        )}
      </View>
      {isFailed && onRetry && (
        <Pressable onPress={onRetry} style={styles.retryButton}>
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
  },
  containerFailed: {
    borderColor: COLORS.destructive,
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