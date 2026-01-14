/**
 * ErrorRecoveryOverlay - Premium error state recovery UX (US-120)
 *
 * Provides visual feedback and recovery options when errors occur:
 * - Slide-in error banner from top with icon
 * - Dim/desaturate background on error state
 * - Recovery action buttons (reconnect, retry, lobby)
 * - Pulse animation on reconnecting status
 * - Success flash animation when recovered
 *
 * @example
 * ```tsx
 * <ErrorRecoveryOverlay
 *   isVisible={hasError}
 *   errorType="network"
 *   message="Connection lost"
 *   isRecovering={isReconnecting}
 *   onRetry={handleRetry}
 *   onReconnect={handleReconnect}
 *   onGoToLobby={navigateToLobby}
 * />
 * ```
 */
import React, { useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS } from '../../constants/theme';
import { PulseRing } from './MicroInteractions';
import { useTheme } from '../../context/ThemeContext';
import { haptics } from '../../services/haptics';

/* ─────────────────────────────────────────────────────────────────────────────
 * Types
 * ───────────────────────────────────────────────────────────────────────────── */

/** Error type determines icon and default recovery action */
export type ErrorType = 'network' | 'parse' | 'server' | 'timeout' | 'unknown';

/** Recovery state for tracking reconnection attempts */
export type RecoveryState = 'idle' | 'recovering' | 'success' | 'failed';

interface ErrorRecoveryOverlayProps {
  /** Whether the error overlay is visible */
  isVisible: boolean;
  /** Type of error for icon selection */
  errorType: ErrorType;
  /** Error message to display */
  message: string;
  /** Current recovery state */
  recoveryState?: RecoveryState;
  /** Callback for retry action (game errors) */
  onRetry?: () => void;
  /** Callback for reconnect action (network errors) */
  onReconnect?: () => void;
  /** Callback to navigate back to lobby */
  onGoToLobby?: () => void;
  /** Optional callback when overlay is dismissed (success recovery) */
  onDismiss?: () => void;
  /** Test ID for testing */
  testID?: string;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Error Icons (Pure RN Views - no SVG dependency)
 * ───────────────────────────────────────────────────────────────────────────── */

interface ErrorIconProps {
  type: ErrorType;
  size?: number;
  color?: string;
}

function ErrorIcon({ type, size = 24, color = COLORS.textPrimary }: ErrorIconProps) {
  switch (type) {
    case 'network':
      // WiFi icon with X
      return (
        <View style={{ width: size, height: size }} testID="error-icon-network">
          {/* WiFi arcs */}
          <View style={[iconStyles.wifiArc, { borderColor: color, width: size * 0.8, height: size * 0.4, top: size * 0.15 }]} />
          <View style={[iconStyles.wifiArc, { borderColor: color, width: size * 0.5, height: size * 0.25, top: size * 0.35 }]} />
          {/* Center dot */}
          <View style={[iconStyles.wifiDot, { backgroundColor: color, bottom: size * 0.15 }]} />
          {/* X overlay */}
          <View style={[iconStyles.xLine, { backgroundColor: COLORS.error, width: size * 0.5, transform: [{ rotate: '45deg' }] }]} />
          <View style={[iconStyles.xLine, { backgroundColor: COLORS.error, width: size * 0.5, transform: [{ rotate: '-45deg' }] }]} />
        </View>
      );

    case 'parse':
    case 'server':
      // Warning triangle
      return (
        <View style={{ width: size, height: size }} testID={`error-icon-${type}`}>
          <View style={[iconStyles.triangleContainer, { borderBottomWidth: size * 0.8, borderLeftWidth: size * 0.5, borderRightWidth: size * 0.5 }]}>
            <View style={[iconStyles.triangleInner, { borderBottomWidth: size * 0.6, borderLeftWidth: size * 0.35, borderRightWidth: size * 0.35, borderBottomColor: color }]} />
          </View>
          {/* Exclamation mark */}
          <View style={[iconStyles.exclamationLine, { backgroundColor: COLORS.background, height: size * 0.25, top: size * 0.35 }]} />
          <View style={[iconStyles.exclamationDot, { backgroundColor: COLORS.background, bottom: size * 0.25 }]} />
        </View>
      );

    case 'timeout':
      // Clock with X
      return (
        <View style={{ width: size, height: size }} testID="error-icon-timeout">
          <View style={[iconStyles.clockCircle, { borderColor: color, width: size * 0.8, height: size * 0.8 }]} />
          {/* Clock hands */}
          <View style={[iconStyles.clockHand, { backgroundColor: color, height: size * 0.25, transform: [{ rotate: '-45deg' }] }]} />
          <View style={[iconStyles.clockHand, { backgroundColor: color, height: size * 0.2, transform: [{ rotate: '60deg' }] }]} />
        </View>
      );

    default:
      // Generic error circle with X
      return (
        <View style={{ width: size, height: size }} testID="error-icon-unknown">
          <View style={[iconStyles.errorCircle, { borderColor: COLORS.error, width: size * 0.8, height: size * 0.8 }]} />
          <View style={[iconStyles.xLine, { backgroundColor: COLORS.error, width: size * 0.35, transform: [{ rotate: '45deg' }] }]} />
          <View style={[iconStyles.xLine, { backgroundColor: COLORS.error, width: size * 0.35, transform: [{ rotate: '-45deg' }] }]} />
        </View>
      );
  }
}

const iconStyles = StyleSheet.create({
  wifiArc: {
    position: 'absolute',
    alignSelf: 'center',
    borderTopLeftRadius: 100,
    borderTopRightRadius: 100,
    borderWidth: 2,
    borderBottomWidth: 0,
  },
  wifiDot: {
    position: 'absolute',
    alignSelf: 'center',
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  xLine: {
    position: 'absolute',
    alignSelf: 'center',
    top: '40%',
    height: 2,
    borderRadius: 1,
  },
  triangleContainer: {
    alignSelf: 'center',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: COLORS.warning,
  },
  triangleInner: {
    position: 'absolute',
    alignSelf: 'center',
    top: 4,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  exclamationLine: {
    position: 'absolute',
    alignSelf: 'center',
    width: 3,
    borderRadius: 1.5,
  },
  exclamationDot: {
    position: 'absolute',
    alignSelf: 'center',
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  clockCircle: {
    position: 'absolute',
    alignSelf: 'center',
    top: '10%',
    borderWidth: 2,
    borderRadius: 100,
  },
  clockHand: {
    position: 'absolute',
    alignSelf: 'center',
    top: '35%',
    width: 2,
    borderRadius: 1,
    transformOrigin: 'bottom',
  },
  errorCircle: {
    position: 'absolute',
    alignSelf: 'center',
    top: '10%',
    borderWidth: 2,
    borderRadius: 100,
  },
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Success Flash Component
 * ───────────────────────────────────────────────────────────────────────────── */

interface SuccessFlashProps {
  isActive: boolean;
  onComplete?: () => void;
}

function SuccessFlash({ isActive, onComplete }: SuccessFlashProps) {
  const flashOpacity = useSharedValue(0);

  useEffect(() => {
    if (!isActive) return;

    // Quick flash in, slower fade out
    flashOpacity.value = withSequence(
      withTiming(0.6, { duration: 100 }),
      withTiming(0, { duration: 600, easing: Easing.out(Easing.ease) })
    );

    // Trigger completion callback after animation
    const timeout = setTimeout(() => {
      onComplete?.();
    }, 700);

    return () => clearTimeout(timeout);
  }, [isActive, flashOpacity, onComplete]);

  const flashStyle = useAnimatedStyle(() => ({
    opacity: flashOpacity.value,
  }));

  if (!isActive) return null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.successFlash, flashStyle]}
      pointerEvents="none"
      testID="success-flash"
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Main Component
 * ───────────────────────────────────────────────────────────────────────────── */

export function ErrorRecoveryOverlay({
  isVisible,
  errorType,
  message,
  recoveryState = 'idle',
  onRetry,
  onReconnect,
  onGoToLobby,
  onDismiss,
  testID = 'error-recovery-overlay',
}: ErrorRecoveryOverlayProps) {
  const { isDark } = useTheme();

  // Animation values
  const bannerTranslateY = useSharedValue(-100);
  const overlayOpacity = useSharedValue(0);
  const contentScale = useSharedValue(1);
  const [showSuccess, setShowSuccess] = React.useState(false);

  // Track previous recovery state to detect success
  const prevRecoveryState = React.useRef(recoveryState);

  useEffect(() => {
    // Detect recovery success transition
    if (prevRecoveryState.current === 'recovering' && recoveryState === 'success') {
      setShowSuccess(true);
      haptics.win().catch(() => {});
    }
    prevRecoveryState.current = recoveryState;
  }, [recoveryState]);

  useEffect(() => {
    if (isVisible) {
      // Slide banner in, fade overlay
      bannerTranslateY.value = withSpring(0, { damping: 20, stiffness: 200 });
      overlayOpacity.value = withTiming(1, { duration: 300 });
      contentScale.value = withTiming(0.98, { duration: 300 });
    } else {
      // Slide banner out, fade overlay
      bannerTranslateY.value = withTiming(-100, { duration: 200 });
      overlayOpacity.value = withTiming(0, { duration: 300 });
      contentScale.value = withTiming(1, { duration: 300 });
    }
  }, [isVisible, bannerTranslateY, overlayOpacity, contentScale]);

  const bannerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bannerTranslateY.value }],
  }));

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const handleSuccessComplete = useCallback(() => {
    setShowSuccess(false);
    onDismiss?.();
  }, [onDismiss]);

  const handleRetry = useCallback(() => {
    haptics.buttonPress().catch(() => {});
    onRetry?.();
  }, [onRetry]);

  const handleReconnect = useCallback(() => {
    haptics.buttonPress().catch(() => {});
    onReconnect?.();
  }, [onReconnect]);

  const handleGoToLobby = useCallback(() => {
    haptics.buttonPress().catch(() => {});
    onGoToLobby?.();
  }, [onGoToLobby]);

  // Determine which action buttons to show based on error type
  const showReconnect = errorType === 'network' || errorType === 'timeout';
  const showRetry = errorType === 'parse' || errorType === 'server' || errorType === 'unknown';
  const isRecovering = recoveryState === 'recovering';

  // Status indicator color
  const statusColor = isRecovering ? COLORS.gold : COLORS.error;

  if (!isVisible && !showSuccess) return null;

  return (
    <View
      style={StyleSheet.absoluteFill}
      testID={testID}
      pointerEvents="box-none"
      accessibilityRole="alert"
      accessibilityLabel={`${getErrorTitle(errorType)}: ${message}`}
      accessibilityLiveRegion="assertive"
    >
      {/* Dimmed background overlay */}
      <Animated.View
        style={[styles.overlay, overlayStyle]}
        pointerEvents={isVisible ? 'auto' : 'none'}
      >
        <BlurView
          intensity={isDark ? 15 : 10}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.dimOverlay, { backgroundColor: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)' }]} />
      </Animated.View>

      {/* Slide-in error banner */}
      <Animated.View style={[styles.bannerContainer, bannerStyle]}>
        <View style={[styles.banner, isDark && styles.bannerDark]}>
          {/* Icon with pulse effect when recovering */}
          <View style={styles.iconContainer}>
            <PulseRing isActive={isRecovering} size={12} color={statusColor} rings={isRecovering ? 2 : 1}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            </PulseRing>
          </View>

          {/* Error icon */}
          <ErrorIcon type={errorType} size={20} color={COLORS.textPrimary} />

          {/* Message */}
          <View style={styles.messageContainer}>
            <Text style={styles.errorTitle} numberOfLines={1}>
              {getErrorTitle(errorType)}
            </Text>
            <Text style={styles.errorMessage} numberOfLines={2}>
              {message}
            </Text>
          </View>

          {/* Recovery status text when recovering */}
          {isRecovering && (
            <Text style={styles.recoveringText}>Reconnecting...</Text>
          )}
        </View>

        {/* Action buttons */}
        <View style={styles.actionsContainer}>
          {showReconnect && onReconnect && (
            <TouchableOpacity
              style={[styles.actionButton, styles.primaryButton]}
              onPress={handleReconnect}
              disabled={isRecovering}
              activeOpacity={0.7}
              testID="error-reconnect-button"
              accessibilityRole="button"
              accessibilityLabel={isRecovering ? 'Connecting' : 'Reconnect'}
              accessibilityState={{ disabled: isRecovering }}
            >
              <Text style={[styles.actionText, styles.primaryText]}>
                {isRecovering ? 'Connecting...' : 'Reconnect'}
              </Text>
            </TouchableOpacity>
          )}

          {showRetry && onRetry && (
            <TouchableOpacity
              style={[styles.actionButton, styles.primaryButton]}
              onPress={handleRetry}
              disabled={isRecovering}
              activeOpacity={0.7}
              testID="error-retry-button"
              accessibilityRole="button"
              accessibilityLabel="Retry"
              accessibilityState={{ disabled: isRecovering }}
            >
              <Text style={[styles.actionText, styles.primaryText]}>Retry</Text>
            </TouchableOpacity>
          )}

          {onGoToLobby && (
            <TouchableOpacity
              style={[styles.actionButton, styles.secondaryButton]}
              onPress={handleGoToLobby}
              activeOpacity={0.7}
              testID="error-lobby-button"
              accessibilityRole="button"
              accessibilityLabel="Back to Lobby"
            >
              <Text style={[styles.actionText, styles.secondaryText]}>Back to Lobby</Text>
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>

      {/* Success flash overlay */}
      <SuccessFlash isActive={showSuccess} onComplete={handleSuccessComplete} />
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ───────────────────────────────────────────────────────────────────────────── */

function getErrorTitle(type: ErrorType): string {
  switch (type) {
    case 'network':
      return 'Connection Lost';
    case 'parse':
      return 'Data Error';
    case 'server':
      return 'Server Error';
    case 'timeout':
      return 'Request Timeout';
    default:
      return 'Something Went Wrong';
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * useErrorRecovery Hook
 * ───────────────────────────────────────────────────────────────────────────── */

interface ErrorState {
  isVisible: boolean;
  errorType: ErrorType;
  message: string;
  recoveryState: RecoveryState;
}

interface UseErrorRecoveryOptions {
  /** Auto-dismiss after successful recovery (ms) */
  autoDismissDelay?: number;
}

/**
 * Hook for managing error recovery state
 *
 * @example
 * ```tsx
 * const { errorState, showError, startRecovery, recoverySuccess, clearError } = useErrorRecovery();
 *
 * // Show network error
 * showError('network', 'Unable to connect to server');
 *
 * // Start recovery
 * startRecovery();
 * await reconnect();
 * recoverySuccess();
 * ```
 */
export function useErrorRecovery(options: UseErrorRecoveryOptions = {}) {
  const { autoDismissDelay = 1000 } = options;
  const dismissTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const [errorState, setErrorState] = React.useState<ErrorState>({
    isVisible: false,
    errorType: 'unknown',
    message: '',
    recoveryState: 'idle',
  });

  const clearDismissTimeout = useCallback(() => {
    if (dismissTimeoutRef.current) {
      clearTimeout(dismissTimeoutRef.current);
      dismissTimeoutRef.current = null;
    }
  }, []);

  React.useEffect(() => () => {
    clearDismissTimeout();
  }, [clearDismissTimeout]);

  const showError = useCallback((type: ErrorType, message: string) => {
    clearDismissTimeout();
    setErrorState({
      isVisible: true,
      errorType: type,
      message,
      recoveryState: 'idle',
    });
    haptics.error().catch(() => {});
  }, [clearDismissTimeout]);

  const startRecovery = useCallback(() => {
    setErrorState(prev => ({
      ...prev,
      recoveryState: 'recovering',
    }));
  }, []);

  const recoverySuccess = useCallback(() => {
    setErrorState(prev => ({
      ...prev,
      recoveryState: 'success',
    }));

    // Auto-dismiss after delay
    clearDismissTimeout();
    dismissTimeoutRef.current = setTimeout(() => {
      setErrorState({
        isVisible: false,
        errorType: 'unknown',
        message: '',
        recoveryState: 'idle',
      });
    }, autoDismissDelay);
  }, [autoDismissDelay, clearDismissTimeout]);

  const recoveryFailed = useCallback((newMessage?: string) => {
    setErrorState(prev => ({
      ...prev,
      message: newMessage || prev.message,
      recoveryState: 'failed',
    }));
  }, []);

  const clearError = useCallback(() => {
    clearDismissTimeout();
    setErrorState({
      isVisible: false,
      errorType: 'unknown',
      message: '',
      recoveryState: 'idle',
    });
  }, [clearDismissTimeout]);

  return {
    errorState,
    showError,
    startRecovery,
    recoverySuccess,
    recoveryFailed,
    clearError,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Styles
 * ───────────────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  dimOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  bannerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 60, // Safe area offset
    paddingHorizontal: SPACING.md,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.error,
    shadowColor: COLORS.error,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
    gap: SPACING.sm,
  },
  bannerDark: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.error,
  },
  iconContainer: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  messageContainer: {
    flex: 1,
  },
  errorTitle: {
    ...TYPOGRAPHY.label,
    color: COLORS.textPrimary,
    fontWeight: '600',
  },
  errorMessage: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  recoveringText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.gold,
    fontStyle: 'italic',
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.md,
    justifyContent: 'center',
  },
  actionButton: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.full,
    minWidth: 100,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionText: {
    ...TYPOGRAPHY.label,
    fontWeight: '600',
  },
  primaryText: {
    color: '#FFFFFF',
  },
  secondaryText: {
    color: COLORS.textSecondary,
  },
  successFlash: {
    backgroundColor: COLORS.success,
  },
});
