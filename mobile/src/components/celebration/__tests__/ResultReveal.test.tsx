/**
 * ResultReveal Component Tests - US-119
 *
 * Tests for staged result reveal choreography:
 * - Semi-transparent overlay fades in
 * - Stagger animation: outcome → payout → session delta
 * - Different choreography for win/loss/push
 * - Payout calculation breakdown for complex wins
 */
import React from 'react';
import { act, create, ReactTestRenderer, ReactTestInstance } from 'react-test-renderer';
import { Text, View, Pressable } from 'react-native';
import { ResultReveal } from '../ResultReveal';
import type { ResultOutcome, PayoutBreakdownItem } from '../ResultReveal';

// Mock expo-blur
jest.mock('expo-blur', () => {
  const { View } = require('react-native');
  return {
    BlurView: (props: { children?: React.ReactNode; intensity: number; tint: string }) => (
      <View testID="blur-view" data-intensity={props.intensity} data-tint={props.tint}>
        {props.children}
      </View>
    ),
  };
});

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => {
  const { View, Text } = require('react-native');

  const Animated = {
    View,
    Text,
    createAnimatedComponent: (Component: React.ComponentType) => Component,
  };

  return {
    __esModule: true,
    default: Animated,
    useSharedValue: (initial: number) => ({ value: initial }),
    useAnimatedStyle: (styleFunc: () => object) => {
      try {
        return styleFunc();
      } catch {
        return {};
      }
    },
    withTiming: (toValue: number) => toValue,
    withSequence: (...values: number[]) => values[values.length - 1] ?? 0,
    withDelay: (_delay: number, value: number) => value,
    withSpring: (toValue: number) => toValue,
    interpolate: (value: number, inputRange: number[], outputRange: number[]) => {
      if (inputRange.length === 0 || outputRange.length === 0) return 0;
      if (value <= inputRange[0]!) return outputRange[0]!;
      if (value >= inputRange[inputRange.length - 1]!) return outputRange[outputRange.length - 1]!;
      return outputRange[0]!;
    },
    interpolateColor: (value: number, inputRange: number[], outputRange: string[]) => {
      if (value <= inputRange[0]!) return outputRange[0]!;
      return outputRange[outputRange.length - 1]!;
    },
    Easing: {
      out: () => (t: number) => t,
      in: () => (t: number) => t,
      inOut: () => (t: number) => t,
      quad: (t: number) => t * t,
      cubic: (t: number) => t * t * t,
    },
    FadeIn: { duration: jest.fn().mockReturnValue({}) },
    FadeOut: { duration: jest.fn().mockReturnValue({}) },
    runOnJS: jest.fn((fn) => fn),
  };
});

// Mock haptics
jest.mock('../../../services/haptics', () => ({
  haptics: {
    error: jest.fn().mockResolvedValue(undefined),
    push: jest.fn().mockResolvedValue(undefined),
    win: jest.fn().mockResolvedValue(undefined),
    bigWin: jest.fn().mockResolvedValue(undefined),
    jackpot: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock design tokens
jest.mock('@nullspace/design-tokens', () => ({
  // Minimal monochrome palette required by ResultReveal (US-262)
  MONO: {
    0: '#000000',
    500: '#737373',
    700: '#D4D4D4',
    1000: '#FFFFFF',
  },
  // Animation stagger tokens used by downstream components
  STAGGER: {
    fast: 30,
    normal: 50,
    slow: 100,
    dramatic: 150,
  },
  ACTION: {
    success: '#34C759',
    error: '#FF3B30',
    warning: '#FF9500',
    indigo: '#5B4FFF',
    indigoHover: '#4338CA',
  },
  TITANIUM: {
    50: '#FAFAFA',
    100: '#F5F5F5',
    200: '#E5E5E5',
    300: '#D4D4D4',
    400: '#A3A3A3',
    500: '#737373',
    600: '#525252',
    700: '#404040',
    800: '#262626',
    900: '#171717',
  },
}));

// Mock theme
jest.mock('../../../constants/theme', () => ({
  COLORS: {
    primary: '#5B4FFF',
    success: '#34C759',
    error: '#FF3B30',
    warning: '#FF9500',
    gold: '#FFD700',
  },
  TYPOGRAPHY: {
    displayMedium: { fontSize: 36, fontWeight: '700' },
    label: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
    body: { fontSize: 16, fontWeight: '400' },
    bodySmall: { fontSize: 14, fontWeight: '400' },
    h3: { fontSize: 20, fontWeight: '600' },
    caption: { fontSize: 12, fontWeight: '400' },
  },
  SPACING: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  RADIUS: { xl: 24 },
  DARK_MODE_GLOW: {
    gold: { shadowColor: '#FFD700', shadowOpacity: 0.5 },
  },
  GLASS: {
    blur: { medium: 20 },
  },
}));

// Helper to find all Text components and extract their content
function findAllText(root: ReactTestInstance): string[] {
  const texts: string[] = [];
  root.findAllByType(Text).forEach((node) => {
    const { children } = node.props;
    if (typeof children === 'string') {
      texts.push(children);
    } else if (typeof children === 'number') {
      texts.push(String(children));
    } else if (Array.isArray(children)) {
      const combinedText = children
        .filter((c: unknown) => typeof c === 'string' || typeof c === 'number')
        .join('');
      if (combinedText) texts.push(combinedText);
    }
  });
  return texts;
}

// Helper to find BlurView
function findBlurView(root: ReactTestInstance): ReactTestInstance | null {
  const blurViews = root.findAll((node) => node.props?.testID === 'blur-view');
  return blurViews[0] ?? null;
}

// Helper to find any element with onPress handler
function findPressable(root: ReactTestInstance): ReactTestInstance | null {
  // Try to find Pressable first
  const pressables = root.findAllByType(Pressable);
  if (pressables.length > 0) return pressables[0]!;

  // Fallback to any node with onPress prop
  const withOnPress = root.findAll((node) => typeof node.props?.onPress === 'function');
  return withOnPress[0] ?? null;
}

describe('ResultReveal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const defaultProps = {
    isVisible: true,
    outcome: 'win' as ResultOutcome,
    message: 'You Win!',
    payout: 100,
    bet: 100,
    onDismiss: jest.fn(),
  };

  describe('visibility', () => {
    it('renders when isVisible is true', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts).toContain('You Win!');
    });

    it('does not render when isVisible is false', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} isVisible={false} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts).not.toContain('You Win!');
    });
  });

  describe('outcome types', () => {
    const outcomeTests: [ResultOutcome, string][] = [
      ['win', 'Won'],
      ['blackjack', 'Won'],
      ['loss', 'Lost'],
      ['push', 'Returned'],
      ['war', 'Returned'],
    ];

    it.each(outcomeTests)('displays correct label for %s outcome', (outcome, expectedLabel) => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} outcome={outcome} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts).toContain(expectedLabel);
    });

    it('displays custom message for each outcome', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} outcome="blackjack" message="Blackjack!" />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts).toContain('Blackjack!');
    });
  });

  describe('payout display', () => {
    it('displays positive payout with + prefix', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} payout={150} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts.some((t) => t.includes('+') && t.includes('150'))).toBe(true);
    });

    it('displays negative payout (loss)', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} outcome="loss" payout={-100} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts.some((t) => t.includes('100'))).toBe(true);
    });

    it('displays formatted large payout', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} payout={1234567} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts.some((t) => t.includes('1,234,567'))).toBe(true);
    });

    it('displays win multiplier for wins', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} payout={200} bet={100} />);
      });

      const texts = findAllText(renderer!.root);
      // 3x return ((200 + 100) / 100)
      expect(texts.some((t) => t.includes('3.0x return'))).toBe(true);
    });
  });

  describe('breakdown display', () => {
    const breakdown: PayoutBreakdownItem[] = [
      { label: 'Main Bet', amount: 100 },
      { label: '21+3 Sidebet', amount: 50 },
    ];

    it('displays breakdown items when provided', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} breakdown={breakdown} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts).toContain('Main Bet');
      expect(texts).toContain('21+3 Sidebet');
    });

    it('does not display breakdown section when empty', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} breakdown={[]} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts).not.toContain('Main Bet');
    });

    it('formats breakdown amounts correctly', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} breakdown={breakdown} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts.some((t) => t.includes('+$100'))).toBe(true);
      expect(texts.some((t) => t.includes('+$50'))).toBe(true);
    });

    it('handles negative breakdown amounts', () => {
      const breakdownWithLoss: PayoutBreakdownItem[] = [
        { label: 'Main Bet', amount: -100 },
        { label: 'Insurance', amount: -25 },
      ];

      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} outcome="loss" breakdown={breakdownWithLoss} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts).toContain('Main Bet');
      expect(texts).toContain('Insurance');
    });
  });

  describe('session delta', () => {
    it('displays positive session delta', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} sessionDelta={500} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts).toContain('Session');
      expect(texts.some((t) => t.includes('+') && t.includes('500'))).toBe(true);
    });

    it('displays negative session delta', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} outcome="loss" sessionDelta={-200} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts.some((t) => t.includes('200'))).toBe(true);
    });

    it('does not display session delta when zero', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} sessionDelta={0} />);
      });

      const texts = findAllText(renderer!.root);
      // Session label shouldn't appear when delta is 0
      const sessionCount = texts.filter((t) => t === 'Session').length;
      expect(sessionCount).toBe(0);
    });

    it('does not display session delta when undefined', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} />);
      });

      const texts = findAllText(renderer!.root);
      const sessionCount = texts.filter((t) => t === 'Session').length;
      expect(sessionCount).toBe(0);
    });
  });

  describe('glassmorphism backdrop', () => {
    it('renders BlurView for backdrop', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} />);
      });

      const blurView = findBlurView(renderer!.root);
      expect(blurView).not.toBeNull();
    });

    it('uses dark tint for blur', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} />);
      });

      const blurView = findBlurView(renderer!.root);
      expect(blurView?.props?.['data-tint']).toBe('dark');
    });
  });

  describe('dismiss behavior', () => {
    it('displays dismiss hint', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts).toContain('Tap to continue');
    });

    it('calls onDismiss when tapped', () => {
      const onDismiss = jest.fn();
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} onDismiss={onDismiss} />);
      });

      const pressable = findPressable(renderer!.root);
      expect(pressable).not.toBeNull();

      act(() => {
        pressable?.props?.onPress?.();
      });

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('auto-dismisses after default duration for wins', () => {
      const onDismiss = jest.fn();
      act(() => {
        create(<ResultReveal {...defaultProps} onDismiss={onDismiss} />);
      });

      // Default for wins is 3000ms
      expect(onDismiss).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(3000);
      });

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('auto-dismisses after default duration for losses', () => {
      const onDismiss = jest.fn();
      act(() => {
        create(<ResultReveal {...defaultProps} outcome="loss" onDismiss={onDismiss} />);
      });

      // Default for losses is 2000ms
      expect(onDismiss).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('respects custom autoDismissMs', () => {
      const onDismiss = jest.fn();
      act(() => {
        create(<ResultReveal {...defaultProps} onDismiss={onDismiss} autoDismissMs={5000} />);
      });

      act(() => {
        jest.advanceTimersByTime(3000);
      });
      expect(onDismiss).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(2000);
      });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('haptic feedback', () => {
    const { haptics } = require('../../../services/haptics');

    it('triggers error haptic for loss outcome', () => {
      act(() => {
        create(<ResultReveal {...defaultProps} outcome="loss" />);
      });

      expect(haptics.error).toHaveBeenCalled();
    });

    it('triggers push haptic for push outcome', () => {
      act(() => {
        create(<ResultReveal {...defaultProps} outcome="push" />);
      });

      expect(haptics.push).toHaveBeenCalled();
    });

    it('does not trigger haptic for win (handled by celebration)', () => {
      act(() => {
        create(<ResultReveal {...defaultProps} outcome="win" />);
      });

      // Win haptics handled by celebration system, not ResultReveal
      expect(haptics.error).not.toHaveBeenCalled();
      expect(haptics.push).not.toHaveBeenCalled();
    });
  });

  describe('intensity variations', () => {
    it('accepts intensity prop', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} intensity="jackpot" />);
      });

      // Just verify it renders without error
      const texts = findAllText(renderer!.root);
      expect(texts).toContain('You Win!');
    });
  });

  describe('edge cases', () => {
    it('handles zero bet gracefully', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} bet={0} payout={0} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts).toContain('You Win!');
    });

    it('handles very large payouts', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} payout={999999999} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts.some((t) => t.includes('999,999,999'))).toBe(true);
    });

    it('handles empty message', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<ResultReveal {...defaultProps} message="" />);
      });

      // Should still render without crashing
      expect(renderer!.toJSON()).not.toBeNull();
    });
  });
});

describe('useResultReveal hook integration', () => {
  // Test the hook's helper functions
  const { determineOutcome, calculateIntensity } = require('../../../hooks/useResultReveal');

  describe('determineOutcome', () => {
    it('returns blackjack for won blackjack', () => {
      expect(determineOutcome(true, false, true)).toBe('blackjack');
    });

    it('returns war for war outcome', () => {
      expect(determineOutcome(false, false, false, true)).toBe('war');
    });

    it('returns push for push', () => {
      expect(determineOutcome(false, true)).toBe('push');
    });

    it('returns win for won', () => {
      expect(determineOutcome(true, false)).toBe('win');
    });

    it('returns loss for lost', () => {
      expect(determineOutcome(false, false)).toBe('loss');
    });
  });

  describe('calculateIntensity', () => {
    it('returns jackpot for 5x+ multiplier', () => {
      expect(calculateIntensity(400, 100)).toBe('jackpot'); // 5x return
    });

    it('returns big for 3x+ multiplier', () => {
      expect(calculateIntensity(200, 100)).toBe('big'); // 3x return
    });

    it('returns medium for 1.5x+ multiplier', () => {
      expect(calculateIntensity(50, 100)).toBe('medium'); // 1.5x return
    });

    it('returns small for under 1.5x', () => {
      expect(calculateIntensity(25, 100)).toBe('small'); // 1.25x return
    });

    it('returns small for zero bet', () => {
      expect(calculateIntensity(100, 0)).toBe('small');
    });

    it('returns small for negative payout', () => {
      expect(calculateIntensity(-50, 100)).toBe('small');
    });
  });
});
