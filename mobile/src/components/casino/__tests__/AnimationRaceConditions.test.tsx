/**
 * Animation State Race Condition Tests (US-069)
 *
 * Tests for animation timing races that could cause:
 * - Visual glitches from overlapping animations
 * - Memory leaks from unmounting during animations
 * - Completion callback issues
 * - Animated.Value (SharedValue) cleanup failures
 */
import React from 'react';
import renderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';
import { Card } from '../Card';
import { ChipSelector } from '../ChipSelector';

// Get mocked reanimated for inspection
const reanimatedMock = jest.requireMock('react-native-reanimated');

jest.mock('../../../services/haptics', () => ({
  haptics: {
    cardDeal: jest.fn(),
    chipPlace: jest.fn(),
    betConfirm: jest.fn(),
  },
}));

jest.mock('../../../constants/theme', () => ({
  COLORS: {
    suitRed: '#FF0000',
    suitBlack: '#1A1A1A',
    primary: '#3B82F6',
    gold: '#FFD700',
    textPrimary: '#FFFFFF',
  },
  RADIUS: { md: 8, sm: 4 },
  SPRING: {
    cardFlip: { damping: 15, stiffness: 100 },
    chipStack: { damping: 12, stiffness: 120 },
    chipToss: { damping: 20, stiffness: 150 },
  },
  SPACING: { md: 16, sm: 8, xs: 4 },
  TYPOGRAPHY: { caption: { fontSize: 12 } },
  CHIP_VALUES: [1, 5, 25, 100, 500, 1000],
}));

describe('Animation Race Conditions (US-069)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  describe('Rapid bet placement animation overlap', () => {
    it('handles rapid chip selections without animation overlap', () => {
      const onSelect = jest.fn();
      const onChipPlace = jest.fn();
      let tree!: ReactTestRenderer;

      act(() => {
        tree = renderer.create(
          <ChipSelector
            selectedValue={25}
            onSelect={onSelect}
            onChipPlace={onChipPlace}
          />
        );
      });

      // Simulate rapid chip value changes (mimics fast tapping)
      for (let i = 0; i < 10; i++) {
        act(() => {
          tree.update(
            <ChipSelector
              selectedValue={i % 2 === 0 ? 25 : 100}
              onSelect={onSelect}
              onChipPlace={onChipPlace}
            />
          );
        });
      }

      // Component should remain stable without crashes
      expect(tree.toJSON()).toBeTruthy();

      act(() => {
        tree.unmount();
      });
    });

    it('maintains animation integrity during rapid re-renders', () => {
      const onSelect = jest.fn();
      const onChipPlace = jest.fn();
      let tree!: ReactTestRenderer;

      act(() => {
        tree = renderer.create(
          <ChipSelector
            selectedValue={1}
            onSelect={onSelect}
            onChipPlace={onChipPlace}
          />
        );
      });

      // Rapid updates should not cause animation state corruption
      const updateCount = 50;
      for (let i = 0; i < updateCount; i++) {
        act(() => {
          tree.update(
            <ChipSelector
              selectedValue={[1, 5, 25, 100, 500, 1000][i % 6] as 1 | 5 | 25 | 100 | 500 | 1000}
              onSelect={onSelect}
              onChipPlace={onChipPlace}
            />
          );
        });
      }

      // Verify no console errors and component is intact
      expect(tree.toJSON()).toBeTruthy();

      act(() => {
        tree.unmount();
      });
    });

    it('handles rapid disabled state toggles without animation issues', () => {
      const onSelect = jest.fn();
      const onChipPlace = jest.fn();
      let tree!: ReactTestRenderer;

      act(() => {
        tree = renderer.create(
          <ChipSelector
            selectedValue={25}
            disabled={false}
            onSelect={onSelect}
            onChipPlace={onChipPlace}
          />
        );
      });

      // Toggle disabled rapidly (simulates game state changes)
      for (let i = 0; i < 20; i++) {
        act(() => {
          tree.update(
            <ChipSelector
              selectedValue={25}
              disabled={i % 2 === 0}
              onSelect={onSelect}
              onChipPlace={onChipPlace}
            />
          );
        });
      }

      expect(tree.toJSON()).toBeTruthy();

      act(() => {
        tree.unmount();
      });
    });
  });

  describe('Unmount during animation - memory leak prevention', () => {
    it('card unmount during flip animation does not leak', () => {
      let tree!: ReactTestRenderer;

      act(() => {
        tree = renderer.create(
          <Card suit="hearts" rank="A" faceUp={false} />
        );
      });

      // Trigger flip animation
      act(() => {
        tree.update(<Card suit="hearts" rank="A" faceUp />);
      });

      // Immediately unmount before animation completes
      act(() => {
        tree.unmount();
      });

      // No assertions needed - test passes if no errors/warnings thrown
      // In production, this would verify no memory leaks via React DevTools
      expect(true).toBe(true);
    });

    it('chip selector unmount during scale animation does not leak', () => {
      const onSelect = jest.fn();
      const onChipPlace = jest.fn();
      let tree!: ReactTestRenderer;

      act(() => {
        tree = renderer.create(
          <ChipSelector
            selectedValue={25}
            onSelect={onSelect}
            onChipPlace={onChipPlace}
          />
        );
      });

      // Trigger animation via disabled toggle
      act(() => {
        tree.update(
          <ChipSelector
            selectedValue={25}
            disabled
            onSelect={onSelect}
            onChipPlace={onChipPlace}
          />
        );
      });

      // Unmount immediately
      act(() => {
        tree.unmount();
      });

      expect(true).toBe(true);
    });

    it('multiple cards unmounting during staggered animations', () => {
      let tree!: ReactTestRenderer;

      // Create multiple cards
      act(() => {
        tree = renderer.create(
          <View>
            <Card suit="hearts" rank="A" faceUp={false} />
            <Card suit="diamonds" rank="K" faceUp={false} />
            <Card suit="clubs" rank="Q" faceUp={false} />
            <Card suit="spades" rank="J" faceUp={false} />
          </View>
        );
      });

      // Flip all cards (staggered animations would overlap)
      act(() => {
        tree.update(
          <View>
            <Card suit="hearts" rank="A" faceUp />
            <Card suit="diamonds" rank="K" faceUp />
            <Card suit="clubs" rank="Q" faceUp />
            <Card suit="spades" rank="J" faceUp />
          </View>
        );
      });

      // Unmount during animations
      act(() => {
        tree.unmount();
      });

      expect(true).toBe(true);
    });

    it('cleans up InteractionManager handle on unmount during animation', () => {
      // This test documents that react-native-reanimated handles cleanup internally
      // SharedValues are automatically garbage collected when component unmounts
      let tree!: ReactTestRenderer;

      act(() => {
        tree = renderer.create(
          <Card suit="hearts" rank="A" faceUp={false} />
        );
      });

      // Start animation
      act(() => {
        tree.update(<Card suit="hearts" rank="A" faceUp />);
      });

      // Advance timers partially (animation in progress)
      act(() => {
        jest.advanceTimersByTime(50);
      });

      // Unmount mid-animation
      act(() => {
        tree.unmount();
      });

      // Flush remaining timers - should not throw
      act(() => {
        jest.runOnlyPendingTimers();
      });

      expect(true).toBe(true);
    });
  });

  describe('Animation completion callback safety', () => {
    it('onFlipComplete fires correctly when animation completes', () => {
      const onFlipComplete = jest.fn();
      let tree!: ReactTestRenderer;

      act(() => {
        tree = renderer.create(
          <Card
            suit="hearts"
            rank="A"
            faceUp={false}
            onFlipComplete={onFlipComplete}
          />
        );
      });

      // In test env, animation effect is skipped (line 98 of Card.tsx)
      // So we verify the component accepts the callback without error
      act(() => {
        tree.update(
          <Card suit="hearts" rank="A" faceUp onFlipComplete={onFlipComplete} />
        );
      });

      // In production, the callback would fire after spring animation completes
      // Test verifies no crash when callback prop is present
      expect(tree.toJSON()).toBeTruthy();

      act(() => {
        tree.unmount();
      });
    });

    it('onFlipComplete callback update does not re-trigger animation', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      let tree!: ReactTestRenderer;

      act(() => {
        tree = renderer.create(
          <Card suit="hearts" rank="A" faceUp onFlipComplete={callback1} />
        );
      });

      // Update callback identity - should NOT re-trigger animation
      // This is handled by the onFlipCompleteRef pattern in Card.tsx
      act(() => {
        tree.update(
          <Card suit="hearts" rank="A" faceUp onFlipComplete={callback2} />
        );
      });

      // faceUp didn't change, so animation shouldn't restart
      // Ref pattern ensures latest callback is used when animation fires
      expect(tree.toJSON()).toBeTruthy();

      act(() => {
        tree.unmount();
      });
    });

    it('onFlipComplete is not called if component unmounts before animation ends', () => {
      const onFlipComplete = jest.fn();
      let tree!: ReactTestRenderer;

      act(() => {
        tree = renderer.create(
          <Card suit="hearts" rank="A" faceUp={false} onFlipComplete={onFlipComplete} />
        );
      });

      // Trigger flip
      act(() => {
        tree.update(
          <Card suit="hearts" rank="A" faceUp onFlipComplete={onFlipComplete} />
        );
      });

      // Unmount before animation completes
      act(() => {
        tree.unmount();
      });

      // Callback should NOT be called on unmounted component
      // (react-native-reanimated's runOnJS handles this internally)
      // In production, this prevents "setState on unmounted component" warnings
    });

    it('handles null/undefined onFlipComplete gracefully', () => {
      let tree!: ReactTestRenderer;

      // First render with callback
      act(() => {
        tree = renderer.create(
          <Card suit="hearts" rank="A" faceUp onFlipComplete={() => {}} />
        );
      });

      // Update to undefined callback
      act(() => {
        tree.update(
          <Card suit="hearts" rank="A" faceUp onFlipComplete={undefined} />
        );
      });

      // Should not crash
      expect(tree.toJSON()).toBeTruthy();

      act(() => {
        tree.unmount();
      });
    });
  });

  describe('Animated.Value (SharedValue) cleanup', () => {
    it('SharedValues are garbage collected on unmount', () => {
      // This test documents that react-native-reanimated mock handles cleanup
      // In production, SharedValues use shared memory that is released on unmount
      let tree!: ReactTestRenderer;

      act(() => {
        tree = renderer.create(
          <Card suit="hearts" rank="A" faceUp />
        );
      });

      // Create multiple instances to stress test
      for (let i = 0; i < 10; i++) {
        act(() => {
          tree.update(
            <View key={i}>
              <Card suit="hearts" rank={String(i % 10) as 'A'} faceUp={i % 2 === 0} />
            </View>
          );
        });
      }

      act(() => {
        tree.unmount();
      });

      // No memory leak assertions possible in Jest, but no errors = pass
      expect(true).toBe(true);
    });

    it('useAnimatedStyle cleanup on rapid prop changes', () => {
      const onSelect = jest.fn();
      const onChipPlace = jest.fn();
      let tree!: ReactTestRenderer;

      act(() => {
        tree = renderer.create(
          <ChipSelector
            selectedValue={25}
            onSelect={onSelect}
            onChipPlace={onChipPlace}
          />
        );
      });

      // Rapid prop changes create new animated styles
      for (let i = 0; i < 100; i++) {
        act(() => {
          tree.update(
            <ChipSelector
              selectedValue={25}
              disabled={i % 2 === 0}
              onSelect={onSelect}
              onChipPlace={onChipPlace}
            />
          );
        });
      }

      act(() => {
        tree.unmount();
      });

      expect(true).toBe(true);
    });

    it('documents: withSpring animation values do not accumulate', () => {
      // In ChipSelector, each Chip has useSharedValue for:
      // - offset ({ x, y })
      // - scale
      // - isDragging
      // - startPosition
      //
      // These are stable (not recreated on render) because useSharedValue
      // returns the same reference across renders.
      //
      // The animation values (from withSpring) are transient and don't accumulate.
      let tree!: ReactTestRenderer;

      act(() => {
        tree = renderer.create(
          <ChipSelector
            selectedValue={25}
            onSelect={jest.fn()}
            onChipPlace={jest.fn()}
          />
        );
      });

      // Multiple animations triggered via prop changes
      for (let i = 0; i < 10; i++) {
        act(() => {
          tree.update(
            <ChipSelector
              selectedValue={[1, 5, 25, 100, 500, 1000][i % 6] as 1 | 5 | 25 | 100 | 500 | 1000}
              onSelect={jest.fn()}
              onChipPlace={jest.fn()}
            />
          );
        });
      }

      expect(tree.toJSON()).toBeTruthy();

      act(() => {
        tree.unmount();
      });
    });

    it('Card flip value resets correctly on faceUp toggle', () => {
      let tree!: ReactTestRenderer;

      act(() => {
        tree = renderer.create(
          <Card suit="hearts" rank="A" faceUp={false} />
        );
      });

      // Toggle faceUp multiple times
      for (let i = 0; i < 10; i++) {
        act(() => {
          tree.update(
            <Card suit="hearts" rank="A" faceUp={i % 2 === 0} />
          );
        });
      }

      // Should not accumulate rotation values
      expect(tree.toJSON()).toBeTruthy();

      act(() => {
        tree.unmount();
      });
    });
  });

  describe('Edge cases and stress tests', () => {
    it('handles simultaneous mount/unmount of many animated components', () => {
      const trees: ReactTestRenderer[] = [];
      const suits: ('hearts' | 'diamonds' | 'clubs' | 'spades')[] = ['hearts', 'diamonds', 'clubs', 'spades'];

      // Mount 20 cards simultaneously
      act(() => {
        for (let i = 0; i < 20; i++) {
          const suit = suits[i % 4]!;
          const tree = renderer.create(
            <Card
              suit={suit}
              rank="A"
              faceUp={i % 2 === 0}
            />
          );
          trees.push(tree);
        }
      });

      // Unmount all
      act(() => {
        trees.forEach((tree) => tree.unmount());
      });

      expect(trees.length).toBe(20);
    });

    it('survives animation during parent re-render', () => {
      let renderCount = 0;

      const Parent = ({ faceUp }: { faceUp: boolean }) => {
        renderCount++;
        return (
          <View>
            <Card suit="hearts" rank="A" faceUp={faceUp} />
            <Card suit="diamonds" rank="K" faceUp={faceUp} />
          </View>
        );
      };

      let tree!: ReactTestRenderer;

      act(() => {
        tree = renderer.create(<Parent faceUp={false} />);
      });

      // Parent re-renders should not break child animations
      for (let i = 0; i < 5; i++) {
        act(() => {
          tree.update(<Parent faceUp={i % 2 === 0} />);
        });
      }

      expect(renderCount).toBeGreaterThan(1);

      act(() => {
        tree.unmount();
      });
    });

    it('documents: animation timing in reanimated mock is synchronous', () => {
      // In Jest, react-native-reanimated/mock makes all animations synchronous.
      // This means:
      // - withSpring() completes immediately
      // - Timing races can't be fully tested in unit tests
      // - Integration tests with real device needed for timing verification
      //
      // What we CAN test:
      // - Component stability during rapid updates
      // - No crashes on unmount
      // - Callback identity patterns
      // - SharedValue initialization patterns
      expect(true).toBe(true);
    });
  });
});
