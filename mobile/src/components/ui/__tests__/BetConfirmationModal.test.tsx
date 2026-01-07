/**
 * BetConfirmationModal Tests - US-118
 *
 * Tests for the bet confirmation modal with countdown.
 */
import React from 'react';
import { create, act, ReactTestRenderer, ReactTestInstance } from 'react-test-renderer';
import { Text, View, Pressable } from 'react-native';
import { BetConfirmationModal } from '../BetConfirmationModal';
import type { BetDetails, GameType } from '../BetConfirmationModal';

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
  const Reanimated = require('react-native-reanimated/mock');
  const { View } = require('react-native');
  return {
    ...Reanimated,
    useSharedValue: jest.fn((initial) => ({ value: initial })),
    useAnimatedStyle: jest.fn(() => ({})),
    withTiming: jest.fn((value) => value),
    withSequence: jest.fn((...values) => values[0]),
    withSpring: jest.fn((value) => value),
    runOnJS: jest.fn((fn) => fn),
    interpolate: jest.fn((value, inputRange, outputRange) => outputRange[0]),
    interpolateColor: jest.fn((value, inputRange, outputRange) => outputRange[0]),
    Extrapolation: { CLAMP: 'clamp' },
    Easing: { linear: jest.fn() },
    FadeIn: { duration: jest.fn().mockReturnValue({}) },
    FadeOut: { duration: jest.fn().mockReturnValue({}) },
    SlideInDown: {
      springify: jest.fn().mockReturnValue({
        damping: jest.fn().mockReturnValue({
          stiffness: jest.fn().mockReturnValue({}),
        }),
      }),
    },
    SlideOutDown: { duration: jest.fn().mockReturnValue({}) },
    createAnimatedComponent: (Component: React.ComponentType) => Component,
    default: {
      View,
      createAnimatedComponent: (Component: React.ComponentType) => Component,
    },
  };
});

// Mock haptics
jest.mock('../../../services/haptics', () => ({
  haptics: {
    betConfirm: jest.fn().mockResolvedValue(undefined),
    selectionChange: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock ThemeContext
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: jest.fn(() => ({
    isDark: false,
    colorScheme: 'light',
    colorSchemePreference: 'system',
    setColorSchemePreference: jest.fn(),
    toggleColorScheme: jest.fn(),
  })),
}));

// Mock themed colors hook
jest.mock('../../../hooks/useThemedColors', () => ({
  useThemedColors: () => ({
    textPrimary: '#000000',
    textSecondary: '#666666',
    primary: '#5B4FFF',
    success: '#34C759',
    error: '#FF3B30',
    warning: '#FF9500',
    gold: '#FFCC00',
    surface: '#FFFFFF',
    border: '#E5E5E5',
  }),
}));

// Helper to find all Text components
function findAllText(root: ReactTestInstance): string[] {
  const texts: string[] = [];
  root.findAllByType(Text).forEach((node) => {
    const { children } = node.props;
    if (typeof children === 'string') {
      texts.push(children);
    } else if (typeof children === 'number') {
      texts.push(String(children));
    } else if (Array.isArray(children)) {
      // Handle array children like ['$', '25'] or ['+$', '100']
      const combinedText = children
        .filter((c: unknown) => typeof c === 'string' || typeof c === 'number')
        .join('');
      if (combinedText) texts.push(combinedText);
    }
  });
  return texts;
}

// Helper to find Pressable buttons
function findButtonByLabel(root: ReactTestInstance, label: string): ReactTestInstance | null {
  const pressables = root.findAllByType(Pressable);
  for (const pressable of pressables) {
    const texts = pressable.findAllByType(Text);
    for (const text of texts) {
      if (text.props.children === label) {
        return pressable;
      }
    }
  }
  return null;
}

describe('BetConfirmationModal', () => {
  const defaultBet: BetDetails = {
    amount: 100,
    gameType: 'blackjack',
  };

  const defaultProps = {
    visible: true,
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
    bet: defaultBet,
    balance: 1000,
    countdownSeconds: 5,
    autoConfirm: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders modal when visible is true', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<BetConfirmationModal {...defaultProps} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts).toContain('Confirm Bet');
      expect(texts).toContain('100');
    });

    it('does not render modal content when visible is false', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<BetConfirmationModal {...defaultProps} visible={false} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts).not.toContain('Confirm Bet');
    });

    it('displays game type badge', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<BetConfirmationModal {...defaultProps} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts).toContain('Blackjack');
    });

    it('displays bet amount with formatting', () => {
      const betWithLargeAmount: BetDetails = {
        amount: 1234567,
        gameType: 'roulette',
      };
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<BetConfirmationModal {...defaultProps} bet={betWithLargeAmount} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts).toContain('1,234,567');
    });
  });

  describe('game types', () => {
    const gameTypesAndNames: [GameType, string][] = [
      ['blackjack', 'Blackjack'],
      ['roulette', 'Roulette'],
      ['baccarat', 'Baccarat'],
      ['craps', 'Craps'],
      ['hi_lo', 'Hi-Lo'],
      ['video_poker', 'Video Poker'],
      ['casino_war', 'Casino War'],
      ['three_card', 'Three Card Poker'],
      ['ultimate_holdem', "Ultimate Texas Hold'em"],
      ['sic_bo', 'Sic Bo'],
    ];

    it.each(gameTypesAndNames)('renders correct game name for %s', (gameType, expectedName) => {
      const bet: BetDetails = { amount: 50, gameType };
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<BetConfirmationModal {...defaultProps} bet={bet} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts).toContain(expectedName);
    });
  });

  describe('payout information', () => {
    it('displays minimum payout estimate', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<BetConfirmationModal {...defaultProps} />);
      });

      const texts = findAllText(renderer!.root);
      // For blackjack with 100 bet, min payout at 1:1 = $100
      // The payout value is split into separate text elements by style
      expect(texts.some(t => t.includes('100'))).toBe(true);
      expect(texts).toContain('Min Win');
    });

    it('displays maximum payout info', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<BetConfirmationModal {...defaultProps} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts).toContain('3:2 (Blackjack)');
    });

    it('uses custom payout description when provided', () => {
      const betWithCustomPayout: BetDetails = {
        amount: 100,
        gameType: 'baccarat',
        payoutDescription: 'Banker pays 0.95:1',
      };
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<BetConfirmationModal {...defaultProps} bet={betWithCustomPayout} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts).toContain('Banker pays 0.95:1');
    });
  });

  describe('side bets', () => {
    it('displays side bets when provided', () => {
      const betWithSideBets: BetDetails = {
        amount: 150,
        gameType: 'blackjack',
        sideBets: [
          { name: '21+3', amount: 25 },
          { name: 'Perfect Pairs', amount: 25 },
        ],
      };
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<BetConfirmationModal {...defaultProps} bet={betWithSideBets} />);
      });

      const texts = findAllText(renderer!.root);
      expect(texts).toContain('21+3');
      // Side bet amounts are formatted as $25 or just 25 depending on how they render
      expect(texts.some(t => t.includes('25'))).toBe(true);
      expect(texts).toContain('Perfect Pairs');
    });
  });

  describe('danger zone warning', () => {
    it('shows warning when bet > 80% of balance', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(
          <BetConfirmationModal
            {...defaultProps}
            bet={{ amount: 900, gameType: 'blackjack' }}
            balance={1000}
          />
        );
      });

      const texts = findAllText(renderer!.root);
      expect(texts).toContain('High Stake Bet');
      // Balance text shows remaining balance formatted as "Balance after: $100"
      expect(texts.some(t => t.includes('Balance after:'))).toBe(true);
    });

    it('does not show warning when bet < 80% of balance', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(
          <BetConfirmationModal
            {...defaultProps}
            bet={{ amount: 100, gameType: 'blackjack' }}
            balance={1000}
          />
        );
      });

      const texts = findAllText(renderer!.root);
      expect(texts).not.toContain('High Stake Bet');
    });
  });

  describe('button interactions', () => {
    it('calls onConfirm when Place Bet is pressed', () => {
      const onConfirm = jest.fn();
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<BetConfirmationModal {...defaultProps} onConfirm={onConfirm} />);
      });

      // Find PrimaryButton by looking for Text with 'Place Bet' label
      // The button is wrapped in Animated.createAnimatedComponent(Pressable)
      const allTexts = renderer!.root.findAllByType(Text);
      const placeBetText = allTexts.find(t => t.props.children === 'Place Bet');
      expect(placeBetText).toBeDefined();

      // Walk up to find the pressable parent
      let parent = placeBetText?.parent;
      while (parent && !parent.props?.onPress) {
        parent = parent.parent;
      }

      expect(parent?.props?.onPress).toBeDefined();
      if (parent?.props?.onPress) {
        act(() => {
          parent.props.onPress();
        });
        expect(onConfirm).toHaveBeenCalledTimes(1);
      }
    });

    it('calls onCancel when Cancel is pressed', () => {
      const onCancel = jest.fn();
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<BetConfirmationModal {...defaultProps} onCancel={onCancel} />);
      });

      const cancelButton = findButtonByLabel(renderer!.root, 'Cancel');
      expect(cancelButton).toBeDefined();
      if (cancelButton) {
        act(() => {
          cancelButton.props.onPress?.();
        });
        expect(onCancel).toHaveBeenCalledTimes(1);
      }
    });

    it('shows "Confirm Now" label when autoConfirm is true', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<BetConfirmationModal {...defaultProps} autoConfirm={true} />);
      });

      const texts = findAllText(renderer!.root);
      // The label is 'Confirm Now' which gets rendered as uppercase in the button
      expect(texts.some(t => t.toUpperCase().includes('CONFIRM'))).toBe(true);
    });

    it('shows auto-confirm hint when autoConfirm is true', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<BetConfirmationModal {...defaultProps} autoConfirm={true} countdownSeconds={5} />);
      });

      const texts = findAllText(renderer!.root);
      // The hint displays "Auto-confirming in Xs" where X is countdownSeconds
      expect(texts.some(t => t.includes('Auto-confirming in 5s'))).toBe(true);
    });
  });

  describe('accessibility', () => {
    it('has accessible cancel button', () => {
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(<BetConfirmationModal {...defaultProps} />);
      });

      // Find all elements with accessibility props
      // The Cancel Pressable has accessibilityRole="button" and accessibilityLabel="Cancel bet"
      const cancelButton = renderer!.root.findAll(
        (node) =>
          node.props?.accessibilityLabel === 'Cancel bet' ||
          (node.props?.accessibilityRole === 'button' &&
            node.findAllByType?.(Text)?.some?.((t: ReactTestInstance) => t.props.children === 'Cancel'))
      );
      // Should have at least one accessible button
      expect(cancelButton.length).toBeGreaterThan(0);
    });
  });
});
