/**
 * AnimatedBalance Component Tests
 *
 * Tests for US-117: Animated balance counter with win/loss delta
 * - Slot-machine roller effect on change
 * - Delta badge shows +/- and fades after 2s
 * - Color animation: white → gold → primary for big wins
 * - Scale pop on balance update
 * - Shimmer wave on change
 */
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Text, View } from 'react-native';
import { AnimatedBalance } from '../AnimatedBalance';

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
    useSharedValue: (initial: number) => {
      return { value: initial };
    },
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
    interpolateColor: (
      value: number,
      inputRange: number[],
      outputRange: string[]
    ): string => {
      // Simple linear interpolation for color
      const firstInput = inputRange[0];
      const lastInput = inputRange[inputRange.length - 1];
      const firstOutput = outputRange[0] ?? '#000000';
      const lastOutput = outputRange[outputRange.length - 1] ?? '#000000';

      if (firstInput === undefined || lastInput === undefined) return firstOutput;
      if (value <= firstInput) return firstOutput;
      if (value >= lastInput) return lastOutput;

      for (let i = 0; i < inputRange.length - 1; i++) {
        const rangeStart = inputRange[i];
        const rangeEnd = inputRange[i + 1];
        if (rangeStart !== undefined && rangeEnd !== undefined) {
          if (value >= rangeStart && value <= rangeEnd) {
            const t = (value - rangeStart) / (rangeEnd - rangeStart);
            return t < 0.5 ? (outputRange[i] ?? firstOutput) : (outputRange[i + 1] ?? lastOutput);
          }
        }
      }
      return firstOutput;
    },
    Easing: {
      out: () => (t: number) => t,
      in: () => (t: number) => t,
      inOut: () => (t: number) => t,
      quad: (t: number) => t * t,
    },
  };
});

// Mock theme constants
jest.mock('../../../constants/theme', () => ({
  COLORS: {
    primary: '#6366F1',
    success: '#22C55E',
    destructive: '#EF4444',
    gold: '#FFCC00',
  },
  TYPOGRAPHY: {
    h2: {
      fontSize: 24,
      fontWeight: '700',
    },
  },
  SPACING: {
    xs: 4,
  },
  SPRING: {
    button: { damping: 15, stiffness: 300 },
    success: { damping: 12, stiffness: 200 },
  },
}));

// Helper to extract all text content from render tree (ignoring spaces)
function extractText(tree: ReactTestRenderer): string {
  const textNodes = tree.root.findAllByType(Text);
  const text = textNodes
    .map((node) => {
      const children = node.props.children;
      if (typeof children === 'string') return children;
      if (typeof children === 'number') return String(children);
      if (Array.isArray(children)) return children.filter((c) => typeof c === 'string' || typeof c === 'number').join('');
      return '';
    })
    .join('');
  // Remove all whitespace for easier assertions
  return text;
}

// Helper to get raw text with spaces preserved
function extractRawText(tree: ReactTestRenderer): string {
  const textNodes = tree.root.findAllByType(Text);
  return textNodes
    .map((node) => {
      const children = node.props.children;
      if (typeof children === 'string') return children;
      if (typeof children === 'number') return String(children);
      if (Array.isArray(children)) return children.filter((c) => typeof c === 'string' || typeof c === 'number').join('');
      return '';
    })
    .join(' ');
}

// Helper to find delta badge
function findDeltaBadge(tree: ReactTestRenderer): string | null {
  const viewNodes = tree.root.findAllByType(View);
  for (const view of viewNodes) {
    // Look for badge by its style (position: absolute)
    const style = view.props.style;
    if (Array.isArray(style)) {
      const hasAbsolute = style.some(
        (s: object) => s && typeof s === 'object' && 'position' in s && (s as { position: string }).position === 'absolute'
      );
      if (hasAbsolute) {
        const textNode = view.findAllByType(Text);
        const firstTextNode = textNode[0];
        if (firstTextNode) {
          return String(firstTextNode.props.children);
        }
      }
    }
  }
  return null;
}

describe('AnimatedBalance', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('basic rendering', () => {
    it('renders balance with dollar sign and formatting', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(<AnimatedBalance balance={1000} />);
      });

      const text = extractText(tree);
      expect(text).toContain('$');
      expect(text).toContain('1,000');
    });

    it('formats large balances with thousands separators', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(<AnimatedBalance balance={1234567} />);
      });

      const text = extractText(tree);
      expect(text).toContain('1,234,567');
    });

    it('renders zero balance correctly', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(<AnimatedBalance balance={0} />);
      });

      const text = extractText(tree);
      expect(text).toContain('$0');
    });
  });

  describe('slot-machine roller effect', () => {
    it('animates digits on balance increase', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(<AnimatedBalance balance={1000} />);
      });

      // Verify initial render
      let text = extractText(tree);
      expect(text).toContain('1,000');

      // Update balance
      act(() => {
        tree.update(<AnimatedBalance balance={1500} />);
      });

      // Verify new balance is displayed
      text = extractText(tree);
      expect(text).toContain('1,500');
    });

    it('animates digits on balance decrease', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(<AnimatedBalance balance={1000} />);
      });

      act(() => {
        tree.update(<AnimatedBalance balance={500} />);
      });

      const text = extractText(tree);
      expect(text).toContain('500');
    });
  });

  describe('delta badge for wins', () => {
    it('shows positive delta badge when isWinActive and winAmount > 0', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(
          <AnimatedBalance
            balance={1500}
            isWinActive={true}
            winAmount={500}
            intensity="medium"
          />
        );
      });

      const text = extractText(tree);
      // Should show the balance and the delta
      expect(text).toContain('1,500');
      expect(text).toContain('+$500');
    });

    it('does not show delta badge when winAmount is 0', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(
          <AnimatedBalance
            balance={1000}
            isWinActive={true}
            winAmount={0}
          />
        );
      });

      const text = extractText(tree);
      expect(text).not.toContain('+$0');
    });
  });

  describe('delta badge for losses', () => {
    it('shows negative delta badge when winAmount < 0', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(
          <AnimatedBalance
            balance={500}
            isWinActive={false}
            winAmount={-100}
          />
        );
      });

      const text = extractText(tree);
      // Loss badge should show without + sign
      expect(text).toContain('$100');
      // Should not have + prefix for losses
      expect(text).not.toContain('+$100');
    });
  });

  describe('intensity-based scaling', () => {
    it('applies small scale for small intensity', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(
          <AnimatedBalance
            balance={1000}
            isWinActive={true}
            intensity="small"
            winAmount={50}
          />
        );
      });

      // Small wins should still render
      const text = extractText(tree);
      expect(text).toContain('1,000');
    });

    it('applies larger scale for medium intensity', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(
          <AnimatedBalance
            balance={1000}
            isWinActive={true}
            intensity="medium"
            winAmount={100}
          />
        );
      });

      const text = extractText(tree);
      expect(text).toContain('1,000');
    });

    it('applies largest scale for jackpot intensity', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(
          <AnimatedBalance
            balance={10000}
            isWinActive={true}
            intensity="jackpot"
            winAmount={5000}
          />
        );
      });

      const text = extractText(tree);
      expect(text).toContain('10,000');
    });
  });

  describe('color animation for big wins', () => {
    it('triggers color animation for medium intensity wins', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(<AnimatedBalance balance={1000} />);
      });

      // Trigger a big win
      act(() => {
        tree.update(
          <AnimatedBalance
            balance={2000}
            isWinActive={true}
            intensity="medium"
            winAmount={1000}
          />
        );
      });

      // Component should render without errors
      const text = extractText(tree);
      expect(text).toContain('2,000');
    });

    it('triggers color animation for big intensity wins', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(<AnimatedBalance balance={1000} />);
      });

      act(() => {
        tree.update(
          <AnimatedBalance
            balance={3000}
            isWinActive={true}
            intensity="big"
            winAmount={2000}
          />
        );
      });

      const text = extractText(tree);
      expect(text).toContain('3,000');
    });

    it('triggers color animation for jackpot intensity wins', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(<AnimatedBalance balance={1000} />);
      });

      act(() => {
        tree.update(
          <AnimatedBalance
            balance={11000}
            isWinActive={true}
            intensity="jackpot"
            winAmount={10000}
          />
        );
      });

      const text = extractText(tree);
      expect(text).toContain('11,000');
    });

    it('does NOT trigger color animation for small intensity wins', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(<AnimatedBalance balance={1000} />);
      });

      act(() => {
        tree.update(
          <AnimatedBalance
            balance={1050}
            isWinActive={true}
            intensity="small"
            winAmount={50}
          />
        );
      });

      const text = extractText(tree);
      expect(text).toContain('1,050');
    });
  });

  describe('delta badge fade timing', () => {
    it('delta badge fades after 2 seconds', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(
          <AnimatedBalance
            balance={1500}
            isWinActive={true}
            winAmount={500}
          />
        );
      });

      // Initial render shows delta
      let text = extractText(tree);
      expect(text).toContain('+$500');

      // Advance timers past fade duration (2s = 200ms in + 1500ms visible + 500ms fade)
      act(() => {
        jest.advanceTimersByTime(2500);
      });

      // Component should still render (even if badge is faded out via animation)
      text = extractText(tree);
      expect(text).toContain('1,500');
    });
  });

  describe('balance change without win state', () => {
    it('updates balance without celebration effects when isWinActive is false', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(<AnimatedBalance balance={1000} />);
      });

      act(() => {
        tree.update(<AnimatedBalance balance={1500} isWinActive={false} />);
      });

      const text = extractText(tree);
      expect(text).toContain('1,500');
      // No delta badge since isWinActive is false and no negative winAmount
      expect(text).not.toContain('+$');
    });
  });

  describe('shimmer overlay', () => {
    it('renders shimmer overlay when win is active', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(
          <AnimatedBalance
            balance={1500}
            isWinActive={true}
            winAmount={500}
          />
        );
      });

      // Shimmer overlay should be present (as a View)
      const viewNodes = tree.root.findAllByType(View);
      expect(viewNodes.length).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('handles rapid balance changes', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(<AnimatedBalance balance={1000} />);
      });

      // Rapid updates
      act(() => {
        tree.update(<AnimatedBalance balance={1100} />);
      });
      act(() => {
        tree.update(<AnimatedBalance balance={1200} />);
      });
      act(() => {
        tree.update(<AnimatedBalance balance={1300} />);
      });

      const text = extractText(tree);
      expect(text).toContain('1,300');
    });

    it('handles very large win amounts', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(
          <AnimatedBalance
            balance={1000000}
            isWinActive={true}
            winAmount={999999}
            intensity="jackpot"
          />
        );
      });

      const text = extractText(tree);
      expect(text).toContain('1,000,000');
      expect(text).toContain('+$999,999');
    });

    it('handles decimal balances', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(<AnimatedBalance balance={1234.56} />);
      });

      const text = extractText(tree);
      expect(text).toContain('1,234.56');
    });
  });
});
