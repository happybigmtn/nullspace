/**
 * Tests for ToastContext - Floating toast notification system (US-116)
 */
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';

// Mock haptics - must return async functions since haptics service methods are async
jest.mock('../../services/haptics', () => ({
  haptics: {
    win: jest.fn(() => Promise.resolve()),
    error: jest.fn(() => Promise.resolve()),
    push: jest.fn(() => Promise.resolve()),
    selectionChange: jest.fn(() => Promise.resolve()),
  },
}));

// Mock ThemeContext
jest.mock('../ThemeContext', () => ({
  useTheme: () => ({ isDark: false }),
}));

// Mock expo-blur
jest.mock('expo-blur', () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => children,
}));

// Mock react-native-safe-area-context
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

// Mock react-native-reanimated - complete mock for all used exports
jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  const AnimatedView = ({ children, entering, style, ...props }: { children?: React.ReactNode; entering?: unknown; style?: unknown }) => (
    <RN.View {...props} style={style}>{children}</RN.View>
  );

  return {
    __esModule: true,
    default: {
      View: AnimatedView,
      createAnimatedComponent: (comp: unknown) => comp,
    },
    View: AnimatedView,
    useSharedValue: (val: number) => ({ value: val }),
    useAnimatedStyle: (fn: () => Record<string, unknown>) => ({}),
    withSpring: (val: number) => val,
    withTiming: (val: number) => val,
    withSequence: (...vals: number[]) => vals[vals.length - 1],
    withDelay: (_delay: number, val: number) => val,
    runOnJS: (fn: (...args: unknown[]) => void) => fn,
    Easing: {
      in: (fn: unknown) => fn,
      out: (fn: unknown) => fn,
      inOut: (fn: unknown) => fn,
      ease: 0,
    },
    interpolate: (val: number) => val,
    Extrapolation: { CLAMP: 'clamp' },
    FadeIn: { delay: () => ({ springify: () => ({ damping: () => ({ stiffness: () => ({}) }) }) }) },
    SlideInUp: { delay: () => ({ springify: () => ({ damping: () => ({ stiffness: () => ({}) }) }) }) },
    SlideOutUp: {},
  };
});

// Mock react-native-gesture-handler
jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  Gesture: {
    Pan: () => ({
      onUpdate: () => ({
        onEnd: () => ({}),
      }),
    }),
  },
}));

// Import after mocks
import { ToastProvider, useToast } from '../ToastContext';

// Get mock reference after imports
const mockHaptics = jest.requireMock('../../services/haptics').haptics;

describe('ToastContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('useToast hook', () => {
    it('provides toast methods', () => {
      let ctx: ReturnType<typeof useToast> | null = null;
      const Consumer = () => {
        ctx = useToast();
        return null;
      };

      act(() => {
        create(
          <ToastProvider>
            <Consumer />
          </ToastProvider>
        );
      });

      expect(ctx).not.toBeNull();
      expect(typeof ctx!.info).toBe('function');
      expect(typeof ctx!.success).toBe('function');
      expect(typeof ctx!.error).toBe('function');
      expect(typeof ctx!.warning).toBe('function');
      expect(typeof ctx!.dismiss).toBe('function');
      expect(typeof ctx!.dismissAll).toBe('function');
    });
  });

  describe('showing toasts', () => {
    it('shows info toast', () => {
      let ctx: ReturnType<typeof useToast> | null = null;
      const Consumer = () => {
        ctx = useToast();
        return null;
      };

      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(
          <ToastProvider>
            <Consumer />
          </ToastProvider>
        );
      });

      act(() => {
        ctx!.info('Test info message');
      });

      const json = renderer!.toJSON();
      expect(JSON.stringify(json)).toContain('Test info message');
    });

    it('shows success toast and triggers win haptic', () => {
      let ctx: ReturnType<typeof useToast> | null = null;
      const Consumer = () => {
        ctx = useToast();
        return null;
      };

      act(() => {
        create(
          <ToastProvider>
            <Consumer />
          </ToastProvider>
        );
      });

      act(() => {
        ctx!.success('Win!');
      });

      expect(mockHaptics.win).toHaveBeenCalled();
    });

    it('shows error toast and triggers error haptic', () => {
      let ctx: ReturnType<typeof useToast> | null = null;
      const Consumer = () => {
        ctx = useToast();
        return null;
      };

      act(() => {
        create(
          <ToastProvider>
            <Consumer />
          </ToastProvider>
        );
      });

      act(() => {
        ctx!.error('Error occurred');
      });

      expect(mockHaptics.error).toHaveBeenCalled();
    });

    it('shows warning toast and triggers push haptic', () => {
      let ctx: ReturnType<typeof useToast> | null = null;
      const Consumer = () => {
        ctx = useToast();
        return null;
      };

      act(() => {
        create(
          <ToastProvider>
            <Consumer />
          </ToastProvider>
        );
      });

      act(() => {
        ctx!.warning('Warning message');
      });

      expect(mockHaptics.push).toHaveBeenCalled();
    });

    it('returns toast ID when showing toast', () => {
      let ctx: ReturnType<typeof useToast> | null = null;
      const Consumer = () => {
        ctx = useToast();
        return null;
      };

      act(() => {
        create(
          <ToastProvider>
            <Consumer />
          </ToastProvider>
        );
      });

      let toastId: string = '';
      act(() => {
        toastId = ctx!.info('Test message');
      });

      expect(toastId).toMatch(/^toast-\d+-\d+$/);
    });

    it('uses custom ID when provided', () => {
      let ctx: ReturnType<typeof useToast> | null = null;
      const Consumer = () => {
        ctx = useToast();
        return null;
      };

      act(() => {
        create(
          <ToastProvider>
            <Consumer />
          </ToastProvider>
        );
      });

      let toastId: string = '';
      act(() => {
        toastId = ctx!.info('Test message', { id: 'custom-id' });
      });

      expect(toastId).toBe('custom-id');
    });
  });

  describe('dismissing toasts', () => {
    it('dismisses specific toast by ID', () => {
      let ctx: ReturnType<typeof useToast> | null = null;
      const Consumer = () => {
        ctx = useToast();
        return null;
      };

      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(
          <ToastProvider>
            <Consumer />
          </ToastProvider>
        );
      });

      let toastId: string = '';
      act(() => {
        toastId = ctx!.info('Test message', { duration: 0 }); // Manual dismiss only
      });

      // Toast should be visible
      let json = renderer!.toJSON();
      expect(JSON.stringify(json)).toContain('Test message');

      // Dismiss the toast
      act(() => {
        ctx!.dismiss(toastId);
      });

      // Toast should be gone
      json = renderer!.toJSON();
      expect(JSON.stringify(json)).not.toContain('Test message');
    });

    it('dismissAll removes all toasts', () => {
      let ctx: ReturnType<typeof useToast> | null = null;
      const Consumer = () => {
        ctx = useToast();
        return null;
      };

      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(
          <ToastProvider>
            <Consumer />
          </ToastProvider>
        );
      });

      // Add multiple toasts
      act(() => {
        ctx!.info('Toast 1', { duration: 0 });
        ctx!.success('Toast 2', { duration: 0 });
        ctx!.warning('Toast 3', { duration: 0 });
      });

      // All toasts should be visible
      let json = renderer!.toJSON();
      expect(JSON.stringify(json)).toContain('Toast 1');

      // Dismiss all
      act(() => {
        ctx!.dismissAll();
      });

      // All toasts should be gone (container may not render when empty)
      json = renderer!.toJSON();
      const jsonStr = JSON.stringify(json) || '';
      expect(jsonStr).not.toContain('Toast 1');
      expect(jsonStr).not.toContain('Toast 2');
      expect(jsonStr).not.toContain('Toast 3');
    });
  });

  describe('auto-dismiss', () => {
    it('auto-dismisses after default duration', () => {
      let ctx: ReturnType<typeof useToast> | null = null;
      const Consumer = () => {
        ctx = useToast();
        return null;
      };

      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(
          <ToastProvider>
            <Consumer />
          </ToastProvider>
        );
      });

      act(() => {
        ctx!.info('Auto dismiss test');
      });

      // Toast should be visible initially
      let json = renderer!.toJSON();
      expect(JSON.stringify(json)).toContain('Auto dismiss test');

      // Fast-forward past default duration (4000ms) + animation time (200ms)
      act(() => {
        jest.advanceTimersByTime(4200);
      });

      // Toast should be gone
      json = renderer!.toJSON();
      expect(JSON.stringify(json)).not.toContain('Auto dismiss test');
    });

    it('respects custom duration', () => {
      let ctx: ReturnType<typeof useToast> | null = null;
      const Consumer = () => {
        ctx = useToast();
        return null;
      };

      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(
          <ToastProvider>
            <Consumer />
          </ToastProvider>
        );
      });

      act(() => {
        ctx!.info('Custom duration', { duration: 1000 });
      });

      // Fast-forward 500ms - toast should still be visible
      act(() => {
        jest.advanceTimersByTime(500);
      });

      let json = renderer!.toJSON();
      expect(JSON.stringify(json)).toContain('Custom duration');

      // Fast-forward past 1000ms + animation
      act(() => {
        jest.advanceTimersByTime(1200);
      });

      json = renderer!.toJSON();
      expect(JSON.stringify(json)).not.toContain('Custom duration');
    });

    it('duration 0 prevents auto-dismiss', () => {
      let ctx: ReturnType<typeof useToast> | null = null;
      const Consumer = () => {
        ctx = useToast();
        return null;
      };

      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(
          <ToastProvider>
            <Consumer />
          </ToastProvider>
        );
      });

      act(() => {
        ctx!.info('Manual only', { duration: 0 });
      });

      // Fast-forward 10 seconds - toast should still be visible
      act(() => {
        jest.advanceTimersByTime(10000);
      });

      const json = renderer!.toJSON();
      expect(JSON.stringify(json)).toContain('Manual only');
    });
  });

  describe('callbacks', () => {
    it('calls onDismiss when toast is dismissed', () => {
      const onDismiss = jest.fn();
      let ctx: ReturnType<typeof useToast> | null = null;
      const Consumer = () => {
        ctx = useToast();
        return null;
      };

      act(() => {
        create(
          <ToastProvider>
            <Consumer />
          </ToastProvider>
        );
      });

      let toastId: string = '';
      act(() => {
        toastId = ctx!.info('Callback test', { duration: 0, onDismiss });
      });

      // Dismiss manually
      act(() => {
        ctx!.dismiss(toastId);
      });

      // onDismiss should have been called
      expect(onDismiss).toHaveBeenCalled();
    });
  });

  describe('queue management', () => {
    it('shows max 3 toasts at a time', () => {
      let ctx: ReturnType<typeof useToast> | null = null;
      const Consumer = () => {
        ctx = useToast();
        return null;
      };

      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(
          <ToastProvider>
            <Consumer />
          </ToastProvider>
        );
      });

      // Add 5 toasts
      act(() => {
        ctx!.info('Toast 1', { duration: 0 });
        ctx!.info('Toast 2', { duration: 0 });
        ctx!.info('Toast 3', { duration: 0 });
        ctx!.info('Toast 4', { duration: 0 });
        ctx!.info('Toast 5', { duration: 0 });
      });

      // Only first 3 should be visible (newest first)
      const json = renderer!.toJSON();
      const jsonStr = JSON.stringify(json);

      // Toast 5, 4, 3 should be visible (newest first)
      expect(jsonStr).toContain('Toast 5');
      expect(jsonStr).toContain('Toast 4');
      expect(jsonStr).toContain('Toast 3');
      // Toast 1, 2 should be hidden (over max)
      expect(jsonStr).not.toContain('Toast 1');
      expect(jsonStr).not.toContain('Toast 2');
    });

    it('newest toast appears at top of queue', () => {
      let ctx: ReturnType<typeof useToast> | null = null;
      const Consumer = () => {
        ctx = useToast();
        return null;
      };

      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(
          <ToastProvider>
            <Consumer />
          </ToastProvider>
        );
      });

      act(() => {
        ctx!.info('First', { duration: 0 });
      });

      act(() => {
        ctx!.info('Second', { duration: 0 });
      });

      const json = renderer!.toJSON();
      const jsonStr = JSON.stringify(json);

      // Both should be visible
      expect(jsonStr).toContain('First');
      expect(jsonStr).toContain('Second');

      // Second should appear before First in the JSON (top of list)
      const secondIndex = jsonStr.indexOf('Second');
      const firstIndex = jsonStr.indexOf('First');
      expect(secondIndex).toBeLessThan(firstIndex);
    });
  });

  describe('haptic feedback', () => {
    it('triggers selectionChange haptic for info toast', () => {
      let ctx: ReturnType<typeof useToast> | null = null;
      const Consumer = () => {
        ctx = useToast();
        return null;
      };

      act(() => {
        create(
          <ToastProvider>
            <Consumer />
          </ToastProvider>
        );
      });

      act(() => {
        ctx!.info('Info');
      });

      expect(mockHaptics.selectionChange).toHaveBeenCalled();
    });
  });

  // IMPORTANT: This test must be LAST because React 19's error boundary behavior
  // can pollute the test environment for subsequent tests
  describe('error handling', () => {
    it('throws error when used outside provider', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      function UnwrappedConsumer() {
        useToast();
        return null;
      }

      create(<UnwrappedConsumer />);

      const errorOrWarnCalled = consoleSpy.mock.calls.length > 0 || warnSpy.mock.calls.length > 0;
      expect(errorOrWarnCalled).toBe(true);

      consoleSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });
});
