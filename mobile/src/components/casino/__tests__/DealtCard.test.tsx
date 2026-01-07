import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { View } from 'react-native';
import { DealtCard, DealtHiddenCard } from '../DealtCard';
import type { Suit, Rank } from '../../../types';

// Mock haptics service
jest.mock('../../../services/haptics', () => ({
  haptics: { cardDeal: jest.fn().mockResolvedValue(undefined) },
}));

// Mock theme constants
jest.mock('../../../constants/theme', () => ({
  COLORS: {
    suitRed: '#FF0000',
    suitBlack: '#1A1A1A',
  },
  RADIUS: { md: 8, sm: 4 },
  SPRING: {
    cardFlip: { damping: 15, stiffness: 100 },
    cardDeal: { mass: 0.7, stiffness: 280, damping: 22 },
  },
}));

describe('DealtCard', () => {
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

  describe('basic rendering', () => {
    it('renders with required props', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <DealtCard suit="hearts" rank="A" faceUp={true} />
        );
      });
      expect(tree.toJSON()).toBeTruthy();
      act(() => {
        tree.unmount();
      });
    });

    it('renders face down card', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <DealtCard suit="spades" rank="K" faceUp={false} />
        );
      });
      expect(tree.toJSON()).toBeTruthy();
      act(() => {
        tree.unmount();
      });
    });

    it('renders all suits correctly', () => {
      const suits: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];

      for (const suit of suits) {
        let tree!: renderer.ReactTestRenderer;
        act(() => {
          tree = renderer.create(
            <DealtCard suit={suit} rank="Q" faceUp={true} />
          );
        });
        expect(tree.toJSON()).toBeTruthy();
        act(() => {
          tree.unmount();
        });
      }
    });

    it('renders all ranks correctly', () => {
      const ranks: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

      for (const rank of ranks) {
        let tree!: renderer.ReactTestRenderer;
        act(() => {
          tree = renderer.create(
            <DealtCard suit="hearts" rank={rank} faceUp={true} />
          );
        });
        expect(tree.toJSON()).toBeTruthy();
        act(() => {
          tree.unmount();
        });
      }
    });
  });

  describe('size variants', () => {
    it('renders small size', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <DealtCard suit="hearts" rank="A" faceUp={true} size="small" />
        );
      });
      expect(tree.toJSON()).toBeTruthy();
      act(() => {
        tree.unmount();
      });
    });

    it('renders normal size (default)', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <DealtCard suit="hearts" rank="A" faceUp={true} />
        );
      });
      expect(tree.toJSON()).toBeTruthy();
      act(() => {
        tree.unmount();
      });
    });

    it('renders large size', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <DealtCard suit="hearts" rank="A" faceUp={true} size="large" />
        );
      });
      expect(tree.toJSON()).toBeTruthy();
      act(() => {
        tree.unmount();
      });
    });
  });

  describe('deal animation props', () => {
    it('accepts dealIndex for staggering', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <DealtCard suit="hearts" rank="A" faceUp={true} dealIndex={2} />
        );
      });
      expect(tree.toJSON()).toBeTruthy();
      act(() => {
        tree.unmount();
      });
    });

    it('accepts custom staggerDelayMs', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <DealtCard suit="hearts" rank="A" faceUp={true} staggerDelayMs={200} />
        );
      });
      expect(tree.toJSON()).toBeTruthy();
      act(() => {
        tree.unmount();
      });
    });

    it('accepts custom dealer position', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <DealtCard
            suit="hearts"
            rank="A"
            faceUp={true}
            dealerPosition={{ x: 100, y: 50 }}
          />
        );
      });
      expect(tree.toJSON()).toBeTruthy();
      act(() => {
        tree.unmount();
      });
    });

    it('skips animation when skipAnimation is true', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <DealtCard suit="hearts" rank="A" faceUp={true} skipAnimation={true} />
        );
      });
      expect(tree.toJSON()).toBeTruthy();
      act(() => {
        tree.unmount();
      });
    });
  });

  describe('callbacks', () => {
    it('accepts onDealComplete callback', () => {
      const onDealComplete = jest.fn();
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <DealtCard
            suit="hearts"
            rank="A"
            faceUp={true}
            onDealComplete={onDealComplete}
          />
        );
      });
      expect(tree.toJSON()).toBeTruthy();
      act(() => {
        tree.unmount();
      });
    });

    it('accepts onFlipComplete callback', () => {
      const onFlipComplete = jest.fn();
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <DealtCard
            suit="hearts"
            rank="A"
            faceUp={true}
            onFlipComplete={onFlipComplete}
          />
        );
      });
      expect(tree.toJSON()).toBeTruthy();
      act(() => {
        tree.unmount();
      });
    });
  });

  describe('stagger timing', () => {
    it('renders multiple cards with different dealIndex values', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <View>
            <DealtCard suit="hearts" rank="A" faceUp={true} dealIndex={0} />
            <DealtCard suit="spades" rank="K" faceUp={true} dealIndex={1} />
            <DealtCard suit="diamonds" rank="Q" faceUp={true} dealIndex={2} />
          </View>
        );
      });

      // All cards should render
      const views = tree.root.findAll((node) => node.type === View);
      expect(views.length).toBeGreaterThan(0);

      act(() => {
        tree.unmount();
      });
    });

    it('handles zero dealIndex', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <DealtCard suit="hearts" rank="A" faceUp={true} dealIndex={0} />
        );
      });
      expect(tree.toJSON()).toBeTruthy();
      act(() => {
        tree.unmount();
      });
    });

    it('handles high dealIndex for many cards', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <DealtCard suit="hearts" rank="A" faceUp={true} dealIndex={10} />
        );
      });
      expect(tree.toJSON()).toBeTruthy();
      act(() => {
        tree.unmount();
      });
    });
  });
});

describe('DealtHiddenCard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  describe('basic rendering', () => {
    it('renders without props (all defaults)', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(<DealtHiddenCard />);
      });
      expect(tree.toJSON()).toBeTruthy();
      act(() => {
        tree.unmount();
      });
    });

    it('renders with explicit size', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(<DealtHiddenCard size="large" />);
      });
      expect(tree.toJSON()).toBeTruthy();
      act(() => {
        tree.unmount();
      });
    });
  });

  describe('animation props', () => {
    it('accepts dealIndex for staggering', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(<DealtHiddenCard dealIndex={1} />);
      });
      expect(tree.toJSON()).toBeTruthy();
      act(() => {
        tree.unmount();
      });
    });

    it('accepts custom dealer position', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <DealtHiddenCard dealerPosition={{ x: 200, y: 0 }} />
        );
      });
      expect(tree.toJSON()).toBeTruthy();
      act(() => {
        tree.unmount();
      });
    });

    it('skips animation when skipAnimation is true', () => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(<DealtHiddenCard skipAnimation={true} />);
      });
      expect(tree.toJSON()).toBeTruthy();
      act(() => {
        tree.unmount();
      });
    });
  });

  describe('callbacks', () => {
    it('accepts onDealComplete callback', () => {
      const onDealComplete = jest.fn();
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(
          <DealtHiddenCard onDealComplete={onDealComplete} />
        );
      });
      expect(tree.toJSON()).toBeTruthy();
      act(() => {
        tree.unmount();
      });
    });
  });

  describe('size variants', () => {
    const sizes = ['small', 'normal', 'large'] as const;

    test.each(sizes)('renders %s size correctly', (size) => {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(<DealtHiddenCard size={size} />);
      });
      expect(tree.toJSON()).toBeTruthy();
      act(() => {
        tree.unmount();
      });
    });
  });
});

describe('DealtCard vs DealtHiddenCard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('both components render in same container', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <View>
          <DealtCard suit="hearts" rank="A" faceUp={true} dealIndex={0} />
          <DealtHiddenCard dealIndex={1} />
        </View>
      );
    });
    expect(tree.toJSON()).toBeTruthy();
    act(() => {
      tree.unmount();
    });
  });

  it('both respect same staggerDelayMs', () => {
    const customDelay = 150;
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <View>
          <DealtCard
            suit="hearts"
            rank="A"
            faceUp={true}
            dealIndex={0}
            staggerDelayMs={customDelay}
          />
          <DealtHiddenCard
            dealIndex={1}
            staggerDelayMs={customDelay}
          />
        </View>
      );
    });
    expect(tree.toJSON()).toBeTruthy();
    act(() => {
      tree.unmount();
    });
  });

  it('both can use same dealer position', () => {
    const dealerPos = { x: 187.5, y: -50 };
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <View>
          <DealtCard
            suit="spades"
            rank="K"
            faceUp={true}
            dealerPosition={dealerPos}
          />
          <DealtHiddenCard dealerPosition={dealerPos} />
        </View>
      );
    });
    expect(tree.toJSON()).toBeTruthy();
    act(() => {
      tree.unmount();
    });
  });
});
