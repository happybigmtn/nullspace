import React from 'react';
import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';
import { GameHeader } from '../GameHeader';

const mockGoBack = jest.fn();
const mockHelpButton = jest.fn(({ onPress }: { onPress: () => void }) => (
  <Text onPress={onPress}>Help</Text>
));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));

jest.mock('../../ui/HelpButton', () => ({
  HelpButton: (props: { onPress: () => void }) => mockHelpButton(props),
}));

jest.mock('../EventBadge', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { EventBadge: () => React.createElement(Text, null, 'Event') };
});

jest.mock('../../ui/WalletBadge', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { WalletBadge: () => React.createElement(Text, null, 'Wallet') };
});

describe('GameHeader', () => {
  beforeEach(() => {
    mockGoBack.mockReset();
    mockHelpButton.mockClear();
  });

  it('renders balance and session delta formatting', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<GameHeader title="Blackjack" balance={1200} sessionDelta={0} />);
    });
    let text = tree.root.findAllByType(Text).map((node) => node.props.children).join(' ');
    let normalized = text.replace(/,/g, '');
    expect(normalized).toContain('Balance');
    expect(normalized).toContain('$1200');
    expect(normalized).toContain('Session $0');

    act(() => {
      tree.update(<GameHeader title="Blackjack" balance={1200} sessionDelta={150} />);
    });
    text = tree.root.findAllByType(Text).map((node) => node.props.children).join(' ');
    normalized = text.replace(/,/g, '');
    expect(normalized).toContain('Session +$150');

    act(() => {
      tree.update(<GameHeader title="Blackjack" balance={1200} sessionDelta={-50} />);
    });
    text = tree.root.findAllByType(Text).map((node) => node.props.children).join(' ');
    normalized = text.replace(/,/g, '');
    expect(normalized).toContain('Session $50');
  });

  it('handles back and help actions', () => {
    const onHelp = jest.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<GameHeader title="Blackjack" balance={1200} onHelp={onHelp} />);
    });

    const pressables = tree.root.findAll((node) => typeof node.props.onPress === 'function');
    const backButton = pressables.find((node) =>
      node.findAllByType(Text).some((textNode) => textNode.props.children === '<')
    );
    act(() => {
      backButton?.props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalled();

    const helpText = tree.root.findAllByType(Text).find((node) => node.props.children === 'Help');
    act(() => {
      helpText?.props.onPress();
    });
    expect(onHelp).toHaveBeenCalled();
  });

  describe('balance formatting edge cases', () => {
    // Helper to flatten children into a clean string for testing
    function getBalanceText(tree: ReturnType<typeof create>): string {
      const textNodes = tree.root.findAllByType(Text);
      const balanceNode = textNodes.find((node) => {
        const children = node.props.children;
        if (typeof children === 'string') {
          return children.startsWith('$');
        }
        if (Array.isArray(children) && children.length >= 1 && children[0] === '$') {
          return true;
        }
        return false;
      });
      if (!balanceNode) return '';
      const children = balanceNode.props.children;
      if (typeof children === 'string') return children;
      if (Array.isArray(children)) return children.join('');
      return String(children);
    }

    function getSessionText(tree: ReturnType<typeof create>): string {
      const textNodes = tree.root.findAllByType(Text);
      const sessionNode = textNodes.find((node) => {
        const children = node.props.children;
        if (typeof children === 'string') {
          return children.includes('Session');
        }
        if (Array.isArray(children) && children.some((c: unknown) => typeof c === 'string' && c.includes('Session'))) {
          return true;
        }
        return false;
      });
      if (!sessionNode) return '';
      const children = sessionNode.props.children;
      if (typeof children === 'string') return children;
      if (Array.isArray(children)) return children.join('');
      return String(children);
    }

    it('formats very large balances with thousands separators', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<GameHeader title="Test" balance={1234567} />);
      });

      const balanceText = getBalanceText(tree);
      // toLocaleString should add commas for thousands
      expect(balanceText).toBe('$1,234,567');
    });

    it('formats million+ balances correctly', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<GameHeader title="Test" balance={50000000} />);
      });

      const balanceText = getBalanceText(tree);
      expect(balanceText).toBe('$50,000,000');
    });

    it('formats zero balance correctly', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<GameHeader title="Test" balance={0} />);
      });

      const balanceText = getBalanceText(tree);
      expect(balanceText).toBe('$0');
    });

    it('handles decimal balances by showing full decimal', () => {
      // Note: toLocaleString preserves decimals
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<GameHeader title="Test" balance={1234.56} />);
      });

      const balanceText = getBalanceText(tree);
      // toLocaleString includes decimals
      expect(balanceText).toBe('$1,234.56');
    });

    it('handles very small decimal balances', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<GameHeader title="Test" balance={0.01} />);
      });

      const balanceText = getBalanceText(tree);
      expect(balanceText).toBe('$0.01');
    });

    it('handles negative balance display (edge case)', () => {
      // Negative balances shouldn't normally occur, but test the formatting
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<GameHeader title="Test" balance={-500} />);
      });

      const balanceText = getBalanceText(tree);
      // toLocaleString on negative: produces "-500"
      expect(balanceText).toBe('$-500');
    });

    it('handles negative large balance with separators', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<GameHeader title="Test" balance={-1234567} />);
      });

      const balanceText = getBalanceText(tree);
      // Negative with thousands separator
      expect(balanceText).toBe('$-1,234,567');
    });

    it('session delta handles very large positive values', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<GameHeader title="Test" balance={1000} sessionDelta={999999} />);
      });

      const sessionText = getSessionText(tree);
      expect(sessionText).toContain('+$999,999');
    });

    it('session delta handles very large negative values', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<GameHeader title="Test" balance={1000} sessionDelta={-999999} />);
      });

      const sessionText = getSessionText(tree);
      // Should show absolute value with the negative styling
      expect(sessionText).toContain('$999,999');
    });

    it('balance handles Number.MAX_SAFE_INTEGER', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<GameHeader title="Test" balance={Number.MAX_SAFE_INTEGER} />);
      });

      const balanceText = getBalanceText(tree);
      // Should not throw, should start with $ and format with commas
      expect(balanceText.startsWith('$')).toBe(true);
      expect(balanceText).not.toContain('NaN');
      expect(balanceText).not.toContain('undefined');
    });

    it('balance handles Infinity gracefully', () => {
      // Edge case: Infinity should render (as "Infinity" string)
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<GameHeader title="Test" balance={Infinity} />);
      });

      const balanceText = getBalanceText(tree);
      // toLocaleString(Infinity) returns "∞" or "Infinity" depending on locale
      expect(balanceText.startsWith('$')).toBe(true);
      // Should not crash
    });

    it('balance handles NaN gracefully', () => {
      // Edge case: NaN - what happens?
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<GameHeader title="Test" balance={NaN} />);
      });

      const balanceText = getBalanceText(tree);
      // NaN.toLocaleString() returns "NaN"
      expect(balanceText).toContain('NaN');
      // This documents current behavior - ideally should show $0 or handle gracefully
    });
  });
});
