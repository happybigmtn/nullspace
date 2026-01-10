/**
 * Tests for ErrorRecoveryOverlay (US-120)
 *
 * Verifies:
 * - Overlay visibility and animation
 * - Error type icons and messaging
 * - Recovery action buttons
 * - Recovery state transitions
 * - Success flash animation
 * - Haptic feedback integration
 */
import React from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { ErrorRecoveryOverlay, useErrorRecovery } from '../ErrorRecoveryOverlay';
import type { ErrorType } from '../ErrorRecoveryOverlay';

// Mock expo-blur
jest.mock('expo-blur', () => ({
  BlurView: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock ThemeContext
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ isDark: false }),
}));

// Mock haptics - must be defined before jest.mock
jest.mock('../../../services/haptics', () => ({
  haptics: {
    buttonPress: jest.fn(() => Promise.resolve()),
    error: jest.fn(() => Promise.resolve()),
    win: jest.fn(() => Promise.resolve()),
  },
}));

// Get the mocked haptics for assertions
const { haptics: mockHaptics } = jest.requireMock('../../../services/haptics');

describe('ErrorRecoveryOverlay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  describe('visibility', () => {
    it('renders nothing when not visible', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <ErrorRecoveryOverlay
            isVisible={false}
            errorType="network"
            message="Test error"
          />
        );
      });

      expect(tree.toJSON()).toBeNull();
    });

    it('renders overlay when visible', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <ErrorRecoveryOverlay
            isVisible={true}
            errorType="network"
            message="Test error"
          />
        );
      });

      expect(tree.toJSON()).not.toBeNull();
      expect(tree.root.findByProps({ testID: 'error-recovery-overlay' })).toBeDefined();
    });
  });

  describe('error types', () => {
    const errorTypes: ErrorType[] = ['network', 'parse', 'server', 'timeout', 'unknown'];

    errorTypes.forEach((errorType) => {
      it(`renders correct icon for ${errorType} error`, () => {
        let tree!: ReturnType<typeof create>;
        act(() => {
          tree = create(
            <ErrorRecoveryOverlay
              isVisible={true}
              errorType={errorType}
              message={`${errorType} error message`}
            />
          );
        });

        const iconTestId = `error-icon-${errorType}`;
        const icon = tree.root.findByProps({ testID: iconTestId });
        expect(icon).toBeDefined();
      });
    });

    it('shows correct title for network error', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <ErrorRecoveryOverlay
            isVisible={true}
            errorType="network"
            message="Unable to connect"
          />
        );
      });

      const textContent = getAllTextContent(tree);
      expect(textContent).toContain('Connection Lost');
    });

    it('shows correct title for parse error', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <ErrorRecoveryOverlay
            isVisible={true}
            errorType="parse"
            message="Invalid data"
          />
        );
      });

      const textContent = getAllTextContent(tree);
      expect(textContent).toContain('Data Error');
    });

    it('shows correct title for server error', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <ErrorRecoveryOverlay
            isVisible={true}
            errorType="server"
            message="Server failed"
          />
        );
      });

      const textContent = getAllTextContent(tree);
      expect(textContent).toContain('Server Error');
    });

    it('shows correct title for timeout error', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <ErrorRecoveryOverlay
            isVisible={true}
            errorType="timeout"
            message="Request timed out"
          />
        );
      });

      const textContent = getAllTextContent(tree);
      expect(textContent).toContain('Request Timeout');
    });

    it('shows error message', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <ErrorRecoveryOverlay
            isVisible={true}
            errorType="network"
            message="Custom error message"
          />
        );
      });

      const textContent = getAllTextContent(tree);
      expect(textContent).toContain('Custom error message');
    });
  });

  describe('action buttons', () => {
    it('shows reconnect button for network error', () => {
      const onReconnect = jest.fn();
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <ErrorRecoveryOverlay
            isVisible={true}
            errorType="network"
            message="Connection lost"
            onReconnect={onReconnect}
          />
        );
      });

      const reconnectButton = tree.root.findByProps({ testID: 'error-reconnect-button' });
      expect(reconnectButton).toBeDefined();
    });

    it('shows reconnect button for timeout error', () => {
      const onReconnect = jest.fn();
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <ErrorRecoveryOverlay
            isVisible={true}
            errorType="timeout"
            message="Request timed out"
            onReconnect={onReconnect}
          />
        );
      });

      const reconnectButton = tree.root.findByProps({ testID: 'error-reconnect-button' });
      expect(reconnectButton).toBeDefined();
    });

    it('shows retry button for parse error', () => {
      const onRetry = jest.fn();
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <ErrorRecoveryOverlay
            isVisible={true}
            errorType="parse"
            message="Failed to parse"
            onRetry={onRetry}
          />
        );
      });

      const retryButton = tree.root.findByProps({ testID: 'error-retry-button' });
      expect(retryButton).toBeDefined();
    });

    it('shows retry button for server error', () => {
      const onRetry = jest.fn();
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <ErrorRecoveryOverlay
            isVisible={true}
            errorType="server"
            message="Server error"
            onRetry={onRetry}
          />
        );
      });

      const retryButton = tree.root.findByProps({ testID: 'error-retry-button' });
      expect(retryButton).toBeDefined();
    });

    it('shows lobby button when onGoToLobby provided', () => {
      const onGoToLobby = jest.fn();
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <ErrorRecoveryOverlay
            isVisible={true}
            errorType="network"
            message="Test error"
            onGoToLobby={onGoToLobby}
          />
        );
      });

      const lobbyButton = tree.root.findByProps({ testID: 'error-lobby-button' });
      expect(lobbyButton).toBeDefined();
    });

    it('invokes onReconnect when reconnect button pressed', () => {
      const onReconnect = jest.fn();
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <ErrorRecoveryOverlay
            isVisible={true}
            errorType="network"
            message="Test error"
            onReconnect={onReconnect}
          />
        );
      });

      const reconnectButton = tree.root.findByProps({ testID: 'error-reconnect-button' });
      act(() => {
        reconnectButton.props.onPress();
      });

      expect(onReconnect).toHaveBeenCalled();
      expect(mockHaptics.buttonPress).toHaveBeenCalled();
    });

    it('invokes onRetry when retry button pressed', () => {
      const onRetry = jest.fn();
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <ErrorRecoveryOverlay
            isVisible={true}
            errorType="parse"
            message="Test error"
            onRetry={onRetry}
          />
        );
      });

      const retryButton = tree.root.findByProps({ testID: 'error-retry-button' });
      act(() => {
        retryButton.props.onPress();
      });

      expect(onRetry).toHaveBeenCalled();
      expect(mockHaptics.buttonPress).toHaveBeenCalled();
    });

    it('invokes onGoToLobby when lobby button pressed', () => {
      const onGoToLobby = jest.fn();
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <ErrorRecoveryOverlay
            isVisible={true}
            errorType="network"
            message="Test error"
            onGoToLobby={onGoToLobby}
          />
        );
      });

      const lobbyButton = tree.root.findByProps({ testID: 'error-lobby-button' });
      act(() => {
        lobbyButton.props.onPress();
      });

      expect(onGoToLobby).toHaveBeenCalled();
      expect(mockHaptics.buttonPress).toHaveBeenCalled();
    });
  });

  describe('recovery state', () => {
    it('shows reconnecting text when recovering', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <ErrorRecoveryOverlay
            isVisible={true}
            errorType="network"
            message="Connection lost"
            recoveryState="recovering"
          />
        );
      });

      const textContent = getAllTextContent(tree);
      expect(textContent).toContain('Reconnecting...');
    });

    it('shows connecting text on button when recovering', () => {
      const onReconnect = jest.fn();
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <ErrorRecoveryOverlay
            isVisible={true}
            errorType="network"
            message="Connection lost"
            recoveryState="recovering"
            onReconnect={onReconnect}
          />
        );
      });

      const textContent = getAllTextContent(tree);
      expect(textContent).toContain('Connecting...');
    });

    it('shows success flash when recovery succeeds', () => {
      let tree!: ReturnType<typeof create>;
      // Start with recovering state
      act(() => {
        tree = create(
          <ErrorRecoveryOverlay
            isVisible={true}
            errorType="network"
            message="Connection lost"
            recoveryState="recovering"
          />
        );
      });

      // Transition to success
      act(() => {
        tree.update(
          <ErrorRecoveryOverlay
            isVisible={true}
            errorType="network"
            message="Connection lost"
            recoveryState="success"
          />
        );
      });

      const successFlash = tree.root.findByProps({ testID: 'success-flash' });
      expect(successFlash).toBeDefined();
      expect(mockHaptics.win).toHaveBeenCalled();
    });

    it('invokes onDismiss after success animation', () => {
      const onDismiss = jest.fn();
      let tree!: ReturnType<typeof create>;

      // Start with recovering
      act(() => {
        tree = create(
          <ErrorRecoveryOverlay
            isVisible={true}
            errorType="network"
            message="Connection lost"
            recoveryState="recovering"
            onDismiss={onDismiss}
          />
        );
      });

      // Transition to success
      act(() => {
        tree.update(
          <ErrorRecoveryOverlay
            isVisible={true}
            errorType="network"
            message="Connection lost"
            recoveryState="success"
            onDismiss={onDismiss}
          />
        );
      });

      // Fast forward past animation
      act(() => {
        jest.advanceTimersByTime(800);
      });

      expect(onDismiss).toHaveBeenCalled();
    });
  });
});

describe('useErrorRecovery hook', () => {
  type HookState = ReturnType<typeof useErrorRecovery>;

  function TestComponent({ onStateChange }: { onStateChange?: (state: HookState) => void }) {
    const recovery = useErrorRecovery();
    React.useEffect(() => {
      onStateChange?.(recovery);
    }, [recovery, onStateChange]);
    return null;
  }

  it('starts with idle state', () => {
    let state: HookState | null = null;
    act(() => {
      create(<TestComponent onStateChange={(s) => { state = s; }} />);
    });

    expect(state!.errorState.isVisible).toBe(false);
    expect(state!.errorState.recoveryState).toBe('idle');
  });

  it('shows error when showError is called', () => {
    let state: HookState | null = null;

    act(() => {
      create(<TestComponent onStateChange={(s) => { state = s; }} />);
    });

    act(() => {
      state!.showError('network', 'Test error');
    });

    expect(state!.errorState.isVisible).toBe(true);
    expect(state!.errorState.errorType).toBe('network');
    expect(state!.errorState.message).toBe('Test error');
    expect(mockHaptics.error).toHaveBeenCalled();
  });

  it('transitions to recovering when startRecovery called', () => {
    let state: HookState | null = null;

    act(() => {
      create(<TestComponent onStateChange={(s) => { state = s; }} />);
    });

    act(() => {
      state!.showError('network', 'Test error');
    });

    act(() => {
      state!.startRecovery();
    });

    expect(state!.errorState.recoveryState).toBe('recovering');
  });

  it('transitions to success when recoverySuccess called', () => {
    let state: HookState | null = null;

    act(() => {
      create(<TestComponent onStateChange={(s) => { state = s; }} />);
    });

    act(() => {
      state!.showError('network', 'Test error');
    });

    act(() => {
      state!.startRecovery();
    });

    act(() => {
      state!.recoverySuccess();
    });

    expect(state!.errorState.recoveryState).toBe('success');
    // Auto-dismiss is tested implicitly via the setTimeout,
    // but React testing-library state capture makes it hard to verify
  });

  it('transitions to failed when recoveryFailed called', () => {
    let state: HookState | null = null;

    act(() => {
      create(<TestComponent onStateChange={(s) => { state = s; }} />);
    });

    act(() => {
      state!.showError('network', 'Test error');
    });

    act(() => {
      state!.startRecovery();
    });

    act(() => {
      state!.recoveryFailed('New error message');
    });

    expect(state!.errorState.recoveryState).toBe('failed');
    expect(state!.errorState.message).toBe('New error message');
  });

  it('clears error when clearError called', () => {
    let state: HookState | null = null;

    act(() => {
      create(<TestComponent onStateChange={(s) => { state = s; }} />);
    });

    act(() => {
      state!.showError('network', 'Test error');
    });

    act(() => {
      state!.clearError();
    });

    expect(state!.errorState.isVisible).toBe(false);
  });
});

// Helper to get all text content from a tree
function getAllTextContent(tree: ReturnType<typeof create>): string {
  const textNodes = tree.root.findAllByType(Text);
  return textNodes.map((node) => {
    const { children } = node.props;
    return Array.isArray(children) ? children.join('') : String(children ?? '');
  }).join(' ');
}
