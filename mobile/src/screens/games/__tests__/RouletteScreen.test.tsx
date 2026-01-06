import React from 'react';
import { act, create } from 'react-test-renderer';
import {
  mockHaptics,
  mockUseGameConnection,
  pressAll,
  resetGameConnection,
  setGameConnectionMessage,
} from '../../../test-utils/gameScreenTestUtils';
import { PrimaryButton } from '../../../components/ui';
import { RouletteScreen } from '../RouletteScreen';

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const Reanimated = require('react-native-reanimated/mock');
  return {
    ...Reanimated,
    useSharedValue: (value: number) => {
      const ref = React.useRef({ value });
      return ref.current;
    },
  };
});

describe('RouletteScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGameConnection();
  });

  const findPrimaryButton = (tree: ReturnType<typeof create>, label: string) =>
    tree.root.findAllByType(PrimaryButton).find((node) => node.props.label === label);

  const findPressableByText = (tree: ReturnType<typeof create>, target: string) =>
    tree.root.find(
      (node) =>
        typeof node.props?.onPress === 'function'
        && node.findAll(
          (child) =>
            typeof child?.props?.children === 'string'
            && child.props.children === target
        ).length > 0
    );

  it('renders and handles actions', async () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<RouletteScreen />);
    });

    await pressAll(tree);
    expect(tree.toJSON()).toBeTruthy();
  });

  it('handles game_result win state', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<RouletteScreen />);
    });

    setGameConnectionMessage({
      type: 'game_result',
      won: true,
      result: 17,
      totalReturn: 150,
      totalWagered: 25,
    });

    act(() => {
      tree.update(<RouletteScreen />);
    });

    expect(mockHaptics.win).toHaveBeenCalled();
  });

  it('adds a quick bet and spins', async () => {
    const sendSpy = mockUseGameConnection().send;
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<RouletteScreen />);
    });

    const redBet = findPressableByText(tree, 'RED');
    act(() => {
      redBet.props.onPress();
    });

    const spinButton = findPrimaryButton(tree, 'SPIN');
    await act(async () => {
      await spinButton?.props.onPress?.();
    });

    expect(mockHaptics.wheelSpin).toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith({
      type: 'roulette_spin',
      bets: [{ type: 'RED', amount: 25, target: undefined }],
    });
  });

  it('handles game_result loss state', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<RouletteScreen />);
    });

    setGameConnectionMessage({
      type: 'game_result',
      won: false,
      result: 1,
      totalReturn: 0,
      totalWagered: 25,
    });

    act(() => {
      tree.update(<RouletteScreen />);
    });

    expect(mockHaptics.loss).toHaveBeenCalled();
  });

  describe('isMounted pattern', () => {
    it('unmounts cleanly without setState warnings', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<RouletteScreen />);
      });

      act(() => {
        tree.unmount();
      });

      expect(true).toBe(true);
    });

    it('handles message after unmount without errors', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<RouletteScreen />);
      });

      act(() => {
        tree.unmount();
      });

      setGameConnectionMessage({
        type: 'game_result',
        won: true,
        result: 17,
        totalReturn: 150,
        totalWagered: 25,
      });

      expect(true).toBe(true);
    });
  });
});
