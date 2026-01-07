/**
 * Toast Notification System (US-116)
 *
 * Premium floating toast notifications with:
 * - Slide-in from top animation
 * - Glassmorphism styling (frosted + border glow)
 * - info/success/error/warning variants with icons
 * - Auto-dismiss with swipe-to-close gesture
 * - Queue management with stagger animation
 *
 * @example
 * ```tsx
 * // In component
 * const toast = useToast();
 * toast.success('Bet placed successfully!');
 * toast.error('Insufficient balance');
 * toast.info('New round starting...', { duration: 5000 });
 * ```
 */
import React, {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  withDelay,
  runOnJS,
  Easing,
  interpolate,
  Extrapolation,
  FadeIn,
  SlideInUp,
  SlideOutUp,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTheme } from './ThemeContext';
import { COLORS, RADIUS, SPACING, FONT_BODY, FONT_DISPLAY } from '../constants/theme';
import { haptics } from '../services/haptics';

/* ─────────────────────────────────────────────────────────────────────────────
 * Types
 * ───────────────────────────────────────────────────────────────────────────── */

/** Toast variant determines color and icon */
export type ToastVariant = 'info' | 'success' | 'error' | 'warning';

/** Options for showing a toast */
export interface ToastOptions {
  /** Auto-dismiss duration in ms (default: 4000, 0 = manual dismiss only) */
  duration?: number;
  /** Unique ID (auto-generated if not provided) */
  id?: string;
  /** Callback when toast is dismissed */
  onDismiss?: () => void;
}

/** Internal toast state */
interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  duration: number;
  createdAt: number;
  onDismiss?: () => void;
}

/** Context value exposed to consumers */
interface ToastContextValue {
  /** Show an info toast */
  info: (message: string, options?: ToastOptions) => string;
  /** Show a success toast */
  success: (message: string, options?: ToastOptions) => string;
  /** Show an error toast */
  error: (message: string, options?: ToastOptions) => string;
  /** Show a warning toast */
  warning: (message: string, options?: ToastOptions) => string;
  /** Dismiss a specific toast by ID */
  dismiss: (id: string) => void;
  /** Dismiss all toasts */
  dismissAll: () => void;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Constants
 * ───────────────────────────────────────────────────────────────────────────── */

const DEFAULT_DURATION = 4000;
const MAX_VISIBLE_TOASTS = 3;
const TOAST_STAGGER_DELAY = 100;
const SWIPE_THRESHOLD = -50; // px to trigger dismiss

/** Variant-specific colors */
const VARIANT_COLORS: Record<ToastVariant, { bg: string; border: string; icon: string }> = {
  info: {
    bg: 'rgba(99, 102, 241, 0.15)', // indigo tint
    border: 'rgba(99, 102, 241, 0.4)',
    icon: '#6366F1',
  },
  success: {
    bg: 'rgba(34, 197, 94, 0.15)', // green tint
    border: 'rgba(34, 197, 94, 0.4)',
    icon: '#22C55E',
  },
  error: {
    bg: 'rgba(239, 68, 68, 0.15)', // red tint
    border: 'rgba(239, 68, 68, 0.4)',
    icon: '#EF4444',
  },
  warning: {
    bg: 'rgba(245, 158, 11, 0.15)', // amber tint
    border: 'rgba(245, 158, 11, 0.4)',
    icon: '#F59E0B',
  },
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Context
 * ───────────────────────────────────────────────────────────────────────────── */

const ToastContext = createContext<ToastContextValue | null>(null);

/* ─────────────────────────────────────────────────────────────────────────────
 * Toast Icon Components (Pure RN Views)
 * ───────────────────────────────────────────────────────────────────────────── */

interface IconProps {
  color: string;
  size?: number;
}

/** Info icon - circle with "i" */
function InfoIcon({ color, size = 20 }: IconProps) {
  return (
    <View style={[iconStyles.container, { width: size, height: size }]}>
      <View
        style={[
          iconStyles.circle,
          { width: size, height: size, borderColor: color },
        ]}
      >
        <View style={[iconStyles.infoDot, { backgroundColor: color }]} />
        <View style={[iconStyles.infoLine, { backgroundColor: color }]} />
      </View>
    </View>
  );
}

/** Success icon - checkmark */
function SuccessIcon({ color, size = 20 }: IconProps) {
  return (
    <View style={[iconStyles.container, { width: size, height: size }]}>
      <View
        style={[
          iconStyles.circle,
          { width: size, height: size, borderColor: color },
        ]}
      >
        <View style={iconStyles.checkContainer}>
          <View
            style={[
              iconStyles.checkShort,
              { backgroundColor: color, transform: [{ rotate: '45deg' }] },
            ]}
          />
          <View
            style={[
              iconStyles.checkLong,
              { backgroundColor: color, transform: [{ rotate: '-45deg' }] },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

/** Error icon - X mark */
function ErrorIcon({ color, size = 20 }: IconProps) {
  return (
    <View style={[iconStyles.container, { width: size, height: size }]}>
      <View
        style={[
          iconStyles.circle,
          { width: size, height: size, borderColor: color },
        ]}
      >
        <View
          style={[
            iconStyles.xLine,
            { backgroundColor: color, transform: [{ rotate: '45deg' }] },
          ]}
        />
        <View
          style={[
            iconStyles.xLine,
            { backgroundColor: color, transform: [{ rotate: '-45deg' }] },
          ]}
        />
      </View>
    </View>
  );
}

/** Warning icon - triangle with "!" */
function WarningIcon({ color, size = 20 }: IconProps) {
  return (
    <View style={[iconStyles.container, { width: size, height: size }]}>
      <View style={[iconStyles.triangleOuter, { borderBottomColor: color }]} />
      <View style={iconStyles.triangleInner}>
        <View style={[iconStyles.warningLine, { backgroundColor: color }]} />
        <View style={[iconStyles.warningDot, { backgroundColor: color }]} />
      </View>
    </View>
  );
}

/** Icon component selector */
function ToastIcon({ variant, color, size }: { variant: ToastVariant } & IconProps) {
  switch (variant) {
    case 'info':
      return <InfoIcon color={color} size={size} />;
    case 'success':
      return <SuccessIcon color={color} size={size} />;
    case 'error':
      return <ErrorIcon color={color} size={size} />;
    case 'warning':
      return <WarningIcon color={color} size={size} />;
  }
}

const iconStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    borderWidth: 2,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoDot: {
    width: 2,
    height: 2,
    borderRadius: 1,
    position: 'absolute',
    top: 4,
  },
  infoLine: {
    width: 2,
    height: 6,
    borderRadius: 1,
    position: 'absolute',
    bottom: 3,
  },
  checkContainer: {
    width: 10,
    height: 8,
    position: 'relative',
  },
  checkShort: {
    position: 'absolute',
    width: 2,
    height: 5,
    left: 1,
    bottom: 0,
    borderRadius: 1,
  },
  checkLong: {
    position: 'absolute',
    width: 2,
    height: 8,
    right: 1,
    bottom: 0,
    borderRadius: 1,
  },
  xLine: {
    position: 'absolute',
    width: 2,
    height: 10,
    borderRadius: 1,
  },
  triangleOuter: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderBottomWidth: 16,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  triangleInner: {
    position: 'absolute',
    alignItems: 'center',
    top: 6,
  },
  warningLine: {
    width: 2,
    height: 6,
    borderRadius: 1,
  },
  warningDot: {
    width: 2,
    height: 2,
    borderRadius: 1,
    marginTop: 1,
  },
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Individual Toast Component
 * ───────────────────────────────────────────────────────────────────────────── */

interface ToastItemProps {
  toast: Toast;
  index: number;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, index, onDismiss }: ToastItemProps) {
  const { isDark } = useTheme();
  const translateY = useSharedValue(0);
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);
  const scale = useSharedValue(1);
  const dismissTriggered = useRef(false);

  // Variant styling
  const variantColors = VARIANT_COLORS[toast.variant];

  // Auto-dismiss timer
  React.useEffect(() => {
    if (toast.duration > 0) {
      const timer = setTimeout(() => {
        if (!dismissTriggered.current) {
          triggerDismiss();
        }
      }, toast.duration);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [toast.duration, toast.id]);

  const triggerDismiss = useCallback(() => {
    if (dismissTriggered.current) return;
    dismissTriggered.current = true;

    // Animate out
    translateY.value = withTiming(-100, { duration: 200, easing: Easing.in(Easing.ease) });
    opacity.value = withTiming(0, { duration: 200 });

    // Call dismiss after animation
    setTimeout(() => {
      toast.onDismiss?.();
      onDismiss(toast.id);
    }, 200);
  }, [toast.id, toast.onDismiss, onDismiss, translateY, opacity]);

  // Swipe-to-dismiss gesture
  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      // Only allow upward swipe
      if (event.translationY < 0) {
        translateY.value = event.translationY;
        opacity.value = interpolate(
          event.translationY,
          [0, SWIPE_THRESHOLD],
          [1, 0.5],
          Extrapolation.CLAMP
        );
      }
      // Allow horizontal swipe for dismiss
      translateX.value = event.translationX * 0.3;
    })
    .onEnd((event) => {
      if (event.translationY < SWIPE_THRESHOLD) {
        // Trigger dismiss
        runOnJS(triggerDismiss)();
        runOnJS(haptics.selectionChange)();
      } else {
        // Spring back
        translateY.value = withSpring(0, { damping: 15, stiffness: 200 });
        translateX.value = withSpring(0, { damping: 15, stiffness: 200 });
        opacity.value = withSpring(1);
      }
    });

  // Press to dismiss
  const handlePress = useCallback(() => {
    haptics.selectionChange();
    triggerDismiss();
  }, [triggerDismiss]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { translateX: translateX.value },
      { scale: scale.value },
    ],
    opacity: opacity.value,
  }));

  // Staggered entrance animation
  const enteringAnimation = SlideInUp.delay(index * TOAST_STAGGER_DELAY)
    .springify()
    .damping(15)
    .stiffness(150);

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        entering={enteringAnimation}
        style={[styles.toastContainer, animatedStyle]}
      >
        <Pressable onPress={handlePress} style={styles.pressable}>
          {/* Glass background */}
          <BlurView
            intensity={isDark ? 30 : 20}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />

          {/* Tinted overlay */}
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: variantColors.bg },
            ]}
          />

          {/* Border glow */}
          <View
            style={[
              styles.borderGlow,
              { borderColor: variantColors.border },
            ]}
            pointerEvents="none"
          />

          {/* Content */}
          <View style={styles.content}>
            <ToastIcon
              variant={toast.variant}
              color={variantColors.icon}
              size={20}
            />
            <Text
              style={[
                styles.message,
                { color: isDark ? '#FFFFFF' : '#1A1A2E' },
              ]}
              numberOfLines={2}
            >
              {toast.message}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Toast Container (renders all toasts)
 * ───────────────────────────────────────────────────────────────────────────── */

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  const insets = useSafeAreaInsets();

  // Only show up to MAX_VISIBLE_TOASTS
  const visibleToasts = toasts.slice(0, MAX_VISIBLE_TOASTS);

  if (visibleToasts.length === 0) return null;

  return (
    <View
      style={[
        styles.container,
        { top: insets.top + SPACING.md },
      ]}
      pointerEvents="box-none"
    >
      {visibleToasts.map((toast, index) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          index={index}
          onDismiss={onDismiss}
        />
      ))}
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Provider
 * ───────────────────────────────────────────────────────────────────────────── */

let toastIdCounter = 0;
function generateToastId(): string {
  return `toast-${Date.now()}-${++toastIdCounter}`;
}

interface ToastProviderProps {
  children: React.ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback(
    (message: string, variant: ToastVariant, options?: ToastOptions): string => {
      const id = options?.id ?? generateToastId();

      const newToast: Toast = {
        id,
        message,
        variant,
        duration: options?.duration ?? DEFAULT_DURATION,
        createdAt: Date.now(),
        onDismiss: options?.onDismiss,
      };

      setToasts((prev) => [newToast, ...prev]);

      // Haptic feedback based on variant
      if (variant === 'success') {
        haptics.win();
      } else if (variant === 'error') {
        haptics.error();
      } else if (variant === 'warning') {
        haptics.push();
      } else {
        haptics.selectionChange();
      }

      return id;
    },
    []
  );

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => {
      const toast = prev.find((t) => t.id === id);
      toast?.onDismiss?.();
      return prev.filter((t) => t.id !== id);
    });
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  const info = useCallback(
    (message: string, options?: ToastOptions) => addToast(message, 'info', options),
    [addToast]
  );

  const success = useCallback(
    (message: string, options?: ToastOptions) => addToast(message, 'success', options),
    [addToast]
  );

  const error = useCallback(
    (message: string, options?: ToastOptions) => addToast(message, 'error', options),
    [addToast]
  );

  const warning = useCallback(
    (message: string, options?: ToastOptions) => addToast(message, 'warning', options),
    [addToast]
  );

  const value = useMemo(
    () => ({
      info,
      success,
      error,
      warning,
      dismiss,
      dismissAll,
    }),
    [info, success, error, warning, dismiss, dismissAll]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Hook
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * Hook to access toast notification system
 *
 * @example
 * ```tsx
 * const toast = useToast();
 * toast.success('Bet placed!');
 * toast.error('Connection lost');
 * toast.warning('Low balance');
 * toast.info('New round starting');
 * ```
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Styles
 * ───────────────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: SPACING.md,
    right: SPACING.md,
    zIndex: 9999,
    gap: SPACING.sm,
  },
  toastContainer: {
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  pressable: {
    minHeight: 56,
  },
  borderGlow: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderRadius: RADIUS.md,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_BODY.medium,
    lineHeight: 20,
  },
});
