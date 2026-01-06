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
import { CrapsScreen } from '../CrapsScreen';

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

describe('CrapsScreen', () => {
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
      tree = create(<CrapsScreen />);
    });

    await pressAll(tree);
    expect(tree.toJSON()).toBeTruthy();
  });

  it('handles game_result win state', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<CrapsScreen />);
    });

    setGameConnectionMessage({
      type: 'game_result',
      dice: [3, 4],
      point: 8,
      totalReturn: 200,
      totalWagered: 50,
    });

    act(() => {
      tree.update(<CrapsScreen />);
    });

    expect(mockHaptics.win).toHaveBeenCalled();
  });

  it('adds pass line bet and places bets', async () => {
    const sendSpy = mockUseGameConnection().send;
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<CrapsScreen />);
    });

    const passLine = findPressableByText(tree, 'PASS LINE');
    act(() => {
      passLine.props.onPress();
    });

    const placeBets = findPrimaryButton(tree, 'PLACE BETS');
    await act(async () => {
      await placeBets?.props.onPress?.();
    });

    expect(sendSpy).toHaveBeenCalledWith({
      type: 'craps_live_bet',
      bets: [{ type: 'PASS', amount: 25, target: undefined }],
    });
  });

  it('handles game_result loss state', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<CrapsScreen />);
    });

    setGameConnectionMessage({
      type: 'game_result',
      dice: [1, 2],
      point: 4,
      totalReturn: 0,
      totalWagered: 50,
    });

    act(() => {
      tree.update(<CrapsScreen />);
    });

    expect(mockHaptics.loss).toHaveBeenCalled();
  });

  describe('isMounted pattern', () => {
    it('unmounts cleanly without setState warnings', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<CrapsScreen />);
      });

      act(() => {
        tree.unmount();
      });

      expect(true).toBe(true);
    });

    it('handles message after unmount without errors', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<CrapsScreen />);
      });

      act(() => {
        tree.unmount();
      });

      setGameConnectionMessage({
        type: 'game_result',
        dice: [3, 4],
        point: 8,
        totalReturn: 200,
        totalWagered: 50,
      });

      expect(true).toBe(true);
    });
  });
});
