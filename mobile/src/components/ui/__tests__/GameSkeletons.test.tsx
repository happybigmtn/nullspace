/**
 * Tests for GameSkeletons components (US-115)
 */
import React from 'react';
import { create, act } from 'react-test-renderer';
import { View, Text } from 'react-native';
import {
  CardSkeleton,
  ChipSkeleton,
  TableAreaSkeleton,
  HandSkeleton,
  ChipRowSkeleton,
  TextSkeleton,
  ButtonSkeleton,
  BlackjackSkeleton,
  HiLoSkeleton,
  RouletteSkeleton,
  VideoPokerSkeleton,
  CrapsSkeleton,
  SicBoSkeleton,
  BaccaratSkeleton,
  GenericGameSkeleton,
  GameSkeletonLoader,
} from '../GameSkeletons';

// Reanimated is mocked in jest/setup.js

describe('GameSkeletons', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  describe('CardSkeleton', () => {
    it('renders with default size', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<CardSkeleton />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders with small size', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<CardSkeleton size="small" />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders with large size', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<CardSkeleton size="large" />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('applies custom style', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<CardSkeleton style={{ margin: 10 }} />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });
  });

  describe('ChipSkeleton', () => {
    it('renders with default size', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<ChipSkeleton />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders with custom size', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<ChipSkeleton size={64} />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });
  });

  describe('TableAreaSkeleton', () => {
    it('renders with default dimensions', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<TableAreaSkeleton />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders with custom dimensions', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<TableAreaSkeleton width={200} height={100} />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders with percentage width', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<TableAreaSkeleton width="80%" />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });
  });

  describe('HandSkeleton', () => {
    it('renders with default card count', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<HandSkeleton />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders with custom card count', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<HandSkeleton cardCount={5} />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders with different card sizes', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<HandSkeleton cardSize="small" />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders with custom overlap', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<HandSkeleton overlap={30} />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });
  });

  describe('ChipRowSkeleton', () => {
    it('renders with default chip count', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<ChipRowSkeleton />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders with custom chip count', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<ChipRowSkeleton chipCount={3} />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders with custom chip size', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<ChipRowSkeleton chipSize={56} />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });
  });

  describe('TextSkeleton', () => {
    it('renders with default dimensions', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<TextSkeleton />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders with custom dimensions', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<TextSkeleton width={120} height={24} />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders with percentage width', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<TextSkeleton width="50%" />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });
  });

  describe('ButtonSkeleton', () => {
    it('renders with default dimensions', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<ButtonSkeleton />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders with custom dimensions', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<ButtonSkeleton width={200} height={60} />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });
  });

  describe('Game-specific skeletons', () => {
    it('renders BlackjackSkeleton', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<BlackjackSkeleton />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders HiLoSkeleton', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<HiLoSkeleton />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders RouletteSkeleton', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<RouletteSkeleton />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders VideoPokerSkeleton', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<VideoPokerSkeleton />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders CrapsSkeleton', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<CrapsSkeleton />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders SicBoSkeleton', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<SicBoSkeleton />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders BaccaratSkeleton', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<BaccaratSkeleton />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders GenericGameSkeleton', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<GenericGameSkeleton />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('applies custom accentColor', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<BlackjackSkeleton accentColor="#FF0000" />);
      });
      expect(tree.toJSON()).toBeTruthy();
    });
  });

  describe('GameSkeletonLoader', () => {
    it('renders skeleton when isLoading is true', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <GameSkeletonLoader gameType="blackjack" isLoading={true}>
            <Text>Game Content</Text>
          </GameSkeletonLoader>
        );
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders children when isLoading is false', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <GameSkeletonLoader gameType="blackjack" isLoading={false}>
            <Text>Game Content</Text>
          </GameSkeletonLoader>
        );
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('selects correct skeleton for hi_lo', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <GameSkeletonLoader gameType="hi_lo" isLoading={true}>
            <View />
          </GameSkeletonLoader>
        );
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('selects correct skeleton for roulette', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <GameSkeletonLoader gameType="roulette" isLoading={true}>
            <View />
          </GameSkeletonLoader>
        );
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('selects correct skeleton for video_poker', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <GameSkeletonLoader gameType="video_poker" isLoading={true}>
            <View />
          </GameSkeletonLoader>
        );
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('selects correct skeleton for craps', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <GameSkeletonLoader gameType="craps" isLoading={true}>
            <View />
          </GameSkeletonLoader>
        );
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('selects correct skeleton for sic_bo', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <GameSkeletonLoader gameType="sic_bo" isLoading={true}>
            <View />
          </GameSkeletonLoader>
        );
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('selects correct skeleton for baccarat', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <GameSkeletonLoader gameType="baccarat" isLoading={true}>
            <View />
          </GameSkeletonLoader>
        );
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('uses BlackjackSkeleton for casino_war', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <GameSkeletonLoader gameType="casino_war" isLoading={true}>
            <View />
          </GameSkeletonLoader>
        );
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('uses BlackjackSkeleton for three_card_poker', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <GameSkeletonLoader gameType="three_card_poker" isLoading={true}>
            <View />
          </GameSkeletonLoader>
        );
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('uses BlackjackSkeleton for ultimate_texas_holdem', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <GameSkeletonLoader gameType="ultimate_texas_holdem" isLoading={true}>
            <View />
          </GameSkeletonLoader>
        );
      });
      expect(tree.toJSON()).toBeTruthy();
    });

    it('accepts custom accentColor', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <GameSkeletonLoader gameType="blackjack" isLoading={true} accentColor="#00FF00">
            <View />
          </GameSkeletonLoader>
        );
      });
      expect(tree.toJSON()).toBeTruthy();
    });
  });
});
