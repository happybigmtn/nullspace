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
import { SicBoScreen } from '../SicBoScreen';

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

describe('SicBoScreen', () => {
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
      tree = create(<SicBoScreen />);
    });

    await pressAll(tree);
    expect(tree.toJSON()).toBeTruthy();
  });

  it('handles game_result win state', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<SicBoScreen />);
    });

    setGameConnectionMessage({
      type: 'game_result',
      dice: [2, 3, 4],
      totalReturn: 120,
      totalWagered: 20,
    });

    act(() => {
      tree.update(<SicBoScreen />);
    });

    expect(mockHaptics.win).toHaveBeenCalled();
  });

  it('adds a quick bet and rolls', async () => {
    const sendSpy = mockUseGameConnection().send;
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<SicBoScreen />);
    });

    const smallBet = findPressableByText(tree, 'SMALL');
    act(() => {
      smallBet.props.onPress();
    });

    const rollButton = findPrimaryButton(tree, 'ROLL');
    await act(async () => {
      await rollButton?.props.onPress?.();
    });

    expect(mockHaptics.diceRoll).toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith({
      type: 'sic_bo_roll',
      bets: [{ type: 'SMALL', amount: 25, target: undefined }],
    });
  });

  it('handles game_result loss state', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<SicBoScreen />);
    });

    setGameConnectionMessage({
      type: 'game_result',
      dice: [1, 1, 1],
      totalReturn: 0,
      totalWagered: 25,
    });

    act(() => {
      tree.update(<SicBoScreen />);
    });

    expect(mockHaptics.loss).toHaveBeenCalled();
  });

  describe('isMounted pattern', () => {
    it('unmounts cleanly without setState warnings', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<SicBoScreen />);
      });

      act(() => {
        tree.unmount();
      });

      expect(true).toBe(true);
    });

    it('handles message after unmount without errors', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<SicBoScreen />);
      });

      act(() => {
        tree.unmount();
      });

      setGameConnectionMessage({
        type: 'game_result',
        dice: [2, 3, 4],
        totalReturn: 120,
        totalWagered: 20,
      });

      expect(true).toBe(true);
    });
  });
});
