/**
 * ChipPile component tests (US-122)
 *
 * Tests chip pile stacking visualization with:
 * - Rendering chips in stack formation
 * - Counter display updates
 * - Empty state handling
 * - Random rotation persistence
 */
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Text, View } from 'react-native';
import { ChipPile, createPlacedChip } from '../ChipPile';
import type { PlacedChip } from '../ChipPile';

// Mock reanimated
jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  Reanimated.default.call = () => {};
  return Reanimated;
});

// Mock haptics
jest.mock('../../../services/haptics', () => ({
  haptics: {
    chipPlace: jest.fn(() => Promise.resolve()),
  },
}));

const findTextWithContent = (texts: any[], content: string) =>
  texts.find((t) => {
    const children = t.props?.children;
    if (typeof children === 'string') return children === content;
    if (typeof children === 'number') return String(children) === content;
    if (Array.isArray(children)) return children.join('') === content;
    return false;
  });

describe('ChipPile', () => {
  const createChip = (value: 1 | 5 | 25 | 100 | 500 | 1000, id?: string): PlacedChip => ({
    id: id || `chip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    value,
    rotation: Math.random() * 30 - 15,
    placedAt: Date.now(),
  });

  const renderComponent = (chips: PlacedChip[], totalBet: number, showCounter = true) => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <ChipPile chips={chips} totalBet={totalBet} showCounter={showCounter} />
      );
    });
    return tree;
  };

  describe('rendering', () => {
    it('renders empty state when no chips', () => {
      const tree = renderComponent([], 0);
      const texts = tree.root.findAllByType(Text);
      const emptyText = texts.find((t) => t.props.children === 'Drop chips here');
      expect(emptyText).toBeTruthy();
    });

    it('renders single chip correctly', () => {
      const chips = [createChip(25)];
      const tree = renderComponent(chips, 25);
      const texts = tree.root.findAllByType(Text);
      const emptyText = texts.find((t) => t.props.children === 'Drop chips here');
      expect(emptyText).toBeUndefined();
    });

    it('renders multiple chips in stack', () => {
      const chips = [
        createChip(25, 'chip-1'),
        createChip(100, 'chip-2'),
        createChip(500, 'chip-3'),
      ];
      const tree = renderComponent(chips, 625);
      expect(tree.root).toBeTruthy();
    });

    it('shows total bet counter', () => {
      const chips = [createChip(100)];
      const tree = renderComponent(chips, 100, true);
      const texts = tree.root.findAllByType(Text);
      const totalText = findTextWithContent(texts, '$100');
      const labelText = findTextWithContent(texts, 'Total');
      expect(totalText).toBeTruthy();
      expect(labelText).toBeTruthy();
    });

    it('hides counter when showCounter is false', () => {
      const chips = [createChip(100)];
      const tree = renderComponent(chips, 100, false);
      const texts = tree.root.findAllByType(Text);
      const labelText = findTextWithContent(texts, 'Total');
      expect(labelText).toBeUndefined();
    });

    it('accepts testID prop', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(
          <ChipPile chips={[createChip(25)]} totalBet={25} testID="test-pile" />
        );
      });
      const rootView = tree.root.findAllByType(View)[0];
      expect(rootView?.props.testID).toBe('test-pile');
    });
  });

  describe('chip values', () => {
    it('renders all chip denominations correctly', () => {
      const values: Array<1 | 5 | 25 | 100 | 500 | 1000> = [1, 5, 25, 100, 500, 1000];
      values.forEach((value) => {
        const chips = [createChip(value)];
        const tree = renderComponent(chips, value);
        expect(tree.root).toBeTruthy();
      });
    });

    it('displays 1K for 1000 chip value', () => {
      const chips = [createChip(1000)];
      const tree = renderComponent(chips, 1000);
      const texts = tree.root.findAllByType(Text);
      const chipValueText = findTextWithContent(texts, '1K');
      expect(chipValueText).toBeTruthy();
    });

    it('displays regular values for non-1000 chips', () => {
      const chips = [createChip(500)];
      const tree = renderComponent(chips, 500);
      const texts = tree.root.findAllByType(Text);
      const chipValueText = findTextWithContent(texts, '500');
      expect(chipValueText).toBeTruthy();
    });
  });

  describe('stack limits', () => {
    it('limits visible chips to MAX_VISIBLE_CHIPS (10)', () => {
      const chips: PlacedChip[] = [];
      for (let i = 0; i < 15; i++) {
        chips.push(createChip(25, `chip-${i}`));
      }

      const tree = renderComponent(chips, 375);
      // Component should render without error even with 15 chips
      expect(tree.root).toBeTruthy();
    });

    it('shows correct total even when some chips are hidden', () => {
      const chips: PlacedChip[] = [];
      for (let i = 0; i < 15; i++) {
        chips.push(createChip(100, `chip-${i}`));
      }

      const tree = renderComponent(chips, 1500);
      const texts = tree.root.findAllByType(Text);
      const totalText = findTextWithContent(texts, '$1500');
      expect(totalText).toBeTruthy();
    });
  });
});

describe('createPlacedChip helper', () => {
  it('creates chip with unique id', () => {
    const chip1 = createPlacedChip(25);
    const chip2 = createPlacedChip(25);

    expect(chip1.id).not.toBe(chip2.id);
  });

  it('creates chip with correct value', () => {
    const chip = createPlacedChip(500);
    expect(chip.value).toBe(500);
  });

  it('creates chip with rotation between -15 and 15 degrees', () => {
    // Test multiple times to catch random variations
    for (let i = 0; i < 10; i++) {
      const chip = createPlacedChip(100);
      expect(chip.rotation).toBeGreaterThanOrEqual(-15);
      expect(chip.rotation).toBeLessThanOrEqual(15);
    }
  });

  it('creates chip with current timestamp', () => {
    const before = Date.now();
    const chip = createPlacedChip(25);
    const after = Date.now();

    expect(chip.placedAt).toBeGreaterThanOrEqual(before);
    expect(chip.placedAt).toBeLessThanOrEqual(after);
  });
});

describe('ChipPile integration', () => {
  const createChip = (value: 1 | 5 | 25 | 100 | 500 | 1000, id?: string): PlacedChip => ({
    id: id || `chip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    value,
    rotation: Math.random() * 30 - 15,
    placedAt: Date.now(),
  });

  it('handles rapid chip additions', () => {
    const chips: PlacedChip[] = [];
    let tree!: ReactTestRenderer;

    act(() => {
      tree = create(<ChipPile chips={chips} totalBet={0} />);
    });

    // Simulate rapid chip additions
    for (let i = 0; i < 5; i++) {
      const newChips = [...chips, createPlacedChip(25)];
      chips.push(newChips[newChips.length - 1]!);
      act(() => {
        tree.update(<ChipPile chips={[...chips]} totalBet={25 * (i + 1)} />);
      });
    }

    // Should not crash
    expect(tree.root).toBeTruthy();
  });

  it('handles clearing chips', () => {
    const chips = [createChip(25), createChip(100)];

    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<ChipPile chips={chips} totalBet={125} />);
    });

    let texts = tree.root.findAllByType(Text);
    let totalText = findTextWithContent(texts, '$125');
    expect(totalText).toBeTruthy();

    // Clear chips
    act(() => {
      tree.update(<ChipPile chips={[]} totalBet={0} />);
    });

    texts = tree.root.findAllByType(Text);
    const emptyText = findTextWithContent(texts, 'Drop chips here');
    expect(emptyText).toBeTruthy();
  });

  it('updates counter when new chips added', () => {
    const chips = [createChip(25)];

    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<ChipPile chips={chips} totalBet={25} />);
    });

    let texts = tree.root.findAllByType(Text);
    let totalText = findTextWithContent(texts, '$25');
    expect(totalText).toBeTruthy();

    // Add another chip
    const newChips = [...chips, createChip(100)];
    act(() => {
      tree.update(<ChipPile chips={newChips} totalBet={125} />);
    });

    texts = tree.root.findAllByType(Text);
    totalText = findTextWithContent(texts, '$125');
    expect(totalText).toBeTruthy();
  });
});
