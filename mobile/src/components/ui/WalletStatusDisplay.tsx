/**
 * WalletStatusDisplay - Shows wallet connection status and network state (AC-8.1)
 *
 * Displays connection status with visual indicators:
 * - Green dot: Connected and ready
 * - Yellow dot: Connecting
 * - Red dot: Disconnected or error
 * - Lock icon: Vault locked
 *
 * Provides user feedback for:
 * - Connection state changes
 * - Session restoration status
 * - Error conditions with guidance
 */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
  interpolateColor,
  cancelAnimation,
} from 'react-native-reanimated';
import { useEffect, useMemo } from 'react';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS, ANIMATION } from '../../constants/theme';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { WalletConnectionStatus } from '../../hooks/useWalletConnection';

/** Status colors for visual feedback */
const STATUS_COLORS = {
  connected: '#34C759',     // Success green
  connecting: '#FFD700',    // Gold/yellow
  vault_locked: '#8B5CF6',  // Purple (security)
  offline: '#6B7280',       // Muted gray
  error: '#FF3B30',         // Destructive red
} as const;

/** Status messages for user feedback */
const STATUS_MESSAGES: Record<WalletConnectionStatus, string> = {
  disconnected: 'Not connected',
  vault_missing: 'Create wallet',
  vault_locked: 'Unlock wallet',
  vault_corrupted: 'Wallet error',
  connecting: 'Connecting...',
  connected: 'Connected',
  offline: 'Offline',
  error: 'Connection error',
};

/** Detailed status descriptions */
const STATUS_DESCRIPTIONS: Record<WalletConnectionStatus, string> = {
  disconnected: 'Tap to connect your wallet',
  vault_missing: 'Set up a new wallet to get started',
  vault_locked: 'Enter your password to unlock',
  vault_corrupted: 'Recovery key needed',
  connecting: 'Establishing secure connection',
  connected: 'Wallet ready',
  offline: 'Check your internet connection',
  error: 'Tap to retry',
};

interface WalletStatusDisplayProps {
  /** Current wallet connection status */
  status: WalletConnectionStatus;
  /** User's public key (truncated for display) */
  publicKey?: string | null;
  /** Current balance */
  balance?: number;
  /** True if balance has been fetched */
  balanceReady?: boolean;
  /** True if session was restored from storage */
  sessionRestored?: boolean;
  /** Error message to display */
  errorMessage?: string | null;
  /** Called when user taps the status display */
  onPress?: () => void;
  /** Compact mode for inline display */
  compact?: boolean;
}

/**
 * Truncate a public key for display (e.g., "abc1...xyz9")
 */
function truncatePublicKey(key: string | null | undefined): string {
  if (!key) return '';
  if (key.length <= 12) return key;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

/**
 * Format balance for display
 */
function formatBalance(balance: number): string {
  return balance.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/**
 * Get status color based on connection status
 */
function getStatusColor(status: WalletConnectionStatus): string {
  switch (status) {
    case 'connected':
      return STATUS_COLORS.connected;
    case 'connecting':
      return STATUS_COLORS.connecting;
    case 'vault_locked':
      return STATUS_COLORS.vault_locked;
    case 'offline':
    case 'disconnected':
    case 'vault_missing':
      return STATUS_COLORS.offline;
    case 'error':
    case 'vault_corrupted':
      return STATUS_COLORS.error;
    default:
      return STATUS_COLORS.offline;
  }
}

export function WalletStatusDisplay({
  status,
  publicKey,
  balance = 0,
  balanceReady = false,
  sessionRestored = false,
  errorMessage,
  onPress,
  compact = false,
}: WalletStatusDisplayProps) {
  const prefersReducedMotion = useReducedMotion();
  const color = getStatusColor(status);

  // Animated values
  const pulseScale = useSharedValue(1);
  const colorProgress = useSharedValue(0);

  // Pulse animation for connecting state
  useEffect(() => {
    if (status === 'connecting' && !prefersReducedMotion) {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.3, { duration: 500 }),
          withTiming(1, { duration: 500 })
        ),
        -1, // Infinite
        true // Reverse
      );
    } else {
      cancelAnimation(pulseScale);
      pulseScale.value = withSpring(1, ANIMATION.spring);
    }

    return () => {
      cancelAnimation(pulseScale);
    };
  }, [status, prefersReducedMotion, pulseScale]);

  // Color transition animation
  useEffect(() => {
    const targetValue =
      status === 'connected' ? 0 :
      status === 'connecting' ? 1 :
      status === 'vault_locked' ? 2 :
      status === 'error' || status === 'vault_corrupted' ? 3 : 4;

    if (prefersReducedMotion) {
      colorProgress.value = targetValue;
    } else {
      colorProgress.value = withSpring(targetValue, ANIMATION.spring);
    }
  }, [status, prefersReducedMotion, colorProgress]);

  // Animated styles
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    backgroundColor: interpolateColor(
      colorProgress.value,
      [0, 1, 2, 3, 4],
      [
        STATUS_COLORS.connected,
        STATUS_COLORS.connecting,
        STATUS_COLORS.vault_locked,
        STATUS_COLORS.error,
        STATUS_COLORS.offline,
      ]
    ),
  }));

  const textStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      colorProgress.value,
      [0, 1, 2, 3, 4],
      [
        STATUS_COLORS.connected,
        STATUS_COLORS.connecting,
        STATUS_COLORS.vault_locked,
        STATUS_COLORS.error,
        STATUS_COLORS.offline,
      ]
    ),
  }));

  // Determine what to show
  const showBalance = status === 'connected' && balanceReady;
  const showPublicKey = status === 'connected' && publicKey;
  const showError = errorMessage && (status === 'error' || status === 'vault_corrupted');
  const isInteractive = onPress && status !== 'connecting';

  const content = (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      style={[styles.container, compact && styles.containerCompact]}
    >
      {/* Status indicator */}
      <View style={styles.indicatorContainer}>
        <Animated.View style={[styles.indicator, indicatorStyle]} />
      </View>

      {/* Status content */}
      <View style={styles.content}>
        <View style={styles.statusRow}>
          <Animated.Text
            style={[
              styles.statusText,
              compact && styles.statusTextCompact,
              textStyle,
            ]}
          >
            {STATUS_MESSAGES[status]}
          </Animated.Text>

          {sessionRestored && status === 'connected' && (
            <Text style={styles.restoredBadge}>Restored</Text>
          )}
        </View>

        {!compact && (
          <>
            {showBalance && (
              <Text style={styles.balanceText}>
                {formatBalance(balance)} credits
              </Text>
            )}

            {showPublicKey && !showBalance && (
              <Text style={styles.publicKeyText}>
                {truncatePublicKey(publicKey)}
              </Text>
            )}

            {showError && (
              <Text style={styles.errorText} numberOfLines={2}>
                {errorMessage}
              </Text>
            )}

            {!showBalance && !showError && status !== 'connected' && (
              <Text style={styles.descriptionText}>
                {STATUS_DESCRIPTIONS[status]}
              </Text>
            )}
          </>
        )}
      </View>

      {/* Action indicator */}
      {isInteractive && (
        <Text style={styles.actionIndicator}>{'>'}</Text>
      )}
    </Animated.View>
  );

  if (isInteractive) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.pressable,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Wallet status: ${STATUS_MESSAGES[status]}. ${STATUS_DESCRIPTIONS[status]}`}
        accessibilityHint="Tap to manage wallet"
      >
        {content}
      </Pressable>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  pressable: {
    borderRadius: RADIUS.md,
  },
  pressed: {
    opacity: 0.7,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: SPACING.md,
  },
  containerCompact: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    gap: SPACING.sm,
  },
  indicatorContainer: {
    width: 12,
    height: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: RADIUS.full,
  },
  content: {
    flex: 1,
    gap: 2, // Tighter gap between status text and description
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  statusText: {
    ...TYPOGRAPHY.label,
    fontSize: 13,
    fontWeight: '600',
  },
  statusTextCompact: {
    fontSize: 11,
  },
  restoredBadge: {
    ...TYPOGRAPHY.label,
    fontSize: 9,
    color: COLORS.textMuted,
    backgroundColor: COLORS.surfaceElevated,
    paddingHorizontal: SPACING.xs,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
  },
  balanceText: {
    ...TYPOGRAPHY.body,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  publicKeyText: {
    ...TYPOGRAPHY.mono,
    fontSize: 10,
    color: COLORS.textMuted,
  },
  descriptionText: {
    ...TYPOGRAPHY.body,
    fontSize: 11,
    color: COLORS.textMuted,
  },
  errorText: {
    ...TYPOGRAPHY.body,
    fontSize: 11,
    color: STATUS_COLORS.error,
  },
  actionIndicator: {
    ...TYPOGRAPHY.label,
    fontSize: 14,
    color: COLORS.textMuted,
    marginLeft: SPACING.sm,
  },
});

export default WalletStatusDisplay;
