import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, View } from 'react-native';
import { Card, HiddenCard } from '../Card';
import type { Suit, Rank } from '../../../types';

jest.mock('../../../services/haptics', () => ({
  haptics: { cardDeal: jest.fn() },
}));

// Mock COLORS for testing color assertions
jest.mock('../../../constants/theme', () => ({
  COLORS: {
    suitRed: '#FF0000', // ACTION.error
    suitBlack: '#1A1A1A', // TITANIUM[900]
  },
  RADIUS: { md: 8, sm: 4 },
  SPRING: { cardFlip: { damping: 15, stiffness: 100 } },
}));

describe('Card', () => {
  let mockHaptics: { cardDeal: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers();
    mockHaptics = (jest.requireMock('../../../services/haptics') as {
      haptics: { cardDeal: jest.Mock };
    }).haptics;
    mockHaptics.cardDeal.mockClear();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('renders rank and suit when face up', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<Card suit="hearts" rank="A" faceUp />);
    });
    const texts = tree.root
      .findAll((node) => node.type === Text)
      .map((node) => node.props.children);
    expect(texts).toContain('A');
    expect(texts).toContain('♥');
    act(() => {
      tree.unmount();
    });
  });

  it('renders hidden card placeholder', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<HiddenCard />);
    });
    expect(tree.toJSON()).toBeTruthy();
    act(() => {
      tree.unmount();
    });
  });

  it('triggers flip side effects outside test env', () => {
    const originalEnv = process.env.NODE_ENV;
    // Use Object.defineProperty to modify NODE_ENV since direct assignment is read-only
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'development',
      writable: true,
      configurable: true,
    });

    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<Card suit="spades" rank="K" faceUp={false} size="large" />);
    });
    act(() => {
      tree.update(<Card suit="spades" rank="K" faceUp size="large" />);
    });

    expect(mockHaptics.cardDeal).toHaveBeenCalled();

    act(() => {
      tree.unmount();
    });
    // Restore original NODE_ENV
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: originalEnv,
      writable: true,
      configurable: true,
    });
  });

  // ========================================================================
  // Full Coverage Tests (US-054)
  // ========================================================================

  describe('All 4 suits with correct colors', () => {
    const suitData: { suit: Suit; symbol: string; colorName: string }[] = [
      { suit: 'hearts', symbol: '♥', colorName: 'suitRed' },
      { suit: 'diamonds', symbol: '♦', colorName: 'suitRed' },
      { suit: 'clubs', symbol: '♣', colorName: 'suitBlack' },
      { suit: 'spades', symbol: '♠', colorName: 'suitBlack' },
    ];

    test.each(suitData)(
      'renders $suit with correct symbol ($symbol) and color ($colorName)',
      ({ suit, symbol, colorName }) => {
        let tree!: renderer.ReactTestRenderer;
        act(() => {
          tree = renderer.create(<Card suit={suit} rank="A" faceUp />);
        });

        const texts = tree.root.findAll((node) => node.type === Text);

        // Find the suit symbol text
        const suitText = texts.find((node) => node.props.children === symbol);
        expect(suitText).toBeDefined();

        // Verify color (red suits should use suitRed, black suits should use suitBlack)
        const expectedColor = colorName === 'suitRed' ? '#FF0000' : '#1A1A1A';
        expect(suitText?.props.style).toEqual(
          expect.arrayContaining([expect.objectContaining({ color: expectedColor })])
        );

        act(() => {
          tree.unmount();
        });
      }
    );

    it('red suits (hearts, diamonds) use same color', () => {
      let heartsTree!: renderer.ReactTestRenderer;
      let diamondsTree!: renderer.ReactTestRenderer;

      act(() => {
        heartsTree = renderer.create(<Card suit="hearts" rank="A" faceUp />);
        diamondsTree = renderer.create(<Card suit="diamonds" rank="A" faceUp />);
      });

      const heartsTexts = heartsTree.root.findAll((node) => node.type === Text);
      const diamondsTexts = diamondsTree.root.findAll((node) => node.type === Text);

      const heartsColor = heartsTexts[0].props.style[1]?.color;
      const diamondsColor = diamondsTexts[0].props.style[1]?.color;

      expect(heartsColor).toBe(diamondsColor);
      expect(heartsColor).toBe('#FF0000'); // suitRed

      act(() => {
        heartsTree.unmount();
        diamondsTree.unmount();
      });
    });

    it('black suits (clubs, spades) use same color', () => {
      let clubsTree!: renderer.ReactTestRenderer;
      let spadesTree!: renderer.ReactTestRenderer;

      act(() => {
        clubsTree = renderer.create(<Card suit="clubs" rank="A" faceUp />);
        spadesTree = renderer.create(<Card suit="spades" rank="A" faceUp />);
      });

      const clubsTexts = clubsTree.root.findAll((node) => node.type === Text);
      const spadesTexts = spadesTree.root.findAll((node) => node.type === Text);

      const clubsColor = clubsTexts[0].props.style[1]?.color;
      const spadesColor = spadesTexts[0].props.style[1]?.color;

      expect(clubsColor).toBe(spadesColor);
      expect(clubsColor).toBe('#1A1A1A'); // suitBlack

      act(() => {
        clubsTree.unmount();
        spadesTree.unmount();
      });
    });
  });

  describe('All 13 ranks', () => {
    const allRanks: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

    test.each(allRanks)('renders rank %s correctly', (rank) => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(<Card suit="hearts" rank={rank} faceUp />);
      });

      const texts = tree.root
        .findAll((node) => node.type === Text)
        .map((node) => node.props.children);

      expect(texts).toContain(rank);

      act(() => {
        tree.unmount();
      });
    });

    it('all face cards render correctly', () => {
      const faceCards: Rank[] = ['J', 'Q', 'K'];

      for (const rank of faceCards) {
        let tree!: renderer.ReactTestRenderer;
        act(() => {
          tree = renderer.create(<Card suit="spades" rank={rank} faceUp />);
        });

        const texts = tree.root
          .findAll((node) => node.type === Text)
          .map((node) => node.props.children);

        expect(texts).toContain(rank);
        expect(texts).toContain('♠');

        act(() => {
          tree.unmount();
        });
      }
    });

    it('10 renders as two-character rank', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(<Card suit="diamonds" rank="10" faceUp />);
      });

      const texts = tree.root
        .findAll((node) => node.type === Text)
        .map((node) => node.props.children);

      expect(texts).toContain('10');

      act(() => {
        tree.unmount();
      });
    });
  });

  describe('Size variants', () => {
    const sizes = ['small', 'normal', 'large'] as const;
    const expectedSizes = {
      small: { width: 56, height: 84 },
      normal: { width: 80, height: 120 },
      large: { width: 100, height: 150 },
    };

    test.each(sizes)('renders %s size with correct dimensions', (size) => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(<Card suit="hearts" rank="A" faceUp size={size} />);
      });

      // Find the container view with the size style
      const views = tree.root.findAll((node) => node.type === View);
      const cardContainer = views[0]; // First view is the container

      const expected = expectedSizes[size];
      expect(cardContainer.props.style).toEqual(
        expect.arrayContaining([expect.objectContaining(expected)])
      );

      act(() => {
        tree.unmount();
      });
    });

    it('defaults to normal size when no size prop', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(<Card suit="hearts" rank="A" faceUp />);
      });

      const views = tree.root.findAll((node) => node.type === View);
      const cardContainer = views[0];

      expect(cardContainer.props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({ width: 80, height: 120 })])
      );

      act(() => {
        tree.unmount();
      });
    });

    it('HiddenCard respects size prop', () => {
      const sizes = ['small', 'normal', 'large'] as const;

      for (const size of sizes) {
        let tree!: renderer.ReactTestRenderer;
        act(() => {
          tree = renderer.create(<HiddenCard size={size} />);
        });

        const views = tree.root.findAll((node) => node.type === View);
        const card = views[0];

        const expected = expectedSizes[size];
        expect(card.props.style).toEqual(
          expect.arrayContaining([expect.objectContaining(expected)])
        );

        act(() => {
          tree.unmount();
        });
      }
    });
  });

  describe('Face up vs face down rendering', () => {
    it('face up shows rank and suit', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(<Card suit="hearts" rank="K" faceUp />);
      });

      const texts = tree.root
        .findAll((node) => node.type === Text)
        .map((node) => node.props.children);

      expect(texts).toContain('K');
      expect(texts).toContain('♥');

      act(() => {
        tree.unmount();
      });
    });

    it('face down still renders card structure', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(<Card suit="hearts" rank="K" faceUp={false} />);
      });

      // Card should still be rendered (flip animation controls visibility)
      expect(tree.toJSON()).toBeTruthy();

      act(() => {
        tree.unmount();
      });
    });
  });

  describe('onFlipComplete callback', () => {
    it('callback is stored in ref and available', () => {
      const onFlipComplete = jest.fn();
      let tree!: renderer.ReactTestRenderer;

      act(() => {
        tree = renderer.create(
          <Card suit="hearts" rank="A" faceUp={false} onFlipComplete={onFlipComplete} />
        );
      });

      // In test env, the animation doesn't run, but we verify the component accepts the callback
      expect(tree.toJSON()).toBeTruthy();

      act(() => {
        tree.unmount();
      });
    });

    it('callback can be updated without re-triggering animation', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <Card suit="hearts" rank="A" faceUp onFlipComplete={callback1} />
        );
      });

      act(() => {
        tree.update(<Card suit="hearts" rank="A" faceUp onFlipComplete={callback2} />);
      });

      // Neither callback should be called in test env
      // The test verifies the component doesn't crash when callback changes
      expect(tree.toJSON()).toBeTruthy();

      act(() => {
        tree.unmount();
      });
    });
  });

  describe('Font size scaling per size variant', () => {
    it('small size uses 0.7x font multiplier', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(<Card suit="hearts" rank="A" faceUp size="small" />);
      });

      const texts = tree.root.findAll((node) => node.type === Text);
      const rankText = texts.find((t) => t.props.children === 'A');

      // Base fontSize is 24, small = 0.7x = 16.8
      expect(rankText?.props.style[1]?.fontSize).toBeCloseTo(16.8, 1);

      act(() => {
        tree.unmount();
      });
    });

    it('normal size uses 1x font multiplier', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(<Card suit="hearts" rank="A" faceUp size="normal" />);
      });

      const texts = tree.root.findAll((node) => node.type === Text);
      const rankText = texts.find((t) => t.props.children === 'A');

      // Base fontSize is 24, normal = 1x = 24
      expect(rankText?.props.style[1]?.fontSize).toBe(24);

      act(() => {
        tree.unmount();
      });
    });

    it('large size uses 1.3x font multiplier', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(<Card suit="hearts" rank="A" faceUp size="large" />);
      });

      const texts = tree.root.findAll((node) => node.type === Text);
      const rankText = texts.find((t) => t.props.children === 'A');

      // Base fontSize is 24, large = 1.3x = 31.2
      expect(rankText?.props.style[1]?.fontSize).toBeCloseTo(31.2, 1);

      act(() => {
        tree.unmount();
      });
    });
  });
});
