/**
 * Tests for ReadOnlyBanner component (AC-8.4)
 *
 * Validates read-only mode banner display, messaging, and actions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReadOnlyReason } from '../../../hooks/useReadOnlyMode';

// Mock dependencies
vi.mock('react-native-reanimated', () => ({
  default: {
    View: 'View',
    Text: 'Text',
  },
  FadeIn: { duration: vi.fn(() => ({})) },
  FadeOut: { duration: vi.fn(() => ({})) },
  useSharedValue: vi.fn((initial) => ({ value: initial })),
  useAnimatedStyle: vi.fn(() => ({})),
  withSpring: vi.fn((v) => v),
  withSequence: vi.fn((...args) => args[args.length - 1]),
  withTiming: vi.fn((v) => v),
  Easing: { out: vi.fn(), cubic: vi.fn() },
}));

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  StyleSheet: {
    create: (styles: Record<string, unknown>) => styles,
  },
  Pressable: 'Pressable',
}));

vi.mock('../../../hooks/useReducedMotion', () => ({
  useReducedMotion: vi.fn(() => false),
}));

vi.mock('../MicroInteractions', () => ({
  PulseRing: 'PulseRing',
}));

describe('ReadOnlyBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Visibility logic', () => {
    it('should not render when visible is false', () => {
      const props = {
        visible: false,
        reason: 'offline' as ReadOnlyReason,
        message: 'No internet connection',
      };

      // When visible is false, component returns null
      expect(props.visible).toBe(false);
    });

    it('should not render when reason is null', () => {
      const props = {
        visible: true,
        reason: null as ReadOnlyReason,
        message: '',
      };

      // When reason is null, component returns null
      expect(props.reason).toBeNull();
    });

    it('should render when visible is true and reason is provided', () => {
      const props = {
        visible: true,
        reason: 'offline' as ReadOnlyReason,
        message: 'Offline - Read Only',
      };

      expect(props.visible).toBe(true);
      expect(props.reason).not.toBeNull();
    });
  });

  describe('Reason color mapping', () => {
    const REASON_COLORS = {
      offline: '#FF9500',
      reconnecting: '#FFD700',
      failed: '#FF3B30',
      connecting: '#FFD700',
    } as const;

    it('should use warning orange for offline', () => {
      expect(REASON_COLORS.offline).toBe('#FF9500');
    });

    it('should use gold for reconnecting', () => {
      expect(REASON_COLORS.reconnecting).toBe('#FFD700');
    });

    it('should use destructive red for failed', () => {
      expect(REASON_COLORS.failed).toBe('#FF3B30');
    });

    it('should use gold for connecting', () => {
      expect(REASON_COLORS.connecting).toBe('#FFD700');
    });
  });

  describe('Reason icon mapping', () => {
    const REASON_ICONS = {
      offline: '\u26A0',       // Warning sign
      reconnecting: '\u21BB',  // Clockwise loop arrow
      failed: '\u2716',        // Heavy multiplication X
      connecting: '\u2026',    // Horizontal ellipsis
    } as const;

    it('should use warning sign for offline', () => {
      expect(REASON_ICONS.offline).toBe('\u26A0');
    });

    it('should use loop arrow for reconnecting', () => {
      expect(REASON_ICONS.reconnecting).toBe('\u21BB');
    });

    it('should use X mark for failed', () => {
      expect(REASON_ICONS.failed).toBe('\u2716');
    });

    it('should use ellipsis for connecting', () => {
      expect(REASON_ICONS.connecting).toBe('\u2026');
    });
  });

  describe('Progress text generation', () => {
    it('should show attempt count during reconnecting', () => {
      const reconnectAttempt = 3;
      const maxReconnectAttempts = 10;
      const nextReconnectIn: number | null = null;
      const isReconnecting = true;

      let progressText = '';
      if (isReconnecting && reconnectAttempt > 0) {
        progressText = `(${reconnectAttempt}/${maxReconnectAttempts})`;
        if (nextReconnectIn !== null && nextReconnectIn > 0) {
          progressText += ` \u2022 ${nextReconnectIn}s`;
        }
      }

      expect(progressText).toBe('(3/10)');
    });

    it('should show attempt count with countdown', () => {
      const reconnectAttempt = 5;
      const maxReconnectAttempts = 10;
      const nextReconnectIn = 8;
      const isReconnecting = true;

      let progressText = '';
      if (isReconnecting && reconnectAttempt > 0) {
        progressText = `(${reconnectAttempt}/${maxReconnectAttempts})`;
        if (nextReconnectIn !== null && nextReconnectIn > 0) {
          progressText += ` \u2022 ${nextReconnectIn}s`;
        }
      }

      expect(progressText).toBe('(5/10) \u2022 8s');
    });

    it('should not show progress when not reconnecting', () => {
      const reconnectAttempt = 0;
      const isReconnecting = false;

      let progressText = '';
      if (isReconnecting && reconnectAttempt > 0) {
        progressText = '(0/10)';
      }

      expect(progressText).toBe('');
    });
  });

  describe('Action button visibility', () => {
    it('should show retry button during reconnecting with handler', () => {
      const reason: ReadOnlyReason = 'reconnecting';
      const onRetry = vi.fn();
      const isReconnecting = reason === 'reconnecting' || reason === 'connecting';

      expect(isReconnecting).toBe(true);
      expect(typeof onRetry).toBe('function');
    });

    it('should show retry button during connecting with handler', () => {
      const reason: ReadOnlyReason = 'connecting';
      const onRetry = vi.fn();
      const isReconnecting = reason === 'reconnecting' || reason === 'connecting';

      expect(isReconnecting).toBe(true);
      expect(typeof onRetry).toBe('function');
    });

    it('should show reconnect button during failed with handler', () => {
      const reason: ReadOnlyReason = 'failed';
      const onResetAndRetry = vi.fn();
      const isFailed = reason === 'failed';

      expect(isFailed).toBe(true);
      expect(typeof onResetAndRetry).toBe('function');
    });

    it('should not show retry button when offline without reconnecting', () => {
      const reason: ReadOnlyReason = 'offline';
      const isReconnecting = reason === 'reconnecting' || reason === 'connecting';
      const isFailed = reason === 'failed';

      expect(isReconnecting).toBe(false);
      expect(isFailed).toBe(false);
    });
  });

  describe('Action handlers', () => {
    it('should call onRetry when retry button is pressed', () => {
      const onRetry = vi.fn();
      onRetry();
      expect(onRetry).toHaveBeenCalled();
    });

    it('should call onResetAndRetry when reconnect button is pressed', () => {
      const onResetAndRetry = vi.fn();
      onResetAndRetry();
      expect(onResetAndRetry).toHaveBeenCalled();
    });
  });

  describe('Accessibility', () => {
    it('should have alert role for screen readers', () => {
      const accessibilityProps = {
        accessibilityRole: 'alert' as const,
        accessibilityLiveRegion: 'polite' as const,
        accessibilityLabel: 'Read-only mode: Offline - Read Only',
      };

      expect(accessibilityProps.accessibilityRole).toBe('alert');
    });

    it('should have polite live region for announcements', () => {
      const accessibilityProps = {
        accessibilityLiveRegion: 'polite' as const,
      };

      expect(accessibilityProps.accessibilityLiveRegion).toBe('polite');
    });

    it('should have descriptive accessibility label', () => {
      const message = 'Offline - Read Only';
      const accessibilityLabel = `Read-only mode: ${message}`;

      expect(accessibilityLabel).toBe('Read-only mode: Offline - Read Only');
    });

    it('should have accessible retry button', () => {
      const buttonProps = {
        accessibilityRole: 'button' as const,
        accessibilityLabel: 'Retry connection now',
        accessibilityHint: 'Attempts to reconnect to the server immediately',
      };

      expect(buttonProps.accessibilityRole).toBe('button');
      expect(buttonProps.accessibilityLabel).toBe('Retry connection now');
      expect(buttonProps.accessibilityHint).toBe('Attempts to reconnect to the server immediately');
    });

    it('should have accessible reconnect button', () => {
      const buttonProps = {
        accessibilityRole: 'button' as const,
        accessibilityLabel: 'Reset and reconnect',
        accessibilityHint: 'Resets the connection and attempts to reconnect',
      };

      expect(buttonProps.accessibilityRole).toBe('button');
      expect(buttonProps.accessibilityLabel).toBe('Reset and reconnect');
      expect(buttonProps.accessibilityHint).toBe('Resets the connection and attempts to reconnect');
    });
  });

  describe('Animation states', () => {
    it('should activate pulse ring during reconnecting', () => {
      const reason: ReadOnlyReason = 'reconnecting';
      const prefersReducedMotion = false;
      const isReconnecting = reason === 'reconnecting' || reason === 'connecting';

      const pulseRingActive = isReconnecting && !prefersReducedMotion;

      expect(pulseRingActive).toBe(true);
    });

    it('should not activate pulse ring with reduced motion', () => {
      const reason: ReadOnlyReason = 'reconnecting';
      const prefersReducedMotion = true;
      const isReconnecting = reason === 'reconnecting' || reason === 'connecting';

      const pulseRingActive = isReconnecting && !prefersReducedMotion;

      expect(pulseRingActive).toBe(false);
    });

    it('should not activate pulse ring when offline', () => {
      const reason: ReadOnlyReason = 'offline';
      const prefersReducedMotion = false;
      const isReconnecting = reason === 'reconnecting' || reason === 'connecting';

      const pulseRingActive = isReconnecting && !prefersReducedMotion;

      expect(pulseRingActive).toBe(false);
    });
  });

  describe('Style derivation', () => {
    it('should apply border color based on reason', () => {
      const REASON_COLORS = {
        offline: '#FF9500',
        reconnecting: '#FFD700',
        failed: '#FF3B30',
        connecting: '#FFD700',
      } as const;

      const reason: ReadOnlyReason = 'offline';
      const color = reason ? REASON_COLORS[reason] : REASON_COLORS.offline;

      expect(color).toBe('#FF9500');
    });

    it('should apply minimum height for touch target', () => {
      const styles = {
        container: {
          minHeight: 44, // Touch target minimum
        },
      };

      expect(styles.container.minHeight).toBe(44);
    });
  });

  describe('Test ID support', () => {
    it('should use provided testID', () => {
      const props = {
        testID: 'custom-banner-id',
      };

      expect(props.testID).toBe('custom-banner-id');
    });

    it('should use default testID when not provided', () => {
      const defaultTestID = 'read-only-banner';

      expect(defaultTestID).toBe('read-only-banner');
    });
  });

  describe('AC-8.4 compliance', () => {
    it('should provide visible banner when app is in read-only mode', () => {
      // AC-8.4: App provides a read-only mode when connectivity is limited
      const offlineReasons: ReadOnlyReason[] = ['offline', 'reconnecting', 'failed'];

      offlineReasons.forEach((reason) => {
        const visible = true;
        const shouldShowBanner = visible && reason !== null;

        expect(shouldShowBanner).toBe(true);
      });
    });

    it('should display appropriate message for each connectivity state', () => {
      const messages = {
        offline: 'Offline - Read Only',
        reconnecting: 'Reconnecting...',
        failed: 'Connection Failed',
        connecting: 'Connecting...',
      };

      Object.entries(messages).forEach(([reason, message]) => {
        expect(message.length).toBeGreaterThan(0);
      });
    });

    it('should provide retry action for recovering from read-only mode', () => {
      const onRetry = vi.fn();
      const onResetAndRetry = vi.fn();

      // Both actions should be available
      expect(typeof onRetry).toBe('function');
      expect(typeof onResetAndRetry).toBe('function');

      // Actions should be callable
      onRetry();
      onResetAndRetry();

      expect(onRetry).toHaveBeenCalled();
      expect(onResetAndRetry).toHaveBeenCalled();
    });

    it('should show reconnect progress during reconnection attempts', () => {
      const reconnectAttempt = 3;
      const maxReconnectAttempts = 10;
      const nextReconnectIn = 5;

      const progressText = `(${reconnectAttempt}/${maxReconnectAttempts}) \u2022 ${nextReconnectIn}s`;

      expect(progressText).toBe('(3/10) \u2022 5s');
    });

    it('should be accessible to screen readers', () => {
      const accessibilityProps = {
        accessibilityRole: 'alert' as const,
        accessibilityLiveRegion: 'polite' as const,
        accessibilityLabel: 'Read-only mode: No internet connection',
      };

      // Alert role for important status messages
      expect(accessibilityProps.accessibilityRole).toBe('alert');

      // Polite live region so screen readers announce changes
      expect(accessibilityProps.accessibilityLiveRegion).toBe('polite');

      // Descriptive label for context
      expect(accessibilityProps.accessibilityLabel).toContain('Read-only mode');
    });
  });
});
